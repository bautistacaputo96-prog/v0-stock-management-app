-- Fase 0c-2 · Migración A (24/11/2026) · NO APLICADA. Se corre ANTES de publicar la rama fix/seguridad-rls: la ruta
-- nueva de /api/alertas/stock-cero pide el secreto que esta migración hace mandar al trigger (si se publica antes,
-- los avisos en el momento dan 401 hasta correrla; el cron diario los manda igual).
-- Con el código de hoy (main) es segura: la tabla y las funciones nuevas nadie las usa todavía, y el header de más
-- que manda el trigger la ruta vieja lo ignora. Especificación: docs/migracion-loop/fase-0c.md,
-- "0c-2 · Especificación técnica", puntos 6, 7 y 10.
--
-- Qué hace:
-- 1. Freno a la adivinación de contraseñas en el login: tabla `ingreso_intentos` (solo el servidor la ve) y tres
--    funciones que usa POST /api/sesion/ingresar con la clave de servicio:
--      ingreso_reservar(user, ip)   → antes de verificar la contraseña: ¿puede probar? Si puede, anota el intento.
--                                     Límites en 15 minutos: misma persona y mismo lugar 5; mismo lugar (cualquier
--                                     persona) 50. NO hay límite por persona sola: los ids son públicos y alguien de
--                                     afuera podría frenar al plantista (lo que se sacó el 04/11/2026).
--                                     Con candado (pg_advisory_xact_lock): pedidos en paralelo cuentan todos.
--      ingreso_exitoso(user, ip)    → entró bien: borra los intentos de esa persona en ese lugar.
--      ingreso_desbloquear(user)    → un gerencial lo destraba desde Usuarios (y al dar contraseña provisoria):
--                                     borra sus intentos y los de los lugares (IP) desde donde probó.
--    Se guardan solo id de usuario, IP y hora. Nunca la contraseña. Lo de más de un día se borra solo.
-- 2. Aviso de stock en cero: el trigger de `materials` llama a /api/alertas/stock-cero con el secreto del cron
--    (el mismo `cron_secret` del Vault que ya usan las pasadas de pg_cron). La ruta, desde la rama
--    fix/seguridad-rls, pide ese secreto. Mandar el header de más a la versión vieja de la ruta no cambia nada.
--
-- 3. Tabla `sesiones_cerradas`: "Salir" anota la sesión de ese equipo y desde la migración B la base deja de aceptar
--    su token (sin cerrar las sesiones de la persona en otros equipos). Solo el servidor la ve.
--
-- Qué pasa con los datos ya cargados: nada. Tablas nuevas vacías; el trigger hace lo mismo que antes más un header.
--
-- Vuelta atrás:
--   DROP FUNCTION IF EXISTS public.ingreso_reservar(uuid, text), public.ingreso_exitoso(uuid, text),
--     public.ingreso_desbloquear(uuid), public._ingreso_espera(integer, timestamptz[]);
--   DROP TABLE IF EXISTS public.ingreso_intentos;   -- el login sigue andando, sin freno
--   (sesiones_cerradas: no borrarla si ya se corrió la B, que la lee; sin la B se puede borrar)
--   (el trigger con el header se puede dejar: sin la rama nueva el header se ignora)

BEGIN;

