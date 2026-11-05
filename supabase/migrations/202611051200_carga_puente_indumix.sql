-- Carga de planta · puente real con Indumix (Canning) · FASE 1, SOLO LECTURA
--
-- Especificación: docs/specs/2026-11-05-puente-indumix.md (punto 3). NO APLICADA: se avisa a Bautista antes.
--
-- Qué agrega o cambia:
--   puestos_carga                + ultimo_latido_at, estado_vivo, version_puente, deriva_reloj_s, info_planta: lo último
--                                  que vio el puente en Indumix y su salud (pantalla /carga).
--   puestos_carga_credenciales   tabla nueva: el sha256 de la clave del puente (una por puesto). RLS prendido SIN
--                                  política y sin permisos para anon y authenticated: el navegador no la puede leer.
--                                  Solo la usa el servidor (service_role).
--   CHECK puestos_carga_indumix_solo_lectura   un puesto Indumix solo puede estar en 'lectura' o 'apagado' y sin kilos
--                                  reales. Nadie lo puede pasar a B o C hasta la migración de la fase 2.
--   Puesto "Canning · Indumix"   sistema 'indumix', etapa 'lectura', ciclo de 2 m³, 20 recetas, con su mapa de salidas
--                                  (igual al del simulador, confirmado con los Txt* de Indumix el 04/11). La Tolva 1
--                                  arranca con Piedra Partida 6/20 (alternativas 6/12 y 6/20): el 03/11 la receta 15
--                                  (6/20) pesó por la Tolva 1.
--   Simulador de Canning         activo = false. cargarPuesto() devuelve el primer puesto ACTIVO de la planta: pasa a
--                                  devolver el real.
--
-- Qué pasa con los datos ya cargados:
--   - El simulador y todo lo suyo (cargas simuladas, recetas armadas, alertas, órdenes en cola) quedan INTACTOS, pero ya
--     no se ven en las pantallas. Se recupera con la vuelta atrás de abajo (activo = true). Las órdenes simuladas que
--     hayan quedado pendientes no bajan a ningún lado.
--   - Efecto visible: los despachos de Canning hechos desde la pantalla nueva DEJAN de mandar órdenes a la cola simulada
--     y el mail "[PLANTA SIMULADA]" a Juan, porque el puesto real está en solo lectura (mandaOrdenes = false).
--   - No cambian despachos, stock, fórmulas, materiales ni permisos. Las cargas reales se crean con simulada = false,
--     origen 'indumix' y estado 'leida'. ajustar_stock_carga sigue sin hacer nada (usa_kilos_reales = false).
--   - Ninguna fila existente cambia, salvo el simulador (activo = false). Las columnas nuevas quedan en NULL.
--   - Conteos que tienen que dar igual antes y después: cargas, recetas_planta y alertas_carga del simulador,
--     dispatches y stock_movements.
--
-- Compatible con main y con el código anterior: nadie lee las columnas nuevas si no están; la app anda igual sin esta
-- migración (no hay puesto Indumix: /carga sigue con el simulador y el mail diario queda igual).
-- Se puede correr más de una vez (IF NOT EXISTS, DROP/ADD CONSTRAINT, ON CONFLICT, WHERE NOT EXISTS).
-- Probarla primero cambiando el COMMIT del final por ROLLBACK.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- Vista en vivo y salud del puente
-- ---------------------------------------------------------------------------
ALTER TABLE public.puestos_carga
  ADD COLUMN IF NOT EXISTS ultimo_latido_at timestamptz,
  ADD COLUMN IF NOT EXISTS estado_vivo      jsonb,
  ADD COLUMN IF NOT EXISTS version_puente   text,
  ADD COLUMN IF NOT EXISTS deriva_reloj_s   int,
  ADD COLUMN IF NOT EXISTS info_planta      jsonb;
COMMENT ON COLUMN public.puestos_carga.estado_vivo IS 'Último estado de Indumix que subió el puente, interpretado por el servidor (lib/carga/indumix.ts).';
COMMENT ON COLUMN public.puestos_carga.deriva_reloj_s IS 'Segundos que el reloj de Indumix va atrasado respecto de la PC del puente.';
COMMENT ON COLUMN public.puestos_carga.info_planta IS 'Nombres de las tolvas en Indumix (Txt*), primer latido y controles del puente.';

