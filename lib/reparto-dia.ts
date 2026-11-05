/**
 * La carga y el armado del día (docs/specs/2026-11-05-dia-unificado-y-mail.md, 3.6).
 *
 * Lo que hacía el hook useRepartoDia, sin React: `leerDatosDia` (las consultas, con los límites del día en hora de
 * Argentina) y `armarVistaDia` (puro: sugerencia, reparto vigente, resultado, filas, avisos). Es la única carga del día:
 * la usan la pantalla, el mail y el resumen para el WhatsApp de Concretus, así los tres dicen lo mismo.
 */
import { parametrosDePlanta } from "@/lib/planificador"
import { cargarViajes, conTiemposGps, parametrosConGps, viajeMinDe, descargaDe, type PedidoParaViajes, type ViajeRow } from "@/lib/viajes"
import { cargarTiemposGps, type TiemposGps } from "@/lib/gps-viajes"
import {
  armarDia, dondeDuermen, repartoDe, avisosEdicion, avisosSuperposicion, viajesDia, trasladoDe, cargarReparto,
  cargarTraslado, nombreVisible, filasPedidos, resumenNumeros, mismoReparto,
  type PlantaReparto, type CamionReparto, type Reparto, type PedidoReparto, type ContextoReparto, type RepartoGuardado,
  type FilaTraslado, type Aviso, type ViajeDia, type EntradaDia, type ResultadoDia, type Noche, type FilaPedido,
} from "@/lib/reparto"

const DIA_MS = 24 * 3600_000

/** Pedidos con lo que muestran la tabla y el detalle (cliente, fórmula, obra) */
export const SELECT_PEDIDOS_DIA = "*, clients(name), formulas(code), construction_sites(id, name, travel_time_minutes, gps_lat, requires_pump)"

export type MixerDia = { id: string; license_plate: string; capacity_m3: number | null; active: boolean | null; status: string | null }
export type PedidoDia = Omit<PedidoParaViajes, "construction_sites"> & {
  construction_sites?: { id?: string; name?: string | null; travel_time_minutes?: number | null; requires_pump?: boolean | null; gps_lat?: number | null } | null
  clients?: { name?: string | null } | null
  formulas?: { code?: string | null } | null
  created_by?: string | null
  confirmado_at?: string | null
  confirmado_por?: string | null
  suspendido_at?: string | null
  suspendido_motivo_tipo?: string | null
  finalidad?: string | null
  bomba_la_pone?: "rebucret" | "cliente" | null
  bomba_empresa_id?: string | null
  bomba_hora?: string | null
}
export type AjustesPedidos = Record<string, { hora?: string; metodo?: "bomba" | "directo" }>

export type DatosDia = {
  fecha: string
  /** 00:00 del día en Argentina (ms) */
  base: number
  plants: { id: string; name: string }[]
  plantRows: any[]
  mixers: MixerDia[]
  pedidosHoy: PedidoDia[]
  pedidosManana: PedidoDia[]
  viajes: Record<string, ViajeRow[]>
  tiempos: TiemposGps | null
  guardado: RepartoGuardado
  ayer: RepartoGuardado
  traslado: { disponible: boolean; fila: FilaTraslado | null }
  /** Fase B: dónde amanece cada camión según la toma del GPS (amanecer_camiones); null sin la tabla */
  amanecer?: AmanecerFila[] | null
  /** Fase B: estado del mail del armado de esta fecha (armado_mail); null sin la tabla o sin fila */
  armadoMail?: Record<string, any> | null
  /** Despachos de los pedidos del día (los hechos, con su hora real); null sin leer */
  despachos?: DespachoDia[] | null
  /** Horas del GPS de esos despachos (viajes_gps) */
  gpsDespachos?: { dispatch_id: string; salida_planta: string | null; llegada_obra: string | null; salida_obra: string | null; llegada_planta: string | null }[] | null
  /** Cuándo se leyó (para que el día de hoy arranque desde ahora) */
  leidoAt?: number
}

export type DespachoDia = { id: string; scheduled_dispatch_id: string | null; mixer_id: string | null; quantity_m3: number; dispatch_date: string; plant_id: string | null; is_test_dispatch?: boolean | null }

/** Una fila de amanecer_camiones */
export type AmanecerFila = { mixer_id: string; plant_id: string | null; fuente: string; texto: string; tomado_at: string }

