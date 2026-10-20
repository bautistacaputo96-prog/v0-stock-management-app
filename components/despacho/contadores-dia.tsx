"use client"

import { m3txt, type Contadores } from "@/lib/despacho"
import { cn } from "@/lib/utils"

/** Contadores del día de la planta elegida, como los íconos de Loop pero con nombre. */
export function ContadoresDia({ c }: { c: Contadores }) {
  const items: { v: string; l: string; cls?: string }[] = [
    { v: `${m3txt(c.programado)} m³`, l: "Programado" },
    { v: `${m3txt(c.despachado)} m³`, l: "Despachado", cls: "text-green-600" },
    { v: `${m3txt(c.falta)} m³`, l: "Falta" },
    { v: `${m3txt(c.suspendido)} m³`, l: "Suspendido", cls: "text-slate-600" },
    { v: `${m3txt(c.cancelado)} m³`, l: "Cancelado", cls: "text-red-600" },
    { v: `${c.viajesDespachados} de ${c.viajesTotal}`, l: "Viajes despachados" },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      {items.map((x) => (
        <div key={x.l} className="rounded-lg border bg-card px-3 py-2">
          <div className={cn("text-xl font-extrabold tabular-nums", x.cls)}>{x.v}</div>
          <div className="text-xs font-semibold text-muted-foreground">{x.l}</div>
        </div>
      ))}
    </div>
  )
}
