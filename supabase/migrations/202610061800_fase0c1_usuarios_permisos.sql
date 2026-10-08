-- Fase 0c-1 · Usuarios, permisos y contraseña propia (lo que se ve)
--
-- Especificación: docs/migracion-loop/fase-0c.md › "0c-1 · Especificación técnica".
--
-- Todo se agrega, nada se borra. Compatible con el front de main: main no lee las columnas ni la tabla
-- nuevas, y los dos cambios en funciones son parámetros OPCIONALES. Se puede aplicar antes de publicar
-- el front. Se puede correr más de una vez (no pisa permisos ni contraseñas ya cargados).
--
--   app_users.tipo                    gerencial / operario / consulta. Pone los permisos por defecto.
--   app_users.permisos                matriz sección × acción (ver · cargar · editar · borrar) de la persona.
--                                     Se guarda completa (no "diferencias con la plantilla").
--   app_users.permisos_actualizados_at / _por   quién y cuándo tocó tipo o permisos por última vez.
--   índice único por nombre           el login y la Actividad identifican a la persona por su nombre.
--   app_user_credenciales             contraseña (solo el hash scrypt, NUNCA el texto), "debe cambiarla",
--                                     primer ingreso con la contraseña común, versión de sesión (para
--                                     cerrar sesiones), intentos fallidos. RLS prendida y sin políticas:
--                                     SOLO la lee y escribe el servidor (clave service_role), como
--                                     `integraciones` y `alertas_stock`. El navegador no la ve nunca.
--   registrar_ingreso_fallido / registrar_ingreso_ok / cerrar_ingreso_clave_comun
--                                     freno de intentos y cierre del ingreso con la contraseña común,
--                                     atómicos en la base. Solo los ejecuta el servidor (service_role).
--   app_users: escritura del navegador cerrada salvo las columnas que main usa hoy (INSERT name/active/
--                                     role, UPDATE ve_funciones_nuevas). tipo, permisos y email solo los
--                                     escribe el servidor.
--   editar_despacho                   lee un "motivo" opcional del jsonb y lo deja en Actividad.
--   ajustar_material_despacho         parámetro nuevo p_motivo (opcional) que queda en Actividad.
--
-- Qué pasa con los datos ya cargados:
--   - Los 7 usuarios existentes quedan con su tipo y sus permisos iniciales (definiciones de Bautista del
--     05 y 06/10/2026). Fernando pasa a gerencial. Se buscan por id Y por nombre: si alguno no coincide
--     (por ejemplo, se renombró), queda como "consulta" y sale un aviso (NOTICE) para corregirlo desde la
--     pantalla Usuarios. Nadie queda con más permisos de los definidos.
--   - La columna vieja `role` (supervisor / operario / mantenimiento) NO se toca: el front de main la
--     sigue usando hasta el merge. Después del merge el front usa `tipo`; `role` queda sin uso.
--   - Ningún usuario tiene contraseña propia todavía. Decisión del 07/10/2026: entran con la contraseña
--     común de siempre (UNA vez, y el sistema les obliga a elegir la suya) solo los operarios y consulta
--     (Titan, Felipe, Braian, Joaquín) y Bautista. Los otros gerenciales (Juan, Fernando) NO: quedan "sin
--     contraseña" hasta que Bautista, ya con la suya, les dé una inicial desde Usuarios. Así nadie que sepa
--     la común puede quedarse con una cuenta gerencial.
--   - Activity_log, despachos, pedidos, etc.: no se tocan.
--   - Un usuario creado entre esta migración y el merge (con el "Agregar nuevo usuario" viejo del login)
--     queda como consulta y sin credencial: no puede entrar con el front nuevo hasta que un gerencial le
--     dé una contraseña inicial desde Usuarios.

