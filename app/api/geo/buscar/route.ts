import { NextResponse } from "next/server"
import { exigirSesion, respuestaError } from "@/lib/auth/servidor"
import { buscarOsm } from "@/lib/geo-osm"

/**
 * Busca una dirección y devuelve candidatos con coordenadas, solo dentro de la
 * zona de influencia de Canning y Hudson (OpenStreetMap: ver lib/geo-osm.ts).
 */
export async function GET(req: Request) {
  // Solo con sesión iniciada: estas búsquedas usan la clave paga de Google (o servicios gratuitos con límite)
  try {
    const s = await exigirSesion()
    if (s.respuesta) return s.respuesta
  } catch (e) {
    return respuestaError(e)
  }
  const q = (new URL(req.url).searchParams.get("q") || "").trim()
  if (q.length < 3) return NextResponse.json({ resultados: [] })
  try {
    return NextResponse.json({ resultados: await buscarOsm(q) })
  } catch (e: any) {
    return NextResponse.json({ resultados: [], error: e?.message || "No se pudo buscar" }, { status: 502 })
  }
}
