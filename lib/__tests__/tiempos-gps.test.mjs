// Pruebas de los tiempos reales del GPS en la programación (docs/migracion-loop/tiempos-gps-programacion.md):
// medianas y filtros (lib/gps-viajes.ts), elección de la fuente y paso a los parámetros del planificador
// (lib/viajes.ts), espera en planta (lib/planificador.ts). Sin base ni red.
import { test } from "node:test"
import assert from "node:assert/strict"
import * as G from "../gps-viajes.ts"
import * as V from "../viajes.ts"
import * as P from "../planificador.ts"

const CAN = "can", HUD = "hud"
const F = (o = {}) => ({ plant_id_salida: CAN, construction_site_id: "obra1", min_en_planta: 30, min_ida: 24, min_obra: 78, m3: 3, metodo: "directo", ...o })
const veces = (n, f) => Array.from({ length: n }, (_, i) => f(i))
const MIN = 60_000
const dif = (a, b) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / MIN)
// Canning como está hoy en la base: carga 15, lavado 1
const PRM_CAN = { ...P.PARAMETROS_BASE, cargaMin: 15, lavadoMin: 1 }

test("mediana: impar, par, vacía, ignora no numéricos", () => {
  assert.equal(G.mediana([5, 1, 3]), 3)
  assert.equal(G.mediana([4, 1, 3, 2]), 2.5)
  assert.equal(G.mediana([]), null)
  assert.equal(G.mediana([NaN, 2, Infinity, 4]), 3)
})

test("por obra: 3 viajes o más; ida por planta; obra con sus m³; filtra absurdos", () => {
  const filas = [
    F({ min_obra: 70, m3: 3 }), F({ min_obra: 78, m3: 3 }), F({ min_obra: 90, m3: 4, min_ida: 26 }),
    F({ min_obra: 6, m3: 8 }), // parada de 6 min: no es una descarga
    F({ min_obra: 300, min_ida: 500 }), // absurdos
    F({ plant_id_salida: HUD, min_ida: 40 }), F({ plant_id_salida: HUD, min_ida: 42 }), // solo 2 desde Hudson
    F({ construction_site_id: "obra2" }), F({ construction_site_id: "obra2" }), // 2 viajes: no alcanza
    F({ construction_site_id: null }),
  ]
  const t = G.calcularTiemposGps(filas, "2026-07-10")
  const o = t.obras.obra1
  assert.deepEqual(o.ida[CAN], { min: 24, viajes: 4 }) // 24, 24, 26, 24 (la de 500 no)
  assert.equal(o.ida[HUD], undefined)
  // obra: 70,78,90 + los 2 de Hudson (78,78) → mediana 78; m³ 3,3,4,3,3 → 3
  assert.deepEqual(o.obra, { min: 78, viajes: 5, m3: 3 })
  assert.equal(t.obras.obra2, undefined)
  assert.equal(t.desde, "2026-07-10")
})

test("obra que el GPS no ve bien (paradas cortas en la mayoría): sin ida ni descarga propias", () => {
  const filas = [...veces(5, () => F({ construction_site_id: "pav", min_obra: 5, min_ida: 40, m3: 8 })), ...veces(3, () => F({ construction_site_id: "pav", min_obra: 15, m3: 8 }))]
  const o = G.calcularTiemposGps(filas).obras.pav
  assert.deepEqual(o.ida, {})
  assert.equal(o.obra, null)
  assert.equal(o.m3.m3, 8) // los m³ salen de los remitos: se pueden sugerir igual
  // Con la mitad o más visibles, sí
  const ok = G.calcularTiemposGps([...veces(3, () => F({ construction_site_id: "pav", min_obra: 5 })), ...veces(3, () => F({ construction_site_id: "pav", min_obra: 30 }))]).obras.pav
  assert.equal(ok.obra.min, 30)
})

test("por planta: 10 viajes o más; en planta y descarga por método", () => {
  const filas = [
    ...veces(12, (i) => F({ construction_site_id: `o${i}`, min_en_planta: 25 + i, min_obra: 20 + i, m3: 8 })),
    ...veces(9, (i) => F({ construction_site_id: `b${i}`, metodo: "bomba", min_obra: 40, m3: 8 })),
    F({ min_en_planta: 400 }),
    ...veces(5, () => F({ plant_id_salida: HUD, min_en_planta: 38 })),
  ]
  const t = G.calcularTiemposGps(filas)
  // en planta: 25..36 (12) + 9 × 30; la de 400 min se descarta
  assert.equal(t.plantas[CAN].enPlanta.viajes, 21)
  assert.ok(t.plantas[CAN].directo.viajes >= 10)
  assert.equal(t.plantas[CAN].bomba, null) // 9 viajes con bomba: no alcanza
  assert.equal(t.plantas[HUD].enPlanta, null) // 5 viajes
})

