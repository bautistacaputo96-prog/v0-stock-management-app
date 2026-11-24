-- Fase 0c-2 · Migración B (24/11/2026) · NO APLICADA. Seguridad real en la base: RLS en todas las tablas.
-- Especificación: docs/migracion-loop/fase-0c.md, "0c-2 · Especificación técnica" (puntos 4, 5 y 10).
--
-- CUÁNDO: una noche sin despachos, y SOLO cuando:
--   1. la rama fix/seguridad-rls está publicada (el navegador ya manda el token de la sesión);
--   2. SUPABASE_JWT_SECRET está cargada y https://www.produccionrebucret.com/api/sesion/token/probar dice
--      "tokenAceptado": true (entrando como gerencial);
--   3. Concretus ya lee por /api/concretus/lectura (docs/migracion-loop/concretus-lectura.md);
--   4. se probó en BEGIN … ROLLBACK con scripts/probar-seguridad-rls.mjs.
-- Antes de esto, que se hayan corrido las migraciones anteriores de la carpeta (202611231200 … 202611241800).
--
-- Qué hace:
--   0. Frena si hay alguna tabla de `public` que no esté clasificada abajo (una tabla nueva tiene que decidir quién
--      la lee y quién la escribe). Guarda los permisos de hoy en el esquema `rebucret_respaldo` para la vuelta atrás.
--   1. Ayudantes: rebucret_sesion_ok(), rebucret_permiso('seccion.accion', …), rebucret_exigir(…), rebucret_usuario(…).
--      La base lee los permisos EN EL MOMENTO de app_users (tipo + permisos, igual que puedeCon de lib/permisos.ts) y
--      corta el token si cambió la versión de sesión (baja, blanqueo, cambio de contraseña).
--   2. Las funciones del motor que escriben y llama el navegador (registrar_despacho, editar_despacho, …) piden el
--      permiso adentro y usan el nombre de la sesión en vez del que manda el navegador. Se les agrega una línea al
--      principio a partir de la definición vigente (pg_get_functiondef): no se pisa nada de otras ramas.
--   3. Actividad y pedidos: el nombre lo pone la base (el de la sesión) cuando escribe el navegador.
--   4. Triggers que hoy corren "como el navegador" pasan a SECURITY DEFINER (un ingreso sigue moviendo el stock).
--   5. RLS en TODAS las tablas de public: leer = sesión válida; escribir = según el permiso (tabla de la especificación);
--      las del servidor, sin reglas (solo la clave de servicio).
--   6. La clave pública (anon) se queda sin nada: tablas, secuencias y funciones, y tampoco recibe permisos sobre lo
--      que se cree después.
--   7. Fotos de mantenimiento: subir pide mantenimiento.cargar (ver sigue siendo público, como hoy).
--
-- Qué pasa con los datos ya cargados: NADA. No se cambia ni se borra ninguna fila. Solo cambia quién puede leer y
-- escribir. Lo que hoy hace cada persona desde sus pantallas lo sigue haciendo.
--
-- Vuelta atrás: supabase/migrations/vuelta-atras/202611241900_seguridad_rls_VUELTA_ATRAS.sql (restaura los permisos
-- guardados en el paso 0, apaga la RLS donde no estaba y deja las funciones sin control).

BEGIN;

-- ── 0. Clasificación de tablas y respaldo de permisos ──────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS rebucret_respaldo;
REVOKE ALL ON SCHEMA rebucret_respaldo FROM PUBLIC, anon, authenticated;
COMMENT ON SCHEMA rebucret_respaldo IS 'Fase 0c-2: permisos de antes de la migración 202611241900, para la vuelta atrás. No lo ve la API.';

