"use client"

import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card } from "@/components/ui/card"
import { PackageCheck } from "lucide-react"

interface MaterialFilterProps {
  materials: any[]
  selectedMaterial: string
  onFilterChange: (materialId: string) => void
}

export function MaterialFilter({ materials, selectedMaterial, onFilterChange }: MaterialFilterProps) {
  const selected = materials.find((m) => m.id === selectedMaterial)

  const formatStock = (material: any) => {
    if (!material) return null

    const isBulkMaterial =
      material.name.toLowerCase().includes("arena") ||
      material.name.toLowerCase().includes("piedra") ||
      material.name.toLowerCase().includes("cemento")

    const displayValue = isBulkMaterial ? (material.current_stock / 1000).toFixed(2) : material.current_stock
    const displayUnit = isBulkMaterial ? "tn" : material.unit

    return `${displayValue} ${displayUnit}`
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Material</Label>
      <div className="flex items-center gap-3">
        <Select value={selectedMaterial} onValueChange={onFilterChange}>
          <SelectTrigger className="w-[250px]">
            <SelectValue placeholder="Todos los materiales" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los materiales</SelectItem>
            {materials.map((material) => (
              <SelectItem key={material.id} value={material.id}>
                {material.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selected && (
          <Card className="px-4 py-2 flex items-center gap-2 bg-muted">
            <PackageCheck className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Stock actual: {formatStock(selected)}</span>
          </Card>
        )}
      </div>
    </div>
  )
}
