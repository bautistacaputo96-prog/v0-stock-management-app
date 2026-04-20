-- Add daily target total and audit columns to production_planning
-- This allows setting a daily production target that distributes proportionally across pipe sizes

-- Add daily_target_total column (the total objective for the day)
ALTER TABLE production_planning 
ADD COLUMN IF NOT EXISTS daily_target_total integer DEFAULT NULL;

-- Add audit columns
ALTER TABLE production_planning 
ADD COLUMN IF NOT EXISTS modified_by text DEFAULT NULL;

ALTER TABLE production_planning 
ADD COLUMN IF NOT EXISTS modified_at timestamp with time zone DEFAULT NULL;

-- Create a separate table to track planning changes history
CREATE TABLE IF NOT EXISTS production_planning_history (
  id serial PRIMARY KEY,
  year integer NOT NULL,
  month integer NOT NULL,
  pipe_size varchar(10),
  previous_values jsonb,
  new_values jsonb,
  daily_target_total integer,
  modified_by text NOT NULL,
  modified_at timestamp with time zone DEFAULT now(),
  change_reason text
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_planning_history_year_month 
ON production_planning_history(year, month);
