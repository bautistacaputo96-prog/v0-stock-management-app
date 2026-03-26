-- Table for RRHH authorized users
CREATE TABLE IF NOT EXISTS rrhh_users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Table for employees
CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  employee_id TEXT UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  dni TEXT NOT NULL UNIQUE,
  birth_date DATE,
  address TEXT,
  branch TEXT NOT NULL CHECK (branch IN ('Villa Rosa', 'Ranchos', 'Olivera')),
  real_start_date DATE,
  registration_date DATE,
  positions TEXT[] DEFAULT '{}',
  agreement TEXT,
  increases_under_agreement BOOLEAN DEFAULT true,
  remuneration_type TEXT CHECK (remuneration_type IN ('quincenal', 'mensual')),
  cuit TEXT,
  category TEXT,
  salary_type TEXT CHECK (salary_type IN ('por_hora', 'fijo')),
  salary_value NUMERIC(12,2),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Table for daily attendance records
CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  clock_in TIME,
  clock_out TIME,
  status TEXT DEFAULT 'presente' CHECK (status IN ('presente', 'ausente', 'justificado', 'vacaciones', 'licencia', 'feriado')),
  observations TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(employee_id, attendance_date)
);

-- Insert a default admin user (password: admin123 - bcrypt hash)
INSERT INTO rrhh_users (username, password_hash, full_name)
VALUES ('admin', '$2b$10$EIXe0VVSuGqGayKmFKp1UOQUgGzkxKxYj0fNJQ5Q1Q6f7KJHcOhLa', 'Administrador')
ON CONFLICT (username) DO NOTHING;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance(employee_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(attendance_date);
CREATE INDEX IF NOT EXISTS idx_employees_branch ON employees(branch);
CREATE INDEX IF NOT EXISTS idx_employees_dni ON employees(dni);
