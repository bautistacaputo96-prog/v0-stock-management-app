-- First, fix the dni column to allow NULL values since most employees don't have DNI yet
ALTER TABLE employees ALTER COLUMN dni DROP NOT NULL;
-- Drop the unique constraint temporarily to allow multiple NULLs
DROP INDEX IF EXISTS idx_employees_dni;

-- Insert Olivera plant employees
-- Applying MODIFICACION records for Centeno Tobias, Salazar Thiago, Romano Hernan
-- Dates left NULL where only month/year was provided (per user request)
-- DNI and address left NULL where not available

INSERT INTO employees (employee_id, first_name, last_name, branch, category, real_start_date, registration_date, agreement, increases_under_agreement, remuneration_type, salary_type, positions, address, is_active)
VALUES
  ('5', 'Noelia', 'Martinez', 'Olivera', 'ADMINISTRATIVO', '2002-07-15', '1996-01-13', 'Fuera de Convenio', false, 'mensual', 'fijo', ARRAY['Logística'], 'Las Golondrinas 88, Pilar, CP 1629 Buenos Aires', true),
  ('97', 'Oscar', 'Olvera', 'Olivera', 'OFICIAL ESPECIALIZADO', NULL, NULL, 'UOCRA', true, 'quincenal', 'por_hora', ARRAY['Operario'], NULL, true),
  ('98', 'Hernan', 'Romano', 'Olivera', 'Medio Oficial', '2013-12-02', '2013-12-02', 'UOCRA', true, 'quincenal', 'por_hora', ARRAY['Operario'], NULL, true),
  ('99', 'Jonathan', 'Luna', 'Olivera', 'OFICIAL ESPECIALIZADO', '2024-08-16', '2025-06-16', 'UOCRA', true, 'quincenal', 'por_hora', ARRAY['Operario'], NULL, true),
  ('100', 'Franco', 'Sampedro', 'Olivera', 'OFICIAL', '2021-05-17', '2021-05-17', 'UOCRA', true, 'quincenal', 'por_hora', ARRAY['Operario'], NULL, true),
  ('101', 'Fernando', 'Aquino', 'Olivera', 'OFICIAL ESPECIALIZADO', '2019-11-21', '2021-01-11', 'UOCRA', true, 'quincenal', 'por_hora', ARRAY['Operario'], NULL, true),
  ('102', 'Daniel', 'Diaz', 'Olivera', 'OFICIAL', '2022-01-03', '2022-01-03', 'UOCRA', true, 'quincenal', 'por_hora', ARRAY['Operario'], NULL, true),
  ('103', 'Agustin', 'Arina', 'Olivera', 'OFICIAL', '2024-02-05', '2024-02-05', 'UOCRA', true, 'quincenal', 'por_hora', ARRAY['Operario'], NULL, true),
  ('104', 'Blas', 'Martinez', 'Olivera', 'Medio Oficial', NULL, NULL, 'UOCRA', true, 'quincenal', 'por_hora', ARRAY['Operario'], NULL, true),
  ('105', 'Brandon', 'Centeno', 'Olivera', 'OFICIAL', NULL, NULL, 'UOCRA', true, 'quincenal', 'por_hora', ARRAY['Operario'], NULL, true),
  ('106', 'Cristian', 'Ferreyra', 'Olivera', 'OFICIAL', '2024-04-08', '2024-06-04', 'UOCRA', true, 'quincenal', 'por_hora', ARRAY['Operario'], NULL, true),
  ('107', 'Jose', 'Centeno', 'Olivera', 'Medio Oficial', '2024-08-27', '2025-06-16', 'UOCRA', true, 'quincenal', 'por_hora', ARRAY['Operario'], NULL, true),
  ('108', 'Ignacio', 'Comesaña', 'Olivera', 'OFICIAL', '2025-06-16', '2025-06-16', 'UOCRA', true, 'quincenal', 'por_hora', ARRAY['Operario'], NULL, true),
  ('109', 'Sergio', 'Correa', 'Olivera', 'AYUDANTE', '2025-06-09', '2025-09-01', 'UOCRA', true, 'quincenal', 'por_hora', ARRAY['Operario'], NULL, true),
  ('110', 'Cristian', 'Chanfalloni', 'Olivera', 'AYUDANTE', '2025-06-19', '2025-09-01', 'UOCRA', true, 'quincenal', 'por_hora', ARRAY['Operario'], NULL, true),
  ('111', 'Miguel', 'Figueroa', 'Olivera', 'AYUDANTE', '2025-06-19', '2025-09-01', 'UOCRA', true, 'quincenal', 'por_hora', ARRAY['Operario'], NULL, true),
  ('112', 'Thiago', 'Salazar', 'Olivera', 'AYUDANTE', '2025-07-03', '2025-09-01', 'UOCRA', true, 'quincenal', 'por_hora', ARRAY['Operario'], NULL, true),
  ('113', 'Jeronimo', 'Periales', 'Olivera', 'AYUDANTE', '2025-07-07', '2025-09-01', 'UOCRA', true, 'quincenal', 'por_hora', ARRAY['Operario'], NULL, true),
  ('114', 'Santiago', 'Muñoz', 'Olivera', 'AYUDANTE', NULL, NULL, 'UOCRA', true, 'quincenal', 'por_hora', ARRAY['Operario'], NULL, true),
  ('115', 'Marcelo', 'Rodriguez', 'Olivera', 'OFICIAL ESPECIALIZADO', '2019-10-21', '2019-10-21', 'UOCRA', true, 'quincenal', 'por_hora', ARRAY['Operario'], NULL, true),
  ('116', 'Rodolfo', 'Michelini', 'Olivera', 'CADETE', '2010-01-01', NULL, 'UOCRA', true, 'quincenal', 'por_hora', ARRAY['Operario'], NULL, true),
  ('117', 'Victor', 'Viera', 'Olivera', 'ADMINISTRATIVO', '2019-11-01', '2019-11-01', 'UOCRA', true, 'mensual', 'fijo', ARRAY['Administrativo'], NULL, true),
  ('118', 'Pablo', 'Flores', 'Olivera', 'ADMINISTRATIVO', '2023-10-02', '2023-10-02', 'UOCRA', true, 'mensual', 'fijo', ARRAY['Administrativo'], NULL, true),
  ('119', 'Alfredo', 'Aleman', 'Olivera', 'SUPERVISOR', NULL, NULL, 'UOCRA', true, 'quincenal', 'por_hora', ARRAY['Supervisor'], NULL, true),
  ('120', 'Juan Francisco', 'Cuñete', 'Olivera', 'VENDEDOR', '2024-08-05', '2024-06-08', 'UOCRA', true, 'quincenal', 'por_hora', ARRAY['Vendedor'], NULL, true),
  ('131', 'Tobias', 'Centeno', 'Olivera', 'AYUDANTE', '2025-07-03', '2025-09-01', 'UOCRA', true, 'quincenal', 'por_hora', ARRAY['Operario'], NULL, true),
  ('132', 'Luis Ezequiel', 'Alvarez', 'Olivera', 'OFICIAL ESPECIALIZADO', '2025-09-22', '2025-09-22', 'Fuera de Convenio', false, 'mensual', 'fijo', ARRAY['Operario'], NULL, true)
ON CONFLICT (employee_id) DO NOTHING;
