/**
 * Zomatik · editar la NP cuando el pedido cambia de m³ antes de terminar: el robot (SOLO rutas de app/api).
 * Spec: docs/specs/2026-11-18-editar-np-al-cambiar-pedido.md (la sección 14, decisiones del 18/11, manda sobre la 12).
 *
 *   procesarEdiciones  con el turno del robot (el mismo de la NP y Z1): toma cada edición pendiente (origen 'pedido' en
 *                      `zomatik_np_ajustes`, la crea `sincronizarPedido`), controla que siga haciendo falta, recalcula la
 *                      cantidad con la base de ahora y la pone en Zomatik con `ajustarCantidadNp` (el MISMO Grabar del
 *                      ajuste al finalizar, con su lista cerrada). Después la pasa a la base (`zomatik_np_edicion_aplicar`:
 *                      la NP y la reserva del pedido juntas) y vuelve a sincronizar el pedido.
 *   resolverEdicion    un gerencial resuelve una edición trabada (revisar o error): "Reintentar cambio de NP" o "Dejar la
 *                      NP como está" (con motivo; la NP deja de ser editable para el pedido y, si hace falta, va una NP
 *                      adicional).
 *
 * LLAVE PROPIA: `zomatik_np_config.editar_activo` (apagada por defecto) y la de la NP. `llaveEdicion()` (np-servidor) es
 * el único lugar que arma la llave que pide `navegadorAjuste()`. Con la llave apagada no se crea ninguna edición ni se
 * abre Zomatik. El robot nunca borra en Zomatik y nunca pide links de acción por GET (la lista cerrada del ajuste).
 */
import { sbServicio } from "@/lib/auth/servidor"
import { mensajeZomatik, navegadorAjuste } from "@/lib/zomatik/cliente"
import {
  COLUMNAS_EDICION, COLUMNAS_NP, PASO_AUTORIZADA, PASO_SIN_AUTORIZAR, PENDIENTE_LARGO_INTENTOS, actividadNp, avisarCaidaFila, avisarErrorZomatik, avisarFallaAcceso, avisarPendienteLargo, avisarZomatikVolvio, contextoEdicion, datosObjetivo,
  editableDe, esFallaDeAcceso, faltaMigracionEdicion, llaveEdicion, plantasNp, sincronizarPedido, tipoDeFalla,
  type AvisarFn, type FilaEdicionDB, type FilaNpDB, type PlantaNpDB, fibraDeLaNp, guardarFibraNp,
} from "@/lib/zomatik/np-servidor"
import { ajustarCantidadNp, totalesDeAjuste as totalesDe, type LlaveAjuste, type NavegadorNp } from "@/lib/zomatik/np-robot"
import { fibraObjetivo } from "@/lib/fibra"
import { hoyAR, quedaTiempo, trabajoPendiente } from "@/lib/zomatik/np"
import { errorInterno } from "@/lib/zomatik/z1-robot"
import {
  EDICION_ABIERTA, MSJ_EDICION_CANCELADO, MSJ_EDICION_ESPERA_NP, MSJ_EDICION_ESPERA_OTRO, MSJ_EDICION_LO_DEJA_EL_AJUSTE, ORIGEN_PEDIDO, PASOS_GRABAR_AJUSTE, TOL_AJUSTE,
  m3Texto, objetivoEdicion, textoEdicion,
} from "@/lib/zomatik/ajuste"
import { configZ1, llaveZ1, prepararRemitos, type ConfigZ1 } from "@/lib/zomatik/z1-servidor"
import { llaveAjuste } from "@/lib/zomatik/ajuste-servidor"

type SB = ReturnType<typeof sbServicio>

/** Lo que el robot de la edición necesita de afuera (en las pruebas se reemplaza). */
export type DependenciasEdicion = {
  navegador: (llave: LlaveAjuste, codigoNp: number) => Promise<NavegadorNp>
  robot: { ajustarCantidadNp: typeof ajustarCantidadNp }
  /** Mail a Bautista: edición en revisar o error, Zomatik la rechazó, robot caído, pendiente largo */
  avisarError: AvisarFn
}
export const DEPENDENCIAS_EDICION: DependenciasEdicion = { navegador: navegadorAjuste, robot: { ajustarCantidadNp }, avisarError: avisarErrorZomatik }

export type ResultadoEdiciones = { ocupado?: boolean; sinTiempo?: boolean; hechas: { id: string; estado: string; mensaje: string | null }[] }

