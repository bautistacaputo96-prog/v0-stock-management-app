-- Agregar campo de categoría a las paradas para identificar paradas planificadas
ALTER TABLE block_downtime ADD COLUMN IF NOT EXISTS downtime_category TEXT;
ALTER TABLE pipe_downtime ADD COLUMN IF NOT EXISTS downtime_category TEXT;

-- Actualizar la estructura de block_downtime para incluir minutos
ALTER TABLE block_downtime ADD COLUMN IF NOT EXISTS minutes INTEGER DEFAULT 0;
ALTER TABLE pipe_downtime ADD COLUMN IF NOT EXISTS minutes INTEGER DEFAULT 0;
