// Pruebas de la vista Día unificada, el mail del armado y el resumen para WhatsApp
// (docs/specs/2026-11-05-dia-unificado-y-mail.md, punto 7). Corren con TZ=UTC y con TZ=America/Argentina/Buenos_Aires
// (npm run test:armado): el resultado tiene que ser el mismo. Sin base ni red.
import { test } from "node:test"
import assert from "node:assert/strict"
import * as D from "../reparto-dia.ts"
import * as R from "../reparto.ts"
import * as A from "../programacion-acciones.ts"

const CAN = "can", HUD = "hud"
const FECHA = "2026-11-05"
const ar = (hhmm, fecha = FECHA) => new Date(`${fecha}T${hhmm}:00-03:00`).toISOString()

// Datos fijos de 3.7: Canning (carga 15, espera 10, directo 30, bomba 38), Hudson (carga 10, espera 22, directo 43,
// bomba 45), ida 30, traslado 50, 8 m³ por camión; 3 camiones
const fila = (id, o) => ({ id, jornada_inicio: "07:00", jornada_fin: "18:00", bocas_carga: 1, t_lavado_min: 0, tolerancia_puntualidad_min: 15, ...o })
const PLANT_ROWS = [
  fila(CAN, { name: "Canning", t_carga_min: 15, t_descarga_directa_min: 30, t_descarga_bomba_min: 38, tiempos_a_mano: { espera_planta_min: 10 } }),
  fila(HUD, { name: "Hudson", t_carga_min: 10, t_descarga_directa_min: 43, t_descarga_bomba_min: 45, tiempos_a_mano: { espera_planta_min: 22 } }),
]
const ped = (id, obra, plant, m3, hhmm, met, o = {}) => ({
  id, plant_id: plant, quantity_m3: m3, dispatched_m3: 0, scheduled_arrival_time: ar(hhmm), metodo_descarga: met, status: "scheduled",
  viaje_min: 30, m3_por_viaje: 8, clients: { name: `Cliente ${obra}` }, construction_sites: { id: `o-${id}`, name: obra, travel_time_minutes: 30, gps_lat: -34 }, ...o,
})
const PEDIDOS = [ped("sr", "Santa Rita", CAN, 40, "07:45", "directo"), ped("gv", "Greenville", HUD, 40, "08:20", "bomba"), ped("pa", "Pampero", CAN, 60, "13:00", "bomba")]
const mixer = (id) => ({ id, license_plate: id, capacity_m3: 8, active: true, status: "available" })
const sinReparto = { disponible: true, reparto: null, origen: null, actualizadoPor: null, actualizado: null }
const datos = (o = {}) => ({
  fecha: FECHA, base: D.limitesDia(FECHA).base, plants: [{ id: CAN, name: "Canning" }, { id: HUD, name: "Hudson" }], plantRows: PLANT_ROWS,
  mixers: ["AE402HE", "AF431GU", "AG083GT"].map(mixer), pedidosHoy: PEDIDOS, pedidosManana: [], viajes: {}, tiempos: null,
  guardado: sinReparto, ayer: sinReparto, traslado: { disponible: true, fila: { plant_a: CAN, plant_b: HUD, minutos: 50, km: null, litros: null } },
  ...o,
})
const corto = (f) => ({ nombre: f.nombre, planta: f.planta, llegada: f.llegada, sale: f.sale, metodo: f.metodo, viajes: f.viajes, camiones: f.camiones.n, comienza: f.comienza, termina: f.termina, estado: f.estado, atrasoMin: f.atrasoMin })

// ── Fase A ──
test("vista Día · ejemplo de 3.7 con 3 camiones: filas en orden de primera carga y valores fijados", () => {
  const v = D.armarVistaDia(datos())
  assert.deepEqual(v.filas.map(corto), [
    { nombre: "Santa Rita", planta: "Canning", llegada: "07:45", sale: "07:15", metodo: "directo", viajes: 5, camiones: 1, comienza: "07:00", termina: "15:55", estado: "5 h 40 min tarde (directo)", atrasoMin: 340 },
    { nombre: "Greenville", planta: "Hudson", llegada: "08:20", sale: "07:50", metodo: "bomba", viajes: 5, camiones: 2, comienza: "07:40", termina: "13:39", estado: "1 h 34 min tarde (bomba)", atrasoMin: 94 },
    { nombre: "Pampero", planta: "Canning", llegada: "13:00", sale: "12:30", metodo: "bomba", viajes: 8, camiones: 3, comienza: "13:37", termina: "20:20", estado: "2 h 35 min tarde (bomba)", atrasoMin: 155 },
  ])
  assert.equal(v.camiones.length, 3)
  assert.equal(v.numeros, "3 pedidos · 140 m³ · 18 viajes · primera carga 07:00 · última vuelta 20:50")
})

