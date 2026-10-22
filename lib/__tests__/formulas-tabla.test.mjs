// Pruebas de la tabla de Fórmulas (docs/migracion-loop/formulas-rediseno.md): lectura del código, orden de los
// materiales, matriz, filtros, orden, copia a la otra planta y diferencias con la receta de Indumix. Sin base.
import { test } from "node:test"
import assert from "node:assert/strict"
import * as F from "../formulas-tabla.ts"
import * as T from "../carga/tipos.ts"

// Materiales de Canning tal como vienen de la base (ordenados por nombre)
const MAT = [
  { id: "agua", name: "Agua", unit: "kg", tipo: "agua" },
  { id: "af", name: "Arena Fina", unit: "kg", tipo: "arido_fino" },
  { id: "a06", name: "Arena Trituración 0/6", unit: "kg", tipo: "arido_fino" },
  { id: "cpc", name: "CPC 40", unit: "kg", tipo: "cemento" },
  { id: "esp", name: "Espumígeno", unit: "kg", tipo: "aditivo_planta" },
  { id: "fib", name: "Fibra", unit: "kg", tipo: "fibra" },
  { id: "p1030", name: "Piedra Partida 10/30", unit: "kg", tipo: "arido_grueso" },
  { id: "p612", name: "Piedra Partida 6/12", unit: "kg", tipo: "arido_grueso" },
  { id: "p620", name: "Piedra Partida 6/20", unit: "kg", tipo: "arido_grueso" },
  { id: "s33", name: "Sikament 33S", unit: "kg", tipo: "aditivo_obra" },
  { id: "s90", name: "Sikament 90E", unit: "kg", tipo: "aditivo_planta" },
  { id: "sup", name: "Superfluidificante (obra)", unit: "lts", tipo: "aditivo_obra" },
]
const m = (id) => MAT.find((x) => x.id === id)
const fm = (id, q) => ({ quantity: q, materials: m(id) })
const FORMULAS = [
  { id: "f1", code: "H30-612-15 B (CAN)", name: "H30-612-15 B (CAN)", updated_at: "2026-10-20T10:00:00Z", formula_materials: [fm("cpc", 330), fm("af", 694), fm("a06", 231), fm("p612", 950), fm("agua", 168), fm("s90", 2.805), fm("s33", 0.99)] },
  { id: "f2", code: "H21-620-10 C (CAN)", name: "H21-620-10 C (CAN)", updated_at: null, formula_materials: [fm("cpc", 280), fm("af", 700), fm("p620", 980), fm("agua", 170), fm("s90", 2.2)] },
  { id: "f3", code: "RDC-300 (CAN)", name: "RDC-300 (CAN)", updated_at: "2026-09-01T10:00:00Z", formula_materials: [fm("cpc", 300), fm("af", 1320), fm("agua", 170), fm("esp", 0.6)] },
  { id: "f4", code: "H8-620-15 (CAN)", name: "H8-620-15 (CAN)", updated_at: null, formula_materials: [fm("cpc", 180), fm("p620", 1000), fm("agua", 0)] },
  { id: "f5", code: "H25-620-15 B PELQUE (CAN)", name: "H25-620-15 B PELQUE (CAN)", formula_materials: [fm("cpc", 320), fm("p620", 960), fm("p620", 10)] },
]

test("leer el código: resistencia, B/C y asentamiento (con la etiqueta de planta y textos de más)", () => {
  assert.deepEqual(F.leerCodigo("H30-612-15 B (CAN)"), { resistencia: "H30", metodo: "B", asentamiento: 15 })
  assert.deepEqual(F.leerCodigo("H21-620-10 C"), { resistencia: "H21", metodo: "C", asentamiento: 10 })
  assert.deepEqual(F.leerCodigo("H35-6/12-10 C (CAN)"), { resistencia: "H35", metodo: "C", asentamiento: 10 })
  assert.equal(F.leerCodigo("H25-620-15 B PELQUE (CAN)").metodo, "B")
  assert.equal(F.leerCodigo("H30-Cordones C (CAN)").metodo, "C")
  assert.deepEqual(F.leerCodigo("H25-6/20"), { resistencia: "H25", metodo: null, asentamiento: null })
  assert.deepEqual(F.leerCodigo("RDC-300 (CAN)"), { resistencia: null, metodo: null, asentamiento: null })
  assert.equal(F.leerCodigo("H30-GUN").metodo, null, "la C/B tiene que ser una palabra suelta")
})

test("materiales en el orden de la planilla de Grow; lo desconocido al final por tipo", () => {
  assert.deepEqual(F.ordenarMateriales(MAT).map((x) => x.id), ["cpc", "af", "a06", "p620", "p612", "p1030", "agua", "s90", "s33", "esp", "sup", "fib"])
  assert.equal(F.nombreCorto("Piedra Partida 6/20"), "P. 6/20")
  assert.equal(F.nombreCorto("Arena Trituración 0/6"), "A. Trit.")
  assert.equal(F.nombreCorto("Sikament 90E"), "Sika 90E")
  assert.equal(F.nombreCorto("CPC 40"), "CPC 40")
})

