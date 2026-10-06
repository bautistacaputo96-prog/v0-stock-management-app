// Pruebas de los indicadores de logística (lib/kpis-logistica.ts).
import { test } from "node:test"
import assert from "node:assert/strict"
import * as K from "../kpis-logistica.ts"

let n = 0
/** Viaje de entrega completo y confiable con valores por defecto. */
const V = (o = {}) => ({
  key: `v${++n}`, fecha: "2026-10-02", mixer_id: "m1", camion: "AE402HE", chofer: null, obra_id: "o1", obra: "Platea", cliente_id: "c1",
  cliente: "Fideicomiso", remito: String(800 + n), dispatch_id: `d${n}`, m3: 8, confianza: "media", estado: "completo",
  min_en_planta: 20, min_motor_parado_planta: 15, min_ida: 25, min_obra: 60, min_vuelta: 25, ciclo_min: 110, km_ida: 22, km_vuelta: 22,
  min_paradas_extra: 0, paradas_extra: 0, ...o,
})
const P = (o = {}) => ({
  key: `p${++n}`, fecha: "2026-10-02", mixer_id: "m1", camion: "AE402HE", chofer: null, obra_id: "o1", obra: "Platea", cliente_id: "c1",
  cliente: "Fideicomiso", remito: "0819", viaje_key: null, dif: 0, tolerancia: 15, ...o,
})
const D = (viajes, pedidos = []) => ({ viajes, pedidos })

test("todas las definiciones están completas y no rompen sin datos", () => {
  const ids = new Set()
  for (const k of K.KPIS) {
    assert.ok(!ids.has(k.id), `id repetido ${k.id}`)
    ids.add(k.id)
    assert.ok(k.unidad)
    for (const c of ["titulo", "corta", "queMide", "comoSeCalcula", "referencia", "columnaItem"]) assert.ok(k[c] && k[c].length > (c === "titulo" || c === "columnaItem" ? 1 : 8), `${k.id}.${c}`)
    assert.ok(["menor", "mayor"].includes(k.direccion))
    assert.equal(k.calcular(D([])), null, k.id)
    assert.deepEqual(k.items(D([])), [])
    assert.deepEqual(K.porDia(k, D([])), [])
  }
  // Los 15 que pidió Bautista
  for (const id of ["ciclo_planta", "ciclo_calle", "obra", "ida", "vuelta", "planta", "ralenti", "m3_camion", "viajes_camion", "uso_flota", "min_m3", "km_viaje", "paradas_extra", "puntualidad", "m3_chofer"]) assert.ok(ids.has(id), id)
})

test("bandas: menos es mejor y más es mejor, con los bordes", () => {
  const obra = K.kpi("obra") // bueno ≤ 70, normal ≤ 90
  assert.equal(K.banda(obra, 70), "bueno")
  assert.equal(K.banda(obra, 70.1), "normal")
  assert.equal(K.banda(obra, 90), "normal")
  assert.equal(K.banda(obra, 91), "a_mejorar")
  assert.equal(K.banda(obra, null), null)
  const m3 = K.kpi("m3_camion") // bueno ≥ 22,5, normal ≥ 15
  assert.equal(K.banda(m3, 22.5), "bueno")
  assert.equal(K.banda(m3, 15), "normal")
  assert.equal(K.banda(m3, 14.9), "a_mejorar")
  assert.equal(K.banda(K.kpi("uso_flota"), 50), null) // sin referencia
  assert.deepEqual(K.textoBandas(K.kpi("ralenti")).map((b) => b.texto), ["hasta 35 min/viaje", "de 35 a 60 min/viaje", "más de 60 min/viaje"])
  assert.deepEqual(K.textoBandas(K.kpi("m3_chofer")).map((b) => b.texto), ["19,9 m³/día o más", "de 16,7 a 19,9 m³/día", "menos de 16,7 m³/día"])
})

