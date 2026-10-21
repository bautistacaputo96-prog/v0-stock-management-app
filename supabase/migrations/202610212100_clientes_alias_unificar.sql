-- Clientes · alias y unificación de duplicados (regla de Bautista del 21/10/2026: "no dar de alta el mismo cliente
-- con otro nombre"). Especificación: docs/migracion-loop/zomatik.md, punto 21.6.
--
-- Solo agrega. Compatible con main y con la Fase 3. Se puede correr más de una vez.
--
--   client_alias         nombres alternativos de un cliente ("MERVA" y "MERVA SA"): el buscador lo encuentra por
--                        cualquiera. Se guardan al confirmar "es este" en el alta, al unificar y a mano.
--   clients.unificado_*  el cliente dado de baja por unificar apunta al que quedó (para no perder el rastro).
--   unificar_clientes    en UNA transacción: mueve obras (las de mismo nombre en los dos se juntan: todo lo que
--                        apuntaba a la repetida pasa a la del que queda), pedidos, despachos y respuestas R/X del día
--                        al cliente que queda, pasa el código de Zomatik si el que queda no tiene, guarda los nombres del otro
--                        como alias, da de baja el otro y deja la Actividad. Si algo no cierra, no cambia nada.
--
-- Qué pasa con los datos ya cargados: nada; la tabla arranca vacía y las columnas nuevas quedan nulas.
-- Permisos: client_alias la leen y escriben solo las rutas del servidor (el buscador va por /api/clientes/buscar);
-- la función solo la ejecuta el servidor (service role), después de controlar que quien unifica es gerencial.

CREATE TABLE IF NOT EXISTS public.client_alias (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  alias       text NOT NULL,
  alias_norm  text NOT NULL,                           -- sin tildes, minúsculas, espacios simples (lo arma el servidor)
  origen      text NOT NULL DEFAULT 'manual' CHECK (origen IN ('alta', 'unificar', 'manual')),
  creado_por  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_alias_unico UNIQUE (client_id, alias_norm)
);
CREATE INDEX IF NOT EXISTS client_alias_norm_idx ON public.client_alias (alias_norm);
COMMENT ON TABLE public.client_alias IS 'Nombres alternativos de un cliente, para que el buscador lo encuentre por cualquiera (regla del 21/10/2026).';

REVOKE ALL ON TABLE public.client_alias FROM anon, authenticated;
GRANT ALL ON TABLE public.client_alias TO service_role;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS unificado_en uuid REFERENCES public.clients(id),
  ADD COLUMN IF NOT EXISTS unificado_at timestamptz,
  ADD COLUMN IF NOT EXISTS unificado_por text;
COMMENT ON COLUMN public.clients.unificado_en IS 'Si se unificó con otro cliente: el que quedó. Este queda dado de baja.';

CREATE OR REPLACE FUNCTION public.unificar_clientes(p_queda uuid, p_sale uuid, p_usuario text, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  q clients%ROWTYPE;
  s clients%ROWTYPE;
  v_usuario text := coalesce(nullif(trim(p_usuario), ''), 'Desconocido');
  n_obras int;
  n_obras_juntadas int := 0;
  n_pedidos int;
  n_despachos int;
  n_rx int;
  n_rx_borrados int;
  r record;
BEGIN
  IF p_queda IS NULL OR p_sale IS NULL OR p_queda = p_sale THEN
    RETURN jsonb_build_object('error', 'Elegí dos clientes distintos.');
  END IF;
  IF length(trim(coalesce(p_motivo, ''))) < 5 THEN
    RETURN jsonb_build_object('error', 'Escribí el motivo (5 letras como mínimo).');
  END IF;
  -- Candado de los dos, siempre en el mismo orden (para que dos unificaciones cruzadas no se traben)
  PERFORM 1 FROM clients WHERE id IN (p_queda, p_sale) ORDER BY id FOR UPDATE;
  SELECT * INTO q FROM clients WHERE id = p_queda;
  SELECT * INTO s FROM clients WHERE id = p_sale;
  IF q.id IS NULL OR s.id IS NULL THEN
    RETURN jsonb_build_object('error', 'No existe alguno de los dos clientes.');
  END IF;
  IF s.unificado_en IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'Ese cliente ya se unificó antes.');
  END IF;
  -- El que queda tiene que estar activo y no unificado en otro (si no, se arman ciclos o se mueve todo a una baja)
  IF q.unificado_en IS NOT NULL OR q.active = false THEN
    RETURN jsonb_build_object('error', format('«%s» está dado de baja o ya se unificó en otro: elegí como el que queda un cliente activo.', q.name));
  END IF;
  IF q.zomatik_codigo IS NOT NULL AND s.zomatik_codigo IS NOT NULL AND q.zomatik_codigo <> s.zomatik_codigo THEN
    RETURN jsonb_build_object('error', format('Los dos tienen distinto cliente de Zomatik (%s y %s): revisalo en Vínculos antes de unificar.', q.zomatik_codigo, s.zomatik_codigo));
  END IF;

  BEGIN
    -- Obras con el mismo nombre en los dos (sin mayúsculas ni espacios de más): todo lo de la obra repetida pasa a
    -- la del que queda y la repetida se borra. Así no choca con UNIQUE (name, client_id).
    FOR r IN
      SELECT os.id AS sale_obra, oq.id AS queda_obra
        FROM construction_sites os
        JOIN LATERAL (
          SELECT o.id FROM construction_sites o
           WHERE o.client_id = p_queda AND lower(trim(o.name)) = lower(trim(os.name))
           ORDER BY o.created_at NULLS LAST, o.id LIMIT 1
        ) oq ON true
       WHERE os.client_id = p_sale
    LOOP
      UPDATE dispatches SET construction_site_id = r.queda_obra WHERE construction_site_id = r.sale_obra;
      UPDATE scheduled_dispatches SET construction_site_id = r.queda_obra WHERE construction_site_id = r.sale_obra;
      UPDATE viajes_gps SET construction_site_id = r.queda_obra WHERE construction_site_id = r.sale_obra;
      UPDATE zomatik_proyectos SET construction_site_id = r.queda_obra WHERE construction_site_id = r.sale_obra;
      DELETE FROM construction_sites WHERE id = r.sale_obra;
      n_obras_juntadas := n_obras_juntadas + 1;
    END LOOP;

    UPDATE construction_sites SET client_id = p_queda WHERE client_id = p_sale;
    GET DIAGNOSTICS n_obras = ROW_COUNT;
    UPDATE scheduled_dispatches SET client_id = p_queda WHERE client_id = p_sale;
    GET DIAGNOSTICS n_pedidos = ROW_COUNT;
    UPDATE dispatches SET client_id = p_queda WHERE client_id = p_sale;
    GET DIAGNOSTICS n_despachos = ROW_COUNT;
    -- Respuesta "con o sin factura" del día: si el que queda ya respondió ese día, vale la suya
    DELETE FROM remito_tipo_dia rt WHERE rt.client_id = p_sale AND EXISTS (SELECT 1 FROM remito_tipo_dia o WHERE o.client_id = p_queda AND o.fecha = rt.fecha);
    GET DIAGNOSTICS n_rx_borrados = ROW_COUNT;
    UPDATE remito_tipo_dia SET client_id = p_queda WHERE client_id = p_sale;
    GET DIAGNOSTICS n_rx = ROW_COUNT;

    -- Código de Zomatik: si el que queda no tiene, pasa el del otro (primero se saca, por el índice único)
    IF s.zomatik_codigo IS NOT NULL THEN
      UPDATE clients SET zomatik_codigo = NULL, zomatik_vinculo = NULL WHERE id = p_sale;
      IF q.zomatik_codigo IS NULL THEN
        UPDATE clients SET zomatik_codigo = s.zomatik_codigo, zomatik_vinculo = 'manual', zomatik_vinculado_por = v_usuario, zomatik_vinculado_at = now() WHERE id = p_queda;
      END IF;
    END IF;

    -- Los nombres del que sale quedan como alias del que queda (y sus alias también)
    INSERT INTO client_alias (client_id, alias, alias_norm, origen, creado_por)
    SELECT p_queda, x.alias, lower(regexp_replace(trim(translate(x.alias, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '\s+', ' ', 'g')), 'unificar', v_usuario
      FROM (SELECT s.name::text AS alias UNION SELECT s.razon_social WHERE s.razon_social IS NOT NULL) x
     WHERE trim(coalesce(x.alias, '')) <> ''
    ON CONFLICT (client_id, alias_norm) DO NOTHING;
    UPDATE client_alias a SET client_id = p_queda
     WHERE a.client_id = p_sale AND NOT EXISTS (SELECT 1 FROM client_alias b WHERE b.client_id = p_queda AND b.alias_norm = a.alias_norm);
    DELETE FROM client_alias WHERE client_id = p_sale;

    -- Los que ya se habían unificado en el que sale pasan a apuntar al que queda (sin cadenas)
    UPDATE clients SET unificado_en = p_queda WHERE unificado_en = p_sale;
    UPDATE clients SET active = false, unificado_en = p_queda, unificado_at = now(), unificado_por = v_usuario WHERE id = p_sale;

    INSERT INTO activity_log (user_name, action, entity, entity_id, reference, details)
    VALUES (v_usuario, 'editar', 'cliente', p_queda, q.name,
            jsonb_build_object('Unificado con', s.name, 'Motivo', trim(p_motivo), 'Obras movidas', n_obras, 'Obras repetidas juntadas', n_obras_juntadas,
                               'Pedidos movidos', n_pedidos, 'Despachos movidos', n_despachos, 'Respuestas R/X movidas', n_rx, 'Respuestas R/X repetidas borradas', n_rx_borrados)),
           (v_usuario, 'editar', 'cliente', p_sale, s.name,
            jsonb_build_object('Unificado en', q.name, 'Motivo', trim(p_motivo), 'Estado', 'dado de baja'));
  EXCEPTION WHEN unique_violation THEN
    -- Todo lo de este bloque se deshace: no cambia nada
    RETURN jsonb_build_object('error', 'No se pudo unificar: quedaría repetido un dato que tiene que ser único (por ejemplo, dos obras o dos clientes con el mismo nombre en la misma planta). No se cambió nada. Corregí el nombre y probá de nuevo.', 'detalle', SQLERRM);
  END;

  RETURN jsonb_build_object('ok', true, 'obras', n_obras, 'obras_juntadas', n_obras_juntadas, 'pedidos', n_pedidos, 'despachos', n_despachos, 'remito_tipo_dia', n_rx);
END;
$$;

REVOKE ALL ON FUNCTION public.unificar_clientes(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unificar_clientes(uuid, uuid, text, text) TO service_role;
