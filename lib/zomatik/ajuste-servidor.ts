/**
 * Zomatik · ajustar la NP a lo despachado al finalizar el pedido: el lado del servidor (SOLO rutas de app/api).
 * Spec: docs/specs/2026-11-06-ajustar-np-al-finalizar.md (la sección 15, decisiones de Bautista del 06/11, manda).
 *
 *   prepararAjustes  al finalizar (o "Remitir en Zomatik") un pedido completo: un ajuste por NP que usa, con la cantidad
 *                    que tiene que quedar (ajuste.ts). Sin cambios: "nada". No habla con Zomatik.
 *   trabajarAjustes  dentro de `procesarZ1`, con el mismo turno del robot y ANTES de las OF y remitos: lee la NP, mira si
 *                    tiene factura y edita la cantidad; después lo pasa a la base (`zomatik_ajuste_aplicar`).
 *   gateAjuste       el remito (y su OF) de un pedido completo espera hasta que el ajuste de su NP esté ok, nada o a_mano;
 *                    y le da al remito el pendiente que tiene que traer Zomatik (4.4).
 *   remitirSinAjustar  escape gerencial: la NP se arregló a mano en Zomatik (con motivo). También es "Ya hice la
 *                    devolución" cuando la NP tiene factura (fase 1: la devolución es a mano).
 *
 * LLAVE PROPIA: `zomatik_np_config.ajustar_activo` (apagada por defecto), y además la de la NP y la de remitir.
 * `llaveAjuste()` es el único lugar que arma la llave que pide `navegadorAjuste()`. Con la llave apagada no se arma
 * ningún ajuste y el remito sale como hoy.
 */
import { sbServicio } from "@/lib/auth/servidor"
import { mensajeZomatik, navegadorAjuste } from "@/lib/zomatik/cliente"
import {
  actividadNp, avisarAjusteNp, avisarCaidaFila, avisarErrorZomatik, avisarFallaAcceso, avisarPendienteLargo, avisarZomatikVolvio, esFallaDeAcceso, tipoDeFalla,
  type AvisarFn,
} from "@/lib/zomatik/np-servidor"
import { ajustarCantidadNp, type LlaveAjuste, type NavegadorNp } from "@/lib/zomatik/np-robot"
import { hoyAR, quedaTiempo, trabajoPendiente, type UsoSaldo } from "@/lib/zomatik/np"
import { errorInterno } from "@/lib/zomatik/z1-robot"
import {
  MSJ_ESPERANDO_AJUSTE, MSJ_NP_NO_AJUSTADA, PASOS_GRABAR_AJUSTE, PASO_ADICIONAL_A_MANO, PASO_DEVOL_A_MANO, PASO_NP_SIN_USO, m3Texto, marcaAjuste, msjConFactura, msjConFacturaExceso, pendienteEsperado, planificarAjuste, textoAjuste,
  type EstadoAjuste, type PlanAjuste,
} from "@/lib/zomatik/ajuste"
import { configZ1, prepararRemitos, type ConfigZ1 } from "@/lib/zomatik/z1-servidor"
import { linkNp } from "@/lib/zomatik/web"

type SB = ReturnType<typeof sbServicio>

/** El ÚNICO lugar que arma la llave del ajuste: la NP, la de remitir Y la del ajuste prendidas. */
export function llaveAjuste(c: ConfigZ1 | undefined): LlaveAjuste | null {
  return c?.activo === true && c.remitir_activo === true && c.ajustar_activo === true ? { ajustar: true, plantId: c.plant_id } : null
}

export const COLUMNAS_AJUSTE =
  "id, np_id, scheduled_dispatch_id, plant_id, marca, tipo, m3_np, m3_objetivo, m3_despachado, con_factura, factura_texto, estado, paso, mensaje, intentos, proximo_intento, en_curso_desde, aplicado_at, aviso_juan_at, resuelto_por, resuelto_motivo, created_at, updated_at, ok_at"

export type AjusteDB = {
  id: string; np_id: string; scheduled_dispatch_id: string | null; plant_id: string; marca: string; tipo: string | null
  m3_np: number | null; m3_objetivo: number | null; m3_despachado: number | null; con_factura: boolean | null; factura_texto: string | null
  estado: EstadoAjuste; paso: string | null; mensaje: string | null; intentos: number; proximo_intento: string | null; en_curso_desde: string | null
  aplicado_at: string | null; aviso_juan_at: string | null; resuelto_por: string | null; resuelto_motivo: string | null; created_at: string; updated_at: string; ok_at: string | null
}

const despuesDe = (min: number) => new Date(Date.now() + min * 60_000).toISOString()
const refDe = (pedidoId: string | null | undefined) => `Pedido ${(pedidoId || "").slice(0, 8)}`
/** ¿Falta la migración del ajuste? (entonces todo sigue como hoy) */
const faltaMigracionAjuste = (e: unknown) => /zomatik_np_ajustes|zomatik_ajuste_|ajustar_activo|ajustar_desde|m3_original|does not exist|schema cache/i.test(String((e as { message?: string })?.message || ""))

// ---------------------------------------------------------------------------
// El plan de un pedido (con los datos de la base, sin Zomatik)
// ---------------------------------------------------------------------------

type NpDB = { id: string; n: number; m3: number; estado: string; numero: string | null; zomatik_codigo: number | null; marca: string; plant_id: string | null; formula_id: string | null; saldo_decision?: string | null }

type PlanPedido =
  | { aplica: false; motivo: string }
  | { aplica: true; pedido: { id: string; plant_id: string; status: string }; planes: PlanAjuste[]; nps: Map<string, NpDB> }

async function lista<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await q
  if (error) throw error
  return (data as T[]) || []
}

/**
 * Lo que tiene que quedar en cada NP del pedido. No aplica (y el remito sale como hoy) si: la llave del ajuste está
 * apagada, el pedido no está completo o no tiene ningún despacho creado después de prender la llave (`ajustar_desde`).
 */
