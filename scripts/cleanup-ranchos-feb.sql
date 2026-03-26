-- Delete old Ranchos February attendance records (imported with wrong date offsets)
DELETE FROM attendance
WHERE attendance_date >= '2026-02-01'
  AND attendance_date <= '2026-02-28'
  AND employee_id IN (
    SELECT id FROM employees WHERE branch = 'Ranchos'
  );
