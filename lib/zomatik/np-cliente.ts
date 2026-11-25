"use client"
/**
 * Zomatik · Z2 · NP desde el navegador: estado de los pedidos, avisar un cambio y "Generar NP ahora".
 * Nunca habla con Zomatik: todo pasa por /api/zomatik/np (servidor, con la llave de la planta).
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { MSJ_TRAER, type ControlDespacho, type EstadoNp, type ModoNp, type MotivoTraer, type TipoNp } from "@/lib/zomatik/np"
import type { EstadoCliente, EstadoFormula, HitArticuloVincular, HitClienteVincular } from "@/lib/zomatik/vincular-servidor"

export type NpFila = {
  id: string; n: number; estado: EstadoNp; tipo: TipoNp; m3: number; numero: string | null; zomatik_codigo: number | null
  mensaje: string | null; paso?: string | null; proyecto_codigo: number | null; es_adicional: boolean; disponible_m3: number | null; updated_at: string
  /** m³ que el pedido usa de esta NP y lo libre de la NP (una NP puede servir a varios pedidos). */
  m3_uso: number; libre: number; fecha: string; fecha_zomatik: string | null; saldo_mensaje: string | null
  /** "NP con saldo": devolver o cerrada (con una de estas el ajuste al finalizar no la toca). */
  saldo_decision?: string | null
  /** Traída de Zomatik (no la generó el sistema): al cancelar el pedido no se ofrece vaciarla. */
  traida?: boolean
  /** Con la llave de la edición (spec 2026-11-18): si se edita en Zomatik cuando el pedido cambia, y su último cambio. */
  editable?: boolean
  edicion?: EdicionNp | null
}
/** El último cambio de la NP por un cambio del pedido (sin montos). */
export type EdicionNp = {
  id: string; estado: string; tipo: string | null; paso: string | null; mensaje: string | null; con_factura: boolean | null
  m3_np: number | null; m3_objetivo: number | null; m3_uso_objetivo: number | null
}
export type EstadoPedidoNp = {
  activo: boolean; modo: ModoNp; entra: boolean; nps: NpFila[]
  /** La llave de la edición de la NP de la planta (spec 2026-11-18). Apagada: un cambio a medias no lo termina nadie. */
  editar?: boolean
  /** Pedido cancelado o completo: sus NP con saldo quedan pendientes en Programación. */
  cerrado: boolean
  excepcion: { autorizado_por: string; motivo_tipo: string; motivo: string | null } | null
  control: ControlDespacho
  /** NP nueva o de un proyecto, guardada en el servidor (null = todavía no se eligió). */
  eleccion: { tipo: TipoNp | "saldo"; proyecto_codigo: number | null; tope_m3: number | null; np_id: string | null } | null
}
export type PlantaNpResumen = { activo: boolean; modo: ModoNp; aviso_hasta: string | null; editar?: boolean }
export type EleccionNp = { tipo: TipoNp | "saldo"; proyecto_codigo: number | null; tope_m3: number | null; np_id?: string | null }

/** Una NP del sistema con saldo (lista de Programación y opción "Traer NP de Zomatik"). */
export type NpSaldo = {
  id: string; numero: string | null; zomatik_codigo: number | null; m3: number; libre: number; comprometido: number; fecha: string; fecha_zomatik: string | null
  saldo_decision: string | null; saldo_mensaje: string | null; pendiente_desde: string | null; plant_id: string | null; client_id: string | null; cliente: string | null
  formula_id: string | null; formula: string | null; construction_site_id: string | null; obra: string | null; con_pedido_activo: boolean
  /** Traída de Zomatik (no la generó el sistema). */
  traida?: boolean
  /** R si es NP, X si es NP2. */
  remito?: "R" | "X" | null
}

export async function cargarNpSaldos(filtro: { clientId?: string; formulaId?: string; plantId?: string } = {}): Promise<NpSaldo[]> {
  try {
    const p = new URLSearchParams()
    if (filtro.clientId) {
      p.set("client_id", filtro.clientId)
      if (filtro.formulaId) p.set("formula_id", filtro.formulaId)
    }
    if (filtro.plantId) p.set("plant_id", filtro.plantId)
    const q = p.toString() ? `?${p}` : ""
    const r = await fetch(`/api/zomatik/np/saldos${q}`, { cache: "no-store" })
    if (!r.ok) return []
    return ((await json(r))?.nps as NpSaldo[]) || []
  } catch {
    return []
  }
}

