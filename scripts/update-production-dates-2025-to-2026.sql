-- Update production dates from January 2025 to January 2026
-- This script updates all production-related tables with correct table names

-- Update paver production (adoquines - Ranchos)
UPDATE paver_production
SET production_date = production_date + INTERVAL '1 year'
WHERE production_date >= '2025-01-01' AND production_date < '2025-02-01';

-- Update pipe production (caños - Mercedes)
UPDATE pipe_production
SET production_date = production_date + INTERVAL '1 year'
WHERE production_date >= '2025-01-01' AND production_date < '2025-02-01';

-- Update block production
UPDATE block_production
SET production_date = production_date + INTERVAL '1 year'
WHERE production_date >= '2025-01-01' AND production_date < '2025-02-01';

-- Update mp_receipts (materia prima)
UPDATE mp_receipts
SET receipt_date = receipt_date + INTERVAL '1 year'
WHERE receipt_date >= '2025-01-01' AND receipt_date < '2025-02-01';

-- Update granulometry tests
UPDATE granulometry_tests
SET test_date = test_date + INTERVAL '1 year'
WHERE test_date >= '2025-01-01' AND test_date < '2025-02-01';

-- Update stockpile granulometry
UPDATE stockpile_granulometry
SET test_date = test_date + INTERVAL '1 year'
WHERE test_date >= '2025-01-01' AND test_date < '2025-02-01';

-- Update humidity tests
UPDATE humidity_tests
SET test_date = test_date + INTERVAL '1 year'
WHERE test_date >= '2025-01-01' AND test_date < '2025-02-01';

-- Update absorption tests
UPDATE absorption_tests
SET test_date = test_date + INTERVAL '1 year'
WHERE test_date >= '2025-01-01' AND test_date < '2025-02-01';

-- Update flexion tests
UPDATE flexion_tests
SET test_date = test_date + INTERVAL '1 year'
WHERE test_date >= '2025-01-01' AND test_date < '2025-02-01';

-- Update quality flexion samples (production_date)
UPDATE quality_flexion_samples
SET production_date = production_date + INTERVAL '1 year'
WHERE production_date >= '2025-01-01' AND production_date < '2025-02-01';

-- Update quality flexion samples (sample_date)
UPDATE quality_flexion_samples
SET sample_date = sample_date + INTERVAL '1 year'
WHERE sample_date >= '2025-01-01' AND sample_date < '2025-02-01';

-- Update quality flexion specimens
UPDATE quality_flexion_specimens
SET test_date = test_date + INTERVAL '1 year'
WHERE test_date >= '2025-01-01' AND test_date < '2025-02-01';

-- Update pipe quality control
UPDATE pipe_quality_control
SET control_date = control_date + INTERVAL '1 year'
WHERE control_date >= '2025-01-01' AND control_date < '2025-02-01';

-- Update attendance
UPDATE attendance
SET attendance_date = attendance_date + INTERVAL '1 year'
WHERE attendance_date >= '2025-01-01' AND attendance_date < '2025-02-01';

-- Update maintenance tasks
UPDATE maintenance_tasks
SET task_date = task_date + INTERVAL '1 year'
WHERE task_date >= '2025-01-01' AND task_date < '2025-02-01';

-- Update maintenance fuel records
UPDATE maintenance_fuel_records
SET fuel_date = fuel_date + INTERVAL '1 year'
WHERE fuel_date >= '2025-01-01' AND fuel_date < '2025-02-01';

-- Update maintenance parte diario
UPDATE maintenance_parte_diario
SET parte_date = parte_date + INTERVAL '1 year'
WHERE parte_date >= '2025-01-01' AND parte_date < '2025-02-01';

-- Verify the updates
SELECT 'paver_production' as table_name, COUNT(*) as records_in_jan_2026 
FROM paver_production WHERE production_date >= '2026-01-01' AND production_date < '2026-02-01'
UNION ALL
SELECT 'pipe_production', COUNT(*) FROM pipe_production WHERE production_date >= '2026-01-01' AND production_date < '2026-02-01'
UNION ALL
SELECT 'mp_receipts', COUNT(*) FROM mp_receipts WHERE receipt_date >= '2026-01-01' AND receipt_date < '2026-02-01';