CREATE TABLE IF NOT EXISTS rebucret_respaldo.acl_previo_0c2 (
  tipo     text NOT NULL,          -- tabla | secuencia | funcion | columna
  objeto   text NOT NULL,          -- regclass o regprocedure, como texto
  columna  text,
  acl      aclitem[],
  guardado timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rebucret_respaldo.rls_previo_0c2 (tabla text PRIMARY KEY, rls boolean NOT NULL);
CREATE TABLE IF NOT EXISTS rebucret_respaldo.politicas_previas_0c2 (
  esquema text, tabla text, nombre text, permissive text, roles name[], cmd text, qual text, with_check text
);
CREATE TABLE IF NOT EXISTS rebucret_respaldo.funciones_previas_0c2 (firma text PRIMARY KEY, security_definer boolean NOT NULL, config text[]);

-- Clasificación (ver la especificación, punto 4). A: lee y escribe el navegador. B: el navegador solo lee.
-- C: solo el servidor.
DROP TABLE IF EXISTS pg_temp._clasif_0c2;
CREATE TEMP TABLE _clasif_0c2 (tabla text PRIMARY KEY, clase char(1) NOT NULL) ON COMMIT DROP;
INSERT INTO _clasif_0c2 (tabla, clase)
SELECT unnest(ARRAY[
  'activity_log', 'carriers', 'choferes', 'clients', 'construction_sites', 'daily_stockpile_humidity', 'dispatches',
  'empresas_bombeo', 'formula_materials', 'formulas', 'granulometria_sieve_results', 'granulometria_tests',
  'humidity_excess_log', 'maint_executions', 'maint_work_order_photos', 'maint_work_orders', 'material_suppliers',
  'materials', 'mixers', 'plants', 'press_calibrations', 'scheduled_dispatches', 'stock_entries', 'stock_movements',
  'suppliers', 'test_cylinders', 'traslados_plantas']), 'A'
UNION ALL
SELECT unnest(ARRAY[
  'alertas_carga', 'amanecer_camiones', 'app_users', 'armado_mail', 'cargas', 'cargas_agua_extra', 'cargas_eventos',
  'cargas_materiales', 'dispatch_materials', 'dispatch_status_log', 'maint_equipment', 'maint_task_images',
  'maint_task_items', 'maint_task_steps', 'maint_tasks', 'manual_material_withdrawals', 'manual_withdrawal_items',
  'puesto_recetas', 'puesto_salidas', 'puestos_carga', 'recetas_planta', 'remito_tipo_dia', 'reparto_camiones',
  'stockpile_cubications', 'viajes', 'viajes_gps', 'zomatik_articulos', 'zomatik_lecturas', 'zomatik_np',
  'zomatik_np_excepciones', 'zomatik_remitos']), 'B'
UNION ALL
SELECT unnest(ARRAY[
  'alertas_stock', 'app_user_credenciales', 'client_alias', 'control_mp_corridas', 'control_mp_diferencias',
  'gps_reconstrucciones', 'ingreso_intentos', 'integraciones', 'zomatik_clientes', 'zomatik_ingresos_mp',
  'zomatik_lista_precios', 'zomatik_listas', 'zomatik_np_ajustes', 'zomatik_np_config', 'zomatik_np_pedido',
  'zomatik_np_pendientes', 'zomatik_np_precio', 'zomatik_np_uso', 'zomatik_pedido_borrar', 'zomatik_produccion_dia',
  'zomatik_produccion_lectura', 'zomatik_proyecto_movimientos', 'zomatik_proyectos', 'zomatik_remito_despachos',
  'zomatik_remitos_compra', 'zomatik_remitos_compra_dias', 'zomatik_remitos_dia', 'zomatik_stock_lecturas',
  'zomatik_stock_movimientos', 'zomatik_vendedores']), 'C';

DO $clasificar$
DECLARE
  v_sin   text;
  v_falta text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_sin
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    AND c.relname NOT IN (SELECT tabla FROM _clasif_0c2);
  IF v_sin IS NOT NULL THEN
    RAISE EXCEPTION 'Tablas de public sin clasificar (agregarlas a A, B o C en esta migración y en la especificación): %', v_sin;
  END IF;
  SELECT string_agg(k.tabla, ', ' ORDER BY k.tabla) INTO v_falta
  FROM _clasif_0c2 k
  WHERE NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND c.relname = k.tabla AND c.relkind IN ('r', 'p'));
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'Faltan tablas que esta migración espera (¿se corrió la 202611241800?): %', v_falta;
  END IF;
END
$clasificar$;

