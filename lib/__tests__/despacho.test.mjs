// Pruebas del despacho en tres columnas (docs/migracion-loop/fase-3.md): estados del camión, viajes calculados,
// atraso, contadores, puntualidad, remito sugerido / repetido / avisos y armado del despacho. Sin base ni red.
import { test } from "node:test"
import assert from "node:assert/strict"
import * as D from "../despacho.ts"
import * as P from "../planificador.ts"

const MIN = 60_000
const HOY = new Date(2026, 9, 8, 9, 5).getTime() // jue 8/10 09:05 (hora local)
const a = (h, m) => new Date(2026, 9, 8, h, m).toISOString()
const HUD = "hud", CAN = "can"
const mixer = (o = {}) => ({ id: "m1", license_plate: "AF431GU", status: "available", estado_desde: a(8, 41), plant_id: HUD, ...o })
const desp = (o = {}) => ({ id: "d1", dispatch_date: a(7, 12), plant_id: HUD, obra: "Pueblos del Plata", idaMin: 28, descargaMin: 90, vueltaMin: 28, ...o })

// ── Estados del camión (cada fila del punto 3.2) ──
test("estado: en planta libre (GPS dentro de la geocerca)", () => {
  const e = D.estadoCamion(mixer(), { estado: "en_planta", ultima_posicion: a(9, 4), planta_id: HUD }, null, HOY)
  assert.equal(e.clave, "planta"); assert.equal(e.fuente, "gps"); assert.equal(e.despachable, "si"); assert.equal(e.plantaId, HUD)
  assert.equal(Math.round((HOY - e.desde) / MIN), 24) // "libre hace 24 min" (estado_desde)
})
test("estado: yendo a obra (GPS en movimiento con remito)", () => {
  const e = D.estadoCamion(mixer({ status: "in_transit" }), { estado: "hacia_obra", ultima_posicion: a(9, 4) }, desp({ dispatch_date: a(8, 50) }), HOY)
  assert.equal(e.clave, "yendo"); assert.equal(e.despachable, "avisa"); assert.equal(Math.round(e.cicloMin), 15)
})
test("estado: en obra (GPS a menos de 400 m de la obra)", () => {
  const e = D.estadoCamion(mixer({ status: "in_transit" }), { estado: "en_obra", ultima_posicion: a(9, 4) }, desp(), HOY)
  assert.equal(e.clave, "obra"); assert.equal(e.etiqueta, "En obra"); assert.equal(e.probableObra, false)
  assert.equal(D.duracion(e.cicloMin), "1 h 53")
})
test("estado: obra sin ubicar → parado fuera de planta (probable obra)", () => {
  const e = D.estadoCamion(mixer({ status: "in_transit" }), { estado: "detenido", ultima_posicion: a(9, 4), probable_obra: true }, desp(), HOY)
  assert.equal(e.clave, "obra"); assert.equal(e.probableObra, true); assert.equal(D.textoFuenteEstado(e), "GPS · probable obra")
  // obra ubicada y parado lejos: por el tiempo (salió 07:12, ida 28 → 1 h 53 de viaje = volviendo)
  assert.equal(D.estadoCamion(mixer({ status: "in_transit" }), { estado: "detenido", ultima_posicion: a(9, 4) }, desp(), HOY).clave, "volviendo")
  assert.equal(D.estadoCamion(mixer({ status: "in_transit" }), { estado: "detenido", ultima_posicion: a(9, 4) }, desp({ dispatch_date: a(8, 55) }), HOY).clave, "yendo")
})
test("estado: volviendo (GPS)", () => {
  const e = D.estadoCamion(mixer({ status: "in_transit" }), { estado: "volviendo", ultima_posicion: a(9, 4) }, desp(), HOY)
  assert.equal(e.clave, "volviendo"); assert.equal(e.fuente, "gps")
})
test("estado: taller y fuera de servicio (a mano), no se despachan", () => {
  const t = D.estadoCamion(mixer({ status: "maintenance", estado_desde: a(7, 0) }), { estado: "en_planta", planta_id: HUD }, null, HOY)
  assert.equal(t.clave, "taller"); assert.equal(t.despachable, "no"); assert.equal(t.fuente, "a_mano")
  const f = D.estadoCamion(mixer({ status: "unavailable" }), null, null, HOY)
  assert.equal(f.clave, "fuera"); assert.equal(f.despachable, "no")
})
test("estado: el GPS lo ve en planta después de salir → libre solo (liberarPorGps), salvo recién salido", () => {
  const e = D.estadoCamion(mixer({ status: "in_transit" }), { estado: "en_planta", ultima_posicion: a(9, 4), planta_id: CAN }, desp(), HOY)
  assert.equal(e.clave, "planta"); assert.equal(e.liberarPorGps, true); assert.equal(e.plantaId, CAN)
  const recien = D.estadoCamion(mixer({ status: "in_transit" }), { estado: "en_planta", ultima_posicion: a(9, 4), planta_id: HUD }, desp({ dispatch_date: a(8, 58) }), HOY)
  assert.equal(recien.clave, "yendo"); assert.equal(recien.liberarPorGps, false) // 7 min: todavía saliendo
})
test("estado sin GPS (no está en Wialon): estimado con los horarios del viaje, y ¿Volvió? a la media hora", () => {
  const m = mixer({ status: "in_transit" })
  const d = desp({ dispatch_date: a(8, 20), idaMin: 30, descargaMin: 25, vueltaMin: 30 }) // llega 8:50, termina 9:15, vuelve 9:45
  let e = D.estadoCamion(m, null, d, new Date(2026, 9, 8, 8, 40).getTime())
  assert.equal(e.clave, "yendo"); assert.equal(e.fuente, "estimado"); assert.equal(D.textoFuenteEstado(e), "sin GPS · estimado")
  e = D.estadoCamion(m, null, d, HOY)
  assert.equal(e.clave, "obra"); assert.equal(Math.round((HOY - e.desde) / MIN), 15)
  e = D.estadoCamion(m, null, d, new Date(2026, 9, 8, 9, 50).getTime())
  assert.equal(e.clave, "volviendo"); assert.equal(e.llegando, true); assert.equal(e.preguntarVolvio, false)
  e = D.estadoCamion(m, null, d, new Date(2026, 9, 8, 10, 16).getTime())
  assert.equal(e.preguntarVolvio, true)
})
test("estado con GPS viejo (más de 3 h sin posición) = sin GPS", () => {
  const e = D.estadoCamion(mixer({ status: "in_transit" }), { estado: "en_obra", ultima_posicion: a(5, 0) }, desp(), HOY)
  assert.equal(e.fuente, "estimado"); assert.equal(e.sinGps, true)
  const s = D.estadoCamion(mixer({ status: "in_transit" }), { estado: "sin_senal" }, desp(), HOY)
  assert.equal(s.fuente, "estimado")
})
test("estado: en ruta sin despacho de hoy (quedó de otro día) pregunta ¿Volvió?", () => {
  const e = D.estadoCamion(mixer({ status: "in_transit" }), null, null, HOY)
  assert.equal(e.clave, "volviendo"); assert.equal(e.preguntarVolvio, true)
})
test("orden de camiones: libres acá, libres en la otra, en viaje, taller", () => {
  const libreAca = D.estadoCamion(mixer(), { estado: "en_planta", planta_id: HUD }, null, HOY)
  const libreOtra = D.estadoCamion(mixer(), { estado: "en_planta", planta_id: CAN }, null, HOY)
  const viaje = D.estadoCamion(mixer({ status: "in_transit" }), { estado: "en_obra" }, desp(), HOY)
  const taller = D.estadoCamion(mixer({ status: "maintenance" }), null, null, HOY)
  const orden = [taller, viaje, libreOtra, libreAca].sort((x, y) => D.ordenCamion(x, HUD) - D.ordenCamion(y, HUD))
  assert.deepEqual(orden.map((x) => x.clave + (x.plantaId || "")), ["plantahud", "plantacan", "obrahud", "tallerhud"])
})

