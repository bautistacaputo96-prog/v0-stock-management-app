/**
 * Zomatik · Z2 · Nota de pedido: el lado del servidor (SOLO rutas de app/api). Spec: zomatik.md, secciones 22 a 24.
 *
 *   sincronizarPedido  mira el pedido y sus NP, decide con `planificarNp` (np.ts) qué crear, vaciar o anular y lo deja
 *                      en `zomatik_np` como "pendiente" / "vaciar". No habla con Zomatik.
 *   procesarNp         toma el turno del robot (una sola sesión a la vez) y trabaja las NP pendientes con
 *                      `np-robot.ts`, guardando cada paso. Lo llaman "Programar y generar NP" (después de responder),
 *                      "Generar NP ahora" y la pasada cada 10 min.
 *
 * LLAVE: con `zomatik_np_config.activo` apagado (por defecto) no se crea ninguna NP ni se llama a Zomatik para
 * escribir: `llaveDe()` es el único lugar que arma la llave que pide `navegadorNp()`. La llave, el modo y la elección
 * del pedido (`zomatik_np_pedido`) viven en tablas que solo escribe el servidor (la clave anon no las toca).
 *
 * Tiempo: cada función de Vercel tiene 60 s. `procesarNp` mide desde que empezó el request (`inicio`) y no arranca una
 * NP si quedan menos de 30 s; el turno del robot se renueva en cada paso. Cada guardado del robot pide que la NP siga
 * "generando"/"vaciando" (si otro la cambió en el medio, no se pisa y se avisa).
 */
import { sbServicio } from "@/lib/auth/servidor"
import { discoverForm, fetchExport, navegadorNp, obtenerSesion, mensajeZomatik } from "@/lib/zomatik/cliente"
import { renglonesRemitos } from "@/lib/zomatik/parseo"
import { generarNp, vaciarNp, type DatosNp, type LlaveNp, type NavegadorNp, type ResultadoNp } from "@/lib/zomatik/np-robot"
import { quedaTiempo, trabajoPendiente } from "@/lib/zomatik/np"
import {
  MIN_REINTENTO, VIGENTES, comprobanteDe, puedeEstarGrabada, comprobanteDeNumero, diaAR, esSerieRebucret, hoyAR, marcaNp, modoNp, numeroNormalizado,
  pedidoConNp, planificarNp, controlDespacho, npConSaldo, saldoNp, type EstadoNp, type FilaNp, type ModoNp, type PlantaNp, type SaldoNp, type TipoNp, type UsoPlan, type UsoSaldo,
} from "@/lib/zomatik/np"

type SB = ReturnType<typeof sbServicio>

export type FilaNpDB = FilaNp & {
  scheduled_dispatch_id: string | null
  marca: string
  es_adicional: boolean
  paso: string | null
  mensaje: string | null
  numero: string | null
  zomatik_codigo: number | null
  sucursal: string | null
  disponible_m3: number | null
  intentos: number
  proximo_intento: string | null
  en_curso_desde: string | null
  created_at: string
  updated_at: string
  saldo_decision?: string | null
  saldo_mensaje?: string | null
  saldo_desde?: string | null
  fecha_zomatik?: string | null
  vendedor_usuario_id?: string | null
}

export const COLUMNAS_NP =
  "id, scheduled_dispatch_id, n, marca, tipo, es_adicional, proyecto_codigo, plant_id, client_id, formula_id, fecha, m3, estado, paso, mensaje, numero, zomatik_codigo, sucursal, disponible_m3, intentos, proximo_intento, en_curso_desde, created_at, updated_at, saldo_decision, saldo_mensaje, saldo_desde, fecha_zomatik, vendedor_usuario_id"

const COLUMNAS_PEDIDO =
  "id, status, quantity_m3, plant_id, client_id, construction_site_id, formula_id, scheduled_arrival_time, created_at, created_by"

export type PlantaNpDB = PlantaNp & { id: string; name: string; zomatik_deposito: number | null }

/** ¿Falta la migración de Z2? (las rutas responden "apagado" en vez de romper). */
export const faltaMigracion = (e: unknown) => /\b(zomatik_np(_config|_pedido|_excepciones)?|zomatik_np_tomar|zomatik_robot_tomar|zomatik_robot_soltar|zomatik_np_uso|zomatik_vendedores|saldo_decision|saldo_mensaje|saldo_desde|fecha_zomatik|vendedor_usuario_id|despachado_fijo|zomatik_np_reservar|zomatik_np_devolver|zomatik_np_desvincular|codigo_sistema|disponible_m3|disponible_articulo|disponible_at|zomatik_proyecto_codigo)\b/i.test(String((e as { message?: string })?.message || ""))

// ---------------------------------------------------------------------------
// Plantas y llave
// ---------------------------------------------------------------------------

type ConfigDB = { plant_id: string; activo: boolean; desde: string | null; deposito: number | null; exigir_np: string | null; aviso_hasta: string | null }

/** Plantas con su llave (de `zomatik_np_config`; sin fila = apagada). Sin la migración: vacío (todo apagado). */
export async function plantasNp(sb: SB = sbServicio()): Promise<Record<string, PlantaNpDB>> {
  const [pl, cfg] = await Promise.all([sb.from("plants").select("id, name"), sb.from("zomatik_np_config").select("plant_id, activo, desde, deposito, exigir_np, aviso_hasta")])
  if (cfg.error) {
    if (faltaMigracion(cfg.error)) return {}
    throw cfg.error
  }
  if (pl.error) throw pl.error
  const porPlanta = new Map(((cfg.data as ConfigDB[]) || []).map((c) => [c.plant_id, c]))
  return Object.fromEntries(
    ((pl.data as { id: string; name: string }[]) || []).map((p) => {
      const c = porPlanta.get(p.id)
      return [p.id, { id: p.id, name: p.name, zomatik_np_activo: c?.activo === true, zomatik_np_desde: c?.desde ?? null, zomatik_deposito: c?.deposito ?? null, exigir_np: c?.exigir_np ?? "aviso", aviso_hasta: c?.aviso_hasta ?? null }]
    }),
  )
}

/** El ÚNICO lugar que arma la llave para escribir en Zomatik: solo con la llave de la planta prendida en la base. */
export function llaveDe(planta: PlantaNpDB | undefined): LlaveNp | null {
  return planta?.zomatik_np_activo === true ? { activo: true, plantId: planta.id } : null
}

export function modoDe(planta: PlantaNpDB | undefined): ModoNp {
  return modoNp(planta, hoyAR())
}

// ---------------------------------------------------------------------------
// Actividad y avisos
// ---------------------------------------------------------------------------

export async function actividadNp(sb: SB, o: { usuario: string; action?: "crear" | "editar" | "borrar"; pedidoId: string | null; plantId?: string | null; referencia: string; detalle: Record<string, unknown> }) {
  try {
    const { error } = await sb.from("activity_log").insert({
      user_name: o.usuario, action: o.action || "editar", entity: "zomatik_np", entity_id: o.pedidoId, reference: o.referencia, plant_id: o.plantId ?? null, details: o.detalle,
    })
    if (error) console.error("[zomatik-np] actividad:", error.message)
  } catch (e) {
    console.error("[zomatik-np] actividad:", e)
  }
}

/** Los que autorizan y revisan (20.1.2): reciben el aviso por mail cuando una NP queda "revisar". */
export const GERENCIALES_NP = ["Bautista Caputo", "Juan Oreguy", "Fernando Maldonado"]
const FROM = process.env.REPORTE_CALIDAD_FROM || "reportes@produccionrebucret.com"
const esc = (t: unknown) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)

