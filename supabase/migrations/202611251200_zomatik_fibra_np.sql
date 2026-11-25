-- Zomatik · la fibra del pedido va a la NP (renglón de MACRO FIBRA) — SIN APLICAR (la corre Bautista después de que
-- el revisor apruebe). Va DESPUÉS de 202611181400_zomatik_np_edicion.sql. Se puede correr dos veces.
--
-- Especificación: docs/specs/2026-11-25-fibra-en-np.md (sección 6).
-- Correrla ANTES de publicar el código (sin ella el código funciona igual: la fibra queda apagada).
-- Va entera en una transacción (BEGIN … COMMIT): para probarla antes, cambiar el COMMIT del final por ROLLBACK.
--
-- Qué cambia (se agrega; no se borra ningún dato):
--   zomatik_np_config.fibra_activo    LLAVE PROPIA de la fibra en la NP, por planta, APAGADA por defecto. Requiere la de
--                         la NP (activo). Apagada: la NP sale como hoy, solo con el hormigón.
--   zomatik_np_config.fibra_articulo  código visible del artículo de Zomatik de la fibra (10099016 = MACRO FIBRA). Se
--                         cambia acá si un día es otro, sin tocar el código.
--   zomatik_np_config.fibra_desde     de registro: cuándo se prendió.
--   zomatik_np.fibra_kg   kg de fibra que el sistema grabó en la NP de Zomatik (el renglón de MACRO FIBRA). Nulo = la
--                         NP no tiene fibra (todas las de antes, las de pedidos sin fibra y una cuya fibra quedó en 0).
--                         Nunca 0: o más de 0, o nulo.
--   zomatik_np.fibra_aviso_at  cuándo se avisó (Actividad y mail) un problema de la fibra de esa NP: una sola vez por NP.
--   zomatik_remitos.fibra_kg   kg de fibra que llevó ese remito en Zomatik (para no bajar la NP de lo ya remitido).
--
-- Qué pasa con los datos ya cargados:
--   zomatik_np_config: fibra_activo = false y fibra_articulo = 10099016 en Canning y Hudson. Con la llave apagada no
--               cambia nada.
--   zomatik_np: fibra_kg y fibra_aviso_at quedan nulos en todas las NP que existen: el sistema las sigue tratando como
--               hoy (solo hormigón). Una NP de antes NO recibe la fibra sola al prender la llave.
--   zomatik_remitos: fibra_kg queda nulo en todos los remitos que existen.
--   scheduled_dispatches, dispatches, dispatch_materials, zomatik_remito_despachos: no se tocan.
--   La fibra del pedido ya está en scheduled_dispatches.fiber_kg_per_m3 y la del camión en dispatch_materials
--   (material tipo 'fibra'): no hace falta nada nuevo para eso.

SET lock_timeout = '3s';
SET statement_timeout = '60s';

BEGIN;

ALTER TABLE public.zomatik_np_config ADD COLUMN IF NOT EXISTS fibra_activo boolean NOT NULL DEFAULT false;
ALTER TABLE public.zomatik_np_config ADD COLUMN IF NOT EXISTS fibra_articulo integer NOT NULL DEFAULT 10099016;
ALTER TABLE public.zomatik_np_config ADD COLUMN IF NOT EXISTS fibra_desde timestamptz;
COMMENT ON COLUMN public.zomatik_np_config.fibra_activo IS 'Zomatik: llave de la fibra en la NP (spec 2026-11-25). false (por defecto) = la NP lleva solo el hormigón, como antes. Requiere activo.';
COMMENT ON COLUMN public.zomatik_np_config.fibra_articulo IS 'Zomatik: código visible del artículo de la fibra (10099016 = MACRO FIBRA, en kg).';
COMMENT ON COLUMN public.zomatik_np_config.fibra_desde IS 'Zomatik: cuándo se prendió la fibra en la NP (de registro).';

ALTER TABLE public.zomatik_np ADD COLUMN IF NOT EXISTS fibra_kg numeric(12,3);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zomatik_np_fibra_kg_check' AND conrelid = 'public.zomatik_np'::regclass) THEN
    ALTER TABLE public.zomatik_np ADD CONSTRAINT zomatik_np_fibra_kg_check CHECK (fibra_kg IS NULL OR fibra_kg > 0);
  END IF;
END;
$$;
COMMENT ON COLUMN public.zomatik_np.fibra_kg IS 'Zomatik: kg de fibra (MACRO FIBRA) grabados en la NP. Nulo = sin fibra (nunca 0).';
ALTER TABLE public.zomatik_np ADD COLUMN IF NOT EXISTS fibra_aviso_at timestamptz;
COMMENT ON COLUMN public.zomatik_np.fibra_aviso_at IS 'Zomatik: cuándo se avisó un problema de la fibra de esta NP (una sola vez por NP).';

ALTER TABLE public.zomatik_remitos ADD COLUMN IF NOT EXISTS fibra_kg numeric(12,3);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zomatik_remitos_fibra_kg_check' AND conrelid = 'public.zomatik_remitos'::regclass) THEN
    ALTER TABLE public.zomatik_remitos ADD CONSTRAINT zomatik_remitos_fibra_kg_check CHECK (fibra_kg IS NULL OR fibra_kg >= 0);
  END IF;
END;
$$;
COMMENT ON COLUMN public.zomatik_remitos.fibra_kg IS 'Zomatik: kg de fibra (MACRO FIBRA) que llevó el remito.';

COMMIT;
