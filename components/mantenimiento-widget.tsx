"use client"

/**
 * Resumen de mantenimiento para el dashboard: qué hay que ir programando y
 * qué insumos van a hacer falta. Todo lleva al módulo de Mantenimiento.
 */

import { useState, useEffect } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, Clock, Wrench, Package, ChevronRight, CheckCircle2 } from "lucide-react"
import { differenceInCalendarDays, parseISO } from "date-fns"
import { cn } from "@/lib/utils"

type Pendiente = {
  id: string
  titulo: string
  componente: string | null
  nivel: "vencida" | "proxima" | "pendiente"
  texto: string
  items: { item: string; cantidad: number | null; unidad: string | null }[]
}

/** Horizonte de aviso: lo que vence dentro de los próximos 30 días. */
const DIAS_AVISO = 30

export function MantenimientoWidget({ plantId }: { plantId?: string }) {
  const [pendientes, setPendientes] = useState<Pendiente[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantId])

  async function cargar() {
    setLoading(true)
    const supabase = createClient()

    let eqQuery = supabase.from("maint_equipment").select("id, plant_id").eq("activo", true)
    if (plantId && plantId !== "all") eqQuery = eqQuery.eq("plant_id", plantId)
    const { data: equipos } = await eqQuery
    if (!equipos?.length) {
      setPendientes([])
      setLoading(false)
      return
    }

    const [{ data: tareas }, { data: ejec }, { data: desp }] = await Promise.all([
      supabase
        .from("maint_tasks")
        .select("id, titulo, componente, frecuencia_dias, frecuencia_m3, maint_task_items(item, cantidad, unidad)")
        .in("equipment_id", equipos.map((e) => e.id))
        .eq("activo", true),
      supabase.from("maint_executions").select("task_id, fecha, m3_acumulado").order("fecha", { ascending: false }),
      supabase.from("dispatches").select("quantity_m3").eq("plant_id", equipos[0].plant_id).limit(20000),
    ])

    const m3Actual = (desp || []).reduce((s: number, d: any) => s + Number(d.quantity_m3 || 0), 0)
    const ultima: Record<string, any> = {}
    ;(ejec || []).forEach((e: any) => {
      if (!ultima[e.task_id]) ultima[e.task_id] = e
    })

    const lista: Pendiente[] = []
    for (const t of tareas || []) {
      const u = ultima[t.id]
      const items = (t as any).maint_task_items || []

      if (!u) {
        lista.push({ id: t.id, titulo: t.titulo, componente: t.componente, nivel: "pendiente", texto: "Sin registro", items })
        continue
      }

      const restanDias = t.frecuencia_dias ? t.frecuencia_dias - differenceInCalendarDays(new Date(), parseISO(u.fecha)) : null
      const restanM3 = t.frecuencia_m3 && u.m3_acumulado != null
        ? t.frecuencia_m3 - (m3Actual - Number(u.m3_acumulado))
        : null

      if ((restanDias !== null && restanDias < 0) || (restanM3 !== null && restanM3 < 0)) {
        lista.push({
          id: t.id, titulo: t.titulo, componente: t.componente, nivel: "vencida",
          texto: restanM3 !== null && restanM3 < 0 ? `Vencida por ${Math.abs(Math.round(restanM3))} m³` : `Vencida hace ${Math.abs(restanDias || 0)} d`,
          items,
        })
      } else if (
        (restanDias !== null && restanDias <= DIAS_AVISO) ||
        (restanM3 !== null && restanM3 <= (t.frecuencia_m3 || 0) * 0.15)
      ) {
        lista.push({
          id: t.id, titulo: t.titulo, componente: t.componente, nivel: "proxima",
          texto: restanM3 !== null && restanM3 <= (t.frecuencia_m3 || 0) * 0.15 ? `En ${Math.round(restanM3)} m³` : `En ${restanDias} días`,
          items,
        })
      }
    }

    const peso = { vencida: 0, pendiente: 1, proxima: 2 }
    lista.sort((a, b) => peso[a.nivel] - peso[b.nivel])
    setPendientes(lista)
    setLoading(false)
  }

  // Insumos consolidados de todo lo que hay que hacer
  const insumos = new Map<string, { cantidad: number; unidad: string | null }>()
  pendientes.forEach((p) =>
    p.items.forEach((i) => {
      const k = i.item
      const prev = insumos.get(k)
      insumos.set(k, { cantidad: (prev?.cantidad || 0) + Number(i.cantidad || 0), unidad: i.unidad })
    }),
  )

  const vencidas = pendientes.filter((p) => p.nivel === "vencida" || p.nivel === "pendiente").length
  const proximas = pendientes.filter((p) => p.nivel === "proxima").length

  if (loading) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Wrench className="h-4 w-4" />
            Mantenimiento a programar
          </CardTitle>
          <Link
            href="/mantenimiento?tab=hoy"
            className="text-xs text-primary hover:underline flex items-center gap-0.5"
          >
            Ver plan completo <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {pendientes.length === 0 ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2 py-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            Todo al día: no hay tareas próximas a vencer.
          </p>
        ) : (
          <>
            <div className="flex gap-4 text-sm">
              {vencidas > 0 && (
                <span className="flex items-center gap-1.5 text-red-600 font-medium">
                  <AlertTriangle className="h-4 w-4" /> {vencidas} vencida{vencidas !== 1 && "s"}
                </span>
              )}
              {proximas > 0 && (
                <span className="flex items-center gap-1.5 text-amber-600 font-medium">
                  <Clock className="h-4 w-4" /> {proximas} próxima{proximas !== 1 && "s"}
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              {pendientes.slice(0, 6).map((p) => (
                <Link
                  key={p.id}
                  href="/mantenimiento?tab=hoy"
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 hover:bg-muted/50 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{p.titulo}</p>
                    {p.componente && <p className="text-xs text-muted-foreground">{p.componente}</p>}
                  </div>
                  <Badge
                    className={cn(
                      "text-[11px] whitespace-nowrap shrink-0",
                      p.nivel === "vencida" && "bg-red-600",
                      p.nivel === "pendiente" && "bg-slate-500",
                      p.nivel === "proxima" && "bg-amber-500",
                    )}
                  >
                    {p.texto}
                  </Badge>
                </Link>
              ))}
              {pendientes.length > 6 && (
                <Link href="/mantenimiento?tab=hoy" className="block text-xs text-primary hover:underline pt-1">
                  Ver las {pendientes.length - 6} restantes
                </Link>
              )}
            </div>

            {insumos.size > 0 && (
              <div className="pt-3 border-t">
                <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5" />
                  Insumos y repuestos que vas a necesitar
                </p>
                <div className="space-y-1">
                  {[...insumos.entries()].map(([item, d]) => (
                    <div key={item} className="flex items-center justify-between text-xs bg-muted/50 rounded px-2 py-1.5">
                      <span className="truncate mr-3">{item}</span>
                      <span className="font-mono font-medium whitespace-nowrap">
                        {d.cantidad.toLocaleString("es-AR", { maximumFractionDigits: 2 })} {d.unidad}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