/** Tablas de la fase B (si la migración no está aplicada: null, y todo sigue como antes) */
async function leerOpcional(q: PromiseLike<{ data: any; error: any }>) {
  try { const { data, error } = await q; return error ? null : data } catch { return null }
}

/** yyyy-mm-dd ± días (sin depender de la hora del equipo) */
export function sumarDias(fecha: string, n: number) {
  return new Date(Date.parse(`${fecha}T12:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10)
}
/** Desde y hasta del día (y del siguiente) en hora de Argentina, como ISO */
export function limitesDia(fecha: string) {
  const ini = Date.parse(`${fecha}T00:00:00-03:00`)
  const iso = (t: number) => new Date(t).toISOString()
  return { base: ini, ini: iso(ini), fin: iso(ini + DIA_MS), fin2: iso(ini + 2 * DIA_MS) }
}
/** La hora "HH:MM" del día `fecha` en Argentina, como ISO */
export const isoDelDia = (fecha: string, hora: string) => new Date(`${fecha}T${hora}:00-03:00`).toISOString()

/** Lee todo lo que hace falta para armar el día `fecha` (yyyy-mm-dd) de las plantas dadas. */
export async function leerDatosDia(sb: any, fecha: string, plants: { id: string; name: string }[]): Promise<DatosDia> {
  const { base, ini, fin, fin2 } = limitesDia(fecha)
  const plantIds = plants.map((p) => p.id)
  const [{ data: pls }, { data: ms }, { data: ph }, { data: pm }, tiempos, guardado, ayer, traslado] = await Promise.all([
    sb.from("plants").select("*").in("id", plantIds),
    sb.from("mixers").select("id, license_plate, capacity_m3, active, status").eq("active", true).order("license_plate"),
    sb.from("scheduled_dispatches").select(SELECT_PEDIDOS_DIA).in("plant_id", plantIds).gte("scheduled_arrival_time", ini).lt("scheduled_arrival_time", fin).neq("status", "cancelled").order("scheduled_arrival_time"),
    sb.from("scheduled_dispatches").select(SELECT_PEDIDOS_DIA).in("plant_id", plantIds).gte("scheduled_arrival_time", fin).lt("scheduled_arrival_time", fin2).neq("status", "cancelled"),
    cargarTiemposGps(sb),
    cargarReparto(sb, fecha),
    cargarReparto(sb, sumarDias(fecha, -1)),
    plantIds.length === 2 ? cargarTraslado(sb, plantIds[0], plantIds[1]) : Promise.resolve({ disponible: false, fila: null }),
  ])
  const pedidosHoy = ((ph as any[]) || []) as PedidoDia[], pedidosManana = ((pm as any[]) || []) as PedidoDia[]
  const idsHoy = pedidosHoy.map((p) => p.id)
  const [viajes, amanecer, armadoMail, despachos] = await Promise.all([
    cargarViajes(sb, [...pedidosHoy, ...pedidosManana].map((p) => p.id)),
    leerOpcional(sb.from("amanecer_camiones").select("mixer_id, plant_id, fuente, texto, tomado_at").eq("fecha", fecha)),
    leerOpcional(sb.from("armado_mail").select("*").eq("fecha", fecha).maybeSingle()),
    idsHoy.length ? leerOpcional(sb.from("dispatches").select("*").in("scheduled_dispatch_id", idsHoy)) : Promise.resolve([]),
  ])
  const ds = ((despachos as any[]) || []).map((d) => ({ id: d.id, scheduled_dispatch_id: d.scheduled_dispatch_id, mixer_id: d.mixer_id, quantity_m3: Number(d.quantity_m3), dispatch_date: d.dispatch_date, plant_id: d.plant_id, is_test_dispatch: d.is_test_dispatch ?? null })) as DespachoDia[]
  const gpsDespachos = ds.length ? await leerOpcional(sb.from("viajes_gps").select("dispatch_id, salida_planta, llegada_obra, salida_obra, llegada_planta").in("dispatch_id", ds.map((d) => d.id))) : []
  return {
    fecha, base, plants, plantRows: (pls as any[]) || [], mixers: ((ms as any[]) || []) as MixerDia[], pedidosHoy, pedidosManana, viajes, tiempos, guardado, ayer, traslado,
    amanecer: (amanecer as AmanecerFila[] | null) || null, armadoMail: armadoMail || null, despachos: ds, gpsDespachos: (gpsDespachos as any[]) || [], leidoAt: Date.now(),
  }
}

/** Pedidos pendientes con viajes pendientes ajustados a mano en el gerenciador (origen "gerenciador") */
export function pedidosManuales(d: Pick<DatosDia, "pedidosHoy" | "viajes">): string[] {
  return d.pedidosHoy
    .filter((p) => p.status !== "completed" && p.status !== "cancelled" && (d.viajes[p.id] || []).some((v) => v.estado === "planificado" && v.origen === "gerenciador"))
    .map((p) => p.id)
}

/**
 * Los viajes del pedido con los ya despachados (los hechos) en su hora real: la salida del GPS (viajes_gps) o, si no
 * está, la hora de salida del despacho ("Salió a las"); la llegada, el fin y la vuelta del GPS o, si no, con los tiempos
 * del pedido. Un despacho que ya tiene su viaje (dispatch_id) lo actualiza; si no, se suma como viaje despachado.
 * Los despachos por árido (is_test_dispatch) no son viajes de hormigón y no cuentan.
 */
export function conHechos(p: PedidoDia, existentes: ViajeRow[], d: Pick<DatosDia, "despachos" | "gpsDespachos">, prm: import("@/lib/planificador").Parametros): ViajeRow[] {
  const ds = (d.despachos || []).filter((x) => x.scheduled_dispatch_id === p.id && !x.is_test_dispatch).sort((a, b) => Date.parse(a.dispatch_date) - Date.parse(b.dispatch_date))
  if (!ds.length) return existentes
  const MIN = 60_000
  const iso = (t: number) => new Date(t).toISOString()
  const out = existentes.map((v) => ({ ...v }))
  const usados = new Set(out.filter((v) => v.estado !== "planificado").map((v) => v.n))
  let libre = 1
  for (const x of ds) {
    const g = (d.gpsDespachos || []).find((y) => y.dispatch_id === x.id)
    const ida = viajeMinDe(p) * MIN
    const salida = Date.parse(g?.salida_planta || x.dispatch_date)
    const llegada = g?.llegada_obra ? Date.parse(g.llegada_obra) : salida + ida
    const fin = g?.salida_obra ? Date.parse(g.salida_obra) : llegada + descargaDe(p, Number(x.quantity_m3) || 8, prm) * MIN
    const vuelta = g?.llegada_planta ? Date.parse(g.llegada_planta) : fin + (prm.lavadoMin * MIN) + ida
    const horas = { hora_carga: iso(salida - prm.cargaMin * MIN), hora_salida: iso(salida), hora_llegada: iso(llegada), hora_fin_descarga: iso(fin), hora_vuelta: iso(Math.max(vuelta, fin)) }
    const ligado = out.find((v) => v.dispatch_id === x.id)
    if (ligado) Object.assign(ligado, horas, { estado: "despachado", mixer_id: ligado.mixer_id ?? x.mixer_id })
    else {
      while (usados.has(libre)) libre++
      usados.add(libre)
      out.push({ pedido_id: p.id, plant_id: p.plant_id, n: libre, m3: Number(x.quantity_m3), ...horas, mixer_id: x.mixer_id, estado: "despachado", dispatch_id: x.id })
    }
  }
  return out
}

/** El pedido con la hora y el método cambiados en la pantalla (sin guardar) */
export function aplicarAjustes<P extends PedidoDia>(p: P, a: AjustesPedidos[string] | undefined, fecha: string): P {
  if (!a) return p
  return {
    ...p,
    ...(a.hora ? { scheduled_arrival_time: isoDelDia(fecha, a.hora) } : {}),
    ...(a.metodo ? { metodo_descarga: a.metodo } : {}),
  }
}

export type VistaDia = {
  fecha: string
  base: number
  plantas: PlantaReparto[]
  nombres: Record<string, string>
  patentes: Record<string, string>
  traslado: ReturnType<typeof trasladoDe>
  amanece: Record<string, string | null>
  /** De dónde sale el "durmió en" de cada camión */
  fuenteAmanece: Record<string, "gps" | "reparto" | null>
  delDia: MixerDia[]
  camiones: CamionReparto[]
  noSalen: Set<string>
  /** Los pedidos del día con los ajustes de la pantalla (también los completados) */
  pedidos: PedidoDia[]
  entrada: EntradaDia
  sugerencia: ResultadoDia
  noche: Noche
  sugerido: Reparto
  efectivo: Reparto | null
  vigente: Reparto
  /** Lo que se ve es lo que se guarda: el motor con el reparto vigente */
  resultado: ResultadoDia
  referencia: ViajeDia[]
  avisos: Aviso[]
  contexto: ContextoReparto
  filas: FilaPedido[]
  numeros: string
  obraDe: (pedidoId: string) => string
  /** Pedidos con viajes ajustados a mano (gerenciador) */
  manuales: string[]
  /** ¿Se armó rearmando también los manuales? */
  rearmaManuales: boolean
}

/**
 * Arma el día (puro). `edicion` = el reparto que se está editando; `ajustes` = horas y métodos cambiados sin guardar;
 * `ruta` = la ruta del mapa entre las plantas (respaldo del traslado); `amanece` = dónde arranca cada camión (si no
 * viene, donde durmió según el reparto del día anterior).
 */
export function armarVistaDia(d: DatosDia, opts: { ajustes?: AjustesPedidos; edicion?: Reparto | null; ruta?: { minutos: number; km: number } | null; amanece?: Record<string, string | null>; rearmarManuales?: boolean; ahora?: number } = {}): VistaDia {
  const { fecha, base } = d
  const plantas: PlantaReparto[] = d.plants.map((p) => {
    const row = d.plantRows.find((x) => x.id === p.id)
    return { id: p.id, nombre: p.name, prm: parametrosConGps(parametrosDePlanta(row), p.id, d.tiempos) }
  })
  const nombres = Object.fromEntries(plantas.map((p) => [p.id, p.nombre]))
  const patentes = Object.fromEntries(d.mixers.map((m) => [m.id, m.license_plate]))
  const traslado = trasladoDe(d.traslado.fila, opts.ruta || null)
  // Dónde arranca cada camión (4.3): lo que se pase (GPS en el momento) > la toma del GPS guardada > dónde duerme según
  // el reparto del día anterior > a confirmar
  const tomado = (id: string) => d.amanecer?.find((a) => a.mixer_id === id)
  const amanece: Record<string, string | null> = Object.fromEntries(d.mixers.map((m) => [m.id, (opts.amanece && m.id in opts.amanece ? opts.amanece[m.id] : undefined) ?? tomado(m.id)?.plant_id ?? d.ayer?.reparto?.[m.id]?.duerme ?? null]))
  const fuenteAmanece: Record<string, "gps" | "reparto" | null> = Object.fromEntries(d.mixers.map((m) => [m.id, opts.amanece && opts.amanece[m.id] ? "gps" : tomado(m.id)?.plant_id ? "gps" : d.ayer?.reparto?.[m.id]?.duerme ? "reparto" : null]))
  const delDia = d.mixers.filter((m) => m.status !== "maintenance" && m.status !== "unavailable")
  const efectivo: Reparto | null = opts.edicion ?? d.guardado?.reparto ?? null
  const noSalen = new Set(delDia.filter((m) => efectivo?.[m.id]?.sale === false).map((m) => m.id))
  const aCamion = (m: MixerDia): CamionReparto => ({ id: m.id, patente: m.license_plate, capacidad: Number(m.capacity_m3) || 8, amanece: amanece[m.id] ?? null })
  const camiones = delDia.filter((m) => !noSalen.has(m.id)).map(aCamion)
  const camionesNoSalen = delDia.filter((m) => noSalen.has(m.id)).map(aCamion)
  const prmDe = (id: string) => plantas.find((p) => p.id === id)?.prm
  const ajustes = opts.ajustes || {}
  const pedidos = d.pedidosHoy.map((p) => aplicarAjustes(p, ajustes[p.id], fecha))
  const aPedidos = (ps: PedidoDia[]): PedidoReparto[] => ps
    .filter((p) => prmDe(p.plant_id))
    .map((p) => {
      const pg = conTiemposGps(p, prmDe(p.plant_id)!, d.tiempos)
      return { p: pg, existentes: conHechos(pg, d.viajes[p.id] || [], d, prmDe(p.plant_id)!), obra: nombreVisible(p.construction_sites?.name) || "Pedido" }
    })
  const pedidosR = aPedidos(pedidos)
  const existentesDe = (id: string) => pedidosR.find((x) => x.p.id === id)?.existentes || d.viajes[id] || []
  // Lo ya despachado de cada pedido (para la columna Viajes y Comienza)
  const hechos = Object.fromEntries(pedidosR.map((x) => {
    const hs = x.existentes.filter((v) => v.estado === "despachado")
    return [x.p.id, { n: hs.length, primeraCarga: hs.length ? Math.min(...hs.map((v) => (Date.parse(v.hora_carga) - base) / 60_000)) : null }]
  }))
  // Hoy: los viajes pendientes no cargan antes de ahora (redondeado a 5 min, hora de Argentina); otros días, como siempre
  const ahora = opts.ahora ?? d.leidoAt
  const desde = ahora != null && new Date(ahora - 3 * 3600_000).toISOString().slice(0, 10) === fecha ? Math.ceil((ahora - base) / 60_000 / 5) * 5 : null
  // Viajes ajustados a mano en el gerenciador: no se rearman (salvo que se pida); sus viajes pendientes ocupan a sus camiones
  const manuales = pedidosManuales(d)
  const fijados = opts.rearmarManuales ? new Set<string>() : new Set(manuales)
  const fijos = d.pedidosHoy.flatMap((p) => existentesDe(p.id).filter((v) => v.estado === "despachado" || (fijados.has(p.id) && v.estado === "planificado")))
  const entrada: EntradaDia = { base, plantas, camiones, pedidos: pedidosR, traslado, fijos, fijados, desde }
  const sugerencia = armarDia(entrada)
  const man = aPedidos(d.pedidosManana)
  const noche = dondeDuermen(sugerencia, camiones, plantas, man.length ? { base: base + DIA_MS, plantas, pedidos: man, traslado } : null)
  const sugerido = repartoDe(sugerencia, camiones, noche.duerme, camionesNoSalen)
  const vigente = efectivo ?? sugerido
  // Lo que se ve es lo que se guarda: el motor con el reparto vigente. Si el reparto es la sugerencia tal cual (sin
  // guardar, o guardada sin cambios), el resultado es la sugerencia misma: sus viajes ya respetan esos tramos, y volver a
  // correr el motor restringido puede elegir otra combinación (pasa con 3 camiones el 05/11).
  const resultado = mismoReparto(vigente, sugerido) ? sugerencia : armarDia({ ...entrada, reparto: vigente })

  // Viajes con que se compara (los guardados o, si el pedido no tiene pendientes, los de la sugerencia)
  const plantDe = (pid: string) => d.pedidosHoy.find((p) => p.id === pid)?.plant_id || null
  const guardadosIds = new Set(d.pedidosHoy.filter((p) => (d.viajes[p.id] || []).some((v) => v.estado === "planificado")).map((p) => p.id))
  const referencia: ViajeDia[] = [
    ...viajesDia(d.pedidosHoy.flatMap((p) => existentesDe(p.id).filter((v) => v.estado !== "cancelado" && (v.estado === "despachado" || guardadosIds.has(p.id)))), base, plantDe),
    ...sugerencia.viajes.filter((v) => !v.fijo && !guardadosIds.has(v.pedidoId)),
  ]
  const obraDe = (pid: string) => nombreVisible(d.pedidosHoy.find((p) => p.id === pid)?.construction_sites?.name) || "otra obra"
  const guardadosDia = d.pedidosHoy.flatMap((p) => (d.viajes[p.id] || []).filter((v) => v.estado !== "cancelado"))
  const avisos: Aviso[] = [
    // Los avisos por pedido (atrasos, fin de jornada) van en la tabla; acá quedan los del día (traslado a confirmar)
    ...resultado.avisos.filter((a) => !a.pedidoId),
    ...(efectivo ? avisosEdicion(efectivo, referencia, guardadosIds, camiones, plantas, traslado, obraDe) : []),
    ...avisosSuperposicion(guardadosDia, obraDe, (id) => patentes[id] || "—"),
  ]
  const contexto: ContextoReparto = {
    base, plantas, traslado, camiones, reparto: vigente,
    sugeridos: Object.fromEntries(resultado.pedidos.map((x) => [x.id, x.camiones])),
    otros: referencia, desde,
  }
  const filas = filasPedidos(resultado, pedidosR.map((x) => ({ ...pedidos.find((p) => p.id === x.p.id), ...x.p })), plantas, patentes, hechos)
  return {
    fecha, base, plantas, nombres, patentes, traslado, amanece, fuenteAmanece, delDia, camiones, noSalen, pedidos, entrada, sugerencia,
    noche, sugerido, efectivo, vigente, resultado, referencia, avisos, contexto, filas, numeros: resumenNumeros(resultado, filas), obraDe,
    manuales, rearmaManuales: !!opts.rearmarManuales,
  }
}
