// Pruebas del nombre automático de las fórmulas (H30-620-15 B (CAN) PELQUE) y de "Normalizar nombres". Sin base.
import { test } from "node:test"
import assert from "node:assert/strict"
import * as N from "../formulas-nombre.ts"

const P = (o) => ({ ...N.PARTES_VACIAS, ...o })

test("armar el nombre: partes en orden, planta sola, comentario en mayúsculas", () => {
  assert.equal(N.armarNombre(P({ resistencia: "H30", piedra: "620", asentamiento: 15, metodo: "B", comentario: "pelque" }), "Canning"), "H30-620-15 B (CAN) PELQUE")
  assert.equal(N.armarNombre(P({ resistencia: "h21", piedra: "612", asentamiento: 10, metodo: "C" }), "Hudson"), "H21-612-10 C (HUD)")
  assert.equal(N.armarNombre(P({ resistencia: "H25", piedra: "1030", asentamiento: 10 }), "Canning"), "H25-1030-10 (CAN)")
  assert.equal(N.armarNombre(P({ resistencia: "H17", piedra: "620", metodo: "B" }), "Canning"), "H17-620 B (CAN)", "sin asentamiento")
  assert.equal(N.armarNombre(P({ resistencia: "H8", asentamiento: 15 }), "Hudson"), "H8-15 (HUD)", "sin piedra")
  assert.equal(N.armarNombre(P({ resistencia: "" }), "Hudson"), "", "sin resistencia no hay nombre")
  assert.equal(N.armarNombre(P({ resistencia: "H30", comentario: "  gún  ñandú! " }), "Canning"), "H30 (CAN) GUN ÑANDU")
})

test("sufijo de planta", () => {
  assert.equal(N.sufijoDePlanta("Canning"), "(CAN)")
  assert.equal(N.sufijoDePlanta("Hudson"), "(HUD)")
  assert.equal(N.sufijoDePlanta("Villa Rosa"), "(VIL)")
  assert.equal(N.sufijoDePlanta(""), "")
})

test("validar las partes: resistencia, piedra, asentamiento y C/B obligatorios (así se vuelve a leer igual)", () => {
  const ok = P({ resistencia: "H30", piedra: "620", asentamiento: 15, metodo: "B" })
  assert.equal(N.validarPartes(ok), null)
  assert.match(N.validarPartes(P({})), /resistencia/)
  assert.match(N.validarPartes({ ...ok, piedra: null }), /piedra/)
  assert.match(N.validarPartes({ ...ok, asentamiento: null }), /asentamiento/)
  assert.match(N.validarPartes({ ...ok, asentamiento: 45 }), /asentamiento/)
  assert.match(N.validarPartes({ ...ok, asentamiento: 10.5 }), /asentamiento/)
  assert.match(N.validarPartes({ ...ok, metodo: null }), /C \(común\) o B/)
  // todo lo que pasa la validación se vuelve a leer igual
  for (const piedra of N.PIEDRAS) for (const metodo of ["B", "C"]) for (const comentario of ["", "PELQUE", "OBRA 12"]) {
    const p = { ...ok, piedra, metodo, comentario }
    assert.equal(N.validarPartes(p), null)
    assert.deepEqual(N.interpretarNombre(N.armarNombre(p, "Canning")), p)
  }
})

test("nombre libre: hasta 50 letras", () => {
  assert.equal(N.validarLibre("RDC-300 (CAN)"), null)
  assert.match(N.validarLibre(" x "), /Escribí/)
  assert.match(N.validarLibre("A".repeat(51)), /hasta 50 letras \(tiene 51\)/)
  assert.equal(N.validarLibre("A".repeat(50)), null)
})

