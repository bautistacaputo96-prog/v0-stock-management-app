-- Create table for pipe mold breakages
CREATE TABLE IF NOT EXISTS pipe_mold_breakage (
  id SERIAL PRIMARY KEY,
  pipe_production_id INTEGER NOT NULL REFERENCES pipe_production(id) ON DELETE CASCADE,
  diameter VARCHAR(10) NOT NULL,
  reasons TEXT[] NOT NULL,
  comments TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_pipe_mold_breakage_production_id ON pipe_mold_breakage(pipe_production_id);
