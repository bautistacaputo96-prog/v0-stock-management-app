// Pruebas del reparto de camiones por planta (docs/specs/2026-11-04-camiones-por-planta.md, puntos 8 y 9):
// el ejemplo del 05/11 completo (pasos 1 a 5 y textos), las reglas de "alcanzan", traslados, reparto editado, viajes
// despachados, boca de carga entre pedidos, dónde duermen, el cronograma del gerenciador y la identidad con main de
// planificar() y planDelDia() sin los parámetros nuevos. Sin base ni red.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import * as R from "../reparto.ts"
import * as P from "../planificador.ts"
import * as V from "../viajes.ts"

const CAN = "can", HUD = "hud"
const DIA = (d) => new Date(2026, 10, d).getTime()
const BASE = DIA(5)
const at = (h, m, d = 5) => new Date(2026, 10, d, h, m).toISOString()
const hh = (m) => P.aHora(Math.round(m))
const hIso = (iso) => { const d = new Date(iso); return P.aHora(d.getHours() * 60 + d.getMinutes()) }

// Datos de prueba fijos del punto 8 (la bomba de Hudson en 45, como dice la especificación; la base no se toca)
const PRM_C = { ...P.PARAMETROS_BASE, cargaMin: 15, lavadoMin: 0, descargaDirectaMin: 30, descargaBombaMin: 38, esperaPlantaMin: 10, inicioJornada: "07:00", finJornada: "18:00", bocasCarga: 1 }
const PRM_H = { ...P.PARAMETROS_BASE, cargaMin: 10, lavadoMin: 0, descargaDirectaMin: 43, descargaBombaMin: 45, esperaPlantaMin: 22, inicioJornada: "07:00", finJornada: "18:00", bocasCarga: 1 }
const PLANTAS = [{ id: CAN, nombre: "Canning", prm: PRM_C }, { id: HUD, nombre: "Hudson", prm: PRM_H }]
const NOMBRES = { [CAN]: "Canning", [HUD]: "Hudson" }
const ped = (id, obra, plant, m3, h, m, met, o = {}, d = 5) => ({
  p: { id, plant_id: plant, quantity_m3: m3, scheduled_arrival_time: at(h, m, d), metodo_descarga: met, viaje_min: 30, construction_sites: { name: obra }, ...o },
  existentes: [], obra,
})
const SANTA_RITA = ped("sr", "Santa Rita", CAN, 40, 7, 45, "directo")
const GREENVILLE = ped("gv", "Greenville", HUD, 40, 8, 20, "bomba")
const PAMPERO = ped("pa", "Pampero", CAN, 60, 13, 0, "bomba")
const cam = (id, amanece) => ({ id, patente: id, capacidad: 8, amanece })
const CAMIONES = [cam("CRN449", CAN), cam("LES431", CAN), cam("AE402HE", HUD), cam("AF431GU", HUD), cam("AG083GT", HUD)]
const PATENTES = Object.fromEntries(CAMIONES.map((c) => [c.id, c.patente]))
const AMANECE = Object.fromEntries(CAMIONES.map((c) => [c.id, c.amanece]))
const TRASLADO = R.trasladoDe({ minutos: 50 })
const ENT = { base: BASE, plantas: PLANTAS, camiones: CAMIONES, pedidos: [SANTA_RITA, GREENVILLE, PAMPERO], traslado: TRASLADO }
const de = (r, id) => r.pedidos.find((x) => x.id === id)

function pedidoPlan(pr, prm) {
  const e = V.entradaPedido(pr.p, pr.existentes, prm)
  return V.pedidoParaPlan(pr.p, e.pendiente, e.llegada + (e.base - BASE) / 60000, pr.obra)
}

// ── Punto 8: el ejemplo del 05/11 ──
test("ejemplo 05/11 · paso 1: Greenville 3 (ideal 4), Pampero 3 (ideal 4), Santa Rita 4", () => {
  const g = R.camionesMinimos(GREENVILLE.p, pedidoPlan(GREENVILLE, PRM_H), PRM_H)
  assert.equal(g.flotaIdeal, 4); assert.equal(g.necesarios, 3)
  const g3 = g.medidas.find((m) => m.n === 3).medida
  assert.deepEqual(g3.cortes, [2]); assert.equal(hh(g3.fin), "12:07"); assert.equal(hh(g3.finIdeal), "12:05")
  const p = R.camionesMinimos(PAMPERO.p, pedidoPlan(PAMPERO, PRM_C), PRM_C)
  assert.equal(p.flotaIdeal, 4); assert.equal(p.necesarios, 3)
  const p3 = p.medidas.find((m) => m.n === 3).medida
  assert.deepEqual(p3.cortes, [9, 9]); assert.equal(hh(p3.fin), "18:03"); assert.equal(hh(p3.finIdeal), "17:45")
  assert.equal(p.medidas.find((m) => m.n === 2).alcanza, false)
  const s = R.camionesMinimos(SANTA_RITA.p, pedidoPlan(SANTA_RITA, PRM_C), PRM_C)
  assert.equal(s.necesarios, 4)
  assert.equal(s.medidas.find((m) => m.n === 3).medida.maxCorte, 25)
})