const despuesDe = (min: number) => new Date(Date.now() + min * 60_000).toISOString()
const refDe = (pedidoId: string | null | undefined) => `Pedido ${(pedidoId || "").slice(0, 8)}`
/** Más de estas veces colgada en "generando" = trabada: queda "revisar" (como el ajuste). */
const MAX_CORTES = 3

class Cambio extends Error {
  name = "Cambio"
}

/** Guarda SOLO si la edición sigue "generando" (si otro la cambió en el medio, no se pisa). */
async function guardarSi(sb: SB, id: string, cambios: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await sb.from("zomatik_np_ajustes").update({ ...cambios, updated_at: new Date().toISOString() } as never).eq("id", id).eq("estado", "generando").select("id")
  if (error) throw error
  return ((data as unknown[]) || []).length > 0
}

/**
 * Las ediciones para trabajar ahora: pendientes con el reintento vencido (la espera de 2 min ya pasó) y colgadas en
 * "generando" más de 3 min. Con el botón ("Generar NP ahora", `manual`), las del pedido sin esperar, también las de error.
 * Sin la migración: ninguna.
 */
async function edicionesATrabajar(sb: SB, plantas: Record<string, PlantaNpDB>, pedidoId: string | null | undefined, manual: boolean): Promise<FilaEdicionDB[]> {
  let q = sb.from("zomatik_np_ajustes").select(COLUMNAS_EDICION).eq("origen", ORIGEN_PEDIDO).in("estado", ["pendiente", "generando", ...(manual ? ["error"] : [])]).order("created_at").limit(20)
  if (pedidoId) q = q.eq("scheduled_dispatch_id", pedidoId)
  const { data, error } = await q
  if (error) {
    if (faltaMigracionEdicion(error)) return []
    throw error
  }
  const ahora = Date.now()
  return ((data as unknown as FilaEdicionDB[]) || []).filter((a) => !!llaveEdicion(plantas[a.plant_id]) && trabajoPendiente(a, ahora, manual))
}

/** Edición en "revisar" o "error" (y la rechazada por Zomatik): un mail a Bautista por episodio. */
async function avisarTrabada(sb: SB, avisar: AvisarFn, a: FilaEdicionDB, numero: string | null, titulo: string, mensaje: string | null, extra: string[] = [], recorte?: string) {
  const ref = refDe(a.scheduled_dispatch_id)
  const r = await avisar(sb, `Zomatik: ${titulo} · ${ref}`, [
    `${ref} · ${numero || "NP"}: ${textoEdicion(numero, a.m3_np, a.m3_objetivo)}`,
    `Mensaje: ${mensaje || "(sin mensaje)"}`,
    ...extra,
    `Marca: ${a.marca}`,
    ...(recorte ? [`Respuesta de Zomatik (recorte): ${recorte}`] : []),
  ])
  if (!r.enviado) console.error("[zomatik-edicion] aviso:", r.motivo)
}

/** El artículo de la fórmula de la NP (para reconocer el renglón en Zomatik). */
async function articuloDeNp(sb: SB, np: FilaNpDB): Promise<{ codigo: number | null; nombre: string }> {
  const { data: f } = np.formula_id ? await sb.from("formulas").select("id, zomatik_articulo_codigo, zomatik_articulo_nombre").eq("id", np.formula_id).maybeSingle() : { data: null }
  const codigo = (f as { zomatik_articulo_codigo?: number | null } | null)?.zomatik_articulo_codigo ?? null
  const { data: art } = codigo ? await sb.from("zomatik_articulos").select("codigo, nombre").eq("codigo", codigo).maybeSingle() : { data: null }
  return { codigo, nombre: (art as { nombre?: string } | null)?.nombre || (f as { zomatik_articulo_nombre?: string } | null)?.zomatik_articulo_nombre || "" }
}

/**
 * Trabaja las ediciones de la NP (5.2 y 5.3). Lo llaman la pasada (`/api/zomatik/np/procesar`, después de las NP y
 * antes de Z1) y "Generar NP ahora" del pedido (`manual`). Mismo turno del robot y misma regla de tiempo.
 */