test("filasPedidos: comienza = primera carga, termina = fin de la última descarga (no la vuelta), atrasoMin", () => {
  const v = D.armarVistaDia(datos())
  for (const f of v.filas) {
    const r = v.resultado.pedidos.find((x) => x.id === f.id)
    assert.equal(f.comienza, R.horaArgentina(new Date(v.base + Math.min(...r.viajes.map((x) => x.inicioCarga)) * 60000).toISOString()))
    assert.equal(f.termina, R.horaArgentina(new Date(v.base + r.medida.fin * 60000).toISOString()))
    assert.notEqual(f.termina, R.horaArgentina(new Date(v.base + Math.max(...r.viajes.map((x) => x.vuelta)) * 60000).toISOString()))
  }
  // a tiempo → 0; sin camión → null; solo cortes sin demora → 0 y no a tiempo
  const res = (o) => ({ pedidos: [{ id: "x", obra: "X", plantId: CAN, conBomba: false, alcanza: false, viajes: [{ inicioCarga: 420 }], camiones: ["c"], medida: { fin: 600, finIdeal: 600, cortes: [25], maxCorte: 25, demora: 0 }, finJornada: 1080, ...o }], viajes: [] })
  const p = [{ id: "x", plant_id: CAN, quantity_m3: 8, scheduled_arrival_time: ar("08:00"), viaje_min: 30 }]
  const plantas = [{ id: CAN, nombre: "Canning", prm: {} }]
  assert.deepEqual([R.filasPedidos(res({}), p, plantas, {})[0].atrasoMin, R.filasPedidos(res({}), p, plantas, {})[0].aTiempo], [0, false])
  assert.equal(R.filasPedidos(res({ alcanza: true, medida: { fin: 610, finIdeal: 600, cortes: [], maxCorte: 0, demora: 10 } }), p, plantas, {})[0].atrasoMin, 0)
  assert.equal(R.filasPedidos(res({ viajes: [], camiones: [] }), p, plantas, {})[0].atrasoMin, null)
})

test("ajustes sin guardar: Pampero a las 14:00 en memoria = guardado a las 14:00; volver a 13:00 = sin ajustes; Santa Rita a bomba", () => {
  const base = D.armarVistaDia(datos())
  const enMemoria = D.armarVistaDia(datos(), { ajustes: { pa: { hora: "14:00" } } })
  const guardado = D.armarVistaDia(datos({ pedidosHoy: PEDIDOS.map((p) => (p.id === "pa" ? { ...p, scheduled_arrival_time: ar("14:00") } : p)) }))
  assert.deepEqual(enMemoria.filas.map(corto), guardado.filas.map(corto))
  assert.equal(enMemoria.filas.find((f) => f.id === "pa").llegada, "14:00")
  assert.notDeepEqual(enMemoria.filas.map(corto), base.filas.map(corto))
  assert.deepEqual(D.armarVistaDia(datos(), { ajustes: {} }).filas.map(corto), base.filas.map(corto))
  const bomba = D.armarVistaDia(datos(), { ajustes: { sr: { metodo: "bomba" } } })
  const sr = bomba.resultado.pedidos.find((x) => x.id === "sr")
  assert.equal(bomba.filas.find((f) => f.id === "sr").metodo, "bomba")
  assert.equal(Math.round(sr.viajes[0].finDescarga - sr.viajes[0].llegada), 38) // descarga con bomba de Canning por 8 m³
})

test("lo que se ve es lo que se guarda: con el reparto de la sugerencia (sin guardar o guardado) da lo mismo", () => {
  for (const mixers of [["AE402HE", "AF431GU", "AG083GT"], ["CRN449", "LES431", "AE402HE", "AF431GU", "AG083GT"]]) {
    const sinGuardar = D.armarVistaDia(datos({ mixers: mixers.map(mixer) }))
    // Guardado tal cual (origen sugerido): al volver a leer, la tabla es la misma
    const v = D.armarVistaDia(datos({ mixers: mixers.map(mixer), guardado: { ...sinReparto, reparto: sinGuardar.sugerido, origen: "sugerido" } }))
    assert.deepEqual(v.filas.map(corto), sinGuardar.filas.map(corto))
    for (const s of v.sugerencia.pedidos) {
      const r = v.resultado.pedidos.find((x) => x.id === s.id)
      assert.deepEqual([...r.camiones].sort(), [...s.camiones].sort(), `${s.obra} (${mixers.length} camiones)`)
      assert.equal(Math.round(r.medida.fin), Math.round(s.medida.fin))
    }
  }
})

