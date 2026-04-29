"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Plus, Trash2, Wrench, Package, Eye } from "lucide-react"

interface Equipment {
  id: number
  nombre: string
  tipo: string
}

interface InventoryItem {
  id: number
  name: string
  code: string | null
  unit: string
  current_stock: number
}

interface WorkItem {
  equipment_id: string
  tipo: string
  compartimento: string
  descripcion: string
}

interface WorkSupply {
  inventory_item_id: string
  item_nombre: string
  cantidad: string
  unidad: string
  comentario: string
}

interface HistoryWorkItem {
  id: number
  tipo: string
  compartimento: string | null
  descripcion: string
  equipment?: { nombre: string }
}

interface HistorySupply {
  id: number
  item_nombre: string | null
  cantidad: number
  unidad: string | null
  comentario: string | null
  inventory_item?: { name: string; unit: string }
}

interface HistoryParte {
  id: number
  fecha: string
  operario: string
  descripcion_general: string | null
  work_items: HistoryWorkItem[]
  work_supplies: HistorySupply[]
}

interface WorkParteModuleProps {
  plant: string
}

const COMPARTIMENTOS = [
  "Motor", "Sistema Hidráulico", "Transmisión", "Frenos",
  "Mástil / Elevación", "Eléctrico", "Neumáticos / Ruedas",
  "Chasis / Estructura", "Cabina", "General",
]

const TIPOS_TRABAJO = [
  { value: "preventivo", label: "Preventivo", color: "bg-blue-100 text-blue-800" },
  { value: "correctivo", label: "Correctivo", color: "bg-orange-100 text-orange-800" },
  { value: "inspeccion", label: "Inspección", color: "bg-purple-100 text-purple-800" },
  { value: "otro", label: "Otro", color: "bg-gray-100 text-gray-700" },
]