test("m³ sugeridos: patrón claro (CORDONES) sí; mezclado no; pocos no", () => {
  assert.deepEqual(G.m3Sugerido([3, 3, 4, 2, 3, 3, 4, 3, 3, 2, 4, 4]), { m3: 3, viajes: 12, desde: 2, hasta: 4 })
  assert.equal(G.m3Sugerido([8, 8, 2, 3]), null)
  assert.equal(G.m3Sugerido([3, 3]), null)
  assert.equal(G.m3Sugerido([3.2, 3.4, 3.3]).m3, 3.5)
})

test("fila de la consulta: árido afuera; método del pedido, de la obra o directo", () => {
  const base = { plant_id_salida: CAN, construction_site_id: "x", min_en_planta: "30.5", min_ida: "24", min_obra: "78.1" }
  assert.equal(G.filaTiemposDeConsulta({ ...base, dispatches: { quantity_m3: "8", is_test_dispatch: true } }), null)
  const f = G.filaTiemposDeConsulta({ ...base, dispatches: { quantity_m3: "3.000", scheduled_dispatches: { metodo_descarga: "bomba" } }, construction_sites: { requires_pump: false } })
  assert.deepEqual(f, { plant_id_salida: CAN, construction_site_id: "x", min_en_planta: 30.5, min_ida: 24, min_obra: 78.1, m3: 3, metodo: "bomba" })
  assert.equal(G.filaTiemposDeConsulta({ ...base, dispatches: null, construction_sites: { requires_pump: true } }).metodo, "bomba")
  assert.equal(G.filaTiemposDeConsulta({ ...base, dispatches: { quantity_m3: 8 } }).metodo, "directo")
})

test("cargarTiemposGps: pagina, filtra, guarda 10 min y devuelve null si la tabla falla", async () => {
  let llamadas = 0, filtros = []
  const fila = (i) => ({ plant_id_salida: CAN, construction_site_id: "o", min_en_planta: 30, min_ida: 20, min_obra: 40, dispatches: { quantity_m3: 8 }, construction_sites: null, i })
  const sb = {
    from: () => {
      const q = { _r: null, select: () => q, eq: (c, v) => (filtros.push([c, v]), q), in: (c, v) => (filtros.push([c, v]), q), gte: (c, v) => (filtros.push([c, v]), q), order: () => q,
        range: (a, b) => { llamadas++; return Promise.resolve({ data: veces(Math.max(0, Math.min(b, 1499) - a + 1), (k) => fila(a + k)), error: null }) } }
      return q
    },
  }
  const t = await G.cargarTiemposGps(sb, { refrescar: true, hoy: "2026-10-08" })
  assert.equal(llamadas, 2) // 1500 filas en dos páginas
  assert.equal(t.plantas[CAN].enPlanta.viajes, 1500)
  assert.equal(t.desde, "2026-07-10")
  assert.deepEqual(filtros.slice(0, 3), [["estado", "completo"], ["confianza", ["alta", "media"]], ["fecha", "2026-07-10"]])
  await G.cargarTiemposGps(sb)
  assert.equal(llamadas, 2) // de la caché
  const roto = { from: () => { const q = { select: () => q, eq: () => q, in: () => q, gte: () => q, order: () => q, range: () => Promise.resolve({ data: null, error: { message: "no existe viajes_gps" } }) }; return q } }
  assert.equal(await G.cargarTiemposGps(roto, { refrescar: true }), null)
})

test("descarga por 8 m³ desde el tiempo en obra (sin contar el lavado dos veces) y espera en planta", () => {
  assert.equal(V.descarga8DeObra(78, 3, 1), 205) // (78 − 1) × 8 / 3
  assert.equal(V.descarga8DeObra(41, 8, 10), 31)
  assert.equal(V.descarga8DeObra(6, 8, 10), 5) // mínimo 5
  assert.equal(V.esperaDePlanta(31, 15), 16)
  assert.equal(V.esperaDePlanta(8, 10), 0)
})

const TIEMPOS = G.calcularTiemposGps([
  ...veces(12, (i) => F({ min_obra: 78, m3: [3, 3, 4, 2][i % 4], min_ida: 24 })), // CORDONES desde Canning
  ...veces(20, (i) => F({ construction_site_id: `com${i % 2}`, min_en_planta: 31, min_obra: 26, m3: 8, min_ida: 22 })),
])

