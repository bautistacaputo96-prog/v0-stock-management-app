// Pruebas de lib/pantallas.ts (auditoría de pantallas, 24/11/2026). Correr con TZ de Argentina:
// las fechas locales son las del navegador de la planta.
import { test } from "node:test"
import assert from "node:assert/strict"
import * as P from "../pantallas.ts"

test("fechaLocal: un despacho de las 21:30 de Argentina queda en su día (no en el de UTC)", () => {
  assert.equal(P.fechaLocal("2026-11-24T00:30:00+00:00"), "2026-11-23")
  assert.equal(P.fechaLocal("2026-11-23T15:00:00-03:00"), "2026-11-23")
})

test("rangoDiasAR: de 00:00 a 23:59:59 de Argentina, vacío = sin extremo", () => {
  assert.deepEqual(P.rangoDiasAR("2026-11-01", "2026-11-30"), { desde: "2026-11-01T00:00:00-03:00", hasta: "2026-11-30T23:59:59.999-03:00" })
  assert.deepEqual(P.rangoDiasAR("", ""), { desde: null, hasta: null })
  // el último día entra entero y la noche del día anterior al "desde" no
  const r = P.rangoDiasAR("2026-11-01", "2026-11-30")
  assert.ok(Date.parse("2026-11-30T22:00:00-03:00") <= Date.parse(r.hasta))
  assert.ok(Date.parse("2026-10-31T22:00:00-03:00") < Date.parse(r.desde))
})

test("claveMes / enMeses: meses sueltos no incluyen los del medio", () => {
  assert.equal(P.claveMes(new Date(2026, 10, 24)), "2026-10")
  const meses = ["2026-7", "2026-10"] // agosto y noviembre
  assert.equal(P.enMeses(new Date(2026, 7, 15), meses), true)
  assert.equal(P.enMeses(new Date(2026, 8, 15), meses), false) // septiembre no
  assert.equal(P.enMeses(new Date(2026, 10, 1), meses), true)
})

test("diasTranscurridos: el mes en curso cuenta hasta hoy", () => {
  const ahora = new Date(2026, 10, 5, 10, 0) // 5 de noviembre
  assert.equal(P.diasTranscurridos(["2026-10"], ahora), 5)
  assert.equal(P.diasTranscurridos(["2026-9", "2026-10"], ahora), 31 + 5)
  assert.equal(P.diasTranscurridos(["2026-7", "2026-10"], ahora), 31 + 5) // agosto + noviembre, sin septiembre ni octubre
  assert.equal(P.diasTranscurridos(["2026-11"], ahora), 0) // diciembre todavía no empezó
  assert.equal(P.diasTranscurridos([], ahora), 0)
  assert.equal(P.diasTranscurridos(["2026-10", "2026-10"], ahora), 5) // repetido cuenta una vez
})

test("agruparProduccion: por la planta que despachó, con la de la fórmula para los viejos", () => {
  const plantas = [{ id: "can", name: "Canning" }, { id: "hud", name: "Hudson" }]
  const filas = [
    { quantity_m3: 8, plant_id: "hud", formulas: { code: "H21 (CAN)", plant_id: "can" }, mixers: { license_plate: "AA1" } },
    { quantity_m3: "6.5", plant_id: "can", formulas: { code: "H21 (CAN)", plant_id: "can" }, mixers: null },
    { quantity_m3: 3, plant_id: null, formulas: { code: "H30 (HUD)", plant_id: "hud" }, mixers: { license_plate: "AA1" } },
    { quantity_m3: 1, plant_id: null, formulas: null, mixers: null },
  ]
  const orden = (xs) => [...xs].sort((a, b) => a.name.localeCompare(b.name))
  assert.deepEqual(orden(P.agruparProduccion(filas, "plant", plantas)), [
    { name: "Canning", volumen: 6.5 }, { name: "Hudson", volumen: 11 }, { name: "Sin planta", volumen: 1 },
  ])
  assert.deepEqual(orden(P.agruparProduccion(filas, "formula", plantas)), [
    { name: "H21 (CAN)", volumen: 14.5 }, { name: "H30 (HUD)", volumen: 3 }, { name: "Sin fórmula", volumen: 1 },
  ])
  assert.deepEqual(orden(P.agruparProduccion(filas, "mixer", plantas)), [
    { name: "AA1", volumen: 11 }, { name: "Sin camión", volumen: 7.5 },
  ])
})

test("materialRepetido: el primero que se repite, ignorando vacíos", () => {
  assert.equal(P.materialRepetido(["a", "b", "c"]), null)
  assert.equal(P.materialRepetido(["a", "b", "a", "b"]), "a")
  assert.equal(P.materialRepetido(["", "", null, "x"]), null)
})
