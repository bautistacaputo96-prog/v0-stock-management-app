-- Add clay content (contenido de arcilla) columns to stockpile_granulometry
-- C.A = PH - PS (material lost during washing)
-- %C.A = (C.A / PS) * 100

-- Add columns for wet weight before washing (PH) and dry weight after washing (PS)
ALTER TABLE stockpile_granulometry 
ADD COLUMN IF NOT EXISTS peso_humedo_g numeric,
ADD COLUMN IF NOT EXISTS peso_seco_g numeric,
ADD COLUMN IF NOT EXISTS contenido_arcilla_g numeric GENERATED ALWAYS AS (peso_humedo_g - peso_seco_g) STORED,
ADD COLUMN IF NOT EXISTS porcentaje_arcilla numeric GENERATED ALWAYS AS (
  CASE WHEN peso_seco_g > 0 THEN ((peso_humedo_g - peso_seco_g) / peso_seco_g) * 100 ELSE 0 END
) STORED;

-- Add comment to explain the columns
COMMENT ON COLUMN stockpile_granulometry.peso_humedo_g IS 'Peso húmedo de la muestra antes del lavado (g) - PH';
COMMENT ON COLUMN stockpile_granulometry.peso_seco_g IS 'Peso seco después del lavado y tamizado (g) - PS';
COMMENT ON COLUMN stockpile_granulometry.contenido_arcilla_g IS 'Contenido de arcilla en gramos (PH - PS)';
COMMENT ON COLUMN stockpile_granulometry.porcentaje_arcilla IS 'Porcentaje de contenido de arcilla ((PH-PS)/PS)*100';
