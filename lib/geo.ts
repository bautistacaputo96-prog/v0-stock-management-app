/**
 * Utilidades de ubicación compartidas por el cliente y el servidor.
 */

export type LatLng = { lat: number; lng: number }

/** Distancia en línea recta entre dos puntos, en km. */
export function distanciaKm(a: LatLng, b: LatLng): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/**
 * Minutos de viaje estimados sin servicio de rutas: la ruta real suele ser ~1,35
 * veces la línea recta y un mixer cargado promedia ~35 km/h en la zona.
 */
export function minutosEstimados(km: number): number {
  return Math.max(5, Math.round(((km * 1.35) / 35) * 60))
}

/**
 * Un mixer tarda más que un auto: se multiplica el tiempo de ruta del auto.
 * Es un valor inicial; con el GPS se reemplaza por el tiempo real de cada obra.
 */
export const FACTOR_MIXER = 1.3

/**
 * Lee coordenadas pegadas por el usuario: "-34.97, -58.46", un link de Google Maps
 * (…/@-34.97,-58.46,17z, …?q=-34.97,-58.46, …!3d-34.97!4d-58.46) o de OpenStreetMap.
 */
export function parsearCoordenadas(texto: string): LatLng | null {
  const t = (texto || "").trim()
  const patrones = [
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, // Google Maps (lugar)
    /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/, // Google Maps (vista)
    /[?&](?:q|query|ll|mlat)=(-?\d+\.\d+)(?:,|&mlon=)\s*(-?\d+\.\d+)/, // ?q=lat,lng / OSM
    /^\s*(-?\d{1,2}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)\s*$/, // "lat, lng"
  ]
  for (const p of patrones) {
    const m = t.match(p)
    if (m) {
      const lat = Number(m[1]), lng = Number(m[2])
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng }
    }
  }
  return null
}
