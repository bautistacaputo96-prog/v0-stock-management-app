// Pruebas del aviso del pedido sin fibra (lib/fibra-aviso.ts): al guardar en Programación un pedido sin fibra, si los
// últimos pedidos de la obra fueron todos con fibra, se pregunta antes de guardar. Sin base ni red.
import { test } from "node:test"
import assert from "node:assert/strict"
import * as A from "../fibra-aviso.ts"

const dia = (d, h = 8) => new Date(Date.UTC(2026, 10, d, h)).toISOString()
const ped = (id, fibra, d, o = {}) => ({ id, status: "scheduled", fiber_kg_per_m3: fibra, scheduled_arrival_time: dia(d), created_at: dia(d - 1), ...o })
const cinco = [ped("a", 0.8, 20), ped("b", 0.8, 19), ped("c", "0.800", 18), ped("d", 0.8, 17), ped("e", 0.8, 16)]

test("5 pedidos anteriores con 0,8 y este sin fibra → avisa con el texto y el botón", () => {
  const r = A.avisoPedidoSinFibra({ kgM3Actual: "", previos: cinco })
  assert.equal(r.cantidad, 5)
  assert.equal(r.kgM3, 0.8)
  assert.equal(r.todosIguales, true)
  assert.equal(r.texto, "¿Estás seguro? Los últimos 5 pedidos de esta obra fueron con fibra (0,8 kg/m³ = 1 bolsita por m³). Este va sin fibra.")
  assert.equal(r.botonAgregar, "Agregar fibra (0,8 kg/m³)")
})

test("el pedido con fibra guarda sin preguntar", () => {
  assert.equal(A.avisoPedidoSinFibra({ kgM3Actual: "0,8", previos: cinco }), null)
  assert.equal(A.avisoPedidoSinFibra({ kgM3Actual: 1.2, previos: cinco }), null)
})

test("0 o vacío cuenta como sin fibra", () => {
  assert.ok(A.avisoPedidoSinFibra({ kgM3Actual: "0", previos: cinco }))
  assert.ok(A.avisoPedidoSinFibra({ kgM3Actual: null, previos: cinco }))
})

test("sin pedidos previos, o con uno solo, no avisa", () => {
  assert.equal(A.avisoPedidoSinFibra({ kgM3Actual: "", previos: [] }), null)
  assert.equal(A.avisoPedidoSinFibra({ kgM3Actual: "", previos: null }), null)
  assert.equal(A.avisoPedidoSinFibra({ kgM3Actual: "", previos: [ped("a", 0.8, 20)] }), null)
})

test("con 2 pedidos con fibra avisa y el texto usa la cantidad real", () => {
  const r = A.avisoPedidoSinFibra({ kgM3Actual: "", previos: [ped("a", 1.6, 20), ped("b", 1.6, 19)] })
  assert.equal(r.cantidad, 2)
  assert.match(r.texto, /^¿Estás seguro\? Los últimos 2 pedidos de esta obra fueron con fibra \(1,6 kg\/m³ = 2 bolsitas por m³\)\./)
})

test("si alguno de los últimos fue sin fibra, no avisa", () => {
  const previos = [ped("a", 0.8, 20), ped("b", null, 19), ped("c", 0.8, 18)]
  assert.equal(A.avisoPedidoSinFibra({ kgM3Actual: "", previos }), null)
  assert.equal(A.avisoPedidoSinFibra({ kgM3Actual: "", previos: [ped("a", 0.8, 20), ped("b", 0, 19)] }), null)
})

test("solo cuentan los últimos 5: un pedido viejo sin fibra no frena el aviso", () => {
  const r = A.avisoPedidoSinFibra({ kgM3Actual: "", previos: [...cinco, ped("viejo", null, 1)] })
  assert.equal(r.cantidad, 5)
})

test("ordena por fecha programada (y, si empata, por fecha de carga) aunque lleguen desordenados", () => {
  // El más nuevo sin fibra: no avisa aunque venga último en la lista
  const previos = [ped("b", 0.8, 10), ped("c", 0.8, 9), ped("d", 0.8, 8), ped("e", 0.8, 7), ped("f", 0.8, 6), ped("nuevo", null, 21)]
  assert.equal(A.avisoPedidoSinFibra({ kgM3Actual: "", previos }), null)
  const mismaHora = [ped("x", 0.8, 5, { created_at: dia(1) }), ped("y", 1.2, 5, { created_at: dia(2) })]
  assert.deepEqual(A.ultimosPedidosFibra(mismaHora).map((p) => p.id), ["y", "x"])
})

test("no cuenta los cancelados ni el pedido que se está editando", () => {
  const previos = [ped("editado", null, 22), ped("cancelado", null, 21, { status: "cancelled" }), ped("a", 0.8, 20), ped("b", 0.8, 19)]
  const r = A.avisoPedidoSinFibra({ kgM3Actual: "", previos, excluirId: "editado" })
  assert.equal(r.cantidad, 2)
  // Editando un pedido de una obra con un solo pedido más: no avisa
  assert.equal(A.avisoPedidoSinFibra({ kgM3Actual: "", previos: [ped("editado", 0.8, 22), ped("a", 0.8, 20)], excluirId: "editado" }), null)
})

test("kg/m³ sugerido: el más repetido; empate, el más reciente", () => {
  const r = A.avisoPedidoSinFibra({ kgM3Actual: "", previos: [ped("a", 1.2, 20), ped("b", 0.8, 19), ped("c", 0.8, 18), ped("d", 1.2, 17), ped("e", 0.8, 16)] })
  assert.equal(r.kgM3, 0.8)
  assert.equal(r.todosIguales, false)
  assert.match(r.texto, /fueron con fibra \(la más usada: 0,8 kg\/m³ = 1 bolsita por m³\)/)
  assert.equal(A.kgM3MasUsado([1.2, 0.8, 0.8, 1.2]), 1.2) // empate 2 a 2: gana el más reciente
  assert.equal(A.kgM3MasUsado([0.8, 1.2]), 0.8)
  assert.equal(A.kgM3MasUsado([]), 0)
})

test("sin obra: el texto habla del cliente con la fórmula", () => {
  const r = A.avisoPedidoSinFibra({ kgM3Actual: "", previos: cinco.slice(0, 3), porObra: false })
  assert.equal(r.texto, "¿Estás seguro? Los últimos 3 pedidos de este cliente con esta fórmula fueron con fibra (0,8 kg/m³ = 1 bolsita por m³). Este va sin fibra.")
})

test("dosificación que no da bolsitas enteras", () => {
  const r = A.avisoPedidoSinFibra({ kgM3Actual: "", previos: [ped("a", 1, 20), ped("b", 1, 19)] })
  assert.equal(r.botonAgregar, "Agregar fibra (1 kg/m³)")
  assert.match(r.texto, /\(1 kg\/m³ = 1,25 bolsitas por m³\)/)
})
