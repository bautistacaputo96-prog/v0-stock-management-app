-- Zomatik · Z1: un despacho partido entre dos NP (16/11) — SIN APLICAR (avisar a Bautista antes)
-- Va DESPUÉS de 202610291000_zomatik_z1_remitos.sql (aplicada). Se puede correr dos veces. Probarla antes en
-- BEGIN … ROLLBACK. Aplicarla ANTES de publicar la rama feat/remito-partir-camion (con el código de main funciona igual).
--
-- Por qué: el pedido 7a4dcc61 (A.A. Arquitectura) se agrandó de 35 a 38 m³ (NP2 2123 por 35 + adicional NP2 2124 por 3)
-- y el último camión (3330, 8 m³) no entra entero en ninguna NP. El robot ahora lo parte: 5 m³ en el remito de la 2123
-- y 3 m³ en el de la 2124. Un mismo despacho queda en DOS remitos, y `zomatik_remito_despachos.dispatch_id` era UNIQUE
-- ("un despacho nunca entra en dos remitos").
--
-- Qué cambia:
--   zomatik_remito_despachos  se saca el UNIQUE de dispatch_id (queda la PK remito_id + dispatch_id: un despacho no
--                         se repite dentro de un remito) y queda un índice común para buscar por despacho. `m3` ya
--                         existía: de un despacho partido es su parte en ese remito.
--   zomatik_remito_crear  el control anti-duplicado que hacía el UNIQUE pasa a la función: si el despacho ya está en
--                         otro remito, solo entra si lo ya remitido + lo nuevo no pasa sus m³ (un despacho entero que ya
--                         está en un remito, como hasta hoy, no entra nunca). Con un candado por despacho
--                         (pg_advisory_xact_lock) para que dos pasadas a la vez no lo metan dos veces.
--   zomatik_remitos_crear_juntos  NUEVA: crea varios remitos (los de un día con un despacho partido) en una sola
--                         transacción: todos o ninguno, así nunca queda una parte sola.
--
-- Qué pasa con los datos ya cargados: nada. No se borra ni se cambia ninguna fila; hoy cada despacho está en un solo
-- remito y sigue así. El código de main sigue igual: nunca parte, y la función rechaza un despacho que ya está en un
-- remito entero (como el UNIQUE).

SET lock_timeout = '3s';
SET statement_timeout = '60s';

BEGIN;

-- 1) La función, con el control en lugar del UNIQUE (va antes de sacarlo: nunca queda un momento sin control)
CREATE OR REPLACE FUNCTION public.zomatik_remito_crear(p jsonb)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_d uuid;
BEGIN
  -- Un candado por despacho, en orden (dos pasadas a la vez con el mismo despacho esperan una a la otra)
  FOR v_d IN SELECT DISTINCT (x->>'id')::uuid FROM jsonb_array_elements(coalesce(p->'despachos', '[]'::jsonb)) x ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('zomatik_remito_despacho:' || v_d::text, 0));
  END LOOP;
  -- Un despacho que ya está en otro remito solo entra si no se pasa de sus m³ (la otra parte de un despacho partido).
  -- Uno que no está en ningún remito entra como siempre.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(coalesce(p->'despachos', '[]'::jsonb)) x
      JOIN LATERAL (SELECT count(*) AS n, coalesce(sum(rd.m3), 0) AS ya FROM zomatik_remito_despachos rd WHERE rd.dispatch_id = (x->>'id')::uuid) e ON true
      LEFT JOIN dispatches d ON d.id = (x->>'id')::uuid
     WHERE e.n > 0 AND (d.id IS NULL OR e.ya + (x->>'m3')::numeric > coalesce(d.quantity_m3, 0) + 0.001)
  ) THEN
    RETURN NULL;
  END IF;
  INSERT INTO zomatik_remitos (tipo, scheduled_dispatch_id, np_id, fecha, plant_id, marca, comprobante, m3, formula_id, patente, patentes, remitos_papel, remito_estado, proximo_intento, created_by)
  VALUES (coalesce(p->>'tipo', 'pedido'), nullif(p->>'scheduled_dispatch_id', '')::uuid, nullif(p->>'np_id', '')::uuid, (p->>'fecha')::date, (p->>'plant_id')::uuid, p->>'marca',
          nullif(p->>'comprobante', ''), (p->>'m3')::numeric, nullif(p->>'formula_id', '')::uuid, p->>'patente', p->>'patentes', p->>'remitos_papel',
          CASE WHEN p->>'tipo' = 'suelto' THEN 'a_mano' ELSE 'pendiente' END, now(), p->>'created_by')
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    INSERT INTO zomatik_remito_despachos (remito_id, dispatch_id, m3)
    SELECT v_id, (x->>'id')::uuid, (x->>'m3')::numeric FROM jsonb_array_elements(p->'despachos') x;
  EXCEPTION WHEN unique_violation THEN
    DELETE FROM zomatik_remitos WHERE id = v_id;     -- un despacho repetido (o el UNIQUE viejo, si todavía está): no se crea
    RETURN NULL;
  END;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.zomatik_remito_crear(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zomatik_remito_crear(jsonb) TO service_role;

-- 2) Varios remitos juntos: todos o ninguno. p = { "remitos": [ <lo mismo que zomatik_remito_crear>, … ] }.
--    Devuelve los ids en el mismo orden, o nulo si alguno no se pudo crear (y entonces no queda ninguno).
CREATE OR REPLACE FUNCTION public.zomatik_remitos_crear_juntos(p jsonb)
RETURNS uuid[]
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ids uuid[] := '{}';
  v_id uuid;
  v_x jsonb;
BEGIN
  BEGIN
    FOR v_x IN SELECT value FROM jsonb_array_elements(coalesce(p->'remitos', '[]'::jsonb)) LOOP
      v_id := zomatik_remito_crear(v_x);
      IF v_id IS NULL THEN
        RAISE EXCEPTION 'zomatik_remitos_crear_juntos: un remito no se pudo crear' USING ERRCODE = 'ZR001';
      END IF;
      v_ids := v_ids || v_id;
    END LOOP;
  EXCEPTION WHEN SQLSTATE 'ZR001' THEN
    RETURN NULL;                                     -- se deshace todo lo de este bloque: no queda ninguno
  END;
  RETURN v_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.zomatik_remitos_crear_juntos(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zomatik_remitos_crear_juntos(jsonb) TO service_role;

-- 3) Sacar el UNIQUE de dispatch_id (sea cual sea su nombre) y dejar un índice común para buscar por despacho
CREATE INDEX IF NOT EXISTS zomatik_remito_despachos_dispatch_idx ON public.zomatik_remito_despachos (dispatch_id);

DO $$
DECLARE
  v_con text;
BEGIN
  FOR v_con IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public.zomatik_remito_despachos'::regclass
       AND c.contype = 'u'
       AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attname = 'dispatch_id')]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE public.zomatik_remito_despachos DROP CONSTRAINT %I', v_con);
  END LOOP;
END;
$$;

COMMENT ON TABLE public.zomatik_remito_despachos IS 'Zomatik Z1: despachos de cada remito. Un despacho va entero a un remito, o partido entre los remitos de dos NP (m3 = su parte); nunca suman más que el despacho (lo controla zomatik_remito_crear).';

COMMIT;

RESET lock_timeout;
RESET statement_timeout;
