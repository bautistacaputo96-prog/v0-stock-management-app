-- Fase 2 · Programación que genera los viajes
--
-- Todo se agrega, nada se borra. Compatible con el front actual (main): columnas nuevas nulas o con
-- valor por defecto, tabla nueva y el parámetro viaje_id OPCIONAL en el jsonb de registrar_despacho.
-- Un pedido sin viajes (todos los de hoy) se despacha y se anula exactamente igual que antes.
-- Se puede aplicar antes de publicar el front. Se puede correr más de una vez.
--
--   app_users.ve_funciones_nuevas   interruptor "modo prueba por usuario" (ver docs/migracion-loop/entorno-prueba.md).
--   viajes                          un camión de un pedido (como los tickets de Loop): m³ y horarios planificados,
--                                   camión sugerido, estado planificado / despachado / cancelado. NO toca stock.
--   scheduled_dispatches            confirmado_at / confirmado_por (👍 del día anterior), espaciado_min,
--                                   m3_por_viaje (por defecto 8).
--   guardar_viajes_pedido           reemplaza en una sola transacción los viajes PLANIFICADOS de un pedido
--                                   (los despachados no se tocan). Lo usa el front al guardar un pedido,
--                                   el plan del día y el gerenciador.
--   registrar_despacho              además marca como despachado el viaje elegido (viaje_id) o el primer
--                                   viaje pendiente del pedido, con dispatch_id.
--   anular_despacho                 además vuelve ese viaje a planificado.
--   Las dos parten de la definición de producción del 01/10/2026 (pg_get_functiondef, = fase 1); lo único
--   que cambia es lo de los viajes. editar_despacho no cambia.
--
-- Permisos como el resto de las tablas (sin RLS; la seguridad la pone la fase 0c).

-- ---------------------------------------------------------------------------
-- Interruptor de funciones nuevas (por usuario)
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS ve_funciones_nuevas boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Pedido: confirmación del día anterior, espaciado y m³ por viaje
-- ---------------------------------------------------------------------------
ALTER TABLE public.scheduled_dispatches
  ADD COLUMN IF NOT EXISTS confirmado_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmado_por text,
  ADD COLUMN IF NOT EXISTS espaciado_min integer CHECK (espaciado_min IS NULL OR espaciado_min > 0),
  ADD COLUMN IF NOT EXISTS m3_por_viaje numeric NOT NULL DEFAULT 8 CHECK (m3_por_viaje > 0);

-- ---------------------------------------------------------------------------
-- Viajes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.viajes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id         uuid NOT NULL REFERENCES public.scheduled_dispatches(id) ON DELETE CASCADE,
  plant_id          uuid REFERENCES public.plants(id),
  n                 integer NOT NULL CHECK (n > 0),
  m3                numeric NOT NULL CHECK (m3 > 0),
  hora_carga        timestamptz NOT NULL,
  hora_salida       timestamptz NOT NULL,
  hora_llegada      timestamptz NOT NULL,
  hora_fin_descarga timestamptz NOT NULL,
  hora_vuelta       timestamptz NOT NULL,
  mixer_id          uuid REFERENCES public.mixers(id) ON DELETE SET NULL,
  estado            text NOT NULL DEFAULT 'planificado' CHECK (estado IN ('planificado', 'despachado', 'cancelado')),
  -- Se completa al despachar. SET NULL solo por seguridad: anular_despacho ya lo libera antes de borrar.
  dispatch_id       uuid REFERENCES public.dispatches(id) ON DELETE SET NULL,
  actualizado_por   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT viajes_pedido_n_key UNIQUE (pedido_id, n)
);
CREATE INDEX IF NOT EXISTS viajes_dispatch_id_idx ON public.viajes (dispatch_id);
CREATE INDEX IF NOT EXISTS viajes_plant_carga_idx ON public.viajes (plant_id, hora_carga);
CREATE INDEX IF NOT EXISTS viajes_mixer_id_idx ON public.viajes (mixer_id);

