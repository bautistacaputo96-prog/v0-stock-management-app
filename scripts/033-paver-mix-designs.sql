-- Paver mix designs table (similar to pipe_mix_designs but for pavers/adoquines)
CREATE TABLE IF NOT EXISTS paver_mix_designs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant TEXT NOT NULL DEFAULT 'ranchos',
  paver_type TEXT NOT NULL, -- 'AH6', 'AH8', 'AH6_ROJO', 'AH6_NEGRO', 'AH8_ROJO', 'AH8_NEGRO', etc.
  paver_name TEXT NOT NULL, -- Display name: 'Adoquin AH6', 'Adoquin AH8 Rojo', etc.
  paver_weight_kg DECIMAL(10,2) DEFAULT 0,
  cement_kg DECIMAL(10,2) DEFAULT 0,
  sand_kg DECIMAL(10,2) DEFAULT 0,
  stone_kg DECIMAL(10,2) DEFAULT 0,
  additive_liters DECIMAL(10,3) DEFAULT 0,
  pigment_kg DECIMAL(10,3) DEFAULT 0, -- For colored pavers
  pigment_color TEXT, -- 'rojo', 'negro', 'amarillo', etc.
  cycle_time_min DECIMAL(5,2) DEFAULT 0,
  pieces_per_cycle INT DEFAULT 0, -- How many pavers per cycle
  spec_pdf_url TEXT,
  modified_by TEXT,
  modified_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  UNIQUE(plant, paver_type)
);

-- Insert default paver types for Ranchos
INSERT INTO paver_mix_designs (plant, paver_type, paver_name, is_active) VALUES
  ('ranchos', 'AH6', 'Adoquin AH6 Natural', true),
  ('ranchos', 'AH6_ROJO', 'Adoquin AH6 Rojo', true),
  ('ranchos', 'AH6_NEGRO', 'Adoquin AH6 Negro', true),
  ('ranchos', 'AH6_AMARILLO', 'Adoquin AH6 Amarillo', true),
  ('ranchos', 'AH8', 'Adoquin AH8 Natural', true),
  ('ranchos', 'AH8_ROJO', 'Adoquin AH8 Rojo', true),
  ('ranchos', 'AH8_NEGRO', 'Adoquin AH8 Negro', true),
  ('ranchos', 'AH8_AMARILLO', 'Adoquin AH8 Amarillo', true)
ON CONFLICT (plant, paver_type) DO NOTHING;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_paver_mix_designs_plant ON paver_mix_designs(plant);
CREATE INDEX IF NOT EXISTS idx_paver_mix_designs_paver_type ON paver_mix_designs(paver_type);
