-- Update production records from January 2025 to January 2026
-- This script updates all production-related tables

-- Update production_entries (partes de producción)
UPDATE production_entries
SET 
  date = date + INTERVAL '1 year',
  created_at = created_at + INTERVAL '1 year',
  updated_at = NOW()
WHERE date >= '2025-01-01' AND date < '2025-02-01';

-- Update mp_entries (materia prima)
UPDATE mp_entries
SET 
  date = date + INTERVAL '1 year',
  created_at = created_at + INTERVAL '1 year'
WHERE date >= '2025-01-01' AND date < '2025-02-01';

-- Update scrap_entries (rezago)
UPDATE scrap_entries
SET 
  date = date + INTERVAL '1 year',
  created_at = created_at + INTERVAL '1 year'
WHERE date >= '2025-01-01' AND date < '2025-02-01';

-- Update granulometry_tests
UPDATE granulometry_tests
SET 
  test_date = test_date + INTERVAL '1 year',
  created_at = created_at + INTERVAL '1 year'
WHERE test_date >= '2025-01-01' AND test_date < '2025-02-01';

-- Update stockpile_granulometry
UPDATE stockpile_granulometry
SET 
  test_date = test_date + INTERVAL '1 year',
  created_at = created_at + INTERVAL '1 year'
WHERE test_date >= '2025-01-01' AND test_date < '2025-02-01';

-- Update compression_tests
UPDATE compression_tests
SET 
  test_date = test_date + INTERVAL '1 year',
  created_at = created_at + INTERVAL '1 year'
WHERE test_date >= '2025-01-01' AND test_date < '2025-02-01';

-- Update absorption_tests
UPDATE absorption_tests
SET 
  test_date = test_date + INTERVAL '1 year',
  created_at = created_at + INTERVAL '1 year'
WHERE test_date >= '2025-01-01' AND test_date < '2025-02-01';

-- Verify the updates
SELECT 'production_entries' as table_name, COUNT(*) as records_in_jan_2026 
FROM production_entries WHERE date >= '2026-01-01' AND date < '2026-02-01'
UNION ALL
SELECT 'mp_entries', COUNT(*) FROM mp_entries WHERE date >= '2026-01-01' AND date < '2026-02-01'
UNION ALL
SELECT 'scrap_entries', COUNT(*) FROM scrap_entries WHERE date >= '2026-01-01' AND date < '2026-02-01';