GRANT ALL ON TABLE public.viajes TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Guardar los viajes planificados de un pedido (todo o nada)
-- p_viajes: [{ n, m3, hora_carga, hora_salida, hora_llegada, hora_fin_descarga, hora_vuelta, mixer_id }]
-- Borra los viajes 'planificado' del pedido y graba los que vienen. Los 'despachado'/'cancelado' quedan
-- como están; si un n de la lista choca con uno de ellos, error y no se graba nada.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guardar_viajes_pedido(p_pedido_id uuid, p_viajes jsonb, p_usuario text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_usuario  text := coalesce(nullif(btrim(coalesce(p_usuario, '')), ''), 'Sistema');
  v_pedido   public.scheduled_dispatches;
  v_borrados int;
  v_n        int := 0;
  v_num      int;
  v_m3       numeric;
  v_carga    timestamptz;
  v_salida   timestamptz;
  v_llegada  timestamptz;
  v_fin      timestamptz;
  v_vuelta   timestamptz;
  e          jsonb;
BEGIN
  -- Mismo orden de bloqueo que el despacho: primero el pedido
  SELECT * INTO v_pedido FROM scheduled_dispatches WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido no existe (puede haber sido borrado). Actualizá la pantalla.';
  END IF;
  IF p_viajes IS NULL OR jsonb_typeof(p_viajes) <> 'array' THEN
    RAISE EXCEPTION 'Los viajes tienen que venir como una lista';
  END IF;

  DELETE FROM viajes WHERE pedido_id = p_pedido_id AND estado = 'planificado';
  GET DIAGNOSTICS v_borrados = ROW_COUNT;

  FOR e IN SELECT * FROM jsonb_array_elements(p_viajes) LOOP
    v_num     := nullif(e->>'n', '')::int;
    v_m3      := nullif(e->>'m3', '')::numeric;
    v_carga   := nullif(e->>'hora_carga', '')::timestamptz;
    v_salida  := nullif(e->>'hora_salida', '')::timestamptz;
    v_llegada := nullif(e->>'hora_llegada', '')::timestamptz;
    v_fin     := nullif(e->>'hora_fin_descarga', '')::timestamptz;
    v_vuelta  := nullif(e->>'hora_vuelta', '')::timestamptz;
    IF v_num IS NULL OR v_num <= 0 THEN
      RAISE EXCEPTION 'Cada viaje necesita su número (1, 2, 3...)';
    END IF;
    IF v_m3 IS NULL OR v_m3 <= 0 THEN
      RAISE EXCEPTION 'Los m³ del viaje % tienen que ser mayores a 0', v_num;
    END IF;
    IF v_carga IS NULL OR v_salida IS NULL OR v_llegada IS NULL OR v_fin IS NULL OR v_vuelta IS NULL THEN
      RAISE EXCEPTION 'Faltan horarios en el viaje %', v_num;
    END IF;
    IF NOT (v_carga <= v_salida AND v_salida <= v_llegada AND v_llegada <= v_fin AND v_fin <= v_vuelta) THEN
      RAISE EXCEPTION 'Los horarios del viaje % no están en orden (carga, salida, llegada, fin de descarga, vuelta)', v_num;
    END IF;
    IF EXISTS (SELECT 1 FROM viajes WHERE pedido_id = p_pedido_id AND n = v_num) THEN
      RAISE EXCEPTION 'El viaje % ya está despachado o repetido: no se puede volver a planificar. Actualizá la pantalla.', v_num;
    END IF;
    INSERT INTO viajes (pedido_id, plant_id, n, m3, hora_carga, hora_salida, hora_llegada, hora_fin_descarga,
                        hora_vuelta, mixer_id, estado, actualizado_por)
    VALUES (p_pedido_id, v_pedido.plant_id, v_num, v_m3, v_carga, v_salida, v_llegada, v_fin,
            v_vuelta, nullif(e->>'mixer_id', '')::uuid, 'planificado', v_usuario);
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('pedido_id', p_pedido_id, 'borrados', v_borrados, 'guardados', v_n);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.guardar_viajes_pedido(uuid, jsonb, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Motor de despacho: registrar_despacho marca el viaje (definición de producción + viajes)
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

    -- Fase 2: el viaje elegido o, si no se eligió, el primer viaje pendiente del pedido queda despachado.
    -- Si el pedido no tiene viajes no pasa nada (igual que antes).
    UPDATE viajes
       SET estado = 'despachado', dispatch_id = v_id, actualizado_por = v_usuario, updated_at = now()
     WHERE id = coalesce(v_viaje_pedido,
                         (SELECT id FROM viajes
                           WHERE pedido_id = v_pedido_id AND estado = 'planificado'
                           ORDER BY n LIMIT 1))
       AND estado = 'planificado'
     RETURNING id, n INTO v_viaje_id, v_viaje_n;
    IF v_viaje_id IS NOT NULL THEN
      SELECT count(*) INTO v_viaje_tot FROM viajes WHERE pedido_id = v_pedido_id AND estado <> 'cancelado';
    END IF;
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
          || CASE WHEN v_viaje_id IS NOT NULL THEN jsonb_build_object('Viaje', v_viaje_n || '/' || v_viaje_tot) ELSE '{}'::jsonb END);

  SELECT count(*) INTO v_probetas FROM test_cylinders WHERE dispatch_id = v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'remito', v_remito,
    'm3', v_m3,
    'restante', CASE WHEN v_pedido_id IS NOT NULL THEN greatest(0, v_pedido.quantity_m3 - v_nuevo) END,
    'completo', coalesce(v_estado = 'completed', false),
    'probetas', v_probetas,
    'materiales', v_n)
    || CASE WHEN v_viaje_id IS NOT NULL THEN jsonb_build_object('viaje_id', v_viaje_id, 'viaje_n', v_viaje_n) ELSE '{}'::jsonb END;