export function WorkParteModule({ plant }: WorkParteModuleProps) {
  const [equipment, setEquipment] = useState<Equipment[]>([])
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [history, setHistory] = useState<HistoryParte[]>([])
  const [saving, setSaving] = useState(false)
  const [viewParte, setViewParte] = useState<HistoryParte | null>(null)

  const [fecha, setFecha] = useState(new Date().toISOString().split("T")[0])
  const [operario, setOperario] = useState("")
  const [descripcionGeneral, setDescripcionGeneral] = useState("")
  const [workItems, setWorkItems] = useState<WorkItem[]>([])
  const [workSupplies, setWorkSupplies] = useState<WorkSupply[]>([])

  const supabase = createClient()

  useEffect(() => { loadData() }, [plant])

  async function loadData() {
    setLoading(true)
    const [{ data: equips }, { data: inv }, { data: hist }] = await Promise.all([
      supabase.from("maintenance_equipment").select("id, nombre, tipo").eq("plant", plant).neq("status", "baja").order("nombre"),
      supabase.from("maintenance_inventory").select("id, name, code, unit, current_stock").eq("plant", plant).gt("current_stock", 0).order("name"),
      supabase.from("maintenance_work_parte")
        .select(`
          *,
          work_items:maintenance_work_items(*, equipment:maintenance_equipment(nombre)),
          work_supplies:maintenance_work_supplies(*, inventory_item:maintenance_inventory(name, unit))
        `)
        .eq("plant", plant)
        .order("fecha", { ascending: false })
        .limit(30),
    ])
    setEquipment(equips || [])
    setInventoryItems(inv || [])
    setHistory(hist || [])
    setLoading(false)
  }

  function addWorkItem() {
    setWorkItems(prev => [...prev, { equipment_id: "", tipo: "correctivo", compartimento: "", descripcion: "" }])
  }

  function updateWorkItem(idx: number, field: keyof WorkItem, value: string) {
    setWorkItems(prev => { const u = [...prev]; u[idx] = { ...u[idx], [field]: value }; return u })
  }

  function removeWorkItem(idx: number) {
    setWorkItems(prev => prev.filter((_, i) => i !== idx))
  }

  function addSupply() {
    setWorkSupplies(prev => [...prev, { inventory_item_id: "", item_nombre: "", cantidad: "1", unidad: "", comentario: "" }])
  }

  function updateSupply(idx: number, field: keyof WorkSupply, value: string) {
    setWorkSupplies(prev => { const u = [...prev]; u[idx] = { ...u[idx], [field]: value }; return u })
  }

  function removeSupply(idx: number) {
    setWorkSupplies(prev => prev.filter((_, i) => i !== idx))
  }

  function selectSupplyItem(idx: number, itemId: string) {
    const inv = inventoryItems.find(i => i.id === parseInt(itemId))
    setWorkSupplies(prev => {
      const u = [...prev]
      u[idx] = { ...u[idx], inventory_item_id: itemId, item_nombre: inv?.name || "", unidad: inv?.unit || "" }
      return u
    })
  }

  async function handleSave() {
    if (!operario.trim()) { alert("Ingresá el nombre del operario"); return }
    if (workItems.length === 0 && workSupplies.length === 0) {
      alert("Agregá al menos un trabajo o insumo realizado")
      return
    }
    const invalidItems = workItems.filter(wi => !wi.descripcion.trim())
    if (invalidItems.length > 0) { alert("Completá la descripción de todos los trabajos"); return }

    setSaving(true)
    try {
      const { data: parte, error } = await supabase
        .from("maintenance_work_parte")
        .insert({ plant, fecha, operario, descripcion_general: descripcionGeneral || null })
        .select().single()
      if (error) throw error

      if (workItems.length > 0) {
        await supabase.from("maintenance_work_items").insert(
          workItems.map(wi => ({
            parte_id: parte.id,
            equipment_id: wi.equipment_id ? parseInt(wi.equipment_id) : null,
            tipo: wi.tipo,
            compartimento: wi.compartimento || null,
            descripcion: wi.descripcion,
          }))
        )
      }

      for (const s of workSupplies) {
        const invItem = s.inventory_item_id
          ? inventoryItems.find(i => i.id === parseInt(s.inventory_item_id))
          : null
        const qty = parseFloat(s.cantidad) || 1

        await supabase.from("maintenance_work_supplies").insert({
          parte_id: parte.id,
          inventory_item_id: invItem?.id || null,
          item_nombre: invItem?.name || s.item_nombre || null,
          cantidad: qty,
          unidad: invItem?.unit || s.unidad || null,
          comentario: s.comentario || null,
        })

        // Deduct from pañol
        if (invItem) {
          const newStock = Math.max(0, invItem.current_stock - qty)
          await supabase.from("maintenance_inventory").update({ current_stock: newStock }).eq("id", invItem.id)
          await supabase.from("maintenance_stock_movements").insert({
            item_id: invItem.id,
            movement_type: "salida",
            quantity: qty,
            previous_stock: invItem.current_stock,
            new_stock: newStock,
            reason: `Parte Taller - ${operario}${s.comentario ? `: ${s.comentario}` : ""}`,
            created_by: operario,
          })
        }
      }

      setOperario("")
      setDescripcionGeneral("")
      setWorkItems([])
      setWorkSupplies([])
      loadData()
    } catch (err) {
      console.error(err)
      alert("Error al guardar el parte")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Card><CardContent className="py-10 text-center text-muted-foreground">Cargando...</CardContent></Card>

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Parte de Taller
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Header */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Fecha *</Label>
              <Input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Operario *</Label>
              <Input value={operario} onChange={e => setOperario(e.target.value)} placeholder="Nombre del operario de mantenimiento" />
            </div>
            <div className="space-y-1">
              <Label>Descripción general del día</Label>
              <Input value={descripcionGeneral} onChange={e => setDescripcionGeneral(e.target.value)} placeholder="Resumen (opcional)" />
            </div>
          </div>

          {/* Work Items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">Trabajos realizados</Label>
              <Button type="button" variant="outline" size="sm" onClick={addWorkItem}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Agregar trabajo
              </Button>
            </div>
            {workItems.length === 0 ? (
              <div className="border rounded-lg p-5 text-center text-sm text-muted-foreground bg-muted/20">
                No hay trabajos agregados. Hacé clic en "Agregar trabajo".
              </div>
            ) : (
              <div className="space-y-2">
                {workItems.map((wi, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 p-3 border rounded-lg bg-muted/10 items-end">
                    <div className="col-span-3">
                      <Label className="text-xs mb-1">Equipo</Label>
                      <Select value={wi.equipment_id} onValueChange={v => updateWorkItem(idx, "equipment_id", v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Sin equipo específico" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">General</SelectItem>
                          {equipment.map(eq => (
                            <SelectItem key={eq.id} value={String(eq.id)}>{eq.nombre}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs mb-1">Tipo</Label>
                      <Select value={wi.tipo} onValueChange={v => updateWorkItem(idx, "tipo", v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {TIPOS_TRABAJO.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs mb-1">Compartimento</Label>
                      <Select value={wi.compartimento} onValueChange={v => updateWorkItem(idx, "compartimento", v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Opcional" /></SelectTrigger>
                        <SelectContent>
                          {COMPARTIMENTOS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-4">
                      <Label className="text-xs mb-1">Descripción *</Label>
                      <Input
                        className="h-8 text-xs"
                        value={wi.descripcion}
                        onChange={e => updateWorkItem(idx, "descripcion", e.target.value)}
                        placeholder="Qué se hizo..."
                      />
                    </div>
                    <div className="col-span-1">
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => removeWorkItem(idx)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Supplies */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base font-semibold">Insumos / Repuestos utilizados</Label>
                <p className="text-xs text-muted-foreground">Se descuenta automáticamente del pañol</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addSupply}>
                <Package className="h-3.5 w-3.5 mr-1" /> Agregar insumo
              </Button>
            </div>
            {workSupplies.length === 0 ? (
              <div className="border rounded-lg p-5 text-center text-sm text-muted-foreground bg-muted/20">
                Sin insumos registrados.
              </div>
            ) : (
              <div className="space-y-2">
                {workSupplies.map((s, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 p-3 border rounded-lg bg-muted/10 items-end">
                    <div className="col-span-5">
                      <Label className="text-xs mb-1">Item del pañol</Label>
                      <Select value={s.inventory_item_id} onValueChange={v => selectSupplyItem(idx, v)}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Seleccionar del pañol..." />
                        </SelectTrigger>
                        <SelectContent>
                          {inventoryItems.length === 0 ? (
                            <SelectItem value="" disabled>Sin stock disponible</SelectItem>
                          ) : (
                            inventoryItems.map(i => (
                              <SelectItem key={i.id} value={String(i.id)}>
                                {i.name}{i.code ? ` (${i.code})` : ""} — Stock: {i.current_stock} {i.unit}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs mb-1">Cantidad</Label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          className="h-8 text-xs"
                          value={s.cantidad}
                          onChange={e => updateSupply(idx, "cantidad", e.target.value)}
                          min="0.01"
                          step="0.01"
                        />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">{s.unidad}</span>
                      </div>
                    </div>
                    <div className="col-span-4">
                      <Label className="text-xs mb-1">Comentario</Label>
                      <Input
                        className="h-8 text-xs"
                        value={s.comentario}
                        onChange={e => updateSupply(idx, "comentario", e.target.value)}
                        placeholder="Dónde se usó, observación..."
                      />
                    </div>
                    <div className="col-span-1">
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => removeSupply(idx)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end pt-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Guardando..." : "Guardar Parte de Taller"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* History */}
      {history.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground font-medium">Historial de partes de taller</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Operario</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="text-center">Trabajos</TableHead>
                  <TableHead className="text-center">Insumos</TableHead>
                  <TableHead className="text-center">Ver</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map(h => (
                  <TableRow key={h.id}>
                    <TableCell className="font-medium">
                      {new Date(h.fecha + "T12:00:00").toLocaleDateString("es-AR")}
                    </TableCell>
                    <TableCell>{h.operario}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{h.descripcion_general || "—"}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary">{h.work_items?.length || 0}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary">{h.work_supplies?.length || 0}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Button variant="ghost" size="icon" onClick={() => setViewParte(h)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* View Detail Dialog */}
      <Dialog open={!!viewParte} onOpenChange={v => !v && setViewParte(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Parte de Taller — {viewParte && new Date(viewParte.fecha + "T12:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
            </DialogTitle>
          </DialogHeader>
          {viewParte && (
            <div className="space-y-4">
              <div className="p-3 bg-muted/20 rounded-lg text-sm flex flex-wrap gap-4">
                <span><strong>Operario:</strong> {viewParte.operario}</span>
                {viewParte.descripcion_general && <span><strong>Descripción:</strong> {viewParte.descripcion_general}</span>}
              </div>

              {viewParte.work_items?.length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
                    <Wrench className="h-4 w-4" /> Trabajos realizados
                  </h4>
                  <div className="space-y-1.5">
                    {viewParte.work_items.map(wi => {
                      const tipoInfo = TIPOS_TRABAJO.find(t => t.value === wi.tipo)
                      return (
                        <div key={wi.id} className="flex items-start gap-2 text-sm p-2 border rounded-lg">
                          <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${tipoInfo?.color || "bg-gray-100"}`}>
                            {tipoInfo?.label || wi.tipo}
                          </span>
                          {wi.equipment && (
                            <span className="text-muted-foreground shrink-0 font-medium">{wi.equipment.nombre}</span>
                          )}
                          {wi.compartimento && (
                            <span className="text-muted-foreground shrink-0 text-xs">· {wi.compartimento}</span>
                          )}
                          <span>{wi.descripcion}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {viewParte.work_supplies?.length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
                    <Package className="h-4 w-4" /> Insumos utilizados
                  </h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Cantidad</TableHead>
                        <TableHead>Comentario</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {viewParte.work_supplies.map(s => (
                        <TableRow key={s.id}>
                          <TableCell>{s.inventory_item?.name || s.item_nombre || "—"}</TableCell>
                          <TableCell className="text-right font-mono">
                            {s.cantidad} {s.inventory_item?.unit || s.unidad || ""}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">{s.comentario || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewParte(null)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
