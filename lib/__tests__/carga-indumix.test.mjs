// Pruebas del puente con Indumix (fase 1, solo lectura): docs/specs/2026-11-05-puente-indumix.md, punto 10.
// Con los datos reales grabados el 04/11 en Canning (lib/__fixtures__/indumix/). Sin base, sin red y sin la planta.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as X from "../../puente-carga/indumix-xml.mjs"
import * as I from "../carga/indumix.ts"
import * as K from "../carga/reloj.ts"
import * as A from "../carga/auditoria.ts"
import * as R from "../carga/receta.ts"
import * as CM from "../carga/control-mail.ts"
import * as M from "../control-ingresos/mail.ts"
import * as PS from "../carga/puente-servidor.ts"

const fx = (n) => readFileSync(new URL(`../__fixtures__/indumix/${n}`, import.meta.url), "utf8")
const reportes = JSON.parse(fx("reportes-03-11.json"))
const slot = (n) => reportes.find((r) => r.slot === n).variables
const ar = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h + 3, mi) // hora de Argentina → ms

const MAT = [
  { id: "af", name: "Arena Fina", tipo: "arido_fino" },
  { id: "a06", name: "Arena Trituración 0/6", tipo: "arido_fino" },
  { id: "p612", name: "Piedra Partida 6/12", tipo: "arido_grueso" },
  { id: "p620", name: "Piedra Partida 6/20", tipo: "arido_grueso" },
  { id: "cpc", name: "CPC 40", tipo: "cemento" },
  { id: "s90", name: "Sikament 90E", tipo: "aditivo_planta" },
  { id: "agua", name: "Agua", tipo: "agua" },
]
// Mapa del puesto real (migración 202611051200): la Tolva 1 arranca con 6/20
const SAL = [
  { salida: "arido_1", nombre_planta: "PIE 6/20 O 6/12", material_id: "p620", unidad_planta: "kg", factor: 1, alternativas: ["p612", "p620"] },
  { salida: "arido_2", nombre_planta: "piedra 06", material_id: "a06", unidad_planta: "kg", factor: 1 },
  { salida: "arido_3", nombre_planta: "ARENA", material_id: "af", unidad_planta: "kg", factor: 1 },
  { salida: "arido_4", nombre_planta: "PIE 6/20", material_id: "p620", unidad_planta: "kg", factor: 1 },
  { salida: "cemento_1", nombre_planta: "CP 40", material_id: "cpc", unidad_planta: "kg", factor: 1 },
  { salida: "cemento_2", nombre_planta: "CP 40", material_id: "cpc", unidad_planta: "kg", factor: 1 },
  { salida: "aditivo_1", nombre_planta: "PLASTIF", material_id: "s90", unidad_planta: "g", factor: 0.001 },
  { salida: "aditivo_2", nombre_planta: "(vacío)", material_id: null, unidad_planta: "g", factor: 0.001 },
  { salida: "agua", nombre_planta: "Agua", material_id: "agua", unidad_planta: "L", factor: 1 },
]
const F620 = { id: "f620", code: "H40-620-15 B (CAN)", materiales: [
  { material_id: "p620", cantidad: 925 }, { material_id: "a06", cantidad: 232 }, { material_id: "af", cantidad: 696 },
  { material_id: "cpc", cantidad: 365 }, { material_id: "s90", cantidad: 3.1 }, { material_id: "agua", cantidad: 170 },
] }
const F612 = { id: "f612", code: "H30-612-15 B (CAN)", materiales: [
  { material_id: "p612", cantidad: 950 }, { material_id: "a06", cantidad: 231 }, { material_id: "af", cantidad: 694 },
  { material_id: "cpc", cantidad: 330 }, { material_id: "s90", cantidad: 2.8 }, { material_id: "agua", cantidad: 168 },
] }
const linea = (rep, s) => rep.lineas.find((l) => l.salida === s)