export async function procesarEdiciones(o: { usuario: string; inicio: number; pedidoId?: string | null; manual?: boolean; sb?: SB; dep?: DependenciasEdicion; totalMs?: number; minimoMs?: number }): Promise<ResultadoEdiciones> {
  const sb = o.sb ?? sbServicio()
  const dep = o.dep ?? DEPENDENCIAS_EDICION
  const manual = !!o.manual
  const total = o.totalMs ?? 55_000
  const minimo = o.minimoMs ?? 30_000
  if (!quedaTiempo(o.inicio, Date.now(), total, minimo)) return { sinTiempo: true, hechas: [] }
  const plantas = await plantasNp(sb)
  if (!Object.values(plantas).some((p) => !!llaveEdicion(p))) return { hechas: [] }
  const lista = await edicionesATrabajar(sb, plantas, o.pedidoId, manual)
  if (!lista.length) return { hechas: [] }
  const quien = `edicion·${o.usuario}·${o.inicio.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
  const { data: turno, error: et } = await sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 60 })
  if (et) throw et
  if (turno !== true) return { ocupado: true, hechas: [] }
  let ultima = Date.now()
  const renovar = async () => {
    if (Date.now() - ultima < 10_000) return
    ultima = Date.now()
    await sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 60 })
  }
  const out: ResultadoEdiciones = { hechas: [] }
  try {
    const cfg = await configZ1(sb)
    let volvio = false
    for (const a of lista) {
      if (!quedaTiempo(o.inicio, Date.now(), total, minimo)) break
      const r = await trabajarEdicion(sb, a, { usuario: o.usuario, plantas, cfg, manual, dep, renovar, alAbrir: async () => {
        if (volvio) return
        volvio = true
        await avisarZomatikVolvio(sb, dep.avisarError)
      } })
      out.hechas.push(r.hecha)
      if (r.corte) break // sin sesión o sin red: no se insiste
    }
  } finally {
    await sb.rpc("zomatik_robot_soltar", { p_quien: quien })
  }
  return out
}

type Ctx = {
  usuario: string; plantas: Record<string, PlantaNpDB>; cfg: Record<string, ConfigZ1>; manual: boolean; dep: DependenciasEdicion
  renovar: () => Promise<void>; alAbrir: () => Promise<void>
}

async function trabajarEdicion(sb: SB, lista: FilaEdicionDB, c: Ctx): Promise<{ hecha: ResultadoEdiciones["hechas"][number]; corte?: boolean }> {
  const hecha = (estado: string, mensaje: string | null) => ({ hecha: { id: lista.id, estado, mensaje } })
  const { data: tom, error: et } = await sb.rpc("zomatik_ajuste_tomar", { p_id: lista.id, p_desde: ["pendiente", ...(c.manual ? ["error"] : [])] })
  if (et) throw et
  const t = (tom as { ajuste_id: string; estado_anterior: string; paso_anterior: string | null }[] | null)?.[0]
  if (!t) return hecha("ocupada", null)
  const antes = { estado: t.estado_anterior, paso: t.paso_anterior }
  // La fila se RELEE ya tomada: entre la lista y el "tomar", quien guarda el pedido pudo cambiarla (8 → 9 → 10). Desde
  // acá está "generando" y nadie más la cambia (sincronizar solo toca las "pendiente"): se trabaja con lo releído
  const { data: rel, error: er } = await sb.from("zomatik_np_ajustes").select(COLUMNAS_EDICION).eq("id", lista.id).maybeSingle()
  if (er) throw er
  const a = rel as unknown as FilaEdicionDB | null
  if (!a) return hecha("ocupada", null)
  /** Las veces que se trabajó ANTES de este intento (`tomar` ya sumó este). */
  const intentosAntes = Math.max(0, Number(a.intentos || 0) - 1)
  // La pasada respeta la espera de 2 min: si el pedido cambió recién (proximo_intento corrido), se suelta sin sumar intento
  if (!c.manual && antes.estado === "pendiente" && a.proximo_intento && Date.parse(a.proximo_intento) > Date.now()) {
    await guardarSi(sb, a.id, { estado: "pendiente", en_curso_desde: null, intentos: intentosAntes })
    return hecha("esperando", "El pedido cambió recién: se espera")
  }
  const pedidoId = a.scheduled_dispatch_id || ""
  const ref = refDe(pedidoId)
  const planta = c.plantas[a.plant_id]
  let numero: string | null = null
  let ultimoPaso: string | null = null
  const log = (detalle: Record<string, unknown>, action: "crear" | "editar" = "editar") => actividadNp(sb, { usuario: c.usuario, action, pedidoId, plantId: a.plant_id, referencia: ref, detalle: { ...detalle, Marca: a.marca } })
  /** Vuelve a mirar el pedido (sale la NP adicional si hace falta, o nace otra edición si cambió de nuevo). Nunca corta. */
  const sincronizar = async () => {
    if (!pedidoId) return
    try {
      await sincronizarPedido(pedidoId, c.usuario, null, sb)
    } catch (e) {
      console.error("[zomatik-edicion] sincronizar", pedidoId, (e as Error)?.message)
    }
  }
  /**
   * Termina sin tocar Zomatik: "anulado" (ya no hace falta, sin aviso) o "pendiente" (espera algo: no suma intento y, si
   * lleva más de 1 hora esperando, el aviso de siempre).
   */
  const cerrar = async (estado: "anulado" | "pendiente", mensaje: string, resincronizar = false) => {
    const guardo = await guardarSi(sb, a.id, { estado, en_curso_desde: null, mensaje, proximo_intento: estado === "pendiente" ? despuesDe(10) : null, ...(estado === "pendiente" ? { intentos: intentosAntes } : {}) })
    if (estado === "anulado") await log({ "Qué pasó": "Cambio de la NP anulado", Mensaje: mensaje, NP: numero })
    if (guardo && estado === "pendiente") await pendienteLargo(mensaje, true)
    if (resincronizar) await sincronizar()
    return hecha(estado, mensaje)
  }
  /** Termina con revisar, error o pendiente (Actividad y avisos de cada caso). Los totales (montos), solo en Actividad y el mail. */
  const trabar = async (estado: "revisar" | "error" | "pendiente", mensaje: string | null, extra: Record<string, unknown> = {}, recorte?: string, totales?: Record<string, unknown> | null) => {
    const guardo = await guardarSi(sb, a.id, { estado, en_curso_desde: null, mensaje, proximo_intento: estado === "pendiente" ? despuesDe(10) : null, ...extra })
    await log({ "Qué pasó": "El cambio de la NP no salió", Estado: estado, Mensaje: mensaje, Paso: (extra.paso as string) || ultimoPaso, NP: numero, ...(totales || {}), ...(recorte ? { "Respuesta de Zomatik (recorte)": recorte } : {}) })
    if (guardo && estado !== "pendiente" && antes.estado !== estado)
      await avisarTrabada(sb, c.dep.avisarError, { ...a, ...(extra as Partial<FilaEdicionDB>) }, numero, `cambio de la NP ${estado === "error" ? "con error" : "para revisar"}`, mensaje, [
        ...Object.entries(totales || {}).map(([k, v]) => `${k}: ${v}`),
        "El pedido no saca una NP adicional mientras tanto (la NP pudo haber quedado cambiada). Un gerencial elige en el pedido (Programación, menú ⋯): «Reintentar cambio de NP» o «Dejar la NP como está».",
      ], recorte)
    if (guardo && estado === "pendiente") await pendienteLargo(mensaje)
    return hecha(estado, mensaje)
  }
  /** Más de 1 hora pendiente: un aviso a Bautista por edición. Una espera (otra NP, otro cambio) cuenta por el tiempo. */
  const pendienteLargo = async (mensaje: string | null, espera = false) => {
    const intentos = espera ? Math.max(PENDIENTE_LARGO_INTENTOS, Number(a.intentos || 0)) : Number(a.intentos || 0)
    await avisarPendienteLargo(sb, c.dep.avisarError, {
      usuario: c.usuario, pedidoId, plantId: a.plant_id, ref, marca: a.marca, creada: a.created_at, intentos,
      titulo: `Cambio de la NP pendiente hace más de 1 hora · ${ref}`,
      lineas: [
        `${ref} · ${numero || "NP"}`,
        espera ? "El cambio de la NP lleva más de 1 hora esperando." : `El cambio de la NP lleva más de 1 hora sin salir (${intentos} intentos), por red o sesión de Zomatik.`,
        `Último mensaje: ${mensaje || "(sin mensaje)"}`,
        `Marca: ${a.marca}`,
        "Se sigue reintentando en la próxima pasada (cada 10 minutos). Este aviso llega una sola vez por cambio.",
      ],
    })
  }

  try {
    const { data: nd, error: en } = await sb.from("zomatik_np").select(COLUMNAS_NP).eq("id", a.np_id).maybeSingle()
    if (en) throw en
    const np = nd as unknown as FilaNpDB | null
    numero = np?.numero ?? null
    const { data: pd, error: ep } = pedidoId ? await sb.from("scheduled_dispatches").select("id, status, quantity_m3, plant_id").eq("id", pedidoId).maybeSingle() : { data: null, error: null }
    if (ep) throw ep
    const ped = pd as { id: string; status: string; quantity_m3: number; plant_id: string } | null

    /** Pasa a la base la NP y la reserva juntas (`zomatik_np_edicion_aplicar`) y lo que sigue (paso 5). */
    const aplicar = async (objetivo: number, m3Uso: number, m3Antes: number, porAutorizar: boolean | null, nada = false) => {
      // Con lo que quedó en Zomatik y la reserva que se decidió: si la fila no dice eso, la base no aplica nada
      const { data, error } = await sb.rpc("zomatik_np_edicion_aplicar", { p_id: a.id, p_m3_objetivo: objetivo, p_m3_uso: m3Uso })
      const r = data as { ok?: boolean; error?: string } | null
      if (error || !r?.ok) {
        // Zomatik ya dice el objetivo: queda "generando" en "aplicar" y el reintento solo repite esto
        const m = (error as { message?: string } | null)?.message || r?.error || null
        console.error("[zomatik-edicion] aplicar", a.id, m)
        await log({ "Qué pasó": "Cambio de la NP: Zomatik ya está, falta guardarlo en el sistema", Mensaje: m })
        return hecha("generando", "falta guardarlo en el sistema")
      }
      if (nada) {
        await sb.from("zomatik_np_ajustes").update({ estado: "nada", updated_at: new Date().toISOString() } as never).eq("id", a.id).eq("estado", "ok")
        await log({ "Qué pasó": `Cambio de la NP: ya estaba en ${m3Texto(objetivo)} m³ (no se abrió Zomatik)`, NP: numero })
      } else {
        await log({ "Qué pasó": `NP editada en Zomatik: ${textoEdicion(numero, m3Antes, objetivo)}${ped ? ` (el pedido pasó a ${m3Texto(ped.quantity_m3)})` : ""}` })
      }
      // Paso 5: errores de acá van a consola (la edición ya está "ok")
      try {
        // Si después de editarla la NP volvió a "por autorizar", o subió la cantidad y no se pudo saber, deja de figurar
        // "autorizada" y la autoriza la pasada de siempre (sinAutorizar). Solo desde "autorizada": no pisa una NP que no se
        // autoriza sola (autorizar_revisar). Como el ajuste al finalizar
        if (!nada && (porAutorizar === true || (porAutorizar === null && objetivo > m3Antes + TOL_AJUSTE))) {
          const mensaje = porAutorizar ? "NP sin autorizar en Zomatik (después de editarla). Se reintenta." : "Se editó la NP: falta confirmar que siga autorizada en Zomatik. Se reintenta."
          await sb.from("zomatik_np").update({ paso: PASO_SIN_AUTORIZAR, mensaje, updated_at: new Date().toISOString() } as never).eq("id", a.np_id).eq("estado", "ok").eq("paso", PASO_AUTORIZADA)
        }
        // El despacho que había quedado afuera de un remito ahora entra (solo si el pedido ya empezó a remitirse)
        if (pedidoId && llaveZ1(c.cfg[a.plant_id])) {
          const { data: rs } = await sb.from("zomatik_remitos").select("id").eq("scheduled_dispatch_id", pedidoId).neq("estado", "anulado").limit(1)
          if (((rs as unknown[]) || []).length) await prepararRemitos(pedidoId, null, c.usuario, sb)
        }
      } catch (e) {
        console.error("[zomatik-edicion] después de aplicar", a.id, (e as Error)?.message)
      }
      await sincronizar()
      return hecha(nada ? "nada" : "ok", textoEdicion(numero, m3Antes, objetivo))
    }

    // Solo faltaba pasarlo a la base: no se vuelve a abrir Zomatik
    if (antes.paso === "aplicar" || a.aplicado_at) return await aplicar(Number(a.m3_objetivo), Number(a.m3_uso_objetivo), Number(a.m3_np), null, a.tipo === "nada")
    // Trabada: más de 3 cortes seguidos (colgada en "generando")
    if (antes.estado === "generando" && intentosAntes >= MAX_CORTES) return await trabar("revisar", "El cambio de la NP se cortó más de 3 veces. Revisá la NP en Zomatik antes de seguir.")
    const cortado = PASOS_GRABAR_AJUSTE.includes(antes.paso || "")
    if (!np || (!np.zomatik_codigo && !cortado && np.estado !== "generando")) return await cerrar("anulado", "La NP no está en Zomatik: no se cambia.", true)
    let objetivo = Number(a.m3_objetivo)
    const m3Uso = Number(a.m3_uso_objetivo)
    const m3Np = Number(np.m3)

    if (!cortado) {
      // 1. controlar (sin Zomatik)
      if (!ped || ped.status === "cancelled") return await cerrar("anulado", MSJ_EDICION_CANCELADO)
      if (ped.status === "completed" && llaveAjuste(c.cfg[a.plant_id])) return await cerrar("anulado", MSJ_EDICION_LO_DEJA_EL_AJUSTE)
      const { data: us, error: eu } = await sb.from("zomatik_np_uso").select("id").eq("np_id", np.id).eq("scheduled_dispatch_id", pedidoId).eq("activo", true)
      if (eu) throw eu
      if (!((us as unknown[]) || []).length) return await cerrar("anulado", "El pedido ya no usa esta NP.", true)
      const ctx = await contextoEdicion(sb, [np.id])
      const ed = editableDe(planta, np, pedidoId, ctx)
      if (!ed.editable) return await cerrar("anulado", `No se puede cambiar: ${ed.motivo || "la NP ya no se puede editar"}`, true)
      if (ed.espera) return await cerrar("pendiente", MSJ_EDICION_ESPERA_NP)
      if ((ctx.ajustes || []).some((x) => x.id !== a.id && EDICION_ABIERTA.includes(x.estado as never))) return await cerrar("pendiente", MSJ_EDICION_ESPERA_OTRO)
      // 2. decidir: la cantidad con la base de AHORA y la reserva de la fila
      const o = objetivoEdicion({ ...(await datosObjetivo(sb, np.id, pedidoId)), m3Uso })
      if (!o.ok) return await trabar("revisar", o.mensaje, { m3_objetivo: o.m3_objetivo, m3_np: m3Np })
      objetivo = o.m3_objetivo
      const nada = Math.abs(objetivo - m3Np) <= TOL_AJUSTE
      // La cantidad y la reserva van juntas: son las que después pasan a la base
      if (!(await guardarSi(sb, a.id, { tipo: nada ? "nada" : "editar", m3_np: m3Np, m3_objetivo: objetivo, m3_uso_objetivo: m3Uso, m3_despachado: o.m3_despachado, ...(nada ? { paso: "aplicar" } : {}) }))) throw new Cambio("La edición cambió mientras se trabajaba")
      // Ya está en la cantidad: solo la base (la reserva), sin abrir Zomatik
      if (nada) return await aplicar(objetivo, m3Uso, m3Np, null, true)
    } else if (!np.zomatik_codigo || np.estado !== "ok") {
      return await trabar("revisar", "La NP no está en Zomatik: no se puede cambiar.")
    }

    // 3. Zomatik: el mismo camino del ajuste (marca, un renglón, cantidad = la de la base, factura, Grabar, verificar)
    const llave = llaveEdicion(planta)
    if (!llave) return await cerrar("pendiente", "La edición de la NP está apagada en la planta.")
    const art = await articuloDeNp(sb, np)
    // La NP lleva fibra (spec 2026-11-25): queda en proporción a los m³ nuevos
    const fibra = await fibraDeLaNp(sb, np)
    const nav = await c.dep.navegador(llave, np.zomatik_codigo!)
    await c.alAbrir()
    const res = await c.dep.robot.ajustarCantidadNp(nav, {
      codigo: np.zomatik_codigo!, numero: np.numero, marca: np.marca, articuloCodigo: art.codigo, articuloNombre: art.nombre, m3Np, objetivo, cortado,
      ...(fibra ? { fibra: { codigo: fibra.codigo, nombre: fibra.nombre, kgNp: fibra.kgNp, kgObjetivo: fibraObjetivo(fibra.kgNp, m3Np, objetivo) } } : {}),
    }, {
      hoy: hoyAR(),
      alPaso: async (paso) => {
        ultimoPaso = paso
        await c.renovar()
        if (!(await guardarSi(sb, a.id, { paso }))) throw new Cambio("La edición cambió mientras se trabajaba")
      },
    })

    // 4. qué se hace con cada resultado (5.3)
    if (res.estado === "ok") {
      // La cantidad de ANTES es la de la base (todavía sin aplicar): después de un corte el robot ya lee el objetivo
      if (!(await guardarSi(sb, a.id, { paso: "aplicar", m3_np: m3Np, con_factura: false, factura_texto: null }))) throw new Cambio("La edición cambió mientras se trabajaba")
      if (fibra && res.fibraKg !== undefined && res.fibraKg !== null) await guardarFibraNp(sb, np.id, res.fibraKg)
      return await aplicar(objetivo, m3Uso, m3Np, res.porAutorizar ?? null)
    }
    const cant = res.leido ?? m3Np
    const crece = objetivo > cant + TOL_AJUSTE
    const rechazo = res.estado === "error" && res.paso === "grabar_np"
    if (res.estado === "con_factura" || rechazo) {
      // No se pudo: crece → NP adicional (como antes); achica → no se toca y lo resuelve el ajuste al finalizar
      const mensaje = res.estado === "con_factura"
        ? crece ? `Zomatik no dejó cambiarla (tiene factura): va una NP adicional por ${m3Texto(objetivo - cant)} m³.` : "Tiene factura: se ajusta al terminar."
        : `${res.mensaje || "Zomatik no dejó cambiar la NP."}${crece ? ` Va una NP adicional por ${m3Texto(objetivo - cant)} m³.` : " Se ajusta al terminar."}`
      const guardo = await guardarSi(sb, a.id, {
        estado: "nada", tipo: crece ? "adicional" : "devol", con_factura: res.estado === "con_factura", factura_texto: res.estado === "con_factura" ? [res.facturaNumero, res.facturaTexto].filter(Boolean).join(" · ") || null : null,
        m3_np: cant, mensaje, paso: res.paso, en_curso_desde: null, proximo_intento: null,
      })
      await log({ "Qué pasó": res.estado === "con_factura" ? "La NP tiene factura: no se cambió" : "Zomatik no dejó cambiar la NP", Mensaje: mensaje, "Por qué": res.facturaTexto || res.mensaje || null, NP: numero, ...(res.recorte ? { "Respuesta de Zomatik (recorte)": res.recorte } : {}) })
      // Con factura, sin mail (decisión 12.4: le llega uno solo a Juan, al finalizar). El rechazo: mail a Bautista (12.7)
      if (guardo && rechazo) await avisarTrabada(sb, c.dep.avisarError, { ...a, m3_np: cant, m3_objetivo: objetivo }, numero, "Zomatik no dejó cambiar la NP", res.mensaje, [crece ? `Va una NP adicional por ${m3Texto(objetivo - cant)} m³.` : "La NP queda como está: el ajuste al finalizar la deja justa."], res.recorte)
      if (guardo) await sincronizar()
      return hecha("nada", mensaje)
    }
    return await trabar(res.estado, res.mensaje, { paso: res.paso, ...(res.leido !== undefined && res.leido !== null ? { m3_np: res.leido } : {}) }, res.recorte, totalesDe(res))
  } catch (e) {
    if (e instanceof Cambio) return hecha("cambió", e.message)
    const interno = errorInterno(e)
    const m = interno ?? mensajeZomatik(e)
    const volvioPend = await guardarSi(sb, a.id, { estado: "pendiente", en_curso_desde: null, mensaje: m, proximo_intento: despuesDe(10) })
    if (volvioPend) {
      if (esFallaDeAcceso(e)) {
        await avisarFallaAcceso(sb, c.dep.avisarError, { que: `el cambio de la NP (${ref})`, mensaje: m, codigo: tipoDeFalla(e) })
      } else {
        await avisarCaidaFila(sb, c.dep.avisarError, {
          usuario: c.usuario, pedidoId, plantId: a.plant_id, ref, marca: a.marca,
          firma: `${tipoDeFalla(e)}|${ultimoPaso || "inicio"}`, mensaje: m, paso: ultimoPaso, quePaso: interno ? "Cambio de la NP: error interno" : "Cambio de la NP: el robot se cayó",
          titulo: `El robot de Zomatik se cayó con el cambio de la NP · ${ref}`,
          lineas: [
            `${ref} · ${numero || "NP"}`,
            `Qué se estaba haciendo: el cambio de la NP${ultimoPaso ? ` · paso ${ultimoPaso}` : ""}`,
            `Mensaje: ${m || "(sin mensaje)"}`,
            `Marca: ${a.marca}`,
            "Queda pendiente: se reintenta en la próxima pasada (cada 10 minutos). Mientras se caiga igual, no llega otro mail.",
          ],
        })
      }
      await pendienteLargo(m)
    }
    return { hecha: { id: a.id, estado: "pendiente", mensaje: m }, corte: esFallaDeAcceso(e) || /sesi[oó]n|entrar a Zomatik|login|ZOMATIK_USER/i.test(m) }
  }
}

// ---------------------------------------------------------------------------
// Un gerencial resuelve una edición trabada (7.3)
// ---------------------------------------------------------------------------

const TRABADAS = ["revisar", "error"]
/** Con la llave de la edición apagada nadie termina una edición pendiente o en curso: también se puede dejar como está. */
const TRABADAS_SIN_LLAVE = [...TRABADAS, "pendiente", "generando"]

/**
 * "Reintentar cambio de NP": la edición vuelve a "pendiente" (si se cortó en el Grabar, el robot relee la NP primero,
 * como siempre). "Dejar la NP como está" (con motivo): queda "a_mano" (tipo adicional), la NP deja de ser editable
 * para el pedido y se sincroniza (si el pedido necesita más, va una NP adicional). Con la llave de la edición apagada
 * no se reintenta, y "dejar" vale también para una pendiente o en curso (nadie la va a terminar). Lo controla la ruta
 * (solo gerenciales; dejar, con motivo).
 */
export async function resolverEdicion(o: { pedidoId: string; edicionId: string; decision: "reintentar" | "dejar"; usuario: string; motivo?: string | null }, sb: SB = sbServicio()): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await sb.from("zomatik_np_ajustes").select(COLUMNAS_EDICION).eq("id", o.edicionId).eq("scheduled_dispatch_id", o.pedidoId).maybeSingle()
  if (error) {
    if (faltaMigracionEdicion(error)) return { ok: false, error: "No hay un cambio de la NP para resolver." }
    throw error
  }
  const a = data as unknown as FilaEdicionDB | null
  if (!a || a.origen !== ORIGEN_PEDIDO) return { ok: false, error: "No hay un cambio de la NP para resolver. Actualizá la pantalla." }
  const conLlave = !!llaveEdicion((await plantasNp(sb))[a.plant_id])
  const trabadas = conLlave ? TRABADAS : TRABADAS_SIN_LLAVE
  if (!trabadas.includes(a.estado)) return { ok: false, error: "Ese cambio de la NP ya no está trabado. Actualizá la pantalla." }
  // Con la llave de la edición apagada nadie la va a reintentar: solo se puede dejar la NP como está
  if (o.decision === "reintentar" && !conLlave) return { ok: false, error: "La edición de la NP está apagada en la planta: elegí «Dejar la NP como está»." }
  const ahora = new Date().toISOString()
  const { data: np } = await sb.from("zomatik_np").select("id, numero").eq("id", a.np_id).maybeSingle()
  const numero = (np as { numero?: string | null } | null)?.numero ?? null
  const cambios = o.decision === "reintentar"
    ? { estado: "pendiente", proximo_intento: ahora, en_curso_desde: null, mensaje: `Reintento pedido por ${o.usuario}`, updated_at: ahora }
    : { estado: "a_mano", tipo: "adicional", resuelto_por: o.usuario, resuelto_motivo: o.motivo || null, mensaje: `NP dejada como está por ${o.usuario}: ${o.motivo || ""}`.trim(), proximo_intento: null, en_curso_desde: null, updated_at: ahora }
  const { data: hecho, error: eu } = await sb.from("zomatik_np_ajustes").update(cambios as never).eq("id", a.id).in("estado", trabadas).select("id")
  if (eu) throw eu
  if (!((hecho as unknown[]) || []).length) return { ok: false, error: "El cambio de la NP cambió. Actualizá la pantalla." }
  await actividadNp(sb, {
    usuario: o.usuario, pedidoId: o.pedidoId, plantId: a.plant_id, referencia: refDe(o.pedidoId),
    detalle: { "Qué pasó": o.decision === "reintentar" ? "Reintentar cambio de NP" : "Dejar la NP como está (no se cambia en Zomatik)", NP: numero, Antes: `${a.estado}${a.mensaje ? `: ${a.mensaje}` : ""}`, ...(o.motivo ? { Motivo: o.motivo } : {}), Marca: a.marca },
  })
  if (o.decision === "dejar") await sincronizarPedido(o.pedidoId, o.usuario, null, sb)
  return { ok: true }
}
