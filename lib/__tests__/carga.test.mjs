// Pruebas de la carga de planta (docs/migracion-loop/carga-planta.md): simulador de Indumix, control de receta
// (tolerancias, Tolva 1, el agua que no frena), puente, reloj de 1970, emparejador, auditoría y cierre.
// Sin base, sin red y sin la planta.
import { test } from "node:test"
import assert from "node:assert/strict"
import * as T from "../carga/tipos.ts"
import * as R from "../carga/receta.ts"
import * as S from "../carga/simulador.ts"
import * as P from "../carga/puente.ts"
import * as K from "../carga/reloj.ts"
import * as A from "../carga/auditoria.ts"
import * as C from "../carga/cierre.ts"
import * as RS from "../carga/recetas-sim.ts"

// ── Datos de Canning (los de producción, con ids de prueba) ──
const MAT = [
  { id: "af", name: "Arena Fina", tipo: "arido_fino" },
  { id: "a06", name: "Arena Trituración 0/6", tipo: "arido_fino" },
  { id: "p612", name: "Piedra Partida 6/12", tipo: "arido_grueso" },
  { id: "p620", name: "Piedra Partida 6/20", tipo: "arido_grueso" },
  { id: "cpc", name: "CPC 40", tipo: "cemento" },
  { id: "s90", name: "Sikament 90E", tipo: "aditivo_planta" },
  { id: "esp", name: "Espumígeno", tipo: "aditivo_planta" },
  { id: "agua", name: "Agua", tipo: "agua" },
  { id: "s33", name: "Sikament 33S", tipo: "aditivo_obra" },
  { id: "fib", name: "Fibra", tipo: "fibra" },
]
const SAL = (t1 = "p612") => [
  { salida: "arido_1", nombre_planta: "PIE 6/20 O 6/12", material_id: t1, unidad_planta: "kg", factor: 1, alternativas: ["p612", "p620"] },
  { salida: "arido_2", nombre_planta: "piedra 06", material_id: "a06", unidad_planta: "kg", factor: 1 },
  { salida: "arido_3", nombre_planta: "ARENA", material_id: "af", unidad_planta: "kg", factor: 1 },
  { salida: "arido_4", nombre_planta: "PIE 6/20", material_id: "p620", unidad_planta: "kg", factor: 1 },
  { salida: "cemento_1", nombre_planta: "CP 40", material_id: "cpc", unidad_planta: "kg", factor: 1 },
  { salida: "cemento_2", nombre_planta: "CP 40", material_id: "cpc", unidad_planta: "kg", factor: 1 },
  { salida: "aditivo_1", nombre_planta: "PLASTIF", material_id: "s90", unidad_planta: "g", factor: 0.001 },
  { salida: "aditivo_2", nombre_planta: "(vacío)", material_id: null, unidad_planta: "g", factor: 0.001 },
  { salida: "agua", nombre_planta: "Agua", material_id: "agua", unidad_planta: "L", factor: 1 },
]
// H30-612-15 B (CAN): la de producción (Grow v8)
const F612 = { id: "f612", code: "H30-612-15 B (CAN)", materiales: [
  { material_id: "agua", cantidad: 168 }, { material_id: "af", cantidad: 694 }, { material_id: "a06", cantidad: 231 },
  { material_id: "cpc", cantidad: 330 }, { material_id: "p612", cantidad: 950 }, { material_id: "s33", cantidad: 0.99 }, { material_id: "s90", cantidad: 2.805 },
] }
const F620 = { id: "f620", code: "H30-620-10 C (CAN)", materiales: [
  { material_id: "agua", cantidad: 165 }, { material_id: "af", cantidad: 705 }, { material_id: "a06", cantidad: 235 },
  { material_id: "cpc", cantidad: 310 }, { material_id: "p620", cantidad: 970 }, { material_id: "s90", cantidad: 2.635 }, { material_id: "fib", cantidad: 0.5 },
] }
const RDC = { id: "frdc", code: "RDC-300 (CAN)", materiales: [{ material_id: "agua", cantidad: 170 }, { material_id: "af", cantidad: 1320 }, { material_id: "cpc", cantidad: 300 }, { material_id: "esp", cantidad: 0.6 }] }

const receta = (numero, v, nombre = "R", orden = { arido_3: 1, arido_1: 2, arido_2: 3 }) => ({
  numero, nombre, habilitada: true,
  salidas: T.SALIDAS.map((s) => ({ salida: s, nombre_planta: s, valor: v[s] || 0, unidad: T.INFO_SALIDA[s].unidad, ...(orden[s] ? { orden: orden[s] } : {}) })),
})
// Receta 13 de la foto de Indumix
const R13 = receta(13, { arido_1: 950, arido_2: 231, arido_3: 694, cemento_1: 350, aditivo_1: 2800, agua: 110 }, "H30-612-15 B")
// Igual a la fórmula
const R13ok = receta(13, { arido_1: 950, arido_2: 231, arido_3: 694, cemento_1: 330, aditivo_1: 2805, agua: 168 }, "H30-612-15 B")
const ctl = (rec, extra = {}) => R.controlReceta({ numero: 13, receta: rec, formula: F612, salidas: SAL(), materiales: MAT, ...extra })

// ───────────────────────────── Control de receta ─────────────────────────────
test("receta igual a la fórmula: no frena, todo ✓ (el aditivo de obra y la fibra no se comparan)", () => {
  const c = ctl(R13ok)
  assert.equal(c.frena, false)
  assert.equal(c.aguaDistinta, false)
  assert.equal(c.cmp.ok, true)
  assert.ok(!c.cmp.filas.some((f) => f.material_id === "s33"), "Sikament 33S (obra) afuera")
  assert.deepEqual(c.items.map((i) => [i.clave, i.ok]), [["receta", true], ["agua", true], ["tolva", true]])
})

