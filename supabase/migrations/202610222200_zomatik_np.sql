-- Zomatik · Etapa Z2: nota de pedido (NP) al programar — SIN APLICAR (avisar a Bautista antes)
--
-- Especificación: docs/migracion-loop/zomatik.md, secciones 22, 23 y 24 (mandan sobre las anteriores).
--
-- CORRERLA FUERA DE HORARIO (sin despachos en curso): pide candados cortos sobre construction_sites, zomatik_articulos,
-- zomatik_proyectos y dispatches (el trigger). Con lock_timeout de 3 s: si no los consigue, falla sin cambiar nada.
--
-- Qué agrega (todo se agrega; no se borra ni se cambia nada de lo cargado):
--   zomatik_np_config             por planta: LLAVE de la NP automática (`activo`, APAGADA por defecto), desde cuándo,
--                                 depósito de Zomatik (Canning 116, Hudson = REBUCRET 113), modo (aviso/duro) y hasta
--                                 cuándo dura el aviso (2 semanas, 20.7). SOLO la escribe el servidor (service_role):
--                                 `plants` la puede escribir la clave anon, por eso la llave no vive ahí.
--   zomatik_np_pedido             por pedido: "NP nueva" o "NP de un proyecto", qué proyecto y (opcional) hasta cuántos
--                                 m³ contra el proyecto (el resto en una NP nueva, 20.4). Solo el servidor, que valida que
--                                 el proyecto esté abierto y sea del cliente.
--   construction_sites.zomatik_proyecto_codigo  el último proyecto elegido en la obra: solo una SUGERENCIA para el
--                                 formulario (el servidor la vuelve a validar al guardar el pedido).
--   zomatik_articulos.codigo_sistema  el código que usa el pedido (`farticulo`, columna "Codigo Sistema", 23.1).
--   zomatik_proyectos.disponible_* lo disponible del proyecto según "Continuar" del MATERIAL (23.2).
--   zomatik_np                    cada NP que genera el sistema (estado, mensaje, número, código). Navegador: solo lee.
--   zomatik_np_excepciones        "Despachar sin NP" de un gerencial, para un pedido y un día. Si se borra el pedido, la
--                                 excepción queda (con una copia del pedido) para Actividad.
--   zomatik_np_tomar()            toma una NP para el robot en una sola sentencia.
--   zomatik_robot_tomar/soltar()  una sola sesión del robot (y de la lectura de Zomatik) a la vez (23.3 e).
--   zomatik_np_control_despacho   trigger BEFORE INSERT en dispatches: con la llave prendida, en modo duro no deja
--                                 despachar un pedido sin NP ok (salvo excepción); en modo aviso deja y lo anota; el
--                                 despacho manual y el de prueba no se controlan y se anotan. Llave apagada: nada.
--                                 registrar_despacho NO se toca: el error sale del trigger en la misma transacción.
--
-- Qué pasa con los datos ya cargados:
--   - plants y scheduled_dispatches: no se tocan.
--   - zomatik_np_config: una fila por planta con la llave APAGADA (Canning 116, Hudson 113).
--   - construction_sites, zomatik_articulos y zomatik_proyectos: columnas nuevas vacías.
--   - dispatches: el trigger solo actúa en despachos NUEVOS y solo con la llave prendida. Los cargados no cambian.
--   - Las demás tablas nuevas, vacías. Los pedidos de antes de prender la llave nunca se controlan.

