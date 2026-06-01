-- =============================================
-- REBUILD DATABASE - All tables + seed data
-- =============================================

-- 1. PLANTS
CREATE TABLE IF NOT EXISTS plants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  code VARCHAR(50) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO plants (name, code) VALUES 
  ('Canning', 'CAN'),
  ('Hudson', 'HUD')
ON CONFLICT (code) DO NOTHING;

-- 2. MATERIALS
CREATE TABLE IF NOT EXISTS materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  unit VARCHAR(20) NOT NULL,
  current_stock DECIMAL(10, 2) NOT NULL DEFAULT 0,
  min_stock DECIMAL(10, 2) DEFAULT 0,
  plant_id UUID REFERENCES plants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. FORMULAS
CREATE TABLE IF NOT EXISTS formulas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  yield_m3 DECIMAL(10, 3) NOT NULL DEFAULT 1,
  plant_id UUID REFERENCES plants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. FORMULA_MATERIALS
CREATE TABLE IF NOT EXISTS formula_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  formula_id UUID NOT NULL REFERENCES formulas(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  quantity DECIMAL(10, 3) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(formula_id, material_id)
);

-- 5. CLIENTS
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  contact VARCHAR(255),
  phone VARCHAR(50),
  email VARCHAR(255),
  plant_id UUID REFERENCES plants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. CONSTRUCTION_SITES
CREATE TABLE IF NOT EXISTS construction_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  address TEXT,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. MIXERS
CREATE TABLE IF NOT EXISTS mixers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_plate VARCHAR(20) NOT NULL UNIQUE,
  brand VARCHAR(100),
  plant_id UUID REFERENCES plants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. SUPPLIERS
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  contact VARCHAR(255),
  phone VARCHAR(50),
  plant_id UUID REFERENCES plants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. MATERIAL_SUPPLIERS
CREATE TABLE IF NOT EXISTS material_suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(supplier_id, material_id)
);

-- 10. CARRIERS
CREATE TABLE IF NOT EXISTS carriers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  driver_name VARCHAR(255),
  phone VARCHAR(50),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. STOCK_ENTRIES
CREATE TABLE IF NOT EXISTS stock_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  quantity DECIMAL(10, 2) NOT NULL,
  supplier VARCHAR(200),
  supplier_id UUID REFERENCES suppliers(id),
  carrier_id UUID REFERENCES carriers(id),
  remito VARCHAR(100),
  notes TEXT,
  entry_date TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. DISPATCHES
CREATE TABLE IF NOT EXISTS dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  formula_id UUID NOT NULL REFERENCES formulas(id) ON DELETE CASCADE,
  quantity_m3 DECIMAL(10, 3) NOT NULL,
  client_id UUID REFERENCES clients(id),
  construction_site_id UUID REFERENCES construction_sites(id),
  mixer_id UUID REFERENCES mixers(id),
  remito VARCHAR(100),
  notes TEXT,
  extra_water_liters DECIMAL(10, 2),
  sand_stockpile_humidity DECIMAL(10, 2),
  sample_taken BOOLEAN DEFAULT false,
  sample_number VARCHAR(100),
  actual_slump_cm DECIMAL(10, 2),
  is_test_dispatch BOOLEAN DEFAULT false,
  dispatch_date TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. DISPATCH_MATERIALS
CREATE TABLE IF NOT EXISTS dispatch_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id UUID NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  quantity DECIMAL(10, 3) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. TEST_CYLINDERS
CREATE TABLE IF NOT EXISTS test_cylinders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id UUID REFERENCES dispatches(id) ON DELETE CASCADE,
  cylinder_number INT NOT NULL,
  test_age_days INT NOT NULL,
  scheduled_test_date DATE,
  actual_test_date DATE,
  dial_reading DECIMAL(10, 2),
  strength_mpa DECIMAL(10, 2),
  weight_grams DECIMAL(10, 2),
  comments TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(dispatch_id, cylinder_number)
);

-- 15. GRANULOMETRIA_TESTS
CREATE TABLE IF NOT EXISTS granulometria_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  extraction_date DATE NOT NULL,
  material_id UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES suppliers(id),
  dry_weight_grams DECIMAL(10, 2),
  remito VARCHAR(100),
  plant_id UUID REFERENCES plants(id),
  comments TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 16. GRANULOMETRIA_SIEVE_RESULTS
CREATE TABLE IF NOT EXISTS granulometria_sieve_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES granulometria_tests(id) ON DELETE CASCADE,
  sieve_name VARCHAR(20) NOT NULL,
  retained_grams DECIMAL(10, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 17. MANUAL_MATERIAL_WITHDRAWALS
CREATE TABLE IF NOT EXISTS manual_material_withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  plant_id UUID REFERENCES plants(id),
  observations TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 18. MANUAL_WITHDRAWAL_ITEMS
CREATE TABLE IF NOT EXISTS manual_withdrawal_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_id UUID NOT NULL REFERENCES manual_material_withdrawals(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  quantity_kg DECIMAL(10, 3) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_materials_plant_id ON materials(plant_id);
CREATE INDEX IF NOT EXISTS idx_formulas_plant_id ON formulas(plant_id);
CREATE INDEX IF NOT EXISTS idx_stock_entries_material ON stock_entries(material_id);
CREATE INDEX IF NOT EXISTS idx_stock_entries_date ON stock_entries(entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_dispatches_formula ON dispatches(formula_id);
CREATE INDEX IF NOT EXISTS idx_dispatches_date ON dispatches(dispatch_date DESC);
CREATE INDEX IF NOT EXISTS idx_formula_materials_formula ON formula_materials(formula_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_materials_dispatch ON dispatch_materials(dispatch_id);

-- FUNCTIONS
CREATE OR REPLACE FUNCTION update_material_stock(p_material_id UUID, p_quantity_change DECIMAL)
RETURNS void AS $$
BEGIN
  UPDATE materials
  SET current_stock = current_stock + p_quantity_change,
      updated_at = NOW()
  WHERE id = p_material_id;
END;
$$ LANGUAGE plpgsql;
