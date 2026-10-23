-- Zomatik · Z2b: NP con saldo, una NP para varios pedidos, vendedor de quien programa y pasada con pg_cron
-- SIN APLICAR (avisar a Bautista antes). Va DESPUÉS de 202610222200_zomatik_np.sql (ya aplicada).
--
-- Especificación: docs/migracion-loop/zomatik.md, sección 25 (respuestas de Bautista del 23/10).
-- CORRERLA FUERA DE HORARIO: pide candados cortos sobre zomatik_np, zomatik_np_pedido, dispatches y
-- scheduled_dispatches (los triggers).
--
-- Qué cambia:
--   zomatik_np_uso        qué pedido usa qué NP y por cuántos m³. Una NP puede servir a varios pedidos (un pedido toma
--                         parte del saldo: "tal vez la NP es mayor a lo que se pide ese día"). El saldo de una NP =
--                         m³ de la NP − lo que reservan los pedidos activos − lo despachado de los demás. Solo servidor.
--   zomatik_np.saldo_*    el saldo de una NP que quedó sin pedido activo (pedido cancelado, cambiado o finalizado con
--                         sobrante): queda "NP con saldo: pendiente" en Programación desde `saldo_desde`, SIN
--                         vencimiento, hasta que alguien toque Reprogramar o Devolver el saldo. saldo_decision: nulo =
--                         pendiente · devolver (falta la devolución DEVOL a mano) · cerrada (vaciada o devuelta).
--   zomatik_np.fecha_zomatik  la fecha de entrega con la que se grabó en Zomatik (solo de registro). Si se mueve la NP a
--                         otra fecha, cambia `fecha` en nuestro sistema; en Zomatik no hace falta cambiarla (25.5).
--   zomatik_np_pedido     suma el tipo "saldo" (usar una NP con saldo) y `np_id`.
--   zomatik_vendedores    usuario de la app → vendedor de Zomatik (5.5). Lo edita un gerencial en Vínculos. Se cargan
--                         Fernando Maldonado 100, Juan Oreguy 101 y Felipe Calvo 123. Solo servidor.
--   trigger del despacho  el pedido tiene NP si alguna NP "ok" está en uso por el pedido (zomatik_np_uso).
--   zomatik_np_saldo / _reservar / _devolver / _desvincular  el saldo se calcula y se reserva en la base con la NP
--                         bloqueada (FOR UPDATE): dos reprogramaciones, o reprogramar y devolver, nunca toman el mismo
--                         saldo. Al desvincular un uso queda la foto de lo despachado contra esa NP (despachado_fijo).
--   pedido con NP         no se puede eliminar (trigger BEFORE DELETE): se cancela y la NP queda pendiente.
--   pg_cron               la pasada de las NP cada 10 min (al final, con lo que hay que hacer antes).
--
-- Qué pasa con los datos ya cargados:
--   - zomatik_np (hoy vacía: la llave nunca se prendió): cada NP pasa a tener su uso por el pedido que la generó, por
--     sus m³ (si estaba anulada, no). fecha_zomatik = fecha. Nada más cambia.
--   - zomatik_np_pedido: las elecciones guardadas siguen igual.
--   - dispatches: el trigger sigue actuando solo en despachos NUEVOS con la llave prendida (hoy apagada en las dos).

SET lock_timeout = '3s';
SET statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- Saldo de las NP
-- ---------------------------------------------------------------------------
ALTER TABLE public.zomatik_np
  ADD COLUMN IF NOT EXISTS saldo_decision text,
  ADD COLUMN IF NOT EXISTS saldo_decision_por text,
  ADD COLUMN IF NOT EXISTS saldo_decision_at timestamptz,
  ADD COLUMN IF NOT EXISTS saldo_mensaje text,
  ADD COLUMN IF NOT EXISTS saldo_desde timestamptz,
  ADD COLUMN IF NOT EXISTS fecha_zomatik date,
  ADD COLUMN IF NOT EXISTS vendedor_usuario_id uuid;

