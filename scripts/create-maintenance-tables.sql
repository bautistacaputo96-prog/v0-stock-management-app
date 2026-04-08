-- Módulo de Mantenimiento - Schema

-- Usuario de mantenimiento (autenticación simple)
CREATE TABLE IF NOT EXISTS maintenance_users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  plant VARCHAR(50) NOT NULL DEFAULT 'silke', -- silke, villa_rosa, ranchos
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Secciones del pañol (configurable por planta)
CREATE TABLE IF NOT EXISTS maintenance_sections (
  id SERIAL PRIMARY KEY,
  plant VARCHAR(50) NOT NULL DEFAULT 'silke',
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Categorías de insumos (Repuestos, Insumos, Herramientas, etc.)
CREATE TABLE IF NOT EXISTS maintenance_categories (
  id SERIAL PRIMARY KEY,
  plant VARCHAR(50) NOT NULL DEFAULT 'silke',
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Inventario del pañol
CREATE TABLE IF NOT EXISTS maintenance_inventory (
  id SERIAL PRIMARY KEY,
  plant VARCHAR(50) NOT NULL DEFAULT 'silke',
  section_id INTEGER REFERENCES maintenance_sections(id),
  category_id INTEGER REFERENCES maintenance_categories(id),
  code VARCHAR(50), -- código interno opcional
  name VARCHAR(255) NOT NULL,
  description TEXT,
  unit VARCHAR(50) DEFAULT 'unidad', -- unidad, kg, litros, metros, etc.
  current_stock NUMERIC(10,2) DEFAULT 0,
  minimum_stock NUMERIC(10,2) DEFAULT 0, -- para alertas de stock bajo
  location VARCHAR(100), -- ubicación física en el pañol
  supplier VARCHAR(255), -- proveedor habitual
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Movimientos de inventario (entradas y salidas)
CREATE TABLE IF NOT EXISTS maintenance_inventory_movements (
  id SERIAL PRIMARY KEY,
  inventory_id INTEGER REFERENCES maintenance_inventory(id) NOT NULL,
  movement_type VARCHAR(20) NOT NULL, -- 'entrada', 'salida', 'ajuste'
  quantity NUMERIC(10,2) NOT NULL,
  previous_stock NUMERIC(10,2),
  new_stock NUMERIC(10,2),
  reason TEXT, -- motivo del movimiento
  task_id INTEGER, -- referencia a tarea de mantenimiento (si aplica)
  user_id INTEGER REFERENCES maintenance_users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Equipos de combustible (pala cargadora, autoelevador, etc.)
CREATE TABLE IF NOT EXISTS maintenance_fuel_equipment (
  id SERIAL PRIMARY KEY,
  plant VARCHAR(50) NOT NULL DEFAULT 'silke',
  name VARCHAR(100) NOT NULL,
  description TEXT,
  fuel_type VARCHAR(50) DEFAULT 'gasoil', -- gasoil, nafta, etc.
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Registro de cargas de combustible
CREATE TABLE IF NOT EXISTS maintenance_fuel_records (
  id SERIAL PRIMARY KEY,
  equipment_id INTEGER REFERENCES maintenance_fuel_equipment(id) NOT NULL,
  plant VARCHAR(50) NOT NULL DEFAULT 'silke',
  fuel_date DATE NOT NULL,
  liters NUMERIC(10,2) NOT NULL,
  horometer_reading NUMERIC(10,2), -- lectura del horómetro (opcional)
  cost_per_liter NUMERIC(10,4), -- costo por litro (opcional)
  total_cost NUMERIC(12,2), -- costo total (opcional)
  observations TEXT,
  user_id INTEGER REFERENCES maintenance_users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tareas de mantenimiento
CREATE TABLE IF NOT EXISTS maintenance_tasks (
  id SERIAL PRIMARY KEY,
  plant VARCHAR(50) NOT NULL DEFAULT 'silke',
  task_date DATE NOT NULL,
  section_id INTEGER REFERENCES maintenance_sections(id),
  task_type VARCHAR(50) NOT NULL, -- 'correctivo', 'preventivo', 'mejora'
  priority VARCHAR(20) DEFAULT 'normal', -- 'baja', 'normal', 'alta', 'urgente'
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) DEFAULT 'pendiente', -- 'pendiente', 'en_progreso', 'completada', 'cancelada'
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  estimated_duration_minutes INTEGER,
  actual_duration_minutes INTEGER,
  assigned_to VARCHAR(255), -- persona asignada
  observations TEXT,
  user_id INTEGER REFERENCES maintenance_users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Insumos utilizados en tareas
CREATE TABLE IF NOT EXISTS maintenance_task_items (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES maintenance_tasks(id) NOT NULL,
  inventory_id INTEGER REFERENCES maintenance_inventory(id) NOT NULL,
  quantity_used NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insertar usuario inicial de mantenimiento (password: Concretus)
-- Hash bcrypt para 'Concretus' (se genera en la app, este es placeholder)
INSERT INTO maintenance_users (username, password_hash, full_name, plant, is_active)
VALUES ('Mantenimiento', 'Concretus', 'Usuario Mantenimiento', 'silke', true)
ON CONFLICT (username) DO NOTHING;

-- Insertar secciones iniciales para Silke
INSERT INTO maintenance_sections (plant, name, description) VALUES
  ('silke', 'Dosificación', 'Sistema de dosificación de materiales'),
  ('silke', 'Mezcladora', 'Mezcladora de hormigón'),
  ('silke', 'Cinta de carga', 'Cinta transportadora de carga'),
  ('silke', 'Prensa', 'Prensa de tubos'),
  ('silke', 'Paletizadora', 'Sistema de paletizado'),
  ('silke', 'Cinta de evacuación', 'Cinta transportadora de evacuación'),
  ('silke', 'Autoelevadores', 'Autoelevadores y montacargas'),
  ('silke', 'Cámara de curado', 'Cámara de curado de productos'),
  ('silke', 'Instalación eléctrica', 'Sistema eléctrico general'),
  ('silke', 'Instalación neumática', 'Sistema neumático'),
  ('silke', 'Instalación hidráulica', 'Sistema hidráulico'),
  ('silke', 'Edificio', 'Mantenimiento edilicio'),
  ('silke', 'Otros', 'Otros equipos y sistemas')
ON CONFLICT DO NOTHING;

-- Insertar categorías iniciales
INSERT INTO maintenance_categories (plant, name, description) VALUES
  ('silke', 'Repuestos', 'Repuestos de maquinaria y equipos'),
  ('silke', 'Insumos', 'Insumos generales de mantenimiento'),
  ('silke', 'Herramientas', 'Herramientas manuales y eléctricas'),
  ('silke', 'Lubricantes', 'Aceites, grasas y lubricantes'),
  ('silke', 'Eléctricos', 'Componentes eléctricos'),
  ('silke', 'Neumáticos', 'Componentes neumáticos'),
  ('silke', 'Hidráulicos', 'Componentes hidráulicos'),
  ('silke', 'Ferretería', 'Tornillos, tuercas, bulones, etc.'),
  ('silke', 'Seguridad', 'Elementos de seguridad e higiene')
ON CONFLICT DO NOTHING;

-- Insertar equipos de combustible iniciales para Silke
INSERT INTO maintenance_fuel_equipment (plant, name, fuel_type) VALUES
  ('silke', 'Pala cargadora', 'gasoil'),
  ('silke', 'Autoelevador 1', 'gasoil'),
  ('silke', 'Autoelevador 2', 'gasoil')
ON CONFLICT DO NOTHING;

-- Crear índices para mejorar performance
CREATE INDEX IF NOT EXISTS idx_maintenance_inventory_plant ON maintenance_inventory(plant);
CREATE INDEX IF NOT EXISTS idx_maintenance_inventory_section ON maintenance_inventory(section_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_inventory_category ON maintenance_inventory(category_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_tasks_plant ON maintenance_tasks(plant);
CREATE INDEX IF NOT EXISTS idx_maintenance_tasks_date ON maintenance_tasks(task_date);
CREATE INDEX IF NOT EXISTS idx_maintenance_tasks_status ON maintenance_tasks(status);
CREATE INDEX IF NOT EXISTS idx_maintenance_fuel_records_plant ON maintenance_fuel_records(plant);
CREATE INDEX IF NOT EXISTS idx_maintenance_fuel_records_date ON maintenance_fuel_records(fuel_date);
