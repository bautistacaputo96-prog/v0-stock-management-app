-- Seed Ranchos employees from provided list
-- Only ID (employee_id) and name, rest blank, branch = Ranchos

INSERT INTO employees (employee_id, first_name, last_name, branch, is_active)
VALUES
  ('1', 'Daniel', 'Rodas', 'Ranchos', true),
  ('2', 'E.', 'Rodas', 'Ranchos', true),
  ('3', 'N.', 'Rotela', 'Ranchos', true),
  ('4', 'G.', 'Salinas', 'Ranchos', true),
  ('5', 'V.', 'Sanssoure', 'Ranchos', true),
  ('7', 'F.', 'Pintos', 'Ranchos', true),
  ('9', 'P.', 'Phuviang', 'Ranchos', true),
  ('10', 'Senethavisouk', '', 'Ranchos', true),
  ('11', 'JP', 'Martin', 'Ranchos', true),
  ('12', 'Navarro', '', 'Ranchos', true),
  ('13', 'Natalia', '', 'Ranchos', true),
  ('14', 'T.', 'Gonzalo', 'Ranchos', true),
  ('16', 'Mendizabal', '', 'Ranchos', true),
  ('18', 'Aramburu', '', 'Ranchos', true),
  ('20', 'L.', 'Gallego', 'Ranchos', true)
ON CONFLICT DO NOTHING;
