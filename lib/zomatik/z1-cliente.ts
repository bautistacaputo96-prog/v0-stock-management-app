"use client"
/**
 * Zomatik · Z1 · OF + remito desde el navegador: "Remitir en Zomatik" (al finalizar el pedido o desde su menú) y el
 * estado de los remitos. Nunca habla con Zomatik: todo pasa por /api/zomatik/remito (servidor, con la llave de remitir).
 */
import { useCallback, useEffect, useRef, useState } from "react"

export type RemitoEstado = { estado: string; remito_estado?: string; of_numero: string | null; remito_numero: string | null; mensaje: string | null; fecha: string; paso?: string | null }

/** El ajuste de una NP del pedido al finalizar (docs/specs/2026-11-06-ajustar-np-al-finalizar.md). */
export type AjusteEstado = { estado: string; tipo: string | null; numero: string | null; m3_np: number | null; m3_objetivo: number | null; mensaje: string | null; con_factura: boolean | null }

const m3t = (n: number | null | undefined) => String(Math.round(Number(n || 0) * 1000) / 1000).replace(".", ",")

/** Arma la OF + remito de lo despachado ese día. Con la llave apagada devuelve null (no hay nada que avisar). */
export async function remitirPedido(pedidoId: string, fecha: string): Promise<{ titulo: string; texto: string; mal?: boolean } | null> {
  try {
    const r = await fetch("/api/zomatik/remito", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "remitir", pedido_id: pedidoId, fecha }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return { titulo: "No se pudo remitir en Zomatik", texto: j?.error || `Error ${r.status}`, mal: true }
    if (j?.activo === false) return null
    // Con el ajuste de la NP en camino, el despacho que no entraba (exceso) entra después de agrandarla
    if (j?.ajuste?.pendientes) {
      const otros = (j?.problemas || []).filter((p: string) => !/supera lo que le queda/i.test(p))
      if (otros.length) return { titulo: "Remito en Zomatik: hay que revisar", texto: otros.join(" "), mal: true }
      return { titulo: "Ajustando la NP y haciendo la OF y el remito…", texto: "En unos segundos aparece en el pedido." }
    }
    if (j?.problemas?.length) return { titulo: "Remito en Zomatik: hay que revisar", texto: j.problemas.join(" "), mal: true }
    if (j?.creados) return { titulo: "Haciendo la OF y el remito en Zomatik…", texto: "En unos segundos aparece el número en el pedido." }
    return { titulo: "Remito en Zomatik", texto: "No había despachos nuevos para remitir." }
  } catch {
    return { titulo: "No se pudo remitir en Zomatik", texto: "Sin conexión", mal: true }
  }
}

/** "Remitir sin ajustar la NP" / "Ya hice la devolución" (solo gerenciales, con motivo). */
export async function remitirSinAjustar(pedidoId: string, motivo: string): Promise<{ ok: boolean; texto: string }> {
  try {
    const r = await fetch("/api/zomatik/remito", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "remitir_sin_ajustar", pedido_id: pedidoId, motivo }) })
    const j = await r.json().catch(() => ({}))
    return r.ok ? { ok: true, texto: "En unos segundos sale el remito." } : { ok: false, texto: j?.error || `Error ${r.status}` }
  } catch {
    return { ok: false, texto: "Sin conexión" }
  }
}

