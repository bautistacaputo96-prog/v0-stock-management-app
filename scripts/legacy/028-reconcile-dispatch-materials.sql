-- Reconcile dispatch materials for existing dispatches that didn't discount stock
-- This script calculates and applies stock adjustments based on historical dispatches

-- First, insert missing dispatch_materials records for dispatches that don't have them
INSERT INTO dispatch_materials (dispatch_id, material_id, quantity, dry_quantity, wet_quantity, humidity_at_dispatch)
SELECT 
  d.id as dispatch_id,
  fm.material_id,
  fm.quantity * d.quantity_m3 as quantity,
  fm.quantity * d.quantity_m3 as dry_quantity,
  CASE 
    WHEN (LOWER(m.name) LIKE '%arena%' OR LOWER(m.name) LIKE '%sand%') AND COALESCE(m.stockpile_humidity, 0) > 0 
    THEN fm.quantity * d.quantity_m3 * (1 + m.stockpile_humidity / 100)
    ELSE fm.quantity * d.quantity_m3
  END as wet_quantity,
  CASE 
    WHEN LOWER(m.name) LIKE '%arena%' OR LOWER(m.name) LIKE '%sand%'
    THEN COALESCE(m.stockpile_humidity, 0)
    ELSE NULL
  END as humidity_at_dispatch
FROM dispatches d
JOIN formulas f ON d.formula_id = f.id
JOIN formula_materials fm ON fm.formula_id = f.id
JOIN materials m ON fm.material_id = m.id
WHERE NOT EXISTS (
  SELECT 1 FROM dispatch_materials dm 
  WHERE dm.dispatch_id = d.id AND dm.material_id = fm.material_id
)
AND d.dispatch_date >= CURRENT_DATE - INTERVAL '7 days';

-- Now update material stock based on dispatch_materials
WITH material_consumption AS (
  SELECT 
    dm.material_id,
    SUM(COALESCE(dm.wet_quantity, dm.quantity)) as total_consumed
  FROM dispatch_materials dm
  JOIN dispatches d ON dm.dispatch_id = d.id
  WHERE d.dispatch_date >= CURRENT_DATE - INTERVAL '7 days'
  GROUP BY dm.material_id
)
UPDATE materials m
SET current_stock = GREATEST(0, m.current_stock - mc.total_consumed)
FROM material_consumption mc
WHERE m.id = mc.material_id;

-- Log what was adjusted
SELECT 
  m.name as material_name,
  m.current_stock as new_stock,
  COALESCE(mc.total_consumed, 0) as total_consumed_7days
FROM materials m
LEFT JOIN (
  SELECT 
    dm.material_id,
    SUM(COALESCE(dm.wet_quantity, dm.quantity)) as total_consumed
  FROM dispatch_materials dm
  JOIN dispatches d ON dm.dispatch_id = d.id
  WHERE d.dispatch_date >= CURRENT_DATE - INTERVAL '7 days'
  GROUP BY dm.material_id
) mc ON m.id = mc.material_id
WHERE mc.total_consumed > 0
ORDER BY m.name;
