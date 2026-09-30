-- Fase 0b · Un solo motor de despacho
--
-- Registrar, editar y anular un despacho pasan a ser UNA transacción en la base
-- (todo o nada). Las pantallas (Despacho diario, despacho manual, Historial) solo
-- llaman a estas funciones.
--
--   registrar_despacho(p jsonb)                              -> jsonb
--   editar_despacho(p_id uuid, p jsonb)                      -> jsonb
--   anular_despacho(p_id uuid, p_usuario text, p_motivo text) -> jsonb
--   ajustar_material_despacho(p_dispatch_id, p_material, p_cantidad, p_usuario, p_nota) -> jsonb
--
-- Reglas:
--   * Los materiales se descuentan del stock de la PLANTA QUE DESPACHA. Una fórmula de la
--     otra planta está permitida: cada material se busca por tipo + nombre en la planta que
--     despacha ("CPC 40" de Canning -> "CPC 40" de Hudson). Si falta, frena con un mensaje.
--   * kg = kg/m³ × m³; si el material corrige_humedad (solo Arena Fina) × (1 + humedad/100).
--     dispatch_materials guarda seco, húmedo y humedad; quantity = húmedo (lo que baja el stock).
--   * descuenta_stock = false (Agua, Sikament 33S): queda en dispatch_materials y en
--     stock_movements como hoy, pero no mueve current_stock (ni al registrar, ni al editar,
--     ni al anular).
--   * Las probetas las sigue creando SOLO el trigger trigger_create_test_cylinders.
--   * Las fechas se calculan en hora de Argentina (SET timezone de cada función; también
--     vale para el trigger de probetas cuando corre dentro de registrar_despacho).
--
-- Compatible con el front actual: solo agrega funciones (requiere 202609291800_materiales_tipo).

-- ---------------------------------------------------------------------------
-- Material equivalente en otra planta (mismo tipo y mismo nombre)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._material_en_planta(p_material_id uuid, p_plant_id uuid, p_contexto text DEFAULT NULL)
RETURNS public.materials
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_src public.materials;
  v_dst public.materials;
  v_planta text;
BEGIN
  SELECT * INTO v_src FROM materials WHERE id = p_material_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El material elegido no existe (actualizá la pantalla)';
  END IF;
  IF v_src.plant_id = p_plant_id THEN
    RETURN v_src;
  END IF;
  SELECT * INTO v_dst FROM materials
   WHERE plant_id = p_plant_id
     AND lower(btrim(name)) = lower(btrim(v_src.name))
     AND tipo = v_src.tipo
   ORDER BY created_at
   LIMIT 1;
  IF NOT FOUND THEN
    SELECT name INTO v_planta FROM plants WHERE id = p_plant_id;
    RAISE EXCEPTION 'La planta % no tiene el material "%"%. Dalo de alta en Materias Primas con el mismo nombre o elegí otra fórmula.',
      coalesce(v_planta, '?'), v_src.name, coalesce(' (lo usa la fórmula ' || p_contexto || ')', '');
  END IF;
  RETURN v_dst;
END;
$$;

-- ---------------------------------------------------------------------------
-- Consumo de una fórmula para m³ en una planta (no escribe nada)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._consumo_formula(p_formula_id uuid, p_plant_id uuid, p_m3 numeric)
RETURNS TABLE (mat_id uuid, mat_nombre text, mat_tipo text, descuenta boolean,
               kg_m3 numeric, kg_seco numeric, humedad_pct numeric, kg_humedo numeric)
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_code text;
  r record;
  v_m public.materials;
