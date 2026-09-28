import { NextResponse } from "next/server"
import { posiciones, sbAdmin } from "@/lib/wialon"
import { distanciaKm, minutosEstimados } from "@/lib/geo"

export const dynamic = "force-dynamic"

/** Radio para considerar que un camión está "en planta" (las geocercas de Wialon son de ~50 m). */
const RADIO_PLANTA_KM = 0.25
/** Radio para considerar que está "en la obra" a la que va. */
const RADIO_OBRA_KM = 0.4

/**
 * Posición actual de los mixers, cruzada con nuestros datos:
 * patente → mixer, último despacho del día (obra, remito, hora de salida) y un estado simple.
 */
export async function GET() {
  try {
    const unidades = await posiciones()
    if (!unidades) return NextResponse.json({ conectado: false, camiones: [] })

    const sb = sbAdmin()
    const hoy = new Date()
    const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).toISOString()
    const [{ data: plantas }, { data: mixers }, { data: despachos }] = await Promise.all([
      sb.from("plants").select("id, name, gps_lat, gps_lng"),
      sb.from("mixers").select("id, license_plate, gps_unit_id"),
      sb
        .from("dispatches")
        .select("id, mixer_id, remito, quantity_m3, dispatch_date, created_at, plant_id, clients(name), construction_sites(id, name, gps_lat, gps_lng, travel_time_minutes)")
        .gte("created_at", inicio)
        .order("created_at", { ascending: false }),
    ])

    const norm = (p: string) => (p || "").toUpperCase().replace(/[^A-Z0-9]/g, "")
    const ahora = Date.now()

    const camiones = unidades.map((u) => {
      const mixer = (mixers || []).find((m) => m.gps_unit_id === u.id || norm(m.license_plate) === norm(u.nombre))
      // Guardar el vínculo patente ↔ unidad la primera vez
      if (mixer && !mixer.gps_unit_id) sb.from("mixers").update({ gps_unit_id: u.id }).eq("id", mixer.id).then(() => {})

      const pos = u.lat != null && u.lng != null ? { lat: u.lat, lng: u.lng } : null
      const plantaCerca = pos
        ? (plantas || [])
            .filter((p) => p.gps_lat != null)
            .map((p) => ({ p, km: distanciaKm(pos, { lat: Number(p.gps_lat), lng: Number(p.gps_lng) }) }))
            .sort((a, b) => a.km - b.km)[0]
        : null
      const despacho = mixer ? (despachos || []).find((d: any) => d.mixer_id === mixer.id) : null
      const obra: any = despacho?.construction_sites || null
      const obraPos = obra?.gps_lat != null ? { lat: Number(obra.gps_lat), lng: Number(obra.gps_lng) } : null
      const kmObra = pos && obraPos ? distanciaKm(pos, obraPos) : null
      const kmPlanta = plantaCerca?.km ?? null
      const enMovimiento = (u.velocidad || 0) > 5
      const minutosDesdeSalida = despacho ? Math.round((ahora - new Date(despacho.created_at).getTime()) / 60000) : null

      let estado: "en_planta" | "hacia_obra" | "en_obra" | "volviendo" | "detenido" | "sin_senal" = "detenido"
      if (!pos || (u.t && ahora - u.t > 3 * 60 * 60 * 1000)) estado = "sin_senal"
      else if (kmPlanta != null && kmPlanta <= RADIO_PLANTA_KM) estado = "en_planta"
      else if (kmObra != null && kmObra <= RADIO_OBRA_KM) estado = "en_obra"
      else if (despacho && enMovimiento) {
        // Si ya estuvo más tiempo afuera que la ida estimada y se acerca a la planta, está volviendo
        const ida = obra?.travel_time_minutes || 30
        estado = minutosDesdeSalida != null && minutosDesdeSalida > ida + 15 ? "volviendo" : "hacia_obra"
      }

      return {
        unidad_id: u.id,
        patente: u.nombre,
        mixer_id: mixer?.id || null,
        lat: u.lat,
        lng: u.lng,
        velocidad: u.velocidad,
        rumbo: u.rumbo,
        ultima_posicion: u.t ? new Date(u.t).toISOString() : null,
        motor: u.motor,
        estado,
        planta_cercana: plantaCerca ? { nombre: plantaCerca.p.name, km: Math.round(plantaCerca.km * 10) / 10 } : null,
        minutos_a_planta: kmPlanta != null && estado !== "en_planta" ? minutosEstimados(kmPlanta) : null,
        minutos_a_obra: kmObra != null && estado === "hacia_obra" ? minutosEstimados(kmObra) : null,
        despacho: despacho
          ? {
              id: despacho.id,
              remito: despacho.remito,
              m3: despacho.quantity_m3,
              salida: despacho.created_at,
              minutos_desde_salida: minutosDesdeSalida,
              cliente: (despacho as any).clients?.name || null,
              obra: obra ? { id: obra.id, nombre: obra.name, lat: obraPos?.lat ?? null, lng: obraPos?.lng ?? null } : null,
            }
          : null,
      }
    })

    return NextResponse.json({ conectado: true, actualizado: new Date().toISOString(), camiones })
  } catch (e: any) {
    return NextResponse.json({ conectado: true, error: e?.message || "Error consultando el GPS", camiones: [] }, { status: 502 })
  }
}
