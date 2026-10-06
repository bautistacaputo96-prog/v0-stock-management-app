// Pruebas de la Fase 4a (reconstrucción de viajes con el GPS) sobre días reales grabados.
// Correr: npm run test:gps   (node --experimental-strip-types --test, sin dependencias)
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import * as G from "../gps-viajes.ts"

const fx = JSON.parse(fs.readFileSync(new URL("../__fixtures__/gps-viajes-dias-reales.json", import.meta.url), "utf8"))
const PLANTAS = fx.plantas
const caso = (fecha, camion) => fx.casos.find((c) => c.fecha === fecha && c.camion === camion)
const mensajes = (c) =>
  G.mensajesDesdeWialon(c.mensajes.map(([t, y, x, s, ign, odo]) => ({ t, pos: { y, x, s }, p: { eng_ign_stat: ign, vhc_mileage: odo } })))
const viajesDe = (c) => G.reconstruirViajes(mensajes(c), PLANTAS, { unidad: c.camion }).filter((v) => v.fecha === c.fecha)
const hora = (iso) => (iso ? new Date(new Date(iso).getTime() - 3 * 3600e3).toISOString().slice(11, 16) : null)

// Ubicaciones vistas en B-Track para las obras del fixture (se usan como "obra ubicada")
const UBIC = {
  "obra-A": { lat: -34.8464, lng: -58.5889 }, // platea, Canning
  "obra-B": { lat: -34.7619, lng: -58.2364 },
  "obra-C": { lat: -34.7865, lng: -58.2523 },
  "obra-E": { lat: -34.8563, lng: -58.59 },
  "obra-F": { lat: -34.8472, lng: -58.5898 },
}
const conUbicacion = (ds) => ds.map((d) => ({ ...d, obra: UBIC[d.construction_site_id] || null }))

function sinAbsurdos(v) {
  for (const k of ["min_ida", "min_obra", "min_vuelta", "ciclo_min", "min_en_planta", "km_ida", "km_vuelta"]) {
    if (v[k] != null) assert.ok(v[k] >= 0, `${k} negativo`)
  }
  if (v.ciclo_min != null) assert.ok(v.ciclo_min > 20 && v.ciclo_min < 12 * 60, `ciclo absurdo ${v.ciclo_min}`)
  assert.ok(v.salida_planta < (v.llegada_obra ?? "9"))
  if (v.llegada_obra && v.salida_obra) assert.ok(v.llegada_obra <= v.salida_obra)
  if (v.salida_obra && v.llegada_planta) assert.ok(v.salida_obra < v.llegada_planta)
}

test("02/10 AE402HE (Canning, H17 a la platea): 6 viajes, 6 remitos, horarios razonables", () => {
  const c = caso("2026-10-02", "AE402HE")
  const vs = viajesDe(c)
  assert.equal(vs.length, 6)
  vs.forEach(sinAbsurdos)
  assert.deepEqual(vs.map((v) => hora(v.salida_planta)), ["07:16", "10:13", "12:11", "14:37", "16:12", "17:55"])
  assert.ok(vs.every((v) => v.estado === "completo" && v.plant_id_salida === "CAN" && v.plant_id_vuelta === "CAN"))
  // Todas las paradas principales en la platea (~22 km de la planta)
  for (const v of vs) {
    assert.ok(G.distanciaKm({ lat: v.parada_lat, lng: v.parada_lng }, UBIC["obra-A"]) < 0.1)
    assert.ok(v.km_ida > 20 && v.km_ida < 25)
  }
  // Primer viaje: pasó la noche en planta; el tiempo en planta arranca con el motor (no 14 h)
  assert.ok(vs[0].min_en_planta < 60)
  assert.ok(vs[0].min_motor_parado_planta <= vs[0].min_en_planta)

  // Cruce sin ubicación: por orden, confianza media
  const sin = G.cruzarConDespachos(vs, c.despachos)
  assert.deepEqual(sin.viajes.map((v) => v.dispatch_id), c.despachos.map((d) => d.id))
  assert.ok(sin.viajes.every((v) => v.confianza === "media"))
  assert.deepEqual(sin.remitosSinViaje, [])

  // Con la obra ubicada: confianza alta
  const con = G.cruzarConDespachos(vs, conUbicacion(c.despachos))
  assert.ok(con.viajes.every((v) => v.confianza === "alta"))
})

