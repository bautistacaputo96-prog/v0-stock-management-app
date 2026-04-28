"use client"

import { useState, useEffect, useCallback } from "react"
import { usePlant } from "@/lib/plant-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Navigation } from "@/components/navigation"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  PlusCircle,
  FileDown,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Truck,
  FlaskConical,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react"

// ── Constantes ────────────────────────────────────────────────────────────────

const SIEVES = [
  { key: "sieve_9500", label: '3/8"' },
  { key: "sieve_4750", label: "#4" },
  { key: "sieve_2360", label: "#8" },
  { key: "sieve_1180", label: "#16" },
  { key: "sieve_600", label: "#30" },
  { key: "sieve_300", label: "#50" },
  { key: "sieve_150", label: "#100" },
  { key: "sieve_pan", label: "Fondo" },
]

const HUMIDITY_TOLERANCE = 3

const FIXED_MATERIALS = [
  { key: "arena_especial", label: "Arena Especial" },
  { key: "piedra_0_10", label: "Piedra 0/10" },
  { key: "cemento", label: "Cemento" },
  { key: "aditivo_mark_v", label: "Aditivo Mark V" },
  { key: "aditivo_darasell", label: "Aditivo Darasell" },
] as const

type MaterialKey = (typeof FIXED_MATERIALS)[number]["key"]

const LAB_SAMPLE_MATERIALS: MaterialKey[] = ["arena_especial", "piedra_0_10"]

