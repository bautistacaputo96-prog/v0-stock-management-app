-- Auditoría de despacho (23/11/2026) · editar_despacho — SIN APLICAR (la corre Bautista después de la revisión).
-- Va DESPUÉS de 202610201200_fase3_despacho.sql. Se puede correr dos veces (CREATE OR REPLACE, misma firma).
--
-- Base: la definición de editar_despacho de 202610201200_fase3_despacho.sql, con dos arreglos (marcados
-- "Auditoría 23/11/2026" en el código):
--
--   1. Probetas al cambiar el día. Si en el Historial se corrige la FECHA de un despacho con muestra, las probetas
--      quedaban programadas desde el día original (el trigger trigger_create_test_cylinders solo corre al insertar).
--      Ej.: despacho cargado el 20/11 que en realidad salió el 19/11 → la rotura de 7 días seguía el 27/11 en vez del
--      26/11. Ahora las probetas SIN rotura cargada (sin resistencia, lectura ni fecha real) se corren los mismos días
--      que se corrió el despacho (por diferencia: una fecha de rotura cambiada a mano en Calidad se respeta). Queda en
--      Actividad ("Probetas: 3 corridas 1 día para atrás") y en la respuesta ('probetas_corridas').
--
--   2. Superfluidificante al cambiar la PLANTA. El recálculo por cambio de fórmula/planta dejaba la fila de
--      superfluidificante (agregado en obra) apuntando al material de la planta VIEJA: el stock quedaba descontado en
--      la planta equivocada y, si después se corregía el superfluidificante desde el Historial,
--      ajustar_material_despacho (que lo busca en la planta del despacho) no veía la fila vieja y lo contaba dos veces.
--      Ahora, si cambia la planta, esos litros se devuelven a la planta vieja y se descuentan del superfluidificante
--      de la planta nueva (si la planta nueva no lo tiene, frena con un mensaje y no se graba nada). Si cambia solo la
--      fórmula, sigue igual que antes (el superfluidificante no se toca).
--
-- Nada más cambia: firma, parámetros y respuesta son los mismos (la respuesta suma 'probetas_corridas').
--
-- Qué pasa con los datos ya cargados: NO se toca ninguna fila al aplicar la migración. Solo cambia lo que pase en las
-- próximas ediciones. Para ver si hay probetas que quedaron corridas por ediciones viejas de fecha (solo lectura):
--
--   SELECT d.remito, d.dispatch_date, t.cylinder_number, t.test_age_days, t.scheduled_test_date
--     FROM test_cylinders t JOIN dispatches d ON d.id = t.dispatch_id
--    WHERE t.strength_mpa IS NULL AND t.dial_reading IS NULL AND t.actual_test_date IS NULL
--      AND t.scheduled_test_date <> (d.dispatch_date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + t.test_age_days;
--
--   (también salen las que se cambiaron a mano en Calidad: revisar antes de corregir nada).
-- Y despachos con superfluidificante de una planta distinta a la del despacho (solo lectura):
--
--   SELECT d.remito, d.plant_id, m.name, m.plant_id AS planta_material, dm.quantity
--     FROM dispatch_materials dm JOIN dispatches d ON d.id = dm.dispatch_id JOIN materials m ON m.id = dm.material_id
--    WHERE m.plant_id IS DISTINCT FROM d.plant_id;

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
  -- Auditoría 23/11/2026
  v_cambia_planta boolean;
  v_super    numeric := 0;
  v_dias     int;
  v_prob     int := 0;
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

  v_recalc := v_m3 <> v_d.quantity_m3 OR v_formula <> v_d.formula_id OR v_plant IS DISTINCT FROM v_d.plant_id;
  v_nota := 'Edición remito ' || coalesce(v_remito, 's/n') || coalesce(' · ' || v_motivo, '') || ' (' || v_usuario || ')';

  IF v_recalc THEN
    IF v_formula = v_d.formula_id AND v_plant IS NOT DISTINCT FROM v_d.plant_id AND v_d.quantity_m3 > 0 THEN
      -- Solo cambian los m³: se escalan fórmula y fibra; lo que ya no está en la fórmula se quita
      v_ratio := v_m3 / v_d.quantity_m3;
      v_nota := v_nota || ': ' || v_d.quantity_m3 || ' → ' || v_m3 || ' m3';
      FOR r IN
        SELECT dm.id, dm.material_id, dm.quantity, dm.dry_quantity,
               (m.tipo = 'fibra' OR EXISTS (
                  SELECT 1 FROM formula_materials fm JOIN materials fmm ON fmm.id = fm.material_id
                   WHERE fm.formula_id = v_d.formula_id
                     AND lower(btrim(fmm.name)) = lower(btrim(m.name)) AND fmm.tipo = m.tipo)) AS por_m3
          FROM dispatch_materials dm JOIN materials m ON m.id = dm.material_id
         WHERE dm.dispatch_id = p_id
           AND NOT (m.tipo = 'aditivo_obra' AND m.name ILIKE '%superfluidificante%')
         ORDER BY dm.material_id, dm.id
      LOOP
        IF r.por_m3 THEN
          v_q := round(r.quantity * v_ratio, 3);
          UPDATE dispatch_materials
             SET quantity = v_q,
                 wet_quantity = v_q,
                 dry_quantity = CASE WHEN r.dry_quantity IS NULL THEN NULL ELSE round(r.dry_quantity * v_ratio, 3) END
           WHERE id = r.id;
          v_neto := public._sumar_kg(v_neto, r.material_id, v_q - r.quantity);
        ELSE
          DELETE FROM dispatch_materials WHERE id = r.id;
          v_neto := public._sumar_kg(v_neto, r.material_id, -r.quantity);
        END IF;
      END LOOP;
    ELSE
      -- Cambia la fórmula o la planta: se sacan todas las filas (menos superfluidificante) y se recalculan.
      -- Auditoría 23/11/2026: si cambia la PLANTA, el superfluidificante también se saca y pasa al de la planta nueva
      -- (antes quedaba descontado del stock de la planta vieja y ajustar_material_despacho, que lo busca en la planta
      -- del despacho, después lo duplicaba).
      v_calc_plant := coalesce(v_plant, (SELECT plant_id FROM formulas WHERE id = v_formula));
      v_cambia_planta := v_calc_plant IS DISTINCT FROM v_d.plant_id;
      v_nota := v_nota || ': recálculo por cambio de fórmula/planta';
      SELECT coalesce(sum(dm.quantity), 0) / nullif(v_d.quantity_m3, 0) INTO v_fibra_m3
        FROM dispatch_materials dm JOIN materials m ON m.id = dm.material_id
       WHERE dm.dispatch_id = p_id AND m.tipo = 'fibra';
      FOR r IN
        SELECT dm.id, dm.material_id, dm.quantity,
               (m.tipo = 'aditivo_obra' AND m.name ILIKE '%superfluidificante%') AS es_super
          FROM dispatch_materials dm JOIN materials m ON m.id = dm.material_id
         WHERE dm.dispatch_id = p_id
           AND (v_cambia_planta OR NOT (m.tipo = 'aditivo_obra' AND m.name ILIKE '%superfluidificante%'))
         ORDER BY dm.material_id, dm.id
      LOOP
        DELETE FROM dispatch_materials WHERE id = r.id;
        v_neto := public._sumar_kg(v_neto, r.material_id, -r.quantity);
        IF r.es_super THEN
          v_super := v_super + coalesce(r.quantity, 0);
        END IF;
      END LOOP;
      FOR r IN SELECT * FROM public._consumo_formula(v_formula, v_calc_plant, v_m3) LOOP
        INSERT INTO dispatch_materials (dispatch_id, material_id, quantity, dry_quantity, wet_quantity, humidity_at_dispatch)
        VALUES (p_id, r.mat_id, r.kg_humedo, r.kg_seco, r.kg_humedo, r.humedad_pct);
        v_neto := public._sumar_kg(v_neto, r.mat_id, r.kg_humedo);
      END LOOP;
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
      -- Superfluidificante agregado en obra (litros por camión, no por m³): mismos litros en la planta nueva
      IF v_super > 0 THEN
        SELECT * INTO v_m FROM materials
         WHERE plant_id = v_calc_plant AND tipo = 'aditivo_obra' AND name ILIKE '%superfluidificante%'
         ORDER BY name LIMIT 1;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'No se encontró el material Superfluidificante (obra) en la planta nueva del despacho';
        END IF;
        v_q := round(v_super, 3);
        INSERT INTO dispatch_materials (dispatch_id, material_id, quantity, dry_quantity, wet_quantity, humidity_at_dispatch)
        VALUES (p_id, v_m.id, v_q, v_q, v_q, 0);
        v_neto := public._sumar_kg(v_neto, v_m.id, v_q);
      END IF;
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
  IF v_fecha IS DISTINCT FROM v_d.dispatch_date THEN
    v_cambios := v_cambios || jsonb_build_object('Fecha', to_char(v_d.dispatch_date, 'DD/MM/YYYY HH24:MI') || ' → ' || to_char(v_fecha, 'DD/MM/YYYY HH24:MI'));
  END IF;

  UPDATE dispatches
     SET quantity_m3 = v_m3, formula_id = v_formula, plant_id = v_plant, remito = v_remito,
         client_id = v_client, construction_site_id = v_site, mixer_id = v_mixer, chofer_id = v_chofer,
         extra_water_liters = v_agua, notes = v_notes, dispatch_date = v_fecha,
         remito_tipo = v_tipo,
         remito_tipo_origen = CASE WHEN v_tipo IS DISTINCT FROM v_d.remito_tipo
                                   THEN CASE WHEN v_tipo IS NULL THEN NULL ELSE 'manual' END
                                   ELSE v_d.remito_tipo_origen END
   WHERE id = p_id;

  -- Auditoría 23/11/2026: si cambia el DÍA del despacho, las probetas sin rotura cargada se corren los mismos días
  -- (el trigger las programó desde el día original; se corre por diferencia para respetar una fecha cambiada a mano)
  v_dias := (v_fecha AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
            - (v_d.dispatch_date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  IF coalesce(v_dias, 0) <> 0 THEN
    UPDATE test_cylinders
       SET scheduled_test_date = scheduled_test_date + v_dias, updated_at = now()
     WHERE dispatch_id = p_id
       AND strength_mpa IS NULL AND dial_reading IS NULL AND actual_test_date IS NULL;
    GET DIAGNOSTICS v_prob = ROW_COUNT;
    IF v_prob > 0 THEN
      v_cambios := v_cambios || jsonb_build_object('Probetas',
        v_prob || ' corridas ' || abs(v_dias) || CASE WHEN abs(v_dias) = 1 THEN ' día' ELSE ' días' END
        || CASE WHEN v_dias > 0 THEN ' para adelante' ELSE ' para atrás' END);
    END IF;
  END IF;

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
                            'sin_mover_por_recuento', coalesce((v_res->>'sin_mover_por_recuento')::int, 0),
                            'probetas_corridas', v_prob);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.editar_despacho(uuid, jsonb) TO anon, authenticated, service_role;