/** Aviso en el momento a los gerenciales (mail por Resend, como las alertas). Nunca corta la operación. */
export async function avisarGerenciales(sb: SB, titulo: string, lineas: string[]): Promise<{ enviado: boolean; motivo?: string }> {
  try {
    if (!process.env.RESEND_API_KEY) return { enviado: false, motivo: "falta RESEND_API_KEY" }
    const { data } = await sb.from("app_users").select("name, email").eq("active", true).not("email", "is", null)
    const a = ((data || []) as { name: string; email: string }[]).filter((u) => GERENCIALES_NP.some((n) => n.toLowerCase() === u.name.trim().toLowerCase())).map((u) => u.email)
    if (!a.length) return { enviado: false, motivo: "los gerenciales no tienen mail cargado" }
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
      <div style="background:#b45309;color:#fff;padding:12px 16px;border-radius:8px 8px 0 0;font-weight:700">${esc(titulo)}</div>
      <div style="border:1px solid #e2e8f0;border-top:none;padding:12px 16px;border-radius:0 0 8px 8px;font-size:13px">
      ${lineas.map((l) => `<p style="margin:0 0 6px">${esc(l)}</p>`).join("")}
      <p style="font-size:11px;color:#94a3b8;margin-top:12px">Programación › NP · produccionrebucret.com</p></div></div>`
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `Rebucret - Zomatik <${FROM}>`, to: a, subject: `Rebucret · ${titulo}`, html }),
    })
    return r.ok ? { enviado: true } : { enviado: false, motivo: `Resend respondió ${r.status}` }
  } catch (e) {
    return { enviado: false, motivo: (e as Error)?.message || "no se pudo mandar" }
  }
}

// ---------------------------------------------------------------------------
// Usos y saldo de las NP (Z2b: una NP puede servir a varios pedidos)
// ---------------------------------------------------------------------------

export type UsoDB = { id: string; np_id: string; scheduled_dispatch_id: string | null; m3: number; activo: boolean; motivo: string | null; created_at: string; despachado_fijo: number | null }
const COLUMNAS_USO = "id, np_id, scheduled_dispatch_id, m3, activo, motivo, created_at, despachado_fijo"

/** RPC que tiene que andar (si falla, se corta: nunca se escribe una reserva a medias). */
async function rpc(sb: SB, nombre: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await sb.rpc(nombre, args)
  if (error) throw error
  return data
}

async function usosDe(sb: SB, campo: "np_id" | "scheduled_dispatch_id", ids: string[]): Promise<UsoDB[]> {
  if (!ids.length) return []
  const { data, error } = await sb.from("zomatik_np_uso").select(COLUMNAS_USO).in(campo, ids)
  if (error) throw error
  return (data as unknown as UsoDB[]) || []
}

/** Saldo de cada NP: reparte lo despachado de cada pedido entre sus NP (np.ts, `saldoNp`). */
export async function saldosDe(sb: SB, nps: { id: string; m3: number }[]): Promise<Map<string, SaldoNp>> {
  const out = new Map<string, SaldoNp>()
  if (!nps.length) return out
  const deNps = await usosDe(sb, "np_id", nps.map((x) => x.id))
  const pedidoIds = [...new Set(deNps.map((u) => u.scheduled_dispatch_id).filter(Boolean) as string[])]
  const dePedidos = await usosDe(sb, "scheduled_dispatch_id", pedidoIds)
  const todos = [...new Map([...deNps, ...dePedidos].map((u) => [u.id, u])).values()]
  const { data: peds, error } = pedidoIds.length ? await sb.from("scheduled_dispatches").select("id, status, dispatched_m3").in("id", pedidoIds) : { data: [], error: null }
  if (error) throw error
  const porId = new Map(((peds as { id: string; status: string; dispatched_m3: number | null }[]) || []).map((p) => [p.id, p]))
  const usos: UsoSaldo[] = todos.map((u) => ({ id: u.id, np_id: u.np_id, m3: Number(u.m3), activo: u.activo, created_at: u.created_at, despachado_fijo: u.despachado_fijo === null || u.despachado_fijo === undefined ? null : Number(u.despachado_fijo), pedido: u.scheduled_dispatch_id ? porId.get(u.scheduled_dispatch_id) || null : null }))
  for (const np of nps) out.set(np.id, saldoNp({ id: np.id, m3: Number(np.m3) }, usos))
  return out
}

// ---------------------------------------------------------------------------
// Sincronizar un pedido (sin Zomatik)
// ---------------------------------------------------------------------------

export type Eleccion = { tipo: TipoNp | "saldo"; proyecto_codigo?: number | null; tope_m3?: number | null; np_id?: string | null }

export type ResultadoSync =
  | { activo: false; motivo: string }
  | { activo: true; fuera?: boolean; error?: string; creadas: number; usadas: number; desvinculadas: number; anuladas: number; avisos: string[]; nps: FilaNpDB[] }

type PedidoDB = {
  id: string; status: string; quantity_m3: number; plant_id: string; client_id: string; construction_site_id: string | null; formula_id: string
  scheduled_arrival_time: string; created_at: string; created_by: string | null
}

export type EleccionDB = { tipo: TipoNp | "saldo"; proyecto_codigo: number | null; tope_m3: number | null; np_id: string | null }

export async function eleccionesDe(sb: SB, ids: string[]): Promise<Record<string, EleccionDB>> {
  if (!ids.length) return {}
  const { data, error } = await sb.from("zomatik_np_pedido").select("scheduled_dispatch_id, tipo, proyecto_codigo, tope_m3, np_id").in("scheduled_dispatch_id", ids)
  if (error) throw error
  return Object.fromEntries(
    ((data as (EleccionDB & { scheduled_dispatch_id: string })[]) || []).map((e) => [
      e.scheduled_dispatch_id,
      { tipo: e.tipo, proyecto_codigo: e.proyecto_codigo ?? null, tope_m3: e.tope_m3 === null || e.tope_m3 === undefined ? null : Number(e.tope_m3), np_id: e.np_id ?? null },
    ]),
  )
}

/** El proyecto tiene que estar abierto y ser del cliente (no se confía en lo que manda el navegador). */
async function validarProyecto(sb: SB, clientId: string, codigo: number): Promise<string | null> {
  const [{ data: c }, { data: p }] = await Promise.all([
    sb.from("clients").select("zomatik_codigo").eq("id", clientId).maybeSingle(),
    sb.from("zomatik_proyectos").select("codigo, cliente_codigo, estado").eq("codigo", codigo).maybeSingle(),
  ])
  const zc = (c as { zomatik_codigo?: number | null } | null)?.zomatik_codigo
  const pr = p as { cliente_codigo: number | null; estado: string } | null
  if (!pr) return "Ese proyecto no está en la copia de Zomatik."
  if (pr.estado !== "abierto") return "Ese proyecto ya no está abierto en Zomatik."
  if (!zc || pr.cliente_codigo !== zc) return "Ese proyecto es de otro cliente en Zomatik."
  return null
}

/** Artículo de Zomatik de una fórmula (para comparar NP con saldo: mismo cliente y artículo). */
async function articuloDe(sb: SB, formulaIds: string[]): Promise<Map<string, number | null>> {
  const ids = [...new Set(formulaIds.filter(Boolean))]
  if (!ids.length) return new Map()
  const { data } = await sb.from("formulas").select("id, zomatik_articulo_codigo").in("id", ids)
  return new Map(((data as { id: string; zomatik_articulo_codigo: number | null }[]) || []).map((f) => [f.id, f.zomatik_articulo_codigo ?? null]))
}

/** Una NP con saldo sirve para el pedido si está en Zomatik, es del mismo cliente y artículo y no se cerró ni se manda a devolver. */
async function validarSaldo(sb: SB, ped: PedidoDB, npId: string): Promise<{ error: string } | { libre: number }> {
  const { data } = await sb.from("zomatik_np").select(COLUMNAS_NP).eq("id", npId).maybeSingle()
  const np = data as unknown as FilaNpDB | null
  if (!np || np.estado !== "ok") return { error: "Esa NP no está en Zomatik." }
  if (np.saldo_decision === "cerrada" || np.saldo_decision === "devolver") return { error: "Esa NP ya se cerró o se está devolviendo." }
  if (np.client_id !== ped.client_id) return { error: "Esa NP es de otro cliente." }
  const art = await articuloDe(sb, [np.formula_id || "", ped.formula_id])
  const a1 = art.get(np.formula_id || ""), a2 = art.get(ped.formula_id)
  if (np.formula_id !== ped.formula_id && (!a1 || a1 !== a2)) return { error: "Esa NP es de otro artículo (fórmula)." }
  const s = (await saldosDe(sb, [np])).get(np.id)
  return { libre: s?.libre ?? 0 }
}

export async function npsDePedidos(sb: SB, ids: string[]): Promise<FilaNpDB[]> {
  if (!ids.length) return []
  const { data, error } = await sb.from("zomatik_np").select(COLUMNAS_NP).in("scheduled_dispatch_id", ids).order("n")
  if (error) throw error
  return (data as unknown as FilaNpDB[]) || []
}

async function npsPorId(sb: SB, ids: string[]): Promise<FilaNpDB[]> {
  if (!ids.length) return []
  const { data, error } = await sb.from("zomatik_np").select(COLUMNAS_NP).in("id", ids)
  if (error) throw error
  return (data as unknown as FilaNpDB[]) || []
}

const vacio = (nps: FilaNpDB[], extra: Partial<Extract<ResultadoSync, { activo: true }>> = {}): ResultadoSync => ({ activo: true, creadas: 0, usadas: 0, desvinculadas: 0, anuladas: 0, avisos: [], nps, ...extra })

export async function sincronizarPedido(pedidoId: string, usuario: string, eleccion?: Eleccion | null, sb: SB = sbServicio(), opciones: { mover_fecha?: boolean | null; usuarioId?: string | null } = {}): Promise<ResultadoSync> {
  const { data: p, error } = await sb.from("scheduled_dispatches").select(COLUMNAS_PEDIDO).eq("id", pedidoId).maybeSingle()
  if (error) throw error
  if (!p) return { activo: false, motivo: "El pedido no existe" }
  const ped = p as unknown as PedidoDB
  const plantas = await plantasNp(sb)
  const planta = plantas[ped.plant_id]
  if (!planta?.zomatik_np_activo) return { activo: false, motivo: "NP: se carga a mano en Zomatik" }
  let usos = (await usosDe(sb, "scheduled_dispatch_id", [ped.id])).filter((u) => u.activo)
  const propias = await npsDePedidos(sb, [ped.id])
  // Un pedido de antes de prender la llave no tiene NP automática (salvo que ya tenga alguna del sistema)
  if (!pedidoConNp(planta, ped.created_at) && !usos.length && !propias.length) return vacio([], { fuera: true })

  // Elección del formulario (NP nueva, de un proyecto o una NP con saldo): se valida y se guarda (solo el servidor)
  let el: EleccionDB = (await eleccionesDe(sb, [ped.id]))[ped.id] || { tipo: "nueva", proyecto_codigo: null, tope_m3: null, np_id: null }
  if (eleccion && (eleccion.tipo === "nueva" || eleccion.tipo === "proyecto" || eleccion.tipo === "saldo")) {
    const proy = eleccion.tipo === "proyecto" && Number(eleccion.proyecto_codigo) > 0 ? Number(eleccion.proyecto_codigo) : null
    const npSaldo = eleccion.tipo === "saldo" && typeof eleccion.np_id === "string" && eleccion.np_id.length > 0 && eleccion.np_id.length <= 64 ? eleccion.np_id : null
    const tipo: EleccionDB["tipo"] = proy ? "proyecto" : npSaldo ? "saldo" : "nueva"
    const tope = proy && eleccion.tope_m3 !== null && eleccion.tope_m3 !== undefined && Number(eleccion.tope_m3) >= 0 ? Number(eleccion.tope_m3) : null
    if (eleccion.tipo === "proyecto" && !proy) return vacio(propias, { error: "Elegí el proyecto." })
    if (eleccion.tipo === "saldo" && !npSaldo) return vacio(propias, { error: "Elegí la NP con saldo." })
    const invalido = proy ? await validarProyecto(sb, ped.client_id, proy) : null
    if (invalido) return vacio(propias, { error: invalido })
    if (npSaldo && !usos.some((u) => u.np_id === npSaldo)) {
      const v = await validarSaldo(sb, ped, npSaldo)
      if ("error" in v) return vacio(propias, { error: v.error })
    }
    if (tipo !== el.tipo || proy !== el.proyecto_codigo || tope !== el.tope_m3 || npSaldo !== el.np_id) {
      const { error: e1 } = await sb.from("zomatik_np_pedido").upsert({ scheduled_dispatch_id: ped.id, tipo, proyecto_codigo: proy, tope_m3: tope, np_id: npSaldo, updated_by: usuario, updated_at: new Date().toISOString() } as never, { onConflict: "scheduled_dispatch_id" })
      if (e1) throw e1
      el = { tipo, proyecto_codigo: proy, tope_m3: tope, np_id: npSaldo }
    }
    if (proy && ped.construction_site_id) await sb.from("construction_sites").update({ zomatik_proyecto_codigo: proy } as never).eq("id", ped.construction_site_id)
  }

  // Lo que usa el pedido, con lo libre de cada NP
  const npsUso = await npsPorId(sb, usos.map((u) => u.np_id))
  const saldoElegida = el.tipo === "saldo" && el.np_id && !usos.some((u) => u.np_id === el.np_id) ? await validarSaldo(sb, ped, el.np_id) : null
  const saldos = await saldosDe(sb, npsUso)
  const usoPlan: UsoPlan[] = usos
    .map((u) => ({ u, np: npsUso.find((x) => x.id === u.np_id) }))
    .filter((x) => !!x.np)
    .sort((a, b) => a.u.created_at.localeCompare(b.u.created_at))
    .map(({ u, np }) => ({ uso_id: u.id, m3: Number(u.m3), np: np!, libre: Math.max(0, saldos.get(np!.id)?.libre ?? 0) }))
  const fecha = diaAR(ped.scheduled_arrival_time)
  const plan = planificarNp(
    {
      id: ped.id, status: ped.status, quantity_m3: Number(ped.quantity_m3), plant_id: ped.plant_id, client_id: ped.client_id, formula_id: ped.formula_id, fecha,
      np_tipo: el.tipo, proyecto_codigo: el.proyecto_codigo, proyecto_tope_m3: el.tope_m3,
      saldo_np: saldoElegida && "libre" in saldoElegida && el.np_id ? { id: el.np_id, libre: saldoElegida.libre } : null,
      mover_fecha: opciones.mover_fecha ?? null,
    },
    usoPlan,
    propias.reduce((m, x) => Math.max(m, x.n || 0), 0),
  )
  const ahora = new Date().toISOString()
  const ref = `Pedido ${ped.id.slice(0, 8)}`
  const log = (detalle: Record<string, unknown>, action: "crear" | "editar" = "editar") => actividadNp(sb, { usuario, action, pedidoId: ped.id, plantId: ped.plant_id, referencia: ref, detalle })

  // Anular lo que no llegó a Zomatik. Si el robot tomó alguna en el medio (ya no está pendiente/error), se anulan
  // menos de las planeadas: entonces NO se crea ni se usa nada; la próxima sincronización vuelve a planear.
  let anuladas = 0
  if (plan.anular.length) {
    const { data: an, error: ea } = await sb.from("zomatik_np").update({ estado: "anulada", mensaje: ped.status === "cancelled" ? "El pedido se canceló antes de generarla" : "Se rehízo con los datos nuevos del pedido", proximo_intento: null, updated_at: ahora } as never).in("id", plan.anular).in("estado", ["pendiente", "error"]).select("id")
    if (ea) throw ea
    const ids = ((an as { id: string }[]) || []).map((x) => x.id)
    anuladas = ids.length
    // El uso se desactiva con la foto de lo despachado (en modo aviso se pudo despachar con la NP pendiente)
    for (const u of usos.filter((x) => ids.includes(x.np_id))) await rpc(sb, "zomatik_np_desvincular", { p_uso: u.id, p_motivo: "NP anulada" })
  }
  const incompleto = anuladas < plan.anular.length
  if (incompleto) plan.avisos.push("Una NP se estaba generando mientras se cambiaba el pedido: se vuelve a mirar en la próxima pasada.")
  if (plan.revisar.length) {
    const msg = "El pedido se canceló y esta NP se cortó al grabar: puede estar en Zomatik. Buscala por la marca y decidí qué hacer con el saldo."
    await sb.from("zomatik_np").update({ estado: "revisar", mensaje: msg, proximo_intento: null, updated_at: ahora } as never).in("id", plan.revisar).in("estado", ["pendiente", "error"])
    await avisarGerenciales(sb, "NP para revisar (pedido cancelado)", [msg, ...npsUso.filter((x) => plan.revisar.includes(x.id)).map((x) => `Marca: ${x.marca}`)])
  }
  for (const d of plan.desvincular) {
    // Desactiva el uso guardando la foto de lo despachado contra esa NP hasta ahora (no le toca lo que venga después)
    await rpc(sb, "zomatik_np_desvincular", { p_uso: d.uso_id, p_motivo: d.motivo })
    const np = usoPlan.find((x) => x.uso_id === d.uso_id)?.np
    if (np) await sb.from("zomatik_np").update({ saldo_mensaje: `Sin pedido: ${d.motivo}`, updated_at: ahora } as never).eq("id", np.id)
    await log({ "Qué pasó": `${np?.numero || "La NP"} queda pendiente con su saldo (${d.motivo})` })
  }
  for (const id of plan.mover_fecha) {
    const np = npsUso.find((x) => x.id === id)
    await sb.from("zomatik_np").update({ fecha, updated_at: ahora } as never).eq("id", id) // solo en nuestro sistema: en Zomatik no hace falta (25.5)
    await log({ "Qué pasó": `${np?.numero || "La NP"} se movió a la nueva fecha del pedido (${fecha}), en el sistema` })
  }
  // Reservas (agrandar/achicar lo que usa de sus NP, y usar una NP con saldo): en la base, con la NP bloqueada. Si otro
  // tomó el saldo en el medio, se reserva menos y lo que falte va en una NP nueva.
  let falta = 0
  let usadas = 0
  if (!incompleto) {
    for (const a of plan.ajustar) {
      const u = usoPlan.find((x) => x.uso_id === a.uso_id)
      if (!u) continue
      const dado = Number(await rpc(sb, "zomatik_np_reservar", { p_np: u.np.id, p_pedido: ped.id, p_m3: a.m3, p_usuario: usuario })) || 0
      if (a.m3 > u.m3) falta += Math.max(0, a.m3 - dado)
    }
    if (plan.ajustar.length) await log({ "Qué pasó": "Cambió lo que el pedido usa de sus NP", Detalle: plan.ajustar.map((a) => `${a.m3} m³`).join(", ") })
    for (const u of plan.usar) {
      const dado = Number(await rpc(sb, "zomatik_np_reservar", { p_np: u.np_id, p_pedido: ped.id, p_m3: u.m3, p_usuario: usuario })) || 0
      falta += Math.max(0, u.m3 - dado)
      if (dado > 0) {
        usadas++
        await log({ "Qué pasó": `El pedido usa ${dado} m³ de una NP con saldo (reprogramado)`, NP: npsUso.find((x) => x.id === u.np_id)?.numero || u.np_id }, "crear")
      }
    }
  }
  const crear = incompleto ? [] : [...plan.crear]
  if (falta > 0.001) {
    const n = Math.max(0, ...crear.map((c) => c.n), ...propias.map((x) => x.n || 0))
    crear.push({ n: n + 1, tipo: "nueva", m3: Math.round(falta * 1000) / 1000, proyecto_codigo: null, es_adicional: true })
    plan.avisos.push(`Otro pedido tomó parte del saldo en el mismo momento: ${Math.round(falta * 1000) / 1000} m³ van en una NP nueva.`)
  }
  let creadas = 0
  for (const c of crear) {
    const fila = {
      scheduled_dispatch_id: ped.id, n: c.n, marca: marcaNp(ped.id, c.n), tipo: c.tipo, es_adicional: c.es_adicional, proyecto_codigo: c.proyecto_codigo,
      plant_id: ped.plant_id, client_id: ped.client_id, formula_id: ped.formula_id, fecha, m3: c.m3, estado: "pendiente", proximo_intento: ahora, created_by: usuario,
      // El vendedor de la NP: el de quien guarda el pedido ahora (sesión del servidor), no el que lo cargó primero
      vendedor_usuario_id: opciones.usuarioId ?? null,
    }
    const { data: nueva, error: e2 } = await sb.from("zomatik_np").insert(fila as never).select("id")
    if (e2) {
      if ((e2 as { code?: string }).code === "23505") continue // otro proceso la creó recién
      throw e2
    }
    const npId = ((nueva as { id: string }[] | null) || [])[0]?.id
    if (npId) await sb.from("zomatik_np_uso").insert({ np_id: npId, scheduled_dispatch_id: ped.id, m3: c.m3, created_by: usuario } as never)
    creadas++
    await log({ "Qué pasó": c.es_adicional ? `NP adicional por ${c.m3} m³ (el pedido se agrandó)` : `NP ${c.tipo === "proyecto" ? `contra el proyecto ${c.proyecto_codigo}` : "nueva"} por ${c.m3} m³: pendiente de generar`, Marca: fila.marca }, "crear")
  }
  // Los avisos no se repiten: si el último aviso de este pedido dice lo mismo, no se vuelve a grabar
  if (plan.avisos.length) {
    const texto = plan.avisos.join(" · ")
    const { data: ult } = await sb.from("activity_log").select("details").eq("entity", "zomatik_np").eq("entity_id", ped.id).eq("reference", ref).order("created_at", { ascending: false }).limit(20)
    const yaEsta = ((ult as { details: { Aviso?: string } | null }[]) || []).some((x) => x.details?.Aviso === texto)
    if (!yaEsta) await log({ "Qué pasó": "Aviso de la NP", Aviso: texto })
  }
  await marcarPendientes(sb, [...new Set([...(await usosDe(sb, "scheduled_dispatch_id", [ped.id])).map((u) => u.np_id), ...propias.map((x) => x.id)])], ahora)
  usos = (await usosDe(sb, "scheduled_dispatch_id", [ped.id])).filter((u) => u.activo)
  const nps = await npsPorId(sb, usos.map((u) => u.np_id))
  return { activo: true, creadas, usadas, desvinculadas: plan.desvincular.length, anuladas, avisos: plan.avisos, nps }
}

/**
 * "NP con saldo: pendiente" desde cuándo (precisión del 23/10): una NP en Zomatik con saldo y sin pedido activo queda
 * pendiente desde que pasó (sin preguntar ni vencer); si vuelve a tener un pedido activo, deja de estarlo.
 */
async function marcarPendientes(sb: SB, npIds: string[], ahora: string) {
  const nps = (await npsPorId(sb, npIds)).filter((x) => x.estado === "ok")
  if (!nps.length) return
  const saldos = await saldosDe(sb, nps)
  for (const x of nps) {
    const pendiente = npConSaldo(x, saldos.get(x.id)!)
    if (pendiente && !x.saldo_desde) await sb.from("zomatik_np").update({ saldo_desde: ahora } as never).eq("id", x.id).is("saldo_desde", null)
    if (!pendiente && x.saldo_desde && x.saldo_decision !== "devolver" && x.saldo_decision !== "cerrada") await sb.from("zomatik_np").update({ saldo_desde: null } as never).eq("id", x.id)
  }
}

// ---------------------------------------------------------------------------
// NP con saldo (Programación) y qué hacer con el saldo
// ---------------------------------------------------------------------------

export type NpSaldo = {
  id: string; numero: string | null; zomatik_codigo: number | null; m3: number; libre: number; comprometido: number; fecha: string; fecha_zomatik: string | null
  saldo_decision: string | null; saldo_mensaje: string | null; pendiente_desde: string | null; plant_id: string | null; client_id: string | null; cliente: string | null
  formula_id: string | null; formula: string | null; construction_site_id: string | null; obra: string | null; con_pedido_activo: boolean
}

/**
 * NP del sistema en Zomatik con saldo. `lista`: las que van a "NP con saldo" (sin pedido activo, sin cerrar).
 * Con `clientId` y `formulaId`: las que sirven para "Usar NP con saldo" (mismo cliente y artículo, con algo libre).
 */
export async function npsConSaldo(o: { clientId?: string | null; formulaId?: string | null; sb?: SB } = {}): Promise<NpSaldo[]> {
  const sb = o.sb ?? sbServicio()
  let q = sb.from("zomatik_np").select(COLUMNAS_NP).eq("estado", "ok").order("fecha", { ascending: false }).limit(300)
  if (o.clientId) q = q.eq("client_id", o.clientId)
  const { data, error } = await q
  if (error) throw error
  const nps = ((data as unknown as FilaNpDB[]) || []).filter((x) => x.saldo_decision !== "cerrada")
  const saldos = await saldosDe(sb, nps)
  let elegidas = nps.filter((x) => {
    const sd = saldos.get(x.id)
    if (!sd) return false
    return o.clientId ? sd.libre > 0.001 && x.saldo_decision !== "devolver" : npConSaldo(x, sd)
  })
  if (o.clientId && o.formulaId) {
    const art = await articuloDe(sb, [o.formulaId, ...elegidas.map((x) => x.formula_id || "")])
    const quiere = art.get(o.formulaId)
    elegidas = elegidas.filter((x) => x.formula_id === o.formulaId || (!!quiere && art.get(x.formula_id || "") === quiere))
  }
  if (!elegidas.length) return []
  const pedIds = [...new Set(elegidas.map((x) => x.scheduled_dispatch_id).filter(Boolean) as string[])]
  const [{ data: cli }, { data: frm }, { data: peds }] = await Promise.all([
    sb.from("clients").select("id, name").in("id", [...new Set(elegidas.map((x) => x.client_id).filter(Boolean) as string[])]),
    sb.from("formulas").select("id, code").in("id", [...new Set(elegidas.map((x) => x.formula_id).filter(Boolean) as string[])]),
    pedIds.length ? sb.from("scheduled_dispatches").select("id, construction_site_id, construction_sites(name)").in("id", pedIds) : Promise.resolve({ data: [] }),
  ])
  const nombre = new Map(((cli as { id: string; name: string }[]) || []).map((c) => [c.id, c.name]))
  const codigo = new Map(((frm as { id: string; code: string }[]) || []).map((f) => [f.id, f.code]))
  const obra = new Map(((peds as { id: string; construction_site_id: string | null; construction_sites?: { name?: string } | null }[]) || []).map((p) => [p.id, p]))
  return elegidas.map((x) => {
    const sd = saldos.get(x.id)!
    const o2 = x.scheduled_dispatch_id ? obra.get(x.scheduled_dispatch_id) : undefined
    return {
      id: x.id, numero: x.numero, zomatik_codigo: x.zomatik_codigo, m3: Number(x.m3), libre: sd.libre, comprometido: sd.comprometido, fecha: String(x.fecha), fecha_zomatik: x.fecha_zomatik ?? null,
      saldo_decision: x.saldo_decision ?? null, saldo_mensaje: x.saldo_mensaje ?? null, pendiente_desde: x.saldo_desde ?? x.updated_at ?? null, plant_id: x.plant_id ?? null, client_id: x.client_id ?? null, cliente: nombre.get(x.client_id || "") || null,
      formula_id: x.formula_id ?? null, formula: codigo.get(x.formula_id || "") || null, construction_site_id: o2?.construction_site_id ?? null, obra: o2?.construction_sites?.name ?? null,
      con_pedido_activo: sd.conPedidoActivo,
    }
  })
}

/**
 * Qué hacer con el saldo de una NP pendiente (respuesta 2 y precisión del 23/10: queda pendiente hasta Reprogramar o
 * Devolver; Reprogramar es abrir un pedido nuevo con "Usar NP con saldo"):
 *   devolver  "Devolver el saldo": si no tuvo despachos, se vacía (23.4, el robot controla que no tenga remitos). Si tuvo,
 *             hace falta una devolución de pedido (DEVOL) por el saldo: TODAVÍA NO la hace el sistema (falta probarla
 *             con Bautista, 20.6.1): queda "devolver" con el aviso de hacerla a mano.
 *   cerrada   "Ya la devolví": se hizo a mano en Zomatik.
 */
export async function decidirSaldo(npId: string, decision: "devolver" | "cerrada", usuario: string, sb: SB = sbServicio(), motivo?: string | null): Promise<{ ok: boolean; error?: string; mensaje?: string }> {
  const { data } = await sb.from("zomatik_np").select(COLUMNAS_NP).eq("id", npId).maybeSingle()
  const np = data as unknown as FilaNpDB | null
  if (!np) return { ok: false, error: "La NP no existe." }
  const ahora = new Date().toISOString()
  const ref = `NP ${np.numero || np.id.slice(0, 8)}`
  let mensaje: string
  if (decision === "cerrada") {
    // "Ya la devolví" (DEVOL a mano): solo un gerencial y con motivo (lo controla la ruta); queda en Actividad
    if (np.estado !== "ok" || np.saldo_decision !== "devolver") return { ok: false, error: "La NP no está esperando la devolución. Actualizá la pantalla." }
    const { data: hecho } = await sb.from("zomatik_np").update({ saldo_decision: "cerrada", saldo_decision_por: usuario, saldo_decision_at: ahora, saldo_mensaje: `Devuelta a mano por ${usuario}: ${motivo || ""}`.trim(), updated_at: ahora } as never).eq("id", np.id).eq("estado", "ok").eq("saldo_decision", "devolver").select("id")
    if (!((hecho as unknown[]) || []).length) return { ok: false, error: "La NP cambió. Actualizá la pantalla." }
    mensaje = "Marcada como devuelta"
  } else {
    // En la base, con la NP bloqueada: no se pisa con una reprogramación al mismo tiempo
    const r = (await rpc(sb, "zomatik_np_devolver", { p_np: np.id, p_usuario: usuario })) as { error?: string; mensaje?: string; libre?: number } | null
    if (!r || r.error) return { ok: false, error: r?.error || "No se pudo." }
    mensaje = r.mensaje || "Listo"
  }
  await actividadNp(sb, { usuario, pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: ref, detalle: { "Qué pasó": decision === "cerrada" ? "NP con saldo: ya devuelta a mano (DEVOL)" : "NP con saldo: devolver el saldo", Mensaje: mensaje, ...(motivo ? { Motivo: motivo } : {}) } })
  return { ok: true, mensaje }
}

/** Vendedor de Zomatik de quien programó el pedido (respuesta 4); null si no tiene. */
async function vendedorDe(sb: SB, appUserId: string | null | undefined): Promise<{ id: number; nombre: string } | null> {
  if (!appUserId) return null
  const { data: v, error } = await sb.from("zomatik_vendedores").select("vendedor_id, vendedor_nombre").eq("app_user_id", appUserId).maybeSingle()
  if (error || !v) return null
  return { id: Number((v as { vendedor_id: number }).vendedor_id), nombre: (v as { vendedor_nombre: string | null }).vendedor_nombre || "" }
}

// ---------------------------------------------------------------------------
// Procesar con el robot
// ---------------------------------------------------------------------------

export type ResultadoProceso = { ocupado?: boolean; sinTiempo?: boolean; hechas: { id: string; estado: string; mensaje: string | null; numero?: string | null }[]; quedan: number; error?: string }

/** Más de estas veces colgada en "generando"/"vaciando" = trabada: queda "revisar". */
const MAX_INTENTOS_TRABADA = 3

const despuesDe = (min: number) => new Date(Date.now() + min * 60_000).toISOString()

/** NP para trabajar ahora (ver `trabajoPendiente`, np.ts). Con `pedidoId`, también las de error (el botón). */
async function aTrabajar(sb: SB, pedidoId?: string | null): Promise<FilaNpDB[]> {
  let q = sb.from("zomatik_np").select(COLUMNAS_NP).in("estado", ["pendiente", "generando", "vaciar", "vaciando", ...(pedidoId ? ["error"] : [])]).order("created_at").limit(30)
  if (pedidoId) q = q.eq("scheduled_dispatch_id", pedidoId)
  const { data, error } = await q
  if (error) throw error
  const ahora = Date.now()
  return ((data as unknown as FilaNpDB[]) || []).filter((x) => trabajoPendiente(x, ahora, !!pedidoId))
}

/** Lo que el robot necesita de afuera (en las pruebas se reemplaza). */
export type Dependencias = {
  navegador: (llave: LlaveNp) => Promise<NavegadorNp>
  remitos: (numero: string | null, desde: string) => Promise<boolean | null>
  avisar: (sb: SB, titulo: string, lineas: string[]) => Promise<{ enviado: boolean; motivo?: string }>
}

type Contexto = {
  plantas: Record<string, PlantaNpDB>
  nav: NavegadorNp | null
  usuario: string
  dep: Dependencias
  /** Renueva el turno del robot (como mucho cada 10 s). */
  renovar: () => Promise<void>
}

/** Datos del pedido que necesita el robot (cliente, fórmula, depósito, R/X y obra). */
async function datosParaRobot(sb: SB, np: FilaNpDB, planta: PlantaNpDB | undefined, buscarAntes: boolean): Promise<DatosNp> {
  const pedidoId = np.scheduled_dispatch_id
  const [{ data: ped }, { data: cli }, { data: form }] = await Promise.all([
    pedidoId ? sb.from("scheduled_dispatches").select("id, created_by, construction_site_id, construction_sites(name, address, localidad)").eq("id", pedidoId).maybeSingle() : Promise.resolve({ data: null }),
    np.client_id ? sb.from("clients").select("id, name, zomatik_codigo").eq("id", np.client_id).maybeSingle() : Promise.resolve({ data: null }),
    np.formula_id ? sb.from("formulas").select("id, code, zomatik_articulo_codigo, zomatik_articulo_nombre").eq("id", np.formula_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  let articulo: { codigo_sistema: number | null; nombre: string } | null = null
  const codArt = (form as { zomatik_articulo_codigo?: number | null } | null)?.zomatik_articulo_codigo
  if (codArt) {
    const { data: a } = await sb.from("zomatik_articulos").select("codigo, nombre, codigo_sistema").eq("codigo", codArt).maybeSingle()
    articulo = a ? { codigo_sistema: (a as { codigo_sistema: number | null }).codigo_sistema ?? null, nombre: (a as { nombre: string }).nombre } : null
  }
  let comprobante: "15" | "16" | null = null
  if (np.tipo === "nueva" && pedidoId) {
    const { data: rt } = await sb.rpc("remito_tipo_para", { p_pedido_id: pedidoId })
    comprobante = comprobanteDe((rt as { tipo?: string } | null)?.tipo || null)
  }
  // Vendedor: el de quien guardó el pedido cuando se creó esta NP (usuario de la sesión del servidor, respuesta 4 del
  // 23/10); si no tiene, el robot usa el del cliente
  const vendedor = await vendedorDe(sb, np.vendedor_usuario_id)
  const obra = (ped as { construction_sites?: { name?: string; address?: string | null; localidad?: string | null } | null } | null)?.construction_sites
  const entrega = obra ? [`Obra: ${obra.name || ""}`, obra.address, obra.localidad].filter(Boolean).join(" · ") : ""
  return {
    marca: np.marca,
    tipo: np.tipo,
    comprobante,
    clienteCodigo: (cli as { zomatik_codigo?: number | null } | null)?.zomatik_codigo ?? null,
    clienteNombre: (cli as { name?: string } | null)?.name || "",
    deposito: planta?.zomatik_deposito ?? null,
    fecha: String(np.fecha),
    m3: Number(np.m3),
    articuloCodigoSistema: articulo?.codigo_sistema ?? null,
    articuloNombre: articulo?.nombre || (form as { zomatik_articulo_nombre?: string } | null)?.zomatik_articulo_nombre || (form as { code?: string } | null)?.code || "",
    proyectoCodigo: np.proyecto_codigo ?? null,
    entrega,
    buscarAntes,
    creadaEl: np.created_at ? diaAR(np.created_at) : null,
    vendedorId: vendedor?.id ?? null,
    vendedorNombre: vendedor?.nombre ?? null,
  }
}

/** ¿La NP tiene remitos? (reporte de remitos de venta, solo lectura). Si no se puede leer, null. */
async function tieneRemitos(numero: string | null, desde: string): Promise<boolean | null> {
  if (!numero) return false
  try {
    const s = await obtenerSesion()
    const f = await discoverForm(s, "reporte_remitosventa.php")
    const rs = renglonesRemitos(await fetchExport(s, "reporte_remitosventa.php", f, { desde, hasta: hoyAR() }))
    const n = numeroNormalizado(numero)
    const comp = comprobanteDeNumero(numero)
    return rs.some((r) => numeroNormalizado(r.pedido) === n && (!comp || comprobanteDeNumero(r.pedido) === comp))
  } catch {
    return null
  }
}

export const DEPENDENCIAS: Dependencias = { navegador: navegadorNp, remitos: tieneRemitos, avisar: avisarGerenciales }

/**
 * Guarda SOLO si la NP sigue en `esperado` ("generando" / "vaciando"): si otro proceso o un gerencial la cambió en el
 * medio (anulada, revisada), no se pisa. Devuelve si se guardó.
 */
async function guardarSi(sb: SB, id: string, esperado: EstadoNp, cambios: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await sb.from("zomatik_np").update({ ...cambios, updated_at: new Date().toISOString() } as never).eq("id", id).eq("estado", esperado).select("id")
  if (error) throw error
  return ((data as unknown[]) || []).length > 0
}

/** Error para cortar el robot ANTES de grabar si la NP cambió mientras trabajaba. */
class NpCambio extends Error {}

/** Si el robot terminó pero la NP ya no estaba "generando"/"vaciando": no se pisa, queda en Actividad y se avisa. */
async function noSePudoGuardar(sb: SB, np: FilaNpDB, ctx: Contexto, que: string) {
  const detalle = `La NP ${np.n} cambió mientras el robot trabajaba (${que}). No se pisó: revisala en Zomatik.`
  await actividadNp(sb, { usuario: ctx.usuario, pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: `Pedido ${(np.scheduled_dispatch_id || "").slice(0, 8)}`, detalle: { "Qué pasó": detalle, Marca: np.marca } })
  await ctx.dep.avisar(sb, "NP para revisar (cambió mientras se generaba)", [detalle, `Marca: ${np.marca}`])
}

async function trabajarGenerar(sb: SB, np: FilaNpDB, ctx: Contexto, previo: { estado: string; paso: string | null }) {
  const G: EstadoNp = "generando"
  const planta = ctx.plantas[np.plant_id || ""]
  const llave = llaveDe(planta)
  if (!llave) {
    await guardarSi(sb, np.id, G, { estado: "pendiente", en_curso_desde: null, mensaje: "La NP automática está apagada para esta planta: cargala a mano en Zomatik.", proximo_intento: null })
    return { estado: "pendiente", mensaje: "llave apagada" }
  }
  const buscarAntes = previo.estado === "generando" || puedeEstarGrabada({ paso: previo.paso })
  // El pedido se canceló (o se borró) entre que se creó la NP y ahora: no se genera
  const { data: est } = np.scheduled_dispatch_id ? await sb.from("scheduled_dispatches").select("status").eq("id", np.scheduled_dispatch_id).maybeSingle() : { data: null }
  const status = (est as { status?: string } | null)?.status
  if (!status || status === "cancelled") {
    if (buscarAntes) {
      await guardarSi(sb, np.id, G, { estado: "revisar", en_curso_desde: null, mensaje: "El pedido se canceló y esta NP se cortó al grabar: puede estar en Zomatik. Buscala por la marca y vaciala.", proximo_intento: null })
      return { estado: "revisar", mensaje: null }
    }
    await guardarSi(sb, np.id, G, { estado: "anulada", en_curso_desde: null, mensaje: "El pedido se canceló antes de generarla", proximo_intento: null })
    return { estado: "anulada", mensaje: null }
  }
  const datos = await datosParaRobot(sb, np, planta, buscarAntes)
  if (!ctx.nav) ctx.nav = await ctx.dep.navegador(llave)
  const r: ResultadoNp = await generarNp(ctx.nav, datos, {
    hoy: hoyAR(),
    alPaso: async (paso) => {
      await ctx.renovar()
      // Antes de cada paso (y sobre todo antes de "grabar") la NP tiene que seguir siendo nuestra
      if (!(await guardarSi(sb, np.id, G, { paso }))) throw new NpCambio("La NP cambió mientras se generaba")
    },
  })
  const ahora = new Date().toISOString()
  const comunes = { en_curso_desde: null, mensaje: r.mensaje, disponible_m3: r.disponible ?? np.disponible_m3 ?? null }
  const ref = `Pedido ${(np.scheduled_dispatch_id || "").slice(0, 8)}`
  let guardo = true
  if (r.estado === "ok") {
    guardo = await guardarSi(sb, np.id, G, { ...comunes, estado: "ok", numero: r.numero, zomatik_codigo: r.codigo, sucursal: r.sucursal, paso: "ok", ok_at: ahora, proximo_intento: null, fecha_zomatik: np.fecha })
    if (guardo) {
      if (np.scheduled_dispatch_id) await sb.from("zomatik_np_excepciones").update({ regularizado_at: ahora } as never).eq("scheduled_dispatch_id", np.scheduled_dispatch_id).is("regularizado_at", null)
      await actividadNp(sb, { usuario: ctx.usuario, action: "crear", pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: ref, detalle: { "Qué pasó": `NP generada en Zomatik: ${r.numero}`, "m³": np.m3, Tipo: np.tipo === "proyecto" ? `Proyecto ${np.proyecto_codigo}` : "NP nueva" } })
    }
  } else if (r.estado === "revisar") {
    guardo = await guardarSi(sb, np.id, G, { ...comunes, estado: "revisar", numero: r.numero ?? null, zomatik_codigo: r.codigo ?? null, sucursal: r.sucursal ?? null, paso: r.paso, proximo_intento: null })
    if (guardo) {
      await actividadNp(sb, { usuario: ctx.usuario, pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: ref, detalle: { "Qué pasó": "NP para revisar", Mensaje: r.mensaje } })
      const aviso = await ctx.dep.avisar(sb, `NP para revisar${r.numero ? `: ${r.numero}` : ""}`, [r.mensaje || "", `Pedido ${(np.scheduled_dispatch_id || "").slice(0, 8)} · ${np.m3} m³ · ${np.fecha}`, `Marca en observaciones: ${np.marca}`])
      if (!aviso.enviado) console.error("[zomatik-np] aviso a gerenciales:", aviso.motivo)
    }
  } else if (r.estado === "pendiente") {
    guardo = await guardarSi(sb, np.id, G, { ...comunes, estado: "pendiente", paso: r.grabado ? "grabar_cortado" : r.paso, proximo_intento: despuesDe(MIN_REINTENTO) })
  } else {
    guardo = await guardarSi(sb, np.id, G, { ...comunes, estado: "error", paso: r.paso, proximo_intento: r.reintentar ? despuesDe(MIN_REINTENTO) : null })
    if (guardo) await actividadNp(sb, { usuario: ctx.usuario, pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: ref, detalle: { "Qué pasó": "Zomatik no generó la NP", Mensaje: r.mensaje } })
  }
  if (!guardo && (r.estado === "ok" || r.estado === "revisar" || r.grabado)) await noSePudoGuardar(sb, np, ctx, r.numero ? `quedó ${r.numero}` : r.mensaje || r.estado)
  if (np.tipo === "proyecto" && np.proyecto_codigo && r.disponible !== undefined && r.disponible !== null)
    await sb.from("zomatik_proyectos").update({ disponible_m3: r.disponible, disponible_articulo: datos.articuloNombre || null, disponible_at: ahora } as never).eq("codigo", np.proyecto_codigo)
  return { estado: guardo ? r.estado : "cambió", mensaje: r.mensaje, numero: r.numero }
}

async function trabajarVaciar(sb: SB, np: FilaNpDB, ctx: Contexto) {
  const V: EstadoNp = "vaciando"
  const planta = ctx.plantas[np.plant_id || ""]
  const llave = llaveDe(planta)
  const ref = `Pedido ${(np.scheduled_dispatch_id || "").slice(0, 8)}`
  if (!llave) {
    await guardarSi(sb, np.id, V, { estado: "vaciar", en_curso_desde: null, mensaje: `La NP automática está apagada: vaciá la ${np.numero || "NP"} a mano en Zomatik.`, proximo_intento: null })
    return { estado: "vaciar", mensaje: "llave apagada" }
  }
  if (!np.zomatik_codigo) {
    await guardarSi(sb, np.id, V, { estado: "revisar", en_curso_desde: null, mensaje: "No se sabe el código de la NP en Zomatik: vaciala a mano.", proximo_intento: null })
    return { estado: "revisar", mensaje: null }
  }
  // Con remitos no se toca (23.4 / decisión 22/10): se avisa
  const conRemitos = await ctx.dep.remitos(np.numero, String(np.fecha))
  if (conRemitos === null) {
    await guardarSi(sb, np.id, V, { estado: "vaciar", en_curso_desde: null, mensaje: "No se pudo leer si la NP tiene remitos: se reintenta en 10 min.", proximo_intento: despuesDe(MIN_REINTENTO) })
    return { estado: "vaciar", mensaje: null }
  }
  if (conRemitos) {
    // Con remitos no se vacía: hace falta una devolución de pedido (DEVOL), que todavía no hace el sistema
    const msg = `La ${np.numero} tiene remitos en Zomatik: no se vació. Hace falta una devolución de pedido (DEVOL) por el saldo: hacela a mano y tocá "Ya la devolví".`
    if (await guardarSi(sb, np.id, V, { estado: "ok", en_curso_desde: null, mensaje: null, saldo_decision: "devolver", saldo_mensaje: msg, proximo_intento: null })) {
      await actividadNp(sb, { usuario: ctx.usuario, pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: ref, detalle: { "Qué pasó": "Devolver el saldo: la NP tiene remitos, falta la DEVOL a mano", NP: np.numero } })
    }
    return { estado: "ok", mensaje: msg }
  }
  if (!ctx.nav) ctx.nav = await ctx.dep.navegador(llave)
  const r = await vaciarNp(ctx.nav, { codigo: np.zomatik_codigo, numero: np.numero, marca: np.marca }, {
    hoy: hoyAR(),
    alPaso: async (paso) => {
      await ctx.renovar()
      if (!(await guardarSi(sb, np.id, V, { paso }))) throw new NpCambio("La NP cambió mientras se vaciaba")
    },
  })
  const ahora = new Date().toISOString()
  let guardo: boolean
  if (r.estado === "vaciada") {
    guardo = await guardarSi(sb, np.id, V, { estado: "vaciada", en_curso_desde: null, mensaje: null, vaciada_at: ahora, proximo_intento: null, paso: "vaciada", saldo_decision: "cerrada", saldo_mensaje: "Vaciada en Zomatik" })
    if (guardo) await actividadNp(sb, { usuario: ctx.usuario, pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: ref, detalle: { "Qué pasó": `NP vaciada en Zomatik (devolver el saldo): ${np.numero}` } })
  } else if (r.estado === "vaciar") {
    guardo = await guardarSi(sb, np.id, V, { estado: "vaciar", en_curso_desde: null, mensaje: r.mensaje, proximo_intento: despuesDe(MIN_REINTENTO) })
  } else {
    guardo = await guardarSi(sb, np.id, V, { estado: "revisar", en_curso_desde: null, mensaje: r.mensaje, proximo_intento: null })
    if (guardo) {
      await actividadNp(sb, { usuario: ctx.usuario, pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: ref, detalle: { "Qué pasó": "No se pudo vaciar la NP", Mensaje: r.mensaje, NP: np.numero } })
      await ctx.dep.avisar(sb, `No se pudo vaciar la ${np.numero || "NP"}`, [r.mensaje || "", `Pedido ${(np.scheduled_dispatch_id || "").slice(0, 8)}`])
    }
  }
  if (!guardo) await noSePudoGuardar(sb, np, ctx, r.estado)
  return { estado: guardo ? r.estado : "cambió", mensaje: r.mensaje }
}

/**
 * Trabaja las NP que esperan, con una sola sesión del robot a la vez (23.3 e). `inicio` = cuándo empezó el request:
 * no se arranca una NP si quedan menos de 30 s de los 55 s útiles de la función. El turno dura 60 s y se renueva en
 * cada paso. Cada NP se "toma" en la base antes de tocar Zomatik: dos procesos nunca trabajan la misma.
 */
export async function procesarNp(o: { usuario: string; pedidoId?: string | null; inicio: number; totalMs?: number; minimoMs?: number; sb?: SB; dep?: Dependencias }): Promise<ResultadoProceso> {
  const sb = o.sb ?? sbServicio()
  const dep = o.dep ?? DEPENDENCIAS
  const total = o.totalMs ?? 55_000
  const minimo = o.minimoMs ?? 30_000
  if (!quedaTiempo(o.inicio, Date.now(), total, minimo)) return { sinTiempo: true, hechas: [], quedan: 0 }
  // Sin ninguna llave prendida o sin NP para trabajar, no se toma el turno (no tapa la lectura diaria de Zomatik)
  const plantas = await plantasNp(sb)
  if (!Object.values(plantas).some((p) => p.zomatik_np_activo)) return { hechas: [], quedan: 0 }
  const lista = await aTrabajar(sb, o.pedidoId)
  if (!lista.length) return { hechas: [], quedan: 0 }
  const quien = `${o.usuario}·${o.inicio.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
  const { data: turno, error: et } = await sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 60 })
  if (et) throw et
  if (turno !== true) return { ocupado: true, hechas: [], quedan: 0 }
  let ultimaRenovacion = Date.now()
  const ctx: Contexto = {
    plantas, nav: null, usuario: o.usuario, dep,
    renovar: async () => {
      if (Date.now() - ultimaRenovacion < 10_000) return
      ultimaRenovacion = Date.now()
      await sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 60 })
    },
  }
  const hechas: ResultadoProceso["hechas"] = []
  let quedan = 0
  try {
    for (let i = 0; i < lista.length; i++) {
      if (!quedaTiempo(o.inicio, Date.now(), total, minimo)) {
        quedan = lista.length - i
        break
      }
      const np = lista[i]
      const vaciando = np.estado === "vaciar" || np.estado === "vaciando"
      const a: EstadoNp = vaciando ? "vaciando" : "generando"
      const { data: tom, error: e1 } = await sb.rpc("zomatik_np_tomar", { p_id: np.id, p_desde: vaciando ? ["vaciar"] : ["pendiente", ...(o.pedidoId ? ["error"] : [])], p_a: a })
      if (e1) throw e1
      const t = (tom as { np_id: string; estado_anterior: string; paso_anterior: string | null }[] | null)?.[0]
      if (!t) continue
      // Trabada: quedó colgada en "generando"/"vaciando" más de 3 veces → la mira un gerencial (no se insiste)
      if (["generando", "vaciando"].includes(t.estado_anterior) && Number(np.intentos || 0) + 1 > MAX_INTENTOS_TRABADA) {
        const msg = `Se cortó ${Number(np.intentos || 0) + 1} veces en el medio (último paso: ${t.paso_anterior || "?"}). No se reintenta: revisala en Zomatik buscando la marca.`
        if (await guardarSi(sb, np.id, a, { estado: "revisar", en_curso_desde: null, mensaje: msg, proximo_intento: null })) {
          await actividadNp(sb, { usuario: ctx.usuario, pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: `Pedido ${(np.scheduled_dispatch_id || "").slice(0, 8)}`, detalle: { "Qué pasó": "NP trabada: para revisar", Mensaje: msg, Marca: np.marca } })
          await dep.avisar(sb, "NP trabada: para revisar", [msg, `Marca: ${np.marca}`])
        }
        hechas.push({ id: np.id, estado: "revisar", mensaje: msg })
        continue
      }
      try {
        const r = vaciando ? await trabajarVaciar(sb, np, ctx) : await trabajarGenerar(sb, np, ctx, { estado: t.estado_anterior, paso: t.paso_anterior })
        hechas.push({ id: np.id, ...r })
      } catch (e) {
        if (e instanceof NpCambio) {
          await noSePudoGuardar(sb, np, ctx, e.message)
          hechas.push({ id: np.id, estado: "cambió", mensaje: e.message })
          continue
        }
        // Falla de nuestro lado o de la sesión (antes de que el robot devuelva): se deja para el reintento
        const m = mensajeZomatik(e) || (e as Error)?.message || "Error"
        await guardarSi(sb, np.id, a, { estado: vaciando ? "vaciar" : "pendiente", en_curso_desde: null, mensaje: m, proximo_intento: despuesDe(MIN_REINTENTO) })
        hechas.push({ id: np.id, estado: vaciando ? "vaciar" : "pendiente", mensaje: m })
        if (/sesi[oó]n|entrar a Zomatik|login|ZOMATIK_USER/i.test(m)) break // no se insiste con la sesión caída
      }
    }
  } finally {
    await sb.rpc("zomatik_robot_soltar", { p_quien: quien })
  }
  return { hechas, quedan }
}