test("1 · XML: el pedido es el de hmi.js y la respuesta se limpia", () => {
  const ped = fx("pedido-inicio.xml")
  const vars = [...ped.matchAll(/<n>(.*?)<\/n>/g)].map((m) => m[1])
  assert.equal(vars.length, 10)
  assert.equal(X.armarPedido(vars), ped)
  const v = X.leerRespuesta(fx("respuesta-inicio-quieto.xml"))
  assert.equal(Object.keys(v).length, 102)
  assert.equal(v["Receta.Parametros.TxtAditivo1"], "PLASTIF")
  assert.equal(v["@GV.I6_BAC"], null) // "var not found"
  assert.equal(v["Receta.Parametros.TxtAditivo2"], "")
  assert.equal(X.leerRespuesta("<i><n>Receta.Parametros.TxtAditivo1</n><v>PLASTIF </v></i><i><n>x</n><v>H35 - 6/12 - 15 </v></i>")["Receta.Parametros.TxtAditivo1"], "PLASTIF")
  assert.equal(X.leerRespuesta("<i><n>x</n><v>A &amp; B</v></i>").x, "A & B")
})

test("1b · Estado de INICIO con la planta quieta", () => {
  const e = I.estadoDesdeVariables(X.leerRespuesta(fx("respuesta-inicio-quieto.xml")), "2026-11-04T12:38:31Z")
  assert.equal(e.receta, 15)
  assert.equal(e.receta_nombre, "H40-6/20-15 B")
  assert.equal(e.m3, 8)
  assert.equal(e.en_ciclo, false)
  assert.equal(e.contador, 13)
  assert.equal(e.m3_ciclo, 2)
  assert.deepEqual(e.humedades, [0, 0, 3, 0])
  assert.equal(e.cliente, "")
  assert.equal(e.camion, "")
  assert.equal(e.observacion, "")
  assert.equal(e.tiempo_ciclo, "6:33")
  assert.equal(e.reloj_plc, "5 : 37 - 4/11/2026")
  assert.equal(e.objetivo.cemento_2, 734.985)
  assert.equal(e.nombres.arido_1, "PIE 6/20 O 6/12")
  assert.equal(I.estadoPantalla(e), "QUIETA")
  const p = I.estadoPlantaDeVivo(e)
  assert.equal(p.seleccion.receta, 15)
  assert.equal(p.salidas.find((s) => s.salida === "arido_3").humedad_pct, 3)
  assert.ok(Number.isNaN(p.salidas[0].nivel_pct)) // Indumix no da niveles: la pantalla muestra "—"
  assert.equal(I.objetivoQuieta(e).arido_1, 1892.44)
})

test("2 · Reloj de Indumix: fecha real atrasada", () => {
  assert.deepEqual(K.fechaPlc("10 : 54 - 3/11/2026"), { anio: 2026, mes: 11, dia: 3, h: 10, mi: 54 })
  assert.deepEqual(K.fechaPlc("4:57 - 1/1/1970"), { anio: 1970, mes: 1, dia: 1, h: 4, mi: 57 })
  assert.deepEqual(K.fechaPlc("11 : 1 - 3/11/2026"), { anio: 2026, mes: 11, dia: 3, h: 11, mi: 1 })
  const deriva = K.derivaSegundos("5 : 37 - 4/11/2026", ar(2026, 11, 4, 9, 1))
  assert.equal(deriva, 3 * 3600 + 24 * 60)
  assert.equal(K.textoDeriva(deriva), "−3 h 24 min")
  // N° 13 sin verlo en vivo: inicio estimado 03/11 14:18 (hora_estimada)
  const L = I.reporteDesdeVariables(slot(1))
  assert.equal(K.horaReal(L.reporte.inicio_plc, deriva), ar(2026, 11, 3, 14, 18))
  assert.equal(L.dia_planta, "2026-11-03")
  // 1970: sin referencia no hay hora; con la del mismo día de Indumix, sí
  assert.equal(K.horaReal("4:57 - 1/1/1970", deriva), null)
  assert.equal(K.horaReal("4:57 - 1/1/1970", null, { plcSeg: 4 * 3600 + 50 * 60, puenteMs: 1_000_000 }), 1_000_000 + 7 * 60_000)
})

