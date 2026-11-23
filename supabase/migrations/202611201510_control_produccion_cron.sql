-- Control cruzado del despacho: la lectura de Zomatik de la mañana con pg_cron — SIN APLICAR.
-- Se aplica DESPUÉS de unificar con main y publicar: antes, el GET de /api/control-stock/actualizar no existe en
-- producción (daría 405). Va después de 202611201500_control_produccion.sql.
-- Especificación: docs/specs/2026-11-20-control-cruzado-despacho-zomatik.md (secciones 9 y 11).
--
--   control-despacho-lectura  08:42 y 09:42 UTC = 05:42 y 06:42 de Argentina. Lee lo que no se leyó hoy: el reporte
--                             de producción y después MOVIMIENTOS STOCK (los 5 materiales en Canning y Hudson), para
--                             que el mail de las 16:25 compare hasta ayer completo. A las 06:42, si ya está todo
--                             leído, no hace nada. Solo lee de Zomatik (lista cerrada).
-- Cae lejos de mp-ingresos-noche (08:05 UTC) y entre pasadas de la NP (:40 y :50); si el robot está ocupado, la ruta
-- espera hasta 20 s el turno y, si no lo consigue, queda para el reintento de las 06:42.
--
-- Usa el mismo secreto de Vault que mp-ingresos-pasada ('cron_secret'). Sin el secreto, la ruta lo rechaza (401) y no
-- hace nada. Se puede correr dos veces (saca el job anterior con el mismo nombre).
--
-- Qué pasa con los datos ya cargados: NADA. Solo agrega un job de pg_cron; no toca ninguna tabla.
-- Vuelta atrás:
--   SELECT cron.unschedule('control-despacho-lectura');
BEGIN;
SET LOCAL lock_timeout = '3s';
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'control-despacho-lectura';

SELECT cron.schedule(
  'control-despacho-lectura',
  '42 8,9 * * *',
  $cron$
    SELECT net.http_get(
      url := 'https://www.produccionrebucret.com/api/control-stock/actualizar',
      headers := jsonb_build_object('Authorization', 'Bearer ' || coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'), '')),
      timeout_milliseconds := 300000
    );
  $cron$
);
COMMIT;
