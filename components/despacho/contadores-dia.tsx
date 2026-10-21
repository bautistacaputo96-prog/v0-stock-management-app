"use client"

import { m3txt, type Contadores } from "@/lib/despacho"
import { cn } from "@/lib/utils"

/** Contadores del día de la planta elegida, en una sola franja chica (con nombre, como los íconos de Loop). */
export function ContadoresDia({ c, extra }: { c: Contadores; extra?: React.ReactNode }) {
  const items: { v: string; l: string; cls?: string }[] = [
    { v: `${m3txt(c.programado)} m³`, l: "Programado" },
    { v: `${m3txt(c.despachado)} m³`, l: "Despachado", cls: "text-emerald-700" },
    { v: `${m3txt(c.falta)} m³`, l: "Falta" },
    { v: `${m3txt(c.suspendido)} m³`, l: "Suspendido" },
    { v: `${m3txt(c.cancelado)} m³`, l: "Cancelado", cls: c.cancelado > 0 ? "text-red-700" : undefined },
    { v: `${c.viajesDespachados} de ${c.viajesTotal}`, l: "Viajes" },
  ]
  return (
    <div className="d3c-card flex flex-wrap items-center gap-x-4 gap-y-0.5 rounded-md border bg-card px-2.5 py-1">
      {items.map((x) => (
        <span key={x.l} className="whitespace-nowrap text-[12px]">
          <span className="text-muted-foreground">{x.l} </span>
          <b className={cn("font-semibold tabular-nums", x.cls)}>{x.v}</b>
        </span>
      ))}
      {extra && <span className="ml-auto text-[11px] text-muted-foreground">{extra}</span>}
    </div>
  )
}
