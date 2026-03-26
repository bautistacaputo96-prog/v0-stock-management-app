-- Update admin password hash to 'admin123' using bcrypt
-- The hash below is for 'admin123' generated with bcrypt cost 10
UPDATE rrhh_users 
SET password_hash = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'
WHERE username = 'admin';

-- If no admin exists, insert one
INSERT INTO rrhh_users (username, password_hash, full_name)
SELECT 'admin', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'Administrador'
WHERE NOT EXISTS (SELECT 1 FROM rrhh_users WHERE username = 'admin');
