-- Add reasons and comments columns to pipe_mold_breakage
ALTER TABLE pipe_mold_breakage 
ADD COLUMN IF NOT EXISTS reasons TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS comments TEXT;

-- Drop the quantity column since we track by reasons now
ALTER TABLE pipe_mold_breakage DROP COLUMN IF EXISTS quantity;