-- Respaldo (solo la primera vez: si se corre dos veces, no se pisa con lo ya restringido)
DO $respaldo$
BEGIN
  IF EXISTS (SELECT 1 FROM rebucret_respaldo.acl_previo_0c2) THEN
    RAISE NOTICE 'El respaldo de permisos ya existe (segunda corrida): no se toca.';
    RETURN;
  END IF;
  INSERT INTO rebucret_respaldo.acl_previo_0c2 (tipo, objeto, acl)
  SELECT CASE c.relkind WHEN 'S' THEN 'secuencia' ELSE 'tabla' END, c.oid::regclass::text, c.relacl
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S');
  INSERT INTO rebucret_respaldo.acl_previo_0c2 (tipo, objeto, columna, acl)
  SELECT 'columna', a.attrelid::regclass::text, a.attname, a.attacl
  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND a.attacl IS NOT NULL AND a.attnum > 0 AND NOT a.attisdropped;
  INSERT INTO rebucret_respaldo.acl_previo_0c2 (tipo, objeto, acl)
  SELECT 'funcion', p.oid::regprocedure::text, p.proacl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public';
  INSERT INTO rebucret_respaldo.rls_previo_0c2 (tabla, rls)
  SELECT c.relname, c.relrowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');
  INSERT INTO rebucret_respaldo.politicas_previas_0c2
  SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
  FROM pg_policies WHERE schemaname IN ('public', 'storage');
  INSERT INTO rebucret_respaldo.funciones_previas_0c2 (firma, security_definer, config)
  SELECT p.oid::regprocedure::text, p.prosecdef, p.proconfig
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prorettype = 'trigger'::regtype;
END
$respaldo$;

-- ── 1. Ayudantes ────────────────────────────────────────────────────────────────────────────────────────────────
-- Id del usuario del token, o null. Solo tokens que emite el servidor del sistema (iss = 'rebucret', role
-- authenticated, sub con forma de uuid): un usuario de Supabase Auth (si alguien se registrara con la clave pública)
-- no sirve.
CREATE OR REPLACE FUNCTION public.rebucret_sesion_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
     AND coalesce(auth.jwt() ->> 'iss', '') = 'rebucret'
     AND (auth.jwt() ->> 'sub') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (auth.jwt() ->> 'sub')::uuid
  END
$$;

-- La persona del token, si la sesión sigue valiendo: activa, con su contraseña ya elegida y la misma versión de
-- sesión que el token (una baja, un blanqueo o un cambio de contraseña suben la versión y cortan el token).
CREATE OR REPLACE FUNCTION public._rebucret_usuario_sesion()
RETURNS TABLE (id uuid, name text, tipo text, permisos jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.name, u.tipo, u.permisos
  FROM public.app_users u
  JOIN public.app_user_credenciales c ON c.user_id = u.id
  WHERE u.id = public.rebucret_sesion_id()
    AND u.active IS NOT FALSE
    AND c.clave_hash IS NOT NULL
    AND c.debe_cambiar IS NOT TRUE
    AND c.sesion_version::text = coalesce(auth.jwt() ->> 'v', '')
$$;

CREATE OR REPLACE FUNCTION public.rebucret_sesion_ok()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public._rebucret_usuario_sesion())
$$;

