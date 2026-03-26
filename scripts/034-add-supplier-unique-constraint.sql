-- Add unique constraint to prevent duplicate supplier entries
-- Using IF NOT EXISTS pattern
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'paver_suppliers_ingredient_supplier_unique'
  ) THEN
    ALTER TABLE paver_suppliers ADD CONSTRAINT paver_suppliers_ingredient_supplier_unique
      UNIQUE (ingredient_name, supplier_name);
  END IF;
END $$;
