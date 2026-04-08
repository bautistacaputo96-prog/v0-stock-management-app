-- ============================================
-- Quality Module Extension Tables
-- ============================================

-- 1. Pipe Mix Designs (Dosificaciones por diámetro)
CREATE TABLE IF NOT EXISTS pipe_mix_designs (
  id SERIAL PRIMARY KEY,
  plant TEXT NOT NULL DEFAULT 'silke',
  diameter INT NOT NULL, -- 300, 400, 500, 600, 800
  cycle_time_min NUMERIC(6,2) NOT NULL DEFAULT 0,
  pipe_weight_kg NUMERIC(8,2) NOT NULL DEFAULT 0,
  cement_kg NUMERIC(8,2) NOT NULL DEFAULT 0,
  sand_kg NUMERIC(8,2) NOT NULL DEFAULT 0,
  stone_kg NUMERIC(8,2) NOT NULL DEFAULT 0,
  water_liters NUMERIC(8,2) NOT NULL DEFAULT 0,
  additive_liters NUMERIC(8,2) NOT NULL DEFAULT 0,
  additive_name TEXT,
  version INT NOT NULL DEFAULT 1,
  modified_by TEXT,
  modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(plant, diameter, version)
);

-- 2. Pipe Mix Design History (historial de cambios)
CREATE TABLE IF NOT EXISTS pipe_mix_design_history (
  id SERIAL PRIMARY KEY,
  pipe_mix_design_id INT NOT NULL REFERENCES pipe_mix_designs(id) ON DELETE CASCADE,
  diameter INT NOT NULL,
  cycle_time_min NUMERIC(6,2),
  pipe_weight_kg NUMERIC(8,2),
  cement_kg NUMERIC(8,2),
  sand_kg NUMERIC(8,2),
  stone_kg NUMERIC(8,2),
  water_liters NUMERIC(8,2),
  additive_liters NUMERIC(8,2),
  modified_by TEXT,
  modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Granulometry bands (límites de aceptación)
CREATE TABLE IF NOT EXISTS granulometry_bands (
  id SERIAL PRIMARY KEY,
  material_type TEXT NOT NULL, -- arena, piedra
  sieve_size_mm NUMERIC(8,3) NOT NULL,
  lower_limit NUMERIC(6,2) NOT NULL DEFAULT 0,
  upper_limit NUMERIC(6,2) NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Extended Granulometry Tests (más campos)
ALTER TABLE granulometry_tests 
  ADD COLUMN IF NOT EXISTS material_type TEXT DEFAULT 'arena',
  ADD COLUMN IF NOT EXISTS origin TEXT DEFAULT 'acopio', -- acopio, camion
  ADD COLUMN IF NOT EXISTS remito_number TEXT,
  ADD COLUMN IF NOT EXISTS total_sample_weight_g NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS complies_spec BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS sieve_3_8 NUMERIC(6,2) DEFAULT 0, -- 3/8" = 9.5mm
  ADD COLUMN IF NOT EXISTS sieve_4 NUMERIC(6,2) DEFAULT 0, -- #4 = 4.75mm
  ADD COLUMN IF NOT EXISTS sieve_8 NUMERIC(6,2) DEFAULT 0, -- #8 = 2.36mm
  ADD COLUMN IF NOT EXISTS sieve_16 NUMERIC(6,2) DEFAULT 0, -- #16 = 1.18mm
  ADD COLUMN IF NOT EXISTS sieve_30 NUMERIC(6,2) DEFAULT 0, -- #30 = 600um
  ADD COLUMN IF NOT EXISTS sieve_50 NUMERIC(6,2) DEFAULT 0, -- #50 = 300um
  ADD COLUMN IF NOT EXISTS sieve_100 NUMERIC(6,2) DEFAULT 0, -- #100 = 150um
  ADD COLUMN IF NOT EXISTS sieve_fondo NUMERIC(6,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS plant TEXT DEFAULT 'silke';

-- 5. Humidity Tests extended
ALTER TABLE humidity_tests
  ADD COLUMN IF NOT EXISTS origin TEXT DEFAULT 'camion', -- acopio, camion
  ADD COLUMN IF NOT EXISTS plant TEXT DEFAULT 'silke',
  ADD COLUMN IF NOT EXISTS wet_weight_g NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS dry_weight_g NUMERIC(10,2);

-- 6. Absorption Tests plant field
ALTER TABLE absorption_tests
  ADD COLUMN IF NOT EXISTS plant TEXT DEFAULT 'silke';

-- 7. Quality Alerts (alertas de calidad)
CREATE TABLE IF NOT EXISTS quality_alerts (
  id SERIAL PRIMARY KEY,
  alert_type TEXT NOT NULL, -- granulometry_out_of_spec, humidity_high, absorption_fail
  severity TEXT NOT NULL DEFAULT 'warning', -- info, warning, critical
  title TEXT NOT NULL,
  description TEXT,
  test_id INT,
  test_type TEXT,
  plant TEXT DEFAULT 'silke',
  is_resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- Seed Data
-- ============================================

-- Default Mix Designs for Silke (datos de ejemplo)
INSERT INTO pipe_mix_designs (plant, diameter, cycle_time_min, pipe_weight_kg, cement_kg, sand_kg, stone_kg, water_liters, additive_liters, modified_by) VALUES
  ('silke', 300, 2.5, 95, 35, 55, 90, 12, 0.3, 'Sistema'),
  ('silke', 400, 3.0, 150, 45, 70, 120, 16, 0.4, 'Sistema'),
  ('silke', 500, 3.5, 220, 55, 85, 150, 20, 0.5, 'Sistema'),
  ('silke', 600, 4.0, 310, 70, 110, 200, 26, 0.6, 'Sistema'),
  ('silke', 800, 5.0, 520, 95, 150, 280, 36, 0.8, 'Sistema')
ON CONFLICT DO NOTHING;

-- Granulometry bands for Sand (Arena - según ASTM C33)
INSERT INTO granulometry_bands (material_type, sieve_size_mm, lower_limit, upper_limit) VALUES
  ('arena', 9.500, 100, 100),   -- 3/8"
  ('arena', 4.750, 95, 100),    -- #4
  ('arena', 2.360, 80, 100),    -- #8
  ('arena', 1.180, 50, 85),     -- #16
  ('arena', 0.600, 25, 60),     -- #30
  ('arena', 0.300, 5, 30),      -- #50
  ('arena', 0.150, 0, 10),      -- #100
  ('arena', 0.000, 0, 0)        -- Fondo
ON CONFLICT DO NOTHING;

-- Granulometry bands for Stone (Piedra 0-10)
INSERT INTO granulometry_bands (material_type, sieve_size_mm, lower_limit, upper_limit) VALUES
  ('piedra', 9.500, 85, 100),   -- 3/8"
  ('piedra', 4.750, 10, 40),    -- #4
  ('piedra', 2.360, 0, 15),     -- #8
  ('piedra', 1.180, 0, 5),      -- #16
  ('piedra', 0.600, 0, 5),      -- #30
  ('piedra', 0.300, 0, 5),      -- #50
  ('piedra', 0.150, 0, 5),      -- #100
  ('piedra', 0.000, 0, 5)       -- Fondo
ON CONFLICT DO NOTHING;
