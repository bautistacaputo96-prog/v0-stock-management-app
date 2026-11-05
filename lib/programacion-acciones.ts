/**
 * Acciones de la programación del día (docs/specs/2026-11-05-dia-unificado-y-mail.md, 3.4).
 *
 * El código que estaba dentro de components/programacion-dia.tsx (guardar la hora, el método, el plan del día y el 👍),
 * movido acá sin cambiar lo que hace, para que lo usen la vista de siempre y "Guardar y confirmar" del bloque. Más
 * `planGuardarYConfirmar` (pura): qué va a hacer el botón y el texto del cartel.
 * Solo se usa desde el navegador (Actividad con logActivity, como antes).
 */
import { logActivity } from "@/lib/activity-log"
import { guardarViajes, type ViajeRow } from "@/lib/viajes"
import { mismoReparto, horaArgentina, type Reparto } from "@/lib/reparto"

const MIN = 60_000
/** "HH:MM" de una hora ISO, en hora de Argentina */
export const hhAR = horaArgentina
/** La hora "HH:MM" del día `fecha` (yyyy-mm-dd) en Argentina, como Date */
export const horaDelDia = (fecha: string, hora: string) => new Date(`${fecha}T${hora}:00-03:00`)

export type PedidoAccion = {
  id: string
  plant_id: string
  scheduled_arrival_time: string
  metodo_descarga?: "bomba" | "directo" | null
  bomba_hora?: string | null
  bomba_la_pone?: string | null
  status?: string
  confirmado_at?: string | null
  suspendido_at?: string | null
  created_by?: string | null
  construction_sites?: { name?: string | null; travel_time_minutes?: number | null } | null
}

/**
 * La hora de llegada del primer camión (y la salida = llegada − viaje de la obra). Si la bomba estaba a la misma hora
 * que el primer camión, se mueve con él. Deja la línea en Actividad. No rearma los viajes (eso lo hace quien llama).
 */
export async function guardarHoraPedido(sb: any, p: PedidoAccion, fecha: string, hora: string): Promise<{ error: string | null }> {
  const llegada = horaDelDia(fecha, hora)
  const salida = new Date(llegada.getTime() - (p.construction_sites?.travel_time_minutes || 30) * MIN)
  const moverBomba = "bomba_hora" in p && p.bomba_hora && new Date(p.bomba_hora).getTime() === new Date(p.scheduled_arrival_time).getTime()
  const { error } = await sb.from("scheduled_dispatches")
    .update({ scheduled_arrival_time: llegada.toISOString(), scheduled_departure_time: salida.toISOString(), ...(moverBomba ? { bomba_hora: llegada.toISOString() } : {}) })
    .eq("id", p.id)
  if (error) return { error: error.message || "No se pudo guardar la hora" }
  await logActivity({ action: "editar", entity: "pedido", entityId: p.id, reference: p.construction_sites?.name || null, plantId: p.plant_id, details: { "Hora de llegada": `${hhAR(p.scheduled_arrival_time)} → ${hora}` } })
  return { error: null }
}

/**
 * El método de descarga. Al pasar a directo no queda nada de bomba (si la base ya tiene esas columnas).
 * `actividad`: deja la línea en Actividad (Guardar y confirmar); la vista de siempre no la dejaba (la deja el rearmado).
 */
export async function guardarMetodoPedido(sb: any, p: PedidoAccion, metodo: "bomba" | "directo", actividad = false): Promise<{ error: string | null; cambios: Record<string, unknown> }> {
  const limpiarBomba = metodo === "directo" && "bomba_la_pone" in p ? { bomba_la_pone: null, bomba_empresa_id: null, bomba_hora: null } : {}
  const cambios = { metodo_descarga: metodo, ...limpiarBomba }
  const { error } = await sb.from("scheduled_dispatches").update(cambios).eq("id", p.id)
  if (error) return { error: error.message || "No se pudo guardar el método", cambios }
  if (actividad && (p.metodo_descarga || null) !== metodo) {
    await logActivity({ action: "editar", entity: "pedido", entityId: p.id, reference: p.construction_sites?.name || null, plantId: p.plant_id, details: { "Método de descarga": `${p.metodo_descarga || "sin método"} → ${metodo}` } })
  }
  return { error: null, cambios }
}

