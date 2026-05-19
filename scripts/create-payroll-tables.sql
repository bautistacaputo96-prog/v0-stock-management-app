-- ============================================================
-- SISTEMA DE LIQUIDACIÓN DE SUELDOS - CONCRETUS SA
-- ============================================================

-- Categorías UOCRA con valor de hora (versionado histórico)
CREATE TABLE IF NOT EXISTS uocra_categories (
  id SERIAL PRIMARY KEY,
  category_name TEXT NOT NULL,           -- 'OFICIAL ESPECIALIZADO', 'OFICIAL', etc.
  hourly_rate NUMERIC(12,4) NOT NULL,    -- valor de hora en $
  daily_rate NUMERIC(12,4),              -- jornal diario (8hs)
  effective_from DATE NOT NULL,          -- desde qué fecha rige
  is_current BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Garantizar que solo haya un registro "is_current" por categoría
CREATE UNIQUE INDEX IF NOT EXISTS idx_uocra_categories_current
  ON uocra_categories(category_name) WHERE is_current = true;

CREATE INDEX IF NOT EXISTS idx_uocra_categories_name ON uocra_categories(category_name);

-- Parámetros globales de liquidación (configurables, versionados)
CREATE TABLE IF NOT EXISTS payroll_parameters (
  id SERIAL PRIMARY KEY,
  parameter_key TEXT NOT NULL,
  parameter_value NUMERIC(12,4) NOT NULL,
  description TEXT,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  is_current BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Feriados nacionales
CREATE TABLE IF NOT EXISTS public_holidays (
  id SERIAL PRIMARY KEY,
  holiday_date DATE NOT NULL UNIQUE,
  holiday_name TEXT NOT NULL,
  holiday_type TEXT DEFAULT 'nacional' CHECK (holiday_type IN ('nacional', 'puente', 'provincial')),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_holidays_date ON public_holidays(holiday_date);

-- Definición de turnos por planta (especialmente Olivera con sus 2 turnos rotativos)
CREATE TABLE IF NOT EXISTS plant_shifts (
  id SERIAL PRIMARY KEY,
  plant TEXT NOT NULL CHECK (plant IN ('Villa Rosa', 'Ranchos', 'Olivera')),
  shift_name TEXT NOT NULL,              -- 'Turno 1', 'Turno 2', 'Administrativo', etc.
  shift_start TIME NOT NULL,             -- hora de ingreso nominal
  shift_end TIME NOT NULL,               -- hora de egreso nominal
  clocked_hours NUMERIC(5,2) NOT NULL,   -- horas que marca el fichero (ej: 10.33 = 10:20hs)
  counted_hours NUMERIC(5,2) NOT NULL,   -- horas que se contabilizan para el pago (ej: 11)
  is_rotating BOOLEAN DEFAULT false,     -- si pertenece a turno rotativo
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(plant, shift_name)
);

-- Períodos de liquidación (una por planta, por quincena/mes)
CREATE TABLE IF NOT EXISTS payroll_periods (
  id SERIAL PRIMARY KEY,
  plant TEXT NOT NULL CHECK (plant IN ('Villa Rosa', 'Ranchos', 'Olivera')),
  period_type TEXT NOT NULL CHECK (period_type IN ('primera_quincena', 'segunda_quincena', 'mensual')),
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL,        -- 1-12
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador', 'revision', 'cerrado')),
  closed_at TIMESTAMP,
  closed_by TEXT,
  total_gross NUMERIC(14,2) DEFAULT 0,  -- total bruto de la quincena
  total_net NUMERIC(14,2) DEFAULT 0,    -- total neto de la quincena
  employee_count INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(plant, period_type, period_year, period_month)
);

CREATE INDEX IF NOT EXISTS idx_payroll_periods_plant ON payroll_periods(plant, period_year, period_month);

-- Líneas de liquidación: un registro por empleado por período
CREATE TABLE IF NOT EXISTS payroll_lines (
  id SERIAL PRIMARY KEY,
  period_id INTEGER NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),

  -- Horas calculadas
  normal_hours NUMERIC(8,2) DEFAULT 0,
  overtime_50_hours NUMERIC(8,2) DEFAULT 0,
  overtime_100_hours NUMERIC(8,2) DEFAULT 0,
  holiday_hours NUMERIC(8,2) DEFAULT 0,
  worked_days INTEGER DEFAULT 0,
  present_days INTEGER DEFAULT 0,
  absent_days INTEGER DEFAULT 0,
  late_count INTEGER DEFAULT 0,          -- tardanzas en la quincena

  -- Tarifa aplicada
  applied_hourly_rate NUMERIC(12,4),     -- valor hora utilizado
  applied_category TEXT,                 -- categoría usada para la liquidación

  -- HABERES
  basic_amount NUMERIC(12,2) DEFAULT 0,           -- sueldo básico
  overtime_50_amount NUMERIC(12,2) DEFAULT 0,     -- HE 50%
  overtime_100_amount NUMERIC(12,2) DEFAULT 0,    -- HE 100% (sábado tarde + feriados)
  holiday_extra_amount NUMERIC(12,2) DEFAULT 0,   -- plus feriado
  presentismo_amount NUMERIC(12,2) DEFAULT 0,     -- premio presentismo (20% si < 3 tardes)
  presentismo_eligible BOOLEAN DEFAULT false,      -- si corresponde o no el premio
  vacation_amount NUMERIC(12,2) DEFAULT 0,        -- pago de vacaciones
  bonus_amount NUMERIC(12,2) DEFAULT 0,           -- bonos manuales
  sac_provision NUMERIC(12,2) DEFAULT 0,          -- provisión SAC del período (informativo)
  gross_total NUMERIC(12,2) DEFAULT 0,            -- total haberes remunerativos

  -- DESCUENTOS
  jubilacion_amount NUMERIC(12,2) DEFAULT 0,      -- 11%
  obra_social_amount NUMERIC(12,2) DEFAULT 0,     -- 3%
  inssjp_amount NUMERIC(12,2) DEFAULT 0,          -- 3% PAMI
  sindical_amount NUMERIC(12,2) DEFAULT 0,        -- cuota sindical (configurable)
  other_deductions NUMERIC(12,2) DEFAULT 0,       -- anticipos, otros
  total_deductions NUMERIC(12,2) DEFAULT 0,

  -- NETO
  net_total NUMERIC(12,2) DEFAULT 0,

  -- Control
  is_manual_override BOOLEAN DEFAULT false,       -- si fue editado manualmente
  calculation_details JSONB,                       -- detalle diario guardado como JSON
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(period_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_lines_period ON payroll_lines(period_id);
CREATE INDEX IF NOT EXISTS idx_payroll_lines_employee ON payroll_lines(employee_id);

-- Recibos de sueldo generados
CREATE TABLE IF NOT EXISTS payroll_receipts (
  id SERIAL PRIMARY KEY,
  period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  receipt_number TEXT NOT NULL UNIQUE,   -- ej: 'REC-2025-05-Q1-097'
  generated_at TIMESTAMP DEFAULT NOW(),
  signed_at TIMESTAMP,
  signed_by TEXT,                        -- nombre del firmante
  is_signed BOOLEAN DEFAULT false,
  pdf_url TEXT,                          -- URL del PDF almacenado (futuro)
  UNIQUE(period_id, employee_id)
);

-- Log de importaciones del fichero (Excel)
CREATE TABLE IF NOT EXISTS attendance_imports (
  id SERIAL PRIMARY KEY,
  plant TEXT NOT NULL,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  original_filename TEXT,
  records_imported INTEGER DEFAULT 0,
  records_skipped INTEGER DEFAULT 0,
  records_errors INTEGER DEFAULT 0,
  imported_by TEXT,
  import_log JSONB,                      -- detalle de errores/advertencias
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- DATOS INICIALES
-- ============================================================

-- Turnos de Olivera (2 turnos rotativos)
-- Turno 1: 5:00 → 15:20 (ficha ~10:20hs, se contabilizan 11hs)
-- Turno 2: 14:20 → 23:40 (ficha ~9:20hs, se contabilizan 11hs)
-- Detección automática por hora de entrada: < 10:00 = T1, >= 10:00 = T2
INSERT INTO plant_shifts (plant, shift_name, shift_start, shift_end, clocked_hours, counted_hours, is_rotating) VALUES
  ('Olivera', 'Turno 1', '05:00', '15:20', 10.33, 11.0, true),
  ('Olivera', 'Turno 2', '14:20', '23:40', 9.33, 11.0, true),
  ('Olivera', 'Administrativo', '08:00', '17:00', 8.0, 8.0, false),
  ('Villa Rosa', 'Normal', '07:00', '15:00', 8.0, 8.0, false),
  ('Ranchos', 'Normal', '07:00', '15:00', 8.0, 8.0, false)
ON CONFLICT (plant, shift_name) DO NOTHING;

-- Parámetros globales de liquidación (actualizables desde la UI)
INSERT INTO payroll_parameters (parameter_key, parameter_value, description, effective_from) VALUES
  ('presentismo_percent', 20.00, 'Premio presentismo UOCRA (% del básico)', '2025-01-01'),
  ('jubilacion_percent', 11.00, 'Descuento jubilación', '2025-01-01'),
  ('obra_social_percent', 3.00, 'Descuento obra social', '2025-01-01'),
  ('inssjp_percent', 3.00, 'Descuento INSSJP (PAMI)', '2025-01-01'),
  ('sindical_percent', 2.00, 'Cuota sindical UOCRA', '2025-01-01'),
  ('overtime_weekly_threshold', 44.00, 'Horas semanales normales antes de HE', '2025-01-01'),
  ('late_tolerance_minutes', 5.00, 'Minutos de tolerancia para tardanzas', '2025-01-01'),
  ('late_penalty_threshold', 3.00, 'Cantidad de tardanzas que hace perder presentismo', '2025-01-01'),
  ('olivera_clocked_hours_min', 9.00, 'Mín horas fichadas para aplicar regla turno Olivera (T1~10:20hs, T2~9:20hs)', '2025-01-01'),
  ('olivera_clocked_hours_max', 11.50, 'Máx horas fichadas para aplicar regla turno Olivera', '2025-01-01'),
  ('olivera_counted_hours', 11.00, 'Horas que se contabilizan en turno Olivera (incluye 40min almuerzo en casa)', '2025-01-01'),
  ('olivera_turno_split_hour', 10.00, 'Hora de corte para distinguir T1 (entrada <10:00) de T2 (entrada >=10:00)', '2025-01-01')
ON CONFLICT DO NOTHING;

-- Categorías UOCRA con valores de hora vigentes (REEMPLAZAR con los valores actuales de paritaria)
-- Valores de ejemplo - actualizar desde la UI con los valores reales del convenio
INSERT INTO uocra_categories (category_name, hourly_rate, daily_rate, effective_from, is_current, notes) VALUES
  ('OFICIAL ESPECIALIZADO', 0.00, 0.00, '2025-01-01', true, 'Ingresar valor de hora actual del convenio UOCRA'),
  ('OFICIAL', 0.00, 0.00, '2025-01-01', true, 'Ingresar valor de hora actual del convenio UOCRA'),
  ('MEDIO OFICIAL', 0.00, 0.00, '2025-01-01', true, 'Ingresar valor de hora actual del convenio UOCRA'),
  ('AYUDANTE', 0.00, 0.00, '2025-01-01', true, 'Ingresar valor de hora actual del convenio UOCRA'),
  ('SERENO', 0.00, 0.00, '2025-01-01', true, 'Salario mensual - ingresar valor mensual en hourly_rate'),
  ('CADETE', 0.00, 0.00, '2025-01-01', true, 'Ingresar valor de hora actual del convenio UOCRA'),
  ('SUPERVISOR', 0.00, 0.00, '2025-01-01', true, 'Verificar si es UOCRA o fuera de convenio'),
  ('VENDEDOR', 0.00, 0.00, '2025-01-01', true, 'Verificar convenio aplicable'),
  ('ADMINISTRATIVO', 0.00, 0.00, '2025-01-01', true, 'Fuera de convenio - valor mensual en salary_value del empleado')
ON CONFLICT DO NOTHING;

-- Feriados nacionales 2025 (Argentina)
INSERT INTO public_holidays (holiday_date, holiday_name, holiday_type) VALUES
  ('2025-01-01', 'Año Nuevo', 'nacional'),
  ('2025-03-03', 'Carnaval', 'nacional'),
  ('2025-03-04', 'Carnaval', 'nacional'),
  ('2025-03-24', 'Día Nacional de la Memoria', 'nacional'),
  ('2025-04-02', 'Día del Veterano de Malvinas', 'nacional'),
  ('2025-04-18', 'Viernes Santo', 'nacional'),
  ('2025-05-01', 'Día del Trabajador', 'nacional'),
  ('2025-05-25', 'Día de la Revolución de Mayo', 'nacional'),
  ('2025-06-20', 'Paso a la Inmortalidad del General Belgrano', 'nacional'),
  ('2025-07-09', 'Día de la Independencia', 'nacional'),
  ('2025-08-17', 'Paso a la Inmortalidad del General San Martín', 'nacional'),
  ('2025-10-13', 'Día del Respeto a la Diversidad Cultural', 'nacional'),
  ('2025-11-20', 'Día de la Soberanía Nacional', 'nacional'),
  ('2025-12-08', 'Inmaculada Concepción de María', 'nacional'),
  ('2025-12-25', 'Navidad', 'nacional')
ON CONFLICT (holiday_date) DO NOTHING;
