"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Factory } from "lucide-react"

interface PlantSelectorProps {
  plants: Array<{ id: string; name: string; code: string }>
  selectedPlant: string
  onPlantChange: (plantId: string) => void
}

export function PlantSelector({ plants, selectedPlant, onPlantChange }: PlantSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <Factory className="h-4 w-4 text-muted-foreground" />
      <Select value={selectedPlant} onValueChange={onPlantChange}>
        <SelectTrigger className="w-[180px] bg-card shadow-sm">
          <SelectValue placeholder="Seleccionar planta" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas las plantas</SelectItem>
          {plants.map((plant) => (
            <SelectItem key={plant.id} value={plant.id}>
              {plant.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
