-- Zomatik · Etapa Z0: lecturas, copia local y vínculos (SOLO LECTURA de Zomatik)
--
-- Especificación: docs/migracion-loop/zomatik.md (puntos 9, 11, 16.5, 17.4, 18.5, 18.6 y 20.3; las respuestas de
-- Bautista de los puntos 16 a 21 mandan).
--
-- Todo se agrega, nada se borra ni se cambia. Compatible con main y con la Fase 3: no toca ninguna función,
-- trigger ni columna existente; main y la Fase 3 no leen nada de esto. Se puede correr más de una vez.
--
--   clients.zomatik_*            código del cliente en Zomatik (único: nunca dos clientes nuestros con el mismo
--                                código) y cómo quedó el vínculo (auto = primera carga, manual = lo confirmó un
--                                gerencial, traido = "Traer de Zomatik", sin_par = un gerencial dijo que no está).
--   formulas.zomatik_*           artículo de Zomatik de la fórmula (spec 6.7: el vínculo se confirma a mano).
--   zomatik_clientes             copia de los clientes de Zomatik (sucursal REBUCRET). La llena la lectura
--                                nocturna con el listado; CUIT, IVA y condición de pago salen de la ficha, que se
--                                lee de a poco (solo los clientes con remitos en el último año).
--   zomatik_articulos            copia de los artículos (líneas Hormigón, Hormigón (OBRAS) y Servicios).
--   zomatik_proyectos            proyectos (acopios) de Zomatik: cabecera con el saldo SOLO en % (Zomatik lo
--                                lleva en pesos: acá no se guarda ningún monto, spec 20.1 y 20.3), lo remitido en
--                                m³ y el vínculo con nuestra obra (construction_site_id, spec 18.5: varios
--                                proyectos pueden ir a la misma obra).
--   zomatik_proyecto_movimientos un renglón por remito y artículo de cada proyecto (fecha, NP, remito, m³).
--   zomatik_np_pendientes        notas de pedido pendientes (sin el total en pesos).
--   zomatik_lecturas             registro de cada lectura (cron o "Actualizar") y freno de frecuencia.
--   zomatik_lectura_registrar    controla y registra una lectura en una sola transacción (con candado).
--
-- Qué pasa con los datos ya cargados:
--   - clients y formulas: las columnas nuevas quedan nulas (nadie vinculado). Ningún dato existente cambia.
--     Los vínculos de la primera carga los pone scripts/zomatik-primera-carga.mjs (con el OK de Bautista).
--   - Las tablas nuevas arrancan vacías; las llena la primera lectura (/api/zomatik/leer).
--
-- Permisos: todo lo escribe solo el servidor (service role). El navegador (anon) solo puede LEER los artículos
-- (nombres de productos) y el registro de lecturas (fecha y conteos, sin claves ni cookies). Clientes de Zomatik
-- (CUIT, teléfonos, mails), proyectos, movimientos y NP pendientes NO los lee el navegador: van por rutas del
-- servidor con sesión (/api/zomatik/clientes y /api/zomatik/acopios).

-- ---------------------------------------------------------------------------
-- Vínculos en nuestras tablas
-- ---------------------------------------------------------------------------
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS zomatik_codigo integer,
  ADD COLUMN IF NOT EXISTS zomatik_vinculo text,
  ADD COLUMN IF NOT EXISTS zomatik_vinculado_por text,
  ADD COLUMN IF NOT EXISTS zomatik_vinculado_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS clients_zomatik_codigo_key ON public.clients (zomatik_codigo) WHERE zomatik_codigo IS NOT NULL;

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_zomatik_vinculo_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_zomatik_vinculo_check CHECK (
  (zomatik_vinculo IS NULL AND zomatik_codigo IS NULL)
  OR (zomatik_vinculo = 'sin_par' AND zomatik_codigo IS NULL)
  OR (zomatik_vinculo IN ('auto', 'manual', 'traido') AND zomatik_codigo IS NOT NULL)
);