test("dudas: sin asentamiento o C/B, NO USAR, B/C suelta después de la planta, comentario que pierde algo", () => {
  assert.deepEqual(N.dudasDelNombre("H30-620-15 B (CAN) PELQUE"), [])
  assert.deepEqual(N.dudasDelNombre("H25-620-15 B PELQUE (CAN)"), [])
  assert.deepEqual(N.dudasDelNombre("H30-620-10 C - Pirelli"), [], "el guion de la etiqueta vieja no cuenta")
  assert.deepEqual(N.dudasDelNombre("H17-6/20 B"), ["falta el asentamiento"])
  assert.deepEqual(N.dudasDelNombre("H40-6/12-15"), ["falta C o B"])
  assert.ok(N.dudasDelNombre("H25-6/20 (CAN) — NO USAR").includes("dice NO USAR"))
  assert.ok(N.dudasDelNombre("H25-620-15 (CAN) B").includes("tiene una B o C suelta después de la planta"))
  assert.match(N.dudasDelNombre("H30-620-10 C OBRA #12").join(), /quedaría «OBRA 12»/)
  assert.match(N.dudasDelNombre("H30-620-10 C COMENTARIO MUY MUY LARGO").join(), /quedaría «COMENTARIO MUY MUY L»/)
  assert.deepEqual(N.dudasDelNombre("H30-620-10 C Gúnitado"), [], "las tildes no cuentan como pérdida")
  assert.deepEqual(N.dudasDelNombre("RDC-300"), [], "las libres van a revisar por otro lado")
})

test("choques de los nombres puestos a mano, sin distinguir mayúsculas", () => {
  const filas = [
    { id: "1", plant_id: "can", actual: "RDC-300 (CAN)" },
    { id: "2", plant_id: "can", actual: "RDC-200 (CAN)" },
    { id: "3", plant_id: "hud", actual: "RDC-300 (HUD)" },
  ]
  assert.equal(N.chocaCon("rdc-300  (can)", { id: "2", plant_id: "can" }, filas), "RDC-300 (CAN)")
  assert.equal(N.chocaCon("RDC-300 (HUD)", { id: "2", plant_id: "can" }, filas), null, "otra planta no choca")
  assert.equal(N.chocaCon("RDC-200 (CAN)", { id: "2", plant_id: "can" }, filas), null, "consigo misma no choca")
  assert.equal(N.chocaCon("RDC-300 (CAN)", { id: "2", plant_id: "can" }, filas, { "1": "RDC MORTERO 300 (CAN)" }), null, "la 1 ya se renombró")
  assert.match(N.chocaCon("Mortero (CAN)", { id: "2", plant_id: "can" }, filas, {}, { "1": "MORTERO (CAN)" }), /escrito para RDC-300/)
})

test("interpretar códigos viejos y nuevos", () => {
  assert.deepEqual(N.interpretarNombre("H30-620-15 B (CAN) PELQUE"), P({ resistencia: "H30", piedra: "620", asentamiento: 15, metodo: "B", comentario: "PELQUE" }))
  assert.deepEqual(N.interpretarNombre("H25-620-15 B PELQUE (CAN)"), P({ resistencia: "H25", piedra: "620", asentamiento: 15, metodo: "B", comentario: "PELQUE" }))
  assert.deepEqual(N.interpretarNombre("H35-6/12-10 C (CAN)"), P({ resistencia: "H35", piedra: "612", asentamiento: 10, metodo: "C" }))
  assert.deepEqual(N.interpretarNombre("H17-6/20 B"), P({ resistencia: "H17", piedra: "620", metodo: "B" }))
  assert.deepEqual(N.interpretarNombre("H30-620-10 Pavimento (CAN)"), P({ resistencia: "H30", piedra: "620", asentamiento: 10, comentario: "PAVIMENTO" }))
  assert.deepEqual(N.interpretarNombre("H30-620-10 C - Pirelli"), P({ resistencia: "H30", piedra: "620", asentamiento: 10, metodo: "C", comentario: "PIRELLI" }), "etiqueta del alta vieja")
  assert.equal(N.interpretarNombre("H08-620-10 C").resistencia, "H8")
  for (const libre of ["RDC-300 (CAN)", "H30-GUN", "H30-Cordones C (CAN)", "H4-RECUPERADO", "H30-620-99 C", "", null]) {
    assert.equal(N.interpretarNombre(libre), null, String(libre))
  }
})

test("ida y vuelta: interpretar lo armado devuelve las mismas partes", () => {
  const p = P({ resistencia: "H40", piedra: "1030", asentamiento: 18, metodo: "C", comentario: "OBRA X" })
  assert.deepEqual(N.interpretarNombre(N.armarNombre(p, "Hudson")), p)
})

