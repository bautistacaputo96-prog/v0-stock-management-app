"use client"
/**
 * Zomatik · Z1 · OF + remito desde el navegador: "Remitir en Zomatik" (al finalizar el pedido o desde su menú) y el
 * estado de los remitos. Nunca habla con Zomatik: todo pasa por /api/zomatik/remito (servidor, con la llave de remitir).
 */
import { useCallback, useEffect, useRef, useState } from "react"

export type RemitoEstado = { estado: string; of_numero: string | null; remito_numero: string | null; mensaje: string | null; fecha: string }

/** Arma la OF + remito de lo despachado ese día. Con la llave apagada devuelve null (no hay nada que avisar). */
export async function remitirPedido(pedidoId: string, fecha: string): Promise<{ titulo: string; texto: string; mal?: boolean } | null> {
  try {
    const r = await fetch("/api/zomatik/remito", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "remitir", pedido_id: pedidoId, fecha }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return { titulo: "No se pudo remitir en Zomatik", texto: j?.error || `Error ${r.status}`, mal: true }
    if (j?.activo === false) return null
    if (j?.problemas?.length) return { titulo: "Remito en Zomatik: hay que revisar", texto: j.problemas.join(" "), mal: true }
    if (j?.creados) return { titulo: "Haciendo la OF y el remito en Zomatik…", texto: "En unos segundos aparece el número en el pedido." }
    return { titulo: "Remito en Zomatik", texto: "No había despachos nuevos para remitir." }
  } catch {
    return { titulo: "No se pudo remitir en Zomatik", texto: "Sin conexión", mal: true }
  }
}

export function useRemitos(ids: string[]) {
  const [porPedido, setPorPedido] = useState<Record<string, RemitoEstado[]>>({})
  const clave = [...ids].sort().join(",")
  const claveActual = useRef(clave)
  claveActual.current = clave
  const ultimo = useRef(0)
  const cargar = useCallback(async () => {
    const n = ++ultimo.current
    if (!claveActual.current) return setPorPedido({})
    try {
      const r = await fetch(`/api/zomatik/remito?pedidos=${encodeURIComponent(claveActual.current)}`, { cache: "no-store" })
      if (!r.ok) return
      const j = await r.json().catch(() => ({}))
      if (n === ultimo.current) setPorPedido(j?.porPedido || {})
    } catch {
      /* sin remitos en pantalla */
    }
  }, [])
  useEffect(() => {
    cargar()
  }, [cargar, clave])
  const recargarEn = useCallback((ms = 15_000) => setTimeout(cargar, ms), [cargar])
  return { porPedido, recargar: cargar, recargarEn }
}

/** Texto corto del chip: "RM2 …2746 ✓", "Remito pendiente", "Remito con error", "Remito: revisar". null = nada. */
export function chipRemito(rs: RemitoEstado[] | undefined): { texto: string; clase: "ok" | "mal" | "aviso"; titulo: string } | null {
  if (!rs?.length) return null
  const titulo = rs.map((r) => `${r.fecha}: ${r.of_numero || "OF pendiente"} · ${r.remito_numero || "remito pendiente"}${r.mensaje ? ` · ${r.mensaje}` : ""}`).join("\n")
  const malos = rs.filter((r) => r.estado !== "ok")
  if (!malos.length) return { texto: `${rs.map((r) => (r.remito_numero || "").replace(/^(RM2?) \d{4}-0+/, "$1 …")).join(" + ")} ✓`, clase: "ok", titulo }
  const peor = malos.find((r) => r.estado === "error") || malos.find((r) => r.estado === "revisar") || malos[0]
  return { texto: peor.estado === "error" ? "Remito con error" : peor.estado === "revisar" ? "Remito: revisar" : "Remito pendiente", clase: peor.estado === "revisar" || peor.estado === "generando" ? "aviso" : "mal", titulo }
}
