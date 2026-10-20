-- Pedidos de hoy en adelante: borrar los minutos de viaje guardados, para que usen la ida real del GPS.
-- Decisión de Bautista (08/10/2026). Se corre UNA vez, el día que se publica la rama loop/tiempos-gps-programacion,
-- fuera del horario de despacho. Especificación: docs/migracion-loop/tiempos-gps-programacion.md.
--
-- Qué toca: scheduled_dispatches.viaje_min = null en los pedidos con llegada desde hoy (00:00 de Argentina) que no
-- estén completos ni cancelados. Esos minutos los puso casi siempre el mapa (fase 2b) y le ganaban al GPS.
-- Con null, el motor usa: la ida real del GPS de la obra desde esa planta (si tiene viajes de 2 días o más), si no
-- travel_time_minutes de la obra, si no 30.
-- Qué NO toca: los viajes ya armados de esos pedidos (se recalculan cuando se edita el pedido, se cambia la hora o
-- se guarda el plan del día), scheduled_departure_time, ni nada de los pedidos pasados, completos o cancelados.
-- Cada pedido tocado queda en Actividad ("Minutos de viaje: X → automático (GPS)").
--
-- Paso 1 (solo mirar): cuántos y cuáles toca.
SELECT count(*) AS pedidos_a_tocar
FROM public.scheduled_dispatches
WHERE viaje_min IS NOT NULL
  AND status NOT IN ('completed', 'cancelled')
  AND scheduled_arrival_time >= (date_trunc('day', now() AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'America/Argentina/Buenos_Aires');

SELECT sd.id, sd.scheduled_arrival_time, p.name AS planta, cs.name AS obra, sd.viaje_min, sd.status
FROM public.scheduled_dispatches sd
LEFT JOIN public.plants p ON p.id = sd.plant_id
LEFT JOIN public.construction_sites cs ON cs.id = sd.construction_site_id
WHERE sd.viaje_min IS NOT NULL
  AND sd.status NOT IN ('completed', 'cancelled')
  AND sd.scheduled_arrival_time >= (date_trunc('day', now() AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'America/Argentina/Buenos_Aires')
ORDER BY sd.scheduled_arrival_time;

-- Paso 2: borrar y dejarlo en Actividad (todo o nada).
BEGIN;
WITH tocados AS (
  UPDATE public.scheduled_dispatches sd SET viaje_min = NULL
  FROM (
    SELECT id, viaje_min AS antes FROM public.scheduled_dispatches
    WHERE viaje_min IS NOT NULL
      AND status NOT IN ('completed', 'cancelled')
      AND scheduled_arrival_time >= (date_trunc('day', now() AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'America/Argentina/Buenos_Aires')
    FOR UPDATE
  ) v
  WHERE sd.id = v.id
  RETURNING sd.id, sd.plant_id, sd.construction_site_id, v.antes
)
INSERT INTO public.activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
SELECT 'Sistema (script)', 'editar', 'pedido', t.id::text, cs.name, t.plant_id,
       jsonb_build_object('Minutos de viaje', format('%s → automático (GPS)', t.antes), 'Motivo', 'Bautista 08/10/2026: los pedidos futuros usan la ida real del GPS')
FROM tocados t LEFT JOIN public.construction_sites cs ON cs.id = t.construction_site_id;
COMMIT;
