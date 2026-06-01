-- Create stock_movements table to track all material movements
CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID NOT NULL REFERENCES materials(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('ingreso', 'consumo', 'ajuste')),
  quantity_kg NUMERIC NOT NULL,
  reference_type TEXT, -- 'dispatch', 'stock_entry', 'adjustment'
  reference_id UUID,
  notes TEXT,
  movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_stock_movements_material_date 
ON stock_movements(material_id, movement_date);

CREATE INDEX IF NOT EXISTS idx_stock_movements_date 
ON stock_movements(movement_date);

-- Enable RLS
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

-- Create policy for all operations
CREATE POLICY "Allow all operations on stock_movements" ON stock_movements
  FOR ALL USING (true) WITH CHECK (true);

-- Insert movements from existing stock_entries (ingresos)
INSERT INTO stock_movements (material_id, movement_type, quantity_kg, reference_type, reference_id, movement_date, notes)
SELECT 
  material_id,
  'ingreso',
  quantity_kg,
  'stock_entry',
  id,
  entry_date,
  'Ingreso de remito ' || COALESCE(remito, 'N/A')
FROM stock_entries
WHERE quantity_kg > 0
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
