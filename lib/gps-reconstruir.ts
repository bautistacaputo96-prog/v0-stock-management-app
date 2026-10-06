/**
 * Fase 4a · Proceso de reconstrucción (servidor): baja los mensajes de Wialon de los mixers para un rango de días,
 * arma los viajes, los cruza con los despachos, aprende ubicaciones de obras y reemplaza los viajes en viajes_gps.
 *
 * Escribe solo en viajes_gps y en construction_sites.gps_* (ubicación aprendida, nunca sobre una cargada a mano).
 * Lo usan /api/gps/reconstruir (cron diario) y la carga histórica.
 */
import { sbAdmin, abrirSesion, cerrarSesion, unidades, mensajesIntervalo } from "@/lib/wialon"
import {
  aFila,
  cruzarConDespachos,
  distanciaKm,
  fechaAR,
  guardarViajesCamion,
  inicioDiaAR,
  mensajesDesdeWialon,
  paradasParaAprender,
  reconstruirViajes,
  sePuedeAprender,
  sumarDias,
  todasLasFilas,
  ubicacionAprendida,
  type DespachoCruce,
  type LatLng,
  type ViajeGps,
  type ViajeGpsFila,
} from "@/lib/gps-viajes"

/** Horas antes y después del rango que se piden a Wialon (para ver la llegada previa a planta y viajes que cruzan la medianoche). */
const MARGEN_H = 6
/** Si la ubicación aprendida se mueve menos que esto, no se vuelve a escribir. */
const MOVIMIENTO_MIN_KM = 0.03

export type InformeReconstruccion = {
  desde: string
  hasta: string
  camiones: {
    patente: string
    unidad: number | null
    viajes: number
    conRemito: number
    sinRemito: number
    remitosSinViaje: number
    incompletos: number
    error?: string
  }[]
  aprendidas: { obra_id: string; lat: number; lng: number; viajes: number }[]
  guardados: number
  /** Modo simulación: no se escribió nada; se devuelven los viajes que se habrían guardado. */
  simulado?: boolean
  filas?: ViajeGpsFila[]
  ms: number
}

const norm = (p: string) => (p || "").toUpperCase().replace(/[^A-Z0-9]/g, "")

