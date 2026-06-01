"use client"

import { useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Eye, Droplets, CheckCircle, Clock, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { ViewGranulometriaDialog } from "./view-granulometria-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"

type Material = {
  id: string
  name: string
  unit: string
}

type GranulometriaTest = {
  id: string
  fineness_modulus: number | null
}

type Supplier = {
  id: string
  name: string
}

type StockEntry = {
  id: string
  quantity: number
  original_quantity: number | null
  remito: string | null
  notes: string | null
  entry_date: string
  humidity_percentage: number | null
  sample_taken_granulometry: boolean
  granulometry_test_id: string | null
  materials: Material
  suppliers?: Supplier | null
  granulometria_tests?: GranulometriaTest | null
}

export function StockEntriesTable({ entries, onRefresh }: { entries: StockEntry[]; onRefresh?: () => void }) {
  const [viewGranulometriaId, setViewGranulometriaId] = useState<string | null>(null)
  const [editingEntry, setEditingEntry] = useState<StockEntry | null>(null)
  const [deleteEntry, setDeleteEntry] = useState<StockEntry | null>(null)
  const [editQuantity, setEditQuantity] = useState("")
  const [editRemito, setEditRemito] = useState("")
  const [editNotes, setEditNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  async function handleDelete() {
    if (!deleteEntry) return
    setSaving(true)
    const supabase = createClient()
    
    // Restar la cantidad del stock actual del material
    await supabase.rpc("decrement_stock", { 
      material_id: deleteEntry.materials.id, 
      amount: deleteEntry.quantity 
    })
    
    const { error } = await supabase.from("stock_entries").delete().eq("id", deleteEntry.id)
    if (error) {
      toast({ title: "Error", description: "No se pudo eliminar el ingreso", variant: "destructive" })
    } else {
      toast({ title: "Ingreso eliminado", description: "El stock fue ajustado" })
      onRefresh?.()
    }
    setDeleteEntry(null)
    setSaving(false)
  }

  async function handleUpdate() {
    if (!editingEntry) return
    setSaving(true)
    const supabase = createClient()
    
    const oldQuantity = editingEntry.quantity
    const newQuantity = parseFloat(editQuantity)
    const quantityDiff = newQuantity - oldQuantity
    
    // Ajustar el stock según la diferencia
    if (quantityDiff > 0) {
      await supabase.rpc("increment_stock", { material_id: editingEntry.materials.id, amount: quantityDiff })
    } else if (quantityDiff < 0) {
      await supabase.rpc("decrement_stock", { material_id: editingEntry.materials.id, amount: Math.abs(quantityDiff) })
    }
    
    const { error } = await supabase.from("stock_entries").update({ 
      quantity: newQuantity,
      remito: editRemito || null,
      notes: editNotes || null
    }).eq("id", editingEntry.id)
    
    if (error) {
      toast({ title: "Error", description: "No se pudo actualizar el ingreso", variant: "destructive" })
    } else {
      toast({ title: "Ingreso actualizado" })
      onRefresh?.()
    }
    setEditingEntry(null)
    setSaving(false)
  }

  function openEdit(entry: StockEntry) {
    setEditingEntry(entry)
    setEditQuantity(entry.quantity.toString())
    setEditRemito(entry.remito || "")
    setEditNotes(entry.notes || "")
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, "0")
    const day = String(date.getUTCDate()).padStart(2, "0")
    return `${day}/${month}/${year}`
  }

  const isSandMaterial = (name: string) => name.toLowerCase().includes("arena")

  return (
    <>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Material</TableHead>
              <TableHead className="text-right">Cantidad</TableHead>
              <TableHead>Proveedor</TableHead>
              <TableHead>Remito</TableHead>
              <TableHead className="text-center">Humedad</TableHead>
              <TableHead className="text-center">Granulometria</TableHead>
              <TableHead>Notas</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  No hay ingresos registrados
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry) => {
                const hasHumidity = isSandMaterial(entry.materials.name) && entry.humidity_percentage !== null
                const hasExcessHumidity = hasHumidity && entry.humidity_percentage! > 3
                const hasGranulometryTest = entry.granulometry_test_id !== null
                const testCompleted = entry.granulometria_tests?.fineness_modulus !== null && entry.granulometria_tests?.fineness_modulus !== undefined

                return (
                  <TableRow key={entry.id}>
                    <TableCell className="font-mono">{formatDate(entry.entry_date)}</TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {entry.materials.name}
                        <Badge variant="secondary" className="text-xs">
                          {entry.materials.unit}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="font-mono text-green-600 font-semibold">
                        +{entry.quantity.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </TableCell>
                    <TableCell>{entry.suppliers?.name || "-"}</TableCell>
                    <TableCell>{entry.remito || "-"}</TableCell>
                    <TableCell className="text-center">
                      {hasHumidity ? (
                        <div className="flex items-center justify-center gap-1">
                          <Droplets className={`h-4 w-4 ${hasExcessHumidity ? "text-amber-500" : "text-blue-500"}`} />
                          <span className={hasExcessHumidity ? "text-amber-600 font-medium" : ""}>
                            {entry.humidity_percentage?.toFixed(2)}%
                          </span>
                        </div>
                      ) : isSandMaterial(entry.materials.name) ? (
                        <span className="text-muted-foreground">-</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">N/A</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {entry.sample_taken_granulometry ? (
                        hasGranulometryTest ? (
                          <div className="flex items-center justify-center">
                            {testCompleted ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2 gap-1 text-green-600 hover:text-green-700"
                                onClick={() => setViewGranulometriaId(entry.granulometry_test_id)}
                              >
                                <CheckCircle className="h-4 w-4" />
                                <span className="text-xs font-medium">
                                  MF {entry.granulometria_tests?.fineness_modulus?.toFixed(2)}
                                </span>
                                <Eye className="h-3 w-3 ml-1" />
                              </Button>
                            ) : (
                              <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300">
                                <Clock className="h-3 w-3" />
                                Pendiente
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300">
                            <Clock className="h-3 w-3" />
                            Pendiente
                          </Badge>
                        )
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-[150px] truncate">
                      {entry.notes || "-"}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(entry)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setDeleteEntry(entry)} className="text-destructive">
                            <Trash2 className="h-4 w-4 mr-2" />
                            Eliminar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {viewGranulometriaId && (
        <ViewGranulometriaDialog
          open={!!viewGranulometriaId}
          onOpenChange={(open) => !open && setViewGranulometriaId(null)}
          testId={viewGranulometriaId}
        />
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editingEntry} onOpenChange={(open) => !open && setEditingEntry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Ingreso</DialogTitle>
          </DialogHeader>
          {editingEntry && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Material:</span>
                  <p className="font-medium">{editingEntry.materials.name}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Proveedor:</span>
                  <p className="font-medium">{editingEntry.suppliers?.name || "-"}</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Cantidad ({editingEntry.materials.unit})</Label>
                <Input 
                  type="number" 
                  step="0.01" 
                  value={editQuantity} 
                  onChange={(e) => setEditQuantity(e.target.value)} 
                />
                <p className="text-xs text-muted-foreground">
                  Si cambias la cantidad, el stock se ajustara automaticamente.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Remito</Label>
                <Input value={editRemito} onChange={(e) => setEditRemito(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Notas</Label>
                <Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingEntry(null)}>Cancelar</Button>
            <Button onClick={handleUpdate} disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteEntry} onOpenChange={(open) => !open && setDeleteEntry(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar Ingreso</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <span>¿Estas seguro que deseas eliminar este ingreso? El stock del material sera ajustado automaticamente.</span>
                {deleteEntry && (
                  <div className="mt-2 p-2 bg-muted rounded text-sm">
                    <div><strong>Material:</strong> {deleteEntry.materials.name}</div>
                    <div><strong>Cantidad:</strong> {deleteEntry.quantity.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {deleteEntry.materials.unit}</div>
                    <div><strong>Proveedor:</strong> {deleteEntry.suppliers?.name || "-"}</div>
                    <div><strong>Remito:</strong> {deleteEntry.remito || "-"}</div>
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
