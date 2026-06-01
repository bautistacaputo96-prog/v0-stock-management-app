"use client"

import { useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Pencil, Trash2, Eye } from "lucide-react"
import { EditMaterialDialog } from "@/components/edit-material-dialog"
import { DeleteMaterialDialog } from "@/components/delete-material-dialog"
import { MaterialDetailDialog } from "@/components/material-detail-dialog"

type Material = {
  id: string
  name: string
  unit: string
  current_stock: number
  min_stock: number
  dry_stock?: number
  stockpile_humidity?: number
  requires_humidity_control?: boolean
}

export function MaterialsTable({ materials, onUpdate }: { materials: Material[]; onUpdate?: () => void }) {
  const [editMaterial, setEditMaterial] = useState<Material | null>(null)
  const [deleteMaterial, setDeleteMaterial] = useState<Material | null>(null)
  const [viewMaterial, setViewMaterial] = useState<Material | null>(null)

  const visibleMaterials = materials.filter((material) => material.name.toLowerCase() !== "agua")

  return (
    <>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Material</TableHead>
              <TableHead>Unidad</TableHead>
              <TableHead className="text-right">Stock Actual</TableHead>
              <TableHead className="text-right">Stock Minimo</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleMaterials.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No hay materiales registrados
                </TableCell>
              </TableRow>
            ) : (
              visibleMaterials.map((material) => {
                // Para materiales con control de humedad, mostrar el stock húmedo (calculado)
                // Internamente se lleva dry_stock pero se muestra el equivalente húmedo
                const dryStock = material.dry_stock ?? material.current_stock
                const humidity = material.stockpile_humidity ?? 0
                const displayStock = material.requires_humidity_control 
                  ? dryStock * (1 + humidity / 100) 
                  : material.current_stock
                const isLowStock = material.current_stock <= material.min_stock
                
                return (
                  <TableRow key={material.id}>
                    <TableCell className="font-medium">{material.name}</TableCell>
                    <TableCell>{material.unit}</TableCell>
                    <TableCell className="text-right font-mono">
                      {displayStock.toLocaleString("es-AR", { maximumFractionDigits: 0 })}
                    </TableCell>
                    <TableCell className="text-right font-mono">{material.min_stock.toLocaleString("es-AR")}</TableCell>
                    <TableCell>
                      {isLowStock ? (
                        <Badge variant="destructive">Bajo</Badge>
                      ) : (
                        <Badge variant="default" className="bg-green-600">
                          OK
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setViewMaterial(material)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditMaterial(material)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setDeleteMaterial(material)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {editMaterial && (
        <EditMaterialDialog
          material={editMaterial}
          open={!!editMaterial}
          onOpenChange={(open) => !open && setEditMaterial(null)}
        />
      )}

      {deleteMaterial && (
        <DeleteMaterialDialog
          material={deleteMaterial}
          open={!!deleteMaterial}
          onOpenChange={(open) => !open && setDeleteMaterial(null)}
        />
      )}

      {viewMaterial && (
        <MaterialDetailDialog
          material={viewMaterial}
          open={!!viewMaterial}
          onOpenChange={(open) => !open && setViewMaterial(null)}
        />
      )}
    </>
  )
}