ALTER TABLE public.zomatik_np DROP CONSTRAINT IF EXISTS zomatik_np_saldo_decision_check;
ALTER TABLE public.zomatik_np ADD CONSTRAINT zomatik_np_saldo_decision_check CHECK (saldo_decision IS NULL OR saldo_decision IN ('devolver', 'cerrada'));

UPDATE public.zomatik_np SET fecha_zomatik = fecha WHERE fecha_zomatik IS NULL AND estado NOT IN ('pendiente', 'error', 'anulada');

COMMENT ON COLUMN public.zomatik_np.saldo_decision IS 'Zomatik Z2b: NP con saldo sin pedido activo. Nulo = pendiente (en Programación, sin vencimiento) · devolver (DEVOL a mano) · cerrada.';
COMMENT ON COLUMN public.zomatik_np.saldo_desde IS 'Zomatik Z2b: desde cuándo la NP está pendiente con saldo y sin pedido activo (nulo si la usa un pedido activo).';
COMMENT ON COLUMN public.zomatik_np.vendedor_usuario_id IS 'Zomatik Z2b: usuario (sesión del servidor) que guardó el pedido cuando se creó esta NP: su vendedor de Zomatik va en la NP.';
COMMENT ON COLUMN public.zomatik_np.fecha_zomatik IS 'Zomatik Z2b: fecha de entrega grabada en Zomatik (fecha puede moverse solo en nuestro sistema).';

