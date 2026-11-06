-- Ingresos de materia prima desde Zomatik: las pasadas con pg_cron (docs/specs/2026-11-05-ingresos-mp-desde-zomatik.md, 5.2)
-- SIN APLICAR. Se aplica DESPUÉS de unificar con main y publicar: antes, la ruta no existe en producción (daría 404).
-- Va después de 202611061000_ingresos_mp_zomatik.sql.
--
--   mp-ingresos-pasada  cada 30 min, a los :05 y :35, de 06:05 a 20:35 de Argentina (09:05 a 23:35 UTC). La ruta
--                       saltea las de 16:05 y 16:35 (es la hora del control diario). Lee los últimos 15 días.
--   mp-ingresos-noche   05:05 de Argentina (08:05 UTC): la lectura completa (la ventana del control).
-- Caen entre dos pasadas de la NP (:00, :10…) y no chocan con zomatik/leer (03:30) ni np/procesar (07:00).
--
-- Usa el mismo secreto de Vault que zomatik-np-pasada y armado-dia-pasada ('cron_secret'). Sin el secreto, la ruta la
-- rechaza (401) y no hace nada. Con la importación apagada (sin la fila en integraciones) solo lee Zomatik.
-- Se puede correr dos veces (saca los jobs anteriores con el mismo nombre).
-- Vuelta atrás:
--   SELECT cron.unschedule('mp-ingresos-pasada');
--   SELECT cron.unschedule('mp-ingresos-noche');
BEGIN;
SET LOCAL lock_timeout = '3s';
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('mp-ingresos-pasada', 'mp-ingresos-noche');

SELECT cron.schedule(
  'mp-ingresos-pasada',
  '5,35 9-23 * * *',
  $cron$
    SELECT net.http_get(
      url := 'https://www.produccionrebucret.com/api/ingresos-zomatik/pasada',
      headers := jsonb_build_object('Authorization', 'Bearer ' || coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'), '')),
      timeout_milliseconds := 120000
    );
  $cron$
);

SELECT cron.schedule(
  'mp-ingresos-noche',
  '5 8 * * *',
  $cron$
    SELECT net.http_get(
      url := 'https://www.produccionrebucret.com/api/ingresos-zomatik/pasada?completa=1',
      headers := jsonb_build_object('Authorization', 'Bearer ' || coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'), '')),
      timeout_milliseconds := 120000
    );
  $cron$
);
COMMIT;