test("02/10 AG083GT: remito de otra planta sin viaje, tanda reordenada por la obra, último viaje incompleto", () => {
  const c = caso("2026-10-02", "AG083GT")
  const vs = viajesDe(c)
  assert.equal(vs.length, 4)
  vs.forEach(sinAbsurdos)
  assert.equal(vs[3].estado, "incompleto")
  assert.equal(vs[3].llegada_planta, null)

  // Sin ubicaciones: el remito de Canning (planta distinta) queda sin viaje; el resto por orden y con confianza baja
  const sin = G.cruzarConDespachos(vs, c.despachos)
  assert.deepEqual(sin.remitosSinViaje, ["2026-10-02-AG083GT-1"])
  assert.deepEqual(sin.viajes.map((v) => v.dispatch_id), ["2026-10-02-AG083GT-2", "2026-10-02-AG083GT-3", "2026-10-02-AG083GT-4", "2026-10-02-AG083GT-5"])
  assert.ok(sin.viajes.every((v) => v.confianza === "baja"))

  // 755 y 756 se cargaron en el mismo minuto: con las obras ubicadas se corrige el orden
  const con = G.cruzarConDespachos(vs, conUbicacion(c.despachos))
  assert.equal(con.viajes[0].dispatch_id, "2026-10-02-AG083GT-3")
  assert.equal(con.viajes[1].dispatch_id, "2026-10-02-AG083GT-2")
  assert.equal(con.viajes[0].confianza, "alta")
  assert.equal(con.viajes[1].confianza, "alta")
})

test("26/09 AE402HE: horas de despacho falsas (12:00 del manual) → manda el número de remito", () => {
  const c = caso("2026-09-26", "AE402HE")
  const vs = viajesDe(c)
  assert.equal(vs.length, 4)
  vs.forEach(sinAbsurdos)
  const r = G.cruzarConDespachos(vs, c.despachos)
  const remito = (id) => c.despachos.find((d) => d.id === id).remito
  assert.deepEqual(r.viajes.map((v) => remito(v.dispatch_id)), ["0800", "0803", "0810", "0814"])
  // y coincide con dónde paró cada viaje
  const con = G.cruzarConDespachos(vs, conUbicacion(c.despachos))
  assert.ok(con.viajes.every((v) => v.confianza === "alta"))
})

test("26/09 AG083GT: traslado Hudson→Canning sin remito, guardado de noche fuera de planta", () => {
  const c = caso("2026-09-26", "AG083GT")
  const vs = viajesDe(c)
  assert.equal(vs.length, 5)
  vs.forEach(sinAbsurdos)
  assert.equal(vs[0].plant_id_salida, "HUD")
  assert.equal(vs[0].plant_id_vuelta, "CAN")
  // El último viaje no vuelve a planta: termina al guardarse; la obra es la de la entrega, no el guardado
  const ult = vs[4]
  assert.equal(ult.estado, "incompleto")
  assert.ok(ult.min_obra < 180, `obra ${ult.min_obra}`)
  assert.ok(G.distanciaKm({ lat: ult.parada_lat, lng: ult.parada_lng }, UBIC["obra-F"]) < 0.2)

  const r = G.cruzarConDespachos(vs, conUbicacion(c.despachos))
  assert.equal(r.viajes[0].dispatch_id, null) // traslado
  const remito = (id) => c.despachos.find((d) => d.id === id)?.remito
  assert.deepEqual(r.viajes.slice(1).map((v) => remito(v.dispatch_id)), ["0801", "0804", "0812", "0816"])
  assert.ok(r.viajes.slice(1).every((v) => v.confianza === "alta"))
})

