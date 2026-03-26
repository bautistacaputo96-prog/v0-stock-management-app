"use client"

import { usePlant } from "@/lib/plant-context"
import { DashboardContent } from "@/components/dashboard-content"
import { RanchosDashboardContent } from "@/components/ranchos-dashboard-content"

export function PlantDashboardRouter() {
  const { selectedPlant } = usePlant()

  if (selectedPlant === "ranchos") {
    return <RanchosDashboardContent />
  }

  return <DashboardContent />
}
