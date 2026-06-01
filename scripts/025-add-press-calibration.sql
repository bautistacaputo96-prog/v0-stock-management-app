-- Table to store press calibration constants
-- Formula: Y = Ax³ + Bx² + Cx + D (where X is dial reading, Y is KGF)
-- MPa = Y * 9.80665 / (π * r²) where r = 0.05m for 10x20 cylinders
CREATE TABLE IF NOT EXISTS press_calibrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id UUID REFERENCES plants(id),
  calibration_date DATE NOT NULL,
  constant_a NUMERIC NOT NULL DEFAULT 0,
  constant_b NUMERIC NOT NULL DEFAULT 0,
  constant_c NUMERIC NOT NULL DEFAULT 0,
  constant_d NUMERIC NOT NULL DEFAULT 0,
  cylinder_diameter_cm NUMERIC NOT NULL DEFAULT 10,
  is_active BOOLEAN DEFAULT true,
  calibrated_by VARCHAR,
  certificate_number VARCHAR,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookup of active calibration
CREATE INDEX IF NOT EXISTS idx_press_calibrations_active ON press_calibrations(plant_id, is_active);
