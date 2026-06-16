-- Redesign dispatch flow: 1 pedido → N despachos reales

-- FK desde dispatches hacia scheduled_dispatches (N:1)
ALTER TABLE dispatches
  ADD COLUMN IF NOT EXISTS scheduled_dispatch_id UUID REFERENCES scheduled_dispatches(id);

-- Acumular m3 despachados en el pedido para mostrar progreso sin queries complejas
ALTER TABLE scheduled_dispatches
  ADD COLUMN IF NOT EXISTS dispatched_m3 DECIMAL(10,2) DEFAULT 0;

-- Backfill: para pedidos ya vinculados via dispatch_id, calcular dispatched_m3
UPDATE scheduled_dispatches sd
SET dispatched_m3 = d.quantity_m3
FROM dispatches d
WHERE sd.dispatch_id = d.id
  AND sd.dispatched_m3 = 0
  AND sd.dispatch_id IS NOT NULL;
