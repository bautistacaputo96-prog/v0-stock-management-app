-- Esquema de la base de Rebucret (esquema public): solo estructura, sin datos.
-- Generado el 30/09/2026 desde PRODUCCIÓN con scripts/volcar-esquema.mjs (consultas de solo lectura al
-- catálogo; PostgreSQL 17.6).
--
-- Refleja la base después de la fase 0b: ya incluye lo que hacen 202609291800_materiales_tipo.sql y
-- 202609291810_motor_despacho.sql. Es una FOTO, no una migración más: las migraciones con fecha
-- posterior a 202609291810 se aplican encima. Ver supabase/migrations/README.md.
--
-- Contenido: 36 tablas, 388 columnas, 1 secuencia(s), 19 funciones,
-- 5 triggers, 91 índices (49 de PK/UNIQUE + 42 sueltos), 59 claves foráneas,
-- 6 checks, 0 políticas RLS.
--
-- Para reconstruir: correr este archivo como el rol postgres (SQL editor de Supabase o psql) en un
-- proyecto Supabase nuevo. Los esquemas que administra Supabase (auth, storage, realtime, vault,
-- extensions, graphql) no se vuelcan. Todo pertenece al rol postgres; las funciones SECURITY DEFINER
-- corren como su dueño.

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
-- Como pg_dump: no validar cuerpos de funciones (hay funciones SQL que nombran tablas creadas más abajo).
SET check_function_bodies = false;
SET client_min_messages = warning;

-- ============================================================================
-- Extensiones
-- ============================================================================

-- CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;  -- (la instala Supabase; versión 1.11)
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
-- CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;  -- (la instala Supabase; versión 0.3.1)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- ============================================================================
-- Secuencias
-- ============================================================================

CREATE SEQUENCE public.maint_work_orders_numero_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1 NO CYCLE;

-- ============================================================================
-- Tablas
-- ============================================================================

CREATE TABLE public.activity_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_name text NOT NULL,
    action text NOT NULL,
    entity text NOT NULL,
    entity_id text,
    reference text,
    plant_id uuid,
    details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.app_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    role text DEFAULT 'operario'::text NOT NULL,
    email text
);

CREATE TABLE public.carriers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(200) NOT NULL,
    driver_name character varying(200),
    phone character varying(50),
    supplier_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(200) NOT NULL,
    contact character varying(200),
    phone character varying(50),
    email character varying(100),
    plant_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    cuit character varying(20),
    active boolean DEFAULT true,
    razon_social text,
    cond_iva text DEFAULT 'Responsable Inscripto'::text,
    direccion_fiscal text,
    cp text,
    localidad_cliente text,
    provincia text DEFAULT 'Buenos Aires'::text,
    cond_pago text DEFAULT 'Contado'::text
);

CREATE TABLE public.construction_sites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(200) NOT NULL,
    address text,
    client_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    gps_lat numeric(10,8),
    gps_lng numeric(11,8),
    travel_time_minutes integer DEFAULT 30,
    unload_time_minutes integer DEFAULT 20,
    requires_pump boolean DEFAULT false,
    reception_hours_start time without time zone DEFAULT '07:00:00'::time without time zone,
    reception_hours_end time without time zone DEFAULT '18:00:00'::time without time zone,
    site_contact character varying(255),
    site_phone character varying(50),
    observations text,
    status character varying(20) DEFAULT 'active'::character varying,
    localidad text,
    gps_source text,
    travel_distance_km numeric(8,2),
    gps_updated_at timestamp with time zone
);

CREATE TABLE public.daily_stockpile_humidity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plant_id uuid NOT NULL,
    material_id uuid NOT NULL,
    reading_date date DEFAULT CURRENT_DATE NOT NULL,
    humidity_percent numeric(5,2) NOT NULL,
    wet_weight_grams numeric(10,2),
    dry_weight_grams numeric(10,2),
    recorded_by character varying(255),
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.dispatch_materials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    dispatch_id uuid NOT NULL,
    material_id uuid NOT NULL,
    quantity numeric(10,3) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    dry_quantity numeric(12,3),
    wet_quantity numeric(12,3),
    humidity_at_dispatch numeric(5,2)
);

CREATE TABLE public.dispatch_status_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scheduled_dispatch_id uuid NOT NULL,
    previous_status character varying(20),
    new_status character varying(20) NOT NULL,
    changed_at timestamp with time zone DEFAULT now(),
    changed_by character varying(255),
    notes text
);

CREATE TABLE public.dispatches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    formula_id uuid NOT NULL,
    quantity_m3 numeric(10,3) NOT NULL,
    client character varying(200),
    obra character varying(200),
    remito character varying(100),
    notes text,
    dispatch_date timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    client_id uuid,
    construction_site_id uuid,
    extra_water_liters numeric(10,2),
    sample_taken boolean DEFAULT false,
    sample_number character varying(100),
    actual_slump_cm numeric(5,2),
    sand_stockpile_humidity numeric(5,2),
    mixer_id uuid,
    is_test_dispatch boolean DEFAULT false,
    created_by character varying,
    scheduled_dispatch_id uuid,
    plant_id uuid
);

CREATE TABLE public.formula_materials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    formula_id uuid NOT NULL,
    material_id uuid NOT NULL,
    quantity numeric(10,3) NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.formulas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(200) NOT NULL,
    description text,
    yield_m3 numeric(10,3) DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    plant_id uuid,
    useful_life_minutes integer DEFAULT 90,
    updated_by character varying(255)
);

CREATE TABLE public.granulometria_sieve_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    test_id uuid,
    sieve_size character varying(50) NOT NULL,
    retained_grams numeric(10,2) NOT NULL,
    retained_cumulative_grams numeric(10,2) NOT NULL,
    percent_passing numeric(5,2) NOT NULL,
    percent_retained numeric(5,2) NOT NULL,
    percent_retained_cumulative numeric(5,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.granulometria_tests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    extraction_date date NOT NULL,
    provider character varying(255) NOT NULL,
    aggregate_type character varying(255) NOT NULL,
    sample_weight_grams numeric(10,2) NOT NULL,
    remito character varying(100),
    dry_weight_grams numeric(10,2),
    moisture_percent numeric(5,2),
    fineness_modulus numeric(5,2),
    plant_id uuid,
    comments text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    stock_entry_id uuid,
    material_id uuid,
    supplier_id uuid,
    test_date date
);

