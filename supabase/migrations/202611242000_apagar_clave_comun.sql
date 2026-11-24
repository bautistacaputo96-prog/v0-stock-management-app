-- Fase 0c-2 · Migración C (24/11/2026) · NO APLICADA. Apagado DEFINITIVO de la contraseña común ("la de siempre").
-- Especificación: docs/migracion-loop/fase-0c.md, "0c-2 · Especificación técnica", punto 8.
--
-- CUÁNDO: cuando todos tengan su contraseña propia. En Usuarios, el recuadro "Primer ingreso pendiente" tiene que
-- estar vacío; a quien falte, darle antes una contraseña provisoria (Usuarios → la persona → "Dar contraseña
-- provisoria"). Al 24/11/2026 falta 1 persona.
-- No depende de las migraciones A ni B: se puede correr antes o después.
--
-- Qué hace:
--   1. permite_clave_comun = false para todos (lo mismo que el botón "Cerrar el ingreso con la contraseña común",
--      incluido cerrar las sesiones abiertas de quien entró con la común y todavía no eligió la suya).
--   2. Una regla en la base (CHECK) que impide volver a prenderla: ni una migración vieja ni un error de código
--      pueden dejar entrar de nuevo con la contraseña común.
-- Desde ahí la común no sirve para nadie. El código la sigue conociendo solo para no dejar elegirla como
-- contraseña nueva.
--
-- Qué pasa con los datos ya cargados: nadie pierde su contraseña. Quien no tenga contraseña propia (si quedara
-- alguno) ve "Todavía no tenés contraseña. Pedile a un gerencial que te la dé desde Usuarios." y un gerencial le da
-- una provisoria.
--
-- Vuelta atrás (solo si alguien quedó afuera y no hay un gerencial a mano; mejor darle una provisoria):
--   ALTER TABLE public.app_user_credenciales DROP CONSTRAINT IF EXISTS app_user_credenciales_sin_clave_comun;
--   UPDATE public.app_user_credenciales SET permite_clave_comun = true WHERE clave_hash IS NULL AND user_id = '<id>';

BEGIN;

DO $aviso$
DECLARE
  v_pend text;
BEGIN
  SELECT string_agg(u.name, ', ' ORDER BY u.name) INTO v_pend
  FROM public.app_user_credenciales c JOIN public.app_users u ON u.id = c.user_id
  WHERE c.clave_hash IS NULL AND u.active IS NOT FALSE;
  IF v_pend IS NOT NULL THEN
    RAISE WARNING 'Sin contraseña propia (no van a poder entrar hasta que un gerencial les dé una provisoria): %', v_pend;
  END IF;
END
$aviso$;

-- Corta las sesiones de quien entró con la común y no eligió la suya (como cerrar_ingreso_clave_comun)
UPDATE public.app_user_credenciales
SET sesion_version = sesion_version + 1, updated_at = now(), actualizado_por = 'Migración 202611242000'
WHERE clave_hash IS NULL AND permite_clave_comun;

UPDATE public.app_user_credenciales
SET permite_clave_comun = false, updated_at = now()
WHERE permite_clave_comun;

ALTER TABLE public.app_user_credenciales DROP CONSTRAINT IF EXISTS app_user_credenciales_sin_clave_comun;
ALTER TABLE public.app_user_credenciales
  ADD CONSTRAINT app_user_credenciales_sin_clave_comun CHECK (permite_clave_comun = false);

COMMENT ON COLUMN public.app_user_credenciales.permite_clave_comun IS
  'Fase 0c-1: podía entrar una vez con la contraseña común. Apagada para siempre desde la migración 202611242000.';

COMMIT;

-- Control: SELECT count(*) FROM public.app_user_credenciales WHERE permite_clave_comun;  -- 0
