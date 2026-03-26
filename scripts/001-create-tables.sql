-- Tabla de configuración de tiempos de ciclo para cada producto
CREATE TABLE IF NOT EXISTS cycle_times (
  id SERIAL PRIMARY KEY,
  product_type TEXT NOT NULL,
  product_code TEXT NOT NULL,
  cycle_seconds INTEGER NOT NULL,
  line_type TEXT NOT NULL CHECK (line_type IN ('bloques', 'caños')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(product_code, line_type)
);

-- Tabla de motivos de parada predefinidos
CREATE TABLE IF NOT EXISTS downtime_reasons (
  id SERIAL PRIMARY KEY,
  reason TEXT NOT NULL,
  line_type TEXT NOT NULL CHECK (line_type IN ('bloques', 'caños')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tabla principal de registros de producción de bloques
CREATE TABLE IF NOT EXISTS block_production (
  id SERIAL PRIMARY KEY,
  production_date DATE NOT NULL,
  shift INTEGER NOT NULL CHECK (shift IN (1, 2)),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  total_downtime_minutes INTEGER NOT NULL DEFAULT 0,
  product_type TEXT,
  concrete_formula TEXT,
  racks_produced INTEGER NOT NULL DEFAULT 0,
  blocks_discarded INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabla de motivos de paradas para producción de bloques
CREATE TABLE IF NOT EXISTS block_downtime (
  id SERIAL PRIMARY KEY,
  block_production_id INTEGER NOT NULL REFERENCES block_production(id) ON DELETE CASCADE,
  downtime_reason_id INTEGER REFERENCES downtime_reasons(id),
  custom_reason TEXT,
  comments TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tabla principal de registros de producción de caños
CREATE TABLE IF NOT EXISTS pipe_production (
  id SERIAL PRIMARY KEY,
  production_date DATE NOT NULL,
  shift INTEGER NOT NULL CHECK (shift IN (1, 2)),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  total_downtime_minutes INTEGER NOT NULL DEFAULT 0,
  cc400_units INTEGER DEFAULT 0,
  cc500_units INTEGER DEFAULT 0,
  cc600_units INTEGER DEFAULT 0,
  cc800_units INTEGER DEFAULT 0,
  cc1000_units INTEGER DEFAULT 0,
  cc1200_units INTEGER DEFAULT 0,
  reprocessed_units INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabla de motivos de paradas para producción de caños
CREATE TABLE IF NOT EXISTS pipe_downtime (
  id SERIAL PRIMARY KEY,
  pipe_production_id INTEGER NOT NULL REFERENCES pipe_production(id) ON DELETE CASCADE,
  downtime_reason_id INTEGER REFERENCES downtime_reasons(id),
  custom_reason TEXT,
  comments TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Crear índices para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_block_production_date ON block_production(production_date DESC);
CREATE INDEX IF NOT EXISTS idx_pipe_production_date ON pipe_production(production_date DESC);
CREATE INDEX IF NOT EXISTS idx_block_production_shift ON block_production(shift);
CREATE INDEX IF NOT EXISTS idx_pipe_production_shift ON pipe_production(shift);