CREATE TABLE public.humidity_excess_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    stock_entry_id uuid NOT NULL,
    entry_date date NOT NULL,
    material_id uuid NOT NULL,
    supplier_id uuid NOT NULL,
    remito character varying(100),
    original_quantity_kg numeric(10,2) NOT NULL,
    humidity_percentage numeric(5,2) NOT NULL,
    tolerance_percentage numeric(5,2) DEFAULT 3.0,
    excess_humidity_percentage numeric(5,2) NOT NULL,
    excess_quantity_kg numeric(10,2) NOT NULL,
    excess_quantity_tn numeric(10,4) NOT NULL,
    plant_id uuid,
    credited boolean DEFAULT false,
    credit_note_number character varying(100),
    credited_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.integraciones (
    clave text NOT NULL,
    valor text NOT NULL,
    usuario text,
    conectado_por text,
    actualizado timestamp with time zone DEFAULT now()
);

CREATE TABLE public.maint_equipment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plant_id uuid,
    nombre text NOT NULL,
    modelo text,
    fabricante text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.maint_executions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid,
    fecha date DEFAULT CURRENT_DATE NOT NULL,
    realizado_por text,
    observaciones text,
    m3_acumulado numeric(12,2),
    created_at timestamp with time zone DEFAULT now(),
    pasos jsonb
);

CREATE TABLE public.maint_task_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid,
    url text NOT NULL,
    epigrafe text,
    orden integer DEFAULT 0
);

CREATE TABLE public.maint_task_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid,
    item text NOT NULL,
    cantidad numeric(10,2),
    unidad text,
    tipo text DEFAULT 'insumo'::text NOT NULL,
    codigo_repuesto text
);

CREATE TABLE public.maint_task_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid,
    texto text NOT NULL,
    orden integer DEFAULT 0
);

CREATE TABLE public.maint_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    equipment_id uuid,
    codigo text,
    titulo text NOT NULL,
    detalle text,
    componente text,
    frecuencia_dias integer,
    frecuencia_m3 integer,
    referencia_manual text,
    activo boolean DEFAULT true NOT NULL,
    orden integer DEFAULT 0,
    asignado_default text,
    duracion_min integer
);

CREATE TABLE public.maint_work_order_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    work_order_id uuid,
    url text NOT NULL,
    comentario text,
    subida_por text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.maint_work_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    numero integer DEFAULT nextval('public.maint_work_orders_numero_seq'::regclass) NOT NULL,
    equipment_id uuid,
    task_id uuid,
    tipo text DEFAULT 'preventiva'::text NOT NULL,
    titulo text NOT NULL,
    descripcion text,
    componente text,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    prioridad text DEFAULT 'normal'::text NOT NULL,
    fecha_programada date DEFAULT CURRENT_DATE NOT NULL,
    fecha_inicio timestamp with time zone,
    fecha_fin timestamp with time zone,
    asignado_a text,
    creado_por text,
    completado_por text,
    observaciones text,
    pasos jsonb,
    m3_acumulado numeric(12,2),
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.manual_material_withdrawals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    withdrawal_date date NOT NULL,
    plant_id uuid,
    observations text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.manual_withdrawal_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    withdrawal_id uuid,
    material_id uuid,
    quantity_kg numeric(10,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.material_suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    material_id uuid NOT NULL,
    supplier_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.materials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    unit character varying(20) NOT NULL,
    current_stock numeric(10,2) DEFAULT 0 NOT NULL,
    min_stock numeric(10,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    plant_id uuid,
    dry_stock numeric(12,2) DEFAULT 0,
    stockpile_humidity numeric(5,2) DEFAULT 0,
    bulk_density numeric(5,3) DEFAULT 1.6,
    bulking_factor_k numeric(5,2) DEFAULT 3.5,
    requires_humidity_control boolean DEFAULT false,
    tipo text NOT NULL,
    descuenta_stock boolean DEFAULT true NOT NULL,
    corrige_humedad boolean DEFAULT false NOT NULL
);

CREATE TABLE public.mixers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    license_plate character varying(50) NOT NULL,
    brand character varying(100),
    plant_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    capacity_m3 numeric(4,1) DEFAULT 8,
    model character varying(100),
    status character varying(20) DEFAULT 'available'::character varying,
    active boolean DEFAULT true,
    gps_unit_id bigint
);

CREATE TABLE public.plants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    code character varying(50) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    gps_lat numeric(10,6),
    gps_lng numeric(10,6)
);

CREATE TABLE public.press_calibrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plant_id uuid,
    calibration_date date NOT NULL,
    constant_a numeric DEFAULT 0 NOT NULL,
    constant_b numeric DEFAULT 0 NOT NULL,
    constant_c numeric DEFAULT 0 NOT NULL,
    constant_d numeric DEFAULT 0 NOT NULL,
    cylinder_diameter_cm numeric DEFAULT 10 NOT NULL,
    is_active boolean DEFAULT true,
    calibrated_by character varying,
    certificate_number character varying,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    force_unit text DEFAULT 'tf'::text
);

CREATE TABLE public.scheduled_dispatches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plant_id uuid NOT NULL,
    client_id uuid NOT NULL,
    construction_site_id uuid NOT NULL,
    formula_id uuid NOT NULL,
    mixer_id uuid,
    quantity_m3 numeric(6,2) NOT NULL,
    scheduled_arrival_time timestamp with time zone NOT NULL,
    scheduled_departure_time timestamp with time zone NOT NULL,
    actual_load_start_time timestamp with time zone,
    actual_departure_time timestamp with time zone,
    actual_arrival_time timestamp with time zone,
    status character varying(20) DEFAULT 'scheduled'::character varying,
    observations text,
    cancelled_reason text,
    is_urgent boolean DEFAULT false,
    dispatch_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by character varying(255),
    remito character varying,
    extra_water_liters numeric,
    dispatched_m3 numeric(10,2) DEFAULT 0,
    fiber_kg_per_m3 numeric(10,3),
    metodo_descarga text
);

CREATE TABLE public.stock_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    material_id uuid NOT NULL,
    quantity numeric(10,2) NOT NULL,
    supplier character varying(200),
    remito character varying(100),
    notes text,
    entry_date timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    supplier_id uuid,
    carrier_id uuid,
    humidity_percentage numeric(5,2),
    original_quantity numeric(10,2),
    sample_taken_granulometry boolean DEFAULT false,
    granulometry_test_id uuid,
    dry_quantity numeric(12,2),
    created_by text
);

