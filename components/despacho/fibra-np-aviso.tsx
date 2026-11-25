"use client"
/**
 * Fibra (spec 2026-11-25, Bautista 25/11): el pedido lleva fibra y su NP de Zomatik no la tiene (NP con saldo, NP de
 * antes de prender la llave o una que no se pudo editar). Se despacha igual, pero tiene que quedar a la vista: lo
 * corrige Programación / Juan en Zomatik. El aviso a Bautista (Actividad y mail) sale una vez por NP, desde el remito.
 */
import { MSJ_NP_SIN_FIBRA, npSinFibra } from "@/lib/fibra"
import type { EstadoPedidoNp } from "@/lib/zomatik/np-cliente"

export function FibraNpAviso({ estado, kgM3 }: { estado: EstadoPedidoNp | null | undefined; kgM3: number | null | undefined }) {
  if (!npSinFibra(estado, Number(kgM3) || 0)) return null
  return <div className="rounded-md border border-amber-400 bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-900">{MSJ_NP_SIN_FIBRA}</div>
}
