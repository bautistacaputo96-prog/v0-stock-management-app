-- Ranchos Quality Module Tables

-- 1. Ensayos pendientes (generados al cargar ingreso de materia prima con extracción de muestra)
CREATE TABLE IF NOT EXISTS quality_pending_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant TEXT NOT NULL DEFAULT 'ranchos',
  test_type TEXT NOT NULL, -- 'humedad', 'granulometria', 'flexion'
  material_type TEXT, -- 'arena', 'piedra', 'cemento', 'adoquin'
  source_type TEXT, -- 'mp_receipt' (materia prima), 'production' (produccion)
  source_id UUID, -- Reference to mp_receipts or paver_production
  source_date DATE,
  supplier_name TEXT,
  remito_number TEXT,
  sample_id TEXT, -- Identificador de la muestra (ej: "M-2024-001")
  notes TEXT,
  status TEXT DEFAULT 'pending', -- 'pending', 'in_progress', 'completed', 'cancelled'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  completed_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_quality_pending_tests_plant ON quality_pending_tests(plant);
CREATE INDEX IF NOT EXISTS idx_quality_pending_tests_status ON quality_pending_tests(status);
CREATE INDEX IF NOT EXISTS idx_quality_pending_tests_type ON quality_pending_tests(test_type);

-- 2. Ensayos de humedad
CREATE TABLE IF NOT EXISTS quality_humidity_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant TEXT NOT NULL DEFAULT 'ranchos',
  pending_test_id UUID REFERENCES quality_pending_tests(id),
  material_type TEXT NOT NULL, -- 'arena', 'piedra'
  supplier_name TEXT,
  sample_date DATE NOT NULL,
  
  -- Datos del ensayo
  tare_weight_g DECIMAL(10,2), -- Peso tara (g)
  wet_weight_g DECIMAL(10,2), -- Peso humedo + tara (g)
  dry_weight_g DECIMAL(10,2), -- Peso seco + tara (g)
  
  -- Resultado calculado
  humidity_percent DECIMAL(5,2), -- % humedad = ((Ph - Ps) / (Ps - Pt)) * 100
  
  tested_by TEXT,
  tested_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_quality_humidity_plant ON quality_humidity_tests(plant);
CREATE INDEX IF NOT EXISTS idx_quality_humidity_date ON quality_humidity_tests(sample_date);

-- 3. Ensayos de granulometria
CREATE TABLE IF NOT EXISTS quality_granulometry_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant TEXT NOT NULL DEFAULT 'ranchos',
  pending_test_id UUID REFERENCES quality_pending_tests(id),
  material_type TEXT NOT NULL, -- 'arena', 'piedra'
  supplier_name TEXT,
  sample_date DATE NOT NULL,
  
  -- Peso inicial de la muestra
  initial_weight_g DECIMAL(10,2),
  
  -- Pesos retenidos por tamiz (en gramos) - tamices estandar
  sieve_25mm_g DECIMAL(10,2) DEFAULT 0,    -- 1"
  sieve_19mm_g DECIMAL(10,2) DEFAULT 0,    -- 3/4"
  sieve_12_5mm_g DECIMAL(10,2) DEFAULT 0,  -- 1/2"
  sieve_9_5mm_g DECIMAL(10,2) DEFAULT 0,   -- 3/8"
  sieve_4_75mm_g DECIMAL(10,2) DEFAULT 0,  -- #4
  sieve_2_36mm_g DECIMAL(10,2) DEFAULT 0,  -- #8
  sieve_1_18mm_g DECIMAL(10,2) DEFAULT 0,  -- #16
  sieve_600um_g DECIMAL(10,2) DEFAULT 0,   -- #30
  sieve_300um_g DECIMAL(10,2) DEFAULT 0,   -- #50
  sieve_150um_g DECIMAL(10,2) DEFAULT 0,   -- #100
  sieve_75um_g DECIMAL(10,2) DEFAULT 0,    -- #200
  pan_g DECIMAL(10,2) DEFAULT 0,           -- Fondo
  
  -- Modulo de finura calculado
  fineness_modulus DECIMAL(4,2),
  
  -- Estado: dentro/fuera de curva granulometrica
  within_limits BOOLEAN,
  
  tested_by TEXT,
  tested_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_quality_granulometry_plant ON quality_granulometry_tests(plant);
CREATE INDEX IF NOT EXISTS idx_quality_granulometry_date ON quality_granulometry_tests(sample_date);