CREATE TABLE public.stock_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    material_id uuid NOT NULL,
    movement_type character varying(20) NOT NULL,
    quantity_kg numeric NOT NULL,
    reference_type character varying(50),
    reference_id uuid,
    movement_date date DEFAULT CURRENT_DATE NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.stockpile_cubications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    material_id uuid NOT NULL,
    cubication_date timestamp with time zone DEFAULT now() NOT NULL,
    volume_m3 numeric(10,2) NOT NULL,
    humidity_percent numeric(5,2) NOT NULL,
    calculated_dry_stock_kg numeric(12,2) NOT NULL,
    system_dry_stock_kg numeric(12,2) NOT NULL,
    deviation_kg numeric(12,2) NOT NULL,
    deviation_percent numeric(5,2) NOT NULL,
    approved boolean DEFAULT false,
    approved_by character varying(255),
    approved_at timestamp with time zone,
    notes text,
    plant_id uuid,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(200) NOT NULL,
    contact character varying(100),
    phone character varying(50),
    plant_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.test_cylinders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    dispatch_id uuid,
    cylinder_number integer NOT NULL,
    test_age_days integer NOT NULL,
    scheduled_test_date date NOT NULL,
    actual_test_date date,
    dial_reading numeric(10,2),
    strength_mpa numeric(10,2),
    comments text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    weight_grams numeric(10,2),
    discarded boolean DEFAULT false,
    discard_reason text
);

ALTER SEQUENCE public.maint_work_orders_numero_seq OWNED BY public.maint_work_orders.numero;

-- ============================================================================
-- Funciones (después de las tablas porque algunas usan sus tipos de fila)
-- ============================================================================

