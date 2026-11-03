-- Zomatik · Precio de la NP elegido por quien programa (03/11/2026) — SIN APLICAR (avisar a Bautista antes)
-- Va después de 202610222200_zomatik_np.sql, 202610231000_zomatik_np_saldo.sql (aplicadas) y 202610291000_zomatik_z1_remitos.sql.
-- Spec: docs/migracion-loop/zomatik.md, sección 27.
--
-- Qué agrega (todo nuevo y vacío; no cambia nada de lo cargado):
--   zomatik_np_pedido.precio_m3     precio por m³ sin IVA que eligió quien programa (vacío = el de la lista).
--   zomatik_np.precio_m3            el precio con el que se genera esa NP (copiado de la elección al crearla).
--   zomatik_np.precio_lista_m3      el precio por m³ que traía el renglón al generarla (lista o proyecto): es la copia
--                                   que usa "Ver precio de lista" (leerlo de Zomatik sin crear un borrador no se puede).
--
-- Qué pasa con los datos ya cargados: nada. Las columnas nuevas quedan vacías: los pedidos y NP de hoy siguen con el
-- precio de la lista, como hasta ahora. Hasta aplicarla, el sistema funciona igual sin precio (si alguien carga un
-- precio, avisa que falta actualizar la base).
-- Candado corto sobre zomatik_np y zomatik_np_pedido (ADD COLUMN sin default): correrla fuera de horario igual.

SET lock_timeout = '3s';
SET statement_timeout = '60s';

ALTER TABLE public.zomatik_np_pedido ADD COLUMN IF NOT EXISTS precio_m3 numeric(14,3);
ALTER TABLE public.zomatik_np ADD COLUMN IF NOT EXISTS precio_m3 numeric(14,3);
ALTER TABLE public.zomatik_np ADD COLUMN IF NOT EXISTS precio_lista_m3 numeric(14,3);

DO $$ BEGIN
  ALTER TABLE public.zomatik_np_pedido ADD CONSTRAINT zomatik_np_pedido_precio_m3_positivo CHECK (precio_m3 IS NULL OR precio_m3 > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.zomatik_np ADD CONSTRAINT zomatik_np_precio_m3_positivo CHECK (precio_m3 IS NULL OR precio_m3 > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.zomatik_np_pedido.precio_m3 IS 'Zomatik: precio por m³ sin IVA de la NP elegido por quien programa (programacion.cargar). Vacío = el de la lista.';
COMMENT ON COLUMN public.zomatik_np.precio_m3 IS 'Zomatik: precio por m³ sin IVA con el que se genera la NP (vacío = el de la lista).';
COMMENT ON COLUMN public.zomatik_np.precio_lista_m3 IS 'Zomatik: precio por m³ que traía el renglón (lista o proyecto) al generar la NP. Copia para "Ver precio de lista".';

RESET lock_timeout;
RESET statement_timeout;
