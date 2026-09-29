"use client"

/** Programación: el calendario semanal de siempre y la vista del día que ordena los camiones. */
import { useState, useEffect } from "react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CalendarDays, CalendarClock } from "lucide-react"
import { DispatchScheduling } from "@/components/dispatch-scheduling"
import { ProgramacionDia } from "@/components/programacion-dia"

type Plant = { id: string; name: string }

export function ProgramacionTabs({ plants }: { plants: Plant[] }) {
  const [vista, setVista] = useState<"semana" | "dia">("semana")
  useEffect(() => { try { const v = localStorage.getItem("programacion-vista"); if (v === "dia" || v === "semana") setVista(v) } catch {} }, [])
  const cambiar = (v: string) => { setVista(v as any); try { localStorage.setItem("programacion-vista", v) } catch {} }
  return (
    <div className="space-y-4">
      <Tabs value={vista} onValueChange={cambiar}>
        <TabsList>
          <TabsTrigger value="semana" className="gap-1.5"><CalendarDays className="h-4 w-4" /> Semana</TabsTrigger>
          <TabsTrigger value="dia" className="gap-1.5"><CalendarClock className="h-4 w-4" /> Día · ordenar camiones</TabsTrigger>
        </TabsList>
      </Tabs>
      {vista === "semana" ? <DispatchScheduling plants={plants as any} /> : <ProgramacionDia plants={plants} />}
    </div>
  )
}