export function useRemitos(ids: string[]) {
  const [porPedido, setPorPedido] = useState<Record<string, RemitoEstado[]>>({})
  const [ajustes, setAjustes] = useState<Record<string, AjusteEstado[]>>({})
  const [ajusteActivo, setAjusteActivo] = useState<Record<string, boolean>>({})
  const clave = [...ids].sort().join(",")
  const claveActual = useRef(clave)
  claveActual.current = clave
  const ultimo = useRef(0)
  const cargar = useCallback(async () => {
    const n = ++ultimo.current
    if (!claveActual.current) {
      setAjustes({})
      return setPorPedido({})
    }
    try {
      const r = await fetch(`/api/zomatik/remito?pedidos=${encodeURIComponent(claveActual.current)}`, { cache: "no-store" })
      if (!r.ok) return
      const j = await r.json().catch(() => ({}))
      if (n === ultimo.current) {
        setPorPedido(j?.porPedido || {})
        setAjustes(j?.ajustes || {})
        setAjusteActivo(j?.ajusteActivo || {})
      }
    } catch {
      /* sin remitos en pantalla */
    }
  }, [])
  useEffect(() => {
    cargar()
  }, [cargar, clave])
  const recargarEn = useCallback((ms = 15_000) => setTimeout(cargar, ms), [cargar])
  return { porPedido, ajustes, ajusteActivo, recargar: cargar, recargarEn }
}

/** ¿Hay un ajuste trabado que un gerencial puede resolver a mano? "factura" = la NP tiene factura (falta la devolución). */
export function ajusteParaResolver(as: AjusteEstado[] | undefined): "factura" | "trabado" | null {
  if (!as?.length) return null
  if (as.some((a) => a.estado === "revisar" && a.con_factura)) return "factura"
  return as.some((a) => a.estado === "revisar" || a.estado === "error" || a.estado === "pendiente") ? "trabado" : null
}

/** Texto corto del chip: "Ajustando NP…", "NP: revisar ajuste", "Remito esperando la NP", "RM2 …2746 ✓", "Remito pendiente"… null = nada. */
export function chipRemito(rs: RemitoEstado[] | undefined, as?: AjusteEstado[]): { texto: string; clase: "ok" | "mal" | "aviso"; titulo: string } | null {
  if (!rs?.length && !as?.length) return null
  rs = rs || []
  const lineasAjuste = (as || []).map((a) => `${a.numero || "NP"} ${a.estado === "ok" ? `${m3t(a.m3_np)} → ${m3t(a.m3_objetivo)} m³` : a.estado === "nada" ? "sin cambios" : a.estado === "a_mano" ? "a mano" : "ajuste pendiente"}${a.mensaje && a.estado !== "ok" ? ` · ${a.mensaje}` : ""}`)
  const titulo = [...lineasAjuste, ...rs.map((r) => `${r.fecha}: ${r.of_numero || "OF pendiente"} · ${r.remito_estado === "a_mano" ? "remito a mano" : r.remito_numero || "remito pendiente"}${r.mensaje ? ` · ${r.mensaje}` : ""}`)].join("\n")
  // El ajuste de la NP va antes que la OF y el remito
  if ((as || []).some((a) => a.estado === "revisar" || a.estado === "error")) return { texto: "NP: revisar ajuste", clase: "mal", titulo }
  if ((as || []).some((a) => a.estado === "pendiente" || a.estado === "generando")) return { texto: "Ajustando NP…", clase: "aviso", titulo }
  if (!rs.length) return null
  if (rs.some((r) => r.estado === "pendiente" && r.paso === "esperando_ajuste")) return { texto: "Remito esperando la NP", clase: "aviso", titulo }
  const malos = rs.filter((r) => r.estado !== "ok")
  // Número del remito en pausa (26.9): la OF la hace el sistema y el remito se carga a mano
  if (!malos.length && rs.some((r) => r.remito_estado === "a_mano")) return { texto: "OF ✓ · remito a mano", clase: "ok", titulo }
  if (!malos.length) return { texto: `${rs.map((r) => (r.remito_numero || "").replace(/^(RM2?) \d{4}-0+/, "$1 …")).join(" + ")} ✓`, clase: "ok", titulo }
  const peor = malos.find((r) => r.estado === "error") || malos.find((r) => r.estado === "revisar") || malos[0]
  return { texto: peor.estado === "error" ? "Remito con error" : peor.estado === "revisar" ? "Remito: revisar" : "Remito pendiente", clase: peor.estado === "revisar" || peor.estado === "generando" ? "aviso" : "mal", titulo }
}
