-- Update block_production table to match PDF structure exactly
ALTER TABLE block_production
DROP COLUMN IF EXISTS formula,
DROP COLUMN IF EXISTS racks_produced,
DROP COLUMN IF EXISTS blocks_discarded,
DROP COLUMN IF EXISTS stone_0_20_kg,
DROP COLUMN IF EXISTS fresh_racks;

ALTER TABLE block_production
ADD COLUMN IF NOT EXISTS cleaning_minutes INTEGER,
ADD COLUMN IF NOT EXISTS pallets INTEGER,
ADD COLUMN IF NOT EXISTS theoretical_units INTEGER,
ADD COLUMN IF NOT EXISTS real_units INTEGER,
ADD COLUMN IF NOT EXISTS scrap_units INTEGER,
ADD COLUMN IF NOT EXISTS scrap_percentage DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS racks_to_camera INTEGER,
ADD COLUMN IF NOT EXISTS production_units INTEGER,
ADD COLUMN IF NOT EXISTS additive_1_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS additive_2_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS palletizer_2 VARCHAR(100);

-- Add comments for clarity
COMMENT ON COLUMN block_production.cleaning_minutes IS 'Limpieza en minutos';
COMMENT ON COLUMN block_production.pallets IS 'Número de pallets producidos';
COMMENT ON COLUMN block_production.theoretical_units IS 'Unidades teóricas esperadas';
COMMENT ON COLUMN block_production.real_units IS 'Unidades reales producidas';
COMMENT ON COLUMN block_production.scrap_units IS 'Unidades descartadas (scrap)';
COMMENT ON COLUMN block_production.scrap_percentage IS 'Porcentaje de scrap calculado';
COMMENT ON COLUMN block_production.racks_to_camera IS 'Racks enviados a cámaras';
COMMENT ON COLUMN block_production.production_units IS 'Unidades totales producidas';