test("ejemplo 05/11 · paso 3: la bomba le saca camiones al directo; textos de cada pedido", () => {
  const r = R.armarDia(ENT)
  const sr = de(r, "sr"), gv = de(r, "gv"), pa = de(r, "pa")
  assert.deepEqual(sr.camiones.sort(), ["CRN449", "LES431"])
  assert.deepEqual(gv.camiones.sort(), ["AE402HE", "AF431GU", "AG083GT"])
  assert.equal(sr.estado, "ambar")
  assert.equal(sr.texto, "Santa Rita · directo · 2 camiones (hacían falta 4): termina 12:05 en vez de 10:15, con 2 cortes de 55 min. Los otros están con la bomba de Greenville.")
  assert.equal(gv.estado, "verde")
  assert.equal(gv.texto, "Greenville · bomba · 3 camiones: alcanzan, la bomba recibe un camión cada 45 min.")
  assert.equal(pa.estado, "verde")
  assert.equal(pa.texto, "Pampero · bomba · 3 camiones: alcanzan, la bomba recibe un camión cada 38 min (2 esperas de 9 min). Con 4 termina 17:45 pero suma un traslado.")
  assert.ok(r.avisos.some((a) => a.texto === "Pampero termina 18:03, después del fin de jornada (18:00)."))
  assert.ok(r.avisos.some((a) => a.texto === "Santa Rita termina 12:05 en vez de 10:15."))
})

test("ejemplo 05/11 · reparto: franjas, traslado y contador", () => {
  const r = R.armarDia(ENT)
  const fr = R.franjasDe(r, CAMIONES, PLANTAS)
  assert.deepEqual(fr.map((f, i) => R.textoFranja(f, i, fr.length, NOMBRES, PATENTES)), [
    "07:00 a 11:05 · Hudson 3 (AE402HE, AF431GU, AG083GT) · Canning 2 (CRN449, LES431)",
    "Desde 11:55 · Canning 3 (CRN449, LES431, AG083GT) · Hudson 2 libres (AE402HE vuelve 11:52, AF431GU 12:37)",
  ])
  assert.deepEqual(r.traslados.map((t) => R.textoTraslado(t, NOMBRES, PATENTES)), ["11:05 · AG083GT pasa de Hudson a Canning (llega 11:55)"])
  const noche = R.dondeDuermen(r, CAMIONES, PLANTAS, null)
  const rep = R.repartoDe(r, CAMIONES, noche.duerme)
  const t = R.contarTraslados(rep, AMANECE)
  assert.deepEqual(t, { dia: 1, noche: 0 })
  assert.equal(R.textoTraslados(t.dia, t.noche, TRASLADO), "Traslados: 1 en el día · 0 a la noche")
  assert.equal(R.textoTraslados(1, 0, R.trasladoDe({ minutos: 50, km: 42, litros: 17 })), "Traslados: 1 en el día · 0 a la noche · ≈ 42 km · 17 L")
})

test("ejemplo 05/11 · cronograma de Pampero con CRN449, LES431 y AG083GT; sin choques de camión ni de boca", () => {
  const r = R.armarDia(ENT)
  const pa = de(r, "pa")
  assert.deepEqual(pa.viajes.map((v) => hh(v.inicioCarga)), ["12:15", "12:53", "13:31", "14:18", "14:56", "15:34", "16:21", "16:59"])
  const filas = r.pedidos.flatMap((x) => x.filas)
  assert.equal(V.choquesDeCamion(filas).size, 0)
  const can = r.viajes.filter((v) => v.plantId === CAN).sort((a, b) => a.inicioCarga - b.inicioCarga)
  for (let i = 1; i < can.length; i++) assert.ok(can[i].inicioCarga >= can[i - 1].salida, `boca: ${hh(can[i - 1].inicioCarga)} y ${hh(can[i].inicioCarga)}`)
})

test("ejemplo 05/11 · dónde duermen: sin pedidos el 06/11 cada uno queda donde termina; con un pedido de 5 camiones en Canning pasan 2", () => {
  const r = R.armarDia(ENT)
  const sin = R.dondeDuermen(r, CAMIONES, PLANTAS, { base: DIA(6), plantas: PLANTAS, pedidos: [], traslado: TRASLADO })
  assert.deepEqual(sin.textos, ["Mañana todavía no tiene pedidos: cada camión queda donde termina."])
  assert.equal(R.textoNoche(sin.duerme, PLANTAS), "A la noche: quedan 3 en Canning y 2 en Hudson")
  assert.equal(R.contarTraslados(R.repartoDe(r, CAMIONES, sin.duerme), AMANECE).noche, 0)
  // 06/11: Canning, ida 45 → ciclo 145 / 30 = 5 camiones; carga 07:00
  const grande = ped("x6", "Prueba", CAN, 80, 8, 0, "directo", { viaje_min: 45 }, 6)
  assert.equal(R.camionesMinimos(grande.p, V.pedidoParaPlan(grande.p, 80, 8 * 60), PRM_C).necesarios, 5)
  const con = R.dondeDuermen(r, CAMIONES, PLANTAS, { base: DIA(6), plantas: PLANTAS, pedidos: [grande], traslado: TRASLADO })
  assert.deepEqual(con.movidos.sort(), ["AE402HE", "AF431GU"])
  assert.equal(con.duerme.AE402HE, CAN); assert.equal(con.duerme.AF431GU, CAN)
  assert.ok(con.textos.includes("AE402HE: pasa a Canning esta noche (mañana Canning arranca con 5)"))
  assert.ok(con.textos.includes("AG083GT: se queda en Canning (mañana Canning arranca con 5)"))
  const t = R.contarTraslados(R.repartoDe(r, CAMIONES, con.duerme), AMANECE)
  assert.equal(R.textoTraslados(t.dia, t.noche, TRASLADO), "Traslados: 1 en el día · 2 a la noche")
  // Con un pedido que cabe en Canning (3 camiones) nadie se mueve
  const chico = ped("x7", "Chica", CAN, 24, 8, 0, "directo", {}, 6)
  assert.deepEqual(R.dondeDuermen(r, CAMIONES, PLANTAS, { base: DIA(6), plantas: PLANTAS, pedidos: [chico], traslado: TRASLADO }).movidos, [])
})

