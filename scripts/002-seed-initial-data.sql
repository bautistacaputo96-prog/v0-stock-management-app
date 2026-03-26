-- Insertar tiempos de ciclo iniciales para bloques
INSERT INTO cycle_times (product_type, product_code, cycle_seconds, line_type) VALUES
  ('Bloque Estándar', 'BLQ-STD', 45, 'bloques'),
  ('Bloque Premium', 'BLQ-PRM', 50, 'bloques'),
  ('Bloque Especial', 'BLQ-ESP', 55, 'bloques')
ON CONFLICT (product_code, line_type) DO NOTHING;

-- Insertar tiempos de ciclo iniciales para caños
INSERT INTO cycle_times (product_type, product_code, cycle_seconds, line_type) VALUES
  ('Caño CC400', 'CC400', 30, 'caños'),
  ('Caño CC500', 'CC500', 35, 'caños'),
  ('Caño CC600', 'CC600', 40, 'caños'),
  ('Caño CC800', 'CC800', 50, 'caños'),
  ('Caño CC1000', 'CC1000', 60, 'caños'),
  ('Caño CC1200', 'CC1200', 70, 'caños')
ON CONFLICT (product_code, line_type) DO NOTHING;

-- Insertar motivos de parada comunes para bloques
INSERT INTO downtime_reasons (reason, line_type) VALUES
  ('Falla mecánica', 'bloques'),
  ('Mantenimiento programado', 'bloques'),
  ('Falta de materia prima', 'bloques'),
  ('Falta de personal', 'bloques'),
  ('Corte de energía', 'bloques'),
  ('Ajuste de máquina', 'bloques'),
  ('Limpieza de equipo', 'bloques'),
  ('Cambio de molde', 'bloques');

-- Insertar motivos de parada comunes para caños
INSERT INTO downtime_reasons (reason, line_type) VALUES
  ('Falla mecánica', 'caños'),
  ('Mantenimiento programado', 'caños'),
  ('Falta de materia prima', 'caños'),
  ('Falta de personal', 'caños'),
  ('Corte de energía', 'caños'),
  ('Ajuste de máquina', 'caños'),
  ('Limpieza de equipo', 'caños'),
  ('Cambio de dimensión', 'caños');
