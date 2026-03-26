-- Fix column name mismatches between DB and application code

-- 1. paver_suppliers: rename columns to match component expectations
ALTER TABLE paver_suppliers RENAME COLUMN ingredient_type TO ingredient_name;
ALTER TABLE paver_suppliers RENAME COLUMN name TO supplier_name;

-- Drop old unique constraint and recreate
ALTER TABLE paver_suppliers DROP CONSTRAINT IF EXISTS paver_suppliers_ingredient_type_name_key;
ALTER TABLE paver_suppliers ADD CONSTRAINT paver_suppliers_ingredient_supplier_key UNIQUE (ingredient_name, supplier_name);

-- 2. paver_production: rename supplier columns
ALTER TABLE paver_production RENAME COLUMN supplier_cement TO cement_supplier;
ALTER TABLE paver_production RENAME COLUMN supplier_arena TO sand_supplier;
ALTER TABLE paver_production RENAME COLUMN supplier_piedra TO stone_supplier;

-- 3. Add 'unit' column to paver_formula_ingredients (used in the UI for kg/lts/cc)
ALTER TABLE paver_formula_ingredients ADD COLUMN IF NOT EXISTS unit text DEFAULT 'kg';

-- 4. Fix supplier seed data - update ingredient_name to match UI values
UPDATE paver_suppliers SET ingredient_name = 'Piedra (0-6)' WHERE ingredient_name = 'piedra';
UPDATE paver_suppliers SET ingredient_name = 'Cemento' WHERE ingredient_name = 'cemento';
UPDATE paver_suppliers SET ingredient_name = 'Arena' WHERE ingredient_name = 'arena';

-- 5. Add supplier_change_notes column if not there (production form expects it)
ALTER TABLE paver_production ADD COLUMN IF NOT EXISTS supplier_change_notes text;
