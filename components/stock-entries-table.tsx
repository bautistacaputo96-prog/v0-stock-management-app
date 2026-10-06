"use client"

import { useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Eye, Droplets, CheckCircle, Clock, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { ViewGranulometriaDialog } from "./view-granulometria-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { logCambio, logDeletion } from "@/lib/activity-log"
import { usePermisos } from "@/lib/current-user"
import { CampoMotivo, ConfirmarConMotivo, motivoValido } from "@/components/motivo"

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
  dry_quantity?: number | null
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
  const [editDate, setEditDate] = useState("")
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()
  // Fase 0c-1: editar y borrar ingresos según el permiso, con motivo
  const { puede } = usePermisos()
  const puedeEditar = puede("materia_prima", "editar")
  const puedeBorrar = puede("materia_prima", "borrar")
  const [motivo, setMotivo] = useState("")

  async function handleDelete(motivoBorrado: string) {
    if (!deleteEntry || !puedeBorrar) return
    setSaving(true)
    const supabase = createClient()

    // El stock lo descuenta la base sola al borrar el ingreso
    // (trigger trigger_decrease_stock_on_entry_delete, también corrige el stock seco).
    await logDeletion({
      entity: "ingreso",
      entityId: deleteEntry.id,
      reference: deleteEntry.remito || null,
      details: {
        Material: deleteEntry.materials?.name || "-",
        Proveedor: deleteEntry.suppliers?.name || "-",
        Remito: deleteEntry.remito || "-",
        Cantidad: `${deleteEntry.quantity} ${deleteEntry.materials?.unit || ""}`.trim(),
        Fecha: deleteEntry.entry_date ? new Date(deleteEntry.entry_date).toLocaleDateString("es-AR") : "-",
      },
      motivo: motivoBorrado,
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
    if (!editingEntry || !puedeEditar) return
    if (!motivoValido(motivo)) {
      toast({ title: "Falta el motivo", description: "Escribí por qué se corrige el ingreso.", variant: "destructive" })
      return
    }
    setSaving(true)
    const supabase = createClient()
    
    const oldQuantity = editingEntry.quantity
    const newQuantity = parseFloat(editQuantity)
    if (isNaN(newQuantity) || newQuantity <= 0) {
      toast({ title: "Error", description: "Ingresá una cantidad válida", variant: "destructive" })
      setSaving(false)
      return
    }
    const quantityDiff = newQuantity - oldQuantity

    // Stock seco: mismo criterio que al cargar el ingreso (add-stock-entry-dialog):
    // solo la Arena Fina lleva stock seco, y en seco entra cantidad / (1 + humedad/100).
    const tracksDryStock = editingEntry.materials?.name === "Arena Fina"
    const humidity = editingEntry.humidity_percentage || 0
    const oldDry = editingEntry.dry_quantity ?? oldQuantity
    const newDry = tracksDryStock && humidity > 0 ? newQuantity / (1 + humidity / 100) : newQuantity
    const dryDiff = newDry - oldDry

    const { error } = await supabase.from("stock_entries").update({
      quantity: newQuantity,
      // Se mantiene al día para que el trigger de borrado descuente lo correcto
      dry_quantity: newDry,
      remito: editRemito || null,
      notes: editNotes || null,
      // Se guarda al mediodía UTC para que la fecha mostrada no cambie por zona horaria
      ...(editDate ? { entry_date: `${editDate}T12:00:00Z` } : {}),
    }).eq("id", editingEntry.id)

    if (error) {
      toast({ title: "Error", description: "No se pudo actualizar el ingreso", variant: "destructive" })
      setEditingEntry(null)
      setSaving(false)
      return
    }

    // El trigger de la base solo suma al insertar: si cambió la cantidad, se corrige el stock por la diferencia
    let stockError: any = null
    if (Math.abs(quantityDiff) > 0.0001) {
      const { error: rpcError } = await supabase.rpc("update_material_stock", {
        p_material_id: editingEntry.materials.id,
        p_quantity_change: quantityDiff,
      })
      stockError = rpcError
    }
    if (!stockError && tracksDryStock && Math.abs(dryDiff) > 0.0001) {
      const { data: materialData } = await supabase
        .from("materials")
        .select("dry_stock")
        .eq("id", editingEntry.materials.id)
        .single()
      const { error: dryError } = await supabase
        .from("materials")
        .update({ dry_stock: (materialData?.dry_stock || 0) + dryDiff })
        .eq("id", editingEntry.materials.id)
      stockError = dryError
    }

    // Fase 0c-1: Actividad con el antes → después, si se corrigió el stock y el motivo
    const unidad = editingEntry.materials?.unit || ""
    await logCambio({
      entity: "ingreso",
      entityId: editingEntry.id,
      reference: editRemito || editingEntry.remito || null,
      antes: {
        cantidad: `${editingEntry.quantity} ${unidad}`.trim(),
        remito: editingEntry.remito || "",
        fecha: editingEntry.entry_date ? new Date(editingEntry.entry_date).toISOString().slice(0, 10) : "",
        notas: editingEntry.notes || "",
      },
      despues: { cantidad: `${newQuantity} ${unidad}`.trim(), remito: editRemito || "", fecha: editDate || "", notas: editNotes || "" },
      etiquetas: { cantidad: "Cantidad", remito: "Remito", fecha: "Fecha", notas: "Notas" },
      extra: {
        Material: editingEntry.materials?.name || "-",
        Stock: Math.abs(quantityDiff) > 0.0001 ? (stockError ? "NO se pudo corregir" : `corregido (${quantityDiff > 0 ? "+" : ""}${Math.round(quantityDiff * 1000) / 1000})`) : "sin cambios",
      },
      motivo: motivo.trim(),
    })

    if (stockError) {
      console.error("Error ajustando stock del ingreso:", stockError)
      toast({ title: "Error", description: "El ingreso se actualizó pero no se pudo corregir el stock. Avisá para revisarlo.", variant: "destructive" })
    } else {
      toast({ title: "Ingreso actualizado", description: Math.abs(quantityDiff) > 0.0001 ? "El stock fue ajustado" : undefined })
    }
    onRefresh?.()
    setEditingEntry(null)
    setSaving(false)
  }

  function openEdit(entry: StockEntry) {
    setMotivo("")
    setEditingEntry(entry)
    setEditQuantity(entry.quantity.toString())
    setEditRemito(entry.remito || "")
    setEditNotes(entry.notes || "")
    // yyyy-MM-dd en UTC, igual criterio que formatDate
    setEditDate(entry.entry_date ? new Date(entry.entry_date).toISOString().slice(0, 10) : "")
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
                        +{entry.quantity.toLocaleString("es-AR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
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
                      {(puedeEditar || puedeBorrar) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {puedeEditar && (
                              <DropdownMenuItem onClick={() => openEdit(entry)}>
                                <Pencil className="h-4 w-4 mr-2" />
                                Editar
                              </DropdownMenuItem>
                            )}
                            {puedeBorrar && (
                              <DropdownMenuItem onClick={() => setDeleteEntry(entry)} className="text-destructive">
                                <Trash2 className="h-4 w-4 mr-2" />
                                Eliminar
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
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
                <Label>Fecha de ingreso</Label>
                <Input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                />
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
              <CampoMotivo value={motivo} onChange={setMotivo} id="motivo-ingreso" />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingEntry(null)}>Cancelar</Button>
            <Button onClick={handleUpdate} disabled={saving || !motivoValido(motivo)}>
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Eliminar: con motivo (fase 0c-1) */}
      <ConfirmarConMotivo
        open={!!deleteEntry}
        onOpenChange={(open) => !open && setDeleteEntry(null)}
        titulo="Eliminar Ingreso"
        descripcion={
          deleteEntry && (
            <div>
              <span>El stock del material se ajusta solo. Queda una copia en Actividad y se avisa por mail.</span>
              <div className="mt-2 p-2 bg-muted rounded text-sm">
                <div><strong>Material:</strong> {deleteEntry.materials.name}</div>
                <div><strong>Cantidad:</strong> {deleteEntry.quantity.toLocaleString("es-AR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} {deleteEntry.materials.unit}</div>
                <div><strong>Proveedor:</strong> {deleteEntry.suppliers?.name || "-"}</div>
                <div><strong>Remito:</strong> {deleteEntry.remito || "-"}</div>
              </div>
            </div>
          )
        }
        textoBoton="Eliminar"
        onConfirmar={handleDelete}
      />
    </>
  )
}