// ── Viajes del día, atraso, contadores ──
const prm = () => ({ ...P.PARAMETROS_BASE, cargaMin: 10, lavadoMin: 10 })
const pedido = (o = {}) => ({ id: "p1", plant_id: HUD, quantity_m3: 16, dispatched_m3: 0, scheduled_arrival_time: a(11, 0), status: "scheduled", metodo_descarga: "directo", construction_sites: { travel_time_minutes: 15 }, ...o })
const viaje = (o = {}) => ({ id: "v1", pedido_id: "p1", n: 1, m3: 8, hora_carga: a(8, 50), hora_salida: a(9, 0), hora_llegada: a(9, 28), hora_fin_descarga: a(9, 53), hora_vuelta: a(10, 31), mixer_id: null, estado: "planificado", ...o })

test("viajes calculados para un pedido sin viajes guardados (marca calculado), los guardados tal cual", () => {
  const ps = [pedido({ id: "p1" }), pedido({ id: "p3", quantity_m3: 16 })]
  const vs = D.viajesDelDia(ps, { p1: [viaje(), viaje({ id: "v2", n: 2, hora_carga: a(9, 20) })] }, prm, null)
  const calc = vs.filter((v) => v.pedido_id === "p3")
  assert.equal(calc.length, 2); assert.ok(calc.every((v) => v.calculado)); assert.equal(calc[0].clave, "calc:p3:1")
  assert.equal(vs.filter((v) => v.pedido_id === "p1" && !v.calculado).length, 2)
  // La primera llega a la hora pedida: carga = llegada − viaje (15) − carga (10)
  assert.equal(D.hhmm(calc[0].hora_llegada), "11:00"); assert.equal(D.hhmm(calc[0].hora_carga), "10:35")
})
test("viajes pendientes ordenados por hora de carga; los del suspendido quedan en pausa", () => {
  const ps = [pedido({ id: "p1" }), pedido({ id: "p2", suspendido_at: a(8, 40) })]
  const vs = D.viajesDelDia(ps, {
    p1: [viaje({ hora_carga: a(9, 20), n: 2, id: "v2" }), viaje({ hora_carga: a(8, 50) })],
    p2: [viaje({ id: "w1", pedido_id: "p2", hora_carga: a(8, 0) })],
  }, prm, null)
  const pend = D.viajesPendientes(vs, ps)
  assert.deepEqual(pend.map((v) => v.id), ["v1", "v2"])
  assert.equal(D.viajesEnPausa(vs, ps), 1)
})
test("atraso: rojo con 'Atrasado 15 min', ámbar 'Ahora' en los próximos 15", () => {
  assert.deepEqual(D.atraso(a(8, 50), HOY), { tipo: "atrasado", min: 15, texto: "Atrasado 15 min" })
  assert.equal(D.atraso(a(9, 17), HOY).tipo, "ahora")
  assert.equal(D.atraso(a(9, 17), HOY).texto, "Ahora · en 12 min")
  assert.equal(D.atraso(a(10, 0), HOY).tipo, null)
})
test("contadores: programado, despachado (manuales incluidos), falta, suspendido y cancelado", () => {
  const ps = [
    pedido({ id: "a", quantity_m3: 32, dispatched_m3: 16 }),
    pedido({ id: "b", quantity_m3: 24, dispatched_m3: 0, suspendido_at: a(8, 0) }),
    pedido({ id: "c", quantity_m3: 10, dispatched_m3: 4, status: "cancelled" }),
    pedido({ id: "d", quantity_m3: 8, dispatched_m3: 8, status: "completed" }),
  ]
  const vs = [viaje({ pedido_id: "a", estado: "despachado" }), viaje({ pedido_id: "a", n: 2 }), viaje({ pedido_id: "c", n: 1, estado: "cancelado" }), viaje({ pedido_id: "d", estado: "despachado" })]
  const c = D.contadoresDia(ps, [{ quantity_m3: 16 }, { quantity_m3: 8 }, { quantity_m3: 3 }, { quantity_m3: 2, is_test_dispatch: true }], vs)
  assert.deepEqual(c, { programado: 64, despachado: 27, falta: 16, suspendido: 24, cancelado: 6, viajesDespachados: 2, viajesTotal: 3 })
})