/** "Devolver el saldo" o "Ya la devolví" (a mano, DEVOL). */
export async function decidirSaldoNp(npId: string, decision: "devolver" | "cerrada", motivo?: string): Promise<{ ok: boolean; texto: string }> {
  try {
    const r = await fetch("/api/zomatik/np", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "saldo", np_id: npId, decision, motivo }) })
    const j = await json(r)
    return r.ok ? { ok: true, texto: j?.mensaje || "Listo" } : { ok: false, texto: j?.error || `Error ${r.status}` }
  } catch {
    return { ok: false, texto: "Sin conexión" }
  }
}

async function json(r: Response) {
  return r.json().catch(() => ({}))
}

/** Lo que contesta "Buscar" de Traer NP de Zomatik (sin montos). `motivo` = el código de 3.3 (o "sin_conexion"). */
export type RespuestaTraer =
  | { ok: true; yaEstaba: boolean; np: NpSaldo; remito: "R" | "X"; avisos: string[] }
  | { ok: false; motivo: MotivoTraer | "datos"; error: string; elegirFormula?: { id: string; code: string }[] }

/** "Buscar" la NP por su número en Zomatik (60 s como mucho). Lo que no responde: "Sin conexión". */
export async function traerNpDeZomatik(o: { numero: string; plantId: string; clientId?: string | null; formulaId?: string | null; remito?: string | null }): Promise<RespuestaTraer> {
  const ctrl = new AbortController()
  const corte = setTimeout(() => ctrl.abort(), 60_000)
  try {
    const r = await fetch("/api/zomatik/np/traer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numero: o.numero, plant_id: o.plantId, client_id: o.clientId || null, formula_id: o.formulaId || null, remito: o.remito === "R" || o.remito === "X" ? o.remito : null }),
      signal: ctrl.signal,
    })
    const j = await json(r)
    if (r.ok && j?.ok) return j as RespuestaTraer
    return { ok: false, motivo: (j?.motivo as MotivoTraer) || "datos", error: j?.error || `Error ${r.status}`, ...(j?.elegirFormula ? { elegirFormula: j.elegirFormula } : {}) }
  } catch {
    return { ok: false, motivo: "sin_conexion", error: MSJ_TRAER.sin_conexion }
  } finally {
    clearTimeout(corte)
  }
}

/**
 * Después de guardar, cancelar o cambiar los m³: el servidor decide qué NP crear o vaciar (con la llave apagada, nada).
 * `precio`: el precio por m³ de la NP (null = el de la lista); `undefined` = no se toca (no va en el pedido). `remito`:
 * el R/X con que la línea del precio calculó la lista (el servidor usa el mismo).
 */
export async function avisarNp(pedidoId: string, eleccion?: EleccionNp | null, moverFecha?: boolean | null, precio?: number | null, remito?: string | null): Promise<{ activo?: boolean; creadas?: number; usadas?: number; avisos?: string[]; error?: string; editadas?: number; edicion?: { numero: string | null; m3: number } | null }> {
  try {
    const r = await fetch("/api/zomatik/np", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "sincronizar", pedido_id: pedidoId, eleccion: eleccion || undefined, mover_fecha: moverFecha ?? undefined, ...(precio !== undefined ? { precio_m3: precio, remito: remito || undefined } : {}) }) })
    const j = await json(r)
    return r.ok ? j : { error: j?.error || `Error ${r.status}` }
  } catch {
    return { error: "Sin conexión" }
  }
}

/** Lo que devuelve /api/zomatik/np/precio (solo con precios_np.editar). Precios NETOS (sin IVA). */
export type PrecioNp = {
  activo?: boolean
  sinMigracion?: boolean
  estado?: "ok" | "sin_vinculo" | "no_en_lista" | "sin_lista"
  lista?: { codigo: number; nombre: string; leida_at: string | null } | null
  precio_lista?: number | null
  precio_m3?: number | null
  origen?: "manual" | "np" | null
  bloqueado?: boolean
  numero_np?: string | null
  proyecto_precio_m3?: number | null
  aviso?: string | null
  /** Con la llave de la fibra (spec 2026-11-25): el artículo y su precio por kg en la lista (null = no está). */
  fibra?: { articulo: number; nombre: string; precio_kg: number | null } | null
}