// ---------------------------------------------------------------------------
// La pasada (cron cada 10 min, botón y Programación abierta): solo la base, sin Zomatik
// ---------------------------------------------------------------------------

/**
 * Sincroniza los pedidos de hoy en adelante de las plantas con la llave prendida y los que tienen NP vivas. Para si se
 * le termina el tiempo (`hastaMs` desde `inicio`), así el robot todavía tiene lugar.
 */
export async function pasadaNp(usuario: string, o: { inicio: number; hastaMs?: number; sb?: SB } = { inicio: Date.now() }): Promise<{ pedidos: number; sincronizados: number }> {
  const sb = o.sb ?? sbServicio()
  const hasta = o.hastaMs ?? 20_000
  const plantas = Object.values(await plantasNp(sb)).filter((p) => p.zomatik_np_activo)
  const ids = new Set<string>()
  if (plantas.length) {
    const desdeDia = new Date(`${hoyAR()}T03:00:00.000Z`).toISOString() // 00:00 de Argentina
    const { data } = await sb.from("scheduled_dispatches").select("id, plant_id, created_at").in("plant_id", plantas.map((p) => p.id)).gte("scheduled_arrival_time", desdeDia).not("status", "in", "(completed,cancelled)").limit(500)
    for (const p of (data as { id: string; plant_id: string; created_at: string }[]) || []) if (pedidoConNp(plantas.find((x) => x.id === p.plant_id), p.created_at)) ids.add(p.id)
  }
  // Los pedidos ACTIVOS que usan NP vivas (cambios y NP adicionales). Los cancelados y completos no se miran más
  // (se sincronizan al cancelar o finalizar; el robot no genera NP de un pedido cancelado) ni las NP cerradas.
  const { data: vivas } = await sb.from("zomatik_np").select("id, saldo_decision").in("estado", ["ok", "pendiente", "error"] as EstadoNp[]).limit(1000)
  const usosVivos = await usosDe(sb, "np_id", ((vivas as { id: string; saldo_decision: string | null }[]) || []).filter((x) => x.saldo_decision !== "cerrada").map((x) => x.id))
  const candidatos = [...new Set(usosVivos.filter((u) => u.activo && u.scheduled_dispatch_id).map((u) => u.scheduled_dispatch_id!))].filter((id) => !ids.has(id))
  if (candidatos.length) {
    const { data: act } = await sb.from("scheduled_dispatches").select("id").in("id", candidatos).not("status", "in", "(completed,cancelled)")
    for (const p of (act as { id: string }[]) || []) ids.add(p.id)
  }
  let sincronizados = 0
  for (const id of ids) {
    if (Date.now() - o.inicio > hasta) break
    try {
      await sincronizarPedido(id, usuario, null, sb)
      sincronizados++
    } catch (e) {
      console.error("[zomatik-np] sincronizar", id, (e as Error)?.message)
    }
  }
  // Las NP de pedidos borrados ya no se vacían solas: quedan en "NP con saldo" para decidir (respuesta 2 del 23/10)
  return { pedidos: ids.size, sincronizados }
}

