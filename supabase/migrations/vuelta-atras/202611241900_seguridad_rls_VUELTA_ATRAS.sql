-- VUELTA ATRÁS de la migración 202611241900_seguridad_rls.sql (fase 0c-2). Correr SOLO si algo se rompió después
-- de la migración B y no hay tiempo de arreglarlo. NO es parte de la lista de migraciones (por eso está en esta
-- subcarpeta): no se corre al reconstruir la base.
--
-- Qué hace (deja la base como antes de la B, con los permisos que la B guardó en el esquema rebucret_respaldo):
--   1. Las funciones del motor dejan de pedir permiso: rebucret_exigir() y rebucret_exigir_sesion() devuelven siempre
--      true y rebucret_usuario()
--      devuelve lo que manda el navegador (las líneas que agregó la B quedan, pero no hacen nada).
--   2. Se borran las reglas de la B y se vuelven a crear las de antes (cargas y puestos "leer todo"; fotos).
--   3. Se apaga la RLS en las tablas donde antes estaba apagada.
--   4. Se devuelven los permisos de antes a anon y authenticated (tablas, columnas, secuencias y funciones).
--   5. Los triggers vuelven a correr "como quien escribe" (SECURITY INVOKER) y se sacan los dos triggers del nombre.
--   6. Los permisos por defecto para lo que se cree después vuelven a ser los de Supabase.
--
-- Datos: no toca ninguna fila. El código de la rama sigue andando (con la clave pública abierta, el token sobra).
-- Después de correrla, la seguridad vuelve a ser "lo que se ve en pantalla", como antes de la 0c-2.

BEGIN;

DO $previo$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM rebucret_respaldo.acl_previo_0c2) THEN
    RAISE EXCEPTION 'No está el respaldo de la migración 202611241900 (rebucret_respaldo.acl_previo_0c2): no se puede volver atrás automáticamente.';
  END IF;
END
$previo$;

-- 1. Funciones sin control
CREATE OR REPLACE FUNCTION public.rebucret_exigir(VARIADIC p_permisos text[])
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$ SELECT true $$;

CREATE OR REPLACE FUNCTION public.rebucret_exigir_sesion()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$ SELECT true $$;

CREATE OR REPLACE FUNCTION public.rebucret_usuario(p_usuario text)
RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$ SELECT p_usuario $$;

-- 2. Reglas
DO $reglas$
DECLARE
  p record;
BEGIN
  FOR p IN SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
  FOR p IN SELECT * FROM rebucret_respaldo.politicas_previas_0c2 WHERE esquema = 'public' LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I AS %s FOR %s TO %s%s%s',
      p.nombre, p.tabla, p.permissive, p.cmd,
      (SELECT string_agg(CASE WHEN r = 'public' THEN 'PUBLIC' ELSE quote_ident(r) END, ', ') FROM unnest(p.roles) AS r),
      CASE WHEN p.qual IS NOT NULL THEN ' USING (' || p.qual || ')' ELSE '' END,
      CASE WHEN p.with_check IS NOT NULL THEN ' WITH CHECK (' || p.with_check || ')' ELSE '' END);
  END LOOP;
END
$reglas$;

DO $storage$
BEGIN
  DROP POLICY IF EXISTS mant_fotos_leer ON storage.objects;
  DROP POLICY IF EXISTS mant_fotos_subir ON storage.objects;
  CREATE POLICY mant_fotos_leer ON storage.objects FOR SELECT TO PUBLIC USING (bucket_id = 'mantenimiento');
  CREATE POLICY mant_fotos_subir ON storage.objects FOR INSERT TO PUBLIC WITH CHECK (bucket_id = 'mantenimiento');
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'No se pudieron restaurar las reglas de storage: hacerlo desde el panel de Supabase.';
END
$storage$;

-- 3. RLS como estaba
DO $rls$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT * FROM rebucret_respaldo.rls_previo_0c2 WHERE NOT rls LOOP
    IF to_regclass('public.' || quote_ident(t.tabla)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t.tabla);
    END IF;
  END LOOP;
END
$rls$;

-- 4. Permisos de antes (solo anon, authenticated y PUBLIC: los de service_role y postgres no se tocaron)
DO $permisos$
DECLARE
  a record;
  v_obj text;
BEGIN
  FOR a IN
    SELECT r.tipo, r.objeto, r.columna, e.privilege_type, e.grantee
    FROM rebucret_respaldo.acl_previo_0c2 r, aclexplode(r.acl) e
    WHERE e.grantee = 0 OR e.grantee IN ('anon'::regrole, 'authenticated'::regrole)
  LOOP
    v_obj := CASE a.tipo
      WHEN 'funcion' THEN 'FUNCTION ' || a.objeto
      WHEN 'secuencia' THEN 'SEQUENCE ' || a.objeto
      ELSE 'TABLE ' || a.objeto END;
    IF (a.tipo = 'funcion' AND to_regprocedure(a.objeto) IS NULL) OR (a.tipo <> 'funcion' AND to_regclass(a.objeto) IS NULL) THEN
      CONTINUE;
    END IF;
    IF a.tipo = 'columna' THEN
      EXECUTE format('GRANT %s (%I) ON TABLE %s TO %s', a.privilege_type, a.columna, a.objeto,
        CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END);
    ELSE
      EXECUTE format('GRANT %s ON %s TO %s', a.privilege_type, v_obj,
        CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END);
    END IF;
  END LOOP;
END
$permisos$;

-- 5. Triggers
DO $triggers$
DECLARE
  f record;
BEGIN
  FOR f IN SELECT * FROM rebucret_respaldo.funciones_previas_0c2 WHERE NOT security_definer LOOP
    IF to_regprocedure(f.firma) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SECURITY INVOKER', f.firma);
      IF f.config IS NULL THEN
        EXECUTE format('ALTER FUNCTION %s RESET search_path', f.firma);
      END IF;
    END IF;
  END LOOP;
END
$triggers$;
DROP TRIGGER IF EXISTS trg_rebucret_actividad_usuario ON public.activity_log;
DROP TRIGGER IF EXISTS trg_rebucret_pedido_creado_por ON public.scheduled_dispatches;

-- 6. Permisos por defecto de Supabase
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- El respaldo (esquema rebucret_respaldo) se deja: sirve para volver a intentar. Para volver a correr la B después
-- de arreglar lo que falló, primero vaciarlo: TRUNCATE rebucret_respaldo.acl_previo_0c2, rebucret_respaldo.rls_previo_0c2,
-- rebucret_respaldo.politicas_previas_0c2, rebucret_respaldo.funciones_previas_0c2;