-- ---------------------------------------------------------------------------
-- Pedidos que usan cada NP
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.zomatik_np_uso (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  np_id                  uuid NOT NULL REFERENCES public.zomatik_np(id) ON DELETE CASCADE,
  -- Si se borra el pedido queda nulo: la NP sigue en Zomatik y pasa a "NP con saldo: decidir"
  scheduled_dispatch_id  uuid REFERENCES public.scheduled_dispatches(id) ON DELETE SET NULL,
  m3                     numeric(10,3) NOT NULL CHECK (m3 >= 0),   -- m³ que el pedido reserva de la NP
  activo                 boolean NOT NULL DEFAULT true,            -- false = el pedido dejó de usarla (cambió fórmula, cliente, fecha…)
  despachado_fijo        numeric(10,3),                            -- al desvincular: lo despachado contra esta NP hasta ese momento (foto)
  motivo                 text,                                     -- por qué se desvinculó
  created_by             text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zomatik_np_uso_np_idx ON public.zomatik_np_uso (np_id);
CREATE INDEX IF NOT EXISTS zomatik_np_uso_pedido_idx ON public.zomatik_np_uso (scheduled_dispatch_id);
CREATE UNIQUE INDEX IF NOT EXISTS zomatik_np_uso_activo_key ON public.zomatik_np_uso (np_id, scheduled_dispatch_id) WHERE activo AND scheduled_dispatch_id IS NOT NULL;
COMMENT ON TABLE public.zomatik_np_uso IS 'Zomatik Z2b: qué pedido usa qué NP y por cuántos m³ (una NP puede servir a varios pedidos). Solo la escribe el servidor.';

REVOKE ALL ON TABLE public.zomatik_np_uso FROM anon, authenticated;
GRANT ALL ON TABLE public.zomatik_np_uso TO service_role;

INSERT INTO public.zomatik_np_uso (np_id, scheduled_dispatch_id, m3, created_by, created_at)
SELECT n.id, n.scheduled_dispatch_id, n.m3, n.created_by, n.created_at
FROM public.zomatik_np n
WHERE n.scheduled_dispatch_id IS NOT NULL AND n.estado <> 'anulada'
  AND NOT EXISTS (SELECT 1 FROM public.zomatik_np_uso u WHERE u.np_id = n.id);

-- ---------------------------------------------------------------------------
-- Elección del pedido: "Usar NP con saldo"
-- ---------------------------------------------------------------------------
ALTER TABLE public.zomatik_np_pedido ADD COLUMN IF NOT EXISTS np_id uuid REFERENCES public.zomatik_np(id) ON DELETE SET NULL;
ALTER TABLE public.zomatik_np_pedido DROP CONSTRAINT IF EXISTS zomatik_np_pedido_tipo_check;
ALTER TABLE public.zomatik_np_pedido DROP CONSTRAINT IF EXISTS zomatik_np_pedido_proyecto_check;
ALTER TABLE public.zomatik_np_pedido ADD CONSTRAINT zomatik_np_pedido_tipo_check CHECK (tipo IN ('nueva', 'proyecto', 'saldo'));
ALTER TABLE public.zomatik_np_pedido ADD CONSTRAINT zomatik_np_pedido_proyecto_check CHECK (
  (tipo <> 'proyecto' OR proyecto_codigo IS NOT NULL) AND (tipo <> 'saldo' OR np_id IS NOT NULL)
) NOT VALID;

-- ---------------------------------------------------------------------------
-- Vendedor de Zomatik de quien programa (respuesta 4)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.zomatik_vendedores (
  app_user_id      uuid PRIMARY KEY REFERENCES public.app_users(id) ON DELETE CASCADE,
  vendedor_id      integer NOT NULL CHECK (vendedor_id > 0),
  vendedor_nombre  text,
  updated_by       text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.zomatik_vendedores IS 'Zomatik Z2b: usuario de la app → vendedor de Zomatik (la NP lleva el de quien programa; si no tiene, el del cliente). Solo la escribe el servidor.';

REVOKE ALL ON TABLE public.zomatik_vendedores FROM anon, authenticated;
GRANT ALL ON TABLE public.zomatik_vendedores TO service_role;

INSERT INTO public.zomatik_vendedores (app_user_id, vendedor_id, vendedor_nombre, updated_by)
SELECT u.id, v.id, v.nombre, 'migración 202610231000'
FROM public.app_users u
JOIN (VALUES ('fernando maldonado', 100, 'MALDONADO FERNANDO'), ('juan oreguy', 101, 'OREGUY JUAN'), ('felipe calvo', 123, 'CALVO FELIPE')) AS v(nombre_app, id, nombre)
  ON lower(btrim(u.name)) = v.nombre_app
ON CONFLICT (app_user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Trigger del despacho: NP en uso por el pedido
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.zomatik_np_control_despacho()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg  public.zomatik_np_config;
  v_ped  public.scheduled_dispatches;
  v_dia  date := (coalesce(NEW.dispatch_date, now()) AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_quien text := coalesce(nullif(btrim(NEW.created_by), ''), 'sistema');
BEGIN
  SELECT * INTO v_cfg FROM zomatik_np_config WHERE plant_id = NEW.plant_id;
  IF NOT FOUND OR NOT v_cfg.activo THEN
    RETURN NEW;                                  -- llave apagada: como hoy
  END IF;

  IF NEW.scheduled_dispatch_id IS NULL THEN      -- despacho manual: sin control, queda anotado
    INSERT INTO activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
    VALUES (v_quien, 'crear', 'zomatik_np', NULL, 'Despacho manual sin NP', NEW.plant_id,
            jsonb_build_object('Qué pasó', 'Despacho manual: no tiene NP automática (cargala a mano en Zomatik)', 'Remito', NEW.remito, 'm³', NEW.quantity_m3));
    RETURN NEW;
  END IF;

  SELECT * INTO v_ped FROM scheduled_dispatches WHERE id = NEW.scheduled_dispatch_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF v_cfg.desde IS NOT NULL AND v_ped.created_at < v_cfg.desde THEN
    RETURN NEW;                                  -- pedido de antes de prender la llave: su NP es a mano
  END IF;
  IF EXISTS (SELECT 1 FROM zomatik_np_uso u JOIN zomatik_np n ON n.id = u.np_id
             WHERE u.scheduled_dispatch_id = v_ped.id AND u.activo AND n.estado = 'ok') THEN
    RETURN NEW;
  END IF;

  IF coalesce(NEW.is_test_dispatch, false) THEN  -- despacho de prueba: no se frena, queda anotado
    INSERT INTO activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
    VALUES (v_quien, 'crear', 'zomatik_np', v_ped.id::text, 'Despacho de prueba sin NP', NEW.plant_id,
            jsonb_build_object('Qué pasó', 'Despacho de prueba de un pedido sin NP (no se controla)', 'Remito', NEW.remito, 'm³', NEW.quantity_m3));
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM zomatik_np_excepciones WHERE scheduled_dispatch_id = v_ped.id AND fecha = v_dia) THEN
    INSERT INTO activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
    VALUES (v_quien, 'crear', 'zomatik_np', v_ped.id::text, 'Despacho sin NP (autorizado)', NEW.plant_id,
            jsonb_build_object('Qué pasó', 'Despacho sin NP con la excepción de un gerencial', 'Remito', NEW.remito, 'm³', NEW.quantity_m3));
    RETURN NEW;
  END IF;

  IF v_cfg.exigir_np = 'duro' OR (v_cfg.aviso_hasta IS NOT NULL AND v_dia > v_cfg.aviso_hasta) THEN
    RAISE EXCEPTION 'NP pendiente: el pedido no tiene su nota de pedido en Zomatik. Avisale a Programación (o pedile la excepción a un gerencial).';
  END IF;

  INSERT INTO activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
  VALUES (v_quien, 'crear', 'zomatik_np', v_ped.id::text, 'Despacho sin NP (modo aviso)', NEW.plant_id,
          jsonb_build_object('Qué pasó', 'Se despachó un pedido con la NP pendiente (modo aviso: deja despachar)', 'Remito', NEW.remito, 'm³', NEW.quantity_m3));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.zomatik_np_control_despacho() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Saldo de una NP en la base (misma cuenta que saldoNp() de lib/zomatik/np.ts) y reservas con candado
-- ---------------------------------------------------------------------------

-- Lo despachado de un pedido que le corresponde a un uso. Un uso desactivado guarda su foto (despachado_fijo); lo
-- demás de lo despachado se reparte entre los usos activos del pedido en el orden en que se crearon (el último se
-- lleva lo que sobre).
CREATE OR REPLACE FUNCTION public.zomatik_np_uso_despachado(p_uso uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH u AS (SELECT * FROM zomatik_np_uso WHERE id = p_uso),
  ped AS (SELECT sd.id, coalesce(sd.dispatched_m3, 0) AS desp FROM scheduled_dispatches sd JOIN u ON sd.id = u.scheduled_dispatch_id),
  fijos AS (SELECT coalesce(sum(x.despachado_fijo), 0) AS f FROM zomatik_np_uso x JOIN ped ON x.scheduled_dispatch_id = ped.id WHERE NOT x.activo),
  activos AS (
    SELECT x.id, x.m3,
           coalesce(sum(x.m3) OVER (ORDER BY x.created_at, x.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS antes,
           row_number() OVER (ORDER BY x.created_at DESC, x.id DESC) = 1 AS ultimo
    FROM zomatik_np_uso x JOIN ped ON x.scheduled_dispatch_id = ped.id
    WHERE x.activo
  )
  SELECT CASE
    WHEN NOT (SELECT activo FROM u) THEN coalesce((SELECT despachado_fijo FROM u), 0)
    WHEN NOT EXISTS (SELECT 1 FROM ped) THEN coalesce((SELECT despachado_fijo FROM u), 0)
    ELSE coalesce((
      SELECT CASE WHEN a.ultimo THEN greatest((SELECT desp FROM ped) - (SELECT f FROM fijos) - a.antes, 0)
                  ELSE least(a.m3, greatest((SELECT desp FROM ped) - (SELECT f FROM fijos) - a.antes, 0)) END
      FROM activos a WHERE a.id = p_uso), 0)
  END
$$;

-- Saldo de una NP: libre = m³ − comprometido. Un uso activo de un pedido activo compromete lo que reserva (o lo
-- despachado, si es más); uno desactivado o de un pedido cerrado, solo lo despachado contra la NP.
CREATE OR REPLACE FUNCTION public.zomatik_np_saldo(p_np uuid)
RETURNS TABLE (libre numeric, comprometido numeric, con_pedido_activo boolean)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT round(n.m3 - coalesce(sum(c.comp), 0), 3), round(coalesce(sum(c.comp), 0), 3), coalesce(bool_or(c.act), false)
  FROM zomatik_np n
  LEFT JOIN LATERAL (
    SELECT CASE
             WHEN NOT x.activo OR sd.id IS NULL THEN coalesce(x.despachado_fijo, 0)
             WHEN sd.status NOT IN ('cancelled', 'completed') THEN greatest(x.m3, zomatik_np_uso_despachado(x.id))
             ELSE least(x.m3, zomatik_np_uso_despachado(x.id))
           END AS comp,
           (x.activo AND sd.id IS NOT NULL AND sd.status NOT IN ('cancelled', 'completed')) AS act
    FROM zomatik_np_uso x LEFT JOIN scheduled_dispatches sd ON sd.id = x.scheduled_dispatch_id
    WHERE x.np_id = n.id
  ) c ON true
  WHERE n.id = p_np
  GROUP BY n.m3
$$;

-- Reservar (o cambiar) lo que un pedido usa de una NP. Bloquea la NP (FOR UPDATE), recalcula lo libre y recién ahí
-- escribe: dos reprogramaciones a la vez, o reprogramar y devolver a la vez, no se pisan. Devuelve los m³ que quedaron
-- reservados (puede ser menos de lo pedido si no alcanza; 0 si la NP ya no se puede usar).
CREATE OR REPLACE FUNCTION public.zomatik_np_reservar(p_np uuid, p_pedido uuid, p_m3 numeric, p_usuario text)
RETURNS numeric
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_np    zomatik_np;
  v_uso   zomatik_np_uso;
  v_libre numeric;
  v_m     numeric;
BEGIN
  SELECT * INTO v_np FROM zomatik_np WHERE id = p_np FOR UPDATE;
  IF NOT FOUND OR v_np.estado IN ('anulada', 'vaciar', 'vaciando', 'vaciada') THEN
    RETURN 0;
  END IF;
  SELECT * INTO v_uso FROM zomatik_np_uso WHERE np_id = p_np AND scheduled_dispatch_id = p_pedido AND activo FOR UPDATE;
  SELECT s.libre INTO v_libre FROM zomatik_np_saldo(p_np) s;
  IF v_uso.id IS NOT NULL THEN
    v_m := CASE WHEN p_m3 <= v_uso.m3 THEN p_m3 ELSE least(p_m3, v_uso.m3 + greatest(v_libre, 0)) END;
    v_m := round(greatest(v_m, 0), 3);
    UPDATE zomatik_np_uso SET m3 = v_m, updated_at = now() WHERE id = v_uso.id;
    RETURN v_m;
  END IF;
  IF v_np.saldo_decision IN ('devolver', 'cerrada') THEN
    RETURN 0;                                    -- se está devolviendo o ya se cerró
  END IF;
  v_m := round(least(greatest(p_m3, 0), greatest(v_libre, 0)), 3);
  IF v_m > 0 THEN
    INSERT INTO zomatik_np_uso (np_id, scheduled_dispatch_id, m3, created_by) VALUES (p_np, p_pedido, v_m, p_usuario);
    UPDATE zomatik_np SET saldo_desde = NULL, saldo_decision = NULL, saldo_mensaje = NULL, updated_at = now() WHERE id = p_np;
  END IF;
  RETURN v_m;
END;
$$;

-- El pedido deja de usar la NP: guarda la foto de lo despachado contra ella hasta ahora.
CREATE OR REPLACE FUNCTION public.zomatik_np_desvincular(p_uso uuid, p_motivo text)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE zomatik_np_uso SET despachado_fijo = zomatik_np_uso_despachado(p_uso), activo = false, motivo = p_motivo, updated_at = now()
  WHERE id = p_uso AND activo;
$$;

-- "Devolver el saldo": con la NP bloqueada (no se pisa con una reprogramación). Sin despachos: se vacía (el robot);
-- con despachos: hace falta la devolución (DEVOL) a mano. Devuelve {modo, libre} o {error}.
CREATE OR REPLACE FUNCTION public.zomatik_np_devolver(p_np uuid, p_usuario text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_np zomatik_np;
  v_s  record;
  v_msg text;
BEGIN
  SELECT * INTO v_np FROM zomatik_np WHERE id = p_np FOR UPDATE;
  IF NOT FOUND OR v_np.estado <> 'ok' THEN
    RETURN jsonb_build_object('error', 'La NP ya no está en Zomatik o se está trabajando. Actualizá la pantalla.');
  END IF;
  SELECT * INTO v_s FROM zomatik_np_saldo(p_np);
  IF v_s.con_pedido_activo THEN
    RETURN jsonb_build_object('error', 'La NP la está usando un pedido activo.');
  END IF;
  IF v_s.libre <= 0.001 THEN
    RETURN jsonb_build_object('error', 'La NP no tiene saldo.');
  END IF;
  IF v_s.comprometido > 0.001 THEN
    v_msg := format('Tuvo despachos: hace falta una devolución de pedido (DEVOL) por %s m³. Todavía no la hace el sistema: hacela a mano en Zomatik y después un gerencial toca "Ya la devolví".', v_s.libre);
    UPDATE zomatik_np SET saldo_decision = 'devolver', saldo_decision_por = p_usuario, saldo_decision_at = now(), saldo_mensaje = v_msg, updated_at = now() WHERE id = p_np;
    RETURN jsonb_build_object('modo', 'devol', 'libre', v_s.libre, 'mensaje', v_msg);
  END IF;
  v_msg := 'Se vacía en Zomatik (sin despachos).';
  UPDATE zomatik_np SET estado = 'vaciar', proximo_intento = now(), paso = NULL, saldo_decision = 'devolver', saldo_decision_por = p_usuario, saldo_decision_at = now(), saldo_mensaje = v_msg, updated_at = now() WHERE id = p_np;
  RETURN jsonb_build_object('modo', 'vaciar', 'libre', v_s.libre, 'mensaje', v_msg);
END;
$$;

REVOKE ALL ON FUNCTION public.zomatik_np_uso_despachado(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zomatik_np_saldo(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zomatik_np_reservar(uuid, uuid, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zomatik_np_desvincular(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zomatik_np_devolver(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zomatik_np_uso_despachado(uuid), public.zomatik_np_saldo(uuid), public.zomatik_np_reservar(uuid, uuid, numeric, text), public.zomatik_np_desvincular(uuid, text), public.zomatik_np_devolver(uuid, text) TO service_role;

-- Un pedido que usa una NP de Zomatik no se borra (se perdería lo despachado contra ella): se cancela y la NP queda
-- pendiente en Programación.
CREATE OR REPLACE FUNCTION public.zomatik_np_no_borrar_pedido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM zomatik_np_uso u JOIN zomatik_np n ON n.id = u.np_id WHERE u.scheduled_dispatch_id = OLD.id AND n.estado <> 'anulada') THEN
    RAISE EXCEPTION 'El pedido tiene nota de pedido en Zomatik: no se puede eliminar. Cancelalo (la NP queda pendiente en Programación).';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.zomatik_np_no_borrar_pedido() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_scheduled_dispatches_zomatik_np ON public.scheduled_dispatches;
CREATE TRIGGER trg_scheduled_dispatches_zomatik_np
  BEFORE DELETE ON public.scheduled_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.zomatik_np_no_borrar_pedido();

RESET lock_timeout;
RESET statement_timeout;

-- ---------------------------------------------------------------------------
-- Pasada de las NP cada 10 min con pg_cron (respuesta 3)
--
-- ANTES de correr este bloque, Bautista guarda en Vault el mismo CRON_SECRET que está en Vercel (proyecto Rebucret),
-- una sola vez, desde el SQL Editor de Supabase (el secreto no va en este archivo):
--     select vault.create_secret('<el CRON_SECRET de Vercel>', 'cron_secret');
-- Sin el secreto, la llamada sale sin clave y /api/zomatik/np/procesar la rechaza (401): no hace nada.
-- Con la llave de las NP apagada, la pasada no escribe nada en Zomatik.
-- Para sacarlo: select cron.unschedule('zomatik-np-pasada');
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'zomatik-np-pasada';

SELECT cron.schedule(
  'zomatik-np-pasada',
  '*/10 * * * *',
  $cron$
    SELECT net.http_get(
      url := 'https://www.produccionrebucret.com/api/zomatik/np/procesar',
      headers := jsonb_build_object('Authorization', 'Bearer ' || coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'), '')),
      timeout_milliseconds := 60000
    );
  $cron$
);
