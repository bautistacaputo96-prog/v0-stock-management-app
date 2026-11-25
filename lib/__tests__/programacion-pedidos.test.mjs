// Pruebas de la auditoría de programación/pedidos (23/11/2026): m³ del pedido, cancelar solo pedidos abiertos y
// rearmar los viajes al cambiar de planta. Sin base ni red (la base es un doble que anota lo que se le pide).
import { test } from "node:test"
import assert from "node:assert/strict"
import * as A from "../programacion-acciones.ts"
import * as V from "../viajes.ts"

test("errorCantidadPedido: alta, mayor a 0", () => {
  assert.equal(A.errorCantidadPedido(8), null)
  assert.match(A.errorCantidadPedido(0), /mayores a 0/)
  assert.match(A.errorCantidadPedido(-4), /mayores a 0/)
  assert.match(A.errorCantidadPedido(NaN), /mayores a 0/) // campo vacío
})

test("errorCantidadPedido: al editar, no menos de lo despachado (igual sí: queda completo)", () => {
  const p = { quantity_m3: 24, dispatched_m3: 16 }
  assert.equal(A.errorCantidadPedido(32, p), null)
  assert.equal(A.errorCantidadPedido(16, p), null)
  assert.match(A.errorCantidadPedido(12, p), /Ya salieron 16 m³/)
  // Sin cambiar los m³ no se frena (un pedido viejo con más despachado que el total se puede seguir editando)
  assert.equal(A.errorCantidadPedido(16, { quantity_m3: "16", dispatched_m3: 16.5 }), null)
  assert.equal(A.errorCantidadPedido(10, { quantity_m3: 8, dispatched_m3: null }), null)
})

/** Doble de supabase: anota update / filtros y devuelve `filas` en el select final */
function sbDoble(filas, error = null) {
  const log = []
  const q = {
    update(c) { log.push(["update", c]); return q },
    eq(c, v) { log.push(["eq", c, v]); return q },
    or(f) { log.push(["or", f]); return q },
    select(c) { log.push(["select", c]); return Promise.resolve({ data: filas, error }) },
  }
  return { log, from(t) { log.push(["from", t]); return q } }
}

test("cancelarPedido: solo pedidos abiertos, con el motivo de Despacho", async () => {
  const sb = sbDoble([{ id: "p1" }])
  assert.deepEqual(await A.cancelarPedido(sb, "p1", { cierre_motivo_tipo: "lluvia", cierre_motivo: "x" }), { error: null })
  assert.deepEqual(sb.log, [
    ["from", "scheduled_dispatches"],
    ["update", { status: "cancelled", cierre_motivo_tipo: "lluvia", cierre_motivo: "x" }],
    ["eq", "id", "p1"],
    ["or", "status.is.null,status.not.in.(cancelled,completed)"],
    ["select", "id"],
  ])
})

test("cancelarPedido: si ya estaba completo o cancelado no cancela y lo dice", async () => {
  const r = await A.cancelarPedido(sbDoble([]), "p1")
  assert.match(r.error, /ya está completo o cancelado/)
  const r2 = await A.cancelarPedido(sbDoble(null, { message: "sin red" }), "p1")
  assert.equal(r2.error, "sin red")
})

test("cambiosQueRearman: cambiar la planta rearma los viajes", () => {
  const antes = { plant_id: "canning", quantity_m3: 16, construction_site_id: "o1" }
  assert.deepEqual(V.cambiosQueRearman(antes, { plant_id: "hudson", quantity_m3: 16, construction_site_id: "o1" }), ["planta"])
  assert.deepEqual(V.cambiosQueRearman(antes, { plant_id: "canning", quantity_m3: 16, construction_site_id: "o1" }), [])
  // Sin la planta en lo nuevo, como antes
  assert.deepEqual(V.cambiosQueRearman(antes, { quantity_m3: 24 }), ["cantidad"])
})
