-- Borrar una fórmula ya no borra sus despachos — SIN APLICAR (la corre Bautista a mano, con su OK). Auditoría de
-- pantallas 24/11/2026. Se puede correr antes o después de publicar, y dos veces.
-- Va entera en una transacción (BEGIN … COMMIT): para probarla antes, cambiar el COMMIT del final por ROLLBACK.
--
-- Hoy: dispatches.formula_id → formulas(id) ON DELETE CASCADE (foto 000000000000_esquema_base.sql). Si alguien borra
-- una fórmula con despachos, la base borra también esos despachos (y, en cascada, sus materiales y probetas), sin
-- devolver el stock. La pantalla Fórmulas cuenta los despachos antes de borrar, pero hasta esta auditoría un error al
-- contar valía "0 despachos" y seguía con el borrado.
--
-- Cambio: la misma clave con ON DELETE RESTRICT. Borrar una fórmula con despachos falla con error de clave foránea
-- (la pantalla ya lo muestra como "No se pudo eliminar"). formula_materials sigue con CASCADE (la composición se va con
-- la fórmula). scheduled_dispatches.formula_id ya era sin cascada.
--
-- Qué pasa con los datos ya cargados: NADA. No se borra ni se cambia ninguna fila; solo la regla de la clave.
-- Vuelta atrás (solo si hace falta):
--   ALTER TABLE public.dispatches DROP CONSTRAINT dispatches_formula_id_fkey,
--     ADD CONSTRAINT dispatches_formula_id_fkey FOREIGN KEY (formula_id) REFERENCES public.formulas(id) ON DELETE CASCADE;

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.dispatches DROP CONSTRAINT IF EXISTS dispatches_formula_id_fkey;
-- NOT VALID + VALIDATE: no bloquea la tabla de despachos mientras revisa las filas viejas (todas tienen fórmula: la
-- clave existía con CASCADE, así que la validación no puede fallar).
ALTER TABLE public.dispatches
  ADD CONSTRAINT dispatches_formula_id_fkey FOREIGN KEY (formula_id) REFERENCES public.formulas(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.dispatches VALIDATE CONSTRAINT dispatches_formula_id_fkey;

COMMIT;
