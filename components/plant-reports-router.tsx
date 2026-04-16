"use client"

import { usePlant } from "@/lib/plant-context"
import { ReportsContent } from "@/components/reports-content"
import { FileText } from "lucide-react"

export function PlantReportsRouter() {
  const { selectedPlant } = usePlant()

  if (selectedPlant === "ranchos") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">Informes - Ranchos</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Informes de produccion de la linea de adoquines</p>
        </div>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <FileText className="h-7 w-7 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-1">Informes disponibles cuando haya datos</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Los informes de la planta Ranchos se generaran automaticamente una vez que cargues partes de produccion de adoquines.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground tracking-tight">Informes de Produccion</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Genera informes de produccion por rango de fechas</p>
      </div>
      <ReportsContent />
    </div>
  )
}
