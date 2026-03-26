-- Agregar campo para cantidad de operarios en pipe_production
ALTER TABLE pipe_production 
ADD COLUMN IF NOT EXISTS operators_count integer DEFAULT 3;

-- Comentario explicativo
COMMENT ON COLUMN pipe_production.operators_count IS 'Cantidad de operarios en el turno, generalmente 3 o 4';