// ---------------------------------------------------------------------------
// Estado para las pantallas
// ---------------------------------------------------------------------------

export type EstadoPedidoNp = {
  activo: boolean
  modo: ModoNp
  /** El pedido entra en la NP automática (cargado después de prender la llave). */
  entra: boolean
  /** Las NP que usa el pedido (con los m³ que reserva de cada una y lo libre de la NP). */
  nps: (FilaNpDB & { m3_uso: number; libre: number })[]
  /** El pedido está cancelado o completo: sus NP con saldo van a "NP con saldo". */
  cerrado: boolean
  excepcion: { autorizado_por: string; motivo_tipo: string; motivo: string | null } | null
  control: { bloquea: boolean; aviso: string | null }
  /** NP nueva o de un proyecto (null = todavía no se eligió). */
  eleccion: EleccionDB | null
}

export async function estadoPedidos(ids: string[]): Promise<{ porPedido: Record<string, EstadoPedidoNp>; plantas: Record<string, { activo: boolean; modo: ModoNp; aviso_hasta: string | null }> }> {
  const sb = sbServicio()
  const plantas = await plantasNp(sb)
  const resumen = Object.fromEntries(Object.values(plantas).map((p) => [p.id, { activo: !!p.zomatik_np_activo, modo: modoDe(p), aviso_hasta: p.aviso_hasta ?? null }]))
  if (!ids.length || !Object.values(plantas).some((p) => p.zomatik_np_activo)) {
    return { porPedido: {}, plantas: resumen }
  }
  const [{ data: peds }, usos, { data: exc }, elecciones] = await Promise.all([
    sb.from("scheduled_dispatches").select("id, plant_id, created_at, status").in("id", ids),
    usosDe(sb, "scheduled_dispatch_id", ids),
    sb.from("zomatik_np_excepciones").select("scheduled_dispatch_id, autorizado_por, motivo_tipo, motivo").in("scheduled_dispatch_id", ids).eq("fecha", hoyAR()),
    eleccionesDe(sb, ids),
  ])
  const activos = usos.filter((u) => u.activo)
  const nps = await npsPorId(sb, [...new Set(activos.map((u) => u.np_id))])
  const saldos = await saldosDe(sb, nps.filter((x) => x.estado === "ok"))
  const porPedido: Record<string, EstadoPedidoNp> = {}
  for (const p of (peds as { id: string; plant_id: string; created_at: string; status: string }[]) || []) {
    const planta = plantas[p.plant_id]
    const modo = modoDe(planta)
    const suyas = activos
      .filter((u) => u.scheduled_dispatch_id === p.id)
      .map((u) => {
        const x = nps.find((n) => n.id === u.np_id)
        return x ? { ...x, m3_uso: Number(u.m3), libre: Math.max(0, saldos.get(x.id)?.libre ?? 0) } : null
      })
      .filter(Boolean) as (FilaNpDB & { m3_uso: number; libre: number })[]
    const entra = pedidoConNp(planta, p.created_at) || suyas.length > 0
    const e = ((exc as { scheduled_dispatch_id: string; autorizado_por: string; motivo_tipo: string; motivo: string | null }[]) || []).find((x) => x.scheduled_dispatch_id === p.id) || null
    porPedido[p.id] = {
      activo: !!planta?.zomatik_np_activo,
      modo,
      entra,
      nps: suyas,
      cerrado: p.status === "cancelled" || p.status === "completed",
      excepcion: e ? { autorizado_por: e.autorizado_por, motivo_tipo: e.motivo_tipo, motivo: e.motivo } : null,
      control: controlDespacho({ modo, entra, nps: suyas.filter((x) => VIGENTES.includes(x.estado)), excepcion: !!e }),
      eleccion: elecciones[p.id] || null,
    }
  }
  return { porPedido, plantas: resumen }
}

