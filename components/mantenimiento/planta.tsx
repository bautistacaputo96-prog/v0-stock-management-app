"use client"

/**
 * La planta desglosada por componentes. Es la parte didáctica: un operario
 * nuevo ve qué partes tiene la Indumóvil y qué hay que hacerle a cada una.
 */

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { ArrowLeftRight, Cog, Wind, Warehouse, Scale, Droplets, FlaskConical, Zap, Settings2, AlertTriangle, CheckCircle2, Package, Clock, History } from "lucide-react"
import { format, parseISO } from "date-fns"
import { cn } from "@/lib/utils"
import { COMPONENTES, proximoVencimiento, nivelDeFecha, textoVencimiento, etiquetaFrecuencia, type Tarea, type Ejecucion, type OrdenTrabajo } from "@/lib/mantenimiento"

const ICONOS: Record<string, any> = {
  conveyor: ArrowLeftRight, screw: Settings2, gear: Cog, air: Wind, hopper: Warehouse,
  scale: Scale, water: Droplets, flask: FlaskConical, bolt: Zap,
}

type Props = {
  tareas: Tarea[]
  ultimaPorTarea: Record<string, Ejecucion>
  m3Actual: number
  ordenes: OrdenTrabajo[]
  onAbrir: (o: OrdenTrabajo) => void
}

