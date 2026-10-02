/**
 * Viajes de un pedido (fase 2): el motor que los arma está SOLO acá.
 *
 * Lo usan el formulario del pedido (Semana), la vista Día ("Ordenar el día" / "Guardar plan del día"),
 * el gerenciador de viajes y las ediciones de hora o total. Por dentro usa el planificador que ya
 * existía (lib/planificador.ts), así un pedido solo y el día entero se calculan con las mismas reglas:
 *   - m³ por viaje = m3_por_viaje del pedido (8 por defecto), el último con el resto;
 *   - el primero llega a la hora pedida; los siguientes, separados por el espaciado del pedido
 *     o, si no tiene, por la descarga de la planta (bomba o directo);
 *   - la carga empieza ida + carga antes de la llegada; la planta carga de a `bocas_carga` camiones.
 * Los viajes despachados no se tocan: solo se regeneran los planificados.
 * Se guardan con una sola función de la base (guardar_viajes_pedido): todo o nada.
 * Los viajes no tocan stock.
 */
import { planificar, aMin, parametrosDePlanta, type Parametros, type Camion, type Plan } from "@/lib/planificador"

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
  construction_sites?: { name?: string | null; travel_time_minutes?: number | null; requires_pump?: boolean | null } | null
}

const MIN = 60_000

export const viajeMinDe = (p: PedidoParaViajes) => p.construction_sites?.travel_time_minutes || 30
export const conBombaDe = (p: PedidoParaViajes) =>
  (p.metodo_descarga || (p.construction_sites?.requires_pump ? "bomba" : "directo")) === "bomba"
export const m3PorViajeDe = (p: PedidoParaViajes) => (Number(p.m3_por_viaje) > 0 ? Number(p.m3_por_viaje) : 8)

/** Minutos de descarga de un viaje (la misma regla del planificador: proporcional a los m³, mínimo 5). */
export function descargaDe(p: PedidoParaViajes, m3: number, prm: Parametros) {
  const base8 = conBombaDe(p) ? prm.descargaBombaMin : prm.descargaDirectaMin
  return Math.max(5, Math.round((base8 * m3) / 8))
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
export function generarViajes(p: PedidoParaViajes, prm: Parametros, existentes: ViajeRow[] = []): ViajeRow[] {
  const { base, pendiente, llegada } = entradaPedido(p, existentes, prm)
  if (pendiente <= 0.01) return []
  const tam = m3PorViajeDe(p)
  const virtuales: Camion[] = Array.from({ length: Math.ceil(pendiente / tam) + 1 }, (_, i) => ({ id: `v${i}`, patente: "", capacidad: 1000 }))
  const plan = planificar(
    [{ id: p.id, cliente: "", obra: "", m3: pendiente, llegada, viajeMin: viajeMinDe(p), conBomba: conBombaDe(p), m3PorViaje: tam, espaciadoMin: Number(p.espaciado_min) > 0 ? Number(p.espaciado_min) : null }],
    virtuales,
    prm,
  )
  const anteriores = pendientes(existentes)
  return aFilas(p, base, plan.viajes, existentes, (_, i) => anteriores[i]?.mixer_id ?? p.mixer_id ?? null)
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
      m3PorViaje: m3PorViajeDe(p), espaciadoMin: Number(p.espaciado_min) > 0 ? Number(p.espaciado_min) : null,
    })),
    camiones,
    prm,
  )
  const filas: Record<string, ViajeRow[]> = {}
  for (const { p } of entradas) {
    const vs = plan.viajes.filter((v) => v.pedidoId === p.id)
    filas[p.id] = aFilas(p, base, vs, viajesPorPedido[p.id] || [], (v) => v.camionId)
  }
  return { plan, filas }
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
  return [...vs, {
    pedido_id: p.id, plant_id: p.plant_id, n, m3,
    hora_carga: carga.toISOString(), hora_salida: salida.toISOString(), hora_llegada: llegada.toISOString(),
    hora_fin_descarga: fin.toISOString(), hora_vuelta: vuelta.toISOString(),
    mixer_id: ult?.mixer_id ?? p.mixer_id ?? null, estado: "planificado",
  }]
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
    const nuevos = generarViajes(p as PedidoParaViajes, parametrosDePlanta(planta), existentes)
    const antes = pendientes(existentes)
    const reemplazoManual = antes.some((v) => v.origen === "plan_dia" || v.origen === "gerenciador")
    const { error } = await guardarViajes(sb, pedidoId, [...existentes.filter((v) => v.estado !== "planificado"), ...nuevos], usuario, "automatico")
    if (error) return { error, generados: null, reemplazoManual: false }
    const detalle: Record<string, string> = existentes.length
      ? { Viajes: `recalculados por cambio de ${opts.motivo || "datos del pedido"}`, "Viajes pendientes": `${antes.length} → ${nuevos.length}` }
      : { Viajes: `armados al guardar el pedido (${nuevos.length})` }
    if (reemplazoManual) detalle.Aviso = "se reemplazaron horarios o camiones ajustados a mano (plan del día / gerenciador)"
    await sb.from("activity_log").insert({
      user_name: usuario, action: "editar", entity: "pedido", entity_id: pedidoId,
      reference: (p as any).construction_sites?.name || null, plant_id: p.plant_id, details: detalle,
    })
    return { error: null, generados: nuevos.length, reemplazoManual }
  } catch (err: any) {
    return { ...nada, error: err?.message || "No se pudieron armar los viajes" }
  }
}
