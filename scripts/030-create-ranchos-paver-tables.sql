-- Ranchos: Paver (Adoquines) Production Tables
-- Plant: Ranchos - Line: Adoquines

-- Product types for pavers (H6, H8, etc.)
CREATE TABLE IF NOT EXISTS paver_product_types (
  id serial PRIMARY KEY,
  product_code text NOT NULL UNIQUE,
  description text,
  paston_formula text,
  piece_weight_kg numeric(8,3),
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Seed default products
INSERT INTO paver_product_types (product_code, description)
VALUES 
  ('H6', 'Adoquin H6'),
  ('H8', 'Adoquin H8')
ON CONFLICT (product_code) DO NOTHING;

-- Main production table
CREATE TABLE IF NOT EXISTS paver_production (
  id serial PRIMARY KEY,
  production_date date NOT NULL,
  start_time time,
  end_time time,
  extra_minutes integer DEFAULT 0,
  product_type_id integer REFERENCES paver_product_types(id),
  product_type_code text,
  paston_formula text,
  pastones_count integer DEFAULT 0,
  cement_silo_1_tn numeric(8,3) DEFAULT 0,
  cement_silo_2_tn numeric(8,3) DEFAULT 0,
  observations text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Downtime table for pavers
CREATE TABLE IF NOT EXISTS paver_downtime (
  id serial PRIMARY KEY,
  paver_production_id integer NOT NULL REFERENCES paver_production(id) ON DELETE CASCADE,
  downtime_category text NOT NULL,
  custom_reason text NOT NULL,
  minutes integer DEFAULT 0,
  comments text,
  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_paver_production_date ON paver_production(production_date);
CREATE INDEX IF NOT EXISTS idx_paver_downtime_production_id ON paver_downtime(paver_production_id);
