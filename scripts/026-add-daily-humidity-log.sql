-- Table to track daily stockpile humidity readings
CREATE TABLE IF NOT EXISTS daily_stockpile_humidity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id UUID NOT NULL REFERENCES plants(id),
  material_id UUID NOT NULL REFERENCES materials(id),
  reading_date DATE NOT NULL DEFAULT CURRENT_DATE,
  humidity_percent NUMERIC(5,2) NOT NULL,
  wet_weight_grams NUMERIC(10,2),
  dry_weight_grams NUMERIC(10,2),
  recorded_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- One reading per material per day per plant
  UNIQUE(plant_id, material_id, reading_date)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_daily_humidity_plant_date ON daily_stockpile_humidity(plant_id, reading_date);

-- Update material stockpile_humidity when a new reading is inserted
CREATE OR REPLACE FUNCTION update_material_stockpile_humidity()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE materials 
  SET stockpile_humidity = NEW.humidity_percent,
      updated_at = NOW()
  WHERE id = NEW.material_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_stockpile_humidity ON daily_stockpile_humidity;
CREATE TRIGGER trg_update_stockpile_humidity
  AFTER INSERT OR UPDATE ON daily_stockpile_humidity
  FOR EACH ROW
  EXECUTE FUNCTION update_material_stockpile_humidity();
