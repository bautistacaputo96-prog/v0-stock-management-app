"use client"

import { useState } from "react"
import { Navigation } from "@/components/navigation"
import { PlantHistorialRouter } from "@/components/plant-historial-router"
import { ProductionForm } from "@/components/production-form"
import { Button } from "@/components/ui/button"
import { PlusCircle, ArrowLeft } from "lucide-react"

export default function ProduccionPage() {
  const [showNewForm, setShowNewForm] = useState(false)

  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {showNewForm ? (
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center gap-3 mb-8">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowNewForm(false)}
                className="gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Volver al historial
              </Button>
            </div>
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-foreground mb-2">Nueva Produccion</h1>
              <p className="text-muted-foreground">Registra los datos de produccion del turno</p>
            </div>
            <ProductionForm />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-3xl font-bold text-foreground mb-2">Produccion</h1>
                <p className="text-muted-foreground">Historial de produccion y registro de partes</p>
              </div>
              <Button onClick={() => setShowNewForm(true)} className="gap-2">
                <PlusCircle className="h-4 w-4" />
                Nueva Produccion
              </Button>
            </div>
            <PlantHistorialRouter />
          </>
        )}
      </main>
    </div>
  )
}
