"use client"

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { duracion, hhmm, textoFuenteEstado } from "@/lib/despacho"
import { cn } from "@/lib/utils"
import type { CamionT, Planta } from "./tipos"

export type FiltroCamion = "todos" | "libres" | "viaje" | "taller"

const BORDE: Record<string, string> = {
  planta: "border-l-green-600", yendo: "border-l-blue-600", obra: "border-l-amber-500", volviendo: "border-l-cyan-600",
  taller: "border-l-slate-700 bg-slate-50", fuera: "border-l-slate-400 bg-slate-50",
}
const ETIQUETA: Record<string, string> = {
  planta: "bg-green-100 text-green-800", yendo: "bg-blue-100 text-blue-800", obra: "bg-amber-100 text-amber-900", volviendo: "bg-cyan-100 text-cyan-800",
  taller: "bg-slate-700 text-white", fuera: "bg-slate-200 text-slate-700",
}
export const COLOR_ESTADO = ETIQUETA

export function ColumnaCamiones({
  camiones, planta, plantas, filtro, setFiltro, ahora, puedeDespachar, hayViajeElegido, sobre,
  onTocar, onVolvio, onTaller, onDisponible,
}: {
  camiones: CamionT[]
  planta: string
  plantas: Planta[]
  filtro: FiltroCamion
  setFiltro: (f: FiltroCamion) => void
  ahora: number
  puedeDespachar: boolean
  hayViajeElegido: boolean
  /** camión que está debajo del viaje que se arrastra */
  sobre: string | null
  onTocar: (id: string) => void
  onVolvio: (id: string) => void
  onTaller: (id: string) => void
  onDisponible: (id: string) => void
}) {
  const nombre = (id: string | null) => plantas.find((p) => p.id === id)?.name || "planta"
  const libresAca = camiones.filter((c) => c.e.clave === "planta" && c.e.plantaId === planta).length
  const lista = camiones.filter((c) => {
    if (filtro === "libres") return c.e.clave === "planta"
    if (filtro === "viaje") return ["yendo", "obra", "volviendo"].includes(c.e.clave)
    if (filtro === "taller") return c.e.clave === "taller" || c.e.clave === "fuera"
    return true
  })
  const filtros: [FiltroCamion, string][] = [["todos", "Todos"], ["libres", "Libres"], ["viaje", "En viaje"], ["taller", "Taller"]]
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
        <h2 className="text-base font-bold">Camiones</h2>
        <span className="rounded-full border bg-muted/40 px-2 text-xs font-bold text-muted-foreground">{libresAca} libre{libresAca === 1 ? "" : "s"} en {nombre(planta)}</span>
        <span className="flex-1" />
        <div className="flex flex-wrap gap-1.5">
          {filtros.map(([k, l]) => (
            <button key={k} onClick={() => setFiltro(k)} className={cn("min-h-[32px] rounded-full border px-2.5 text-[13px] font-semibold", filtro === k ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground")}>{l}</button>
          ))}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-auto p-2.5">
        {hayViajeElegido && puedeDespachar && <div className="rounded-lg bg-blue-100 px-3 py-2 text-sm font-semibold text-blue-900">Tocá el camión que sale. Los de marco verde están libres en {nombre(planta)}.</div>}
        {!lista.length && <div className="py-8 text-center text-sm text-muted-foreground">No hay camiones con ese filtro.</div>}
        {lista.map((c) => {
          const e = c.e
          const libreAca = e.clave === "planta" && e.plantaId === planta
          const enViaje = ["yendo", "obra", "volviendo"].includes(e.clave)
          const fuente = textoFuenteEstado(e)
          return (
            <div
              key={c.id}
              data-camion={c.id}
              onClick={(ev) => { if ((ev.target as HTMLElement).closest("button,[role=menuitem]")) return; onTocar(c.id) }}
              className={cn(
                "relative rounded-lg border border-l-[6px] bg-card px-2.5 py-2",
                BORDE[e.clave],
                puedeDespachar && "cursor-pointer",
                hayViajeElegido && libreAca && "ring-[3px] ring-green-600 hover:bg-green-50",
                hayViajeElegido && (e.clave === "taller" || e.clave === "fuera") && "opacity-55",
                sobre === c.id && "ring-4 ring-blue-600 bg-blue-50",
              )}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-lg font-extrabold tracking-wide">{c.patente}</span>
                <span className={cn("rounded px-2 py-0.5 text-[13px] font-extrabold", ETIQUETA[e.clave])}>{e.etiqueta}</span>
                {e.desde != null && <span className="font-bold tabular-nums">{duracion((ahora - e.desde) / 60000)}</span>}
                <span className="flex-1" />
                {puedeDespachar && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="h-9 w-9 rounded-md text-xl leading-none text-muted-foreground hover:bg-muted" title="Más opciones">⋮</button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[230px]">
                      {e.clave === "taller"
                        ? <DropdownMenuItem className="min-h-[42px]" onClick={() => onDisponible(c.id)}>✅ Disponible (salió del taller)</DropdownMenuItem>
                        : e.clave !== "fuera" && <DropdownMenuItem className="min-h-[42px]" onClick={() => onTaller(c.id)}>🔧 Mandar a taller</DropdownMenuItem>}
                      {c.status === "in_transit" && <DropdownMenuItem className="min-h-[42px]" onClick={() => onVolvio(c.id)}>🏁 Volvió a planta</DropdownMenuItem>}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="min-h-[42px]" onClick={() => window.open("/logistica", "_blank")}>📍 Ver en el mapa</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              {e.probableObra && <div className="text-xs text-muted-foreground">probable obra (la obra no está ubicada)</div>}
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
                {e.clave === "planta" && (
                  e.plantaId === planta ? <span>En {nombre(e.plantaId)}</span> : <span><b>En {nombre(e.plantaId)}</b> (la otra planta)</span>
                )}
                {(e.clave === "taller" || e.clave === "fuera") && <span>{c.notaTaller || "Sin nota"}</span>}
                {enViaje && <span>→ <b>{c.obra || "obra"}</b></span>}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                <span>👤 {c.chofer || <i>chofer: sin asignar hoy</i>}</span>
                {enViaje && e.cicloMin != null && <span>⏱ {duracion(e.cicloMin)} desde la salida</span>}
                {enViaje && e.fuente === "estimado" && e.vueltaEstimada && <span>vuelve ~{hhmm(e.vueltaEstimada)}</span>}
                <span className={cn("rounded border px-1.5 text-[11px] font-bold",
                  e.fuente === "gps" ? "border-green-200 bg-green-50 text-green-800" : e.fuente === "estimado" ? "border-amber-200 bg-amber-50 text-amber-800" : "")}>{fuente}</span>
              </div>
              {puedeDespachar && e.preguntarVolvio && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-amber-100 px-2 py-1.5 text-[13px] font-bold text-amber-900">
                  <span>¿Volvió? Ya debería estar en planta.</span>
                  <button className="min-h-[36px] rounded-lg bg-green-600 px-3 text-sm font-semibold text-white" onClick={() => onVolvio(c.id)}>Volvió a planta</button>
                </div>
              )}
              {puedeDespachar && !e.preguntarVolvio && e.fuente === "estimado" && enViaje && (
                <div className="mt-2 flex items-center gap-2">
                  <button className="min-h-[36px] rounded-lg border px-3 text-sm font-semibold" onClick={() => onVolvio(c.id)}>Volvió a planta</button>
                  {e.llegando && <span className="text-[13px] text-muted-foreground">debería estar llegando</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
