-- Agregar campos de objetivos de producción a product_config
-- Objetivos mensuales y semanales por tipo de caño

ALTER TABLE product_config 
ADD COLUMN IF NOT EXISTS monthly_target_units INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS weekly_target_units INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS daily_target_units INTEGER DEFAULT 0;

-- Actualizar objetivos para caños (valores de ejemplo, se pueden ajustar en configuración)
UPDATE product_config SET 
  monthly_target_units = 200,
  weekly_target_units = 50,
  daily_target_units = 10
WHERE line_type = 'caños' AND product_code = 'CC300';

UPDATE product_config SET 
  monthly_target_units = 180,
  weekly_target_units = 45,
  daily_target_units = 9
WHERE line_type = 'caños' AND product_code = 'CC400';

UPDATE product_config SET 
  monthly_target_units = 150,
  weekly_target_units = 38,
  daily_target_units = 8
WHERE line_type = 'caños' AND product_code = 'CC500';

UPDATE product_config SET 
  monthly_target_units = 120,
  weekly_target_units = 30,
  daily_target_units = 6
WHERE line_type = 'caños' AND product_code = 'CC600';

UPDATE product_config SET 
  monthly_target_units = 80,
  weekly_target_units = 20,
  daily_target_units = 4
WHERE line_type = 'caños' AND product_code = 'CC800';

UPDATE product_config SET 
  monthly_target_units = 60,
  weekly_target_units = 15,
  daily_target_units = 3
WHERE line_type = 'caños' AND product_code = 'CC1000';

UPDATE product_config SET 
  monthly_target_units = 40,
  weekly_target_units = 10,
  daily_target_units = 2
WHERE line_type = 'caños' AND product_code = 'CC1200';

-- Comentario: Los objetivos se pueden modificar desde la configuración del sistema
