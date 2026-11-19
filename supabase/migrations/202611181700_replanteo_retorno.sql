-- Replanteo: hormigón que vuelve en el camión — SIN APLICAR (la corre Bautista después de que el revisor apruebe).
-- Va DESPUÉS de 202611181400_zomatik_np_edicion.sql. Se puede correr dos veces.
--
-- Especificación: docs/specs/2026-11-18-replanteo-hormigon-de-retorno.md (sección 6; "Decisiones tomadas" manda).
-- CORRERLA FUERA DE HORARIO y ANTES de publicar el código: toma candados cortos sobre dispatches, dispatch_materials y
-- cargas (ALTER TABLE). Va entera en una transacción (BEGIN … COMMIT): para probarla antes, cambiar el COMMIT del final
-- por ROLLBACK (y ver el bloque de prueba comentado al final).
--
-- ANTES DE APLICAR: comparar registrar_despacho y editar_despacho de producción con las de
-- 202610201200_fase3_despacho.sql (scripts/volcar-esquema.mjs a otro archivo). Esta migración parte de esas dos, que son
-- la última CREATE OR REPLACE de cada una en el repo. Si producción tiene algo que el repo no, sumarlo primero.
--
-- Qué cambia (se agrega; no se borra ningún dato):
--   dispatches.retorno_m3              m³ con que volvió el camión (nulo = sin replanteo). quantity_m3 sigue siendo lo
--                                      del remito, la OF, la NP y el pedido.
--   dispatches.cemento_extra_kg        kg de cemento agregados a mano (nulo = sin replanteo).
--   dispatches.retorno_de_dispatch_id  de qué despacho volvió el hormigón (opcional, ON DELETE SET NULL) + índice parcial.
--   CHECK dispatches_retorno_ck        retorno > 0 y hasta quantity_m3.
--   CHECK dispatches_cemento_extra_ck  cemento entre 0 y 1.000 kg y solo con retorno.
--   dispatch_materials.es_replanteo    marca la fila del cemento agregado (false por defecto).
--   cargas.retorno_m3, cargas.cemento_extra_kg  lo que se le pidió a la planta (copia del despacho).
--   cargas.cemento_extra_hecho         lo que confirmó el plantista: {kg, por, at}.
--   CHECK cargas_cemento_extra_ck      cemento entre 0 y 1.000 kg.
--   _cemento_replanteo (nueva)         de qué cemento se descuenta (spec 3.2). Solo service_role.
--   cemento_para_replanteo (nueva)     lo mismo para la pantalla: {id, nombre} o {error}. Lectura.
--   registrar_despacho                 base: 202610201200_fase3_despacho.sql. Además: replanteo opcional (retorno_m3,
--                                      cemento_extra_kg, retorno_de_dispatch_id): fórmula × (m³ − retorno) + fila de
--                                      cemento. Sin esas claves, idéntica a la de fase 3.
--   editar_despacho                    base: 202610201200_fase3_despacho.sql. Además: poner, cambiar o sacar el
--                                      replanteo; stock por diferencia (ratios separados para fórmula y fibra).
--   anular_despacho, _consumo_formula, ajustar_stock_carga, ajustar_material_despacho: NO se tocan.
--
-- Qué pasa con los datos ya cargados:
--   dispatches: las tres columnas nuevas quedan nulas en todos los despachos = sin replanteo. Los CHECK pasan (todo
--               nulo). No se reescribe ningún despacho.
--   dispatch_materials: todas las filas quedan es_replanteo = false (columna con default constante: no reescribe la
--               tabla).
--   cargas: columnas nuevas nulas; las cargas simuladas de prueba que haya quedan igual.
--   Stock, stock_movements, pedidos, viajes, probetas, Zomatik: no cambian. No hay recálculo.
--   Los replanteos hechos antes a mano descontaron 8 m³. Si hay que corregir alguno, se edita en Historial (el stock
--   se corrige por diferencia, salvo materiales con un recuento posterior).
--   Con el código de main (que no manda las claves nuevas) todo sigue exactamente como hoy.

SET lock_timeout = '3s';
SET statement_timeout = '60s';

BEGIN;

