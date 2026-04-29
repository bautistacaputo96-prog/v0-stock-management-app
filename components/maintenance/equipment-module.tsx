"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Edit2, Truck } from "lucide-react"

interface Equipment {
  id: number
  plant: string
  nombre: string
  tipo: string
  marca: string | null
  modelo: string | null
  anio: number | null
  nro_serie: string | null
  horometro_actual: number
  fecha_ultimo_horometro: string | null
  status: string
}

interface EquipmentModuleProps {
  plant: string
}

const TIPOS = [
  { value: "autoelevador", label: "Autoelevador" },
  { value: "pala", label: "Pala Cargadora" },
  { value: "compresor", label: "Compresor" },
  { value: "generador", label: "Generador" },
  { value: "otro", label: "Otro" },
]

const STATUS_LABELS: Record<string, string> = {
  activo: "Activo",
  fuera_servicio: "Fuera de servicio",
  baja: "Baja",
}

const STATUS_COLORS: Record<string, string> = {
  activo: "bg-green-100 text-green-800",
  fuera_servicio: "bg-red-100 text-red-800",
  baja: "bg-gray-100 text-gray-600",
}

const EMPTY_FORM = {
  nombre: "",
  tipo: "autoelevador",
  marca: "",
  modelo: "",
  anio: "",
  nro_serie: "",
  horometro_actual: "0",
  status: "activo",
}

export function EquipmentModule({ plant }: EquipmentModuleProps) {
  const [equipment, setEquipment] = useState<Equipment[]>([])
  const [loading, setLoading] = useState(true)
  const [showDialog, setShowDialog] = useState(false)
  const [editItem, setEditItem] = useState<Equipment | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const supabase = createClient()

  useEffect(() => { loadEquipment() }, [plant])

  async function loadEquipment() {
    setLoading(true)
    const { data } = await supabase
      .from("maintenance_equipment")
      .select("*")
      .eq("plant", plant)
      .order("tipo")
      .order("nombre")
    setEquipment(data || [])
    setLoading(false)
  }

  function openAdd() {
    setEditItem(null)
    setForm(EMPTY_FORM)
    setShowDialog(true)
  }

  function openEdit(item: Equipment) {
    setEditItem(item)
    setForm({
      nombre: item.nombre,
      tipo: item.tipo,
      marca: item.marca || "",
      modelo: item.modelo || "",
      anio: item.anio?.toString() || "",
      nro_serie: item.nro_serie || "",
      horometro_actual: item.horometro_actual.toString(),
      status: item.status,
    })
    setShowDialog(true)
  }

  async function handleSave() {
    if (!form.nombre.trim()) return
    setSaving(true)
    try {
      const payload = {
        plant,
        nombre: form.nombre.trim(),
        tipo: form.tipo,
        marca: form.marca || null,
        modelo: form.modelo || null,
        anio: form.anio ? parseInt(form.anio) : null,
        nro_serie: form.nro_serie || null,
        horometro_actual: parseFloat(form.horometro_actual) || 0,
        status: form.status,
      }

      if (editItem) {
        await supabase.from("maintenance_equipment").update(payload).eq("id", editItem.id)
      } else {
        const { data: newEquip, error } = await supabase
          .from("maintenance_equipment")
          .insert(payload)
          .select()
          .single()

        // Auto-create 250hs service program for forklifts
        if (!error && newEquip && form.tipo === "autoelevador") {
          await supabase.from("maintenance_service_programs").insert({
            equipment_id: newEquip.id,
            nombre: "Service 250hs",
            intervalo_horas: 250,
            modo: "horas",
            descripcion: "Service preventivo estándar cada 250 horas",
          })
        }
      }

      setShowDialog(false)
      loadEquipment()
    } finally {
      setSaving(false)
    }
  }

  // Group by type for display
  const byTipo = TIPOS.map(t => ({
    ...t,
    items: equipment.filter(e => e.tipo === t.value),
  })).filter(g => g.items.length > 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg">Equipos de la planta</h3>
          <p className="text-sm text-muted-foreground">
            Los autoelevadores reciben un programa de service de 250hs automáticamente
          </p>
        </div>
        <Dialog open={showDialog} onOpenChange={v => { setShowDialog(v); if (!v) setEditItem(null) }}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openAdd}>
              <Plus className="h-4 w-4 mr-1" /> Agregar Equipo
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editItem ? "Editar Equipo" : "Nuevo Equipo"}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3 py-2">
              <div className="col-span-2 space-y-1">
                <Label>Nombre interno *</Label>
                <Input
                  value={form.nombre}
                  onChange={e => setForm({ ...form, nombre: e.target.value })}
                  placeholder="Ej: AE-01, Pala Silke"
                />
              </div>
              <div className="space-y-1">
                <Label>Tipo *</Label>
                <Select value={form.tipo} onValueChange={v => setForm({ ...form, tipo: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIPOS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="activo">Activo</SelectItem>
                    <SelectItem value="fuera_servicio">Fuera de Servicio</SelectItem>
                    <SelectItem value="baja">Baja</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Marca</Label>
                <Input value={form.marca} onChange={e => setForm({ ...form, marca: e.target.value })} placeholder="Toyota, Lonking..." />
              </div>
              <div className="space-y-1">
                <Label>Modelo</Label>
                <Input value={form.modelo} onChange={e => setForm({ ...form, modelo: e.target.value })} placeholder="FD30, CDM833N..." />
              </div>
              <div className="space-y-1">
                <Label>Año</Label>
                <Input type="number" value={form.anio} onChange={e => setForm({ ...form, anio: e.target.value })} placeholder="2020" />
              </div>
              <div className="space-y-1">
                <Label>Nro. de Serie</Label>
                <Input value={form.nro_serie} onChange={e => setForm({ ...form, nro_serie: e.target.value })} />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Horómetro actual (hs)</Label>
                <Input
                  type="number"
                  value={form.horometro_actual}
                  onChange={e => setForm({ ...form, horometro_actual: e.target.value })}
                />
              </div>
              {form.tipo === "autoelevador" && !editItem && (
                <div className="col-span-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
                  ✓ Se creará automáticamente un programa de service cada <strong>250 hs</strong>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDialog(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={!form.nombre.trim() || saving}>
                {saving ? "Guardando..." : "Guardar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Cargando equipos...</CardContent></Card>
      ) : equipment.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <Truck className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>No hay equipos cargados.</p>
            <p className="text-xs mt-1">Agregá el primero con el botón de arriba.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {byTipo.map(group => (
            <Card key={group.value}>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  {group.label} ({group.items.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Marca / Modelo</TableHead>
                      <TableHead>Año</TableHead>
                      <TableHead>Nro. Serie</TableHead>
                      <TableHead className="text-right">Horómetro</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.items.map(eq => (
                      <TableRow key={eq.id}>
                        <TableCell className="font-medium">{eq.nombre}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {[eq.marca, eq.modelo].filter(Boolean).join(" ") || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">{eq.anio || "—"}</TableCell>
                        <TableCell className="text-muted-foreground text-sm font-mono text-xs">{eq.nro_serie || "—"}</TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          {eq.horometro_actual.toLocaleString("es-AR")} hs
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[eq.status] || "bg-gray-100 text-gray-600"}`}>
                            {STATUS_LABELS[eq.status] || eq.status}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => openEdit(eq)}>
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
