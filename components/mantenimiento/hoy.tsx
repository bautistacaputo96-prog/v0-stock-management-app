"use client"

/**
 * Pantalla de inicio del operario: qué hay que hacer hoy.
 * Tarjetas grandes, lo vencido arriba, un botón por tarjeta.
 */

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AlertTriangle, CheckCircle2, Clock, Play, ChevronRight, Camera, Wrench, User } from "lucide-react"
import { differenceInCalendarDays, parseISO, format } from "date-fns"
import { es } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { currentUserName } from "@/lib/current-user"
import { etiquetaFrecuencia, type OrdenTrabajo, type Tarea } from "@/lib/mantenimiento"

type Props = {
  ordenes: OrdenTrabajo[]
  tareas: Tarea[]
  onAbrir: (o: OrdenTrabajo) => void
}

export function VistaHoy({ ordenes, tareas, onAbrir }: Props) {
  const usuario = currentUserName()
  const [filtro, setFiltro] = useState<"mias" | "todas">("todas")
  const tareaDe = (o: OrdenTrabajo) => tareas.find((t) => t.id === o.task_id)

  const abiertas = ordenes.filter((o) => o.estado === "pendiente" || o.estado === "en_curso")
  const visibles = filtro === "mias" ? abiertas.filter((o) => o.asignado_a === usuario) : abiertas

  const peso = (o: OrdenTrabajo) => {
    if (o.prioridad === "urgente") return 0
    if (o.estado === "en_curso") return 1
    const d = differenceInCalendarDays(new Date(), parseISO(o.fecha_programada))
    if (d > 0) return 2
    if (o.prioridad === "alta") return 3
    return 4
  }
  const ordenadas = [...visibles].sort((a, b) => peso(a) - peso(b) || a.fecha_programada.localeCompare(b.fecha_programada))

  const vencidas = abiertas.filter((o) => differenceInCalendarDays(new Date(), parseISO(o.fecha_programada)) > 0).length
  const enCurso = abiertas.filter((o) => o.estado === "en_curso").length
  const completadasHoy = ordenes.filter((o) => o.estado === "completada" && o.fecha_fin && differenceInCalendarDays(new Date(), parseISO(o.fecha_fin)) === 0)

  const mias = abiertas.filter((o) => o.asignado_a === usuario).length

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm text-muted-foreground">{(() => { const s = format(new Date(), "EEEE d 'de' MMMM", { locale: es }); return s.charAt(0).toUpperCase() + s.slice(1) })()}</p>
          <h2 className="text-2xl font-bold tracking-tight">
            {ordenadas.length === 0 ? "Nada pendiente" : `${ordenadas.length} ${ordenadas.length === 1 ? "tarea" : "tareas"} para hacer`}
          </h2>
          <div className="flex gap-3 text-sm mt-1">
            {vencidas > 0 && <span className="text-red-600 font-medium flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />{vencidas} vencida{vencidas > 1 && "s"}</span>}
            {enCurso > 0 && <span className="text-blue-600 font-medium flex items-center gap-1"><Play className="h-3.5 w-3.5" />{enCurso} en curso</span>}
            {completadasHoy.length > 0 && <span className="text-emerald-600 font-medium flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />{completadasHoy.length} hecha{completadasHoy.length > 1 && "s"} hoy</span>}
          </div>
        </div>
        {mias > 0 && mias !== abiertas.length && (
          <div className="flex rounded-lg border p-0.5 text-xs">
            <button onClick={() => setFiltro("mias")} className={cn("px-3 py-1.5 rounded-md", filtro === "mias" && "bg-muted font-medium")}>Mías ({mias})</button>
            <button onClick={() => setFiltro("todas")} className={cn("px-3 py-1.5 rounded-md", filtro === "todas" && "bg-muted font-medium")}>Todas ({abiertas.length})</button>
          </div>
        )}
      </div>

      {/* Tarjetas */}
      {ordenadas.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
          <p className="font-medium">Todo al día</p>
          <p className="text-sm text-muted-foreground mt-1">No hay órdenes pendientes. Fijate en el calendario qué viene.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {ordenadas.map((o) => {
            const t = tareaDe(o)
            const dias = differenceInCalendarDays(new Date(), parseISO(o.fecha_programada))
            const vencida = dias > 0
            const urgente = o.prioridad === "urgente"
            const foto = t?.maint_task_images?.[0]?.url || o.maint_work_order_photos?.[0]?.url
            const pasosTotal = t?.maint_task_steps?.length || 0
            const pasosHechos = pasosTotal ? Object.values(o.pasos || {}).filter(Boolean).length : 0
            return (
              <button
                key={o.id}
                onClick={() => onAbrir(o)}
                className={cn(
                  "text-left rounded-xl border-2 p-3 flex gap-3 items-stretch transition-colors hover:bg-muted/40",
                  urgente ? "border-red-500 bg-red-50/60" : vencida ? "border-red-300 bg-red-50/30" : o.estado === "en_curso" ? "border-blue-300 bg-blue-50/30" : "border-border",
                )}
              >
                <div className="w-20 shrink-0 rounded-lg bg-muted overflow-hidden flex items-center justify-center">
                  {foto ? <img src={foto} alt="" className="h-full w-full object-cover" /> : <Wrench className="h-7 w-7 text-muted-foreground" />}
                </div>
                <div className="flex-1 min-w-0 flex flex-col">
                  <div className="flex items-start gap-2">
                    <p className="font-semibold leading-tight flex-1">{o.titulo}</p>
                    {o.estado === "en_curso" ? (
                      <Badge className="bg-blue-600 shrink-0 text-[10px]"><Play className="h-3 w-3 mr-0.5" />En curso</Badge>
                    ) : urgente ? (
                      <Badge className="bg-red-600 shrink-0 text-[10px]">Urgente</Badge>
                    ) : vencida ? (
                      <Badge className="bg-red-600 shrink-0 text-[10px]">Vencida {dias}d</Badge>
                    ) : (
                      <Badge variant="outline" className="shrink-0 text-[10px]">{t ? etiquetaFrecuencia(t.frecuencia_dias) : "Falla"}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {o.componente}{t?.duracion_min ? ` · ${t.duracion_min} min` : ""}
                    {o.tipo === "correctiva" && <span className="text-amber-700"> · Falla reportada por {o.creado_por}</span>}
                  </p>
                  <div className="mt-auto pt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><User className="h-3 w-3" />{o.asignado_a || "Sin asignar"}</span>
                    <span className="flex items-center gap-2">
                      {pasosTotal > 0 && <span>{pasosHechos}/{pasosTotal} pasos</span>}
                      {(o.maint_work_order_photos?.length || 0) > 0 && <span className="flex items-center gap-0.5"><Camera className="h-3 w-3" />{o.maint_work_order_photos!.length}</span>}
                      <ChevronRight className="h-4 w-4" />
                    </span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Hechas hoy */}
      {completadasHoy.length > 0 && (
        <div className="pt-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Hechas hoy</p>
          <div className="space-y-1.5">
            {completadasHoy.map((o) => (
              <button key={o.id} onClick={() => onAbrir(o)} className="w-full text-left flex items-center gap-3 rounded-lg border px-3 py-2 text-sm hover:bg-muted/40">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span className="flex-1 truncate">{o.titulo}</span>
                <span className="text-xs text-muted-foreground">{o.completado_por} · {o.fecha_fin && format(parseISO(o.fecha_fin), "HH:mm")}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
