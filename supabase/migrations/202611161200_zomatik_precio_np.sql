-- Zomatik · Precio por m³ al programar (va a la NP de Zomatik) — SIN APLICAR (la corre Bautista)
--
-- Especificación: docs/specs/2026-11-16-precio-en-programacion.md (sección 5; la 15 manda sobre lo anterior).
--
-- Qué agrega (solo tablas y funciones NUEVAS; no se toca ninguna fila existente):
--   zomatik_listas              copia de listado_listas.php (código, nombre, desde, estado).
--   zomatik_lista_precios       precio NETO (sin IVA) por artículo de las listas ACTIVAS (export exportar_lista.php,
--                               cruzado por nombre con zomatik_articulos: el export no trae códigos).
--   zomatik_np_precio           por pedido: el precio por m³ que va a la NP nueva (nulo = el de la lista), puesto a mano
--                               o congelado con la primera NP (así las adicionales salen con el mismo).
--   zomatik_np_precio_guardar() guarda el precio con las NP del pedido bloqueadas: si la NP nueva de esa fórmula ya salió
--                               (o pudo salir), no cambia nada y devuelve bloqueado.
--   zomatik_np_precio_congelar() después de la primera NP nueva "ok": deja el precio con que salió (nunca pisa uno
--                               puesto a mano para la misma fórmula).
--
-- Las tres tablas son SOLO del servidor (REVOKE a anon/authenticated): el navegador no puede leer precios.
--
-- Qué pasa con los datos ya cargados:
--   - Nada cambia. Todo pedido sin fila en zomatik_np_precio sale como hoy (precio de la lista).
--   - Las copias de listas arrancan vacías y se llenan con la primera lectura (noche o "Actualizar").
--   - La clave foránea a scheduled_dispatches pide un candado corto sobre esa tabla al crearse: lock_timeout 3 s (si no
--     lo consigue, falla sin cambiar nada y se vuelve a correr). Se puede correr dos veces.
--   - Compatible con el código de main: main no usa estas tablas.

SET lock_timeout = '3s';
SET statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- Copia de las listas de precios de Zomatik (sucursal REBUCRET)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.zomatik_listas (
  codigo     integer PRIMARY KEY,                 -- modificar_listas.php?codigo=N
  nombre     text NOT NULL,
  desde      date,
  estado     text NOT NULL,                       -- "Activo", "Invisible"…
  leida_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.zomatik_listas IS 'Zomatik: copia de listado_listas.php (precio por m³ al programar). Solo servidor.';

REVOKE ALL ON TABLE public.zomatik_listas FROM anon, authenticated;
GRANT ALL ON TABLE public.zomatik_listas TO service_role;

CREATE TABLE IF NOT EXISTS public.zomatik_lista_precios (
  lista_codigo     integer NOT NULL,
  articulo_codigo  bigint NOT NULL,               -- = zomatik_articulos.codigo (cruzado por nombre)
  articulo_nombre  text NOT NULL,                 -- como viene en el export
  precio           numeric(14,3) NOT NULL,        -- NETO (sin IVA), por m³
  leida_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lista_codigo, articulo_codigo)
);
COMMENT ON TABLE public.zomatik_lista_precios IS 'Zomatik: precio neto (sin IVA) por artículo de las listas activas (exportar_lista.php). Solo servidor.';

REVOKE ALL ON TABLE public.zomatik_lista_precios FROM anon, authenticated;
GRANT ALL ON TABLE public.zomatik_lista_precios TO service_role;

-- ---------------------------------------------------------------------------
-- Precio por m³ de la NP de cada pedido (solo servidor)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.zomatik_np_precio (
  scheduled_dispatch_id  uuid PRIMARY KEY REFERENCES public.scheduled_dispatches(id) ON DELETE CASCADE,
  precio_m3              numeric(14,3) CHECK (precio_m3 IS NULL OR (precio_m3 > 0 AND precio_m3 < 100000000)),  -- nulo = lista
  origen                 text CHECK (origen IS NULL OR origen IN ('manual', 'np')),
  formula_id             uuid,                    -- para qué fórmula vale
  lista_codigo           integer,                 -- la lista activa cuando se puso
  precio_lista_m3        numeric(14,3),           -- el de la lista cuando se puso
  proyecto_precio_m3     numeric(14,3),           -- NP de proyecto: el costo que trajo el MATERIAL (solo para mostrar)
  updated_by             text,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zomatik_np_precio_origen_check CHECK ((precio_m3 IS NULL) = (origen IS NULL))
);
COMMENT ON TABLE public.zomatik_np_precio IS 'Zomatik: precio neto por m³ de la NP nueva del pedido (nulo = lista). Solo servidor: el navegador no lo puede leer.';

