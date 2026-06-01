-- Create app_users table for tracking who creates dispatches
CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Insert default users
INSERT INTO app_users (name) VALUES 
  ('Fernando Maldonado'),
  ('Felipe Calvo')
ON CONFLICT DO NOTHING;
