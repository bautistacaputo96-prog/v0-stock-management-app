-- Fix quality tables for Ranchos module
-- Drop existing tables and recreate with correct schema

DROP TABLE IF EXISTS quality_flexion_specimens CASCADE;
DROP TABLE IF EXISTS quality_flexion_samples CASCADE;
DROP TABLE IF EXISTS quality_granulometry_tests CASCADE;
DROP TABLE IF EXISTS quality_humidity_tests CASCADE;
DROP TABLE IF EXISTS quality_pending_tests CASCADE;
DROP TABLE IF EXISTS quality_press_calibration CASCADE;
DROP TABLE IF EXISTS quality_parameters CASCADE;

-- Quality parameters per plant (min/max values for alerts)
CREATE TABLE quality_parameters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant TEXT NOT NULL,
  parameter_name TEXT NOT NULL,
  min_value DECIMAL(10,3),
  max_value DECIMAL(10,3),
  unit TEXT,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(plant, parameter_name)
);

-- Pending tests queue (generated when raw material arrives with sample extraction)
CREATE TABLE quality_pending_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant TEXT NOT NULL,
  test_type TEXT NOT NULL, -- 'humedad', 'granulometria', 'flexion'
  material_type TEXT, -- 'arena', 'piedra', 'cemento', 'adoquin'
  supplier_id UUID REFERENCES suppliers(id),
  receipt_id UUID, -- Reference to raw material receipt
  production_date DATE, -- For flexion tests linked to production
  adoquin_type TEXT, -- 'AH6', 'AH8', etc for flexion
  sample_count INT DEFAULT 1, -- Number of samples extracted
  priority TEXT DEFAULT 'normal', -- 'alta', 'normal', 'baja'
  notes TEXT,
  status TEXT DEFAULT 'pending', -- 'pending', 'in_progress', 'completed', 'cancelled'
  due_date DATE, -- When test should be completed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Humidity tests
CREATE TABLE quality_humidity_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant TEXT NOT NULL,
  pending_test_id UUID REFERENCES quality_pending_tests(id),
  material_type TEXT NOT NULL, -- 'arena', 'piedra'
  supplier_id UUID REFERENCES suppliers(id),
  test_date DATE NOT NULL,
  tested_by TEXT,
  -- Measurements
  wet_weight_g DECIMAL(10,2), -- Peso humedo
  dry_weight_g DECIMAL(10,2), -- Peso seco
  container_weight_g DECIMAL(10,2), -- Peso tara
  -- Calculated
  humidity_percent DECIMAL(5,2), -- ((wet - dry) / (dry - container)) * 100
  -- Status
  is_within_spec BOOLEAN,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Granulometry tests
CREATE TABLE quality_granulometry_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant TEXT NOT NULL,
  pending_test_id UUID REFERENCES quality_pending_tests(id),
  material_type TEXT NOT NULL, -- 'arena', 'piedra'
  supplier_id UUID REFERENCES suppliers(id),
  test_date DATE NOT NULL,
  tested_by TEXT,
  sample_weight_g DECIMAL(10,2),
  -- Sieve results stored as JSONB: {sieve_mm: retained_g, ...}
  sieve_results JSONB,
  -- Calculated values
  fineness_modulus DECIMAL(5,2), -- Modulo de finura
  is_within_spec BOOLEAN,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Press calibration (polynomial coefficients)