// ── Puntualidad ──
test("puntualidad: real del GPS (4a), en vivo, estimada y sin salir", () => {
  const base = { llegadaPedida: a(7, 45), toleranciaMin: 15, viajeMin: 28, ahora: HOY }
  assert.deepEqual(D.puntualidadPrimerCamion({ ...base, despachos: [{ id: "d1", dispatch_date: a(7, 20) }], llegadaGps: { d1: a(7, 52) } }), { clase: "ok", texto: "Llegó 07:52 · pedido 07:45 · +7 min" })
  assert.equal(D.puntualidadPrimerCamion({ ...base, despachos: [{ id: "d1", dispatch_date: a(7, 20) }], llegadaGps: { d1: a(8, 10) } }).clase, "mal")
  assert.equal(D.puntualidadPrimerCamion({ ...base, ahora: new Date(2026, 9, 8, 7, 50).getTime(), despachos: [{ id: "d1", dispatch_date: a(7, 20) }], enObraAhoraGps: true }).texto, "En obra (GPS) · pedido 07:45 · a tiempo")
  const est = D.puntualidadPrimerCamion({ ...base, ahora: new Date(2026, 9, 8, 7, 30).getTime(), despachos: [{ id: "d2", dispatch_date: a(7, 22) }, { id: "d1", dispatch_date: a(7, 15) }] })
  assert.equal(est.texto, "Llegaría ~07:43 (estimado) · pedido 07:45"); assert.equal(est.clase, "ok")
  assert.deepEqual(D.puntualidadPrimerCamion({ ...base, despachos: [], proximaCarga: a(7, 5) }), { clase: "na", texto: "1.er camión carga 07:05" })
})