test("receta 13 de la foto: el cemento (350 contra 330) FRENA; el agua (110 contra 168) resalta y NO frena", () => {
  const c = ctl(R13)
  assert.equal(c.frena, true)
  assert.equal(c.frenaReceta, true)
  assert.equal(c.frenaTolva, false)
  assert.deepEqual(c.cmp.malNoAgua.map((f) => f.material_id), ["cpc"])
  assert.equal(c.cmp.malAgua.material_id, "agua")
  assert.equal(c.aguaDistinta, true)
  assert.equal(Math.round(c.ac.receta * 100) / 100, 0.31)
  assert.equal(Math.round(c.ac.formula * 100) / 100, 0.51)
  assert.match(c.motivo, /La receta 13 de la planta no coincide con H30-612-15 B \(CAN\): CPC 40 350 kg contra 330 kg/)
  const agua = c.items.find((i) => i.clave === "agua")
  assert.equal(agua.ok, true); assert.equal(agua.aviso, true)
})

test("solo el agua distinta: la carga NO se frena, queda el aviso ámbar", () => {
  const solo = receta(13, { arido_1: 950, arido_2: 231, arido_3: 694, cemento_1: 330, aditivo_1: 2805, agua: 110 })
  const c = ctl(solo)
  assert.equal(c.frena, false)
  assert.equal(c.aguaDistinta, true)
  assert.equal(c.motivo, null)
})

test("tolerancias de 6.2: cemento ±1 % (mín 2 kg), áridos ±1 % (mín 5), aditivo ±2 % (mín 20 g), agua ±2 % (mín 3 L)", () => {
  const conCem = (x) => ctl(receta(13, { arido_1: 950, arido_2: 231, arido_3: 694, cemento_1: x, aditivo_1: 2805, agua: 168 })).frena
  assert.equal(conCem(333.3), false, "330 + 1 % = 333,3")
  assert.equal(conCem(333.4), true)
  assert.equal(conCem(326.7), false)
  const conAr = (x) => ctl(receta(13, { arido_1: 950, arido_2: x, arido_3: 694, cemento_1: 330, aditivo_1: 2805, agua: 168 })).frena
  assert.equal(conAr(236), false, "231: el mínimo de 5 kg manda sobre el 1 %")
  assert.equal(conAr(236.1), true)
  const conAd = (g) => ctl(receta(13, { arido_1: 950, arido_2: 231, arido_3: 694, cemento_1: 330, aditivo_1: g, agua: 168 })).frena
  assert.equal(conAd(2800), false, "2.800 g contra 2.805 g")
  assert.equal(conAd(2861), false, "+2 % = 2.861,1 g")
  assert.equal(conAd(2862), true)
  const conAgua = (l) => ctl(receta(13, { arido_1: 950, arido_2: 231, arido_3: 694, cemento_1: 330, aditivo_1: 2805, agua: l }))
  assert.equal(conAgua(171).aguaDistinta, false, "168 + 3 L")
  assert.equal(conAgua(171.5).aguaDistinta, true)
  assert.equal(conAgua(171.5).frena, false, "el agua nunca frena")
})

test("Tolva 1 con la piedra equivocada: frena con su motivo, y no cuenta como diferencia de receta", () => {
  const c = R.controlReceta({ numero: 13, receta: R13ok, formula: F612, salidas: SAL("p620"), materiales: MAT })
  assert.equal(c.frenaTolva, true)
  assert.equal(c.frenaReceta, false)
  assert.equal(c.frena, true)
  assert.equal(c.motivo, "La fórmula pide Piedra Partida 6/12 y la Tolva 1 tiene Piedra Partida 6/20")
  // La autorización de "solo esta carga" NO sirve para la Tolva 1
  const aut = R.controlReceta({ numero: 13, receta: R13ok, formula: F612, salidas: SAL("p620"), materiales: MAT, autorizada: { por: "Bautista" } })
  assert.equal(aut.frena, true)
})

test("autorizar solo esta carga: la receta distinta deja de frenar y queda marcada", () => {
  const c = ctl(R13, { autorizada: { por: "Bautista", motivo: "camión esperando" } })
  assert.equal(c.frena, false)
  const r = c.items.find((i) => i.clave === "receta")
  assert.equal(r.ok, true); assert.equal(r.aviso, true)
  assert.match(r.texto, /autorizada solo esta carga \(Bautista\)/)
})

test("la receta pesa en una salida sin material (Aditivo 2 vacío): frena", () => {
  const c = ctl(receta(13, { arido_1: 950, arido_2: 231, arido_3: 694, cemento_1: 330, aditivo_1: 2805, aditivo_2: 500, agua: 168 }))
  assert.equal(c.frena, true)
  assert.deepEqual(c.cmp.sueltas, ["aditivo_2"])
  assert.match(c.motivo, /pesa en Aditivo 2, sin material/)
})

test("material de la fórmula que no está en ninguna salida (Espumígeno de los RDC): no coincide", () => {
  const r = receta(14, { arido_3: 1320, cemento_1: 300, agua: 170 })
  const c = R.controlReceta({ numero: 14, receta: r, formula: RDC, salidas: SAL(), materiales: MAT })
  assert.equal(c.frena, true)
  assert.ok(c.cmp.malNoAgua.some((f) => f.material_id === "esp" && f.receta === 0))
})

test("sin receta asignada o receta vacía: frena con el motivo", () => {
  const sin = R.controlReceta({ numero: null, receta: null, formula: F612, salidas: SAL(), materiales: MAT })
  assert.equal(sin.frena, true)
  assert.match(sin.motivo, /no tiene receta entre las 20/)
  const vac = R.controlReceta({ numero: 20, receta: receta(20, {}), formula: F612, salidas: SAL(), materiales: MAT })
  assert.match(vac.motivo, /La receta 20 de la planta está vacía/)
})

