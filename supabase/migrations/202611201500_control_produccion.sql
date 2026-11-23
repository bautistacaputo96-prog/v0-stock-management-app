-- Control cruzado: lo despachado contra Zomatik (FABRICA › REPORTE PRODUCCION) — SIN APLICAR (la corre Bautista a
-- mano, después de que el revisor apruebe). Se puede correr antes o después de publicar, y dos veces.
-- Especificación: docs/specs/2026-11-20-control-cruzado-despacho-zomatik.md (sección 9). Va después de 202610281800.
-- Va entera en una transacción (BEGIN … COMMIT): para probarla antes, cambiar el COMMIT del final por ROLLBACK.
--
-- Qué agrega (todo nuevo, nada existente cambia):
--   zomatik_produccion_dia        copia del reporte: m³ con OF por día (fecha de entrega de la OF), depósito (116
--                                 Canning, 113 REBUCRET = Hudson) y producto. Solo las celdas con m³ distinto de 0.
--                                 Cada lectura reemplaza sus 16 días; los anteriores quedan como historia.
--   zomatik_produccion_lectura    una sola fila (id = 1): el período leído, cuántas filas, lo que no se sumó (otros
--                                 segmentos o depósitos), la última lectura buena y el error del último intento.
--   control_produccion_reemplazar() borra los días leídos, inserta lo nuevo y actualiza la lectura, todo o nada.
--
-- Qué pasa con los datos ya cargados: NADA. Las tablas nuevas arrancan vacías (las llena el pg_cron de las 05:42 de
-- 202611201510 o "Actualizar ahora"). dispatches, dispatch_materials, zomatik_remitos y zomatik_stock_* solo se leen;
-- no hay triggers nuevos ni columnas nuevas en tablas existentes.
--
-- Permisos: solo el servidor (service role), como zomatik_stock_*. anon y authenticated sin acceso: la pantalla va por
-- /api/control-stock/despacho con sesión y permiso.
-- Vuelta atrás (solo si hace falta; se pierde la copia del reporte):
--   DROP FUNCTION IF EXISTS public.control_produccion_reemplazar(date, date, jsonb, jsonb);
--   DROP TABLE IF EXISTS public.zomatik_produccion_dia;
--   DROP TABLE IF EXISTS public.zomatik_produccion_lectura;

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.zomatik_produccion_dia (
  id               bigserial PRIMARY KEY,
  fecha            date NOT NULL,          -- fecha de entrega de la OF (columna del reporte)
  deposito         integer NOT NULL,       -- de la columna Deposito: "Canning" 116, "REBUCRET" 113
  plant_id         uuid REFERENCES public.plants(id) ON DELETE SET NULL,  -- nulo si el depósito no tiene planta
  segmento         text,                   -- "Hormigon"
  producto         text NOT NULL,          -- nombre del artículo en el reporte
  articulo_codigo  integer,                -- zomatik_articulos.codigo si el nombre cruza; nulo si no
  um               text,
  m3               numeric NOT NULL,
  leido_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zomatik_produccion_dia_dep_fecha_idx ON public.zomatik_produccion_dia (deposito, fecha);
COMMENT ON TABLE public.zomatik_produccion_dia IS 'Control del despacho: copia de FABRICA › REPORTE PRODUCCION de Zomatik (m³ con OF por día, depósito y producto). Solo servidor.';

REVOKE ALL ON TABLE public.zomatik_produccion_dia FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.zomatik_produccion_dia_id_seq FROM anon, authenticated;
GRANT ALL ON TABLE public.zomatik_produccion_dia TO service_role;
GRANT ALL ON SEQUENCE public.zomatik_produccion_dia_id_seq TO service_role;

CREATE TABLE IF NOT EXISTS public.zomatik_produccion_lectura (
  id          integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  desde       date,
  hasta       date,
  filas       integer,
  otros       jsonb,                       -- segmentos o depósitos que no se sumaron: [{segmento, producto, deposito, um, m3}]
  leido_at    timestamptz,                 -- última lectura buena
  intento_at  timestamptz,                 -- último intento (bueno o malo)
  error       text                         -- por qué falló el último intento (null si anduvo)
);
COMMENT ON TABLE public.zomatik_produccion_lectura IS 'Control del despacho: última lectura del reporte de producción de Zomatik (una sola fila). Solo servidor.';

REVOKE ALL ON TABLE public.zomatik_produccion_lectura FROM anon, authenticated;
GRANT ALL ON TABLE public.zomatik_produccion_lectura TO service_role;

CREATE OR REPLACE FUNCTION public.control_produccion_reemplazar(p_desde date, p_hasta date, p_filas jsonb, p_otros jsonb)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde OR p_hasta - p_desde > 31 OR jsonb_typeof(p_filas) <> 'array' THEN
    RAISE EXCEPTION 'Datos inválidos';
  END IF;
  DELETE FROM zomatik_produccion_dia WHERE fecha BETWEEN p_desde AND p_hasta;
  INSERT INTO zomatik_produccion_dia (fecha, deposito, plant_id, segmento, producto, articulo_codigo, um, m3, leido_at)
  SELECT f.fecha, f.deposito, f.plant_id, f.segmento, f.producto, f.articulo_codigo, f.um, f.m3, now()
    FROM jsonb_to_recordset(p_filas) AS f(fecha date, deposito integer, plant_id uuid, segmento text, producto text, articulo_codigo integer, um text, m3 numeric)
   WHERE f.fecha BETWEEN p_desde AND p_hasta AND f.m3 IS NOT NULL AND f.m3 <> 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO zomatik_produccion_lectura (id, desde, hasta, filas, otros, leido_at, intento_at, error)
  VALUES (1, p_desde, p_hasta, v_n, coalesce(p_otros, '[]'::jsonb), now(), now(), NULL)
  ON CONFLICT (id) DO UPDATE SET
    desde = EXCLUDED.desde, hasta = EXCLUDED.hasta, filas = EXCLUDED.filas, otros = EXCLUDED.otros,
    leido_at = EXCLUDED.leido_at, intento_at = EXCLUDED.intento_at, error = NULL;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.control_produccion_reemplazar(date, date, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.control_produccion_reemplazar(date, date, jsonb, jsonb) TO service_role;

COMMIT;

-- Para que la API vea las tablas nuevas enseguida
NOTIFY pgrst, 'reload schema';
