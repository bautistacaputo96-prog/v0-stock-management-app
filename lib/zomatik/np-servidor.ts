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
  pedidoConNp, planificarNp, controlDespacho, type EstadoNp, type FilaNp, type ModoNp, type PlantaNp, type TipoNp,
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
}

export const COLUMNAS_NP =
  "id, scheduled_dispatch_id, n, marca, tipo, es_adicional, proyecto_codigo, plant_id, client_id, formula_id, fecha, m3, estado, paso, mensaje, numero, zomatik_codigo, sucursal, disponible_m3, intentos, proximo_intento, en_curso_desde, created_at, updated_at"

const COLUMNAS_PEDIDO =
  "id, status, quantity_m3, plant_id, client_id, construction_site_id, formula_id, scheduled_arrival_time, created_at, created_by"

export type PlantaNpDB = PlantaNp & { id: string; name: string; zomatik_deposito: number | null }

/** ¿Falta la migración de Z2? (las rutas responden "apagado" en vez de romper). */
export const faltaMigracion = (e: unknown) => /zomatik_np|zomatik_proyecto|codigo_sistema|disponible_m3|zomatik_robot|does not exist|schema cache|Could not find/i.test(String((e as { message?: string })?.message || ""))

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
// Sincronizar un pedido (sin Zomatik)
// ---------------------------------------------------------------------------

export type Eleccion = { tipo: TipoNp; proyecto_codigo?: number | null; tope_m3?: number | null }

export type ResultadoSync =
  | { activo: false; motivo: string }
  | { activo: true; fuera?: boolean; error?: string; creadas: number; vaciar: number; anuladas: number; avisos: string[]; nps: FilaNpDB[] }

type PedidoDB = {
  id: string; status: string; quantity_m3: number; plant_id: string; client_id: string; construction_site_id: string | null; formula_id: string
  scheduled_arrival_time: string; created_at: string; created_by: string | null
}

export type EleccionDB = { tipo: TipoNp; proyecto_codigo: number | null; tope_m3: number | null }