test("ejemplo 05/11 · editar: AE402HE a Canning suma un traslado; ida y vuelta de las filas; Usar la sugerencia vuelve", () => {
  const r = R.armarDia(ENT)
  const sug = R.repartoDe(r, CAMIONES, R.dondeDuermen(r, CAMIONES, PLANTAS, null).duerme)
  const ed = structuredClone(sug)
  ed.AE402HE.tramos = [{ plantId: HUD, desde: null }, { plantId: CAN, desde: P.aMin("12:42") }]
  ed.AE402HE.duerme = CAN
  assert.equal(R.contarTraslados(ed, AMANECE).dia, 2)
  const filas = R.repartoAFilas(ed, "a_mano")
  assert.equal(filas.length, 5)
  assert.ok(filas.every((f) => f.origen === "a_mano"))
  assert.deepEqual(filas.find((f) => f.mixer_id === "AE402HE").tramos, [{ plant_id: HUD, desde: null }, { plant_id: CAN, desde: "12:42" }])
  assert.ok(R.mismoReparto(R.repartoDeFilas(filas), ed))
  assert.ok(!R.mismoReparto(ed, sug))
  assert.ok(R.mismoReparto(R.repartoDeFilas(R.repartoAFilas(sug, "sugerido")), sug))
  // Con el reparto editado el motor respeta lo editado: AE402HE carga en Canning recién desde que llega
  const re = R.armarDia({ ...ENT, reparto: ed })
  for (const v of re.viajes.filter((x) => x.camionId === "AE402HE" && x.plantId === CAN)) assert.ok(v.inicioCarga >= P.aMin("12:52"), hh(v.inicioCarga))
  const fr = R.franjasDe(re, CAMIONES, PLANTAS)
  assert.ok(R.textoComparacion(R.franjasDe(r, CAMIONES, PLANTAS), fr, NOMBRES).startsWith("Sugerido: "))
})

test("ejemplo 05/11 · edición imposible: AG083GT pasa a Canning 10:30 → vuelve de Greenville 11:05 y la bomba va a esperar", () => {
  const r = R.armarDia(ENT)
  const sug = R.repartoDe(r, CAMIONES, R.dondeDuermen(r, CAMIONES, PLANTAS, null).duerme)
  const ed = structuredClone(sug)
  ed.AG083GT.tramos = [{ plantId: HUD, desde: null }, { plantId: CAN, desde: P.aMin("10:30") + 50 }]
  const av = R.avisosEdicion(ed, r.viajes, new Set(), CAMIONES, PLANTAS, TRASLADO, (id) => ENT.pedidos.find((x) => x.p.id === id).obra)
  assert.ok(av.some((a) => a.texto === "AG083GT pasa a Canning a las 10:30 pero vuelve de Greenville 11:05."), JSON.stringify(av))
  const re = R.armarDia({ ...ENT, reparto: ed })
  const gv = de(re, "gv")
  assert.equal(gv.alcanza, false)
  assert.equal(gv.estado, "ambar")
  assert.ok(gv.texto.endsWith("La bomba va a esperar."), gv.texto)
  // El aviso cuenta los camiones que de verdad le tocan (no se contradice con la línea del pedido)
  const aviso = re.avisos.find((a) => a.pedidoId === "gv" && a.texto.startsWith("La bomba de Greenville va a esperar"))
  assert.ok(aviso, JSON.stringify(re.avisos))
  assert.equal(aviso.texto, gv.camiones.length < 3
    ? `La bomba de Greenville va a esperar: tiene ${gv.camiones.length} ${gv.camiones.length === 1 ? "camión" : "camiones"} y hacen falta 3.`
    : `La bomba de Greenville va a esperar: tiene ${gv.camiones.length} camiones pero no llegan a tiempo (los otros están en otros pedidos o en la otra planta).`)
  assert.ok(gv.texto.includes(`${gv.camiones.length} camion`), gv.texto)
  // AG083GT ya no carga en Hudson después de salir (10:30)
  for (const v of re.viajes.filter((x) => x.camionId === "AG083GT" && x.plantId === HUD)) assert.ok(v.vuelta <= P.aMin("10:30"), hh(v.vuelta))
})