test("3 · Reporte N° 13 (normal)", () => {
  const L = I.reporteDesdeVariables(slot(1))
  const r = L.reporte
  assert.equal(r.numero, 13)
  assert.equal(r.receta, 15)
  assert.equal(r.receta_nombre, "H40-6/20-15 B")
  assert.equal(r.m3, 8)
  assert.equal(r.ciclos, 4)
  assert.equal(r.observacion, "0961")
  assert.equal(r.camion, "AG 083")
  assert.equal(r.tiempo_ciclo, "6:33")
  const c2 = linea(r, "cemento_2")
  assert.deepEqual([c2.receta, c2.teorico, c2.teorico_corregido, c2.real], [365, 2920, 2920, 2930])
  assert.equal(A.desvio({ grupo: "cemento", teorico_corregido: c2.teorico_corregido, real: c2.real }), false) // +0,3 %
  const agua = linea(r, "agua")
  assert.equal(agua.teorico, 1360)
  assert.equal(agua.real, 1196)
  assert.equal(agua.teorico_corregido, null) // sin la humedad con que se pesó, no se evalúa
  assert.equal(L.sin_humedad, true)
  assert.equal(L.sinMaterial, false)
  assert.equal(r.parada, false)
  assert.equal(r.m3_cargados, 8)
  // Con la humedad vista en vivo (arena 3 %): el agua corregida da 1.193 L y lo real (1.196) entra
  const V = I.reporteDesdeVariables(slot(1), { humedades: ["0", "0", "3", "0"] })
  assert.equal(linea(V.reporte, "agua").teorico_corregido, 1193)
  assert.equal(linea(V.reporte, "arido_3").teorico_corregido, 5735)
  assert.equal(A.desvio({ grupo: "agua", teorico_corregido: 1193, real: 1196 }), false)
})

test("4 · N° 8 dos veces (slots 6 y 7): sin material, ninguna carga, sin choque", () => {
  const a = I.reporteDesdeVariables(slot(6)), b = I.reporteDesdeVariables(slot(7))
  assert.equal(a.reporte.numero, 8)
  assert.equal(b.reporte.numero, 8)
  assert.equal(a.reporte.inicio_plc, b.reporte.inicio_plc) // el mismo índice de cargas chocaría
  assert.equal(a.sinMaterial, true)
  assert.equal(b.sinMaterial, true)
  // Dos eventos distintos, y el mismo leído otra vez da la misma clave (no se graba dos veces)
  const ka = I.claveSinMaterial("p", a.dia_planta, a.reporte), kb = I.claveSinMaterial("p", b.dia_planta, b.reporte)
  assert.notEqual(ka, kb)
  assert.equal(I.claveSinMaterial("p", a.dia_planta, I.reporteDesdeVariables(slot(6)).reporte), ka)
  // Los 10 reportes: solo los dos N° 8 vienen sin material
  assert.deepEqual(reportes.filter((x) => I.reporteDesdeVariables(x.variables).sinMaterial).map((x) => x.slot), [6, 7])
})

test("5 · N° 5: carga corta, sin remito", () => {
  const L = I.reporteDesdeVariables(slot(10))
  const r = L.reporte
  assert.equal(r.numero, 5)
  assert.equal(r.cliente, "")
  assert.equal(r.camion, "")
  assert.equal(r.observacion, "")
  assert.equal(r.m3, 7.5)
  assert.equal(L.cemento.real, 2074)
  assert.ok(Math.abs(L.cemento.teorico - 2737.5) <= 0.5) // Indumix lo redondea a 2.738
  assert.equal(Math.round(L.cemento.pct * 100), -24)
  assert.equal(r.m3_cargados, 5.7)
  assert.equal(L.m3_estimado, true)
  assert.equal(r.parada, true)
  assert.deepEqual(r.extras.map((x) => x.litros), [8])
  assert.equal(linea(r, "agua").extra, 8)
  // Sin remito: el emparejador no tiene con qué unirla
  assert.equal(A.emparejar({ observacion: r.observacion, patente: r.camion, fin: Date.now() }, [{ id: "d", remito: "957", patente: "AE402GT", at: Date.now() }]), null)
})

test("6 · N° 7: aditivo 16.130 contra 22.400 g (−28 %) es desvío", () => {
  const r = I.reporteDesdeVariables(slot(8)).reporte
  assert.equal(r.numero, 7)
  const ad = linea(r, "aditivo_1")
  assert.deepEqual([ad.teorico, ad.teorico_corregido, ad.real], [22400, 22400, 16130])
  assert.equal(Math.round((ad.real / ad.teorico - 1) * 100), -28)
  assert.equal(A.desvio({ grupo: "aditivo", teorico_corregido: ad.teorico_corregido, real: ad.real }), true)
})

