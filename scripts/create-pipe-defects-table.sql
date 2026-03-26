-- ============================================
-- Pipe Defect Reasons & Defect Records
-- ============================================

-- 1. Catalog of defect reasons
CREATE TABLE IF NOT EXISTS pipe_defect_reasons (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL, -- 'produccion' or 'desmolde'
  reason TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Defects per pipe quality item (links to pipe_quality_items)
CREATE TABLE IF NOT EXISTS pipe_quality_defects (
  id SERIAL PRIMARY KEY,
  pipe_quality_item_id INT NOT NULL REFERENCES pipe_quality_items(id) ON DELETE CASCADE,
  defect_reason_id INT NOT NULL REFERENCES pipe_defect_reasons(id),
  defect_type TEXT NOT NULL DEFAULT 'broken', -- 'broken' or 'second'
  quantity INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed defect reasons
INSERT INTO pipe_defect_reasons (category, reason, display_order) VALUES
  -- Rotura dentro de produccion
  ('produccion', 'Cano mal cargado', 1),
  ('produccion', 'Cano seco', 2),
  ('produccion', 'Molde en mal estado', 3),
  ('produccion', 'Panal de abeja', 4),
  ('produccion', 'Mala terminacion', 5),
  ('produccion', 'Diferencia de espesores', 6),
  ('produccion', 'Cano pasado de agua', 7),
  -- Rotura en desmolde
  ('desmolde', 'Aro en mal estado', 8),
  ('desmolde', 'Cano fresco', 9),
  ('desmolde', 'Traslado', 10),
  ('desmolde', 'Manipulacion en playa', 11),
  ('desmolde', 'Fisura por molde', 12),
  ('desmolde', 'Fisura por noyo vibrador', 13)
ON CONFLICT DO NOTHING;
