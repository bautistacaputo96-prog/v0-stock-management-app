"use client"

import { useState, useEffect, useCallback } from "react"
import { usePlant } from "@/lib/plant-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Navigation } from "@/components/navigation"
import { PlusCircle, FileDown, AlertTriangle, CheckCircle2, Loader2, UserPlus } from "lucide-react"

// Granulometry sieves matching the physical form
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

// Common material types
const DEFAULT_MATERIAL_TYPES = [
  "Arena",
  "Piedra 0-10",
  "Piedra 0-6 Lavada",
  "Piedra 0-6 Limpia",
  "Cemento",
]

interface Supplier {
  id: number
  name: string
  material_type: string
  product_detail: string
  line_type: string
}

interface Receipt {
  id: number
  date: string
  remito_number: string
  supplier: Supplier
  material_type: string
  quantity_kg: number
  notes: string
}

function calculateFinenessModulus(sieves: Record<string, number>, totalWeight: number): number {
  if (totalWeight <= 0) return 0
  // Calculate retained percentages from grams
  const retainedKeys = ["sieve_9500", "sieve_4750", "sieve_2360", "sieve_1180", "sieve_600", "sieve_300", "sieve_150"]
  const retainedPcts = retainedKeys.map((k) => ((sieves[k] || 0) / totalWeight) * 100)

  // Cumulative retained percentages
  const cumulative: number[] = []
  let sum = 0
  for (const pct of retainedPcts) {
    sum += pct
    cumulative.push(sum)
  }

  const mf = cumulative.reduce((a, b) => a + b, 0) / 100
  return Math.round(mf * 100) / 100
}

