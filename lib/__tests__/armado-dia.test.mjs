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

// ── Fase B: mail del armado ──
import * as M from "../armado-dia.ts"
import * as V from "../viajes.ts"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const t = (hhmm, fecha = "2026-11-04") => Date.parse(`${fecha}T${hhmm}:00-03:00`)
const GPS_49 = { AF431GU: HUD, AE402HE: CAN, AG083GT: HUD }
const vista49 = (o = {}) => D.armarVistaDia(datos(o), { amanece: GPS_49 })

test("fechaObjetivo: 16:59 ninguna; 17:00 y 23:59 mañana; 00:01 y 05:59 hoy; 06:00 ninguna", () => {
  assert.equal(M.fechaObjetivo(t("16:59")), null)
  assert.equal(M.fechaObjetivo(t("17:00")), "2026-11-05")
  assert.equal(M.fechaObjetivo(t("23:59")), "2026-11-05")
  assert.equal(M.fechaObjetivo(t("00:01", "2026-11-05")), "2026-11-05")
  assert.equal(M.fechaObjetivo(t("05:59", "2026-11-05")), "2026-11-05")
  assert.equal(M.fechaObjetivo(t("06:00", "2026-11-05")), null)
  assert.equal(M.fechaObjetivo(t("06:30", "2026-11-05")), null) // fuera de reenvioHasta
})

test("decidirEnvio: primero, sin pedidos, igual, cambió hace 9 y 10 min, pedido nuevo después, tope", () => {
  const e = (o = {}) => ({ ...M.estadoVacio(FECHA), ...o })
  assert.deepEqual(M.decidirEnvio(e(), t("17:00"), "H1", true), { accion: "enviar", tipo: "dia", anotarVista: true, motivo: "primer mail" })
  const sinP = M.decidirEnvio(e(), t("17:00"), "H0", false)
  assert.equal(sinP.accion, "nada"); assert.equal(sinP.anotarVista, true)
  // Ya salió y es igual: nada
  assert.equal(M.decidirEnvio(e({ envios: 1, huella_enviada: "H1", huella_vista: "H1", vista_desde: new Date(t("17:00")).toISOString() }), t("21:00"), "H1", true).accion, "nada")
  // Cambió: se anota y se espera; 9 min después espera; 10 min después sale la actualización
  const enviado = { envios: 1, huella_enviada: "H1", huella_vista: "H1", vista_desde: new Date(t("17:00")).toISOString() }
  assert.deepEqual(M.decidirEnvio(e(enviado), t("21:00"), "H2", true), { accion: "esperar", anotarVista: true, motivo: "cambió: se espera el antirrebote" })
  const visto = { ...enviado, huella_vista: "H2", vista_desde: new Date(t("21:06")).toISOString() }
  assert.equal(M.decidirEnvio(e(visto), t("21:15"), "H2", true).accion, "esperar")
  assert.deepEqual(M.decidirEnvio(e(visto), t("21:16"), "H2", true), { accion: "enviar", tipo: "actualizacion", anotarVista: false, motivo: "sin cambios hace 10 min" })
  // Sin pedidos a las 17:00 (vista anotada) y a las 19:00 aparece uno: mail del día, con antirrebote
  const vacio = { huella_vista: "H0", vista_desde: new Date(t("17:00")).toISOString() }
  assert.equal(M.decidirEnvio(e(vacio), t("19:00"), "H1", true).accion, "esperar")
  assert.equal(M.decidirEnvio(e({ huella_vista: "H1", vista_desde: new Date(t("19:00")).toISOString() }), t("19:10"), "H1", true).tipo, "dia")
  // Tope
  assert.equal(M.decidirEnvio(e({ envios: 10, huella_enviada: "H1" }), t("22:00"), "H9", true).motivo, "tope")
})