test("7 · Receta 15: lectura, cambio de rosca, solo agua y aditivo a 0", () => {
  const v = X.leerRespuesta(fx("respuesta-receta-15.xml"))
  const r = I.recetaDesdeVariables(15, v)
  const val = R.valoresReceta(r)
  assert.equal(r.nombre, "H40-6/20-15 B")
  assert.equal(r.habilitada, true)
  assert.deepEqual([val.arido_1, val.arido_2, val.arido_3, val.arido_4, val.cemento_1, val.cemento_2, val.agua, val.aditivo_1], [925, 232, 696, 0, 0, 365, 170, 0])
  assert.equal(r.salidas.find((s) => s.salida === "arido_1").orden, 2)
  assert.equal(r.salidas.find((s) => s.salida === "arido_1").nombre_planta, "PIE 6/20 O 6/12")
  assert.equal(I.recetaDesdeVariables(14, v), null) // lo leído no es la receta pedida
  // Antes y después de pasar el cemento de la rosca 2 a la 1: cambia la huella, el control da lo mismo → receta_salida
  const g = JSON.parse(fx("receta-15-guardar.json"))
  const antes = I.recetaDesdeVariables(15, g.antes), despues = I.recetaDesdeVariables(15, g.despues)
  assert.notEqual(R.huellaReceta(antes), R.huellaReceta(despues))
  const ca = R.compararReceta(antes, F620, SAL, MAT), cd = R.compararReceta(despues, F620, SAL, MAT)
  assert.deepEqual(ca.filas, cd.filas)
  assert.equal(I.clasificarCambioReceta(antes, despues, SAL), "salida")
  // Solo agua (150 → 170): receta_agua, sin alerta
  const con = (base, cambios) => ({ ...base, salidas: base.salidas.map((s) => (s.salida in cambios ? { ...s, valor: cambios[s.salida] } : s)) })
  assert.equal(I.clasificarCambioReceta(con(r, { agua: 150 }), con(r, { agua: 170 }), SAL), "agua")
  // Aditivo 2.800 → 0: frena → alerta receta_cambiada
  assert.equal(I.clasificarCambioReceta(con(r, { aditivo_1: 2800 }), r, SAL), "frena")
  assert.equal(I.clasificarCambioReceta(r, con(r, { cemento_2: 370 }), SAL), "frena")
  assert.equal(I.clasificarCambioReceta(r, { ...r, nombre: "otro" }, SAL), "otro")
  assert.equal(I.clasificarCambioReceta(r, r, SAL), "igual")
  // La receta del reporte (N° 13) es igual a la versión leída; con aditivo distinto, hay que volver a leerla
  const rep = I.reporteDesdeVariables(slot(1)).reporte
  assert.equal(I.recetaDeReporteDistinta(rep, r), false)
  assert.equal(I.recetaDeReporteDistinta(I.reporteDesdeVariables(slot(8)).reporte, r), true)
  assert.equal(I.nombreRecetaComoFormula("H40-6/20-15 B"), "H40-620-15 B")
  assert.equal(I.nombreRecetaComoFormula("H 35 - 6/12 - 10 B"), "H35-612-10 B")
})

test("8 · Emparejar con patentes de Indumix", () => {
  const fin = ar(2026, 11, 3, 9, 32)
  const cand = [{ id: "d958", remito: "958", tipo: "R", patente: "AG083GT", at: fin - 10 * 60_000 }, { id: "d402", remito: "960", tipo: "R", patente: "AE402GT", at: fin - 5 * 60_000 }]
  assert.deepEqual(A.emparejar({ observacion: "0958", patente: "AG - 083", fin }, cand), { id: "d958", union: "por remito (Observación)" })
  assert.deepEqual(A.emparejar({ observacion: "", patente: "AG - 083", fin }, cand), { id: "d958", union: "por camión y hora" })
  assert.equal(A.emparejar({ observacion: "", patente: "AG083", fin }, [cand[1]]), null)
  assert.equal(A.mismaPatente("AG - 083", "AG083GT"), true)
  assert.equal(A.mismaPatente("AG08", "AG083GT"), false) // menos de 5 caracteres no alcanza
  assert.equal(A.mismaPatente("AF - 431", "AF431KL"), true)
})