export function VistaPlanta({ tareas, ultimaPorTarea, m3Actual, ordenes, onAbrir }: Props) {
  const [sel, setSel] = useState<string | null>(null)
  const [fotoAmpliada, setFotoAmpliada] = useState<string | null>(null)

  const porComponente = Object.keys(COMPONENTES).map((nombre) => {
    const ts = tareas.filter((t) => t.componente === nombre)
    const estados = ts.map((t) => nivelDeFecha(proximoVencimiento(t, ultimaPorTarea[t.id], m3Actual).fecha))
    const vencidas = estados.filter((e) => e === "vencida" || e === "hoy").length
    const repuestos = new Set(ts.flatMap((t) => t.maint_task_items.map((i) => i.item))).size
    const fallas = ordenes.filter((o) => o.componente === nombre && o.tipo === "correctiva" && (o.estado === "pendiente" || o.estado === "en_curso")).length
    const fotos = ts.flatMap((t) => t.maint_task_images)
    return { nombre, ...COMPONENTES[nombre], tareas: ts, vencidas, repuestos, fallas, foto: fotos[0]?.url }
  }).filter((c) => c.tareas.length > 0 || c.fallas > 0)

  const comp = porComponente.find((c) => c.nombre === sel)
  const historialComp = sel ? ordenes.filter((o) => o.componente === sel && o.estado === "completada").sort((a, b) => (b.fecha_fin || "").localeCompare(a.fecha_fin || "")).slice(0, 8) : []

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Planta dosificadora Indumóvil 80</h2>
        <p className="text-sm text-muted-foreground">Tocá un componente para ver qué hay que hacerle, qué repuestos lleva y su historial.</p>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
        {porComponente.map((c) => {
          const Icono = ICONOS[c.icono] || Cog
          const alerta = c.vencidas > 0 || c.fallas > 0
          return (
            <button
              key={c.nombre}
              onClick={() => setSel(c.nombre)}
              className={cn("text-left rounded-xl border-2 p-3 hover:bg-muted/40 transition-colors flex flex-col", alerta ? "border-red-300 bg-red-50/30" : "border-border")}
            >
              <div className="flex items-start justify-between">
                <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center", alerta ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground")}>
                  <Icono className="h-5 w-5" />
                </div>
                {c.fallas > 0 && <Badge className="bg-amber-500 text-[10px]"><AlertTriangle className="h-3 w-3 mr-0.5" />{c.fallas} falla{c.fallas > 1 && "s"}</Badge>}
                {c.fallas === 0 && c.vencidas > 0 && <Badge className="bg-red-600 text-[10px]">{c.vencidas} vencida{c.vencidas > 1 && "s"}</Badge>}
                {!alerta && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
              </div>
              <p className="font-semibold mt-2 leading-tight">{c.nombre}</p>
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{c.descripcion}</p>
              <p className="text-xs text-muted-foreground mt-2 pt-2 border-t">
                {c.tareas.length} tarea{c.tareas.length !== 1 && "s"}{c.repuestos > 0 && ` · ${c.repuestos} repuesto${c.repuestos !== 1 && "s"}`}
              </p>
            </button>
          )
        })}
      </div>

      {/* Detalle del componente */}
      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          {comp && (
            <>
              <DialogHeader>
                <DialogTitle>{comp.nombre}</DialogTitle>
                <DialogDescription>{comp.descripcion}</DialogDescription>
              </DialogHeader>

              {/* Fotos del manual del componente */}
              {(() => {
                const fotos = comp.tareas.flatMap((t) => t.maint_task_images)
                const unicas = fotos.filter((f, i, a) => a.findIndex((x) => x.url === f.url) === i)
                return unicas.length > 0 ? (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {unicas.map((f) => (
                      <button key={f.id} onClick={() => setFotoAmpliada(f.url)} className="shrink-0">
                        <img src={f.url} alt="" className="h-24 w-auto rounded border object-cover" />
                      </button>
                    ))}
                  </div>
                ) : null
              })()}

              {/* Fallas abiertas */}
              {comp.fallas > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                  <p className="text-xs font-semibold text-amber-900 mb-1.5 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Fallas reportadas</p>
                  {ordenes.filter((o) => o.componente === comp.nombre && o.tipo === "correctiva" && (o.estado === "pendiente" || o.estado === "en_curso")).map((o) => (
                    <button key={o.id} onClick={() => { setSel(null); onAbrir(o) }} className="block w-full text-left text-sm py-1 hover:underline">
                      OT-{String(o.numero).padStart(4, "0")} · {o.titulo} <span className="text-xs text-muted-foreground">· {o.creado_por}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Tareas del plan */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Qué hay que hacerle</p>
                <div className="rounded-lg border divide-y">
                  {[...comp.tareas].sort((a, b) => (a.frecuencia_dias || 0) - (b.frecuencia_dias || 0)).map((t) => {
                    const v = proximoVencimiento(t, ultimaPorTarea[t.id], m3Actual)
                    const n = nivelDeFecha(v.fecha)
                    const u = ultimaPorTarea[t.id]
                    return (
                      <div key={t.id} className="p-2.5 flex items-center gap-3 text-sm">
                        <Badge variant="outline" className="text-[10px] w-20 justify-center shrink-0">{etiquetaFrecuencia(t.frecuencia_dias)}</Badge>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{t.titulo.replace("PARADA ANUAL — ", "")}</p>
                          <p className="text-xs text-muted-foreground">{u ? `Última: ${format(parseISO(u.fecha), "d/M/yy")}${u.realizado_por ? ` · ${u.realizado_por}` : ""}` : "Nunca registrada"}{t.asignado_default && ` · ${t.asignado_default}`}</p>
                        </div>
                        <span className={cn("text-xs whitespace-nowrap", n === "vencida" || n === "hoy" ? "text-red-600 font-medium" : n === "proxima" ? "text-amber-600" : "text-muted-foreground")}>
                          {textoVencimiento(v.fecha, v.porM3, v.restanM3)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Repuestos e insumos */}
              {comp.repuestos > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1"><Package className="h-3.5 w-3.5" /> Repuestos e insumos que lleva</p>
                  <div className="grid sm:grid-cols-2 gap-1.5 text-sm">
                    {Array.from(new Map(comp.tareas.flatMap((t) => t.maint_task_items).map((i) => [i.item, i])).values()).map((i) => (
                      <div key={i.item} className="flex justify-between bg-muted/50 rounded px-2 py-1.5 text-xs">
                        <span className="truncate">{i.item}</span>
                        <span className="text-muted-foreground ml-2 whitespace-nowrap">{i.codigo_repuesto || (i.tipo === "insumo" ? "insumo" : "")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Historial */}
              {historialComp.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1"><History className="h-3.5 w-3.5" /> Últimos trabajos</p>
                  <div className="space-y-1">
                    {historialComp.map((o) => (
                      <button key={o.id} onClick={() => { setSel(null); onAbrir(o) }} className="w-full text-left flex items-center gap-2 text-sm py-1 hover:underline">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                        <span className="flex-1 truncate">{o.titulo.replace("PARADA ANUAL — ", "")}</span>
                        <span className="text-xs text-muted-foreground">{o.fecha_fin && format(parseISO(o.fecha_fin), "d/M/yy")} · {o.completado_por}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!fotoAmpliada} onOpenChange={(o) => !o && setFotoAmpliada(null)}>
        <DialogContent className="max-w-3xl p-2">
          <DialogHeader className="sr-only"><DialogTitle>Foto</DialogTitle></DialogHeader>
          {fotoAmpliada && <img src={fotoAmpliada} alt="" className="w-full h-auto rounded" />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
