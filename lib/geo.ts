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

/** google.com, google.com.ar, google.de, google.co.uk… */
const DOMINIO_GOOGLE = /^google\.(com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$/

function urlWeb(texto: string): URL | null {
  try {
    const u = new URL((texto || "").trim())
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password || u.port) return null
    return u
  } catch {
    return null
  }
}

/** El host es de Google (cualquier subdominio de google.<país>) o de sus links cortos. */
function hostDeGoogle(host: string): boolean {
  const h = host.toLowerCase()
  if (h === "goo.gl" || h === "maps.app.goo.gl" || h === "g.co") return true
  const partes = h.split(".")
  for (let k = 0; k < partes.length - 1; k++) if (DOMINIO_GOOGLE.test(partes.slice(k).join("."))) return true
  return false
}

/**
 * ¿Es un link de Google Maps que /api/geo/link puede abrir? Se mira el host real (antes una expresión sobre el
 * texto dejaba pasar maps.google.otro-sitio.com y el servidor iba a buscar ese sitio).
 */
export function esLinkDeGoogleMaps(texto: string): boolean {
  const u = urlWeb(texto)
  if (!u) return false
  const h = u.hostname.toLowerCase(), p = u.pathname.toLowerCase()
  if (h === "maps.app.goo.gl") return true
  if (h === "goo.gl") return p.startsWith("/maps")
  if (h === "g.co") return p.startsWith("/kgs")
  if (h.startsWith("maps.") && DOMINIO_GOOGLE.test(h.slice(5))) return true
  const sinWww = h.startsWith("www.") ? h.slice(4) : h
  return DOMINIO_GOOGLE.test(sinWww) && p.startsWith("/maps")
}

/** Una redirección de un link de Google Maps se sigue solo si va a otro sitio de Google. */
export function esRedireccionDeGoogle(texto: string): boolean {
  const u = urlWeb(texto)
  return !!u && hostDeGoogle(u.hostname)
}