// ── Remito: sugerido, repetido, avisos ──
const H = (remitos, plant = HUD) => remitos.map((r) => ({ remito: r, plant_id: plant }))
const hist = [
  ...H(["755 HUDSON", ...Array.from({ length: 7 }, (_, i) => String(770 + i)), ...Array.from({ length: 11 }, (_, i) => String(3190 + i))]),
  ...H([...Array.from({ length: 15 }, (_, i) => String(826 + i)), "0841", ...Array.from({ length: 9 }, (_, i) => String(3297 + i))], CAN),
]
test("tipo por número y dígitos (igual que la base)", () => {
  assert.equal(D.digitosRemito("755 HUDSON"), "755"); assert.equal(D.digitosRemito("0841"), "841"); assert.equal(D.digitosRemito("HUDSON"), null)
  assert.equal(D.tipoPorNumero("3201"), "X"); assert.equal(D.tipoPorNumero("2201"), "X"); assert.equal(D.tipoPorNumero("2200"), "R")
  assert.equal(D.tipoPorNumero("776"), "R"); assert.equal(D.tipoPorNumero("780781"), null)
})
test("sugerido por planta y tipo: Hudson R 777 y X 3201; Canning R 842 y X 3306", () => {
  assert.deepEqual(D.remitoSugerido(hist, HUD, "R"), { numero: 777, ultimo: 776 })
  assert.equal(D.remitoSugerido(hist, HUD, "X").numero, 3201)
  assert.equal(D.remitoSugerido(hist, CAN, "R").numero, 842)
  assert.equal(D.remitoSugerido(hist, CAN, "X").numero, 3306)
  // saltea los que ya existen (se cargan desordenados)
  assert.equal(D.remitoSugerido([...hist, ...H(["778"])], HUD, "R").numero, 779)
  assert.equal(D.remitoSugerido([], HUD, "R"), null)
  // el tipo guardado manda sobre el número
  assert.equal(D.remitoSugerido([{ remito: "3500", plant_id: HUD, remito_tipo: "R" }], HUD, "R").numero, 3501)
})
test("repetido: R 776 frena; X 776 no choca con R 776; 755 choca con 755 HUDSON; Canning no choca con Hudson", () => {
  assert.equal(D.remitoRepetido(hist, HUD, "R", "776"), true)
  assert.equal(D.remitoRepetido(hist, HUD, "X", "776"), false)
  assert.equal(D.remitoRepetido(hist, HUD, "R", "755"), true)
  assert.equal(D.remitoRepetido(hist, CAN, "R", "755"), false)
  assert.equal(D.remitoRepetido(hist, CAN, "R", "841"), true) // "0841"
})
test("avisos: 780781 dígitos de más; 3260 con R parece X; 12 salta mucho; 3187 no avisa; X usado en la otra planta", () => {
  const nom = { planta: "Hudson", otraPlanta: "Canning", otraPlantaId: CAN }
  assert.equal(D.avisosRemito("780781", HUD, "R", hist, nom).clave, "digitos")
  assert.match(D.avisosRemito("780781", HUD, "R", hist, nom).texto, /¿No juntaste dos números\? 780781 tiene 6 dígitos/)
  const x = D.avisosRemito("3260", HUD, "R", hist, nom)
  assert.equal(x.clave, "otro_tipo"); assert.equal(x.texto, "3260 parece un remito X (sin factura). Los R de Hudson van por el 776.")
  assert.equal(D.avisosRemito("12", HUD, "R", hist, nom).clave, "salta")
  assert.equal(D.avisosRemito("3187", HUD, "X", hist, nom), null)
  assert.equal(D.avisosRemito("3260", HUD, "X", hist, nom).clave, "salta") // más de 20 por encima del mayor X
  assert.equal(D.avisosRemito("777", HUD, "R", hist, nom), null)
  assert.equal(D.avisosRemito("775", HUD, "X", hist, nom).clave, "otro_tipo")
  const conOtra = [...hist, ...H(["3205"], CAN)]
  assert.equal(D.avisosRemito("3205", HUD, "X", conOtra, nom).clave, "otra_planta")
})
test("número impreso: X con 8 dígitos (RM2: 0099-00003201) y R con RM", () => {
  assert.equal(D.numeroImpreso("X", "3201"), "RM2: 0099-00003201")
  assert.equal(D.numeroImpreso("R", "755 HUDSON"), "RM: 0099-00000755")
  assert.equal(D.numeroImpreso(null, "3201"), "RM2: 0099-00003201")
})