test("huella y diferencias de una receta", () => {
  assert.equal(R.huellaReceta(R13), R.huellaReceta(JSON.parse(JSON.stringify(R13))))
  assert.notEqual(R.huellaReceta(R13), R.huellaReceta(R13ok))
  const otra = JSON.parse(JSON.stringify(R13)); otra.salidas.find((s) => s.salida === "cemento_1").valor = 330
  assert.equal(R.diferenciasReceta(R13, otra), "cemento_1: 350 → 330")
})

test("ficha para Indumix: sin la confirmación de Grow no lleva el agua", () => {
  const sin = R.fichaParaIndumix(R13, F612, SAL(), MAT, false)
  assert.deepEqual(sin.lineas.map((l) => [l.salida, l.antes, l.despues]), [["cemento_1", 350, 330], ["aditivo_1", 2800, 2805]])
  assert.equal(sin.aguaPendiente, true)
  const con = R.fichaParaIndumix(R13, F612, SAL(), MAT, true)
  assert.ok(con.lineas.some((l) => l.salida === "agua" && l.antes === 110 && l.despues === 168))
})

test("recetas iniciales del simulador: 13 = la real de la foto (frena), las demás iguales a su fórmula", () => {
  const { recetas, mapeo } = RS.recetasIniciales([{ ...F620, usos: 448 }, { ...F612, usos: 35 }, { ...RDC, usos: 17 }], SAL(), MAT)
  assert.equal(recetas.length, 20)
  assert.equal(mapeo.find((m) => m.numero === 13).formula_id, "f612")
  assert.equal(mapeo.find((m) => m.numero === 1).formula_id, "f620")
  assert.equal(mapeo.find((m) => m.numero === 17).tipo, "rotativa")
  const r1 = recetas[0]
  const c1 = R.controlReceta({ numero: 1, receta: r1, formula: F620, salidas: SAL(), materiales: MAT })
  assert.equal(c1.frena, false, "H30-620-10 C: Tolva 4 con 6/20")
  assert.equal(r1.salidas.find((s) => s.salida === "arido_4").valor, 970)
  assert.equal(r1.salidas.find((s) => s.salida === "aditivo_1").valor, 2635, "kg → g")
  const c13 = R.controlReceta({ numero: 13, receta: recetas[12], formula: F612, salidas: SAL(), materiales: MAT })
  assert.equal(c13.frena, true); assert.equal(c13.aguaDistinta, true)
  const crdc = R.controlReceta({ numero: 2, receta: recetas[1], formula: RDC, salidas: SAL(), materiales: MAT })
  assert.equal(crdc.frena, true, "el Espumígeno no tiene salida")
  assert.equal(recetas[19].salidas.every((s) => s.valor === 0), true)
})

// ───────────────────────────── Simulador ─────────────────────────────
const orden = (o = {}) => ({ receta: 13, secuencia: 1, m3: 3, cliente: "TOP", camion: "AG 083 GT", observacion: "0886", ...o })
async function cargarTodo(sim, o = orden()) {
  await sim.escribirOrden(o)
  await sim.arrancar()
  for (let i = 0; i < 2000 && sim.estado().en_ciclo; i++) sim.avanzar(1)
  return (await sim.leerReportes())[0]
}

test("simulador: 3 m³ con receta coincidente = 2 ciclos de 1,5 m³; el ciclo 2 compensa el 1", async () => {
  const sim = new S.SimuladorIndumix({ recetas: [R13ok], humedades: { arido_3: 0 }, contador: 14 })
  await sim.escribirOrden(orden())
  await sim.arrancar()
  let e = await sim.leerEstado()
  assert.equal(e.ciclos, 2); assert.equal(e.m3_ciclo, 1.5); assert.equal(e.ciclo, 1); assert.equal(e.contador_carga, 15)
  const objetivo1 = e.salidas.find((s) => s.salida === "cemento_1").objetivo
  assert.equal(objetivo1, 495, "990 / 2")
  sim.avanzar(S.DURACION_CICLO_S)
  e = await sim.leerEstado()
  assert.equal(e.ciclo, 2)
  const real1 = sim.carga.acum.cemento_1
  assert.ok(Math.abs(e.salidas.find((s) => s.salida === "cemento_1").objetivo - (990 - real1)) < 1e-9, "objetivo 2 = total − real del 1")
  sim.avanzar(S.DURACION_CICLO_S)
  e = await sim.leerEstado()
  assert.equal(e.en_ciclo, false)
  const rep = (await sim.leerReportes())[0]
  assert.equal(rep.numero, 15); assert.equal(rep.ciclos, 2); assert.equal(rep.m3, 3); assert.equal(rep.observacion, "0886"); assert.equal(rep.tiempo_ciclo, "1:48")
  assert.equal(rep.parada, false)
  const cem = rep.lineas.find((l) => l.salida === "cemento_1")
  assert.equal(cem.teorico, 990)
  assert.ok(Number.isInteger(cem.real) && Number.isInteger(cem.teorico), "kg enteros, como el reporte de Indumix")
  // Lo real de toda la carga queda adentro de la tolerancia de pesaje (cemento 1 %)
  assert.ok(Math.abs(cem.real - 990) <= 9.9)
})

test("simulador: la compensación del último ciclo da los números de la foto (cemento 521,925; Tolva 1 1.411,1)", async () => {
  // Error de pesaje fijo para el ciclo 1: cemento 1.050/2 → 528,075; Tolva 1 1.425 → 1.438,9
  const err = (s, ciclo) => (ciclo === 1 ? ({ cemento_1: 528.075 / 525 - 1, arido_1: 1438.9 / 1425 - 1 }[s] ?? 0) : 0)
  const sim = new S.SimuladorIndumix({ recetas: [R13], humedades: { arido_3: 3 }, errorPesaje: err })
  await sim.escribirOrden(orden())
  await sim.arrancar()
  sim.avanzar(S.DURACION_CICLO_S)
  const e = await sim.leerEstado()
  assert.equal(e.ciclo, 2)
  assert.equal(Math.round(e.salidas.find((s) => s.salida === "cemento_1").objetivo * 1000) / 1000, 521.925)
  assert.equal(Math.round(e.salidas.find((s) => s.salida === "arido_1").objetivo * 10) / 10, 1411.1)
})

