-- Carga de planta · muestra al final de la carga y espera en cola (respuestas de Bautista 21/10/2026 · 5)
--
-- Especificación: docs/migracion-loop/carga-planta.md, punto 22. Va ENCIMA de 202610211800_carga_planta.sql, que ya
-- está aplicada en producción (21/10, 11:44): por eso es un archivo aparte y no se toca el anterior.
--
--   cargas.muestra_pedida   la casilla "Sacar muestra a este camión" de la Entrega (solo un aviso para la planta).
--   cargas.muestra          la respuesta a "¿Se sacó muestra?" al terminar: {tomada, numero, asentamiento, por, at}.
--                           Las probetas NO se crean acá: las crea la pantalla con el mismo camino que "Agregar
--                           muestra" del Historial (lib/muestra.ts), sobre el despacho. El trigger
--                           trigger_create_test_cylinders corre solo al insertar el despacho, así que no interviene.
--   cargas_tiempos          suma min_espera_cola: del despacho (hora fija del remito) al inicio de la carga.
--
-- Qué pasa con lo cargado: las cargas que ya existen quedan con muestra_pedida = false y muestra nula (sin
-- respuesta). La vista se reemplaza agregando la columna al final: sus columnas de antes no cambian.
-- Compatible con el front que ya está: no lee estas columnas. Se puede correr más de una vez.

ALTER TABLE public.cargas
  ADD COLUMN IF NOT EXISTS muestra_pedida boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS muestra jsonb;
COMMENT ON COLUMN public.cargas.muestra_pedida IS 'Aviso de la Entrega: "Sacar muestra a este camión".';
COMMENT ON COLUMN public.cargas.muestra IS '"¿Se sacó muestra?" al terminar: {tomada, numero, asentamiento, por, at}. Las probetas van por el despacho.';

CREATE OR REPLACE VIEW public.cargas_tiempos WITH (security_invoker = true) AS
  SELECT c.id AS carga_id,
         c.dispatch_id,
         c.puesto_id,
         c.plant_id,
         c.simulada,
         c.origen,
         g.llegada_planta_previa AS llegada_planta,
         d.created_at            AS despachado_at,
         d.dispatch_date         AS salio_a_las,
         c.bajada_at,
         c.inicio_at,
         c.fin_at,
         round(extract(epoch FROM (c.fin_at - c.inicio_at)) / 60.0, 1)                  AS min_carga,
         g.salida_planta,
         round(extract(epoch FROM (g.salida_planta - c.fin_at)) / 60.0, 1)              AS min_espera_salida,
         round(extract(epoch FROM (c.inicio_at - g.llegada_planta_previa)) / 60.0, 1)   AS min_espera_antes,
         -- secuencia A: del despacho (hora fija del remito) al inicio de la carga
         round(extract(epoch FROM (c.inicio_at - d.created_at)) / 60.0, 1)              AS min_espera_cola
    FROM public.cargas c
    LEFT JOIN public.dispatches d ON d.id = c.dispatch_id
    LEFT JOIN public.viajes_gps g ON g.dispatch_id = c.dispatch_id
   WHERE c.completa_carga_id IS NULL;
REVOKE ALL ON TABLE public.cargas_tiempos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.cargas_tiempos TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
