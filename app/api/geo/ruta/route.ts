import { NextResponse } from "next/server"
import { distanciaKm, minutosEstimados, FACTOR_MIXER } from "@/lib/geo"

/**
 * Distancia y tiempo por ruta entre dos puntos (planta → obra).
 * Usa OSRM (motor de rutas de OpenStreetMap). El tiempo del auto se multiplica
 * por FACTOR_MIXER. Si el servicio no responde, estima con la línea recta.
 * ?desde=lat,lng&hasta=lat,lng
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const [aLat, aLng] = (searchParams.get("desde") || "").split(",").map(Number)
  const [bLat, bLng] = (searchParams.get("hasta") || "").split(",").map(Number)
  if ([aLat, aLng, bLat, bLng].some((n) => !Number.isFinite(n))) {
    return NextResponse.json({ error: "Faltan coordenadas" }, { status: 400 })
  }
  const recta = distanciaKm({ lat: aLat, lng: aLng }, { lat: bLat, lng: bLng })
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${aLng},${aLat};${bLng},${bLat}?overview=false`
    const r = await fetch(url, { headers: { "User-Agent": "RebucretProduccion/1.0" }, next: { revalidate: 86400 } })
    const d = await r.json()
    const ruta = d?.routes?.[0]
    if (!ruta) throw new Error("sin ruta")
    return NextResponse.json({
      km: Math.round((ruta.distance / 1000) * 10) / 10,
      minutos: Math.max(5, Math.round((ruta.duration / 60) * FACTOR_MIXER)),
      fuente: "ruta",
    })
  } catch {
    return NextResponse.json({ km: Math.round(recta * 1.35 * 10) / 10, minutos: minutosEstimados(recta), fuente: "estimado" })
  }
}