test("simulador: con la receta 13 y H% 0/0/3/0, el agua teórica corregida da 268 L (330 − 62,5)", async () => {
  const sim = new S.SimuladorIndumix({ recetas: [R13], humedades: { arido_1: 0, arido_2: 0, arido_3: 3, arido_4: 0 }, errorPesaje: () => 0 })
  const rep = await cargarTodo(sim)
  const agua = rep.lineas.find((l) => l.salida === "agua")
  assert.equal(agua.teorico, 330)
  assert.equal(agua.teorico_corregido, 268)
  assert.equal(agua.real, 268)
  const arena = rep.lineas.find((l) => l.salida === "arido_3")
  assert.equal(arena.teorico, 2082)
  assert.equal(arena.teorico_corregido, 2144, "2.082 × 1,03 = 2.144,5")
  assert.equal(arena.humedad_pct, 3)
  assert.deepEqual(rep.humedades, [0, 0, 3, 0])
})

test("simulador: áridos uno atrás del otro en el orden de la receta; cemento, aditivo y agua en paralelo", async () => {
  const sim = new S.SimuladorIndumix({ recetas: [R13], errorPesaje: () => 0 })
  await sim.escribirOrden(orden())
  await sim.arrancar()
  sim.avanzar(4)
  let e = sim.estado()
  const pes = (s) => e.salidas.find((x) => x.salida === s).pesando
  assert.equal(pes("arido_3"), true, "primero la arena (orden 1)")
  assert.equal(pes("arido_1"), false)
  assert.equal(pes("cemento_1"), true)
  sim.avanzar(15)
  e = sim.estado()
  assert.equal(pes("arido_3"), false); assert.equal(pes("arido_1"), true)
  assert.equal(e.balanzas.find((b) => b.id === "aridos").estado, "pesando")
  sim.avanzar(40)
  e = sim.estado()
  assert.equal(e.balanzas.find((b) => b.id === "aridos").estado, "descargando")
  assert.equal(e.cinta_en_marcha, true)
  assert.ok(e.m3_en_trompo > 0 && e.m3_en_trompo < 1.5)
})

test("simulador: PARAR a mitad deja lo pesado y un reporte de carga parada", async () => {
  const sim = new S.SimuladorIndumix({ recetas: [R13], errorPesaje: () => 0 })
  await sim.escribirOrden(orden())
  await sim.arrancar()
  sim.avanzar(S.DURACION_CICLO_S + 70)
  await sim.parar()
  const e = await sim.leerEstado()
  assert.equal(e.parada, true); assert.equal(e.en_ciclo, false)
  const rep = (await sim.leerReportes())[0]
  assert.equal(rep.parada, true)
  assert.ok(rep.m3_cargados > 1.5 && rep.m3_cargados < 3)
  assert.ok(rep.lineas.find((l) => l.salida === "cemento_1").real > 525)
  sim.avanzar(500)
  assert.equal(sim.estado().ciclo, 2, "parada no sigue sola")
})

test("simulador: suspender detiene el tiempo y reanudar sigue; la alarma detiene la PLC", async () => {
  const sim = new S.SimuladorIndumix({ recetas: [R13] })
  await sim.escribirOrden(orden())
  await sim.arrancar()
  sim.avanzar(10)
  await sim.suspender()
  sim.avanzar(100)
  assert.equal(sim.estado().tiempo_ciclo_s, 10)
  assert.equal(sim.estado().suspendida, true)
  await sim.reanudar()
  sim.avanzar(5)
  assert.equal(sim.estado().tiempo_ciclo_s, 15)
  sim.provocar({ tipo: "alarma" })
  sim.avanzar(30)
  assert.equal(sim.estado().tiempo_ciclo_s, 15)
  assert.equal(sim.estado().alarmas.length, 1)
  sim.provocar({ tipo: "alarma_fin" })
  sim.avanzar(1)
  assert.equal(sim.estado().tiempo_ciclo_s, 16)
})

test("simulador: PLC que no arranca (una vez), sin selección, receta que no existe", async () => {
  const sim = new S.SimuladorIndumix({ recetas: [R13] })
  await assert.rejects(() => sim.arrancar(), (e) => e.codigo === "planta_rechazo")
  await assert.rejects(() => sim.escribirOrden(orden({ receta: 7 })), /La receta 7 no existe/)
  await sim.escribirOrden(orden())
  sim.provocar({ tipo: "no_arranca" })
  await assert.rejects(() => sim.arrancar(), /Compuerta de la balanza de áridos abierta/)
  assert.equal(sim.estado().en_ciclo, false)
  await sim.arrancar() // no se reintenta solo: lo vuelve a pedir la persona
  assert.equal(sim.estado().en_ciclo, true)
})

test("simulador: sin conexión no se lee nada, pero la PLC termina sola; al volver se ve el fin", async () => {
  const sim = new S.SimuladorIndumix({ recetas: [R13] })
  await sim.escribirOrden(orden())
  await sim.arrancar()
  const antes = await sim.leerEstado()
  sim.provocar({ tipo: "sin_conexion" })
  await assert.rejects(() => sim.leerEstado(), (e) => e.codigo === "sin_conexion")
  await assert.rejects(() => sim.parar(), (e) => e.codigo === "sin_conexion")
  sim.avanzar(S.DURACION_CICLO_S * 2 + 1)
  sim.provocar({ tipo: "con_conexion" })
  const despues = await sim.leerEstado()
  assert.deepEqual(S.detectarEventos(antes, despues).map((e) => e.tipo), ["fin"])
  assert.equal((await sim.leerReportes())[0].numero, antes.contador_carga)
})

