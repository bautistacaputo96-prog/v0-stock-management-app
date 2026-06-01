-- Link existing granulometria tests to stock entries based on remito number
-- This fixes entries that were created before the automatic linking was implemented

UPDATE stock_entries se
SET granulometry_test_id = gt.id
FROM granulometria_tests gt
WHERE se.remito = gt.remito
  AND se.material_id IS NOT NULL
  AND se.granulometry_test_id IS NULL
  AND gt.remito IS NOT NULL;