END;
$function$;

-- ---------------------------------------------------------------------------
-- anular_despacho libera el viaje (definición de producción + viajes)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.anular_despacho(p_id uuid, p_usuario text DEFAULT NULL::text, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_usuario  text := coalesce(nullif(btrim(coalesce(p_usuario, '')), ''), 'Sistema');
  v_motivo   text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_d        public.dispatches;
  v_resumen  text;
  v_neto     jsonb := '{}'::jsonb;
  v_res      jsonb;
  v_n        int := 0;
  v_prob     int;
  v_legacy   uuid[];
  v_cliente  text;
  v_obra     text;
  v_formula  text;
  r          record;
  v_viaje_n  int;  -- fase 2
BEGIN
  -- Orden de bloqueos: despacho -> pedido -> materiales
  SELECT * INTO v_d FROM dispatches WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El despacho no existe (puede que ya se haya borrado). Actualizá la pantalla.';
  END IF;
  IF v_d.scheduled_dispatch_id IS NOT NULL THEN
    PERFORM 1 FROM scheduled_dispatches WHERE id = v_d.scheduled_dispatch_id FOR UPDATE;
  END IF;

  IF EXISTS (SELECT 1 FROM test_cylinders
              WHERE dispatch_id = p_id
                AND (strength_mpa IS NOT NULL OR dial_reading IS NOT NULL OR actual_test_date IS NOT NULL)) THEN
    RAISE EXCEPTION 'No se puede borrar: la muestra % de este despacho ya tiene roturas cargadas en Calidad.',
      coalesce(v_d.sample_number, 's/n');
  END IF;

  -- Stock: se devuelve lo consumido como 'consumo' negativo (salvo ancla de stock posterior)
  FOR r IN
    SELECT dm.material_id, dm.quantity, m.name, m.unit
      FROM dispatch_materials dm JOIN materials m ON m.id = dm.material_id
     WHERE dm.dispatch_id = p_id
     ORDER BY m.name
  LOOP
    v_neto := public._sumar_kg(v_neto, r.material_id, -r.quantity);
    v_resumen := concat_ws(', ', v_resumen, r.name || ' ' || round(r.quantity, 1) || ' ' || r.unit);
    v_n := v_n + 1;
  END LOOP;
  v_res := public._aplicar_neto(p_id, v_d.created_at, v_neto,
             'Anulación remito ' || coalesce(v_d.remito, 's/n') || coalesce(' · ' || v_motivo, '') || ' (' || v_usuario || ')');

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

  -- Fase 2: el viaje que había salido con este despacho vuelve a quedar pendiente
  UPDATE viajes
     SET estado = 'planificado', dispatch_id = NULL, actualizado_por = v_usuario, updated_at = now()
   WHERE dispatch_id = p_id
  RETURNING n INTO v_viaje_n;

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
            'Materiales', coalesce(v_resumen, '-'),
            'Stock devuelto', (v_res->>'movidos') || ' materiales',
            'Sin devolver (recuento posterior)', (v_res->>'sin_mover_por_recuento') || ' materiales')
          || CASE WHEN v_viaje_n IS NOT NULL THEN jsonb_build_object('Viaje liberado', v_viaje_n) ELSE '{}'::jsonb END);

  RETURN jsonb_build_object('id', p_id, 'remito', v_d.remito, 'm3', v_d.quantity_m3,
                            'pedido_id', v_d.scheduled_dispatch_id, 'materiales', v_n, 'probetas', v_prob,
                            'stock_devuelto', (v_res->>'movidos')::int,
                            'sin_devolver_por_recuento', (v_res->>'sin_mover_por_recuento')::int);
END;
$function$;

-- Permisos: los mismos que en la 0b (CREATE OR REPLACE ya los conserva; se repiten por claridad)
GRANT EXECUTE ON FUNCTION public.registrar_despacho(jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anular_despacho(uuid, text, text) TO anon, authenticated;
