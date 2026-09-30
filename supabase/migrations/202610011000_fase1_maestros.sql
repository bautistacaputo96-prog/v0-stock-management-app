-- Fase 1 · Maestros tipo Loop (choferes, bombas de terceros, finalidad del pedido, tiempos por planta)
--
-- Todo se agrega, nada se borra. Compatible con el front actual: columnas nuevas nulas o con
-- valor por defecto, tablas nuevas y el parámetro chofer_id OPCIONAL en el jsonb del motor de
-- despacho (una pantalla vieja que no lo manda despacha exactamente igual que antes).
-- Se puede aplicar antes de publicar el front. Se puede correr más de una vez.
--
--   choferes                    lista de personas (rotan: sin camión ni planta fijos). Baja lógica (activo).
--   empresas_bombeo             empresas de bombeo de terceros. Baja lógica (activo).
--   dispatches.chofer_id        quién manejó el camión (nulo en los despachos viejos).
--   scheduled_dispatches        finalidad; bomba_la_pone ('rebucret' | 'cliente'), bomba_empresa_id, bomba_hora.
--   plants                      tiempos del planificador (antes en el navegador de cada uno).
--   registrar_despacho / editar_despacho: aceptan chofer_id. Parten de la definición que estaba
--   en producción el 30/09/2026 (pg_get_functiondef); lo único que cambia es el chofer.
--
-- Permisos como el resto de las tablas (sin RLS; la seguridad la pone la fase 0c).

-- ---------------------------------------------------------------------------
-- Choferes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.choferes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     text NOT NULL CHECK (btrim(nombre) <> ''),
  telefono   text,
  dni        text,
  activo     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Empresas de bombeo (las bombas son de terceros)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.empresas_bombeo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        text NOT NULL CHECK (btrim(nombre) <> ''),
  contacto      text,
  telefono      text,
  observaciones text,
  activo        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON TABLE public.choferes, public.empresas_bombeo TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Despacho: chofer (sin ON DELETE: un chofer con despachos no se puede borrar, solo dar de baja)
-- ---------------------------------------------------------------------------
ALTER TABLE public.dispatches
  ADD COLUMN IF NOT EXISTS chofer_id uuid REFERENCES public.choferes(id);
CREATE INDEX IF NOT EXISTS dispatches_chofer_id_idx ON public.dispatches (chofer_id);

-- ---------------------------------------------------------------------------
-- Pedido: finalidad y bomba
-- La lista de finalidades vive en el front (lib/maestros.ts) para poder ajustarla sin migración:
-- Platea / Fundación, Pilotes, Columnas, Vigas, Losa, Tabiques, Contrapiso, Pavimento / Carpeta, Otro.
-- ---------------------------------------------------------------------------
ALTER TABLE public.scheduled_dispatches
  ADD COLUMN IF NOT EXISTS finalidad text,
  ADD COLUMN IF NOT EXISTS bomba_la_pone text CHECK (bomba_la_pone IS NULL OR bomba_la_pone IN ('rebucret', 'cliente')),
  ADD COLUMN IF NOT EXISTS bomba_empresa_id uuid REFERENCES public.empresas_bombeo(id),
  ADD COLUMN IF NOT EXISTS bomba_hora timestamptz;

-- ---------------------------------------------------------------------------
-- Planta: tiempos del planificador (vista Día). Defaults = valores de referencia.
-- Descargas: minutos por camión de 8 m³. Tolerancia de puntualidad: 15 (estándar Loop).
-- ---------------------------------------------------------------------------
ALTER TABLE public.plants
  ADD COLUMN IF NOT EXISTS t_carga_min integer NOT NULL DEFAULT 10 CHECK (t_carga_min > 0),
  ADD COLUMN IF NOT EXISTS t_descarga_bomba_min integer NOT NULL DEFAULT 15 CHECK (t_descarga_bomba_min > 0),
  ADD COLUMN IF NOT EXISTS t_descarga_directa_min integer NOT NULL DEFAULT 25 CHECK (t_descarga_directa_min > 0),
  ADD COLUMN IF NOT EXISTS t_lavado_min integer NOT NULL DEFAULT 10 CHECK (t_lavado_min > 0),
  ADD COLUMN IF NOT EXISTS jornada_inicio time NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS jornada_fin time NOT NULL DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS tolerancia_puntualidad_min integer NOT NULL DEFAULT 15 CHECK (tolerancia_puntualidad_min >= 0),
  ADD COLUMN IF NOT EXISTS bocas_carga integer NOT NULL DEFAULT 1 CHECK (bocas_carga > 0);

