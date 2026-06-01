"use client"

import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { ChevronDown } from "lucide-react"

interface FormulaFilterProps {
  formulas: any[]
  selectedFormulas: string[]
  onFilterChange: (formulas: string[]) => void
}

export function FormulaFilter({ formulas, selectedFormulas, onFilterChange }: FormulaFilterProps) {
  const toggleFormula = (formulaId: string) => {
    if (selectedFormulas.includes(formulaId)) {
      onFilterChange(selectedFormulas.filter((id) => id !== formulaId))
    } else {
      onFilterChange([...selectedFormulas, formulaId])
    }
  }

  const selectedCount = selectedFormulas.length
  const displayText =
    selectedCount === 0
      ? "Todos los hormigones"
      : selectedCount === 1
        ? formulas.find((f) => f.id === selectedFormulas[0])?.code
        : `${selectedCount} seleccionados`

  return (
    <div className="flex flex-col gap-2">
      <Label>Tipo de Hormigón</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="justify-between bg-transparent">
            {displayText}
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 max-h-80 overflow-auto">
          <div className="space-y-2">
            {formulas.map((formula) => (
              <div key={formula.id} className="flex items-center space-x-2">
                <Checkbox
                  id={`formula-${formula.id}`}
                  checked={selectedFormulas.includes(formula.id)}
                  onCheckedChange={() => toggleFormula(formula.id)}
                />
                <label
                  htmlFor={`formula-${formula.id}`}
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  {formula.code} - {formula.name}
                </label>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