COMMENT ON COLUMN public.clients.zomatik_codigo IS 'Zomatik Z0: código del cliente en Zomatik (sucursal REBUCRET). Único.';
COMMENT ON COLUMN public.clients.zomatik_vinculo IS 'Zomatik Z0: auto (primera carga, nombre o CUIT iguales) · manual (lo confirmó un gerencial) · traido ("Traer de Zomatik") · sin_par (no está en Zomatik). Nulo = sin revisar.';

ALTER TABLE public.formulas
  ADD COLUMN IF NOT EXISTS zomatik_articulo_codigo integer,
  ADD COLUMN IF NOT EXISTS zomatik_articulo_nombre text,
  ADD COLUMN IF NOT EXISTS zomatik_vinculo text,
  ADD COLUMN IF NOT EXISTS zomatik_vinculado_por text,
  ADD COLUMN IF NOT EXISTS zomatik_vinculado_at timestamptz;

ALTER TABLE public.formulas DROP CONSTRAINT IF EXISTS formulas_zomatik_vinculo_check;
ALTER TABLE public.formulas ADD CONSTRAINT formulas_zomatik_vinculo_check CHECK (
  (zomatik_vinculo IS NULL AND zomatik_articulo_codigo IS NULL)
  OR (zomatik_vinculo = 'sin_par' AND zomatik_articulo_codigo IS NULL)
  OR (zomatik_vinculo IN ('auto', 'manual') AND zomatik_articulo_codigo IS NOT NULL)
);

COMMENT ON COLUMN public.formulas.zomatik_articulo_codigo IS 'Zomatik Z0: artículo de Zomatik de esta fórmula (spec 6.7).';
COMMENT ON COLUMN public.formulas.zomatik_vinculo IS 'Zomatik Z0: auto (nombre igual o reglas de la spec) · manual (lo confirmó un gerencial) · sin_par. Nulo = sin revisar.';