test("sin mensajes o día sin trabajo: no hay viajes y no rompe", () => {
  assert.deepEqual(G.reconstruirViajes([], PLANTAS), [])
  assert.deepEqual(G.mensajesDesdeWialon(undefined), [])
  // Camión quieto en planta todo el día (mensajes cada hora, motor apagado)
  const t0 = G.inicioDiaAR("2026-10-01")
  const quieto = Array.from({ length: 24 }, (_, h) => ({ t: t0 + h * 3600, lat: -34.97395, lng: -58.46595, vel: 0, ign: false, odo: 1000 }))
  assert.deepEqual(G.reconstruirViajes(quieto, PLANTAS), [])
  // Sin despachos: los viajes quedan sin remito
  const r = G.cruzarConDespachos(viajesDe(caso("2026-10-02", "AE402HE")), [])
  assert.ok(r.viajes.every((v) => v.dispatch_id === null && v.confianza === null))
})

test("salir y volver sin parar no es viaje; hueco sin señal en movimiento deja incompleto", () => {
  const t0 = G.inicioDiaAR("2026-10-03") + 8 * 3600
  const planta = { lat: -34.973882, lng: -58.466128 }
  const p = (min, dLat, vel, ign = true) => ({ t: t0 + min * 60, lat: planta.lat + dLat, lng: planta.lng, vel, ign, odo: null })
  // Vuelta a la manzana de 10 min sin paradas
  const vuelta = [p(0, 0, 0), p(2, 0.004, 30), p(4, 0.01, 30), p(6, 0.015, 30), p(8, 0.006, 30), p(10, 0, 0)]
  assert.equal(G.reconstruirViajes(vuelta, PLANTAS).length, 0)
  // Viaje con parada de 30 min y un hueco de 40 min mientras se mueve
  const conHueco = [
    p(0, 0, 0), p(2, 0.01, 40), p(10, 0.05, 40), p(12, 0.06, 0), ...Array.from({ length: 15 }, (_, k) => p(14 + k * 2, 0.06, 0)),
    p(45, 0.055, 40), p(85, 0.01, 40), p(88, 0, 0),
  ]
  const vs = G.reconstruirViajes(conHueco, PLANTAS)
  assert.equal(vs.length, 1)
  assert.equal(vs[0].estado, "incompleto")
  assert.ok(vs[0].min_obra >= 30)
})

test("alinear: misma cantidad → por orden; distinta → deja sueltos los que no encajan", () => {
  const vs = viajesDe(caso("2026-10-02", "AE402HE"))
  const ds = caso("2026-10-02", "AE402HE").despachos
  assert.deepEqual(G.alinear(vs, ds), [0, 1, 2, 3, 4, 5])
  const r = G.cruzarConDespachos(vs, ds.slice(0, 5))
  assert.equal(r.viajes.filter((v) => v.dispatch_id === null).length, 1)
  assert.ok(r.viajes.filter((v) => v.dispatch_id).every((v) => v.confianza === "baja"))
})

test("ordenarDespachos: el número de remito ordena dentro de cada planta", () => {
  const ds = [
    { id: "a", hora: "2026-09-26T15:00:00Z", remito: "0810", plant_id: "CAN" },
    { id: "b", hora: "2026-09-26T11:52:00Z", remito: "0800", plant_id: "CAN" },
    { id: "c", hora: "2026-09-26T15:20:00Z", remito: "0803", plant_id: "CAN" },
    { id: "d", hora: "2026-09-26T13:00:00Z", remito: "754 HUDSON", plant_id: "HUD" },
  ]
  assert.deepEqual(G.ordenarDespachos(ds).map((d) => d.id), ["b", "d", "c", "a"])
  // Si algún remito no tiene número, queda el orden por hora
  ds[0].remito = "s/n"
  assert.deepEqual(G.ordenarDespachos(ds).map((d) => d.id), ["b", "d", "a", "c"])
})

