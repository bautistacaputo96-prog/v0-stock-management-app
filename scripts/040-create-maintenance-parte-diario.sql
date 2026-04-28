-- Create maintenance_parte_diario table
CREATE TABLE IF NOT EXISTS maintenance_parte_diario (
  id bigserial PRIMARY KEY,
  plant text NOT NULL,
  parte_date date NOT NULL,
  operator_name text NOT NULL,
  area text NOT NULL,
  general_comment text,
  created_at timestamptz DEFAULT now()
);

-- Create maintenance_parte_diario_items table
CREATE TABLE IF NOT EXISTS maintenance_parte_diario_items (
  id bigserial PRIMARY KEY,
  parte_id bigint NOT NULL REFERENCES maintenance_parte_diario(id) ON DELETE CASCADE,
  item_id bigint NOT NULL REFERENCES maintenance_inventory(id),
  quantity numeric NOT NULL,
  comment text,
  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_parte_diario_plant ON maintenance_parte_diario(plant);
CREATE INDEX IF NOT EXISTS idx_parte_diario_date ON maintenance_parte_diario(parte_date);
CREATE INDEX IF NOT EXISTS idx_parte_diario_items_parte ON maintenance_parte_diario_items(parte_id);

-- RLS policies (allow all operations for now, same as other maintenance tables)
ALTER TABLE maintenance_parte_diario ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_parte_diario_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Allow all on maintenance_parte_diario" ON maintenance_parte_diario FOR ALL USING (true);
CREATE POLICY IF NOT EXISTS "Allow all on maintenance_parte_diario_items" ON maintenance_parte_diario_items FOR ALL USING (true);
