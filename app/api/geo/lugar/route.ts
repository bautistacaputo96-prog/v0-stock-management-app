import { NextResponse } from "next/server"
import { obtenerLugar } from "@/lib/geo-lugares"

/**
 * Coordenadas del lugar elegido en el buscador.
 * ?id=<placeId de Google o "osm:lat,lng">&sesion=<el mismo token de la búsqueda>
 * Google Places (New) Place Details con field mask location,formattedAddress,displayName (Essentials).
 * Respuesta: { lugar: { id, nombre, direccion, lat, lng, fuente } } o 404 si no se pudo.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const id = (sp.get("id") || "").slice(0, 300)
  const sesion = (sp.get("sesion") || "").slice(0, 64) || null
  const { lugar, aviso } = await obtenerLugar(id, {
    sesion,
    clave: process.env.GOOGLE_MAPS_API_KEY || null,
    fetchFn: (u, init) => fetch(u, { ...init, cache: "no-store" }),
  })
  // Si Google no se pudo usar, queda en el log del servidor (el motivo nunca incluye la clave)
  if (aviso) console.error(`[geo/lugar] Google no respondió: ${aviso}`)
  if (!lugar) return NextResponse.json({ error: "No se pudo ubicar ese lugar: probá con otro o marcá el punto en el mapa", ...(aviso ? { aviso } : {}) }, { status: 404 })
  return NextResponse.json({ lugar })
}
