-- Zomatik · Z1: la OF del robot descuenta la materia prima (pantalla "Composicion") — SIN APLICAR (la corre Bautista
-- después de que el revisor apruebe). Va DESPUÉS de 202610291000_zomatik_z1_remitos.sql. Se puede correr dos veces.
--
-- Especificación: docs/specs/2026-11-19-of-descuenta-materia-prima.md (sección 3.3).
-- Candado corto sobre zomatik_remitos (tabla chica): agregar columnas sin valor por defecto no reescribe la tabla.
-- Va entera en una transacción (BEGIN … COMMIT): para probarla antes, cambiar el COMMIT del final por ROLLBACK.
--
-- Qué cambia (se agrega; no se borra ni se cambia ningún dato):
--   zomatik_remitos.of_mp_estado   estado de la materia prima de la OF en Zomatik:
--                         NULL       fila vieja: el robot no la toca sola;
--                         'pendiente' hay que descontarla. Las OF nuevas nacen así; las viejas, solo si alguien las marca
--                                    para regularizar (la pasada de cada 10 minutos las toma);
--                         'ok'       descontada (o ya estaba: la OF ya tenía su remito interno de materia prima);
--                         'revisar'  no se pudo (ver of_mp_mensaje). El remito del cliente NO se frena;
--                         'no'       decidido que no va (OF duplicada de una hecha a mano).
--   zomatik_remitos.of_mp_at       la MARCA: cuándo se mandó (o pudo mandarse) la materia prima a Zomatik. Se pone ANTES
--                         de mandar y solo si estaba vacía: con la marca puesta el robot nunca manda otra vez (no se
--                         puede descontar dos veces). Si ya estaba descontada, cuándo se verificó.
--   zomatik_remitos.of_mp_mensaje  por qué quedó 'revisar' (o el último intento que no se pudo).
--   zomatik_remitos.of_mp_detalle  lo que se mandó a descontar: [{codigo, nombre, toneladas}] (artículo de Zomatik).
--
-- El contador de reintentos es el que ya existe (zomatik_remitos.sin_stock, tope de 6 = 1 hora): no se agrega otro.
--
-- Qué pasa con los datos ya cargados: no cambia ninguna fila. Todas quedan con of_mp_estado NULL (y las otras tres
-- columnas también): el robot no descuenta nada de lo viejo hasta que alguien marque la fila 'pendiente'.
-- Para volver a intentar una fila que quedó 'revisar' (después de mirarla en Zomatik):
--   UPDATE zomatik_remitos SET of_mp_estado = 'pendiente', of_mp_at = NULL, sin_stock = 0 WHERE id = '…';
-- (of_mp_at = NULL saca la marca: hacerlo SOLO si en Zomatik esa OF no tiene su remito interno de materia prima.)
--
-- Con el código de main (que no lee estas columnas) no cambia nada. Sin esta migración, el código nuevo sigue como
-- hoy: el paso de la materia prima no corre.

SET lock_timeout = '3s';
SET statement_timeout = '60s';

BEGIN;

ALTER TABLE public.zomatik_remitos ADD COLUMN IF NOT EXISTS of_mp_estado text;
ALTER TABLE public.zomatik_remitos ADD COLUMN IF NOT EXISTS of_mp_at timestamptz;
ALTER TABLE public.zomatik_remitos ADD COLUMN IF NOT EXISTS of_mp_mensaje text;
ALTER TABLE public.zomatik_remitos ADD COLUMN IF NOT EXISTS of_mp_detalle jsonb;

-- El CHECK aparte y con nombre: al correrla dos veces no se duplica
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zomatik_remitos_of_mp_estado_check' AND conrelid = 'public.zomatik_remitos'::regclass) THEN
    ALTER TABLE public.zomatik_remitos ADD CONSTRAINT zomatik_remitos_of_mp_estado_check CHECK (of_mp_estado IS NULL OR of_mp_estado IN ('pendiente', 'ok', 'revisar', 'no'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.zomatik_remitos.of_mp_estado IS 'Zomatik Z1: materia prima de la OF. NULL = fila vieja (no se toca sola) · pendiente = hay que descontarla · ok = descontada o ya estaba · revisar = no se pudo (ver of_mp_mensaje) · no = decidido que no va (OF duplicada).';
COMMENT ON COLUMN public.zomatik_remitos.of_mp_at IS 'Zomatik Z1: la marca de la materia prima de la OF: cuándo se mandó (o pudo mandarse) a Zomatik. Se pone antes de mandar; con la marca puesta el robot nunca manda otra vez.';
COMMENT ON COLUMN public.zomatik_remitos.of_mp_mensaje IS 'Zomatik Z1: por qué la materia prima de la OF quedó en revisar (o el último intento que no se pudo).';
COMMENT ON COLUMN public.zomatik_remitos.of_mp_detalle IS 'Zomatik Z1: lo que se mandó a descontar de materia prima: [{codigo, nombre, toneladas}].';

COMMIT;

RESET lock_timeout;
RESET statement_timeout;

-- Para que la API vea las columnas nuevas enseguida
NOTIFY pgrst, 'reload schema';
