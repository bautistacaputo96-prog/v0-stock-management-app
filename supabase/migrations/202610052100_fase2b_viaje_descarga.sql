-- Fase 2b · Tiempo de viaje y de descarga por pedido (ajustes de Bautista al probar el preview, 05/10/2026)
--
-- Solo agrega columnas nulas: compatible con el front de main y con el de la fase 2. Se puede correr más de una vez.
--
--   scheduled_dispatches.viaje_min     minutos de viaje planta → obra para ESTE pedido. Depende de la planta que
--                                      despacha, por eso va en el pedido y no en la obra. Se propone con la ruta
--                                      real (OSRM × 1,3) cuando la obra está ubicada y se puede corregir a mano.
--                                      Nulo = el de la obra (travel_time_minutes) o el de referencia (30).
--   scheduled_dispatches.descarga_min  minutos de descarga por camión de 8 m³ para ESTE pedido (el dato clave del
--                                      ritmo). Nulo = el de la planta según el método (bomba / canaleta).

ALTER TABLE public.scheduled_dispatches
  ADD COLUMN IF NOT EXISTS viaje_min integer CHECK (viaje_min IS NULL OR viaje_min > 0),
  ADD COLUMN IF NOT EXISTS descarga_min integer CHECK (descarga_min IS NULL OR descarga_min > 0);

COMMENT ON COLUMN public.scheduled_dispatches.viaje_min IS 'Minutos de viaje planta → obra de este pedido (nulo: el de la obra o 30)';
COMMENT ON COLUMN public.scheduled_dispatches.descarga_min IS 'Minutos de descarga por camión de 8 m³ de este pedido (nulo: el de la planta según bomba/directo)';
