-- Agregar columnas para los 5 tipos de cajones de desperdicio
-- Cada cajón tiene un peso diferente y el operario puede ingresar cantidad con precisión de 0.5

-- Cajón 1: Sector Cinta - 710kg
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS waste_bin_1_cinta numeric DEFAULT 0;
COMMENT ON COLUMN pipe_production.waste_bin_1_cinta IS 'Cajón 1 - Sector Cinta (710kg/cajón)';

-- Cajón 2: Sector Desmolde - 656kg
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS waste_bin_2_desmolde numeric DEFAULT 0;
COMMENT ON COLUMN pipe_production.waste_bin_2_desmolde IS 'Cajón 2 - Sector Desmolde (656kg/cajón)';

-- Cajón 3: Sector Cinta (segundo) - 476.5kg neto (585kg bruto - 108.5kg tara)
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS waste_bin_3_cinta numeric DEFAULT 0;
COMMENT ON COLUMN pipe_production.waste_bin_3_cinta IS 'Cajón 3 - Sector Cinta (476.5kg neto/cajón)';

-- Cajón 4: Caños Rotos - 1307kg
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS waste_bin_4_rotos numeric DEFAULT 0;
COMMENT ON COLUMN pipe_production.waste_bin_4_rotos IS 'Cajón 4 - Caños Rotos (1307kg/cajón)';

-- Cajón 5: Mezcladora - 710kg
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS waste_bin_5_mezcladora numeric DEFAULT 0;
COMMENT ON COLUMN pipe_production.waste_bin_5_mezcladora IS 'Cajón 5 - Mezcladora (710kg/cajón)';

-- Columna calculada para el total de desperdicio en kg
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS total_waste_kg numeric DEFAULT 0;
COMMENT ON COLUMN pipe_production.total_waste_kg IS 'Total de desperdicio en kg (calculado desde los cajones)';
