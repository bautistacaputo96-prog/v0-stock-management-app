import { Navigation } from "@/components/navigation"
import { PlantReportsRouter } from "@/components/plant-reports-router"

export const metadata = {
  title: "Informes - Concretus Control de Produccion",
  description: "Informes de produccion diarios, semanales y mensuales",
}

export default function ReportsPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <PlantReportsRouter />
      </main>
    </div>
  )
}