test("matriz: una columna por material que alguna fórmula usa, en orden; cantidades sumadas; cero = no lo usa", () => {
  const mz = F.armarMatriz(FORMULAS, MAT, { f1: 12, f3: 1 })
  assert.deepEqual(mz.columnas.map((c) => c.id), ["cpc", "af", "a06", "p620", "p612", "agua", "s90", "s33", "esp"], "sin 10/30, fibra ni superfluidificante")
  const f1 = mz.filas.find((r) => r.id === "f1")
  assert.equal(f1.valores.cpc, 330)
  assert.equal(f1.valores.p620, undefined)
  assert.equal(f1.usos, 12)
  assert.deepEqual(f1.piedras, ["6/12"])
  assert.equal(mz.filas.find((r) => r.id === "f4").valores.agua, undefined, "agua 0 no cuenta")
  assert.equal(mz.filas.find((r) => r.id === "f5").valores.p620, 970, "el mismo material dos veces se suma")
  assert.equal(mz.filas.find((r) => r.id === "f2").usos, 0)
  assert.equal(F.celda(undefined), "—")
  assert.equal(F.celda(2.805), "2,805")
  assert.equal(F.celda(0.6), "0,6")
  assert.equal(F.celda(1320), "1.320")
})

test("filtros: texto, resistencia (y Otras), piedra, B/C y solo usadas", () => {
  const { filas } = F.armarMatriz(FORMULAS, MAT, { f1: 12, f3: 1 })
  const ids = (f) => F.filtrar(filas, f).map((r) => r.id).sort()
  assert.deepEqual(ids({}), ["f1", "f2", "f3", "f4", "f5"])
  assert.deepEqual(ids({ texto: "rdc" }), ["f3"])
  assert.deepEqual(ids({ texto: "pelque" }), ["f5"])
  assert.deepEqual(ids({ resistencia: "H30" }), ["f1"])
  assert.deepEqual(ids({ resistencia: "Otras" }), ["f3"])
  assert.deepEqual(ids({ piedra: "6/20" }), ["f2", "f4", "f5"])
  assert.deepEqual(ids({ metodo: "B" }), ["f1", "f5"])
  assert.deepEqual(ids({ metodo: "C" }), ["f2"])
  assert.deepEqual(ids({ soloUsadas: true }), ["f1", "f3"])
  assert.deepEqual(ids({ piedra: "6/20", metodo: "B" }), ["f5"])
})

test("orden: por código (resistencia numérica), por material (sin valor al final), por usos y por fecha", () => {
  const { filas } = F.armarMatriz(FORMULAS, MAT, { f1: 12, f3: 1 })
  const o = (col, asc) => F.ordenar(filas, { col, asc }).map((r) => r.id)
  assert.deepEqual(o("code", true), ["f4", "f2", "f5", "f1", "f3"], "H8 antes que H21; RDC al final")
  assert.deepEqual(o("code", false), ["f3", "f1", "f5", "f2", "f4"])
  assert.deepEqual(o("cpc", false), ["f1", "f5", "f3", "f2", "f4"])
  assert.deepEqual(o("a06", true).slice(0, 1), ["f1"], "la única que usa 0/6 primero")
  assert.deepEqual(o("esp", false), ["f3", "f4", "f2", "f5", "f1"], "las que no lo usan al final, por código")
  assert.deepEqual(o("usos", false).slice(0, 2), ["f1", "f3"])
  assert.deepEqual(o("editado", false).slice(0, 2), ["f1", "f3"])
  assert.deepEqual(o("editado", true).slice(0, 2), ["f3", "f1"], "sin fecha siempre al final")
})

test("usos: despachos por fórmula", () => {
  assert.deepEqual(F.contarUsos([{ formula_id: "a" }, { formula_id: "a" }, { formula_id: "b" }, { formula_id: null }]), { a: 2, b: 1 })
})

test("copiar a la otra planta: sufijo (CAN), si ya existe, materiales por nombre", () => {
  assert.equal(F.codigoEnPlanta("H25-620-10 C", "Canning"), "H25-620-10 C (CAN)")
  assert.equal(F.codigoEnPlanta("H25-620-10 C (CAN)", "Hudson"), "H25-620-10 C (HUD)")
  assert.equal(F.codigoEnPlanta("H25-620-10 C (CAN)", "Canning"), "H25-620-10 C (CAN)", "no duplica el sufijo")
  assert.equal(F.codigoEnPlanta("H25-620-15 B (HUD) PELQUE", "Canning"), "H25-620-15 B (CAN) PELQUE")
  assert.equal(F.codigoEnPlanta("RDC-300 (CAN)", "Hudson"), "RDC-300 (HUD)", "nombre libre: solo cambia la etiqueta")
  const canning = [{ id: "x", code: "H25-620-10 C (CAN)" }, { id: "y", code: "H40-6/12-15" }]
  assert.equal(F.existeEnPlanta("H25-620-10 C", canning)?.id, "x")
  assert.equal(F.existeEnPlanta("h25-620-10  c", canning)?.id, "x", "sin importar mayúsculas ni espacios")
  assert.equal(F.existeEnPlanta("H40-6/12-15", canning)?.id, "y", "las de Canning sin sufijo también cuentan")
  assert.equal(F.existeEnPlanta("H30-620-10 C", canning), null)
  assert.equal(F.existeEnPlanta("H25-6/20-10 C (HUD)", canning)?.id, "x", "6/20 = 620")
  const destino = [{ id: "h-cpc", name: "CPC 40" }, { id: "h-esp", name: "Espumigeno" }]
  assert.deepEqual(
    F.materialesEnPlanta([{ material_name: "CPC 40", quantity: 300 }, { material_name: "Espumígeno", quantity: 0.6 }, { material_name: "Agua", quantity: 0 }], destino),
    { filas: [{ material_id: "h-cpc", quantity: 300 }, { material_id: "h-esp", quantity: 0.6 }], faltan: [] },
  )
  assert.deepEqual(F.materialesEnPlanta([{ material_name: "Fibra", quantity: 1 }], destino).faltan, ["Fibra"])
})

