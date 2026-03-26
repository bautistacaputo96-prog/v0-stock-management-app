"use client"

import { usePlant } from "@/lib/plant-context"
import { ProductionHistory } from "@/components/production-history"
import { RanchosProductionHistory } from "@/components/ranchos-production-history"
import { VillaRosaProductionHistory } from "@/components/villa-rosa-production-history"

export function PlantHistorialRouter() {
  const { selectedPlant } = usePlant()

  if (selectedPlant === "ranchos") {
    return <RanchosProductionHistory />
  }

  if (selectedPlant === "villa-rosa") {
    return <VillaRosaProductionHistory />
  }

  return <ProductionHistory />
}
