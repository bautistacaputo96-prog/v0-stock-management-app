"use client"

/**
 * /plantista: la pantalla nueva (tres columnas) convive con la de siempre (fase-3.md 6).
 * - Solo los usuarios con el interruptor de funciones nuevas (app_users.ve_funciones_nuevas) ven el selector
 *   "Pantalla nueva · en prueba / Pantalla de siempre". Para ellos arranca en la nueva; la elección se recuerda en
 *   el equipo.
 * - Para los demás no cambia nada: ven la pantalla de siempre, igual que antes.
 */
import { useEffect, useState } from "react"
import { PlantistaView } from "@/components/plantista-view"
import { usePermisos } from "@/lib/current-user"
import { cn } from "@/lib/utils"
import { DespachoTablero } from "./despacho-tablero"
import type { Planta } from "./tipos"

const CLAVE = "rebucret_pantalla_despacho"

export function SelectorPantallaDespacho({ plants }: { plants: Planta[] }) {
  const { usuario, listo } = usePermisos()
  const ve = usuario?.veFuncionesNuevas === true
  const [pantalla, setPantalla] = useState<"nueva" | "vieja">("nueva")
  useEffect(() => {
    try { if (window.localStorage.getItem(CLAVE) === "vieja") setPantalla("vieja") } catch { /* sin almacenamiento */ }
  }, [])
  const elegir = (p: "nueva" | "vieja") => {
    setPantalla(p)
    try { window.localStorage.setItem(CLAVE, p) } catch { /* sin almacenamiento */ }
  }

  if (!listo) return null

  const vieja = (
    <div className="container mx-auto py-6 px-4">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Despacho Diario</h1>
          <p className="text-muted-foreground">Control de despachos en tiempo real</p>
        </div>
        {ve && <Selector valor="vieja" onElegir={elegir} />}
      </div>
      <PlantistaView plants={plants} />
    </div>
  )
  if (!ve || pantalla === "vieja") return vieja
  return (
    <div className="px-3 pb-6">
      <DespachoTablero plants={plants} onPantallaVieja={() => elegir("vieja")} />
    </div>
  )
}

function Selector({ valor, onElegir }: { valor: "nueva" | "vieja"; onElegir: (v: "nueva" | "vieja") => void }) {
  return (
    <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-sm">
      {([["nueva", "Pantalla nueva · en prueba"], ["vieja", "Pantalla de siempre"]] as const).map(([k, l]) => (
        <button key={k} onClick={() => onElegir(k)} className={cn("min-h-[38px] rounded-md px-3 font-semibold", valor === k ? "bg-background shadow-sm" : "text-muted-foreground")}>{l}</button>
      ))}
    </div>
  )
}