function calculateFinenessModulus(
  sieves: Record<string, number>,
  totalWeight: number
): number {
  if (totalWeight <= 0) return 0
  const retainedKeys = [
    "sieve_9500",
    "sieve_4750",
    "sieve_2360",
    "sieve_1180",
    "sieve_600",
    "sieve_300",
    "sieve_150",
  ]
  const retainedPcts = retainedKeys.map(
    (k) => ((sieves[k] || 0) / totalWeight) * 100
  )
  const cumulative: number[] = []
  let sum = 0
  for (const pct of retainedPcts) {
    sum += pct
    cumulative.push(sum)
  }
  const mf = cumulative.reduce((a, b) => a + b, 0) / 100
  return Math.round(mf * 100) / 100
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Supplier {
  id: number
  name: string
  material_type: string
  product_detail: string
  line_type: string
}

interface Carrier {
  id: number
  name: string
  phone: string | null
  license_plate: string | null
  company: string | null
}

interface Receipt {
  id: number
  date: string
  remito_number: string
  supplier: Supplier
  carrier: Carrier | null
  material_type: string
  quantity_kg: number
  lab_sample_taken: boolean
  notes: string
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function IngresoMPPage() {
  const { selectedPlant } = usePlant()

  // Data
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [carriers, setCarriers] = useState<Carrier[]>([])
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingReceiptId, setEditingReceiptId] = useState<number | null>(null)

  // Basic form
  const [date, setDate] = useState(new Date().toISOString().split("T")[0])
  const [remitoNumber, setRemitoNumber] = useState("")
  const [quantityKg, setQuantityKg] = useState("")
  const [notes, setNotes] = useState("")

  // Supplier selection
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("")
  const [showNewSupplierDialog, setShowNewSupplierDialog] = useState(false)
  const [newSupplierName, setNewSupplierName] = useState("")
  const [newSupplierMaterialType, setNewSupplierMaterialType] = useState("")
  const [newSupplierProductDetail, setNewSupplierProductDetail] = useState("")
  const [savingSupplier, setSavingSupplier] = useState(false)

  // Material selection - filtered by selected supplier
  const [selectedMaterial, setSelectedMaterial] = useState<string>("")

  // Carrier dropdown
  const [selectedCarrierId, setSelectedCarrierId] = useState<string>("")
  const [showNewCarrierDialog, setShowNewCarrierDialog] = useState(false)
  const [newCarrierName, setNewCarrierName] = useState("")
  const [newCarrierPhone, setNewCarrierPhone] = useState("")
  const [newCarrierPlate, setNewCarrierPlate] = useState("")
  const [newCarrierCompany, setNewCarrierCompany] = useState("")
  const [savingCarrier, setSavingCarrier] = useState(false)

  // Lab sample question (Arena Especial y Piedra 0/10)
  const [labSampleTaken, setLabSampleTaken] = useState<boolean | null>(null)

  // Production line for cement
  const [productionLine, setProductionLine] = useState<string>("")

  // Granulometry
  const [showGranulometry, setShowGranulometry] = useState(false)
  const [sieveValues, setSieveValues] = useState<Record<string, number>>({})
  const [wetSample, setWetSample] = useState("500")
  const [drySample, setDrySample] = useState("")
  const [granObs, setGranObs] = useState("")

  // Humidity
  const [showHumidity, setShowHumidity] = useState(false)
  const [humidityPercentage, setHumidityPercentage] = useState("")
  const [wetWeightG, setWetWeightG] = useState("500")
  const [dryWeightG, setDryWeightG] = useState("")

  // ── Derived ────────────────────────────────────────────────────────────────
  const selectedSupplier = suppliers.find((s) => s.id.toString() === selectedSupplierId)
  const selectedCarrier = carriers.find((c) => c.id.toString() === selectedCarrierId)
  
  // Get unique supplier names for the dropdown
  const uniqueSupplierNames = [...new Set(suppliers.map(s => s.name))]
  
  // Get materials for the selected supplier
  const supplierMaterials = selectedSupplier 
    ? suppliers.filter(s => s.name === selectedSupplier.name)
    : []
  
  const isCemento = selectedMaterial?.toLowerCase().includes("cemento")
  const isArena = selectedMaterial?.toLowerCase().includes("arena")
  const isPiedra = selectedMaterial?.toLowerCase().includes("piedra")
  const isArenaOrPiedra = isArena || isPiedra
  const needsLabAnswer = isArenaOrPiedra

  const drySampleVal = parseFloat(drySample) || 0
  const totalRetainedGrams = Object.entries(sieveValues)
    .filter(([key]) => key !== "sieve_pan")
    .reduce((sum, [, val]) => sum + (val || 0), 0)
  const panGrams = Math.max(0, drySampleVal - totalRetainedGrams)
  const finenessModulus = showGranulometry
    ? calculateFinenessModulus(sieveValues, drySampleVal)
    : 0

  // Calculate humidity from wet/dry weights if available
  const wetWeight = parseFloat(wetWeightG) || 0
  const dryWeight = parseFloat(dryWeightG) || 0
  const calculatedHumidity = dryWeight > 0 ? ((wetWeight - dryWeight) / dryWeight) * 100 : 0
  const humidityVal = dryWeight > 0 ? calculatedHumidity : (parseFloat(humidityPercentage) || 0)
  const excessPercentage = Math.max(0, humidityVal - HUMIDITY_TOLERANCE)
  const quantityTn = (parseFloat(quantityKg) || 0) / 1000
  const creditTn = quantityTn * (excessPercentage / 100)

  // Validation messages
  const missingFields: string[] = []
  if (!remitoNumber) missingFields.push("Número de Remito")
  if (!selectedSupplierId) missingFields.push("Proveedor")
  if (!selectedMaterial) missingFields.push("Tipo de Materia Prima")
  if (!quantityKg) missingFields.push("Cantidad (kg)")
  if (!selectedCarrierId) missingFields.push("Flete")
  if (isCemento && !productionLine) missingFields.push("Línea de Producción")
  if (needsLabAnswer && labSampleTaken === null) missingFields.push("Muestra de Laboratorio")

  const canSubmit = missingFields.length === 0

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchSuppliers = useCallback(async () => {
    try {
      const plantValue = selectedPlant === "villa-rosa" ? "villa_rosa" : selectedPlant
      const res = await fetch(`/api/quality/suppliers?plant=${plantValue}`)
      if (res.ok) setSuppliers(await res.json())
    } catch { /* ignore */ }
  }, [selectedPlant])

  const fetchCarriers = useCallback(async () => {
    try {
      const res = await fetch("/api/materia-prima/carriers")
      if (res.ok) setCarriers(await res.json())
    } catch { /* ignore */ }
  }, [])

  const fetchReceipts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/quality/mp-receipts?plant=${selectedPlant}`)
      if (res.ok) setReceipts(await res.json())
    } catch { /* ignore */ }
    setLoading(false)
  }, [selectedPlant])

  useEffect(() => {
    fetchSuppliers()
    fetchCarriers()
    fetchReceipts()
  }, [fetchSuppliers, fetchCarriers, fetchReceipts])

  // ── Handlers ───────────────────────────────────────────────────────────────
  const saveNewSupplier = async () => {
    if (!newSupplierName.trim() || !newSupplierMaterialType.trim()) return
    setSavingSupplier(true)
    try {
      const res = await fetch("/api/quality/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newSupplierName.trim(),
          material_type: newSupplierMaterialType.trim(),
          product_detail: newSupplierProductDetail.trim() || newSupplierMaterialType.trim(),
          line_type: "ambas",
          plant: selectedPlant,
        }),
      })
      if (res.ok) {
        const created = await res.json()
        await fetchSuppliers()
        setSelectedSupplierId(created.id.toString())
        setShowNewSupplierDialog(false)
        setNewSupplierName("")
        setNewSupplierMaterialType("")
        setNewSupplierProductDetail("")
      }
    } catch { /* ignore */ }
    setSavingSupplier(false)
  }

  const saveNewCarrier = async () => {
    if (!newCarrierName.trim()) return
    setSavingCarrier(true)
    try {
      const res = await fetch("/api/materia-prima/carriers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCarrierName.trim(),
          phone: newCarrierPhone.trim() || null,
          license_plate: newCarrierPlate.trim() || null,
          company: newCarrierCompany.trim() || null,
        }),
      })
      if (res.ok) {
        const created = await res.json()
        await fetchCarriers()
        setSelectedCarrierId(created.id.toString())
        setShowNewCarrierDialog(false)
        setNewCarrierName("")
        setNewCarrierPhone("")
        setNewCarrierPlate("")
        setNewCarrierCompany("")
      }
    } catch { /* ignore */ }
    setSavingCarrier(false)
  }

  const handleSupplierChange = (supplierName: string) => {
    // Find all entries for this supplier
    const supplierEntries = suppliers.filter(s => s.name === supplierName)
    if (supplierEntries.length > 0) {
      // If only one material for this supplier, auto-select it
      if (supplierEntries.length === 1) {
        setSelectedSupplierId(supplierEntries[0].id.toString())
        setSelectedMaterial(supplierEntries[0].material_type)
      } else {
        // Multiple materials - select first as supplier reference but clear material
        setSelectedSupplierId(supplierEntries[0].id.toString())
        setSelectedMaterial("")
      }
    }
    setLabSampleTaken(null)
    setShowGranulometry(false)
    setShowHumidity(false)
    setSieveValues({})
    setDrySample("")
    setHumidityPercentage("")
    setWetWeightG("500")
    setDryWeightG("")
  }

  const handleMaterialChange = (materialId: string) => {
    // Find the supplier entry for this material
    const supplierEntry = suppliers.find(s => s.id.toString() === materialId)
    if (supplierEntry) {
      setSelectedSupplierId(materialId)
      setSelectedMaterial(supplierEntry.material_type)
    }
    setLabSampleTaken(null)
    setShowGranulometry(false)
    setShowHumidity(false)
    setSieveValues({})
    setDrySample("")
    setHumidityPercentage("")
    setWetWeightG("500")
    setDryWeightG("")
  }

  const resetForm = () => {
    setEditingReceiptId(null)
    setDate(new Date().toISOString().split("T")[0])
    setRemitoNumber("")
    setSelectedSupplierId("")
    setSelectedMaterial("")
    setProductionLine("")
    setQuantityKg("")
    setNotes("")
    setSelectedCarrierId("")
    setNewCarrierName("")
    setNewCarrierPhone("")
    setNewCarrierPlate("")
    setNewCarrierCompany("")
    setLabSampleTaken(null)
    setShowGranulometry(false)
    setSieveValues({})
    setWetSample("500")
    setDrySample("")
    setGranObs("")
    setShowHumidity(false)
    setHumidityPercentage("")
    setWetWeightG("500")
    setDryWeightG("")
  }

  const handleEditReceipt = (receipt: any) => {
    setEditingReceiptId(receipt.id)
    setDate(receipt.receipt_date || new Date().toISOString().split("T")[0])
    setRemitoNumber(receipt.remito_number || "")
    setSelectedSupplierId(receipt.supplier_id?.toString() || "")
    setSelectedMaterial(receipt.material_type || "")
    setProductionLine(receipt.production_line || "")
    setQuantityKg(receipt.quantity_tn ? (receipt.quantity_tn * 1000).toString() : "")
    setNotes(receipt.observations || "")
    setSelectedCarrierId(receipt.carrier_id?.toString() || "")
    setShowForm(true)
    // Scroll to form
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const handleDeleteReceipt = async (id: number) => {
    if (!confirm("¿Estás seguro de que querés eliminar este ingreso?")) return
    try {
      const res = await fetch(`/api/quality/mp-receipts/${id}`, {
        method: "DELETE",
      })
      if (res.ok) {
        await fetchReceipts()
      } else {
        alert("Error al eliminar el ingreso")
      }
    } catch {
      alert("Error al eliminar el ingreso")
    }
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        plant: selectedPlant,
        date,
        remito_number: remitoNumber,
        supplier_id: parseInt(selectedSupplierId),
        material_type: selectedMaterial,
        quantity_kg: parseFloat(quantityKg),
        production_line: isCemento ? productionLine : null,
        carrier_id: parseInt(selectedCarrierId),
        lab_sample_taken: isArenaOrPiedra ? labSampleTaken : false,
        notes,
      }

      if (showGranulometry && drySampleVal > 0) {
        payload.granulometry = {
          ...sieveValues,
          sieve_pan: panGrams,
          fineness_modulus: finenessModulus,
          wet_sample_g: parseFloat(wetSample) || 0,
          dry_sample_g: drySampleVal,
          observations: granObs,
        }
      }

      if (showHumidity && isArena) {
        payload.humidity = {
          humidity_percentage: humidityVal,
          tolerance_percentage: HUMIDITY_TOLERANCE,
          excess_percentage: excessPercentage,
          quantity_tn: quantityTn,
          credit_tn: creditTn,
          remito_number: remitoNumber,
        }
      }

      const url = editingReceiptId 
        ? `/api/quality/mp-receipts/${editingReceiptId}`
        : "/api/quality/mp-receipts"
      
      const res = await fetch(url, {
        method: editingReceiptId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        resetForm()
        setShowForm(false)
        fetchReceipts()
      } else {
        const errorData = await res.json()
        alert(errorData.error || "Error al guardar el ingreso")
      }
    } catch (error) {
      console.error("[v0] Error submitting receipt:", error)
      alert("Error al guardar el ingreso")
    }
    setSubmitting(false)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground tracking-tight">
              Ingreso de Materia Prima
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Registro de ingresos con ensayos de granulometría y humedad
            </p>
          </div>
          <Button
            onClick={() => { setShowForm(!showForm); if (showForm) resetForm() }}
            size="sm"
            className="gap-2"
          >
            <PlusCircle className="h-4 w-4" />
            Nuevo Ingreso
          </Button>
        </div>

        {/* ── Formulario ── */}
        {showForm && (
          <Card className="border-primary/20">
            <CardHeader className="pb-4">
              <CardTitle className="text-base">{editingReceiptId ? "Editar Ingreso de Materia Prima" : "Nuevo Ingreso de Materia Prima"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">

              {/* Fila básica */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Fecha</Label>
                  <Input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">N° Remito *</Label>
                  <Input
                    value={remitoNumber}
                    onChange={(e) => setRemitoNumber(e.target.value)}
                    placeholder="0001-00012345"
                    className="text-sm"
                  />
                </div>

                {/* Proveedor - Select con opción de agregar */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Proveedor *</Label>
                  <div className="flex gap-2">
                    <Select value={selectedSupplier?.name || ""} onValueChange={handleSupplierChange}>
                      <SelectTrigger className="text-sm flex-1">
                        <SelectValue placeholder="Seleccionar proveedor" />
                      </SelectTrigger>
                      <SelectContent>
                        {uniqueSupplierNames.map((name) => (
                          <SelectItem key={name} value={name}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Dialog open={showNewSupplierDialog} onOpenChange={setShowNewSupplierDialog}>
                      <DialogTrigger asChild>
                        <Button type="button" variant="outline" size="icon" className="shrink-0">
                          <Plus className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Agregar Nuevo Proveedor</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 pt-4">
                          <div className="space-y-2">
                            <Label>Nombre del Proveedor *</Label>
                            <Input
                              value={newSupplierName}
                              onChange={(e) => setNewSupplierName(e.target.value)}
                              placeholder="Ej: Piatti, Cementos Avellaneda"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Tipo de Material *</Label>
                            <Input
                              value={newSupplierMaterialType}
                              onChange={(e) => setNewSupplierMaterialType(e.target.value)}
                              placeholder="Ej: Arena, Piedra, Cemento"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Detalle del Producto</Label>
                            <Input
                              value={newSupplierProductDetail}
                              onChange={(e) => setNewSupplierProductDetail(e.target.value)}
                              placeholder="Ej: Arena de trituración, Piedra 0/10, CPC40"
                            />
                          </div>
                          <Button 
                            onClick={saveNewSupplier} 
                            disabled={savingSupplier || !newSupplierName.trim() || !newSupplierMaterialType.trim()}
                            className="w-full"
                          >
                            {savingSupplier ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            Guardar Proveedor
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
              </div>

              {/* Selector de material - filtrado por proveedor */}
              <div className="space-y-2">
                <Label className="text-xs">Tipo de Materia Prima *</Label>
                {selectedSupplier ? (
                  supplierMaterials.length === 1 ? (
                    // Solo un material para este proveedor - mostrar automáticamente
                    <div className="p-2 border rounded-md bg-muted/30">
                      <p className="text-sm font-medium">{supplierMaterials[0].product_detail || supplierMaterials[0].material_type}</p>
                      <p className="text-xs text-muted-foreground">{supplierMaterials[0].material_type}</p>
                    </div>
                  ) : (
                    // Múltiples materiales - mostrar Select
                    <Select value={selectedSupplierId} onValueChange={handleMaterialChange}>
                      <SelectTrigger className="text-sm">
                        <SelectValue placeholder="Seleccionar material" />
                      </SelectTrigger>
                      <SelectContent>
                        {supplierMaterials.map((s) => (
                          <SelectItem key={s.id} value={s.id.toString()}>
                            {s.product_detail || s.material_type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )
                ) : (
                  <p className="text-xs text-muted-foreground p-2 border rounded-md bg-muted/30">
                    Seleccioná un proveedor primero para ver los materiales disponibles
                  </p>
                )}
                {selectedMaterial && supplierMaterials.length > 1 && (
                  <Badge variant="secondary" className="text-xs">
                    {selectedMaterial} - {selectedSupplier?.product_detail}
                  </Badge>
                )}
              </div>

              {/* Línea de producción — solo cemento */}
              {isCemento && (
                <div className="flex items-start gap-4 bg-amber-500/5 border border-amber-500/20 rounded-lg p-4">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <div className="space-y-2 flex-1">
                    <Label className="text-xs font-semibold text-foreground">
                      Línea de Producción *
                    </Label>
                    <p className="text-[11px] text-muted-foreground">
                      El cemento se asigna a una línea específica para el control de stock
                    </p>
                    <div className="flex gap-3">
                      {["adoquines", "canos"].map((line) => (
                        <Button
                          key={line}
                          type="button"
                          variant={productionLine === line ? "default" : "outline"}
                          size="sm"
                          className="text-xs capitalize"
                          onClick={() => setProductionLine(line)}
                        >
                          {line === "canos" ? "Caños" : "Adoquines"}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Flete (Carrier) — obligatorio con Select y Dialog */}
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5">
                  <Truck className="h-3 w-3" />
                  Flete *
                </Label>
                <div className="flex gap-2">
                  <Select value={selectedCarrierId} onValueChange={setSelectedCarrierId}>
                    <SelectTrigger className="text-sm flex-1">
                      <SelectValue placeholder="Seleccionar transportista" />
                    </SelectTrigger>
                    <SelectContent>
                      {carriers.length === 0 ? (
                        <SelectItem value="none" disabled>No hay transportistas cargados</SelectItem>
                      ) : (
                        carriers.map((c) => (
                          <SelectItem key={c.id} value={c.id.toString()}>
                            <span className="flex items-center gap-2">
                              {c.name}
                              {c.license_plate && (
                                <span className="text-muted-foreground text-xs">
                                  ({c.license_plate})
                                </span>
                              )}
                            </span>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <Dialog open={showNewCarrierDialog} onOpenChange={setShowNewCarrierDialog}>
                    <DialogTrigger asChild>
                      <Button type="button" variant="outline" size="icon" className="shrink-0">
                        <Plus className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Agregar Nuevo Transportista</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 pt-4">
                        <div className="space-y-2">
                          <Label>Nombre del Chofer *</Label>
                          <Input
                            value={newCarrierName}
                            onChange={(e) => setNewCarrierName(e.target.value)}
                            placeholder="Nombre completo"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Teléfono</Label>
                            <Input
                              value={newCarrierPhone}
                              onChange={(e) => setNewCarrierPhone(e.target.value)}
                              placeholder="11-1234-5678"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Patente del Camión</Label>
                            <Input
                              value={newCarrierPlate}
                              onChange={(e) => setNewCarrierPlate(e.target.value)}
                              placeholder="ABC123"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Empresa de Transporte</Label>
                          <Input
                            value={newCarrierCompany}
                            onChange={(e) => setNewCarrierCompany(e.target.value)}
                            placeholder="Nombre de la empresa (opcional)"
                          />
                        </div>
                        <Button 
                          onClick={saveNewCarrier} 
                          disabled={savingCarrier || !newCarrierName.trim()}
                          className="w-full"
                        >
                          {savingCarrier ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                          Guardar Transportista
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
                {selectedCarrier && (
                  <p className="text-xs text-muted-foreground">
                    {selectedCarrier.phone && `Tel: ${selectedCarrier.phone}`}
                    {selectedCarrier.company && ` · ${selectedCarrier.company}`}
                  </p>
                )}
              </div>

              {/* Cantidad */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Cantidad (kg) *</Label>
                  <Input
                    type="number"
                    value={quantityKg}
                    onChange={(e) => setQuantityKg(e.target.value)}
                    placeholder="30000"
                    className="text-sm"
                  />
                </div>
              </div>

              {/* Toggle ensayos (Arena y Piedra) */}
              {(isArena || selectedMaterial === "piedra_0_10") && (
                <div className="flex items-center gap-3 border-t border-border pt-4">
                  <Button
                    type="button"
                    variant={showGranulometry ? "default" : "outline"}
                    size="sm"
                    onClick={() => setShowGranulometry(!showGranulometry)}
                    className="text-xs"
                  >
                    Ensayo Granulometría
                  </Button>
                  {isArena && (
                    <Button
                      type="button"
                      variant={showHumidity ? "default" : "outline"}
                      size="sm"
                      onClick={() => setShowHumidity(!showHumidity)}
                      className="text-xs"
                    >
                      Ensayo Humedad
                    </Button>
                  )}
                </div>
              )}

              {/* Sección granulometría */}
              {showGranulometry && (
                <div className="border border-border rounded-lg p-4 space-y-4 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">Ensayo de Granulometría</h3>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        Módulo de Finura
                      </div>
                      <div className="text-2xl font-bold text-foreground">
                        {finenessModulus.toFixed(2)}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Muestra Húmeda (g)</Label>
                      <Input
                        type="number"
                        value={wetSample}
                        onChange={(e) => setWetSample(e.target.value)}
                        placeholder="500"
                        className="text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Muestra Seca (g) *</Label>
                      <Input
                        type="number"
                        value={drySample}
                        onChange={(e) => setDrySample(e.target.value)}
                        placeholder="480"
                        className="text-sm"
                      />
                    </div>
                    {drySampleVal > 0 && parseFloat(wetSample) > 0 && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">Humedad de Muestra (%)</Label>
                        <div className="flex items-center h-9 px-3 rounded-md border border-border bg-muted text-sm font-medium">
                          {(
                            ((parseFloat(wetSample) - drySampleVal) / drySampleVal) *
                            100
                          ).toFixed(1)}
                          %
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 px-2 text-xs font-medium text-muted-foreground">Tamiz</th>
                          <th className="text-center py-2 px-2 text-xs font-medium text-muted-foreground">Retenido (g)</th>
                          <th className="text-center py-2 px-2 text-xs font-medium text-muted-foreground">% Retenido</th>
                          <th className="text-center py-2 px-2 text-xs font-medium text-muted-foreground">% Ret. Acum.</th>
                          <th className="text-center py-2 px-2 text-xs font-medium text-muted-foreground">% Pasa</th>
                        </tr>
                      </thead>
                      <tbody>
                        {SIEVES.map((sieve, idx) => {
                          const isPan = sieve.key === "sieve_pan"
                          const gramsVal = isPan
                            ? panGrams
                            : sieveValues[sieve.key] || 0
                          const retPct =
                            drySampleVal > 0
                              ? (gramsVal / drySampleVal) * 100
                              : 0
                          let cumPct = 0
                          for (let i = 0; i <= idx; i++) {
                            const k = SIEVES[i].key
                            const g =
                              k === "sieve_pan"
                                ? panGrams
                                : sieveValues[k] || 0
                            cumPct +=
                              drySampleVal > 0
                                ? (g / drySampleVal) * 100
                                : 0
                          }
                          const passPct = Math.max(
                            0,
                            100 - cumPct + (isPan ? retPct : 0)
                          )
                          return (
                            <tr
                              key={sieve.key}
                              className="border-b border-border/50"
                            >
                              <td className="py-1.5 px-2 text-xs font-medium">
                                {sieve.label}
                              </td>
                              <td className="py-1.5 px-2 text-center">
                                {isPan ? (
                                  <span className="text-xs text-muted-foreground">
                                    {panGrams.toFixed(1)}
                                  </span>
                                ) : (
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.1"
                                    value={sieveValues[sieve.key] || ""}
                                    onChange={(e) =>
                                      setSieveValues((prev) => ({
                                        ...prev,
                                        [sieve.key]: parseFloat(e.target.value) || 0,
                                      }))
                                    }
                                    className="w-20 h-7 text-xs text-center mx-auto"
                                  />
                                )}
                              </td>
                              <td className="py-1.5 px-2 text-center text-xs text-muted-foreground">
                                {retPct.toFixed(1)}
                              </td>
                              <td className="py-1.5 px-2 text-center text-xs text-muted-foreground">
                                {cumPct.toFixed(1)}
                              </td>
                              <td className="py-1.5 px-2 text-center text-xs text-muted-foreground">
                                {isPan ? "0.0" : passPct.toFixed(1)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-muted/50">
                          <td className="py-2 px-2 text-xs font-semibold">Total</td>
                          <td className="py-2 px-2 text-center text-xs font-semibold">
                            {(totalRetainedGrams + panGrams).toFixed(1)} g
                          </td>
                          <td className="py-2 px-2 text-center text-xs font-semibold">
                            {drySampleVal > 0
                              ? (
                                  ((totalRetainedGrams + panGrams) / drySampleVal) *
                                  100
                                ).toFixed(1)
                              : "0.0"}
                            %
                          </td>
                          <td colSpan={2} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Observaciones</Label>
                    <Input
                      value={granObs}
                      onChange={(e) => setGranObs(e.target.value)}
                      placeholder="Observaciones del ensayo..."
                      className="text-sm"
                    />
                  </div>
                </div>
              )}

              {/* Sección humedad (arena) */}
              {showHumidity && isArena && (
                <div className="border border-border rounded-lg p-4 space-y-4 bg-muted/30">
                  <h3 className="text-sm font-medium">Ensayo de Humedad — Arena</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Peso Muestra Húmeda (g)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={wetWeightG}
                        onChange={(e) => setWetWeightG(e.target.value)}
                        placeholder="500"
                        className="text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Peso Muestra Seca (g)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={dryWeightG}
                        onChange={(e) => setDryWeightG(e.target.value)}
                        placeholder="470"
                        className="text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Humedad Calculada (%)</Label>
                      <div
                        className={`flex items-center h-9 px-3 rounded-md border text-sm font-bold ${
                          humidityVal > 0
                            ? "border-primary/50 bg-primary/5 text-primary"
                            : "border-border bg-muted text-muted-foreground"
                        }`}
                      >
                        {humidityVal.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Tolerancia (%)</Label>
                      <Input
                        type="number"
                        value={HUMIDITY_TOLERANCE}
                        disabled
                        className="text-sm bg-muted"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Exceso (%)</Label>
                      <div
                        className={`flex items-center h-9 px-3 rounded-md border text-sm font-semibold ${
                          excessPercentage > 0
                            ? "border-destructive/50 bg-destructive/5 text-destructive"
                            : "border-border bg-muted text-foreground"
                        }`}
                      >
                        {excessPercentage.toFixed(1)}%
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Nota de Crédito (Tn)</Label>
                      <div
                        className={`flex items-center h-9 px-3 rounded-md border text-sm font-bold ${
                          creditTn > 0
                            ? "border-destructive/50 bg-destructive/5 text-destructive"
                            : "border-border bg-muted text-foreground"
                        }`}
                      >
                        {creditTn.toFixed(3)} Tn
                      </div>
                    </div>
                  </div>
                  {excessPercentage > 0 && (
                    <div className="flex items-start gap-2 text-xs p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                      <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-destructive">
                          Exceso de humedad detectado.
                        </span>{" "}
                        <span className="text-muted-foreground">
                          De {quantityTn.toFixed(1)} Tn entregadas con{" "}
                          {humidityVal}% de humedad, se registran{" "}
                          {creditTn.toFixed(3)} Tn de agua excedente (
                          {excessPercentage.toFixed(1)}% sobre la tolerancia del{" "}
                          {HUMIDITY_TOLERANCE}%). Esto se computará como nota de
                          crédito.
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Muestra de laboratorio — obligatorio para Arena y Piedra */}
              {isArenaOrPiedra && (
                <div className="flex items-start gap-4 bg-blue-500/5 border border-blue-500/20 rounded-lg p-4">
                  <FlaskConical className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                  <div className="space-y-2 flex-1">
                    <Label className="text-xs font-semibold text-foreground">
                      ¿Se extrajo muestra de laboratorio? *
                    </Label>
                    <p className="text-[11px] text-muted-foreground">
                      Si se extrajo muestra, se generarán ensayos pendientes de humedad y
                      granulometría asociados a este remito.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={labSampleTaken === true ? "default" : "outline"}
                        className="text-xs min-w-16"
                        onClick={() => setLabSampleTaken(true)}
                      >
                        Sí
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={labSampleTaken === false ? "default" : "outline"}
                        className="text-xs min-w-16"
                        onClick={() => setLabSampleTaken(false)}
                      >
                        No
                      </Button>
                    </div>
                    {labSampleTaken === true && (
                      <p className="text-[11px] text-blue-600 dark:text-blue-400">
                        Se crearán 2 ensayos pendientes: humedad y granulometría para
                        el remito {remitoNumber || "—"}.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Observaciones */}
              <div className="space-y-1.5">
                <Label className="text-xs">Observaciones</Label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notas adicionales..."
                  className="text-sm"
                />
              </div>

              {/* Guardar */}
              <div className="flex items-center gap-3 border-t border-border pt-4">
                <Button
                  onClick={handleSubmit}
                  disabled={submitting || !canSubmit}
                  size="sm"
                  className="gap-2"
                >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {editingReceiptId ? "Actualizar Ingreso" : "Registrar Ingreso"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setShowForm(false); resetForm() }}
                >
                  Cancelar
                </Button>
                {!canSubmit && missingFields.length > 0 && (
                  <div className="flex items-center gap-2 text-amber-600 bg-amber-50 px-3 py-2 rounded-md">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <p className="text-xs">
                      <span className="font-medium">Faltan datos:</span> {missingFields.join(", ")}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Historial ── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Historial de Ingresos</CardTitle>
              <Button variant="outline" size="sm" className="gap-2 text-xs">
                <FileDown className="h-3.5 w-3.5" />
                Exportar
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : receipts.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                No hay ingresos registrados
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Fecha</th>
                      <th className="text-left py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Remito</th>
                      <th className="text-left py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Proveedor</th>
                      <th className="text-left py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Material</th>
                      <th className="text-left py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Flete</th>
                      <th className="text-right py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Cantidad</th>
                      <th className="text-center py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipts.map((r: any) => (
                      <tr
                        key={r.id}
                        className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                      >
                        <td className="py-2.5 px-3 text-xs">
                          {r.receipt_date ? new Date(r.receipt_date + "T12:00:00").toLocaleDateString("es-AR") : "—"}
                        </td>
                        <td className="py-2.5 px-3 text-xs font-mono">
                          {r.remito_number}
                        </td>
                        <td className="py-2.5 px-3 text-xs">
                          {r.supplier?.name || "—"}
                        </td>
                        <td className="py-2.5 px-3">
                          <Badge variant="secondary" className="text-[10px]">
                            {r.material_type?.replace(/_/g, " ") || "—"}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3 text-xs text-muted-foreground">
                          {r.carrier?.name || "—"}
                        </td>
                        <td className="py-2.5 px-3 text-xs text-right font-medium">
                          {typeof r.quantity_tn === "number" ? r.quantity_tn.toFixed(1) : "—"} Tn
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleEditReceipt(r)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => handleDeleteReceipt(r.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
