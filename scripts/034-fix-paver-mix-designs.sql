-- Drop and recreate paver_mix_designs with correct columns
DROP TABLE IF EXISTS paver_mix_designs CASCADE;

CREATE TABLE paver_mix_designs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant TEXT NOT NULL DEFAULT 'ranchos',
  adoquin_type TEXT NOT NULL,
  adoquin_name TEXT NOT NULL,
  height_cm INT DEFAULT 6,
  color TEXT,
  weight_kg DECIMAL(10,2) DEFAULT 0,
  cement_kg DECIMAL(10,2) DEFAULT 0,
  sand_kg DECIMAL(10,2) DEFAULT 0,
  stone_kg DECIMAL(10,2) DEFAULT 0,
  additive_liters DECIMAL(10,3) DEFAULT 0,
  pigment_kg DECIMAL(10,3) DEFAULT 0,
  cycle_time_min DECIMAL(5,2) DEFAULT 0,
  pieces_per_batch INT DEFAULT 0,
  spec_pdf_url TEXT,
  modified_by TEXT,
  modified_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  UNIQUE(plant, adoquin_type)
);

-- Insert default paver types for Ranchos
INSERT INTO paver_mix_designs (plant, adoquin_type, adoquin_name, height_cm, color, is_active) VALUES
  ('ranchos', 'AH6', 'Adoquin H6', 6, NULL, true),
  ('ranchos', 'AH6-R', 'Adoquin H6 Rojo', 6, 'rojo', true),
  ('ranchos', 'AH6-A', 'Adoquin H6 Amarillo', 6, 'amarillo', true),
  ('ranchos', 'AH6-N', 'Adoquin H6 Negro', 6, 'negro', true),
  ('ranchos', 'AH8', 'Adoquin H8', 8, NULL, true),
  ('ranchos', 'AH8-R', 'Adoquin H8 Rojo', 8, 'rojo', true),
  ('ranchos', 'AH8-A', 'Adoquin H8 Amarillo', 8, 'amarillo', true),
  ('ranchos', 'AH8-N', 'Adoquin H8 Negro', 8, 'negro', true);

-- Create indexes
CREATE INDEX idx_paver_mix_designs_plant ON paver_mix_designs(plant);
CREATE INDEX idx_paver_mix_designs_adoquin_type ON paver_mix_designs(adoquin_type);

-- Create formula changes table
DROP TABLE IF EXISTS paver_formula_changes;

CREATE TABLE paver_formula_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant TEXT NOT NULL,
  formula_type TEXT NOT NULL,
  adoquin_type TEXT,
  changed_by TEXT NOT NULL,
  change_reason TEXT NOT NULL,
  previous_values JSONB,
  new_values JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_paver_formula_changes_plant ON paver_formula_changes(plant);
CREATE INDEX idx_paver_formula_changes_date ON paver_formula_changes(created_at);
