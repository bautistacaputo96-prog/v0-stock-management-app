/**
 * Viajes de un pedido (fase 2): el motor que los arma está SOLO acá.
 *
 * Lo usan el formulario del pedido (Semana), la vista Día ("Ordenar el día" / "Guardar plan del día"),
 * el gerenciador de viajes y las ediciones de hora o total. Por dentro usa el planificador que ya
 * existía (lib/planificador.ts), así un pedido solo y el día entero se calculan con las mismas reglas:
 *   - m³ por viaje = m3_por_viaje del pedido (8 por defecto), el último con el resto;
 *   - el primero llega a la hora pedida; los siguientes, separados por el espaciado del pedido
 *     o, si no tiene, por la descarga de la planta (bomba o directo);
 *   - la carga empieza ida + carga antes de la llegada; la planta carga de a `bocas_carga` camiones;
 *   - tiempos reales del GPS (parametrosConGps / conTiemposGps): ida y descarga de la obra, descarga y tiempo en
 *     planta de la planta, si hay datos; lo cargado en el pedido gana siempre.
 * Los viajes despachados no se tocan: solo se regeneran los planificados.
 * Se guardan con una sola función de la base (guardar_viajes_pedido): todo o nada.
 * Los viajes no tocan stock.
 */
import { planificar, aMin, aHora, parametrosDePlanta, type Parametros, type Camion, type Plan, type Ocupado } from "@/lib/planificador"
import { cargarTiemposGps, type TiemposGps, type MedidaGps, type MedidaObraGps, type M3SugeridoGps } from "@/lib/gps-viajes"

export type EstadoViaje = "planificado" | "despachado" | "cancelado"

export type ViajeRow = {
  id?: string
  pedido_id: string
  plant_id?: string | null
  n: number
  m3: number
  hora_carga: string
  hora_salida: string
  hora_llegada: string
  hora_fin_descarga: string
  hora_vuelta: string
  mixer_id: string | null
  estado: EstadoViaje
  dispatch_id?: string | null
  /** m³ que tenía planificados antes de despacharse (los de `m3` son los reales del camión) */
  m3_planificado?: number | null
  origen?: OrigenViajes
  actualizado_por?: string | null
  updated_at?: string | null
}

/** Quién armó los viajes: al guardar el pedido (automatico), "Guardar plan del día" o el gerenciador. */
export type OrigenViajes = "automatico" | "plan_dia" | "gerenciador"

/** Lo mínimo del pedido que hace falta para armar sus viajes. */
export type PedidoParaViajes = {
  id: string
  plant_id: string
  construction_site_id?: string | null
  quantity_m3: number
  dispatched_m3?: number | null
  scheduled_arrival_time: string
  metodo_descarga?: "bomba" | "directo" | null
  mixer_id?: string | null
  status?: string
  m3_por_viaje?: number | null
  espaciado_min?: number | null
  /** Fase 2b: minutos de viaje de este pedido (dependen de la planta) y de descarga por camión de 8 m³ */
  viaje_min?: number | null
  descarga_min?: number | null
  construction_sites?: { name?: string | null; travel_time_minutes?: number | null; requires_pump?: boolean | null } | null
  /**
   * Tiempos reales del GPS (no son columnas: los pone conTiemposGps antes de armar los viajes). Valen solo si el
   * pedido no tiene su propio número: ida real de la obra desde la planta del pedido y descarga por 8 m³ de la obra.
   */
  viaje_min_gps?: number | null
  descarga_min_gps?: number | null
}

const MIN = 60_000

/**
 * Minutos de viaje: los del pedido (ruta real desde su planta o corregidos a mano), si no la ida real del GPS de la
 * obra desde esa planta, si no los de la obra, si no 30.
 */
export const viajeMinDe = (p: PedidoParaViajes) =>
  Number(p.viaje_min) > 0 ? Number(p.viaje_min) : Number(p.viaje_min_gps) > 0 ? Number(p.viaje_min_gps) : p.construction_sites?.travel_time_minutes || 30
/** Descarga por 8 m³ propia del pedido (la del pedido o la real de la obra); null = la de la planta. */
export const descargaPropiaDe = (p: PedidoParaViajes): number | null =>
  Number(p.descarga_min) > 0 ? Number(p.descarga_min) : Number(p.descarga_min_gps) > 0 ? Number(p.descarga_min_gps) : null
/**
 * Minutos de descarga por camión de 8 m³: los del pedido, si no la real de la obra (GPS), si no los de la planta
 * según bomba o directo (que con el GPS ya son los reales de la planta, ver parametrosConGps).
 */
export const descarga8De = (p: PedidoParaViajes, prm: Parametros) =>
  descargaPropiaDe(p) ?? (conBombaDe(p) ? prm.descargaBombaMin : prm.descargaDirectaMin)
export const conBombaDe = (p: PedidoParaViajes) =>
  (p.metodo_descarga || (p.construction_sites?.requires_pump ? "bomba" : "directo")) === "bomba"
export const m3PorViajeDe = (p: PedidoParaViajes) => (Number(p.m3_por_viaje) > 0 ? Number(p.m3_por_viaje) : 8)

/** Minutos de descarga de un viaje (la misma regla del planificador: proporcional a los m³, mínimo 5). */
export function descargaDe(p: PedidoParaViajes, m3: number, prm: Parametros) {
  return Math.max(5, Math.round((descarga8De(p, prm) * m3) / 8))
}
/** Minutos entre la llegada de un camión y la del siguiente. */
export function espaciadoDe(p: PedidoParaViajes, m3: number, prm: Parametros) {
  return Number(p.espaciado_min) > 0 ? Number(p.espaciado_min) : descargaDe(p, m3, prm)
}