/** El precio por m³ de la NP para la línea del formulario. null si no respondió (o no hay permiso): la línea no aparece. */
export async function leerPrecioNp(o: { formulaId: string; plantId: string; remito: string | null; pedidoId?: string | null }): Promise<PrecioNp | null> {
  try {
    const q = new URLSearchParams({ formula_id: o.formulaId, plant_id: o.plantId })
    if (o.remito) q.set("remito", o.remito)
    if (o.pedidoId) q.set("pedido_id", o.pedidoId)
    const r = await fetch(`/api/zomatik/np/precio?${q}`, { cache: "no-store" })
    if (!r.ok) return null
    return (await json(r)) as PrecioNp
  } catch {
    return null
  }
}

/** "Generar NP ahora": espera al robot (5 a 30 s). */
export async function generarNpAhora(pedidoId: string): Promise<{ ok: boolean; texto: string }> {
  try {
    const r = await fetch("/api/zomatik/np", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "generar", pedido_id: pedidoId }) })
    const j = await json(r)
    if (!r.ok) return { ok: false, texto: j?.error || `Error ${r.status}` }
    if (j?.activo === false) return { ok: false, texto: j?.motivo || "NP: se carga a mano en Zomatik" }
    if (j?.proceso?.ocupado) return { ok: false, texto: "El robot está ocupado con otra NP. Probá en un minuto." }
    const h = (j?.proceso?.hechas || []) as { estado: string; mensaje: string | null; numero?: string | null }[]
    const ok = h.find((x) => x.estado === "ok")
    if (ok) return { ok: true, texto: `NP generada: ${ok.numero}` }
    // El cambio de la NP por un cambio del pedido (spec 2026-11-18): "NP 0001-00001194 8 → 9 m³"
    const ed = (j?.ediciones?.hechas || []) as { estado: string; mensaje: string | null }[]
    const edOk = ed.find((x) => x.estado === "ok" || x.estado === "nada")
    if (edOk && !h.length) return { ok: true, texto: `NP actualizada en Zomatik: ${edOk.mensaje || "listo"}` }
    if (ed[0] && !h.length) return { ok: false, texto: ed[0].mensaje || ed[0].estado }
    if (j?.ediciones?.ocupado && !h.length) return { ok: false, texto: "El robot está ocupado con otra NP. Probá en un minuto." }
    const otra = h[0]
    if (otra) return { ok: false, texto: otra.mensaje || otra.estado }
    const nps = (j?.nps || []) as NpFila[]
    if (nps.some((x) => x.estado === "ok") && !nps.some((x) => ["pendiente", "error"].includes(x.estado))) return { ok: true, texto: "El pedido ya tiene su NP." }
    return { ok: false, texto: "No había nada para generar." }
  } catch {
    return { ok: false, texto: "Sin conexión" }
  }
}

// ---------------------------------------------------------------------------
// Vincular con Zomatik desde el pedido (04/11/2026): /api/zomatik/vincular
// ---------------------------------------------------------------------------

export type EstadoVinculosPedido = { cliente: EstadoCliente | null; formula: EstadoFormula | null }

/** Qué le falta vincular al cliente y a la fórmula del pedido, con sugerencias. null si no respondió. */
export async function estadoVinculos(clientId: string | null, formulaId: string | null): Promise<EstadoVinculosPedido | { error: string }> {
  try {
    const q = new URLSearchParams()
    if (clientId) q.set("client_id", clientId)
    if (formulaId) q.set("formula_id", formulaId)
    const r = await fetch(`/api/zomatik/vincular?${q}`, { cache: "no-store" })
    const j = await json(r)
    return r.ok ? (j as EstadoVinculosPedido) : { error: j?.error || `Error ${r.status}` }
  } catch {
    return { error: "Sin conexión" }
  }
}

/** Buscador del cartel: clientes de la copia de Zomatik o artículos. */
export async function buscarParaVincular(
  tipo: "cliente" | "articulo",
  q: string,
  o: { clientId?: string | null; formulaId?: string | null } = {},
): Promise<{ clientes?: HitClienteVincular[]; articulos?: HitArticuloVincular[]; error?: string }> {
  try {
    const p = new URLSearchParams({ buscar: tipo, q })
    if (o.clientId) p.set("client_id", o.clientId)
    if (o.formulaId) p.set("formula_id", o.formulaId)
    const r = await fetch(`/api/zomatik/vincular?${p}`, { cache: "no-store" })
    const j = await json(r)
    return r.ok ? j : { error: j?.error || `Error ${r.status}` }
  } catch {
    return { error: "Sin conexión" }
  }
}

