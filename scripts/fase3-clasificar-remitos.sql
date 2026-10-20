-- Fase 3 · Clasificar los remitos viejos en R (con factura) y X (sin factura)
--
-- Especificación: docs/migracion-loop/fase-3.md, punto 14.5 (con las respuestas de Bautista del 20/10/2026:
-- los del 2201 al 3200 también son X; el "HUDSON" no se limpia).
--
-- Se corre AL PUBLICAR, DESPUÉS de la migración 202610201200_fase3_despacho.sql (usa sus funciones
-- _remito_digitos y _remito_tipo_de_numero) y con el OK de Bautista. Dos partes:
--
--   Parte A · SOLO LECTURA. Se corre primero y se le muestra a Bautista: resumen por planta, tipo y mes, y la
--             lista de dudosos (los que NO se clasifican solos).
--   Parte B · ESCRIBE, en una transacción: pone el tipo a todo lo que no es dudoso, con origen 'script'.
--             No toca los dudosos ni el texto de ningún remito. Muestra el conteo antes y después.
--
-- Regla (dígitos sin los ceros de adelante: "0841" → 841, "755 HUDSON" → 755):
--   2201 en adelante → X (talonarios de imprenta 00002-00002201…00008200) · el resto → R.
-- Dudosos (quedan sin tipo y se clasifican a mano desde Historial › filtro "Sin tipo" › Editar):
--   1. remito vacío o sin dígitos (los despachos por árido o de prueba no llevan tipo y no se listan);
--   2. más de 5 dígitos (dos números juntos: "780781", "3189-3190-3191");
--   3. 4 o 5 dígitos por debajo de 2201;
--   4. X por encima de 8200, o R por debajo de 600 antes del 01/07/2026 (antes de esa fecha no hay talonario R
--      en los datos: el R de Canning arranca en 0002 el 08/07/2026);
--   5. letras que no son "HUDSON" ("N°", "R 3110", "3103-A"…), o "HUDSON" en un despacho de Canning;
--   6. repetidos después de normalizar dentro de la misma planta y el mismo tipo ("755" y "755 HUDSON");
--   7. el pedido, la obra o el cliente ya dicen un tipo distinto del que da el número.
-- Si hay varios motivos, se muestra el primero.

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE A · SOLO LECTURA
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

-- A1 · Resumen: lo que se clasificaría, por planta, tipo y mes (para ver que cada serie cae donde tiene que caer)
WITH b AS (
  SELECT d.id, d.dispatch_date, d.plant_id, p.name AS planta, d.remito, d.quantity_m3, d.remito_tipo,
         public._remito_digitos(d.remito) AS dig,
         regexp_replace(upper(coalesce(d.remito, '')), '[^A-ZÁÉÍÓÚÑ]', '', 'g') AS letras,
         public._remito_tipo_de_numero(d.remito) AS tipo_num,
         coalesce(sd.remito_tipo, cs.remito_tipo, cl.remito_tipo) AS tipo_def
    FROM dispatches d
    JOIN plants p ON p.id = d.plant_id
    LEFT JOIN scheduled_dispatches sd ON sd.id = d.scheduled_dispatch_id
    LEFT JOIN construction_sites cs ON cs.id = d.construction_site_id
    LEFT JOIN clients cl ON cl.id = d.client_id
   WHERE NOT coalesce(d.is_test_dispatch, false)
), r AS (
  SELECT b.*, count(*) OVER (PARTITION BY plant_id, coalesce(remito_tipo, tipo_num), dig) AS veces
    FROM b WHERE dig IS NOT NULL AND length(dig) <= 5
), m AS (
  SELECT b.*,
         CASE
           WHEN b.dig IS NULL THEN '1. remito vacío o sin dígitos'
           WHEN length(b.dig) > 5 THEN '2. más de 5 dígitos (¿dos números juntos?)'
           WHEN length(b.dig) BETWEEN 4 AND 5 AND b.dig::int < 2201 THEN '3. 4 o 5 dígitos por debajo de 2201'
           WHEN b.tipo_num = 'X' AND b.dig::int > 8200 THEN '4. X por encima de 8200'
           WHEN b.tipo_num = 'R' AND b.dig::int < 600 AND b.dispatch_date < '2026-07-01' THEN '4. R por debajo de 600 antes de julio de 2026'
           WHEN b.letras <> '' AND b.letras <> 'HUDSON' THEN '5. letras que no son HUDSON'
           WHEN b.letras = 'HUDSON' AND b.planta <> 'Hudson' THEN '5. HUDSON en un despacho de ' || b.planta
           WHEN r.veces > 1 THEN '6. repetido en la planta y el tipo'
           WHEN b.tipo_def IS NOT NULL AND b.tipo_def <> b.tipo_num THEN '7. el pedido, la obra o el cliente dicen ' || b.tipo_def
         END AS motivo
    FROM b LEFT JOIN r ON r.id = b.id
   WHERE b.remito_tipo IS NULL
)
SELECT planta, coalesce(CASE WHEN motivo IS NULL THEN tipo_num END, 'dudoso') AS tipo_propuesto,
       to_char(dispatch_date, 'YYYY-MM') AS mes, count(*) AS cantidad,
       min(CASE WHEN motivo IS NULL THEN dig::int END) AS minimo, max(CASE WHEN motivo IS NULL THEN dig::int END) AS maximo,
       round(sum(quantity_m3), 1) AS m3
  FROM m
 GROUP BY 1, 2, 3
 ORDER BY 1, 2, 3;