test("ubicación aprendida: ≥3 paradas que coinciden (cualquier día) o 2 de días distintos; nunca pisa una manual", () => {
  const P1 = { lat: -34.8463, lng: -58.5889 }, P2 = { lat: -34.8465, lng: -58.589 }, P3 = { lat: -34.8464, lng: -58.5888 }
  const lejos = { lat: -34.9, lng: -58.3 }
  const u = G.ubicacionAprendida([{ ...P1, fecha: "2026-10-01" }, { ...P2, fecha: "2026-10-02" }, { ...P3, fecha: "2026-10-02" }, { ...lejos, fecha: "2026-10-02" }])
  assert.ok(u && Math.abs(u.lat + 34.8464) < 0.0002 && u.viajes === 3)
  // 3 paradas del mismo día: alcanza (obra de un solo hormigonado)
  assert.ok(G.ubicacionAprendida([P1, P2, P3].map((p) => ({ ...p, fecha: "2026-10-02" }))))
  // 2 paradas: solo si son de días distintos
  assert.ok(G.ubicacionAprendida([{ ...P1, fecha: "2026-10-01" }, { ...P2, fecha: "2026-10-02" }]))
  assert.equal(G.ubicacionAprendida([{ ...P1, fecha: "2026-10-02" }, { ...P2, fecha: "2026-10-02" }]), null)
  assert.equal(G.ubicacionAprendida([{ ...P1, fecha: "2026-10-02" }]), null)
  // Que no coinciden (a más de 200 m): no alcanza
  const a300 = { lat: -34.8437, lng: -58.5889 } // ~300 m al norte
  assert.equal(G.ubicacionAprendida([P1, a300, lejos].map((p) => ({ ...p, fecha: "2026-10-02" }))), null)
  // Sin mayoría: no alcanza
  assert.equal(G.ubicacionAprendida([P1, P2, P3, lejos, lejos, lejos].map((p, k) => ({ ...p, fecha: `2026-10-0${1 + (k % 2)}` }))), null)
  assert.equal(G.sePuedeAprender({ gps_lat: null, gps_source: null }), true)
  assert.equal(G.sePuedeAprender({ gps_lat: -34.8, gps_source: "gps_aprendido" }), true)
  assert.equal(G.sePuedeAprender({ gps_lat: -34.8, gps_source: "manual" }), false)
  assert.equal(G.sePuedeAprender({ gps_lat: -34.8, gps_source: null }), false)
})

test("02/10 la platea (un solo día, AE402HE) se aprende con sus paradas coincidentes", () => {
  const c = caso("2026-10-02", "AE402HE")
  const r = G.cruzarConDespachos(viajesDe(c), c.despachos)
  const filas = r.viajes.map((v) => G.aFila(v, "m1"))
  const ps = G.paradasParaAprender({ gps_lat: null, gps_source: null }, filas)
  assert.equal(ps.length, 6)
  const u = G.ubicacionAprendida(ps)
  assert.ok(u && u.viajes === 6 && u.dias === 1)
  assert.ok(G.distanciaKm(u, UBIC["obra-A"]) < 0.05)
})

test("paradas para aprender: sin ubicación solo 'media'; aprendida se recalcula con todos los viajes con remito; manual nunca", () => {
  const vs = [
    { dispatch_id: "a", confianza: "media", parada_lat: -34.1, parada_lng: -58.1, fecha: "2026-10-01" },
    { dispatch_id: "b", confianza: "baja", parada_lat: -34.2, parada_lng: -58.2, fecha: "2026-10-01" },
    { dispatch_id: "c", confianza: "alta", parada_lat: -34.3, parada_lng: -58.3, fecha: "2026-10-02" },
    { dispatch_id: null, confianza: null, parada_lat: -34.4, parada_lng: -58.4, fecha: "2026-10-02" },
  ]
  assert.deepEqual(G.paradasParaAprender({ gps_lat: null, gps_source: null }, vs).map((p) => p.lat), [-34.1])
  assert.deepEqual(G.paradasParaAprender({ gps_lat: -34, gps_source: "gps_aprendido" }, vs).map((p) => p.lat), [-34.1, -34.2, -34.3])
  assert.deepEqual(G.paradasParaAprender({ gps_lat: -34, gps_source: "manual" }, vs), [])
  // Una aprendida equivocada se corrige: los viajes (aunque hayan quedado "baja" contra ella) votan otra ubicación
  const mal = { gps_lat: -34.9, gps_source: "gps_aprendido" }
  const buenos = ["2026-10-01", "2026-10-02", "2026-10-03"].map((fecha) => ({ dispatch_id: fecha, confianza: "baja", parada_lat: -34.8464, parada_lng: -58.5889, fecha }))
  const u = G.ubicacionAprendida(G.paradasParaAprender(mal, buenos))
  assert.ok(u && Math.abs(u.lat + 34.8464) < 0.0001)
})