-- ¿La persona del token tiene ALGUNO de estos permisos ('seccion.accion')? Igual que puedeCon (lib/permisos.ts):
-- gerencial = todo salvo lo que se le sacó a mano (false); operario y consulta = solo lo tildado (true).
CREATE OR REPLACE FUNCTION public.rebucret_permiso(VARIADIC p_permisos text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce((
    SELECT bool_or(
      CASE WHEN s.tipo = 'gerencial'
        THEN (s.permisos -> split_part(x, '.', 1) -> split_part(x, '.', 2)) IS DISTINCT FROM 'false'::jsonb
        ELSE (s.permisos -> split_part(x, '.', 1) -> split_part(x, '.', 2)) = 'true'::jsonb
      END)
    FROM public._rebucret_usuario_sesion() s, unnest(p_permisos) AS x
  ), false)
$$;

-- Para las funciones que escriben. Sin token (SQL directo, pg_cron, migraciones) o con la clave de servicio
-- (servidor): pasa. Con sesión: pide el permiso. Con la clave pública: no.
CREATE OR REPLACE FUNCTION public.rebucret_exigir(VARIADIC p_permisos text[])
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rol text := nullif(auth.jwt() ->> 'role', '');
BEGIN
  IF v_rol IS NULL OR v_rol = 'service_role' THEN
    RETURN true;
  END IF;
  IF v_rol = 'authenticated' AND public.rebucret_permiso(VARIADIC p_permisos) THEN
    RETURN true;
  END IF;
  RAISE EXCEPTION 'Sin permiso para esto (hace falta: %). Si te parece un error, pedíselo a un gerencial.',
    array_to_string(p_permisos, ' o ')
    USING ERRCODE = '42501';
END;
$$;

-- Con sesión, el nombre de la sesión (lo que mande el navegador no cuenta). Si no, el que vino.
CREATE OR REPLACE FUNCTION public.rebucret_usuario(p_usuario text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce((SELECT s.name FROM public._rebucret_usuario_sesion() s), p_usuario)
$$;

-- Igual que normalizarNombre (lib/permisos.ts): minúsculas, sin tildes, sin espacios de más.
CREATE OR REPLACE FUNCTION public.rebucret_normalizar_nombre(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT btrim(regexp_replace(lower(translate(coalesce(p, ''), 'ÁÉÍÓÚÜÑáéíóúüñÀÈÌÒÙàèìòù', 'AEIOUUNaeiouunAEIOUaeiou')), '\s+', ' ', 'g'))
$$;

REVOKE ALL ON FUNCTION public.rebucret_sesion_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._rebucret_usuario_sesion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rebucret_sesion_ok() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rebucret_permiso(text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rebucret_exigir(text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rebucret_usuario(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rebucret_normalizar_nombre(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rebucret_sesion_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._rebucret_usuario_sesion() TO service_role;
GRANT EXECUTE ON FUNCTION public.rebucret_sesion_ok() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rebucret_permiso(text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rebucret_exigir(text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rebucret_usuario(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rebucret_normalizar_nombre(text) TO authenticated, service_role;

-- ── 2. Guardas en las funciones del motor que llama el navegador ────────────────────────────────────────────────
-- A cada una se le agrega como PRIMERA línea del DECLARE:
--     v_permiso_0c2 boolean := public.rebucret_exigir('…');
-- (se evalúa al entrar, antes que todo lo demás) y el usuario pasa por rebucret_usuario(). El resto del código queda
-- igual. Si alguna no tiene la forma esperada, se frena TODA la migración. Si ya la tiene (segunda corrida), se saltea.
-- REGLA: toda migración futura que reemplace una de estas funciones tiene que conservar esas dos cosas
-- (lo controla `npm run test:seguridad`).
DO $guardas$
DECLARE
  g       record;
  v_n     integer;
  v_def   text;
  v_paso1 text;
  v_paso2 text;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
      ('registrar_despacho',        'p',         ARRAY['despacho.cargar']),
      ('editar_despacho',           'p',         ARRAY['historial.editar']),
      ('ajustar_material_despacho', 'p_usuario', ARRAY['historial.editar']),
      ('anular_despacho',           'p_usuario', ARRAY['historial.borrar']),
      ('camion_volvio',             'p_usuario', ARRAY['despacho.cargar', 'programacion.editar']),
      ('finalizar_pedido',          'p_usuario', ARRAY['despacho.cargar', 'programacion.editar']),
      ('suspender_pedido',          'p_usuario', ARRAY['despacho.cargar', 'programacion.cargar', 'programacion.editar']),
      ('reabrir_pedido',            'p_usuario', ARRAY['despacho.cargar', 'programacion.cargar', 'programacion.editar']),
      ('guardar_viajes_pedido',     'p_usuario', ARRAY['programacion.cargar', 'programacion.editar', 'despacho.cargar']),
      ('guardar_reparto_dia',       'p_usuario', ARRAY['programacion.editar', 'despacho.cargar'])
    ) AS t(nombre, usuario, permisos)
  LOOP
    SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = g.nombre;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'Se esperaba una sola función public.% y hay %', g.nombre, v_n;
    END IF;
    SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = g.nombre;

    IF position('rebucret_exigir(' IN v_def) > 0 THEN
      RAISE NOTICE '%: ya tiene la guarda (se saltea)', g.nombre;
      CONTINUE;
    END IF;
    IF v_def !~ 'SECURITY DEFINER' THEN
      RAISE EXCEPTION '%: se esperaba SECURITY DEFINER', g.nombre;
    END IF;

    v_paso1 := regexp_replace(
      v_def,
      E'AS \\$function\\$\\s*\\nDECLARE\\n',
      E'AS $function$\nDECLARE\n  v_permiso_0c2 boolean := public.rebucret_exigir('
        || (SELECT string_agg(quote_literal(x), ', ') FROM unnest(g.permisos) AS x)
        || E'); -- fase 0c-2: permiso de la sesión (no sacar)\n');
    IF v_paso1 = v_def THEN
      RAISE EXCEPTION '%: no se encontró el DECLARE del principio', g.nombre;
    END IF;

    IF g.usuario = 'p_usuario' THEN
      v_paso2 := regexp_replace(v_paso1, 'coalesce\(p_usuario, ''''\)', 'coalesce(public.rebucret_usuario(p_usuario), '''')');
    ELSE
      v_paso2 := regexp_replace(v_paso1, 'coalesce\(p->>''usuario'', ''''\)', 'coalesce(public.rebucret_usuario(p->>''usuario''), '''')');
    END IF;
    IF v_paso2 = v_paso1 THEN
      RAISE EXCEPTION '%: no se encontró dónde toma el usuario', g.nombre;
    END IF;

    EXECUTE v_paso2;   -- CREATE OR REPLACE: conserva dueño y permisos
    RAISE NOTICE '%: guarda agregada (%)', g.nombre, array_to_string(g.permisos, ' o ');
  END LOOP;
END
$guardas$;

-- ── 3. El nombre lo pone la base cuando escribe el navegador ───────────────────────────────────────────────────
-- Solo cuando quien escribe es el navegador (current_user = authenticated). Si escribe una función del motor
-- (current_user = su dueño) o el servidor, queda lo que vino (ya es el de la sesión o el del proceso).
CREATE OR REPLACE FUNCTION public._rebucret_actividad_usuario()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user = 'authenticated' THEN
    NEW.user_name := coalesce(public.rebucret_usuario(NEW.user_name), NEW.user_name);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public._rebucret_pedido_creado_por()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user = 'authenticated' THEN
    NEW.created_by := coalesce(public.rebucret_usuario(NEW.created_by), NEW.created_by);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._rebucret_actividad_usuario() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._rebucret_pedido_creado_por() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rebucret_actividad_usuario ON public.activity_log;
CREATE TRIGGER trg_rebucret_actividad_usuario
  BEFORE INSERT ON public.activity_log
  FOR EACH ROW EXECUTE FUNCTION public._rebucret_actividad_usuario();

DROP TRIGGER IF EXISTS trg_rebucret_pedido_creado_por ON public.scheduled_dispatches;
CREATE TRIGGER trg_rebucret_pedido_creado_por
  BEFORE INSERT ON public.scheduled_dispatches
  FOR EACH ROW EXECUTE FUNCTION public._rebucret_pedido_creado_por();

-- ── 4. Triggers que escriben otras tablas: SECURITY DEFINER ────────────────────────────────────────────────────
-- Hoy corren con el rol de quien escribe (el navegador). Con RLS, un ingreso de materia prima no podría mover el
-- stock si la persona no tiene permiso de tocar materiales a mano. Como triggers no se pueden llamar sueltos.
DO $triggers$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'update_stock_after_entry', 'decrease_stock_after_entry_delete', 'update_material_stockpile_humidity',
    'create_test_cylinders_for_dispatch', '_viajes_pedido_cerrado', '_pedido_estado_por_cantidad',
    '_dispatches_created_at_fijo', '_mixers_estado_desde', '_stock_movements_carga_simulada', '_cargas_simulada',
    'materials_tipo_por_defecto']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname = f AND p.prorettype = 'trigger'::regtype) THEN
      EXECUTE format('ALTER FUNCTION public.%I() SECURITY DEFINER SET search_path = public, pg_temp', f);
    ELSE
      RAISE NOTICE 'Trigger % no existe (se saltea)', f;
    END IF;
  END LOOP;
END
$triggers$;

-- ── 5. RLS ──────────────────────────────────────────────────────────────────────────────────────────────────────
-- Se borran las reglas viejas de "leer todo" (cargas y puestos, con anon) y se prende la RLS en todas.
DO $rls$
DECLARE
  t record;
  p record;
BEGIN
  FOR p IN SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
  FOR t IN SELECT tabla, clase FROM _clasif_0c2 LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tabla);
    IF t.clase IN ('A', 'B') THEN
      EXECUTE format(
        'CREATE POLICY rls_leer ON public.%I FOR SELECT TO authenticated USING ((SELECT public.rebucret_sesion_ok()))',
        t.tabla);
    END IF;
  END LOOP;
END
$rls$;

-- Escribir: tabla × (INSERT | UPDATE | DELETE) × permisos (alcanza uno). Especificación, punto 4.
DO $escribir$
DECLARE
  r      record;
  v_expr text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('carriers',                    'INSERT', ARRAY['materia_prima.cargar']),
      ('carriers',                    'UPDATE', ARRAY['materia_prima.editar']),
      ('carriers',                    'DELETE', ARRAY['materia_prima.borrar']),
      ('suppliers',                   'INSERT', ARRAY['materia_prima.cargar']),
      ('suppliers',                   'UPDATE', ARRAY['materia_prima.editar']),
      ('suppliers',                   'DELETE', ARRAY['materia_prima.borrar']),
      ('material_suppliers',          'INSERT', ARRAY['materia_prima.cargar', 'materia_prima.editar', 'formulas.cargar']),
      ('material_suppliers',          'UPDATE', ARRAY['materia_prima.editar']),
      ('material_suppliers',          'DELETE', ARRAY['materia_prima.editar', 'materia_prima.borrar']),
      ('clients',                     'INSERT', ARRAY['clientes.cargar']),
      ('clients',                     'UPDATE', ARRAY['clientes.cargar', 'clientes.editar', 'clientes.borrar']),
      ('clients',                     'DELETE', ARRAY['clientes.borrar']),
      ('construction_sites',          'INSERT', ARRAY['clientes.cargar']),
      ('construction_sites',          'UPDATE', ARRAY['clientes.cargar', 'clientes.editar', 'clientes.borrar', 'programacion.cargar', 'programacion.editar']),
      ('construction_sites',          'DELETE', ARRAY['clientes.borrar']),
      ('daily_stockpile_humidity',    'INSERT', ARRAY['materia_prima.cargar']),
      ('daily_stockpile_humidity',    'UPDATE', ARRAY['materia_prima.cargar']),
      ('dispatches',                  'UPDATE', ARRAY['historial.cargar', 'historial.editar', 'laboratorio.cargar', 'laboratorio.editar']),
      ('formulas',                    'INSERT', ARRAY['formulas.cargar']),
      ('formulas',                    'UPDATE', ARRAY['formulas.editar']),
      ('formulas',                    'DELETE', ARRAY['formulas.borrar']),
      ('formula_materials',           'INSERT', ARRAY['formulas.cargar', 'formulas.editar']),
      ('formula_materials',           'UPDATE', ARRAY['formulas.editar']),
      ('formula_materials',           'DELETE', ARRAY['formulas.editar', 'formulas.borrar']),
      ('granulometria_tests',         'INSERT', ARRAY['laboratorio.cargar', 'materia_prima.cargar']),
      ('granulometria_tests',         'UPDATE', ARRAY['laboratorio.cargar', 'laboratorio.editar']),
      ('granulometria_tests',         'DELETE', ARRAY['laboratorio.borrar']),
      ('granulometria_sieve_results', 'INSERT', ARRAY['laboratorio.cargar', 'laboratorio.editar']),
      ('granulometria_sieve_results', 'UPDATE', ARRAY['laboratorio.editar']),
      ('granulometria_sieve_results', 'DELETE', ARRAY['laboratorio.cargar', 'laboratorio.editar']),
      ('humidity_excess_log',         'INSERT', ARRAY['materia_prima.cargar', 'materia_prima.editar']),
      ('humidity_excess_log',         'UPDATE', ARRAY['materia_prima.cargar', 'materia_prima.editar']),
      ('humidity_excess_log',         'DELETE', ARRAY['materia_prima.cargar', 'materia_prima.editar', 'materia_prima.borrar']),
      ('maint_executions',            'INSERT', ARRAY['mantenimiento.cargar']),
      ('maint_work_order_photos',     'INSERT', ARRAY['mantenimiento.cargar']),
      ('maint_work_orders',           'INSERT', ARRAY['mantenimiento.cargar']),
      ('maint_work_orders',           'UPDATE', ARRAY['mantenimiento.cargar', 'mantenimiento.borrar']),
      ('materials',                   'INSERT', ARRAY['formulas.cargar']),
      ('materials',                   'UPDATE', ARRAY['recuentos.cargar', 'materia_prima.cargar', 'materia_prima.editar', 'materia_prima.borrar', 'formulas.cargar', 'formulas.editar']),
      ('materials',                   'DELETE', ARRAY['formulas.borrar']),
      ('mixers',                      'INSERT', ARRAY['flota.cargar']),
      ('mixers',                      'UPDATE', ARRAY['flota.editar', 'flota.borrar', 'despacho.cargar']),
      ('mixers',                      'DELETE', ARRAY['flota.borrar']),
      ('choferes',                    'INSERT', ARRAY['flota.cargar']),
      ('choferes',                    'UPDATE', ARRAY['flota.editar', 'flota.borrar']),
      ('empresas_bombeo',             'INSERT', ARRAY['flota.cargar']),
      ('empresas_bombeo',             'UPDATE', ARRAY['flota.editar', 'flota.borrar']),
      ('plants',                      'UPDATE', ARRAY['programacion.editar']),
      ('press_calibrations',          'INSERT', ARRAY['laboratorio.cargar']),
      ('press_calibrations',          'UPDATE', ARRAY['laboratorio.cargar']),
      ('scheduled_dispatches',        'INSERT', ARRAY['programacion.cargar']),
      ('scheduled_dispatches',        'UPDATE', ARRAY['programacion.editar', 'programacion.borrar', 'historial.editar', 'despacho.cargar']),
      ('scheduled_dispatches',        'DELETE', ARRAY['programacion.borrar', 'historial.borrar']),
      ('stock_entries',               'INSERT', ARRAY['materia_prima.cargar']),
      ('stock_entries',               'UPDATE', ARRAY['materia_prima.cargar', 'materia_prima.editar', 'materia_prima.borrar', 'laboratorio.cargar', 'laboratorio.editar']),
      ('stock_entries',               'DELETE', ARRAY['materia_prima.borrar']),
      ('stock_movements',             'INSERT', ARRAY['recuentos.cargar', 'materia_prima.cargar', 'materia_prima.editar', 'materia_prima.borrar']),
      ('test_cylinders',              'INSERT', ARRAY['historial.cargar', 'laboratorio.cargar']),
      ('test_cylinders',              'UPDATE', ARRAY['laboratorio.cargar', 'laboratorio.editar', 'laboratorio.borrar']),
      ('test_cylinders',              'DELETE', ARRAY['laboratorio.borrar']),
      ('traslados_plantas',           'INSERT', ARRAY['programacion.editar']),
      ('traslados_plantas',           'UPDATE', ARRAY['programacion.editar'])
    ) AS t(tabla, cmd, permisos)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM _clasif_0c2 WHERE tabla = r.tabla AND clase = 'A') THEN
      RAISE EXCEPTION 'La tabla % tiene reglas de escritura pero no está en la clase A', r.tabla;
    END IF;
    v_expr := format('(SELECT public.rebucret_permiso(%s))',
                     (SELECT string_agg(quote_literal(x), ', ') FROM unnest(r.permisos) AS x));
    IF r.cmd = 'INSERT' THEN
      EXECUTE format('CREATE POLICY rls_agregar ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)', r.tabla, v_expr);
    ELSIF r.cmd = 'UPDATE' THEN
      EXECUTE format('CREATE POLICY rls_cambiar ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', r.tabla, v_expr, v_expr);
    ELSIF r.cmd = 'DELETE' THEN
      EXECUTE format('CREATE POLICY rls_borrar ON public.%I FOR DELETE TO authenticated USING (%s)', r.tabla, v_expr);
    ELSE
      RAISE EXCEPTION 'Comando desconocido: %', r.cmd;
    END IF;
  END LOOP;
END
$escribir$;

-- Casos especiales (las reglas se suman: alcanza con que una deje)
-- Actividad: cualquier sesión agrega (el nombre lo pone el trigger del punto 3). Nadie cambia ni borra.
CREATE POLICY rls_agregar ON public.activity_log FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.rebucret_sesion_ok()));

-- Pedidos: quien solo carga en Programación ajusta SUS pedidos (igual que puedeAjustarPedido).
CREATE POLICY rls_cambiar_propios ON public.scheduled_dispatches FOR UPDATE TO authenticated
  USING ((SELECT public.rebucret_permiso('programacion.cargar'))
         AND public.rebucret_normalizar_nombre(created_by) <> ''
         AND public.rebucret_normalizar_nombre(created_by) = (SELECT public.rebucret_normalizar_nombre(public.rebucret_usuario(NULL))))
  WITH CHECK ((SELECT public.rebucret_permiso('programacion.cargar'))
         AND public.rebucret_normalizar_nombre(created_by) = (SELECT public.rebucret_normalizar_nombre(public.rebucret_usuario(NULL))));

-- Fórmulas: quien da de alta puede deshacer un alta que falló a mitad (la fórmula todavía sin materiales).
CREATE POLICY rls_borrar_alta_fallida ON public.formulas FOR DELETE TO authenticated
  USING ((SELECT public.rebucret_permiso('formulas.cargar'))
         AND NOT EXISTS (SELECT 1 FROM public.formula_materials fm WHERE fm.formula_id = formulas.id));

-- Mantenimiento: la generación automática de órdenes ("Sistema") corre para cualquiera que abra la pantalla.
CREATE POLICY rls_agregar_sistema ON public.maint_work_orders FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.rebucret_sesion_ok()) AND creado_por = 'Sistema');