test("simulador: el reloj de Indumix arranca en 1/1/1970 0:00 y corre", () => {
  const sim = new S.SimuladorIndumix({ recetas: [R13], prendidaHaceS: 4 * 3600 + 57 * 60 })
  assert.equal(sim.estado().reloj_plc, "4:57 - 1/1/1970")
  sim.avanzar(240)
  assert.equal(sim.estado().reloj_plc, "5:01 - 1/1/1970")
})

test("simulador: extra agua durante la carga y después de terminar (camión en planta)", async () => {
  const sim = new S.SimuladorIndumix({ recetas: [R13] })
  await assert.rejects(() => sim.extraAgua(20), /No hay un camión/)
  await sim.escribirOrden(orden())
  await sim.arrancar()
  sim.avanzar(30)
  await sim.extraAgua(20)
  for (let i = 0; i < 300 && sim.estado().en_ciclo; i++) sim.avanzar(1)
  await sim.extraAgua(30)
  const rep = (await sim.leerReportes())[0]
  assert.deepEqual(rep.extras.map((e) => [e.litros, e.despues_de_terminar]), [[20, false], [30, true]])
  assert.equal(rep.lineas.find((l) => l.salida === "agua").extra, 50)
})

test("eventos: arranque, ciclo, suspender, reanudar, alarma, fin y carga hecha desde Indumix", async () => {
  const sim = new S.SimuladorIndumix({ recetas: [R13], contador: 3 })
  const vistos = []
  let prev = sim.estado()
  const mirar = () => { const n = sim.estado(); vistos.push(...S.detectarEventos(prev, n).map((e) => e.tipo)); prev = n }
  await sim.escribirOrden(orden()); await sim.arrancar(); mirar()
  sim.avanzar(10); await sim.suspender(); mirar(); await sim.reanudar(); mirar()
  sim.provocar({ tipo: "alarma" }); mirar(); sim.provocar({ tipo: "alarma_fin" }); mirar()
  sim.avanzar(S.DURACION_CICLO_S); mirar()
  sim.avanzar(S.DURACION_CICLO_S); mirar()
  assert.deepEqual(vistos, ["arranque", "ciclo_inicio", "suspender", "reanudar", "alarma", "alarma_fin", "ciclo_inicio", "fin"])
  // Alguien carga desde Indumix: cambia el contador sin una orden nuestra
  sim.provocar({ tipo: "carga_indumix", receta: 13, camion: "LES 431" })
  const e = S.detectarEventos(prev, sim.estado())
  assert.deepEqual(e.map((x) => x.tipo), ["arranque", "ciclo_inicio"])
  assert.equal(e[0].contador, 5)
})

// ───────────────────────────── Puente ─────────────────────────────
test("puente: escribe la orden, la verifica, recompara la receta y arranca; si la receta cambió, no arranca", async () => {
  const { puente, simulador } = P.crearPuente("simulador", { recetas: [R13ok] })
  const pasos = []
  await puente.cargarYArrancar(orden(), R.huellaReceta(R13ok), (i) => pasos.push(i))
  assert.deepEqual(pasos, [1, 2, 3, 4])
  assert.equal(simulador.estado().en_ciclo, true)
  for (let i = 0; i < 300 && simulador.estado().en_ciclo; i++) simulador.avanzar(1)
  // Alguien cambió la receta 13 en el medio
  simulador.cambiarReceta(13, { cemento_1: 350 })
  await assert.rejects(() => puente.cargarYArrancar(orden(), R.huellaReceta(R13ok)), /La receta 13 cambió en Indumix/)
  assert.equal(simulador.estado().en_ciclo, false)
  assert.throws(() => P.crearPuente("indumix", { recetas: [] }), /todavía no existe/)
})

// ───────────────────────────── Reloj ─────────────────────────────
test("reloj de 1970: formato, lectura, reinicio diario y hora estimada de un reporte", () => {
  assert.equal(K.relojPlc(0), "0:00 - 1/1/1970")
  assert.equal(K.relojPlc(86400 + 3600), "1:00 - 2/1/1970")
  assert.equal(K.segundosPlc("4:57 - 1/1/1970"), 4 * 3600 + 57 * 60)
  assert.equal(K.segundosPlc("4:57:30 - 1/1/1970"), 4 * 3600 + 57 * 60 + 30)
  assert.equal(K.segundosPlc("12/10/2026"), null)
  assert.equal(K.seReinicio(5 * 3600, 30), true)
  assert.equal(K.seReinicio(5 * 3600, 5 * 3600 + 10), false)
  // A las 12:15 (puente) Indumix decía 5:17: un reporte que empezó 4:40 fue a las 11:38
  const ref = { plcSeg: K.segundosPlc("5:17 - 1/1/1970"), puenteMs: new Date(2026, 9, 20, 12, 15).getTime() }
  const h = new Date(K.horaEstimada("4:40 - 1/1/1970", ref))
  assert.equal(`${h.getHours()}:${h.getMinutes()}`, "11:38")
  assert.equal(K.horaEstimada("4:40 - 3/1/1970", ref), null, "otro día de Indumix: no se estima")
})

