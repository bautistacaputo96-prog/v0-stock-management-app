"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { BlockProductionForm } from "@/components/block-production-form"
import { PipeProductionForm, LARGE_PIPE_SIZES } from "@/components/pipe-production-form"
import { PaverProductionForm } from "@/components/paver-production-form"
import { PaverRapidLoader } from "@/components/paver-rapid-loader"
import { usePlant } from "@/lib/plant-context"
import { Factory, Cylinder, LayoutGrid, Zap } from "lucide-react"

type SilkeLine = "bloques" | "caños"
type RanchosLine = "adoquines" | "adoquines-rapido"
type VillaRosaLine = "caños-grandes"
type SelectedLine = SilkeLine | RanchosLine | VillaRosaLine | null

export function ProductionForm() {
  const { selectedPlant, plantInfo } = usePlant()
  const [selectedLine, setSelectedLine] = useState<SelectedLine>(null)

  // Line selection screen
  if (!selectedLine) {
    const lines = selectedPlant === "silke"
      ? [
          { id: "caños" as const, label: "CANOS", desc: "Linea de produccion de canos", icon: Cylinder, color: "primary" },
        ]
      : selectedPlant === "villa-rosa"
      ? [
          { id: "caños-grandes" as const, label: "CANOS GRANDES", desc: "Canos de 800, 1000 y 1200mm", icon: Cylinder, color: "primary" },
        ]
      : [
          { id: "adoquines" as const, label: "ADOQUINES", desc: "Parte diario de adoquines", icon: LayoutGrid, color: "primary" },
          { id: "adoquines-rapido" as const, label: "CARGA RAPIDA", desc: "Cargar un mes completo dia por dia", icon: Zap, color: "accent" },
        ]

    return (
      <div className="space-y-6">
        <div className="text-center mb-2">
          <h2 className="text-lg font-semibold text-foreground tracking-tight">
            {plantInfo.name} - Seleccionar Linea
          </h2>
          <p className="text-xs text-muted-foreground mt-1">Elegi la linea para registrar la produccion del turno</p>
        </div>

        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${lines.length <= 1 ? "max-w-sm mx-auto" : ""}`}>
          {lines.map(line => (
            <button
              key={line.id}
              type="button"
              onClick={() => setSelectedLine(line.id)}
              className={`group relative flex flex-col items-center justify-center p-8 rounded-lg border border-border bg-card hover:border-${line.color}/40 transition-all duration-200 hover:shadow-md`}
            >
              <div className={`w-14 h-14 rounded-lg bg-${line.color}/10 flex items-center justify-center mb-4 group-hover:bg-${line.color}/15 transition-colors`}>
                <line.icon className={`h-7 w-7 text-${line.color}`} />
              </div>
              <span className="text-lg font-semibold text-foreground tracking-tight">{line.label}</span>
              <span className="text-xs text-muted-foreground mt-1">{line.desc}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <button
          type="button"
          onClick={() => setSelectedLine(null)}
          className="mb-4 text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
        >
          <span>{"<-"}</span> Cambiar linea de produccion
        </button>

        {selectedLine === "bloques" && <BlockProductionForm />}
        {selectedLine === "caños" && <PipeProductionForm selectedPlant={selectedPlant || "olivera"} />}
        {selectedLine === "caños-grandes" && <PipeProductionForm pipeSizes={LARGE_PIPE_SIZES} plantName="Villa Rosa" selectedPlant="villa-rosa" />}
        {selectedLine === "adoquines" && <PaverProductionForm />}
        {selectedLine === "adoquines-rapido" && <PaverRapidLoader onBack={() => setSelectedLine(null)} />}
      </CardContent>
    </Card>
  )
}