test("ciclos y tiempos: solo viajes de entrega completos y confiables", () => {
  const vs = [
    V({ ciclo_min: 100, min_en_planta: 20 }),
    V({ ciclo_min: 140, min_en_planta: 40 }),
    V({ ciclo_min: 30, dispatch_id: null }), // traslado
    V({ ciclo_min: 500, estado: "incompleto" }),
    V({ ciclo_min: 300, confianza: "baja" }),
    V({ ciclo_min: 120, min_en_planta: 600 }), // camión guardado: no cuenta en planta
  ]
  assert.equal(K.kpi("ciclo_calle").calcular(D(vs)), (100 + 140 + 120) / 3)
  assert.equal(K.kpi("ciclo_planta").calcular(D(vs)), (120 + 180) / 2)
  // Tiempo en planta: viajes de entrega (incluye el dudoso), sin estadías de más de 3 h
  assert.equal(K.kpi("planta").calcular(D(vs)), (20 + 40 + 20 + 20) / 4)
  // min/m³: (ciclo + planta) / m³ de los confiables con planta válida
  assert.equal(K.kpi("min_m3").calcular(D(vs)), (120 + 180) / 16)
})

test("por camión por día: m³, viajes y uso de la flota usan días-camión", () => {
  const vs = [
    V({ mixer_id: "m1", fecha: "2026-10-01", m3: 8, ciclo_min: 132 }),
    V({ mixer_id: "m1", fecha: "2026-10-01", m3: 8, ciclo_min: 132 }),
    V({ mixer_id: "m1", fecha: "2026-10-02", m3: 8, ciclo_min: 132 }),
    V({ mixer_id: "m2", fecha: "2026-10-02", m3: 6, ciclo_min: 132 }),
    V({ mixer_id: "m2", fecha: "2026-10-02", m3: 9, dispatch_id: null }), // traslado
  ]
  assert.equal(K.kpi("m3_camion").calcular(D(vs)), 30 / 3)
  assert.equal(K.kpi("viajes_camion").calcular(D(vs)), 4 / 3)
  assert.equal(K.kpi("uso_flota").calcular(D(vs)), ((4 * 132) / 60 / (3 * 11)) * 100)
  // m³ por chofer: días-chofer, solo con chofer
  const cs = [V({ chofer: "Juan", m3: 8 }), V({ chofer: "Juan", m3: 8 }), V({ chofer: "Pedro", m3: 6 }), V({ chofer: null, m3: 8 })]
  assert.equal(K.kpi("m3_chofer").calcular(D(cs)), 22 / 2)
})

test("puntualidad: tolerancia de cada pedido y sin dato fuera de la cuenta", () => {
  const ps = [P({ dif: -10 }), P({ dif: 15 }), P({ dif: 16 }), P({ dif: 25, tolerancia: 30 }), P({ dif: null })]
  assert.equal(K.kpi("puntualidad").calcular(D([], ps)), 75)
  // El más atrasado primero
  assert.deepEqual(K.peoresPrimero(K.kpi("puntualidad"), D([], ps)).map((i) => i.valor), [25, 16, 15, -10])
})

test("por día, desglose y peores primero", () => {
  const vs = [
    V({ fecha: "2026-10-01", min_obra: 40, obra_id: "o1", obra: "A" }),
    V({ fecha: "2026-10-01", min_obra: 60, obra_id: "o2", obra: "B" }),
    V({ fecha: "2026-10-02", min_obra: 120, obra_id: "o2", obra: "B" }),
  ]
  const obra = K.kpi("obra")
  assert.deepEqual(K.porDia(obra, D(vs)), [{ fecha: "2026-10-01", valor: 50 }, { fecha: "2026-10-02", valor: 120 }])
  const porObra = K.desglosar(obra, D(vs), "obra")
  assert.deepEqual(porObra.map((f) => [f.id, f.valor, f.n]), [["o2", 90, 2], ["o1", 40, 1]])
  assert.deepEqual(K.peoresPrimero(obra, D(vs)).map((i) => i.valor), [120, 60, 40])
  // Más es mejor: el peor camión es el de menos m³
  const m3 = [V({ mixer_id: "m1", camion: "A", m3: 8 }), V({ mixer_id: "m2", camion: "B", m3: 4 })]
  assert.deepEqual(K.desglosar(K.kpi("m3_camion"), D(m3), "camion").map((f) => f.nombre), ["B", "A"])
})

test("formato en castellano", () => {
  assert.equal(K.formatear(K.kpi("min_m3"), 17.456), "17,5")
  assert.equal(K.formatear(K.kpi("obra"), 70.4), "70")
  assert.equal(K.formatear(K.kpi("obra"), null), "–")
})