export async function eleccionesDe(sb: SB, ids: string[]): Promise<Record<string, EleccionDB>> {
  if (!ids.length) return {}
  const { data, error } = await sb.from("zomatik_np_pedido").select("scheduled_dispatch_id, tipo, proyecto_codigo, tope_m3").in("scheduled_dispatch_id", ids)
  if (error) throw error
  return Object.fromEntries(((data as (EleccionDB & { scheduled_dispatch_id: string })[]) || []).map((e) => [e.scheduled_dispatch_id, { tipo: e.tipo, proyecto_codigo: e.proyecto_codigo ?? null, tope_m3: e.tope_m3 === null || e.tope_m3 === undefined ? null : Number(e.tope_m3) }]))
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

export async function npsDePedidos(sb: SB, ids: string[]): Promise<FilaNpDB[]> {
  if (!ids.length) return []
  const { data, error } = await sb.from("zomatik_np").select(COLUMNAS_NP).in("scheduled_dispatch_id", ids).order("n")
  if (error) throw error
  return (data as unknown as FilaNpDB[]) || []
}

export async function sincronizarPedido(pedidoId: string, usuario: string, eleccion?: Eleccion | null, sb: SB = sbServicio()): Promise<ResultadoSync> {
  const { data: p, error } = await sb.from("scheduled_dispatches").select(COLUMNAS_PEDIDO).eq("id", pedidoId).maybeSingle()
  if (error) throw error
  if (!p) return { activo: false, motivo: "El pedido no existe" }
  const ped = p as unknown as PedidoDB
  const plantas = await plantasNp(sb)
  const planta = plantas[ped.plant_id]
  if (!planta?.zomatik_np_activo) return { activo: false, motivo: "NP: se carga a mano en Zomatik" }
  let nps = await npsDePedidos(sb, [ped.id])
  // Un pedido de antes de prender la llave no tiene NP automática (salvo que ya tenga alguna del sistema)
  if (!pedidoConNp(planta, ped.created_at) && !nps.length) return { activo: true, fuera: true, creadas: 0, vaciar: 0, anuladas: 0, avisos: [], nps }

  // Elección del formulario (NP nueva o de un proyecto): se valida y se guarda en zomatik_np_pedido (solo el servidor)
  let el: EleccionDB = (await eleccionesDe(sb, [ped.id]))[ped.id] || { tipo: "nueva", proyecto_codigo: null, tope_m3: null }
  if (eleccion && (eleccion.tipo === "nueva" || eleccion.tipo === "proyecto")) {
    const proy = eleccion.tipo === "proyecto" && Number(eleccion.proyecto_codigo) > 0 ? Number(eleccion.proyecto_codigo) : null
    const tipo: TipoNp = proy ? "proyecto" : "nueva"
    const tope = proy && eleccion.tope_m3 !== null && eleccion.tope_m3 !== undefined && Number(eleccion.tope_m3) >= 0 ? Number(eleccion.tope_m3) : null
    if (eleccion.tipo === "proyecto" && !proy) return { activo: true, error: "Elegí el proyecto.", creadas: 0, vaciar: 0, anuladas: 0, avisos: [], nps }
    const invalido = proy ? await validarProyecto(sb, ped.client_id, proy) : null
    if (invalido) return { activo: true, error: invalido, creadas: 0, vaciar: 0, anuladas: 0, avisos: [], nps }
    if (tipo !== el.tipo || proy !== el.proyecto_codigo || tope !== el.tope_m3) {
      const { error: e1 } = await sb.from("zomatik_np_pedido").upsert({ scheduled_dispatch_id: ped.id, tipo, proyecto_codigo: proy, tope_m3: tope, updated_by: usuario, updated_at: new Date().toISOString() } as never, { onConflict: "scheduled_dispatch_id" })
      if (e1) throw e1
      el = { tipo, proyecto_codigo: proy, tope_m3: tope }
    }
    if (proy && ped.construction_site_id) await sb.from("construction_sites").update({ zomatik_proyecto_codigo: proy } as never).eq("id", ped.construction_site_id)
  }

  const fecha = diaAR(ped.scheduled_arrival_time)
  const plan = planificarNp(
    { id: ped.id, status: ped.status, quantity_m3: Number(ped.quantity_m3), plant_id: ped.plant_id, client_id: ped.client_id, formula_id: ped.formula_id, fecha, np_tipo: el.tipo, proyecto_codigo: el.proyecto_codigo, proyecto_tope_m3: el.tope_m3 },
    nps,
  )
  const ahora = new Date().toISOString()
  const ref = `Pedido ${ped.id.slice(0, 8)}`
  if (plan.anular.length) {
    await sb.from("zomatik_np").update({ estado: "anulada", mensaje: ped.status === "cancelled" ? "El pedido se canceló antes de generarla" : "Se rehízo con los datos nuevos del pedido", proximo_intento: null, updated_at: ahora } as never).in("id", plan.anular).in("estado", ["pendiente", "error"])
  }
  if (plan.revisar.length) {
    const msg = "El pedido se canceló y esta NP se cortó al grabar: puede estar en Zomatik. Buscala por la marca y vaciala."
    await sb.from("zomatik_np").update({ estado: "revisar", mensaje: msg, proximo_intento: null, updated_at: ahora } as never).in("id", plan.revisar).in("estado", ["pendiente", "error"])
    await avisarGerenciales(sb, "NP para revisar (pedido cancelado)", [msg, ...nps.filter((x) => plan.revisar.includes(x.id)).map((x) => `Marca: ${x.marca}`)])
  }
  if (plan.vaciar.length) {
    await sb.from("zomatik_np").update({ estado: "vaciar", mensaje: "Pedido cancelado: falta vaciar la NP", proximo_intento: ahora, paso: null, updated_at: ahora } as never).in("id", plan.vaciar).eq("estado", "ok")
    await actividadNp(sb, { usuario, pedidoId: ped.id, plantId: ped.plant_id, referencia: ref, detalle: { "Qué pasó": `Pedido cancelado: se van a vaciar ${plan.vaciar.length} NP en Zomatik`, NP: nps.filter((x) => plan.vaciar.includes(x.id)).map((x) => x.numero).join(", ") } })
  }
  let creadas = 0
  for (const c of plan.crear) {
    const fila = {
      scheduled_dispatch_id: ped.id, n: c.n, marca: marcaNp(ped.id, c.n), tipo: c.tipo, es_adicional: c.es_adicional, proyecto_codigo: c.proyecto_codigo,
      plant_id: ped.plant_id, client_id: ped.client_id, formula_id: ped.formula_id, fecha, m3: c.m3, estado: "pendiente", proximo_intento: ahora, created_by: usuario,
    }
    const { error: e2 } = await sb.from("zomatik_np").insert(fila as never)
    if (e2) {
      if ((e2 as { code?: string }).code === "23505") continue // otro proceso la creó recién
      throw e2
    }
    creadas++
    await actividadNp(sb, {
      usuario, action: "crear", pedidoId: ped.id, plantId: ped.plant_id, referencia: ref,
      detalle: { "Qué pasó": c.es_adicional ? `NP adicional por ${c.m3} m³ (el pedido se agrandó)` : `NP ${c.tipo === "proyecto" ? `contra el proyecto ${c.proyecto_codigo}` : "nueva"} por ${c.m3} m³: pendiente de generar`, Marca: fila.marca },
    })
  }
  if (plan.avisos.length) await actividadNp(sb, { usuario, pedidoId: ped.id, plantId: ped.plant_id, referencia: ref, detalle: { "Qué pasó": "Aviso de la NP", Aviso: plan.avisos.join(" · ") } })
  if (plan.crear.length || plan.anular.length || plan.vaciar.length || plan.revisar.length) nps = await npsDePedidos(sb, [ped.id])
  return { activo: true, creadas, vaciar: plan.vaciar.length, anuladas: plan.anular.length, avisos: plan.avisos, nps }
}

// ---------------------------------------------------------------------------
// Procesar con el robot
// ---------------------------------------------------------------------------

export type ResultadoProceso = { ocupado?: boolean; sinTiempo?: boolean; hechas: { id: string; estado: string; mensaje: string | null; numero?: string | null }[]; quedan: number; error?: string }

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
    pedidoId ? sb.from("scheduled_dispatches").select("id, construction_site_id, construction_sites(name, address, localidad)").eq("id", pedidoId).maybeSingle() : Promise.resolve({ data: null }),
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
    guardo = await guardarSi(sb, np.id, G, { ...comunes, estado: "ok", numero: r.numero, zomatik_codigo: r.codigo, sucursal: r.sucursal, paso: "ok", ok_at: ahora, proximo_intento: null })
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
    const msg = `La ${np.numero} ya tiene remitos: no se vació. Revisala en Zomatik.`
    if (await guardarSi(sb, np.id, V, { estado: "revisar", en_curso_desde: null, mensaje: msg, proximo_intento: null })) {
      await actividadNp(sb, { usuario: ctx.usuario, pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: ref, detalle: { "Qué pasó": "Pedido cancelado con NP remitida: no se vació", NP: np.numero } })
      await ctx.dep.avisar(sb, `Pedido cancelado con remitos: ${np.numero}`, [msg, `Pedido ${(np.scheduled_dispatch_id || "").slice(0, 8)} · ${np.m3} m³ · ${np.fecha}`])
    }
    return { estado: "revisar", mensaje: msg }
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
    guardo = await guardarSi(sb, np.id, V, { estado: "vaciada", en_curso_desde: null, mensaje: null, vaciada_at: ahora, proximo_intento: null, paso: "vaciada" })
    if (guardo) await actividadNp(sb, { usuario: ctx.usuario, pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: ref, detalle: { "Qué pasó": `NP vaciada en Zomatik (pedido cancelado): ${np.numero}` } })
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
  const quien = `${o.usuario}·${o.inicio.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
  const { data: turno, error: et } = await sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 60 })
  if (et) throw et
  if (turno !== true) return { ocupado: true, hechas: [], quedan: 0 }
  let ultimaRenovacion = Date.now()
  const ctx: Contexto = {
    plantas: await plantasNp(sb), nav: null, usuario: o.usuario, dep,
    renovar: async () => {
      if (Date.now() - ultimaRenovacion < 10_000) return
      ultimaRenovacion = Date.now()
      await sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 60 })
    },
  }
  const hechas: ResultadoProceso["hechas"] = []
  let quedan = 0
  try {
    const lista = await aTrabajar(sb, o.pedidoId)
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
export async function pasadaNp(usuario: string, o: { inicio: number; hastaMs?: number; sb?: SB } = { inicio: Date.now() }): Promise<{ pedidos: number; sincronizados: number; huerfanas: number }> {
  const sb = o.sb ?? sbServicio()
  const hasta = o.hastaMs ?? 20_000
  const plantas = Object.values(await plantasNp(sb)).filter((p) => p.zomatik_np_activo)
  const ids = new Set<string>()
  if (plantas.length) {
    const desdeDia = new Date(`${hoyAR()}T03:00:00.000Z`).toISOString() // 00:00 de Argentina
    const { data } = await sb.from("scheduled_dispatches").select("id, plant_id, created_at").in("plant_id", plantas.map((p) => p.id)).gte("scheduled_arrival_time", desdeDia).neq("status", "completed").limit(500)
    for (const p of (data as { id: string; plant_id: string; created_at: string }[]) || []) if (pedidoConNp(plantas.find((x) => x.id === p.plant_id), p.created_at)) ids.add(p.id)
  }
  const { data: vivas } = await sb.from("zomatik_np").select("scheduled_dispatch_id").in("estado", ["ok", "pendiente", "error"] as EstadoNp[]).not("scheduled_dispatch_id", "is", null).limit(1000)
  for (const v of (vivas as { scheduled_dispatch_id: string }[]) || []) ids.add(v.scheduled_dispatch_id)
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
  // NP de pedidos borrados: como un pedido cancelado
  const { data: huer } = await sb.from("zomatik_np").select("id").is("scheduled_dispatch_id", null).eq("estado", "ok")
  const h = ((huer as { id: string }[]) || []).map((x) => x.id)
  if (h.length) await sb.from("zomatik_np").update({ estado: "vaciar", mensaje: "El pedido se borró: falta vaciar la NP", proximo_intento: new Date().toISOString() } as never).in("id", h).eq("estado", "ok")
  return { pedidos: ids.size, sincronizados, huerfanas: h.length }
}

// ---------------------------------------------------------------------------
// Estado para las pantallas
// ---------------------------------------------------------------------------

export type EstadoPedidoNp = {
  activo: boolean
  modo: ModoNp
  /** El pedido entra en la NP automática (cargado después de prender la llave). */
  entra: boolean
  nps: FilaNpDB[]
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
  const [{ data: peds }, nps, { data: exc }, elecciones] = await Promise.all([
    sb.from("scheduled_dispatches").select("id, plant_id, created_at").in("id", ids),
    npsDePedidos(sb, ids),
    sb.from("zomatik_np_excepciones").select("scheduled_dispatch_id, autorizado_por, motivo_tipo, motivo").in("scheduled_dispatch_id", ids).eq("fecha", hoyAR()),
    eleccionesDe(sb, ids),
  ])
  const porPedido: Record<string, EstadoPedidoNp> = {}
  for (const p of (peds as { id: string; plant_id: string; created_at: string }[]) || []) {
    const planta = plantas[p.plant_id]
    const modo = modoDe(planta)
    const suyas = nps.filter((x) => x.scheduled_dispatch_id === p.id)
    const entra = pedidoConNp(planta, p.created_at) || suyas.length > 0
    const e = ((exc as { scheduled_dispatch_id: string; autorizado_por: string; motivo_tipo: string; motivo: string | null }[]) || []).find((x) => x.scheduled_dispatch_id === p.id) || null
    porPedido[p.id] = {
      activo: !!planta?.zomatik_np_activo,
      modo,
      entra,
      nps: suyas,
      excepcion: e ? { autorizado_por: e.autorizado_por, motivo_tipo: e.motivo_tipo, motivo: e.motivo } : null,
      control: controlDespacho({ modo, entra, nps: suyas.filter((x) => VIGENTES.includes(x.estado)), excepcion: !!e }),
      eleccion: elecciones[p.id] || null,
    }
  }
  return { porPedido, plantas: resumen }
}

/** Revisión de un gerencial de una NP en "revisar": generar otra (la errónea ya se vació a mano) o dejar esta como buena. */
export async function revisarNp(npId: string, decision: "otra" | "buena", usuario: string, sb: SB = sbServicio()): Promise<{ ok: boolean; error?: string }> {
  const { data } = await sb.from("zomatik_np").select(COLUMNAS_NP).eq("id", npId).maybeSingle()
  const np = data as unknown as FilaNpDB | null
  if (!np) return { ok: false, error: "La NP no existe" }
  if (np.estado !== "revisar") return { ok: false, error: "La NP ya no está para revisar. Actualizá la pantalla." }
  if (decision === "buena") {
    if (!np.numero || !np.zomatik_codigo || np.sucursal !== "18" || !esSerieRebucret(np.numero)) return { ok: false, error: "Esta NP no es de REBUCRET: no se puede dejar como buena." }
    if (!(await guardarSi(sb, np.id, "revisar", { estado: "ok", mensaje: `Revisada por ${usuario}`, ok_at: new Date().toISOString() }))) return { ok: false, error: "La NP cambió. Actualizá la pantalla." }
  } else {
    if (!(await guardarSi(sb, np.id, "revisar", { estado: "anulada", mensaje: `${np.mensaje || ""} · Revisada por ${usuario}: se genera otra`.replace(/^ · /, "") }))) return { ok: false, error: "La NP cambió. Actualizá la pantalla." }
    if (np.scheduled_dispatch_id) await sincronizarPedido(np.scheduled_dispatch_id, usuario, null, sb)
  }
  await actividadNp(sb, { usuario, pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: `Pedido ${(np.scheduled_dispatch_id || "").slice(0, 8)}`, detalle: { "Qué pasó": decision === "buena" ? `NP revisada: queda ${np.numero}` : "NP revisada: se genera otra", NP: np.numero, Antes: np.mensaje } })
  return { ok: true }
}