test("tomaPendiente: la de las 17:00 una vez y la segunda de las 20:00", () => {
  const e = M.estadoVacio(FECHA)
  assert.equal(M.tomaPendiente(e, t("17:00")), "primera")
  const tomada = { ...e, toma_gps_at: new Date(t("17:00")).toISOString() }
  assert.equal(M.tomaPendiente(tomada, t("19:55")), null)
  assert.equal(M.tomaPendiente(tomada, t("20:00")), "segunda")
  assert.equal(M.tomaPendiente({ ...tomada, toma_gps_2_at: new Date(t("20:00")).toISOString() }, t("21:00")), null)
  assert.equal(M.tomaPendiente({ ...e, toma_gps_at: new Date(t("20:30")).toISOString() }, t("21:00")), null) // la primera ya fue después de las 20
})

test("amanecerDe: los casos de 4.3 con sus textos (los de 4.9 punto 3)", () => {
  const nombres = { [CAN]: "Canning", [HUD]: "Hudson" }
  const ahora = t("17:00")
  const gps = (o) => ({ estado: "en_planta", planta_id: null, planta_cercana: null, ultima_posicion: new Date(ahora - 5 * 60000).toISOString(), lat: -34, lng: -58, despacho: null, ...o })
  const a = (o) => M.amanecerDe({ mixerId: "m", patente: "X", gps: null, gpsCaido: false, repartoHoy: null, ultimoDespachoPlanta: null, nombres, ahora, ...o })
  assert.equal(a({ patente: "AF431GU", gps: gps({ planta_id: HUD }) }).texto, "AF431GU: en Hudson.")
  const obra = a({ patente: "AE402HE", gps: gps({ estado: "en_obra", despacho: { obra: { nombre: "Santa Rita" } } }), ultimoDespachoPlanta: CAN })
  assert.equal(obra.texto, "AE402HE: todavía en obra (Santa Rita), se toma Canning (su último viaje)."); assert.equal(obra.plant_id, CAN); assert.equal(obra.fuente, "ultimo_viaje")
  const sinSenal = a({ patente: "AG083GT", gps: gps({ ultima_posicion: new Date(t("11:20")).toISOString() }), repartoHoy: { duerme: HUD, terminaEn: HUD } })
  assert.equal(sinSenal.texto, "AG083GT: sin señal del GPS desde las 11:20, se toma Hudson (reparto de hoy)."); assert.equal(sinSenal.fuente, "reparto")
  assert.equal(a({ patente: "AG083GT", gps: gps({ planta_id: HUD }), repartoHoy: { duerme: CAN, terminaEn: HUD } }).texto, "AG083GT: pasa a Canning esta noche (reparto).")
  assert.equal(a({ patente: "AF431GU", gps: gps({ estado: "detenido", planta_cercana: { id: HUD, nombre: "Hudson", km: 18.2 } }) }).texto, "AF431GU: a 18 km de Hudson, se toma Hudson (la más cercana).")
  const nada = a({ patente: "LES431" })
  assert.equal(nada.texto, "LES431: sin GPS, a confirmar."); assert.equal(nada.plant_id, null); assert.equal(nada.fuente, "sin_dato")
  assert.equal(a({ patente: "AG083GT", gpsCaido: true, repartoHoy: { duerme: HUD, terminaEn: HUD } }).texto, "AG083GT: no se pudo leer el GPS, se toma Hudson (reparto de hoy).")
  assert.equal(M.TEXTO_GPS_CAIDO, "No se pudo leer el GPS: se toma dónde duermen según el reparto de hoy.")
})

test("huella: igual con otro orden y otra hora de armado; cambia con hora, m³, método, reparto, arranque y pedidos de pasado mañana", () => {
  const v = vista49()
  const c = M.contenidoArmado(v, null)
  const h = M.huellaDe(c)
  assert.equal(M.huellaDe({ ...c, pedidos: [...c.pedidos].reverse(), arranque: [...c.arranque].reverse() }), h)
  assert.equal(M.huellaDe(M.contenidoArmado(D.armarVistaDia(datos(), { amanece: GPS_49 }), null)), h) // armado en otro momento
  const otra = (o) => M.huellaDe(M.contenidoArmado(D.armarVistaDia(datos(o.datos || {}), { amanece: o.amanece || GPS_49, ajustes: o.ajustes }), o.guardado || null))
  assert.notEqual(otra({ ajustes: { pa: { hora: "14:00" } } }), h)
  assert.notEqual(otra({ ajustes: { sr: { metodo: "bomba" } } }), h)
  assert.notEqual(otra({ datos: { pedidosHoy: PEDIDOS.map((p) => (p.id === "gv" ? { ...p, quantity_m3: 32 } : p)) } }), h)
  assert.notEqual(otra({ guardado: { por: "Fernando Maldonado", at: ar("22:31", "2026-11-04") } }), h)
  assert.notEqual(otra({ amanece: { ...GPS_49, AE402HE: HUD } }), h)
  // Pasado mañana (para el armado del 05/11, el 06/11) con un pedido grande en Hudson: los camiones pasan a dormir allá
  assert.notEqual(otra({ datos: { pedidosManana: [ped("x6", "Lote 5", HUD, 80, "08:00", "directo", { scheduled_arrival_time: ar("08:00", "2026-11-06") })] } }), h)
})