export async function planDelPedido(sb: SB, pedidoId: string, cfgs?: Record<string, ConfigZ1>): Promise<PlanPedido> {
  const { data: p } = await sb.from("scheduled_dispatches").select("id, plant_id, status").eq("id", pedidoId).maybeSingle()
  if (!p) return { aplica: false, motivo: "El pedido no existe" }
  const ped = p as { id: string; plant_id: string; status: string }
  const cfg = (cfgs ?? (await configZ1(sb)))[ped.plant_id]
  if (!llaveAjuste(cfg)) return { aplica: false, motivo: "El ajuste de la NP está apagado" }
  if (ped.status !== "completed") return { aplica: false, motivo: "El pedido no está completo" }
  const despachos = (await lista<{ id: string; quantity_m3: number | null; created_at: string; is_test_dispatch: boolean | null }>(
    sb.from("dispatches").select("id, quantity_m3, created_at, is_test_dispatch").eq("scheduled_dispatch_id", ped.id).limit(1000),
  )).filter((d) => !d.is_test_dispatch && Number(d.quantity_m3) > 0)
  if (!despachos.some((d) => !cfg!.ajustar_desde || d.created_at >= cfg!.ajustar_desde)) return { aplica: false, motivo: "El pedido es de antes de prender el ajuste" }
  // Los usos del pedido y sus NP
  const usosPed = await lista<{ id: string; np_id: string; scheduled_dispatch_id: string | null; m3: number; activo: boolean; created_at: string; despachado_fijo: number | null }>(
    sb.from("zomatik_np_uso").select("id, np_id, scheduled_dispatch_id, m3, activo, created_at, despachado_fijo").eq("scheduled_dispatch_id", ped.id),
  )
  const npIds = [...new Set(usosPed.map((u) => u.np_id))]
  const nps = npIds.length ? await lista<NpDB>(sb.from("zomatik_np").select("id, n, m3, estado, numero, zomatik_codigo, marca, plant_id, formula_id, saldo_decision").in("id", npIds)) : []
  // Lo que comprometen los otros pedidos de esas NP (la misma cuenta que el saldo)
  const deNps = npIds.length ? await lista<typeof usosPed[number]>(sb.from("zomatik_np_uso").select("id, np_id, scheduled_dispatch_id, m3, activo, created_at, despachado_fijo").in("np_id", npIds)) : []
  const otrosPed = [...new Set(deNps.map((u) => u.scheduled_dispatch_id).filter((x): x is string => !!x && x !== ped.id))]
  const dePedidos = otrosPed.length ? await lista<typeof usosPed[number]>(sb.from("zomatik_np_uso").select("id, np_id, scheduled_dispatch_id, m3, activo, created_at, despachado_fijo").in("scheduled_dispatch_id", otrosPed)) : []
  const peds = otrosPed.length ? await lista<{ id: string; status: string; dispatched_m3: number | null }>(sb.from("scheduled_dispatches").select("id, status, dispatched_m3").in("id", otrosPed)) : []
  const porPed = new Map(peds.map((x) => [x.id, x]))
  const todos = [...new Map([...deNps, ...dePedidos].map((u) => [u.id, u])).values()].filter((u) => u.scheduled_dispatch_id !== ped.id)
  const usosSaldo: UsoSaldo[] = todos.map((u) => ({
    id: u.id, np_id: u.np_id, m3: Number(u.m3), activo: u.activo, created_at: u.created_at,
    despachado_fijo: u.despachado_fijo === null || u.despachado_fijo === undefined ? null : Number(u.despachado_fijo),
    pedido: u.scheduled_dispatch_id ? porPed.get(u.scheduled_dispatch_id) || null : null,
  }))
  // Lo remitido por este pedido contra cada NP y lo que todavía no está en ningún remito
  const remitos = await lista<{ np_id: string | null; m3: number }>(sb.from("zomatik_remitos").select("np_id, m3").eq("scheduled_dispatch_id", ped.id).neq("estado", "anulado"))
  const remitidoPorNp: Record<string, number> = {}
  for (const r of remitos) if (r.np_id) remitidoPorNp[r.np_id] = (remitidoPorNp[r.np_id] || 0) + Number(r.m3)
  const enRemito = new Set((await lista<{ dispatch_id: string }>(sb.from("zomatik_remito_despachos").select("dispatch_id").in("dispatch_id", despachos.map((d) => d.id)))).map((x) => x.dispatch_id))
  const sinRemitir = despachos.filter((d) => !enRemito.has(d.id)).reduce((s, d) => s + Number(d.quantity_m3), 0)
  const planes = planificarAjuste({
    pedidoId: ped.id, status: ped.status,
    despachos: despachos.map((d) => ({ id: d.id, m3: Number(d.quantity_m3), created_at: d.created_at })),
    remitirDesde: cfg!.remitir_desde, usosDelPedido: usosPed.map((u) => ({ ...u, m3: Number(u.m3) })),
    nps: nps.map((x) => ({ id: x.id, n: x.n, m3: Number(x.m3), estado: x.estado, numero: x.numero, zomatik_codigo: x.zomatik_codigo, saldo_decision: x.saldo_decision ?? null })),
    usosSaldo, remitidoPorNp, sinRemitir,
  })
  return { aplica: true, pedido: ped, planes, nps: new Map(nps.map((x) => [x.id, x])) }
}

// ---------------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------------

/** Ajuste en "revisar" o "error": un mail a Bautista por episodio (15.4). */
async function avisarTrabado(sb: SB, avisar: AvisarFn, a: { marca: string; scheduled_dispatch_id: string | null }, numero: string | null, estado: "revisar" | "error", mensaje: string | null, recorte?: string) {
  const ref = refDe(a.scheduled_dispatch_id)
  const r = await avisar(sb, `Zomatik: ajuste de la NP ${estado === "error" ? "con error" : "para revisar"} · ${ref}`, [
    `${ref} · ${numero || "NP"}`,
    `Mensaje: ${mensaje || "(sin mensaje)"}`,
    "El remito del pedido espera hasta que se resuelva. Si la NP se arregló a mano en Zomatik, un gerencial toca «Remitir sin ajustar la NP» en el pedido.",
    `Marca: ${a.marca}`,
    ...(recorte ? [`Respuesta de Zomatik (recorte): ${recorte}`] : []),
  ])
  if (!r.enviado) console.error("[zomatik-ajuste] aviso:", r.motivo)
}

// ---------------------------------------------------------------------------
// Preparar los ajustes de un pedido
// ---------------------------------------------------------------------------

export type ResultadoAjustes = { aplica: false; motivo: string } | { aplica: true; creados: number; pendientes: number; ajustes: { np_id: string; estado: string; mensaje: string | null }[] }

