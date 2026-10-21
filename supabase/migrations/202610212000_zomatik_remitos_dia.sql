-- Zomatik · Etapa Z0 (2): resumen diario de los remitos de Zomatik por cliente, para cruzar por fechas y m³
--
-- Idea de Bautista (21/10/2026): si un cliente nuestro tuvo despachos ciertos días y un cliente de Zomatik tuvo
-- remitos esos mismos días, con m³ parecidos y en la misma planta, son el mismo cliente. La pantalla "Vínculos con
-- Zomatik" lo usa para proponer clientes y fórmulas con su confianza (lib/zomatik/cruce.ts).
--
-- Solo agrega una tabla. No toca nada existente. Se puede correr más de una vez. Requiere la migración
-- 202610211800_zomatik_z0_lecturas.sql (ya aplicada).
--
--   zomatik_remitos_dia   un renglón por cliente de Zomatik (nombre normalizado), día y planta del depósito
--                         (Canning = depósito 116, Hudson = REBUCRET 113): m³ de hormigón remitidos y los códigos
--                         de artículo. Sin precios. La llena la lectura de Zomatik con los remitos del último año
--                         (/api/zomatik/leer); los días que Zomatik ya no trae se sacan (salvo que la lectura caiga
--                         mucho, ver puedeBorrarViejos).
--
-- Qué pasa con los datos ya cargados: nada; la tabla arranca vacía y se llena en la próxima lectura.
-- Permisos: solo el servidor (service role). El navegador no la lee.

CREATE TABLE IF NOT EXISTS public.zomatik_remitos_dia (
  cliente_norm  text NOT NULL,                         -- nombre del cliente normalizado (como zomatik_clientes.nombre_norm)
  cliente       text,                                  -- como viene en el remito
  fecha         date NOT NULL,
  planta        text NOT NULL CHECK (planta IN ('Canning', 'Hudson', 'otro')),
  m3            numeric(12,3) NOT NULL DEFAULT 0,      -- solo hormigón (sin bombeo ni servicios)
  remitos       integer NOT NULL DEFAULT 0,
  articulos     integer[] NOT NULL DEFAULT '{}',
  leido_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cliente_norm, fecha, planta)
);
CREATE INDEX IF NOT EXISTS zomatik_remitos_dia_fecha_idx ON public.zomatik_remitos_dia (fecha);
COMMENT ON TABLE public.zomatik_remitos_dia IS 'Zomatik Z0: m³ de hormigón remitidos por cliente, día y planta (último año), para cruzar con nuestros despachos. Sin precios. La escribe /api/zomatik/leer.';

REVOKE ALL ON TABLE public.zomatik_remitos_dia FROM anon, authenticated;
GRANT ALL ON TABLE public.zomatik_remitos_dia TO service_role;