/**
 * Guarda los viajes de varios pedidos ("Guardar plan del día"): por pedido, los no planificados quedan y los
 * planificados se reemplazan por `nuevos` (origen plan_dia), con Actividad (los 10 primeros viajes).
 */
export async function guardarPlanDia(
  sb: any,
  items: { pedido: { id: string; plant_id: string; nombre: string }; existentes: ViajeRow[]; nuevos: ViajeRow[] }[],
  patente: (mixerId: string | null) => string,
  usuario: string,
): Promise<{ ok: string[]; errores: string[] }> {
  const ok: string[] = [], errores: string[] = []
  for (const { pedido, existentes, nuevos } of items) {
    const fijos = existentes.filter((v) => v.estado !== "planificado")
    const { error } = await guardarViajes(sb, pedido.id, [...fijos, ...nuevos], usuario, "plan_dia")
    if (error) { errores.push(`${pedido.nombre}: ${error}`); continue }
    ok.push(pedido.nombre)
    const detalle: Record<string, string> = { Origen: "Plan del día", Viajes: String(nuevos.length) }
    nuevos.slice(0, 10).forEach((v) => { detalle[`Viaje ${v.n}`] = `carga ${hhAR(v.hora_carga)} · ${v.m3} m³ · ${patente(v.mixer_id) || "sin camión"}` })
    await logActivity({ action: "editar", entity: "pedido", entityId: pedido.id, reference: pedido.nombre, plantId: pedido.plant_id, details: detalle })
  }
  return { ok, errores }
}

/** El 👍 del día anterior (o quitarlo), con Actividad. */
export async function confirmarPedidos(sb: any, pedidos: PedidoAccion[], usuario: string, confirmar = true): Promise<{ ok: { id: string; cambios: Record<string, unknown> }[]; errores: string[] }> {
  const ok: { id: string; cambios: Record<string, unknown> }[] = [], errores: string[] = []
  for (const p of pedidos) {
    const cambios = confirmar ? { confirmado_at: new Date().toISOString(), confirmado_por: usuario } : { confirmado_at: null, confirmado_por: null }
    const { error } = await sb.from("scheduled_dispatches").update(cambios).eq("id", p.id)
    if (error) { errores.push(`${p.construction_sites?.name || "pedido"}: ${error.message || "no se pudo confirmar"}`); continue }
    ok.push({ id: p.id, cambios })
    await logActivity({ action: "editar", entity: "pedido", entityId: p.id, reference: p.construction_sites?.name || null, plantId: p.plant_id, details: { Confirmado: confirmar ? "no → sí (día anterior)" : "sí → no" } })
  }
  return { ok, errores }
}

// ---------------------------------------------------------------------------
// "Guardar y confirmar": qué va a hacer (puro)
// ---------------------------------------------------------------------------
export type AjustesPedidos = Record<string, { hora?: string; metodo?: "bomba" | "directo" }>

export type PlanGuardar = {
  horas: { pedido: PedidoAccion; hora: string }[]
  metodos: { pedido: PedidoAccion; metodo: "bomba" | "directo" }[]
  /** null = el reparto no cambió (o la tabla todavía no existe) */
  reparto: { reparto: Reparto; origen: "sugerido" | "a_mano" } | null
  viajes: { pedido: { id: string; plant_id: string; nombre: string }; existentes: ViajeRow[]; nuevos: ViajeRow[] }[]
  confirmar: PedidoAccion[]
  /** Pedidos con viajes ajustados a mano (gerenciador): se dejan como están salvo que se pida rearmarlos */
  manuales: { id: string; nombre: string }[]
  /** "Guardar y confirmar el jueves 05/11." */
  titulo: string
  /** "Se guarda el reparto de las dos plantas, los viajes de 3 pedidos y se confirman 2 (Santa Rita, Pampero)." */
  texto: string
}