test("fase 2 · gerenciador de Pampero: 3 camiones = cronograma del punto 4; sacar uno no alcanza (la bomba espera)", () => {
  const r = R.armarDia(ENT)
  const rep = R.repartoDe(r, CAMIONES, {})
  const ctx = { base: BASE, plantas: PLANTAS, traslado: TRASLADO, camiones: CAMIONES, reparto: rep, sugeridos: Object.fromEntries(r.pedidos.map((x) => [x.id, x.camiones])), otros: r.viajes.filter((v) => v.pedidoId !== "pa") }
  const ofrecidos = R.camionesParaPedido(ctx, CAN, P.aMin("12:15"), P.aMin("17:00"))
  assert.deepEqual(ofrecidos.filter((c) => c.ofrecido).map((c) => c.id).sort(), ["AG083GT", "CRN449", "LES431"])
  assert.equal(ofrecidos.find((c) => c.id === "AE402HE").motivo, "en Hudson")
  assert.equal(R.camionesParaPedido(ctx, CAN, P.aMin("09:00"), P.aMin("11:00")).find((c) => c.id === "AG083GT").motivo, "en Hudson hasta 11:55")
  const tres = R.cronogramaConCamiones(ctx, PAMPERO.p, PRM_C, [], ["CRN449", "LES431", "AG083GT"])
  assert.deepEqual(tres.filas.map((v) => hIso(v.hora_carga)), ["12:15", "12:53", "13:31", "14:18", "14:56", "15:34", "16:21", "16:59"])
  assert.equal(tres.alcanza, true)
  assert.equal(V.choquesDeCamion([...tres.filas]).size, 0)
  const dos = R.cronogramaConCamiones(ctx, PAMPERO.p, PRM_C, [], ["CRN449", "LES431"])
  assert.equal(dos.alcanza, false)
  assert.ok(dos.medida.fin > tres.medida.fin)
  const av = R.avisosCronograma(dos, "Pampero", 2)
  assert.ok(av[0].startsWith("No alcanza: la bomba espera"), av[0])
  assert.match(R.textoCronograma(2, dos.medida, { n: 3, fin: tres.medida.fin }), /^Con 2 camiones termina \d\d:\d\d \(con 3, 18:03\) · 3 cortes de 47 min$/)
})

// ── Punto 9: reglas y casos sueltos ──
test("alcanza(): límites justos", () => {
  assert.equal(R.alcanza({ maxCorte: 10, demora: 0 }, true), true)
  assert.equal(R.alcanza({ maxCorte: 11, demora: 0 }, true), false)
  assert.equal(R.alcanza({ maxCorte: 20, demora: 0 }, false), true)
  assert.equal(R.alcanza({ maxCorte: 21, demora: 0 }, false), false)
  assert.equal(R.alcanza({ maxCorte: 0, demora: 20 }, true), true)
  assert.equal(R.alcanza({ maxCorte: 0, demora: 21 }, true), false)
  assert.equal(R.alcanza({ maxCorte: 0, demora: 30 }, false), true)
  assert.equal(R.alcanza({ maxCorte: 0, demora: 31 }, false), false)
})

test("un pedido solo con 5 camiones libres usa el mínimo (no los 5)", () => {
  const r = R.armarDia({ ...ENT, pedidos: [GREENVILLE] })
  assert.equal(de(r, "gv").camiones.length, 3)
  assert.equal(de(r, "gv").alcanza, true)
})

test("prefiere no trasladar: elige el camión de la planta aunque cargue un poco más tarde, mientras alcance", () => {
  // AAA está en Canning y vuelve 07:50 (viaje despachado); BBB está libre en Hudson. Un pedido de Canning de 1 camión a las 08:30.
  const fijo = { pedido_id: "otro", plant_id: CAN, n: 1, m3: 8, estado: "despachado", mixer_id: "AAA", hora_carga: at(6, 30), hora_salida: at(6, 45), hora_llegada: at(7, 0), hora_fin_descarga: at(7, 20), hora_vuelta: at(7, 50) }
  const p = ped("p1", "Una", CAN, 8, 8, 15, "directo")
  const r = R.armarDia({ ...ENT, camiones: [cam("AAA", CAN), cam("BBB", HUD)], pedidos: [p], fijos: [fijo] })
  assert.deepEqual(de(r, "p1").camiones, ["AAA"])
  assert.equal(r.traslados.length, 0)
})

test("traslado: un camión que vuelve a Hudson 11:05 no carga en Canning antes de 11:05 + traslado + espera", () => {
  const fijo = { pedido_id: "otro", plant_id: HUD, n: 1, m3: 8, estado: "despachado", mixer_id: "AAA", hora_carga: at(9, 0), hora_salida: at(9, 10), hora_llegada: at(9, 40), hora_fin_descarga: at(10, 35), hora_vuelta: at(11, 5) }
  const p = ped("p1", "Una", CAN, 8, 11, 30, "directo")
  const r = R.armarDia({ ...ENT, camiones: [cam("AAA", HUD)], pedidos: [p], fijos: [fijo] })
  const v = de(r, "p1").viajes[0]
  assert.equal(hh(v.inicioCarga), hh(P.aMin("11:05") + 50 + 10)) // 12:05
  assert.equal(r.traslados.length, 1)
})

test("la bomba le saca camiones al directo y nunca deja un directo con 0", () => {
  // Directo en Canning con 1 solo camión superpuesto con una bomba en Canning que necesita más: el directo no baja a 0
  const dir = ped("d1", "Directo", CAN, 8, 8, 0, "directo")
  const bom = ped("b1", "Bomba", CAN, 40, 8, 30, "bomba")
  const r = R.armarDia({ ...ENT, camiones: [cam("AAA", CAN), cam("BBB", CAN)], pedidos: [dir, bom] })
  assert.equal(de(r, "d1").camiones.length, 1)
  assert.equal(de(r, "b1").alcanza, false)
  assert.equal(de(r, "b1").estado, "rojo")
  const b = de(r, "b1")
  assert.ok(r.avisos.some((a) => a.nivel === "rojo" && a.texto === `No alcanzan los camiones para la bomba de Bomba: tiene ${b.camiones.length} ${b.camiones.length === 1 ? "camión" : "camiones"} y hacen falta ${b.necesarios}.`), JSON.stringify(r.avisos))
})