test("misma cantidad de viajes y remitos, pero un traslado y un remito de más: gana la alineación ordenada", () => {
  const c = caso("2026-09-26", "AG083GT")
  const vs = viajesDe(c) // 5 viajes: el 1.º es un traslado Hudson → Canning a las 05:45
  const extra = { id: "extra", hora: "2026-09-26T22:30:00Z", remito: "0830", plant_id: "CAN", construction_site_id: "obra-X", obra: null }
  const ds = [...conUbicacion(c.despachos), extra]
  assert.equal(vs.length, ds.length)
  const r = G.cruzarConDespachos(vs, ds)
  assert.equal(r.viajes[0].dispatch_id, null)
  assert.deepEqual(r.remitosSinViaje, ["extra"])
  const remito = (id) => ds.find((d) => d.id === id)?.remito
  assert.deepEqual(r.viajes.slice(1).map((v) => remito(v.dispatch_id)), ["0801", "0804", "0812", "0816"])
  // y sin traslado (los 6 del 02/10 de AE402HE) sigue siendo 1.º con 1.º
  const c2 = caso("2026-10-02", "AE402HE")
  assert.deepEqual(G.alinear(viajesDe(c2), c2.despachos), [0, 1, 2, 3, 4, 5])
})

/** Cliente de Supabase de mentira: registra las llamadas y puede fallar en una operación. */
function sbFalso({ fallaEn = null } = {}) {
  const ops = []
  const builder = (tabla) => {
    const op = { tabla, tipo: null, filtros: [], filas: null }
    const b = {
      upsert(filas, opts) { op.tipo = "upsert"; op.filas = filas; op.opts = opts; return b },
      delete() { op.tipo = "delete"; return b },
      eq(c, v) { op.filtros.push(["eq", c, v]); return b },
      gte(c, v) { op.filtros.push(["gte", c, v]); return b },
      lte(c, v) { op.filtros.push(["lte", c, v]); return b },
      lt(c, v) { op.filtros.push(["lt", c, v]); return b },
      then(ok, ko) { ops.push(op); return Promise.resolve({ error: fallaEn === op.tipo ? { message: "falla " + op.tipo } : null }).then(ok, ko) },
    }
    return b
  }
  return { ops, from: builder }
}

test("guardar un camión: primero upsert, después borra lo viejo; si el upsert falla no borra nada", async () => {
  const filas = [{ mixer_id: "m1", salida_planta: "2026-10-02T10:13:00Z", fecha: "2026-10-02" }]
  const ahora = "2026-10-05T09:00:00.000Z"
  const sb = sbFalso()
  await G.guardarViajesCamion(sb, "m1", filas, "2026-10-01", "2026-10-03", ahora)
  assert.deepEqual(sb.ops.map((o) => o.tipo), ["upsert", "delete"])
  assert.equal(sb.ops[0].opts.onConflict, "mixer_id,salida_planta")
  assert.equal(sb.ops[0].filas[0].procesado_at, ahora)
  assert.deepEqual(sb.ops[1].filtros, [["eq", "mixer_id", "m1"], ["gte", "fecha", "2026-10-01"], ["lte", "fecha", "2026-10-03"], ["lt", "procesado_at", ahora]])

  const sbMal = sbFalso({ fallaEn: "upsert" })
  await assert.rejects(G.guardarViajesCamion(sbMal, "m1", filas, "2026-10-01", "2026-10-03", ahora))
  assert.deepEqual(sbMal.ops.map((o) => o.tipo), ["upsert"]) // no se borró nada

  // Día sin viajes: solo limpia lo viejo
  const sbVacio = sbFalso()
  await G.guardarViajesCamion(sbVacio, "m1", [], "2026-10-01", "2026-10-01", ahora)
  assert.deepEqual(sbVacio.ops.map((o) => o.tipo), ["delete"])
})

test("todasLasFilas pagina de a 1000 hasta agotar", async () => {
  const datos = Array.from({ length: 2345 }, (_, k) => k)
  const pedidos = []
  const r = await G.todasLasFilas((a, b) => { pedidos.push([a, b]); return Promise.resolve({ data: datos.slice(a, b + 1), error: null }) })
  assert.equal(r.length, 2345)
  assert.deepEqual(pedidos, [[0, 999], [1000, 1999], [2000, 2999]])
})

