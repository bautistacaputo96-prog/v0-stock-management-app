import { Navigation } from "@/components/navigation"
import { ProductionForm } from "@/components/production-form"

export default function NewProductionPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Nueva Producción</h1>
          <p className="text-muted-foreground">Registra los datos de producción del turno</p>
        </div>

        <ProductionForm />
      </main>
    </div>
  )
}
