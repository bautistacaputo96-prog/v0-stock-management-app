"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Plus, X } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AddClientDialog } from "./add-client-dialog"
import { AddConstructionSiteDialog } from "./add-construction-site-dialog"
import { AddMixerDialog } from "./add-mixer-dialog"
import { UserSelector } from "./user-selector"

type Formula = {
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

type Client = {
  id: string
  name: string
}

type ConstructionSite = {
  id: string
  name: string
  address: string
}

type Mixer = {
  id: string
  license_plate: string
  brand: string
}

type Material = {
  id: string
  name: string
  unit: string
}

type ManualMaterialEntry = {
  material_id: string
  quantity_kg: number
}

interface AddDispatchDialogProps {
  formulas: Formula[]
  clients: Client[]
  mixers: Mixer[]
  plantId: string
  onSuccess?: () => void
  triggerLabel?: string
}

export function AddDispatchDialog({
  formulas,
  clients: initialClients,
  mixers: initialMixers,
  plantId,
  onSuccess,
  triggerLabel = "Nuevo Despacho",
}: AddDispatchDialogProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [clients, setClients] = useState(initialClients)
  const [mixers, setMixers] = useState(initialMixers)
  const [constructionSites, setConstructionSites] = useState<ConstructionSite[]>([])
  const router = useRouter()

  const [isTestDispatch, setIsTestDispatch] = useState(false)
  const [isManualEntry, setIsManualEntry] = useState(false)
  const [materials, setMaterials] = useState<Material[]>([])
  const [manualMaterials, setManualMaterials] = useState<ManualMaterialEntry[]>([])

  const [formData, setFormData] = useState({
    formula_id: "",
    quantity_m3: "",
    remito: "",
    client_id: "",
    construction_site_id: "",
    mixer_id: "",
    extra_water_liters: "",
    sand_stockpile_humidity: "",
    sample_taken: false,
    sample_number: "",
    actual_slump_cm: "",
    dispatch_date: new Date().toISOString().split("T")[0],
    notes: "",
    created_by: "",
  })

  useEffect(() => {
    setClients(initialClients)
  }, [initialClients])

  useEffect(() => {
    setMixers(initialMixers)
  }, [initialMixers])

  useEffect(() => {
    if (formData.client_id) {
      loadConstructionSites(formData.client_id)
    } else {
      setConstructionSites([])
      setFormData((prev) => ({ ...prev, construction_site_id: "" }))
    }
  }, [formData.client_id])

  useEffect(() => {
    if (open) {
      loadLastSandHumidity()
    }
  }, [open])

  useEffect(() => {
    if (open && isTestDispatch && isManualEntry) {
      loadMaterials()
    }
  }, [open, isTestDispatch, isManualEntry])

  async function loadLastSandHumidity() {
    const supabase = createClient()
    const { data } = await supabase
      .from("dispatches")
      .select("sand_stockpile_humidity")
      .not("sand_stockpile_humidity", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .single()

    if (data?.sand_stockpile_humidity) {
      setFormData((prev) => ({
        ...prev,
        sand_stockpile_humidity: data.sand_stockpile_humidity.toString(),
      }))
    }
  }

  async function loadConstructionSites(clientId: string) {
    const supabase = createClient()
    const { data } = await supabase.from("construction_sites").select("*").eq("client_id", clientId).order("name")
    setConstructionSites(data || [])
  }

  async function loadMaterials() {
    const supabase = createClient()
    const { data } = await supabase.from("materials").select("id, name, unit").order("name")
    setMaterials(data || [])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    console.log("[v0] Starting dispatch submit")
    setLoading(true)

    try {
      const supabase = createClient()

      if (isTestDispatch && !formData.notes.trim()) {
        toast.error("Las observaciones son obligatorias para despachos de prueba")
        setLoading(false)
        return
      }

      if (isTestDispatch && isManualEntry) {
        // Validate manual materials
        if (manualMaterials.length === 0) {
          toast.error("Debe agregar al menos un material")
          setLoading(false)
          return
        }

        // Create manual withdrawal
        const { data: withdrawal, error: withdrawalError } = await supabase
          .from("manual_material_withdrawals")
          .insert({
            withdrawal_date: `${formData.dispatch_date}T12:00:00-03:00`, // Argentina timezone
            plant_id: plantId,
            observations: formData.notes,
          })
          .select()
          .single()

        if (withdrawalError) throw withdrawalError

        // Insert withdrawal items and update stock
        for (const item of manualMaterials) {
          // Insert withdrawal item
          const { error: itemError } = await supabase.from("manual_withdrawal_items").insert({
            withdrawal_id: withdrawal.id,
            material_id: item.material_id,
            quantity_kg: item.quantity_kg,
          })

          if (itemError) throw itemError

          // Update material stock
          const { error: stockError } = await supabase.rpc("update_material_stock", {
            p_material_id: item.material_id,
            p_quantity_change: -item.quantity_kg,
          })

          if (stockError) throw stockError
        }

        toast.success("Ingreso manual registrado exitosamente")
        setOpen(false)
        resetForm()
        if (onSuccess) onSuccess()
        router.refresh()
        setLoading(false)
        return
      }

      const selectedFormula = formulas.find((f) => f.id === formData.formula_id)
      console.log("[v0] Selected formula:", selectedFormula?.code)

      if (!selectedFormula) {
        toast.error("Debe seleccionar una fórmula")
        setLoading(false)
        return
      }

      const quantityM3 = Number.parseFloat(formData.quantity_m3)
      console.log("[v0] Quantity m3:", quantityM3)

      if (isNaN(quantityM3) || quantityM3 <= 0) {
        toast.error("La cantidad debe ser mayor a 0")
        setLoading(false)
        return
      }

      if (!isTestDispatch) {
        if (!formData.client_id) {
          toast.error("Debe seleccionar un cliente")
          setLoading(false)
          return
        }
        if (!formData.construction_site_id) {
          toast.error("Debe seleccionar una obra")
          setLoading(false)
          return
        }
      }

      if (formData.sample_taken && !formData.sample_number) {
        toast.error("Debe ingresar el número de muestra")
        setLoading(false)
        return
      }

      console.log("[v0] Stock check passed, creating dispatch")

      const dispatchData = {
        formula_id: formData.formula_id,
        quantity_m3: quantityM3,
        remito: formData.remito,
        client_id: !isTestDispatch && formData.client_id ? formData.client_id : null,
        construction_site_id: !isTestDispatch && formData.construction_site_id ? formData.construction_site_id : null,
        mixer_id: formData.mixer_id || null,
        extra_water_liters: formData.extra_water_liters ? Number.parseFloat(formData.extra_water_liters) : null,
        sand_stockpile_humidity: formData.sand_stockpile_humidity
          ? Number.parseFloat(formData.sand_stockpile_humidity)
          : null,
        sample_taken: formData.sample_taken,
        sample_number: formData.sample_taken ? formData.sample_number : null,
        actual_slump_cm:
          formData.sample_taken && formData.actual_slump_cm ? Number.parseFloat(formData.actual_slump_cm) : null,
        dispatch_date: `${formData.dispatch_date}T12:00:00-03:00`, // Argentina timezone
        notes: formData.notes || null,
        is_test_dispatch: isTestDispatch,
        created_by: formData.created_by || null,
      }

      console.log("[v0] Inserting dispatch data")

      const { data: dispatch, error: dispatchError } = await supabase
        .from("dispatches")
        .insert(dispatchData)
        .select()
        .single()

      console.log("[v0] Dispatch insert result:", { success: !!dispatch, error: dispatchError })

      if (dispatchError) throw dispatchError

      console.log("[v0] Creating dispatch_materials and updating stock")

      // Create dispatch_materials records and update stock
      for (let i = 0; i < selectedFormula.formula_materials.length; i++) {
        const fm = selectedFormula.formula_materials[i]
        console.log(
          `[v0] Checking stock for material ${i + 1}/${selectedFormula.formula_materials.length}:`,
          fm.materials.name,
        )

        const { data: material, error: stockError } = await supabase
          .from("materials")
          .select("current_stock, name, stockpile_humidity")
          .eq("id", fm.materials.id)
          .single()

        console.log(`[v0] Material ${fm.materials.name} stock:`, material?.current_stock, "needed:", fm.quantity)

        if (stockError) {
          console.error("[v0] Error checking stock:", stockError)
          throw stockError
        }

        let requiredQty = fm.quantity * quantityM3
        
        // If material is sand/arena and has humidity, compensate for moisture content
        const materialName = material?.name?.toLowerCase() || fm.materials.name?.toLowerCase() || ""
        const humidity = material?.stockpile_humidity || 0
        if ((materialName.includes("arena") || materialName.includes("sand")) && humidity > 0) {
          // Add extra quantity to compensate: wet_qty = dry_qty * (1 + humidity/100)
          requiredQty = requiredQty * (1 + humidity / 100)
        }
        
        if (!material || material.current_stock < requiredQty) {
          toast.error(
            `Stock insuficiente de ${material?.name || fm.materials.name}. Disponible: ${material?.current_stock?.toFixed(2) || 0} kg, Necesario: ${requiredQty.toFixed(2)} kg. Por favor ajuste la cantidad o actualice el stock.`,
            { duration: 5000 }
          )
          setLoading(false)
          return
        }

        // Discount stock
        const { error: updateError } = await supabase.rpc("update_material_stock", {
          p_material_id: fm.materials.id,
          p_quantity_change: -requiredQty,
        })

        if (updateError) {
          console.error("[v0] Error updating stock:", updateError)
          throw updateError
        }

        // Create dispatch_material record
        await supabase.from("dispatch_materials").insert({
          dispatch_id: dispatch.id,
          material_id: fm.materials.id,
          quantity: requiredQty,
        })

        // Register stock movement for tracking
        await supabase.from("stock_movements").insert({
          material_id: fm.materials.id,
          movement_type: "consumo",
          quantity_kg: requiredQty,
          reference_type: "dispatch",
          reference_id: dispatch.id,
          movement_date: formData.dispatch_date,
          notes: `Despacho remito ${formData.remito || "N/A"}`,
        })
      }

      console.log("[v0] Dispatch saved successfully with stock updated")
      toast.success("Despacho registrado y stock actualizado")
      // Close dialog immediately - setLoading(false) AFTER setOpen(false) to avoid race condition
      setOpen(false)
      resetForm()
      setLoading(false)
      if (onSuccess) onSuccess()
      router.refresh()
    } catch (error: any) {
      console.error("[v0] Error creating dispatch:", error)
      toast.error(error?.message || "Error al registrar el despacho")
      setLoading(false)
    }
  }

  const resetForm = () => {
    setIsTestDispatch(false)
    setIsManualEntry(false)
    setManualMaterials([])
    setFormData({
      formula_id: "",
      quantity_m3: "",
      remito: "",
      client_id: "",
      construction_site_id: "",
      mixer_id: "",
      extra_water_liters: "",
      sand_stockpile_humidity: "",
      sample_taken: false,
      sample_number: "",
      actual_slump_cm: "",
      dispatch_date: new Date().toISOString().split("T")[0],
      notes: "",
      created_by: "",
    })
  }

  const addManualMaterial = () => {
    setManualMaterials([...manualMaterials, { material_id: "", quantity_kg: 0 }])
  }

  const updateManualMaterial = (index: number, field: keyof ManualMaterialEntry, value: string | number) => {
    const updated = [...manualMaterials]
    updated[index] = { ...updated[index], [field]: value }
    setManualMaterials(updated)
  }

  const removeManualMaterial = (index: number) => {
    setManualMaterials(manualMaterials.filter((_, i) => i !== index))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle>Registrar Despacho</DialogTitle>
                <DialogDescription>Complete los datos del despacho de hormigón</DialogDescription>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="is_test_dispatch"
                  checked={isTestDispatch}
                  onCheckedChange={(checked) => {
                    setIsTestDispatch(checked as boolean)
                    if (!checked) {
                      setIsManualEntry(false)
                      setManualMaterials([])
                    }
                    if (checked) {
                      setFormData({
                        ...formData,
                        client_id: "",
                        construction_site_id: "",
                      })
                    }
                  }}
                />
                <Label htmlFor="is_test_dispatch" className="text-xs cursor-pointer">
                  Prueba
                </Label>
              </div>
            </div>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {isTestDispatch && (
              <div className="grid gap-3 p-4 border rounded-lg bg-muted/50">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="is_manual_entry"
                    checked={isManualEntry}
                    onCheckedChange={(checked) => {
                      setIsManualEntry(checked as boolean)
                      if (checked) {
                        setManualMaterials([{ material_id: "", quantity_kg: 0 }])
                      } else {
                        setManualMaterials([])
                      }
                    }}
                  />
                  <Label htmlFor="is_manual_entry" className="font-medium cursor-pointer">
                    Ingreso Manual
                  </Label>
                </div>
                {isManualEntry && (
                  <p className="text-xs text-muted-foreground">
                    Ingrese las materias primas manualmente. No se creará un despacho, solo se descontará el stock.
                  </p>
                )}
              </div>
            )}

            {!(isTestDispatch && isManualEntry) && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="formula">Fórmula *</Label>
                    <Select
                      value={formData.formula_id}
                      onValueChange={(value) => setFormData({ ...formData, formula_id: value })}
                      required
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar fórmula" />
                      </SelectTrigger>
  <SelectContent className="max-h-[200px]">
  {[...formulas].sort((a, b) => a.name.localeCompare(b.name)).map((formula) => (
  <SelectItem key={formula.id} value={formula.id}>
  {formula.name} ({formula.code})
  </SelectItem>
  ))}
  </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="sand_stockpile_humidity">Humedad acopio arena (%)</Label>
                    <Input
                      id="sand_stockpile_humidity"
                      type="number"
                      step="0.1"
                      placeholder="3.5"
                      value={formData.sand_stockpile_humidity}
                      onChange={(e) => setFormData({ ...formData, sand_stockpile_humidity: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="quantity_m3">Cantidad (m³) *</Label>
                    <Input
                      id="quantity_m3"
                      type="number"
                      step="0.01"
                      placeholder="10.5"
                      value={formData.quantity_m3}
                      onChange={(e) => setFormData({ ...formData, quantity_m3: e.target.value })}
                      required
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="remito">Remito {!isTestDispatch && "*"}</Label>
                    <Input
                      id="remito"
                      placeholder="R-001234"
                      value={formData.remito}
                      onChange={(e) => setFormData({ ...formData, remito: e.target.value })}
                      required={!isTestDispatch}
                    />
                  </div>
                </div>
              </>
            )}

            {isTestDispatch && isManualEntry && (
              <div className="grid gap-3 p-4 border rounded-lg">
                <div className="flex items-center justify-between">
                  <Label className="font-medium">Materias Primas</Label>
                  <Button type="button" size="sm" onClick={addManualMaterial}>
                    <Plus className="h-4 w-4 mr-1" />
                    Agregar Material
                  </Button>
                </div>
                {manualMaterials.map((item, index) => (
                  <div key={index} className="grid grid-cols-[1fr,1fr,auto] gap-2 items-end">
                    <div className="grid gap-2">
                      <Label>Material *</Label>
                      <Select
                        value={item.material_id}
                        onValueChange={(value) => updateManualMaterial(index, "material_id", value)}
                        required
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar" />
                        </SelectTrigger>
                        <SelectContent>
                          {materials.map((material) => (
                            <SelectItem key={material.id} value={material.id}>
                              {material.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label>Cantidad (kg) *</Label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0"
                        value={item.quantity_kg || ""}
                        onChange={(e) => updateManualMaterial(index, "quantity_kg", Number.parseFloat(e.target.value))}
                        required
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeManualMaterial(index)}
                      disabled={manualMaterials.length === 1}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {!isTestDispatch && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="mixer">Mixer</Label>
                  <div className="flex gap-2">
                    <Select
                      value={formData.mixer_id}
                      onValueChange={(value) => setFormData({ ...formData, mixer_id: value })}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Seleccionar mixer" />
                      </SelectTrigger>
                      <SelectContent>
                        {mixers.map((mixer) => (
                          <SelectItem key={mixer.id} value={mixer.id}>
                            {mixer.license_plate} {mixer.brand ? `- ${mixer.brand}` : ""}
                          </SelectItem>
                        ))}
                        <SelectItem value="add_new" className="text-primary">
                          + Agregar nuevo mixer
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <AddMixerDialog
                      plantId={plantId}
                      trigger={
                        <Button type="button" variant="outline" size="icon">
                          <Plus className="h-4 w-4" />
                        </Button>
                      }
                      onMixerAdded={(mixer) => {
                        setMixers([...mixers, mixer])
                        setFormData({ ...formData, mixer_id: mixer.id })
                      }}
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="client">Cliente *</Label>
                  <div className="flex gap-2">
                    <Select
                      value={formData.client_id}
                      onValueChange={(value) => {
                        if (value === "add_new") {
                          // Will be handled by dialog trigger
                        } else {
                          setFormData({ ...formData, client_id: value })
                        }
                      }}
                      required
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Seleccionar cliente" />
                      </SelectTrigger>
                      <SelectContent>
                        {clients.map((client) => (
                          <SelectItem key={client.id} value={client.id}>
                            {client.name}
                          </SelectItem>
                        ))}
                        <SelectItem value="add_new" className="text-primary">
                          + Agregar nuevo cliente
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <AddClientDialog
                      plantId={plantId}
                      trigger={
                        <Button type="button" variant="outline" size="icon">
                          <Plus className="h-4 w-4" />
                        </Button>
                      }
                      onClientAdded={(client) => {
                        setClients([...clients, client])
                        setFormData({ ...formData, client_id: client.id })
                      }}
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="construction_site">Obra *</Label>
                  <div className="flex gap-2">
                    <Select
                      value={formData.construction_site_id}
                      onValueChange={(value) => setFormData({ ...formData, construction_site_id: value })}
                      disabled={!formData.client_id}
                      required
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue
                          placeholder={formData.client_id ? "Seleccionar obra" : "Primero seleccione un cliente"}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {constructionSites.map((site) => (
                          <SelectItem key={site.id} value={site.id}>
                            {site.name}
                          </SelectItem>
                        ))}
                        {formData.client_id && (
                          <SelectItem value="add_new" className="text-primary">
                            + Agregar nueva obra
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    {formData.client_id && (
                      <AddConstructionSiteDialog
                        clientId={formData.client_id}
                        trigger={
                          <Button type="button" variant="outline" size="icon">
                            <Plus className="h-4 w-4" />
                          </Button>
                        }
                        onSiteAdded={(site) => {
                          setConstructionSites([...constructionSites, site])
                          setFormData({ ...formData, construction_site_id: site.id })
                        }}
                      />
                    )}
                  </div>
                </div>
              </>
            )}

            {!(isTestDispatch && isManualEntry) && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="extra_water_liters">Agua extra en planta (L)</Label>
                  <Input
                    id="extra_water_liters"
                    type="number"
                    step="0.1"
                    placeholder="0"
                    value={formData.extra_water_liters}
                    onChange={(e) => setFormData({ ...formData, extra_water_liters: e.target.value })}
                  />
                </div>

                <div className="grid gap-3 p-4 border rounded-lg">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="sample_taken"
                      checked={formData.sample_taken}
                      onCheckedChange={(checked) =>
                        setFormData({
                          ...formData,
                          sample_taken: checked as boolean,
                          sample_number: checked ? formData.sample_number : "",
                          actual_slump_cm: checked ? formData.actual_slump_cm : "",
                        })
                      }
                    />
                    <Label htmlFor="sample_taken" className="font-medium cursor-pointer">
                      ¿Se extrajo muestra?
                    </Label>
                  </div>

                  {formData.sample_taken && (
                    <div className="grid grid-cols-2 gap-4 mt-2">
                      <div className="grid gap-2">
                        <Label htmlFor="sample_number">Número de muestra *</Label>
                        <Input
                          id="sample_number"
                          placeholder="M-001"
                          value={formData.sample_number}
                          onChange={(e) => setFormData({ ...formData, sample_number: e.target.value })}
                          required={formData.sample_taken}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="actual_slump_cm">Asentamiento real (cm)</Label>
                        <Input
                          id="actual_slump_cm"
                          type="number"
                          step="0.1"
                          placeholder="15"
                          value={formData.actual_slump_cm}
                          onChange={(e) => setFormData({ ...formData, actual_slump_cm: e.target.value })}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="grid gap-2">
              <Label htmlFor="dispatch_date">Fecha *</Label>
              <Input
                id="dispatch_date"
                type="date"
                value={formData.dispatch_date}
                onChange={(e) => setFormData({ ...formData, dispatch_date: e.target.value })}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="notes">Observaciones {isTestDispatch && "*"}</Label>
              <Textarea
                id="notes"
                placeholder={
                  isTestDispatch
                    ? "Observaciones obligatorias (indique el motivo de la prueba o ingreso manual)"
                    : "Observaciones adicionales (opcional)"
                }
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
                required={isTestDispatch}
              />
            </div>

            <UserSelector
              value={formData.created_by}
              onValueChange={(value) => setFormData({ ...formData, created_by: value })}
              label="Responsable"
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading
                ? "Registrando..."
                : isTestDispatch && isManualEntry
                  ? "Registrar Ingreso Manual"
                  : "Registrar Despacho"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
