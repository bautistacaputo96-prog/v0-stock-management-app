"use client"

import { createContext, useContext, useState, useEffect, type ReactNode } from "react"

export type PlantId = "silke" | "ranchos" | "villa-rosa"

export interface PlantInfo {
  id: PlantId
  name: string
  location: string
  lines: string[]
}

export const PLANTS: Record<PlantId, PlantInfo> = {
  silke: {
    id: "silke",
    name: "SILKE",
    location: "Mercedes",
    lines: ["Bloques", "Canos"],
  },
  ranchos: {
    id: "ranchos",
    name: "Ranchos",
    location: "Ranchos",
    lines: ["Adoquines", "Premoldeados"],
  },
  "villa-rosa": {
    id: "villa-rosa",
    name: "Villa Rosa",
    location: "Villa Rosa",
    lines: ["Canos Grandes"],
  },
}

interface PlantContextType {
  selectedPlant: PlantId
  setSelectedPlant: (plant: PlantId) => void
  plantInfo: PlantInfo
  plantName: string
  isPlantLoaded: boolean
}

const defaultPlantInfo = PLANTS.silke

const PlantContext = createContext<PlantContextType>({
  selectedPlant: "silke",
  setSelectedPlant: () => {},
  plantInfo: defaultPlantInfo,
  plantName: "SILKE",
  isPlantLoaded: false,
})

export function PlantProvider({ children }: { children: ReactNode }) {
  const [selectedPlant, setSelectedPlant] = useState<PlantId>("silke")
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem("selectedPlant") as PlantId | null
    if (saved && PLANTS[saved]) {
      setSelectedPlant(saved)
    }
    setLoaded(true)
  }, [])

  useEffect(() => {
    if (loaded) {
      localStorage.setItem("selectedPlant", selectedPlant)
    }
  }, [selectedPlant, loaded])

  const plantInfo = PLANTS[selectedPlant] || defaultPlantInfo

  return (
    <PlantContext.Provider
      value={{
        selectedPlant,
        setSelectedPlant,
        plantInfo,
        plantName: plantInfo.name,
        isPlantLoaded: loaded,
      }}
    >
      {children}
    </PlantContext.Provider>
  )
}

export function usePlant() {
  return useContext(PlantContext)
}