test("parámetros con el GPS: descarga directa y espera reales; sin datos, los mismos", () => {
  const p = V.parametrosConGps(PRM_CAN, CAN, TIEMPOS)
  assert.equal(p.esperaPlantaMin, 31 - 15)
  assert.equal(p.cargaMin, 15) // la boca sigue ocupada solo la carga
  assert.equal(p.descargaDirectaMin, V.descarga8DeObra(TIEMPOS.plantas[CAN].directo.min, TIEMPOS.plantas[CAN].directo.m3, 1))
  assert.equal(p.descargaBombaMin, PRM_CAN.descargaBombaMin) // sin viajes con bomba: la de la planta
  assert.equal(V.parametrosConGps(PRM_CAN, HUD, TIEMPOS), PRM_CAN)
  assert.equal(V.parametrosConGps(PRM_CAN, CAN, null), PRM_CAN)
})

const PED = { id: "P", plant_id: CAN, construction_site_id: "obra1", quantity_m3: 12, dispatched_m3: 0, scheduled_arrival_time: new Date(2026, 9, 9, 8, 0).toISOString(), metodo_descarga: "directo", m3_por_viaje: 3, construction_sites: { travel_time_minutes: 30 } }

test("elección de la fuente: pedido > real de la obra > planta > obra / referencia", () => {
  let td = V.tiemposDelPedido(PED, PRM_CAN, TIEMPOS)
  assert.deepEqual(td.viaje, { min: 24, fuente: "gps_obra", viajes: 12 })
  assert.equal(td.descarga.fuente, "gps_obra")
  assert.equal(td.descarga.min, 205)
  assert.equal(td.enPlanta.fuente, "gps_planta")
  assert.deepEqual([td.enPlanta.min, td.enPlanta.carga, td.enPlanta.espera], [31, 15, 16])
  assert.equal(V.textoFuente(td.viaje), "real GPS · 12 viajes")
  assert.ok(V.textoDescargaObra(td).startsWith("En esta obra cada camión estuvo 78 min (con 3 m³"))
  // A mano gana siempre
  td = V.tiemposDelPedido({ ...PED, viaje_min: 35, descarga_min: 60 }, PRM_CAN, TIEMPOS)
  assert.deepEqual([td.viaje.min, td.viaje.fuente, td.descarga.min, td.descarga.fuente], [35, "pedido", 60, "a_mano"])
  assert.equal(V.textoFuente(td.descarga), "cargado a mano")
  // Obra sin datos: la planta (real) y el viaje de la obra
  td = V.tiemposDelPedido({ ...PED, construction_site_id: "nueva" }, PRM_CAN, TIEMPOS)
  assert.equal(td.descarga.fuente, "gps_planta")
  assert.ok(V.textoFuente(td.descarga).startsWith("promedio de la planta · "))
  assert.deepEqual(td.viaje, { min: 30, fuente: "obra" })
  // Sin GPS: todo como antes
  td = V.tiemposDelPedido({ ...PED, construction_sites: null }, PRM_CAN, null)
  assert.deepEqual([td.viaje, td.descarga.fuente, td.descarga.min, td.enPlanta.fuente], [{ min: 30, fuente: "referencia" }, "planta", 25, "planta"])
  // Con bomba y sin viajes con bomba en la planta: la de la planta
  assert.equal(V.tiemposDelPedido({ ...PED, construction_site_id: "nueva", metodo_descarga: "bomba" }, PRM_CAN, TIEMPOS).descarga.fuente, "planta")
})

test("m³ sugeridos solo si difieren de los del pedido", () => {
  const td = V.tiemposDelPedido(PED, PRM_CAN, TIEMPOS)
  assert.equal(V.m3ParaSugerir(td, 3), null)
  assert.equal(V.m3ParaSugerir(td, 8).m3, 3)
  assert.equal(V.m3ParaSugerir(td, null).m3, 3) // vacío = 8
})

test("viajes de CORDONES con los tiempos reales: 4 × 3 m³, 78 min en obra, uno cada 77", () => {
  const prm = V.parametrosConGps(PRM_CAN, CAN, TIEMPOS)
  const ped = V.conTiemposGps(PED, prm, TIEMPOS)
  assert.equal(V.viajeMinDe(ped), 24)
  assert.equal(V.descarga8De(ped, prm), 205)
  const vs = V.generarViajes(ped, prm)
  assert.deepEqual(vs.map((v) => v.m3), [3, 3, 3, 3])
  for (const v of vs) {
    assert.equal(dif(v.hora_llegada, v.hora_fin_descarga) + prm.lavadoMin, 78) // descarga + lavado = en obra real
    assert.equal(dif(v.hora_salida, v.hora_llegada), 24)
    assert.equal(dif(v.hora_carga, v.hora_salida), 15)
  }
  assert.equal(dif(vs[0].hora_llegada, vs[1].hora_llegada), 77)
  // Lo del pedido gana: viaje 35 y descarga 25 por 8 m³
  const amano = V.generarViajes(V.conTiemposGps({ ...PED, viaje_min: 35, descarga_min: 25 }, prm, TIEMPOS), prm)
  assert.equal(dif(amano[0].hora_salida, amano[0].hora_llegada), 35)
  assert.equal(dif(amano[0].hora_llegada, amano[0].hora_fin_descarga), 9) // 25 × 3 / 8
})

