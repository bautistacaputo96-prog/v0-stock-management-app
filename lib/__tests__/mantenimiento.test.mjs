// Pruebas del módulo de mantenimiento (auditoría 23/11/2026):
// paginado contra el tope de 1000 filas, m³ desde la última ejecución en hora argentina
// y completar una orden sin pisar ni duplicar.
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  traerTodas, calcularM3, ultimaEjecucionPorTarea, diaArgentina, proximoVencimiento, completarOrden,
} from "../mantenimiento.ts"

test("traerTodas junta todas las páginas aunque Supabase corte en 1000", async () => {
  const filas = Array.from({ length: 2500 }, (_, i) => ({ i }))
  const pedidos = []
  const todas = await traerTodas(async (desde, hasta) => {
    pedidos.push([desde, hasta])
    return { data: filas.slice(desde, Math.min(hasta + 1, desde + 1000)), error: null }
  })
  assert.equal(todas.length, 2500)
  assert.deepEqual(pedidos, [[0, 999], [1000, 1999], [2000, 2999]])
})

test("traerTodas con exactamente 1000 filas pide una página más (vacía) y corta", async () => {
  const filas = Array.from({ length: 1000 }, (_, i) => i)
  let n = 0
  const todas = await traerTodas(async (desde) => { n++; return { data: filas.slice(desde, desde + 1000), error: null } })
  assert.equal(todas.length, 1000)
  assert.equal(n, 2)
})

test("traerTodas lanza si una página falla (no devuelve datos a medias)", async () => {
  await assert.rejects(
    traerTodas(async (desde) => (desde === 0 ? { data: Array(1000).fill(0), error: null } : { data: null, error: { message: "timeout" } })),
    { message: "timeout" },
  )
})

test("diaArgentina: 22:30 del 22 en Argentina es el 23 en UTC, pero el día es el 22", () => {
  assert.equal(diaArgentina("2026-11-23T01:30:00Z"), "2026-11-22")
  assert.equal(diaArgentina("2026-11-23T03:00:00Z"), "2026-11-23")
})

test("calcularM3: total de todos los despachos y m³ desde el día siguiente a la ejecución", () => {
  const despachos = [
    { quantity_m3: "8", dispatch_date: "2026-11-01T13:00:00Z" },
    { quantity_m3: 7, dispatch_date: "2026-11-23T01:30:00Z" }, // 22/11 22:30 en Argentina
    { quantity_m3: 6, dispatch_date: "2026-11-23T12:00:00Z" }, // 23/11
    { quantity_m3: null, dispatch_date: null },
  ]
  // m3_acumulado guardado viejo (cortado en 1000 despachos): se ignora
  const ultima = { t1: { task_id: "t1", fecha: "2026-11-22", realizado_por: null, m3_acumulado: 123456 } }
  const r = calcularM3(despachos, ultima)
  assert.equal(r.m3Actual, 21)
  // Después del 22/11 solo cuenta el del 23 (6 m³): el de las 22:30 del 22 no
  assert.equal(r.m3Actual - r.ultimaPorTarea.t1.m3_acumulado, 6)
  assert.equal(ultima.t1.m3_acumulado, 123456, "no muta la entrada")
})

test("proximoVencimiento usa los m³ desde la ejecución: vence por m³ aunque falten días", () => {
  const tarea = { id: "t1", frecuencia_dias: 365, frecuencia_m3: 15000 }
  const despachos = [
    { quantity_m3: 9000, dispatch_date: "2025-06-01T15:00:00Z" }, // antes de la ejecución
    { quantity_m3: 15500, dispatch_date: new Date().toISOString() }, // después
  ]
  const hace30 = new Date(Date.now() - 86400000 * 30)
  const fecha = `${hace30.getFullYear()}-${String(hace30.getMonth() + 1).padStart(2, "0")}-${String(hace30.getDate()).padStart(2, "0")}`
  const { m3Actual, ultimaPorTarea } = calcularM3(despachos, { t1: { task_id: "t1", fecha, realizado_por: null, m3_acumulado: 0 } })
  const r = proximoVencimiento(tarea, ultimaPorTarea.t1, m3Actual)
  assert.equal(r.porM3, true)
  assert.equal(Math.round(r.restanM3), -500)
})

test("ultimaEjecucionPorTarea toma la primera (más nueva) de cada tarea", () => {
  const u = ultimaEjecucionPorTarea([
    { task_id: "a", fecha: "2026-11-20" }, { task_id: "b", fecha: "2026-11-10" }, { task_id: "a", fecha: "2026-10-01" },
  ])
  assert.equal(u.a.fecha, "2026-11-20")
  assert.equal(u.b.fecha, "2026-11-10")
})

