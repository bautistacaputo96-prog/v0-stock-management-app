-- Ensure granulometry link columns exist (safe to run multiple times)

-- Link from stock_entries back to the granulometria_tests record
ALTER TABLE stock_entries
  ADD COLUMN IF NOT EXISTS granulometry_test_id UUID REFERENCES granulometria_tests(id);

-- Extra metadata columns on granulometria_tests
ALTER TABLE granulometria_tests
  ADD COLUMN IF NOT EXISTS stock_entry_id UUID REFERENCES stock_entries(id),
  ADD COLUMN IF NOT EXISTS provider VARCHAR(200),
  ADD COLUMN IF NOT EXISTS aggregate_type VARCHAR(200);
