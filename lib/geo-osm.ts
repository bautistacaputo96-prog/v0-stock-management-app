/**
 * Buscador de direcciones gratuito de OpenStreetMap, solo dentro de la zona de influencia de Canning y Hudson.
 * (Movido de /api/geo/buscar para usarlo también como respaldo del buscador de Google.)
 *
 * Combina dos buscadores:
 *  - Photon: tolera mejor abreviaturas y encuentra barrios ("Santa Clara al Sur").
 *  - Nominatim: mejor con calles y numeración cuando la tiene.
 * La numeración de muchas calles de la zona no está cargada en OpenStreetMap, así
 * que a veces se ubica la calle o el barrio y el punto se ajusta a mano en el mapa.
 */
const ZONA = { oeste: -58.95, sur: -35.35, este: -57.85, norte: -34.55 }
const UA = { "User-Agent": "RebucretProduccion/1.0 (produccionrebucret.com)", "Accept-Language": "es" }

export type Resultado = { nombre: string; lat: number; lng: number; localidad: string | null; exacto: boolean }

const enZona = (r: Resultado) => r.lng >= ZONA.oeste && r.lng <= ZONA.este && r.lat >= ZONA.sur && r.lat <= ZONA.norte

async function photon(q: string): Promise<Resultado[]> {
  const u = new URL("https://photon.komoot.io/api/")
  u.searchParams.set("q", q)
  u.searchParams.set("lat", "-34.9")
  u.searchParams.set("lon", "-58.35")
  u.searchParams.set("limit", "8")
  u.searchParams.set("bbox", `${ZONA.oeste},${ZONA.sur},${ZONA.este},${ZONA.norte}`)
  const r = await fetch(u, { headers: UA, next: { revalidate: 86400 } })
  if (!r.ok) return []
  const d = await r.json()
  return (d.features || []).map((f: any) => {
    const p = f.properties || {}
    const calle = [p.street, p.housenumber].filter(Boolean).join(" ")
    const lugar = p.city || p.district || p.county || ""
    const nombre = [p.name, calle, lugar].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ")
    return { nombre, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], localidad: lugar || null, exacto: !!p.housenumber }
  })
}

async function nominatim(q: string): Promise<Resultado[]> {
  const u = new URL("https://nominatim.openstreetmap.org/search")
  u.searchParams.set("q", /argentina/i.test(q) ? q : `${q}, Buenos Aires, Argentina`)
  u.searchParams.set("format", "jsonv2")
  u.searchParams.set("countrycodes", "ar")
  u.searchParams.set("addressdetails", "1")
  u.searchParams.set("limit", "6")
  u.searchParams.set("viewbox", `${ZONA.oeste},${ZONA.norte},${ZONA.este},${ZONA.sur}`)
  u.searchParams.set("bounded", "1")
  const r = await fetch(u, { headers: UA, next: { revalidate: 86400 } })
  if (!r.ok) return []
  const d = (await r.json()) as any[]
  return d.map((x) => ({
    nombre: String(x.display_name).split(", ").slice(0, 4).join(", "),
    lat: Number(x.lat),
    lng: Number(x.lon),
    localidad: x.address?.city || x.address?.town || x.address?.village || x.address?.suburb || null,
    exacto: !!x.address?.house_number,
  }))
}

/** Busca y devuelve hasta 8 candidatos sin duplicados, primero los que tienen número. */
export async function buscarOsm(q: string): Promise<Resultado[]> {
  const buscar = async (texto: string) => {
    const [a, b] = await Promise.all([photon(texto).catch(() => []), nominatim(texto).catch(() => [])])
    return [...a, ...b].filter(enZona)
  }
  // Si no aparece con número, se busca la calle sola y, en último caso, la localidad:
  // al menos el mapa queda centrado en la zona para marcar el punto con un clic.
  let todos = await buscar(q)
  if (!todos.length && /\d/.test(q)) todos = (await buscar(q.replace(/\b\d+\b/g, "").replace(/\s+,/g, ",").trim())).map((r) => ({ ...r, exacto: false }))
  if (!todos.length && q.includes(",")) todos = (await buscar(q.split(",").slice(-1)[0].trim())).map((r) => ({ ...r, exacto: false, nombre: `${r.nombre} (zona)` }))
  // Sin duplicados (mismo punto a menos de ~100 m)
  const unicos: Resultado[] = []
  for (const r of todos) {
    if (!unicos.some((u) => Math.abs(u.lat - r.lat) < 0.001 && Math.abs(u.lng - r.lng) < 0.001)) unicos.push(r)
  }
  unicos.sort((x, y) => Number(y.exacto) - Number(x.exacto))
  return unicos.slice(0, 8)
}