-- A2 · Dudosos, uno por uno (NO se clasifican solos)
WITH b AS (
  SELECT d.id, d.dispatch_date, d.plant_id, p.name AS planta, d.remito, d.quantity_m3, d.remito_tipo,
         c.name AS cliente,
         public._remito_digitos(d.remito) AS dig,
         regexp_replace(upper(coalesce(d.remito, '')), '[^A-ZÁÉÍÓÚÑ]', '', 'g') AS letras,
         public._remito_tipo_de_numero(d.remito) AS tipo_num,
         coalesce(sd.remito_tipo, cs.remito_tipo, cl.remito_tipo) AS tipo_def
    FROM dispatches d
    JOIN plants p ON p.id = d.plant_id
    LEFT JOIN clients c ON c.id = d.client_id
    LEFT JOIN scheduled_dispatches sd ON sd.id = d.scheduled_dispatch_id
    LEFT JOIN construction_sites cs ON cs.id = d.construction_site_id
    LEFT JOIN clients cl ON cl.id = d.client_id
   WHERE NOT coalesce(d.is_test_dispatch, false)
), r AS (
  SELECT b.*, count(*) OVER (PARTITION BY plant_id, coalesce(remito_tipo, tipo_num), dig) AS veces
    FROM b WHERE dig IS NOT NULL AND length(dig) <= 5
), m AS (
  SELECT b.*,
         CASE
           WHEN b.dig IS NULL THEN '1. remito vacío o sin dígitos'
           WHEN length(b.dig) > 5 THEN '2. más de 5 dígitos (¿dos números juntos?)'
           WHEN length(b.dig) BETWEEN 4 AND 5 AND b.dig::int < 2201 THEN '3. 4 o 5 dígitos por debajo de 2201'
           WHEN b.tipo_num = 'X' AND b.dig::int > 8200 THEN '4. X por encima de 8200'
           WHEN b.tipo_num = 'R' AND b.dig::int < 600 AND b.dispatch_date < '2026-07-01' THEN '4. R por debajo de 600 antes de julio de 2026'
           WHEN b.letras <> '' AND b.letras <> 'HUDSON' THEN '5. letras que no son HUDSON'
           WHEN b.letras = 'HUDSON' AND b.planta <> 'Hudson' THEN '5. HUDSON en un despacho de ' || b.planta
           WHEN r.veces > 1 THEN '6. repetido en la planta y el tipo'
           WHEN b.tipo_def IS NOT NULL AND b.tipo_def <> b.tipo_num THEN '7. el pedido, la obra o el cliente dicen ' || b.tipo_def
         END AS motivo
    FROM b LEFT JOIN r ON r.id = b.id
   WHERE b.remito_tipo IS NULL
)
SELECT motivo, id, to_char(dispatch_date, 'DD/MM/YYYY HH24:MI') AS fecha, planta, remito, cliente, quantity_m3 AS m3,
       coalesce(tipo_num, '-') AS tipo_por_numero
  FROM m
 WHERE motivo IS NOT NULL
 ORDER BY motivo, planta, dig, dispatch_date;

