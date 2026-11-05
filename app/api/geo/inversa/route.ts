import { NextResponse } from "next/server"
import { reverse } from "@/lib/geo-osm"

/**
 * Dirección y localidad de un punto (geocodificación inversa de OpenStreetMap: ver lib/geo-osm.ts).
 * Se usa cuando la obra se ubica con un clic en el mapa, arrastrando el punto, o pegando un link o coordenadas.
 * ?lat=&lng=
 * Respuesta: { direccion, localidad } (null en lo que no se encontró).
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const lat = Number(sp.get("lat")), lng = Number(sp.get("lng"))
  if (!sp.get("lat") || !sp.get("lng") || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "Faltan coordenadas" }, { status: 400 })
  }
  try {
    const d = await reverse(lat, lng)
    return NextResponse.json({ direccion: d?.direccion ?? null, localidad: d?.localidad ?? null })
  } catch (e: any) {
    return NextResponse.json({ direccion: null, localidad: null, error: e?.message || "No se pudo buscar la dirección" }, { status: 502 })
  }
}