CREATE OR REPLACE FUNCTION public._ajustar_pedido(p_pedido_id uuid, p_delta_m3 numeric, p_usuario text, p_nota text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public._ancla_stock(p_material_id uuid, p_desde timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT min(created_at)
    FROM stock_movements
   WHERE material_id = p_material_id
     AND created_at > p_desde
     AND reference_type = 'recuento'
$function$;

CREATE OR REPLACE FUNCTION public._aplicar_neto(p_dispatch_id uuid, p_desde timestamp with time zone, p_neto jsonb, p_nota text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r        record;
  v_ancla  timestamptz;
  v_mover  jsonb := '{}'::jsonb;
  v_sin    int := 0;
  v_dia    date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
BEGIN
  FOR r IN
    SELECT key::uuid AS mid, round(value::numeric, 3) AS kg, m.descuenta_stock, m.name
      FROM jsonb_each_text(coalesce(p_neto, '{}'::jsonb)) e
      JOIN materials m ON m.id = e.key::uuid
     ORDER BY key::uuid
  LOOP
    CONTINUE WHEN r.kg = 0;
    v_ancla := public._ancla_stock(r.mid, p_desde);
    IF v_ancla IS NOT NULL THEN
      INSERT INTO stock_movements (material_id, movement_type, quantity_kg, reference_type, reference_id, movement_date, notes)
      VALUES (r.mid, 'consumo', 0, 'dispatch', p_dispatch_id, v_dia,
              p_nota || CASE WHEN r.kg < 0 THEN ' · no se devuelve stock' ELSE ' · no se descuenta stock' END
                     || ': recuento posterior al despacho ('
                     || to_char(v_ancla AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY') || '); '
                     || abs(r.kg) || ' kg sin mover');
      v_sin := v_sin + 1;
    ELSE
      INSERT INTO stock_movements (material_id, movement_type, quantity_kg, reference_type, reference_id, movement_date, notes)
      VALUES (r.mid, 'consumo', r.kg, 'dispatch', p_dispatch_id, v_dia, p_nota);
      IF r.descuenta_stock THEN
        v_mover := v_mover || jsonb_build_object(r.mid::text, r.kg);
      END IF;
    END IF;
  END LOOP;
  PERFORM public._mover_stock(v_mover);
  RETURN jsonb_build_object('movidos', (SELECT count(*) FROM jsonb_object_keys(v_mover)), 'sin_mover_por_recuento', v_sin);
END;
$function$;

CREATE OR REPLACE FUNCTION public._consumo_formula(p_formula_id uuid, p_plant_id uuid, p_m3 numeric)
 RETURNS TABLE(mat_id uuid, mat_nombre text, mat_tipo text, descuenta boolean, kg_m3 numeric, kg_seco numeric, humedad_pct numeric, kg_humedo numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public._material_en_planta(p_material_id uuid, p_plant_id uuid, p_contexto text DEFAULT NULL::text)
 RETURNS public.materials
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public._mover_stock(p_mapa jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT key::uuid AS mid, round(value::numeric, 3) AS kg
      FROM jsonb_each_text(coalesce(p_mapa, '{}'::jsonb))
     ORDER BY key::uuid
  LOOP
    IF r.kg <> 0 THEN
      UPDATE materials SET current_stock = coalesce(current_stock, 0) - r.kg, updated_at = now() WHERE id = r.mid;
    END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public._sumar_kg(p_mapa jsonb, p_material_id uuid, p_kg numeric)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_set(coalesce(p_mapa, '{}'::jsonb), ARRAY[p_material_id::text],
                   to_jsonb(coalesce((p_mapa->>p_material_id::text)::numeric, 0) + p_kg))
$function$;

CREATE OR REPLACE FUNCTION public.ajustar_material_despacho(p_dispatch_id uuid, p_material text, p_cantidad numeric, p_usuario text DEFAULT NULL::text, p_nota text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_usuario text := coalesce(nullif(btrim(coalesce(p_usuario, '')), ''), 'Sistema');
  v_d       public.dispatches;
  v_m       public.materials;
  v_prev    numeric;
  v_new     numeric;
  v_diff    numeric;
  v_res     jsonb;
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
    v_res := public._aplicar_neto(p_dispatch_id, v_d.created_at, jsonb_build_object(v_m.id::text, v_diff),
               coalesce(nullif(btrim(coalesce(p_nota, '')), ''), v_m.name || ' — remito ' || coalesce(v_d.remito, 's/n')));
    INSERT INTO activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
    VALUES (v_usuario, 'editar', 'despacho', p_dispatch_id::text, v_d.remito, v_d.plant_id,
            jsonb_build_object('Material', v_m.name, 'Antes', v_prev, 'Ahora', v_new));
  END IF;

  RETURN jsonb_build_object('material_id', v_m.id, 'anterior', v_prev, 'nuevo', v_new, 'diferencia', v_diff,
                            'sin_mover_por_recuento', coalesce((v_res->>'sin_mover_por_recuento')::int, 0));
END;
$function$;

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
            'Sin devolver (recuento posterior)', (v_res->>'sin_mover_por_recuento') || ' materiales'));

  RETURN jsonb_build_object('id', p_id, 'remito', v_d.remito, 'm3', v_d.quantity_m3,
                            'pedido_id', v_d.scheduled_dispatch_id, 'materiales', v_n, 'probetas', v_prob,
                            'stock_devuelto', (v_res->>'movidos')::int,
                            'sin_devolver_por_recuento', (v_res->>'sin_mover_por_recuento')::int);
END;
$function$;

CREATE OR REPLACE FUNCTION public.clasificar_material(p_nombre text)
 RETURNS TABLE(tipo text, descuenta_stock boolean, corrige_humedad boolean)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    CASE
      WHEN n LIKE 'arena%'               THEN 'arido_fino'
      WHEN n LIKE 'piedra%'              THEN 'arido_grueso'
      WHEN n LIKE 'cpc%' OR n LIKE 'cemento%' THEN 'cemento'
      WHEN n = 'agua' OR n LIKE 'agua %' THEN 'agua'
      WHEN n LIKE 'sikament 33%'         THEN 'aditivo_obra'
      WHEN n LIKE 'superfluidificante%'  THEN 'aditivo_obra'
      WHEN n LIKE 'sikament%'            THEN 'aditivo_planta'
      WHEN n LIKE 'fibra%'               THEN 'fibra'
      ELSE 'otro'
    END,
    NOT (n = 'agua' OR n LIKE 'agua %' OR n LIKE 'sikament 33%'),
    n LIKE 'arena fina%'
  FROM (SELECT lower(btrim(coalesce(p_nombre, ''))) AS n) x
$function$;

CREATE OR REPLACE FUNCTION public.create_test_cylinders_for_dispatch()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Only create cylinders if sample_taken is true
  IF NEW.sample_taken = true THEN
    -- Create cylinder 1 (7 days)
    INSERT INTO test_cylinders (dispatch_id, cylinder_number, test_age_days, scheduled_test_date)
    VALUES (NEW.id, 1, 7, (NEW.dispatch_date::date + INTERVAL '7 days')::date);
    
    -- Create cylinder 2 (28 days)
    INSERT INTO test_cylinders (dispatch_id, cylinder_number, test_age_days, scheduled_test_date)
    VALUES (NEW.id, 2, 28, (NEW.dispatch_date::date + INTERVAL '28 days')::date);
    
    -- Create cylinder 3 (28 days)
    INSERT INTO test_cylinders (dispatch_id, cylinder_number, test_age_days, scheduled_test_date)
    VALUES (NEW.id, 3, 28, (NEW.dispatch_date::date + INTERVAL '28 days')::date);
  END IF;
  
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.decrease_stock_after_entry_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
    BEGIN
      UPDATE materials
      SET current_stock = GREATEST(0, COALESCE(current_stock, 0) - OLD.quantity),
          updated_at = NOW()
      WHERE id = OLD.material_id;
      
      -- For humidity materials (Arena Fina): dry_quantity differs from quantity
      IF OLD.dry_quantity IS NOT NULL AND ABS(COALESCE(OLD.dry_quantity, OLD.quantity) - OLD.quantity) > 0.001 THEN
        UPDATE materials
        SET dry_stock = GREATEST(0, COALESCE(dry_stock, 0) - OLD.dry_quantity)
        WHERE id = OLD.material_id;
      END IF;
      
      RETURN OLD;
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

CREATE OR REPLACE FUNCTION public.materials_tipo_por_defecto()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE c record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.tipo IS NULL THEN
      SELECT * INTO c FROM public.clasificar_material(NEW.name);
      NEW.tipo := c.tipo;
      NEW.descuenta_stock := c.descuenta_stock;
      NEW.corrige_humedad := c.corrige_humedad;
    END IF;
  ELSIF NEW.name IS DISTINCT FROM OLD.name THEN
    SELECT * INTO c FROM public.clasificar_material(NEW.name);
    IF NEW.tipo IS NOT DISTINCT FROM OLD.tipo THEN
      NEW.tipo := c.tipo;
    END IF;
    IF NEW.descuenta_stock IS NOT DISTINCT FROM OLD.descuenta_stock THEN
      NEW.descuenta_stock := c.descuenta_stock;
    END IF;
    IF NEW.corrige_humedad IS NOT DISTINCT FROM OLD.corrige_humedad THEN
      NEW.corrige_humedad := c.corrige_humedad;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

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
$function$;

CREATE OR REPLACE FUNCTION public.update_material_stock(p_material_id uuid, p_quantity_change numeric)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE materials 
  SET current_stock = COALESCE(current_stock, 0) + p_quantity_change,
      updated_at = NOW()
  WHERE id = p_material_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_material_stockpile_humidity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE materials 
  SET stockpile_humidity = NEW.humidity_percent,
      updated_at = NOW()
  WHERE id = NEW.material_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_stock_after_dispatch()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE materials
  SET current_stock = current_stock - NEW.quantity,
      updated_at = NOW()
  WHERE id = NEW.material_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_stock_after_entry()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE materials
  SET current_stock = current_stock + NEW.quantity,
      updated_at = NOW()
  WHERE id = NEW.material_id;
  RETURN NEW;
END;
$function$;


-- ============================================================================
-- Claves primarias, UNIQUE y CHECK
-- ============================================================================

ALTER TABLE ONLY public.activity_log ADD CONSTRAINT activity_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.app_users ADD CONSTRAINT app_users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.carriers ADD CONSTRAINT carriers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.clients ADD CONSTRAINT clients_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.construction_sites ADD CONSTRAINT construction_sites_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.daily_stockpile_humidity ADD CONSTRAINT daily_stockpile_humidity_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.dispatch_materials ADD CONSTRAINT dispatch_materials_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.dispatch_status_log ADD CONSTRAINT dispatch_status_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.dispatches ADD CONSTRAINT dispatches_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.formula_materials ADD CONSTRAINT formula_materials_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.formulas ADD CONSTRAINT formulas_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.granulometria_sieve_results ADD CONSTRAINT granulometria_sieve_results_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.granulometria_tests ADD CONSTRAINT granulometria_tests_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.humidity_excess_log ADD CONSTRAINT humidity_excess_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.integraciones ADD CONSTRAINT integraciones_pkey PRIMARY KEY (clave);
ALTER TABLE ONLY public.maint_equipment ADD CONSTRAINT maint_equipment_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.maint_executions ADD CONSTRAINT maint_executions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.maint_task_images ADD CONSTRAINT maint_task_images_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.maint_task_items ADD CONSTRAINT maint_task_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.maint_task_steps ADD CONSTRAINT maint_task_steps_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.maint_tasks ADD CONSTRAINT maint_tasks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.maint_work_order_photos ADD CONSTRAINT maint_work_order_photos_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.maint_work_orders ADD CONSTRAINT maint_work_orders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.manual_material_withdrawals ADD CONSTRAINT manual_material_withdrawals_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.manual_withdrawal_items ADD CONSTRAINT manual_withdrawal_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.material_suppliers ADD CONSTRAINT material_suppliers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.materials ADD CONSTRAINT materials_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.mixers ADD CONSTRAINT mixers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.plants ADD CONSTRAINT plants_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.press_calibrations ADD CONSTRAINT press_calibrations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.scheduled_dispatches ADD CONSTRAINT scheduled_dispatches_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.stock_entries ADD CONSTRAINT stock_entries_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.stock_movements ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.stockpile_cubications ADD CONSTRAINT stockpile_cubications_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.suppliers ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.test_cylinders ADD CONSTRAINT test_cylinders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.carriers ADD CONSTRAINT carriers_name_supplier_id_key UNIQUE (name, supplier_id);
ALTER TABLE ONLY public.clients ADD CONSTRAINT clients_name_plant_id_key UNIQUE (name, plant_id);
ALTER TABLE ONLY public.construction_sites ADD CONSTRAINT construction_sites_name_client_id_key UNIQUE (name, client_id);
ALTER TABLE ONLY public.daily_stockpile_humidity ADD CONSTRAINT daily_stockpile_humidity_plant_id_material_id_reading_date_key UNIQUE (plant_id, material_id, reading_date);
ALTER TABLE ONLY public.formula_materials ADD CONSTRAINT formula_materials_formula_id_material_id_key UNIQUE (formula_id, material_id);
ALTER TABLE ONLY public.formulas ADD CONSTRAINT formulas_code_plant_unique UNIQUE (code, plant_id);
ALTER TABLE ONLY public.material_suppliers ADD CONSTRAINT material_suppliers_material_id_supplier_id_key UNIQUE (material_id, supplier_id);
ALTER TABLE ONLY public.materials ADD CONSTRAINT materials_name_plant_unique UNIQUE (name, plant_id);
ALTER TABLE ONLY public.mixers ADD CONSTRAINT mixers_license_plate_plant_id_key UNIQUE (license_plate, plant_id);
ALTER TABLE ONLY public.plants ADD CONSTRAINT plants_code_key UNIQUE (code);
ALTER TABLE ONLY public.plants ADD CONSTRAINT plants_name_key UNIQUE (name);
ALTER TABLE ONLY public.suppliers ADD CONSTRAINT suppliers_name_plant_id_key UNIQUE (name, plant_id);
ALTER TABLE ONLY public.test_cylinders ADD CONSTRAINT test_cylinders_dispatch_id_cylinder_number_key UNIQUE (dispatch_id, cylinder_number);
ALTER TABLE ONLY public.materials ADD CONSTRAINT materials_tipo_check CHECK ((tipo = ANY (ARRAY['arido_fino'::text, 'arido_grueso'::text, 'cemento'::text, 'agua'::text, 'aditivo_planta'::text, 'aditivo_obra'::text, 'fibra'::text, 'otro'::text])));
ALTER TABLE ONLY public.scheduled_dispatches ADD CONSTRAINT scheduled_dispatches_metodo_descarga_check CHECK (((metodo_descarga IS NULL) OR (metodo_descarga = ANY (ARRAY['bomba'::text, 'directo'::text]))));
ALTER TABLE ONLY public.scheduled_dispatches ADD CONSTRAINT valid_times CHECK ((scheduled_departure_time <= scheduled_arrival_time));
ALTER TABLE ONLY public.stock_movements ADD CONSTRAINT stock_movements_movement_type_check CHECK (((movement_type)::text = ANY ((ARRAY['ingreso'::character varying, 'consumo'::character varying, 'ajuste'::character varying, 'transferencia'::character varying])::text[])));
ALTER TABLE ONLY public.test_cylinders ADD CONSTRAINT test_cylinders_cylinder_number_check CHECK ((cylinder_number = ANY (ARRAY[1, 2, 3])));
ALTER TABLE ONLY public.test_cylinders ADD CONSTRAINT test_cylinders_test_age_days_check CHECK ((test_age_days = ANY (ARRAY[7, 28])));

-- ============================================================================
-- Índices (los de PK/UNIQUE los crea la restricción)
-- ============================================================================

CREATE INDEX idx_activity_log_created ON public.activity_log USING btree (created_at DESC);
CREATE INDEX idx_activity_log_entity ON public.activity_log USING btree (entity, action);
CREATE INDEX idx_activity_log_user ON public.activity_log USING btree (user_name);
CREATE INDEX idx_carriers_supplier_id ON public.carriers USING btree (supplier_id);
CREATE INDEX idx_clients_plant_id ON public.clients USING btree (plant_id);
CREATE INDEX idx_construction_sites_client_id ON public.construction_sites USING btree (client_id);
CREATE INDEX idx_daily_humidity_plant_date ON public.daily_stockpile_humidity USING btree (plant_id, reading_date);
CREATE INDEX idx_dispatch_materials_dispatch ON public.dispatch_materials USING btree (dispatch_id);
CREATE INDEX idx_dispatch_status_log_dispatch ON public.dispatch_status_log USING btree (scheduled_dispatch_id);
CREATE INDEX idx_dispatches_client_id ON public.dispatches USING btree (client_id);
CREATE INDEX idx_dispatches_construction_site_id ON public.dispatches USING btree (construction_site_id);
CREATE INDEX idx_dispatches_date ON public.dispatches USING btree (dispatch_date DESC);
CREATE INDEX idx_dispatches_formula ON public.dispatches USING btree (formula_id);
CREATE INDEX idx_dispatches_mixer_id ON public.dispatches USING btree (mixer_id);
CREATE INDEX idx_formula_materials_formula ON public.formula_materials USING btree (formula_id);
CREATE INDEX idx_formulas_plant_id ON public.formulas USING btree (plant_id);
CREATE INDEX idx_granulometria_sieve_results_test ON public.granulometria_sieve_results USING btree (test_id);
CREATE INDEX idx_granulometria_tests_date ON public.granulometria_tests USING btree (extraction_date DESC);
CREATE INDEX idx_granulometria_tests_plant ON public.granulometria_tests USING btree (plant_id);
CREATE INDEX idx_maint_exec_task ON public.maint_executions USING btree (task_id, fecha DESC);
CREATE INDEX idx_wo_estado ON public.maint_work_orders USING btree (estado, fecha_programada);
CREATE INDEX idx_wo_task ON public.maint_work_orders USING btree (task_id) WHERE (estado = ANY (ARRAY['pendiente'::text, 'en_curso'::text]));
CREATE UNIQUE INDEX uq_wo_task_abierta ON public.maint_work_orders USING btree (task_id) WHERE ((estado = ANY (ARRAY['pendiente'::text, 'en_curso'::text])) AND (task_id IS NOT NULL));
CREATE INDEX idx_material_suppliers_material ON public.material_suppliers USING btree (material_id);
CREATE INDEX idx_material_suppliers_supplier ON public.material_suppliers USING btree (supplier_id);
CREATE INDEX idx_materials_plant_id ON public.materials USING btree (plant_id);
CREATE INDEX idx_mixers_plant_id ON public.mixers USING btree (plant_id);
CREATE INDEX idx_press_calibrations_active ON public.press_calibrations USING btree (plant_id, is_active);
CREATE INDEX idx_scheduled_dispatches_date ON public.scheduled_dispatches USING btree (scheduled_arrival_time);
CREATE INDEX idx_scheduled_dispatches_mixer ON public.scheduled_dispatches USING btree (mixer_id);
CREATE INDEX idx_scheduled_dispatches_plant ON public.scheduled_dispatches USING btree (plant_id);
CREATE INDEX idx_scheduled_dispatches_status ON public.scheduled_dispatches USING btree (status);
CREATE INDEX idx_stock_entries_carrier ON public.stock_entries USING btree (carrier_id);
CREATE INDEX idx_stock_entries_date ON public.stock_entries USING btree (entry_date DESC);
CREATE INDEX idx_stock_entries_material ON public.stock_entries USING btree (material_id);
CREATE INDEX idx_stock_entries_supplier ON public.stock_entries USING btree (supplier_id);
CREATE INDEX idx_stock_movements_date ON public.stock_movements USING btree (movement_date);
CREATE INDEX idx_stock_movements_material_id ON public.stock_movements USING btree (material_id);
CREATE INDEX idx_stock_movements_type ON public.stock_movements USING btree (movement_type);
CREATE INDEX idx_suppliers_plant_id ON public.suppliers USING btree (plant_id);
CREATE INDEX idx_test_cylinders_dispatch_id ON public.test_cylinders USING btree (dispatch_id);
CREATE INDEX idx_test_cylinders_scheduled_date ON public.test_cylinders USING btree (scheduled_test_date);

-- ============================================================================
-- Claves foráneas
-- ============================================================================

ALTER TABLE ONLY public.activity_log ADD CONSTRAINT activity_log_plant_id_fkey FOREIGN KEY (plant_id) REFERENCES public.plants(id);
ALTER TABLE ONLY public.carriers ADD CONSTRAINT carriers_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.clients ADD CONSTRAINT clients_plant_id_fkey FOREIGN KEY (plant_id) REFERENCES public.plants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.construction_sites ADD CONSTRAINT construction_sites_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.daily_stockpile_humidity ADD CONSTRAINT daily_stockpile_humidity_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id);
ALTER TABLE ONLY public.daily_stockpile_humidity ADD CONSTRAINT daily_stockpile_humidity_plant_id_fkey FOREIGN KEY (plant_id) REFERENCES public.plants(id);
ALTER TABLE ONLY public.dispatch_materials ADD CONSTRAINT dispatch_materials_dispatch_id_fkey FOREIGN KEY (dispatch_id) REFERENCES public.dispatches(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.dispatch_materials ADD CONSTRAINT dispatch_materials_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.dispatch_status_log ADD CONSTRAINT dispatch_status_log_scheduled_dispatch_id_fkey FOREIGN KEY (scheduled_dispatch_id) REFERENCES public.scheduled_dispatches(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.dispatches ADD CONSTRAINT dispatches_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.dispatches ADD CONSTRAINT dispatches_construction_site_id_fkey FOREIGN KEY (construction_site_id) REFERENCES public.construction_sites(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.dispatches ADD CONSTRAINT dispatches_formula_id_fkey FOREIGN KEY (formula_id) REFERENCES public.formulas(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.dispatches ADD CONSTRAINT dispatches_mixer_id_fkey FOREIGN KEY (mixer_id) REFERENCES public.mixers(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.dispatches ADD CONSTRAINT dispatches_plant_id_fkey FOREIGN KEY (plant_id) REFERENCES public.plants(id);
ALTER TABLE ONLY public.dispatches ADD CONSTRAINT dispatches_scheduled_dispatch_id_fkey FOREIGN KEY (scheduled_dispatch_id) REFERENCES public.scheduled_dispatches(id);
ALTER TABLE ONLY public.formula_materials ADD CONSTRAINT formula_materials_formula_id_fkey FOREIGN KEY (formula_id) REFERENCES public.formulas(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.formula_materials ADD CONSTRAINT formula_materials_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.formulas ADD CONSTRAINT formulas_plant_id_fkey FOREIGN KEY (plant_id) REFERENCES public.plants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.granulometria_sieve_results ADD CONSTRAINT granulometria_sieve_results_test_id_fkey FOREIGN KEY (test_id) REFERENCES public.granulometria_tests(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.granulometria_tests ADD CONSTRAINT granulometria_tests_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id);
ALTER TABLE ONLY public.granulometria_tests ADD CONSTRAINT granulometria_tests_plant_id_fkey FOREIGN KEY (plant_id) REFERENCES public.plants(id);
ALTER TABLE ONLY public.granulometria_tests ADD CONSTRAINT granulometria_tests_stock_entry_id_fkey FOREIGN KEY (stock_entry_id) REFERENCES public.stock_entries(id);
ALTER TABLE ONLY public.granulometria_tests ADD CONSTRAINT granulometria_tests_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);
ALTER TABLE ONLY public.humidity_excess_log ADD CONSTRAINT humidity_excess_log_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id);
ALTER TABLE ONLY public.humidity_excess_log ADD CONSTRAINT humidity_excess_log_plant_id_fkey FOREIGN KEY (plant_id) REFERENCES public.plants(id);
ALTER TABLE ONLY public.humidity_excess_log ADD CONSTRAINT humidity_excess_log_stock_entry_id_fkey FOREIGN KEY (stock_entry_id) REFERENCES public.stock_entries(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.humidity_excess_log ADD CONSTRAINT humidity_excess_log_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);
ALTER TABLE ONLY public.maint_equipment ADD CONSTRAINT maint_equipment_plant_id_fkey FOREIGN KEY (plant_id) REFERENCES public.plants(id);
ALTER TABLE ONLY public.maint_executions ADD CONSTRAINT maint_executions_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.maint_tasks(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.maint_task_images ADD CONSTRAINT maint_task_images_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.maint_tasks(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.maint_task_items ADD CONSTRAINT maint_task_items_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.maint_tasks(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.maint_task_steps ADD CONSTRAINT maint_task_steps_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.maint_tasks(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.maint_tasks ADD CONSTRAINT maint_tasks_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.maint_equipment(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.maint_work_order_photos ADD CONSTRAINT maint_work_order_photos_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES public.maint_work_orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.maint_work_orders ADD CONSTRAINT maint_work_orders_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.maint_equipment(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.maint_work_orders ADD CONSTRAINT maint_work_orders_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.maint_tasks(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.manual_material_withdrawals ADD CONSTRAINT manual_material_withdrawals_plant_id_fkey FOREIGN KEY (plant_id) REFERENCES public.plants(id);
ALTER TABLE ONLY public.manual_withdrawal_items ADD CONSTRAINT manual_withdrawal_items_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id);
ALTER TABLE ONLY public.manual_withdrawal_items ADD CONSTRAINT manual_withdrawal_items_withdrawal_id_fkey FOREIGN KEY (withdrawal_id) REFERENCES public.manual_material_withdrawals(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.material_suppliers ADD CONSTRAINT material_suppliers_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.material_suppliers ADD CONSTRAINT material_suppliers_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.materials ADD CONSTRAINT materials_plant_id_fkey FOREIGN KEY (plant_id) REFERENCES public.plants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.mixers ADD CONSTRAINT mixers_plant_id_fkey FOREIGN KEY (plant_id) REFERENCES public.plants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.press_calibrations ADD CONSTRAINT press_calibrations_plant_id_fkey FOREIGN KEY (plant_id) REFERENCES public.plants(id);
ALTER TABLE ONLY public.scheduled_dispatches ADD CONSTRAINT scheduled_dispatches_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);
ALTER TABLE ONLY public.scheduled_dispatches ADD CONSTRAINT scheduled_dispatches_construction_site_id_fkey FOREIGN KEY (construction_site_id) REFERENCES public.construction_sites(id);
ALTER TABLE ONLY public.scheduled_dispatches ADD CONSTRAINT scheduled_dispatches_dispatch_id_fkey FOREIGN KEY (dispatch_id) REFERENCES public.dispatches(id);
ALTER TABLE ONLY public.scheduled_dispatches ADD CONSTRAINT scheduled_dispatches_formula_id_fkey FOREIGN KEY (formula_id) REFERENCES public.formulas(id);
ALTER TABLE ONLY public.scheduled_dispatches ADD CONSTRAINT scheduled_dispatches_mixer_id_fkey FOREIGN KEY (mixer_id) REFERENCES public.mixers(id);
ALTER TABLE ONLY public.scheduled_dispatches ADD CONSTRAINT scheduled_dispatches_plant_id_fkey FOREIGN KEY (plant_id) REFERENCES public.plants(id);
ALTER TABLE ONLY public.stock_entries ADD CONSTRAINT stock_entries_carrier_id_fkey FOREIGN KEY (carrier_id) REFERENCES public.carriers(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.stock_entries ADD CONSTRAINT stock_entries_granulometry_test_id_fkey FOREIGN KEY (granulometry_test_id) REFERENCES public.granulometria_tests(id);
ALTER TABLE ONLY public.stock_entries ADD CONSTRAINT stock_entries_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.stock_entries ADD CONSTRAINT stock_entries_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.stock_movements ADD CONSTRAINT stock_movements_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id);
ALTER TABLE ONLY public.stockpile_cubications ADD CONSTRAINT stockpile_cubications_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.stockpile_cubications ADD CONSTRAINT stockpile_cubications_plant_id_fkey FOREIGN KEY (plant_id) REFERENCES public.plants(id);
ALTER TABLE ONLY public.suppliers ADD CONSTRAINT suppliers_plant_id_fkey FOREIGN KEY (plant_id) REFERENCES public.plants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.test_cylinders ADD CONSTRAINT test_cylinders_dispatch_id_fkey FOREIGN KEY (dispatch_id) REFERENCES public.dispatches(id) ON DELETE CASCADE;

-- ============================================================================
-- Triggers
-- ============================================================================

CREATE TRIGGER trg_update_stockpile_humidity AFTER INSERT OR UPDATE ON public.daily_stockpile_humidity FOR EACH ROW EXECUTE FUNCTION public.update_material_stockpile_humidity();
CREATE TRIGGER trigger_create_test_cylinders AFTER INSERT ON public.dispatches FOR EACH ROW EXECUTE FUNCTION public.create_test_cylinders_for_dispatch();
CREATE TRIGGER trg_materials_tipo_por_defecto BEFORE INSERT OR UPDATE OF name ON public.materials FOR EACH ROW EXECUTE FUNCTION public.materials_tipo_por_defecto();
CREATE TRIGGER trigger_decrease_stock_on_entry_delete AFTER DELETE ON public.stock_entries FOR EACH ROW EXECUTE FUNCTION public.decrease_stock_after_entry_delete();
CREATE TRIGGER trigger_update_stock_entry AFTER INSERT ON public.stock_entries FOR EACH ROW EXECUTE FUNCTION public.update_stock_after_entry();

-- ============================================================================
-- Row Level Security (apagado en todas las tablas salvo las que figuran acá)
-- ============================================================================

ALTER TABLE public.integraciones ENABLE ROW LEVEL SECURITY;
-- integraciones: sin políticas (solo la lee service_role).

-- ============================================================================
-- Comentarios
-- ============================================================================

COMMENT ON COLUMN public.formulas.updated_by IS 'Name of the person who last edited the formula';
COMMENT ON COLUMN public.materials.tipo IS 'Fase 0b: arido_fino, arido_grueso, cemento, agua, aditivo_planta, aditivo_obra, fibra, otro';
COMMENT ON COLUMN public.materials.descuenta_stock IS 'Fase 0b: false = se registra en el despacho pero no descuenta stock (Agua, Sikament 33S)';
COMMENT ON COLUMN public.materials.corrige_humedad IS 'Fase 0b: true = el despacho descuenta seco x (1 + stockpile_humidity/100). Solo Arena Fina';

-- ============================================================================
-- Permisos (exactos: primero se quitan los que pone Supabase por defecto y después se dan los reales)
-- ============================================================================

REVOKE ALL ON TABLE public.activity_log FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.activity_log TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.app_users FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.app_users TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.carriers FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.carriers TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.clients FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.clients TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.construction_sites FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.construction_sites TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.daily_stockpile_humidity FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.daily_stockpile_humidity TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.dispatch_materials FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.dispatch_materials TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.dispatch_status_log FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.dispatch_status_log TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.dispatches FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.dispatches TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.formula_materials FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.formula_materials TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.formulas FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.formulas TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.granulometria_sieve_results FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.granulometria_sieve_results TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.granulometria_tests FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.granulometria_tests TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.humidity_excess_log FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.humidity_excess_log TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.integraciones FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.integraciones TO service_role;
REVOKE ALL ON TABLE public.maint_equipment FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.maint_equipment TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.maint_executions FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.maint_executions TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.maint_task_images FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.maint_task_images TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.maint_task_items FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.maint_task_items TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.maint_task_steps FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.maint_task_steps TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.maint_tasks FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.maint_tasks TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.maint_work_order_photos FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.maint_work_order_photos TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.maint_work_orders FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.maint_work_orders TO anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.maint_work_orders_numero_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON SEQUENCE public.maint_work_orders_numero_seq TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.manual_material_withdrawals FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.manual_material_withdrawals TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.manual_withdrawal_items FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.manual_withdrawal_items TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.material_suppliers FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.material_suppliers TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.materials FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.materials TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.mixers FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.mixers TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.plants FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.plants TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.press_calibrations FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.press_calibrations TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.scheduled_dispatches FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.scheduled_dispatches TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.stock_entries FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.stock_entries TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.stock_movements FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.stock_movements TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.stockpile_cubications FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.stockpile_cubications TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.suppliers FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.suppliers TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.test_cylinders FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.test_cylinders TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public._ajustar_pedido(p_pedido_id uuid, p_delta_m3 numeric, p_usuario text, p_nota text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._ajustar_pedido(p_pedido_id uuid, p_delta_m3 numeric, p_usuario text, p_nota text) TO service_role;
REVOKE ALL ON FUNCTION public._ancla_stock(p_material_id uuid, p_desde timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._ancla_stock(p_material_id uuid, p_desde timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION public._aplicar_neto(p_dispatch_id uuid, p_desde timestamp with time zone, p_neto jsonb, p_nota text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._aplicar_neto(p_dispatch_id uuid, p_desde timestamp with time zone, p_neto jsonb, p_nota text) TO service_role;
REVOKE ALL ON FUNCTION public._consumo_formula(p_formula_id uuid, p_plant_id uuid, p_m3 numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._consumo_formula(p_formula_id uuid, p_plant_id uuid, p_m3 numeric) TO service_role;
REVOKE ALL ON FUNCTION public._material_en_planta(p_material_id uuid, p_plant_id uuid, p_contexto text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._material_en_planta(p_material_id uuid, p_plant_id uuid, p_contexto text) TO service_role;
REVOKE ALL ON FUNCTION public._mover_stock(p_mapa jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._mover_stock(p_mapa jsonb) TO service_role;
REVOKE ALL ON FUNCTION public._sumar_kg(p_mapa jsonb, p_material_id uuid, p_kg numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._sumar_kg(p_mapa jsonb, p_material_id uuid, p_kg numeric) TO service_role;
REVOKE ALL ON FUNCTION public.ajustar_material_despacho(p_dispatch_id uuid, p_material text, p_cantidad numeric, p_usuario text, p_nota text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ajustar_material_despacho(p_dispatch_id uuid, p_material text, p_cantidad numeric, p_usuario text, p_nota text) TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.anular_despacho(p_id uuid, p_usuario text, p_motivo text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.anular_despacho(p_id uuid, p_usuario text, p_motivo text) TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.clasificar_material(p_nombre text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clasificar_material(p_nombre text) TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_test_cylinders_for_dispatch() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_test_cylinders_for_dispatch() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.decrease_stock_after_entry_delete() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decrease_stock_after_entry_delete() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editar_despacho(p_id uuid, p jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.editar_despacho(p_id uuid, p jsonb) TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.materials_tipo_por_defecto() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.materials_tipo_por_defecto() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.registrar_despacho(p jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_despacho(p jsonb) TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_material_stock(p_material_id uuid, p_quantity_change numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_material_stock(p_material_id uuid, p_quantity_change numeric) TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_material_stockpile_humidity() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_material_stockpile_humidity() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_stock_after_dispatch() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_stock_after_dispatch() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_stock_after_entry() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_stock_after_entry() TO PUBLIC, anon, authenticated, service_role;

-- ============================================================================
-- Referencia (no se ejecuta): objetos fuera de public que administra Supabase
-- ============================================================================

-- Buckets de storage: mantenimiento (público).
-- Política storage.objects "mant_fotos_leer": SELECT TO {public} USING ((bucket_id = 'mantenimiento'::text))
-- Política storage.objects "mant_fotos_subir": INSERT TO {public} WITH CHECK ((bucket_id = 'mantenimiento'::text))
-- Publicación supabase_realtime: sin tablas de public.
