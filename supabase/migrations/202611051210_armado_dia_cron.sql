-- Mail del armado del día: la pasada cada 5 minutos con pg_cron (docs/specs/2026-11-05-dia-unificado-y-mail.md, 5.2)
-- SIN APLICAR. Se aplica DESPUÉS de unificar con main y publicar: antes, la ruta no existe en producción (daría 404
-- cada 5 minutos). Va después de 202611051200_armado_dia_mail.sql.
--
-- Usa el mismo secreto de Vault que zomatik-np-pasada ('cron_secret', ya cargado). Sin el secreto, la ruta la rechaza
-- (401) y no hace nada. Fuera de 17:00–06:00 la pasada termina enseguida, sin leer la base.
-- Para sacarlo: select cron.unschedule('armado-dia-pasada');
-- Se puede correr dos veces (saca el job anterior con el mismo nombre).
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'armado-dia-pasada';

SELECT cron.schedule(
  'armado-dia-pasada',
  '*/5 * * * *',
  $cron$
    SELECT net.http_get(
      url := 'https://www.produccionrebucret.com/api/programacion/armado-dia',
      headers := jsonb_build_object('Authorization', 'Bearer ' || coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'), '')),
      timeout_milliseconds := 60000
    );
  $cron$
);
