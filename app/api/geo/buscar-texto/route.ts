import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buscarTexto, type Centro } from "@/lib/geo-lugares"
import { buscarOsm } from "@/lib/geo-osm"

/**
 * Búsqueda completa, como apretar Enter en Google Maps (places:searchText), con coordenadas.
 * ?q=texto&planta=<id de planta>
 * Sesgo de 50 km alrededor de la planta del pedido; si no hay GOOGLE_MAPS_API_KEY o Google falla, OpenStreetMap.
 * Respuesta: { fuente: "google" | "osm", sugerencias: Sugerencia[] } (con lat/lng y busqueda: true).
 * La clave nunca sale del servidor.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const q = (sp.get("q") || "").slice(0, 200)
  const planta = sp.get("planta")
  let centro: Centro | null = null
  if (planta && /^[0-9a-f-]{36}$/i.test(planta)) {
    try {
      const sb = await createClient()
      const { data } = await sb.from("plants").select("gps_lat, gps_lng").eq("id", planta).maybeSingle()
      if (data?.gps_lat != null && data?.gps_lng != null) centro = { lat: Number(data.gps_lat), lng: Number(data.gps_lng) }
    } catch {}
  }
  const r = await buscarTexto(q, {
    centro,
    clave: process.env.GOOGLE_MAPS_API_KEY || null,
    fetchFn: (u, init) => fetch(u, { ...init, cache: "no-store" }),
    buscarOsm,
  })
  return NextResponse.json(r)
}
