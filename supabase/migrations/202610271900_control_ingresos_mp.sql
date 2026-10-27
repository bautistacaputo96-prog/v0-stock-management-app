-- Control de ingresos de materia prima: nuestros ingresos (stock_entries) contra los remitos de compra de Zomatik
-- SIN APLICAR (avisar a Bautista antes). Especificación: docs/control-ingresos-mp.md.
--
-- Qué agrega (todo nuevo, nada existente cambia):
--   zomatik_remitos_compra       copia de ESTAD R.COMPRA de Zomatik (sucursal REBUCRET, depósitos Canning 116 y
--                                REBUCRET/Hudson 113; lo cargado en otro depósito queda con deposito nulo). Sin precios.
--                                La escribe el cron /api/control-ingresos/controlar, reemplazando por tramo de fechas.
--   zomatik_remitos_compra_dias  qué días de Zomatik quedaron leídos enteros y cuándo. El cruce solo informa (y solo
--                                resuelve) diferencias de días leídos en las últimas 30 h: sin lectura, no hay aviso.
--   control_mp_diferencias       una fila por diferencia encontrada (4 categorías de las planillas de Juan), con estado
--                                abierta / revisada / resuelta, quién y cuándo. `clave` identifica la diferencia
--                                entre corridas: una revisada no vuelve al mail.
--   control_mp_corridas          registro de cada control (cron o "Controlar ahora"), con lo leído y el mail.
--   control_mp_registrar()       freno en la base, con candado: un control a la vez, a mano cada 2 min, el cron una
--                                vez por hora (el header del cron se puede falsificar).
--   control_mp_reemplazar_zomatik()  borra y vuelve a cargar un tramo de fechas de la copia y marca sus días como
--                                leídos, en una sola transacción.
--
-- Qué pasa con los datos ya cargados:
--   - stock_entries, materials, suppliers, carriers: NO se tocan (el control solo los lee; no hay triggers nuevos).
--   - Las tablas nuevas arrancan vacías. La primera corrida lee Zomatik desde el 27/07/2026 (01/08 menos 5 días de
--     margen) y abre las diferencias que encuentre desde el 01/08/2026, solo de los días que pudo leer enteros.
--
-- Permisos: todo lo lee y escribe solo el servidor (service role). El navegador (anon) no ve ninguna de las tablas
-- nuevas: la pantalla va por /api/control-ingresos con sesión y permiso de materia prima.
--
-- Se puede correr dos veces (IF NOT EXISTS / CREATE OR REPLACE).

SET lock_timeout = '3s';
SET statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- Copia de los remitos de compra de Zomatik
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.zomatik_remitos_compra (
  id               bigserial PRIMARY KEY,
  clave            text NOT NULL UNIQUE,      -- depósito|fecha|remito|artículo|cantidad|proveedor|orden (estable)
  fecha            date NOT NULL,
  remito           text NOT NULL,
  remito_norm      text,                      -- sin punto de venta ni ceros a la izquierda (null = sin número)
  orden_compra     text,
  proveedor        text,
  codigo_articulo  text,
  articulo         text NOT NULL,
  cantidad         numeric NOT NULL,
  transportista    text,
  deposito         integer,                   -- 116 Canning · 113 REBUCRET (Hudson) · null = otro depósito
  plant_id         uuid REFERENCES public.plants(id) ON DELETE SET NULL,
  datos            jsonb,                     -- la fila del export sin columnas de precio
  leido_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zomatik_remitos_compra_fecha_idx ON public.zomatik_remitos_compra (fecha);
CREATE INDEX IF NOT EXISTS zomatik_remitos_compra_remito_norm_idx ON public.zomatik_remitos_compra (remito_norm);
COMMENT ON TABLE public.zomatik_remitos_compra IS 'Control de ingresos MP: copia de ESTAD R.COMPRA de Zomatik (REBUCRET). Sin precios. La escribe /api/control-ingresos/controlar.';

REVOKE ALL ON TABLE public.zomatik_remitos_compra FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.zomatik_remitos_compra_id_seq FROM anon, authenticated;
GRANT ALL ON TABLE public.zomatik_remitos_compra TO service_role;
GRANT ALL ON SEQUENCE public.zomatik_remitos_compra_id_seq TO service_role;

CREATE TABLE IF NOT EXISTS public.zomatik_remitos_compra_dias (
  fecha     date PRIMARY KEY,
  leido_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.zomatik_remitos_compra_dias IS 'Control de ingresos MP: días de ESTAD R.COMPRA leídos enteros (tramo completo, sucursal confirmada) y cuándo.';

REVOKE ALL ON TABLE public.zomatik_remitos_compra_dias FROM anon, authenticated;
GRANT ALL ON TABLE public.zomatik_remitos_compra_dias TO service_role;

-- ---------------------------------------------------------------------------
-- Diferencias
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.control_mp_diferencias (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave          text NOT NULL UNIQUE,
  categoria      text NOT NULL CHECK (categoria IN ('falta_nuestro', 'falta_zomatik', 'no_coincide', 'numero_mal')),
  tipo           text NOT NULL,
  fecha          date NOT NULL,
  plant_id       uuid REFERENCES public.plants(id) ON DELETE SET NULL,
  detalle        text NOT NULL DEFAULT '',
  nuestro        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- renglones de stock_entries involucrados (resumen)
  zomatik        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- renglones de zomatik_remitos_compra involucrados (resumen)
  estado         text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'revisada', 'resuelta')),
  nota           text,
  revisada_por   text,
  revisada_at    timestamptz,
  resuelta_at    timestamptz,
  detectada_at   timestamptz NOT NULL DEFAULT now(),   -- cuándo apareció (o volvió a aparecer)
  vista_at       timestamptz NOT NULL DEFAULT now()    -- última corrida que la encontró
);
CREATE INDEX IF NOT EXISTS control_mp_diferencias_estado_idx ON public.control_mp_diferencias (estado, fecha);
COMMENT ON TABLE public.control_mp_diferencias IS 'Control de ingresos MP: diferencias entre stock_entries y Zomatik. abierta → revisada (a mano, con nota) o resuelta (el cruce ya no la encuentra). Solo servidor.';