-- ---------------------------------------------------------------------------
-- Copia de los clientes de Zomatik
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.zomatik_clientes (
  codigo           integer PRIMARY KEY,
  razon_social     text NOT NULL,
  nombre_norm      text NOT NULL DEFAULT '',
  -- del listado (todas las noches)
  direccion        text,
  localidad        text,
  provincia        text,
  cp               text,
  telefono         text,
  email            text,
  vendedor         text,
  clasificacion    text,
  categoria        text,
  estado           text,
  ultimo_pedido    date,
  -- de los remitos del último año
  remitos_r_12m    integer NOT NULL DEFAULT 0,
  remitos_x_12m    integer NOT NULL DEFAULT 0,
  ultimo_remito    date,
  -- de la ficha (se lee de a poco)
  cuit             text,
  tipo_documento   text,
  tipo_iva         text,
  condicion_pago   text,
  contacto         text,
  ficha_leida_at   timestamptz,
  visto_at         timestamptz NOT NULL DEFAULT now(),
  actualizado_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zomatik_clientes_nombre_norm_idx ON public.zomatik_clientes (nombre_norm);
COMMENT ON TABLE public.zomatik_clientes IS 'Zomatik Z0: copia de los clientes de Zomatik (sucursal REBUCRET). La escribe /api/zomatik/leer. visto_at = última lectura en la que apareció.';

REVOKE ALL ON TABLE public.zomatik_clientes FROM anon, authenticated;
GRANT ALL ON TABLE public.zomatik_clientes TO service_role;

-- ---------------------------------------------------------------------------
-- Copia de los artículos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.zomatik_articulos (
  codigo          integer PRIMARY KEY,
  nombre          text NOT NULL,
  linea           text,
  visto_at        timestamptz NOT NULL DEFAULT now(),
  actualizado_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.zomatik_articulos IS 'Zomatik Z0: artículos de Zomatik (Hormigón, Hormigón (OBRAS), Servicios). La escribe /api/zomatik/leer.';

REVOKE ALL ON TABLE public.zomatik_articulos FROM anon, authenticated;
GRANT SELECT ON TABLE public.zomatik_articulos TO anon, authenticated;
GRANT ALL ON TABLE public.zomatik_articulos TO service_role;

-- ---------------------------------------------------------------------------
-- Proyectos (acopios) y lo remitido contra cada uno
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.zomatik_proyectos (
  codigo                integer PRIMARY KEY,           -- id interno (reporte_detalleproyecto.php?proyecto=N)
  numero                text NOT NULL UNIQUE,          -- "PRO 0001-00000030" / "PRO2 0001-00000013"
  comprobante           text,                          -- PRO / PRO2
  cliente_codigo        integer,                       -- código del cliente en Zomatik
  cliente_nombre        text,
  obra                  text,                          -- obra según Zomatik (texto)
  fecha                 date,
  tipo                  text CHECK (tipo IS NULL OR tipo IN ('monto', 'cantidades')),
  pactado_m3            numeric(12,3),                 -- solo si es por cantidades
  saldo_pct             numeric(6,1),                  -- lo que le queda de material, en % (sin pesos)
  remitido_m3           numeric(12,3) NOT NULL DEFAULT 0,
  ultima_entrega        date,
  estado                text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado')),
  estado_zomatik        text,
  historia_leida_at     timestamptz,                   -- ya se leyeron los remitos de antes del último año
  construction_site_id  uuid REFERENCES public.construction_sites(id) ON DELETE SET NULL,
  vinculo               text CHECK (vinculo IS NULL OR vinculo IN ('auto', 'manual', 'sin_par')),
  vinculado_por         text,
  vinculado_at          timestamptz,
  visto_at              timestamptz NOT NULL DEFAULT now(),
  leido_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zomatik_proyectos_vinculo_obra_check CHECK (
    (vinculo IS NULL AND construction_site_id IS NULL)
    OR (vinculo = 'sin_par' AND construction_site_id IS NULL)
    OR (vinculo IN ('auto', 'manual') AND construction_site_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS zomatik_proyectos_obra_idx ON public.zomatik_proyectos (construction_site_id);
CREATE INDEX IF NOT EXISTS zomatik_proyectos_cliente_idx ON public.zomatik_proyectos (cliente_codigo);
COMMENT ON TABLE public.zomatik_proyectos IS 'Zomatik Z0: proyectos (acopios) leídos de Zomatik, solo lectura y vínculo con nuestra obra. Sin montos: el saldo va en % (spec 20.3). estado cerrado = ya no aparece entre los abiertos.';
COMMENT ON COLUMN public.zomatik_proyectos.saldo_pct IS 'Restan material ÷ material pactado × 100, calculado con los montos de Zomatik (que no se guardan).';

REVOKE ALL ON TABLE public.zomatik_proyectos FROM anon, authenticated;
GRANT ALL ON TABLE public.zomatik_proyectos TO service_role;

CREATE TABLE IF NOT EXISTS public.zomatik_proyecto_movimientos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_numero  text NOT NULL REFERENCES public.zomatik_proyectos(numero) ON DELETE CASCADE ON UPDATE CASCADE,
  fecha            date NOT NULL,
  remito           text NOT NULL,                      -- "RM2 0099-00002744"
  pedido           text,                               -- "NP2 0001-00002079"
  articulo_codigo  integer NOT NULL DEFAULT 0,
  articulo         text,
  m3               numeric(12,3) NOT NULL DEFAULT 0,
  deposito         text,                               -- Canning / REBUCRET (Hudson)
  es_hormigon      boolean NOT NULL DEFAULT true,      -- false: bombeo y otros servicios (no cuentan en los m³)
  leido_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zomatik_proyecto_movimientos_key UNIQUE (proyecto_numero, remito, articulo_codigo)
);
CREATE INDEX IF NOT EXISTS zomatik_proyecto_movimientos_fecha_idx ON public.zomatik_proyecto_movimientos (proyecto_numero, fecha);
COMMENT ON TABLE public.zomatik_proyecto_movimientos IS 'Zomatik Z0: renglones de remito de cada proyecto (reporte_remitosventa.php, columna Proyecto). Sin precios.';

REVOKE ALL ON TABLE public.zomatik_proyecto_movimientos FROM anon, authenticated;
GRANT ALL ON TABLE public.zomatik_proyecto_movimientos TO service_role;

-- ---------------------------------------------------------------------------
-- Notas de pedido pendientes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.zomatik_np_pendientes (
  numero          text PRIMARY KEY,                    -- "NP2 0001-00002079"
  cliente         text,
  fecha           date,
  fecha_entrega   date,
  estado          text,
  vendedor        text,
  deposito        text,
  origen          text,                                -- Lista / Proyecto
  leido_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.zomatik_np_pendientes IS 'Zomatik Z0: notas de pedido pendientes de remitir según Zomatik (sin el total en pesos). Se reemplaza en cada lectura.';

REVOKE ALL ON TABLE public.zomatik_np_pendientes FROM anon, authenticated;
GRANT ALL ON TABLE public.zomatik_np_pendientes TO service_role;

-- ---------------------------------------------------------------------------
-- Registro de lecturas y freno de frecuencia
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.zomatik_lecturas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origen     text NOT NULL CHECK (origen IN ('cron', 'manual')),
  usuario    text,
  inicio     timestamptz NOT NULL DEFAULT now(),
  fin        timestamptz,
  ok         boolean,
  resultado  jsonb,                                    -- conteos por parte y errores (nunca claves ni cookies)
  error      text
);
CREATE INDEX IF NOT EXISTS zomatik_lecturas_inicio_idx ON public.zomatik_lecturas (inicio DESC);
COMMENT ON TABLE public.zomatik_lecturas IS 'Zomatik Z0: cada lectura de Zomatik (cron nocturno o botón Actualizar) con su resultado. Sirve de freno.';

REVOKE ALL ON TABLE public.zomatik_lecturas FROM anon, authenticated;
GRANT SELECT ON TABLE public.zomatik_lecturas TO anon, authenticated;
GRANT ALL ON TABLE public.zomatik_lecturas TO service_role;

-- Controla y registra una lectura con un candado: dos llamadas juntas no pueden pasar las dos.
--   - Si hay una lectura en curso (sin fin, de hace menos de 3 min), se rechaza cualquiera.
--   - Manual ("Actualizar"): se rechaza si hubo otra lectura hace menos de 5 min.
--   - Cron: se rechaza si hubo otra del cron hace menos de 60 min (el header del cron se puede falsificar).
-- Devuelve {"id": …} si se registró, o {"motivo": "…"} si se rechaza.
CREATE OR REPLACE FUNCTION public.zomatik_lectura_registrar(p_origen text, p_usuario text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_origen NOT IN ('cron', 'manual') THEN
    RETURN jsonb_build_object('motivo', 'Origen inválido');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('zomatik_lectura_registrar'));
  IF EXISTS (SELECT 1 FROM zomatik_lecturas WHERE fin IS NULL AND inicio > now() - interval '3 minutes') THEN
    RETURN jsonb_build_object('motivo', 'Ya se está leyendo Zomatik. Esperá un minuto.');
  END IF;
  IF p_origen = 'manual' AND EXISTS (SELECT 1 FROM zomatik_lecturas WHERE inicio > now() - interval '5 minutes') THEN
    RETURN jsonb_build_object('motivo', 'Zomatik se leyó hace menos de 5 min. Esperá un rato.');
  END IF;
  IF p_origen = 'cron' AND EXISTS (SELECT 1 FROM zomatik_lecturas WHERE origen = 'cron' AND inicio > now() - interval '60 minutes') THEN
    RETURN jsonb_build_object('motivo', 'La lectura nocturna ya corrió hace menos de una hora.');
  END IF;
  INSERT INTO zomatik_lecturas (origen, usuario) VALUES (p_origen, nullif(trim(coalesce(p_usuario, '')), '')) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.zomatik_lectura_registrar(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zomatik_lectura_registrar(text, text) TO service_role;