test("dos bombas que no alcanzan: aviso rojo para cada una y sin bucle infinito", () => {
  // Dos camiones para dos bombas de 64 m³ (hacen falta 3 cada una) y un directo: no hay de dónde sacar
  const b1 = ped("b1", "Uno", CAN, 64, 8, 0, "bomba"), b2 = ped("b2", "Dos", HUD, 64, 8, 0, "bomba"), d = ped("d", "Dir", CAN, 16, 8, 0, "directo")
  const r = R.armarDia({ ...ENT, camiones: [cam("AAA", CAN), cam("BBB", HUD)], pedidos: [b1, b2, d] })
  assert.equal(de(r, "b1").alcanza, false); assert.equal(de(r, "b2").alcanza, false)
  assert.equal(de(r, "b1").estado, "rojo"); assert.equal(de(r, "b2").estado, "rojo")
  for (const id of ["b1", "b2"]) assert.ok(r.avisos.some((a) => a.nivel === "rojo" && a.pedidoId === id), id)
  assert.ok(de(r, "d").camiones.length >= 1)
  // Un directo que no ayuda a la bomba no pierde camiones por nada
  const b3 = ped("b3", "Tres", HUD, 64, 8, 0, "bomba")
  const r2 = R.armarDia({ ...ENT, camiones: [cam("AAA", CAN), cam("CCC", CAN), cam("BBB", HUD)], pedidos: [ped("b1", "Uno", CAN, 64, 8, 0, "bomba"), b3, ped("d", "Dir", CAN, 40, 8, 0, "directo")] })
  assert.equal(de(r2, "b3").estado, "rojo")
  assert.equal(de(r2, "d").cedeA, null)
})

test("reparto editado: un camión fuera de su tramo nunca recibe viajes en esa planta", () => {
  const rep = Object.fromEntries(CAMIONES.map((c) => [c.id, { sale: true, tramos: [{ plantId: c.amanece, desde: null }], duerme: c.amanece }]))
  rep.CRN449 = { sale: true, tramos: [{ plantId: CAN, desde: null }, { plantId: HUD, desde: P.aMin("09:00") }], duerme: HUD }
  rep.LES431 = { sale: false, tramos: [], duerme: CAN }
  const r = R.armarDia({ ...ENT, camiones: CAMIONES.filter((c) => c.id !== "LES431"), reparto: rep })
  for (const v of r.viajes) {
    const t = rep[v.camionId].tramos
    let pl = t[0].plantId
    for (const x of t) if ((x.desde ?? -1e9) <= v.inicioCarga) pl = x.plantId
    assert.equal(v.plantId, pl, `${v.camionId} ${hh(v.inicioCarga)}`)
    if (v.camionId === "CRN449" && v.plantId === CAN) assert.ok(v.vuelta <= P.aMin("08:10"), hh(v.vuelta)) // sale 08:10
  }
  assert.ok(!r.viajes.some((v) => v.camionId === "LES431"))
  assert.deepEqual(R.contarTraslados(rep, AMANECE), { dia: 1, noche: 0 })
})

test("viajes despachados quedan fijos y ocupan a su camión", () => {
  const fijo = { pedido_id: "sr", plant_id: CAN, n: 1, m3: 8, estado: "despachado", mixer_id: "CRN449", hora_carga: at(7, 0), hora_salida: at(7, 15), hora_llegada: at(7, 45), hora_fin_descarga: at(8, 15), hora_vuelta: at(8, 45) }
  const sr = { ...SANTA_RITA, existentes: [fijo] }
  const r = R.armarDia({ ...ENT, pedidos: [sr], fijos: [fijo] })
  const x = de(r, "sr")
  assert.equal(x.viajes.reduce((s, v) => s + v.m3, 0), 32) // lo que falta
  assert.ok(!x.filas.some((f) => f.n === 1)) // el 1 es el despachado
  for (const v of x.viajes.filter((v) => v.camionId === "CRN449")) assert.ok(v.inicioCarga >= P.aMin("08:55"), hh(v.inicioCarga))
  assert.ok(r.viajes.some((v) => v.fijo && v.camionId === "CRN449"))
})

test("sin traslado cargado: la ruta del mapa o 60 min, con la marca 'a confirmar'", () => {
  const t = R.trasladoDe(null)
  assert.deepEqual(t, { minutos: 60, km: null, litros: null, fuente: "sin_dato", aConfirmar: true })
  assert.deepEqual(R.trasladoDe(null, { minutos: 52, km: 41 }), { minutos: 52, km: 41, litros: null, fuente: "ruta", aConfirmar: true })
  assert.equal(R.trasladoDe({ minutos: 50 }, { minutos: 52 }).aConfirmar, false)
  const r = R.armarDia({ ...ENT, traslado: t })
  assert.ok(r.avisos.some((a) => a.texto === "Traslado a confirmar: cargalo en Tiempos y camiones."))
  assert.equal(R.trasladoEntre(CAN, HUD, t), 60)
  assert.equal(R.trasladoEntre(CAN, CAN, t), 0)
})