SET lock_timeout = '3s';
SET statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- Llave y modo por planta (solo el servidor)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.zomatik_np_config (
  plant_id      uuid PRIMARY KEY REFERENCES public.plants(id) ON DELETE CASCADE,
  activo        boolean NOT NULL DEFAULT false,
  desde         timestamptz,                    -- cuándo se prendió: solo los pedidos cargados después
  deposito      integer,                        -- depósito de Zomatik
  exigir_np     text NOT NULL DEFAULT 'aviso' CHECK (exigir_np IN ('aviso', 'duro')),
  aviso_hasta   date,                           -- modo aviso hasta este día (incluido); después, duro
  updated_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.zomatik_np_config IS 'Zomatik Z2: llave de la NP automática por planta (activo=false: no se escribe nunca en Zomatik). Solo la escribe el servidor.';

REVOKE ALL ON TABLE public.zomatik_np_config FROM anon, authenticated;
GRANT ALL ON TABLE public.zomatik_np_config TO service_role;

INSERT INTO public.zomatik_np_config (plant_id, deposito)
SELECT id, CASE code WHEN 'CAN' THEN 116 WHEN 'HUD' THEN 113 END FROM public.plants WHERE code IN ('CAN', 'HUD')
ON CONFLICT (plant_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- NP nueva o de un proyecto, por pedido (solo el servidor)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.zomatik_np_pedido (
  scheduled_dispatch_id  uuid PRIMARY KEY REFERENCES public.scheduled_dispatches(id) ON DELETE CASCADE,
  tipo                   text NOT NULL DEFAULT 'nueva' CHECK (tipo IN ('nueva', 'proyecto')),
  proyecto_codigo        integer,
  tope_m3                numeric(10,3) CHECK (tope_m3 IS NULL OR tope_m3 >= 0),
  updated_by             text,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zomatik_np_pedido_proyecto_check CHECK (tipo = 'nueva' OR proyecto_codigo IS NOT NULL)
);
COMMENT ON TABLE public.zomatik_np_pedido IS 'Zomatik Z2: NP nueva o contra un proyecto (y tope de m³ contra el proyecto, 20.4). Solo la escribe el servidor.';

REVOKE ALL ON TABLE public.zomatik_np_pedido FROM anon, authenticated;
GRANT ALL ON TABLE public.zomatik_np_pedido TO service_role;

ALTER TABLE public.construction_sites ADD COLUMN IF NOT EXISTS zomatik_proyecto_codigo integer;
COMMENT ON COLUMN public.construction_sites.zomatik_proyecto_codigo IS 'Zomatik Z2: el último proyecto elegido en la obra. Solo sugerencia: el servidor lo valida al guardar el pedido.';

-- ---------------------------------------------------------------------------
-- Copias de Zomatik
-- ---------------------------------------------------------------------------
ALTER TABLE public.zomatik_articulos ADD COLUMN IF NOT EXISTS codigo_sistema bigint;
COMMENT ON COLUMN public.zomatik_articulos.codigo_sistema IS 'Zomatik Z2: "Codigo Sistema" del export (articulos.codigo, lo que va en farticulo del pedido). codigo es el código interno.';

ALTER TABLE public.zomatik_proyectos
  ADD COLUMN IF NOT EXISTS disponible_m3 numeric(12,3),
  ADD COLUMN IF NOT EXISTS disponible_articulo text,
  ADD COLUMN IF NOT EXISTS disponible_at timestamptz;
COMMENT ON COLUMN public.zomatik_proyectos.disponible_m3 IS 'Zomatik Z2: lo disponible del renglón del proyecto según "Continuar" del MATERIAL (23.2), en la última NP generada.';

-- ---------------------------------------------------------------------------
-- Las NP que genera el sistema
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.zomatik_np (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Si se borra el pedido queda nulo: la NP sigue en Zomatik y la pasada la vacía como un pedido cancelado
  scheduled_dispatch_id  uuid REFERENCES public.scheduled_dispatches(id) ON DELETE SET NULL,
  n                      integer NOT NULL,                       -- 1 la primera, 2… las adicionales
  marca                  text NOT NULL UNIQUE,                   -- "Sistema Rebucret · pedido 1a2b3c4d · NP 1"
  tipo                   text NOT NULL CHECK (tipo IN ('nueva', 'proyecto')),
  es_adicional           boolean NOT NULL DEFAULT false,
  proyecto_codigo        integer,
  -- Foto del pedido al crearla (para avisar si después cambió)
  plant_id               uuid,
  client_id              uuid,
  formula_id             uuid,
  fecha                  date NOT NULL,
  m3                     numeric(10,3) NOT NULL CHECK (m3 > 0),
  -- Estado
  estado                 text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'generando', 'ok', 'revisar', 'error', 'vaciar', 'vaciando', 'vaciada', 'anulada')),
  paso                   text,                                   -- hasta dónde llegó el robot ("grabar" = puede haber grabado)
  mensaje                text,                                   -- lo que dijo Zomatik, en castellano
  numero                 text,                                   -- "NP 0001-00001176"
  zomatik_codigo         integer,                                -- modificar_pedidos.php?codigo=N
  sucursal               text,                                   -- donde quedó grabada (18 = REBUCRET)
  disponible_m3          numeric(12,3),                          -- NP de proyecto: lo disponible al generarla
  intentos               integer NOT NULL DEFAULT 0,
  proximo_intento        timestamptz,                            -- nulo = no se reintenta sola (error de datos)
  en_curso_desde         timestamptz,
  created_by             text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  ok_at                  timestamptz,
  vaciada_at             timestamptz,
  CONSTRAINT zomatik_np_pedido_n_key UNIQUE (scheduled_dispatch_id, n),
  CONSTRAINT zomatik_np_proyecto_check CHECK (tipo = 'nueva' OR proyecto_codigo IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS zomatik_np_pedido_idx ON public.zomatik_np (scheduled_dispatch_id);
CREATE INDEX IF NOT EXISTS zomatik_np_trabajo_idx ON public.zomatik_np (estado, proximo_intento) WHERE estado IN ('pendiente', 'generando', 'error', 'vaciar', 'vaciando', 'revisar');
COMMENT ON TABLE public.zomatik_np IS 'Zomatik Z2: notas de pedido que genera el sistema (una por pedido y día; adicionales si el pedido se agranda). La escribe solo el servidor; el navegador lee el estado.';

REVOKE ALL ON TABLE public.zomatik_np FROM anon, authenticated;
GRANT SELECT ON TABLE public.zomatik_np TO anon, authenticated;
GRANT ALL ON TABLE public.zomatik_np TO service_role;

CREATE TABLE IF NOT EXISTS public.zomatik_np_excepciones (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Si se borra el pedido queda nulo y la copia (pedido_ref, cliente, planta) sigue para Actividad
  scheduled_dispatch_id  uuid REFERENCES public.scheduled_dispatches(id) ON DELETE SET NULL,
  pedido_ref             text,
  cliente                text,
  plant_id               uuid,
  fecha                  date NOT NULL,                          -- día del despacho (dispatch_date en Argentina)
  motivo_tipo            text NOT NULL CHECK (motivo_tipo IN ('zomatik_caido', 'cliente_sin_alta', 'otro')),
  motivo                 text,
  autorizado_por         text NOT NULL,                          -- el gerencial
  pedido_por             text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  regularizado_at        timestamptz,
  CONSTRAINT zomatik_np_excepciones_dia_key UNIQUE (scheduled_dispatch_id, fecha)
);
COMMENT ON TABLE public.zomatik_np_excepciones IS 'Zomatik Z2: "Despachar sin NP" autorizado por un gerencial, para ese pedido y ese día (18.4).';

REVOKE ALL ON TABLE public.zomatik_np_excepciones FROM anon, authenticated;
GRANT SELECT ON TABLE public.zomatik_np_excepciones TO anon, authenticated;
GRANT ALL ON TABLE public.zomatik_np_excepciones TO service_role;

-- ---------------------------------------------------------------------------
-- Tomar una NP y la sesión del robot
-- ---------------------------------------------------------------------------

-- Toma la NP para el robot si está en uno de p_desde, o si quedó "generando"/"vaciando" colgada (más de 3 min:
-- un corte). Devuelve el id con el estado y el paso ANTERIORES, o nada si otro la tomó.
CREATE OR REPLACE FUNCTION public.zomatik_np_tomar(p_id uuid, p_desde text[], p_a text)
RETURNS TABLE (np_id uuid, estado_anterior text, paso_anterior text)
LANGUAGE plpgsql
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF p_a NOT IN ('generando', 'vaciando') THEN
    RAISE EXCEPTION 'Estado inválido para tomar: %', p_a;
  END IF;
  RETURN QUERY
  WITH previa AS (
    SELECT z.id, z.estado, z.paso FROM zomatik_np z WHERE z.id = p_id FOR UPDATE SKIP LOCKED
  ), tomada AS (
    UPDATE zomatik_np z
       SET estado = p_a, en_curso_desde = now(), intentos = z.intentos + 1, updated_at = now()
      FROM previa
     WHERE z.id = previa.id
       AND (previa.estado = ANY (p_desde)
            OR (previa.estado IN ('generando', 'vaciando') AND z.en_curso_desde < now() - interval '3 minutes'))
    RETURNING z.id, previa.estado, previa.paso
  )
  SELECT tomada.id, tomada.estado, tomada.paso FROM tomada;
END;
$$;

REVOKE ALL ON FUNCTION public.zomatik_np_tomar(uuid, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zomatik_np_tomar(uuid, text[], text) TO service_role;

-- Una sola sesión del robot a la vez (23.3 e): un turno en integraciones ('zomatik_robot') que vence solo. Quien ya lo
-- tiene lo renueva llamando de nuevo con el mismo p_quien. La lectura de Zomatik (Z0) pide el mismo turno.
CREATE OR REPLACE FUNCTION public.zomatik_robot_tomar(p_quien text, p_segundos integer)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('zomatik_robot'));
  INSERT INTO integraciones (clave, valor, actualizado, conectado_por)
  VALUES ('zomatik_robot', (now() + make_interval(secs => greatest(10, least(p_segundos, 300))))::text, now(), p_quien)
  ON CONFLICT (clave) DO UPDATE
     SET valor = EXCLUDED.valor, actualizado = now(), conectado_por = EXCLUDED.conectado_por
   WHERE integraciones.conectado_por = p_quien
      OR integraciones.valor IS NULL
      OR integraciones.valor !~ '^\d{4}-'
      OR integraciones.valor::timestamptz < now()
  RETURNING true INTO v_ok;
  RETURN coalesce(v_ok, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.zomatik_robot_soltar(p_quien text)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  DELETE FROM integraciones WHERE clave = 'zomatik_robot' AND conectado_por = p_quien;
$$;

REVOKE ALL ON FUNCTION public.zomatik_robot_tomar(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zomatik_robot_soltar(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zomatik_robot_tomar(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.zomatik_robot_soltar(text) TO service_role;

-- ---------------------------------------------------------------------------
-- Control en el despacho (igual que controlDespacho() de lib/zomatik/np.ts)
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
  v_ok   boolean;
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
  v_ok := EXISTS (SELECT 1 FROM zomatik_np WHERE scheduled_dispatch_id = v_ped.id AND estado = 'ok');
  IF v_ok THEN
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

  -- Modo aviso: deja despachar y lo anota
  INSERT INTO activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
  VALUES (v_quien, 'crear', 'zomatik_np', v_ped.id::text, 'Despacho sin NP (modo aviso)', NEW.plant_id,
          jsonb_build_object('Qué pasó', 'Se despachó un pedido con la NP pendiente (modo aviso: deja despachar)', 'Remito', NEW.remito, 'm³', NEW.quantity_m3));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.zomatik_np_control_despacho() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_dispatches_zomatik_np ON public.dispatches;
CREATE TRIGGER trg_dispatches_zomatik_np
  BEFORE INSERT ON public.dispatches
  FOR EACH ROW EXECUTE FUNCTION public.zomatik_np_control_despacho();

-- ---------------------------------------------------------------------------
-- Reintento cada 10 min (opcional, pregunta 24.8.3): el plan Hobby de Vercel solo deja crons diarios. Si Bautista
-- elige pg_cron, se habilita la extensión en Supabase y se corre esto con el CRON_SECRET guardado en vault:
--
--   select cron.schedule('zomatik-np', '*/10 * * * *', $$
--     select net.http_get('https://produccionrebucret.com/api/zomatik/np/procesar',
--       headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')))
--   $$);
-- ---------------------------------------------------------------------------

RESET lock_timeout;
RESET statement_timeout;