test("freno del endpoint: mismo rango antes de 5 min → 429; el cron pasa siempre", () => {
  const ahora = new Date("2026-10-05T12:00:00Z")
  const rec = [{ desde: "2026-09-26", hasta: "2026-10-02", simular: true, origen: "manual", inicio: "2026-10-05T11:57:00Z" }]
  assert.match(G.motivoFreno(rec, { desde: "2026-10-01", hasta: "2026-10-01", simular: true, cron: false }, ahora), /simuló/)
  assert.equal(G.motivoFreno(rec, { desde: "2026-10-01", hasta: "2026-10-01", simular: false, cron: false }, ahora), null)
  assert.equal(G.motivoFreno(rec, { desde: "2026-10-03", hasta: "2026-10-04", simular: true, cron: false }, ahora), null)
  assert.equal(G.motivoFreno(rec, { desde: "2026-10-01", hasta: "2026-10-01", simular: true, cron: true }, ahora), null)
  const viejo = [{ ...rec[0], inicio: "2026-10-05T11:54:00Z" }]
  assert.equal(G.motivoFreno(viejo, { desde: "2026-10-01", hasta: "2026-10-01", simular: true, cron: false }, ahora), null)
  const muchas = Array.from({ length: 30 }, (_, k) => ({ desde: `2025-0${1 + (k % 9)}-01`, hasta: `2025-0${1 + (k % 9)}-01`, simular: false, origen: "manual", inicio: "2026-10-05T11:58:00Z" }))
  assert.match(G.motivoFreno(muchas, { desde: "2026-10-01", hasta: "2026-10-01", simular: false, cron: false }, ahora), /Demasiadas/)
})

test("puntualidad: el primer camión es el primer remito; si su viaje falta o es dudoso → sin dato", () => {
  const ds = [
    { id: "d2", dispatch_date: "2026-09-26T15:00:00Z", remito: "0810", plant_id: "CAN" },
    { id: "d1", dispatch_date: "2026-09-26T15:00:00Z", remito: "0800", plant_id: "CAN" },
  ]
  const viajes = new Map([["d1", { llegada_obra: "2026-09-26T10:45:00Z", confianza: "media" }], ["d2", { llegada_obra: "2026-09-26T12:58:00Z", confianza: "alta" }]])
  assert.deepEqual(G.llegadaPrimerCamion(ds, viajes), { dispatch_id: "d1", llegada: "2026-09-26T10:45:00Z" })
  viajes.set("d1", { llegada_obra: "2026-09-26T10:45:00Z", confianza: "baja" })
  assert.deepEqual(G.llegadaPrimerCamion(ds, viajes), { dispatch_id: "d1", llegada: null })
  viajes.delete("d1")
  assert.deepEqual(G.llegadaPrimerCamion(ds, viajes), { dispatch_id: "d1", llegada: null })
  assert.equal(G.llegadaPrimerCamion([], viajes), null)
})

test("resumen y tiempos medidos", () => {
  const c = caso("2026-10-02", "AE402HE")
  const r = G.cruzarConDespachos(viajesDe(c), c.despachos)
  const filas = r.viajes.map((v) => ({ ...G.aFila(v, "m1"), m3: 8, chofer: "Juan" }))
  assert.ok(!("_msgs" in filas[0]) && !("paradas" in filas[0]))
  const s = G.resumirViajes(filas)
  assert.equal(s.viajes, 6)
  assert.equal(s.m3, 48)
  assert.ok(s.ciclo > 60 && s.ciclo < 160)
  assert.ok(s.cicloConPlanta > s.ciclo)
  assert.ok(s.motorParadoPlanta > 0 && s.motorParadoPlanta < 60)
  assert.equal(s.porCamion[0].viajes, 6)
  assert.equal(s.porChofer[0].chofer, "Juan")
  assert.ok(s.porChofer[0].motorParadoPlanta > 0)
  const t = G.medianasTramos(filas)
  assert.equal(t.viajes, 6)
  assert.ok(t.obra > 30 && t.obra < 90)
})