test("en la otra planta y clave para comparar", () => {
  assert.equal(N.nombreEnOtraPlanta("H25-620-15 B (HUD) PELQUE", "Canning"), "H25-620-15 B (CAN) PELQUE")
  assert.equal(N.nombreEnOtraPlanta("H21-620-10 C", "Hudson"), "H21-620-10 C (HUD)")
  assert.equal(N.nombreEnOtraPlanta("RDC-300 (CAN)", "Hudson"), "RDC-300 (HUD)")
  assert.equal(N.claveNombre("H35-6/12-10 C (CAN)"), N.claveNombre("h35-612-10 c (HUD)"))
  assert.equal(N.claveNombre("RDC-300 (CAN)"), "RDC-300")
})

test("normalizar: los dudosos van a revisar aunque ya tengan la etiqueta", () => {
  const r = N.proponerRenombres([
    { id: "a", code: "H8-620-15 (CAN)", name: "H8-620-15 (CAN)", plant_id: "can" },
    { id: "b", code: "H17-6/20 B", name: "H17-6/20 B", plant_id: "can" },
    { id: "c", code: "H25-6/20 (CAN) — NO USAR", name: "H25-6/20 (CAN) — NO USAR", plant_id: "can" },
  ], [{ id: "can", name: "Canning" }])
  assert.deepEqual(r.map((x) => [x.id, x.estado]), [["a", "revisar"], ["b", "revisar"], ["c", "revisar"]])
  assert.equal(r.find((x) => x.id === "a").motivo, "Falta C o B")
  assert.equal(r.find((x) => x.id === "b").propuesto, "H17-620 B (CAN)", "la sugerencia queda para corregir a mano")
})

test("normalizar nombres: renombrar, revisar a mano, iguales y choques", () => {
  const plantas = [{ id: "can", name: "Canning" }, { id: "hud", name: "Hudson" }]
  const r = N.proponerRenombres([
    { id: "1", code: "H21-620-10 C", name: "H21-620-10 C", plant_id: "hud" },
    { id: "2", code: "H21-620-10 C (CAN)", name: "H21-620-10 C (CAN)", plant_id: "can" },
    { id: "3", code: "H25-620-15 B PELQUE (CAN)", name: "H25-620-15 B PELQUE (CAN)", plant_id: "can" },
    { id: "4", code: "RDC-200", name: "RDC-200", plant_id: "hud" },
    { id: "5", code: "H35-6/12-10 C (CAN)", name: "H35-6/12-10 C (CAN)", plant_id: "can" },
    { id: "6", code: "H35-612-10 C (CAN)", name: "H35-612-10 C (CAN)", plant_id: "can" },
    { id: "7", code: "H30-620-10 C (CAN)", name: "Otro nombre", plant_id: "can" },
  ], plantas)
  const de = (id) => r.find((x) => x.id === id)
  assert.deepEqual([de("1").estado, de("1").propuesto], ["renombrar", "H21-620-10 C (HUD)"])
  assert.equal(de("2").estado, "igual")
  assert.deepEqual([de("3").estado, de("3").propuesto], ["renombrar", "H25-620-15 B (CAN) PELQUE"])
  assert.deepEqual([de("4").estado, de("4").propuesto], ["revisar", "RDC-200 (HUD)"])
  assert.equal(de("5").estado, "revisar", "quedaría igual a otra de su planta")
  assert.match(de("5").motivo, /H35-612-10 C \(CAN\)/)
  assert.equal(de("6").estado, "igual")
  assert.equal(de("7").estado, "renombrar", "el nombre distinto del código también se corrige")
  assert.equal(de("7").motivo, "Solo cambia el nombre: «Otro nombre» → «H30-620-10 C (CAN)»")
  assert.deepEqual(r.map((x) => x.estado), ["renombrar", "renombrar", "renombrar", "revisar", "revisar", "igual", "igual"], "ordenadas: renombrar, revisar, iguales")
})

test("nombre para Indumix: sin la etiqueta de planta, esté donde esté", async () => {
  const { nombreParaIndumix } = await import("../carga/recetas-sim.ts")
  assert.equal(nombreParaIndumix("H30-612-15 B (CAN)"), "H30-612-15 B")
  assert.equal(nombreParaIndumix("H25-620-15 B (CAN) PELQUE"), "H25-620-15 B PELQUE")
  assert.equal(nombreParaIndumix("H21-620-10 C (HUD)"), "H21-620-10 C")
})
