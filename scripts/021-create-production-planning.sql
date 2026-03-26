-- Create production planning table for monthly planning by pipe type and day
CREATE TABLE IF NOT EXISTS production_planning (
  id SERIAL PRIMARY KEY,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  pipe_size VARCHAR(10) NOT NULL, -- '300', '400', '500', '600', '800', '1000', '1200'
  day_1 INTEGER DEFAULT 0,
  day_2 INTEGER DEFAULT 0,
  day_3 INTEGER DEFAULT 0,
  day_4 INTEGER DEFAULT 0,
  day_5 INTEGER DEFAULT 0,
  day_6 INTEGER DEFAULT 0,
  day_7 INTEGER DEFAULT 0,
  day_8 INTEGER DEFAULT 0,
  day_9 INTEGER DEFAULT 0,
  day_10 INTEGER DEFAULT 0,
  day_11 INTEGER DEFAULT 0,
  day_12 INTEGER DEFAULT 0,
  day_13 INTEGER DEFAULT 0,
  day_14 INTEGER DEFAULT 0,
  day_15 INTEGER DEFAULT 0,
  day_16 INTEGER DEFAULT 0,
  day_17 INTEGER DEFAULT 0,
  day_18 INTEGER DEFAULT 0,
  day_19 INTEGER DEFAULT 0,
  day_20 INTEGER DEFAULT 0,
  day_21 INTEGER DEFAULT 0,
  day_22 INTEGER DEFAULT 0,
  day_23 INTEGER DEFAULT 0,
  day_24 INTEGER DEFAULT 0,
  day_25 INTEGER DEFAULT 0,
  day_26 INTEGER DEFAULT 0,
  day_27 INTEGER DEFAULT 0,
  day_28 INTEGER DEFAULT 0,
  day_29 INTEGER DEFAULT 0,
  day_30 INTEGER DEFAULT 0,
  day_31 INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(year, month, pipe_size)
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_production_planning_year_month ON production_planning(year, month);

-- Enable RLS
ALTER TABLE production_planning ENABLE ROW LEVEL SECURITY;

-- Create policy for all operations
CREATE POLICY "Allow all operations on production_planning" ON production_planning
  FOR ALL USING (true) WITH CHECK (true);