test("boca de carga entre dos pedidos de la misma planta", () => {
  const a = ped("a", "A", CAN, 16, 8, 0, "directo"), b = ped("b", "B", CAN, 16, 8, 0, "directo")
  const r = R.armarDia({ ...ENT, pedidos: [a, b] })
  const can = r.viajes.filter((v) => v.plantId === CAN).sort((x, y) => x.inicioCarga - y.inicioCarga)
  assert.equal(can.length, 4)
  for (let i = 1; i < can.length; i++) assert.ok(can[i].inicioCarga >= can[i - 1].salida)
  // planificar con cargasOcupadas: la boca corre la carga
  const pl = P.planificar([{ id: "x", cliente: "", obra: "", m3: 8, llegada: 480, viajeMin: 30, conBomba: false }], [{ id: "c", patente: "c", capacidad: 8 }], PRM_C, [], [{ desde: 435, hasta: 450 }])
  assert.equal(pl.viajes[0].inicioCarga, 450)
  assert.equal(pl.plantaOcupacion, P.planificar([{ id: "x", cliente: "", obra: "", m3: 8, llegada: 540, viajeMin: 30, conBomba: false }], [{ id: "c", patente: "c", capacidad: 8 }], PRM_C).plantaOcupacion)
})

test("superposición de viajes guardados: X se superpone con Y", () => {
  const v = (pedido, n, c, carga, vuelta) => ({ pedido_id: pedido, plant_id: CAN, n, m3: 8, estado: "planificado", mixer_id: c, hora_carga: carga, hora_salida: carga, hora_llegada: carga, hora_fin_descarga: vuelta, hora_vuelta: vuelta })
  const av = R.avisosSuperposicion([v("x", 1, "AF431GU", at(11, 0), at(12, 37)), v("y", 1, "AF431GU", at(12, 15), at(13, 30))], (id) => (id === "x" ? "Greenville" : "Pampero"), (id) => id)
  assert.deepEqual(av.map((a) => a.texto), ["Greenville se superpone con Pampero: AF431GU tendría que cargar para Pampero a las 12:15 y vuelve de Greenville 12:37."])
})

test("migración: agrega, se puede correr dos veces, todo en una transacción", () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations")
  const f = fs.readdirSync(dir).find((x) => x.endsWith("_reparto_camiones.sql"))
  assert.ok(f, "falta la migración")
  const sql = fs.readFileSync(path.join(dir, f), "utf8")
  assert.match(sql, /^BEGIN;/m); assert.match(sql, /^COMMIT;/m); assert.match(sql, /SET LOCAL lock_timeout/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.traslados_plantas/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.reparto_camiones/)
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.guardar_reparto_dia\(p_fecha date, p_filas jsonb, p_usuario text/)
  assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /\b(DROP TABLE|ALTER TABLE public\.(?!traslados_plantas|reparto_camiones)\w+|DELETE FROM public\.(?!reparto_camiones))/i)
})

test("aviso de la bomba: cuenta los camiones que le tocan (tiene 2 y hacen falta 3)", () => {
  // Greenville con solo 2 camiones en Hudson y los de Canning sin poder pasar (reparto que los deja en Canning)
  const rep = { CRN449: { sale: true, tramos: [{ plantId: CAN, desde: null }], duerme: CAN }, LES431: { sale: true, tramos: [{ plantId: CAN, desde: null }], duerme: CAN }, AE402HE: { sale: true, tramos: [{ plantId: HUD, desde: null }], duerme: HUD }, AF431GU: { sale: true, tramos: [{ plantId: HUD, desde: null }], duerme: HUD } }
  const r = R.armarDia({ ...ENT, camiones: CAMIONES.filter((c) => c.id !== "AG083GT"), pedidos: [GREENVILLE], reparto: rep })
  const gv = de(r, "gv")
  assert.deepEqual(gv.camiones.sort(), ["AE402HE", "AF431GU"])
  assert.ok(r.avisos.some((a) => a.texto === "La bomba de Greenville va a esperar: tiene 2 camiones y hacen falta 3."), JSON.stringify(r.avisos))
  assert.equal(gv.texto.startsWith("Greenville · bomba · 2 camiones (hacían falta 3)"), true, gv.texto)
})

test("Ordenar el día con reparto usa lo de la pantalla: un pedido movido de hora y tiempos sin guardar", () => {
  const r = R.armarDia(ENT)
  const reparto = R.repartoDe(r, CAMIONES, R.dondeDuermen(r, CAMIONES, PLANTAS, null).duerme)
  // Lo cargado por el bloque tiene Pampero a las 13:00; en la pantalla ya se movió a las 14:00
  const movido = { ...PAMPERO, p: { ...PAMPERO.p, scheduled_arrival_time: at(14, 0) } }
  const prop = R.propuestaDePlanta(R.armarDia({ ...R.entradaConPantalla(ENT, CAN, { pedidos: [SANTA_RITA, movido], prm: PRM_C }), reparto }), CAN)
  assert.deepEqual(Object.keys(prop).sort(), ["pa", "sr"]) // solo los de esta planta
  assert.equal(hIso(prop.pa[0].hora_carga), "13:15")
  assert.equal(hIso(prop.pa[0].hora_llegada), "14:00")
  // Con la carga de Canning en 20 min (sin guardar) la primera carga se corre
  const prop2 = R.propuestaDePlanta(R.armarDia({ ...R.entradaConPantalla(ENT, CAN, { pedidos: [SANTA_RITA, movido], prm: { ...PRM_C, cargaMin: 20 } }), reparto }), CAN)
  assert.equal(hIso(prop2.pa[0].hora_carga), "13:10")
  // Sin cambios en la pantalla da lo mismo que el armado del bloque
  const igual = R.propuestaDePlanta(R.armarDia({ ...R.entradaConPantalla(ENT, CAN, { pedidos: [SANTA_RITA, PAMPERO], prm: PRM_C }), reparto }), CAN)
  assert.deepEqual(igual.pa.map((v) => v.hora_carga), de(R.armarDia({ ...ENT, reparto }), "pa").filas.map((v) => v.hora_carga))
})

