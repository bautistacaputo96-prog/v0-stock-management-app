-- Add individual formula ingredient columns to paver_production
ALTER TABLE paver_production ADD COLUMN IF NOT EXISTS formula_cement_kg numeric;
ALTER TABLE paver_production ADD COLUMN IF NOT EXISTS formula_sand_kg numeric;
ALTER TABLE paver_production ADD COLUMN IF NOT EXISTS formula_stone_kg numeric;
ALTER TABLE paver_production ADD COLUMN IF NOT EXISTS formula_additive_lts numeric;

-- Create supplier change log (tracks every change, the "current" is the latest per ingredient)
CREATE TABLE IF NOT EXISTS paver_supplier_current (
  id serial PRIMARY KEY,
  ingredient_name text NOT NULL,
  supplier_name text NOT NULL,
  changed_date date NOT NULL DEFAULT CURRENT_DATE,
  changed_notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(ingredient_name, changed_date)
);

-- Seed initial "current" suppliers from existing paver_suppliers
INSERT INTO paver_supplier_current (ingredient_name, supplier_name, changed_date, changed_notes)
SELECT DISTINCT ON (ingredient_name) ingredient_name, supplier_name, '2026-01-01', 'Proveedor inicial'
FROM paver_suppliers
WHERE active = true
ORDER BY ingredient_name, id ASC
ON CONFLICT (ingredient_name, changed_date) DO NOTHING;
