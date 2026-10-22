-- Zomatik · Etapa Z2: nota de pedido (NP) al programar — SIN APLICAR (avisar a Bautista antes)
--
-- Especificación: docs/migracion-loop/zomatik.md, secciones 22, 23 y 24 (mandan sobre las anteriores).
--
-- Qué agrega (todo se agrega; no se borra ni se cambia nada de lo cargado):
--   plants.zomatik_np_activo      LLAVE de apagado por planta. APAGADA por defecto: mientras esté apagada el sistema
--                                 no le escribe nunca a Zomatik y la NP se carga a mano, como hoy. La prende Bautista
--                                 desde "Vínculos con Zomatik".
--   plants.zomatik_np_desde       cuándo se prendió: solo los pedidos cargados después tienen NP automática (los de
--                                 antes ya tienen su NP a mano y no se controlan).
--   plants.zomatik_deposito       depósito de Zomatik de la planta (Canning 116, Hudson = REBUCRET 113).
--   plants.exigir_np / aviso_hasta modo aviso (2 semanas desde que se prende la llave, 20.7) y después duro.
--   scheduled_dispatches.zomatik_np_tipo / zomatik_proyecto_codigo / zomatik_proyecto_tope_m3
--                                 "NP nueva" o "NP de un proyecto", qué proyecto y (opcional) hasta cuántos m³ contra
--                                 el proyecto (el resto, en una NP nueva: 20.4). Las escribe solo el servidor.
--   construction_sites.zomatik_proyecto_codigo  el proyecto elegido queda guardado en la obra para los días siguientes.
--   zomatik_articulos.codigo_sistema  el código que usa el pedido (`farticulo`, columna "Codigo Sistema" del export;
--                                 23.1: no es el `codigo` de la copia). Lo llena la lectura de Zomatik.
--   zomatik_proyectos.disponible_* lo disponible del proyecto según "Continuar" del MATERIAL (23.2), la última vez.
--   zomatik_np                    cada NP que genera el sistema: estado (pendiente, generando, ok, revisar, error,
--                                 vaciar, vaciando, vaciada, anulada), mensaje de Zomatik, número y código.
--   zomatik_np_excepciones        "Despachar sin NP" autorizado por un gerencial, con motivo, para un pedido y un día.
--   zomatik_np_tomar()            toma una NP para el robot en una sola sentencia (dos procesos nunca la toman los dos).
--   zomatik_robot_tomar/soltar()  una sola sesión del robot a la vez (23.3 e).
--   zomatik_np_control_despacho   trigger BEFORE INSERT en dispatches: con la llave prendida, en modo duro no deja
--                                 despachar un pedido sin NP ok (salvo excepción); en modo aviso deja y lo anota en
--                                 Actividad; el despacho manual no se controla y se anota en Actividad. Con la llave
--                                 apagada no hace nada. registrar_despacho NO se toca: el error sale del trigger
--                                 dentro de la misma transacción y no se graba nada, como cualquier otro control.
--
-- Qué pasa con los datos ya cargados:
--   - plants: la llave queda apagada en las dos plantas; se completa el depósito de Canning (116) y Hudson (113).
--   - scheduled_dispatches, construction_sites, zomatik_articulos y zomatik_proyectos: columnas nuevas vacías.
--     Ningún pedido, obra ni despacho cambia. Los pedidos de antes de prender la llave nunca se controlan.
--   - dispatches: el trigger solo actúa en despachos NUEVOS y solo con la llave prendida. Los cargados no cambian.
--   - Tablas nuevas vacías.
--
-- Bloqueos: los ALTER TABLE ADD COLUMN sin default (o con default constante) son instantáneos, pero piden un candado
-- corto sobre plants, scheduled_dispatches, construction_sites y dispatches (trigger). Con lock_timeout de 3 s: si
-- la planta está despachando y no lo consigue, falla sin cambiar nada y se vuelve a correr.

SET lock_timeout = '3s';
SET statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- Plantas: llave, depósito y modo
-- ---------------------------------------------------------------------------
ALTER TABLE public.plants
  ADD COLUMN IF NOT EXISTS zomatik_np_activo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS zomatik_np_desde timestamptz,
  ADD COLUMN IF NOT EXISTS zomatik_deposito integer,
  ADD COLUMN IF NOT EXISTS exigir_np text NOT NULL DEFAULT 'aviso',
  ADD COLUMN IF NOT EXISTS aviso_hasta date;

ALTER TABLE public.plants DROP CONSTRAINT IF EXISTS plants_exigir_np_check;
ALTER TABLE public.plants ADD CONSTRAINT plants_exigir_np_check CHECK (exigir_np IN ('aviso', 'duro'));