// ── Formulario Entrega ──
const form = (o = {}) => ({ m3: "8", mixerId: "m1", choferId: "c1", remito: "777", tipo: "R", origenTipo: "pedido", salio: "09:05", salioTocado: false, agua: "0", fibraOn: false, fibraKgM3: "", muestraOn: false, muestraNum: "", asentamiento: "", ...o })
const ctx = (o = {}) => ({ falta: 16, hayChoferes: true, camionEnTaller: false, repetido: false, plantaNombre: "Hudson", ahora: HOY, ...o })
test("validar entrega: mismas reglas de hoy, tipo de remito y salió a las", () => {
  assert.equal(D.validarEntrega(form(), ctx()), null)
  assert.match(D.validarEntrega(form({ m3: "0" }), ctx()), /m³/)
  assert.match(D.validarEntrega(form({ m3: "17" }), ctx()), /Supera lo que falta/)
  assert.equal(D.validarEntrega(form({ m3: "16,5" }), ctx()), null) // falta + 0,5
  assert.match(D.validarEntrega(form({ choferId: "" }), ctx()), /chofer/)
  assert.equal(D.validarEntrega(form({ choferId: "" }), ctx({ hayChoferes: false })), null)
  assert.match(D.validarEntrega(form({ tipo: null }), ctx()), /con o sin factura/)
  assert.match(D.validarEntrega(form(), ctx({ repetido: true })), /Ya hay un remito R 777 en Hudson/)
  assert.match(D.validarEntrega(form({ salioTocado: true, salio: "10:00" }), ctx()), /más tarde que ahora/)
  assert.equal(D.validarEntrega(form({ salioTocado: true, salio: "07:12" }), ctx()), null)
  assert.match(D.validarEntrega(form({ fibraOn: true, fibraKgM3: "" }), ctx()), /fibra/)
  assert.match(D.validarEntrega(form({ muestraOn: true, muestraNum: "M-1" }), ctx()), /muestra/)
  assert.match(D.validarEntrega(form(), ctx({ camionEnTaller: true })), /taller/)
})
test("payload: el mismo jsonb de hoy + viaje, salida corregida, tipo y aviso", () => {
  const p = D.armarPayloadDespacho({
    plantId: HUD, pedido: { id: "p1", formula_id: "f1", client_id: "c1", construction_site_id: "s1" }, viajeId: "v1",
    form: form({ m3: "7,5", agua: "30", fibraOn: true, fibraKgM3: "0,5", muestraOn: true, muestraNum: " M-0413 ", asentamiento: "12,5", salioTocado: true, salio: "07:12" }),
    usuario: "Titan", ahora: HOY, aviso: { clave: "salta", texto: "" },
  })
  assert.deepEqual({ ...p, dispatch_date: undefined }, {
    plant_id: HUD, scheduled_dispatch_id: "p1", formula_id: "f1", client_id: "c1", construction_site_id: "s1", mixer_id: "m1", chofer_id: "c1", viaje_id: "v1",
    quantity_m3: 7.5, remito: "777", extra_water_liters: 30, fiber_kg_per_m3: 0.5, sample_taken: true, sample_number: "M-0413", actual_slump_cm: 12.5,
    created_by: "Titan", usuario: "Titan", dispatch_date: undefined, remito_tipo: "R", remito_tipo_origen: "pedido", aviso_remito: "salta mucho", pantalla: "Despacho en tres columnas",
  })
  assert.equal(D.hhmm(p.dispatch_date), "07:12")
  const sin = D.armarPayloadDespacho({ plantId: HUD, pedido: { id: "p1" }, viajeId: null, form: form({ choferId: "" }), usuario: "x", ahora: HOY })
  assert.equal("dispatch_date" in sin, false); assert.equal("viaje_id" in sin, false); assert.equal("chofer_id" in sin, false); assert.equal(sin.fiber_kg_per_m3, 0)
})
test("camión propuesto: el sugerido si está libre acá; si no, el primer libre de esta planta", () => {
  const est = (id, gps, st = "available") => ({ id, e: D.estadoCamion(mixer({ id, status: st }), gps, st === "in_transit" ? desp() : null, HOY) })
  const lista = [est("a", { estado: "en_planta", planta_id: CAN }), est("b", { estado: "en_obra" }, "in_transit"), est("c", { estado: "en_planta", planta_id: HUD })]
  assert.equal(D.camionPropuesto("b", lista, HUD), "c")
  assert.equal(D.camionPropuesto("c", lista, HUD), "c")
  assert.equal(D.camionPropuesto(null, lista, CAN), "a")
})
