/**
 * Buscador de lugares "como Google Maps" para ubicar obras.
 *
 * Proveedor principal: Google Places API (New), solo desde el servidor. La clave está en GOOGLE_MAPS_API_KEY
 * (no es NEXT_PUBLIC: nunca llega al navegador ni se escribe en logs). Se usa un token de sesión por búsqueda,
 * que el navegador genera y pasa a autocompletar y a lugar, para que Google cobre la tarifa por sesión.
 * Si falta la clave o Google falla, se usa sin avisar el buscador gratuito de OpenStreetMap (Photon/Nominatim),
 * con la misma forma de respuesta.
 *
 * Este archivo no importa nada de Next ni de la base: las funciones reciben `fetch` para poder probarlas.
 */

export type FuenteLugar = "google" | "osm"

/** Una sugerencia de la lista (con Google las coordenadas vienen después, al elegirla). */
export type Sugerencia = {
  id: string
  principal: string
  secundario: string
  lat: number | null
  lng: number | null
  fuente: FuenteLugar
}

export type Lugar = { id: string; nombre: string; direccion: string; lat: number; lng: number; fuente: FuenteLugar }

/** Resultado del buscador de OpenStreetMap (/api/geo/buscar) */
export type ResultadoOsm = { nombre: string; lat: number; lng: number; localidad?: string | null; exacto?: boolean }

export type Centro = { lat: number; lng: number }

/** Centro de la zona (entre Canning y Hudson) si la planta no tiene ubicación */
export const CENTRO_ZONA: Centro = { lat: -34.9, lng: -58.35 }
/** Places API (New) acepta un radio de sesgo de hasta 50 km */
export const RADIO_SESGO_M = 50000

type FetchFn = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>

// ---------------------------------------------------------------------------- normalizadores
export function normalizarAutocompleteGoogle(d: any): Sugerencia[] {
  return ((d?.suggestions || []) as any[])
    .map((s) => s?.placePrediction)
    .filter((p) => p?.placeId)
    .map((p) => {
      const principal = p.structuredFormat?.mainText?.text || p.text?.text || ""
      const secundario = p.structuredFormat?.secondaryText?.text || (p.text?.text && p.text.text !== principal ? p.text.text : "")
      return { id: String(p.placeId), principal, secundario, lat: null, lng: null, fuente: "google" as const }
    })
}

export function normalizarLugarGoogle(d: any, id: string): Lugar | null {
  const lat = Number(d?.location?.latitude), lng = Number(d?.location?.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { id, nombre: d?.displayName?.text || d?.formattedAddress || "", direccion: d?.formattedAddress || "", lat, lng, fuente: "google" }
}

/** "Calle 123, Barrio, Localidad" → principal "Calle 123", secundario "Barrio, Localidad" */
export function normalizarOsm(rs: ResultadoOsm[]): Sugerencia[] {
  return (rs || [])
    .filter((r) => Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng)))
    .map((r) => {
      const partes = String(r.nombre || "").split(",").map((x) => x.trim()).filter(Boolean)
      return {
        id: `osm:${Number(r.lat).toFixed(6)},${Number(r.lng).toFixed(6)}`,
        principal: partes[0] || r.nombre || "",
        secundario: partes.slice(1).join(", ") || r.localidad || "",
        lat: Number(r.lat),
        lng: Number(r.lng),
        fuente: "osm" as const,
      }
    })
}

/** Los ids "osm:lat,lng" ya traen las coordenadas */
export function lugarDeIdOsm(id: string): Lugar | null {
  const m = /^osm:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(id)
  if (!m) return null
  return { id, nombre: "", direccion: "", lat: Number(m[1]), lng: Number(m[2]), fuente: "osm" }
}

// ---------------------------------------------------------------------------- llamadas
/**
 * Sugerencias para el texto escrito. Con clave: Google (sesgo de 50 km alrededor del centro); si no hay clave,
 * Google responde error o no trae nada utilizable por error, se usa OpenStreetMap.
 */
export async function autocompletar(
  q: string,
  opts: { centro?: Centro | null; sesion?: string | null; clave?: string | null; fetchFn: FetchFn; buscarOsm: (q: string) => Promise<ResultadoOsm[]> },
): Promise<{ fuente: FuenteLugar; sugerencias: Sugerencia[] }> {
  const texto = (q || "").trim()
  if (texto.length < 3) return { fuente: opts.clave ? "google" : "osm", sugerencias: [] }
  if (opts.clave) {
    try {
      const centro = opts.centro || CENTRO_ZONA
      const r = await opts.fetchFn("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": opts.clave },
        body: JSON.stringify({
          input: texto,
          languageCode: "es",
          includedRegionCodes: ["ar"],
          locationBias: { circle: { center: { latitude: centro.lat, longitude: centro.lng }, radius: RADIO_SESGO_M } },
          ...(opts.sesion ? { sessionToken: opts.sesion } : {}),
        }),
      })
      if (r.ok) return { fuente: "google", sugerencias: normalizarAutocompleteGoogle(await r.json()).slice(0, 8) }
    } catch {
      // sigue con OpenStreetMap
    }
  }
  return { fuente: "osm", sugerencias: normalizarOsm(await opts.buscarOsm(texto).catch(() => [])).slice(0, 8) }
}

/** Coordenadas del lugar elegido. Los "osm:" no consultan nada. Null si no se pudo. */
export async function obtenerLugar(
  id: string,
  opts: { sesion?: string | null; clave?: string | null; fetchFn: FetchFn },
): Promise<Lugar | null> {
  const osm = lugarDeIdOsm(id)
  if (osm) return osm
  if (!opts.clave || !/^[A-Za-z0-9_-]+$/.test(id)) return null
  try {
    const u = `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}?languageCode=es${opts.sesion ? `&sessionToken=${encodeURIComponent(opts.sesion)}` : ""}`
    const r = await opts.fetchFn(u, { headers: { "X-Goog-Api-Key": opts.clave, "X-Goog-FieldMask": "location,formattedAddress,displayName" } })
    if (!r.ok) return null
    return normalizarLugarGoogle(await r.json(), id)
  } catch {
    return null
  }
}