-- ── 6. Permisos: la clave pública sin nada ──────────────────────────────────────────────────────────────────────
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, PUBLIC;

-- authenticated: las de la clase C no se tocan (no tienen GRANT); app_users solo id, name, active (como la
-- 202611231700); activity_log sin cambiar ni borrar.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.app_users FROM authenticated;
REVOKE SELECT ON public.app_users FROM authenticated;
GRANT SELECT (id, name, active) ON public.app_users TO authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.activity_log FROM authenticated;
REVOKE ALL ON public.app_user_credenciales, public.integraciones, public.alertas_stock, public.ingreso_intentos FROM authenticated;

-- Lo que se cree de ahora en más en public no le da nada a la clave pública
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ── 7. Fotos de mantenimiento (storage) ─────────────────────────────────────────────────────────────────────────
-- Ver: el bucket es público (los links de las fotos andan sin sesión, como hoy). Subir: mantenimiento.cargar.
-- Si el rol no puede tocar las reglas de storage, se avisa y sigue (queda como hoy).
DO $storage$
BEGIN
  DROP POLICY IF EXISTS mant_fotos_leer ON storage.objects;
  DROP POLICY IF EXISTS mant_fotos_subir ON storage.objects;
  CREATE POLICY mant_fotos_leer ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'mantenimiento' AND (SELECT public.rebucret_sesion_ok()));
  CREATE POLICY mant_fotos_subir ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'mantenimiento' AND (SELECT public.rebucret_permiso('mantenimiento.cargar')));
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'No se pudieron cambiar las reglas de storage (fotos de mantenimiento): quedan como estaban. Cambiarlas desde el panel de Supabase.';
END
$storage$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Control después de correrla (tienen que dar 0 filas las dos primeras):
--   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity;
--   SELECT table_name, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND grantee = 'anon';
--   SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2;