/**
 * "¿No está? Actualizar desde Zomatik": trae a la copia los clientes o los artículos de Zomatik (como mucho una vez
 * cada 2 min por tipo; si se hizo hace poco, `reciente` y se busca en lo que hay). Después hay que volver a buscar.
 */
export async function actualizarCopiaZomatik(tipo: "clientes" | "articulos" | "precios"): Promise<{ ok: boolean; reciente?: boolean; error?: string }> {
  try {
    const r = await fetch("/api/zomatik/actualizar-copia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo }) })
    const j = await json(r)
    return r.ok && j?.ok ? { ok: true, reciente: !!j.reciente } : { ok: false, error: j?.error || `Error ${r.status}` }
  } catch {
    return { ok: false, error: "Sin conexión" }
  }
}

export type ItemVincular = { tipo: "cliente" | "formula"; id: string; codigo: number }

/** Vincula desde el pedido (solo lo que falta). `pedidoId` = el pedido guardado; sin él, "pedido nuevo". */
export async function vincularDesdePedido(items: ItemVincular[], pedidoId?: string | null): Promise<{ ok: boolean; errores: string[]; resultados: { ok: boolean; tipo?: string; codigo?: number; nombre?: string; error?: string }[] }> {
  try {
    const r = await fetch("/api/zomatik/vincular", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ desde: "pedido", pedido_id: pedidoId || undefined, items: items.map((x) => ({ ...x, accion: "vincular" })) }),
    })
    const j = await json(r)
    if (!j?.resultados) return { ok: false, errores: [j?.error || `Error ${r.status}`], resultados: [] }
    return { ok: !!j.ok, errores: (j.errores || []).filter(Boolean), resultados: j.resultados }
  } catch {
    return { ok: false, errores: ["Sin conexión"], resultados: [] }
  }
}

/** Un gerencial resuelve un cambio de la NP trabado: "Reintentar cambio de NP" o "Dejar la NP como está" (con motivo). */
export async function resolverEdicionNp(pedidoId: string, edicionId: string, decision: "reintentar" | "dejar", motivo?: string): Promise<{ ok: boolean; texto: string }> {
  try {
    const r = await fetch("/api/zomatik/np", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "edicion", pedido_id: pedidoId, edicion_id: edicionId, decision, motivo }) })
    const j = await json(r)
    return r.ok ? { ok: true, texto: decision === "reintentar" ? "Se reintenta en unos segundos." : "La NP queda como está." } : { ok: false, texto: j?.error || `Error ${r.status}` }
  } catch {
    return { ok: false, texto: "Sin conexión" }
  }
}

/** Estados de un cambio de la NP que resuelve un gerencial. Con la llave apagada, también uno pendiente o en curso. */
const trabadasDe = (e: EstadoPedidoNp | undefined | null) => (e?.editar === false ? ["revisar", "error", "pendiente", "generando"] : ["revisar", "error"])

/** Los cambios de la NP trabados de un pedido: los resuelve un gerencial desde el menú ⋯. */
export function edicionesTrabadas(e: EstadoPedidoNp | undefined | null): { np: NpFila; edicion: EdicionNp }[] {
  const t = trabadasDe(e)
  return (e?.nps || []).filter((x) => x.edicion && t.includes(x.edicion.estado)).map((x) => ({ np: x, edicion: x.edicion! }))
}

/** ¿El pedido tiene un cambio de la NP esperando al robot (pendiente o en error)? "Generar NP ahora" lo hace ya. */
export const tieneEdicionPorHacer = (e: EstadoPedidoNp | undefined | null) => e?.editar !== false && (e?.nps || []).some((x) => x.edicion && ["pendiente", "error"].includes(x.edicion.estado))

export async function revisarNp(npId: string, decision: "otra" | "buena"): Promise<string | null> {
  const r = await fetch("/api/zomatik/np", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "revisada", np_id: npId, decision }) })
  if (r.ok) return null
  return (await json(r))?.error || `Error ${r.status}`
}

