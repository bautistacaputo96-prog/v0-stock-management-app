-- Control de stock de materia prima: nuestro sistema contra Zomatik (INVENTARIO › MOVIMIENTOS STOCK)
-- SIN APLICAR (avisar a Bautista antes). Especificación: docs/control-stock-mp.md. Va después de 202610271900.
--
-- Qué agrega (todo nuevo, nada existente cambia):
--   zomatik_stock_movimientos   copia de reporte_movimientosdestock.php (REBUCRET) por depósito (116 Canning, 113
--                               Hudson) y artículo: fecha, comprobante (RMP compra, RMI consumo…), movimiento y saldo,
--                               en toneladas. Se reemplaza entera por depósito y artículo en cada lectura.
--   zomatik_stock_lecturas      una fila por depósito y artículo: desde cuándo se leyó, saldo inicial (el "Total
--                               acumulado" del reporte, que en el ejemplo real es el saldo anterior al período), saldo
--                               final, si cierra, con qué `idarticulo` filtró Zomatik y si se verificó con los remitos de
--                               compra. Si la última lectura falló, `error` e `intento_at` (los datos quedan los de antes).
--   control_stock_reemplazar()  reemplaza los movimientos de un depósito y artículo y su lectura, todo o nada.
--
-- Qué pasa con los datos ya cargados:
--   - stock_entries, stock_movements, materials: NO se tocan (el control solo los lee; no hay triggers nuevos).
--   - Las tablas nuevas arrancan vacías; las llena el cron de las 16:25 o "Actualizar ahora".
--
-- Permisos: solo el servidor (service role). El navegador (anon) no ve ninguna de las tablas nuevas: la pantalla va por
-- /api/control-stock con sesión y permiso. Se puede correr dos veces.

SET lock_timeout = '3s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.zomatik_stock_lecturas (
  deposito          integer NOT NULL,
  codigo_articulo   text NOT NULL,
  plant_id          uuid REFERENCES public.plants(id) ON DELETE SET NULL,
  articulo          text,
  idarticulo        text,                 -- el valor que filtró bien el reporte (código del sistema o código visible)
  desde             date,
  hasta             date,
  saldo_inicial     numeric,
  saldo_final       numeric,
  total_acumulado   numeric,
  total_es_inicial  boolean,              -- el "Total acumulado" coincide con el saldo inicial (null: sin con qué comparar)
  cierra            boolean,              -- cada saldo = anterior + movimiento
  verificado        text,                 -- verificado / sin_verificar (con los remitos de compra)
  formato           text,                 -- excel / html
  renglones         integer,
  leido_at          timestamptz,          -- última lectura buena
  intento_at        timestamptz,          -- último intento (bueno o malo)
  error             text,                 -- por qué falló el último intento (null si anduvo)
  PRIMARY KEY (deposito, codigo_articulo)
);
COMMENT ON TABLE public.zomatik_stock_lecturas IS 'Control de stock MP: última lectura de MOVIMIENTOS STOCK de Zomatik por depósito y artículo. Solo servidor.';

REVOKE ALL ON TABLE public.zomatik_stock_lecturas FROM anon, authenticated;
GRANT ALL ON TABLE public.zomatik_stock_lecturas TO service_role;

CREATE TABLE IF NOT EXISTS public.zomatik_stock_movimientos (
  id               bigserial PRIMARY KEY,
  deposito         integer NOT NULL,
  codigo_articulo  text NOT NULL,
  fecha            date NOT NULL,
  orden            integer NOT NULL,      -- orden en el reporte (para el saldo del día)
  comprobante      text,
  prefijo          text,                  -- RMP, RMI, …
  descripcion      text,
  movimiento       numeric NOT NULL,      -- toneladas, con signo
  saldo            numeric NOT NULL,
  leido_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zomatik_stock_movimientos_art_idx ON public.zomatik_stock_movimientos (deposito, codigo_articulo, fecha);
COMMENT ON TABLE public.zomatik_stock_movimientos IS 'Control de stock MP: copia de MOVIMIENTOS STOCK de Zomatik (REBUCRET). Solo servidor.';

REVOKE ALL ON TABLE public.zomatik_stock_movimientos FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.zomatik_stock_movimientos_id_seq FROM anon, authenticated;
GRANT ALL ON TABLE public.zomatik_stock_movimientos TO service_role;
GRANT ALL ON SEQUENCE public.zomatik_stock_movimientos_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.control_stock_reemplazar(p_deposito integer, p_codigo text, p_lectura jsonb, p_movs jsonb)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_deposito IS NULL OR coalesce(p_codigo, '') = '' OR jsonb_typeof(p_movs) <> 'array' OR jsonb_typeof(p_lectura) <> 'object' THEN
    RAISE EXCEPTION 'Datos inválidos';
  END IF;
  DELETE FROM zomatik_stock_movimientos WHERE deposito = p_deposito AND codigo_articulo = p_codigo;
  INSERT INTO zomatik_stock_movimientos (deposito, codigo_articulo, fecha, orden, comprobante, prefijo, descripcion, movimiento, saldo, leido_at)
  SELECT p_deposito, p_codigo, m.fecha, m.orden, m.comprobante, m.prefijo, m.descripcion, m.movimiento, m.saldo, now()
    FROM jsonb_to_recordset(p_movs) AS m(fecha date, orden integer, comprobante text, prefijo text, descripcion text, movimiento numeric, saldo numeric);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO zomatik_stock_lecturas (deposito, codigo_articulo, plant_id, articulo, idarticulo, desde, hasta, saldo_inicial, saldo_final, total_acumulado, total_es_inicial, cierra, verificado, formato, renglones, leido_at, intento_at, error)
  SELECT p_deposito, p_codigo, l.plant_id, l.articulo, l.idarticulo, l.desde, l.hasta, l.saldo_inicial, l.saldo_final, l.total_acumulado, l.total_es_inicial, l.cierra, l.verificado, l.formato, v_n, now(), now(), NULL
    FROM jsonb_to_record(p_lectura) AS l(plant_id uuid, articulo text, idarticulo text, desde date, hasta date, saldo_inicial numeric, saldo_final numeric, total_acumulado numeric, total_es_inicial boolean, cierra boolean, verificado text, formato text)
  ON CONFLICT (deposito, codigo_articulo) DO UPDATE SET
    plant_id = EXCLUDED.plant_id, articulo = EXCLUDED.articulo, idarticulo = EXCLUDED.idarticulo, desde = EXCLUDED.desde, hasta = EXCLUDED.hasta,
    saldo_inicial = EXCLUDED.saldo_inicial, saldo_final = EXCLUDED.saldo_final, total_acumulado = EXCLUDED.total_acumulado,
    total_es_inicial = EXCLUDED.total_es_inicial, cierra = EXCLUDED.cierra, verificado = EXCLUDED.verificado, formato = EXCLUDED.formato,
    renglones = EXCLUDED.renglones, leido_at = EXCLUDED.leido_at, intento_at = EXCLUDED.intento_at, error = NULL;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.control_stock_reemplazar(integer, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.control_stock_reemplazar(integer, text, jsonb, jsonb) TO service_role;

RESET statement_timeout;
RESET lock_timeout;
