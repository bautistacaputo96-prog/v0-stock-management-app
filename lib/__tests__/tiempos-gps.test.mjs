// Pruebas de los tiempos reales del GPS en la programación (docs/migracion-loop/tiempos-gps-programacion.md):
// medianas y filtros (lib/gps-viajes.ts), elección de la fuente y paso a los parámetros del planificador
// (lib/viajes.ts), espera en planta y tiempos a mano (lib/planificador.ts). Sin base ni red.
import { test } from "node:test"
import assert from "node:assert/strict"
import * as G from "../gps-viajes.ts"
import * as V from "../viajes.ts"
import * as P from "../planificador.ts"

const CAN = "can", HUD = "hud"
// Por defecto los viajes se reparten en dos días (la obra pide 2 días distintos) y sin camión (no se descarta el primero)
let k = 0
const F = (o = {}) => ({ plant_id_salida: CAN, construction_site_id: "obra1", min_en_planta: 30, min_ida: 24, min_obra: 78, m3: 3, metodo: "directo", fecha: k++ % 2 ? "2026-10-01" : "2026-10-02", ...o })
const veces = (n, f) => Array.from({ length: n }, (_, i) => f(i))
const MIN = 60_000
const dif = (a, b) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / MIN)
// Canning después de la migración 202610081800: carga 15, lavado 0
const PRM_CAN = { ...P.PARAMETROS_BASE, cargaMin: 15, lavadoMin: 0, aMano: {} }

test("mediana: impar, par, vacía, ignora no numéricos", () => {
  assert.equal(G.mediana([5, 1, 3]), 3)
  assert.equal(G.mediana([4, 1, 3, 2]), 2.5)
  assert.equal(G.mediana([]), null)
  assert.equal(G.mediana([NaN, 2, Infinity, 4]), 3)
})

test("por obra: 3 viajes o más; ida por planta; obra con sus m³ y métodos; filtra absurdos", () => {
  const filas = [
    F({ min_obra: 70, m3: 3 }), F({ min_obra: 78, m3: 3 }), F({ min_obra: 90, m3: 4, min_ida: 26 }),
    F({ min_obra: 6, m3: 8 }), // parada de 6 min: no es una descarga
    F({ min_obra: 300, min_ida: 500 }), // absurdos
    F({ plant_id_salida: HUD, min_ida: 40 }), F({ plant_id_salida: HUD, min_ida: 42, metodo: "bomba" }), // solo 2 desde Hudson
    F({ construction_site_id: "obra2" }), F({ construction_site_id: "obra2" }), // 2 viajes: no alcanza
    F({ construction_site_id: null }),
  ]
  const t = G.calcularTiemposGps(filas, "2026-07-10")
  const o = t.obras.obra1
  assert.deepEqual(o.ida[CAN], { min: 24, viajes: 4 }) // 24, 24, 26, 24 (la de 500 no)
  assert.equal(o.ida[HUD], undefined)
  // obra: 70,78,90 + los 2 de Hudson (78,78) → mediana 78; m³ 3,3,4,3,3 → 3; uno con bomba
  assert.deepEqual(o.obra, { min: 78, viajes: 5, m3: 3, bomba: 1, directo: 4 })
  assert.equal(t.obras.obra2, undefined)
  assert.equal(t.desde, "2026-07-10")
})

test("obra: la ida y el tiempo en obra piden viajes de 2 días distintos (Etcheverry: 113 min de un solo día)", () => {
  const unDia = G.calcularTiemposGps(veces(3, () => F({ construction_site_id: "etch", min_ida: 113, min_obra: 31, m3: 8, fecha: "2026-09-20" }))).obras.etch
  assert.deepEqual(unDia.ida, {})
  assert.equal(unDia.obra, null)
  assert.equal(unDia.m3.m3, 8) // la sugerencia de m³ sale de los remitos, no pide días
  const dosDias = G.calcularTiemposGps([...veces(2, () => F({ construction_site_id: "etch", fecha: "2026-09-20" })), F({ construction_site_id: "etch", fecha: "2026-09-21" })]).obras.etch
  assert.ok(dosDias.ida[CAN] && dosDias.obra)
})