/** Estado de la NP de los pedidos visibles (y las plantas). `ids` vacío: solo las plantas. */
export function useNp(ids: string[]) {
  const [porPedido, setPorPedido] = useState<Record<string, EstadoPedidoNp>>({})
  const [plantas, setPlantas] = useState<Record<string, PlantaNpResumen>>({})
  const clave = [...ids].sort().join(",")
  const vivo = useRef(true)
  // Siempre se pide con los pedidos de AHORA y solo vale la última respuesta (antes, un "recargar en 12 s" con la
  // lista vieja podía llegar después y pisar el estado: un pedido "desaparecía").
  const claveActual = useRef(clave)
  claveActual.current = clave
  const ultimo = useRef(0)
  const cargar = useCallback(async () => {
    const n = ++ultimo.current
    try {
      const r = await fetch(`/api/zomatik/np?pedidos=${encodeURIComponent(claveActual.current)}`, { cache: "no-store" })
      if (!r.ok) return
      const j = await json(r)
      if (!vivo.current || n !== ultimo.current) return
      setPorPedido(j?.porPedido || {})
      setPlantas(j?.plantas || {})
    } catch {
      /* sin NP en pantalla */
    }
  }, [])
  useEffect(() => {
    vivo.current = true
    cargar()
    return () => {
      vivo.current = false
    }
  }, [cargar, clave])
  /** Vuelve a mirar en unos segundos (el robot trabaja después de responder). */
  const recargarEn = useCallback((ms = 12_000) => {
    setTimeout(() => vivo.current && cargar(), ms)
  }, [cargar])
  return { porPedido, plantas, recargar: cargar, recargarEn }
}

/**
 * Estado de la NP de UN pedido (el que se abre para editar), aparte de la lista de la semana, con tiempo máximo.
 * null si no respondió a tiempo o falló: quien llama sigue sin él (Guardar nunca depende de esto).
 */
export async function estadoNpDePedido(pedidoId: string, ms = 5_000): Promise<EstadoPedidoNp | null> {
  const ctrl = new AbortController()
  const corte = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(`/api/zomatik/np?pedidos=${encodeURIComponent(pedidoId)}`, { cache: "no-store", signal: ctrl.signal })
    if (!r.ok) return null
    const j = await json(r)
    return (j?.porPedido?.[pedidoId] as EstadoPedidoNp) || null
  } catch {
    return null
  } finally {
    clearTimeout(corte)
  }
}

/**
 * Programación abierta (con programacion.cargar) y alguna planta con la llave prendida: cada 10 min pide la pasada
 * (reintento automático de las NP pendientes). El servidor hace como mucho una cada 9 min entre todos.
 */
export function usePasadaNp(activa: boolean, alTerminar?: () => void) {
  useEffect(() => {
    if (!activa) return
    const t = setInterval(async () => {
      try {
        await fetch("/api/zomatik/np/procesar", { method: "POST" })
        alTerminar?.()
      } catch {
        /* la próxima */
      }
    }, 10 * 60_000)
    return () => clearInterval(t)
  }, [activa, alTerminar])
}