// ───────────────────────────── Emparejador y auditoría ─────────────────────────────
const MIN = 60_000
const t0 = new Date(2026, 9, 20, 11, 0).getTime()
test("emparejador: «0886» con el remito 886; «AG 083 GT» con AG083GT por hora", () => {
  const cand = [
    { id: "d885", remito: "885", patente: "AE402HE", at: t0 },
    { id: "d886", remito: "886", patente: "AG083GT", at: t0 + 10 * MIN },
    { id: "d887", remito: "R 887", patente: "AG083GT", at: t0 + 90 * MIN },
  ]
  assert.deepEqual(A.emparejar({ observacion: "0886", patente: "XX", fin: null }, cand), { id: "d886", union: "por remito (Observación)" })
  assert.deepEqual(A.emparejar({ observacion: "887", patente: null, fin: null }, cand), { id: "d887", union: "por remito (Observación)" })
  assert.deepEqual(A.emparejar({ observacion: "", patente: "AG 083 GT", fin: t0 + 20 * MIN }, cand), { id: "d886", union: "por camión y hora" })
  assert.deepEqual(A.emparejar({ observacion: "", patente: "AG 083 GT", fin: t0 + 95 * MIN }, cand), { id: "d887", union: "por camión y hora" })
  assert.equal(A.emparejar({ observacion: "", patente: "AG 083 GT", fin: t0 - 60 * MIN }, cand), null)
  assert.equal(A.emparejar({ observacion: "", patente: "LES 431", fin: t0 }, cand), null)
})

const mat = (o) => ({ salida: "cemento_1", material_id: "cpc", nombre: "CPC 40", grupo: "cemento", unidad: "kg", receta_por_m3: 330, formula_por_m3: 330, teorico: 990, humedad_pct: null, teorico_corregido: 990, real: 995, ...o })
const carga = (o = {}) => ({
  id: "c1", origen: "sistema", simulada: false, estado: "terminada", contador: 1, inicio_at: new Date(t0).toISOString(), fin_at: new Date(t0 + 4 * MIN).toISOString(),
  m3: 3, m3_cargados: 3, ciclos: 2, receta_numero: 1, receta_ok: true, agua_distinta: false, autorizada: false, parada: null, completa_carga_id: null,
  materiales: [mat()], plantista: "Titan", patente_planta: "AG 083 GT", observacion_planta: "886", revisada: false, ...o,
})
const desp = (o = {}) => ({ id: "d1", remito: "886", remito_tipo: "R", patente: "AG083GT", despachado_at: new Date(t0 - 5 * MIN).toISOString(), salio_at: new Date(t0 - 5 * MIN).toISOString(), cliente: "TOP", obra: "Santa Clara", formula: "H30-612-15 B (CAN)", m3: 3, ...o })
const fila = (o = {}) => ({ despacho: desp(), cargas: [carga()], extras: [], salida_gps: null, union: "por id", ...o })

test("auditoría: una carga de cada categoría", () => {
  const ahora = t0 + 3 * 60 * MIN
  assert.deepEqual(A.banderas(fila(), ahora), [])
  assert.deepEqual(A.banderas(fila({ despacho: null, union: null, cargas: [carga({ origen: "indumix" })] }), ahora), ["sinRemito", "indumix"])
  assert.deepEqual(A.banderas(fila({ despacho: null, cargas: [carga({ fin_at: new Date(ahora - 10 * MIN).toISOString(), origen: "indumix" })] }), ahora), ["indumix"], "todavía no pasaron 30 min")
  assert.deepEqual(A.banderas(fila({ cargas: [] }), ahora), ["sinCarga"])
  assert.deepEqual(A.banderas(fila({ cargas: [carga({ m3_cargados: 2.5 })] }), ahora), ["difVol"])
  assert.deepEqual(A.banderas(fila({ cargas: [carga({ materiales: [mat({ real: 1005 })] })] }), ahora), ["desv"], "cemento +1,5 %")
  assert.deepEqual(A.banderas(fila({ cargas: [carga({ materiales: [mat({ grupo: "arido", real: 1005 })] })] }), ahora), [], "un árido +1,5 % está adentro (±2 %)")
  assert.deepEqual(A.banderas(fila({ cargas: [carga({ receta_ok: false, agua_distinta: true })] }), ahora), ["receta", "aguaDist"])
  assert.deepEqual(A.banderas(fila({ cargas: [carga({ autorizada: true })] }), ahora), ["receta"])
  assert.deepEqual(A.banderas(fila({ extras: [{ litros: 20, at: new Date(t0).toISOString(), despues_de_terminar: true, usuario: "Titan" }] }), ahora), ["aguaExtra"])
  assert.deepEqual(A.banderas(fila({ cargas: [carga({ simulada: true })] }), ahora), ["simulada"])
  // Parada que se completa con otra carga del mismo remito: los m³ se suman
  const c1 = carga({ id: "c1", estado: "parada", parada: "completar", m3_cargados: 1.8, materiales: [] })
  const c2 = carga({ id: "c2", completa_carga_id: "c1", m3: 1.2, m3_cargados: 1.2, materiales: [] })
  assert.deepEqual(A.banderas(fila({ cargas: [c1, c2] }), ahora), ["parada"])
  assert.deepEqual(A.banderas(fila({ cargas: [c1] }), ahora), ["parada"], "falta la segunda: no es dif. de volumen todavía")
})

test("auditoría: tiempos de carga y espera hasta salir (GPS); resumen del agua extra", () => {
  const f = fila({ salida_gps: new Date(t0 + 11 * MIN).toISOString() })
  // despacho 10:55 (fijo) → inicio 11:00 → fin 11:04 → salida GPS 11:11
  assert.deepEqual(A.tiempos(f), { colaMin: 5, cargaMin: 4, esperaSalidaMin: 7 })
  assert.deepEqual(A.tiempos(fila()), { colaMin: 5, cargaMin: 4, esperaSalidaMin: null })
  assert.deepEqual(A.tiempos(fila({ despacho: null })), { colaMin: null, cargaMin: 4, esperaSalidaMin: null })
  const ex = (l, d) => ({ litros: l, at: new Date(t0).toISOString(), despues_de_terminar: d, usuario: "Titan" })
  const r = A.resumenAguaExtra([fila({ extras: [ex(20, false), ex(30, true)] }), fila({ despacho: desp({ patente: "AE402HE" }), extras: [ex(10, false)] }), fila()])
  assert.equal(r.total, 60); assert.equal(r.camiones, 2); assert.equal(r.despues, 30)
  assert.deepEqual(r.porCamion, [["AG083GT", 50], ["AE402HE", 10]])
  assert.deepEqual(r.porPlantista, [["Titan", 60]])
})