test("obra que el GPS no ve bien (paradas cortas en la mayoría): sin ida ni descarga propias", () => {
  const filas = [...veces(5, () => F({ construction_site_id: "pav", min_obra: 5, min_ida: 40, m3: 8 })), ...veces(3, () => F({ construction_site_id: "pav", min_obra: 15, m3: 8 }))]
  const o = G.calcularTiemposGps(filas).obras.pav
  assert.deepEqual(o.ida, {})
  assert.equal(o.obra, null)
  assert.equal(o.m3.m3, 8)
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
  assert.equal(t.plantas[CAN].enPlanta.viajes, 21) // 12 + 9; la de 400 min se descarta
  assert.ok(t.plantas[CAN].directo.viajes >= 10)
  assert.equal(t.plantas[CAN].bomba, null) // 9 viajes con bomba: no alcanza
  assert.equal(t.plantas[HUD].enPlanta, null) // 5 viajes
  // Con 10 con bomba (Canning tiene 18) sí se usa, con su cantidad de viajes
  const b = G.calcularTiemposGps(veces(10, (i) => F({ construction_site_id: `b${i}`, metodo: "bomba", min_obra: 38, m3: 8 }))).plantas[CAN].bomba
  assert.deepEqual([b.min, b.viajes], [38, 10])
})

test("tiempo en planta: sin el primer viaje del día de cada camión ni los que no tienen llegada previa del mismo día", () => {
  const dia = (fecha, mixer, enPlanta) => enPlanta.map((m, i) => F({ mixer_id: mixer, fecha, salida_planta: `${fecha}T${10 + i}:00:00Z`, llegada_planta_previa: `${fecha}T${String(9 + i).padStart(2, "0")}:30:00Z`, min_en_planta: m }))
  const filas = [
    ...dia("2026-10-01", "m1", [66, 25, 24, 26]), // 66 = desde que arrancó el motor
    ...dia("2026-10-01", "m2", [70, 25, 25]),
    ...dia("2026-10-02", "m1", [65, 24, 26, 25]),
    F({ mixer_id: "m3", fecha: "2026-10-02", salida_planta: "2026-10-02T11:00:00Z", llegada_planta_previa: "2026-10-02T10:00:00Z", min_en_planta: 25 }),
    F({ mixer_id: "m3", fecha: "2026-10-02", salida_planta: "2026-10-02T12:00:00Z", llegada_planta_previa: null, min_en_planta: 90 }), // sin llegada previa
    F({ mixer_id: "m3", fecha: "2026-10-02", salida_planta: "2026-10-02T13:00:00Z", llegada_planta_previa: "2026-10-01T22:00:00Z", min_en_planta: 95 }), // de otro día
  ]
  const fuera = G.noCuentaEnPlanta(filas)
  assert.deepEqual(filas.filter((f) => fuera.has(f)).map((f) => f.min_en_planta).sort(), [25, 65, 66, 70, 90, 95].sort())
  const t = G.calcularTiemposGps(filas, "", { ...G.TIEMPOS_GPS, minViajesPlanta: 5 })
  assert.deepEqual(t.plantas[CAN].enPlanta, { min: 25, viajes: 8 }) // sin descartar daría 25,5 con los de 65–95 adentro
})

test("m³ sugeridos: patrón claro (CORDONES) sí; mezclado no; pocos no", () => {
  assert.deepEqual(G.m3Sugerido([3, 3, 4, 2, 3, 3, 4, 3, 3, 2, 4, 4]), { m3: 3, viajes: 12, desde: 2, hasta: 4 })
  assert.equal(G.m3Sugerido([8, 8, 2, 3]), null)
  assert.equal(G.m3Sugerido([3, 3]), null)
  assert.equal(G.m3Sugerido([3.2, 3.4, 3.3]).m3, 3.5)
})

test("fila de la consulta: árido afuera; método del pedido, de la obra o directo; camión y día", () => {
  const base = { plant_id_salida: CAN, construction_site_id: "x", min_en_planta: "30.5", min_ida: "24", min_obra: "78.1" }
  assert.equal(G.filaTiemposDeConsulta({ ...base, dispatches: { quantity_m3: "8", is_test_dispatch: true } }), null)
  const f = G.filaTiemposDeConsulta({ ...base, mixer_id: "m1", fecha: "2026-10-02", salida_planta: "2026-10-02T10:00:00Z", llegada_planta_previa: null, dispatches: { quantity_m3: "3.000", scheduled_dispatches: { metodo_descarga: "bomba" } }, construction_sites: { requires_pump: false } })
  assert.deepEqual(f, { plant_id_salida: CAN, construction_site_id: "x", min_en_planta: 30.5, min_ida: 24, min_obra: 78.1, m3: 3, metodo: "bomba", mixer_id: "m1", fecha: "2026-10-02", salida_planta: "2026-10-02T10:00:00Z", llegada_planta_previa: null })
  assert.equal(G.filaTiemposDeConsulta({ ...base, dispatches: null, construction_sites: { requires_pump: true } }).metodo, "bomba")
  assert.equal(G.filaTiemposDeConsulta({ ...base, dispatches: { quantity_m3: 8 } }).llegada_planta_previa, undefined)
})