// ── Receta de la planta: misma comparación que la carga (lib/carga/receta.ts) ──
const SAL = [
  { salida: "arido_1", nombre_planta: "PIE 6/20 O 6/12", material_id: "p612", unidad_planta: "kg", factor: 1, alternativas: ["p612", "p620"] },
  { salida: "arido_2", nombre_planta: "piedra 06", material_id: "a06", unidad_planta: "kg", factor: 1 },
  { salida: "arido_3", nombre_planta: "ARENA", material_id: "af", unidad_planta: "kg", factor: 1 },
  { salida: "arido_4", nombre_planta: "PIE 6/20", material_id: "p620", unidad_planta: "kg", factor: 1 },
  { salida: "cemento_1", nombre_planta: "CP 40", material_id: "cpc", unidad_planta: "kg", factor: 1 },
  { salida: "cemento_2", nombre_planta: "CP 40", material_id: "cpc", unidad_planta: "kg", factor: 1 },
  { salida: "aditivo_1", nombre_planta: "PLASTIF", material_id: "s90", unidad_planta: "g", factor: 0.001 },
  { salida: "aditivo_2", nombre_planta: "(vacío)", material_id: null, unidad_planta: "g", factor: 0.001 },
  { salida: "agua", nombre_planta: "Agua", material_id: "agua", unidad_planta: "L", factor: 1 },
]
const F612 = { id: "f1", code: "H30-612-15 B (CAN)", materiales: [
  { material_id: "agua", cantidad: 168 }, { material_id: "af", cantidad: 694 }, { material_id: "a06", cantidad: 231 },
  { material_id: "cpc", cantidad: 330 }, { material_id: "p612", cantidad: 950 }, { material_id: "s33", cantidad: 0.99 }, { material_id: "s90", cantidad: 2.805 },
] }
const receta = (numero, v, nombre = "R") => ({
  numero, nombre, habilitada: true,
  salidas: T.SALIDAS.map((s) => ({ salida: s, nombre_planta: s, valor: v[s] || 0, unidad: T.INFO_SALIDA[s].unidad })),
})

test("receta de la planta: sin número no se muestra nada; vacía lo dice", () => {
  assert.equal(F.recetaContraFormula(null, null, F612, SAL, MAT), null)
  const v = F.recetaContraFormula(19, null, F612, SAL, MAT)
  assert.equal(v.vacia, true)
  assert.equal(v.resumen, null)
})

test("receta 13 de la foto: CPC 350 y agua 110 en ámbar, con el resumen", () => {
  const r13 = receta(13, { arido_1: 950, arido_2: 231, arido_3: 694, cemento_1: 350, aditivo_1: 2800, agua: 110 }, "H30-612-15 B")
  const v = F.recetaContraFormula(13, r13, F612, SAL, MAT)
  assert.equal(v.iguales, false)
  assert.deepEqual(v.lineas.filter((l) => l.distinta).map((l) => l.material_id).sort(), ["agua", "cpc"])
  assert.equal(v.resumen, "Planta (receta 13): CPC 40 350 kg · Agua 110 L")
  assert.ok(!v.lineas.some((l) => l.material_id === "s33"), "el aditivo de obra no pasa por Indumix")
  assert.equal(v.lineas.find((l) => l.material_id === "s90").texto, "2.800 g")
})

test("receta igual a la fórmula: sin resumen; una salida que pesa sin material se avisa", () => {
  const ok = receta(13, { arido_1: 950, arido_2: 231, arido_3: 694, cemento_1: 330, aditivo_1: 2805, agua: 168 })
  const v = F.recetaContraFormula(13, ok, F612, SAL, MAT)
  assert.equal(v.iguales, true)
  assert.equal(v.resumen, null)
  const suelta = receta(13, { arido_1: 950, arido_2: 231, arido_3: 694, cemento_1: 330, aditivo_1: 2805, aditivo_2: 500, agua: 168 })
  const w = F.recetaContraFormula(13, suelta, F612, SAL, MAT)
  assert.deepEqual(w.sueltas, ["Aditivo 2"])
  assert.equal(w.resumen, "Planta (receta 13): pesa en Aditivo 2 sin material")
})
