-- Create stock_movements table for tracking material flow
CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID NOT NULL REFERENCES materials(id),
  movement_type VARCHAR(20) NOT NULL CHECK (movement_type IN ('ingreso', 'consumo', 'ajuste')),
  quantity_kg NUMERIC NOT NULL,
  reference_type VARCHAR(50), -- 'stock_entry', 'dispatch', 'adjustment'
  reference_id UUID,
  movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_stock_movements_material_id ON stock_movements(material_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_date ON stock_movements(movement_date);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type ON stock_movements(movement_type);

-- Insert movements from existing stock entries (ingresos)
INSERT INTO stock_movements (material_id, movement_type, quantity_kg, reference_type, reference_id, movement_date, notes)
SELECT 
  se.material_id,
  'ingreso',
  se.quantity,
  'stock_entry',
  se.id,
  se.entry_date::date,
  'Ingreso remito ' || COALESCE(se.remito, 'N/A')
FROM stock_entries se
WHERE se.quantity > 0
ON CONFLICT DO NOTHING;

-- Insert movements from existing dispatches (consumos)
INSERT INTO stock_movements (material_id, movement_type, quantity_kg, reference_type, reference_id, movement_date, notes)
SELECT 
  dm.material_id,
  'consumo',
  dm.quantity,
  'dispatch',
  dm.dispatch_id,
  d.dispatch_date::date,
  'Despacho remito ' || COALESCE(d.remito, 'N/A')
FROM dispatch_materials dm
JOIN dispatches d ON dm.dispatch_id = d.id
WHERE dm.quantity > 0
ON CONFLICT DO NOTHING;
