"use client"

/**
 * Módulo de mantenimiento. Cuatro pantallas sobre el mismo juego de datos:
 *  Hoy        → lo que el operario tiene que hacer (órdenes abiertas)
 *  Calendario → el mes, para planificar
 *  Planta     → la Indumóvil por componentes (didáctico)
 *  Historial  → todo lo hecho, con fotos y comentarios
 * Más "Reportar falla", que crea una orden correctiva.
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AlertTriangle, ListChecks, CalendarDays, Factory, History, Loader2 } from "lucide-react"
import { cargarDatosEquipo, sincronizarOrdenes, type OrdenTrabajo, type Tarea, type Ejecucion } from "@/lib/mantenimiento"
import { VistaHoy } from "@/components/mantenimiento/hoy"
import { VistaCalendario } from "@/components/mantenimiento/calendario"
import { VistaPlanta } from "@/components/mantenimiento/planta"
import { VistaHistorial } from "@/components/mantenimiento/historial"
import { OrdenTrabajoDialog } from "@/components/mantenimiento/orden-trabajo-dialog"
import { ReportarFallaDialog } from "@/components/mantenimiento/reportar-falla-dialog"

type Equipo = { id: string; nombre: string; modelo: string | null; fabricante: string | null; plant_id: string; plants?: { name: string } }

const TABS = [
  { v: "hoy", l: "Hoy", I: ListChecks },
  { v: "calendario", l: "Calendario", I: CalendarDays },
  { v: "planta", l: "Planta", I: Factory },
  { v: "historial", l: "Historial", I: History },
]

export function MantenimientoContent({ equipos }: { equipos: Equipo[] }) {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const tab = params.get("tab") || "hoy"

  const [equipoId] = useState(equipos[0]?.id || "")
  const equipo = equipos.find((e) => e.id === equipoId)

  const [tareas, setTareas] = useState<Tarea[]>([])
  const [ultimaPorTarea, setUltima] = useState<Record<string, Ejecucion>>({})
  const [m3Actual, setM3] = useState(0)
  const [ordenes, setOrdenes] = useState<OrdenTrabajo[]>([])
  const [loading, setLoading] = useState(true)
  const [ordenAbierta, setOrdenAbierta] = useState<OrdenTrabajo | null>(null)
  const [reportar, setReportar] = useState(false)

  const cargar = useCallback(async (sincronizar = false) => {
    if (!equipo) return
    const supabase = createClient()
    let d = await cargarDatosEquipo(supabase, equipo.id, equipo.plant_id)
    if (sincronizar) {
      const creadas = await sincronizarOrdenes(supabase, equipo.id, d.tareas, d.ultimaPorTarea, d.m3Actual, d.ordenes)
      if (creadas > 0) d = await cargarDatosEquipo(supabase, equipo.id, equipo.plant_id)
    }
    setTareas(d.tareas); setUltima(d.ultimaPorTarea); setM3(d.m3Actual); setOrdenes(d.ordenes)
    // Si hay una orden abierta en el diálogo, refrescarla con los datos nuevos
    setOrdenAbierta((prev) => (prev ? d.ordenes.find((o) => o.id === prev.id) || null : null))
    setLoading(false)
  }, [equipo])

  // Sincronizar una sola vez por carga de página (React en desarrollo monta dos veces)
  const sincronizado = useRef(false)
  useEffect(() => {
    const primera = !sincronizado.current
    sincronizado.current = true
    cargar(primera)
  }, [cargar])

  const abiertas = ordenes.filter((o) => o.estado === "pendiente" || o.estado === "en_curso").length

  function irA(t: string) {
    router.replace(`${pathname}?tab=${t}`, { scroll: false })
  }

  if (!equipo) return <p className="text-sm text-muted-foreground">No hay equipos cargados.</p>

  return (
    <div className="space-y-4">
      {/* Barra superior */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Tabs value={tab} onValueChange={irA}>
          <TabsList className="h-10">
            {TABS.map(({ v, l, I }) => (
              <TabsTrigger key={v} value={v} className="gap-1.5 px-3">
                <I className="h-4 w-4" />
                <span className="hidden sm:inline">{l}</span>
                {v === "hoy" && abiertas > 0 && <span className="ml-0.5 rounded-full bg-red-600 text-white text-[10px] px-1.5 leading-4">{abiertas}</span>}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button variant="outline" className="border-amber-400 text-amber-800 hover:bg-amber-50" onClick={() => setReportar(true)}>
          <AlertTriangle className="h-4 w-4 mr-2" /> Reportar falla
        </Button>
      </div>

      <p className="text-xs text-muted-foreground -mt-2">
        {equipo.nombre} · {equipo.plants?.name} · {m3Actual.toLocaleString("es-AR", { maximumFractionDigits: 0 })} m³ acumulados
      </p>

      {loading ? (
        <div className="py-16 text-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />Cargando...</div>
      ) : tab === "calendario" ? (
        <VistaCalendario ordenes={ordenes} tareas={tareas} ultimaPorTarea={ultimaPorTarea} m3Actual={m3Actual} onAbrir={setOrdenAbierta} />
      ) : tab === "planta" ? (
        <VistaPlanta tareas={tareas} ultimaPorTarea={ultimaPorTarea} m3Actual={m3Actual} ordenes={ordenes} onAbrir={setOrdenAbierta} />
      ) : tab === "historial" ? (
        <VistaHistorial ordenes={ordenes} onAbrir={setOrdenAbierta} />
      ) : (
        <VistaHoy ordenes={ordenes} tareas={tareas} onAbrir={setOrdenAbierta} />
      )}

      <OrdenTrabajoDialog
        orden={ordenAbierta}
        tarea={ordenAbierta ? tareas.find((t) => t.id === ordenAbierta.task_id) || null : null}
        m3Actual={m3Actual}
        onClose={() => setOrdenAbierta(null)}
        onCambio={() => cargar(false)}
      />
      <ReportarFallaDialog open={reportar} equipmentId={equipo.id} onClose={() => setReportar(false)} onCreada={() => cargar(false)} />
    </div>
  )
}