test("antes de guardar: cambios de planta en orden y antes de la medianoche", () => {
  const pat = (id) => id, nom = (id) => NOMBRES[id]
  const ok = { AG083GT: { sale: true, tramos: [{ plantId: HUD, desde: null }, { plantId: CAN, desde: P.aMin("11:55") }], duerme: CAN } }
  assert.equal(R.validarReparto(ok, pat, nom, TRASLADO), null)
  const tarde = { AG083GT: { sale: true, tramos: [{ plantId: HUD, desde: null }, { plantId: CAN, desde: P.aMin("23:30") + 50 }], duerme: CAN } }
  assert.equal(R.validarReparto(tarde, pat, nom, TRASLADO), "AG083GT: el cambio a Canning de las 23:30 llega después de la medianoche (el traslado tarda 50 min). Ponelo más temprano o sacalo.")
  const dosIguales = { AG083GT: { sale: true, tramos: [{ plantId: HUD, desde: null }, { plantId: CAN, desde: P.aMin("23:59") }, { plantId: HUD, desde: P.aMin("23:59") }], duerme: HUD } }
  assert.match(R.validarReparto(dosIguales, pat, nom, TRASLADO), /tienen que ir en orden/)
  assert.equal(R.validarReparto({ X: { sale: false, tramos: [{ plantId: HUD, desde: 5000 }], duerme: HUD } }, pat, nom, TRASLADO), null)
})

test("medirFilas: el resumen del gerenciador sobre los viajes que se ven (guardados o corridos a mano)", () => {
  const r = R.armarDia(ENT)
  const pa = de(r, "pa")
  const m = R.medirFilas(pa.filas, pa.medida.finIdeal, BASE)
  assert.deepEqual(m.cortes, pa.medida.cortes)
  assert.equal(Math.round(m.fin), Math.round(pa.medida.fin))
  // Corrido 5 min a mano el viaje 3: un corte más largo
  const corridas = pa.filas.map((v) => (v.n === 3 ? V.correrViaje(v, 5) : v))
  assert.ok(R.medirFilas(corridas, pa.medida.finIdeal, BASE).cortes.includes(5))
})

test("Ordenar el día con reparto: los viajes pendientes guardados de la otra planta quedan fijos y ocupan a sus camiones", () => {
  const r = R.armarDia(ENT)
  const reparto = R.repartoDe(r, CAMIONES, R.dondeDuermen(r, CAMIONES, PLANTAS, null).duerme)
  // Greenville (Hudson) tiene guardado un viaje pendiente con AG083GT que vuelve 15:00
  const guardado = { pedido_id: "gv", plant_id: HUD, n: 1, m3: 8, estado: "planificado", mixer_id: "AG083GT", hora_carga: at(12, 0), hora_salida: at(12, 10), hora_llegada: at(12, 40), hora_fin_descarga: at(14, 30), hora_vuelta: at(15, 0) }
  const ent = { ...ENT, pedidos: [SANTA_RITA, { ...GREENVILLE, existentes: [guardado] }, PAMPERO] }
  const e = R.entradaConPantalla(ent, CAN, { pedidos: [SANTA_RITA, PAMPERO], prm: PRM_C })
  assert.ok(!e.pedidos.some((x) => x.p.id === "gv")) // no se reordena desde Canning
  assert.ok(e.fijos.some((v) => v.pedido_id === "gv" && v.estado === "planificado"))
  const res = R.armarDia({ ...e, reparto })
  const prop = R.propuestaDePlanta(res, CAN)
  assert.ok(!("gv" in prop))
  // AG083GT recién puede cargar en Canning a la vuelta (15:00) + traslado (50) + espera de Canning (10)
  for (const v of res.viajes.filter((x) => !x.fijo && x.camionId === "AG083GT" && x.plantId === CAN)) assert.ok(v.inicioCarga >= P.aMin("16:00"), hh(v.inicioCarga))
  // Sin viajes guardados en la otra planta, sus pedidos se arman con la sugerencia (no quedan fijos)
  const sin = R.entradaConPantalla(ENT, CAN, { pedidos: [SANTA_RITA, PAMPERO], prm: PRM_C })
  assert.ok(sin.pedidos.some((x) => x.p.id === "gv"))
})

test("medirFilas: los cortes solo entre pendientes (un despachado no corta ni se mezcla)", () => {
  const r = R.armarDia(ENT)
  const pa = de(r, "pa")
  // El viaje 1 ya salió y su hora real fue mucho antes: no cuenta como corte para el 2
  const filas = pa.filas.map((v) => (v.n === 1 ? { ...v, estado: "despachado", hora_llegada: at(12, 0), hora_fin_descarga: at(12, 20) } : v))
  const m = R.medirFilas(filas, pa.medida.finIdeal, BASE)
  assert.deepEqual(m.cortes, R.medirFilas(pa.filas.filter((v) => v.n !== 1), pa.medida.finIdeal, BASE).cortes)
  assert.equal(Math.round(m.fin), Math.round(pa.medida.fin))
})