REVOKE ALL ON TABLE public.control_mp_diferencias FROM anon, authenticated;
GRANT ALL ON TABLE public.control_mp_diferencias TO service_role;

-- ---------------------------------------------------------------------------
-- Corridas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.control_mp_corridas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origen      text NOT NULL CHECK (origen IN ('cron', 'manual')),
  usuario     text,
  inicio      timestamptz NOT NULL DEFAULT now(),
  fin         timestamptz,
  ok          boolean,
  lectura     jsonb,       -- tramos leídos de Zomatik y conteos
  resumen     jsonb,       -- diferencias por categoría, nuevas, resueltas
  error       text,
  mail_at     timestamptz,
  mail_a      text[]
);
CREATE INDEX IF NOT EXISTS control_mp_corridas_inicio_idx ON public.control_mp_corridas (inicio DESC);
COMMENT ON TABLE public.control_mp_corridas IS 'Control de ingresos MP: cada corrida (cron diario 16:25 o "Controlar ahora") y el mail. Solo servidor.';

REVOKE ALL ON TABLE public.control_mp_corridas FROM anon, authenticated;
GRANT ALL ON TABLE public.control_mp_corridas TO service_role;

-- ---------------------------------------------------------------------------
-- Freno: registra una corrida o dice por qué no (una corrida dura hasta 5 min: maxDuration 300)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.control_mp_registrar(p_origen text, p_usuario text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_origen NOT IN ('cron', 'manual') THEN
    RETURN jsonb_build_object('motivo', 'Origen inválido');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('control_mp_registrar'));
  IF EXISTS (SELECT 1 FROM control_mp_corridas WHERE fin IS NULL AND inicio > now() - interval '6 minutes') THEN
    RETURN jsonb_build_object('motivo', 'Ya se está controlando. Esperá un minuto.');
  END IF;
  IF p_origen = 'manual' AND EXISTS (SELECT 1 FROM control_mp_corridas WHERE inicio > now() - interval '2 minutes') THEN
    RETURN jsonb_build_object('motivo', 'Se controló hace menos de 2 min. Esperá un rato.');
  END IF;
  IF p_origen = 'cron' AND EXISTS (SELECT 1 FROM control_mp_corridas WHERE origen = 'cron' AND inicio > now() - interval '60 minutes') THEN
    RETURN jsonb_build_object('motivo', 'El control diario ya corrió hace menos de una hora.');
  END IF;
  INSERT INTO control_mp_corridas (origen, usuario) VALUES (p_origen, nullif(trim(coalesce(p_usuario, '')), '')) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.control_mp_registrar(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.control_mp_registrar(text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Reemplazo de un tramo de la copia (todo o nada)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.control_mp_reemplazar_zomatik(p_desde date, p_hasta date, p_filas jsonb)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN
    RAISE EXCEPTION 'Tramo inválido';
  END IF;
  IF jsonb_typeof(p_filas) <> 'array' THEN
    RAISE EXCEPTION 'p_filas tiene que ser una lista';
  END IF;
  DELETE FROM zomatik_remitos_compra WHERE fecha BETWEEN p_desde AND p_hasta;
  INSERT INTO zomatik_remitos_compra (clave, fecha, remito, remito_norm, orden_compra, proveedor, codigo_articulo, articulo, cantidad, transportista, deposito, plant_id, datos, leido_at)
  SELECT f.clave, f.fecha, f.remito, f.remito_norm, f.orden_compra, f.proveedor, f.codigo_articulo, f.articulo, f.cantidad, f.transportista, f.deposito, f.plant_id, f.datos, now()
    FROM jsonb_to_recordset(p_filas) AS f(clave text, fecha date, remito text, remito_norm text, orden_compra text, proveedor text, codigo_articulo text, articulo text, cantidad numeric, transportista text, deposito integer, plant_id uuid, datos jsonb)
   WHERE f.fecha BETWEEN p_desde AND p_hasta
  ON CONFLICT (clave) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO zomatik_remitos_compra_dias (fecha, leido_at)
  SELECT d::date, now() FROM generate_series(p_desde::timestamp, p_hasta::timestamp, interval '1 day') AS d
  ON CONFLICT (fecha) DO UPDATE SET leido_at = EXCLUDED.leido_at;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.control_mp_reemplazar_zomatik(date, date, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.control_mp_reemplazar_zomatik(date, date, jsonb) TO service_role;

RESET statement_timeout;
RESET lock_timeout;
