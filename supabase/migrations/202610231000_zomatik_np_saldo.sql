-- Zomatik · Z2b: NP con saldo, una NP para varios pedidos, vendedor de quien programa y pasada con pg_cron
-- SIN APLICAR (avisar a Bautista antes). Va DESPUÉS de 202610222200_zomatik_np.sql (ya aplicada).
--
-- Especificación: docs/migracion-loop/zomatik.md, sección 25 (respuestas de Bautista del 23/10).
-- CORRERLA FUERA DE HORARIO: pide candados cortos sobre zomatik_np, zomatik_np_pedido y dispatches (el trigger).
--
-- Qué cambia:
--   zomatik_np_uso        qué pedido usa qué NP y por cuántos m³. Una NP puede servir a varios pedidos (un pedido toma
--                         parte del saldo: "tal vez la NP es mayor a lo que se pide ese día"). El saldo de una NP =
--                         m³ de la NP − lo que reservan los pedidos activos − lo despachado de los demás. Solo servidor.
--   zomatik_np.saldo_*    el saldo de una NP que quedó sin pedido activo (pedido cancelado, cambiado o finalizado con
--                         sobrante): queda "NP con saldo: pendiente" en Programación desde `saldo_desde`, SIN
--                         vencimiento, hasta que alguien toque Reprogramar o Devolver el saldo. saldo_decision: nulo =
--                         pendiente · devolver (falta la devolución DEVOL a mano) · cerrada (vaciada o devuelta).
--   zomatik_np.fecha_zomatik  la fecha de entrega con la que se grabó en Zomatik (si se mueve la NP a otra fecha, en
--                         nuestro sistema cambia `fecha`; en Zomatik queda esta hasta que se pruebe CambiarFechaEntrega).
--   zomatik_np_pedido     suma el tipo "saldo" (usar una NP con saldo) y `np_id`.
--   zomatik_vendedores    usuario de la app → vendedor de Zomatik (5.5). Lo edita un gerencial en Vínculos. Se cargan
--                         Fernando Maldonado 100, Juan Oreguy 101 y Felipe Calvo 123. Solo servidor.
--   trigger del despacho  el pedido tiene NP si alguna NP "ok" está en uso por el pedido (zomatik_np_uso).
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
  ADD COLUMN IF NOT EXISTS fecha_zomatik date;

ALTER TABLE public.zomatik_np DROP CONSTRAINT IF EXISTS zomatik_np_saldo_decision_check;
ALTER TABLE public.zomatik_np ADD CONSTRAINT zomatik_np_saldo_decision_check CHECK (saldo_decision IS NULL OR saldo_decision IN ('devolver', 'cerrada'));

UPDATE public.zomatik_np SET fecha_zomatik = fecha WHERE fecha_zomatik IS NULL AND estado NOT IN ('pendiente', 'error', 'anulada');

COMMENT ON COLUMN public.zomatik_np.saldo_decision IS 'Zomatik Z2b: NP con saldo sin pedido activo. Nulo = pendiente (en Programación, sin vencimiento) · devolver (DEVOL a mano) · cerrada.';
COMMENT ON COLUMN public.zomatik_np.saldo_desde IS 'Zomatik Z2b: desde cuándo la NP está pendiente con saldo y sin pedido activo (nulo si la usa un pedido activo).';
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
