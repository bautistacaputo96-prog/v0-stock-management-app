"use client"
/**
 * Al cancelar un pedido con NP en Zomatik (pedido de Bautista del 28/10): "¿Cancelar también la NP en Zomatik?".
 *   - No, dejala pendiente: queda en "NP con saldo" para reprogramar (por ejemplo, por lluvia).
 *   - Sí, cancelarla: la vacía en el momento, como "Devolver el saldo".
 * Sin elegir no se cancela el pedido. Si el pedido ya tuvo despachos (remitos), solo la primera, con el aviso de DEVOL.
 */
import { cn } from "@/lib/utils"
import { avisarNp, decidirSaldoNp, type NpFila } from "@/lib/zomatik/np-cliente"

export type DecisionNpCancelar = "dejar" | "cancelar"

/** NP del pedido que ya están en Zomatik (las que hay que decidir). */
export const npsEnZomatik = (nps: NpFila[] | undefined | null) => (nps || []).filter((x) => x.estado === "ok")

export function NpCancelarPregunta({ nps, despachado, valor, onCambio }: { nps: NpFila[]; despachado: number; valor: DecisionNpCancelar | null; onCambio: (v: DecisionNpCancelar) => void }) {
  if (!nps.length) return null
  const conRemitos = despachado > 0.001
  const numeros = nps.map((x) => x.numero || `NP ${x.n}`).join(", ")
  return (
    <div className="space-y-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
      <div className="font-medium">¿Cancelar también la NP en Zomatik? <span className="font-normal text-muted-foreground">({numeros})</span></div>
      <button type="button" onClick={() => onCambio("dejar")} className={cn("block w-full rounded-md border-2 bg-white px-2 py-1.5 text-left", valor === "dejar" ? "border-primary" : "border-border")}>
        <span className="font-medium">No, dejala pendiente</span>
        <span className="block text-xs text-muted-foreground">Por ejemplo, por lluvia: queda en «NP con saldo» para reprogramar.</span>
      </button>
      {conRemitos ? (
        <p className="text-xs text-amber-900">Ya tuvo despachos: para cancelar el saldo hace falta una devolución (DEVOL) a mano en Zomatik. Queda pendiente y se devuelve desde «NP con saldo».</p>
      ) : (
        <button type="button" onClick={() => onCambio("cancelar")} className={cn("block w-full rounded-md border-2 bg-white px-2 py-1.5 text-left", valor === "cancelar" ? "border-primary" : "border-border")}>
          <span className="font-medium">Sí, cancelarla</span>
          <span className="block text-xs text-muted-foreground">Se vacía en Zomatik ahora, como «Devolver el saldo».</span>
        </button>
      )}
    </div>
  )
}

/**
 * Después de cancelar el pedido: sincroniza (lo que no llegó a Zomatik se anula) y, si se eligió, vacía sus NP.
 * Devuelve el texto para el aviso.
 */
export async function npDespuesDeCancelar(pedidoId: string, nps: NpFila[], decision: DecisionNpCancelar | null): Promise<{ titulo: string; texto: string; mal?: boolean } | null> {
  await avisarNp(pedidoId)
  if (!nps.length) return null
  if (decision !== "cancelar") return { titulo: "La NP queda pendiente en Programación", texto: "En «NP con saldo», hasta que se reprograme o se devuelva." }
  const res = await Promise.all(nps.map((x) => decidirSaldoNp(x.id, "devolver").then((r) => ({ ...r, numero: x.numero || `NP ${x.n}` }))))
  const mal = res.filter((r) => !r.ok)
  if (!mal.length) return { titulo: "Se cancela la NP en Zomatik", texto: res.map((r) => `${r.numero}: ${r.texto}`).join(" · ") }
  return { titulo: "La NP no se pudo cancelar", texto: mal.map((r) => `${r.numero}: ${r.texto}`).join(" · ") + " Queda pendiente en «NP con saldo».", mal: true }
}
