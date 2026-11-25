// Pruebas del módulo de mantenimiento (auditoría 23/11/2026):
// paginado contra el tope de 1000 filas, m³ desde la última ejecución en hora argentina
// y completar una orden sin pisar ni duplicar.
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  traerTodas, calcularM3, ultimaEjecucionPorTarea, diaArgentina, proximoVencimiento, completarOrden,
  salteosPorTarea, vencimientoConSalteo, sincronizarOrdenes, pendienteInicio,
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

// ── Cancelar una preventiva saltea ese vencimiento (auditoría 24/11: al recargar se volvía a generar) ──
/** "yyyy-MM-dd" de hace n días (hora local, como proximoVencimiento) */
const hace = (n) => {
  const d = new Date(Date.now() - 86400000 * n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
const diasHasta = (fecha) => Math.round((fecha.getTime() - new Date(`${hace(0)}T00:00:00`).getTime()) / 86400000)
const mensual = { id: "m", titulo: "Engrase", frecuencia_dias: 30, frecuencia_m3: null }
const ot = (extra) => ({ id: "o", numero: 1, equipment_id: "e", task_id: "m", tipo: "preventiva", estado: "cancelada", completado_por: "Braian", ...extra })
const ejec = (fecha) => ({ task_id: "m", fecha, realizado_por: "Titan", m3_acumulado: 0 })

test("salteosPorTarea: la última preventiva cancelada después de la última ejecución, con el día de la cancelación", () => {
  const ultima = { m: ejec(hace(40)) }
  const s = salteosPorTarea([
    ot({ id: "vieja", fecha_programada: hace(50), fecha_fin: `${hace(48)}T15:00:00Z` }), // antes de la ejecución: no cuenta
    ot({ id: "a", fecha_programada: hace(10), fecha_fin: `${hace(9)}T15:00:00Z` }),
    ot({ id: "b", fecha_programada: hace(10), fecha_fin: `${hace(2)}T15:00:00Z` }),
    ot({ id: "c", estado: "completada", fecha_programada: hace(10), fecha_fin: `${hace(1)}T15:00:00Z` }),
    ot({ id: "d", tipo: "correctiva", fecha_programada: hace(10), fecha_fin: `${hace(1)}T15:00:00Z` }),
  ], ultima)
  assert.deepEqual(Object.keys(s), ["m"])
  assert.equal(s.m.fecha, hace(2))
  assert.equal(s.m.realizado_por, "Braian")
  // Cancelada a las 22:30 en Argentina (01:30 UTC del día siguiente): cuenta el día argentino
  assert.equal(salteosPorTarea([ot({ fecha_programada: "2026-11-20", fecha_fin: "2026-11-23T01:30:00Z" })], {}).m.fecha, "2026-11-22")
  // Una cancelada vieja ya no saltea nada después de una ejecución nueva
  assert.deepEqual(salteosPorTarea([ot({ fecha_programada: hace(10), fecha_fin: `${hace(9)}T15:00:00Z` })], { m: ejec(hace(5)) }), {})
})

test("vencimientoConSalteo: vencida hace 10 días y cancelada hoy → la próxima del plan (en 20 días), sin fingir que se hizo", () => {
  const ultima = ejec(hace(40))
  assert.ok(proximoVencimiento(mensual, ultima, 0).fecha < new Date(), "sin salteo sigue vencida")
  const v = vencimientoConSalteo(mensual, ultima, { ...ejec(hace(0)), m3_acumulado: null }, 0)
  assert.equal(v.salteada, true)
  assert.equal(diasHasta(v.fecha), 20)
  // Sin salteo, igual que proximoVencimiento
  assert.deepEqual(vencimientoConSalteo(mensual, ultima, undefined, 0).fecha, proximoVencimiento(mensual, ultima, 0).fecha)
})

test("vencimientoConSalteo: cancelada el mismo día que vence → el vencimiento siguiente; nunca hecha → cancelación + frecuencia", () => {
  const v = vencimientoConSalteo(mensual, ejec(hace(30)), { ...ejec(hace(0)), m3_acumulado: null }, 0)
  assert.equal(diasHasta(v.fecha), 30)
  const n = vencimientoConSalteo(mensual, undefined, { ...ejec(hace(3)), m3_acumulado: null }, 0)
  assert.equal(diasHasta(n.fecha), 27)
})

test("vencimientoConSalteo: pasado el ciclo salteado, la próxima vuelve a vencer", () => {
  // Vencía hace 40 días, se canceló hace 38: el vencimiento siguiente (hace 10 días) ya pasó
  const v = vencimientoConSalteo(mensual, ejec(hace(70)), { ...ejec(hace(38)), m3_acumulado: null }, 0)
  assert.equal(diasHasta(v.fecha), -10)
})

test("vencimientoConSalteo por m³: cuenta los m³ desde la cancelación", () => {
  const anual = { id: "m", titulo: "Reductor", frecuencia_dias: 365, frecuencia_m3: 15000 }
  const despachos = [
    { quantity_m3: 20000, dispatch_date: `${hace(20)}T15:00:00Z` }, // venció por m³ y se canceló
    { quantity_m3: 1000, dispatch_date: `${hace(1)}T15:00:00Z` }, // después de la cancelación
  ]
  const ultimas = { m: ejec(hace(30)) }
  const { m3Actual, ultimaPorTarea } = calcularM3(despachos, ultimas)
  assert.equal(proximoVencimiento(anual, ultimaPorTarea.m, m3Actual).porM3, true)
  const salteo = calcularM3(despachos, salteosPorTarea([ot({ fecha_programada: hace(15), fecha_fin: `${hace(10)}T15:00:00Z` })], ultimas)).ultimaPorTarea
  const v = vencimientoConSalteo(anual, ultimaPorTarea.m, salteo.m, m3Actual)
  assert.equal(v.porM3, false)
  assert.equal(Math.round(v.restanM3), 14000)
  assert.equal(diasHasta(v.fecha), 335, "por días sigue el plan: ejecución + 365")
  // Con 15.000 m³ más después de la cancelación, vence de nuevo por m³
  const mas = [...despachos, { quantity_m3: 14500, dispatch_date: new Date().toISOString() }]
  const r = calcularM3(mas, ultimas)
  const s2 = calcularM3(mas, salteosPorTarea([ot({ fecha_programada: hace(15), fecha_fin: `${hace(10)}T15:00:00Z` })], ultimas)).ultimaPorTarea
  assert.equal(vencimientoConSalteo(anual, r.ultimaPorTarea.m, s2.m, r.m3Actual).porM3, true)
})

test("sincronizarOrdenes: una preventiva cancelada no se vuelve a generar al recargar; las demás vencidas sí", async () => {
  const insertadas = []
  const sb = { from: () => ({ insert: (v) => { insertadas.push(v); return Promise.resolve({ error: null }) } }) }
  const otra = { ...mensual, id: "x", titulo: "Otra" }
  const tareas = [mensual, otra]
  const ultimaPorTarea = { m: ejec(hace(40)), x: { ...ejec(hace(40)), task_id: "x" } }
  const ordenes = [ot({ fecha_programada: hace(10), fecha_fin: new Date().toISOString() })]
  const salteos = calcularM3([], salteosPorTarea(ordenes, ultimaPorTarea)).ultimaPorTarea
  const n = await sincronizarOrdenes(sb, "e", tareas, ultimaPorTarea, 0, ordenes, salteos)
  assert.equal(n, 1)
  assert.deepEqual(insertadas.map((o) => o.task_id), ["x"])
  // Sin los salteos (como antes) se generaba otra vez
  insertadas.length = 0
  await sincronizarOrdenes(sb, "e", tareas, ultimaPorTarea, 0, ordenes)
  assert.deepEqual(insertadas.map((o) => o.task_id).sort(), ["m", "x"])
})

test("pendienteInicio (cuadrito del Inicio): sin salteo como antes; cancelada = salteada con la próxima fecha, no 'Vencida'", () => {
  const ultima = ejec(hace(40))
  assert.deepEqual(pendienteInicio(mensual, ultima, undefined, 0, 30), { nivel: "vencida", texto: "Vencida hace 10 d" })
  assert.deepEqual(pendienteInicio(mensual, undefined, undefined, 0, 30), { nivel: "pendiente", texto: "Sin registro" })
  assert.equal(pendienteInicio(mensual, ejec(hace(0)), undefined, 0, 7), null, "al día")
  // Cancelada hoy: la próxima del plan es en 20 días
  const salteo = { ...ejec(hace(0)), m3_acumulado: 0 }
  assert.deepEqual(pendienteInicio(mensual, ultima, salteo, 0, 30), { nivel: "proxima", texto: "Salteada · En 20 días" })
  assert.equal(pendienteInicio(mensual, ultima, salteo, 0, 7), null)
  // Nunca hecha y cancelada: no queda "Sin registro"
  assert.deepEqual(pendienteInicio(mensual, undefined, { ...ejec(hace(3)), m3_acumulado: 0 }, 0, 30), { nivel: "proxima", texto: "Salteada · En 27 días" })
  // Pasado el ciclo salteado vuelve a estar vencida
  assert.deepEqual(pendienteInicio(mensual, ejec(hace(70)), { ...ejec(hace(38)), m3_acumulado: 0 }, 0, 30), { nivel: "vencida", texto: "Salteada · Vencida hace 10 d" })
  // Por m³: cuenta desde la cancelación
  const anual = { frecuencia_dias: 365, frecuencia_m3: 15000 }
  assert.equal(pendienteInicio(anual, { ...ejec(hace(30)), m3_acumulado: 0 }, { ...ejec(hace(5)), m3_acumulado: 20000 }, 21000, 30), null)
  assert.deepEqual(pendienteInicio(anual, { ...ejec(hace(30)), m3_acumulado: 0 }, { ...ejec(hace(5)), m3_acumulado: 20000 }, 36000, 30), { nivel: "vencida", texto: "Salteada · Vencida por 1000 m³" })
})