/**
 * Un ajuste por NP del pedido (idempotente: una fila por pedido y NP, marca única). Lo llaman "Finalizar" / "Remitir en
 * Zomatik" (después de armar los remitos), la pasada de la noche y el gate de `procesarZ1`. Un ajuste "anulado" (el
 * pedido se había reabierto) vuelve a armarse. Los que ya existen no se tocan (el robot recalcula antes de grabar).
 */
export async function prepararAjustes(pedidoId: string, usuario: string, sb: SB = sbServicio(), o: { cfg?: Record<string, ConfigZ1>; avisar?: AvisarFn } = {}): Promise<ResultadoAjustes> {
  const p = await planDelPedido(sb, pedidoId, o.cfg)
  if (!p.aplica) return p
  const avisar = o.avisar ?? avisarErrorZomatik
  const ya = await lista<AjusteDB>(sb.from("zomatik_np_ajustes").select(COLUMNAS_AJUSTE).eq("scheduled_dispatch_id", p.pedido.id))
  let creados = 0
  const ahora = new Date().toISOString()
  for (const pl of p.planes) {
    const np = p.nps.get(pl.np_id)!
    const existe = ya.find((x) => x.np_id === pl.np_id)
    if (existe && existe.estado !== "anulado") continue
    const fila = {
      tipo: pl.tipo, m3_np: pl.m3_np, m3_objetivo: pl.m3_objetivo, m3_despachado: pl.m3_despachado, estado: pl.estado, mensaje: pl.mensaje, paso: pl.paso ?? null,
      proximo_intento: pl.estado === "pendiente" ? ahora : null, en_curso_desde: null, ok_at: pl.estado === "nada" ? ahora : null, aplicado_at: null, updated_at: ahora,
    }
    if (existe) {
      const { data, error } = await sb.from("zomatik_np_ajustes").update(fila as never).eq("id", existe.id).eq("estado", "anulado").select("id")
      if (error) throw error
      if (!((data as unknown[]) || []).length) continue
    } else {
      const { error } = await sb.from("zomatik_np_ajustes").insert({ ...fila, np_id: pl.np_id, scheduled_dispatch_id: p.pedido.id, plant_id: p.pedido.plant_id, marca: marcaAjuste(p.pedido.id, np), created_by: usuario } as never)
      if (error && (error as { code?: string }).code === "23505") continue // otro proceso lo armó recién
      if (error) throw error
    }
    creados++
    const que = pl.estado === "nada" ? `Ajuste de la NP: nada que cambiar (${np.numero} ${m3Texto(pl.m3_np)} m³)` : pl.estado === "pendiente" ? `Ajuste de la NP pendiente: ${textoAjuste(pl)}` : "Ajuste de la NP para revisar"
    await actividadNp(sb, { usuario, action: "crear", pedidoId: p.pedido.id, plantId: p.pedido.plant_id, referencia: refDe(p.pedido.id), detalle: { "Qué pasó": que, ...(pl.mensaje ? { Mensaje: pl.mensaje } : {}), NP: np.numero, Marca: marcaAjuste(p.pedido.id, np) } })
    if (pl.estado === "revisar") await avisarTrabado(sb, avisar, { marca: marcaAjuste(p.pedido.id, np), scheduled_dispatch_id: p.pedido.id }, np.numero, "revisar", pl.mensaje)
  }
  const ahoraHay = await lista<AjusteDB>(sb.from("zomatik_np_ajustes").select(COLUMNAS_AJUSTE).eq("scheduled_dispatch_id", p.pedido.id))
  return {
    aplica: true, creados,
    pendientes: ahoraHay.filter((x) => x.estado === "pendiente" || x.estado === "generando").length,
    ajustes: ahoraHay.map((x) => ({ np_id: x.np_id, estado: x.estado, mensaje: x.mensaje })),
  }
}

/** `prepararAjustes` que no rompe lo de hoy: sin la migración (o con cualquier falla) devuelve null y se avisa por consola. */
export async function prepararAjustesSeguro(pedidoId: string, usuario: string, sb?: SB): Promise<ResultadoAjustes | null> {
  try {
    return await prepararAjustes(pedidoId, usuario, sb)
  } catch (e) {
    if (!faltaMigracionAjuste(e)) console.error("[zomatik-ajuste] preparar", pedidoId, (e as Error)?.message)
    return null
  }
}

// ---------------------------------------------------------------------------
// El gate del remito (4.4)
// ---------------------------------------------------------------------------

async function ajusteDe(sb: SB, pedidoId: string, npId: string): Promise<AjusteDB | null> {
  const { data, error } = await sb.from("zomatik_np_ajustes").select(COLUMNAS_AJUSTE).eq("scheduled_dispatch_id", pedidoId).eq("np_id", npId).maybeSingle()
  if (error) throw error
  return (data as unknown as AjusteDB) || null
}

/** Mensaje del remito cuando no se pudo leer el ajuste (una falla pasajera de la base): espera, nunca sale libre. */
export const MSJ_GATE_SIN_LEER = `${MSJ_ESPERANDO_AJUSTE} (no se pudo leer el ajuste: se reintenta)`

export type Gate = { espera: false; pendienteEsperado: number | null } | { espera: true; mensaje: string }

/**
 * ¿Puede salir el remito (y su OF)? Solo se controla un remito de pedido de un pedido completo, con la llave del ajuste
 * prendida y si el ajuste aplica al pedido. Sale con el ajuste de su NP en ok o nada (con el pendiente que tiene que
 * traer Zomatik) o a_mano (sin control). Si no, espera. Sin tocar Zomatik.
 */
export async function gateAjuste(sb: SB, r: { id: string; tipo: string; np_id: string | null; scheduled_dispatch_id: string | null; plant_id: string }, o: { usuario: string; cfg: Record<string, ConfigZ1>; avisar?: AvisarFn }): Promise<Gate> {
  if (r.tipo !== "pedido" || !r.np_id || !r.scheduled_dispatch_id || !llaveAjuste(o.cfg[r.plant_id])) return { espera: false, pendienteEsperado: null }
  try {
    return await gate(sb, { ...r, np_id: r.np_id, scheduled_dispatch_id: r.scheduled_dispatch_id }, o)
  } catch (e) {
    // Una falla de la base leyendo el pedido o el ajuste: el remito espera (nunca sale sin el control)
    console.error("[zomatik-ajuste] gate", r.id, (e as Error)?.message)
    return { espera: true, mensaje: MSJ_GATE_SIN_LEER }
  }
}