-- ---------------------------------------------------------------------------
-- Columnas
-- ---------------------------------------------------------------------------
ALTER TABLE public.dispatches ADD COLUMN IF NOT EXISTS retorno_m3 numeric(10,3);
ALTER TABLE public.dispatches ADD COLUMN IF NOT EXISTS cemento_extra_kg numeric(10,3);
ALTER TABLE public.dispatches ADD COLUMN IF NOT EXISTS retorno_de_dispatch_id uuid REFERENCES public.dispatches(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.dispatches.retorno_m3 IS 'Replanteo: m³ con que volvió el camión. Nulo = sin replanteo. La fórmula se descuenta por quantity_m3 − retorno_m3.';
COMMENT ON COLUMN public.dispatches.cemento_extra_kg IS 'Replanteo: kg de cemento agregados a mano (fila es_replanteo de dispatch_materials).';
COMMENT ON COLUMN public.dispatches.retorno_de_dispatch_id IS 'Replanteo: el despacho del que volvió el hormigón (opcional).';
CREATE INDEX IF NOT EXISTS dispatches_retorno_de_idx ON public.dispatches (retorno_de_dispatch_id) WHERE retorno_de_dispatch_id IS NOT NULL;

ALTER TABLE public.dispatches DROP CONSTRAINT IF EXISTS dispatches_retorno_ck;
ALTER TABLE public.dispatches ADD CONSTRAINT dispatches_retorno_ck
  CHECK (retorno_m3 IS NULL OR (retorno_m3 > 0 AND retorno_m3 <= quantity_m3));
ALTER TABLE public.dispatches DROP CONSTRAINT IF EXISTS dispatches_cemento_extra_ck;
ALTER TABLE public.dispatches ADD CONSTRAINT dispatches_cemento_extra_ck
  CHECK (cemento_extra_kg IS NULL OR (cemento_extra_kg >= 0 AND cemento_extra_kg <= 1000 AND retorno_m3 IS NOT NULL));

ALTER TABLE public.dispatch_materials ADD COLUMN IF NOT EXISTS es_replanteo boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.dispatch_materials.es_replanteo IS 'Replanteo: fila del cemento agregado a mano (no sale de la fórmula).';

ALTER TABLE IF EXISTS public.cargas ADD COLUMN IF NOT EXISTS retorno_m3 numeric;
ALTER TABLE IF EXISTS public.cargas ADD COLUMN IF NOT EXISTS cemento_extra_kg numeric;
ALTER TABLE IF EXISTS public.cargas ADD COLUMN IF NOT EXISTS cemento_extra_hecho jsonb;
DO $$
BEGIN
  IF to_regclass('public.cargas') IS NOT NULL THEN
    ALTER TABLE public.cargas DROP CONSTRAINT IF EXISTS cargas_cemento_extra_ck;
    ALTER TABLE public.cargas ADD CONSTRAINT cargas_cemento_extra_ck
      CHECK (cemento_extra_kg IS NULL OR cemento_extra_kg BETWEEN 0 AND 1000);
    COMMENT ON COLUMN public.cargas.retorno_m3 IS 'Replanteo: m³ que volvieron en el camión (copia del despacho). m3 = lo que se carga.';
    COMMENT ON COLUMN public.cargas.cemento_extra_kg IS 'Replanteo: kg de cemento que el plantista agrega a mano (indicación; Indumix no los recibe).';
    COMMENT ON COLUMN public.cargas.cemento_extra_hecho IS 'Replanteo: lo que confirmó el plantista ("Listo, agregado"): {kg, por, at}. No mueve stock.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- De qué cemento se descuenta el replanteo (spec 3.2):
--   1. el material cemento de la fórmula, en la planta que despacha (_material_en_planta); con más de uno, el de más
--      kg/m³ (empate: por nombre);
--   2. si la fórmula no tiene: el único material cemento de la planta;
--   3. si no se sabe: NULL (registrar_despacho frena si hay cemento > 0).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._cemento_replanteo(p_formula_id uuid, p_plant_id uuid)
 RETURNS public.materials
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mid  uuid;
  v_code text;
  v_m    public.materials;
  v_n    int;
BEGIN
  SELECT fm.material_id, f.code INTO v_mid, v_code
    FROM formula_materials fm
    JOIN materials m ON m.id = fm.material_id
    JOIN formulas f ON f.id = fm.formula_id
   WHERE fm.formula_id = p_formula_id AND m.tipo = 'cemento'
   ORDER BY fm.quantity DESC NULLS LAST, m.name, fm.id
   LIMIT 1;
  IF v_mid IS NOT NULL THEN
    RETURN public._material_en_planta(v_mid, p_plant_id, v_code);
  END IF;
  SELECT count(*) INTO v_n FROM materials WHERE plant_id = p_plant_id AND tipo = 'cemento';
  IF v_n = 1 THEN
    SELECT * INTO v_m FROM materials WHERE plant_id = p_plant_id AND tipo = 'cemento';
    RETURN v_m;
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._cemento_replanteo(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._cemento_replanteo(uuid, uuid) TO service_role;

-- Para la pantalla ("Se descuenta de CPC 40."): {id, nombre} o {error}. Solo lee.
CREATE OR REPLACE FUNCTION public.cemento_para_replanteo(p_formula_id uuid, p_plant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_m public.materials;
BEGIN
  v_m := public._cemento_replanteo(p_formula_id, p_plant_id);
  IF v_m.id IS NULL THEN
    RETURN jsonb_build_object('error', 'La fórmula no tiene cemento.');
  END IF;
  RETURN jsonb_build_object('id', v_m.id, 'nombre', v_m.name);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM);
END;
$function$;
REVOKE ALL ON FUNCTION public.cemento_para_replanteo(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cemento_para_replanteo(uuid, uuid) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- registrar_despacho: base = 202610201200_fase3_despacho.sql (la última del repo). Diff (spec 6.1):
--   - entrada opcional retorno_m3, cemento_extra_kg, retorno_de_dispatch_id. Sin retorno_m3 (o 0): como antes;
--   - con retorno: frena en despacho por árido / de prueba y con las reglas 3.3; el origen inexistente se ignora;
--   - fórmula × (quantity_m3 − retorno_m3) (si es > 0); fibra igual que antes (× quantity_m3);
--   - fila es_replanteo con el cemento (_cemento_replanteo), movimiento 'consumo' propio; un solo _mover_stock;
--   - Actividad "Replanteo" y "Volvió de"; la respuesta suma retorno_m3, m3_cargados y cemento_extra_kg.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_despacho(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_created_by text := nullif(btrim(coalesce(p->>'created_by', '')), '');
  v_usuario    text := coalesce(nullif(btrim(coalesce(p->>'usuario', '')), ''), v_created_by, 'Sistema');
  v_pedido_id  uuid := nullif(p->>'scheduled_dispatch_id', '')::uuid;
  v_pedido     public.scheduled_dispatches;
  v_plant_id   uuid := nullif(p->>'plant_id', '')::uuid;
  v_plant_name text;
  v_formula_id uuid := nullif(p->>'formula_id', '')::uuid;
  v_formula_code text;
  v_client_id  uuid := nullif(p->>'client_id', '')::uuid;
  v_site_id    uuid := nullif(p->>'construction_site_id', '')::uuid;
  v_mixer_id   uuid := nullif(p->>'mixer_id', '')::uuid;
  v_chofer_id  uuid := nullif(p->>'chofer_id', '')::uuid;  -- fase 1 (opcional)
  v_chofer_nombre text;
  v_m3         numeric := nullif(p->>'quantity_m3', '')::numeric;
  v_remito     text := nullif(btrim(coalesce(p->>'remito', '')), '');
  v_es_prueba  boolean := coalesce(nullif(p->>'is_test_dispatch', '')::boolean, false);
  v_fecha      timestamptz := coalesce(nullif(p->>'dispatch_date', '')::timestamptz, now());
  v_dia        date;
  v_fibra_m3   numeric := coalesce(nullif(p->>'fiber_kg_per_m3', '')::numeric, 0);
  v_muestra    boolean := coalesce(nullif(p->>'sample_taken', '')::boolean, false);
  v_sample     text := nullif(btrim(coalesce(p->>'sample_number', '')), '');
  v_notes      text := nullif(btrim(coalesce(p->>'notes', '')), '');
  v_manual     jsonb := p->'materiales_manuales';
  v_en_ruta    boolean;
  v_restante   numeric;
  v_nuevo      numeric;
  v_estado     text;
  v_id         uuid;
  v_n          int := 0;
  v_probetas   int := 0;
  v_total      numeric;
  v_mover      jsonb := '{}'::jsonb;
  v_m          public.materials;
  r            record;
  v_viaje_pedido uuid := nullif(p->>'viaje_id', '')::uuid;  -- fase 2 (opcional): el viaje que se elige
  v_viaje_id   uuid;
  v_viaje_n    int;
  v_viaje_tot  int;
  v_viaje_plan numeric;
  -- Fase 3 (todo opcional)
  v_tipo_in    text := nullif(btrim(coalesce(p->>'remito_tipo', '')), '');
  v_origen_in  text := nullif(btrim(coalesce(p->>'remito_tipo_origen', '')), '');
  v_aviso      text := nullif(btrim(coalesce(p->>'aviso_remito', '')), '');
  v_tipo       text;
  v_tipo_origen text;
  v_res        jsonb;
  v_tipo_dia   text;
  v_dig        text;
  -- Replanteo (todo opcional; spec 2026-11-18)
  v_retorno    numeric := nullif(p->>'retorno_m3', '')::numeric;
  v_cem_kg     numeric := nullif(p->>'cemento_extra_kg', '')::numeric;
  v_ret_de     uuid := nullif(p->>'retorno_de_dispatch_id', '')::uuid;
  v_ret_de_txt text;
  v_cargados   numeric;
  v_cem        public.materials;
  v_nota_desp  text;
BEGIN
  v_dia := (v_fecha AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  -- Replanteo: 0 = sin replanteo (como no mandarlo)
  IF v_retorno = 0 THEN
    v_retorno := NULL;
  END IF;

  -- Pedido (si viene de Despacho diario): se bloquea la fila hasta terminar
  IF v_pedido_id IS NOT NULL THEN
    SELECT * INTO v_pedido FROM scheduled_dispatches WHERE id = v_pedido_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El pedido no existe (puede haber sido borrado). Actualizá la pantalla.';
    END IF;
    IF v_pedido.status = 'cancelled' THEN
      RAISE EXCEPTION 'El pedido está cancelado: no se puede despachar.';
    END IF;
    IF v_pedido.status = 'completed' THEN
      RAISE EXCEPTION 'El pedido ya está completo o finalizado: no se puede despachar más. Actualizá la pantalla.';
    END IF;
    -- Fase 3: suspendido (lluvia, etc.), también desde la pantalla de siempre
    IF v_pedido.suspendido_at IS NOT NULL THEN
      RAISE EXCEPTION 'El pedido está suspendido: reabrilo para despachar.';
    END IF;
    v_plant_id   := coalesce(v_plant_id, v_pedido.plant_id);
    v_formula_id := coalesce(v_formula_id, v_pedido.formula_id);
    v_client_id  := coalesce(v_client_id, v_pedido.client_id);
    v_site_id    := coalesce(v_site_id, v_pedido.construction_site_id);
  END IF;

  IF v_plant_id IS NULL THEN
    RAISE EXCEPTION 'Falta la planta del despacho';
  END IF;
  SELECT name INTO v_plant_name FROM plants WHERE id = v_plant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La planta elegida no existe';
  END IF;

  -- Replanteo: solo para despachos con remito
  IF v_retorno IS NOT NULL AND (v_es_prueba OR (v_manual IS NOT NULL AND jsonb_typeof(v_manual) = 'array' AND jsonb_array_length(v_manual) > 0)) THEN
    RAISE EXCEPTION 'El replanteo es solo para despachos con remito.';
  END IF;

  -- Despacho por árido con ingreso manual: salida de materiales sin despacho (igual que hoy)
  IF v_manual IS NOT NULL AND jsonb_typeof(v_manual) = 'array' AND jsonb_array_length(v_manual) > 0 THEN
    IF v_notes IS NULL THEN
      RAISE EXCEPTION 'Las observaciones son obligatorias para el despacho por árido';
    END IF;
    INSERT INTO manual_material_withdrawals (withdrawal_date, plant_id, observations)
    VALUES (v_dia, v_plant_id, v_notes)
    RETURNING id INTO v_id;
    FOR r IN
      SELECT nullif(e->>'material_id', '')::uuid AS mid, nullif(e->>'quantity_kg', '')::numeric AS q
        FROM jsonb_array_elements(v_manual) e
    LOOP
      IF r.mid IS NULL THEN
        RAISE EXCEPTION 'Elegí el material de cada fila';
      END IF;
      IF r.q IS NULL OR r.q <= 0 THEN
        RAISE EXCEPTION 'La cantidad de cada material debe ser mayor a 0';
      END IF;
      v_m := public._material_en_planta(r.mid, v_plant_id);
      INSERT INTO manual_withdrawal_items (withdrawal_id, material_id, quantity_kg)
      VALUES (v_id, v_m.id, r.q);
      IF v_m.descuenta_stock THEN
        v_mover := public._sumar_kg(v_mover, v_m.id, r.q);
      END IF;
      INSERT INTO stock_movements (material_id, movement_type, quantity_kg, reference_type, reference_id, movement_date, notes)
      VALUES (v_m.id, 'consumo', r.q, 'manual_withdrawal', v_id, v_dia, 'Descarga manual: ' || v_notes);
      v_n := v_n + 1;
    END LOOP;
    PERFORM public._mover_stock(v_mover);
    INSERT INTO activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
    VALUES (v_usuario, 'crear', 'despacho', v_id::text, 'Descarga manual', v_plant_id,
            jsonb_build_object('Tipo', 'Despacho por árido (ingreso manual)', 'Materiales', v_n, 'Observaciones', v_notes));
    RETURN jsonb_build_object('withdrawal_id', v_id, 'materiales', v_n);
  END IF;

  -- Validaciones del despacho
  IF v_formula_id IS NULL THEN
    RAISE EXCEPTION 'Debe seleccionar una fórmula';
  END IF;
  SELECT code INTO v_formula_code FROM formulas WHERE id = v_formula_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La fórmula elegida no existe (actualizá la pantalla)';
  END IF;
  IF v_m3 IS NULL OR v_m3 <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
  END IF;
  IF NOT v_es_prueba THEN
    IF v_remito IS NULL THEN
      RAISE EXCEPTION 'El numero de remito es obligatorio';
    END IF;
    IF v_client_id IS NULL THEN
      RAISE EXCEPTION 'Debe seleccionar un cliente';
    END IF;
    IF v_site_id IS NULL THEN
      RAISE EXCEPTION 'Debe seleccionar una obra';
    END IF;
  ELSIF v_notes IS NULL THEN
    RAISE EXCEPTION 'Las observaciones son obligatorias para el despacho por árido';
  END IF;
  IF v_muestra AND v_sample IS NULL THEN
    RAISE EXCEPTION 'Debe ingresar el número de muestra';
  END IF;
  IF v_fibra_m3 < 0 THEN
    RAISE EXCEPTION 'La fibra (kg por m³) no puede ser negativa';
  END IF;
  -- Replanteo (spec 3.3, mismos textos que la pantalla)
  IF v_retorno IS NULL THEN
    IF coalesce(v_cem_kg, 0) <> 0 THEN
      RAISE EXCEPTION 'Elegí con cuántos m³ volvió el camión.';
    END IF;
    v_cem_kg := NULL;
    v_ret_de := NULL;
  ELSE
    IF v_retorno < 0 THEN
      RAISE EXCEPTION 'Elegí con cuántos m³ volvió el camión.';
    END IF;
    IF mod(v_retorno, 0.5) <> 0 THEN
      RAISE EXCEPTION 'El retorno va de a 0,5 m³.';
    END IF;
    IF v_retorno > v_m3 THEN
      RAISE EXCEPTION 'No puede volver más de lo que lleva el camión (% m³).', replace(trim_scale(v_m3)::text, '.', ',');
    END IF;
    v_cem_kg := coalesce(v_cem_kg, 0);
    IF v_cem_kg < 0 THEN
      RAISE EXCEPTION 'Poné los kg de cemento (o 0).';
    END IF;
    IF v_cem_kg > 1000 THEN
      RAISE EXCEPTION 'Más de 1.000 kg de cemento: revisá el número.';
    END IF;
    -- El despacho del que volvió: si no existe, se ignora
    IF v_ret_de IS NOT NULL THEN
      SELECT coalesce(d.remito_tipo || ' ', '') || coalesce(d.remito, 's/n') || coalesce(' · ' || c.name, '')
        INTO v_ret_de_txt
        FROM dispatches d LEFT JOIN clients c ON c.id = d.client_id
       WHERE d.id = v_ret_de;
      IF NOT FOUND THEN
        v_ret_de := NULL;
      END IF;
    END IF;
  END IF;
  v_cargados := v_m3 - coalesce(v_retorno, 0);
  IF v_chofer_id IS NOT NULL THEN
    SELECT nombre INTO v_chofer_nombre FROM choferes WHERE id = v_chofer_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El chofer elegido no existe (actualizá la pantalla)';
    END IF;
  END IF;

  -- Fase 2: el viaje elegido tiene que ser un viaje pendiente de este pedido
  IF v_viaje_pedido IS NOT NULL THEN
    IF v_pedido_id IS NULL THEN
      RAISE EXCEPTION 'El viaje elegido no corresponde a un pedido. Actualizá la pantalla.';
    END IF;
    PERFORM 1 FROM viajes WHERE id = v_viaje_pedido AND pedido_id = v_pedido_id AND estado = 'planificado' FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El viaje elegido ya se despachó o no es de este pedido. Actualizá la pantalla.';
    END IF;
  END IF;

  -- Fase 3: tipo de remito (R con factura / X sin factura). El despacho por árido o de prueba no lleva tipo.
  IF NOT v_es_prueba THEN
    IF v_tipo_in IS NOT NULL AND v_tipo_in NOT IN ('R', 'X') THEN
      RAISE EXCEPTION 'El tipo de remito tiene que ser R (con factura) o X (sin factura).';
    END IF;
    v_res := public.remito_tipo_para(v_pedido_id, v_client_id, v_site_id, v_dia);
    IF v_tipo_in IS NULL THEN
      -- Pantalla de siempre: lo que diga la base o, si nadie lo definió, el número (2201 en adelante = X)
      v_tipo := v_res->>'tipo';
      v_tipo_origen := v_res->>'origen';
      IF v_tipo IS NULL THEN
        v_tipo := public._remito_tipo_de_numero(v_remito);
        v_tipo_origen := CASE WHEN v_tipo IS NOT NULL THEN 'numero' END;
      END IF;
    ELSIF v_origen_in IN ('pedido', 'obra', 'cliente', 'dia') THEN
      IF (v_res->>'tipo') IS DISTINCT FROM v_tipo_in THEN
        RAISE EXCEPTION 'El tipo de remito cambió (ahora es %). Actualizá la pantalla.',
          CASE v_res->>'tipo' WHEN 'R' THEN 'Con factura' WHEN 'X' THEN 'Sin factura' ELSE 'sin definir' END;
      END IF;
      v_tipo := v_tipo_in;
      v_tipo_origen := v_res->>'origen';
    ELSIF v_origen_in = 'pregunta' THEN
      IF (v_res->>'tipo') IS NOT NULL THEN
        -- Alguien lo definió mientras tanto
        IF v_res->>'tipo' <> v_tipo_in THEN
          IF v_res->>'origen' = 'dia' THEN
            RAISE EXCEPTION 'Hoy ya se respondió % para este cliente. Actualizá la pantalla.',
              CASE v_res->>'tipo' WHEN 'R' THEN 'Con factura' ELSE 'Sin factura' END;
          END IF;
          RAISE EXCEPTION 'El tipo de remito cambió (ahora es %). Actualizá la pantalla.',
            CASE v_res->>'tipo' WHEN 'R' THEN 'Con factura' ELSE 'Sin factura' END;
        END IF;
        v_tipo := v_tipo_in;
        v_tipo_origen := v_res->>'origen';
      ELSE
        -- La respuesta vale para todo el día de ese cliente (en las dos plantas). Si este despacho falla,
        -- no queda grabada (misma transacción).
        INSERT INTO remito_tipo_dia (fecha, client_id, remito_tipo, respondido_por)
        VALUES (v_dia, v_client_id, v_tipo_in, v_usuario)
        ON CONFLICT (fecha, client_id) DO NOTHING;
        IF FOUND THEN
          v_tipo_origen := 'pregunta';
        ELSE
          SELECT remito_tipo INTO v_tipo_dia FROM remito_tipo_dia WHERE fecha = v_dia AND client_id = v_client_id;
          IF v_tipo_dia IS DISTINCT FROM v_tipo_in THEN
            RAISE EXCEPTION 'Hoy ya se respondió % para este cliente. Actualizá la pantalla.',
              CASE v_tipo_dia WHEN 'R' THEN 'Con factura' ELSE 'Sin factura' END;
          END IF;
          v_tipo_origen := 'dia';
        END IF;
        v_tipo := v_tipo_in;
      END IF;
    ELSIF v_origen_in = 'manual' THEN
      -- "Cambiar solo en este remito" (la pantalla lo deja solo con programacion.editar)
      v_tipo := v_tipo_in;
      v_tipo_origen := 'manual';
    ELSE
      RAISE EXCEPTION 'Falta de dónde sale el tipo de remito. Actualizá la pantalla.';
    END IF;
  END IF;

  -- Remito repetido: por planta y tipo, comparando los dígitos ("755" choca con "755 HUDSON" de la misma
  -- planta y no con el 755 de la otra). El lock evita que dos pantallas carguen el mismo número a la vez.
  IF v_remito IS NOT NULL THEN
    v_dig := public._remito_digitos(v_remito);
    PERFORM pg_advisory_xact_lock(hashtext('remito:' || v_plant_id || ':' || coalesce(v_dig, v_remito)));
    IF public._remito_repetido(v_plant_id, v_remito, v_tipo, NULL) THEN
      RAISE EXCEPTION 'Ya hay un remito % en %. No se puede cargar dos veces.',
        coalesce(v_tipo || ' ', '') || coalesce(v_dig, v_remito), v_plant_name;
    END IF;
  END IF;

  -- m³: no superar el restante del pedido + 0,5
  IF v_pedido_id IS NOT NULL THEN
    v_restante := v_pedido.quantity_m3 - coalesce(v_pedido.dispatched_m3, 0);
    IF v_m3 > v_restante + 0.5 THEN
      RAISE EXCEPTION 'Supera el restante (% m3)', round(v_restante, 1);
    END IF;
  END IF;

  -- 1. Despacho (el trigger crea las 3 probetas si sample_taken)
  INSERT INTO dispatches (
    formula_id, quantity_m3, dispatch_date, remito, client_id, construction_site_id, mixer_id,
    extra_water_liters, sand_stockpile_humidity, sample_taken, sample_number, actual_slump_cm,
    notes, is_test_dispatch, created_by, scheduled_dispatch_id, plant_id, chofer_id,
    remito_tipo, remito_tipo_origen, retorno_m3, cemento_extra_kg, retorno_de_dispatch_id
  ) VALUES (
    v_formula_id, v_m3, v_fecha, v_remito,
    CASE WHEN v_es_prueba THEN NULL ELSE v_client_id END,
    CASE WHEN v_es_prueba THEN NULL ELSE v_site_id END,
    v_mixer_id,
    nullif(p->>'extra_water_liters', '')::numeric,
    nullif(p->>'sand_stockpile_humidity', '')::numeric,
    v_muestra,
    CASE WHEN v_muestra THEN v_sample ELSE NULL END,
    CASE WHEN v_muestra THEN nullif(p->>'actual_slump_cm', '')::numeric ELSE NULL END,
    v_notes, v_es_prueba, coalesce(v_created_by, v_usuario), v_pedido_id, v_plant_id, v_chofer_id,
    v_tipo, v_tipo_origen, v_retorno, v_cem_kg, v_ret_de
  )
  RETURNING id INTO v_id;

  -- 2. Materiales de la fórmula, en la planta que despacha. Con replanteo, por los m³ que se cargan (m³ − retorno);
  --    volvió entero: no se carga fórmula.
  v_nota_desp := 'Despacho remito ' || coalesce(v_remito, 'N/A')
    || CASE WHEN v_retorno IS NOT NULL
            THEN ' · replanteo: ' || replace(trim_scale(v_cargados)::text, '.', ',') || ' de ' || replace(trim_scale(v_m3)::text, '.', ',') || ' m³'
            ELSE '' END;
  IF v_cargados > 0 THEN
    FOR r IN SELECT * FROM public._consumo_formula(v_formula_id, v_plant_id, v_cargados) LOOP
      INSERT INTO dispatch_materials (dispatch_id, material_id, quantity, dry_quantity, wet_quantity, humidity_at_dispatch)
      VALUES (v_id, r.mat_id, r.kg_humedo, r.kg_seco, r.kg_humedo, r.humedad_pct);
      IF r.descuenta THEN
        v_mover := public._sumar_kg(v_mover, r.mat_id, r.kg_humedo);
      END IF;
      INSERT INTO stock_movements (material_id, movement_type, quantity_kg, reference_type, reference_id, movement_date, notes)
      VALUES (r.mat_id, 'consumo', r.kg_humedo, 'dispatch', v_id, v_dia, v_nota_desp);
      v_n := v_n + 1;
    END LOOP;
  END IF;

  -- 3. Fibra agregada al camión (kg/m³ × m³), material tipo fibra de la planta
  IF v_fibra_m3 > 0 THEN
    SELECT * INTO v_m FROM materials WHERE plant_id = v_plant_id AND tipo = 'fibra' ORDER BY name LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No se encontró el material Fibra en la planta %', v_plant_name;
    END IF;
    v_total := round(v_fibra_m3 * v_m3, 3);
    INSERT INTO dispatch_materials (dispatch_id, material_id, quantity, dry_quantity, wet_quantity, humidity_at_dispatch)
    VALUES (v_id, v_m.id, v_total, v_total, v_total, 0);
    IF v_m.descuenta_stock THEN
      v_mover := public._sumar_kg(v_mover, v_m.id, v_total);
    END IF;
    INSERT INTO stock_movements (material_id, movement_type, quantity_kg, reference_type, reference_id, movement_date, notes)
    VALUES (v_m.id, 'consumo', v_total, 'dispatch', v_id, v_dia,
            'Fibra ' || v_fibra_m3 || ' kg/m³ × ' || v_m3 || ' m³ — remito ' || coalesce(v_remito, 'N/A'));
    v_n := v_n + 1;
  END IF;

  -- 3b. Replanteo: el cemento agregado a mano, en una fila aparte (es_replanteo)
  IF coalesce(v_cem_kg, 0) > 0 THEN
    v_cem := public._cemento_replanteo(v_formula_id, v_plant_id);
    IF v_cem.id IS NULL THEN
      RAISE EXCEPTION 'No se sabe de qué cemento descontar: la fórmula no tiene cemento.';
    END IF;
    INSERT INTO dispatch_materials (dispatch_id, material_id, quantity, dry_quantity, wet_quantity, humidity_at_dispatch, es_replanteo)
    VALUES (v_id, v_cem.id, v_cem_kg, v_cem_kg, v_cem_kg, 0, true);
    IF v_cem.descuenta_stock THEN
      v_mover := public._sumar_kg(v_mover, v_cem.id, v_cem_kg);
    END IF;
    INSERT INTO stock_movements (material_id, movement_type, quantity_kg, reference_type, reference_id, movement_date, notes)
    VALUES (v_cem.id, 'consumo', v_cem_kg, 'dispatch', v_id, v_dia,
            'Replanteo: cemento agregado (volvió ' || replace(trim_scale(v_retorno)::text, '.', ',') || ' m³) — remito ' || coalesce(v_remito, 'N/A'));
    v_n := v_n + 1;
  END IF;

  -- Stock: todos los materiales juntos, en orden de id
  PERFORM public._mover_stock(v_mover);

  -- Fase 2 (antes de tocar el pedido: si este camión lo completa, el trigger cancela los viajes que sobran)
  IF v_pedido_id IS NOT NULL THEN
    -- Fase 2: el viaje elegido o, si no se eligió, el primer viaje pendiente del pedido queda despachado.
    -- Si el pedido no tiene viajes no pasa nada (igual que antes).
    UPDATE viajes
       SET estado = 'despachado', dispatch_id = v_id, m3_planificado = m3, m3 = v_m3,  -- m³ reales del camión
           actualizado_por = v_usuario, updated_at = now()
     WHERE id = coalesce(v_viaje_pedido,
                         (SELECT id FROM viajes
                           WHERE pedido_id = v_pedido_id AND estado = 'planificado'
                           ORDER BY n LIMIT 1))
       AND estado = 'planificado'
     RETURNING id, n, m3_planificado INTO v_viaje_id, v_viaje_n, v_viaje_plan;
    IF v_viaje_id IS NOT NULL THEN
      SELECT count(*) INTO v_viaje_tot FROM viajes WHERE pedido_id = v_pedido_id AND estado <> 'cancelado';
    END IF;
  END IF;

  -- 4. Pedido: acumulado atómico y completo si se llegó al total
  IF v_pedido_id IS NOT NULL THEN
    UPDATE scheduled_dispatches
       SET dispatched_m3 = coalesce(dispatched_m3, 0) + v_m3,
           status = CASE WHEN coalesce(dispatched_m3, 0) + v_m3 >= quantity_m3 - 0.01 THEN 'completed' ELSE status END,
           updated_at = now()
     WHERE id = v_pedido_id
     RETURNING dispatched_m3, status INTO v_nuevo, v_estado;
    INSERT INTO dispatch_status_log (scheduled_dispatch_id, previous_status, new_status, changed_by, notes)
    VALUES (v_pedido_id, v_pedido.status, v_estado, v_usuario, 'Despacho remito ' || coalesce(v_remito, 'N/A') || ' · ' || v_m3 || ' m3');

  END IF;

  -- 5. Camión en ruta (por defecto solo cuando sale de un pedido, como hoy)
  v_en_ruta := coalesce(nullif(p->>'mixer_en_ruta', '')::boolean, v_pedido_id IS NOT NULL);
  IF v_mixer_id IS NOT NULL AND v_en_ruta THEN
    UPDATE mixers SET status = 'in_transit', updated_at = now() WHERE id = v_mixer_id;
  END IF;

  -- 6. Actividad
  INSERT INTO activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
  VALUES (v_usuario, 'crear', 'despacho', v_id::text, v_remito, v_plant_id,
          jsonb_build_object(
            'Remito', coalesce(v_remito, '-'),
            'm3', v_m3,
            'Formula', v_formula_code,
            'Origen', CASE WHEN v_pedido_id IS NOT NULL THEN 'Pedido' WHEN v_es_prueba THEN 'Por árido' ELSE 'Manual' END)
          || CASE WHEN v_chofer_nombre IS NOT NULL THEN jsonb_build_object('Chofer', v_chofer_nombre) ELSE '{}'::jsonb END
          || CASE WHEN v_viaje_id IS NOT NULL THEN jsonb_build_object('Viaje', v_viaje_n || '/' || v_viaje_tot) ELSE '{}'::jsonb END
          -- Fase 3
          || CASE WHEN v_tipo IS NOT NULL THEN jsonb_build_object('Tipo de remito',
               v_tipo || CASE v_tipo WHEN 'R' THEN ' (con factura)' ELSE ' (sin factura)' END
               || ' · ' || CASE v_tipo_origen
                             WHEN 'pedido' THEN 'lo dice el pedido'
                             WHEN 'obra' THEN 'lo dice la obra'
                             WHEN 'cliente' THEN 'lo dice el cliente'
                             WHEN 'dia' THEN 'respuesta del día'
                             WHEN 'pregunta' THEN 'respondido al despachar (vale para todo el día del cliente)'
                             WHEN 'manual' THEN 'cambiado solo en este remito'
                             WHEN 'numero' THEN 'deducido del número'
                             ELSE coalesce(v_tipo_origen, '-') END) ELSE '{}'::jsonb END
          || CASE WHEN v_aviso IS NOT NULL THEN jsonb_build_object('Aviso de remito aceptado', v_aviso) ELSE '{}'::jsonb END
          -- Para medir el retiro de la pantalla vieja (fase-3.md 6.4): la nueva manda "pantalla"
          || CASE WHEN nullif(btrim(coalesce(p->>'pantalla', '')), '') IS NOT NULL THEN jsonb_build_object('Pantalla', p->>'pantalla') ELSE '{}'::jsonb END
          || CASE WHEN v_pedido_id IS NOT NULL AND p ? 'dispatch_date' AND abs(extract(epoch FROM (now() - v_fecha))) > 600
                  THEN jsonb_build_object('Salió a las', to_char(v_fecha, 'HH24:MI') || ' (corregida; cargado ' || to_char(now(), 'HH24:MI') || ')')
                  ELSE '{}'::jsonb END
          -- Replanteo
          || CASE WHEN v_retorno IS NOT NULL THEN jsonb_build_object('Replanteo',
               'Volvió ' || replace(trim_scale(v_retorno)::text, '.', ',') || ' m³ · '
               || CASE WHEN v_cargados > 0 THEN 'se cargaron ' || replace(trim_scale(v_cargados)::text, '.', ',') || ' m³' ELSE 'no se cargó hormigón nuevo' END
               || CASE WHEN v_cem_kg > 0 THEN ' · +' || replace(trim_scale(v_cem_kg)::text, '.', ',') || ' kg de ' || v_cem.name ELSE '' END)
             ELSE '{}'::jsonb END
          || CASE WHEN v_ret_de IS NOT NULL THEN jsonb_build_object('Volvió de', 'Remito ' || v_ret_de_txt) ELSE '{}'::jsonb END);

  SELECT count(*) INTO v_probetas FROM test_cylinders WHERE dispatch_id = v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'remito', v_remito,
    'm3', v_m3,
    'restante', CASE WHEN v_pedido_id IS NOT NULL THEN greatest(0, v_pedido.quantity_m3 - v_nuevo) END,
    'completo', coalesce(v_estado = 'completed', false),
    'probetas', v_probetas,
    'materiales', v_n)
    || CASE WHEN v_viaje_id IS NOT NULL THEN jsonb_build_object('viaje_id', v_viaje_id, 'viaje_n', v_viaje_n, 'viaje_m3_planificado', v_viaje_plan) ELSE '{}'::jsonb END
    || jsonb_build_object('remito_tipo', v_tipo, 'remito_tipo_origen', v_tipo_origen)
    -- Replanteo (siempre: la pantalla sabe así que la función es la nueva)
    || jsonb_build_object('retorno_m3', v_retorno, 'm3_cargados', v_cargados, 'cemento_extra_kg', v_cem_kg);
END;
$function$;

-- ---------------------------------------------------------------------------
-- editar_despacho: base = 202610201200_fase3_despacho.sql (la última del repo). Diff (spec 6.2):
--   - entrada nueva retorno_m3, cemento_extra_kg, retorno_de_dispatch_id (clave ausente = queda; nulo o 0 = sin
--     replanteo), con las reglas 3.3 contra los m³ nuevos;
--   - se recalcula también si cambia el retorno o el cemento;
--   - escala (misma fórmula y planta, cargados viejos y nuevos > 0): fórmula × cargados nuevos / viejos, fibra × m³
--     nuevos / viejos, la fila es_replanteo se reemplaza; recálculo: fórmula por los cargados nuevos;
--   - _ajustar_pedido solo con la diferencia de quantity_m3; Actividad "Replanteo" antes → después.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.editar_despacho(p_id uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_usuario  text := coalesce(nullif(btrim(coalesce(p->>'usuario', '')), ''), 'Sistema');
  v_d        public.dispatches;
  v_m3       numeric;
  v_formula  uuid;
  v_plant    uuid;
  v_calc_plant uuid;
  v_remito   text;
  v_old_rem  text;
  v_client   uuid;
  v_site     uuid;
  v_mixer    uuid;
  v_chofer   uuid;  -- fase 1
  v_agua     numeric;
  v_notes    text;
  v_fecha    timestamptz;
  v_recalc   boolean;
  v_ratio    numeric;
  v_q        numeric;
  v_fibra_m3 numeric;
  v_neto     jsonb := '{}'::jsonb;
  v_res      jsonb;
  v_cambios  jsonb := '{}'::jsonb;
  v_nota     text;
  v_m        public.materials;
  v_motivo   text := nullif(btrim(coalesce(p->>'motivo', '')), '');  -- fase 0c-1 (opcional)
  r          record;
  -- Fase 3
  v_tipo     text;
  v_tipo_ef  text;
  v_dig      text;
  -- Replanteo
  v_ret      numeric;
  v_cem      numeric;
  v_retde    uuid;
  v_carg_viejo numeric;
  v_carg_nuevo numeric;
  v_ratio_fib numeric;
  v_cem_mat  public.materials;
  v_rep_txt  text;
BEGIN
  -- Orden de bloqueos: despacho -> pedido -> materiales
  SELECT * INTO v_d FROM dispatches WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El despacho no existe (puede que se haya borrado). Actualizá la pantalla.';
  END IF;
  IF v_d.scheduled_dispatch_id IS NOT NULL THEN
    PERFORM 1 FROM scheduled_dispatches WHERE id = v_d.scheduled_dispatch_id FOR UPDATE;
  END IF;

  v_m3      := CASE WHEN p ? 'quantity_m3' THEN nullif(p->>'quantity_m3', '')::numeric ELSE v_d.quantity_m3 END;
  v_formula := coalesce(CASE WHEN p ? 'formula_id' THEN nullif(p->>'formula_id', '')::uuid END, v_d.formula_id);
  v_plant   := coalesce(CASE WHEN p ? 'plant_id' THEN nullif(p->>'plant_id', '')::uuid END, v_d.plant_id);
  v_remito  := CASE WHEN p ? 'remito' THEN nullif(btrim(coalesce(p->>'remito', '')), '') ELSE v_d.remito END;
  v_client  := CASE WHEN p ? 'client_id' THEN nullif(p->>'client_id', '')::uuid ELSE v_d.client_id END;
  v_site    := CASE WHEN p ? 'construction_site_id' THEN nullif(p->>'construction_site_id', '')::uuid ELSE v_d.construction_site_id END;
  v_mixer   := CASE WHEN p ? 'mixer_id' THEN nullif(p->>'mixer_id', '')::uuid ELSE v_d.mixer_id END;
  v_chofer  := CASE WHEN p ? 'chofer_id' THEN nullif(p->>'chofer_id', '')::uuid ELSE v_d.chofer_id END;
  v_agua    := CASE WHEN p ? 'extra_water_liters' THEN nullif(p->>'extra_water_liters', '')::numeric ELSE v_d.extra_water_liters END;
  v_notes   := CASE WHEN p ? 'notes' THEN nullif(btrim(coalesce(p->>'notes', '')), '') ELSE v_d.notes END;
  v_fecha   := coalesce(CASE WHEN p ? 'dispatch_date' THEN nullif(p->>'dispatch_date', '')::timestamptz END, v_d.dispatch_date);
  v_tipo    := CASE WHEN p ? 'remito_tipo' THEN nullif(btrim(coalesce(p->>'remito_tipo', '')), '') ELSE v_d.remito_tipo END;
  v_ret     := CASE WHEN p ? 'retorno_m3' THEN nullif(p->>'retorno_m3', '')::numeric ELSE v_d.retorno_m3 END;
  v_cem     := CASE WHEN p ? 'cemento_extra_kg' THEN nullif(p->>'cemento_extra_kg', '')::numeric ELSE v_d.cemento_extra_kg END;
  v_retde   := CASE WHEN p ? 'retorno_de_dispatch_id' THEN nullif(p->>'retorno_de_dispatch_id', '')::uuid ELSE v_d.retorno_de_dispatch_id END;
  IF v_ret = 0 THEN
    v_ret := NULL;
  END IF;

  IF v_m3 IS NULL OR v_m3 <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM formulas WHERE id = v_formula) THEN
    RAISE EXCEPTION 'La fórmula elegida no existe (actualizá la pantalla)';
  END IF;
  IF v_chofer IS DISTINCT FROM v_d.chofer_id AND v_chofer IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM choferes WHERE id = v_chofer) THEN
    RAISE EXCEPTION 'El chofer elegido no existe (actualizá la pantalla)';
  END IF;
  IF v_tipo IS NOT NULL AND v_tipo NOT IN ('R', 'X') THEN
    RAISE EXCEPTION 'El tipo de remito tiene que ser R (con factura) o X (sin factura).';
  END IF;

  -- Replanteo (spec 3.3, contra los m³ nuevos)
  IF v_ret IS NULL THEN
    IF p ? 'cemento_extra_kg' AND coalesce(v_cem, 0) <> 0 THEN
      RAISE EXCEPTION 'Elegí con cuántos m³ volvió el camión.';
    END IF;
    v_cem := NULL;
    v_retde := NULL;
  ELSE
    IF v_d.is_test_dispatch THEN
      RAISE EXCEPTION 'El replanteo es solo para despachos con remito.';
    END IF;
    IF v_ret < 0 THEN
      RAISE EXCEPTION 'Elegí con cuántos m³ volvió el camión.';
    END IF;
    IF mod(v_ret, 0.5) <> 0 THEN
      RAISE EXCEPTION 'El retorno va de a 0,5 m³.';
    END IF;
    IF v_ret > v_m3 THEN
      RAISE EXCEPTION 'No puede volver más de lo que lleva el camión (% m³).', replace(trim_scale(v_m3)::text, '.', ',');
    END IF;
    v_cem := coalesce(v_cem, 0);
    IF v_cem < 0 THEN
      RAISE EXCEPTION 'Poné los kg de cemento (o 0).';
    END IF;
    IF v_cem > 1000 THEN
      RAISE EXCEPTION 'Más de 1.000 kg de cemento: revisá el número.';
    END IF;
    IF v_retde IS NOT NULL AND (v_retde = p_id OR NOT EXISTS (SELECT 1 FROM dispatches WHERE id = v_retde)) THEN
      v_retde := NULL;
    END IF;
  END IF;
  v_carg_viejo := v_d.quantity_m3 - coalesce(v_d.retorno_m3, 0);
  v_carg_nuevo := v_m3 - coalesce(v_ret, 0);

  -- Remito: si cambia el remito, la planta o el tipo, no puede repetir otro de la misma planta y tipo
  v_old_rem := nullif(btrim(coalesce(v_d.remito, '')), '');
  IF v_remito IS NOT NULL
     AND (public._remito_digitos(v_remito) IS DISTINCT FROM public._remito_digitos(v_old_rem)
          OR (public._remito_digitos(v_remito) IS NULL AND v_remito IS DISTINCT FROM v_old_rem)
          OR v_plant IS DISTINCT FROM v_d.plant_id
          -- el tipo EFECTIVO (el guardado o, si no tiene, el que dice el número): clasificar un despacho viejo
          -- con el tipo que ya decía su número no vuelve a controlar el repetido
          OR coalesce(v_tipo, public._remito_tipo_de_numero(v_remito)) IS DISTINCT FROM coalesce(v_d.remito_tipo, public._remito_tipo_de_numero(v_old_rem))) THEN
    v_dig := public._remito_digitos(v_remito);
    v_tipo_ef := coalesce(v_tipo, public._remito_tipo_de_numero(v_remito));
    PERFORM pg_advisory_xact_lock(hashtext('remito:' || v_plant || ':' || coalesce(v_dig, v_remito)));
    IF public._remito_repetido(v_plant, v_remito, v_tipo_ef, p_id) THEN
      RAISE EXCEPTION 'Ya hay un remito % en %. No se puede cargar dos veces.',
        coalesce(v_tipo_ef || ' ', '') || coalesce(v_dig, v_remito), coalesce((SELECT name FROM plants WHERE id = v_plant), 'esa planta');
    END IF;
  END IF;

  v_recalc := v_m3 <> v_d.quantity_m3 OR v_formula <> v_d.formula_id OR v_plant IS DISTINCT FROM v_d.plant_id
              -- Replanteo: también si cambia el retorno o el cemento
              OR v_ret IS DISTINCT FROM v_d.retorno_m3 OR v_cem IS DISTINCT FROM v_d.cemento_extra_kg;
  v_nota := 'Edición remito ' || coalesce(v_remito, 's/n') || coalesce(' · ' || v_motivo, '') || ' (' || v_usuario || ')';

  IF v_recalc THEN
    v_calc_plant := coalesce(v_plant, (SELECT plant_id FROM formulas WHERE id = v_formula));
    IF v_formula = v_d.formula_id AND v_plant IS NOT DISTINCT FROM v_d.plant_id AND v_d.quantity_m3 > 0
       AND v_carg_viejo > 0 AND v_carg_nuevo > 0 THEN
      -- Solo cambian los m³ o el replanteo: se escalan fórmula (por los m³ cargados) y fibra (por los m³ del camión);
      -- lo que ya no está en la fórmula se quita; la fila del cemento del replanteo se reemplaza (abajo)
      v_ratio := v_carg_nuevo / v_carg_viejo;
      v_ratio_fib := v_m3 / v_d.quantity_m3;
      v_nota := v_nota || CASE WHEN v_m3 <> v_d.quantity_m3 THEN ': ' || v_d.quantity_m3 || ' → ' || v_m3 || ' m3' ELSE '' END;
      FOR r IN
        SELECT dm.id, dm.material_id, dm.quantity, dm.dry_quantity, dm.es_replanteo, (m.tipo = 'fibra') AS es_fibra,
               (m.tipo = 'fibra' OR EXISTS (
                  SELECT 1 FROM formula_materials fm JOIN materials fmm ON fmm.id = fm.material_id
                   WHERE fm.formula_id = v_d.formula_id
                     AND lower(btrim(fmm.name)) = lower(btrim(m.name)) AND fmm.tipo = m.tipo)) AS por_m3
          FROM dispatch_materials dm JOIN materials m ON m.id = dm.material_id
         WHERE dm.dispatch_id = p_id
           AND NOT (m.tipo = 'aditivo_obra' AND m.name ILIKE '%superfluidificante%')
         ORDER BY dm.material_id, dm.id
      LOOP
        IF r.es_replanteo THEN
          DELETE FROM dispatch_materials WHERE id = r.id;
          v_neto := public._sumar_kg(v_neto, r.material_id, -r.quantity);
        ELSIF r.por_m3 THEN
          v_q := round(r.quantity * CASE WHEN r.es_fibra THEN v_ratio_fib ELSE v_ratio END, 3);
          UPDATE dispatch_materials
             SET quantity = v_q,
                 wet_quantity = v_q,
                 dry_quantity = CASE WHEN r.dry_quantity IS NULL THEN NULL ELSE round(r.dry_quantity * CASE WHEN r.es_fibra THEN v_ratio_fib ELSE v_ratio END, 3) END
           WHERE id = r.id;
          v_neto := public._sumar_kg(v_neto, r.material_id, v_q - r.quantity);
        ELSE
          DELETE FROM dispatch_materials WHERE id = r.id;
          v_neto := public._sumar_kg(v_neto, r.material_id, -r.quantity);
        END IF;
      END LOOP;
    ELSE
      -- Cambia la fórmula o la planta (o con replanteo, alguno de los m³ cargados es 0): se sacan todas las filas
      -- (menos superfluidificante) y se recalculan
      v_nota := v_nota || CASE WHEN v_formula <> v_d.formula_id OR v_plant IS DISTINCT FROM v_d.plant_id
                               THEN ': recálculo por cambio de fórmula/planta'
                               ELSE ': recálculo por replanteo (' || v_d.quantity_m3 || ' → ' || v_m3 || ' m3)' END;
      SELECT coalesce(sum(dm.quantity), 0) / nullif(v_d.quantity_m3, 0) INTO v_fibra_m3
        FROM dispatch_materials dm JOIN materials m ON m.id = dm.material_id
       WHERE dm.dispatch_id = p_id AND m.tipo = 'fibra';
      FOR r IN
        SELECT dm.id, dm.material_id, dm.quantity
          FROM dispatch_materials dm JOIN materials m ON m.id = dm.material_id
         WHERE dm.dispatch_id = p_id
           AND NOT (m.tipo = 'aditivo_obra' AND m.name ILIKE '%superfluidificante%')
         ORDER BY dm.material_id, dm.id
      LOOP
        DELETE FROM dispatch_materials WHERE id = r.id;
        v_neto := public._sumar_kg(v_neto, r.material_id, -r.quantity);
      END LOOP;
      IF v_carg_nuevo > 0 THEN
        FOR r IN SELECT * FROM public._consumo_formula(v_formula, v_calc_plant, v_carg_nuevo) LOOP
          INSERT INTO dispatch_materials (dispatch_id, material_id, quantity, dry_quantity, wet_quantity, humidity_at_dispatch)
          VALUES (p_id, r.mat_id, r.kg_humedo, r.kg_seco, r.kg_humedo, r.humedad_pct);
          v_neto := public._sumar_kg(v_neto, r.mat_id, r.kg_humedo);
        END LOOP;
      END IF;
      IF coalesce(v_fibra_m3, 0) > 0 THEN
        SELECT * INTO v_m FROM materials WHERE plant_id = v_calc_plant AND tipo = 'fibra' ORDER BY name LIMIT 1;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'No se encontró el material Fibra en la planta del despacho';
        END IF;
        v_q := round(v_fibra_m3 * v_m3, 3);
        INSERT INTO dispatch_materials (dispatch_id, material_id, quantity, dry_quantity, wet_quantity, humidity_at_dispatch)
        VALUES (p_id, v_m.id, v_q, v_q, v_q, 0);
        v_neto := public._sumar_kg(v_neto, v_m.id, v_q);
      END IF;
    END IF;

    -- Replanteo: la fila nueva del cemento (la vieja ya se sacó en los dos caminos)
    IF coalesce(v_cem, 0) > 0 THEN
      v_cem_mat := public._cemento_replanteo(v_formula, v_calc_plant);
      IF v_cem_mat.id IS NULL THEN
        RAISE EXCEPTION 'No se sabe de qué cemento descontar: la fórmula no tiene cemento.';
      END IF;
      INSERT INTO dispatch_materials (dispatch_id, material_id, quantity, dry_quantity, wet_quantity, humidity_at_dispatch, es_replanteo)
      VALUES (p_id, v_cem_mat.id, v_cem, v_cem, v_cem, 0, true);
      v_neto := public._sumar_kg(v_neto, v_cem_mat.id, v_cem);
    END IF;
    IF v_ret IS DISTINCT FROM v_d.retorno_m3 OR v_cem IS DISTINCT FROM v_d.cemento_extra_kg THEN
      v_nota := v_nota || ' · replanteo: ' || CASE WHEN v_ret IS NULL THEN 'sin replanteo'
        ELSE replace(trim_scale(v_carg_nuevo)::text, '.', ',') || ' de ' || replace(trim_scale(v_m3)::text, '.', ',') || ' m³ + '
             || replace(trim_scale(v_cem)::text, '.', ',') || ' kg de cemento' END;
    END IF;

    -- Stock por diferencia neta (orden de id; ancla de stock respetada)
    v_res := public._aplicar_neto(p_id, v_d.created_at, v_neto, v_nota);

    -- Pedido
    PERFORM public._ajustar_pedido(v_d.scheduled_dispatch_id, v_m3 - v_d.quantity_m3, v_usuario,
                                   'Edición remito ' || coalesce(v_remito, 's/n') || ': ' || v_d.quantity_m3 || ' → ' || v_m3 || ' m3');
  END IF;

  -- Registro de lo anterior y lo nuevo (solo lo que cambió)
  IF v_m3 <> v_d.quantity_m3 THEN
    v_cambios := v_cambios || jsonb_build_object('m3', v_d.quantity_m3 || ' → ' || v_m3);
  END IF;
  IF v_formula <> v_d.formula_id THEN
    v_cambios := v_cambios || jsonb_build_object('Formula',
      (SELECT code FROM formulas WHERE id = v_d.formula_id) || ' → ' || (SELECT code FROM formulas WHERE id = v_formula));
  END IF;
  IF v_plant IS DISTINCT FROM v_d.plant_id THEN
    v_cambios := v_cambios || jsonb_build_object('Planta',
      coalesce((SELECT name FROM plants WHERE id = v_d.plant_id), '-') || ' → ' || coalesce((SELECT name FROM plants WHERE id = v_plant), '-'));
  END IF;
  IF v_remito IS DISTINCT FROM v_d.remito THEN
    v_cambios := v_cambios || jsonb_build_object('Remito', coalesce(v_d.remito, '-') || ' → ' || coalesce(v_remito, '-'));
  END IF;
  IF v_tipo IS DISTINCT FROM v_d.remito_tipo THEN
    v_cambios := v_cambios || jsonb_build_object('Tipo de remito', coalesce(v_d.remito_tipo, 'sin tipo') || ' → ' || coalesce(v_tipo, 'sin tipo'));
  END IF;
  IF v_client IS DISTINCT FROM v_d.client_id THEN
    v_cambios := v_cambios || jsonb_build_object('Cliente',
      coalesce((SELECT name FROM clients WHERE id = v_d.client_id), '-') || ' → ' || coalesce((SELECT name FROM clients WHERE id = v_client), '-'));
  END IF;
  IF v_site IS DISTINCT FROM v_d.construction_site_id THEN
    v_cambios := v_cambios || jsonb_build_object('Obra',
      coalesce((SELECT name FROM construction_sites WHERE id = v_d.construction_site_id), '-') || ' → ' || coalesce((SELECT name FROM construction_sites WHERE id = v_site), '-'));
  END IF;
  IF v_mixer IS DISTINCT FROM v_d.mixer_id THEN
    v_cambios := v_cambios || jsonb_build_object('Camion',
      coalesce((SELECT license_plate FROM mixers WHERE id = v_d.mixer_id), '-') || ' → ' || coalesce((SELECT license_plate FROM mixers WHERE id = v_mixer), '-'));
  END IF;
  IF v_chofer IS DISTINCT FROM v_d.chofer_id THEN
    v_cambios := v_cambios || jsonb_build_object('Chofer',
      coalesce((SELECT nombre FROM choferes WHERE id = v_d.chofer_id), '-') || ' → ' || coalesce((SELECT nombre FROM choferes WHERE id = v_chofer), '-'));
  END IF;
  IF v_agua IS DISTINCT FROM v_d.extra_water_liters THEN
    v_cambios := v_cambios || jsonb_build_object('Agua extra (L)', coalesce(v_d.extra_water_liters::text, '-') || ' → ' || coalesce(v_agua::text, '-'));
  END IF;
  IF v_notes IS DISTINCT FROM v_d.notes THEN
    v_cambios := v_cambios || jsonb_build_object('Observaciones', coalesce(v_d.notes, '-') || ' → ' || coalesce(v_notes, '-'));
  END IF;
  -- Replanteo: "sin replanteo → volvió 1 m³ + 50 kg", "volvió 1 m³ + 50 kg → sin replanteo" o
  -- "volvió 1 → 1,5 m³ · cemento 50 → 80 kg"
  IF v_ret IS DISTINCT FROM v_d.retorno_m3 OR v_cem IS DISTINCT FROM v_d.cemento_extra_kg THEN
    IF v_d.retorno_m3 IS NULL THEN
      v_rep_txt := 'sin replanteo → volvió ' || replace(trim_scale(v_ret)::text, '.', ',') || ' m³ + ' || replace(trim_scale(v_cem)::text, '.', ',') || ' kg';
    ELSIF v_ret IS NULL THEN
      v_rep_txt := 'volvió ' || replace(trim_scale(v_d.retorno_m3)::text, '.', ',') || ' m³ + ' || replace(trim_scale(coalesce(v_d.cemento_extra_kg, 0))::text, '.', ',') || ' kg → sin replanteo';
    ELSE
      v_rep_txt := 'volvió ' || replace(trim_scale(v_d.retorno_m3)::text, '.', ',')
        || CASE WHEN v_ret IS DISTINCT FROM v_d.retorno_m3 THEN ' → ' || replace(trim_scale(v_ret)::text, '.', ',') ELSE '' END || ' m³'
        || ' · cemento ' || replace(trim_scale(coalesce(v_d.cemento_extra_kg, 0))::text, '.', ',')
        || CASE WHEN v_cem IS DISTINCT FROM v_d.cemento_extra_kg THEN ' → ' || replace(trim_scale(v_cem)::text, '.', ',') ELSE '' END || ' kg';
    END IF;
    v_cambios := v_cambios || jsonb_build_object('Replanteo', v_rep_txt);
  END IF;
  IF v_retde IS DISTINCT FROM v_d.retorno_de_dispatch_id THEN
    v_cambios := v_cambios || jsonb_build_object('Volvió de',
      coalesce((SELECT coalesce(remito_tipo || ' ', '') || coalesce(remito, 's/n') FROM dispatches WHERE id = v_d.retorno_de_dispatch_id), '-')
      || ' → ' || coalesce((SELECT coalesce(remito_tipo || ' ', '') || coalesce(remito, 's/n') FROM dispatches WHERE id = v_retde), '-'));
  END IF;
  IF v_fecha IS DISTINCT FROM v_d.dispatch_date THEN
    v_cambios := v_cambios || jsonb_build_object('Fecha', to_char(v_d.dispatch_date, 'DD/MM/YYYY HH24:MI') || ' → ' || to_char(v_fecha, 'DD/MM/YYYY HH24:MI'));
  END IF;

  UPDATE dispatches
     SET quantity_m3 = v_m3, formula_id = v_formula, plant_id = v_plant, remito = v_remito,
         client_id = v_client, construction_site_id = v_site, mixer_id = v_mixer, chofer_id = v_chofer,
         extra_water_liters = v_agua, notes = v_notes, dispatch_date = v_fecha,
         remito_tipo = v_tipo,
         retorno_m3 = v_ret, cemento_extra_kg = v_cem, retorno_de_dispatch_id = v_retde,
         remito_tipo_origen = CASE WHEN v_tipo IS DISTINCT FROM v_d.remito_tipo
                                   THEN CASE WHEN v_tipo IS NULL THEN NULL ELSE 'manual' END
                                   ELSE v_d.remito_tipo_origen END
   WHERE id = p_id;

  -- Fase 2: los m³ del viaje despachado son los reales del camión
  IF v_m3 <> v_d.quantity_m3 THEN
    UPDATE viajes SET m3 = v_m3, actualizado_por = v_usuario, updated_at = now() WHERE dispatch_id = p_id;
  END IF;

  IF v_cambios <> '{}'::jsonb THEN
    INSERT INTO activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
    VALUES (v_usuario, 'editar', 'despacho', p_id::text, v_remito, v_plant,
            v_cambios
            || CASE WHEN v_motivo IS NOT NULL THEN jsonb_build_object('Motivo', v_motivo) ELSE '{}'::jsonb END
            || jsonb_build_object('Stock',
              CASE WHEN NOT v_recalc THEN 'sin cambios'
                   WHEN (v_res->>'sin_mover_por_recuento')::int > 0
                     THEN 'recalculado (' || (v_res->>'sin_mover_por_recuento') || ' materiales sin mover por recuento posterior)'
                   ELSE 'recalculado' END));
  END IF;

  RETURN jsonb_build_object('id', p_id, 'recalculado', v_recalc, 'cambios', v_cambios,
                            'sin_mover_por_recuento', coalesce((v_res->>'sin_mover_por_recuento')::int, 0));
END;
$function$;


-- ---------------------------------------------------------------------------
-- Permisos (los mismos de fase 3)
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.registrar_despacho(jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.editar_despacho(uuid, jsonb) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

RESET lock_timeout;
RESET statement_timeout;

-- ===========================================================================
-- PRUEBA ANTES DE APLICAR (spec 9, "Base"). Correrla DESPUÉS de aplicar esta migración dentro de una transacción que
-- termina en ROLLBACK (o con la migración entera en la misma transacción, cambiando su COMMIT por nada). Reemplazar
-- los :pedido, :planta, :formula, :camion por un pedido de prueba, la planta y la fórmula reales de Canning (con CPC 40).
-- Nada queda grabado.
--
-- BEGIN;
--   -- stock de antes
--   CREATE TEMP TABLE antes AS SELECT id, current_stock FROM materials WHERE plant_id = ':planta';
--   -- 1. 8 m³, volvió 1, 50 kg → m3_cargados 7; fórmula × 7 + fila es_replanteo de 50; dispatched_m3 +8
--   SELECT registrar_despacho(jsonb_build_object('scheduled_dispatch_id', ':pedido', 'plant_id', ':planta', 'mixer_id', ':camion',
--     'quantity_m3', 8, 'remito', '99999', 'remito_tipo', 'R', 'remito_tipo_origen', 'manual', 'usuario', 'prueba',
--     'retorno_m3', 1, 'cemento_extra_kg', 50)) AS r \gset
--   SELECT m.name, dm.quantity, dm.es_replanteo FROM dispatch_materials dm JOIN materials m ON m.id = dm.material_id
--    WHERE dm.dispatch_id = (:'r'::jsonb->>'id')::uuid ORDER BY dm.es_replanteo, m.name;
--   SELECT m.name, a.current_stock - m.current_stock AS bajo FROM materials m JOIN antes a USING (id) WHERE a.current_stock <> m.current_stock;
--   -- 2. m³ 9 → +1 m³ de fórmula; fibra × 9/8; cemento extra igual
--   SELECT editar_despacho((:'r'::jsonb->>'id')::uuid, '{"quantity_m3": 9, "usuario": "prueba", "motivo": "prueba"}');
--   -- 3. sacar el replanteo → fórmula × 9, sin fila es_replanteo
--   SELECT editar_despacho((:'r'::jsonb->>'id')::uuid, '{"retorno_m3": null, "cemento_extra_kg": null, "usuario": "prueba", "motivo": "prueba"}');
--   -- 4. anular → el stock vuelve al de antes de 1 (la consulta de diferencias no devuelve filas)
--   SELECT anular_despacho((:'r'::jsonb->>'id')::uuid, 'prueba', 'prueba');
--   SELECT m.name, a.current_stock - m.current_stock FROM materials m JOIN antes a USING (id) WHERE a.current_stock <> m.current_stock;
--   -- 5. sin las claves nuevas → dispatch_materials igual a hoy (sin fila es_replanteo, fórmula × 8)
--   -- 6. frenan: retorno 0,7 · retorno 9 con 8 · cemento sin retorno · despacho de prueba con retorno
--   --    (cada uno en su SAVEPOINT / ROLLBACK TO, porque el error aborta la transacción)
-- ROLLBACK;
