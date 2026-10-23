"use client"
/**
 * Zomatik · Z2 · NP desde el navegador: estado de los pedidos, avisar un cambio y "Generar NP ahora".
 * Nunca habla con Zomatik: todo pasa por /api/zomatik/np (servidor, con la llave de la planta).
 */
import { useCallback, useEffect, useRef, useState } from "react"
import type { ControlDespacho, EstadoNp, ModoNp, TipoNp } from "@/lib/zomatik/np"

export type NpFila = {
  id: string; n: number; estado: EstadoNp; tipo: TipoNp; m3: number; numero: string | null; zomatik_codigo: number | null
  mensaje: string | null; proyecto_codigo: number | null; es_adicional: boolean; disponible_m3: number | null; updated_at: string
  /** m³ que el pedido usa de esta NP y lo libre de la NP (una NP puede servir a varios pedidos). */
  m3_uso: number; libre: number; fecha: string; fecha_zomatik: string | null; saldo_mensaje: string | null
}
export type EstadoPedidoNp = {
  activo: boolean; modo: ModoNp; entra: boolean; nps: NpFila[]
  /** Pedido cancelado o completo: sus NP con saldo quedan pendientes en Programación. */
  cerrado: boolean
  excepcion: { autorizado_por: string; motivo_tipo: string; motivo: string | null } | null
  control: ControlDespacho
  /** NP nueva o de un proyecto, guardada en el servidor (null = todavía no se eligió). */
  eleccion: { tipo: TipoNp | "saldo"; proyecto_codigo: number | null; tope_m3: number | null; np_id: string | null } | null
}
export type PlantaNpResumen = { activo: boolean; modo: ModoNp; aviso_hasta: string | null }
export type EleccionNp = { tipo: TipoNp | "saldo"; proyecto_codigo: number | null; tope_m3: number | null; np_id?: string | null }

/** Una NP del sistema con saldo (lista de Programación y opción "Usar NP con saldo"). */
export type NpSaldo = {
  id: string; numero: string | null; zomatik_codigo: number | null; m3: number; libre: number; comprometido: number; fecha: string; fecha_zomatik: string | null
  saldo_decision: string | null; saldo_mensaje: string | null; pendiente_desde: string | null; plant_id: string | null; client_id: string | null; cliente: string | null
  formula_id: string | null; formula: string | null; construction_site_id: string | null; obra: string | null; con_pedido_activo: boolean
}

export async function cargarNpSaldos(filtro: { clientId?: string; formulaId?: string } = {}): Promise<NpSaldo[]> {
  try {
    const q = filtro.clientId ? `?client_id=${filtro.clientId}${filtro.formulaId ? `&formula_id=${filtro.formulaId}` : ""}` : ""
    const r = await fetch(`/api/zomatik/np/saldos${q}`, { cache: "no-store" })
    if (!r.ok) return []
    return ((await json(r))?.nps as NpSaldo[]) || []
  } catch {
    return []
  }
}

/** "Devolver el saldo" o "Ya la devolví" (a mano, DEVOL). */
export async function decidirSaldoNp(npId: string, decision: "devolver" | "cerrada"): Promise<{ ok: boolean; texto: string }> {
  try {
    const r = await fetch("/api/zomatik/np", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "saldo", np_id: npId, decision }) })
    const j = await json(r)
    return r.ok ? { ok: true, texto: j?.mensaje || "Listo" } : { ok: false, texto: j?.error || `Error ${r.status}` }
  } catch {
    return { ok: false, texto: "Sin conexión" }
  }
}

async function json(r: Response) {
  return r.json().catch(() => ({}))
}

/** Después de guardar, cancelar o cambiar los m³: el servidor decide qué NP crear o vaciar (con la llave apagada, nada). */
export async function avisarNp(pedidoId: string, eleccion?: EleccionNp | null, moverFecha?: boolean | null): Promise<{ activo?: boolean; creadas?: number; usadas?: number; avisos?: string[]; error?: string }> {
  try {
    const r = await fetch("/api/zomatik/np", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "sincronizar", pedido_id: pedidoId, eleccion: eleccion || undefined, mover_fecha: moverFecha ?? undefined }) })
    const j = await json(r)
    return r.ok ? j : { error: j?.error || `Error ${r.status}` }
  } catch {
    return { error: "Sin conexión" }
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
    const otra = h[0]
    if (otra) return { ok: false, texto: otra.mensaje || otra.estado }
    const nps = (j?.nps || []) as NpFila[]
    if (nps.some((x) => x.estado === "ok") && !nps.some((x) => ["pendiente", "error"].includes(x.estado))) return { ok: true, texto: "El pedido ya tiene su NP." }
    return { ok: false, texto: "No había nada para generar." }
  } catch {
    return { ok: false, texto: "Sin conexión" }
  }
}

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
  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/zomatik/np?pedidos=${encodeURIComponent(clave)}`, { cache: "no-store" })
      if (!r.ok) return
      const j = await json(r)
      if (!vivo.current) return
      setPorPedido(j?.porPedido || {})
      setPlantas(j?.plantas || {})
    } catch {
      /* sin NP en pantalla */
    }
  }, [clave])
  useEffect(() => {
    vivo.current = true
    cargar()
    return () => {
      vivo.current = false
    }
  }, [cargar])
  /** Vuelve a mirar en unos segundos (el robot trabaja después de responder). */
  const recargarEn = useCallback((ms = 12_000) => {
    setTimeout(() => vivo.current && cargar(), ms)
  }, [cargar])
  return { porPedido, plantas, recargar: cargar, recargarEn }
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
  const titulo = vivas.map((x) => `${x.numero || `NP ${x.n}`} · ${x.m3} m³${x.tipo === "proyecto" ? " · proyecto" : ""}${x.estado !== "ok" ? ` · ${x.mensaje || x.estado}` : ""}`).join("\n")
  if (!malas.length) return { texto: `${vivas.map((x) => corto(x.numero)).join(" + ")} ✓`, clase: "ok", titulo }
  const peor = malas.find((x) => x.estado === "error") || malas.find((x) => x.estado === "revisar") || malas[0]
  const t = peor.estado === "error" ? "NP con error" : peor.estado === "revisar" ? "NP: revisar" : peor.estado === "generando" ? "Generando NP…" : "NP pendiente"
  return { texto: t, clase: peor.estado === "revisar" || peor.estado === "generando" ? "aviso" : "mal", titulo }
}
