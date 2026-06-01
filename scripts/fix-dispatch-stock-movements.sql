-- Fix: Create stock_movements for existing dispatches that have formulas
-- This calculates material consumption based on formula and dispatch quantity

-- First, let's insert dispatch_materials records for dispatches that don't have them
INSERT INTO dispatch_materials (dispatch_id, material_id, quantity)
SELECT 
  d.id as dispatch_id,
  fm.material_id,
  (fm.quantity * d.quantity_m3) as quantity
FROM dispatches d
JOIN formula_materials fm ON fm.formula_id = d.formula_id
WHERE d.formula_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM dispatch_materials dm 
    WHERE dm.dispatch_id = d.id AND dm.material_id = fm.material_id
  );

-- Now create stock_movements for consumos based on dispatch_materials
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
WHERE NOT EXISTS (
  SELECT 1 FROM stock_movements sm 
  WHERE sm.reference_type = 'dispatch' 
    AND sm.reference_id = dm.dispatch_id 
    AND sm.material_id = dm.material_id
);

-- Verify results
SELECT 
  'dispatch_materials' as table_name,
  COUNT(*) as count
FROM dispatch_materials
UNION ALL
SELECT 
  'stock_movements (consumo)' as table_name,
  COUNT(*) as count
FROM stock_movements
WHERE movement_type = 'consumo';