-- ── 1. Intentos de ingreso ────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ingreso_intentos (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid,                       -- sin FK: también se cuentan ids que no existen
  ip         text NOT NULL,
  creado_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ingreso_intentos_creado_idx ON public.ingreso_intentos (creado_at);
CREATE INDEX IF NOT EXISTS ingreso_intentos_user_idx ON public.ingreso_intentos (user_id, creado_at);
CREATE INDEX IF NOT EXISTS ingreso_intentos_ip_idx ON public.ingreso_intentos (ip, creado_at);

COMMENT ON TABLE public.ingreso_intentos IS
  'Fase 0c-2: intentos de ingreso (solo id, IP y hora) para el freno por intentos del login. Solo el servidor.';

ALTER TABLE public.ingreso_intentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ingreso_intentos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ingreso_intentos TO service_role;

-- Segundos que faltan para poder probar de nuevo: si hay `p_limite` o más intentos en la ventana (horas de más
-- nueva a más vieja), hasta que el intento número `p_limite` cumpla 15 minutos. Si no, 0.
CREATE OR REPLACE FUNCTION public._ingreso_espera(p_limite integer, p_horas timestamptz[])
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN coalesce(array_length(p_horas, 1), 0) < p_limite THEN 0
    ELSE greatest(0, ceil(extract(epoch FROM (p_horas[p_limite] + interval '15 minutes') - now()))::integer)
  END
$$;

CREATE OR REPLACE FUNCTION public.ingreso_reservar(p_user_id uuid, p_ip text)
RETURNS TABLE (permitido boolean, espera_seg integer, intento_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ip     text := left(coalesce(nullif(btrim(p_ip), ''), 'desconocida'), 64);
  v_desde  timestamptz := now() - interval '15 minutes';
  v_espera integer := 0;
  v_id     bigint;
BEGIN
  -- Un ingreso a la vez (son pocos): así los pedidos en paralelo no se saltean el conteo
  PERFORM pg_advisory_xact_lock(hashtext('rebucret_ingreso_intentos'));

  DELETE FROM public.ingreso_intentos WHERE creado_at < now() - interval '1 day';

  -- Mismo lugar, cualquier persona: 50 (la planta sale a internet por una sola IP: tiene que ser alto)
  v_espera := greatest(v_espera, public._ingreso_espera(50, ARRAY(
    SELECT creado_at FROM public.ingreso_intentos WHERE ip = v_ip AND creado_at >= v_desde ORDER BY creado_at DESC)));

  IF p_user_id IS NOT NULL THEN
    -- Misma persona y mismo lugar: 5
    v_espera := greatest(v_espera, public._ingreso_espera(5, ARRAY(
      SELECT creado_at FROM public.ingreso_intentos
      WHERE user_id = p_user_id AND ip = v_ip AND creado_at >= v_desde ORDER BY creado_at DESC)));
  END IF;

  IF v_espera > 0 THEN
    RETURN QUERY SELECT false, v_espera, NULL::bigint;
    RETURN;
  END IF;

  -- Se anota antes de verificar la contraseña (cuenta como error hasta que ingreso_exitoso lo borre)
  INSERT INTO public.ingreso_intentos (user_id, ip) VALUES (p_user_id, v_ip) RETURNING id INTO v_id;
  RETURN QUERY SELECT true, 0, v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ingreso_exitoso(p_user_id uuid, p_ip text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM public.ingreso_intentos
  WHERE user_id = p_user_id AND ip = left(coalesce(nullif(btrim(p_ip), ''), 'desconocida'), 64)
$$;

CREATE OR REPLACE FUNCTION public.ingreso_desbloquear(p_user_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Sus intentos y los de los lugares (IP) desde donde probó: si la planta quedó frenada por IP, también se destraba
  WITH b AS (
    DELETE FROM public.ingreso_intentos
    WHERE user_id = p_user_id
       OR ip IN (SELECT i.ip FROM public.ingreso_intentos i WHERE i.user_id = p_user_id)
    RETURNING 1)
  SELECT count(*)::integer FROM b
$$;

REVOKE ALL ON FUNCTION public._ingreso_espera(integer, timestamptz[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ingreso_reservar(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ingreso_exitoso(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ingreso_desbloquear(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ingreso_espera(integer, timestamptz[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.ingreso_reservar(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ingreso_exitoso(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ingreso_desbloquear(uuid) TO service_role;

-- ── 1b. Sesiones cerradas con "Salir" ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sesiones_cerradas (
  sid        text PRIMARY KEY,           -- id de la sesión del equipo (va en la cookie y en el token)
  user_id    uuid,
  cerrada_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sesiones_cerradas_at_idx ON public.sesiones_cerradas (cerrada_at);
COMMENT ON TABLE public.sesiones_cerradas IS
  'Fase 0c-2: sesiones cerradas con Salir (su cookie y su token para la base dejan de valer). Solo el servidor.';
ALTER TABLE public.sesiones_cerradas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sesiones_cerradas FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.sesiones_cerradas TO service_role;

-- ── 2. Aviso de stock en cero con el secreto del cron ─────────────────────────────────────────────────────────
-- Igual que la versión de 202610051930 (pg_get_functiondef de producción del 24/11/2026), más el header
-- Authorization con el `cron_secret` del Vault (como las pasadas de pg_cron). Si el secreto no está, va vacío y
-- la ruta lo rechaza: el mail lo manda igual el cron diario de Vercel.
CREATE OR REPLACE FUNCTION public.trg_alerta_stock_cero()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.current_stock IS NOT DISTINCT FROM OLD.current_stock THEN
    RETURN NEW;
  END IF;

  IF NEW.current_stock <= 0 AND coalesce(OLD.current_stock, 1) > 0 AND public._material_controla_stock(NEW.id) THEN
    INSERT INTO public.alertas_stock (material_id, plant_id, stock_al_alertar)
    VALUES (NEW.id, NEW.plant_id, NEW.current_stock)
    ON CONFLICT (material_id) WHERE resuelto_at IS NULL DO NOTHING;
    -- El mail sale aparte; si el llamado falla, lo manda el cron diario. Nunca frena el despacho.
    BEGIN
      PERFORM net.http_post(
        url := 'https://www.produccionrebucret.com/api/alertas/stock-cero',
        body := '{}'::jsonb,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'), '')
        )
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  ELSIF NEW.current_stock > 0 THEN
    UPDATE public.alertas_stock SET resuelto_at = now()
    WHERE material_id = NEW.id AND resuelto_at IS NULL;
  END IF;

  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Control después de correrla:
--   SELECT * FROM public.ingreso_reservar(NULL, 'prueba-manual');   -- permitido = true (y deja una fila)
--   DELETE FROM public.ingreso_intentos WHERE ip = 'prueba-manual';
--   SELECT has_table_privilege('anon', 'public.ingreso_intentos', 'SELECT');  -- false
