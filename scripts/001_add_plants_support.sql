-- Add plants table
CREATE TABLE IF NOT EXISTS plants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  code VARCHAR(50) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add plant_id to materials table
ALTER TABLE materials ADD COLUMN IF NOT EXISTS plant_id UUID REFERENCES plants(id) ON DELETE CASCADE;

-- Add plant_id to formulas table
ALTER TABLE formulas ADD COLUMN IF NOT EXISTS plant_id UUID REFERENCES plants(id) ON DELETE CASCADE;

-- Insert the two plants
INSERT INTO plants (name, code) VALUES 
  ('Canning', 'CAN'),
  ('Hudson', 'HUD')
ON CONFLICT (code) DO NOTHING;

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_materials_plant_id ON materials(plant_id);
CREATE INDEX IF NOT EXISTS idx_formulas_plant_id ON formulas(plant_id);
