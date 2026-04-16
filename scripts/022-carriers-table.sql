-- Tabla de transportistas/choferes
CREATE TABLE IF NOT EXISTS carriers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT,
  phone TEXT,
  license_plate TEXT,
  company TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Agregar columna carrier_id a mp_receipts si no existe
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'mp_receipts' AND column_name = 'carrier_id') THEN
    ALTER TABLE mp_receipts ADD COLUMN carrier_id INTEGER REFERENCES carriers(id);
  END IF;
END $$;
