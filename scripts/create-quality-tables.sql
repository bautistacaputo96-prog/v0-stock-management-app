-- ============================================
-- Quality Module Tables
-- ============================================

-- 1. Suppliers (proveedores predefinidos)
CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  material_type TEXT NOT NULL, -- piedra_0_10, piedra_0_6_lavada, piedra_0_6_limpia, arena, cemento
  product_detail TEXT, -- e.g. CPC-40
  line_type TEXT NOT NULL DEFAULT 'ambas', -- canos, bloques, ambas
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. MP Receipts (ingresos de materia prima)
CREATE TABLE IF NOT EXISTS mp_receipts (
  id SERIAL PRIMARY KEY,
  receipt_date DATE NOT NULL,
  remito_number TEXT NOT NULL,
  supplier_id INT NOT NULL REFERENCES suppliers(id),
  material_type TEXT NOT NULL,
  quantity_tn NUMERIC(10,2) NOT NULL,
  line_type TEXT NOT NULL,
  observations TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Granulometry Tests (ensayos de granulometria)
CREATE TABLE IF NOT EXISTS granulometry_tests (
  id SERIAL PRIMARY KEY,
  mp_receipt_id INT NOT NULL REFERENCES mp_receipts(id) ON DELETE CASCADE,
  test_date DATE NOT NULL,
  sieve_9500 NUMERIC(6,2) DEFAULT 0, -- % retenido 9.5mm
  sieve_4750 NUMERIC(6,2) DEFAULT 0, -- % retenido 4.75mm
  sieve_2360 NUMERIC(6,2) DEFAULT 0, -- % retenido 2.36mm
  sieve_1180 NUMERIC(6,2) DEFAULT 0, -- % retenido 1.18mm
  sieve_600 NUMERIC(6,2) DEFAULT 0,  -- % retenido 600um
  sieve_300 NUMERIC(6,2) DEFAULT 0,  -- % retenido 300um
  sieve_150 NUMERIC(6,2) DEFAULT 0,  -- % retenido 150um
  sieve_pan NUMERIC(6,2) DEFAULT 0,  -- % fondo
  fineness_modulus NUMERIC(4,2),      -- MF calculado
  observations TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Humidity Tests (ensayos de humedad - solo arena)
CREATE TABLE IF NOT EXISTS humidity_tests (
  id SERIAL PRIMARY KEY,
  mp_receipt_id INT NOT NULL REFERENCES mp_receipts(id) ON DELETE CASCADE,
  test_date DATE NOT NULL,
  humidity_percentage NUMERIC(5,2) NOT NULL,
  tolerance_percentage NUMERIC(5,2) NOT NULL DEFAULT 3.0,
  excess_percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
  quantity_tn NUMERIC(10,2) NOT NULL,
  credit_tn NUMERIC(10,4) NOT NULL DEFAULT 0,
  remito_number TEXT,
  observations TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Absorption Tests (ensayos de absorcion - canos)
CREATE TABLE IF NOT EXISTS absorption_tests (
  id SERIAL PRIMARY KEY,
  test_date DATE NOT NULL,
  pipe_diameter INT NOT NULL, -- 300, 400, 500, 600, 800, 1000, 1200
  sample_dry_weight_g NUMERIC(10,2) NOT NULL,
  sample_wet_weight_g NUMERIC(10,2) NOT NULL,
  absorption_percentage NUMERIC(5,2) NOT NULL,
  complies_iram BOOLEAN NOT NULL DEFAULT true,
  lote TEXT,
  observations TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Flexion Tests (ensayos de flexion - adoquines)
CREATE TABLE IF NOT EXISTS flexion_tests (
  id SERIAL PRIMARY KEY,
  test_date DATE NOT NULL,
  product_type TEXT NOT NULL,
  sample_length_mm NUMERIC(8,2) NOT NULL,
  sample_width_mm NUMERIC(8,2) NOT NULL,
  sample_height_mm NUMERIC(8,2) NOT NULL,
  breaking_load_n NUMERIC(10,2) NOT NULL,
  flexion_strength_mpa NUMERIC(6,2) NOT NULL,
  complies_iram BOOLEAN NOT NULL DEFAULT true,
  lote TEXT,
  observations TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Pipe Quality Control (planilla de canos terminados - cabecera)
CREATE TABLE IF NOT EXISTS pipe_quality_control (
  id SERIAL PRIMARY KEY,
  control_date DATE NOT NULL,
  lote TEXT NOT NULL,
  fabrication_order TEXT NOT NULL,
  production_responsible_id INT REFERENCES employees(id),
  logistics_responsible_id INT REFERENCES employees(id),
  observations TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Pipe Quality Items (detalle por diametro)
CREATE TABLE IF NOT EXISTS pipe_quality_items (
  id SERIAL PRIMARY KEY,
  pipe_quality_control_id INT NOT NULL REFERENCES pipe_quality_control(id) ON DELETE CASCADE,
  diameter INT NOT NULL, -- 300, 400, 500, 600, 800, 1000, 1200
  first_quality INT NOT NULL DEFAULT 0,
  second_quality INT NOT NULL DEFAULT 0,
  broken INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Quality Parameters (parametros IRAM configurables)
CREATE TABLE IF NOT EXISTS quality_parameters (
  id SERIAL PRIMARY KEY,
  parameter_name TEXT NOT NULL UNIQUE,
  parameter_value NUMERIC(10,2) NOT NULL,
  unit TEXT NOT NULL,
  test_type TEXT NOT NULL, -- absorcion, flexion, granulometria, humedad
  description TEXT,
  iram_norm TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- Seed Data
-- ============================================

-- Proveedores
INSERT INTO suppliers (name, material_type, product_detail, line_type) VALUES
  ('Piatti', 'piedra_0_10', 'Piedra 0-10', 'canos'),
  ('Piatti', 'piedra_0_6_lavada', 'Piedra 0-6 Lavada', 'bloques'),
  ('Cementos Avellaneda', 'piedra_0_6_limpia', 'Piedra 0-6 Limpia', 'bloques'),
  ('San Pedro', 'arena', 'Arena Especial', 'ambas'),
  ('Holcim', 'cemento', 'CPC-40', 'ambas'),
  ('Cementos Avellaneda', 'cemento', 'CPC-40', 'ambas')
ON CONFLICT DO NOTHING;

-- Parametros IRAM de referencia
INSERT INTO quality_parameters (parameter_name, parameter_value, unit, test_type, description, iram_norm) VALUES
  ('absorcion_max_individual', 6.0, '%', 'absorcion', 'Absorcion maxima individual para tubos de hormigon', 'IRAM 11503'),
  ('absorcion_max_promedio', 5.0, '%', 'absorcion', 'Absorcion maxima promedio (3 muestras) para tubos de hormigon', 'IRAM 11503'),
  ('flexion_min_individual', 3.5, 'MPa', 'flexion', 'Resistencia minima individual a flexion para adoquines', 'IRAM 11532'),
  ('flexion_min_promedio', 4.0, 'MPa', 'flexion', 'Resistencia minima promedio a flexion para adoquines', 'IRAM 11532'),
  ('mf_arena_min', 1.5, '', 'granulometria', 'Modulo de finura minimo para arena', 'IRAM 1627'),
  ('mf_arena_max', 3.0, '', 'granulometria', 'Modulo de finura maximo para arena', 'IRAM 1627'),
  ('mf_piedra_0_10_min', 5.5, '', 'granulometria', 'Modulo de finura minimo para piedra 0-10', 'IRAM 1627'),
  ('mf_piedra_0_10_max', 7.0, '', 'granulometria', 'Modulo de finura maximo para piedra 0-10', 'IRAM 1627'),
  ('humedad_tolerancia', 3.0, '%', 'humedad', 'Tolerancia de humedad contractual para arena', 'Contractual')
ON CONFLICT (parameter_name) DO NOTHING;