// ───────────────────────────── Cierre: stock y despacho ─────────────────────────────
test("ajuste de stock = real − teórico del despacho (áridos en seco, aditivo g → kg, el agua no)", () => {
  const reales = [
    { salida: "arido_3", material_id: "af", real: 2144.5, humedad_pct: 3, factor: 1 },
    { salida: "cemento_1", material_id: "cpc", real: 1055, factor: 1 },
    { salida: "aditivo_1", material_id: "s90", real: 8360, factor: 0.001 },
    { salida: "agua", material_id: "agua", real: 268, factor: 1 },
  ]
  const aj = C.ajustesStock(reales, { af: 2082, cpc: 990, s90: 8.415, fib: 1.5 })
  const por = Object.fromEntries(aj.map((a) => [a.material_id, a.ajuste]))
  assert.equal(por.af, Math.round((2144.5 / 1.03 - 2082) * 1000) / 1000)
  assert.equal(por.cpc, 65)
  assert.equal(por.s90, -0.055)
  assert.equal(por.agua, undefined)
  assert.equal(por.fib, undefined, "la fibra sale de la Entrega, no se toca")
  const tirada = C.ajustesStock(reales, { cpc: 990 }, { anulado: true })
  assert.equal(tirada.find((a) => a.material_id === "cpc").ajuste, 1055, "se tiró: todo lo pesado es pérdida")
})

test("modo simulado: nunca se ajusta el stock ni se toca el despacho real", () => {
  assert.equal(C.ajusteStockHabilitado({ simulada: true, sistema: "indumix", usa_kilos_reales: true }), false)
  assert.equal(C.ajusteStockHabilitado({ simulada: false, sistema: "simulador", usa_kilos_reales: true }), false)
  assert.equal(C.ajusteStockHabilitado({ simulada: false, sistema: "indumix", usa_kilos_reales: false }), false)
  assert.equal(C.ajusteStockHabilitado({ simulada: false, sistema: "indumix", usa_kilos_reales: true }), true)
  const sale = C.efectoSobreDespacho("sale", { m3_despacho: 3, m3_cargados: 1.84, remito: "R 886", simulada: true })
  assert.equal(sale.accion, "editar_m3"); assert.equal(sale.m3_despacho, 1.8); assert.equal(sale.aplicar, false)
  assert.match(sale.texto, /planta simulada/)
  assert.equal(C.efectoSobreDespacho("tirada", { m3_despacho: 3, m3_cargados: 1, remito: "R 886", simulada: true }).aplicar, false)
  assert.equal(C.efectoSobreDespacho("sale", { m3_despacho: 3, m3_cargados: 2, remito: null, simulada: false }).aplicar, true)
  const comp = C.efectoSobreDespacho("completar", { m3_despacho: 3, m3_cargados: 1.84, remito: "R 886", simulada: true })
  assert.equal(comp.accion, "nueva_carga"); assert.equal(comp.m3_falta, 1.2)
})

test("textos: dígitos del remito y patentes", () => {
  assert.equal(T.digitos("0886"), "886"); assert.equal(T.digitos("R 0886"), "886"); assert.equal(T.digitos("0"), "0")
  assert.equal(T.normalizarPatente("ag 083-gt"), "AG083GT")
  assert.equal(T.patenteParaPlanta("AG083GT"), "AG 083 GT"); assert.equal(T.patenteParaPlanta("CRN449"), "CRN 449")
})

// ───────────────────────────── Indicador en la tarjeta del camión ─────────────────────────────
import * as I from "../carga/indicador.ts"
test("indicador del camión en Despacho: cola (posición y frenada), cargando, parada, cargado esperando salir", () => {
  const base = { puesto_id: "p", ciclo_actual: null, ciclos: 2, fin_at: null, simulada: true, bloqueo: null, completa_carga_id: null }
  const at = (m) => new Date(t0 + m * MIN).toISOString()
  const cs = [
    { ...base, id: "a", mixer_id: "m1", estado: "pendiente", created_at: at(0) },
    { ...base, id: "b", mixer_id: "m2", estado: "bloqueada", created_at: at(1), bloqueo: { frena: true } },
    { ...base, id: "c", mixer_id: "m3", estado: "en_curso", ciclo_actual: 1, created_at: at(2) },
    { ...base, id: "d", mixer_id: "m4", estado: "parada", created_at: at(3) },
    { ...base, id: "e", mixer_id: "m5", estado: "terminada", fin_at: at(10), created_at: at(4) },
    { ...base, id: "f", mixer_id: "m6", estado: "terminada", fin_at: at(10), created_at: at(5), salida_gps: at(14) },
    { ...base, id: "g", mixer_id: "m7", estado: "terminada", fin_at: at(1), created_at: at(0) },
    { ...base, id: "h", mixer_id: "m7", estado: "cancelada", created_at: at(6) },
    { ...base, id: "i", mixer_id: "m8", estado: "parada", resolucion_modo: "sale", fin_at: at(12), created_at: at(7) },
    { ...base, id: "j", mixer_id: "m9", estado: "parada", resolucion_modo: "tirada", fin_at: at(12), created_at: at(7) },
  ]
  const r = I.indicadoresPorCamion(cs, t0 + 20 * MIN)
  assert.equal(r.m1.texto, "En cola de carga · 1°"); assert.equal(r.m1.tono, "violet")
  assert.equal(r.m2.texto, "En cola de carga · 2° · frenada"); assert.equal(r.m2.tono, "bad")
  assert.equal(r.m3.texto, "Cargando · ciclo 1/2")
  assert.equal(r.m4.texto, "Carga parada")
  assert.match(r.m5.texto, /^Cargado \d\d:\d\d · esperando salir$/)
  assert.equal(r.m6, undefined, "ya salió (GPS): lo muestra el estado del camión")
  assert.equal(r.m7, undefined, "la más reciente (cancelada) manda")
  assert.match(r.m8.texto, /esperando salir/, "parada que sale con lo cargado")
  assert.equal(r.m9, undefined, "se tiró: el despacho se anula")
  assert.equal(I.indicadoresPorCamion(cs, t0 + 120 * MIN).m5, undefined, "sin GPS, a los 45 min deja de mostrarse")
})