BEGIN
  SELECT code INTO v_code FROM formulas WHERE id = p_formula_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La fórmula elegida no existe (actualizá la pantalla)';
  END IF;
  FOR r IN
    SELECT fm.material_id, fm.quantity
      FROM formula_materials fm JOIN materials s ON s.id = fm.material_id
     WHERE fm.formula_id = p_formula_id
     ORDER BY s.name, fm.id
  LOOP
    v_m := public._material_en_planta(r.material_id, p_plant_id, v_code);
    mat_id      := v_m.id;
    mat_nombre  := v_m.name;
    mat_tipo    := v_m.tipo;
    descuenta   := v_m.descuenta_stock;
    kg_m3       := r.quantity;
    kg_seco     := round(r.quantity * p_m3, 3);
    humedad_pct := CASE WHEN v_m.corrige_humedad THEN coalesce(v_m.stockpile_humidity, 0) ELSE 0 END;
    kg_humedo   := round(r.quantity * p_m3 * (1 + humedad_pct / 100), 3);
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- registrar_despacho
-- ---------------------------------------------------------------------------
-- Entrada (jsonb): plant_id, scheduled_dispatch_id?, formula_id, client_id?, construction_site_id?,
--   mixer_id?, quantity_m3, remito?, dispatch_date? (default ahora), extra_water_liters?,
--   sand_stockpile_humidity?, fiber_kg_per_m3?, sample_taken?, sample_number?, actual_slump_cm?,
--   is_test_dispatch? (despacho por árido), notes?, created_by?, usuario?,
--   mixer_en_ruta? (default: true si viene de un pedido),
--   materiales_manuales? [{material_id, quantity_kg}] (despacho por árido con ingreso manual:
--   NO crea despacho, registra una salida manual de materiales, como hoy).
-- Salida: { id, remito, m3, restante, completo, probetas, materiales } o { withdrawal_id, materiales }.
CREATE OR REPLACE FUNCTION public.registrar_despacho(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET timezone TO 'America/Argentina/Buenos_Aires'
AS $$
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
  v_m          public.materials;
  r            record;
BEGIN
  v_dia := (v_fecha AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;

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
        UPDATE materials SET current_stock = coalesce(current_stock, 0) - r.q, updated_at = now() WHERE id = v_m.id;
      END IF;
      INSERT INTO stock_movements (material_id, movement_type, quantity_kg, reference_type, reference_id, movement_date, notes)
      VALUES (v_m.id, 'consumo', r.q, 'manual_withdrawal', v_id, v_dia, 'Descarga manual: ' || v_notes);
      v_n := v_n + 1;
    END LOOP;
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

  -- Remito repetido (mismo criterio que antes: en todo el sistema). El lock evita que dos
  -- pantallas carguen el mismo número al mismo tiempo.
  IF v_remito IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('remito:' || v_remito));
    IF EXISTS (SELECT 1 FROM dispatches WHERE btrim(remito) = v_remito) THEN
      RAISE EXCEPTION 'Ya existe un despacho con el remito % en el sistema. No se puede cargar dos veces.', v_remito;
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
    notes, is_test_dispatch, created_by, scheduled_dispatch_id, plant_id
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
    v_notes, v_es_prueba, coalesce(v_created_by, v_usuario), v_pedido_id, v_plant_id
  )
  RETURNING id INTO v_id;

  -- 2. Materiales de la fórmula, en la planta que despacha
  FOR r IN SELECT * FROM public._consumo_formula(v_formula_id, v_plant_id, v_m3) LOOP
    INSERT INTO dispatch_materials (dispatch_id, material_id, quantity, dry_quantity, wet_quantity, humidity_at_dispatch)
    VALUES (v_id, r.mat_id, r.kg_humedo, r.kg_seco, r.kg_humedo, r.humedad_pct);
    IF r.descuenta THEN
      UPDATE materials SET current_stock = coalesce(current_stock, 0) - r.kg_humedo, updated_at = now() WHERE id = r.mat_id;
    END IF;
    INSERT INTO stock_movements (material_id, movement_type, quantity_kg, reference_type, reference_id, movement_date, notes)
    VALUES (r.mat_id, 'consumo', r.kg_humedo, 'dispatch', v_id, v_dia, 'Despacho remito ' || coalesce(v_remito, 'N/A'));
    v_n := v_n + 1;
  END LOOP;

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
      UPDATE materials SET current_stock = coalesce(current_stock, 0) - v_total, updated_at = now() WHERE id = v_m.id;
    END IF;
    INSERT INTO stock_movements (material_id, movement_type, quantity_kg, reference_type, reference_id, movement_date, notes)
    VALUES (v_m.id, 'consumo', v_total, 'dispatch', v_id, v_dia,
            'Fibra ' || v_fibra_m3 || ' kg/m³ × ' || v_m3 || ' m³ — remito ' || coalesce(v_remito, 'N/A'));
    v_n := v_n + 1;
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
            'Origen', CASE WHEN v_pedido_id IS NOT NULL THEN 'Pedido' WHEN v_es_prueba THEN 'Por árido' ELSE 'Manual' END));

  SELECT count(*) INTO v_probetas FROM test_cylinders WHERE dispatch_id = v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'remito', v_remito,
    'm3', v_m3,
    'restante', CASE WHEN v_pedido_id IS NOT NULL THEN greatest(0, v_pedido.quantity_m3 - v_nuevo) END,
    'completo', coalesce(v_estado = 'completed', false),
    'probetas', v_probetas,
    'materiales', v_n);
