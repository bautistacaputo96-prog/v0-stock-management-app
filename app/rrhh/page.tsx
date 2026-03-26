import { Navigation } from "@/components/navigation"
import { RRHHContent } from "@/components/rrhh/rrhh-content"

export const metadata = {
  title: "Recursos Humanos - Concretus Control de Produccion",
  description: "Gestión de empleados y control de asistencia",
}

export default function RRHHPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Recursos Humanos</h1>
          <p className="text-muted-foreground">Gestión de empleados, asistencia y presentismo</p>
        </div>

        <RRHHContent />
      </main>
    </div>
  )
}
