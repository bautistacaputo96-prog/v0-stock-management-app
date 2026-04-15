"use client"

import { FormuleoContent } from "@/components/formuleo-content"
import { Navigation } from "@/components/navigation"
import { usePlant } from "@/lib/plant-context"

export default function FormuleoPage() {
  const { selectedPlant } = usePlant()
  
  // Formuleo solo está disponible para plantas de caños (silke, villa-rosa, mercedes)
  const isPipePlant = selectedPlant === "silke" || selectedPlant === "villa-rosa" || selectedPlant === "mercedes"
  
  if (!isPipePlant) {
    return (
      <div className="min-h-screen bg-background">
        <Navigation />
        <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center py-12">
            <h2 className="text-lg font-semibold text-foreground mb-2">Formuleo no disponible</h2>
            <p className="text-muted-foreground">
              El módulo de Formuleo solo está disponible para las plantas de caños (Silke, Villa Rosa, Mercedes).
            </p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Formuleo</h1>
          <p className="text-muted-foreground">Gestión de fórmulas de pastón y caños</p>
        </div>
        <FormuleoContent />
      </main>
    </div>
  )
}