// ── completarOrden con un Supabase de mentira ──────────────────────────────
function fakeSupabase({ filasTomadas = [{ id: "o1" }], errorUpdate = null, errorInsert = null } = {}) {
  const llamadas = []
  const sb = {
    from(tabla) {
      const c = { tabla, ops: [] }
      llamadas.push(c)
      const b = {
        update(v) { c.ops.push(["update", v]); return b },
        insert(v) { c.ops.push(["insert", v]); return b },
        eq(k, v) { c.ops.push(["eq", k, v]); return b },
        in(k, v) { c.ops.push(["in", k, v]); return b },
        select(v) { c.ops.push(["select", v]); return b },
        then(res, rej) {
          const esUpdate = c.ops[0][0] === "update"
          const conSelect = c.ops.some((o) => o[0] === "select")
          let r
          if (tabla === "maint_work_orders" && esUpdate) r = { data: conSelect ? (errorUpdate ? null : filasTomadas) : null, error: conSelect ? errorUpdate : null }
          else if (tabla === "maint_executions") r = { data: null, error: errorInsert }
          else r = { data: null, error: null }
          return Promise.resolve(r).then(res, rej)
        },
      }
      return b
    },
  }
  return { sb, llamadas }
}

const orden = { id: "o1", task_id: "t1", estado: "en_curso", fecha_inicio: "2026-11-23T11:00:00Z", fecha_fin: null, completado_por: null, observaciones: null, pasos: { p1: true }, m3_acumulado: null }
const datos = { usuario: "Titan", obs: "ok", pasos: { p1: true }, m3Actual: 1000, ahora: new Date("2026-11-23T15:00:00Z") }

test("completarOrden: solo toma la orden si sigue abierta y registra la ejecución", async () => {
  const { sb, llamadas } = fakeSupabase()
  const r = await completarOrden(sb, orden, datos)
  assert.deepEqual(r, { ok: true })
  const upd = llamadas[0]
  assert.deepEqual(upd.ops.find((o) => o[0] === "in"), ["in", "estado", ["pendiente", "en_curso"]])
  assert.equal(llamadas[1].tabla, "maint_executions")
  assert.equal(llamadas[1].ops[0][1].task_id, "t1")
})

test("completarOrden: si otro ya la cerró, no pisa ni duplica la ejecución", async () => {
  const { sb, llamadas } = fakeSupabase({ filasTomadas: [] })
  const r = await completarOrden(sb, orden, datos)
  assert.equal(r.ok, false)
  assert.equal(r.yaCerrada, true)
  assert.equal(llamadas.filter((c) => c.tabla === "maint_executions").length, 0)
})

test("completarOrden: error al grabar avisa (antes decía 'Orden completada' igual)", async () => {
  const { sb, llamadas } = fakeSupabase({ errorUpdate: { message: "sin conexión" } })
  const r = await completarOrden(sb, orden, datos)
  assert.deepEqual(r, { ok: false, mensaje: "sin conexión" })
  assert.equal(llamadas.length, 1)
})

test("completarOrden: si falla la ejecución, la orden vuelve a quedar abierta", async () => {
  const { sb, llamadas } = fakeSupabase({ errorInsert: { message: "falló" } })
  const r = await completarOrden(sb, orden, datos)
  assert.equal(r.ok, false)
  const revertir = llamadas[2]
  assert.equal(revertir.tabla, "maint_work_orders")
  assert.equal(revertir.ops[0][1].estado, "en_curso")
  assert.equal(revertir.ops[0][1].fecha_fin, null)
})

test("completarOrden: correctiva (sin tarea) no crea ejecución", async () => {
  const { sb, llamadas } = fakeSupabase()
  const r = await completarOrden(sb, { ...orden, task_id: null }, datos)
  assert.equal(r.ok, true)
  assert.equal(llamadas.length, 1)
})

test("completarOrden 'Ya estaba hecha': ejecución con la fecha elegida, fin a las 12 de Argentina", async () => {
  const { sb, llamadas } = fakeSupabase()
  await completarOrden(sb, orden, { ...datos, fechaManual: "2026-10-01" })
  assert.equal(llamadas[0].ops[0][1].fecha_fin, "2026-10-01T12:00:00-03:00")
  assert.equal(llamadas[1].ops[0][1].fecha, "2026-10-01")
})
