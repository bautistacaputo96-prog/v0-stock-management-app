-- 1. Table for structured formula ingredients per product type
CREATE TABLE IF NOT EXISTS paver_formula_ingredients (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  product_type_id bigint NOT NULL REFERENCES paver_product_types(id) ON DELETE CASCADE,
  ingredient_name text NOT NULL,       -- 'Cemento', 'Arena', 'Piedra (0-6)', 'Aditivo 1 (Mark V)', 'Aditivo 2 (Darasell)'
  quantity_kg numeric(10,2) DEFAULT 0,
  default_supplier text,               -- only for Cemento/Arena/Piedra
  sort_order int DEFAULT 0,
  UNIQUE(product_type_id, ingredient_name)
);

-- 2. Supplier catalog for autocompletion
CREATE TABLE IF NOT EXISTS paver_suppliers (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  ingredient_type text NOT NULL,       -- 'cemento', 'arena', 'piedra'
  name text NOT NULL,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(ingredient_type, name)
);

-- 3. Add supplier columns to paver_production
ALTER TABLE paver_production
  ADD COLUMN IF NOT EXISTS supplier_cement text,
  ADD COLUMN IF NOT EXISTS supplier_arena text,
  ADD COLUMN IF NOT EXISTS supplier_piedra text,
  ADD COLUMN IF NOT EXISTS supplier_changed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS supplier_change_notes text;

-- 4. Seed default ingredients for H6 and H8
INSERT INTO paver_formula_ingredients (product_type_id, ingredient_name, quantity_kg, sort_order)
SELECT pt.id, i.name, 0, i.ord
FROM paver_product_types pt
CROSS JOIN (VALUES 
  ('Cemento', 1),
  ('Arena', 2),
  ('Piedra (0-6)', 3),
  ('Aditivo 1 (Mark V)', 4),
  ('Aditivo 2 (Darasell)', 5)
) AS i(name, ord)
WHERE pt.product_code IN ('H6', 'H8')
ON CONFLICT (product_type_id, ingredient_name) DO NOTHING;

-- 5. Seed some initial suppliers
INSERT INTO paver_suppliers (ingredient_type, name) VALUES
  ('piedra', 'Piatti'),
  ('piedra', 'Avellaneda')
ON CONFLICT (ingredient_type, name) DO NOTHING;

-- 6. Index for quick supplier change queries
CREATE INDEX IF NOT EXISTS idx_paver_production_supplier_changed 
  ON paver_production(supplier_changed) WHERE supplier_changed = true;
