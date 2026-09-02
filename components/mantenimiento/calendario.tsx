"use client"

/**
 * El mes de un vistazo. Muestra las órdenes existentes y proyecta las
 * próximas ocurrencias de cada tarea del plan según su frecuencia.
 */

import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ChevronLeft, ChevronRight, CheckCircle2, AlertTriangle, Play } from "lucide-react"
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, addMonths, subMonths,
  isSameMonth, isSameDay, isToday, format, parseISO, addDays, startOfDay, isBefore, isAfter,
} from "date-fns"
import { es } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { proximoVencimiento, etiquetaFrecuencia, type OrdenTrabajo, type Tarea, type Ejecucion } from "@/lib/mantenimiento"

type Evento = {
  key: string
  fecha: Date
  titulo: string
  componente: string | null
  tipo: "vencida" | "hoy" | "programada" | "completada" | "en_curso" | "falla"
  orden?: OrdenTrabajo
  tarea?: Tarea
}

type Props = {
  ordenes: OrdenTrabajo[]
  tareas: Tarea[]
  ultimaPorTarea: Record<string, Ejecucion>
  m3Actual: number
  onAbrir: (o: OrdenTrabajo) => void
}

export function VistaCalendario({ ordenes, tareas, ultimaPorTarea, m3Actual, onAbrir }: Props) {
  const [mes, setMes] = useState(startOfMonth(new Date()))
  const [diaSel, setDiaSel] = useState<Date>(startOfDay(new Date()))

  const eventos = useMemo(() => {
    const hoy = startOfDay(new Date())
    const desde = startOfWeek(startOfMonth(mes), { weekStartsOn: 1 })
    const hasta = endOfWeek(endOfMonth(mes), { weekStartsOn: 1 })
    const lista: Evento[] = []

    // 1. Órdenes reales (abiertas y cerradas) dentro del rango
    for (const o of ordenes) {
      const f = o.estado === "completada" && o.fecha_fin ? startOfDay(parseISO(o.fecha_fin)) : startOfDay(parseISO(o.fecha_programada))
      if (isBefore(f, desde) || isAfter(f, hasta)) continue
      if (o.estado === "cancelada") continue
      const tipo: Evento["tipo"] =
        o.estado === "completada" ? "completada"
        : o.estado === "en_curso" ? "en_curso"
        : o.tipo === "correctiva" ? "falla"
        : isBefore(f, hoy) ? "vencida"
        : isSameDay(f, hoy) ? "hoy" : "programada"
      lista.push({ key: `o-${o.id}`, fecha: f, titulo: o.titulo, componente: o.componente, tipo, orden: o, tarea: tareas.find((t) => t.id === o.task_id) })
    }

    // 2. Proyección futura de cada tarea del plan (no crea nada, solo muestra)
    const conOrdenAbierta = new Set(ordenes.filter((o) => o.estado === "pendiente" || o.estado === "en_curso").map((o) => o.task_id))
    for (const t of tareas) {
      // Las diarias son rutina del plantista: proyectarlas taparía todo el mes
      if (!t.frecuencia_dias || t.frecuencia_dias <= 1) continue
      let { fecha } = proximoVencimiento(t, ultimaPorTarea[t.id], m3Actual)
      // Si ya tiene orden abierta, la próxima proyección arranca después de esa
      if (conOrdenAbierta.has(t.id)) fecha = addDays(fecha, t.frecuencia_dias)
      // Nunca proyectar al pasado
      if (isBefore(fecha, hoy)) fecha = addDays(hoy, 1)
      let n = 0
      while (!isAfter(fecha, hasta) && n < 40) {
        if (!isBefore(fecha, desde) && isAfter(fecha, hoy)) {
          lista.push({ key: `p-${t.id}-${n}`, fecha, titulo: t.titulo, componente: t.componente, tipo: "programada", tarea: t })
        }
        fecha = addDays(fecha, t.frecuencia_dias)
        n++
      }
    }
    return lista
  }, [ordenes, tareas, ultimaPorTarea, m3Actual, mes])

  const dias = eachDayOfInterval({ start: startOfWeek(startOfMonth(mes), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(mes), { weekStartsOn: 1 }) })
  const eventosDe = (d: Date) => eventos.filter((e) => isSameDay(e.fecha, d))
  const delDia = eventosDe(diaSel)

  const color: Record<Evento["tipo"], string> = {
    vencida: "bg-red-100 text-red-800 border-red-200",
    hoy: "bg-amber-100 text-amber-800 border-amber-200",
    en_curso: "bg-blue-100 text-blue-800 border-blue-200",
    falla: "bg-amber-100 text-amber-900 border-amber-300",
    programada: "bg-emerald-50 text-emerald-800 border-emerald-200",
    completada: "bg-muted text-muted-foreground border-transparent line-through",
  }

  // Resumen del mes: cuántas cosas grandes vienen
  const grandes = eventos.filter((e) => e.tipo === "programada" && e.tarea && (e.tarea.frecuencia_dias || 0) >= 30 && isSameMonth(e.fecha, mes))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold capitalize">{format(mes, "MMMM yyyy", { locale: es })}</h2>
        <div className="flex gap-1">
          <Button variant="outline" size="icon" onClick={() => setMes(subMonths(mes, 1))}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => { setMes(startOfMonth(new Date())); setDiaSel(startOfDay(new Date())) }}>Hoy</Button>
          <Button variant="outline" size="icon" onClick={() => setMes(addMonths(mes, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-red-400" />Vencida</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400" />Hoy / falla</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-blue-400" />En curso</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" />Programada</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-muted-foreground/40" />Hecha</span>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        {/* Grilla */}
        <div className="rounded-xl border overflow-hidden">
          <div className="grid grid-cols-7 bg-muted/50 text-center text-xs font-medium text-muted-foreground py-1.5">
            {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => <div key={d}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {dias.map((d) => {
              const evs = eventosDe(d)
              const fuera = !isSameMonth(d, mes)
              const sel = isSameDay(d, diaSel)
              const vis = evs.slice(0, 2)
              return (
                <button
                  key={d.toISOString()}
                  onClick={() => setDiaSel(d)}
                  className={cn(
                    "min-h-[76px] border-t border-r p-1 text-left align-top hover:bg-muted/30 transition-colors",
                    fuera && "bg-muted/20 text-muted-foreground",
                    sel && "ring-2 ring-inset ring-primary",
                  )}
                >
                  <span className={cn("text-xs font-medium inline-flex h-5 w-5 items-center justify-center rounded-full", isToday(d) && "bg-primary text-primary-foreground")}>{format(d, "d")}</span>
                  <div className="space-y-0.5 mt-0.5">
                    {vis.map((e) => (
                      <div key={e.key} className={cn("text-[10px] leading-tight rounded border px-1 py-0.5 truncate", color[e.tipo])}>{e.titulo.replace("PARADA ANUAL — ", "")}</div>
                    ))}
                    {evs.length > 2 && <div className="text-[10px] text-muted-foreground px-1">+{evs.length - 2} más</div>}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Detalle del día */}
        <div className="space-y-3">
          <div className="rounded-xl border p-3">
            <p className="font-semibold">{(() => { const s = format(diaSel, "EEEE d 'de' MMMM", { locale: es }); return s.charAt(0).toUpperCase() + s.slice(1) })()}</p>
            {delDia.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-2">Sin tareas este día.</p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {delDia.map((e) => (
                  <button
                    key={e.key}
                    disabled={!e.orden}
                    onClick={() => e.orden && onAbrir(e.orden)}
                    className={cn("w-full text-left rounded-lg border p-2 text-sm", e.orden && "hover:bg-muted/40", color[e.tipo].split(" ").filter((c) => c.startsWith("border")).join(" "))}
                  >
                    <div className="flex items-center gap-1.5">
                      {e.tipo === "completada" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                      {e.tipo === "vencida" && <AlertTriangle className="h-3.5 w-3.5 text-red-600" />}
                      {e.tipo === "en_curso" && <Play className="h-3.5 w-3.5 text-blue-600" />}
                      <span className={cn("font-medium flex-1", e.tipo === "completada" && "line-through text-muted-foreground")}>{e.titulo.replace("PARADA ANUAL — ", "")}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {e.componente}{e.tarea && ` · ${etiquetaFrecuencia(e.tarea.frecuencia_dias)}`}
                      {e.orden?.asignado_a && ` · ${e.orden.asignado_a}`}
                      {!e.orden && " · proyectada"}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {grandes.length > 0 && (
            <div className="rounded-xl border p-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Trabajos grandes este mes</p>
              <div className="space-y-1">
                {grandes.map((e) => (
                  <div key={e.key} className="flex items-center justify-between text-sm">
                    <span className="truncate">{e.titulo.replace("PARADA ANUAL — ", "")}</span>
                    <Badge variant="outline" className="text-[10px] ml-2 shrink-0">{format(e.fecha, "d/M")}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
