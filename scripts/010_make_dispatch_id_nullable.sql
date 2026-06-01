-- Make dispatch_id nullable in test_cylinders table
-- This allows creating test cylinders without an associated dispatch (orphan cylinders)
ALTER TABLE test_cylinders 
ALTER COLUMN dispatch_id DROP NOT NULL;

-- Verify the change
SELECT 
    column_name, 
    is_nullable, 
    data_type
FROM information_schema.columns 
WHERE table_name = 'test_cylinders' 
AND column_name = 'dispatch_id';
