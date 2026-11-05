/**
 * La carga y el armado del día (docs/specs/2026-11-05-dia-unificado-y-mail.md, 3.6).
 *
 * Lo que hacía el hook useRepartoDia, sin React: `leerDatosDia` (las consultas, con los límites del día en hora de
 * Argentina) y `armarVistaDia` (puro: sugerencia, reparto vigente, resultado, filas, avisos). Es la única carga del día:
 * la usan la pantalla, el mail y el resumen para el WhatsApp de Concretus, así los tres dicen lo mismo.
 */
import { parametrosDePlanta } from "@/lib/planificador"
import { cargarViajes, conTiemposGps, parametrosConGps, type PedidoParaViajes, type ViajeRow } from "@/lib/viajes"
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
}

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
  const [viajes, amanecer, armadoMail] = await Promise.all([
    cargarViajes(sb, [...pedidosHoy, ...pedidosManana].map((p) => p.id)),
    leerOpcional(sb.from("amanecer_camiones").select("mixer_id, plant_id, fuente, texto, tomado_at").eq("fecha", fecha)),
    leerOpcional(sb.from("armado_mail").select("*").eq("fecha", fecha).maybeSingle()),
  ])
  return { fecha, base, plants, plantRows: (pls as any[]) || [], mixers: ((ms as any[]) || []) as MixerDia[], pedidosHoy, pedidosManana, viajes, tiempos, guardado, ayer, traslado, amanecer: (amanecer as AmanecerFila[] | null) || null, armadoMail: armadoMail || null }
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
}

/**
 * Arma el día (puro). `edicion` = el reparto que se está editando; `ajustes` = horas y métodos cambiados sin guardar;
 * `ruta` = la ruta del mapa entre las plantas (respaldo del traslado); `amanece` = dónde arranca cada camión (si no
 * viene, donde durmió según el reparto del día anterior).
 */
export function armarVistaDia(d: DatosDia, opts: { ajustes?: AjustesPedidos; edicion?: Reparto | null; ruta?: { minutos: number; km: number } | null; amanece?: Record<string, string | null> } = {}): VistaDia {
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
    .map((p) => ({ p: conTiemposGps(p, prmDe(p.plant_id)!, d.tiempos), existentes: d.viajes[p.id] || [], obra: nombreVisible(p.construction_sites?.name) || "Pedido" }))
  const pedidosR = aPedidos(pedidos)
  const fijos = d.pedidosHoy.flatMap((p) => (d.viajes[p.id] || []).filter((v) => v.estado === "despachado"))
  const entrada: EntradaDia = { base, plantas, camiones, pedidos: pedidosR, traslado, fijos }
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
    ...viajesDia(d.pedidosHoy.flatMap((p) => (d.viajes[p.id] || []).filter((v) => v.estado !== "cancelado" && (v.estado === "despachado" || guardadosIds.has(p.id)))), base, plantDe),
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
    otros: referencia,
  }
  const filas = filasPedidos(resultado, pedidosR.map((x) => ({ ...pedidos.find((p) => p.id === x.p.id), ...x.p })), plantas, patentes)
  return {
    fecha, base, plantas, nombres, patentes, traslado, amanece, fuenteAmanece, delDia, camiones, noSalen, pedidos, entrada, sugerencia,
    noche, sugerido, efectivo, vigente, resultado, referencia, avisos, contexto, filas, numeros: resumenNumeros(resultado, filas), obraDe,
  }
}