const sbFalso = (rango) => ({ from: () => { const q = { select: () => q, eq: () => q, in: () => q, gte: () => q, order: () => q, range: rango }; return q } })

test("cargarTiemposGps: pagina, filtra, guarda 10 min; null sin guardar si falla, tarda o viene vacía", async () => {
  let llamadas = 0, filtros = []
  const fila = (i) => ({ plant_id_salida: CAN, construction_site_id: "o", min_en_planta: 30, min_ida: 20, min_obra: 40, dispatches: { quantity_m3: 8 }, construction_sites: null, i })
  const sb = {
    from: () => {
      const q = { select: () => q, eq: (c, v) => (filtros.push([c, v]), q), in: (c, v) => (filtros.push([c, v]), q), gte: (c, v) => (filtros.push([c, v]), q), order: () => q,
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
  assert.equal(await G.cargarTiemposGps(sbFalso(() => Promise.resolve({ data: null, error: { message: "no existe viajes_gps" } })), { refrescar: true }), null)
  // Lectura vacía (RLS sin permiso): null y no queda en caché
  let vacias = 0
  const vacio = sbFalso(() => { vacias++; return Promise.resolve({ data: [], error: null }) })
  assert.equal(await G.cargarTiemposGps(vacio, { refrescar: true }), null)
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(await G.cargarTiemposGps(vacio), null)
  assert.equal(vacias, 2)
  // Demora: a los esperaMs sigue con null
  const t0 = Date.now()
  assert.equal(await G.cargarTiemposGps(sbFalso(() => new Promise(() => {})), { refrescar: true, esperaMs: 50 }), null)
  assert.ok(Date.now() - t0 < 1000)
  assert.equal(G.TIEMPOS_GPS.esperaLecturaMs, 3000)
})

test("descarga por 8 m³ desde el tiempo en obra (sin contar el lavado dos veces) y espera en planta", () => {
  assert.equal(V.descarga8DeObra(78, 3, 1), 205) // (78 − 1) × 8 / 3
  assert.equal(V.descarga8DeObra(78, 3, 0), 208) // lavado 0
  assert.equal(V.descarga8DeObra(41, 8, 10), 31)
  assert.equal(V.descarga8DeObra(6, 8, 10), 5) // mínimo 5
  assert.equal(V.esperaDePlanta(25, 15), 10)
  assert.equal(V.esperaDePlanta(8, 10), 0)
})

const TIEMPOS = G.calcularTiemposGps([
  ...veces(12, (i) => F({ min_obra: 78, m3: [3, 3, 4, 2][i % 4], min_ida: 24, min_en_planta: 25 })), // CORDONES desde Canning
  ...veces(20, (i) => F({ construction_site_id: `com${i % 2}`, min_en_planta: 25, min_obra: 30, m3: 8, min_ida: 22 })),
  ...veces(3, () => F({ construction_site_id: "huella", min_obra: 78, m3: 2, min_ida: 2, min_en_planta: 25 })), // La huella
])

test("parámetros con el GPS: descarga directa y espera reales; sin datos, los mismos", () => {
  const p = V.parametrosConGps(PRM_CAN, CAN, TIEMPOS)
  assert.equal(p.esperaPlantaMin, 25 - 15)
  assert.equal(p.cargaMin, 15) // la boca sigue ocupada solo la carga
  assert.equal(p.descargaDirectaMin, V.descarga8DeObra(TIEMPOS.plantas[CAN].directo.min, TIEMPOS.plantas[CAN].directo.m3, 0))
  assert.equal(p.descargaBombaMin, PRM_CAN.descargaBombaMin) // sin viajes con bomba: la de la planta
  assert.equal(V.parametrosConGps(PRM_CAN, HUD, TIEMPOS), PRM_CAN)
  assert.equal(V.parametrosConGps(PRM_CAN, CAN, null), PRM_CAN)
})

test("tiempos de la planta corregidos a mano: le ganan al GPS hasta volver a automático", () => {
  const conMano = { ...PRM_CAN, aMano: { esperaPlantaMin: 12, descargaDirectaMin: 35 } }
  const p = V.parametrosConGps(conMano, CAN, TIEMPOS)
  assert.deepEqual([p.esperaPlantaMin, p.descargaDirectaMin, p.descargaBombaMin], [12, 35, PRM_CAN.descargaBombaMin])
  assert.equal(V.parametrosConGps(conMano, HUD, null).descargaDirectaMin, 35) // sin GPS también
  const td = V.tiemposDelPedido({ ...PED, construction_site_id: "nueva" }, conMano, TIEMPOS)
  assert.deepEqual([td.descarga.min, td.descarga.fuente, td.enPlanta.min, td.enPlanta.fuente], [35, "planta_a_mano", 27, "planta_a_mano"])
  assert.equal(V.textoFuente(td.descarga), "cargado a mano en la planta")
  // Volver a automático = sacar la clave
  assert.equal(V.parametrosConGps({ ...PRM_CAN, aMano: {} }, CAN, TIEMPOS).descargaDirectaMin, V.parametrosConGps(PRM_CAN, CAN, TIEMPOS).descargaDirectaMin)
  // Columna plants.tiempos_a_mano ↔ parámetros
  assert.deepEqual(P.tiemposAManoDe({ espera_planta_min: 0, descarga_directa_min: 29.4, descarga_bomba_min: 0, otra: 3 }), { esperaPlantaMin: 0, descargaDirectaMin: 29 })
  assert.deepEqual(P.tiemposAManoAColumna({ esperaPlantaMin: 0, descargaBombaMin: 37 }), { espera_planta_min: 0, descarga_bomba_min: 37 })
  const pl = { t_carga_min: 15, t_lavado_min: 0, tiempos_a_mano: { descarga_directa_min: 30 } }
  assert.deepEqual(P.parametrosDePlanta(pl).aMano, { descargaDirectaMin: 30 })
  assert.equal(P.parametrosDePlanta(pl).lavadoMin, 0) // lavado 0 se respeta (no vuelve al 10 de referencia)
  assert.deepEqual(P.columnasDePlanta(P.parametrosDePlanta(pl)).tiempos_a_mano, { descarga_directa_min: 30 })
  // Sin la columna (migración sin aplicar) no se manda
  assert.equal("tiempos_a_mano" in P.columnasDePlanta(P.parametrosDePlanta({ t_carga_min: 15 })), false)
})

const PED = { id: "P", plant_id: CAN, construction_site_id: "obra1", quantity_m3: 12, dispatched_m3: 0, scheduled_arrival_time: new Date(2026, 9, 9, 8, 0).toISOString(), metodo_descarga: "directo", m3_por_viaje: 3, construction_sites: { travel_time_minutes: 30 } }

test("elección de la fuente: pedido > real de la obra > planta > obra / referencia", () => {
  let td = V.tiemposDelPedido(PED, PRM_CAN, TIEMPOS)
  assert.deepEqual(td.viaje, { min: 24, fuente: "gps_obra", viajes: 12 })
  assert.equal(td.descarga.fuente, "gps_obra")
  assert.equal(td.descarga.min, 208)
  assert.equal(td.enPlanta.fuente, "gps_planta")
  assert.deepEqual([td.enPlanta.min, td.enPlanta.carga, td.enPlanta.espera], [25, 15, 10])
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

test("descarga de la obra solo con m³ por camión parecidos (±1,5): La huella y CORDONES con 8 m³", () => {
  const prm = V.parametrosConGps(PRM_CAN, CAN, TIEMPOS)
  // La huella: 78 min con 2 m³ → 312 por 8 m³. Con 8 m³ por camión no se usa: la de la planta
  const huella8 = { ...PED, construction_site_id: "huella", m3_por_viaje: 8 }
  assert.equal(V.conTiemposGps(huella8, prm, TIEMPOS).descarga_min_gps, null)
  let td = V.tiemposDelPedido(huella8, PRM_CAN, TIEMPOS)
  assert.equal(td.descarga.fuente, "gps_planta")
  assert.equal(td.descarga.min, prm.descargaDirectaMin)
  assert.deepEqual(td.descarga.obraNoAplica, { m3Obra: 2, m3Pedido: 8 })
  assert.equal(V.textoDescargaObra(td), "Esta obra suele llevar 2 m³; con 8 m³ por camión se usan los tiempos de la planta")
  const vs = V.generarViajes(V.conTiemposGps({ ...huella8, quantity_m3: 8 }, prm, TIEMPOS), prm)
  assert.equal(dif(vs[0].hora_llegada, vs[0].hora_fin_descarga), prm.descargaDirectaMin) // no 312
  // Con 2 m³ (o hasta 3,5) sí: cada camión 78 min
  const huella2 = { ...huella8, m3_por_viaje: 2, quantity_m3: 4 }
  assert.equal(V.conTiemposGps(huella2, prm, TIEMPOS).descarga_min_gps, 312)
  assert.equal(V.tiemposDelPedido({ ...huella8, m3_por_viaje: 3.5 }, PRM_CAN, TIEMPOS).descarga.fuente, "gps_obra")
  assert.equal(V.tiemposDelPedido({ ...huella8, m3_por_viaje: 3.6 }, PRM_CAN, TIEMPOS).descarga.fuente, "gps_planta")
  const v2 = V.generarViajes(V.conTiemposGps(huella2, prm, TIEMPOS), prm)
  assert.equal(dif(v2[0].hora_llegada, v2[0].hora_fin_descarga), 78)
  // CORDONES con 8 m³: planta + aviso
  td = V.tiemposDelPedido({ ...PED, m3_por_viaje: 8 }, PRM_CAN, TIEMPOS)
  assert.equal(V.textoDescargaObra(td), "Esta obra suele llevar 3 m³; con 8 m³ por camión se usan los tiempos de la planta")
})

test("el tiempo de obra avisa si mezcla bomba y directo", () => {
  assert.equal(V.textoMezclaMetodos({ min: 40, viajes: 5, m3: 8, bomba: 2, directo: 3 }), "mezcla viajes con bomba (2) y directos (3)")
  assert.equal(V.textoMezclaMetodos({ min: 40, viajes: 5, m3: 8, bomba: 0, directo: 5 }), null)
  const t = G.calcularTiemposGps([...veces(3, () => F({ construction_site_id: "mix", m3: 8, min_obra: 40 })), F({ construction_site_id: "mix", m3: 8, min_obra: 40, metodo: "bomba" })])
  const td = V.tiemposDelPedido({ ...PED, construction_site_id: "mix", m3_por_viaje: 8 }, PRM_CAN, t)
  assert.equal(V.textoDescargaObra(td), "En esta obra cada camión estuvo 40 min (con 8 m³, contando el lavado) · mezcla viajes con bomba (1) y directos (3)")
})

test("m³ sugeridos solo si difieren de los del pedido", () => {
  const td = V.tiemposDelPedido(PED, PRM_CAN, TIEMPOS)
  assert.equal(V.m3ParaSugerir(td, 3), null)
  assert.equal(V.m3ParaSugerir(td, 8).m3, 3)
  assert.equal(V.m3ParaSugerir(td, null).m3, 3) // vacío = 8
})

test("viajes de CORDONES con los tiempos reales y lavado 0: 4 × 3 m³, 78 min en obra, uno cada 78", () => {
  const prm = V.parametrosConGps(PRM_CAN, CAN, TIEMPOS)
  const ped = V.conTiemposGps(PED, prm, TIEMPOS)
  assert.equal(V.viajeMinDe(ped), 24)
  assert.equal(V.descarga8De(ped, prm), 208)
  const vs = V.generarViajes(ped, prm)
  assert.deepEqual(vs.map((v) => v.m3), [3, 3, 3, 3])
  for (const v of vs) {
    assert.equal(dif(v.hora_llegada, v.hora_fin_descarga), 78) // lavado 0: todo el tiempo en obra es descarga
    assert.equal(dif(v.hora_fin_descarga, v.hora_vuelta), 24) // sale de obra apenas termina
    assert.equal(dif(v.hora_salida, v.hora_llegada), 24)
    assert.equal(dif(v.hora_carga, v.hora_salida), 15)
  }
  assert.equal(dif(vs[0].hora_llegada, vs[1].hora_llegada), 78)
  // Lo del pedido gana: viaje 35 y descarga 25 por 8 m³
  const amano = V.generarViajes(V.conTiemposGps({ ...PED, viaje_min: 35, descarga_min: 25 }, prm, TIEMPOS), prm)
  assert.equal(dif(amano[0].hora_salida, amano[0].hora_llegada), 35)
  assert.equal(dif(amano[0].hora_llegada, amano[0].hora_fin_descarga), 9) // 25 × 3 / 8
})

test("explicarFlota con el tiempo en planta real; sin GPS el texto de siempre; camión / camiones", () => {
  const prm = V.parametrosConGps(PRM_CAN, CAN, TIEMPOS)
  const f = V.explicarFlota(V.conTiemposGps(PED, prm, TIEMPOS), prm, 4)
  assert.equal(f.espera, 10)
  assert.equal(f.ciclo, 15 + 10 + 24 + 78 + 0 + 24)
  assert.equal(f.texto, "Ciclo: en planta 25 (carga 15 + espera 10) + ida 24 + descarga 78 (3 m³) + lavado 0 + vuelta 24 = 151 min · un camión cada 78 min → para no cortar el hormigonado hacen falta 2 camiones")
  const sin = V.explicarFlota({ ...PED, m3_por_viaje: null, construction_sites: { travel_time_minutes: 25 }, metodo_descarga: "bomba" }, P.PARAMETROS_BASE, 5)
  assert.equal(sin.texto, "Ciclo: carga 10 + ida 25 + descarga 15 + lavado 10 + vuelta 25 = 85 min · un camión cada 15 min → para no cortar el hormigonado hacen falta 5 camiones")
  assert.ok(V.explicarFlota({ ...PED, m3_por_viaje: null }, P.PARAMETROS_BASE, 1).texto.endsWith("para no cortar el hormigonado hace falta 1 camión"))
})

test("planificador: espera 0 = sin espera (300 días al azar); lavado 0 funciona", () => {
  let seed = 11
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let k = 0; k < 300; k++) {
    const ps = veces(1 + Math.floor(rnd() * 5), (i) => ({ id: "p" + i, cliente: "", obra: "", m3: Math.round(rnd() * 50) + 1, llegada: 420 + Math.floor(rnd() * 500), viajeMin: 10 + Math.floor(rnd() * 50), conBomba: rnd() > 0.5 }))
    const cs = veces(1 + Math.floor(rnd() * 5), (i) => ({ id: "c" + i, patente: "c" + i, capacidad: 8 }))
    const oc = rnd() > 0.5 ? [{ camionId: "c0", desde: 500, hasta: 600 }] : []
    assert.equal(JSON.stringify(P.planificar(ps, cs, { ...P.PARAMETROS_BASE, esperaPlantaMin: 0 }, oc)), JSON.stringify(P.planificar(ps, cs, P.PARAMETROS_BASE, oc)))
  }
  const l0 = P.planificar([{ id: "a", cliente: "", obra: "", m3: 16, llegada: 480, viajeMin: 20, conBomba: true }], [{ id: "c", patente: "c", capacidad: 8 }], { ...P.PARAMETROS_BASE, lavadoMin: 0 })
  assert.equal(l0.viajes[0].salidaObra, l0.viajes[0].finDescarga)
  assert.equal(l0.pedidos[0].cicloMin, 10 + 20 + 15 + 0 + 20)
})

test("planificador: con espera el camión no vuelve a cargar antes, pero la boca no se ocupa", () => {
  const prm = { ...P.PARAMETROS_BASE, esperaPlantaMin: 20 }
  const uno = P.planificar([{ id: "a", cliente: "", obra: "", m3: 16, llegada: 480, viajeMin: 20, conBomba: true }], [{ id: "c", patente: "c", capacidad: 8 }], prm)
  assert.equal(uno.viajes[1].inicioCarga - uno.viajes[0].vuelta, 20)
  assert.equal(uno.pedidos[0].cicloMin, 10 + 20 + 20 + 15 + 10 + 20)
  const dos = P.planificar([{ id: "a", cliente: "", obra: "", m3: 16, llegada: 480, viajeMin: 20, conBomba: true }], [{ id: "c1", patente: "c1", capacidad: 8 }, { id: "c2", patente: "c2", capacidad: 8 }], prm)
  assert.equal(dos.viajes[1].inicioCarga - dos.viajes[0].inicioCarga, 15)
  assert.notEqual(dos.viajes[0].camionId, dos.viajes[1].camionId)
  const oc = P.planificar([{ id: "a", cliente: "", obra: "", m3: 8, llegada: 480, viajeMin: 20, conBomba: true }], [{ id: "c", patente: "c", capacidad: 8 }], prm, [{ camionId: "c", desde: 400, hasta: 450 }])
  assert.ok(oc.viajes[0].inicioCarga >= 470, String(oc.viajes[0].inicioCarga))
})
