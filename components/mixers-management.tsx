"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { Plus, Pencil, Truck, Search, CheckCircle, XCircle, Wrench, AlertTriangle, Trash2 } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"

type Mixer = {
  id: string
  license_plate: string
  brand: string | null
  capacity_m3: number
  model: string | null
  status: string
  active: boolean
  plant_id: string | null
}

const STATUS_OPTIONS = [
  { value: "available", label: "Disponible", color: "bg-green-500", icon: CheckCircle },
  { value: "in_transit", label: "En Transito", color: "bg-blue-500", icon: Truck },
  { value: "maintenance", label: "En Mantenimiento", color: "bg-yellow-500", icon: Wrench },
  { value: "unavailable", label: "No Disponible", color: "bg-red-500", icon: XCircle },
]

export function MixersManagement() {
  const [mixers, setMixers] = useState<Mixer[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingMixer, setEditingMixer] = useState<Mixer | null>(null)
  const [deleteMixerConfirm, setDeleteMixerConfirm] = useState<Mixer | null>(null)
  const [deleteMixerStep, setDeleteMixerStep] = useState(1)
  const { toast } = useToast()

  const [form, setForm] = useState({
    license_plate: "",
    brand: "",
    capacity_m3: "8",
    model: "",
    status: "available",
  })

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const supabase = createClient()

    const { data, error } = await supabase
      .from("mixers")
      .select("*")
      .eq("active", true)
      .order("license_plate")

    if (error) {
      toast({ title: "Error", description: "No se pudieron cargar los camiones", variant: "destructive" })
    } else {
      setMixers(data || [])
    }

    setLoading(false)
  }

  const filteredMixers = mixers.filter((m) => {
    const matchesSearch =
      m.license_plate?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.brand?.toLowerCase().includes(searchTerm.toLowerCase())

    const matchesStatus = statusFilter === "all" || m.status === statusFilter

    return matchesSearch && matchesStatus
  })

  const statusCounts = {
    all: mixers.length,
    available: mixers.filter((m) => m.status === "available").length,
    in_transit: mixers.filter((m) => m.status === "in_transit").length,
    maintenance: mixers.filter((m) => m.status === "maintenance").length,
    unavailable: mixers.filter((m) => m.status === "unavailable").length,
  }

  async function handleSave() {
    const supabase = createClient()

    const data = {
      license_plate: form.license_plate,
      brand: form.brand || null,
      capacity_m3: parseFloat(form.capacity_m3) || 8,
      model: form.model || null,
      status: form.status,
    }

    if (editingMixer) {
      const { error } = await supabase.from("mixers").update(data).eq("id", editingMixer.id)

      if (error) {
        toast({ title: "Error", description: "No se pudo actualizar el camion", variant: "destructive" })
        return
      }
      toast({ title: "Camion actualizado" })
    } else {
      const { error } = await supabase.from("mixers").insert(data)

      if (error) {
        toast({ title: "Error", description: "No se pudo crear el camion", variant: "destructive" })
        return
      }
      toast({ title: "Camion creado" })
    }

    setIsDialogOpen(false)
    setEditingMixer(null)
    setForm({ license_plate: "", brand: "", capacity_m3: "8", model: "", status: "available" })
    loadData()
  }

  async function updateStatus(mixer: Mixer, newStatus: string) {
    const supabase = createClient()
    const { error } = await supabase.from("mixers").update({ status: newStatus }).eq("id", mixer.id)

    if (error) {
      toast({ title: "Error", description: "No se pudo actualizar el estado", variant: "destructive" })
    } else {
      loadData()
    }
  }

  function openEdit(mixer: Mixer) {
    setEditingMixer(mixer)
    setForm({
      license_plate: mixer.license_plate || "",
      brand: mixer.brand || "",
      capacity_m3: mixer.capacity_m3?.toString() || "8",
      model: mixer.model || "",
      status: mixer.status || "available",
    })
    setIsDialogOpen(true)
  }

  function getStatusBadge(status: string) {
    const opt = STATUS_OPTIONS.find((s) => s.value === status)
    if (!opt) return <Badge variant="outline">{status}</Badge>

    const Icon = opt.icon
    return (
      <Badge className={`${opt.color} text-white gap-1`}>
        <Icon className="h-3 w-3" />
        {opt.label}
      </Badge>
    )
  }

  function startDeleteMixer(mixer: Mixer) {
    setDeleteMixerConfirm(mixer)
    setDeleteMixerStep(1)
  }

  async function confirmDeleteMixer() {
    if (deleteMixerStep === 1) {
      setDeleteMixerStep(2)
      return
    }

    if (!deleteMixerConfirm) return
    const supabase = createClient()

    // Soft delete - set active to false
    const { error } = await supabase
      .from("mixers")
      .update({ active: false })
      .eq("id", deleteMixerConfirm.id)

    if (error) {
      toast({ title: "Error", description: "No se pudo eliminar el camion", variant: "destructive" })
      return
    }

    toast({ title: "Camion eliminado" })
    setDeleteMixerConfirm(null)
    setDeleteMixerStep(1)
    loadData()
  }

  if (loading) {
    return <div className="flex items-center justify-center py-8">Cargando...</div>
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {[
          { key: "all", label: "Total", icon: Truck },
          { key: "available", label: "Disponibles", icon: CheckCircle },
          { key: "in_transit", label: "En Transito", icon: Truck },
          { key: "maintenance", label: "Mantenimiento", icon: Wrench },
          { key: "unavailable", label: "No Disponibles", icon: XCircle },
        ].map((stat) => {
          const Icon = stat.icon
          return (
            <Card
              key={stat.key}
              className={`cursor-pointer transition-colors ${statusFilter === stat.key ? "ring-2 ring-primary" : ""}`}
              onClick={() => setStatusFilter(stat.key)}
            >
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-2xl font-bold">{statusCounts[stat.key as keyof typeof statusCounts]}</p>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Search and Add */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por patente o marca..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          onClick={() => {
            setEditingMixer(null)
            setForm({ license_plate: "", brand: "", capacity_m3: "8", model: "", status: "available" })
            setIsDialogOpen(true)
          }}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          Nuevo Camion
        </Button>
      </div>

      {/* Mixer cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredMixers.map((mixer) => (
          <Card key={mixer.id} className="relative">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-lg">{mixer.license_plate}</CardTitle>
                  {mixer.brand && <p className="text-sm text-muted-foreground">{mixer.brand}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(mixer)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => startDeleteMixer(mixer)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Capacidad</span>
                <span className="font-medium">{mixer.capacity_m3} m3</span>
              </div>
              {mixer.model && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Modelo</span>
                  <span className="text-sm">{mixer.model}</span>
                </div>
              )}
              <div className="pt-2 border-t">
                <div className="flex items-center justify-between">
                  {getStatusBadge(mixer.status)}
                  <Select value={mixer.status} onValueChange={(value) => updateStatus(mixer, value)}>
                    <SelectTrigger className="w-[130px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredMixers.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">No se encontraron camiones</div>
      )}

      {/* Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingMixer ? "Editar Camion" : "Nuevo Camion"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Patente *</Label>
                <Input
                  value={form.license_plate}
                  onChange={(e) => setForm({ ...form, license_plate: e.target.value })}
                  placeholder="Ej: ABC123"
                />
              </div>
              <div className="space-y-2">
                <Label>Marca</Label>
                <Input
                  value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                  placeholder="Ej: IVECO"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Capacidad (m3)</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={form.capacity_m3}
                  onChange={(e) => setForm({ ...form, capacity_m3: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Modelo</Label>
                <Input
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder="Ej: Trakker"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Estado</Label>
              <Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={!form.license_plate}>
              {editingMixer ? "Guardar" : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
