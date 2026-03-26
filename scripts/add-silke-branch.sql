-- Add 'Silke' to the allowed branch values
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_branch_check;
ALTER TABLE employees ADD CONSTRAINT employees_branch_check CHECK (branch IN ('Villa Rosa', 'Ranchos', 'Olivera', 'Silke'));