async function gate(sb: SB, r: { id: string; np_id: string; scheduled_dispatch_id: string; plant_id: string }, o: { usuario: string; cfg: Record<string, ConfigZ1>; avisar?: AvisarFn }): Promise<Gate> {
  const libre: Gate = { espera: false, pendienteEsperado: null }
  const { data: ped, error: ep } = await sb.from("scheduled_dispatches").select("id, status").eq("id", r.scheduled_dispatch_id).maybeSingle()
  if (ep) throw ep
  if (!ped) return { espera: true, mensaje: MSJ_GATE_SIN_LEER }
  if ((ped as { status?: string }).status !== "completed") return libre
  let a = await ajusteDe(sb, r.scheduled_dispatch_id, r.np_id)
  if (!a || a.estado === "anulado") {
    // Se cortó entre armar el remito y armar el ajuste (o el pedido se había reabierto)
    const p = await prepararAjustes(r.scheduled_dispatch_id, o.usuario, sb, { cfg: o.cfg, avisar: o.avisar })
    if (!p.aplica) return libre
    a = await ajusteDe(sb, r.scheduled_dispatch_id, r.np_id)
  }
  if (!a || a.estado === "anulado") return { espera: true, mensaje: MSJ_ESPERANDO_AJUSTE }
  if (a.estado === "a_mano") return libre
  if (a.estado === "ok" || a.estado === "nada") {
    // Un gerencial liberó ESTA fila del control del pendiente ("Remitir igual"): sale sin controlar
    const { data: rm, error: er } = await sb.from("zomatik_remitos").select("id, sin_control_pendiente").eq("id", r.id).maybeSingle()
    if (er) throw er
    if ((rm as { sin_control_pendiente?: boolean } | null)?.sin_control_pendiente === true) return libre
    const { data: np, error: en } = await sb.from("zomatik_np").select("id, m3").eq("id", r.np_id).maybeSingle()
    if (en) throw en
    if (!np) return { espera: true, mensaje: MSJ_GATE_SIN_LEER }
    const otros = await lista<{ id: string; m3: number }>(sb.from("zomatik_remitos").select("id, m3").eq("np_id", r.np_id).eq("remito_estado", "ok"))
    const remitido = otros.filter((x) => x.id !== r.id).reduce((s, x) => s + Number(x.m3), 0)
    return { espera: false, pendienteEsperado: pendienteEsperado(Number((np as { m3: number }).m3), remitido) }
  }
  return { espera: true, mensaje: a.estado === "revisar" || a.estado === "error" ? `${MSJ_ESPERANDO_AJUSTE}: ${a.mensaje || "hay que revisarlo"}` : MSJ_ESPERANDO_AJUSTE }
}

// ---------------------------------------------------------------------------
// Trabajar los ajustes con el robot (dentro de procesarZ1, con su turno)
// ---------------------------------------------------------------------------

export type DependenciasAjuste = {
  navegador: (llave: LlaveAjuste, codigoNp: number) => Promise<NavegadorNp>
  robot: { ajustarCantidadNp: typeof ajustarCantidadNp }
  /** Mail a Bautista: ajuste en revisar o error, robot caído, pendiente largo */
  avisarError: AvisarFn
  /** Mail a Juan: la NP tiene factura */
  avisarJuan: AvisarFn
}
export const DEPENDENCIAS_AJUSTE: DependenciasAjuste = { navegador: navegadorAjuste, robot: { ajustarCantidadNp }, avisarError: avisarErrorZomatik, avisarJuan: avisarAjusteNp }

/** Los ajustes para trabajar ahora (como las NP: pendientes con el reintento vencido y colgados). Con el botón, los del pedido, también los de error. */
export async function ajustesATrabajar(sb: SB, cfg: Record<string, ConfigZ1>, pedidoId?: string | null): Promise<AjusteDB[]> {
  try {
    let q = sb.from("zomatik_np_ajustes").select(COLUMNAS_AJUSTE).in("estado", ["pendiente", "generando", ...(pedidoId ? ["error"] : [])]).order("created_at").limit(20)
    if (pedidoId) q = q.eq("scheduled_dispatch_id", pedidoId)
    const { data, error } = await q
    if (error) throw error
    const ahora = Date.now()
    return ((data as unknown as AjusteDB[]) || []).filter((a) => !!llaveAjuste(cfg[a.plant_id]) && trabajoPendiente(a, ahora, !!pedidoId))
  } catch (e) {
    if (!faltaMigracionAjuste(e)) console.error("[zomatik-ajuste] a trabajar", (e as Error)?.message)
    return []
  }
}

class Cambio extends Error {
  name = "Cambio"
}

async function guardarSi(sb: SB, id: string, cambios: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await sb.from("zomatik_np_ajustes").update({ ...cambios, updated_at: new Date().toISOString() } as never).eq("id", id).eq("estado", "generando").select("id")
  if (error) throw error
  return ((data as unknown[]) || []).length > 0
}

/** Lo que el robot necesita de la NP y del pedido. */
async function datosAjuste(sb: SB, a: AjusteDB) {
  const { data: np } = await sb.from("zomatik_np").select("id, n, m3, estado, numero, zomatik_codigo, marca, plant_id, formula_id").eq("id", a.np_id).maybeSingle()
  const x = np as NpDB | null
  const { data: f } = x?.formula_id ? await sb.from("formulas").select("id, zomatik_articulo_codigo, zomatik_articulo_nombre").eq("id", x.formula_id).maybeSingle() : { data: null }
  const codArt = (f as { zomatik_articulo_codigo?: number | null } | null)?.zomatik_articulo_codigo ?? null
  const { data: art } = codArt ? await sb.from("zomatik_articulos").select("codigo, nombre").eq("codigo", codArt).maybeSingle() : { data: null }
  const { data: ped } = a.scheduled_dispatch_id ? await sb.from("scheduled_dispatches").select("id, status, clients(name), construction_sites(name)").eq("id", a.scheduled_dispatch_id).maybeSingle() : { data: null }
  const pd = ped as { status?: string; clients?: { name?: string } | null; construction_sites?: { name?: string } | null } | null
  return {
    np: x,
    articuloCodigo: codArt,
    articuloNombre: (art as { nombre?: string } | null)?.nombre || (f as { zomatik_articulo_nombre?: string } | null)?.zomatik_articulo_nombre || "",
    status: pd?.status ?? null,
    cliente: pd?.clients?.name ?? null,
    obra: pd?.construction_sites?.name ?? null,
  }
}

