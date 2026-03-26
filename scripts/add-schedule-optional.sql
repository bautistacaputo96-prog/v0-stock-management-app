-- Add is_optional column to employee_schedules
-- When true, the day is optional (e.g., Saturday): no absence is counted if employee doesn't show up,
-- but if they do clock in, their hours are tracked and analyzed normally.
ALTER TABLE employee_schedules ADD COLUMN IF NOT EXISTS is_optional BOOLEAN NOT NULL DEFAULT false;
