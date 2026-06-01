"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ChevronDown, Eye, Pencil, Trash2, Calendar } from "lucide-react"
import { format, parseISO } from "date-fns"
import { es } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { ViewFormulaDialog } from "@/components/view-formula-dialog"
import { EditFormulaDialog } from "@/components/edit-formula-dialog"
import { DeleteFormulaDialog } from "@/components/delete-formula-dialog"

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
  tamanioPiedra: string | null
  asentamiento: string | null
  metodo: string
}

type Formula = {
  id: string
  code: string
  name: string
  description: string | null
  yield_m3: number
  formula_materials: FormulaMaterial[]
  parsed?: ParsedFormula | null
  updated_at?: string | null
  updated_by?: string | null
}

type GroupedFormulas = Record<string, Formula[]>

interface FormulasGroupedViewProps {
  groupedFormulas: GroupedFormulas
  materials: Material[]
  onUpdate: () => void
  expandedGroup: string | null
}

const RESISTENCIAS_ORDER = ["H4", "H8", "H13", "H17", "H21", "H25", "H30", "H35", "H40", "H45", "H50", "Otros"]

export function FormulasGroupedView({ groupedFormulas, materials, onUpdate, expandedGroup }: FormulasGroupedViewProps) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const [viewFormula, setViewFormula] = useState<Formula | null>(null)
  const [editFormula, setEditFormula] = useState<Formula | null>(null)
  const [deleteFormula, setDeleteFormula] = useState<Formula | null>(null)

  useEffect(() => {
    if (expandedGroup) {
      setOpenGroups(new Set([expandedGroup]))
    }
  }, [expandedGroup])

  const toggleGroup = (group: string) => {
    const newOpen = new Set(openGroups)
    if (newOpen.has(group)) {
      newOpen.delete(group)
    } else {
      newOpen.add(group)
    }
    setOpenGroups(newOpen)
  }

  const totalFormulas = Object.values(groupedFormulas).reduce((sum, arr) => sum + arr.length, 0)

  if (totalFormulas === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No hay formulas que coincidan con los filtros seleccionados
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {RESISTENCIAS_ORDER.map(resistencia => {
        const formulas = groupedFormulas[resistencia] || []
        const hasFormulas = formulas.length > 0
        const isOpen = openGroups.has(resistencia)

        if (!hasFormulas && resistencia !== "Otros") {
          return (
            <Card key={resistencia} className="opacity-50">
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-medium text-muted-foreground">
                    {resistencia}
                  </CardTitle>
                  <Badge variant="outline" className="text-muted-foreground">
                    0 variantes
                  </Badge>
                </div>
              </CardHeader>
            </Card>
          )
        }

        if (!hasFormulas) return null

        // Get the most recent update date for this group
        const lastUpdated = formulas.reduce((latest, f) => {
          if (!f.updated_at) return latest
          if (!latest) return f.updated_at
          return new Date(f.updated_at) > new Date(latest) ? f.updated_at : latest
        }, null as string | null)

        return (
          <Collapsible key={resistencia} open={isOpen} onOpenChange={() => toggleGroup(resistencia)}>
            <Card>
              <CollapsibleTrigger asChild>
                <CardHeader className="py-3 cursor-pointer hover:bg-muted/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <ChevronDown className={cn(
                        "h-5 w-5 text-muted-foreground transition-transform",
                        isOpen && "rotate-180"
                      )} />
                      <CardTitle className="text-lg font-semibold">
                        {resistencia}
                      </CardTitle>
                    </div>
                    <div className="flex items-center gap-3">
                      {lastUpdated && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Ult. edicion: {format(parseISO(lastUpdated), "dd/MM/yyyy", { locale: es })}
                        </span>
                      )}
                      <Badge variant="secondary">
                        {formulas.length} variante{formulas.length !== 1 ? "s" : ""}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Codigo</TableHead>
                        <TableHead>Piedra</TableHead>
                        <TableHead>Asentamiento</TableHead>
                        <TableHead>Metodo</TableHead>
                        <TableHead className="text-center">Materiales</TableHead>
                        <TableHead>Ult. Edicion</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {formulas.map(formula => (
                        <TableRow key={formula.id}>
                          <TableCell className="font-mono font-semibold">
                            {formula.code}
                          </TableCell>
                          <TableCell>
                            {formula.parsed?.tipoPiedra && formula.parsed?.tamanioPiedra
                              ? `Tipo ${formula.parsed.tipoPiedra} - ${formula.parsed.tamanioPiedra}mm`
                              : "-"
                            }
                          </TableCell>
                          <TableCell>
                            {formula.parsed?.asentamiento
                              ? `${formula.parsed.asentamiento} cm`
                              : "-"
                            }
                          </TableCell>
                          <TableCell>
                            <Badge 
                              variant="outline"
                              className={cn(
                                formula.parsed?.metodo === "Canaleta" 
                                  ? "border-green-500 text-green-600 bg-green-50" 
                                  : "border-blue-500 text-blue-600 bg-blue-50"
                              )}
                            >
                              {formula.parsed?.metodo || "N/A"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            {formula.formula_materials?.length || 0}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            <div>
                              {formula.updated_at 
                                ? format(parseISO(formula.updated_at), "dd/MM/yy", { locale: es })
                                : "-"
                              }
                            </div>
                            {formula.updated_by && (
                              <div className="text-[10px] text-muted-foreground/70 truncate max-w-[120px]" title={formula.updated_by}>
                                por {formula.updated_by.split("@")[0]}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="sm" onClick={() => setViewFormula(formula)}>
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setEditFormula(formula)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setDeleteFormula(formula)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        )
      })}

      {viewFormula && (
        <ViewFormulaDialog
          formula={viewFormula}
          open={!!viewFormula}
          onOpenChange={(open) => !open && setViewFormula(null)}
        />
      )}

      {editFormula && (
        <EditFormulaDialog
          formula={editFormula}
          materials={materials}
          open={!!editFormula}
          onOpenChange={(open) => {
            if (!open) {
              setEditFormula(null)
              onUpdate()
            }
          }}
        />
      )}

      {deleteFormula && (
        <DeleteFormulaDialog
          formula={deleteFormula}
          open={!!deleteFormula}
          onOpenChange={(open) => {
            if (!open) {
              setDeleteFormula(null)
              onUpdate()
            }
          }}
        />
      )}
    </div>
  )
}
