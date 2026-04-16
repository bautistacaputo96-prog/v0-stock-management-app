-- Quality module tables for Ranchos (simplified without foreign keys)

-- Drop existing tables if they exist
DROP TABLE IF EXISTS quality_flexion_specimens CASCADE;
DROP TABLE IF EXISTS quality_flexion_samples CASCADE;
DROP TABLE IF EXISTS quality_press_calibration CASCADE;

-- Pending tests table (generated from mp_receipts when sample is extracted)
CREATE TABLE IF NOT EXISTS quality_pending_tests (
  id SERIAL PRIMARY KEY,
  plant TEXT NOT NULL DEFAULT 'ranchos',
  test_type TEXT NOT NULL, -- 'humedad', 'granulometria', 'flexion'
  material_type TEXT, -- 'arena', 'piedra', 'cemento', 'adoquin'
  mp_receipt_id INTEGER, -- Reference to mp_receipts
  supplier_id INTEGER, -- Reference to suppliers
  supplier_name TEXT,
  remito_number TEXT,
  sample_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'pendiente', -- 'pendiente', 'en_proceso', 'completado'
  completed_at TIMESTAMPTZ,
  completed_by TEXT,
  test_result_id INTEGER, -- ID of the completed test record
  observations TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Press calibration table (cubic polynomial: F = A*dial^3 + B*dial^2 + C*dial + D)
CREATE TABLE IF NOT EXISTS quality_press_calibration (
  id SERIAL PRIMARY KEY,
  plant TEXT NOT NULL DEFAULT 'ranchos',
  calibration_date DATE NOT NULL,
  calibrated_by TEXT NOT NULL,
  -- Cubic polynomial coefficients
  coef_a NUMERIC(20,10) NOT NULL DEFAULT 0, -- dial^3 coefficient
  coef_b NUMERIC(20,10) NOT NULL DEFAULT 0, -- dial^2 coefficient
  coef_c NUMERIC(20,10) NOT NULL DEFAULT 0, -- dial coefficient
  coef_d NUMERIC(20,10) NOT NULL DEFAULT 0, -- constant
  -- Validation range
  dial_min NUMERIC DEFAULT 0,
  dial_max NUMERIC DEFAULT 100,
  -- Metadata
  certificate_number TEXT,
  certificate_url TEXT,
  observations TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Flexion samples table (1 sample = 3 adoquines: 1 for 7 days, 2 for 28 days)
CREATE TABLE IF NOT EXISTS quality_flexion_samples (
  id SERIAL PRIMARY KEY,
  plant TEXT NOT NULL DEFAULT 'ranchos',
  sample_code TEXT NOT NULL, -- e.g., "FL-2024-001"
  sample_date DATE NOT NULL DEFAULT CURRENT_DATE,
  
  -- Adoquin info
  adoquin_type TEXT NOT NULL, -- 'AH6', 'AH8', 'AH6-R', etc.
  adoquin_height_cm INTEGER NOT NULL DEFAULT 6,
  
  -- Dimensions (from IRAM: 20x10 standard)
  length_mm NUMERIC NOT NULL DEFAULT 200,
  width_mm NUMERIC NOT NULL DEFAULT 100,
  
  -- Production reference
  production_date DATE,
  paver_production_id INTEGER,
  lote TEXT,
  
  -- Formula used that day (snapshot)
  formula_cement_kg NUMERIC,
  formula_sand_kg NUMERIC,
  formula_stone_kg NUMERIC,
  formula_additive_lts NUMERIC,
  
  -- Sample status
  status TEXT NOT NULL DEFAULT 'pendiente', -- 'pendiente', '7_dias_completado', 'completado'
  
  -- Calculated results (after all specimens tested)
  avg_resistance_7d_mpa NUMERIC,
  avg_resistance_28d_mpa NUMERIC,
  complies_individual BOOLEAN, -- All individual >= 3.8 MPa
  complies_group BOOLEAN, -- Average >= 4.2 MPa
  
  observations TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Flexion specimens table (individual adoquin tests)
CREATE TABLE IF NOT EXISTS quality_flexion_specimens (
  id SERIAL PRIMARY KEY,
  sample_id INTEGER NOT NULL REFERENCES quality_flexion_samples(id) ON DELETE CASCADE,
  specimen_number INTEGER NOT NULL, -- 1, 2, or 3
  test_age_days INTEGER NOT NULL, -- 7 or 28
  
  -- Pre-test measurements
  height_mm NUMERIC NOT NULL, -- Actual measured height
  weight_sss_g NUMERIC, -- Saturated surface-dry weight
  
  -- Test execution
  test_date DATE,
  tested_by TEXT,
  
  -- Press reading
  dial_reading NUMERIC, -- Raw dial value
  calibration_id INTEGER REFERENCES quality_press_calibration(id),
  
  -- Calculated values
  load_kn NUMERIC, -- Force calculated from dial and calibration
  area_mm2 NUMERIC, -- length_mm * width_mm from sample
  resistance_mpa NUMERIC, -- Calculated flexion resistance
  
  -- IRAM compliance
  complies_min BOOLEAN, -- >= 3.8 MPa individual minimum
  
  observations TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(sample_id, specimen_number, test_age_days)
);

-- Add plant column to quality_parameters if not exists
ALTER TABLE quality_parameters ADD COLUMN IF NOT EXISTS plant TEXT DEFAULT 'ranchos';

-- Insert default quality parameters for Ranchos (IRAM standards)
INSERT INTO quality_parameters (parameter_name, parameter_value, unit, test_type, description, iram_norm, plant)
VALUES 
  ('flexion_min_individual', 3.8, 'MPa', 'flexion', 'Resistencia minima individual a flexion', 'IRAM 11656', 'ranchos'),
  ('flexion_min_group', 4.2, 'MPa', 'flexion', 'Resistencia minima grupal a flexion (promedio)', 'IRAM 11656', 'ranchos'),
  ('humidity_max_sand', 8.0, '%', 'humedad', 'Humedad maxima permitida en arena', 'IRAM', 'ranchos'),
  ('humidity_max_stone', 3.0, '%', 'humedad', 'Humedad maxima permitida en piedra', 'IRAM', 'ranchos')
ON CONFLICT DO NOTHING;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_quality_pending_tests_plant ON quality_pending_tests(plant);
CREATE INDEX IF NOT EXISTS idx_quality_pending_tests_status ON quality_pending_tests(status);
CREATE INDEX IF NOT EXISTS idx_quality_flexion_samples_plant ON quality_flexion_samples(plant);
CREATE INDEX IF NOT EXISTS idx_quality_flexion_samples_status ON quality_flexion_samples(status);
CREATE INDEX IF NOT EXISTS idx_quality_flexion_specimens_sample ON quality_flexion_specimens(sample_id);
CREATE INDEX IF NOT EXISTS idx_quality_press_calibration_active ON quality_press_calibration(plant, is_active);
