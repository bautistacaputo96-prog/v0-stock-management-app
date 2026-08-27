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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { cn } from "@/lib/utils"
import { currentUserName } from "@/lib/current-user"
import { logActivity } from "@/lib/activity-log"
import { Checkbox } from "@/components/ui/checkbox"
import { Plus, X, Check, ChevronsUpDown, Truck } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AddClientDialog } from "./add-client-dialog"
import { AddConstructionSiteDialog } from "./add-construction-site-dialog"
import { AddMixerDialog } from "./add-mixer-dialog"
import { UserSelector } from "./user-selector"
import { SearchableSelect } from "@/components/dispatch-scheduling"

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
  plants?: { id: string; name: string }[]
  onSuccess?: () => void
  triggerLabel?: string
}

function FormulaCombobox({ formulas, value, onChange }: { formulas: Formula[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const selected = formulas.find((f) => f.id === value)
  const sorted = [...formulas].sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          {selected ? (selected.name && selected.name !== selected.code ? `${selected.name} (${selected.code})` : selected.code) : "Buscar fórmula..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar fórmula..." />
          <CommandList className="max-h-[220px]">
            <CommandEmpty>No se encontró fórmula.</CommandEmpty>
            <CommandGroup>
              {sorted.map((f) => (
                <CommandItem
                  key={f.id}
                  value={`${f.name} ${f.code}`}
                  onSelect={() => { onChange(f.id); setOpen(false) }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === f.id ? "opacity-100" : "opacity-0")} />
                  <span className="font-medium">{f.code}</span>
                  {f.name && f.name !== f.code && <span className="ml-2 text-muted-foreground text-xs">{f.name}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function AddDispatchDialog({
  formulas,
  clients: initialClients,
  mixers: initialMixers,
  plantId,
  plants = [],
  onSuccess,
  triggerLabel = "Nuevo Despacho",
}: AddDispatchDialogProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [dispatchPlantId, setDispatchPlantId] = useState(plantId)
  const [dialogFormulas, setDialogFormulas] = useState(formulas)
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
    // Fibra agregada al camión, en kg por m³
    fiber_kg_per_m3: "",
  })

  // Mantener la planta del diálogo sincronizada con la planta que llega por prop
  useEffect(() => {
    setDispatchPlantId(plantId)
  }, [plantId])

  // Cargar fórmulas (de la planta elegida), clientes y camiones (compartidos) al abrir o cambiar de planta
  useEffect(() => {
    if (!open || !dispatchPlantId) return
    const load = async () => {
      const supabase = createClient()
      const [fRes, cRes, mRes] = await Promise.all([
        supabase
          .from("formulas")
          .select("*, formula_materials(id, quantity, materials(id, name, unit))")
          .eq("plant_id", dispatchPlantId)
          .order("code"),
        supabase.from("clients").select("id, name").neq("active", false).order("name"),
        supabase.from("mixers").select("*").eq("active", true).order("license_plate"),
      ])
      setDialogFormulas(fRes.data || [])
      setClients(cRes.data || [])
      setMixers(mRes.data || [])
    }
    load()
  }, [open, dispatchPlantId])

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
        toast.error("Las observaciones son obligatorias para el despacho por árido")
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
            plant_id: dispatchPlantId,
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

          // Track in stock_movements so manual discharges appear in the evolution chart
          await supabase.from("stock_movements").insert({
            material_id: item.material_id,
            movement_type: "consumo",
            quantity_kg: item.quantity_kg,
            reference_type: "manual_withdrawal",
            reference_id: withdrawal.id,
            movement_date: formData.dispatch_date,
            notes: `Descarga manual${formData.notes ? `: ${formData.notes}` : ""}`,
          })
        }

        toast.success("Ingreso manual registrado exitosamente")
        setOpen(false)
        resetForm()
        if (onSuccess) onSuccess()
        router.refresh()
        setLoading(false)
        return
      }

      const selectedFormula = dialogFormulas.find((f) => f.id === formData.formula_id)
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

      // Anti-duplicado: no permitir cargar un remito que ya existe en el sistema
      if (formData.remito.trim()) {
        const { data: dupRemito } = await supabase
          .from("dispatches")
          .select("id")
          .eq("remito", formData.remito.trim())
          .limit(1)
        if (dupRemito && dupRemito.length > 0) {
          toast.error(`Ya existe un despacho con el remito ${formData.remito.trim()} en el sistema. No se puede cargar dos veces.`)
          setLoading(false)
          return
        }
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
        created_by: formData.created_by || currentUserName(),
        plant_id: dispatchPlantId,
      }

      console.log("[v0] Inserting dispatch data")

      const { data: dispatch, error: dispatchError } = await supabase
        .from("dispatches")
        .insert(dispatchData)
        .select()
        .single()

      console.log("[v0] Dispatch insert result:", { success: !!dispatch, error: dispatchError })

      if (dispatchError) throw dispatchError

      await logActivity({
        action: "crear",
        entity: "despacho",
        entityId: dispatch?.id,
        reference: formData.remito || null,
        plantId: dispatchPlantId,
        details: {
          Remito: formData.remito || "-",
          "m3": quantityM3,
          Formula: selectedFormula?.code || "-",
        },
      })

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

        // Insumos que NO se descuentan del stock por despacho:
        // - Agua: stock infinito. - Sikament 33S: aditivo que se agrega en obra, no en planta.
        const isNonDeductible =
          materialName.includes("agua") || materialName.includes("water") || materialName.includes("sikament 33")

        // NO se bloquea el despacho por stock insuficiente: el operario siempre debe poder despachar,
        // aunque el stock quede negativo (se corrige luego con recuento físico).

        // Discount stock (excepto agua y Sikament 33S)
        if (!isNonDeductible) {
          const { error: updateError } = await supabase.rpc("update_material_stock", {
            p_material_id: fm.materials.id,
            p_quantity_change: -requiredQty,
          })

          if (updateError) {
            console.error("[v0] Error updating stock:", updateError)
            throw updateError
          }
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

      // Auto-create test cylinders if sample was taken.
      // No crear probetas si el N° de muestra no es real (vacío, "NO", "PRUEBA") -> evita probetas fantasma.
      const sampleNumTrim = (formData.sample_number || "").trim().toUpperCase()
      const isRealSample = sampleNumTrim !== "" && sampleNumTrim !== "NO" && sampleNumTrim !== "PRUEBA"
      if (formData.sample_taken && isRealSample) {
        const [year, month, day] = formData.dispatch_date.split("-").map(Number)
        const addDays = (n: number) => {
          const d = new Date(year, month - 1, day)
          d.setDate(d.getDate() + n)
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
        }
        await supabase.from("test_cylinders").insert([
          { dispatch_id: dispatch.id, cylinder_number: 1, test_age_days: 7,  scheduled_test_date: addDays(7)  },
          { dispatch_id: dispatch.id, cylinder_number: 2, test_age_days: 28, scheduled_test_date: addDays(28) },
          { dispatch_id: dispatch.id, cylinder_number: 3, test_age_days: 28, scheduled_test_date: addDays(28) },
        ])
        console.log("[v0] Test cylinders created for sample", formData.sample_number)
      }

      // Fibra agregada al camión (kg/m³ × m³ del despacho)
      const fiberPerM3 = Number.parseFloat(formData.fiber_kg_per_m3) || 0
      if (fiberPerM3 > 0) {
        const fiberTotal = fiberPerM3 * quantityM3
        const { data: fiberMaterial } = await supabase
          .from("materials")
          .select("id")
          .eq("plant_id", dispatchPlantId)
          .ilike("name", "%fibra%")
          .maybeSingle()

        if (fiberMaterial) {
          await supabase.rpc("update_material_stock", {
            p_material_id: fiberMaterial.id,
            p_quantity_change: -fiberTotal,
          })
          await supabase.from("dispatch_materials").insert({
            dispatch_id: dispatch.id,
            material_id: fiberMaterial.id,
            quantity: fiberTotal,
          })
          await supabase.from("stock_movements").insert({
            material_id: fiberMaterial.id,
            movement_type: "consumo",
            quantity_kg: fiberTotal,
            reference_type: "dispatch",
            reference_id: dispatch.id,
            movement_date: formData.dispatch_date,
            notes: `Fibra ${fiberPerM3} kg/m³ × ${quantityM3} m³ — remito ${formData.remito}`,
          })
        } else {
          toast.error("No se encontró el material 'Fibra' en esta planta; el despacho se guardó sin descontarla")
        }
      }

      console.log("[v0] Dispatch saved successfully with stock updated")
      toast.success(
        formData.sample_taken
          ? "Despacho registrado con 3 probetas (7d, 28d, 28d)"
          : "Despacho registrado y stock actualizado"
      )
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
      fiber_kg_per_m3: "",
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
      <DialogContent className="sm:max-w-[600px] flex flex-col max-h-[90vh]">
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle>Registrar Despacho</DialogTitle>
                <DialogDescription>Complete los datos del despacho de hormigón</DialogDescription>
              </div>
              {/* Despacho por árido: permite cargar manualmente los materiales
                  despachados en vez de calcularlos desde la fórmula */}
              <label
                htmlFor="is_test_dispatch"
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md border-2 cursor-pointer transition-colors select-none",
                  isTestDispatch
                    ? "bg-amber-500 border-amber-600 text-white hover:bg-amber-600"
                    : "bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-200",
                )}
              >
                <Checkbox
                  id="is_test_dispatch"
                  checked={isTestDispatch}
                  className={cn(isTestDispatch && "border-white data-[state=checked]:bg-white data-[state=checked]:text-amber-600")}
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
                <Truck className="h-4 w-4" />
                <span className="text-sm font-semibold whitespace-nowrap">Despacho por árido</span>
              </label>
            </div>
          </DialogHeader>
          <div className="grid gap-4 py-4 overflow-y-auto flex-1">
            {plants.length > 1 && (
              <div className="grid gap-2">
                <Label>Planta *</Label>
                <Select
                  value={dispatchPlantId}
                  onValueChange={(v) => {
                    setDispatchPlantId(v)
                    setFormData((prev) => ({ ...prev, formula_id: "" }))
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar planta" />
                  </SelectTrigger>
                  <SelectContent>
                    {plants.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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
                    <FormulaCombobox
                      formulas={dialogFormulas}
                      value={formData.formula_id}
                      onChange={(value) => setFormData({ ...formData, formula_id: value })}
                    />
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
                    {Number.parseFloat(formData.quantity_m3) > 12 && (
                      <p className="text-xs text-amber-600 font-medium">Supera los 12 m³ por camión. Podés continuar igual.</p>
                    )}
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
                      plantId={dispatchPlantId}
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
                    <div className="flex-1">
                      <SearchableSelect
                        items={clients.map((c) => ({ id: c.id, label: c.name }))}
                        value={formData.client_id}
                        onChange={(value) => setFormData({ ...formData, client_id: value })}
                        placeholder="Escribí para buscar el cliente..."
                        emptyText="No se encontró el cliente"
                      />
                    </div>
                    <AddClientDialog
                      plantId={dispatchPlantId}
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
                    <div className="flex-1">
                      <SearchableSelect
                        items={constructionSites.map((s) => ({ id: s.id, label: s.name, hint: s.address || "" }))}
                        value={formData.construction_site_id}
                        onChange={(value) => setFormData({ ...formData, construction_site_id: value })}
                        disabled={!formData.client_id}
                        placeholder={formData.client_id ? "Escribí para buscar la obra..." : "Primero elegí un cliente"}
                        emptyText="No se encontró la obra"
                      />
                    </div>
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

                {/* Fibra: se carga por m³ y se muestra el total del camión */}
                <div className="grid gap-2">
                  <Label htmlFor="fiber_kg_per_m3">Fibra (kg por m³)</Label>
                  <div className="flex items-center gap-3">
                    <Input
                      id="fiber_kg_per_m3"
                      type="number"
                      step="0.1"
                      min="0"
                      placeholder="Dejar vacío si no lleva"
                      value={formData.fiber_kg_per_m3}
                      onChange={(e) => setFormData({ ...formData, fiber_kg_per_m3: e.target.value })}
                      className="flex-1"
                    />
                    {(() => {
                      const perM3 = Number.parseFloat(formData.fiber_kg_per_m3) || 0
                      const m3 = Number.parseFloat(formData.quantity_m3) || 0
                      if (perM3 <= 0 || m3 <= 0) return null
                      return (
                        <p className="text-xs text-muted-foreground flex-1 leading-tight">
                          Total en el camión:{" "}
                          <span className="font-semibold text-foreground">
                            {(perM3 * m3).toLocaleString("es-AR", { maximumFractionDigits: 2 })} kg
                          </span>
                          <br />
                          <span className="text-[11px]">{perM3} kg/m³ × {m3} m³</span>
                        </p>
                      )
                    })()}
                  </div>
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
                    ? "Observaciones obligatorias (indique el motivo del despacho por árido)"
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
          <DialogFooter className="border-t pt-4 shrink-0">
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
