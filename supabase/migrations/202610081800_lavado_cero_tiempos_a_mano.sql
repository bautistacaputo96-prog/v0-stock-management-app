-- Tiempos GPS en la programación · lavado en 0 y tiempos reales de planta corregidos a mano (Bautista, 08/10/2026)
-- Especificación: docs/migracion-loop/tiempos-gps-programacion.md
--
-- Se puede correr más de una vez. Compatible con el front de main y con el de esta rama.
--
-- 1. plants.t_lavado_min puede ser 0 (antes el CHECK pedía > 0). Bautista: "todavía no hacemos lavado, dejalo en 0".
--    Se pone en 0 en Hudson (estaba en 10) y en Canning (estaba en 1), y queda en Actividad.
--    EFECTO: la programación calcula para TODOS (también en main y sin el interruptor de funciones nuevas) un ciclo
--    de camión más corto: el camión sale de obra apenas termina de descargar. En Hudson, 10 min menos por viaje
--    (vuelve antes a planta y puede tomar el viaje siguiente antes); en Canning, 1 min menos. No cambia ningún
--    viaje ya guardado ni ningún despacho: los viajes se recalculan solo cuando se edita el pedido o se ordena el
--    día. Con los tiempos reales del GPS, el tiempo en obra medido entero pasa a contar como descarga.
--
-- 2. plants.tiempos_a_mano (jsonb, por defecto {}): los tiempos reales de la planta que un gerencial corrigió a mano
--    en Programación › Día › "Tiempos y camiones". Claves posibles (minutos):
--      espera_planta_min      espera en planta después de volver, antes de cargar (>= 0)
--      descarga_directa_min   descarga directa por camión de 8 m³ (> 0)
--      descarga_bomba_min     descarga con bomba por camión de 8 m³ (> 0)
--    Si una clave está, le gana al GPS; si no está, "automático" (el GPS, o el t_descarga_* de la planta si no hay
--    datos). Las plantas existentes quedan con {} = todo automático, como hasta hoy. Solo lo usa el motor de viajes
--    con los tiempos reales (con el interruptor); el resto de las pantallas no lo lee.
--
-- Permisos como el resto de plants (sin RLS; la seguridad la pone la 0c-2).

-- 1 · Lavado puede ser 0
ALTER TABLE public.plants DROP CONSTRAINT IF EXISTS plants_t_lavado_min_check;
ALTER TABLE public.plants ADD CONSTRAINT plants_t_lavado_min_check CHECK (t_lavado_min >= 0);

-- 2 · Tiempos reales corregidos a mano
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS tiempos_a_mano jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.plants DROP CONSTRAINT IF EXISTS plants_tiempos_a_mano_check;
ALTER TABLE public.plants ADD CONSTRAINT plants_tiempos_a_mano_check CHECK (
  jsonb_typeof(tiempos_a_mano) = 'object'
  AND (NOT tiempos_a_mano ? 'espera_planta_min' OR (jsonb_typeof(tiempos_a_mano -> 'espera_planta_min') = 'number' AND (tiempos_a_mano ->> 'espera_planta_min')::numeric >= 0))
  AND (NOT tiempos_a_mano ? 'descarga_directa_min' OR (jsonb_typeof(tiempos_a_mano -> 'descarga_directa_min') = 'number' AND (tiempos_a_mano ->> 'descarga_directa_min')::numeric > 0))
  AND (NOT tiempos_a_mano ? 'descarga_bomba_min' OR (jsonb_typeof(tiempos_a_mano -> 'descarga_bomba_min') = 'number' AND (tiempos_a_mano ->> 'descarga_bomba_min')::numeric > 0))
);
COMMENT ON COLUMN public.plants.t_lavado_min IS 'Minutos en obra después de descargar (lavado, remito, salida). 0 = no se lava en obra (desde 08/10/2026).';
COMMENT ON COLUMN public.plants.tiempos_a_mano IS 'Tiempos reales de la planta corregidos a mano (espera_planta_min, descarga_directa_min, descarga_bomba_min): le ganan al GPS. {} = automático.';

-- 3 · Lavado en 0 en Hudson y Canning, con Actividad (solo si todavía no estaba en 0: la segunda corrida no hace nada)
WITH antes AS (
  SELECT id, name, t_lavado_min AS lavado FROM public.plants
  WHERE name IN ('Hudson', 'Canning') AND t_lavado_min IS DISTINCT FROM 0
  FOR UPDATE
), cambiadas AS (
  UPDATE public.plants p SET t_lavado_min = 0
  FROM antes a WHERE p.id = a.id
  RETURNING p.id, p.name, a.lavado
)
INSERT INTO public.activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
SELECT 'Sistema (migración)', 'editar', 'planta', c.id::text, c.name, c.id,
       jsonb_build_object('Lavado (min)', format('%s → 0', c.lavado), 'Motivo', 'Bautista 08/10/2026: todavía no hacemos lavado')
FROM cambiadas c;
