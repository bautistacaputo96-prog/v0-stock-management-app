-- Add individual shift schedule columns to employees
ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_start TIME DEFAULT '05:00';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_end TIME DEFAULT '16:00';