test("9 · Escritura: lista cerrada y URL como la de Indumix", () => {
  assert.equal(X.escrituraPermitida("Receta.neReporte", 3), true)
  assert.equal(X.escrituraPermitida("Receta.neReceta", 20), true)
  assert.equal(X.escrituraPermitida("Receta.neReceta", 21), false)
  assert.equal(X.escrituraPermitida("Receta.neReporte", 0), false)
  assert.equal(X.escrituraPermitida("Receta.neReporte", 2.5), false)
  assert.equal(X.escrituraPermitida("@GV.nReceta", 15), false)
  assert.equal(X.escrituraPermitida("@GV.Registro.m3Carga", 8), false)
  assert.equal(X.escrituraPermitida("Receta.beReceta", 1), false)
  assert.equal(X.escrituraPermitida("toString", 1), false)
  assert.throws(() => X.urlEscritura("http://192.168.0.10", "@GV.nReceta", 15))
  assert.throws(() => { X.ESCRITURAS_PERMITIDAS["@GV.nReceta"] = [1, 20] })
  const gets = fx("escritura.txt").split("\n").filter((l) => l.startsWith("GET ")).map((l) => l.slice(4))
  assert.equal(X.urlEscritura("http://192.168.0.10", "Receta.neReporte", 3), gets[0])
  assert.equal(X.urlEscritura("http://192.168.0.10/", "Receta.neReceta", 16), gets[1])
  // Las variables con @ van codificadas igual que en Indumix (%40), aunque el puente no las escriba
  assert.equal(`http://192.168.0.10${X.RUTA_ESCRIBIR}?${encodeURIComponent("@GV.nReceta")}+16`, gets[2])
  // Solo Indumix en la red de la planta y nuestro servidor
  assert.equal(X.baseIndumix("http://192.168.0.10"), "http://192.168.0.10")
  assert.throws(() => X.baseIndumix("http://8.8.8.8"))
  assert.throws(() => X.baseIndumix("https://192.168.0.10"))
  assert.throws(() => X.baseIndumix("http://192.168.0.10/otra"))
  assert.equal(X.direccionPermitida("https://www.produccionrebucret.com/api/carga/puente", "http://192.168.0.10"), true)
  assert.equal(X.direccionPermitida("http://192.168.0.10/cgi-bin/ILRReadValues.exe", "http://192.168.0.10"), true)
  assert.equal(X.direccionPermitida("http://192.168.0.11/cgi-bin/ILRReadValues.exe", "http://192.168.0.10"), false)
  assert.equal(X.direccionPermitida("https://produccionrebucret.com.evil.com/", "http://192.168.0.10"), false)
})

test("10 · Humedad de la arena (H1 y H2)", () => {
  const h2 = I.controlHumedad({ indumix: 3, medida: { pct: 6, hhmm: "07:30" }, minutos: 10 * 60 })
  assert.equal(h2.regla, "H2")
  assert.equal(h2.texto, "Humedad de la arena: Indumix 3 % · medida hoy 6 % (07:30)")
  assert.match(I.controlHumedad({ indumix: 3, medida: { pct: 6, hhmm: "07:30" }, minutos: 600, sinCambioDesdeAyer: true }).texto, /en Indumix no se cambió desde ayer$/)
  assert.equal(I.controlHumedad({ indumix: 3, medida: { pct: 4 }, minutos: 600 }).regla, null)
  assert.equal(I.controlHumedad({ indumix: 3, medida: { pct: 4.5 }, minutos: 600 }).regla, null) // 1,5 justo no avisa
  assert.deepEqual(I.controlHumedad({ indumix: 3, medida: null, minutos: 7 * 60 }), { regla: "H1", texto: "Falta la humedad de la arena de hoy" })
  assert.equal(I.controlHumedad({ indumix: 3, medida: null, minutos: 6 * 60 }).regla, null)
  assert.equal(I.controlHumedad({ indumix: 3, medida: null, minutos: 6 * 60, cargoHoy: true }).regla, "H1")
})

