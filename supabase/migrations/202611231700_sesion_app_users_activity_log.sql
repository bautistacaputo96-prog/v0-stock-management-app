-- Auditoría de sesión/permisos (23/11/2026) · NO APLICADA. Correr a mano DESPUÉS de unir fix/auditoria-sesion a main
-- (la versión de main de /api/notificar-borrado lee los mails de app_users con la clave pública; la de esta rama
-- usa la clave de servicio. Si se corre antes, los mails de aviso de borrado dejan de salir hasta el merge).
--
-- Qué cambia (solo permisos de anon/authenticated = la clave pública que está en el JS del sitio; ningún dato se toca):
--
-- 1. app_users: se sacan los GRANT residuales de la fase 0c-1, que su propia migración
--    (202610061800, línea 328) dejó "para sacar después del merge":
--      INSERT (name, active, role)   → con la clave pública cualquiera podía dar de alta usuarios activos (aparecen en
--                                      la lista del login y en "Responsable").
--      UPDATE (ve_funciones_nuevas)  → cualquiera podía prenderse (o prenderle a otro) las funciones nuevas en prueba,
--                                      que el servidor usa como llave de /api/carga/* (lib/carga/servidor.ts:24).
--    Hoy el navegador no escribe app_users (todo pasa por /api/usuarios con la clave de servicio).
--
-- 2. app_users: lectura solo de id, name y active (lo único que lee el navegador: components/user-selector.tsx).
--    Antes la clave pública leía también email, tipo, permisos y quién los cambió de todos los usuarios.
--    Las rutas del servidor leen con la clave de servicio y no cambian. Concretus (lib/rebucret.ts) no lee app_users.
--
-- 3. activity_log: la clave pública sigue pudiendo LEER (pantalla Actividad, historial de fórmulas) y AGREGAR
--    (logActivity del navegador y funciones de la base), pero ya no puede MODIFICAR ni BORRAR registros (ningún código
--    lo hace). Así no se puede borrar o reescribir el rastro de quién hizo qué.
--
-- Vuelta atrás:
--   GRANT INSERT (name, active, role), UPDATE (ve_funciones_nuevas) ON public.app_users TO anon, authenticated;
--   GRANT SELECT ON public.app_users TO anon, authenticated;
--   GRANT UPDATE, DELETE, TRUNCATE ON public.activity_log TO anon, authenticated;

BEGIN;

-- 1 y 2: app_users
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.app_users FROM anon, authenticated;
REVOKE SELECT ON public.app_users FROM anon, authenticated;
GRANT SELECT (id, name, active) ON public.app_users TO anon, authenticated;
GRANT ALL ON public.app_users TO service_role;

-- 3: activity_log (solo leer y agregar)
REVOKE UPDATE, DELETE, TRUNCATE ON public.activity_log FROM anon, authenticated;
GRANT SELECT, INSERT ON public.activity_log TO anon, authenticated;
GRANT ALL ON public.activity_log TO service_role;

COMMIT;

-- Control después de correrla (tiene que dar: anon con SELECT solo en id/name/active, sin INSERT/UPDATE en app_users,
-- y en activity_log solo SELECT e INSERT):
--   SELECT grantee, privilege_type, column_name FROM information_schema.column_privileges
--    WHERE table_schema = 'public' AND table_name = 'app_users' AND grantee IN ('anon', 'authenticated') ORDER BY 1, 2, 3;
--   SELECT grantee, privilege_type FROM information_schema.table_privileges
--    WHERE table_schema = 'public' AND table_name IN ('app_users', 'activity_log') AND grantee IN ('anon', 'authenticated') ORDER BY 1, 2;
