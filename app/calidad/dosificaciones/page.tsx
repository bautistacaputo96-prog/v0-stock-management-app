"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Plus, Edit2, History, FileText, AlertTriangle, CheckCircle2, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"

const PIPE_DIAMETERS = [300, 400, 500, 600, 800, 1000, 1200]

interface MixDesign {
  id: string
  diameter: number
  version: number
  is_active: boolean
  cement_kg: number
  sand_kg: number
  stone_0_10_kg: number
  stone_0_20_kg: number
  water_liters: number
  additive_ml: number | null
  additive_type: string | null
  total_weight_kg: number
  observations: string | null
  approved_by: string | null
  approved_at: string | null
  created_at: string
}

interface MixHistory {
  id: string
  mix_design_id: string
  changed_by: string
  change_type: string
  previous_values: any
  new_values: any
  reason: string | null
  created_at: string
}

export default function DosificacionesPage() {
  const supabase = createClient()
  const [mixDesigns, setMixDesigns] = useState<MixDesign[]>([])
  const [history, setHistory] = useState<MixHistory[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDiameter, setSelectedDiameter] = useState<number | "all">("all")
  const [showDialog, setShowDialog] = useState(false)
  const [showHistoryDialog, setShowHistoryDialog] = useState(false)
  const [editingMix, setEditingMix] = useState<MixDesign | null>(null)
  const [historyMixId, setHistoryMixId] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    diameter: 300,
    cement_kg: 0,
    sand_kg: 0,
    stone_0_10_kg: 0,
    stone_0_20_kg: 0,
    water_liters: 0,
    additive_ml: 0,
    additive_type: "",
    observations: "",
    change_reason: "",
  })

  useEffect(() => {
    loadMixDesigns()
  }, [])

  async function loadMixDesigns() {
    setLoading(true)
    const { data, error } = await supabase
      .from("pipe_mix_designs")
      .select("*")
      .order("diameter", { ascending: true })
      .order("version", { ascending: false })

    if (!error && data) {
      setMixDesigns(data)
    }
    setLoading(false)
  }

  async function loadHistory(mixId: string) {
    const { data, error } = await supabase
      .from("pipe_mix_design_history")
      .select("*")
      .eq("mix_design_id", mixId)
      .order("created_at", { ascending: false })

    if (!error && data) {
      setHistory(data)
    }
    setHistoryMixId(mixId)
    setShowHistoryDialog(true)
  }

  function calculateTotalWeight() {
    return formData.cement_kg + formData.sand_kg + formData.stone_0_10_kg + formData.stone_0_20_kg + (formData.water_liters * 1)
  }

  async function handleSubmit() {
    const totalWeight = calculateTotalWeight()

    if (editingMix) {
      // Update existing - create new version
      const { data: newMix, error } = await supabase
        .from("pipe_mix_designs")
        .insert({
          diameter: editingMix.diameter,
          version: editingMix.version + 1,
          is_active: true,
          cement_kg: formData.cement_kg,
          sand_kg: formData.sand_kg,
          stone_0_10_kg: formData.stone_0_10_kg,
          stone_0_20_kg: formData.stone_0_20_kg,
          water_liters: formData.water_liters,
          additive_ml: formData.additive_ml || null,
          additive_type: formData.additive_type || null,
          total_weight_kg: totalWeight,
          observations: formData.observations || null,
        })
        .select()
        .single()

      if (error) {
        toast.error("Error al crear nueva version")
        return
      }

      // Deactivate old version
      await supabase
        .from("pipe_mix_designs")
        .update({ is_active: false })
        .eq("id", editingMix.id)

      // Record history
      await supabase.from("pipe_mix_design_history").insert({
        mix_design_id: newMix.id,
        changed_by: "Usuario",
        change_type: "version_update",
        previous_values: {
          cement_kg: editingMix.cement_kg,
          sand_kg: editingMix.sand_kg,
          stone_0_10_kg: editingMix.stone_0_10_kg,
          stone_0_20_kg: editingMix.stone_0_20_kg,
          water_liters: editingMix.water_liters,
        },
        new_values: {
          cement_kg: formData.cement_kg,
          sand_kg: formData.sand_kg,
          stone_0_10_kg: formData.stone_0_10_kg,
          stone_0_20_kg: formData.stone_0_20_kg,
          water_liters: formData.water_liters,
        },
        reason: formData.change_reason || null,
      })

      toast.success(`Dosificacion CC${editingMix.diameter} actualizada a version ${editingMix.version + 1}`)
    } else {
      // Create new
      const existingVersions = mixDesigns.filter(m => m.diameter === formData.diameter)
      const maxVersion = existingVersions.length > 0 ? Math.max(...existingVersions.map(m => m.version)) : 0

      // Deactivate all existing for this diameter
      if (existingVersions.length > 0) {
        await supabase
          .from("pipe_mix_designs")
          .update({ is_active: false })
          .eq("diameter", formData.diameter)
      }

      const { error } = await supabase.from("pipe_mix_designs").insert({
        diameter: formData.diameter,
        version: maxVersion + 1,
        is_active: true,
        cement_kg: formData.cement_kg,
        sand_kg: formData.sand_kg,
        stone_0_10_kg: formData.stone_0_10_kg,
        stone_0_20_kg: formData.stone_0_20_kg,
        water_liters: formData.water_liters,
        additive_ml: formData.additive_ml || null,
        additive_type: formData.additive_type || null,
        total_weight_kg: totalWeight,
        observations: formData.observations || null,
      })

      if (error) {
        toast.error("Error al crear dosificacion")
        return
      }

      toast.success(`Dosificacion CC${formData.diameter} creada`)
    }

    setShowDialog(false)
    setEditingMix(null)
    resetForm()
    loadMixDesigns()
  }

  function resetForm() {
    setFormData({
      diameter: 300,
      cement_kg: 0,
      sand_kg: 0,
      stone_0_10_kg: 0,
      stone_0_20_kg: 0,
      water_liters: 0,
      additive_ml: 0,
      additive_type: "",
      observations: "",
      change_reason: "",
    })
  }

  function openEdit(mix: MixDesign) {
    setEditingMix(mix)
    setFormData({
      diameter: mix.diameter,
      cement_kg: mix.cement_kg,
      sand_kg: mix.sand_kg,
      stone_0_10_kg: mix.stone_0_10_kg,
      stone_0_20_kg: mix.stone_0_20_kg,
      water_liters: mix.water_liters,
      additive_ml: mix.additive_ml || 0,
      additive_type: mix.additive_type || "",
      observations: mix.observations || "",
      change_reason: "",
    })
    setShowDialog(true)
  }

  const activeMixes = mixDesigns.filter(m => m.is_active)
  const filteredMixes = selectedDiameter === "all" 
    ? activeMixes 
    : activeMixes.filter(m => m.diameter === selectedDiameter)

  // Calculate proportions for a mix
  function getProportions(mix: MixDesign) {
    const cement = mix.cement_kg
    if (cement === 0) return { sand: 0, stone010: 0, stone020: 0 }
    return {
      sand: (mix.sand_kg / cement).toFixed(2),
      stone010: (mix.stone_0_10_kg / cement).toFixed(2),
      stone020: (mix.stone_0_20_kg / cement).toFixed(2),
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/calidad" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold">Dosificaciones de Mezcla</h1>
            <p className="text-sm text-muted-foreground">Gestión de fórmulas por diámetro de caño</p>
          </div>
        </div>
        <Dialog open={showDialog} onOpenChange={(open) => { setShowDialog(open); if (!open) { setEditingMix(null); resetForm(); } }}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Plus className="h-4 w-4" />
                  Nueva Dosificación
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>{editingMix ? `Editar Dosificación CC${editingMix.diameter}` : "Nueva Dosificación"}</DialogTitle>
                  <DialogDescription>
                    {editingMix ? "Se creará una nueva versión manteniendo el historial" : "Defina la fórmula de mezcla para un diámetro"}
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                  {!editingMix && (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Diámetro</Label>
                        <Select value={String(formData.diameter)} onValueChange={(v) => setFormData({ ...formData, diameter: Number(v) })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PIPE_DIAMETERS.map(d => (
                              <SelectItem key={d} value={String(d)}>CC{d}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-2">
                      <Label>Cemento (kg)</Label>
                      <Input
                        type="number"
                        value={formData.cement_kg || ""}
                        onChange={(e) => setFormData({ ...formData, cement_kg: Number(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Arena (kg)</Label>
                      <Input
                        type="number"
                        value={formData.sand_kg || ""}
                        onChange={(e) => setFormData({ ...formData, sand_kg: Number(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Piedra 0-10 (kg)</Label>
                      <Input
                        type="number"
                        value={formData.stone_0_10_kg || ""}
                        onChange={(e) => setFormData({ ...formData, stone_0_10_kg: Number(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Piedra 0-20 (kg)</Label>
                      <Input
                        type="number"
                        value={formData.stone_0_20_kg || ""}
                        onChange={(e) => setFormData({ ...formData, stone_0_20_kg: Number(e.target.value) })}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Agua (litros)</Label>
                      <Input
                        type="number"
                        value={formData.water_liters || ""}
                        onChange={(e) => setFormData({ ...formData, water_liters: Number(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Aditivo (ml)</Label>
                      <Input
                        type="number"
                        value={formData.additive_ml || ""}
                        onChange={(e) => setFormData({ ...formData, additive_ml: Number(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Tipo de aditivo</Label>
                      <Input
                        placeholder="Ej: Plastificante"
                        value={formData.additive_type}
                        onChange={(e) => setFormData({ ...formData, additive_type: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="p-3 bg-muted rounded-lg">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Peso total estimado:</span>
                      <span className="text-lg font-bold">{calculateTotalWeight().toFixed(1)} kg</span>
                    </div>
                    {formData.cement_kg > 0 && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Proporción: 1 : {(formData.sand_kg / formData.cement_kg).toFixed(2)} : {(formData.stone_0_10_kg / formData.cement_kg).toFixed(2)} : {(formData.stone_0_20_kg / formData.cement_kg).toFixed(2)} (Cemento : Arena : P.0-10 : P.0-20)
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Observaciones</Label>
                    <Textarea
                      placeholder="Notas sobre la dosificación..."
                      value={formData.observations}
                      onChange={(e) => setFormData({ ...formData, observations: e.target.value })}
                    />
                  </div>

                  {editingMix && (
                    <div className="space-y-2">
                      <Label className="text-amber-600">Motivo del cambio *</Label>
                      <Textarea
                        placeholder="Explique por qué se modifica la dosificación..."
                        value={formData.change_reason}
                        onChange={(e) => setFormData({ ...formData, change_reason: e.target.value })}
                      />
                    </div>
                  )}
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => { setShowDialog(false); setEditingMix(null); resetForm(); }}>
                    Cancelar
                  </Button>
                  <Button onClick={handleSubmit} disabled={formData.cement_kg === 0}>
                    {editingMix ? "Crear Nueva Versión" : "Guardar"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* Filter */}
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-4">
              <Label>Filtrar por diámetro:</Label>
              <Select value={String(selectedDiameter)} onValueChange={(v) => setSelectedDiameter(v === "all" ? "all" : Number(v))}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {PIPE_DIAMETERS.map(d => (
                    <SelectItem key={d} value={String(d)}>CC{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground ml-auto">
                {filteredMixes.length} dosificación(es) activa(s)
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Active Mix Designs Table */}
        <Card>
          <CardHeader>
            <CardTitle>Dosificaciones Activas</CardTitle>
            <CardDescription>Fórmulas vigentes por diámetro de caño</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">Cargando...</div>
            ) : filteredMixes.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No hay dosificaciones registradas</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Diámetro</TableHead>
                    <TableHead>Versión</TableHead>
                    <TableHead className="text-right">Cemento</TableHead>
                    <TableHead className="text-right">Arena</TableHead>
                    <TableHead className="text-right">P. 0-10</TableHead>
                    <TableHead className="text-right">P. 0-20</TableHead>
                    <TableHead className="text-right">Agua</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Proporción</TableHead>
                    <TableHead className="text-center">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMixes.map((mix) => {
                    const props = getProportions(mix)
                    return (
                      <TableRow key={mix.id}>
                        <TableCell className="font-bold">CC{mix.diameter}</TableCell>
                        <TableCell>
                          <Badge variant="outline">v{mix.version}</Badge>
                        </TableCell>
                        <TableCell className="text-right">{mix.cement_kg} kg</TableCell>
                        <TableCell className="text-right">{mix.sand_kg} kg</TableCell>
                        <TableCell className="text-right">{mix.stone_0_10_kg} kg</TableCell>
                        <TableCell className="text-right">{mix.stone_0_20_kg} kg</TableCell>
                        <TableCell className="text-right">{mix.water_liters} L</TableCell>
                        <TableCell className="text-right font-medium">{mix.total_weight_kg} kg</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          1:{props.sand}:{props.stone010}:{props.stone020}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-center gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEdit(mix)} title="Editar">
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => loadHistory(mix.id)} title="Historial">
                              <History className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {PIPE_DIAMETERS.slice(0, 4).map(d => {
            const mix = activeMixes.find(m => m.diameter === d)
            return (
              <Card key={d} className={mix ? "border-green-200 bg-green-50/50" : "border-amber-200 bg-amber-50/50"}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <span className="font-bold">CC{d}</span>
                    {mix ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                    )}
                  </div>
                  {mix ? (
                    <div className="text-xs text-muted-foreground mt-1">
                      v{mix.version} - {mix.total_weight_kg} kg
                    </div>
                  ) : (
                    <div className="text-xs text-amber-600 mt-1">
                      Sin dosificación
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

      {/* History Dialog */}
      <Dialog open={showHistoryDialog} onOpenChange={setShowHistoryDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Historial de Cambios</DialogTitle>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto">
            {history.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No hay historial de cambios</div>
            ) : (
              <div className="space-y-3">
                {history.map((h) => (
                  <div key={h.id} className="border rounded-lg p-3">
                    <div className="flex justify-between items-start mb-2">
                      <Badge variant="outline">{h.change_type}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(h.created_at).toLocaleString("es-AR")}
                      </span>
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Por:</span> {h.changed_by}
                    </div>
                    {h.reason && (
                      <div className="text-sm mt-1">
                        <span className="text-muted-foreground">Motivo:</span> {h.reason}
                      </div>
                    )}
                    {h.previous_values && h.new_values && (
                      <div className="mt-2 text-xs grid grid-cols-2 gap-2">
                        <div className="bg-red-50 p-2 rounded">
                          <div className="font-medium text-red-700 mb-1">Anterior</div>
                          {Object.entries(h.previous_values).map(([k, v]) => (
                            <div key={k}>{k}: {String(v)}</div>
                          ))}
                        </div>
                        <div className="bg-green-50 p-2 rounded">
                          <div className="font-medium text-green-700 mb-1">Nuevo</div>
                          {Object.entries(h.new_values).map(([k, v]) => (
                            <div key={k}>{k}: {String(v)}</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