test("cambiosEntre: hora, método, m³, nuevo, cancelado, otro día, reparto, arranque; corta en 8", () => {
  const c0 = M.contenidoArmado(vista49(), null)
  const c1 = M.contenidoArmado(D.armarVistaDia(datos({ pedidosHoy: [...PEDIDOS.filter((p) => p.id !== "gv").map((p) => (p.id === "sr" ? { ...p, quantity_m3: 32 } : p)), ped("l5", "Lote 5", HUD, 16, "11:00", "directo")] }), { amanece: { ...GPS_49, AE402HE: HUD }, ajustes: { pa: { hora: "14:00" }, sr: { metodo: "bomba" } } }), { por: "Fernando Maldonado", at: ar("22:31", "2026-11-04") })
  const cambios = M.cambiosEntre(c0, c1, { desaparecidos: { gv: "cancelado" }, tomaGpsAt: ar("22:40", "2026-11-04") })
  for (const x of ["Pampero: llega 13:00 → 14:00", "Santa Rita: directo → bomba", "Santa Rita: 40 → 32 m³", "Nuevo: Lote 5 (Hudson, 11:00)", "Greenville: cancelado", "Cambió el reparto (guardado por Fernando Maldonado 22:31)", "AE402HE ahora arranca en Hudson (GPS 22:40)"]) assert.ok(cambios.includes(x), `${x} · ${cambios.join(" | ")}`)
  assert.ok(M.cambiosEntre(c0, { ...c0, pedidos: c0.pedidos.filter((p) => p.id !== "gv") }, { desaparecidos: { gv: "otro_dia" } }).includes("Greenville: pasó a otro día"))
  const muchos = { ...c0, pedidos: Array.from({ length: 11 }, (_, i) => ({ ...c0.pedidos[0], id: `n${i}`, nombre: `Obra ${i}` })) }
  const corte = M.cambiosEntre(c0, muchos)
  assert.equal(corte.length, 9); assert.equal(corte[8], "y 6 cambios más")
  assert.deepEqual(M.cambiosEntre(null, c0), [])
})

test("destinatarios: producción (Fernando y Juan; Fernando sin mail → Juan con aviso; ninguno → error) y prueba (solo Bautista)", () => {
  const mails = { "Fernando Maldonado": "f@x.com", "Juan Oreguy": "j@x.com", "Bautista Caputo": "b@x.com" }
  assert.deepEqual(M.destinatarios(false, mails), { to: ["f@x.com"], cc: ["j@x.com"], aviso: null, error: null, prueba: false })
  assert.deepEqual(M.destinatarios(false, { ...mails, "Fernando Maldonado": null }), { to: ["j@x.com"], cc: [], aviso: "Fernando Maldonado no tiene mail cargado en Usuarios: este mail no le llegó.", error: null, prueba: false })
  assert.equal(M.destinatarios(false, { "Bautista Caputo": "b@x.com" }).error, "Fernando Maldonado y Juan Oreguy no tienen mail cargado en Usuarios.")
  assert.deepEqual(M.destinatarios(true, mails), { to: ["b@x.com"], cc: [], aviso: null, error: null, prueba: true })
})