test("11 · Tolva 1: aviso cuando cambia la piedra que pide la receta", () => {
  const r15 = I.recetaDesdeVariables(15, X.leerRespuesta(fx("respuesta-receta-15.xml")))
  const t1 = SAL[0]
  const r612 = { nombre: "H30-612-15 B", salidas: [{ salida: "arido_1", valor: 950 }, { salida: "cemento_1", valor: 330 }] }
  const a = I.controlTolva1({ numero: 13, receta: r612, formula: F612, salida: t1, materiales: MAT, ultimo: "p620" })
  assert.equal(a.aviso, true)
  assert.equal(a.lleva, "p612")
  assert.equal(a.texto, "¿Cambiaron la piedra de la Tolva 1? La receta 13 lleva 6/12 y lo último fue 6/20")
  // Sin fórmula asignada: por el nombre
  assert.equal(I.controlTolva1({ numero: 13, receta: r612, formula: null, salida: t1, materiales: MAT, ultimo: "p620" }).aviso, true)
  // A otra 6/20: nada
  assert.equal(I.controlTolva1({ numero: 15, receta: r15, formula: F620, salida: t1, materiales: MAT, ultimo: "p620" }).aviso, false)
  // Una que no pesa en la Tolva 1: nada
  assert.equal(I.controlTolva1({ numero: 8, receta: { nombre: "H30-612-15 B", salidas: [{ salida: "arido_1", valor: 0 }, { salida: "arido_4", valor: 900 }] }, formula: F612, salida: t1, materiales: MAT, ultimo: "p620" }).aviso, false)
})

test("12 · Clave del puente", async () => {
  const buena = PS.generarClave()
  assert.match(buena, /^rbp_[A-Za-z0-9_-]{43}$/)
  const fila = { id: "pu1", plant_id: "can", nombre: "Canning · Indumix", sistema: "indumix", etapa: "lectura", activo: true }
  const base = new Map([[PS.hashClave(buena), fila]])
  const buscar = async (h) => base.get(h) || null
  const ok = await PS.verificarClave(buena, buscar)
  assert.equal(ok.puesto.id, "pu1")
  assert.equal(PS.usuarioPuente(ok.puesto), "Puente Canning")
  assert.equal(await PS.verificarClave(PS.generarClave(), buscar), null)
  assert.equal(await PS.verificarClave(null, buscar), null)
  assert.equal(await PS.verificarClave("cualquier cosa", buscar), null)
  fila.etapa = "apagado"
  assert.equal((await PS.verificarClave(buena, buscar)).status, 409)
  fila.etapa = "lectura"; fila.activo = false
  assert.equal((await PS.verificarClave(buena, buscar)).status, 409)
  const cfg = PS.configPuente({ ...ok.puesto, info_planta: { primer_latido_at: "2026-11-05T10:00:00Z" } }, Date.parse("2026-11-05T12:00:00Z"))
  assert.equal(cfg.muestrear_crudo_hasta, "2026-11-12T10:00:00.000Z")
  assert.ok(cfg.variables.estado.includes("Receta.neReceta") && cfg.variables.estado.includes("Main.Falla_TAC"))
})

test("12b · Alarmas y huecos del contador", () => {
  const al = I.alarmasDesdeVariables(X.leerRespuesta(fx("respuesta-alarma.xml")))
  assert.deepEqual(al.map((a) => a.codigo), ["Main.Falla_TAC"])
  assert.match(al[0].texto, /a confirmar con Egacom/)
  assert.deepEqual(I.huecosContador([13, 12, 11, 10, 9, 8, 8, 7, 6, 5]), [])
  assert.deepEqual(I.huecosContador([5, 6, 9, 10, 13]), [7, 8, 11, 12])
  assert.equal(I.textoPerdidas([3, 4]), "Faltan los N° 3 y 4: Indumix guarda solo 10")
  const tot = X.leerRespuesta(fx("respuesta-totales.xml"))
  assert.equal(tot["Receta.ConsumoT.Cemento1"], "5531027")
})

// ── Mail ──
const cargaMail = (n, extra = {}) => {
  const r = I.reporteDesdeVariables(slot(n)).reporte
  return {
    id: `c${r.numero}`, contador: r.numero, fin_at: "2026-11-03T14:00:00Z", remito: null, remito_tipo: null, camion: r.camion || null, formula_id: null, formula_code: null,
    receta_numero: r.receta, receta_nombre: r.receta_nombre, m3_remito: null, m3: r.m3, m3_cargados: r.m3_cargados,
    materiales: r.lineas.map((l) => ({ salida: l.salida, receta_por_m3: l.receta, teorico: l.teorico, teorico_corregido: l.teorico_corregido, real: l.real })), ...extra,
  }
}

