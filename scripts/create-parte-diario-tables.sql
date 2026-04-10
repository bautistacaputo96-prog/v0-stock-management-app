-- Tabla de partes diarios de mantenimiento
CREATE TABLE IF NOT EXISTS maintenance_parte_diario (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant TEXT NOT NULL,
  parte_date DATE NOT NULL DEFAULT CURRENT_DATE,
  operator_name TEXT NOT NULL,
  area TEXT NOT NULL,
  section_id UUID REFERENCES maintenance_sections(id) ON DELETE SET NULL,
  general_comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de items usados en cada parte diario
CREATE TABLE IF NOT EXISTS maintenance_parte_diario_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parte_id UUID NOT NULL REFERENCES maintenance_parte_diario(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES maintenance_inventory(id) ON DELETE RESTRICT,
  quantity DECIMAL(10,2) NOT NULL CHECK (quantity > 0),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para mejor rendimiento
CREATE INDEX IF NOT EXISTS idx_parte_diario_plant_date ON maintenance_parte_diario(plant, parte_date DESC);
CREATE INDEX IF NOT EXISTS idx_parte_diario_operator ON maintenance_parte_diario(operator_name);
CREATE INDEX IF NOT EXISTS idx_parte_diario_items_parte ON maintenance_parte_diario_items(parte_id);
