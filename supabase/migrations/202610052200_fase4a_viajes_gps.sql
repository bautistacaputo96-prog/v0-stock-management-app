-- Fase 4a · Tiempos reales con el GPS: viajes reconstruidos desde el historial de Wialon (B-Track)
--
-- Solo agrega dos tablas. No toca ninguna existente. Se puede correr más de una vez.
--
--   viajes_gps             un viaje de un mixer: salida de planta → obra → salida de obra → vuelta a planta,
--                          con los minutos de cada tramo, km, tiempo y ralentí en planta, paradas fuera de obra
--                          y el cruce con su remito (dispatch_id, puede ser nulo = viaje sin remito).
--   gps_reconstrucciones   registro de cada llamada a /api/gps/reconstruir (rango, simulación, origen, resultado).
--                          Sirve de freno: una llamada manual que repite un rango antes de 5 min se rechaza.
--
-- La llena /api/gps/reconstruir (cron diario y carga histórica): por camión, primero hace upsert de los viajes
-- nuevos (índice único mixer_id + salida_planta) y después borra los del rango que quedaron sin tocar, así un
-- error nunca deja un camión sin viajes.
--
-- Las ubicaciones aprendidas de las obras se guardan en construction_sites.gps_lat/gps_lng con
-- gps_source = 'gps_aprendido' (columnas que ya existen); nunca pisan una ubicación cargada a mano.
--
-- Permisos como el resto de las tablas (sin RLS; la seguridad la pone la fase 0c).

CREATE TABLE IF NOT EXISTS public.viajes_gps (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha                    date NOT NULL,
  mixer_id                 uuid NOT NULL REFERENCES public.mixers(id),
  unidad_wialon            text,
  plant_id_salida          uuid NOT NULL REFERENCES public.plants(id),
  plant_id_vuelta          uuid REFERENCES public.plants(id),
  dispatch_id              uuid REFERENCES public.dispatches(id) ON DELETE SET NULL,
  construction_site_id     uuid REFERENCES public.construction_sites(id) ON DELETE SET NULL,
  llegada_planta_previa    timestamptz,
  salida_planta            timestamptz NOT NULL,
  llegada_obra             timestamptz,
  salida_obra              timestamptz,
  llegada_planta           timestamptz,
  min_en_planta            numeric(7,1),
  min_motor_parado_planta  numeric(7,1),
  min_ida                  numeric(7,1),
  min_obra                 numeric(7,1),
  min_vuelta               numeric(7,1),
  ciclo_min                numeric(7,1),
  km_ida                   numeric(7,1),
  km_vuelta                numeric(7,1),
  parada_lat               numeric(10,7),
  parada_lng               numeric(10,7),
  paradas_extra            jsonb NOT NULL DEFAULT '[]'::jsonb,
  confianza                text CHECK (confianza IS NULL OR confianza IN ('alta', 'media', 'baja')),
  estado                   text NOT NULL DEFAULT 'completo' CHECK (estado IN ('completo', 'incompleto')),
  procesado_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT viajes_gps_mixer_salida_key UNIQUE (mixer_id, salida_planta)
);

CREATE INDEX IF NOT EXISTS viajes_gps_fecha_idx ON public.viajes_gps (fecha);
CREATE INDEX IF NOT EXISTS viajes_gps_dispatch_id_idx ON public.viajes_gps (dispatch_id);
CREATE INDEX IF NOT EXISTS viajes_gps_construction_site_id_idx ON public.viajes_gps (construction_site_id);

COMMENT ON TABLE public.viajes_gps IS 'Fase 4a: viajes reales de los mixers reconstruidos desde el GPS (Wialon). Los escribe /api/gps/reconstruir.';
COMMENT ON COLUMN public.viajes_gps.fecha IS 'Día (hora argentina) de la salida de planta.';
COMMENT ON COLUMN public.viajes_gps.llegada_planta_previa IS 'Llegada a planta antes de salir; si el camión pasó la noche o estuvo guardado, desde que arrancó el motor.';
COMMENT ON COLUMN public.viajes_gps.min_motor_parado_planta IS 'Minutos con motor encendido y velocidad 0 en planta antes de salir (ralentí).';
COMMENT ON COLUMN public.viajes_gps.ciclo_min IS 'Salida de planta → vuelta a planta (sin el tiempo en planta).';
COMMENT ON COLUMN public.viajes_gps.paradas_extra IS 'Paradas fuera de obra ≥3 min: [{desde, hasta, min, lat, lng, tramo: ida|vuelta}].';
COMMENT ON COLUMN public.viajes_gps.confianza IS 'Cruce con el remito: alta (obra ubicada y coincide), media (por orden, obra sin ubicar), baja (cantidades, planta u obra no coinciden). Nula si no tiene remito.';
COMMENT ON COLUMN public.viajes_gps.estado IS 'incompleto: sin señal en movimiento o no volvió a planta (por ejemplo, quedó guardado afuera).';

GRANT ALL ON TABLE public.viajes_gps TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Registro de llamadas (solo el servidor: sin permisos para anon/authenticated)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gps_reconstrucciones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  desde      date NOT NULL,
  hasta      date NOT NULL,
  simular    boolean NOT NULL DEFAULT false,
  origen     text NOT NULL CHECK (origen IN ('cron', 'manual')),
  inicio     timestamptz NOT NULL DEFAULT now(),
  fin        timestamptz,
  resultado  jsonb
);
CREATE INDEX IF NOT EXISTS gps_reconstrucciones_inicio_idx ON public.gps_reconstrucciones (inicio);
COMMENT ON TABLE public.gps_reconstrucciones IS 'Fase 4a: registro y freno de /api/gps/reconstruir (hasta que la 0c ponga autenticación).';

REVOKE ALL ON TABLE public.gps_reconstrucciones FROM anon, authenticated;
GRANT ALL ON TABLE public.gps_reconstrucciones TO service_role;
