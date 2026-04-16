-- Table to track formula changes with person and reason
CREATE TABLE IF NOT EXISTS paver_formula_changes (
  id serial PRIMARY KEY,
  paver_production_id integer REFERENCES paver_production(id) ON DELETE CASCADE,
  change_date timestamptz DEFAULT now(),
  changed_by text NOT NULL,
  change_reason text NOT NULL,
  -- Previous values
  prev_cement_kg numeric(8,3),
  prev_sand_kg numeric(8,3),
  prev_stone_kg numeric(8,3),
  prev_additive_lts numeric(8,4),
  -- New values
  new_cement_kg numeric(8,3),
  new_sand_kg numeric(8,3),
  new_stone_kg numeric(8,3),
  new_additive_lts numeric(8,4),
  created_at timestamptz DEFAULT now()
);

-- Add columns to paver_production to store formula with change tracking
ALTER TABLE paver_production 
ADD COLUMN IF NOT EXISTS formula_cement_kg numeric(8,3),
ADD COLUMN IF NOT EXISTS formula_sand_kg numeric(8,3),
ADD COLUMN IF NOT EXISTS formula_stone_kg numeric(8,3),
ADD COLUMN IF NOT EXISTS formula_additive_lts numeric(8,4),
ADD COLUMN IF NOT EXISTS formula_changed boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS formula_changed_by text,
ADD COLUMN IF NOT EXISTS formula_change_reason text;

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_paver_formula_changes_date ON paver_formula_changes(change_date);
CREATE INDEX IF NOT EXISTS idx_paver_production_formula_changed ON paver_production(formula_changed) WHERE formula_changed = true;