ROLLBACK;

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE B · ESCRIBE (con el OK de Bautista, después de mirar la Parte A)
-- Para probarla sin grabar, cambiar el COMMIT del final por ROLLBACK.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

-- Conteo antes
SELECT 'antes' AS momento,
       count(*) FILTER (WHERE remito_tipo IS NULL) AS sin_tipo,
       count(*) FILTER (WHERE remito_tipo = 'R') AS r,
       count(*) FILTER (WHERE remito_tipo = 'X') AS x
  FROM dispatches WHERE NOT coalesce(is_test_dispatch, false);

WITH b AS (
  SELECT d.id, d.dispatch_date, d.plant_id, p.name AS planta, d.remito, d.remito_tipo,
         public._remito_digitos(d.remito) AS dig,
         regexp_replace(upper(coalesce(d.remito, '')), '[^A-ZÁÉÍÓÚÑ]', '', 'g') AS letras,
         public._remito_tipo_de_numero(d.remito) AS tipo_num,
         coalesce(sd.remito_tipo, cs.remito_tipo, cl.remito_tipo) AS tipo_def
    FROM dispatches d
    JOIN plants p ON p.id = d.plant_id
    LEFT JOIN scheduled_dispatches sd ON sd.id = d.scheduled_dispatch_id
    LEFT JOIN construction_sites cs ON cs.id = d.construction_site_id
    LEFT JOIN clients cl ON cl.id = d.client_id
   WHERE NOT coalesce(d.is_test_dispatch, false)
), r AS (
  SELECT b.*, count(*) OVER (PARTITION BY plant_id, coalesce(remito_tipo, tipo_num), dig) AS veces
    FROM b WHERE dig IS NOT NULL AND length(dig) <= 5
), m AS (
  SELECT b.id, b.tipo_num,
         CASE
           WHEN b.dig IS NULL THEN 1
           WHEN length(b.dig) > 5 THEN 2
           WHEN length(b.dig) BETWEEN 4 AND 5 AND b.dig::int < 2201 THEN 3
           WHEN b.tipo_num = 'X' AND b.dig::int > 8200 THEN 4
           WHEN b.tipo_num = 'R' AND b.dig::int < 600 AND b.dispatch_date < '2026-07-01' THEN 4
           WHEN b.letras <> '' AND b.letras <> 'HUDSON' THEN 5
           WHEN b.letras = 'HUDSON' AND b.planta <> 'Hudson' THEN 5
           WHEN r.veces > 1 THEN 6
           WHEN b.tipo_def IS NOT NULL AND b.tipo_def <> b.tipo_num THEN 7
         END AS dudoso
    FROM b LEFT JOIN r ON r.id = b.id
   WHERE b.remito_tipo IS NULL
)
UPDATE dispatches d
   SET remito_tipo = m.tipo_num, remito_tipo_origen = 'script'
  FROM m
 WHERE d.id = m.id
   AND m.dudoso IS NULL
   AND m.tipo_num IS NOT NULL
   AND d.remito_tipo IS NULL;

-- Conteo después (los que quedan sin tipo son exactamente los dudosos de la Parte A)
SELECT 'después' AS momento,
       count(*) FILTER (WHERE remito_tipo IS NULL) AS sin_tipo,
       count(*) FILTER (WHERE remito_tipo = 'R') AS r,
       count(*) FILTER (WHERE remito_tipo = 'X') AS x
  FROM dispatches WHERE NOT coalesce(is_test_dispatch, false);

COMMIT;
