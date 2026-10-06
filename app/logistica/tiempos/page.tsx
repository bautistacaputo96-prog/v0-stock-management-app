import { Suspense } from "react"
import { LogisticaTiempos } from "@/components/logistica-tiempos"

export const dynamic = "force-dynamic"

export default function TiemposRealesPage() {
  return (
    <div className="py-4 px-4 md:py-6 md:px-6">
      <div className="mb-4 md:mb-6">
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">Tiempos reales</h1>
        <p className="text-xs md:text-sm text-muted-foreground mt-1">Los viajes de los mixers medidos con el GPS: salida, obra, vuelta y tiempo en planta, cruzados con los remitos</p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando...</p>}>
        <LogisticaTiempos />
      </Suspense>
    </div>
  )
}