// ───────────────────────────── Revisión: PARAR mientras arranca, emparejador por tipo ─────────────────────────────
test("puente: PARAR mientras arranca corta antes de CARGAR y no arranca nada", async () => {
  for (const cortarEn of [0, 1, 2, 3]) {
    const { puente, simulador } = P.crearPuente("simulador", { recetas: [R13ok] })
    let pasos = 0
    const cancelado = () => pasos >= cortarEn
    await assert.rejects(
      () => puente.cargarYArrancar(orden(), R.huellaReceta(R13ok), () => { pasos++ }, cancelado),
      (e) => e instanceof P.ArranqueCanceladoError && e.message === "PARAR",
    )
    assert.equal(simulador.estado().en_ciclo, false, `cortado después del paso ${cortarEn}`)
    assert.equal(simulador.contador, 0, "el contador de Indumix no se movió")
  }
  // Sin cancelar, arranca
  const { puente, simulador } = P.crearPuente("simulador", { recetas: [R13ok] })
  await puente.cargarYArrancar(orden(), R.huellaReceta(R13ok), undefined, () => false)
  assert.equal(simulador.estado().en_ciclo, true)
})

test("emparejador: con los mismos dígitos prefiere el remito del mismo tipo (R/X) y después el mismo camión", () => {
  const c = [
    { id: "r886", remito: "886", tipo: "R", patente: "AE402HE", at: t0 },
    { id: "x886", remito: "886", tipo: "X", patente: "AG083GT", at: t0 + 5 * MIN },
  ]
  assert.equal(A.tipoDeObservacion("X 0886"), "X"); assert.equal(A.tipoDeObservacion("R886"), "R"); assert.equal(A.tipoDeObservacion("0886"), null)
  assert.equal(A.emparejar({ observacion: "R 886", patente: "AG 083 GT", fin: t0 }, c).id, "r886", "el tipo manda sobre el camión")
  assert.equal(A.emparejar({ observacion: "X0886", patente: null, fin: t0 }, c).id, "x886")
  assert.equal(A.emparejar({ observacion: "0886", patente: "AG 083 GT", fin: t0 }, c).id, "x886", "sin tipo, el mismo camión")
  assert.equal(A.emparejar({ observacion: "0886", patente: null, fin: t0 + 6 * MIN }, c).id, "x886", "si no, el más cercano en la hora")
})

// ───────────────────────────── Muestra al final de la carga ─────────────────────────────
import * as M from "../muestra.ts"
test("muestra al terminar la carga: las 3 probetas del Historial (7, 28, 28 días desde el despacho) y el asentamiento", () => {
  const p = M.probetasParaMuestra("d1", "2026-10-20T12:41:00-03:00")
  assert.deepEqual(p.map((x) => [x.cylinder_number, x.test_age_days, x.scheduled_test_date]), [[1, 7, "2026-10-27"], [2, 28, "2026-11-17"], [3, 28, "2026-11-17"]])
  assert.ok(p.every((x) => x.dispatch_id === "d1"))
  assert.equal(M.asentamientoValido("12,5"), 12.5); assert.equal(M.asentamientoValido("x"), null); assert.equal(M.asentamientoValido(""), null); assert.equal(M.asentamientoValido(40), null)
})

test("agregarMuestraDespacho: marca el despacho, crea las probetas si no tenía y deja Actividad (como el Historial)", async () => {
  const hechos = []
  const sb = (yaTiene) => ({
    from: (t) => ({
      update: (v) => ({ eq: async (c, id) => { hechos.push(["update", t, v, id]); return { error: null } } }),
      select: () => ({
        eq: (c, id) => ({ limit: async () => ({ data: yaTiene ? [{ id: "p" }] : [] }), single: async () => ({ data: { dispatch_date: "2026-10-20T12:41:00-03:00" } }) }),
      }),
      insert: async (rows) => { hechos.push(["insert", t, rows.length]); return { error: null } },
    }),
  })
  const logs = []
  const r = await M.agregarMuestraDespacho(sb(false), (x) => logs.push(x), { dispatchId: "d1", numero: " M-0413 ", asentamiento: 12.5, remito: "886", plantId: "can", origen: "Carga de planta (al terminar la carga)" })
  assert.deepEqual(r, { ok: true, probetas: "creadas" })
  assert.deepEqual(hechos[0], ["update", "dispatches", { sample_taken: true, sample_number: "M-0413", actual_slump_cm: 12.5 }, "d1"])
  assert.deepEqual(hechos[1], ["insert", "test_cylinders", 3])
  assert.equal(logs[0].details.Origen, "Carga de planta (al terminar la carga)")
  hechos.length = 0
  const r2 = await M.agregarMuestraDespacho(sb(true), () => {}, { dispatchId: "d1", numero: "M-1", asentamiento: 10, remito: null, plantId: null, origen: "x" })
  assert.deepEqual(r2, { ok: true, probetas: "ya_tenia" })
  assert.equal(hechos.filter((h) => h[0] === "insert").length, 0, "ya tenía probetas: no se crean de nuevo")
})
