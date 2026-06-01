-- Create materials table (raw materials like cement, sand, gravel, water, etc.)
CREATE TABLE IF NOT EXISTS materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  unit VARCHAR(20) NOT NULL, -- kg, L, m3, etc.
  current_stock DECIMAL(10, 2) NOT NULL DEFAULT 0,
  min_stock DECIMAL(10, 2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create formulas table (concrete formulas like H-17, H-21, H-30, etc.)
CREATE TABLE IF NOT EXISTS formulas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  yield_m3 DECIMAL(10, 3) NOT NULL DEFAULT 1, -- how many m3 this formula produces
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create formula_materials table (composition of each formula)
CREATE TABLE IF NOT EXISTS formula_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  formula_id UUID NOT NULL REFERENCES formulas(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  quantity DECIMAL(10, 3) NOT NULL, -- quantity of material per batch
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(formula_id, material_id)
);

-- Create stock_entries table (incoming raw materials)
CREATE TABLE IF NOT EXISTS stock_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  quantity DECIMAL(10, 2) NOT NULL,
  supplier VARCHAR(200),
  remito VARCHAR(100),
  notes TEXT,
  entry_date TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create dispatches table (outgoing finished product)
CREATE TABLE IF NOT EXISTS dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  formula_id UUID NOT NULL REFERENCES formulas(id) ON DELETE CASCADE,
  quantity_m3 DECIMAL(10, 3) NOT NULL,
  client VARCHAR(200),
  obra VARCHAR(200),
  remito VARCHAR(100),
  notes TEXT,
  dispatch_date TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create dispatch_materials table (materials consumed per dispatch)
CREATE TABLE IF NOT EXISTS dispatch_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id UUID NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  quantity DECIMAL(10, 3) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_stock_entries_material ON stock_entries(material_id);
CREATE INDEX IF NOT EXISTS idx_stock_entries_date ON stock_entries(entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_dispatches_formula ON dispatches(formula_id);
CREATE INDEX IF NOT EXISTS idx_dispatches_date ON dispatches(dispatch_date DESC);
CREATE INDEX IF NOT EXISTS idx_formula_materials_formula ON formula_materials(formula_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_materials_dispatch ON dispatch_materials(dispatch_id);

-- Create function to update material stock after entry
CREATE OR REPLACE FUNCTION update_stock_after_entry()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE materials
  SET current_stock = current_stock + NEW.quantity,
      updated_at = NOW()
  WHERE id = NEW.material_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create function to update material stock after dispatch
CREATE OR REPLACE FUNCTION update_stock_after_dispatch()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE materials
  SET current_stock = current_stock - NEW.quantity,
      updated_at = NOW()
  WHERE id = NEW.material_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
DROP TRIGGER IF EXISTS trigger_update_stock_entry ON stock_entries;
CREATE TRIGGER trigger_update_stock_entry
  AFTER INSERT ON stock_entries
  FOR EACH ROW
  EXECUTE FUNCTION update_stock_after_entry();

DROP TRIGGER IF EXISTS trigger_update_stock_dispatch ON dispatch_materials;
CREATE TRIGGER trigger_update_stock_dispatch
  AFTER INSERT ON dispatch_materials
  FOR EACH ROW
  EXECUTE FUNCTION update_stock_after_dispatch();