test("armarMailArmado: asuntos, link, Fernando sin mail, sin <img> ni <style>, escapes y columnas con los valores de filasPedidos", () => {
  const v = vista49({ pedidosHoy: PEDIDOS.map((p) => (p.id === "sr" ? { ...p, construction_sites: { ...p.construction_sites, name: "Santa Rita & <Lote 2>" } } : p)) })
  const base = { armadoEl: t("17:00"), cambios: [], prueba: false, aviso: null, mas1: null, mas2: null, arranque: [], gpsCaido: false, gpsHora: "17:00", conviene: null, guardado: null }
  const dia = M.armarMailArmado(M.datosMailDeVista(v, { ...base, tipo: "dia", n: 0 }))
  assert.equal(dia.asunto, "Armado del jueves 05/11 · Rebucret")
  const act = M.armarMailArmado(M.datosMailDeVista(v, { ...base, armadoEl: t("22:40"), tipo: "actualizacion", n: 1, cambios: ["Pampero: llega 13:00 → 14:00"] }))
  assert.equal(act.asunto, "ACTUALIZACIÓN 1 · Armado del jueves 05/11 · Rebucret (22:40)")
  assert.ok(act.html.includes("<b>Actualización 1 (22:40).</b> Cambió: Pampero: llega 13:00 → 14:00."))
  assert.equal(M.armarMailArmado(M.datosMailDeVista(v, { ...base, tipo: "dia", n: 0, prueba: true })).asunto, "[PRUEBA] Armado del jueves 05/11 · Rebucret")
  assert.ok(dia.html.includes('href="https://www.produccionrebucret.com/programacion?vista=dia&amp;fecha=2026-11-05"'))
  assert.equal(M.linkDia(FECHA), "https://www.produccionrebucret.com/programacion?vista=dia&fecha=2026-11-05")
  assert.ok(M.armarMailArmado(M.datosMailDeVista(v, { ...base, tipo: "dia", n: 0, aviso: "Fernando Maldonado no tiene mail cargado en Usuarios: este mail no le llegó." })).html.includes("Fernando Maldonado no tiene mail cargado en Usuarios: este mail no le llegó."))
  assert.doesNotMatch(dia.html, /<img|<style/i)
  assert.ok(dia.html.includes("Santa Rita &amp; &lt;Lote 2&gt;")); assert.ok(!dia.html.includes("<Lote 2>"))
  const cab = [...dia.html.matchAll(/<th [^>]*>([^<]+)<\/th>/g)].map((m) => m[1])
  assert.deepEqual(cab, ["Pedido", "Viajes", "Camiones", "Comienza", "Termina", "Llega a obra", "Estado", "Conf."])
  for (const f of v.filas) for (const x of [f.comienza, f.termina, f.llegada, `sale ${f.sale}`, f.estado]) assert.ok(dia.html.includes(M.esc(x)), `${f.nombre}: ${x}`)
  assert.ok(dia.html.includes("Armado el miércoles 04/11 a las 17:00."))
})

test("diagramaHtml: suma de colspan = celdas, sin bloques pisados al redondear, obra visible con 4 celdas o más", () => {
  const v = vista49()
  const filas = R.bloquesDiagrama(v.resultado, v.camiones, v.nombres, v.obraDe)
  filas.push({ camionId: "x", patente: "PRUEBA", ficticio: false, bloques: [
    { tipo: "viaje", desde: 7 * 60 + 5, hasta: 7 * 60 + 50, plantId: CAN, texto: "Larga", detalle: "" },
    { tipo: "viaje", desde: 7 * 60 + 52, hasta: 8 * 60 + 10, plantId: CAN, texto: "Corta", detalle: "" },
  ] })
  const html = M.diagramaHtml(filas, v.plantas.map((p) => ({ id: p.id, nombre: p.nombre })))
  const tabla = html.slice(0, html.indexOf("</table>"))
  const filasTr = tabla.split("<tr>").slice(2)
  const n = [...tabla.split("<tr>")[1].matchAll(/colspan="(\d+)"/g)].reduce((s, m) => s + Number(m[1]), 0)
  for (const tr of filasTr) assert.equal([...tr.matchAll(/colspan="(\d+)"/g)].reduce((s, m) => s + Number(m[1]), 0), n)
  const prueba = filasTr[filasTr.length - 1]
  assert.ok(prueba.includes(">Larga</td>")); assert.ok(!prueba.includes(">Corta</td>")) // 2 celdas: sin nombre (queda en el title)
  assert.ok(html.includes("<b>AG083GT</b> · "))
  assert.doesNotMatch(html, /<img/)
})

