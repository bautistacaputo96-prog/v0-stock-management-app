/**
 * GPS en vivo (docs/migracion-loop/gps-vivo.md): estado de cada mixer a partir de su última posición,
 * rumbo en texto y antigüedad del dato. Lógica pura, sin red ni base: la usan /api/gps/posiciones y la
 * pantalla Logística › En vivo, y se prueba en lib/__tests__/gps-vivo.test.mjs.
 */
import { distanciaKm, type LatLng } from "@/lib/geo"

/** Cada cuánto pide posiciones la pantalla En vivo (solo con la pestaña visible). */
export const REFRESCO_VIVO_MS = 15_000
/** Caché del servidor: varias pantallas abiertas a la vez hacen una sola consulta a Wialon. */
export const CACHE_GPS_MS = 8_000

/** Radio para considerar que un camión está "en planta" (las geocercas de Wialon son de ~50 m). */
export const RADIO_PLANTA_KM = 0.25
/** Radio para considerar que está "en la obra" a la que va. */
export const RADIO_OBRA_KM = 0.4
/** Más de 5 km/h = en movimiento (parado con el motor en marcha el GPS marca 0–3 km/h). */
export const VELOCIDAD_MOVIMIENTO = 5
/** Sin posición hace más de 3 h = sin señal. */
export const SIN_SENAL_MS = 3 * 60 * 60 * 1000
/** Rumbo "apuntando" a un destino: a menos de 60° de la línea recta hacia él. */
const TOLERANCIA_RUMBO = 60
/** El rumbo solo decide si la obra y la planta quedan para lados distintos (más de 90° entre una y otra). */
const SEPARACION_MINIMA = 90

export type EstadoGps = "en_planta" | "hacia_obra" | "en_obra" | "volviendo" | "detenido" | "sin_senal"

/** Rumbo de a hacia b, en grados (0 = norte, 90 = este). */
export function rumboHacia(a: LatLng, b: LatLng): number {
  const r = Math.PI / 180
  const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r)
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r)
  return ((Math.atan2(y, x) / r) + 360) % 360
}

/** Diferencia entre dos rumbos, de 0 a 180°. */
export function difAngulo(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360)
  return d > 180 ? 360 - d : d
}

const PUNTOS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"]
/** 0 → "N", 45 → "NE", 225 → "SO"… (puntos cardinales en castellano). */
export function rumboTexto(grados: number | null | undefined): string | null {
  if (grados == null || !Number.isFinite(grados)) return null
  return PUNTOS[Math.round((((grados % 360) + 360) % 360) / 45) % 8]
}

/** "hace 20 s", "hace 3 min", "hace 2 h 5 min", "hace 3 días". */
export function antiguedad(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `hace ${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `hace ${m} min`
  const h = Math.floor(m / 60)
  if (h < 48) return `hace ${h} h${m % 60 ? ` ${m % 60} min` : ""}`
  return `hace ${Math.floor(h / 24)} días`
}

export type EntradaEstado = {
  pos: LatLng | null
  /** momento de la posición (ms) */
  t: number | null
  velocidad: number | null
  /** rumbo del GPS en grados */
  rumbo: number | null
  /** km a la planta más cercana */
  kmPlanta: number | null
  /** ubicación de la planta más cercana (para ver si el rumbo apunta a ella) */
  plantaPos: LatLng | null
  /** hay un despacho de hoy que ya salió */
  conDespacho: boolean
  obraPos: LatLng | null
  /** minutos desde la salida del despacho */
  minutosDesdeSalida: number | null
  /** minutos de ida a la obra (los de la obra, o 30) */
  idaMin: number
  ahora: number
}

/**
 * Estado del mixer según el GPS:
 * - sin señal: no hay posición o tiene más de 3 h;
 * - en planta / en obra: dentro del radio;
 * - en movimiento con despacho: si la obra está ubicada y el rumbo apunta claramente a la obra o a la planta, eso
 *   decide; si no, por el tiempo (más que la ida estimada + 15 min = volviendo);
 * - el resto: detenido.
 */
export function estadoGps(e: EntradaEstado): EstadoGps {
  if (!e.pos || (e.t != null && e.ahora - e.t > SIN_SENAL_MS)) return "sin_senal"
  if (e.kmPlanta != null && e.kmPlanta <= RADIO_PLANTA_KM) return "en_planta"
  const kmObra = e.obraPos ? distanciaKm(e.pos, e.obraPos) : null
  if (kmObra != null && kmObra <= RADIO_OBRA_KM) return "en_obra"
  if (!e.conDespacho || (e.velocidad || 0) <= VELOCIDAD_MOVIMIENTO) return "detenido"
  if (e.obraPos && e.plantaPos && e.rumbo != null) {
    const aObra = rumboHacia(e.pos, e.obraPos)
    const aPlanta = rumboHacia(e.pos, e.plantaPos)
    if (difAngulo(aObra, aPlanta) >= SEPARACION_MINIMA) {
      if (difAngulo(e.rumbo, aObra) <= TOLERANCIA_RUMBO) return "hacia_obra"
      if (difAngulo(e.rumbo, aPlanta) <= TOLERANCIA_RUMBO) return "volviendo"
    }
  }
  return e.minutosDesdeSalida != null && e.minutosDesdeSalida > e.idaMin + 15 ? "volviendo" : "hacia_obra"
}