-- ---------------------------------------------------------------------------
-- Clave del puente (solo el hash; el navegador no la lee)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.puestos_carga_credenciales (
  puesto_id  uuid PRIMARY KEY REFERENCES public.puestos_carga(id) ON DELETE CASCADE,
  hash       text NOT NULL UNIQUE,
  creada_por text,
  creada_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.puestos_carga_credenciales IS 'sha256 de la clave del puente de cada puesto (rbp_…). Solo la lee el servidor.';
ALTER TABLE public.puestos_carga_credenciales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.puestos_carga_credenciales FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.puestos_carga_credenciales TO service_role;

-- ---------------------------------------------------------------------------
-- El puesto real no sale de solo lectura (hasta la fase 2)
-- ---------------------------------------------------------------------------
ALTER TABLE public.puestos_carga DROP CONSTRAINT IF EXISTS puestos_carga_indumix_solo_lectura;
ALTER TABLE public.puestos_carga ADD CONSTRAINT puestos_carga_indumix_solo_lectura
  CHECK (sistema <> 'indumix' OR (etapa IN ('lectura', 'apagado') AND NOT usa_kilos_reales));

-- ---------------------------------------------------------------------------
-- El puesto real de Canning y su mapa de salidas
-- ---------------------------------------------------------------------------
INSERT INTO public.puestos_carga (plant_id, nombre, sistema, etapa, max_recetas, m3_max_ciclo)
SELECT p.id, 'Canning · Indumix', 'indumix', 'lectura', 20, 2
  FROM public.plants p WHERE p.name = 'Canning'
ON CONFLICT (plant_id, sistema) DO NOTHING;

WITH pu AS (
  SELECT pc.id, pc.plant_id FROM public.puestos_carga pc JOIN public.plants p ON p.id = pc.plant_id
   WHERE p.name = 'Canning' AND pc.sistema = 'indumix'
), mat AS (
  SELECT m.name, m.id FROM public.materials m JOIN pu ON m.plant_id = pu.plant_id
), mapa (salida, nombre_planta, material, unidad, factor, alt) AS (
  VALUES
    ('arido_1',   'PIE 6/20 O 6/12', 'Piedra Partida 6/20',   'kg', 1::numeric,     ARRAY['Piedra Partida 6/12', 'Piedra Partida 6/20']),
    ('arido_2',   'piedra 06',       'Arena Trituración 0/6', 'kg', 1::numeric,     NULL::text[]),
    ('arido_3',   'ARENA',           'Arena Fina',            'kg', 1::numeric,     NULL::text[]),
    ('arido_4',   'PIE 6/20',        'Piedra Partida 6/20',   'kg', 1::numeric,     NULL::text[]),
    ('cemento_1', 'CP 40',           'CPC 40',                'kg', 1::numeric,     NULL::text[]),
    ('cemento_2', 'CP 40',           'CPC 40',                'kg', 1::numeric,     NULL::text[]),
    ('aditivo_1', 'PLASTIF',         'Sikament 90E',          'g',  0.001::numeric, NULL::text[]),
    ('aditivo_2', '(vacío)',         NULL,                    'g',  0.001::numeric, NULL::text[]),
    ('agua',      'Agua',            'Agua',                  'L',  1::numeric,     NULL::text[])
)
INSERT INTO public.puesto_salidas (puesto_id, salida, nombre_planta, material_id, unidad_planta, factor_a_unidad_sistema, alternativas, cambiado_por)
SELECT pu.id, mapa.salida, mapa.nombre_planta, (SELECT mat.id FROM mat WHERE mat.name = mapa.material), mapa.unidad, mapa.factor,
       CASE WHEN mapa.alt IS NULL THEN NULL ELSE ARRAY(SELECT mat.id FROM mat WHERE mat.name = ANY (mapa.alt) ORDER BY mat.name) END,
       'Migración (cargas del 03/11)'
  FROM pu CROSS JOIN mapa
 WHERE NOT EXISTS (SELECT 1 FROM public.puesto_salidas s WHERE s.puesto_id = pu.id AND s.salida = mapa.salida AND s.vigente_hasta IS NULL);

-- ---------------------------------------------------------------------------
-- El simulador de Canning queda apagado (con todos sus datos)
-- ---------------------------------------------------------------------------
UPDATE public.puestos_carga pc
   SET activo = false
  FROM public.plants p
 WHERE p.id = pc.plant_id AND p.name = 'Canning' AND pc.sistema = 'simulador' AND pc.activo;

-- Que la API (PostgREST) vea lo nuevo sin esperar
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ---------------------------------------------------------------------------
-- VUELTA ATRÁS (no se corre: copiar y correr a mano si hace falta)
-- Vuelve a prender el simulador y apaga el puesto real. Los datos del puesto real (cargas leídas, recetas, eventos)
-- quedan guardados; el puesto real no se borra porque sus cargas lo referencian.
-- ---------------------------------------------------------------------------
-- BEGIN;
-- SET LOCAL lock_timeout = '3s';
-- UPDATE public.puestos_carga pc SET activo = true  FROM public.plants p WHERE p.id = pc.plant_id AND p.name = 'Canning' AND pc.sistema = 'simulador';
-- UPDATE public.puestos_carga pc SET activo = false FROM public.plants p WHERE p.id = pc.plant_id AND p.name = 'Canning' AND pc.sistema = 'indumix';
-- DELETE FROM public.puestos_carga_credenciales;   -- la clave del puente deja de andar
-- ALTER TABLE public.puestos_carga DROP CONSTRAINT IF EXISTS puestos_carga_indumix_solo_lectura;
-- -- Opcional (solo si no se va a volver a usar): DROP TABLE public.puestos_carga_credenciales;
-- --   ALTER TABLE public.puestos_carga DROP COLUMN ultimo_latido_at, DROP COLUMN estado_vivo, DROP COLUMN version_puente,
-- --     DROP COLUMN deriva_reloj_s, DROP COLUMN info_planta;
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
