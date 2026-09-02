"use client"

/** Todo lo que se hizo: quién, cuándo, con fotos y comentarios. */

import { useState, useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { CheckCircle2, XCircle, Camera, Search, AlertTriangle, MessageSquare } from "lucide-react"
import { format, parseISO, differenceInCalendarDays, startOfMonth } from "date-fns"
import { es } from "date-fns/locale"
import { cn } from "@/lib/utils"
import type { OrdenTrabajo } from "@/lib/mantenimiento"

type Props = { ordenes: OrdenTrabajo[]; onAbrir: (o: OrdenTrabajo) => void }

export function VistaHistorial({ ordenes, onAbrir }: Props) {
  const [q, setQ] = useState("")
  const [tipo, setTipo] = useState<"todas" | "preventiva" | "correctiva">("todas")

  const cerradas = useMemo(
    () => ordenes
      .filter((o) => o.estado === "completada" || o.estado === "cancelada")
      .filter((o) => tipo === "todas" || o.tipo === tipo)
      .filter((o) => !q || o.titulo.toLowerCase().includes(q.toLowerCase()) || (o.componente || "").toLowerCase().includes(q.toLowerCase()) || (o.completado_por || "").toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => (b.fecha_fin || b.created_at).localeCompare(a.fecha_fin || a.created_at)),
    [ordenes, q, tipo],
  )

  // Cumplimiento del mes: completadas a tiempo / completadas
  const mes = startOfMonth(new Date())
  const delMes = ordenes.filter((o) => o.estado === "completada" && o.fecha_fin && parseISO(o.fecha_fin) >= mes && o.tipo === "preventiva")
  const aTiempo = delMes.filter((o) => o.fecha_fin && differenceInCalendarDays(parseISO(o.fecha_fin), parseISO(o.fecha_programada)) <= 1).length
  const cumplimiento = delMes.length ? Math.round((aTiempo / delMes.length) * 100) : null
  const fallasMes = ordenes.filter((o) => o.tipo === "correctiva" && parseISO(o.created_at) >= mes).length

  // Agrupar por día
  const grupos: { dia: string; items: OrdenTrabajo[] }[] = []
  for (const o of cerradas) {
    const dia = format(parseISO(o.fecha_fin || o.created_at), "yyyy-MM-dd")
    const g = grupos.find((x) => x.dia === dia)
    if (g) g.items.push(o); else grupos.push({ dia, items: [o] })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">Preventivas este mes</p>
          <p className="text-2xl font-bold">{delMes.length}</p>
        </div>
        <div className="rounded-xl bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">Hechas a tiempo</p>
          <p className={cn("text-2xl font-bold", cumplimiento !== null && (cumplimiento >= 80 ? "text-emerald-600" : cumplimiento >= 50 ? "text-amber-600" : "text-red-600"))}>{cumplimiento === null ? "—" : `${cumplimiento}%`}</p>
        </div>
        <div className="rounded-xl bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">Fallas este mes</p>
          <p className={cn("text-2xl font-bold", fallasMes > 0 && "text-amber-600")}>{fallasMes}</p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por tarea, componente o persona" className="pl-8" />
        </div>
        <div className="flex rounded-lg border p-0.5 text-xs">
          {(["todas", "preventiva", "correctiva"] as const).map((t) => (
            <button key={t} onClick={() => setTipo(t)} className={cn("px-3 py-1.5 rounded-md capitalize", tipo === t && "bg-muted font-medium")}>{t === "correctiva" ? "Fallas" : t}</button>
          ))}
        </div>
      </div>

      {grupos.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Todavía no hay trabajos registrados.</p>
      ) : (
        grupos.map((g) => (
          <div key={g.dia}>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 capitalize">{format(parseISO(g.dia), "EEEE d 'de' MMMM", { locale: es })}</p>
            <div className="rounded-xl border divide-y">
              {g.items.map((o) => (
                <button key={o.id} onClick={() => onAbrir(o)} className="w-full text-left p-3 flex items-start gap-3 hover:bg-muted/40 text-sm">
                  {o.estado === "completada" ? <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" /> : <XCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn("font-medium", o.estado === "cancelada" && "line-through text-muted-foreground")}>{o.titulo.replace("PARADA ANUAL — ", "")}</span>
                      {o.tipo === "correctiva" && <Badge variant="outline" className="border-amber-400 text-amber-700 text-[10px]"><AlertTriangle className="h-3 w-3 mr-0.5" />Falla</Badge>}
                      {o.estado === "cancelada" && <Badge variant="outline" className="text-[10px]">Cancelada</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {o.componente} · {o.completado_por || o.asignado_a}{o.fecha_fin && ` · ${format(parseISO(o.fecha_fin), "HH:mm")}`}
                    </p>
                    {o.observaciones && <p className="text-xs mt-1 flex items-start gap-1"><MessageSquare className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" /><span className="italic">{o.observaciones}</span></p>}
                  </div>
                  {(o.maint_work_order_photos?.length || 0) > 0 && (
                    <div className="flex items-center gap-1 shrink-0">
                      <img src={o.maint_work_order_photos![0].url} alt="" className="h-10 w-10 rounded object-cover border" />
                      {o.maint_work_order_photos!.length > 1 && <span className="text-xs text-muted-foreground">+{o.maint_work_order_photos!.length - 1}</span>}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
