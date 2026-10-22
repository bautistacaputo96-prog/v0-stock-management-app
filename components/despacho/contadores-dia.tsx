"use client"

/**
 * Contadores del día, como Loop (22/10): una caja chica con íconos naranjas y el número abajo (m³). Programado,
 * despachado, % despachado, pendiente, suspendido, cancelado y adicional (despachos sin pedido programado). El nombre de
 * cada uno va en el tooltip.
 */
import { Ban, CalendarRange, CircleDashed, Pause, Percent, Plus, Truck } from "lucide-react"
import { m3txt, type Contadores } from "@/lib/despacho"
import { cn } from "@/lib/utils"

export function ContadoresDia({ c, adicional = 0, className }: { c: Contadores; adicional?: number; className?: string }) {
  const pct = c.programado > 0 ? (c.despachado / c.programado) * 100 : 0
  const items: { Icono: typeof Truck; v: string; t: string }[] = [
    { Icono: CalendarRange, v: m3txt(c.programado), t: "Programado (m³)" },
    { Icono: Truck, v: m3txt(c.despachado), t: "Despachado (m³)" },
    { Icono: Percent, v: `${pct.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`, t: "Despachado sobre programado" },
    { Icono: CircleDashed, v: m3txt(c.falta), t: "Pendiente (m³)" },
    { Icono: Pause, v: m3txt(c.suspendido), t: "Suspendido (m³)" },
    { Icono: Ban, v: m3txt(c.cancelado), t: "Cancelado (m³)" },
    { Icono: Plus, v: m3txt(adicional), t: "Adicional: despachado sin pedido programado (m³)" },
  ]
  return (
    <div className={cn("d3c-card inline-flex items-center gap-3 rounded-md border bg-card px-2.5 py-0.5 shadow-sm", className)} title={`Viajes despachados: ${c.viajesDespachados} de ${c.viajesTotal}`}>
      {items.map(({ Icono, v, t }) => (
        <span key={t} className="flex flex-col items-center leading-tight" title={t}>
          <Icono className="h-3 w-3 text-orange-500" aria-label={t} />
          <span className="text-xs tabular-nums">{v}</span>
        </span>
      ))}
    </div>
  )
}
