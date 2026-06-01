"use client"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Eye, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { ViewDispatchDialog } from "./view-dispatch-dialog"
import { useState } from "react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"

type DispatchData = {
  id: string
  dispatch_date: string
  remito: string
  quantity_m3: number
  notes: string | null
  extra_water_liters: number | null
  sand_stockpile_humidity: number | null
  sample_taken: boolean | null
  sample_number: string | null
  actual_slump_cm: number | null
  clients: {
    id: string
    name: string
  } | null
  construction_sites: {
    id: string
    name: string
  } | null
  mixers: {
    id: string
    license_plate: string
    brand: string | null
  } | null
  formulas: {
    id: string
    code: string
    name: string
    yield_m3: number
    formula_materials: Array<{
      id: string
      quantity: number
      materials: {
        id: string
        name: string
        unit: string
      }
    }>
  }
}

export function DispatchesTable({ dispatches, onRefresh }: { dispatches: DispatchData[]; onRefresh?: () => void }) {
  const [selectedDispatch, setSelectedDispatch] = useState<DispatchData | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingDispatch, setEditingDispatch] = useState<DispatchData | null>(null)
  const [deleteDispatch, setDeleteDispatch] = useState<DispatchData | null>(null)
  const [editQuantity, setEditQuantity] = useState("")
  const [editRemito, setEditRemito] = useState("")
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  async function handleDelete() {
    if (!deleteDispatch) return
    setSaving(true)
    const supabase = createClient()
    
    // Primero restaurar el stock de los materiales
    const formula = deleteDispatch.formulas
    for (const fm of formula.formula_materials) {
      const quantityToRestore = (fm.quantity / formula.yield_m3) * deleteDispatch.quantity_m3
      await supabase.rpc("increment_stock", { material_id: fm.materials.id, amount: quantityToRestore })
    }
    
    // Luego eliminar el despacho
    const { error } = await supabase.from("dispatches").delete().eq("id", deleteDispatch.id)
    if (error) {
      toast({ title: "Error", description: "No se pudo eliminar el despacho", variant: "destructive" })
    } else {
      toast({ title: "Despacho eliminado", description: "El stock fue restaurado" })
      onRefresh?.()
    }
    setDeleteDispatch(null)
    setSaving(false)
  }

  async function handleUpdate() {
    if (!editingDispatch) return
    setSaving(true)
    const supabase = createClient()
    
    const oldQuantity = editingDispatch.quantity_m3
    const newQuantity = parseFloat(editQuantity)
    const quantityDiff = newQuantity - oldQuantity
    
    // Ajustar el stock según la diferencia
    const formula = editingDispatch.formulas
    for (const fm of formula.formula_materials) {
      const stockChange = (fm.quantity / formula.yield_m3) * quantityDiff
      if (quantityDiff > 0) {
        // Se aumentó la cantidad, descontar más stock
        await supabase.rpc("decrement_stock", { material_id: fm.materials.id, amount: stockChange })
      } else {
        // Se redujo la cantidad, restaurar stock
        await supabase.rpc("increment_stock", { material_id: fm.materials.id, amount: Math.abs(stockChange) })
      }
    }
    
    // Actualizar el despacho
    const { error } = await supabase.from("dispatches").update({ 
      quantity_m3: newQuantity,
      remito: editRemito 
    }).eq("id", editingDispatch.id)
    
    if (error) {
      toast({ title: "Error", description: "No se pudo actualizar el despacho", variant: "destructive" })
    } else {
      toast({ title: "Despacho actualizado" })
      onRefresh?.()
    }
    setEditingDispatch(null)
    setSaving(false)
  }

  function openEdit(dispatch: DispatchData) {
    setEditingDispatch(dispatch)
    setEditQuantity(dispatch.quantity_m3.toString())
    setEditRemito(dispatch.remito)
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, "0")
    const day = String(date.getUTCDate()).padStart(2, "0")
    return `${day}/${month}/${year}`
  }

  return (
    <>
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Remito</TableHead>
              <TableHead>Fórmula</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Obra</TableHead>
              <TableHead className="text-right">Cantidad (m³)</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dispatches.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No hay despachos registrados
                </TableCell>
              </TableRow>
            ) : (
              dispatches.map((dispatch) => (
                <TableRow key={dispatch.id}>
                  <TableCell>{formatDate(dispatch.dispatch_date)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{dispatch.remito}</Badge>
                  </TableCell>
                  <TableCell>
                    <div>
                      <div className="font-medium">{dispatch.formulas.code}</div>
                      <div className="text-sm text-muted-foreground">{dispatch.formulas.name}</div>
                    </div>
                  </TableCell>
                  <TableCell>{dispatch.clients?.name || "-"}</TableCell>
                  <TableCell>{dispatch.construction_sites?.name || "-"}</TableCell>
                  <TableCell className="text-right font-medium">{dispatch.quantity_m3} m³</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedDispatch(dispatch)
                          setDialogOpen(true)
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(dispatch)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setDeleteDispatch(dispatch)} className="text-destructive">
                            <Trash2 className="h-4 w-4 mr-2" />
                            Eliminar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {selectedDispatch && (
        <ViewDispatchDialog dispatch={selectedDispatch} open={dialogOpen} onOpenChange={setDialogOpen} />
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editingDispatch} onOpenChange={(open) => !open && setEditingDispatch(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Despacho</DialogTitle>
          </DialogHeader>
          {editingDispatch && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Formula:</span>
                  <p className="font-medium">{editingDispatch.formulas.code} - {editingDispatch.formulas.name}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Cliente:</span>
                  <p className="font-medium">{editingDispatch.clients?.name || "-"}</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Remito</Label>
                <Input value={editRemito} onChange={(e) => setEditRemito(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Cantidad (m3)</Label>
                <Input type="number" step="0.5" value={editQuantity} onChange={(e) => setEditQuantity(e.target.value)} />
                <p className="text-xs text-muted-foreground">
                  Si cambias la cantidad, el stock de materiales se ajustara automaticamente.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingDispatch(null)}>Cancelar</Button>
            <Button onClick={handleUpdate} disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteDispatch} onOpenChange={(open) => !open && setDeleteDispatch(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar Despacho</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <span>¿Estas seguro que deseas eliminar este despacho? El stock de materiales sera restaurado automaticamente.</span>
                {deleteDispatch && (
                  <div className="mt-2 p-2 bg-muted rounded text-sm">
                    <div><strong>Remito:</strong> {deleteDispatch.remito}</div>
                    <div><strong>Formula:</strong> {deleteDispatch.formulas.code}</div>
                    <div><strong>Cantidad:</strong> {deleteDispatch.quantity_m3}m3</div>
                    <div><strong>Cliente:</strong> {deleteDispatch.clients?.name || "-"}</div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={saving} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {saving ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
