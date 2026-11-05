/**
 * Dirección y localidad de la obra a partir de lo que devuelve el buscador del mapa (Google Places, Photon o
 * Nominatim), para completar los campos del formulario de obra cuando se elige la ubicación.
 *
 * - direccion: calle y número si hay; si no hay número, el nombre del lugar (un barrio cerrado, por ejemplo)
 *   o la calle sola.
 * - localidad: la ciudad o pueblo; si no hay, el barrio o el partido (sin "Partido de").
 *
 * Funciones puras: no importan nada de Next ni de la base (se prueban en lib/__tests__/geo-direccion.test.mjs).
 */

export type DireccionMapa = { direccion: string | null; localidad: string | null }

const limpio = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "")

/** "Partido de Esteban Echeverría" → "Esteban Echeverría" */
const sinPartido = (v: string) => v.replace(/^partido\s+(de|del)\s+/i, "").trim()

/** Para comparar: sin mayúsculas, tildes, puntos ni espacios de más */
export function normalizarDireccion(v: string | null | undefined): string {
  return limpio(v)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,;:°º#]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function armar(o: { calle?: string; numero?: string; nombre?: string; localidad?: string }): DireccionMapa {
  const calle = limpio(o.calle), numero = limpio(o.numero), localidad = limpio(o.localidad)
  let nombre = limpio(o.nombre)
  // El nombre no sirve como dirección si es la localidad misma o repite la calle
  if (nombre && (normalizarDireccion(nombre) === normalizarDireccion(localidad) || normalizarDireccion(nombre) === normalizarDireccion(calle))) nombre = ""
  const direccion = calle && numero ? `${calle} ${numero}` : nombre || calle
  return { direccion: direccion || null, localidad: localidad || null }
}

const primero = (...vs: unknown[]) => vs.map(limpio).find(Boolean) || ""

// ---------------------------------------------------------------------------- Google Places (New)
/**
 * Lugar de Google (Place Details o un resultado de places:searchText) con addressComponents, formattedAddress y
 * displayName. Si no vienen los addressComponents, se arma con formattedAddress ("Calle 123, B1804 Canning, ...").
 */
export function direccionDeGoogle(d: any): DireccionMapa {
  const comps = (Array.isArray(d?.addressComponents) ? d.addressComponents : []) as any[]
  const nombre = limpio(d?.displayName?.text ?? d?.displayName)
  if (comps.length) {
    const de = (tipo: string) => {
      const c = comps.find((x) => Array.isArray(x?.types) && x.types.includes(tipo))
      return limpio(c?.longText ?? c?.long_name ?? c?.shortText ?? c?.short_name)
    }
    const localidad = primero(de("locality"), de("sublocality_level_1"), de("sublocality"), de("neighborhood"), sinPartido(de("administrative_area_level_2")))
    // Si el lugar es la localidad (o el partido, la provincia), no hay dirección
    const tipos = (Array.isArray(d?.types) ? d.types : []) as string[]
    const esZona = tipos.some((t) => ["locality", "administrative_area_level_1", "administrative_area_level_2", "country"].includes(t))
    return armar({ calle: de("route"), numero: de("street_number"), nombre: esZona ? "" : nombre, localidad })
  }
  const partes = limpio(d?.formattedAddress).split(",").map((x) => x.trim()).filter(Boolean)
  if (partes.length >= 2) {
    // Quita el código postal: "B1804 Canning" / "1804 Canning" → "Canning"
    const localidad = partes[1].replace(/^[A-Z]?\d{4}[A-Z]{0,3}\s+/, "").trim()
    const ultimo = partes[partes.length - 1].toLowerCase()
    // "Canning, Provincia de Buenos Aires, Argentina": la primera parte ya es la localidad
    if (partes.length === 3 && ultimo === "argentina" && /provincia|buenos aires/i.test(partes[1])) return armar({ nombre, localidad: partes[0] })
    return armar({ calle: partes[0], nombre: /\d/.test(partes[0]) ? "" : nombre, localidad })
  }
  return armar({ nombre, localidad: partes[0] && partes[0] !== nombre ? partes[0] : "" })
}

// ---------------------------------------------------------------------------- Nominatim
/** Un resultado de Nominatim (search con addressdetails=1, o reverse con format=jsonv2) */
export function direccionDeNominatim(x: any): DireccionMapa {
  const a = x?.address || {}
  const localidad = primero(a.city, a.town, a.village, a.hamlet, a.suburb, a.municipality, sinPartido(limpio(a.county)), sinPartido(limpio(a.state_district)))
  return armar({ calle: a.road, numero: a.house_number, nombre: limpio(x?.name), localidad })
}

// ---------------------------------------------------------------------------- Photon
/** Las properties de un feature de Photon */
export function direccionDePhoton(p: any): DireccionMapa {
  const tipo = limpio(p?.type)
  // El lugar elegido es la localidad misma
  if (["city", "town", "village", "locality"].includes(tipo) && p?.name) return { direccion: null, localidad: limpio(p.name) || null }
  const localidad = primero(p?.city, p?.district, sinPartido(limpio(p?.county)))
  return armar({ calle: p?.street, numero: p?.housenumber, nombre: p?.name, localidad })
}

// ---------------------------------------------------------------------------- en el formulario
export const tieneDireccion = (d: DireccionMapa | null | undefined): d is DireccionMapa => !!(d && (d.direccion || d.localidad))

/** Completa solo los campos vacíos (lo que escribió la persona no se pisa) */
export function completarVacios(actual: { direccion: string; localidad: string }, mapa: DireccionMapa | null | undefined): { direccion: string; localidad: string } {
  return {
    direccion: actual.direccion.trim() ? actual.direccion : mapa?.direccion || actual.direccion,
    localidad: actual.localidad.trim() ? actual.localidad : mapa?.localidad || actual.localidad,
  }
}

/** El mapa dice otra cosa que lo escrito (para ofrecer "Usar esto") */
export function difiereDelMapa(actual: { direccion: string; localidad: string }, mapa: DireccionMapa | null | undefined): boolean {
  if (!tieneDireccion(mapa)) return false
  const distinto = (escrito: string, delMapa: string | null) => !!delMapa && normalizarDireccion(escrito) !== normalizarDireccion(delMapa)
  return distinto(actual.direccion, mapa.direccion) || distinto(actual.localidad, mapa.localidad)
}

/** Reemplaza con lo del mapa (lo que el mapa no trae queda como estaba) */
export function usarDelMapa(actual: { direccion: string; localidad: string }, mapa: DireccionMapa): { direccion: string; localidad: string } {
  return { direccion: mapa.direccion || actual.direccion, localidad: mapa.localidad || actual.localidad }
}

/** "Av. X 123, Canning" */
export const textoDireccion = (d: DireccionMapa) => [d.direccion, d.localidad].filter(Boolean).join(", ")
