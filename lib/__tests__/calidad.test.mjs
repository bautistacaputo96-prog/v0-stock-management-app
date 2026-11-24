// Pruebas de Calidad (lib/calidad.ts): fechas de probetas, MPa, clase H, desvío, semana del reporte.
// Corren con TZ=UTC (Vercel) y con TZ=America/Argentina/Buenos_Aires (el navegador): el resultado tiene que ser el mismo
// (npm run test:calidad). Sin base ni red.
import { test } from "node:test"
import assert from "node:assert/strict"
import * as C from "../calidad.ts"
import { probetasParaMuestra } from "../muestra.ts"

const ar = (fecha, hhmm = "12:00") => new Date(`${fecha}T${hhmm}:00-03:00`)

test("diaArgentina: un despacho de las 22 h es de ese día, aunque en UTC ya sea el siguiente", () => {
  // Así llega dispatch_date de PostgREST: en UTC
  assert.equal(C.diaArgentina("2026-11-23T01:30:00+00:00"), "2026-11-22")
  assert.equal(C.diaArgentina("2026-11-22T13:00:00+00:00"), "2026-11-22")
  assert.equal(C.diaArgentina("2026-11-22"), "2026-11-22")
  assert.equal(C.diaArgentina(null), "")
  assert.equal(C.diaArgentina("basura"), "")
})

test("fmtDia: la fecha programada se muestra el mismo día (antes salía el anterior en Argentina)", () => {
  assert.equal(C.fmtDia("2026-11-23"), "23/11/2026")
  assert.equal(C.fmtDia(""), "")
  const d = C.fechaDeDia("2026-11-23")
  assert.equal(d.getDate(), 23)
  assert.equal(d.getMonth(), 10)
})

test("diasHasta: la probeta de hoy es 0 (no vencida), la de mañana 1 y la de ayer −1", () => {
  const ahora = ar("2026-11-23", "08:00")
  assert.equal(C.diasHasta("2026-11-23", ahora), 0)
  assert.equal(C.diasHasta("2026-11-24", ahora), 1)
  assert.equal(C.diasHasta("2026-11-22", ahora), -1)
  // a las 22 h de Argentina (ya es el 24 en UTC) sigue siendo hoy
  assert.equal(C.diasHasta("2026-11-23", ar("2026-11-23", "22:30")), 0)
  // cruce de mes y de año
  assert.equal(C.diasHasta("2027-01-02", ar("2026-12-30")), 3)
})

test("diasEntre: edad real de la probeta con el moldeo en el día de Argentina", () => {
  // moldeo 22/11 a las 22:30 (23/11 en UTC), rotura 29/11 → 7 días, no 6
  assert.equal(C.diasEntre("2026-11-23T01:30:00+00:00", "2026-11-29"), 7)
  assert.equal(C.diasEntre("2026-11-01", "2026-11-29"), 28)
})

test("semanaAnterior: el lunes 08:00 de Argentina (cron 11:00 UTC) da lunes a domingo de la semana pasada", () => {
  assert.deepEqual(C.semanaAnterior(new Date("2026-11-23T11:00:00Z")), { desde: "2026-11-16", hasta: "2026-11-22" })
  // domingo a la noche en Argentina (lunes en UTC): todavía es la semana en curso
  assert.deepEqual(C.semanaAnterior(new Date("2026-11-23T01:00:00Z")), { desde: "2026-11-09", hasta: "2026-11-15" })
  // miércoles
  assert.deepEqual(C.semanaAnterior(ar("2026-11-25")), { desde: "2026-11-16", hasta: "2026-11-22" })
})

test("limitesDias: el rango de despachos va de 00:00 a 23:59 de Argentina", () => {
  const { gte, lte } = C.limitesDias("2026-11-16", "2026-11-22")
  assert.equal(new Date(gte).toISOString(), "2026-11-16T03:00:00.000Z")
  assert.equal(new Date(lte).toISOString(), "2026-11-23T02:59:59.999Z")
})

test("resistenciaDeFormula: la clase H sale del código, con o sin guion", () => {
  assert.equal(C.resistenciaDeFormula("H30-620-15 B (CAN) PELQUE"), 30)
  assert.equal(C.resistenciaDeFormula("H-21"), 21)
  assert.equal(C.resistenciaDeFormula("h8-620 (HUD)"), 8)
  // (HUD) no es una clase
  assert.equal(C.resistenciaDeFormula("RDC (HUD)"), null)
  // si el código no la tiene, se busca en el nombre y después en la descripción
  assert.equal(C.resistenciaDeFormula("RDC", "", "Hormigón H25 bombeable"), 25)
  assert.equal(C.resistenciaDeFormula(null, undefined, ""), null)
})

test("mpaDesdeDial: tf, kN y kgf dan lo mismo para la misma fuerza; cilindro de 10 cm", () => {
  const base = { constant_a: 0, constant_b: 0, constant_c: 1, constant_d: 0, cylinder_diameter_cm: 10 }
  const area = Math.PI * 0.05 ** 2
  // 20 tf sobre un cilindro de 10 cm ≈ 24,97 MPa
  assert.ok(Math.abs(C.mpaDesdeDial({ ...base, force_unit: "tf" }, 20) - (20 * 9806.65) / area / 1e6) < 1e-9)
  assert.ok(Math.abs(C.mpaDesdeDial({ ...base, force_unit: "tf" }, 20) - 24.97) < 0.01)
  assert.ok(Math.abs(C.mpaDesdeDial({ ...base, force_unit: "kN" }, 196.133) - 24.97) < 0.01)
  assert.ok(Math.abs(C.mpaDesdeDial({ ...base, force_unit: "kgf" }, 20000) - 24.97) < 0.01)
  // sin unidad = tf (como las calibraciones viejas)
  assert.equal(C.mpaDesdeDial({ ...base, force_unit: null }, 20), C.mpaDesdeDial({ ...base, force_unit: "tf" }, 20))
  assert.equal(C.mpaDesdeDial(null, 20), null)
  assert.equal(C.mpaDesdeDial({ ...base, cylinder_diameter_cm: 0 }, 20), null)
})

test("desvioMuestral: con n − 1 (el reporte de compresión usaba n y daba un desvío menor)", () => {
  assert.equal(C.desvioMuestral([30]), 0)
  assert.equal(C.desvioMuestral([28, 32]), Math.sqrt(8))
  assert.ok(Math.abs(C.desvioMuestral([25, 27, 29, 31, 33]) - Math.sqrt(10)) < 1e-12)
})

test("limitesHistograma: un resultado justo en el borde (30,0 MPa) entra en el último intervalo", () => {
  const l = C.limitesHistograma([25.3, 30])
  assert.deepEqual(l, { min: 24, max: 32 })
  const enAlguno = [25.3, 30].every((v) => {
    for (let i = l.min; i < l.max; i += 2) if (v >= i && v < i + 2) return true
    return false
  })
  assert.ok(enAlguno)
  assert.deepEqual(C.limitesHistograma([30, 30]), { min: 30, max: 32 })
  assert.equal(C.limitesHistograma([]), null)
})

test("probetasParaMuestra: 7 y 28 días desde el día del despacho", () => {
  const p = probetasParaMuestra("d1", "2026-11-02T15:00:00+00:00")
  assert.deepEqual(p.map((x) => [x.cylinder_number, x.test_age_days, x.scheduled_test_date]), [
    [1, 7, "2026-11-09"],
    [2, 28, "2026-11-30"],
    [3, 28, "2026-11-30"],
  ])
})