/** Revisión de un gerencial de una NP en "revisar": generar otra (la errónea ya se vació a mano) o dejar esta como buena. */
export async function revisarNp(npId: string, decision: "otra" | "buena", usuario: string, sb: SB = sbServicio(), usuarioId: string | null = null): Promise<{ ok: boolean; error?: string }> {
  const { data } = await sb.from("zomatik_np").select(COLUMNAS_NP).eq("id", npId).maybeSingle()
  const np = data as unknown as FilaNpDB | null
  if (!np) return { ok: false, error: "La NP no existe" }
  if (np.estado !== "revisar") return { ok: false, error: "La NP ya no está para revisar. Actualizá la pantalla." }
  if (decision === "buena") {
    if (!np.numero || !np.zomatik_codigo || np.sucursal !== "18" || !esSerieRebucret(np.numero)) return { ok: false, error: "Esta NP no es de REBUCRET: no se puede dejar como buena." }
    if (!(await guardarSi(sb, np.id, "revisar", { estado: "ok", mensaje: `Revisada por ${usuario}`, ok_at: new Date().toISOString() }))) return { ok: false, error: "La NP cambió. Actualizá la pantalla." }
  } else {
    if (!(await guardarSi(sb, np.id, "revisar", { estado: "anulada", mensaje: `${np.mensaje || ""} · Revisada por ${usuario}: se genera otra`.replace(/^ · /, "") }))) return { ok: false, error: "La NP cambió. Actualizá la pantalla." }
    if (np.scheduled_dispatch_id) await sincronizarPedido(np.scheduled_dispatch_id, usuario, null, sb, { usuarioId })
  }
  await actividadNp(sb, { usuario, pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: `Pedido ${(np.scheduled_dispatch_id || "").slice(0, 8)}`, detalle: { "Qué pasó": decision === "buena" ? `NP revisada: queda ${np.numero}` : "NP revisada: se genera otra", NP: np.numero, Antes: np.mensaje } })
  return { ok: true }
}