test("Guardar y confirmar: viajes de las dos plantas, reparto vigente, confirma pendientes ajustables; texto del cartel", () => {
  const v = D.armarVistaDia(datos({ pedidosHoy: PEDIDOS.map((p) => (p.id === "gv" ? { ...p, suspendido_at: ar("06:00") } : p)) }))
  const pedidos = v.pedidos.map((p) => ({ ...p, nombre: v.filas.find((f) => f.id === p.id).nombre }))
  const plan = A.planGuardarYConfirmar({
    tituloDia: "jueves 05/11", pedidos, ajustes: { pa: { hora: "14:00" } }, resultado: v.resultado, viajesGuardados: {},
    vigente: v.vigente, guardado: null, repartoDisponible: true, origen: "sugerido", puedeAjustar: () => true,
  })
  assert.deepEqual(plan.viajes.map((x) => x.pedido.id).sort(), ["gv", "pa", "sr"]) // Canning y Hudson
  assert.equal(plan.viajes.find((x) => x.pedido.id === "gv").nuevos, v.resultado.pedidos.find((x) => x.id === "gv").filas)
  assert.equal(plan.reparto.reparto, v.vigente)
  assert.deepEqual(plan.horas.map((h) => [h.pedido.id, h.hora]), [["pa", "14:00"]])
  assert.deepEqual(plan.confirmar.map((p) => p.id), ["sr", "pa"]) // Greenville suspendido
  assert.equal(plan.titulo, "Guardar y confirmar el jueves 05/11.")
  assert.equal(plan.texto, "Se guarda 1 hora cambiados, el reparto de las dos plantas y los viajes de 3 pedidos y se confirman 2 (Santa Rita y Pampero).")
  // Sin cambios de reparto (igual a lo guardado) no se guarda el reparto; sin permiso no se confirma ni se cambia la hora
  const sinRep = A.planGuardarYConfirmar({ tituloDia: "jueves 05/11", pedidos, ajustes: { pa: { hora: "14:00" } }, resultado: v.resultado, viajesGuardados: {}, vigente: v.vigente, guardado: v.vigente, repartoDisponible: true, origen: "sugerido", puedeAjustar: () => false })
  assert.equal(sinRep.reparto, null); assert.deepEqual(sinRep.confirmar, []); assert.deepEqual(sinRep.horas, [])
  // Ya confirmados: no se vuelven a confirmar
  const conf = A.planGuardarYConfirmar({ tituloDia: "x", pedidos: pedidos.map((p) => ({ ...p, confirmado_at: ar("10:00") })), ajustes: {}, resultado: v.resultado, viajesGuardados: {}, vigente: v.vigente, guardado: null, repartoDisponible: false, origen: "sugerido", puedeAjustar: () => true })
  assert.deepEqual(conf.confirmar, []); assert.equal(conf.reparto, null)
})

test("leerDatosDia: los límites del día en hora de Argentina, con cualquier TZ", async () => {
  const llamadas = []
  const builder = (tabla) => {
    const q = new Proxy({}, {
      get: (_, k) => {
        if (k === "then") return (ok) => ok({ data: [], error: null })
        return (...args) => { llamadas.push([tabla, k, ...args]); return q }
      },
    })
    return q
  }
  const sb = { from: (t) => builder(t), rpc: () => Promise.resolve({ data: null, error: null }) }
  const d = await D.leerDatosDia(sb, FECHA, [{ id: CAN, name: "Canning" }, { id: HUD, name: "Hudson" }])
  const ped = llamadas.filter((x) => x[0] === "scheduled_dispatches")
  assert.ok(ped.some((x) => x[1] === "gte" && x[3] === "2026-11-05T03:00:00.000Z"))
  assert.ok(ped.some((x) => x[1] === "lt" && x[3] === "2026-11-06T03:00:00.000Z"))
  assert.ok(ped.some((x) => x[1] === "lt" && x[3] === "2026-11-07T03:00:00.000Z"))
  assert.ok(llamadas.some((x) => x[0] === "reparto_camiones" && x[1] === "eq" && x[3] === "2026-11-04")) // el día anterior
  assert.equal(d.base, Date.parse("2026-11-05T03:00:00.000Z"))
  assert.equal(D.sumarDias("2026-11-01", -1), "2026-10-31")
})
