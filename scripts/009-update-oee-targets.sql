-- Actualizar objetivos de OEE
-- Rendimiento objetivo: 75%
-- Disponibilidad objetivo: 95%
-- Calidad objetivo: 98.5%

-- Actualizar configuración de tiempos de ciclo para bloques (20 segundos)
UPDATE cycle_times 
SET cycle_seconds = 20 
WHERE line_type = 'bloques';

-- Si no existe una tabla de configuración de objetivos, podemos comentar esto
-- y usar los valores directamente en el código del dashboard
COMMENT ON TABLE cycle_times IS 'Objetivos OEE: Disponibilidad 95%, Rendimiento 75%, Calidad 98.5%';
