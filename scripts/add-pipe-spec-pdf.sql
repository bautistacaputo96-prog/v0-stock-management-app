-- Add technical spec PDF URL field to pipe_mix_designs
ALTER TABLE pipe_mix_designs 
ADD COLUMN IF NOT EXISTS spec_pdf_url TEXT;

-- Add comment
COMMENT ON COLUMN pipe_mix_designs.spec_pdf_url IS 'URL to technical specification PDF for this pipe diameter';
