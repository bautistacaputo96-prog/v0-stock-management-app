// Pruebas del aviso de cantidad rara al cargar o editar un ingreso de MP (lib/ingresos/validar.ts, avisoCantidadRara):
// mediana de los últimos ingresos del material (del proveedor si tiene ≥ 3), límites 60% / 150%, sin historial no
// avisa y el de "¿Son toneladas?" va primero. Caso real: remito 885580 de piedra 6/20 con 3.046 kg (Guerrico ~30.400).
import { test } from "node:test"
import assert from "node:assert/strict"
import * as V from "../ingresos/validar.ts"

const piedra = { name: "Piedra 6/20", tipo: "arido_grueso", unit: "kg" }
const aditivo = { name: "Aditivo X", tipo: "aditivo", unit: "L" }
const guerrico = (kg) => ({ kg, supplier_id: "guerrico" })
const otro = (kg) => ({ kg, supplier_id: "otro" })
const camiones = [30380, 30420, 30400, 30500, 30300, 30440].map(guerrico)

test("caso real: 3.046 kg de piedra 6/20 cuando Guerrico trae ~30.400", () => {
  const a = V.avisoCantidadRara(piedra, 3046, camiones, "guerrico")
  assert.ok(a)
  assert.equal(a.titulo, "¿Estás seguro?")
  assert.equal(a.texto, "Los últimos ingresos de Piedra 6/20 fueron de unos 30.400 kg (30,4 t). Cargaste 3.046 kg.")
  assert.equal(a.tipo, "menos")
  assert.equal(a.referencia, 30410)
})

test("dentro de los límites no avisa; afuera sí (60% y 150% de la mediana)", () => {
  const h = [10000, 10000, 10000].map(guerrico)
  assert.equal(V.avisoCantidadRara(piedra, 10000, h, "guerrico"), null)
  assert.equal(V.avisoCantidadRara(piedra, 6000, h, "guerrico"), null)
  assert.equal(V.avisoCantidadRara(piedra, 15000, h, "guerrico"), null)
  assert.equal(V.avisoCantidadRara(piedra, 5999, h, "guerrico").tipo, "menos")
  const mas = V.avisoCantidadRara(piedra, 15001, h, "guerrico")
  assert.equal(mas.tipo, "mas")
  assert.match(mas.texto, /unos 10\.000 kg \(10 t\)\. Cargaste 15\.001 kg\.$/)
  assert.deepEqual(V.CANTIDAD_RARA, { ultimos: 10, minimo: 3, menorQue: 0.6, mayorQue: 1.5 })
})

test("sin historial suficiente (menos de 3 ingresos) no avisa", () => {
  assert.equal(V.avisoCantidadRara(piedra, 3046, [], "guerrico"), null)
  assert.equal(V.avisoCantidadRara(piedra, 3046, [guerrico(30400), otro(30000)], "guerrico"), null)
  // Los en 0 (anulados) no cuentan
  assert.equal(V.avisoCantidadRara(piedra, 3046, [guerrico(30400), guerrico(0), guerrico(30000)], "guerrico"), null)
})

test("con ≥ 3 del proveedor usa solo los suyos; si no, los del material", () => {
  // El proveedor chico trae 10 t; los demás 30 t
  const h = [otro(30000), guerrico(10000), otro(30000), guerrico(10000), otro(30000), guerrico(10000), otro(30000)]
  assert.equal(V.referenciaCantidad(h, "guerrico").delProveedor, true)
  assert.equal(V.referenciaCantidad(h, "guerrico").mediana, 10000)
  assert.equal(V.avisoCantidadRara(piedra, 10000, h, "guerrico"), null)
  // Con 2 del proveedor: mediana del material
  const h2 = h.slice(0, 5)
  const r = V.referenciaCantidad(h2, "guerrico")
  assert.equal(r.delProveedor, false)
  assert.equal(r.mediana, 30000)
  // Sin proveedor elegido: del material
  assert.equal(V.referenciaCantidad(h, null).delProveedor, false)
})

test("solo los últimos 10 (vienen del más nuevo al más viejo)", () => {
  const h = [...Array(10).fill(guerrico(30000)), ...Array(20).fill(guerrico(5000))]
  const r = V.referenciaCantidad(h, "guerrico")
  assert.equal(r.n, 10)
  assert.equal(r.mediana, 30000)
})

test("mediana: no la mueve un camión raro del historial (uno cargado en toneladas)", () => {
  const h = [30400, 30.4, 30300, 30500, 30200].map(guerrico)
  assert.equal(V.referenciaCantidad(h, "guerrico").mediana, 30300)
  // Par: promedio de los dos del medio
  assert.equal(V.referenciaCantidad([1000, 2000, 3000, 4000].map(otro), null).mediana, 2500)
})

test("si aplica el de toneladas, ese va primero (no dos carteles)", () => {
  assert.ok(V.avisoToneladas(piedra, 30.4))
  assert.equal(V.avisoCantidadRara(piedra, 30.4, camiones, "guerrico"), null)
  // Desde 200 kg ya no es el de toneladas: salta el de cantidad rara
  assert.equal(V.avisoToneladas(piedra, 304), null)
  assert.ok(V.avisoCantidadRara(piedra, 304, camiones, "guerrico"))
})

test("otras unidades: sin toneladas; redondeo de la referencia", () => {
  const a = V.avisoCantidadRara(aditivo, 100, [1000, 1000, 1000].map(otro), "otro")
  assert.equal(a.texto, "Los últimos ingresos de Aditivo X fueron de unos 1.000 L. Cargaste 100 L.")
  const b = V.avisoCantidadRara(piedra, 300, [1234, 1236, 1240].map(otro), "otro")
  assert.match(b.texto, /unos 1\.240 kg \(1,2 t\)/)
  const c = V.avisoCantidadRara({ name: "Fibra", tipo: "fibra", unit: "kg" }, 20, [123, 123, 123].map(otro), null)
  assert.match(c.texto, /unos 123 kg \(0,1 t\)\. Cargaste 20 kg\./)
})

test("cantidad vacía, 0 o sin material: no avisa", () => {
  assert.equal(V.avisoCantidadRara(piedra, NaN, camiones, "guerrico"), null)
  assert.equal(V.avisoCantidadRara(piedra, 0, camiones, "guerrico"), null)
  assert.equal(V.avisoCantidadRara(null, 3046, camiones, "guerrico"), null)
})
