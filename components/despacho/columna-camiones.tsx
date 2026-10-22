"use client"

/**
 * Columna Camiones como las "Betoneiras" de Loop (22/10): ícono del mixer con la patente en azul, el punto de estado con
 * el tiempo en ese estado ("03h42"), el chofer y, a la derecha y en chico, dónde está y de dónde sale el estado.
 */
import { useState } from "react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { CircleUser, Truck } from "lucide-react"
import { duracion, textoFuenteEstado } from "@/lib/despacho"
import type { Indicador } from "@/lib/carga/indicador"
import { cn } from "@/lib/utils"
import { Buscador, coincide } from "./buscador"
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
const PUNTO: Record<string, string> = {
  planta: "bg-emerald-500", yendo: "bg-blue-500", obra: "bg-amber-500", volviendo: "bg-cyan-500", taller: "bg-slate-600", fuera: "bg-slate-400",
}
/** "41min", "03h42" (como Loop) */
function tiempoEstado(min: number): string {
  const m = Math.max(0, Math.floor(min))
  if (m < 60) return `${m}min`
  if (m >= 24 * 60) return "24h+"
  return `${String(Math.floor(m / 60)).padStart(2, "0")}h${String(m % 60).padStart(2, "0")}`
}
/** Indicador de la carga de planta (en prueba): chico, con link "Ver carga" (carga-planta.md 19.2) */
const TONO_CARGA: Record<Indicador["tono"], string> = {
  violet: "bg-violet-50 text-violet-800", bad: "bg-red-50 text-red-700", blue: "bg-blue-50 text-blue-800", dark: "bg-slate-800 text-white", warn: "bg-amber-50 text-amber-900",
}

