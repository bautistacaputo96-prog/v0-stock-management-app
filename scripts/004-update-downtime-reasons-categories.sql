-- Clear existing downtime reasons and add new categorized reasons based on user's image

-- Delete existing reasons
DELETE FROM downtime_reasons;

-- Factores Externos
INSERT INTO downtime_reasons (reason, line_type, category) VALUES 
('Energía Eléctrica', 'bloques', 'Factores Externos'),
('Piedra en Materia Prima', 'bloques', 'Factores Externos'),
('Energía Eléctrica', 'caños', 'Factores Externos'),
('Piedra en Materia Prima', 'caños', 'Factores Externos');

-- Paradas Planificadas
INSERT INTO downtime_reasons (reason, line_type, category) VALUES 
('Cambio de Producto', 'bloques', 'Paradas Planificadas'),
('Mantenimiento', 'bloques', 'Paradas Planificadas'),
('Capacitación', 'bloques', 'Paradas Planificadas'),
('Reuniones', 'bloques', 'Paradas Planificadas'),
('Mant. Aut (Limp, Lub. Y Ajustes)', 'bloques', 'Paradas Planificadas'),
('Pruebas y/o Ensayos varios', 'bloques', 'Paradas Planificadas'),
('Cambio de Producto', 'caños', 'Paradas Planificadas'),
('Mantenimiento', 'caños', 'Paradas Planificadas'),
('Capacitación', 'caños', 'Paradas Planificadas'),
('Reuniones', 'caños', 'Paradas Planificadas'),
('Mant. Aut (Limp, Lub. Y Ajustes)', 'caños', 'Paradas Planificadas'),
('Pruebas y/o Ensayos varios', 'caños', 'Paradas Planificadas');

-- Fallas de Equipo (Paradas Mayores a 5 min.)
INSERT INTO downtime_reasons (reason, line_type, category) VALUES 
('Bomba de Agua de Pozo', 'bloques', 'Fallas de Equipo'),
('Tolvas de Áridos', 'bloques', 'Fallas de Equipo'),
('Balanza de Áridos', 'bloques', 'Fallas de Equipo'),
('Cinta Transp. de Áridos', 'bloques', 'Fallas de Equipo'),
('Skip', 'bloques', 'Fallas de Equipo'),
('Sinfín de Cemento', 'bloques', 'Fallas de Equipo'),
('Balanza de Cemento', 'bloques', 'Fallas de Equipo'),
('Mezcladora', 'bloques', 'Fallas de Equipo'),
('Bloquera', 'bloques', 'Fallas de Equipo'),
('Limpiadores', 'bloques', 'Fallas de Equipo'),
('Cargador', 'bloques', 'Fallas de Equipo'),
('Molde-Zapata', 'bloques', 'Fallas de Equipo'),
('Mesa Vibradora', 'bloques', 'Fallas de Equipo'),
('Responsable de producción', 'bloques', 'Fallas de Equipo'),
('Vibrad/Motores', 'bloques', 'Fallas de Equipo'),
('Ascensor', 'bloques', 'Fallas de Equipo'),
('Descensor', 'bloques', 'Fallas de Equipo'),
('Paletizadora', 'bloques', 'Fallas de Equipo'),
('Trans.Ret.Tabla', 'bloques', 'Fallas de Equipo'),
('Mesa Avanza Retr.', 'bloques', 'Fallas de Equipo'),
('Mesa Retorna Tabla', 'bloques', 'Fallas de Equipo'),
('Transp. Frontal', 'bloques', 'Fallas de Equipo'),
('Dosificador Aditivo', 'bloques', 'Fallas de Equipo'),
('Gira Tablas', 'bloques', 'Fallas de Equipo'),
('Compresor de Aire', 'bloques', 'Fallas de Equipo'),
('Puesta a Punto', 'bloques', 'Fallas de Equipo'),
('Electroválvula', 'bloques', 'Fallas de Equipo');

-- Falla de Proceso
INSERT INTO downtime_reasons (reason, line_type, category) VALUES 
('Problema con Calidad de Hormigón', 'bloques', 'Falla de Proceso'),
('Problema con Calidad de Mat. Prima', 'bloques', 'Falla de Proceso'),
('Calidad de Producto', 'bloques', 'Falla de Proceso'),
('Arranques y Ajustes en Moldes', 'bloques', 'Falla de Proceso'),
('Problema con Calidad de Hormigón', 'caños', 'Falla de Proceso'),
('Problema con Calidad de Mat. Prima', 'caños', 'Falla de Proceso'),
('Calidad de Producto', 'caños', 'Falla de Proceso'),
('Arranques y Ajustes en Moldes', 'caños', 'Falla de Proceso');

-- Falla de Gestión
INSERT INTO downtime_reasons (reason, line_type, category) VALUES 
('Espera de Materia Prima', 'bloques', 'Falla de Gestión'),
('Espera de Insumos', 'bloques', 'Falla de Gestión'),
('Espera de Instrucciones', 'bloques', 'Falla de Gestión'),
('Factores Humanos', 'bloques', 'Falla de Gestión'),
('Espera de Materia Prima', 'caños', 'Falla de Gestión'),
('Espera de Insumos', 'caños', 'Falla de Gestión'),
('Espera de Instrucciones', 'caños', 'Falla de Gestión'),
('Factores Humanos', 'caños', 'Falla de Gestión');

-- Falla Logística
INSERT INTO downtime_reasons (reason, line_type, category) VALUES 
('Log. Int. de Prod. Terminado', 'bloques', 'Falla Logística'),
('Reposición Interna de Pallets', 'bloques', 'Falla Logística'),
('Log. Int. de Prod. Terminado', 'caños', 'Falla Logística'),
('Reposición Interna de Pallets', 'caños', 'Falla Logística');

-- Add category column to downtime_reasons if it doesn't exist
ALTER TABLE downtime_reasons ADD COLUMN IF NOT EXISTS category TEXT;
