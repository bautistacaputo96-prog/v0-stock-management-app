-- ============================================================
-- Maintenance Equipment & Services Tables
-- ============================================================

-- Equipment registry (per plant)
CREATE TABLE IF NOT EXISTS maintenance_equipment (
  id bigserial PRIMARY KEY,
  plant text NOT NULL,
  nombre text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('autoelevador', 'pala', 'compresor', 'generador', 'otro')),
  marca text,
  modelo text,
  anio integer,
  nro_serie text,
  horometro_actual numeric DEFAULT 0,
  fecha_ultimo_horometro date,
  status text DEFAULT 'activo' CHECK (status IN ('activo', 'fuera_servicio', 'baja')),
  created_at timestamptz DEFAULT now()
);

-- Service programs linked to each equipment
CREATE TABLE IF NOT EXISTS maintenance_service_programs (
  id bigserial PRIMARY KEY,
  equipment_id bigint NOT NULL REFERENCES maintenance_equipment(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  intervalo_horas integer,
  intervalo_meses integer,
  modo text DEFAULT 'horas' CHECK (modo IN ('horas', 'tiempo', 'primero')),
  descripcion text,
  created_at timestamptz DEFAULT now()
);

-- Service records (history)
CREATE TABLE IF NOT EXISTS maintenance_service_records (
  id bigserial PRIMARY KEY,
  equipment_id bigint NOT NULL REFERENCES maintenance_equipment(id) ON DELETE CASCADE,
  program_id bigint REFERENCES maintenance_service_programs(id),
  fecha date NOT NULL,
  horometro_al_momento numeric,
  notas text,
  realizado_por text,
  created_at timestamptz DEFAULT now()
);

-- Operational daily report header (one per plant/day for forklifts)
CREATE TABLE IF NOT EXISTS maintenance_operational_parte (
  id bigserial PRIMARY KEY,
  plant text NOT NULL,
  fecha date NOT NULL,
  creado_por text,
  observaciones text,
  created_at timestamptz DEFAULT now()
);

-- Operational daily report items (one row per forklift)
CREATE TABLE IF NOT EXISTS maintenance_operational_items (
  id bigserial PRIMARY KEY,
  parte_id bigint NOT NULL REFERENCES maintenance_operational_parte(id) ON DELETE CASCADE,
  equipment_id bigint NOT NULL REFERENCES maintenance_equipment(id),
  horometro_inicial numeric,
  horometro_final numeric,
  horas_trabajadas numeric,
  combustible_lts numeric DEFAULT 0,
  aceite_lts numeric DEFAULT 0,
  status text DEFAULT 'operativo' CHECK (status IN ('operativo', 'fuera_servicio', 'no_opera')),
  observaciones text
);

-- Maintenance work parte header (by maintenance operator)
CREATE TABLE IF NOT EXISTS maintenance_work_parte (
  id bigserial PRIMARY KEY,
  plant text NOT NULL,
  fecha date NOT NULL,
  operario text NOT NULL,
  descripcion_general text,
  created_at timestamptz DEFAULT now()
);

-- Work items (what was done, on which equipment)
CREATE TABLE IF NOT EXISTS maintenance_work_items (
  id bigserial PRIMARY KEY,
  parte_id bigint NOT NULL REFERENCES maintenance_work_parte(id) ON DELETE CASCADE,
  equipment_id bigint REFERENCES maintenance_equipment(id),
  tipo text DEFAULT 'correctivo' CHECK (tipo IN ('preventivo', 'correctivo', 'inspeccion', 'otro')),
  compartimento text,
  descripcion text NOT NULL
);

-- Supplies used (links to pañol inventory and deducts stock)
CREATE TABLE IF NOT EXISTS maintenance_work_supplies (
  id bigserial PRIMARY KEY,
  parte_id bigint NOT NULL REFERENCES maintenance_work_parte(id) ON DELETE CASCADE,
  inventory_item_id bigint REFERENCES maintenance_inventory(id),
  item_nombre text,
  cantidad numeric NOT NULL,
  unidad text,
  comentario text
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_maint_equipment_plant ON maintenance_equipment(plant);
CREATE INDEX IF NOT EXISTS idx_maint_svc_programs_equip ON maintenance_service_programs(equipment_id);
CREATE INDEX IF NOT EXISTS idx_maint_svc_records_equip ON maintenance_service_records(equipment_id, fecha);
CREATE INDEX IF NOT EXISTS idx_maint_op_parte_plant ON maintenance_operational_parte(plant, fecha);
CREATE INDEX IF NOT EXISTS idx_maint_op_items_parte ON maintenance_operational_items(parte_id);
CREATE INDEX IF NOT EXISTS idx_maint_work_parte_plant ON maintenance_work_parte(plant, fecha);
CREATE INDEX IF NOT EXISTS idx_maint_work_items_parte ON maintenance_work_items(parte_id);
CREATE INDEX IF NOT EXISTS idx_maint_work_supplies_parte ON maintenance_work_supplies(parte_id);

-- RLS
ALTER TABLE maintenance_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_service_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_service_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_operational_parte ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_operational_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_work_parte ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_work_supplies ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_equipment' AND policyname='Allow all maintenance_equipment') THEN
    CREATE POLICY "Allow all maintenance_equipment" ON maintenance_equipment FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_service_programs' AND policyname='Allow all maintenance_service_programs') THEN
    CREATE POLICY "Allow all maintenance_service_programs" ON maintenance_service_programs FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_service_records' AND policyname='Allow all maintenance_service_records') THEN
    CREATE POLICY "Allow all maintenance_service_records" ON maintenance_service_records FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_operational_parte' AND policyname='Allow all maintenance_operational_parte') THEN
    CREATE POLICY "Allow all maintenance_operational_parte" ON maintenance_operational_parte FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_operational_items' AND policyname='Allow all maintenance_operational_items') THEN
    CREATE POLICY "Allow all maintenance_operational_items" ON maintenance_operational_items FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_work_parte' AND policyname='Allow all maintenance_work_parte') THEN
    CREATE POLICY "Allow all maintenance_work_parte" ON maintenance_work_parte FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_work_items' AND policyname='Allow all maintenance_work_items') THEN
    CREATE POLICY "Allow all maintenance_work_items" ON maintenance_work_items FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_work_supplies' AND policyname='Allow all maintenance_work_supplies') THEN
    CREATE POLICY "Allow all maintenance_work_supplies" ON maintenance_work_supplies FOR ALL USING (true);
  END IF;
END $$;
