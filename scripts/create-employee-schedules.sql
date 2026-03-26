-- Table: employee_schedules
-- Stores per-employee, per-day-of-week schedules with effective_from date for versioning.
-- When a schedule changes (e.g., shift rotation), a new row is inserted with the new effective_from date.
-- The old rows remain untouched so historical calculations stay correct.

CREATE TABLE IF NOT EXISTS employee_schedules (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday, 1=Monday, ..., 6=Saturday
  shift_start TIME,
  shift_end TIME,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP DEFAULT NOW(),

  -- Unique constraint: one schedule per employee per day per effective date
  UNIQUE(employee_id, day_of_week, effective_from)
);

-- Index for fast lookups by employee and effective date
CREATE INDEX IF NOT EXISTS idx_employee_schedules_lookup 
  ON employee_schedules(employee_id, effective_from DESC);