const lista = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}` : xs[0] || "")

/**
 * Los pasos de "Guardar y confirmar" (3.4): horas y métodos cambiados, el reparto vigente (si cambió respecto de lo
 * guardado), los viajes de los pedidos de las dos plantas (las filas del resultado: lo que se ve es lo que se guarda) y
 * el 👍 de los pendientes no confirmados, no suspendidos y que la persona puede ajustar.
 */
export function planGuardarYConfirmar(args: {
  tituloDia: string
  pedidos: (PedidoAccion & { nombre: string })[]
  ajustes: AjustesPedidos
  resultado: { pedidos: { id: string; filas: ViajeRow[] }[] }
  viajesGuardados: Record<string, ViajeRow[]>
  vigente: Reparto | null
  guardado: Reparto | null
  repartoDisponible: boolean
  origen: "sugerido" | "a_mano"
  puedeAjustar: (p: PedidoAccion) => boolean
  /** Pedidos con viajes ajustados a mano (gerenciador) */
  manuales?: string[]
  /** El tilde del cartel: rearmar también los ajustados a mano (`resultado` tiene que venir rearmándolos) */
  rearmarManuales?: boolean
}): PlanGuardar {
  const { pedidos, ajustes } = args
  const horas = pedidos.flatMap((p) => (ajustes[p.id]?.hora && args.puedeAjustar(p) ? [{ pedido: p, hora: ajustes[p.id].hora! }] : []))
  const metodos = pedidos.flatMap((p) => (ajustes[p.id]?.metodo && args.puedeAjustar(p) && ajustes[p.id].metodo !== p.metodo_descarga ? [{ pedido: p, metodo: ajustes[p.id].metodo! }] : []))
  const reparto = args.repartoDisponible && args.vigente && !mismoReparto(args.vigente, args.guardado) ? { reparto: args.vigente, origen: args.origen } : null
  const manuales = new Set(args.manuales || [])
  // Solo los pedidos cuyos viajes cambian (los que quedan igual no se regraban ni dejan Actividad); los ajustados a mano,
  // solo con el tilde
  const viajes = args.resultado.pedidos.flatMap((r) => {
    const p = pedidos.find((x) => x.id === r.id)
    if (!p || !r.filas.length) return []
    if (manuales.has(p.id) && !args.rearmarManuales) return []
    const existentes = args.viajesGuardados[p.id] || []
    if (mismosViajes(existentes.filter((v) => v.estado === "planificado"), r.filas)) return []
    return [{ pedido: { id: p.id, plant_id: p.plant_id, nombre: p.nombre }, existentes, nuevos: r.filas }]
  })
  const confirmar = pedidos.filter((p) => !p.confirmado_at && !p.suspendido_at && p.status !== "completed" && p.status !== "cancelled" && args.puedeAjustar(p))
  const partes: string[] = []
  if (horas.length || metodos.length) partes.push(`${[horas.length ? `${horas.length} ${horas.length === 1 ? "hora" : "horas"}` : "", metodos.length ? `${metodos.length} ${metodos.length === 1 ? "método" : "métodos"}` : ""].filter(Boolean).join(" y ")} cambiados`)
  if (reparto) partes.push("el reparto de las dos plantas")
  if (viajes.length) partes.push(`los viajes de ${viajes.length} ${viajes.length === 1 ? "pedido" : "pedidos"}`)
  const conf = confirmar.length ? `se ${confirmar.length === 1 ? "confirma 1" : `confirman ${confirmar.length}`} (${lista(confirmar.map((p) => p.nombre))})` : ""
  const texto = partes.length
    ? `Se guarda ${lista(partes)}${conf ? ` y ${conf}` : ""}.`
    : conf ? `${conf.charAt(0).toUpperCase()}${conf.slice(1)}.` : "No hay nada para guardar ni confirmar."
  return {
    horas, metodos, reparto, viajes, confirmar, titulo: `Guardar y confirmar el ${args.tituloDia}.`, texto,
    manuales: pedidos.filter((p) => manuales.has(p.id)).map((p) => ({ id: p.id, nombre: p.nombre })),
  }
}

/** ¿Los viajes pendientes guardados son los mismos que los nuevos? (número, m³, horas y camión) */
export function mismosViajes(guardados: ViajeRow[], nuevos: ViajeRow[]) {
  if (guardados.length !== nuevos.length) return false
  const ord = (vs: ViajeRow[]) => [...vs].sort((a, b) => a.n - b.n)
  const t = (iso: string) => new Date(iso).getTime()
  const a = ord(guardados), b = ord(nuevos)
  return a.every((x, i) => {
    const y = b[i]
    return x.n === y.n && Number(x.m3) === Number(y.m3) && (x.mixer_id || null) === (y.mixer_id || null)
      && (["hora_carga", "hora_salida", "hora_llegada", "hora_fin_descarga", "hora_vuelta"] as const).every((k) => t(x[k]) === t(y[k]))
  })
}