-- ---------------------------------------------------------------------------
-- Motor de despacho con chofer_id (definiciones de producción + chofer)
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
  IF v_chofer_id IS NOT NULL THEN
    SELECT nombre INTO v_chofer_nombre FROM choferes WHERE id = v_chofer_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El chofer elegido no existe (actualizá la pantalla)';
    END IF;
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
    notes, is_test_dispatch, created_by, scheduled_dispatch_id, plant_id, chofer_id
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
    v_notes, v_es_prueba, coalesce(v_created_by, v_usuario), v_pedido_id, v_plant_id, v_chofer_id
  )
  RETURNING id INTO v_id;

  -- 2. Materiales de la fórmula, en la planta que despacha
  FOR r IN SELECT * FROM public._consumo_formula(v_formula_id, v_plant_id, v_m3) LOOP
    INSERT INTO dispatch_materials (dispatch_id, material_id, quantity, dry_quantity, wet_quantity, humidity_at_dispatch)
    VALUES (v_id, r.mat_id, r.kg_humedo, r.kg_seco, r.kg_humedo, r.humedad_pct);
    IF r.descuenta THEN
      v_mover := public._sumar_kg(v_mover, r.mat_id, r.kg_humedo);
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
      v_mover := public._sumar_kg(v_mover, v_m.id, v_total);
    END IF;
    INSERT INTO stock_movements (material_id, movement_type, quantity_kg, reference_type, reference_id, movement_date, notes)
    VALUES (v_m.id, 'consumo', v_total, 'dispatch', v_id, v_dia,
            'Fibra ' || v_fibra_m3 || ' kg/m³ × ' || v_m3 || ' m³ — remito ' || coalesce(v_remito, 'N/A'));
    v_n := v_n + 1;
  END IF;

  -- Stock: todos los materiales juntos, en orden de id
  PERFORM public._mover_stock(v_mover);

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
          || CASE WHEN v_chofer_nombre IS NOT NULL THEN jsonb_build_object('Chofer', v_chofer_nombre) ELSE '{}'::jsonb END);

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
$function$;

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
  r          record;
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
      -- Cambia la fórmula o la planta: se sacan todas las filas (menos superfluidificante) y se recalculan
      v_calc_plant := coalesce(v_plant, (SELECT plant_id FROM formulas WHERE id = v_formula));
      v_nota := v_nota || ': recálculo por cambio de fórmula/planta';
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
         extra_water_liters = v_agua, notes = v_notes, dispatch_date = v_fecha
   WHERE id = p_id;

  IF v_cambios <> '{}'::jsonb THEN
    INSERT INTO activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
    VALUES (v_usuario, 'editar', 'despacho', p_id::text, v_remito, v_plant,
            v_cambios || jsonb_build_object('Stock',
              CASE WHEN NOT v_recalc THEN 'sin cambios'
                   WHEN (v_res->>'sin_mover_por_recuento')::int > 0
                     THEN 'recalculado (' || (v_res->>'sin_mover_por_recuento') || ' materiales sin mover por recuento posterior)'
                   ELSE 'recalculado' END));
  END IF;

  RETURN jsonb_build_object('id', p_id, 'recalculado', v_recalc, 'cambios', v_cambios,
                            'sin_mover_por_recuento', coalesce((v_res->>'sin_mover_por_recuento')::int, 0));
END;
$function$;

-- Permisos: los mismos que en la 0b (CREATE OR REPLACE ya los conserva; se repiten por claridad)
GRANT EXECUTE ON FUNCTION public.registrar_despacho(jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.editar_despacho(uuid, jsonb) TO anon, authenticated;