export async function reconstruirRango(
  desde: string,
  hasta: string,
  opciones: { simular?: boolean } = {},
): Promise<InformeReconstruccion> {
  const t0 = Date.now()
  const sb = sbAdmin()
  const simular = !!opciones.simular
  const informe: InformeReconstruccion = { desde, hasta, camiones: [], aprendidas: [], guardados: 0, ms: 0 }
  if (simular) { informe.simulado = true; informe.filas = [] }

  const [{ data: plantasDb, error: e1 }, { data: mixers, error: e2 }] = await Promise.all([
    sb.from("plants").select("id, gps_lat, gps_lng"),
    sb.from("mixers").select("id, license_plate, gps_unit_id"),
  ])
  if (e1 || e2) throw e1 || e2
  const plantas = (plantasDb || [])
    .filter((p: any) => p.gps_lat != null && p.gps_lng != null)
    .map((p: any) => ({ id: p.id as string, lat: Number(p.gps_lat), lng: Number(p.gps_lng) }))
  if (plantas.length === 0) throw new Error("Las plantas no tienen coordenadas")

  // 1. Mensajes y viajes por camión (secuencial, sesión propia)
  const desdeT = inicioDiaAR(desde) - MARGEN_H * 3600
  const hastaT = inicioDiaAR(sumarDias(hasta, 1)) + MARGEN_H * 3600
  const viajesPorMixer = new Map<string, ViajeGps[]>()
  const sid = await abrirSesion()
  if (!sid) throw new Error("El GPS no está conectado")
  try {
    const us = await unidades(sid)
    for (const m of mixers || []) {
      const u = us.find((x) => String(x.id) === String(m.gps_unit_id)) || us.find((x) => norm(x.nombre) === norm(m.license_plate))
      const fila = { patente: m.license_plate as string, unidad: u?.id ?? null, viajes: 0, conRemito: 0, sinRemito: 0, remitosSinViaje: 0, incompletos: 0 } as InformeReconstruccion["camiones"][number]
      informe.camiones.push(fila)
      if (!u) { fila.error = "Sin unidad en el GPS"; continue }
      try {
        const raw = await mensajesIntervalo(sid, u.id, desdeT, Math.min(hastaT, Math.floor(Date.now() / 1000)))
        const vs = reconstruirViajes(mensajesDesdeWialon(raw), plantas, { unidad: String(u.id) }).filter(
          (v) => v.fecha >= desde && v.fecha <= hasta,
        )
        viajesPorMixer.set(m.id, vs)
      } catch (e: any) {
        fila.error = e?.message || "Error leyendo el GPS"
      }
    }
  } finally {
    await cerrarSesion(sid)
  }

  // 2. Despachos del rango (con camión, sin los despachos por árido) y obras
  const desp: any[] = await todasLasFilas((a, b) =>
    sb
      .from("dispatches")
      .select("id, dispatch_date, created_at, remito, plant_id, mixer_id, construction_site_id, quantity_m3")
      .not("mixer_id", "is", null)
      .not("is_test_dispatch", "is", true)
      .gt("quantity_m3", 0)
      .gte("dispatch_date", new Date(inicioDiaAR(desde) * 1000).toISOString())
      .lt("dispatch_date", new Date(inicioDiaAR(sumarDias(hasta, 1)) * 1000).toISOString())
      .order("dispatch_date")
      .order("id")
      .range(a, b),
  )
  const obrasDb: any[] = await todasLasFilas((a, b) => sb.from("construction_sites").select("id, gps_lat, gps_lng, gps_source").order("id").range(a, b))
  const obras = new Map<string, { gps_lat: number | null; gps_lng: number | null; gps_source: string | null }>(
    obrasDb.map((o: any) => [o.id, { gps_lat: o.gps_lat == null ? null : Number(o.gps_lat), gps_lng: o.gps_lng == null ? null : Number(o.gps_lng), gps_source: o.gps_source }]),
  )
  const posObra = (id: string | null): LatLng | null => {
    const o = id ? obras.get(id) : null
    return o && o.gps_lat != null && o.gps_lng != null ? { lat: o.gps_lat, lng: o.gps_lng } : null
  }

  const cruzarTodo = () => {
    const ubicadas = [...obras.entries()].filter(([, o]) => o.gps_lat != null && o.gps_lng != null).map(([id, o]) => ({ id, lat: o.gps_lat!, lng: o.gps_lng! }))
    const res = new Map<string, { filas: ViajeGpsFila[]; sinViaje: number }>()
    for (const [mixerId, vs] of viajesPorMixer) {
      const filas: ViajeGpsFila[] = []
      let sinViaje = 0
      const dias = new Set([...vs.map((v) => v.fecha), ...desp.filter((d: any) => d.mixer_id === mixerId).map((d: any) => fechaAR(d.dispatch_date))])
      for (const dia of dias) {
        const ds: DespachoCruce[] = desp
          .filter((d: any) => d.mixer_id === mixerId && fechaAR(d.dispatch_date) === dia)
          .map((d: any) => ({
            id: d.id,
            hora: new Date(d.dispatch_date).toISOString(),
            creado: d.created_at,
            remito: d.remito,
            plant_id: d.plant_id,
            construction_site_id: d.construction_site_id,
            obra: posObra(d.construction_site_id),
          }))
        const r = cruzarConDespachos(vs.filter((v) => v.fecha === dia), ds, ubicadas)
        filas.push(...r.viajes.map((v) => aFila(v, mixerId)))
        sinViaje += r.remitosSinViaje.length
      }
      res.set(mixerId, { filas, sinViaje })
    }
    return res
  }

  // 3. Primer cruce
  let cruce = cruzarTodo()

  // 4. Ubicaciones aprendidas (ver paradasParaAprender y ubicacionAprendida): obras con viajes en este rango
  //    que no tengan una ubicación cargada a mano. Se junta el historial de esas obras fuera del rango.
  const filasPorObra = new Map<string, ViajeGpsFila[]>()
  for (const { filas } of cruce.values()) {
    for (const f of filas) {
      if (!f.construction_site_id || !f.dispatch_id) continue
      const o = obras.get(f.construction_site_id)
      if (!o || !sePuedeAprender(o)) continue
      const arr = filasPorObra.get(f.construction_site_id) || []
      arr.push(f)
      filasPorObra.set(f.construction_site_id, arr)
    }
  }
  if (filasPorObra.size > 0) {
    const ids = [...filasPorObra.keys()]
    let hist: any[] = []
    try {
      hist = await todasLasFilas((a, b) =>
        sb
          .from("viajes_gps")
          .select("id, construction_site_id, dispatch_id, parada_lat, parada_lng, confianza, fecha")
          .in("construction_site_id", ids)
          .not("dispatch_id", "is", null)
          .not("parada_lat", "is", null)
          .or(`fecha.lt.${desde},fecha.gt.${hasta}`)
          .order("id")
          .range(a, b),
      )
    } catch (e) {
      if (!simular) throw e // en simulación la tabla puede no existir todavía
    }
    for (const id of ids) {
      const o = obras.get(id)!
      const puntos = paradasParaAprender(o, [...filasPorObra.get(id)!, ...hist.filter((h: any) => h.construction_site_id === id)])
      const u = ubicacionAprendida(puntos)
      if (!u) continue // sin consenso (≥3 paradas, ≥2 días, mayoría): no se toca nada
      const actual = posObra(id)
      if (actual && distanciaKm(actual, u) < MOVIMIENTO_MIN_KM) continue
      const lat = Math.round(u.lat * 1e7) / 1e7, lng = Math.round(u.lng * 1e7) / 1e7
      if (simular) {
        obras.set(id, { gps_lat: lat, gps_lng: lng, gps_source: "gps_aprendido" })
        informe.aprendidas.push({ obra_id: id, lat, lng, viajes: u.viajes })
        continue
      }
      const { data: upd, error: e6 } = await sb
        .from("construction_sites")
        .update({ gps_lat: lat, gps_lng: lng, gps_source: "gps_aprendido", gps_updated_at: new Date().toISOString() })
        .eq("id", id)
        .or("gps_lat.is.null,gps_source.eq.gps_aprendido") // nunca pisa una cargada a mano
        .select("id")
      if (e6) throw e6
      if (upd && upd.length) {
        obras.set(id, { gps_lat: lat, gps_lng: lng, gps_source: "gps_aprendido" })
        informe.aprendidas.push({ obra_id: id, lat, lng, viajes: u.viajes })
      }
    }
    // 5. Segundo cruce con las ubicaciones nuevas (confirma por distancia y ordena tandas)
    if (informe.aprendidas.length) cruce = cruzarTodo()
  }

  // 6. Guardar por camión: upsert y después borrar lo que quedó sin tocar (ver guardarViajesCamion).
  //    Si un camión falla, se informa y se sigue con los demás; sus viajes anteriores quedan como estaban.
  const ahora = new Date().toISOString()
  for (const [mixerId, { filas, sinViaje }] of cruce) {
    const m = (mixers || []).find((x: any) => x.id === mixerId)
    const fila = informe.camiones.find((c) => c.patente === m?.license_plate)
    if (simular) informe.filas!.push(...filas)
    else {
      try {
        await guardarViajesCamion(sb, mixerId, filas, desde, hasta, ahora)
        informe.guardados += filas.length
      } catch (e: any) {
        if (fila) fila.error = `No se pudo guardar: ${e?.message || "error"}`
        continue
      }
    }
    if (fila) {
      fila.viajes = filas.length
      fila.conRemito = filas.filter((f) => f.dispatch_id).length
      fila.sinRemito = filas.filter((f) => !f.dispatch_id).length
      fila.incompletos = filas.filter((f) => f.estado === "incompleto").length
      fila.remitosSinViaje = sinViaje
    }
  }

  informe.ms = Date.now() - t0
  return informe
}