UPDATE public.plants SET zomatik_deposito = CASE code WHEN 'CAN' THEN 116 WHEN 'HUD' THEN 113 END
WHERE zomatik_deposito IS NULL AND code IN ('CAN', 'HUD');

COMMENT ON COLUMN public.plants.zomatik_np_activo IS 'Zomatik Z2: llave de la NP automática. false (por defecto) = no se escribe nunca en Zomatik; la NP se carga a mano.';
COMMENT ON COLUMN public.plants.zomatik_np_desde IS 'Zomatik Z2: cuándo se prendió la llave. Solo los pedidos cargados después tienen NP automática y control en el despacho.';
COMMENT ON COLUMN public.plants.exigir_np IS 'Zomatik Z2: aviso (deja despachar sin NP y lo anota) hasta aviso_hasta; después, o con duro, no deja.';

-- ---------------------------------------------------------------------------
-- Pedido y obra: NP nueva o de un proyecto
-- ---------------------------------------------------------------------------
ALTER TABLE public.scheduled_dispatches
  ADD COLUMN IF NOT EXISTS zomatik_np_tipo text,
  ADD COLUMN IF NOT EXISTS zomatik_proyecto_codigo integer,
  ADD COLUMN IF NOT EXISTS zomatik_proyecto_tope_m3 numeric(10,3);

ALTER TABLE public.scheduled_dispatches DROP CONSTRAINT IF EXISTS scheduled_dispatches_zomatik_np_tipo_check;
ALTER TABLE public.scheduled_dispatches ADD CONSTRAINT scheduled_dispatches_zomatik_np_tipo_check CHECK (
  zomatik_np_tipo IS NULL OR zomatik_np_tipo = 'nueva' OR (zomatik_np_tipo = 'proyecto' AND zomatik_proyecto_codigo IS NOT NULL)
) NOT VALID;

COMMENT ON COLUMN public.scheduled_dispatches.zomatik_np_tipo IS 'Zomatik Z2: nueva (NP común) o proyecto (NP contra un proyecto, como MATERIAL). Nulo = nueva.';
COMMENT ON COLUMN public.scheduled_dispatches.zomatik_proyecto_tope_m3 IS 'Zomatik Z2: m³ que van contra el proyecto; el resto del pedido va en una NP nueva (20.4). Nulo = todo contra el proyecto.';

ALTER TABLE public.construction_sites ADD COLUMN IF NOT EXISTS zomatik_proyecto_codigo integer;
COMMENT ON COLUMN public.construction_sites.zomatik_proyecto_codigo IS 'Zomatik Z2: el último proyecto elegido para la obra (se propone en los pedidos siguientes).';

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
  scheduled_dispatch_id  uuid NOT NULL REFERENCES public.scheduled_dispatches(id) ON DELETE CASCADE,
  fecha                  date NOT NULL,
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

-- Una sola sesión del robot a la vez (23.3 e): un turno en integraciones ('zomatik_robot') que vence solo.
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
  v_pl   public.plants;
  v_ped  public.scheduled_dispatches;
  v_dia  date := (coalesce(NEW.dispatch_date, now()) AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_hoy  date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_quien text := coalesce(nullif(btrim(NEW.created_by), ''), 'sistema');
BEGIN
  IF coalesce(NEW.is_test_dispatch, false) THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_pl FROM plants WHERE id = NEW.plant_id;
  IF NOT FOUND OR NOT coalesce(v_pl.zomatik_np_activo, false) THEN
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
  IF v_pl.zomatik_np_desde IS NOT NULL AND v_ped.created_at < v_pl.zomatik_np_desde THEN
    RETURN NEW;                                  -- pedido de antes de prender la llave: su NP es a mano
  END IF;
  IF EXISTS (SELECT 1 FROM zomatik_np WHERE scheduled_dispatch_id = v_ped.id AND estado = 'ok') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM zomatik_np_excepciones WHERE scheduled_dispatch_id = v_ped.id AND fecha = v_dia) THEN
    INSERT INTO activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
    VALUES (v_quien, 'crear', 'zomatik_np', v_ped.id::text, 'Despacho sin NP (autorizado)', NEW.plant_id,
            jsonb_build_object('Qué pasó', 'Despacho sin NP con la excepción de un gerencial', 'Remito', NEW.remito, 'm³', NEW.quantity_m3));
    RETURN NEW;
  END IF;

  IF v_pl.exigir_np = 'duro' OR (v_pl.aviso_hasta IS NOT NULL AND v_hoy > v_pl.aviso_hasta) THEN
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
