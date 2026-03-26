import { Navigation } from "@/components/navigation"
import { PlantHistorialRouter } from "@/components/plant-historial-router"

export default function HistorialPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <PlantHistorialRouter />
      </main>
    </div>
  )
}
