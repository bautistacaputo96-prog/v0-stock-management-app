"use client"

/** Columna Camiones, compacta: dos líneas por camión (patente, estado y tiempo / destino, chofer, ciclo y fuente). */
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { duracion, hhmm, textoFuenteEstado } from "@/lib/despacho"
import { cn } from "@/lib/utils"
import type { CamionT, Planta } from "./tipos"

export type FiltroCamion = "todos" | "libres" | "viaje" | "taller"

const BORDE: Record<string, string> = {
  planta: "border-l-emerald-500", yendo: "border-l-blue-500", obra: "border-l-amber-500", volviendo: "border-l-cyan-500",
  taller: "border-l-slate-600", fuera: "border-l-slate-400",
}
const ETIQUETA: Record<string, string> = {
  planta: "bg-emerald-50 text-emerald-800", yendo: "bg-blue-50 text-blue-800", obra: "bg-amber-50 text-amber-900", volviendo: "bg-cyan-50 text-cyan-800",
  taller: "bg-slate-200 text-slate-800", fuera: "bg-slate-100 text-slate-700",
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
      <div className="flex flex-wrap items-center gap-x-2 border-b px-2.5 py-1">
        <h2 className="text-sm font-semibold">Camiones</h2>
        <span className="text-xs text-muted-foreground">{libresAca} libre{libresAca === 1 ? "" : "s"} en {nombre(planta)}</span>
        <span className="flex-1" />
        <div className="flex">
          {filtros.map(([k, l]) => (
            <button key={k} onClick={() => setFiltro(k)} className={cn("h-7 rounded px-1.5 text-xs", filtro === k ? "font-semibold text-foreground underline underline-offset-4" : "text-muted-foreground")}>{l}</button>
          ))}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-[3px] overflow-auto p-1.5">
        {hayViajeElegido && puedeDespachar && <div className="rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-900">Tocá el camión que sale. Los de marco verde están libres en {nombre(planta)}.</div>}
        {!lista.length && <div className="py-6 text-center text-xs text-muted-foreground">No hay camiones con ese filtro.</div>}
        {lista.map((c) => {
          const e = c.e
          const libreAca = e.clave === "planta" && e.plantaId === planta
          const enViaje = ["yendo", "obra", "volviendo"].includes(e.clave)
          const fuente = textoFuenteEstado(e)
          const donde =
            e.clave === "planta" ? (e.plantaId === planta ? `En ${nombre(e.plantaId)}` : `En ${nombre(e.plantaId)} (la otra planta)`)
            : e.clave === "taller" || e.clave === "fuera" ? c.notaTaller || "Sin nota"
            : `→ ${c.obra || "obra"}`
          return (
            <div
              key={c.id}
              data-camion={c.id}
              onClick={(ev) => { if ((ev.target as HTMLElement).closest("button,[role=menuitem]")) return; onTocar(c.id) }}
              className={cn(
                "d3c-card relative rounded-md border border-l-[3px] bg-card",
                BORDE[e.clave],
                puedeDespachar && "cursor-pointer",
                hayViajeElegido && libreAca && "ring-2 ring-emerald-500",
                hayViajeElegido && (e.clave === "taller" || e.clave === "fuera") && "opacity-50",
                sobre === c.id && "ring-2 ring-blue-500 bg-blue-50",
              )}
            >
              <div className="flex items-center gap-1.5 py-[3px] pl-2 pr-0.5">
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-semibold tracking-wide">{c.patente}</span>
                    <span className={cn("d3c-tag truncate rounded px-1 text-[11px] font-medium leading-4", ETIQUETA[e.clave])}>{e.etiqueta}</span>
                    {e.desde != null && <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">{duracion((ahora - e.desde) / 60000)}</span>}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {donde}
                    {` · ${c.chofer || "chofer: sin asignar hoy"}`}
                    {enViaje && e.cicloMin != null ? ` · ⏱ ${duracion(e.cicloMin)}` : ""}
                    {enViaje && e.fuente === "estimado" && e.vueltaEstimada ? ` · vuelve ~${hhmm(e.vueltaEstimada)}` : ""}
                    {` · ${fuente}`}
                    {e.probableObra ? " (obra sin ubicar)" : ""}
                    {e.llegando ? " · debería estar llegando" : ""}
                  </div>
                </div>
                {puedeDespachar && e.preguntarVolvio && (
                  <button className="h-8 shrink-0 rounded-md border border-amber-400 bg-amber-50 px-2 text-xs font-medium text-amber-900" onClick={() => onVolvio(c.id)} title="Ya debería estar en planta">¿Volvió?</button>
                )}
                {puedeDespachar && !e.preguntarVolvio && e.fuente === "estimado" && enViaje && (
                  <button className="h-8 shrink-0 rounded-md border px-2 text-xs" onClick={() => onVolvio(c.id)} title="Volvió a planta · disponible">Volvió</button>
                )}
                {/* "Ver en el mapa" también en modo consulta; lo demás solo para quien despacha */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="h-8 w-7 shrink-0 rounded text-lg leading-none text-muted-foreground hover:bg-muted" title="Más opciones">⋮</button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[220px]">
                    {puedeDespachar && (
                      <>
                        {e.clave === "taller"
                          ? <DropdownMenuItem className="min-h-[32px]" onClick={() => onDisponible(c.id)}>✅ Disponible (salió del taller)</DropdownMenuItem>
                          : e.clave !== "fuera" && <DropdownMenuItem className="min-h-[32px]" onClick={() => onTaller(c.id)}>🔧 Mandar a taller</DropdownMenuItem>}
                        {c.status === "in_transit" && <DropdownMenuItem className="min-h-[32px]" onClick={() => onVolvio(c.id)}>🏁 Volvió a planta</DropdownMenuItem>}
                        <DropdownMenuSeparator />
                      </>
                    )}
                    {/* Abre Logística › En vivo con el camión centrado y resaltado */}
                    <DropdownMenuItem className="min-h-[32px]" onClick={() => window.open(`/logistica?camion=${encodeURIComponent(c.patente)}`, "_blank")}>📍 Ver en el mapa</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