CREATE TABLE quality_press_calibration (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant TEXT NOT NULL,
  press_name TEXT NOT NULL,
  calibration_date DATE NOT NULL,
  valid_until DATE,
  -- Cubic polynomial: F = A*dial^3 + B*dial^2 + C*dial + D
  coef_a DECIMAL(15,10) DEFAULT 0, -- dial^3 coefficient
  coef_b DECIMAL(15,10) DEFAULT 0, -- dial^2 coefficient
  coef_c DECIMAL(15,10) DEFAULT 0, -- dial coefficient
  coef_d DECIMAL(15,10) DEFAULT 0, -- constant
  dial_min INT DEFAULT 0,
  dial_max INT DEFAULT 100,
  calibrated_by TEXT,
  certificate_url TEXT,
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Flexion samples (1 sample = 3 physical pavers)
CREATE TABLE quality_flexion_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant TEXT NOT NULL,
  pending_test_id UUID REFERENCES quality_pending_tests(id),
  sample_code TEXT NOT NULL, -- e.g., 'F-2024-001'
  production_date DATE NOT NULL,
  adoquin_type TEXT NOT NULL, -- 'AH6', 'AH8', 'AH6-R', etc.
  extraction_date DATE NOT NULL,
  extracted_by TEXT,
  -- Link to production for formula tracking
  paver_production_id UUID,
  -- Dimensions (from adoquin type, can be overridden)
  length_cm DECIMAL(5,2) DEFAULT 20,
  width_cm DECIMAL(5,2) DEFAULT 10,
  height_cm DECIMAL(5,2), -- 6 for AH6, 8 for AH8
  -- Status
  status TEXT DEFAULT 'curing', -- 'curing', 'ready_7d', 'tested_7d', 'ready_28d', 'completed'
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Flexion specimens (individual paver test results)
CREATE TABLE quality_flexion_specimens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id UUID REFERENCES quality_flexion_samples(id) ON DELETE CASCADE,
  specimen_number INT NOT NULL, -- 1, 2, or 3
  test_age_days INT NOT NULL, -- 7 or 28
  test_date DATE,
  tested_by TEXT,
  -- Pre-test measurements
  weight_sss_g DECIMAL(10,2), -- Peso saturado superficie seca
  actual_height_cm DECIMAL(5,2), -- Altura real medida
  -- Test data
  press_calibration_id UUID REFERENCES quality_press_calibration(id),
  dial_reading DECIMAL(10,2),
  load_kn DECIMAL(10,3), -- Calculated from dial and calibration
  -- Result
  resistance_mpa DECIMAL(6,3), -- Calculated: (3*P*L)/(2*b*h^2) for point load
  -- Validation
  is_individual_pass BOOLEAN, -- >= 3.8 MPa
  failure_type TEXT, -- 'normal', 'irregular', etc.
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_quality_pending_plant ON quality_pending_tests(plant);
CREATE INDEX idx_quality_pending_status ON quality_pending_tests(status);
CREATE INDEX idx_quality_pending_type ON quality_pending_tests(test_type);
CREATE INDEX idx_quality_humidity_plant ON quality_humidity_tests(plant);
CREATE INDEX idx_quality_humidity_date ON quality_humidity_tests(test_date);
CREATE INDEX idx_quality_granulometry_plant ON quality_granulometry_tests(plant);
CREATE INDEX idx_quality_granulometry_date ON quality_granulometry_tests(test_date);
CREATE INDEX idx_quality_flexion_samples_plant ON quality_flexion_samples(plant);
CREATE INDEX idx_quality_flexion_samples_production ON quality_flexion_samples(production_date);
CREATE INDEX idx_quality_flexion_samples_status ON quality_flexion_samples(status);
CREATE INDEX idx_quality_flexion_specimens_sample ON quality_flexion_specimens(sample_id);
CREATE INDEX idx_quality_flexion_specimens_age ON quality_flexion_specimens(test_age_days);
CREATE INDEX idx_quality_press_plant ON quality_press_calibration(plant);

-- Insert default parameters for Ranchos
INSERT INTO quality_parameters (plant, parameter_name, min_value, max_value, unit, description) VALUES
  ('ranchos', 'flexion_individual_min', 3.8, NULL, 'MPa', 'Resistencia minima individual a flexion'),
  ('ranchos', 'flexion_group_min', 4.2, NULL, 'MPa', 'Resistencia minima grupal a flexion (promedio)'),
  ('ranchos', 'humidity_arena_max', NULL, 8.0, '%', 'Humedad maxima arena'),
  ('ranchos', 'humidity_piedra_max', NULL, 3.0, '%', 'Humedad maxima piedra'),
  ('ranchos', 'fineness_modulus_min', 2.3, 3.1, NULL, 'Modulo de finura arena')
ON CONFLICT (plant, parameter_name) DO UPDATE SET
  min_value = EXCLUDED.min_value,
  max_value = EXCLUDED.max_value;

-- Insert default press calibration for Ranchos (placeholder values)
INSERT INTO quality_press_calibration (plant, press_name, calibration_date, valid_until, coef_a, coef_b, coef_c, coef_d, dial_min, dial_max, is_active)
VALUES ('ranchos', 'Prensa Principal', CURRENT_DATE, CURRENT_DATE + INTERVAL '1 year', 0.00001, 0.001, 0.5, 0, 0, 100, true)
ON CONFLICT DO NOTHING;
