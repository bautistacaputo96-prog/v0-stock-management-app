-- Fase 3 · Clasificar los remitos viejos en R (con factura) y X (sin factura) — PARTE B: ESCRIBE
--
-- Especificación: docs/migracion-loop/fase-3.md, punto 14.5. Se corre AL PUBLICAR, después de la migración y
-- de mostrarle a Bautista la Parte A (scripts/fase3-clasificar-remitos-A-lectura.sql).
-- Pone el tipo a todo lo que NO es dudoso, con origen 'script'. No toca los dudosos ni el texto de ningún
-- remito. Muestra el conteo antes y después.
--
-- ⚠ TERMINA EN ROLLBACK: así como está NO GRABA NADA (sirve para ver los conteos).
--   Recién con el OK de Bautista, cambiar el ROLLBACK del final por COMMIT y volver a correrlo.
--
-- Los CTE van MATERIALIZED a propósito: sin eso, el UPDATE recalcula los dudosos por cada fila y tarda minutos
-- (con las tablas bloqueadas). Así tarda unos segundos.
--
-- Las reglas de dudosos son las mismas de la Parte A:
-- Regla (dígitos sin los ceros de adelante: "0841" → 841, "755 HUDSON" → 755):
--   2201 en adelante → X (talonarios de imprenta 00002-00002201…00008200, respuesta de Bautista del 20/10) ·
--   el resto → R.
-- Dudosos (quedan sin tipo y se clasifican a mano desde Historial › filtro "Sin tipo" › Editar):
--   1.  remito vacío o sin dígitos (los despachos por árido o de prueba no llevan tipo y no se listan);
--   2.  más de 5 dígitos (dos números juntos: "780781", "3189-3190-3191");
--   2b. dos grupos de números separados ("0073-2", "3070-2", "3279 3280");
--   3.  4 o 5 dígitos por debajo de 2201;
--   4.  X por encima de 8200, o R por debajo de 600 antes del 01/07/2026 (antes de esa fecha no hay talonario R
--       en los datos: el R de Canning arranca en 0002 el 08/07/2026);
--   5.  letras que no son "HUDSON" ("N°", "R 3110", "3103-A"…), o "HUDSON" en un despacho de Canning;
--   6.  repetidos después de normalizar dentro de la misma planta y el mismo tipo ("755" y "755 HUDSON");
--   6b. salta mucho dentro del mes: no hay otro remito de esa planta y ese tipo, en el mismo mes, a ±50
--       ("2403HUDSON" del 19/10 en Hudson, cuando los X iban por el 4202);
--   7.  el pedido, la obra o el cliente ya dicen un tipo distinto del que da el número.
-- Si hay varios motivos, se muestra el primero.

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';

-- Conteo antes
SELECT 'antes' AS momento,
       count(*) FILTER (WHERE remito_tipo IS NULL) AS sin_tipo,
       count(*) FILTER (WHERE remito_tipo = 'R') AS r,
       count(*) FILTER (WHERE remito_tipo = 'X') AS x
  FROM dispatches WHERE NOT coalesce(is_test_dispatch, false);

WITH b AS MATERIALIZED (
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
), n AS MATERIALIZED (
  -- los que tienen número de hasta 5 dígitos, con su tipo efectivo
  SELECT b.*, b.dig::int AS num, coalesce(b.remito_tipo, b.tipo_num) AS tipo_ef
    FROM b WHERE b.dig IS NOT NULL AND length(b.dig) <= 5
), r AS MATERIALIZED (
  SELECT n.id,
         count(*) OVER (PARTITION BY n.plant_id, n.tipo_ef, n.dig) AS veces,
         -- "salta mucho dentro del mes": no hay otro remito de esa planta y ese tipo, en el mismo mes, a ±50
         NOT EXISTS (SELECT 1 FROM n n2
                      WHERE n2.plant_id = n.plant_id AND n2.tipo_ef = n.tipo_ef AND n2.id <> n.id AND n2.num <> n.num
                        AND date_trunc('month', n2.dispatch_date) = date_trunc('month', n.dispatch_date)
                        AND abs(n2.num - n.num) <= 50) AS aislado
    FROM n
), m AS MATERIALIZED (
  SELECT b.*,
         CASE
           WHEN b.dig IS NULL THEN '1. remito vacío o sin dígitos'
           WHEN length(b.dig) > 5 THEN '2. más de 5 dígitos (¿dos números juntos?)'
           WHEN b.remito ~ '\d[^0-9A-Za-z]+\d' THEN '2b. dos grupos de números ("0073-2", "3279 3280")'
           WHEN length(b.dig) BETWEEN 4 AND 5 AND b.dig::int < 2201 THEN '3. 4 o 5 dígitos por debajo de 2201'
           WHEN b.tipo_num = 'X' AND b.dig::int > 8200 THEN '4. X por encima de 8200'
           WHEN b.tipo_num = 'R' AND b.dig::int < 600 AND b.dispatch_date < '2026-07-01' THEN '4. R por debajo de 600 antes de julio de 2026'
           WHEN b.letras <> '' AND b.letras <> 'HUDSON' THEN '5. letras que no son HUDSON'
           WHEN b.letras = 'HUDSON' AND b.planta <> 'Hudson' THEN '5. HUDSON en un despacho de ' || b.planta
           WHEN r.veces > 1 THEN '6. repetido en la planta y el tipo'
           WHEN r.aislado THEN '6b. salta mucho dentro del mes (no hay otro de esa planta y ese tipo a ±50 en el mes)'
           WHEN b.tipo_def IS NOT NULL AND b.tipo_def <> b.tipo_num THEN '7. el pedido, la obra o el cliente dicen ' || b.tipo_def
         END AS motivo
    FROM b LEFT JOIN r ON r.id = b.id
   WHERE b.remito_tipo IS NULL
)
UPDATE dispatches d
   SET remito_tipo = m.tipo_num, remito_tipo_origen = 'script'
  FROM m
 WHERE d.id = m.id
   AND m.motivo IS NULL
   AND m.tipo_num IS NOT NULL
   AND d.remito_tipo IS NULL;

-- Conteo después (los que quedan sin tipo son exactamente los dudosos de la Parte A)
SELECT 'después' AS momento,
       count(*) FILTER (WHERE remito_tipo IS NULL) AS sin_tipo,
       count(*) FILTER (WHERE remito_tipo = 'R') AS r,
       count(*) FILTER (WHERE remito_tipo = 'X') AS x
  FROM dispatches WHERE NOT coalesce(is_test_dispatch, false);

-- ⚠ Cambiar por COMMIT recién con el OK de Bautista.
ROLLBACK;
