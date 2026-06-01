"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Droplets } from "lucide-react"
import { cn } from "@/lib/utils"

type Material = {
  id: string
  name: string
  unit: string
}

type FormulaMaterial = {
  id: string
  quantity: number
  materials: Material
}

type ParsedFormula = {
  resistencia: string
  tipoPiedra: string | null
  asentamiento: string | null
  metodo: string | null
}

type Formula = {
  id: string
  code: string
  name: string
  description: string | null
  yield_m3: number
  formula_materials: FormulaMaterial[]
  parsed?: ParsedFormula | null
}

// Helper to parse formula code
function parseFormulaCode(code: string): ParsedFormula | null {
  // Format: H21-6/20-10 C (nuevo formato con tipo piedra como "6/20")
  const newMatch = code.match(/^(H\d+)-([^-]+)-(\d+)\s*([CB])?$/i)
  if (newMatch) {
    return {
      resistencia: newMatch[1].toUpperCase(),
      tipoPiedra: newMatch[2],
      asentamiento: newMatch[3],
      metodo: newMatch[4]?.toUpperCase() === "B" ? "Bombeable" : newMatch[4]?.toUpperCase() === "C" ? "Canaleta" : null
    }
  }
  // Format legacy: H21-612-10 C
  const match = code.match(/^(H\d+)-(\d)(\d+)-(\d+)\s*([CB])?$/i)
  if (match) {
    return {
      resistencia: match[1].toUpperCase(),
      tipoPiedra: `${match[2]}/${match[3]}`,
      asentamiento: match[4],
      metodo: match[5]?.toUpperCase() === "B" ? "Bombeable" : match[5]?.toUpperCase() === "C" ? "Canaleta" : null
    }
  }
  // Format: H21-6/20 (sin asentamiento)
  const noAsentMatch = code.match(/^(H\d+)-([^-\s]+)\s*([CB])?$/i)
  if (noAsentMatch) {
    return {
      resistencia: noAsentMatch[1].toUpperCase(),
      tipoPiedra: noAsentMatch[2],
      asentamiento: null,
      metodo: noAsentMatch[3]?.toUpperCase() === "B" ? "Bombeable" : noAsentMatch[3]?.toUpperCase() === "C" ? "Canaleta" : null
    }
  }
  // Simple format: H21 C or just H21
  const simpleMatch = code.match(/^(H\d+)\s*([CB])?$/i)
  if (simpleMatch) {
    return {
      resistencia: simpleMatch[1].toUpperCase(),
      tipoPiedra: null,
      asentamiento: null,
      metodo: simpleMatch[2]?.toUpperCase() === "B" ? "Bombeable" : simpleMatch[2]?.toUpperCase() === "C" ? "Canaleta" : null
    }
  }
  return null
}

// Check if material requires humidity consideration
function requiresHumidity(materialName: string): boolean {
  const name = materialName.toLowerCase()
  return name.includes("arena") || name.includes("piedra")
}

export function ViewFormulaDialog({
  formula,
  open,
  onOpenChange,
}: {
  formula: Formula
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const parsed = formula.parsed || parseFormulaCode(formula.code)
  const waterMaterial = formula.formula_materials.find((fm) => fm.materials.name.toLowerCase() === "agua")
  const otherMaterials = formula.formula_materials.filter((fm) => fm.materials.name.toLowerCase() !== "agua")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="font-mono text-xl">{formula.code}</span>
            {parsed?.metodo && (
              <Badge 
                variant="outline"
                className={cn(
                  parsed?.metodo === "Canaleta" 
                    ? "border-green-500 text-green-600 bg-green-50" 
                    : "border-blue-500 text-blue-600 bg-blue-50"
                )}
              >
                {parsed.metodo}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground">Resistencia</p>
              <p className="text-lg font-bold">{parsed?.resistencia || "-"}</p>
            </div>
            <div className="p-3 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground">Piedra</p>
              <p className="text-lg font-bold">
                {parsed?.tipoPiedra || "-"}
              </p>
            </div>
            <div className="p-3 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground">Asentamiento</p>
              <p className="text-lg font-bold">
                {parsed?.asentamiento ? `${parsed.asentamiento} cm` : "-"}
              </p>
            </div>
            <div className="p-3 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground">Rinde</p>
              <p className="text-lg font-bold">{formula.yield_m3} m3</p>
            </div>
          </div>

          {/* Water card */}
          {waterMaterial && (
            <div className="flex items-center gap-4 p-4 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
              <Droplets className="h-8 w-8 text-blue-600 dark:text-blue-400" />
              <div>
                <p className="text-sm text-muted-foreground">Agua</p>
                <p className="text-2xl font-bold">
                  {waterMaterial.quantity.toLocaleString("es-AR")} {waterMaterial.materials.unit}
                </p>
              </div>
            </div>
          )}

          {/* Materials table */}
          <div>
            <h3 className="font-semibold mb-3">Composicion</h3>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead>Unidad</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead className="text-center">Humedad</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {otherMaterials.map((fm) => (
                    <TableRow key={fm.id}>
                      <TableCell className="font-medium">{fm.materials.name}</TableCell>
                      <TableCell>{fm.materials.unit}</TableCell>
                      <TableCell className="text-right font-mono">
                        {fm.quantity.toLocaleString("es-AR", { maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-center">
                        {requiresHumidity(fm.materials.name) ? (
                          <Badge variant="outline" className="text-xs">
                            Aplica
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