-- 4. Calibracion de prensa (coeficientes polinomicos)
CREATE TABLE IF NOT EXISTS quality_press_calibration (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant TEXT NOT NULL DEFAULT 'ranchos',
  press_name TEXT NOT NULL DEFAULT 'Prensa Principal',
  
  -- Coeficientes de la formula cubica: F = A*dial^3 + B*dial^2 + C*dial + D
  coef_a DECIMAL(15,10) DEFAULT 0,
  coef_b DECIMAL(15,10) DEFAULT 0,
  coef_c DECIMAL(15,10) DEFAULT 0,
  coef_d DECIMAL(15,10) DEFAULT 0,
  
  -- Metadata de calibracion
  calibration_date DATE,
  calibration_certificate TEXT,
  next_calibration_date DATE,
  
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

-- Insert default press calibration for Ranchos
INSERT INTO quality_press_calibration (plant, press_name, coef_a, coef_b, coef_c, coef_d, is_active)
VALUES ('ranchos', 'Prensa Principal', 0, 0, 1, 0, true)
ON CONFLICT DO NOTHING;

-- 5. Muestras de flexion (grupo de adoquines)
CREATE TABLE IF NOT EXISTS quality_flexion_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant TEXT NOT NULL DEFAULT 'ranchos',
  pending_test_id UUID REFERENCES quality_pending_tests(id),
  
  -- Identificacion de la muestra
  sample_code TEXT NOT NULL, -- Ej: "F-2024-001"
  extraction_date DATE NOT NULL,
  adoquin_type TEXT NOT NULL, -- 'AH6', 'AH8', etc.
  color TEXT, -- 'natural', 'rojo', 'negro', 'amarillo'
  
  -- Referencia a produccion (para obtener formula del dia)
  production_id UUID, -- References paver_production
  production_date DATE,
  
  -- Dimensiones nominales (cm)
  nominal_length_cm DECIMAL(5,2) DEFAULT 20,
  nominal_width_cm DECIMAL(5,2) DEFAULT 10,
  nominal_height_cm DECIMAL(5,2), -- 6 para AH6, 8 para AH8
  
  -- Estado de la muestra
  status TEXT DEFAULT 'pending', -- 'pending', 'partial', 'completed'
  
  -- Resultados agregados (calculados)
  avg_7d_mpa DECIMAL(6,2),
  avg_28d_mpa DECIMAL(6,2),
  passes_individual BOOLEAN, -- Todos >= 3.8 MPa
  passes_group BOOLEAN, -- Promedio >= 4.2 MPa
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_quality_flexion_samples_plant ON quality_flexion_samples(plant);
CREATE INDEX IF NOT EXISTS idx_quality_flexion_samples_date ON quality_flexion_samples(extraction_date);
CREATE INDEX IF NOT EXISTS idx_quality_flexion_samples_status ON quality_flexion_samples(status);

-- 6. Especimenes individuales de flexion (cada adoquin de la muestra)
CREATE TABLE IF NOT EXISTS quality_flexion_specimens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id UUID NOT NULL REFERENCES quality_flexion_samples(id) ON DELETE CASCADE,
  
  -- Identificacion del especimen
  specimen_number INT NOT NULL, -- 1, 2, o 3
  test_age_days INT NOT NULL, -- 7 o 28
  scheduled_test_date DATE NOT NULL,
  
  -- Mediciones del especimen
  actual_length_cm DECIMAL(5,2),
  actual_width_cm DECIMAL(5,2),
  actual_height_cm DECIMAL(5,2),
  weight_sss_g DECIMAL(8,2), -- Peso saturado superficie seca
  
  -- Lectura del ensayo
  dial_reading DECIMAL(10,2),
  load_kn DECIMAL(10,2), -- Carga calculada con calibracion
  
  -- Resultado
  flexion_mpa DECIMAL(6,2),
  passes_minimum BOOLEAN, -- >= 3.8 MPa
  
  -- Metadata
  tested_at TIMESTAMPTZ,
  tested_by TEXT,
  status TEXT DEFAULT 'pending', -- 'pending', 'tested'
  notes TEXT,
  
  UNIQUE(sample_id, specimen_number, test_age_days)
);

CREATE INDEX IF NOT EXISTS idx_quality_flexion_specimens_sample ON quality_flexion_specimens(sample_id);
CREATE INDEX IF NOT EXISTS idx_quality_flexion_specimens_scheduled ON quality_flexion_specimens(scheduled_test_date);
CREATE INDEX IF NOT EXISTS idx_quality_flexion_specimens_status ON quality_flexion_specimens(status);

-- 7. Parametros de calidad (limites y referencias)
CREATE TABLE IF NOT EXISTS quality_parameters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant TEXT NOT NULL,
  parameter_type TEXT NOT NULL, -- 'flexion', 'humidity', 'granulometry'
  parameter_name TEXT NOT NULL,
  min_value DECIMAL(10,4),
  max_value DECIMAL(10,4),
  unit TEXT,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT,
  UNIQUE(plant, parameter_type, parameter_name)
);

-- Insert default IRAM parameters for Ranchos
INSERT INTO quality_parameters (plant, parameter_type, parameter_name, min_value, max_value, unit, description) VALUES
  ('ranchos', 'flexion', 'min_individual_28d', 3.8, NULL, 'MPa', 'Resistencia minima individual a 28 dias (IRAM)'),
  ('ranchos', 'flexion', 'min_group_28d', 4.2, NULL, 'MPa', 'Resistencia minima grupal a 28 dias (IRAM)'),
  ('ranchos', 'flexion', 'min_individual_7d', 2.5, NULL, 'MPa', 'Resistencia minima individual a 7 dias (referencia)'),
  ('ranchos', 'humidity', 'max_arena', NULL, 8.0, '%', 'Humedad maxima arena'),
  ('ranchos', 'humidity', 'max_piedra', NULL, 3.0, '%', 'Humedad maxima piedra')
ON CONFLICT (plant, parameter_type, parameter_name) DO NOTHING;

-- 8. Vista para calendario de ensayos pendientes
CREATE OR REPLACE VIEW quality_pending_flexion_tests AS
SELECT 
  s.id as sample_id,
  s.sample_code,
  s.extraction_date,
  s.adoquin_type,
  s.color,
  sp.id as specimen_id,
  sp.specimen_number,
  sp.test_age_days,
  sp.scheduled_test_date,
  sp.status as specimen_status,
  s.plant
FROM quality_flexion_samples s
JOIN quality_flexion_specimens sp ON sp.sample_id = s.id
WHERE sp.status = 'pending'
ORDER BY sp.scheduled_test_date ASC;
