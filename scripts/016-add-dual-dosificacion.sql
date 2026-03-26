-- Agregar columnas de dosificación separadas para caño chico y caño grande
ALTER TABLE pipe_production 
ADD COLUMN IF NOT EXISTS dosif_chico_cemento_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS dosif_chico_arena_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS dosif_chico_piedra_0_10_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS dosif_chico_piedra_0_20_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS dosif_chico_aditivo_1_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS dosif_chico_aditivo_2_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS dosif_chico_agua_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS dosif_grande_cemento_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS dosif_grande_arena_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS dosif_grande_piedra_0_10_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS dosif_grande_piedra_0_20_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS dosif_grande_aditivo_1_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS dosif_grande_aditivo_2_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS dosif_grande_agua_kg DECIMAL(10,2);
