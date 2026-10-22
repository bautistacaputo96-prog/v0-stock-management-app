"use client"
/** Chip de la NP de Zomatik de un pedido (Z2): verde con el número, rojo pendiente/error, ámbar revisar. */
import { cn } from "@/lib/utils"
import { chipNp, type EstadoPedidoNp } from "@/lib/zomatik/np-cliente"

export function NpChip({ estado, className }: { estado: EstadoPedidoNp | undefined | null; className?: string }) {
  const c = chipNp(estado)
  if (!c) return null
  return (
    <span
      title={c.titulo}
      className={cn(
        "inline-block max-w-full truncate rounded px-1 text-[10px] leading-tight",
        c.clase === "ok" && "bg-emerald-50 text-emerald-800",
        c.clase === "mal" && "bg-red-50 font-medium text-red-700",
        c.clase === "aviso" && "bg-amber-50 text-amber-800",
        c.clase === "gris" && "text-muted-foreground",
        className,
      )}
    >
      {c.texto}
    </span>
  )
}