END;
$$;

-- ---------------------------------------------------------------------------
-- Estado del pedido después de cambiar lo despachado
-- (reabre un pedido completado si ya no llega al total, salvo que se haya cerrado a mano
--  con "Finalizar", que deja "Cerrado con ..." en las observaciones)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._ajustar_pedido(p_pedido_id uuid, p_delta_m3 numeric, p_usuario text, p_nota text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ant text;
  v_new text;
BEGIN
  IF p_pedido_id IS NULL OR p_delta_m3 = 0 THEN
    RETURN;
  END IF;
  SELECT status INTO v_ant FROM scheduled_dispatches WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  UPDATE scheduled_dispatches
     SET dispatched_m3 = greatest(0, coalesce(dispatched_m3, 0) + p_delta_m3),
         status = CASE
           WHEN greatest(0, coalesce(dispatched_m3, 0) + p_delta_m3) >= quantity_m3 - 0.01
                AND status NOT IN ('cancelled') THEN 'completed'
           WHEN status = 'completed'
                AND greatest(0, coalesce(dispatched_m3, 0) + p_delta_m3) < quantity_m3 - 0.01
                AND coalesce(observations, '') NOT LIKE '%Cerrado con%' THEN 'scheduled'
           ELSE status END,
         updated_at = now()
   WHERE id = p_pedido_id
   RETURNING status INTO v_new;
  INSERT INTO dispatch_status_log (scheduled_dispatch_id, previous_status, new_status, changed_by, notes)
  VALUES (p_pedido_id, v_ant, v_new, p_usuario, p_nota);
END;
$$;

-- ---------------------------------------------------------------------------
-- anular_despacho: devuelve el stock, descuenta el pedido, borra probetas sin resultados,
-- materiales y el despacho. Frena si alguna probeta ya tiene rotura cargada.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.anular_despacho(p_id uuid, p_usuario text DEFAULT NULL, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET timezone TO 'America/Argentina/Buenos_Aires'
AS $$
DECLARE
  v_usuario  text := coalesce(nullif(btrim(coalesce(p_usuario, '')), ''), 'Sistema');
  v_motivo   text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_d        public.dispatches;
  v_dia      date := now()::date;
  v_resumen  text;
  v_n        int := 0;
  v_prob     int;
  v_legacy   uuid[];
  v_cliente  text;
  v_obra     text;
  v_formula  text;
  r          record;
BEGIN
  SELECT * INTO v_d FROM dispatches WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El despacho no existe (puede que ya se haya borrado). Actualizá la pantalla.';
  END IF;

  IF EXISTS (SELECT 1 FROM test_cylinders
              WHERE dispatch_id = p_id
                AND (strength_mpa IS NOT NULL OR dial_reading IS NOT NULL OR actual_test_date IS NOT NULL)) THEN
    RAISE EXCEPTION 'No se puede borrar: la muestra % de este despacho ya tiene roturas cargadas en Calidad.',
      coalesce(v_d.sample_number, 's/n');
  END IF;

  -- Stock: se devuelve lo que se había descontado (solo materiales que descuentan stock)
  FOR r IN
    SELECT dm.material_id, dm.quantity, m.name, m.unit, m.descuenta_stock
      FROM dispatch_materials dm JOIN materials m ON m.id = dm.material_id
     WHERE dm.dispatch_id = p_id
     ORDER BY m.name
  LOOP
    IF r.descuenta_stock AND r.quantity <> 0 THEN
      UPDATE materials SET current_stock = coalesce(current_stock, 0) + r.quantity, updated_at = now() WHERE id = r.material_id;
      INSERT INTO stock_movements (material_id, movement_type, quantity_kg, reference_type, reference_id, movement_date, notes)
      VALUES (r.material_id, 'ajuste', r.quantity, 'anulacion', p_id, v_dia,
              'Anulación remito ' || coalesce(v_d.remito, 's/n') || coalesce(' · ' || v_motivo, '') || ' (' || v_usuario || ')');
    END IF;
    v_resumen := concat_ws(', ', v_resumen, r.name || ' ' || round(r.quantity, 1) || ' ' || r.unit);
    v_n := v_n + 1;
  END LOOP;

  -- Pedido (flujo actual: dispatches.scheduled_dispatch_id)
  PERFORM public._ajustar_pedido(v_d.scheduled_dispatch_id, -v_d.quantity_m3, v_usuario,
                                 'Anulación remito ' || coalesce(v_d.remito, 's/n'));

  -- Pedido del flujo viejo 1 pedido = 1 camión (scheduled_dispatches.dispatch_id): como antes se
  -- borra junto con el despacho, salvo que tenga otros camiones (entonces solo se desvincula).
  SELECT array_agg(id) INTO v_legacy FROM scheduled_dispatches WHERE dispatch_id = p_id;
  UPDATE scheduled_dispatches SET dispatch_id = NULL WHERE dispatch_id = p_id;

  SELECT name INTO v_cliente FROM clients WHERE id = v_d.client_id;
  SELECT name INTO v_obra FROM construction_sites WHERE id = v_d.construction_site_id;
  SELECT code INTO v_formula FROM formulas WHERE id = v_d.formula_id;
  SELECT count(*) INTO v_prob FROM test_cylinders WHERE dispatch_id = p_id;

  DELETE FROM test_cylinders WHERE dispatch_id = p_id;
  DELETE FROM dispatch_materials WHERE dispatch_id = p_id;
  DELETE FROM dispatches WHERE id = p_id;

  IF v_legacy IS NOT NULL THEN
    DELETE FROM dispatch_status_log
     WHERE scheduled_dispatch_id = ANY (v_legacy)
       AND NOT EXISTS (SELECT 1 FROM dispatches x WHERE x.scheduled_dispatch_id = dispatch_status_log.scheduled_dispatch_id);
    DELETE FROM scheduled_dispatches s
     WHERE s.id = ANY (v_legacy)
       AND NOT EXISTS (SELECT 1 FROM dispatches x WHERE x.scheduled_dispatch_id = s.id);
  END IF;

  INSERT INTO activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
  VALUES (v_usuario, 'borrar', 'despacho', p_id::text, v_d.remito, v_d.plant_id,
          jsonb_build_object(
            'Remito', coalesce(v_d.remito, '-'),
            'Cliente', coalesce(v_cliente, '-'),
            'Obra', coalesce(v_obra, '-'),
            'Formula', coalesce(v_formula, '-'),
            'm3', v_d.quantity_m3,
            'Fecha', to_char(v_d.dispatch_date, 'DD/MM/YYYY HH24:MI'),
            'Cargado por', coalesce(v_d.created_by, '-'),
            'Motivo', coalesce(v_motivo, '-'),
            'Probetas borradas', v_prob,
            'Materiales (stock devuelto)', coalesce(v_resumen, '-')));

  RETURN jsonb_build_object('id', p_id, 'remito', v_d.remito, 'm3', v_d.quantity_m3,
                            'pedido_id', v_d.scheduled_dispatch_id, 'materiales', v_n, 'probetas', v_prob);
END;
$$;

-- ---------------------------------------------------------------------------
-- editar_despacho
-- ---------------------------------------------------------------------------
-- p (jsonb, solo las claves que cambian): quantity_m3, formula_id, plant_id, dispatch_date, remito,
--   client_id, construction_site_id, mixer_id, extra_water_liters, notes, usuario.
-- * Cambian solo datos (remito, cliente, obra, camión, agua, observaciones, fecha): no toca stock.
-- * Cambian los m³ (misma fórmula y planta): cada material de la fórmula y la fibra se escalan
--   por m³ nuevo / m³ viejo (conserva la humedad y las exclusiones con que se cargó); el stock
--   se corrige por la diferencia y el pedido también.
-- * Cambia la fórmula o la planta: se recalculan los materiales como en registrar_despacho
--   (humedad actual del acopio), el stock se corrige por la diferencia por material.
-- * Lo agregado aparte (superfluidificante en obra) no se toca.
CREATE OR REPLACE FUNCTION public.editar_despacho(p_id uuid, p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET timezone TO 'America/Argentina/Buenos_Aires'
AS $$
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
  v_agua     numeric;
  v_notes    text;
  v_fecha    timestamptz;
  v_recalc   boolean;
  v_ratio    numeric;
  v_q        numeric;
  v_diff     numeric;
  v_fibra_m3 numeric;
  v_net      jsonb := '{}'::jsonb;
  v_cambios  jsonb := '{}'::jsonb;
  v_dia      date := now()::date;
  v_nota     text;
  v_m        public.materials;
  r          record;
  k          text;
  v          text;
BEGIN
  SELECT * INTO v_d FROM dispatches WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El despacho no existe (puede que se haya borrado). Actualizá la pantalla.';
  END IF;

  v_m3      := CASE WHEN p ? 'quantity_m3' THEN nullif(p->>'quantity_m3', '')::numeric ELSE v_d.quantity_m3 END;
  v_formula := coalesce(CASE WHEN p ? 'formula_id' THEN nullif(p->>'formula_id', '')::uuid END, v_d.formula_id);
  v_plant   := coalesce(CASE WHEN p ? 'plant_id' THEN nullif(p->>'plant_id', '')::uuid END, v_d.plant_id);
  v_remito  := CASE WHEN p ? 'remito' THEN nullif(btrim(coalesce(p->>'remito', '')), '') ELSE v_d.remito END;
  v_client  := CASE WHEN p ? 'client_id' THEN nullif(p->>'client_id', '')::uuid ELSE v_d.client_id END;
  v_site    := CASE WHEN p ? 'construction_site_id' THEN nullif(p->>'construction_site_id', '')::uuid ELSE v_d.construction_site_id END;
  v_mixer   := CASE WHEN p ? 'mixer_id' THEN nullif(p->>'mixer_id', '')::uuid ELSE v_d.mixer_id END;
  v_agua    := CASE WHEN p ? 'extra_water_liters' THEN nullif(p->>'extra_water_liters', '')::numeric ELSE v_d.extra_water_liters END;
  v_notes   := CASE WHEN p ? 'notes' THEN nullif(btrim(coalesce(p->>'notes', '')), '') ELSE v_d.notes END;
  v_fecha   := coalesce(CASE WHEN p ? 'dispatch_date' THEN nullif(p->>'dispatch_date', '')::timestamptz END, v_d.dispatch_date);

  IF v_m3 IS NULL OR v_m3 <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM formulas WHERE id = v_formula) THEN
    RAISE EXCEPTION 'La fórmula elegida no existe (actualizá la pantalla)';
  END IF;

  -- Remito: si cambia, no puede repetir otro
  v_old_rem := nullif(btrim(coalesce(v_d.remito, '')), '');
  IF v_remito IS DISTINCT FROM v_old_rem AND v_remito IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('remito:' || v_remito));
    IF EXISTS (SELECT 1 FROM dispatches WHERE btrim(remito) = v_remito AND id <> p_id) THEN
      RAISE EXCEPTION 'Ya existe un despacho con el remito % en el sistema. No se puede cargar dos veces.', v_remito;
    END IF;
  END IF;

  v_recalc := v_m3 <> v_d.quantity_m3 OR v_formula <> v_d.formula_id OR v_plant IS DISTINCT FROM v_d.plant_id;
  v_nota := 'Edición remito ' || coalesce(v_remito, 's/n') || ' (' || v_usuario || ')';

  IF v_recalc THEN
    IF v_formula = v_d.formula_id AND v_plant IS NOT DISTINCT FROM v_d.plant_id AND v_d.quantity_m3 > 0 THEN
      -- Solo cambian los m³: se escala cada material por m³ (fórmula + fibra)
      v_ratio := v_m3 / v_d.quantity_m3;
      FOR r IN
        SELECT dm.id, dm.material_id, dm.quantity, dm.dry_quantity, m.descuenta_stock
          FROM dispatch_materials dm JOIN materials m ON m.id = dm.material_id
         WHERE dm.dispatch_id = p_id
           AND (m.tipo = 'fibra' OR EXISTS (
                 SELECT 1 FROM formula_materials fm JOIN materials fmm ON fmm.id = fm.material_id
                  WHERE fm.formula_id = v_d.formula_id
                    AND lower(btrim(fmm.name)) = lower(btrim(m.name)) AND fmm.tipo = m.tipo))
      LOOP
        v_q := round(r.quantity * v_ratio, 3);
        v_diff := v_q - r.quantity;
        UPDATE dispatch_materials
           SET quantity = v_q,
               wet_quantity = v_q,
               dry_quantity = CASE WHEN r.dry_quantity IS NULL THEN NULL ELSE round(r.dry_quantity * v_ratio, 3) END
         WHERE id = r.id;
        IF v_diff <> 0 THEN
          IF r.descuenta_stock THEN
            UPDATE materials SET current_stock = coalesce(current_stock, 0) - v_diff, updated_at = now() WHERE id = r.material_id;
          END IF;
          INSERT INTO stock_movements (material_id, movement_type, quantity_kg, reference_type, reference_id, movement_date, notes)
          VALUES (r.material_id, 'consumo', v_diff, 'dispatch', p_id, v_dia, v_nota || ': ' || v_d.quantity_m3 || ' → ' || v_m3 || ' m3');
        END IF;
      END LOOP;
    ELSE
      -- Cambia la fórmula o la planta: se sacan los materiales por m³ y se recalculan
      v_calc_plant := coalesce(v_plant, (SELECT plant_id FROM formulas WHERE id = v_formula));
      SELECT coalesce(sum(dm.quantity), 0) / nullif(v_d.quantity_m3, 0) INTO v_fibra_m3
        FROM dispatch_materials dm JOIN materials m ON m.id = dm.material_id
       WHERE dm.dispatch_id = p_id AND m.tipo = 'fibra';
      FOR r IN
        SELECT dm.id, dm.material_id, dm.quantity, m.descuenta_stock
          FROM dispatch_materials dm JOIN materials m ON m.id = dm.material_id
         WHERE dm.dispatch_id = p_id
           AND (m.tipo = 'fibra' OR EXISTS (
                 SELECT 1 FROM formula_materials fm JOIN materials fmm ON fmm.id = fm.material_id
                  WHERE fm.formula_id = v_d.formula_id
                    AND lower(btrim(fmm.name)) = lower(btrim(m.name)) AND fmm.tipo = m.tipo))
      LOOP
        IF r.descuenta_stock THEN
          UPDATE materials SET current_stock = coalesce(current_stock, 0) + r.quantity, updated_at = now() WHERE id = r.material_id;
        END IF;
        v_net := jsonb_set(v_net, ARRAY[r.material_id::text],
                           to_jsonb(coalesce((v_net->>r.material_id::text)::numeric, 0) - r.quantity));
        DELETE FROM dispatch_materials WHERE id = r.id;
      END LOOP;
      FOR r IN SELECT * FROM public._consumo_formula(v_formula, v_calc_plant, v_m3) LOOP
        INSERT INTO dispatch_materials (dispatch_id, material_id, quantity, dry_quantity, wet_quantity, humidity_at_dispatch)
        VALUES (p_id, r.mat_id, r.kg_humedo, r.kg_seco, r.kg_humedo, r.humedad_pct);
        IF r.descuenta THEN
          UPDATE materials SET current_stock = coalesce(current_stock, 0) - r.kg_humedo, updated_at = now() WHERE id = r.mat_id;
        END IF;
        v_net := jsonb_set(v_net, ARRAY[r.mat_id::text],
                           to_jsonb(coalesce((v_net->>r.mat_id::text)::numeric, 0) + r.kg_humedo));
      END LOOP;
      IF coalesce(v_fibra_m3, 0) > 0 THEN
        SELECT * INTO v_m FROM materials WHERE plant_id = v_calc_plant AND tipo = 'fibra' ORDER BY name LIMIT 1;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'No se encontró el material Fibra en la planta del despacho';
        END IF;
        v_q := round(v_fibra_m3 * v_m3, 3);
        INSERT INTO dispatch_materials (dispatch_id, material_id, quantity, dry_quantity, wet_quantity, humidity_at_dispatch)
        VALUES (p_id, v_m.id, v_q, v_q, v_q, 0);
        IF v_m.descuenta_stock THEN
          UPDATE materials SET current_stock = coalesce(current_stock, 0) - v_q, updated_at = now() WHERE id = v_m.id;
        END IF;
        v_net := jsonb_set(v_net, ARRAY[v_m.id::text], to_jsonb(coalesce((v_net->>v_m.id::text)::numeric, 0) + v_q));
      END IF;
      FOR k, v IN SELECT key, value FROM jsonb_each_text(v_net) LOOP
        IF round(v::numeric, 3) <> 0 THEN
          INSERT INTO stock_movements (material_id, movement_type, quantity_kg, reference_type, reference_id, movement_date, notes)
          VALUES (k::uuid, 'consumo', round(v::numeric, 3), 'dispatch', p_id, v_dia, v_nota || ': recálculo por cambio de fórmula/planta');
        END IF;
      END LOOP;
    END IF;

    -- Pedido
    PERFORM public._ajustar_pedido(v_d.scheduled_dispatch_id, v_m3 - v_d.quantity_m3, v_usuario,
                                   v_nota || ': ' || v_d.quantity_m3 || ' → ' || v_m3 || ' m3');
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
  IF v_agua IS DISTINCT FROM v_d.extra_water_liters THEN
    v_cambios := v_cambios || jsonb_build_object('Agua extra (L)', coalesce(v_d.extra_water_liters::text, '-') || ' → ' || coalesce(v_agua::text, '-'));
  END IF;
  IF v_notes IS DISTINCT FROM v_d.notes THEN
    v_cambios := v_cambios || jsonb_build_object('Observaciones', coalesce(v_d.notes, '-') || ' → ' || coalesce(v_notes, '-'));
  END IF;
  IF v_fecha IS DISTINCT FROM v_d.dispatch_date THEN
    v_cambios := v_cambios || jsonb_build_object('Fecha', to_char(v_d.dispatch_date, 'DD/MM/YYYY HH24:MI') || ' → ' || to_char(v_fecha, 'DD/MM/YYYY HH24:MI'));
  END IF;

  UPDATE dispatches
     SET quantity_m3 = v_m3, formula_id = v_formula, plant_id = v_plant, remito = v_remito,
         client_id = v_client, construction_site_id = v_site, mixer_id = v_mixer,
         extra_water_liters = v_agua, notes = v_notes, dispatch_date = v_fecha
   WHERE id = p_id;

  IF v_cambios <> '{}'::jsonb THEN
    INSERT INTO activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
    VALUES (v_usuario, 'editar', 'despacho', p_id::text, v_remito, v_plant,
            v_cambios || jsonb_build_object('Stock', CASE WHEN v_recalc THEN 'recalculado' ELSE 'sin cambios' END));
  END IF;

  RETURN jsonb_build_object('id', p_id, 'recalculado', v_recalc, 'cambios', v_cambios);
END;
$$;

-- ---------------------------------------------------------------------------
-- ajustar_material_despacho: fibra o superfluidificante cargados desde el Historial.
-- Fija la cantidad total de ese material en el despacho y corrige el stock por la diferencia.
-- p_material: 'fibra' (material tipo fibra de la planta) o 'superfluidificante'
-- (aditivo de obra "Superfluidificante (obra)" de la planta).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ajustar_material_despacho(
  p_dispatch_id uuid, p_material text, p_cantidad numeric, p_usuario text DEFAULT NULL, p_nota text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET timezone TO 'America/Argentina/Buenos_Aires'
AS $$
DECLARE
  v_usuario text := coalesce(nullif(btrim(coalesce(p_usuario, '')), ''), 'Sistema');
  v_d       public.dispatches;
  v_m       public.materials;
  v_prev    numeric;
  v_new     numeric;
  v_diff    numeric;
BEGIN
  SELECT * INTO v_d FROM dispatches WHERE id = p_dispatch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El despacho no existe (puede que se haya borrado). Actualizá la pantalla.';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad < 0 THEN
    RAISE EXCEPTION 'Cantidad inválida';
  END IF;

  IF p_material = 'fibra' THEN
    SELECT * INTO v_m FROM materials WHERE plant_id = v_d.plant_id AND tipo = 'fibra' ORDER BY name LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No se encontró el material Fibra en esta planta';
    END IF;
  ELSIF p_material = 'superfluidificante' THEN
    SELECT * INTO v_m FROM materials
     WHERE plant_id = v_d.plant_id AND tipo = 'aditivo_obra' AND name ILIKE '%superfluidificante%'
     ORDER BY name LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No se encontró el material Superfluidificante (obra) para esta planta';
    END IF;
  ELSE
    RAISE EXCEPTION 'Material a ajustar desconocido: %', p_material;
  END IF;

  v_new := round(p_cantidad, 3);
  SELECT coalesce(sum(quantity), 0) INTO v_prev FROM dispatch_materials WHERE dispatch_id = p_dispatch_id AND material_id = v_m.id;
  v_diff := v_new - v_prev;

  DELETE FROM dispatch_materials WHERE dispatch_id = p_dispatch_id AND material_id = v_m.id;
  IF v_new > 0 THEN
    INSERT INTO dispatch_materials (dispatch_id, material_id, quantity, dry_quantity, wet_quantity, humidity_at_dispatch)
    VALUES (p_dispatch_id, v_m.id, v_new, v_new, v_new, 0);
  END IF;

  IF v_diff <> 0 THEN
    IF v_m.descuenta_stock THEN
      UPDATE materials SET current_stock = coalesce(current_stock, 0) - v_diff, updated_at = now() WHERE id = v_m.id;
    END IF;
    INSERT INTO stock_movements (material_id, movement_type, quantity_kg, reference_type, reference_id, movement_date, notes)
    VALUES (v_m.id, 'consumo', v_diff, 'dispatch', p_dispatch_id, now()::date,
            coalesce(nullif(btrim(coalesce(p_nota, '')), ''), v_m.name || ' — remito ' || coalesce(v_d.remito, 's/n')));
    INSERT INTO activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
    VALUES (v_usuario, 'editar', 'despacho', p_dispatch_id::text, v_d.remito, v_d.plant_id,
            jsonb_build_object('Material', v_m.name, 'Antes', v_prev, 'Ahora', v_new));
  END IF;

  RETURN jsonb_build_object('material_id', v_m.id, 'anterior', v_prev, 'nuevo', v_new, 'diferencia', v_diff);
END;
$$;

-- Permisos: como el resto de las funciones de hoy (RLS sigue apagado; la 0c agrega seguridad)
GRANT EXECUTE ON FUNCTION public.registrar_despacho(jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.editar_despacho(uuid, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anular_despacho(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ajustar_material_despacho(uuid, text, numeric, text, text) TO anon, authenticated;

-- Que la API (PostgREST) vea las funciones nuevas sin esperar
NOTIFY pgrst, 'reload schema';