export type ResultadoTrabajoAjustes = { hechas: { id: string; estado: string; mensaje: string | null }[]; listos: Set<string>; corte: boolean }

/**
 * Trabaja los ajustes (cada uno se toma en la base antes de tocar Zomatik, como los remitos). Cada paso se guarda solo
 * si el ajuste sigue "generando"; el Grabar queda registrado ANTES de mandarse. Devuelve los pedidos cuyos ajustes
 * quedaron listos (sus remitos ya pueden salir en esta misma pasada).
 */
export async function trabajarAjustes(sb: SB, ajustes: AjusteDB[], o: { usuario: string; cfg: Record<string, ConfigZ1>; inicio: number; manual: boolean; renovar: () => Promise<void>; dep: DependenciasAjuste }): Promise<ResultadoTrabajoAjustes> {
  const out: ResultadoTrabajoAjustes = { hechas: [], listos: new Set(), corte: false }
  let volvio = false
  for (const a of ajustes) {
    if (!quedaTiempo(o.inicio, Date.now())) break
    const llave = llaveAjuste(o.cfg[a.plant_id])
    if (!llave) continue
    const { data: tom, error: et } = await sb.rpc("zomatik_ajuste_tomar", { p_id: a.id, p_desde: ["pendiente", ...(o.manual ? ["error"] : [])] })
    if (et) throw et
    const t = (tom as { ajuste_id: string; estado_anterior: string; paso_anterior: string | null }[] | null)?.[0]
    if (!t) continue
    const antes = { estado: t.estado_anterior, paso: t.paso_anterior }
    const ref = refDe(a.scheduled_dispatch_id)
    let ultimoPaso: string | null = null
    let numero: string | null = null
    const hecho = (estado: string, mensaje: string | null) => out.hechas.push({ id: a.id, estado, mensaje })
    const pendienteLargo = async (mensaje: string | null) => {
      const intentos = Number(a.intentos || 0) + 1
      await avisarPendienteLargo(sb, o.dep.avisarError, {
        usuario: o.usuario, pedidoId: a.scheduled_dispatch_id, plantId: a.plant_id, ref, marca: a.marca, creada: a.created_at, intentos,
        titulo: `Ajuste de la NP pendiente hace más de 1 hora · ${ref}`,
        lineas: [
          `${ref} · ${numero || "NP"}`,
          `El ajuste de la NP lleva más de 1 hora sin salir (${intentos} intentos), por red o sesión de Zomatik. El remito del pedido espera.`,
          `Último mensaje: ${mensaje || "(sin mensaje)"}`,
          `Marca: ${a.marca}`,
          "Se sigue reintentando en la próxima pasada (cada 10 minutos). Este aviso llega una sola vez por ajuste.",
        ],
      })
    }
    /** Termina el intento con un estado que no es "ok" (actividad y avisos de cada caso). */
    const trabar = async (estado: "revisar" | "error" | "pendiente", mensaje: string | null, extra: Record<string, unknown> = {}, recorte?: string) => {
      const guardo = await guardarSi(sb, a.id, { estado, en_curso_desde: null, mensaje, proximo_intento: estado === "pendiente" ? despuesDe(10) : null, ...extra })
      await actividadNp(sb, { usuario: o.usuario, pedidoId: a.scheduled_dispatch_id, plantId: a.plant_id, referencia: ref, detalle: { "Qué pasó": "El ajuste de la NP no salió", Estado: estado, Mensaje: mensaje, Paso: (extra.paso as string) || ultimoPaso, NP: numero, Marca: a.marca, ...(recorte ? { "Respuesta de Zomatik (recorte)": recorte } : {}) } })
      if (guardo && estado !== "pendiente" && antes.estado !== estado) await avisarTrabado(sb, o.dep.avisarError, a, numero, estado, mensaje, recorte)
      if (guardo && estado === "pendiente") await pendienteLargo(mensaje)
      hecho(estado, mensaje)
    }
    try {
      const d = await datosAjuste(sb, a)
      numero = d.np?.numero ?? null
      // El pedido se reabrió con el ajuste sin hacer (4.1): no se ajusta
      if (d.status !== "completed") {
        await guardarSi(sb, a.id, { estado: "anulado", en_curso_desde: null, proximo_intento: null, mensaje: "El pedido ya no está completo: no se ajusta." })
        hecho("anulado", null)
        continue
      }
      if (!d.np?.zomatik_codigo || d.np.estado !== "ok") {
        await trabar("revisar", "La NP no está en Zomatik: no se puede ajustar.")
        continue
      }
      const aplicar = async (objetivo: number, m3Antes: number) => {
        const { data, error } = await sb.rpc("zomatik_ajuste_aplicar", { p_id: a.id })
        const r = data as { ok?: boolean; error?: string } | null
        if (error || !r?.ok) {
          // Zomatik ya dice el objetivo: queda "generando" en "aplicar" y el reintento solo repite esto
          console.error("[zomatik-ajuste] aplicar", a.id, (error as { message?: string } | null)?.message || r?.error)
          await actividadNp(sb, { usuario: o.usuario, pedidoId: a.scheduled_dispatch_id, plantId: a.plant_id, referencia: ref, detalle: { "Qué pasó": "Ajuste de la NP: Zomatik ya está, falta guardarlo en el sistema", Mensaje: (error as { message?: string } | null)?.message || r?.error || null, Marca: a.marca } })
          hecho("generando", "falta guardarlo en el sistema")
          return
        }
        await actividadNp(sb, { usuario: o.usuario, pedidoId: a.scheduled_dispatch_id, plantId: a.plant_id, referencia: ref, detalle: { "Qué pasó": `NP ajustada en Zomatik: ${textoAjuste({ numero, m3_np: m3Antes, m3_objetivo: objetivo })}`, Marca: a.marca } })
        out.listos.add(a.scheduled_dispatch_id || "")
        hecho("ok", textoAjuste({ numero, m3_np: m3Antes, m3_objetivo: objetivo }))
        // Se agrandó (exceso): el despacho que había quedado afuera ahora entra en el remito (3.3)
        if (objetivo > m3Antes + 0.001 && a.scheduled_dispatch_id) {
          try {
            await prepararRemitos(a.scheduled_dispatch_id, null, o.usuario, sb)
          } catch (e) {
            console.error("[zomatik-ajuste] remitos después de agrandar", a.scheduled_dispatch_id, (e as Error)?.message) // la pasada de la noche lo vuelve a armar
          }
        }
      }
      // Solo faltaba pasarlo a la base: no se vuelve a abrir Zomatik
      if (antes.paso === "aplicar" || a.aplicado_at) {
        await aplicar(Number(a.m3_objetivo), Number(a.m3_np))
        continue
      }
      // Trabado: más de 3 cortes seguidos (colgado en "generando")
      if (antes.estado === "generando" && Number(a.intentos || 0) >= 3) {
        await trabar("revisar", "El ajuste se cortó más de 3 veces. Revisá la NP en Zomatik antes de seguir.")
        continue
      }
      const cortado = PASOS_GRABAR_AJUSTE.includes(antes.paso || "")
      let objetivo = Number(a.m3_objetivo)
      let despachado = Number(a.m3_despachado)
      const m3Np = Number(d.np.m3)
      if (!cortado) {
        // El plan de ahora (un despacho pudo cambiar desde que se armó): solo si todavía no hubo un Grabar
        const p = await planDelPedido(sb, a.scheduled_dispatch_id || "", o.cfg)
        const pl = p.aplica ? p.planes.find((x) => x.np_id === a.np_id) : null
        if (!pl) {
          await trabar("revisar", p.aplica ? "El pedido ya no usa esta NP: revisala." : `No se puede ajustar: ${p.motivo}.`)
          continue
        }
        if (pl.estado === "nada") {
          await guardarSi(sb, a.id, { estado: "nada", tipo: "nada", en_curso_desde: null, proximo_intento: null, mensaje: null, m3_np: pl.m3_np, m3_objetivo: pl.m3_objetivo, m3_despachado: pl.m3_despachado, ok_at: new Date().toISOString() })
          out.listos.add(a.scheduled_dispatch_id || "")
          hecho("nada", null)
          continue
        }
        if (pl.estado === "revisar") {
          await trabar("revisar", pl.mensaje, { m3_objetivo: pl.m3_objetivo, m3_despachado: pl.m3_despachado, ...(pl.paso ? { paso: pl.paso } : {}) })
          continue
        }
        objetivo = pl.m3_objetivo
        despachado = pl.m3_despachado
        if (!(await guardarSi(sb, a.id, { tipo: "editar", m3_np: pl.m3_np, m3_objetivo: objetivo, m3_despachado: despachado }))) throw new Cambio("El ajuste cambió mientras se trabajaba")
      }
      const nav = await o.dep.navegador(llave, d.np.zomatik_codigo)
      if (!volvio) {
        volvio = true
        await avisarZomatikVolvio(sb, o.dep.avisarError)
      }
      const res = await o.dep.robot.ajustarCantidadNp(nav, {
        codigo: d.np.zomatik_codigo, numero: d.np.numero, marca: d.np.marca, articuloCodigo: d.articuloCodigo, articuloNombre: d.articuloNombre,
        m3Np, objetivo, cortado,
      }, {
        hoy: hoyAR(),
        alPaso: async (paso) => {
          ultimoPaso = paso
          await o.renovar()
          if (!(await guardarSi(sb, a.id, { paso }))) throw new Cambio("El ajuste cambió mientras se trabajaba")
        },
      })
      if (res.estado === "ok") {
        // La cantidad de ANTES es la de la base (todavía sin aplicar): después de un corte el robot ya lee el objetivo
        if (!(await guardarSi(sb, a.id, { paso: "aplicar", m3_np: m3Np, con_factura: false, factura_texto: null }))) throw new Cambio("El ajuste cambió mientras se trabajaba")
        await aplicar(objetivo, m3Np)
        continue
      }
      if (res.estado === "con_factura") {
        // 15.1 y fase 1: la NP no se toca; la devolución (o la NP adicional, si se despachó de más) la hace una persona
        const cant = res.leido ?? m3Np
        const exceso = objetivo > cant + 0.001
        const fac = res.facturaNumero ?? null
        const msj = exceso ? msjConFacturaExceso(objetivo - cant, fac) : msjConFactura(cant - objetivo, fac)
        const guardo = await guardarSi(sb, a.id, { estado: "revisar", tipo: exceso ? "adicional" : "devol", con_factura: true, factura_texto: [fac, res.facturaTexto].filter(Boolean).join(" · ") || null, m3_np: cant, mensaje: msj, paso: exceso ? PASO_ADICIONAL_A_MANO : PASO_DEVOL_A_MANO, en_curso_desde: null, proximo_intento: null })
        await actividadNp(sb, { usuario: o.usuario, pedidoId: a.scheduled_dispatch_id, plantId: a.plant_id, referencia: ref, detalle: { "Qué pasó": "La NP tiene factura: no se tocó", Mensaje: msj, "Por qué": res.facturaTexto, NP: numero, ...(fac ? { Factura: fac } : {}), Marca: a.marca } })
        if (guardo && !a.aviso_juan_at) {
          const m = await o.dep.avisarJuan(sb, `${exceso ? "NP adicional a mano" : "Devolución a mano"} · NP con factura · ${d.cliente || "cliente"} · ${numero || "NP"}${fac ? ` · ${fac}` : ""}`, [
            `${d.cliente || "Cliente"}${d.obra ? ` · ${d.obra}` : ""}`,
            `${numero || "NP"}: ${m3Texto(cant)} m³ en la NP y ${m3Texto(despachado)} m³ despachados.`,
            fac ? `Factura de la NP: ${fac} (hecha antes de este remito: pago adelantado o remitos de días anteriores ya facturados).` : "La NP ya tiene factura (pago adelantado o remitos de días anteriores ya facturados).",
            exceso ? `Se despacharon ${m3Texto(objetivo - cant)} m³ de más: hacé una NP adicional por esa diferencia a mano en Zomatik.` : `Hacé la devolución (DEVOL) de ${m3Texto(cant - objetivo)} m³ a mano en Zomatik.`,
            exceso ? "Después tocá «Ya hice la NP adicional» en el pedido (Despacho, menú ⋮): recién ahí sale el remito." : "Después tocá «Ya hice la devolución» en el pedido (Despacho, menú ⋮): recién ahí sale el remito.",
            ...(linkNp(d.np.zomatik_codigo) ? [`Ver en Zomatik: ${linkNp(d.np.zomatik_codigo)}`] : []),
            "Revisá si corresponde una nota de crédito.",
            `Por qué el sistema cree que tiene factura: ${res.facturaTexto || "Zomatik no dejó editarla"}`,
            `Marca: ${a.marca}`,
          ])
          await sb.from("zomatik_np_ajustes").update({ aviso_juan_at: new Date().toISOString() } as never).eq("id", a.id)
          if (!m.enviado) await actividadNp(sb, { usuario: o.usuario, pedidoId: a.scheduled_dispatch_id, plantId: a.plant_id, referencia: ref, detalle: { "Qué pasó": "Mail a Juan (NP con factura): no salió", Motivo: m.motivo || "sin mail", Marca: a.marca } })
        }
        hecho("revisar", msj)
        continue
      }
      await trabar(res.estado, res.mensaje, { paso: res.paso, ...(res.leido !== undefined && res.leido !== null ? { m3_np: res.leido } : {}) }, res.recorte)
    } catch (e) {
      if (e instanceof Cambio) {
        hecho("cambió", e.message)
        continue
      }
      const interno = errorInterno(e)
      const m = interno ?? mensajeZomatik(e)
      const volvioPend = await guardarSi(sb, a.id, { estado: "pendiente", en_curso_desde: null, mensaje: m, proximo_intento: despuesDe(10) })
      hecho("pendiente", m)
      if (volvioPend) {
        if (esFallaDeAcceso(e)) {
          await avisarFallaAcceso(sb, o.dep.avisarError, { que: `el ajuste de la NP (${ref})`, mensaje: m, codigo: tipoDeFalla(e) })
        } else {
          await avisarCaidaFila(sb, o.dep.avisarError, {
            usuario: o.usuario, pedidoId: a.scheduled_dispatch_id, plantId: a.plant_id, ref, marca: a.marca,
            firma: `${tipoDeFalla(e)}|${ultimoPaso || "inicio"}`, mensaje: m, paso: ultimoPaso, quePaso: interno ? "Ajuste de la NP: error interno" : "Ajuste de la NP: el robot se cayó",
            titulo: `El robot de Zomatik se cayó con el ajuste de la NP · ${ref}`,
            lineas: [
              `${ref} · ${numero || "NP"}`,
              `Qué se estaba haciendo: el ajuste de la NP${ultimoPaso ? ` · paso ${ultimoPaso}` : ""}`,
              `Mensaje: ${m || "(sin mensaje)"}`,
              `Marca: ${a.marca}`,
              "Queda pendiente: se reintenta en la próxima pasada (cada 10 minutos). Mientras se caiga igual, no llega otro mail.",
            ],
          })
        }
        await pendienteLargo(m)
      }
      if (esFallaDeAcceso(e) || /sesi[oó]n|entrar a Zomatik|login|ZOMATIK_USER/i.test(m)) {
        out.corte = true
        break
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Escape gerencial y estado para las pantallas
// ---------------------------------------------------------------------------

/** Solo un ajuste trabado se resuelve a mano: nunca uno pendiente, generando, ok ni nada (I-3). */
const TRABADOS: EstadoAjuste[] = ["revisar", "error"]

export type ResolucionAjuste = { motivo: string; ajusteId?: string | null; /** NP sin uso (15.5): true = "ya la eliminé en Zomatik"; false = dejarla */ eliminada?: boolean | null }

/**
 * Un gerencial resolvió a mano UN ajuste trabado (revisar o error) del pedido. Si hay uno solo, ese; si hay más, el que
 * eligió el diálogo (`ajusteId`). Según el caso:
 *   devol_a_mano     "Ya hice la devolución" (NP con factura): en la base lo mismo que `aplicar` (zomatik_ajuste_aplicar
 *                    con la NP bloqueada: m3 = objetivo, uso = lo despachado, saldo cerrado si corresponde) y 'a_mano'.
 *   adicional_a_mano "Ya hice la NP adicional": 'a_mano', la NP no se toca.
 *   np_sin_uso       "Ya la eliminé en Zomatik" (la NP queda cerrada, como "Ya la devolví") o "dejarla" (no se toca).
 *   el resto         "Remitir sin ajustar la NP": 'a_mano', la NP no se toca.
 * Los remitos del pedido que esperaban salen ya. Lo controla la ruta (solo gerenciales, con motivo).
 */
export async function remitirSinAjustar(pedidoId: string, usuario: string, r: ResolucionAjuste, sb: SB = sbServicio()): Promise<{ ok: boolean; error?: string }> {
  const ajustes = await lista<AjusteDB>(sb.from("zomatik_np_ajustes").select(COLUMNAS_AJUSTE).eq("scheduled_dispatch_id", pedidoId))
  const trabados = ajustes.filter((x) => TRABADOS.includes(x.estado))
  if (!trabados.length) return { ok: false, error: "No hay un ajuste trabado para resolver. Actualizá la pantalla." }
  const a = r.ajusteId ? trabados.find((x) => x.id === r.ajusteId) : trabados.length === 1 ? trabados[0] : null
  if (!a) return { ok: false, error: r.ajusteId ? "Ese ajuste ya no está trabado. Actualizá la pantalla." : "Hay más de un ajuste trabado: elegí cuál." }
  const ahora = new Date().toISOString()
  const { data: np } = await sb.from("zomatik_np").select("id, numero").eq("id", a.np_id).maybeSingle()
  const numero = (np as { numero?: string | null } | null)?.numero ?? null
  let que: string
  if (a.paso === PASO_DEVOL_A_MANO) {
    const { data, error } = await sb.rpc("zomatik_ajuste_aplicar", { p_id: a.id, p_resuelto_por: usuario, p_motivo: r.motivo })
    if (error) throw error
    const x = data as { ok?: boolean; error?: string } | null
    if (!x?.ok) return { ok: false, error: x?.error || "No se pudo guardar." }
    que = `Devolución hecha a mano: ${textoAjuste({ numero, m3_np: a.m3_np, m3_objetivo: a.m3_objetivo })}`
  } else {
    const msj = a.paso === PASO_ADICIONAL_A_MANO ? `NP adicional hecha a mano por ${usuario}: ${r.motivo}`
      : a.paso === PASO_NP_SIN_USO ? `${r.eliminada ? "Eliminada en Zomatik" : "Se deja pendiente"} (${usuario}): ${r.motivo}`
      : `Resuelto a mano por ${usuario}: ${r.motivo}`
    const { data, error } = await sb.from("zomatik_np_ajustes").update({ estado: "a_mano", resuelto_por: usuario, resuelto_motivo: r.motivo, mensaje: msj, en_curso_desde: null, proximo_intento: null, updated_at: ahora } as never).eq("id", a.id).in("estado", TRABADOS).select("id")
    if (error) throw error
    if (!((data as unknown[]) || []).length) return { ok: false, error: "El ajuste cambió. Actualizá la pantalla." }
    // 15.5 "Ya la eliminé": la NP sale de "NP con saldo" (como "Ya la devolví")
    if (a.paso === PASO_NP_SIN_USO && r.eliminada)
      await sb.from("zomatik_np").update({ saldo_decision: "cerrada", saldo_decision_por: usuario, saldo_decision_at: ahora, saldo_mensaje: `Eliminada a mano en Zomatik por ${usuario}: ${r.motivo}`, updated_at: ahora } as never).eq("id", a.np_id)
    que = a.paso === PASO_ADICIONAL_A_MANO ? "NP adicional hecha a mano (la NP tiene factura)" : a.paso === PASO_NP_SIN_USO ? `NP sin uso: ${r.eliminada ? "eliminada a mano en Zomatik" : "queda pendiente"}` : "Remitir sin ajustar la NP (se arregló a mano en Zomatik)"
  }
  // Los remitos que esperaban el ajuste salen ahora
  await sb.from("zomatik_remitos").update({ proximo_intento: ahora, updated_at: ahora } as never).eq("scheduled_dispatch_id", pedidoId).eq("estado", "pendiente").eq("paso", "esperando_ajuste")
  await actividadNp(sb, { usuario, pedidoId, plantId: a.plant_id, referencia: refDe(pedidoId), detalle: { "Qué pasó": que, Motivo: r.motivo, NP: numero, Antes: `${a.estado}${a.mensaje ? `: ${a.mensaje}` : ""}`, Marca: a.marca } })
  return { ok: true }
}

/**
 * "Remitir igual (sin controlar el pendiente)": un remito quedó en "revisar" porque lo que trae Zomatik no es lo que
 * esperaba el sistema ("La NP no quedó ajustada"). Un gerencial lo revisó: SOLO esa fila sale sin el control (queda
 * marcada: "Remitir en Zomatik" no la vuelve a frenar). Los ajustes no se tocan. Queda en Actividad con el motivo.
 */
export async function remitirSinControl(pedidoId: string, usuario: string, motivo: string, remitoId?: string | null, sb: SB = sbServicio()): Promise<{ ok: boolean; error?: string }> {
  const rs = await lista<{ id: string; estado: string; paso: string | null; mensaje: string | null; marca: string; plant_id: string; m3: number }>(
    sb.from("zomatik_remitos").select("id, estado, paso, mensaje, marca, plant_id, m3").eq("scheduled_dispatch_id", pedidoId).eq("estado", "revisar"),
  )
  const frenados = rs.filter((x) => String(x.mensaje || "").startsWith(MSJ_NP_NO_AJUSTADA))
  const r = remitoId ? frenados.find((x) => x.id === remitoId) : frenados.length === 1 ? frenados[0] : null
  if (!r) return { ok: false, error: frenados.length > 1 && !remitoId ? "Hay más de un remito frenado: elegí cuál." : "No hay un remito frenado por el control de la NP. Actualizá la pantalla." }
  const ahora = new Date().toISOString()
  const { data, error } = await sb.from("zomatik_remitos").update({ sin_control_pendiente: true, estado: "error", remito_estado: "error", proximo_intento: ahora, mensaje: `Liberado del control de la NP por ${usuario}: ${motivo}`, updated_at: ahora } as never).eq("id", r.id).eq("estado", "revisar").select("id")
  if (error) throw error
  if (!((data as unknown[]) || []).length) return { ok: false, error: "El remito cambió. Actualizá la pantalla." }
  await actividadNp(sb, { usuario, pedidoId, plantId: r.plant_id, referencia: refDe(pedidoId), detalle: { "Qué pasó": "Remitir igual (sin controlar el pendiente de la NP)", Motivo: motivo, Antes: r.mensaje, "m³": r.m3, Marca: r.marca } })
  return { ok: true }
}

export type EstadoAjusteNp = { id: string; np_id: string; estado: EstadoAjuste; tipo: string | null; paso: string | null; numero: string | null; m3_np: number | null; m3_objetivo: number | null; mensaje: string | null; con_factura: boolean | null }

/** Los ajustes de cada pedido y qué plantas tienen la llave prendida (para Finalizar y el chip). Sin la migración: vacío. */
export async function estadoAjustes(ids: string[], sb: SB = sbServicio()): Promise<{ porPedido: Record<string, EstadoAjusteNp[]>; activo: Record<string, boolean> }> {
  const cfg = await configZ1(sb)
  const activo = Object.fromEntries(Object.values(cfg).map((c) => [c.plant_id, !!llaveAjuste(c)]))
  if (!ids.length || !Object.values(activo).some(Boolean)) return { porPedido: {}, activo }
  try {
    const as = await lista<AjusteDB>(sb.from("zomatik_np_ajustes").select(COLUMNAS_AJUSTE).in("scheduled_dispatch_id", ids).neq("estado", "anulado"))
    const nps = as.length ? await lista<{ id: string; numero: string | null }>(sb.from("zomatik_np").select("id, numero").in("id", [...new Set(as.map((x) => x.np_id))])) : []
    const numero = new Map(nps.map((x) => [x.id, x.numero]))
    const porPedido: Record<string, EstadoAjusteNp[]> = {}
    for (const a of as) {
      if (!a.scheduled_dispatch_id) continue
      ;(porPedido[a.scheduled_dispatch_id] ||= []).push({ id: a.id, np_id: a.np_id, estado: a.estado, tipo: a.tipo, paso: a.paso, numero: numero.get(a.np_id) ?? null, m3_np: a.m3_np === null ? null : Number(a.m3_np), m3_objetivo: a.m3_objetivo === null ? null : Number(a.m3_objetivo), mensaje: a.mensaje, con_factura: a.con_factura })
    }
    return { porPedido, activo }
  } catch (e) {
    if (!faltaMigracionAjuste(e)) console.error("[zomatik-ajuste] estado", (e as Error)?.message)
    return { porPedido: {}, activo }
  }
}