// ── Identidad con main: planificar() sin cargasOcupadas y planDelDia() sin traslado ──
function cargarMain() {
  try {
    const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..")
    const ref = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { cwd: raiz, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reparto-main-"))
    const pl = execFileSync("git", ["show", `${ref}:lib/planificador.ts`], { cwd: raiz, encoding: "utf8" })
    const vj = execFileSync("git", ["show", `${ref}:lib/viajes.ts`], { cwd: raiz, encoding: "utf8" }).replace(/from "@\/lib\/planificador"/g, 'from "./planificador.ts"')
    fs.writeFileSync(path.join(dir, "planificador.ts"), pl)
    fs.writeFileSync(path.join(dir, "viajes.ts"), vj)
    return dir
  } catch {
    return null
  }
}
const DIR_MAIN = cargarMain()

test("identidad con main en 1.000 días al azar: planificar() sin cargasOcupadas y planDelDia() sin traslado", { skip: DIR_MAIN ? false : "sin git: no se puede leer main" }, async () => {
  const PM = await import(pathToFileURL(path.join(DIR_MAIN, "planificador.ts")).href)
  const VM = await import(pathToFileURL(path.join(DIR_MAIN, "viajes.ts")).href)
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const veces = (n, f) => Array.from({ length: n }, (_, i) => f(i))
  for (let k = 0; k < 1000; k++) {
    const prm = { ...P.PARAMETROS_BASE, cargaMin: 8 + Math.floor(rnd() * 10), lavadoMin: Math.floor(rnd() * 12), esperaPlantaMin: rnd() > 0.5 ? Math.floor(rnd() * 25) : undefined, bocasCarga: rnd() > 0.8 ? 2 : 1 }
    const ps = veces(1 + Math.floor(rnd() * 5), (i) => ({ id: "p" + i, cliente: "", obra: "", m3: Math.round(rnd() * 60) + 1, llegada: 400 + Math.floor(rnd() * 560), viajeMin: 10 + Math.floor(rnd() * 50), conBomba: rnd() > 0.5, m3PorViaje: rnd() > 0.7 ? 6 : null, espaciadoMin: rnd() > 0.8 ? 20 : null }))
    const cs = veces(1 + Math.floor(rnd() * 6), (i) => ({ id: "c" + i, patente: "c" + i, capacidad: rnd() > 0.9 ? 10 : 8 }))
    const oc = rnd() > 0.5 ? veces(1 + Math.floor(rnd() * 3), () => ({ camionId: "c" + Math.floor(rnd() * cs.length), desde: 400 + Math.floor(rnd() * 400), hasta: 500 + Math.floor(rnd() * 400) })) : []
    const viejo = JSON.stringify(PM.planificar(ps, cs, prm, oc))
    assert.equal(JSON.stringify(P.planificar(ps, cs, prm, oc)), viejo)
    assert.equal(JSON.stringify(P.planificar(ps, cs, prm, oc, [])), viejo)
    // planDelDia con pedidos de verdad (horas ISO), despachados y viajes de la otra planta
    const base = new Date(2026, 10, 5).getTime()
    const iso = (m) => new Date(base + m * 60000).toISOString()
    const pedidos = ps.map((p, i) => ({ id: p.id, plant_id: CAN, quantity_m3: p.m3, dispatched_m3: 0, scheduled_arrival_time: iso(p.llegada), metodo_descarga: p.conBomba ? "bomba" : "directo", m3_por_viaje: p.m3PorViaje, espaciado_min: p.espaciadoMin, viaje_min: i % 2 ? p.viajeMin : null, descarga_min: rnd() > 0.8 ? 40 : null, construction_sites: { name: "o" + i, travel_time_minutes: p.viajeMin } }))
    const vpp = {}
    if (rnd() > 0.6) vpp.p0 = [{ pedido_id: "p0", plant_id: CAN, n: 1, m3: 8, estado: "despachado", mixer_id: "c0", hora_carga: iso(ps[0].llegada - 60), hora_salida: iso(ps[0].llegada - 50), hora_llegada: iso(ps[0].llegada - 20), hora_fin_descarga: iso(ps[0].llegada), hora_vuelta: iso(ps[0].llegada + 30) }]
    const otros = rnd() > 0.5 ? [{ pedido_id: "z", plant_id: HUD, n: 1, m3: 8, estado: "planificado", mixer_id: "c" + Math.floor(rnd() * cs.length), hora_carga: iso(500), hora_salida: iso(510), hora_llegada: iso(540), hora_fin_descarga: iso(580), hora_vuelta: iso(610) }] : []
    assert.equal(JSON.stringify(V.planDelDia(pedidos, vpp, cs, prm, otros)), JSON.stringify(VM.planDelDia(pedidos, vpp, cs, prm, otros)))
    assert.equal(JSON.stringify(V.generarViajes(pedidos[0], prm, vpp.p0 || [], otros)), JSON.stringify(VM.generarViajes(pedidos[0], prm, vpp.p0 || [], otros)))
  }
})
