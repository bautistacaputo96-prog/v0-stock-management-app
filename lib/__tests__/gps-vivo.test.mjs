// Pruebas del GPS en vivo (docs/migracion-loop/gps-vivo.md): estado del mixer, rumbo y antigüedad del dato. Sin red.
import { test } from "node:test"
import assert from "node:assert/strict"
import * as V from "../gps-vivo.ts"

const MIN = 60_000
const AHORA = new Date(2026, 9, 21, 10, 0).getTime()
const CANNING = { lat: -34.973882, lng: -58.466128 }
// Obra al norte de Canning, a ~5,5 km
const OBRA = { lat: -34.924, lng: -58.466 }
const base = (o = {}) => ({
  pos: { lat: -34.95, lng: -58.466 }, t: AHORA - 10_000, velocidad: 40, rumbo: 0, kmPlanta: 2.6, plantaPos: CANNING,
  conDespacho: true, obraPos: OBRA, minutosDesdeSalida: 10, idaMin: 30, ahora: AHORA, ...o,
})

test("rumbo: hacia el norte, el este y el sudoeste", () => {
  assert.equal(Math.round(V.rumboHacia(CANNING, { lat: -34.9, lng: -58.466128 })), 0)
  assert.equal(Math.round(V.rumboHacia({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })), 90)
  assert.equal(V.rumboTexto(225), "SO")
  assert.equal(V.rumboTexto(350), "N")
  assert.equal(V.rumboTexto(null), null)
  assert.equal(V.difAngulo(350, 10), 20)
  assert.equal(V.difAngulo(90, 270), 180)
})

test("antigüedad en segundos, minutos, horas y días", () => {
  assert.equal(V.antiguedad(20_000), "hace 20 s")
  assert.equal(V.antiguedad(3 * MIN + 5_000), "hace 3 min")
  assert.equal(V.antiguedad(125 * MIN), "hace 2 h 5 min")
  assert.equal(V.antiguedad(120 * MIN), "hace 2 h")
  assert.equal(V.antiguedad(3 * 24 * 60 * MIN), "hace 3 días")
  assert.equal(V.antiguedad(-500), "hace 0 s") // reloj del equipo un poco adelantado
})

test("estado: sin señal, en planta y en obra", () => {
  assert.equal(V.estadoGps(base({ pos: null })), "sin_senal")
  assert.equal(V.estadoGps(base({ t: AHORA - 4 * 60 * MIN })), "sin_senal")
  assert.equal(V.estadoGps(base({ pos: CANNING, kmPlanta: 0.01 })), "en_planta")
  assert.equal(V.estadoGps(base({ pos: { lat: -34.925, lng: -58.466 }, kmPlanta: 5.4 })), "en_obra")
})

test("estado: parado fuera de planta o sin despacho = detenido", () => {
  assert.equal(V.estadoGps(base({ velocidad: 2 })), "detenido")
  assert.equal(V.estadoGps(base({ conDespacho: false })), "detenido")
})

test("estado: con la obra ubicada manda el rumbo", () => {
  // Va al norte (a la obra) aunque ya pasó más tiempo que la ida: antes decía "volviendo" por el reloj
  assert.equal(V.estadoGps(base({ rumbo: 10, minutosDesdeSalida: 60 })), "hacia_obra")
  // Va al sur (a la planta) a los 20 min: antes decía "hacia la obra" por el reloj
  assert.equal(V.estadoGps(base({ rumbo: 185, minutosDesdeSalida: 20 })), "volviendo")
  // Rumbo de costado (este): no decide, vale el reloj
  assert.equal(V.estadoGps(base({ rumbo: 90, minutosDesdeSalida: 20 })), "hacia_obra")
  assert.equal(V.estadoGps(base({ rumbo: 90, minutosDesdeSalida: 50 })), "volviendo")
})

test("estado: obra y planta para el mismo lado → el rumbo no decide", () => {
  // Camión al sur de las dos: la obra y la planta quedan al norte
  const p = { lat: -35.05, lng: -58.466 }
  assert.equal(V.estadoGps(base({ pos: p, kmPlanta: 8.5, rumbo: 0, minutosDesdeSalida: 60 })), "volviendo")
  assert.equal(V.estadoGps(base({ pos: p, kmPlanta: 8.5, rumbo: 0, minutosDesdeSalida: 20 })), "hacia_obra")
})

test("estado: obra sin ubicar → por el reloj (como antes)", () => {
  assert.equal(V.estadoGps(base({ obraPos: null, rumbo: 185, minutosDesdeSalida: 20 })), "hacia_obra")
  assert.equal(V.estadoGps(base({ obraPos: null, rumbo: 185, minutosDesdeSalida: 46 })), "volviendo")
  assert.equal(V.estadoGps(base({ obraPos: null, rumbo: null, minutosDesdeSalida: 45 })), "hacia_obra")
})
