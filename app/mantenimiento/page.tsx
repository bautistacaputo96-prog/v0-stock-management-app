import { Navigation } from "@/components/navigation"
import { MaintenanceContent } from "@/components/maintenance/maintenance-content"

export const metadata = {
  title: "Mantenimiento - Concretus Control de Produccion",
  description: "Gestión de mantenimiento, pañol y combustible",
}

export default function MantenimientoPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <MaintenanceContent />
      </main>
    </div>
  )
}