test("hora de Argentina fija: textoChoque y avisosSuperposicion dan la misma hora con cualquier TZ", () => {
  const vj = (pedido, carga, vuelta) => ({ pedido_id: pedido, plant_id: CAN, n: 1, m3: 8, estado: "planificado", mixer_id: "AF431GU", hora_carga: ar(carga), hora_salida: ar(carga), hora_llegada: ar(carga), hora_fin_descarga: ar(vuelta), hora_vuelta: ar(vuelta) })
  const viajes = [vj("x", "11:00", "12:37"), vj("y", "12:15", "13:30")]
  assert.equal(R.avisosSuperposicion(viajes, (id) => (id === "x" ? "Greenville" : "Pampero"), (id) => id)[0].texto, "Greenville se superpone con Pampero: AF431GU tendría que cargar para Pampero a las 12:15 y vuelve de Greenville 12:37.")
  const ch = V.choquesDeCamion(viajes).get("y:1")
  assert.equal(V.textoChoque(ch, "AF431GU", "Greenville"), "AF431GU todavía vuelve de Greenville a las 12:37")
})

// ── Fase B: resumen para el WhatsApp de Concretus ──
test("resumenReparto con el ejemplo de 3.7 y el GPS de 4.9: el JSON completo, igual a filasPedidos", () => {
  const v = vista49()
  const r = M.resumenReparto(v)
  assert.deepEqual(r, {
    fecha: "2026-11-05", camiones: 3,
    pedidos: [
      { nombre: "Santa Rita", planta: "Canning", viajes: 5, camiones: 1, comienza: "07:00", termina: "15:55", atraso_min: 340, a_tiempo: false },
      { nombre: "Greenville", planta: "Hudson", viajes: 5, camiones: 2, comienza: "07:40", termina: "13:39", atraso_min: 94, a_tiempo: false },
      { nombre: "Pampero", planta: "Canning", viajes: 8, camiones: 3, comienza: "13:37", termina: "20:20", atraso_min: 155, a_tiempo: false },
    ],
    traslados: ["12:37 AG083GT → Canning", "14:09 AF431GU → Canning"],
    noche: "Duermen: 3 en Canning",
  })
  r.pedidos.forEach((p, i) => {
    const f = v.filas[i]
    assert.deepEqual(p, { nombre: f.nombre, planta: f.planta, viajes: f.viajes, camiones: f.camiones.n, comienza: f.comienza, termina: f.termina, atraso_min: f.atrasoMin, a_tiempo: f.aTiempo })
  })
  for (const x of r.traslados) assert.match(x, /^\d\d:\d\d \S+ → \S+$/)
  assert.ok(r.noche.startsWith("Duermen: "))
  // Sin pedidos pendientes
  const vacio = M.resumenReparto(D.armarVistaDia(datos({ pedidosHoy: [] }), { amanece: GPS_49 }))
  assert.deepEqual(vacio.pedidos, []); assert.deepEqual(vacio.traslados, []); assert.match(vacio.noche, /^Duermen: /)
  // Completados no van
  assert.equal(M.resumenReparto(D.armarVistaDia(datos({ pedidosHoy: PEDIDOS.map((p) => (p.id === "gv" ? { ...p, status: "completed" } : p)) }))).pedidos.length, 2)
  // Pedido sin camión
  const sinCamion = M.resumenReparto(D.armarVistaDia(datos({ mixers: [] })))
  assert.ok(sinCamion.pedidos.every((p) => p.camiones === 0 && p.atraso_min === null && p.a_tiempo === false))
})

