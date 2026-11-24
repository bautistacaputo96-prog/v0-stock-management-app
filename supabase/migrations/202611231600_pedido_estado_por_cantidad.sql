-- Auditoría de programación/pedidos (23/11/2026) · estado del pedido al cambiar sus m³ — SIN APLICAR (la corre
-- Bautista después de la revisión). Va DESPUÉS de 202610021000_fase2_viajes.sql (usa su trigger de viajes).
-- Se puede correr dos veces (CREATE OR REPLACE + DROP TRIGGER IF EXISTS). NO reemplaza ninguna función existente:
-- agrega una función y un trigger nuevos.
--
-- El problema: el estado del pedido (completo / programado) solo se recalculaba cuando cambiaba lo DESPACHADO
-- (registrar_despacho, anular_despacho, editar_despacho → _ajustar_pedido). Cuando cambia el TOTAL del pedido
-- (formulario de Semana, "Editar total" de Despacho y de la pantalla de siempre) el estado quedaba como estaba:
--   - Pedido de 16 m³ completo (salieron los 16) y la obra pide 8 más: se edita a 24 → seguía "completo", sin viajes
--     (regenerarViajesPedido no arma viajes de un pedido completo) y registrar_despacho rechaza despachar
--     ("ya está completo"). Los 8 m³ no aparecían en ningún lado.
--   - Pedido de 24 m³ con 16 despachados y la obra pide menos: se edita a 16 → seguía "programado" con 0 m³ por
--     despachar (los viajes pendientes se borraban), nunca pasaba a completo y se podía seguir despachando de más.
--
-- El arreglo: después de cambiar quantity_m3, la MISMA regla de _ajustar_pedido:
--   - abierto (no completo ni cancelado) con algo despachado y lo despachado ≥ total − 0,01 → 'completed'
--     (además se limpia la suspensión, como en finalizar_pedido);
--   - completo, lo despachado < total − 0,01 y NO cerrado a mano con Finalizar (observaciones sin "Cerrado con")
--     → 'scheduled'.
-- El cambio de estado se hace con un UPDATE ... SET status, así corre el trigger de la fase 2
-- (trg_viajes_pedido_cerrado): al completarse, los viajes pendientes quedan cancelados; al reabrirse, vuelven a
-- pendientes los que se habían cancelado por "Pedido completo" (después la pantalla los rearma, como ya hacía).
-- Queda en dispatch_status_log ("Cambio de m³: 16 → 24 (despachado 16)"). Los cancelados no se tocan.
--
-- Qué pasa con los datos ya cargados: al aplicar la migración NO se toca ninguna fila. Solo cambia lo que pase en
-- los próximos cambios de m³. Para ver si hay pedidos que ya quedaron mal (solo lectura):
--
--   -- abiertos con todo despachado (deberían estar completos)
--   SELECT id, scheduled_arrival_time, quantity_m3, dispatched_m3, status FROM scheduled_dispatches
--    WHERE status NOT IN ('completed', 'cancelled', 'delivered') AND coalesce(dispatched_m3, 0) > 0
--      AND dispatched_m3 >= quantity_m3 - 0.01;
--   -- completos (no finalizados a mano) con m³ sin despachar
--   SELECT id, scheduled_arrival_time, quantity_m3, dispatched_m3, observations FROM scheduled_dispatches
--    WHERE status = 'completed' AND coalesce(dispatched_m3, 0) < quantity_m3 - 0.01
--      AND coalesce(observations, '') NOT LIKE '%Cerrado con%';
--
-- (Los arreglaría Bautista a mano, pedido por pedido, si hace falta: no se corrigen solos.)

CREATE OR REPLACE FUNCTION public._pedido_estado_por_cantidad()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_desp  numeric := coalesce(NEW.dispatched_m3, 0);
  v_nuevo text;
BEGIN
  IF NEW.status IN ('cancelled', 'delivered') THEN
    RETURN NULL;
  END IF;
  IF coalesce(NEW.status, '') <> 'completed' AND v_desp > 0 AND v_desp >= NEW.quantity_m3 - 0.01 THEN
    v_nuevo := 'completed';
  ELSIF NEW.status = 'completed' AND v_desp < NEW.quantity_m3 - 0.01
        AND coalesce(NEW.observations, '') NOT LIKE '%Cerrado con%' THEN
    v_nuevo := 'scheduled';
  END IF;
  IF v_nuevo IS NULL THEN
    RETURN NULL;
  END IF;

  -- UPDATE OF status: dispara trg_viajes_pedido_cerrado (viajes pendientes ↔ cancelados)
  UPDATE scheduled_dispatches
     SET status = v_nuevo,
         suspendido_at          = CASE WHEN v_nuevo = 'completed' THEN NULL ELSE suspendido_at END,
         suspendido_por         = CASE WHEN v_nuevo = 'completed' THEN NULL ELSE suspendido_por END,
         suspendido_motivo_tipo = CASE WHEN v_nuevo = 'completed' THEN NULL ELSE suspendido_motivo_tipo END,
         suspendido_motivo      = CASE WHEN v_nuevo = 'completed' THEN NULL ELSE suspendido_motivo END,
         updated_at = now()
   WHERE id = NEW.id;

  INSERT INTO dispatch_status_log (scheduled_dispatch_id, previous_status, new_status, changed_by, notes)
  VALUES (NEW.id, NEW.status, v_nuevo, 'Sistema',
          'Cambio de m³: ' || trim_scale(OLD.quantity_m3) || ' → ' || trim_scale(NEW.quantity_m3)
          || ' (despachado ' || trim_scale(v_desp) || ')');
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public._pedido_estado_por_cantidad() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pedido_estado_por_cantidad ON public.scheduled_dispatches;
CREATE TRIGGER trg_pedido_estado_por_cantidad
  AFTER UPDATE OF quantity_m3 ON public.scheduled_dispatches
  FOR EACH ROW
  WHEN (OLD.quantity_m3 IS DISTINCT FROM NEW.quantity_m3)
  EXECUTE FUNCTION public._pedido_estado_por_cantidad();