/** 00:00 (hora local) del día del pedido */
function inicioDelDia(iso: string) {
  const d = new Date(iso)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
const aIso = (base: number, minutos: number) => new Date(base + Math.round(minutos) * MIN).toISOString()
const minDelDia = (base: number, iso: string) => (new Date(iso).getTime() - base) / MIN

export const ordenarPorN = (vs: ViajeRow[]) => [...vs].sort((a, b) => a.n - b.n)
export const pendientes = (vs: ViajeRow[]) => ordenarPorN(vs.filter((v) => v.estado === "planificado"))
export const proximoViaje = (vs: ViajeRow[]) => pendientes(vs)[0] || null
export const totalViajes = (vs: ViajeRow[]) => vs.filter((v) => v.estado !== "cancelado").length

/**
 * m³ ya entregados: los reales de los viajes despachados (registrar_despacho graba los m³ del camión) o, si es
 * más, lo despachado del pedido (despachos que salieron antes de que el pedido tuviera viajes).
 */
export function m3Entregados(p: PedidoParaViajes, vs: ViajeRow[]) {
  const enviados = vs.filter((v) => v.estado === "despachado").reduce((s, v) => s + Number(v.m3), 0)
  return Math.round(Math.max(Number(p.dispatched_m3 || 0), enviados) * 100) / 100
}

/**
 * Lo que falta planificar de un pedido y desde qué hora:
 * m³ = total − lo ya entregado; el primer pendiente llega a la hora pedida más el espaciado de los ya despachados
 * (si se corre la hora del pedido, se corren todos los pendientes).
 */
function entradaPedido(p: PedidoParaViajes, existentes: ViajeRow[], prm: Parametros) {
  const base = inicioDelDia(p.scheduled_arrival_time)
  const despachados = ordenarPorN(existentes.filter((v) => v.estado === "despachado"))
  const pendiente = Math.max(0, Number(p.quantity_m3) - m3Entregados(p, existentes))
  const llegada = minDelDia(base, p.scheduled_arrival_time) + despachados.reduce((s, v) => s + espaciadoDe(p, Number(v.m3), prm), 0)
  return { base, pendiente: Math.round(pendiente * 100) / 100, llegada }
}

/** Números libres para los pendientes: 1..N salteando los de viajes despachados o cancelados. */
function numerosLibres(existentes: ViajeRow[], cuantos: number) {
  const usados = new Set(existentes.filter((v) => v.estado !== "planificado").map((v) => v.n))
  const out: number[] = []
  for (let n = 1; out.length < cuantos; n++) if (!usados.has(n)) out.push(n)
  return out
}

type ViajePlan = Plan["viajes"][number]

function aFilas(p: PedidoParaViajes, base: number, viajesPlan: ViajePlan[], existentes: ViajeRow[], camionPorViaje: (v: ViajePlan, i: number) => string | null): ViajeRow[] {
  const nums = numerosLibres(existentes, viajesPlan.length)
  return viajesPlan.map((v, i) => ({
    pedido_id: p.id,
    plant_id: p.plant_id,
    n: nums[i],
    m3: v.m3,
    hora_carga: aIso(base, v.inicioCarga),
    hora_salida: aIso(base, v.salida),
    hora_llegada: aIso(base, v.llegada),
    hora_fin_descarga: aIso(base, v.finDescarga),
    hora_vuelta: aIso(base, v.vuelta),
    mixer_id: camionPorViaje(v, i),
    estado: "planificado" as const,
  }))
}

/**
 * Viajes pendientes de UN pedido, con el motor del planificador y sin límite de camiones
 * (el camión sugerido es el del pedido o el que ya tenía ese viaje). Respeta la boca de carga
 * dentro del pedido. Devuelve solo los planificados nuevos; los despachados quedan como están.
 */
export function generarViajes(
  p: PedidoParaViajes, prm: Parametros, existentes: ViajeRow[] = [],
  /** Viajes de otros pedidos del día (cualquier planta, incluidos los despachados): sus camiones están ocupados */
  otrosViajes: ViajeRow[] = [],
): ViajeRow[] {
  const { base, pendiente, llegada } = entradaPedido(p, existentes, prm)
  if (pendiente <= 0.01) return []
  const tam = m3PorViajeDe(p)
  const virtuales: Camion[] = Array.from({ length: Math.ceil(pendiente / tam) + 1 }, (_, i) => ({ id: `v${i}`, patente: "", capacidad: 1000 }))
  const plan = planificar(
    [{ id: p.id, cliente: "", obra: "", m3: pendiente, llegada, viajeMin: viajeMinDe(p), conBomba: conBombaDe(p), descargaMin: descargaPropiaDe(p), m3PorViaje: tam, espaciadoMin: Number(p.espaciado_min) > 0 ? Number(p.espaciado_min) : null }],
    virtuales,
    prm,
  )
  const anteriores = pendientes(existentes)
  const filas = aFilas(p, base, plan.viajes, existentes, (_, i) => anteriores[i]?.mixer_id ?? p.mixer_id ?? null)
  // El camión sugerido que se conserva no puede quedar en dos viajes que se pisan (en este pedido o en otro, de
  // cualquier planta): si choca, queda sin camión
  const fijos = [...existentes.filter((v) => v.estado === "despachado"), ...otrosViajes.filter((o) => o.pedido_id !== p.id && o.estado !== "cancelado")]
  filas.forEach((v, i) => {
    if (v.mixer_id && [...fijos, ...filas.slice(0, i)].some((o) => o.mixer_id === v.mixer_id && pisan(o, v))) v.mixer_id = null
  })
  return filas
}

/**
 * "Ordenar el día": todos los pedidos del día de una planta con los camiones disponibles.
 * Respeta las bocas de carga, asigna el camión sugerido y corre las cargas que chocan.
 */
export function planDelDia(
  pedidos: PedidoParaViajes[],
  viajesPorPedido: Record<string, ViajeRow[]>,
  camiones: Camion[],
  prm: Parametros,
  /** Viajes del día que no entran en este plan (otra planta, otros pedidos): sus camiones están ocupados */
  otrosViajes: ViajeRow[] = [],
): { plan: Plan | null; filas: Record<string, ViajeRow[]> } {
  const entradas = pedidos
    .filter((p) => p.status !== "completed" && p.status !== "cancelled")
    .map((p) => ({ p, e: entradaPedido(p, viajesPorPedido[p.id] || [], prm) }))
    .filter((x) => x.e.pendiente > 0.01)
  if (!entradas.length || !camiones.length) return { plan: null, filas: {} }
  // Todos los pedidos del día comparten el mismo 00:00 (el del primero)
  const base = entradas[0].e.base
  const plan = planificar(
    entradas.map(({ p, e }) => ({
      id: p.id, cliente: "", obra: p.construction_sites?.name || "", m3: e.pendiente,
      llegada: e.llegada + (e.base - base) / MIN, viajeMin: viajeMinDe(p), conBomba: conBombaDe(p),
      descargaMin: descargaPropiaDe(p),
      m3PorViaje: m3PorViajeDe(p), espaciadoMin: Number(p.espaciado_min) > 0 ? Number(p.espaciado_min) : null,
    })),
    camiones,
    prm,
    ocupadosDe([...Object.values(viajesPorPedido).flat().filter((v) => v.estado === "despachado"), ...otrosViajes], base, new Set(entradas.map((x) => x.p.id))),
  )
  const filas: Record<string, ViajeRow[]> = {}
  for (const { p } of entradas) {
    const vs = plan.viajes.filter((v) => v.pedidoId === p.id)
    filas[p.id] = aFilas(p, base, vs, viajesPorPedido[p.id] || [], (v) => v.camionId)
  }
  return { plan, filas }
}

/** Ventanas ocupadas de los camiones (de la carga a la vuelta) para el planificador, en minutos del día. */
function ocupadosDe(viajes: ViajeRow[], base: number, pedidosDelPlan: Set<string>): Ocupado[] {
  return viajes
    .filter((v) => v.mixer_id && v.estado !== "cancelado" && !(v.estado === "planificado" && pedidosDelPlan.has(v.pedido_id)))
    .map((v) => ({ camionId: v.mixer_id!, desde: minDelDia(base, v.hora_carga), hasta: minDelDia(base, v.hora_vuelta) }))
}

// ---------------------------------------------------------------------------
// Camión ocupado (fase 2b, D): un camión no puede estar en dos viajes que se pisan, en el mismo pedido o en otro
// ---------------------------------------------------------------------------
/** otroAntes: el otro viaje carga antes (este camión "todavía vuelve de…"); si no, carga después ("tiene que salir a…") */
export type ChoqueCamion = { viaje: ViajeRow; otro: ViajeRow; otroAntes: boolean }
const clave = (v: ViajeRow) => `${v.pedido_id}:${v.n}`
const pisan = (a: ViajeRow, b: ViajeRow) =>
  new Date(a.hora_carga).getTime() < new Date(b.hora_vuelta).getTime() && new Date(b.hora_carga).getTime() < new Date(a.hora_vuelta).getTime()

/**
 * Para cada viaje con camión que se pisa con otro viaje del mismo camión (en los dos sentidos: el otro carga antes
 * o después; mismo pedido u otro; cualquier estado salvo cancelado), ese otro viaje. Se marcan los DOS viajes.
 * Si hay varios, se prefiere el que carga antes (el aviso "todavía vuelve de…"). Clave: "pedido:n".
 */
export function choquesDeCamion(viajes: ViajeRow[]): Map<string, ChoqueCamion> {
  const out = new Map<string, ChoqueCamion>()
  const vs = viajes.filter((v) => v.mixer_id && v.estado !== "cancelado")
  const t = (iso: string) => new Date(iso).getTime()
  for (const v of vs) {
    const pisados = vs.filter((o) => o !== v && clave(o) !== clave(v) && o.mixer_id === v.mixer_id && pisan(o, v))
    if (!pisados.length) continue
    const antes = pisados.filter((o) => t(o.hora_carga) <= t(v.hora_carga)).sort((a, b) => t(b.hora_vuelta) - t(a.hora_vuelta))[0]
    const otro = antes || pisados.sort((a, b) => t(a.hora_carga) - t(b.hora_carga))[0]
    out.set(clave(v), { viaje: v, otro, otroAntes: !!antes })
  }
  return out
}

/** "AF431GU todavía vuelve de Obra X a las 09:40" / "AF431GU tiene que cargar para Obra X a las 09:10" */
export function textoChoque(ch: ChoqueCamion, patente: string, obra: string) {
  const hh = (iso: string) => { const d = new Date(iso); return aHora(d.getHours() * 60 + d.getMinutes()) }
  return ch.otroAntes
    ? `${patente} todavía vuelve de ${obra} a las ${hh(ch.otro.hora_vuelta)}`
    : `${patente} tiene que cargar para ${obra} a las ${hh(ch.otro.hora_carga)}, antes de volver de este viaje`
}
export const claveViaje = clave

/** Camiones libres durante todo el viaje (de la carga a la vuelta), sin contar el propio viaje. */
export function camionesLibresPara<M extends { id: string }>(v: ViajeRow, viajes: ViajeRow[], camiones: M[]): M[] {
  const ocupados = new Set(viajes.filter((o) => o.mixer_id && o.estado !== "cancelado" && clave(o) !== clave(v) && pisan(o, v)).map((o) => o.mixer_id))
  return camiones.filter((c) => !ocupados.has(c.id))
}

// ---------------------------------------------------------------------------
// Flota (fase 2b, E): cuántos camiones hacen falta para no cortar el hormigonado
// ---------------------------------------------------------------------------
export type ExplicacionFlota = {
  carga: number; ida: number; descarga: number; lavado: number; vuelta: number; ciclo: number
  /** espera en planta antes de volver a cargar (tiempo en planta real − carga); 0 sin datos del GPS */
  espera: number
  /** minutos entre camiones (espaciado o descarga) */
  ritmo: number
  viajes: number
  /** camiones para no cortar: ciclo / ritmo, como máximo uno por viaje */
  necesarios: number
  texto: string
}

export function explicarFlota(p: PedidoParaViajes, prm: Parametros, viajes: number): ExplicacionFlota {
  // Descarga de un camión lleno del pedido (m³ por camión; 8 por defecto, como antes)
  const tam = m3PorViajeDe(p)
  const ida = viajeMinDe(p), descarga = descargaDe(p, tam, prm)
  const ritmo = Number(p.espaciado_min) > 0 ? Number(p.espaciado_min) : descarga
  const espera = Math.max(0, Number(prm.esperaPlantaMin) || 0)
  const ciclo = prm.cargaMin + espera + ida + descarga + prm.lavadoMin + ida
  const necesarios = Math.max(1, Math.min(viajes || 1, Math.ceil(ciclo / ritmo)))
  const planta = espera > 0 ? `en planta ${prm.cargaMin + espera} (carga ${prm.cargaMin} + espera ${espera})` : `carga ${prm.cargaMin}`
  const texto = `Ciclo: ${planta} + ida ${ida} + descarga ${descarga}${tam !== 8 ? ` (${tam.toLocaleString("es-AR")} m³)` : ""} + lavado ${prm.lavadoMin} + vuelta ${ida} = ${ciclo} min · un camión cada ${ritmo} min → para no cortar el hormigonado ${necesarios === 1 ? "hace falta 1 camión" : `hacen falta ${necesarios} camiones`}`
  return { carga: prm.cargaMin, espera, ida, descarga, lavado: prm.lavadoMin, vuelta: ida, ciclo, ritmo, viajes, necesarios, texto }
}

/**
 * "Con 4 camiones el vaciado termina 09:50 en vez de 09:15, con 3 huecos de 12 min": compara el plan real del
 * pedido (con los camiones que hay) con el ideal (sin límite de camiones). Nulo si no hay cortes.
 */
export function textoConMenosCamiones(viajesPlan: ViajeRow[], ideal: ViajeRow[], camionesUsados: number): string | null {
  if (!viajesPlan.length || !ideal.length) return null
  const fin = (vs: ViajeRow[]) => Math.max(...vs.map((v) => new Date(v.hora_fin_descarga).getTime()))
  const finReal = fin(viajesPlan), finIdeal = fin(ideal)
  if (finReal - finIdeal < MIN) return null
  const orden = [...viajesPlan].sort((a, b) => new Date(a.hora_llegada).getTime() - new Date(b.hora_llegada).getTime())
  const huecos: number[] = []
  for (let i = 1; i < orden.length; i++) {
    const h = Math.round((new Date(orden[i].hora_llegada).getTime() - new Date(orden[i - 1].hora_fin_descarga).getTime()) / MIN)
    if (h > 0) huecos.push(h)
  }
  const hh = (t: number) => { const d = new Date(t); return aHora(d.getHours() * 60 + d.getMinutes()) }
  const prom = huecos.length ? Math.round(huecos.reduce((s, x) => s + x, 0) / huecos.length) : 0
  return `Con ${camionesUsados} ${camionesUsados === 1 ? "camión" : "camiones"} el vaciado termina ${hh(finReal)} en vez de ${hh(finIdeal)}${huecos.length ? `, con ${huecos.length} hueco${huecos.length === 1 ? "" : "s"} de ${prom} min` : ""}`
}

// ---------------------------------------------------------------------------
// Ajustes a mano (gerenciador). Solo tocan los viajes planificados.
// ---------------------------------------------------------------------------
const correr = (iso: string, min: number) => new Date(new Date(iso).getTime() + min * MIN).toISOString()

export function correrViaje(v: ViajeRow, min: number): ViajeRow {
  if (v.estado !== "planificado" || !min) return v
  return { ...v, hora_carga: correr(v.hora_carga, min), hora_salida: correr(v.hora_salida, min), hora_llegada: correr(v.hora_llegada, min), hora_fin_descarga: correr(v.hora_fin_descarga, min), hora_vuelta: correr(v.hora_vuelta, min) }
}

/** Corre ±min todos los viajes pendientes. */
export const correrPendientes = (vs: ViajeRow[], min: number) => vs.map((v) => correrViaje(v, min))

/** "Ajustar a la hora actual": el próximo pendiente carga ahora y los demás se corren lo mismo. */
export function ajustarAHora(vs: ViajeRow[], ahora: Date = new Date()): ViajeRow[] {
  const prox = proximoViaje(vs)
  if (!prox) return vs
  const delta = Math.round((ahora.getTime() - new Date(prox.hora_carga).getTime()) / MIN)
  return correrPendientes(vs, delta)
}

/** Cambia los m³ de un viaje pendiente: se recalculan su descarga y su vuelta (la llegada no se mueve). */
export function cambiarM3(vs: ViajeRow[], n: number, m3: number, p: PedidoParaViajes, prm: Parametros): ViajeRow[] {
  return vs.map((v) => {
    if (v.n !== n || v.estado !== "planificado" || !(m3 > 0)) return v
    const fin = new Date(new Date(v.hora_llegada).getTime() + descargaDe(p, m3, prm) * MIN)
    const vuelta = new Date(fin.getTime() + (prm.lavadoMin + viajeMinDe(p)) * MIN)
    return { ...v, m3, hora_fin_descarga: fin.toISOString(), hora_vuelta: vuelta.toISOString() }
  })
}

/** m³ que faltan cubrir con viajes (total − despachados − pendientes). Negativo = sobran. */
export function m3Faltantes(vs: ViajeRow[], p: PedidoParaViajes) {
  const planificados = vs.filter((v) => v.estado === "planificado").reduce((s, v) => s + Number(v.m3), 0)
  return Math.round((Number(p.quantity_m3) - m3Entregados(p, vs) - planificados) * 100) / 100
}

/**
 * Qué cambió del pedido que obliga a rearmar los viajes pendientes (nombres para Actividad).
 * Las observaciones, la fibra, la finalidad, la bomba, etc. no tocan los viajes.
 */
export function cambiosQueRearman(antes: Partial<PedidoParaViajes>, despues: Partial<PedidoParaViajes>): string[] {
  const t = (x: any) => (x ? new Date(x).getTime() : null)
  const num = (x: any, def: number | null = null) => (x == null || x === "" ? def : Number(x))
  const out: string[] = []
  if ("scheduled_arrival_time" in despues && t(antes.scheduled_arrival_time) !== t(despues.scheduled_arrival_time)) out.push("hora de llegada")
  if ("quantity_m3" in despues && num(antes.quantity_m3) !== num(despues.quantity_m3)) out.push("cantidad")
  if ("metodo_descarga" in despues && (antes.metodo_descarga || null) !== (despues.metodo_descarga || null)) out.push("método de descarga")
  if ("construction_site_id" in despues && (antes.construction_site_id || null) !== (despues.construction_site_id || null)) out.push("obra")
  if ("m3_por_viaje" in despues && num(antes.m3_por_viaje, 8) !== num(despues.m3_por_viaje, 8)) out.push("m³ por camión")
  if ("espaciado_min" in despues && num(antes.espaciado_min) !== num(despues.espaciado_min)) out.push("minutos entre camiones")
  if ("viaje_min" in despues && num(antes.viaje_min) !== num(despues.viaje_min)) out.push("minutos de viaje")
  if ("descarga_min" in despues && num(antes.descarga_min) !== num(despues.descarga_min)) out.push("minutos de descarga")
  return out
}

/** Agrega un viaje al final con lo que falta (o m3_por_viaje si no falta nada), separado por el espaciado. */
export function agregarViaje(vs: ViajeRow[], p: PedidoParaViajes, prm: Parametros): ViajeRow[] {
  const falta = m3Faltantes(vs, p)
  const m3 = falta > 0.01 ? Math.min(m3PorViajeDe(p), falta) : m3PorViajeDe(p)
  const ult = ordenarPorN(vs.filter((v) => v.estado !== "cancelado")).pop()
  const llegada = ult
    ? new Date(new Date(ult.hora_llegada).getTime() + espaciadoDe(p, Number(ult.m3), prm) * MIN)
    : new Date(p.scheduled_arrival_time)
  const salida = new Date(llegada.getTime() - viajeMinDe(p) * MIN)
  const carga = new Date(salida.getTime() - prm.cargaMin * MIN)
  const fin = new Date(llegada.getTime() + descargaDe(p, m3, prm) * MIN)
  const vuelta = new Date(fin.getTime() + (prm.lavadoMin + viajeMinDe(p)) * MIN)
  const n = Math.max(0, ...vs.map((v) => v.n)) + 1
  const nuevo: ViajeRow = {
    pedido_id: p.id, plant_id: p.plant_id, n, m3,
    hora_carga: carga.toISOString(), hora_salida: salida.toISOString(), hora_llegada: llegada.toISOString(),
    hora_fin_descarga: fin.toISOString(), hora_vuelta: vuelta.toISOString(),
    mixer_id: ult?.mixer_id ?? p.mixer_id ?? null, estado: "planificado",
  }
  // Se propone el camión del último viaje solo si llega a volver (si no, queda sin camión para elegir)
  if (nuevo.mixer_id && vs.some((o) => o.estado !== "cancelado" && o.mixer_id === nuevo.mixer_id && pisan(o, nuevo))) nuevo.mixer_id = null
  return [...vs, nuevo]
}

/** Quita un viaje pendiente y renumera los pendientes (los despachados conservan su número). */
export function quitarViaje(vs: ViajeRow[], n: number): ViajeRow[] {
  return renumerar(vs.filter((v) => !(v.n === n && v.estado === "planificado")))
}

export function renumerar(vs: ViajeRow[]): ViajeRow[] {
  const fijos = vs.filter((v) => v.estado !== "planificado")
  const pend = pendientes(vs).sort((a, b) => new Date(a.hora_carga).getTime() - new Date(b.hora_carga).getTime())
  const nums = numerosLibres(fijos, pend.length)
  return [...fijos, ...pend.map((v, i) => ({ ...v, n: nums[i] }))].sort((a, b) => a.n - b.n)
}

// ---------------------------------------------------------------------------
// Boca de carga: choques entre pedidos y horarios sugeridos (formulario del pedido)
// ---------------------------------------------------------------------------
export type OtroPedido = { id: string; obra: string; viajes: ViajeRow[] }

/** Primera obra cuya carga se pisa con la de estos viajes (más cargas a la vez que bocas). */
export function chocaEnBoca(viajes: ViajeRow[], otros: OtroPedido[], prm: Parametros): string | null {
  const bocas = Math.max(1, prm.bocasCarga || 1)
  const intervalos = otros.flatMap((o) => o.viajes.filter((v) => v.estado !== "cancelado").map((v) => ({ obra: o.obra, desde: new Date(v.hora_carga).getTime(), hasta: new Date(v.hora_salida).getTime() })))
  for (const v of viajes) {
    const desde = new Date(v.hora_carga).getTime(), hasta = new Date(v.hora_salida).getTime()
    const pisa = intervalos.filter((x) => desde < x.hasta && hasta > x.desde)
    if (pisa.length >= bocas) return pisa[0].obra
  }
  return null
}

/**
 * Dos horarios de llegada sin choque, uno antes y otro después de la pedida (de a 5 minutos, hasta 4 horas).
 * `armar(llegada)` devuelve los viajes del pedido para esa llegada.
 */
export function horariosSinChoque(llegada: Date, armar: (llegada: Date) => ViajeRow[], otros: OtroPedido[], prm: Parametros) {
  const probar = (delta: number) => {
    const d = new Date(llegada.getTime() + delta * MIN)
    if (d.getDate() !== llegada.getDate()) return null
    return chocaEnBoca(armar(d), otros, prm) ? null : d
  }
  let antes: Date | null = null, despues: Date | null = null
  for (let k = 5; k <= 240 && (!antes || !despues); k += 5) {
    if (!antes) antes = probar(-k)
    if (!despues) despues = probar(k)
  }
  return { antes, despues }
}

// ---------------------------------------------------------------------------
// Demanda de camiones por media hora (vista Día)
// ---------------------------------------------------------------------------
/** Camiones ocupados a la vez (de la carga a la vuelta) en cada media hora entre desde y hasta. */
export function demandaPorMediaHora(viajes: ViajeRow[], dia: Date, desde = "06:00", hasta = "19:00") {
  const base = new Date(dia); base.setHours(0, 0, 0, 0)
  const vs = viajes.filter((v) => v.estado !== "cancelado").map((v) => ({ a: minDelDia(base.getTime(), v.hora_carga), b: minDelDia(base.getTime(), v.hora_vuelta) }))
  const out: { inicio: number; camiones: number }[] = []
  for (let t = aMin(desde); t < aMin(hasta); t += 30) {
    let max = 0
    for (let s = t; s < t + 30; s += 5) max = Math.max(max, vs.filter((x) => x.a <= s && s < x.b).length)
    out.push({ inicio: t, camiones: max })
  }
  return out
}

// ---------------------------------------------------------------------------
// Tiempos reales del GPS (docs/migracion-loop/tiempos-gps-programacion.md)
// Las medianas salen de lib/gps-viajes.ts (cargarTiemposGps); acá se pasan al modelo del planificador:
//   - tiempo en obra (descarga + lavado) → descarga por 8 m³ = (obra − lavado) × 8 ÷ m³ típicos;
//   - tiempo en planta → carga (la de la planta, ocupa la boca) + espera (el resto, no ocupa la boca);
//   - ida real → minutos de viaje.
// Lo del pedido (viaje_min, descarga_min) gana siempre.
// ---------------------------------------------------------------------------
export type FuenteTiempo = "pedido" | "a_mano" | "ruta" | "gps_obra" | "gps_planta" | "planta_a_mano" | "obra" | "planta" | "referencia"
export type TiempoConFuente = { min: number; fuente: FuenteTiempo; viajes?: number }

/**
 * La descarga de la obra se usa solo si el pedido lleva m³ por camión parecidos a los habituales de la obra (±1,5):
 * llevarla a 8 m³ con m³ muy distintos da números absurdos (La huella: 78 min con 2 m³ → 312 por 8 m³).
 */
export const TOLERANCIA_M3_OBRA = 1.5
const obraAplica = (obra: MedidaObraGps, p: PedidoParaViajes) => Math.abs(m3PorViajeDe(p) - obra.m3) <= TOLERANCIA_M3_OBRA

/** Descarga por camión de 8 m³ a partir del tiempo en obra real (descarga + lavado) y los m³ típicos (mínimo 5). */
export function descarga8DeObra(obraMin: number, m3: number, lavadoMin: number) {
  return Math.max(5, Math.round(((obraMin - (lavadoMin || 0)) * 8) / Math.max(0.5, m3 || 8)))
}
/** Espera en planta = tiempo en planta real − carga (nunca negativa). */
export const esperaDePlanta = (enPlantaMin: number, cargaMin: number) => Math.max(0, Math.round(enPlantaMin - cargaMin))

/**
 * Parámetros de la planta con lo real del GPS (descarga directa / con bomba y espera en planta, si hay datos) y,
 * encima, lo corregido a mano en la planta (`prm.aMano`), que gana hasta que se vuelva a automático.
 */
export function parametrosConGps(prm: Parametros, plantaId: string | null | undefined, t: TiemposGps | null | undefined): Parametros {
  const pl = plantaId && t ? t.plantas[plantaId] : null
  const m = prm.aMano || {}
  if (!pl && m.descargaDirectaMin == null && m.descargaBombaMin == null && m.esperaPlantaMin == null) return prm
  return {
    ...prm,
    ...(pl?.directo ? { descargaDirectaMin: descarga8DeObra(pl.directo.min, pl.directo.m3, prm.lavadoMin) } : {}),
    ...(pl?.bomba ? { descargaBombaMin: descarga8DeObra(pl.bomba.min, pl.bomba.m3, prm.lavadoMin) } : {}),
    ...(pl?.enPlanta ? { esperaPlantaMin: esperaDePlanta(pl.enPlanta.min, prm.cargaMin) } : {}),
    ...(m.descargaDirectaMin != null ? { descargaDirectaMin: m.descargaDirectaMin } : {}),
    ...(m.descargaBombaMin != null ? { descargaBombaMin: m.descargaBombaMin } : {}),
    ...(m.esperaPlantaMin != null ? { esperaPlantaMin: m.esperaPlantaMin } : {}),
  }
}

/** El pedido con la ida real de su obra (desde su planta) y la descarga real de la obra, para el motor. */
export function conTiemposGps<P extends PedidoParaViajes>(p: P, prm: Parametros, t: TiemposGps | null | undefined): P {
  const o = p.construction_site_id && t ? t.obras[p.construction_site_id] : null
  const ida = o?.ida[p.plant_id]
  const obra = o?.obra && obraAplica(o.obra, p) ? o.obra : null
  return { ...p, viaje_min_gps: ida ? ida.min : null, descarga_min_gps: obra ? descarga8DeObra(obra.min, obra.m3, prm.lavadoMin) : null }
}

export type TiemposDelPedido = {
  viaje: TiempoConFuente
  /**
   * min = por camión de 8 m³; obra = el tiempo en obra real con sus m³ (si sale de la obra o de la planta);
   * obraNoAplica = la obra tiene tiempo real pero el pedido lleva otros m³ por camión (se usa la planta).
   */
  descarga: TiempoConFuente & { obra?: MedidaObraGps; obraNoAplica?: { m3Obra: number; m3Pedido: number } }
  enPlanta: { min: number; carga: number; espera: number; fuente: "gps_planta" | "planta_a_mano" | "planta"; viajes?: number }
  m3Sugerido: M3SugeridoGps | null
}

/** Qué número usa el motor para este pedido y de dónde sale (para mostrarlo al lado). */
export function tiemposDelPedido(p: PedidoParaViajes, prmBase: Parametros, t: TiemposGps | null | undefined): TiemposDelPedido {
  const prm = parametrosConGps(prmBase, p.plant_id, t)
  const m = prmBase.aMano || {}
  const o = p.construction_site_id && t ? t.obras[p.construction_site_id] : null
  const pl = p.plant_id && t ? t.plantas[p.plant_id] : null
  const ida: MedidaGps | undefined = o?.ida[p.plant_id]
  const tt = p.construction_sites?.travel_time_minutes
  const viaje: TiempoConFuente = Number(p.viaje_min) > 0 ? { min: Number(p.viaje_min), fuente: "pedido" }
    : ida ? { min: ida.min, fuente: "gps_obra", viajes: ida.viajes }
    : tt ? { min: tt, fuente: "obra" } : { min: 30, fuente: "referencia" }
  const bomba = conBombaDe(p)
  const plMet = pl ? (bomba ? pl.bomba : pl.directo) : null
  const minPlanta = bomba ? prm.descargaBombaMin : prm.descargaDirectaMin
  const aManoPlanta = (bomba ? m.descargaBombaMin : m.descargaDirectaMin) != null
  const noAplica = o?.obra && !obraAplica(o.obra, p) ? { m3Obra: o.obra.m3, m3Pedido: m3PorViajeDe(p) } : undefined
  const descarga: TiemposDelPedido["descarga"] = Number(p.descarga_min) > 0 ? { min: Number(p.descarga_min), fuente: "a_mano" }
    : o?.obra && !noAplica ? { min: descarga8DeObra(o.obra.min, o.obra.m3, prm.lavadoMin), fuente: "gps_obra", viajes: o.obra.viajes, obra: o.obra }
    : aManoPlanta ? { min: minPlanta, fuente: "planta_a_mano", obraNoAplica: noAplica }
    : plMet ? { min: minPlanta, fuente: "gps_planta", viajes: plMet.viajes, obra: plMet, obraNoAplica: noAplica }
    : { min: minPlanta, fuente: "planta", obraNoAplica: noAplica }
  const espera = Math.max(0, Number(prm.esperaPlantaMin) || 0)
  const enPlanta: TiemposDelPedido["enPlanta"] = m.esperaPlantaMin != null
    ? { min: prm.cargaMin + espera, carga: prm.cargaMin, espera, fuente: "planta_a_mano" }
    : pl?.enPlanta
      ? { min: prm.cargaMin + espera, carga: prm.cargaMin, espera, fuente: "gps_planta", viajes: pl.enPlanta.viajes }
      : { min: prm.cargaMin, carga: prm.cargaMin, espera: 0, fuente: "planta" }
  return { viaje, descarga, enPlanta, m3Sugerido: o?.m3 || null }
}

/** "real GPS · 12 viajes", "promedio de la planta · 412 viajes", "cargado a mano"… */
export function textoFuente(f: { fuente: FuenteTiempo; viajes?: number }): string {
  const n = f.viajes != null ? ` · ${f.viajes} viaje${f.viajes === 1 ? "" : "s"}` : ""
  switch (f.fuente) {
    case "pedido": return "cargado en el pedido"
    case "a_mano": return "cargado a mano"
    case "ruta": return "ruta del mapa"
    case "gps_obra": return `real GPS${n}`
    case "gps_planta": return `promedio de la planta${n}`
    case "planta_a_mano": return "cargado a mano en la planta"
    case "obra": return "el de la obra"
    case "planta": return "de la planta"
    default: return "de referencia"
  }
}

/** Una línea con los tiempos usados (Actividad, pantallas): "viaje 24 (real GPS · 12 viajes) · descarga 8 m³ 205 (…) · en planta 31 (…)". */
export function textoTiempos(td: TiemposDelPedido): string {
  return `viaje ${td.viaje.min} (${textoFuente(td.viaje)}) · descarga 8 m³ ${td.descarga.min} (${textoFuente(td.descarga)}) · en planta ${td.enPlanta.min} (${textoFuente(td.enPlanta)})`
}

const m3Texto = (x: number) => x.toLocaleString("es-AR")
/** "mezcla viajes con bomba (3) y directos (9)" si el tiempo de obra sale de los dos métodos. */
export function textoMezclaMetodos(o: MedidaObraGps | undefined): string | null {
  return o && (o.bomba || 0) > 0 && (o.directo || 0) > 0 ? `mezcla viajes con bomba (${o.bomba}) y directos (${o.directo})` : null
}

/**
 * Lo que hay que saber de la descarga de la obra (null si no hay nada que decir):
 * "En esta obra cada camión estuvo 78 min (con 3 m³, contando el lavado): son unos 205 min por cada 8 m³", o
 * "Esta obra suele llevar 3 m³; con 8 m³ por camión se usan los tiempos de la planta".
 */
export function textoDescargaObra(td: TiemposDelPedido): string | null {
  const na = td.descarga.obraNoAplica
  if (na) return `Esta obra suele llevar ${m3Texto(na.m3Obra)} m³; con ${m3Texto(na.m3Pedido)} m³ por camión se usan los tiempos de la planta`
  const o = td.descarga.obra
  if (!o || td.descarga.fuente !== "gps_obra") return null
  const mezcla = textoMezclaMetodos(o)
  const base = o.m3 === 8
    ? `En esta obra cada camión estuvo ${o.min} min (con 8 m³, contando el lavado)`
    : `En esta obra cada camión estuvo ${o.min} min (con ${m3Texto(o.m3)} m³, contando el lavado): son unos ${td.descarga.min} min de descarga por cada 8 m³`
  return mezcla ? `${base} · ${mezcla}` : base
}

/** m³ sugeridos solo si difieren de los del pedido (0,5 o más). */
export function m3ParaSugerir(td: TiemposDelPedido, m3Actual: number | null | undefined): M3SugeridoGps | null {
  const s = td.m3Sugerido
  return s && Math.abs(s.m3 - (Number(m3Actual) > 0 ? Number(m3Actual) : 8)) >= 0.5 ? s : null
}

// ---------------------------------------------------------------------------
// Base de datos
// ---------------------------------------------------------------------------
/** Viajes de varios pedidos. Si la tabla no existe todavía (migración sin aplicar) devuelve {}. */
export async function cargarViajes(sb: any, pedidoIds: string[]): Promise<Record<string, ViajeRow[]>> {
  if (!pedidoIds.length) return {}
  const { data, error } = await sb.from("viajes").select("*").in("pedido_id", pedidoIds).order("n")
  if (error || !data) return {}
  const out: Record<string, ViajeRow[]> = {}
  for (const v of data as ViajeRow[]) (out[v.pedido_id] ||= []).push({ ...v, m3: Number(v.m3) })
  return out
}

/**
 * Graba los viajes planificados del pedido: actualiza por número (mismo id), agrega los nuevos y borra los que
 * sobran; los despachados quedan. Todo o nada (guardar_viajes_pedido).
 */
export async function guardarViajes(sb: any, pedidoId: string, viajes: ViajeRow[], usuario: string, origen: OrigenViajes = "automatico"): Promise<{ error: string | null }> {
  const lista = pendientes(viajes).map((v) => ({
    n: v.n, m3: v.m3, hora_carga: v.hora_carga, hora_salida: v.hora_salida, hora_llegada: v.hora_llegada,
    hora_fin_descarga: v.hora_fin_descarga, hora_vuelta: v.hora_vuelta, mixer_id: v.mixer_id,
  }))
  const { error } = await sb.rpc("guardar_viajes_pedido", { p_pedido_id: pedidoId, p_viajes: lista, p_usuario: usuario, p_origen: origen })
  return { error: error ? error.message || "No se pudieron guardar los viajes" : null }
}

/**
 * Rearma los viajes pendientes de un pedido con sus datos actuales y la planta, y lo deja en Actividad
 * ("Viajes recalculados por cambio de …"). Se llama solo cuando cambió algo que afecta los viajes
 * (ver cambiosQueRearman) o al crear el pedido. Si pisa un plan del día o ajustes del gerenciador, lo hace
 * igual pero lo avisa en Actividad (y devuelve reemplazoManual para el aviso en pantalla).
 * soloSiTiene: para usuarios sin el interruptor (si el pedido no tiene viajes no hace nada).
 * Nunca corta la operación del usuario: devuelve el error para avisarlo.
 */
export async function regenerarViajesPedido(
  sb: any, pedidoId: string, usuario: string,
  opts: { soloSiTiene?: boolean; motivo?: string } = {},
): Promise<{ error: string | null; generados: number | null; reemplazoManual: boolean }> {
  const nada = { error: null, generados: null, reemplazoManual: false }
  try {
    const { data: existentesData, error: e1 } = await sb.from("viajes").select("*").eq("pedido_id", pedidoId)
    if (e1) return nada // tabla sin crear: como antes
    const existentes = ((existentesData || []) as ViajeRow[]).map((v) => ({ ...v, m3: Number(v.m3) }))
    if (opts.soloSiTiene && existentes.length === 0) return nada
    const { data: p, error: e2 } = await sb.from("scheduled_dispatches").select("*, construction_sites(name, travel_time_minutes, requires_pump)").eq("id", pedidoId).maybeSingle()
    if (e2 || !p) return { ...nada, error: e2?.message || "No se encontró el pedido" }
    if (p.status === "cancelled" || p.status === "completed") return nada
    const { data: planta } = await sb.from("plants").select("*").eq("id", p.plant_id).maybeSingle()
    // Tiempos reales del GPS (si no se pueden leer, null = los de la planta, como antes)
    const tiempos = await cargarTiemposGps(sb)
    const prmBase = parametrosDePlanta(planta)
    const prm = parametrosConGps(prmBase, p.plant_id, tiempos)
    const ped = conTiemposGps(p as PedidoParaViajes, prm, tiempos)
    // Viajes de otros pedidos del día (cualquier planta): un camión que quedaría en dos viajes a la vez se quita
    const ini = new Date(p.scheduled_arrival_time); ini.setHours(0, 0, 0, 0)
    const { data: otrosData } = await sb.from("viajes").select("*").neq("pedido_id", pedidoId).neq("estado", "cancelado")
      .gte("hora_carga", new Date(ini.getTime() - 6 * 60 * MIN).toISOString()).lt("hora_carga", new Date(ini.getTime() + 30 * 60 * MIN).toISOString())
    const otros = ((otrosData || []) as ViajeRow[])
    const sinGenerarChoque = generarViajes(ped, prm, existentes)
    const nuevos = generarViajes(ped, prm, existentes, otros)
    const quitados = nuevos.filter((v, i) => !v.mixer_id && sinGenerarChoque[i]?.mixer_id).map((v) => v.n)
    const antes = pendientes(existentes)
    const reemplazoManual = antes.some((v) => v.origen === "plan_dia" || v.origen === "gerenciador")
    const { error } = await guardarViajes(sb, pedidoId, [...existentes.filter((v) => v.estado !== "planificado"), ...nuevos], usuario, "automatico")
    if (error) return { error, generados: null, reemplazoManual: false }
    const detalle: Record<string, string> = existentes.length
      ? { Viajes: `recalculados por cambio de ${opts.motivo || "datos del pedido"}`, "Viajes pendientes": `${antes.length} → ${nuevos.length}` }
      : { Viajes: `armados al guardar el pedido (${nuevos.length})` }
    if (reemplazoManual) detalle.Aviso = "se reemplazaron horarios o camiones ajustados a mano (plan del día / gerenciador)"
    const td = tiemposDelPedido(p as PedidoParaViajes, prmBase, tiempos)
    if ([td.viaje, td.descarga, td.enPlanta].some((x) => x.fuente.startsWith("gps"))) detalle.Tiempos = textoTiempos(td)
    if (quitados.length) detalle["Camión quitado"] = `viaje${quitados.length > 1 ? "s" : ""} ${quitados.join(", ")}: con la hora nueva el camión estaría en otro viaje a la vez`
    await sb.from("activity_log").insert({
      user_name: usuario, action: "editar", entity: "pedido", entity_id: pedidoId,
      reference: (p as any).construction_sites?.name || null, plant_id: p.plant_id, details: detalle,
    })
    return { error: null, generados: nuevos.length, reemplazoManual }
  } catch (err: any) {
    return { ...nada, error: err?.message || "No se pudieron armar los viajes" }
  }
}