export default function IngresoMPPage() {
  const { selectedPlant } = usePlant()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showForm, setShowForm] = useState(false)

  // Form state
  const [date, setDate] = useState(new Date().toISOString().split("T")[0])
  const [remitoNumber, setRemitoNumber] = useState("")
  const [quantityKg, setQuantityKg] = useState("")
  const [notes, setNotes] = useState("")

  // Supplier combobox state
  const [supplierSearch, setSupplierSearch] = useState("")
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null)
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false)

  // Material type combobox state
  const [materialTypeSearch, setMaterialTypeSearch] = useState("")
  const [showMaterialDropdown, setShowMaterialDropdown] = useState(false)
  const [customMaterialTypes, setCustomMaterialTypes] = useState<string[]>([])

  // Production line for cement
  const [productionLine, setProductionLine] = useState<string>("")
  const isCemento = materialTypeSearch.toLowerCase().includes("cemento")

  const allMaterialTypes = [...new Set([...DEFAULT_MATERIAL_TYPES, ...customMaterialTypes, ...suppliers.map((s) => s.material_type)])]

  // Granulometry state
  const [showGranulometry, setShowGranulometry] = useState(false)
  const [sieveValues, setSieveValues] = useState<Record<string, number>>({})
  const [wetSample, setWetSample] = useState("500")
  const [drySample, setDrySample] = useState("")
  const [granObs, setGranObs] = useState("")

  // Humidity state
  const [showHumidity, setShowHumidity] = useState(false)
  const [humidityPercentage, setHumidityPercentage] = useState("")

  const isArena = materialTypeSearch.toLowerCase().includes("arena")

  // Granulometry calculations (now in grams, not percentages)
  const drySampleVal = parseFloat(drySample) || 0
  const totalRetainedGrams = Object.entries(sieveValues)
    .filter(([key]) => key !== "sieve_pan")
    .reduce((sum, [, val]) => sum + (val || 0), 0)
  const panGrams = Math.max(0, drySampleVal - totalRetainedGrams)
  const finenessModulus = showGranulometry ? calculateFinenessModulus(sieveValues, drySampleVal) : 0

  // Humidity calculations
  const humidityVal = parseFloat(humidityPercentage) || 0
  const excessPercentage = Math.max(0, humidityVal - HUMIDITY_TOLERANCE)
  const quantityTn = (parseFloat(quantityKg) || 0) / 1000
  const creditTn = quantityTn * (excessPercentage / 100)

  // Filtered suppliers
  const filteredSuppliers = supplierSearch.trim()
    ? suppliers.filter((s) => s.name.toLowerCase().includes(supplierSearch.toLowerCase()))
    : suppliers

  const supplierNameExists = suppliers.some((s) => s.name.toLowerCase() === supplierSearch.trim().toLowerCase())

  // Filtered material types
  const filteredMaterials = materialTypeSearch.trim()
    ? allMaterialTypes.filter((m) => m.toLowerCase().includes(materialTypeSearch.toLowerCase()))
    : allMaterialTypes

  const materialExists = allMaterialTypes.some((m) => m.toLowerCase() === materialTypeSearch.trim().toLowerCase())

  const fetchSuppliers = useCallback(async () => {
    try {
      const res = await fetch("/api/quality/suppliers")
      if (res.ok) {
        const data = await res.json()
        setSuppliers(data)
      }
    } catch { /* ignore */ }
  }, [])

  const fetchReceipts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/quality/mp-receipts?plant=${selectedPlant}`)
      if (res.ok) {
        const data = await res.json()
        setReceipts(data)
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [selectedPlant])

  useEffect(() => {
    fetchSuppliers()
    fetchReceipts()
  }, [fetchSuppliers, fetchReceipts])

  const selectSupplier = (supplier: Supplier) => {
    setSelectedSupplierId(supplier.id)
    setSupplierSearch(supplier.name)
    setShowSupplierDropdown(false)
    // Auto-fill material type if not already set
    if (!materialTypeSearch) {
      setMaterialTypeSearch(supplier.material_type)
    }
  }

  const addNewSupplier = async () => {
    if (!supplierSearch.trim() || !materialTypeSearch.trim()) return
    try {
      const res = await fetch("/api/quality/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: supplierSearch.trim(),
          material_type: materialTypeSearch.trim().toLowerCase().replace(/ /g, "_"),
          product_detail: materialTypeSearch.trim(),
          line_type: "ambas",
        }),
      })
      if (res.ok) {
        const created = await res.json()
        await fetchSuppliers()
        setSelectedSupplierId(created.id)
        setShowSupplierDropdown(false)
      }
    } catch { /* ignore */ }
  }

  const selectMaterial = (material: string) => {
    setMaterialTypeSearch(material)
    setShowMaterialDropdown(false)
  }

  const addNewMaterial = () => {
    if (!materialTypeSearch.trim()) return
    setCustomMaterialTypes((prev) => [...prev, materialTypeSearch.trim()])
    setShowMaterialDropdown(false)
  }

  const resetForm = () => {
    setDate(new Date().toISOString().split("T")[0])
    setRemitoNumber("")
    setSupplierSearch("")
    setSelectedSupplierId(null)
    setMaterialTypeSearch("")
    setProductionLine("")
    setQuantityKg("")
    setNotes("")
    setShowGranulometry(false)
    setSieveValues({})
    setWetSample("500")
    setDrySample("")
    setGranObs("")
    setShowHumidity(false)
    setHumidityPercentage("")
  }

  const handleSubmit = async () => {
    if (!remitoNumber || !supplierSearch.trim() || !quantityKg) return
    if (isCemento && !productionLine) return
    setSubmitting(true)
    try {
      // Resolve supplier ID
      let suppId = selectedSupplierId
      if (!suppId) {
        // Create supplier on-the-fly
        const res = await fetch("/api/quality/suppliers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: supplierSearch.trim(),
            material_type: materialTypeSearch.trim().toLowerCase().replace(/ /g, "_") || "otro",
            product_detail: materialTypeSearch.trim() || "Otro",
            line_type: "ambas",
          }),
        })
        if (res.ok) {
          const created = await res.json()
          suppId = created.id
          await fetchSuppliers()
        }
      }
      if (!suppId) { setSubmitting(false); return }

      const payload: Record<string, unknown> = {
        plant: selectedPlant,
        date,
        remito_number: remitoNumber,
        supplier_id: suppId,
        material_type: materialTypeSearch.trim().toLowerCase().replace(/ /g, "_") || "otro",
        quantity_kg: parseFloat(quantityKg),
        production_line: isCemento ? productionLine : null,
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

      const res = await fetch("/api/quality/mp-receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        resetForm()
        setShowForm(false)
        fetchReceipts()
      }
    } catch { /* ignore */ }
    setSubmitting(false)
  }

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground tracking-tight">Ingreso de Materia Prima</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Registro de ingresos con ensayos de granulometria y humedad</p>
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

        {/* New Receipt Form */}
        {showForm && (
          <Card className="border-primary/20">
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Nuevo Ingreso de Materia Prima</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Basic data */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Fecha</Label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">N. Remito</Label>
                  <Input value={remitoNumber} onChange={(e) => setRemitoNumber(e.target.value)} placeholder="0001-00012345" className="text-sm" />
                </div>

                {/* Supplier combobox */}
                <div className="space-y-1.5 relative">
                  <Label className="text-xs">Proveedor</Label>
                  <Input
                    value={supplierSearch}
                    onChange={(e) => { setSupplierSearch(e.target.value); setSelectedSupplierId(null); setShowSupplierDropdown(true) }}
                    onFocus={() => setShowSupplierDropdown(true)}
                    onBlur={() => setTimeout(() => setShowSupplierDropdown(false), 200)}
                    placeholder="Escribir proveedor..."
                    className="text-sm"
                    autoComplete="off"
                  />
                  {showSupplierDropdown && supplierSearch.trim().length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-card border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                      {filteredSuppliers.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => selectSupplier(s)}
                        >
                          {s.name} <span className="text-muted-foreground text-xs">- {s.product_detail}</span>
                        </button>
                      ))}
                      {!supplierNameExists && supplierSearch.trim().length >= 2 && (
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-muted/50 transition-colors flex items-center gap-2 border-t border-border/50"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={addNewSupplier}
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          Agregar "{supplierSearch.trim()}"
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Material type combobox */}
                <div className="space-y-1.5 relative">
                  <Label className="text-xs">Tipo de Materia Prima</Label>
                  <Input
                    value={materialTypeSearch}
                    onChange={(e) => { setMaterialTypeSearch(e.target.value); setShowMaterialDropdown(true) }}
                    onFocus={() => setShowMaterialDropdown(true)}
                    onBlur={() => setTimeout(() => setShowMaterialDropdown(false), 200)}
                    placeholder="Escribir material..."
                    className="text-sm"
                    autoComplete="off"
                  />
                  {showMaterialDropdown && (
                    <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-card border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                      {filteredMaterials.map((m) => (
                        <button
                          key={m}
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => selectMaterial(m)}
                        >
                          {m}
                        </button>
                      ))}
                      {!materialExists && materialTypeSearch.trim().length >= 2 && (
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-muted/50 transition-colors flex items-center gap-2 border-t border-border/50"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={addNewMaterial}
                        >
                          <PlusCircle className="h-3.5 w-3.5" />
                          Agregar "{materialTypeSearch.trim()}"
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Production line for cement */}
              {isCemento && (
                <div className="flex items-start gap-4 bg-amber-500/5 border border-amber-500/20 rounded-lg p-4">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <div className="space-y-2 flex-1">
                    <Label className="text-xs font-semibold text-foreground">Linea de Produccion *</Label>
                    <p className="text-[11px] text-muted-foreground">El cemento se asigna a una linea especifica para el control de stock</p>
                    <div className="flex gap-3">
                      <Button
                        type="button"
                        variant={productionLine === "adoquines" ? "default" : "outline"}
                        size="sm"
                        className="text-xs gap-2"
                        onClick={() => setProductionLine("adoquines")}
                      >
                        Adoquines
                      </Button>
                      <Button
                        type="button"
                        variant={productionLine === "canos" ? "default" : "outline"}
                        size="sm"
                        className="text-xs gap-2"
                        onClick={() => setProductionLine("canos")}
                      >
                        Canos
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Quantity */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Cantidad (kg)</Label>
                  <Input type="number" value={quantityKg} onChange={(e) => setQuantityKg(e.target.value)} placeholder="30000" className="text-sm" />
                </div>
              </div>

              {/* Toggle ensayos */}
              <div className="flex items-center gap-3 border-t border-border pt-4">
                <Button
                  type="button"
                  variant={showGranulometry ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowGranulometry(!showGranulometry)}
                  className="text-xs"
                >
                  Ensayo Granulometria
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

              {/* Granulometry section */}
              {showGranulometry && (
                <div className="border border-border rounded-lg p-4 space-y-4 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">Ensayo de Granulometria</h3>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Modulo de Finura</div>
                      <div className="text-2xl font-bold text-foreground">{finenessModulus.toFixed(2)}</div>
                    </div>
                  </div>

                  {/* Wet / Dry sample */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Muestra Humeda (g)</Label>
                      <Input type="number" value={wetSample} onChange={(e) => setWetSample(e.target.value)} placeholder="500" className="text-sm" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Muestra Seca (g) *</Label>
                      <Input type="number" value={drySample} onChange={(e) => setDrySample(e.target.value)} placeholder="480" className="text-sm" />
                    </div>
                    {drySampleVal > 0 && parseFloat(wetSample) > 0 && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">Humedad de Muestra (%)</Label>
                        <div className="flex items-center h-9 px-3 rounded-md border border-border bg-muted text-sm font-medium">
                          {(((parseFloat(wetSample) - drySampleVal) / drySampleVal) * 100).toFixed(1)}%
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Sieve table */}
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
                          const gramsVal = isPan ? panGrams : (sieveValues[sieve.key] || 0)
                          const retPct = drySampleVal > 0 ? (gramsVal / drySampleVal) * 100 : 0

                          // Cumulative retained %
                          let cumPct = 0
                          for (let i = 0; i <= idx; i++) {
                            const k = SIEVES[i].key
                            const g = k === "sieve_pan" ? panGrams : (sieveValues[k] || 0)
                            cumPct += drySampleVal > 0 ? (g / drySampleVal) * 100 : 0
                          }
                          const passPct = Math.max(0, 100 - cumPct + (isPan ? retPct : 0))

                          return (
                            <tr key={sieve.key} className="border-b border-border/50">
                              <td className="py-1.5 px-2 text-xs font-medium">{sieve.label}</td>
                              <td className="py-1.5 px-2 text-center">
                                {isPan ? (
                                  <span className="text-xs text-muted-foreground">{panGrams.toFixed(1)}</span>
                                ) : (
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.1"
                                    value={sieveValues[sieve.key] || ""}
                                    onChange={(e) => {
                                      setSieveValues((prev) => ({
                                        ...prev,
                                        [sieve.key]: parseFloat(e.target.value) || 0,
                                      }))
                                    }}
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
                          <td className="py-2 px-2 text-center text-xs font-semibold">{(totalRetainedGrams + panGrams).toFixed(1)} g</td>
                          <td className="py-2 px-2 text-center text-xs font-semibold">{drySampleVal > 0 ? (((totalRetainedGrams + panGrams) / drySampleVal) * 100).toFixed(1) : "0.0"}%</td>
                          <td colSpan={2} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Observations */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Observaciones</Label>
                    <Input value={granObs} onChange={(e) => setGranObs(e.target.value)} placeholder="Observaciones del ensayo..." className="text-sm" />
                  </div>
                </div>
              )}

              {/* Humidity section (arena only) */}
              {showHumidity && isArena && (
                <div className="border border-border rounded-lg p-4 space-y-4 bg-muted/30">
                  <h3 className="text-sm font-medium">Ensayo de Humedad - Arena</h3>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Humedad Medida (%)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={humidityPercentage}
                        onChange={(e) => setHumidityPercentage(e.target.value)}
                        placeholder="6.0"
                        className="text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Tolerancia (%)</Label>
                      <Input type="number" value={HUMIDITY_TOLERANCE} disabled className="text-sm bg-muted" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Exceso (%)</Label>
                      <div className={`flex items-center h-9 px-3 rounded-md border text-sm font-semibold ${excessPercentage > 0 ? "border-destructive/50 bg-destructive/5 text-destructive" : "border-border bg-muted text-foreground"}`}>
                        {excessPercentage.toFixed(1)}%
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Nota de Credito (Tn)</Label>
                      <div className={`flex items-center h-9 px-3 rounded-md border text-sm font-bold ${creditTn > 0 ? "border-destructive/50 bg-destructive/5 text-destructive" : "border-border bg-muted text-foreground"}`}>
                        {creditTn.toFixed(3)} Tn
                      </div>
                    </div>
                  </div>

                  {excessPercentage > 0 && (
                    <div className="flex items-start gap-2 text-xs p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                      <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-destructive">Exceso de humedad detectado.</span>{" "}
                        <span className="text-muted-foreground">
                          De {quantityTn.toFixed(1)} Tn entregadas con {humidityVal}% de humedad, se registran {creditTn.toFixed(3)} Tn de agua excedente ({excessPercentage.toFixed(1)}% sobre la tolerancia del {HUMIDITY_TOLERANCE}%). Esto se computara como nota de credito.
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              <div className="space-y-1.5">
                <Label className="text-xs">Observaciones</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas adicionales..." className="text-sm" />
              </div>

              {/* Submit */}
              <div className="flex items-center gap-3 border-t border-border pt-4">
                <Button onClick={handleSubmit} disabled={submitting || !remitoNumber || !supplierSearch.trim() || !quantityKg} size="sm" className="gap-2">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Registrar Ingreso
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setShowForm(false); resetForm() }}>
                  Cancelar
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* History table */}
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
                      <th className="text-right py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Cantidad</th>
                      <th className="text-center py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Ensayos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipts.map((r) => (
                      <tr key={r.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 px-3 text-xs">{new Date(r.date).toLocaleDateString("es-AR")}</td>
                        <td className="py-2.5 px-3 text-xs font-mono">{r.remito_number}</td>
                        <td className="py-2.5 px-3 text-xs">{r.supplier?.name || "-"}</td>
                        <td className="py-2.5 px-3">
                          <Badge variant="secondary" className="text-[10px]">{r.material_type?.replace(/_/g, " ")}</Badge>
                        </td>
                        <td className="py-2.5 px-3 text-xs text-right font-medium">{(r.quantity_kg / 1000).toFixed(1)} Tn</td>
                        <td className="py-2.5 px-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Badge variant="outline" className="text-[9px]">G</Badge>
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