-- ---------------------------------------------------------------------------
-- app_users: tipo y permisos
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'consulta',
  -- Por defecto: plantilla "consulta" (ve todo menos Usuarios, no carga nada). Es lo más seguro para una
  -- fila creada por fuera de la pantalla Usuarios. Las acciones que no existen en una sección (por ejemplo
  -- "ver" en recuentos, que no tiene pantalla) se guardan en false, igual que lib/permisos.ts.
  ADD COLUMN IF NOT EXISTS permisos jsonb NOT NULL DEFAULT '{
    "programacion":  {"ver": true,  "cargar": false, "editar": false, "borrar": false},
    "despacho":      {"ver": true,  "cargar": false, "editar": false, "borrar": false},
    "historial":     {"ver": true,  "cargar": false, "editar": false, "borrar": false},
    "materia_prima": {"ver": true,  "cargar": false, "editar": false, "borrar": false},
    "recuentos":     {"ver": false, "cargar": false, "editar": false, "borrar": false},
    "laboratorio":   {"ver": true,  "cargar": false, "editar": false, "borrar": false},
    "mantenimiento": {"ver": true,  "cargar": false, "editar": false, "borrar": false},
    "clientes":      {"ver": true,  "cargar": false, "editar": false, "borrar": false},
    "formulas":      {"ver": true,  "cargar": false, "editar": false, "borrar": false},
    "flota":         {"ver": true,  "cargar": false, "editar": false, "borrar": false},
    "usuarios":      {"ver": false, "cargar": false, "editar": false, "borrar": false}
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS permisos_actualizados_at timestamptz,
  ADD COLUMN IF NOT EXISTS permisos_actualizados_por text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_users_tipo_check') THEN
    ALTER TABLE public.app_users
      ADD CONSTRAINT app_users_tipo_check CHECK (tipo IN ('gerencial', 'operario', 'consulta'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_users_permisos_objeto') THEN
    ALTER TABLE public.app_users
      ADD CONSTRAINT app_users_permisos_objeto CHECK (jsonb_typeof(permisos) = 'object');
  END IF;
END $$;

COMMENT ON COLUMN public.app_users.tipo IS 'Fase 0c: gerencial / operario / consulta. Gerencial puede todo (los permisos se ignoran).';
COMMENT ON COLUMN public.app_users.permisos IS 'Fase 0c: {seccion: {ver, cargar, editar, borrar}} de la persona. La plantilla del tipo se aplica al crear o al cambiar el tipo.';
COMMENT ON COLUMN public.app_users.role IS 'OBSOLETA desde la fase 0c-1 (se usa tipo). Queda por compatibilidad.';

-- Nombre único (sin distinguir mayúsculas ni espacios de los costados). Si hubiera repetidos, la migración
-- se frena con un mensaje claro en vez de dejar dos personas con el mismo nombre en el login.
DO $$
DECLARE v_rep text;
BEGIN
  SELECT string_agg(n, ', ') INTO v_rep
    FROM (SELECT lower(btrim(name)) n FROM public.app_users GROUP BY 1 HAVING count(*) > 1) x;
  IF v_rep IS NOT NULL THEN
    RAISE EXCEPTION 'Hay usuarios con el mismo nombre (%). Corregilos antes de aplicar la fase 0c-1.', v_rep;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS app_users_nombre_unico ON public.app_users (lower(btrim(name)));

-- ---------------------------------------------------------------------------
-- Permisos iniciales (solo la primera vez: permisos_actualizados_at nulo)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  -- Plantilla "consulta" (ve todo menos Usuarios, no carga nada). Igual a PLANTILLAS.consulta de lib/permisos.ts
  base jsonb := '{
    "programacion":  {"ver": true,  "cargar": false, "editar": false, "borrar": false},
    "despacho":      {"ver": true,  "cargar": false, "editar": false, "borrar": false},
    "historial":     {"ver": true,  "cargar": false, "editar": false, "borrar": false},
    "materia_prima": {"ver": true,  "cargar": false, "editar": false, "borrar": false},
    "recuentos":     {"ver": false, "cargar": false, "editar": false, "borrar": false},
    "laboratorio":   {"ver": true,  "cargar": false, "editar": false, "borrar": false},
    "mantenimiento": {"ver": true,  "cargar": false, "editar": false, "borrar": false},
    "clientes":      {"ver": true,  "cargar": false, "editar": false, "borrar": false},
    "formulas":      {"ver": true,  "cargar": false, "editar": false, "borrar": false},
    "flota":         {"ver": true,  "cargar": false, "editar": false, "borrar": false},
    "usuarios":      {"ver": false, "cargar": false, "editar": false, "borrar": false}
  }'::jsonb;
  -- Plantilla "gerencial": todas las acciones que existen en cada sección (igual se ignora: gerencial
  -- puede todo). Igual a PLANTILLAS.gerencial de lib/permisos.ts
  ger jsonb := '{
    "programacion":  {"ver": true,  "cargar": true,  "editar": true,  "borrar": true},
    "despacho":      {"ver": true,  "cargar": true,  "editar": false, "borrar": false},
    "historial":     {"ver": true,  "cargar": true,  "editar": true,  "borrar": true},
    "materia_prima": {"ver": true,  "cargar": true,  "editar": true,  "borrar": true},
    "recuentos":     {"ver": false, "cargar": true,  "editar": false, "borrar": false},
    "laboratorio":   {"ver": true,  "cargar": true,  "editar": true,  "borrar": true},
    "mantenimiento": {"ver": true,  "cargar": true,  "editar": false, "borrar": true},
    "clientes":      {"ver": true,  "cargar": true,  "editar": true,  "borrar": true},
    "formulas":      {"ver": true,  "cargar": true,  "editar": true,  "borrar": true},
    "flota":         {"ver": true,  "cargar": true,  "editar": true,  "borrar": true},
    "usuarios":      {"ver": true,  "cargar": false, "editar": false, "borrar": false}
  }'::jsonb;
  carga jsonb := '{"ver": true, "cargar": true, "editar": false, "borrar": false}'::jsonb;
  -- Plantilla "operario" = consulta + "agregar muestra después del despacho" (historial.cargar), respuesta
  -- 18.3 de Bautista (06/10/2026): lo pueden hacer todos los que cargan.
  oper  jsonb;
  quien text := 'Migración fase 0c-1';
  n     int;
