"use client"

import { useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Pencil, Trash2, Eye } from "lucide-react"
import { EditFormulaDialog } from "@/components/edit-formula-dialog"
import { DeleteFormulaDialog } from "@/components/delete-formula-dialog"
import { ViewFormulaDialog } from "@/components/view-formula-dialog"

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

type Formula = {
  id: string
  code: string
  name: string
  description: string | null
  yield_m3: number
  formula_materials: FormulaMaterial[]
}

export function FormulasTable({ formulas, materials }: { formulas: Formula[]; materials: Material[] }) {
  const [viewFormula, setViewFormula] = useState<Formula | null>(null)
  const [editFormula, setEditFormula] = useState<Formula | null>(null)
  const [deleteFormula, setDeleteFormula] = useState<Formula | null>(null)

  return (
    <>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead className="text-right">Rinde (m³)</TableHead>
              <TableHead className="text-right">Materiales</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {formulas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No hay fórmulas registradas
                </TableCell>
              </TableRow>
            ) : (
              formulas.map((formula) => (
                <TableRow key={formula.id}>
                  <TableCell className="font-bold">{formula.code}</TableCell>
                  <TableCell className="font-medium">{formula.name}</TableCell>
                  <TableCell className="text-muted-foreground">{formula.description || "-"}</TableCell>
                  <TableCell className="text-right font-mono">{formula.yield_m3}</TableCell>
                  <TableCell className="text-right">{formula.formula_materials?.length || 0}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
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
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
          onOpenChange={(open) => !open && setEditFormula(null)}
        />
      )}

      {deleteFormula && (
        <DeleteFormulaDialog
          formula={deleteFormula}
          open={!!deleteFormula}
          onOpenChange={(open) => !open && setDeleteFormula(null)}
        />
      )}
    </>
  )
}