REVOKE ALL ON TABLE public.zomatik_np_precio FROM anon, authenticated;
GRANT ALL ON TABLE public.zomatik_np_precio TO service_role;

-- Guardar el precio (o nulo = volver a la lista). Bloquea las NP del pedido: si la NP nueva de esa fórmula ya salió o
-- pudo salir (no pendiente/error/anulada, o cortada en Grabar), no cambia nada. Devuelve {ok, bloqueado, cambio, antes}.
CREATE OR REPLACE FUNCTION public.zomatik_np_precio_guardar(p_pedido uuid, p_precio numeric, p_formula uuid, p_lista integer, p_precio_lista numeric, p_usuario text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_fila  zomatik_np_precio;
  v_hay   boolean;
  v_antes numeric;
BEGIN
  IF p_precio IS NOT NULL AND (p_precio <= 0 OR p_precio >= 100000000) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'El precio tiene que ser mayor a 0');
  END IF;
  PERFORM 1 FROM zomatik_np WHERE scheduled_dispatch_id = p_pedido FOR UPDATE;
  SELECT * INTO v_fila FROM zomatik_np_precio WHERE scheduled_dispatch_id = p_pedido FOR UPDATE;
  v_hay := FOUND;
  v_antes := CASE WHEN v_hay AND v_fila.formula_id IS NOT DISTINCT FROM p_formula THEN v_fila.precio_m3 END;
  IF EXISTS (
    SELECT 1 FROM zomatik_np n
    WHERE n.scheduled_dispatch_id = p_pedido AND n.tipo = 'nueva' AND n.formula_id IS NOT DISTINCT FROM p_formula
      AND (n.estado NOT IN ('pendiente', 'error', 'anulada') OR coalesce(n.paso, '') IN ('grabar', 'verificar', 'grabar_cortado', 'buscar_marca'))
  ) THEN
    RETURN jsonb_build_object('ok', true, 'bloqueado', true, 'cambio', false, 'antes', v_antes);
  END IF;
  IF (NOT v_hay AND p_precio IS NULL)
     OR (v_hay AND v_fila.formula_id IS NOT DISTINCT FROM p_formula AND v_fila.precio_m3 IS NOT DISTINCT FROM p_precio) THEN
    RETURN jsonb_build_object('ok', true, 'bloqueado', false, 'cambio', false, 'antes', v_antes);
  END IF;
  INSERT INTO zomatik_np_precio (scheduled_dispatch_id, precio_m3, origen, formula_id, lista_codigo, precio_lista_m3, updated_by, updated_at)
  VALUES (p_pedido, p_precio, CASE WHEN p_precio IS NULL THEN NULL ELSE 'manual' END, p_formula, p_lista, p_precio_lista, p_usuario, now())
  ON CONFLICT (scheduled_dispatch_id) DO UPDATE SET
    precio_m3 = EXCLUDED.precio_m3, origen = EXCLUDED.origen, formula_id = EXCLUDED.formula_id, lista_codigo = EXCLUDED.lista_codigo,
    precio_lista_m3 = EXCLUDED.precio_lista_m3, updated_by = EXCLUDED.updated_by, updated_at = now();
  RETURN jsonb_build_object('ok', true, 'bloqueado', false, 'cambio', true, 'antes', v_antes);
END;
$$;

-- Después de la primera NP nueva "ok": el precio con que salió queda para las adicionales. Solo si no había precio o era
-- de otra fórmula (nunca pisa uno puesto a mano para la misma fórmula). Devuelve si escribió.
CREATE OR REPLACE FUNCTION public.zomatik_np_precio_congelar(p_pedido uuid, p_precio numeric, p_formula uuid, p_usuario text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_precio IS NULL OR p_precio <= 0 OR p_precio >= 100000000 THEN
    RETURN false;
  END IF;
  INSERT INTO zomatik_np_precio (scheduled_dispatch_id, precio_m3, origen, formula_id, updated_by, updated_at)
  VALUES (p_pedido, p_precio, 'np', p_formula, p_usuario, now())
  ON CONFLICT (scheduled_dispatch_id) DO UPDATE SET
    precio_m3 = EXCLUDED.precio_m3, origen = 'np', formula_id = EXCLUDED.formula_id, updated_by = EXCLUDED.updated_by, updated_at = now()
  WHERE zomatik_np_precio.precio_m3 IS NULL OR zomatik_np_precio.formula_id IS DISTINCT FROM EXCLUDED.formula_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.zomatik_np_precio_guardar(uuid, numeric, uuid, integer, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zomatik_np_precio_congelar(uuid, numeric, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zomatik_np_precio_guardar(uuid, numeric, uuid, integer, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.zomatik_np_precio_congelar(uuid, numeric, uuid, text) TO service_role;

RESET lock_timeout;
RESET statement_timeout;
