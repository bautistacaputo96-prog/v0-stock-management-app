-- Add fuel prices table and additional fields for fuel records

-- Create fuel prices table
CREATE TABLE IF NOT EXISTS maintenance_fuel_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fuel_type TEXT NOT NULL,
  price_per_liter NUMERIC(10,2) NOT NULL,
  plant TEXT NOT NULL DEFAULT 'Silke',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add unique constraint for fuel_type per plant
ALTER TABLE maintenance_fuel_prices ADD CONSTRAINT unique_fuel_type_per_plant UNIQUE (fuel_type, plant);

-- Add responsible_name and fuel_type columns to fuel_records if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'maintenance_fuel_records' AND column_name = 'responsible_name') THEN
    ALTER TABLE maintenance_fuel_records ADD COLUMN responsible_name TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'maintenance_fuel_records' AND column_name = 'fuel_type') THEN
    ALTER TABLE maintenance_fuel_records ADD COLUMN fuel_type TEXT DEFAULT 'Gasoil';
  END IF;
END $$;

-- Insert default fuel prices for Silke
INSERT INTO maintenance_fuel_prices (fuel_type, price_per_liter, plant, updated_by)
VALUES 
  ('Gasoil', 0, 'Silke', 'Sistema'),
  ('Nafta', 0, 'Silke', 'Sistema'),
  ('GNC', 0, 'Silke', 'Sistema')
ON CONFLICT (fuel_type, plant) DO NOTHING;
