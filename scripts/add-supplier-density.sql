-- Add density column to suppliers table for unit conversion
-- Density is in kg/L (for liquids like additives)
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS density NUMERIC;

-- Add unit column to specify if the product is measured in kg or liters
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT 'kg';

-- Add some common densities for reference
COMMENT ON COLUMN suppliers.density IS 'Density in kg/L for liquids (additives). Used for kg<->liters conversion';
COMMENT ON COLUMN suppliers.unit IS 'Primary unit of measurement: kg or liters';