BEGIN
  oper := base || jsonb_build_object('historial', carga);

  -- Gerenciales: Bautista, Juan, Fernando (Fernando hoy figura como operario: pasa a gerencial)
  UPDATE public.app_users SET tipo = 'gerencial', permisos = ger,
         permisos_actualizados_at = now(), permisos_actualizados_por = quien
   WHERE permisos_actualizados_at IS NULL
     AND (   (id = 'fdedc2eb-26d1-4add-a7a4-27b0b36e3f23' AND name = 'Bautista Caputo')
          OR (id = '1590b7d9-a08b-4886-b8fa-12b116b6bcf5' AND name = 'Juan Oreguy')
          OR (id = 'c32be9a2-dd7b-4cc3-93e9-42ac593bd3a0' AND name = 'Fernando Maldonado'));

  -- Titan: Programación del día (carga y edita: arma y ajusta todos los pedidos; NO cancela ni elimina,
  -- respuesta 18.1), Despacho, Materia prima, Laboratorio, Mantenimiento (chequeos diarios) y alta de
  -- clientes y obras (respuesta 18.2: cargar, no editar ni borrar)
  UPDATE public.app_users SET tipo = 'operario',
         permisos = oper || jsonb_build_object(
           'programacion',  '{"ver": true, "cargar": true, "editar": true, "borrar": false}'::jsonb,
           'despacho',      carga,
           'materia_prima', carga,
           'laboratorio',   carga,
           'mantenimiento', carga,
           'clientes',      carga),
         permisos_actualizados_at = now(), permisos_actualizados_por = quien
   WHERE permisos_actualizados_at IS NULL
     AND id = '94281578-c830-437b-a1f2-27b3ff275787' AND name = 'Titan Concretus';

  -- Felipe: Programación (crea pedidos y ajusta SOLO los propios, respuesta 18.4) y despacho, Materia prima,
  -- y alta y edición de Clientes y obras
  UPDATE public.app_users SET tipo = 'operario',
         permisos = oper || jsonb_build_object(
           'programacion',  carga,
           'despacho',      carga,
           'materia_prima', carga,
           'clientes',      '{"ver": true, "cargar": true, "editar": true, "borrar": false}'::jsonb),
         permisos_actualizados_at = now(), permisos_actualizados_por = quien
   WHERE permisos_actualizados_at IS NULL
     AND id = '7a7e6e10-cbcc-423e-8d49-5778d625a4ff' AND name = 'Felipe Calvo';

  -- Braian: Mantenimiento
  UPDATE public.app_users SET tipo = 'operario',
         permisos = oper || jsonb_build_object('mantenimiento', carga),
         permisos_actualizados_at = now(), permisos_actualizados_por = quien
   WHERE permisos_actualizados_at IS NULL
     AND id = '688f4ff0-ca82-48ea-9f69-78f0d877372a' AND name = 'Braian Peralta';

  -- Joaquín: consulta (ve todo, no carga nada)
  UPDATE public.app_users SET tipo = 'consulta', permisos = base,
         permisos_actualizados_at = now(), permisos_actualizados_por = quien
   WHERE permisos_actualizados_at IS NULL
     AND id = '536cbb60-02f8-411c-93be-d2607a7d0194' AND name = 'Joaquin Graham';

  -- David (nuevo) NO se crea acá: lo da de alta un gerencial desde Usuarios con su contraseña inicial
  -- (Operario + Laboratorio; la plantilla de operario ya trae "agregar muestra").

  -- Cualquier otro (o alguno de arriba que no coincidió por nombre): consulta, con aviso
  SELECT count(*) INTO n FROM public.app_users WHERE permisos_actualizados_at IS NULL;
  IF n > 0 THEN
    RAISE NOTICE 'Fase 0c-1: % usuario(s) quedaron como CONSULTA porque no estaban en la lista: %', n,
      (SELECT string_agg(name, ', ') FROM public.app_users WHERE permisos_actualizados_at IS NULL);
    UPDATE public.app_users SET tipo = 'consulta', permisos = base,
           permisos_actualizados_at = now(), permisos_actualizados_por = quien || ' (consulta por defecto)'
     WHERE permisos_actualizados_at IS NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Credenciales: solo el servidor (service_role)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_user_credenciales (
  user_id              uuid PRIMARY KEY REFERENCES public.app_users(id) ON DELETE CASCADE,
  -- "scrypt$N$r$p$sal$hash" (sal y hash en base64). Nunca la contraseña en texto.
  clave_hash           text CHECK (clave_hash IS NULL OR clave_hash LIKE 'scrypt$%'),
  -- true: la contraseña la puso un gerencial (alta o blanqueo) o es el primer ingreso: tiene que elegir la suya
  debe_cambiar         boolean NOT NULL DEFAULT false,
  -- true: todavía puede entrar UNA vez con la contraseña común de antes (solo usuarios existentes al
  -- 06/10/2026 y solo mientras no tengan contraseña propia). Un gerencial la cierra para todos desde Usuarios.
  permite_clave_comun  boolean NOT NULL DEFAULT false,
  -- Va dentro de la cookie de sesión: sumarle 1 cierra todas las sesiones abiertas de la persona
  -- (cambio o blanqueo de contraseña, baja).
  sesion_version       integer NOT NULL DEFAULT 1,
  intentos_fallidos    integer NOT NULL DEFAULT 0,
  bloqueado_hasta      timestamptz,
  clave_cambiada_at    timestamptz,
  ultimo_ingreso_at    timestamptz,
  actualizado_por      text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.app_user_credenciales IS 'Fase 0c-1: contraseñas (hash scrypt) y estado de sesión. Solo service_role (RLS sin políticas).';

ALTER TABLE public.app_user_credenciales ENABLE ROW LEVEL SECURITY;
-- Sin políticas: anon y authenticated no leen ni escriben nada.
REVOKE ALL ON TABLE public.app_user_credenciales FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.app_user_credenciales TO service_role;

-- Primer ingreso pendiente para los usuarios que ya existen (activos). No pisa filas existentes.
-- Decisión del 07/10/2026: la contraseña común vale (una vez) para operarios, consulta y Bautista; los
-- demás gerenciales quedan sin contraseña hasta que un gerencial les dé una inicial desde Usuarios.
INSERT INTO public.app_user_credenciales (user_id, debe_cambiar, permite_clave_comun, actualizado_por)
SELECT u.id, true,
       coalesce(u.active, true)
         AND (u.tipo <> 'gerencial'
              OR (u.id = 'fdedc2eb-26d1-4add-a7a4-27b0b36e3f23' AND u.name = 'Bautista Caputo')),
       'Migración fase 0c-1'
  FROM public.app_users u
ON CONFLICT (user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Freno de intentos y cierre del ingreso con la contraseña común (atómicos; solo service_role)
-- ---------------------------------------------------------------------------
-- Contraseña mal: suma 1 en la base (no "lo que leyó el servidor + 1"), así varios intentos al mismo
-- tiempo cuentan todos. Al llegar a 5: 10 minutos de bloqueo e intentos a 0. Si ya estaba bloqueado no
-- suma ni alarga el bloqueo (ya_bloqueado = true). Sin fila de credencial no devuelve nada.
CREATE OR REPLACE FUNCTION public.registrar_ingreso_fallido(p_user_id uuid)
 RETURNS TABLE (intentos integer, bloqueado timestamptz, ya_bloqueado boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH viejo AS (
    -- Bloquea la fila: los pedidos simultáneos de la misma persona se ordenan acá
    SELECT v.user_id, coalesce(v.bloqueado_hasta > now(), false) AS bloq, v.intentos_fallidos + 1 AS sig
      FROM public.app_user_credenciales v
     WHERE v.user_id = p_user_id
     FOR UPDATE)
  UPDATE public.app_user_credenciales c
     SET intentos_fallidos = CASE WHEN viejo.bloq THEN c.intentos_fallidos WHEN viejo.sig >= 5 THEN 0 ELSE viejo.sig END,
         bloqueado_hasta   = CASE WHEN viejo.bloq THEN c.bloqueado_hasta WHEN viejo.sig >= 5 THEN now() + interval '10 minutes' ELSE c.bloqueado_hasta END,
         updated_at = now()
    FROM viejo
   WHERE c.user_id = viejo.user_id
  RETURNING c.intentos_fallidos, c.bloqueado_hasta, viejo.bloq;
$function$;

-- Contraseña bien: intentos a 0 y último ingreso, SOLO si no está bloqueado en ese mismo momento
-- (chequeo atómico: si otro pedido lo bloqueó mientras se verificaba, no entra). true = puede entrar.
CREATE OR REPLACE FUNCTION public.registrar_ingreso_ok(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH u AS (
    UPDATE public.app_user_credenciales c
       SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_ingreso_at = now(), updated_at = now()
     WHERE c.user_id = p_user_id AND (c.bloqueado_hasta IS NULL OR c.bloqueado_hasta <= now())
    RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM u);
$function$;

-- "Cerrar el ingreso con la contraseña común" (pantalla Usuarios): nadie más entra con la común, y a los
-- que entraron con ella y todavía no eligieron la suya se les cierran las sesiones (sesion_version + 1).
-- Devuelve las personas afectadas.
CREATE OR REPLACE FUNCTION public.cerrar_ingreso_clave_comun(p_por text)
 RETURNS TABLE (user_id uuid, tenia_clave_comun boolean, sesion_cerrada boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH viejo AS (
    SELECT v.user_id, v.permite_clave_comun AS comun, v.clave_hash IS NULL AS sin_clave
      FROM public.app_user_credenciales v
     WHERE v.permite_clave_comun OR v.clave_hash IS NULL
     FOR UPDATE)
  UPDATE public.app_user_credenciales c
     SET permite_clave_comun = false,
         sesion_version = CASE WHEN viejo.sin_clave THEN c.sesion_version + 1 ELSE c.sesion_version END,
         actualizado_por = p_por,
         updated_at = now()
    FROM viejo
   WHERE c.user_id = viejo.user_id
  RETURNING c.user_id, viejo.comun, viejo.sin_clave;
$function$;

REVOKE ALL ON FUNCTION public.registrar_ingreso_fallido(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_ingreso_ok(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cerrar_ingreso_clave_comun(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_ingreso_fallido(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_ingreso_ok(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cerrar_ingreso_clave_comun(text) TO service_role;

-- ---------------------------------------------------------------------------
-- app_users: el navegador ya no escribe tipo, permisos ni email
-- ---------------------------------------------------------------------------
-- Hasta hoy anon/authenticated podían escribir cualquier columna. Desde acá, con la clave pública solo se
-- puede lo que el front de MAIN usa hoy (para no romperlo entre esta migración y el merge):
--   INSERT (name, active, role)   "Agregar nuevo usuario" del login y "Agregar" del selector Responsable
--   UPDATE (ve_funciones_nuevas)  interruptor de funciones nuevas en Actividad
-- La lectura no cambia. Después del merge el front nuevo no escribe app_users (todo pasa por /api/usuarios
-- con service_role): esos GRANT residuales se sacan en la 0c-2 o en una migración posterior al merge.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.app_users FROM anon, authenticated;
GRANT INSERT (name, active, role) ON public.app_users TO anon, authenticated;
GRANT UPDATE (ve_funciones_nuevas) ON public.app_users TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Motivo en Actividad para las ediciones hechas por funciones de la base
-- ---------------------------------------------------------------------------
-- editar_despacho: definición de producción del 06/10/2026 (pg_get_functiondef, = fase 2). Diff: v_motivo
-- (jsonb "motivo", opcional) va a la nota del movimiento de stock y a Actividad ("Motivo"). Nada más.
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

-- ajustar_material_despacho: se agrega p_motivo al final (opcional). Hay que borrar la firma vieja de 5
-- parámetros para que no queden dos funciones con el mismo nombre (PostgREST no sabría cuál llamar).
-- El front de main la llama con 5 parámetros con nombre: sigue andando igual (p_motivo queda nulo).
DROP FUNCTION IF EXISTS public.ajustar_material_despacho(uuid, text, numeric, text, text);

CREATE OR REPLACE FUNCTION public.ajustar_material_despacho(p_dispatch_id uuid, p_material text, p_cantidad numeric, p_usuario text DEFAULT NULL::text, p_nota text DEFAULT NULL::text, p_motivo text DEFAULT NULL::text)
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
  v_motivo  text := nullif(btrim(coalesce(p_motivo, '')), '');  -- fase 0c-1 (opcional)
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
            jsonb_build_object('Material', v_m.name, 'Antes', v_prev, 'Ahora', v_new)
            || CASE WHEN v_motivo IS NOT NULL THEN jsonb_build_object('Motivo', v_motivo) ELSE '{}'::jsonb END);
  END IF;

  RETURN jsonb_build_object('material_id', v_m.id, 'anterior', v_prev, 'nuevo', v_new, 'diferencia', v_diff,
                            'sin_mover_por_recuento', coalesce((v_res->>'sin_mover_por_recuento')::int, 0));
END;
$function$;

-- Mismos permisos de ejecución que en producción (la seguridad en la base es la fase 0c-2)
GRANT EXECUTE ON FUNCTION public.editar_despacho(uuid, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ajustar_material_despacho(uuid, text, numeric, text, text, text) TO anon, authenticated, service_role;

-- Que PostgREST vea enseguida la firma nueva de ajustar_material_despacho
NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Control (solo informa)
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT u.name, u.tipo,
           (SELECT string_agg(k, ', ' ORDER BY k) FROM jsonb_each(u.permisos) e(k, v) WHERE (v->>'cargar')::boolean) AS carga_en,
           c.permite_clave_comun, c.clave_hash IS NOT NULL AS tiene_clave
      FROM public.app_users u LEFT JOIN public.app_user_credenciales c ON c.user_id = u.id
     ORDER BY u.name
  LOOP
    RAISE NOTICE '% · % · carga en: % · primer ingreso con la común: % · contraseña propia: %',
      r.name, r.tipo, coalesce(r.carga_en, '—'), r.permite_clave_comun, r.tiene_clave;
  END LOOP;
END $$;
