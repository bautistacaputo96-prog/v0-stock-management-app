-- Add forklift_model column to block_downtime table
ALTER TABLE block_downtime
ADD COLUMN IF NOT EXISTS forklift_model VARCHAR(100);

COMMENT ON COLUMN block_downtime.forklift_model IS 'Model of forklift when downtime reason is Autoelevador';