export function ColumnaCamiones({
  camiones, planta, plantas, filtro, setFiltro, ahora, puedeDespachar, hayViajeElegido, sobre,
  onTocar, onVolvio, onTaller, onDisponible, cargas,
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
  /** carga de planta por camión (solo con el interruptor de funciones nuevas y la migración aplicada) */
  cargas?: Record<string, Indicador>
}) {
  const [buscar, setBuscar] = useState("")
  const nombre = (id: string | null) => plantas.find((p) => p.id === id)?.name || "planta"
  const libresAca = camiones.filter((c) => c.e.clave === "planta" && c.e.plantaId === planta).length
  const lista = camiones.filter((c) => {
    if (!coincide(buscar, c.patente, c.chofer, c.e.etiqueta, c.obra)) return false
    if (filtro === "libres") return c.e.clave === "planta"
    if (filtro === "viaje") return ["yendo", "obra", "volviendo"].includes(c.e.clave)
    if (filtro === "taller") return c.e.clave === "taller" || c.e.clave === "fuera"
    return true
  })
  const filtros: [FiltroCamion, string][] = [["todos", "Todos"], ["libres", "Libres"], ["viaje", "En viaje"], ["taller", "Taller"]]
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 border-b px-2.5 py-1">
        <h2 className="text-[12px] font-medium">Camiones</h2>
        <span className="text-xs text-muted-foreground">{libresAca} libre{libresAca === 1 ? "" : "s"} en {nombre(planta)}</span>
        <span className="flex-1" />
        <div className="flex">
          {filtros.map(([k, l]) => (
            <button key={k} onClick={() => setFiltro(k)} className={cn("h-7 rounded px-1.5 text-xs", filtro === k ? "text-foreground underline underline-offset-4" : "text-muted-foreground")}>{l}</button>
          ))}
        </div>
      </div>
      <Buscador valor={buscar} onCambio={setBuscar} />
      <div className="flex flex-1 flex-col gap-1 overflow-auto p-1.5">
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
          // Tarjeta como las "Betoneiras" de Loop: mixer y patente en azul · punto de estado y tiempo · chofer · dónde
          return (
            <div
              key={c.id}
              data-camion={c.id}
              title={`${e.etiqueta} · ${donde} · ${fuente}${e.probableObra ? " (obra sin ubicar)" : ""}${e.llegando ? " · debería estar llegando" : ""}${enViaje && e.cicloMin != null ? ` · ciclo ${duracion(e.cicloMin)}` : ""}`}
              onClick={(ev) => { if ((ev.target as HTMLElement).closest("button,a,[role=menuitem]")) return; onTocar(c.id) }}
              className={cn(
                "d3c-card relative rounded-md border border-l-[3px] border-slate-200 bg-slate-50",
                BORDE[e.clave],
                puedeDespachar && "cursor-pointer",
                hayViajeElegido && libreAca && "ring-2 ring-emerald-500",
                hayViajeElegido && (e.clave === "taller" || e.clave === "fuera") && "opacity-50",
                sobre === c.id && "ring-2 ring-blue-500 bg-blue-50",
              )}
            >
              <div className="flex items-center gap-2 py-1 pl-2 pr-0.5">
                <div className="w-[62px] shrink-0 text-center leading-tight">
                  <Truck className="mx-auto h-5 w-5 text-amber-500" aria-hidden />
                  <div className="truncate text-[11px] font-medium tracking-wide text-blue-700">{c.patente}</div>
                </div>
                <div className="w-[78px] shrink-0 leading-tight">
                  <div className="flex items-center gap-1 text-[11px] tabular-nums">
                    <i className={cn("inline-block h-[7px] w-[7px] shrink-0 rounded-full", PUNTO[e.clave])} />
                    {e.desde != null ? tiempoEstado((ahora - e.desde) / 60000) : "—"}
                  </div>
                  <div className="truncate text-[10.5px] text-slate-500">{e.etiqueta}</div>
                </div>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="flex items-center gap-1 text-[11px]">
                    <CircleUser className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                    <span className="truncate">{c.chofer || "sin chofer hoy"}</span>
                  </div>
                  {e.llegando && <div className="truncate text-[10.5px] text-amber-800">debería estar llegando</div>}
                </div>
                <div className="max-w-[96px] shrink-0 text-right leading-tight">
                  <div className="truncate text-[10.5px] text-slate-500">{donde}</div>
                  <div className="truncate text-[10.5px] text-blue-700">{e.fuente === "gps" ? "GPS" : e.fuente === "a_mano" ? "a mano" : "estimado"}{enViaje && e.cicloMin != null ? ` · ${duracion(e.cicloMin)}` : ""}</div>
                </div>
                {puedeDespachar && e.preguntarVolvio && (
                  <button className="h-6 shrink-0 rounded border border-amber-400 bg-transparent px-2 text-[11px] text-amber-900" onClick={() => onVolvio(c.id)} title="Ya debería estar en planta">¿Volvió?</button>
                )}
                {puedeDespachar && !e.preguntarVolvio && e.fuente === "estimado" && enViaje && (
                  <button className="h-6 shrink-0 rounded border px-2 text-[11px]" onClick={() => onVolvio(c.id)} title="Volvió a planta · disponible">Volvió</button>
                )}
                {puedeDespachar && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="h-6 w-6 shrink-0 rounded text-base leading-none text-muted-foreground hover:bg-muted" title="Más opciones">⋮</button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[220px]">
                      {e.clave === "taller"
                        ? <DropdownMenuItem className="min-h-[32px]" onClick={() => onDisponible(c.id)}>✅ Disponible (salió del taller)</DropdownMenuItem>
                        : e.clave !== "fuera" && <DropdownMenuItem className="min-h-[32px]" onClick={() => onTaller(c.id)}>🔧 Mandar a taller</DropdownMenuItem>}
                      {c.status === "in_transit" && <DropdownMenuItem className="min-h-[32px]" onClick={() => onVolvio(c.id)}>🏁 Volvió a planta</DropdownMenuItem>}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="min-h-[32px]" onClick={() => window.open("/logistica", "_blank")}>📍 Ver en el mapa</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              {cargas?.[c.id] && (
                <div className="flex items-center gap-1.5 border-t border-slate-200 px-2 py-0.5 text-[11px]">
                  <span className={cn("d3c-tag truncate rounded px-1 text-[10.5px] leading-4", TONO_CARGA[cargas[c.id].tono])}>{cargas[c.id].texto}{cargas[c.id].simulada ? " · simulada" : ""}</span>
                  <a href={`/carga?carga=${cargas[c.id].cargaId}`} className="shrink-0 text-[11px] text-blue-800 underline">Ver carga</a>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