test("13 · Mail: cargas cortas, sin remito y el mail de siempre sin puesto real", () => {
  const datos = {
    planta: "Canning", cargas: [
      cargaMail(10),
      cargaMail(8, { remito: "0956", remito_tipo: "R", m3_remito: 8, formula_id: "f620", formula_code: "H40-620-15 B (CAN)" }),
      cargaMail(1, { remito: "0961", remito_tipo: "R", m3_remito: 8, formula_id: "f620", formula_code: "H40-620-15 B (CAN)" }),
    ],
    formulas: [], salidas: SAL, materiales: MAT, ultimoLatidoAt: "2026-11-03T19:20:00Z",
  }
  const s = CM.seccionCarga(datos)
  assert.match(s.html, /Cargas cortas o con desvío \(2\)/)
  assert.match(s.html, /Sin remito \(1\)/)
  assert.match(s.html, /Carga de planta · Canning/)
  assert.match(s.html, /cemento 2\.074 de 2\.738 kg \(−24 %\)/)
  assert.match(s.html, /aditivo 16\.130 de 22\.400 g \(−28 %\)/)
  assert.match(s.html, /3 cargas leídas · último dato del puente 16:20/)
  assert.equal(s.n, 3)
  // Receta distinta de la fórmula, agrupada (la receta 15 sin aditivo contra 3,1 kg/m³ de la fórmula)
  const conF = CM.seccionCarga({ ...datos, formulas: [F620] })
  assert.match(conF.html, /Receta distinta de la fórmula \(2\)/) // N° 7 (aditivo 2.800 g, agua 160) y N° 13 (sin aditivo)
  assert.equal(conF.n, 5)
  assert.match(conF.html, /Receta 15 \(H40-6\/20-15 B\) contra H40-620-15 B \(CAN\): Sikament 90E 0 g contra 3\.100 g · 1 carga \(0961\)/)
  // Sin diferencias: una línea
  const sin = CM.seccionCarga({ ...datos, cargas: [cargaMail(1, { remito: "0961", m3_remito: 8 })] })
  assert.equal(sin.n, 0)
  assert.match(sin.html, /Carga de planta: 1 carga leída, sin diferencias/)
  // armarMail: sin `carga`, el asunto y el HTML de siempre; con diferencias, se suma al asunto
  const base = { tipo: "diario", nuevas: [], link: "https://x/materias-primas?tab=control", hoy: "2026-11-04" }
  const hoy = M.armarMail(base)
  assert.equal(hoy.asunto, "Rebucret · Control de ingresos MP: sin inconsistencias hoy")
  assert.equal(/Carga de planta/.test(hoy.html), false)
  assert.deepEqual(M.armarMail({ ...base, carga: null }), hoy)
  assert.deepEqual(M.armarMail({ ...base, carga: { html: "", n: 0 } }), hoy)
  const con = M.armarMail({ ...base, carga: s })
  assert.equal(con.asunto, "Rebucret · Control de ingresos MP: sin inconsistencias hoy · 3 de carga de planta")
  assert.ok(con.html.indexOf("Carga de planta · Canning") < con.html.indexOf("Toneladas iguales"))
  assert.equal(M.armarMail({ ...base, carga: sin }).asunto, hoy.asunto)
})

test("13b · Resumen de cambios de receta", () => {
  const r = I.recetaDesdeVariables(15, X.leerRespuesta(fx("respuesta-receta-15.xml")))
  const v = (at, cambios) => ({ numero: 15, nombre: r.nombre, primera_lectura_at: at, salidas: r.salidas.map((s) => (s.salida in cambios ? { ...s, valor: cambios[s.salida] } : s)) })
  const vs = [
    v("2026-11-03T09:00:00Z", { agua: 150, aditivo_1: 2800, cemento_1: 365, cemento_2: 0 }),
    v("2026-11-03T10:00:00Z", { agua: 170, aditivo_1: 2800, cemento_1: 365, cemento_2: 0 }),
    v("2026-11-03T11:00:00Z", { agua: 160, aditivo_1: 2800, cemento_1: 0, cemento_2: 365 }),
    v("2026-11-03T11:43:00Z", { agua: 170, aditivo_1: 0, cemento_1: 0, cemento_2: 365 }),
  ]
  const [x] = CM.resumenCambios(vs, "2026-11-03T09:30:00Z")
  assert.equal(x.texto, "Receta 15: agua 150 → 170 → 160 → 170 · aditivo 2.800 → 0 g (08:43) · cemento pasó a la rosca 2")
  assert.deepEqual(CM.resumenCambios(vs.slice(0, 1)), [])
})