/** Texto corto y color de la NP de un pedido para las tarjetas. null = no mostrar nada (llave apagada). */
export function chipNp(e: EstadoPedidoNp | undefined | null): { texto: string; clase: "ok" | "mal" | "aviso" | "gris"; titulo: string } | null {
  if (!e || !e.activo) return null
  if (!e.entra) return { texto: "NP a mano", clase: "gris", titulo: "Pedido de antes de prender la NP automática: la NP se carga a mano en Zomatik" }
  // Pedido cancelado o completo con saldo en su NP: queda pendiente en Programación (NP con saldo)
  if (e.cerrado) {
    const conSaldo = e.nps.filter((x) => x.estado === "ok" && x.libre > 0.001)
    if (conSaldo.length) return { texto: "NP pendiente con saldo", clase: "aviso", titulo: conSaldo.map((x) => `${x.numero || "NP"}: ${x.libre} m³ libres (Programación › NP con saldo)`).join("\n") }
  }
  const vivas = e.nps.filter((x) => ["pendiente", "generando", "ok", "revisar", "error"].includes(x.estado))
  const corto = (n: string | null) => (n ? n.replace(/^(NP2?) 0001-0000/, "$1 …") : "")
  if (!vivas.length) {
    const vac = e.nps.filter((x) => ["vaciar", "vaciando"].includes(x.estado))
    if (vac.length) return { texto: "NP: falta vaciar", clase: "aviso", titulo: vac.map((x) => `${x.numero || "NP"}: ${x.mensaje || "pedido cancelado"}`).join("\n") }
    if (e.nps.some((x) => x.estado === "vaciada")) return { texto: "NP vaciada", clase: "gris", titulo: e.nps.map((x) => x.numero).filter(Boolean).join(", ") }
    return e.excepcion ? { texto: "Sin NP (autorizado)", clase: "aviso", titulo: `Autorizó ${e.excepcion.autorizado_por}` } : { texto: "NP pendiente", clase: "mal", titulo: "Todavía no tiene NP en Zomatik" }
  }
  const malas = vivas.filter((x) => x.estado !== "ok")
  const m3c = (n: number | null | undefined) => String(Math.round(Number(n || 0) * 1000) / 1000).replace(".", ",")
  // Un cambio de la NP que Zomatik no dejó hacer (factura o rechazo): el chip de siempre, con la nota en el título
  const notaEdicion = (x: NpFila) => {
    const ed = x.edicion
    if (!ed || ed.estado !== "nada" || !["adicional", "devol"].includes(ed.tipo || "")) return ""
    return ed.tipo === "adicional"
      ? ` · Zomatik no dejó cambiarla: va una NP adicional por ${m3c(Math.max(0, Number(ed.m3_objetivo) - Number(ed.m3_np)))} m³`
      : " · Tiene factura: se ajusta al terminar"
  }
  const titulo = vivas.map((x) => `${x.numero || `NP ${x.n}`} · ${x.m3} m³${x.tipo === "proyecto" ? " · proyecto" : ""}${x.estado !== "ok" ? ` · ${x.mensaje || x.estado}` : ""}${notaEdicion(x)}`).join("\n")
  // Cambio de la NP por un cambio del pedido (spec 2026-11-18, 7.3). Con la llave de la edición apagada, uno pendiente o
  // en curso no lo termina nadie: es "revisar cambio", y no tapa "NP sin autorizar"
  const sinLlave = e.editar === false
  const editando = vivas.filter((x) => x.estado === "ok" && x.edicion && ["pendiente", "generando", "revisar", "error"].includes(x.edicion.estado))
  const sinAutorizar = vivas.filter((x) => x.estado === "ok" && (x.paso === "sin_autorizar" || x.paso === "autorizar_revisar"))
  if (!malas.length && editando.length && !(sinLlave && sinAutorizar.length)) {
    const t = trabadasDe(e)
    const trabada = editando.find((x) => t.includes(x.edicion!.estado))
    if (trabada) {
      const quieto = sinLlave && ["pendiente", "generando"].includes(trabada.edicion!.estado)
      return { texto: "NP: revisar cambio", clase: trabada.edicion!.estado === "error" ? "mal" : "aviso", titulo: quieto ? "El cambio de la NP quedó a medias y la edición está apagada: dejala como está." : trabada.edicion!.mensaje || "El cambio de la NP quedó para revisar" }
    }
    const x = editando[0]
    const ed = x.edicion!
    const espera = ed.mensaje && /^Esperando/.test(ed.mensaje) ? `\n${ed.mensaje}` : ""
    return { texto: `NP: actualizando a ${m3c(ed.m3_objetivo)} m³`, clase: "aviso", titulo: `${x.numero || "NP"}: ${m3c(ed.m3_np ?? x.m3)} → ${m3c(ed.m3_objetivo)} m³ en Zomatik${espera}` }
  }
  // NP generada pero sin autorizar en Zomatik (03/11): sin autorizar no se puede remitir
  const sinAut = vivas.filter((x) => x.estado === "ok" && (x.paso === "sin_autorizar" || x.paso === "autorizar_revisar"))
  if (!malas.length && sinAut.length) return { texto: "NP sin autorizar en Zomatik", clase: "aviso", titulo: sinAut.map((x) => `${x.numero || "NP"}: ${x.mensaje || "sin autorizar"}`).join("\n") }
  if (!malas.length) return { texto: `${vivas.map((x) => corto(x.numero)).join(" + ")} ✓`, clase: "ok", titulo }
  const peor = malas.find((x) => x.estado === "error") || malas.find((x) => x.estado === "revisar") || malas[0]
  const t = peor.estado === "error" ? "NP con error" : peor.estado === "revisar" ? "NP: revisar" : peor.estado === "generando" ? "Generando NP…" : "NP pendiente"
  return { texto: t, clase: peor.estado === "revisar" || peor.estado === "generando" ? "aviso" : "mal", titulo }
}
