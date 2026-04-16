"use client"

import { FormuleoContent } from "@/components/formuleo-content"
import { FormuleoRanchosContent } from "@/components/formuleo-ranchos-content"
import { Navigation } from "@/components/navigation"
import { usePlant } from "@/lib/plant-context"

export default function FormuleoPage() {
  const { selectedPlant } = usePlant()
  
  // Determine plant type
  const isPipePlant = selectedPlant === "silke" || selectedPlant === "villa-rosa" || selectedPlant === "mercedes"
  const isPaverPlant = selectedPlant === "ranchos"
  
  // Get display info based on plant
  const getPlantInfo = () => {
    if (isPipePlant) {
      return { title: "Formuleo - Canos", description: "Gestion de formulas de paston y canos" }
    }
    if (isPaverPlant) {
      return { title: "Formuleo - Adoquines", description: "Gestion de formulas de paston y adoquines" }
    }
    return { title: "Formuleo", description: "Seleccione una planta" }
  }
  
  const plantInfo = getPlantInfo()

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">{plantInfo.title}</h1>
          <p className="text-muted-foreground">{plantInfo.description}</p>
        </div>
        
        {isPipePlant && <FormuleoContent />}
        {isPaverPlant && <FormuleoRanchosContent />}
        
        {!isPipePlant && !isPaverPlant && (
          <div className="text-center py-12">
            <h2 className="text-lg font-semibold text-foreground mb-2">Formuleo no disponible</h2>
            <p className="text-muted-foreground">
              Por favor seleccione una planta valida para acceder al modulo de Formuleo.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
