/**
 * Posición actual de los camiones cruzada con nuestros datos (sacado de /api/gps/posiciones, sin cambiar nada):
 * unidad del GPS ↔ mixer (por gps_unit_id o patente), planta más cercana, estado (lib/gps-vivo.ts) y el último despacho
 * de hoy. Lo usan la ruta de posiciones (Logística, Despacho) y el mail del armado ("dónde amanecen"). Solo servidor.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { posiciones } from "@/lib/wialon"
import { distanciaKm, minutosEstimados } from "@/lib/geo"
import { estadoGps } from "@/lib/gps-vivo"

export type CamionGps = {
  unidad_id: number | string
  patente: string
  mixer_id: string | null
  lat: number | null
  lng: number | null
  velocidad: number | null
  rumbo: number | null
  ultima_posicion: string | null
  motor: any
  satelites: any
  estado: string
  probable_obra: boolean
  planta_id: string | null
  planta_cercana: { id: string; nombre: string; km: number } | null
  minutos_a_planta: number | null
  minutos_a_obra: number | null
  despacho: { id: string; remito: any; m3: any; salida: string; minutos_desde_salida: number | null; cliente: string | null; obra: { id: string; nombre: string; lat: number | null; lng: number | null } | null } | null
}

/** 00:00 de hoy en Argentina (UTC−3 fijo), como ISO */
export function inicioHoyAR(ahora: number) {
  const fecha = new Date(ahora - 3 * 3600_000).toISOString().slice(0, 10)
  return new Date(`${fecha}T00:00:00-03:00`).toISOString()
}

/**
 * `soloLectura`: no guarda el vínculo patente ↔ unidad (modo prueba local, mail en el preview).
 * Devuelve además, aparte de la respuesta de siempre, la planta del último despacho de hoy de cada camión.
 */
export async function leerPosicionesCamiones(sb: SupabaseClient, opts: { soloLectura?: boolean } = {}): Promise<{ conectado: boolean; actualizado?: string; camiones: CamionGps[]; plantaUltimoDespacho: Record<string, string | null> }> {
  const soloLectura = !!opts.soloLectura
  const unidades = await posiciones()
  if (!unidades) return { conectado: false, camiones: [], plantaUltimoDespacho: {} }

  // "Hoy" es el día de Argentina (el servidor corre en UTC: a las 22:00 de Argentina ya es mañana en UTC)
  const inicio = inicioHoyAR(Date.now())
  const [{ data: plantas }, { data: mixers }, { data: despachos }] = await Promise.all([
    sb.from("plants").select("id, name, gps_lat, gps_lng"),
    sb.from("mixers").select("id, license_plate, gps_unit_id"),
    sb
      .from("dispatches")
      .select("id, mixer_id, remito, quantity_m3, dispatch_date, created_at, plant_id, clients(name), construction_sites(id, name, gps_lat, gps_lng, travel_time_minutes)")
      // Fase 3: por la hora de salida ("Salió a las", que se puede corregir), no por la de carga en el sistema
      .gte("dispatch_date", inicio)
      .order("dispatch_date", { ascending: false }),
  ])

  const norm = (p: string) => (p || "").toUpperCase().replace(/[^A-Z0-9]/g, "")
  const ahora = Date.now()

  const camiones = unidades.map((u) => {
    const mixer = (mixers || []).find((m) => m.gps_unit_id === u.id || norm(m.license_plate) === norm(u.nombre))
    // Guardar el vínculo patente ↔ unidad la primera vez (lo hace el servidor; en el modo prueba local, no)
    if (mixer && !mixer.gps_unit_id && !soloLectura) sb.from("mixers").update({ gps_unit_id: u.id }).eq("id", mixer.id).then(() => {})

    const pos = u.lat != null && u.lng != null ? { lat: u.lat, lng: u.lng } : null
    const plantaCerca = pos
      ? (plantas || [])
          .filter((p) => p.gps_lat != null)
          .map((p) => ({ p, km: distanciaKm(pos, { lat: Number(p.gps_lat), lng: Number(p.gps_lng) }) }))
          .sort((a, b) => a.km - b.km)[0]
      : null
    // El último que ya salió (un despacho manual de hoy con hora 12:00 todavía no salió)
    const despacho = mixer ? (despachos || []).find((d: any) => d.mixer_id === mixer.id && new Date(d.dispatch_date).getTime() <= ahora) : null
    const obra: any = despacho?.construction_sites || null
    const obraPos = obra?.gps_lat != null ? { lat: Number(obra.gps_lat), lng: Number(obra.gps_lng) } : null
    const kmObra = pos && obraPos ? distanciaKm(pos, obraPos) : null
    const kmPlanta = plantaCerca?.km ?? null
    const minutosDesdeSalida = despacho ? Math.round((ahora - new Date(despacho.dispatch_date).getTime()) / 60000) : null

    // Reglas en lib/gps-vivo.ts (probadas): radios de planta y obra, y en movimiento el rumbo si la obra está ubicada
    const estado = estadoGps({
      pos, t: u.t, velocidad: u.velocidad, rumbo: u.rumbo, kmPlanta,
      plantaPos: plantaCerca ? { lat: Number(plantaCerca.p.gps_lat), lng: Number(plantaCerca.p.gps_lng) } : null,
      conDespacho: !!despacho, obraPos, minutosDesdeSalida, idaMin: obra?.travel_time_minutes || 30, ahora,
    })

    // Fase 3: parado fuera de planta con remito de hoy y la obra sin ubicar = probable obra
    const probableObra = estado === "detenido" && !!despacho && !obraPos
    const plantaId = estado === "en_planta" && plantaCerca ? plantaCerca.p.id : null

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
      satelites: u.satelites,
      estado,
      probable_obra: probableObra,
      planta_id: plantaId,
      planta_cercana: plantaCerca ? { id: plantaCerca.p.id, nombre: plantaCerca.p.name, km: Math.round(plantaCerca.km * 10) / 10 } : null,
      minutos_a_planta: kmPlanta != null && estado !== "en_planta" ? minutosEstimados(kmPlanta) : null,
      minutos_a_obra: kmObra != null && estado === "hacia_obra" ? minutosEstimados(kmObra) : null,
      despacho: despacho
        ? {
            id: despacho.id,
            remito: despacho.remito,
            m3: despacho.quantity_m3,
            salida: despacho.dispatch_date,
            minutos_desde_salida: minutosDesdeSalida,
            cliente: (despacho as any).clients?.name || null,
            obra: obra ? { id: obra.id, nombre: obra.name, lat: obraPos?.lat ?? null, lng: obraPos?.lng ?? null } : null,
          }
        : null,
    }
  })

  const plantaUltimoDespacho: Record<string, string | null> = {}
  for (const m of mixers || []) {
    const d = (despachos || []).find((x: any) => x.mixer_id === m.id && new Date(x.dispatch_date).getTime() <= ahora)
    if (d) plantaUltimoDespacho[m.id] = (d as any).plant_id || null
  }
  return { conectado: true, actualizado: new Date().toISOString(), camiones: camiones as CamionGps[], plantaUltimoDespacho }
}