test("explicarFlota con el tiempo en planta real; sin GPS el texto de siempre", () => {
  const prm = V.parametrosConGps(PRM_CAN, CAN, TIEMPOS)
  const f = V.explicarFlota(V.conTiemposGps(PED, prm, TIEMPOS), prm, 4)
  assert.equal(f.espera, 16)
  // Con camiones de 3 m³ (los del pedido): descarga 77 por camión
  assert.equal(f.ciclo, 15 + 16 + 24 + 77 + 1 + 24)
  assert.equal(f.texto, "Ciclo: en planta 31 (carga 15 + espera 16) + ida 24 + descarga 77 (3 m³) + lavado 1 + vuelta 24 = 157 min · un camión cada 77 min → para no cortar el hormigonado hacen falta 3 camiones")
  const sin = V.explicarFlota({ ...PED, m3_por_viaje: null, construction_sites: { travel_time_minutes: 25 }, metodo_descarga: "bomba" }, P.PARAMETROS_BASE, 5)
  assert.equal(sin.texto, "Ciclo: carga 10 + ida 25 + descarga 15 + lavado 10 + vuelta 25 = 85 min · un camión cada 15 min → para no cortar el hormigonado hacen falta 5 camiones")
})

test("planificador: espera 0 = sin espera (300 días al azar)", () => {
  let seed = 11
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let k = 0; k < 300; k++) {
    const ps = veces(1 + Math.floor(rnd() * 5), (i) => ({ id: "p" + i, cliente: "", obra: "", m3: Math.round(rnd() * 50) + 1, llegada: 420 + Math.floor(rnd() * 500), viajeMin: 10 + Math.floor(rnd() * 50), conBomba: rnd() > 0.5 }))
    const cs = veces(1 + Math.floor(rnd() * 5), (i) => ({ id: "c" + i, patente: "c" + i, capacidad: 8 }))
    const oc = rnd() > 0.5 ? [{ camionId: "c0", desde: 500, hasta: 600 }] : []
    assert.equal(JSON.stringify(P.planificar(ps, cs, { ...P.PARAMETROS_BASE, esperaPlantaMin: 0 }, oc)), JSON.stringify(P.planificar(ps, cs, P.PARAMETROS_BASE, oc)))
  }
})

test("planificador: con espera el camión no vuelve a cargar antes, pero la boca no se ocupa", () => {
  const prm = { ...P.PARAMETROS_BASE, esperaPlantaMin: 20 }
  // Un camión, dos viajes seguidos: el 2.º carga recién vuelta + 20
  const uno = P.planificar([{ id: "a", cliente: "", obra: "", m3: 16, llegada: 480, viajeMin: 20, conBomba: true }], [{ id: "c", patente: "c", capacidad: 8 }], prm)
  assert.equal(uno.viajes[1].inicioCarga - uno.viajes[0].vuelta, 20)
  assert.equal(uno.pedidos[0].cicloMin, 10 + 20 + 20 + 15 + 10 + 20)
  // Dos camiones: el segundo carga apenas termina la carga del primero (la espera no ocupa la boca)
  const dos = P.planificar([{ id: "a", cliente: "", obra: "", m3: 16, llegada: 480, viajeMin: 20, conBomba: true }], [{ id: "c1", patente: "c1", capacidad: 8 }, { id: "c2", patente: "c2", capacidad: 8 }], prm)
  assert.equal(dos.viajes[1].inicioCarga - dos.viajes[0].inicioCarga, 15)
  assert.notEqual(dos.viajes[0].camionId, dos.viajes[1].camionId)
  // Un camión ocupado en otro viaje (fuera del plan) también espera al volver
  const oc = P.planificar([{ id: "a", cliente: "", obra: "", m3: 8, llegada: 480, viajeMin: 20, conBomba: true }], [{ id: "c", patente: "c", capacidad: 8 }], prm, [{ camionId: "c", desde: 400, hasta: 450 }])
  assert.ok(oc.viajes[0].inicioCarga >= 470, String(oc.viajes[0].inicioCarga))
})
