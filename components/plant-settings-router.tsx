"use client"

import { usePlant } from "@/lib/plant-context"
import { SettingsContent } from "@/components/settings-content"
import { RanchosSettingsContent } from "@/components/ranchos-settings-content"

export function PlantSettingsRouter() {
  const { selectedPlant } = usePlant()

  if (selectedPlant === "ranchos") {
    return (
      <>
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Configuracion - Ranchos</h1>
          <p className="text-muted-foreground">Administra los tipos de producto y configuracion de adoquines</p>
        </div>
        <RanchosSettingsContent />
      </>
    )
  }

  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">Configuracion</h1>
        <p className="text-muted-foreground">Administra los tiempos de ciclo y motivos de parada</p>
      </div>
      <SettingsContent />
    </>
  )
}
