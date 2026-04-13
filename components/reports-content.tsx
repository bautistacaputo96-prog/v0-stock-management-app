"use client"

import { useState, useEffect } from "react"
import { UnifiedPipeReport } from "@/components/reports/unified-pipe-report"
import { CustomRangeReport } from "@/components/reports/custom-range-report"
import { Factory, Cylinder } from "lucide-react"
import { usePlant } from "@/lib/plant-context"

export function ReportsContent() {
  const { selectedPlant } = usePlant()
  const showBloques = selectedPlant !== "silke" && selectedPlant !== "villa-rosa"
  const [selectedLine, setSelectedLine] = useState<"bloques" | "caños" | null>(null)

  // Si la planta no tiene bloques, auto-seleccionar caños
  useEffect(() => {
    if (!showBloques) setSelectedLine("caños")
  }, [showBloques])

  if (!selectedLine) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <p className="text-sm text-muted-foreground mb-6">Selecciona una linea de produccion</p>
        <div className="flex items-center gap-3">
          {showBloques && (
            <button
              type="button"
              onClick={() => setSelectedLine("bloques")}
              className="flex items-center gap-2 px-5 py-3 rounded-lg border-2 border-border bg-card hover:bg-muted hover:border-primary/30 transition-all text-sm font-medium text-foreground"
            >
              <Factory className="w-4 h-4" />
              Bloques
            </button>
          )}
          <button
            type="button"
            onClick={() => setSelectedLine("caños")}
            className="flex items-center gap-2 px-5 py-3 rounded-lg border-2 border-border bg-card hover:bg-muted hover:border-primary/30 transition-all text-sm font-medium text-foreground"
          >
            <Cylinder className="w-4 h-4" />
            Canos
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header con selector de línea */}
      {showBloques && (
        <header className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSelectedLine(null)}
            className="text-muted-foreground hover:text-foreground transition-colors text-sm"
            aria-label="Volver"
          >
            &larr;
          </button>

          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            <button
              onClick={() => setSelectedLine("bloques")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                selectedLine === "bloques"
                  ? "bg-card text-foreground shadow-sm border border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Factory className="w-3.5 h-3.5" />
              Bloques
            </button>
            <button
              onClick={() => setSelectedLine("caños")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                selectedLine === "caños"
                  ? "bg-card text-foreground shadow-sm border border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Cylinder className="w-3.5 h-3.5" />
              Canos
            </button>
          </div>
        </header>
      )}

      {/* Contenido del informe */}
      {selectedLine === "caños" ? (
        <UnifiedPipeReport />
      ) : (
        <CustomRangeReport lineType="bloques" />
      )}
    </div>
  )
}
