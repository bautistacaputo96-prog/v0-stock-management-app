-- Add supplier columns to pipe_production table
ALTER TABLE pipe_production 
ADD COLUMN IF NOT EXISTS supplier_cement VARCHAR(100),
ADD COLUMN IF NOT EXISTS supplier_sand VARCHAR(100),
ADD COLUMN IF NOT EXISTS supplier_stone VARCHAR(100);

-- Add comment
COMMENT ON COLUMN pipe_production.supplier_cement IS 'Proveedor de cemento utilizado';
COMMENT ON COLUMN pipe_production.supplier_sand IS 'Proveedor de arena utilizado';
COMMENT ON COLUMN pipe_production.supplier_stone IS 'Proveedor de piedra utilizado';