test("validarFechaResumen y la autorización de la ruta (solo su secreto propio)", () => {
  assert.deepEqual(M.validarFechaResumen("2026-11-05"), { ok: true, fecha: "2026-11-05" })
  for (const f of ["2026-13-40", "2026-02-30", "05/11/2026", "", null, undefined]) assert.equal(M.validarFechaResumen(f).ok, false, String(f))
  assert.equal(M.autorizadoResumen("Bearer s3cr3t", "s3cr3t"), true)
  assert.equal(M.autorizadoResumen("Bearer otro", "s3cr3t"), false)
  assert.equal(M.autorizadoResumen(null, "s3cr3t"), false)
  assert.equal(M.autorizadoResumen("Bearer ", ""), false) // sin el secreto cargado, nadie entra
  assert.equal(M.autorizadoResumen("Bearer x", undefined), false)
})

test("textoEstadoMail: antes de las 17, enviado, actualización pendiente, tope, sin guardar", () => {
  assert.deepEqual(M.textoEstadoMail(null, FECHA, t("15:00"), false), ["Mail a Fernando Maldonado (copia a Juan Oreguy): sale hoy a las 17:00."])
  const e = { ...M.estadoVacio(FECHA), envios: 2, primer_envio_at: new Date(t("17:00")).toISOString(), ultimo_envio_at: new Date(t("22:40")).toISOString(), huella_enviada: "A", huella_vista: "B", vista_desde: new Date(t("22:43")).toISOString() }
  const l = M.textoEstadoMail(e, FECHA, t("22:45"), true)
  assert.deepEqual(l, ["Mail enviado 17:00 · actualización 1 a las 22:40.", "Hay cambios desde el último mail: sale una actualización a las ~22:55 si no cambia nada más.", "Los cambios sin guardar no van al mail."])
  assert.ok(M.textoEstadoMail({ ...e, envios: 10 }, FECHA, t("23:00"), false).includes("Se mandaron 10 mails de este día: no se mandan más solos. Usá Enviar ahora."))
  assert.deepEqual(M.textoEstadoMail({ ...M.estadoVacio(FECHA), ultimo_error: "Fernando Maldonado y Juan Oreguy no tienen mail cargado en Usuarios" }, FECHA, t("17:05"), false), ["No se mandó: Fernando Maldonado y Juan Oreguy no tienen mail cargado en Usuarios."])
})

test("migraciones de la fase B: transacción, dos veces, guardar_reparto_dia con la misma firma; el cron aparte", () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations")
  const sql = fs.readFileSync(path.join(dir, "202611051200_armado_dia_mail.sql"), "utf8")
  assert.match(sql, /^BEGIN;/m); assert.match(sql, /^COMMIT;/m); assert.match(sql, /SET LOCAL lock_timeout/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.amanecer_camiones/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.armado_mail/)
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.armado_mail_tomar\(p_fecha date, p_quien text, p_segundos integer DEFAULT 120\)/)
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.guardar_reparto_dia\(p_fecha date, p_filas jsonb, p_usuario text DEFAULT NULL, p_borrar boolean DEFAULT false\)/)
  assert.match(sql, /FROM amanecer_camiones WHERE fecha = p_fecha AND mixer_id = v_mixer/)
  assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /DROP TABLE|cron\.schedule/i)
  const cron = fs.readFileSync(path.join(dir, "202611051210_armado_dia_cron.sql"), "utf8")
  assert.match(cron, /cron\.unschedule\(jobid\) FROM cron\.job WHERE jobname = 'armado-dia-pasada'/)
  assert.match(cron, /'\*\/5 \* \* \* \*'/)
  assert.match(cron, /api\/programacion\/armado-dia/)
})

// ── Campo de hora de 24 h (bloque y gerenciador) ──
import * as Hh from "../hora-24.ts"
test("parsearHora24: 1300, 13:00, 13.00, 930 y 7 valen; 24:00, 12:60 y texto no", () => {
  for (const [x, y] of [["1300", "13:00"], ["13:00", "13:00"], ["13.00", "13:00"], ["930", "09:30"], ["9:05", "09:05"], ["7", "07:00"], ["0000", "00:00"], ["23:59", "23:59"], [" 08:15 ", "08:15"]]) assert.equal(Hh.parsearHora24(x), y, x)
  for (const x of ["24:00", "12:60", "2400", "1:5", "abc", "", null, "13:000", "12345"]) assert.equal(Hh.parsearHora24(x), null, String(x))
})
