"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Plus, UserPlus, Truck, Calculator, AlertTriangle } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { AddSupplierDialog } from "./add-supplier-dialog"
import { AddCarrierDialog } from "./add-carrier-dialog"
import { Card, CardContent } from "@/components/ui/card"

const HUMIDITY_TOLERANCE = 3.0 // 3% tolerance
const WET_SAMPLE_WEIGHT = 500 // Fixed wet sample weight in grams

type Material = {
  id: string
  name: string
  unit: string
  plant_id: string
}

type Supplier = {
  id: string
  name: string
}

type Carrier = {
  id: string
  name: string
}

export function AddStockEntryDialog({ materials, onSuccess }: { materials: Material[], onSuccess?: () => void }) {
  const [open, setOpen] = useState(false)
  const [addSupplierOpen, setAddSupplierOpen] = useState(false)
  const [addCarrierOpen, setAddCarrierOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [filteredSuppliers, setFilteredSuppliers] = useState<Supplier[]>([])
  const [filteredCarriers, setFilteredCarriers] = useState<Carrier[]>([])
  const [showHumidityCalc, setShowHumidityCalc] = useState(false)
  const [drySampleWeight, setDrySampleWeight] = useState("")
  const [formData, setFormData] = useState({
    material_id: "",
    quantity: "",
    supplier_id: "",
    carrier_id: "",
    remito: "",
    humidity_percentage: "",
    sample_taken_granulometry: "",
    notes: "",
    entry_date: new Date().toISOString().slice(0, 10),
  })
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    const loadSuppliers = async () => {
      if (!formData.material_id) {
        setFilteredSuppliers([])
        return
      }

      const supabase = createClient()
      const { data, error } = await supabase
        .from("material_suppliers")
        .select(`
          supplier_id,
          suppliers (
            id,
            name
          )
        `)
        .eq("material_id", formData.material_id)

      if (!error && data) {
        const supplierList = data
          .map((ms: any) => ms.suppliers)
          .filter(Boolean)
          .map((s: any) => ({ id: s.id, name: s.name }))
        setFilteredSuppliers(supplierList)
      }
    }

    loadSuppliers()
  }, [formData.material_id])

  useEffect(() => {
    const loadCarriers = async () => {
      if (!formData.supplier_id) {
        setFilteredCarriers([])
        return
      }

      const supabase = createClient()
      const { data, error } = await supabase.from("carriers").select("id, name").eq("supplier_id", formData.supplier_id)

      if (!error && data) {
        setFilteredCarriers(data)
      }
    }

    loadCarriers()
  }, [formData.supplier_id])

  const calculateHumidity = () => {
    const dryWeight = Number.parseFloat(drySampleWeight)
    if (dryWeight > 0 && dryWeight < WET_SAMPLE_WEIGHT) {
      const humidity = ((WET_SAMPLE_WEIGHT - dryWeight) / dryWeight) * 100
      setFormData({ ...formData, humidity_percentage: humidity.toFixed(2) })
      setShowHumidityCalc(false)
      setDrySampleWeight("")
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const selectedMaterial = materials.find((m) => m.id === formData.material_id)
    const isSandMaterial = selectedMaterial?.name.toLowerCase().includes("arena")
    // Solo Arena Fina requiere ensayo granulométrico
    const requiresGranulometry = selectedMaterial?.name === "Arena Fina"

    if (!formData.material_id || Number.parseFloat(formData.quantity) <= 0 || !formData.supplier_id) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Debes seleccionar un material, un proveedor y una cantidad valida",
      })
      return
    }

    if (!formData.remito.trim()) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "El numero de remito es obligatorio",
      })
      return
    }

    if (!formData.carrier_id) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Debes seleccionar un flete",
      })
      return
    }

    if (isSandMaterial && (!formData.humidity_percentage || Number.parseFloat(formData.humidity_percentage) < 0)) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "La humedad es obligatoria para materiales de arena",
      })
      return
    }

    if (requiresGranulometry && !formData.sample_taken_granulometry) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Debes indicar si se extrajo muestra para granulometria",
      })
      return
    }

    setLoading(true)

    try {
      const supabase = createClient()
      const originalQuantity = Number.parseFloat(formData.quantity) // This is the wet weight from the truck
      let dryQuantity = originalQuantity
      const humidity = isSandMaterial && formData.humidity_percentage 
        ? Number.parseFloat(formData.humidity_percentage) 
        : 0

      // For materials with humidity, calculate dry weight
      // Formula: dry_weight = wet_weight / (1 + humidity/100)
      if (requiresGranulometry && humidity > 0) {
        dryQuantity = originalQuantity / (1 + humidity / 100)
      }

      // Insert stock entry - quantity muestra peso húmedo, dry_quantity es el control interno
      const { data: entryData, error: entryError } = await supabase
        .from("stock_entries")
        .insert({
          material_id: formData.material_id,
          quantity: originalQuantity, // Peso húmedo visible (lo que ingresó)
          original_quantity: originalQuantity, // Mismo valor para compatibilidad
          dry_quantity: dryQuantity, // Control interno en seco
          supplier_id: formData.supplier_id,
          carrier_id: formData.carrier_id,
          remito: formData.remito.trim(),
          humidity_percentage: requiresGranulometry ? humidity : null,
          sample_taken_granulometry: requiresGranulometry ? formData.sample_taken_granulometry === "yes" : false,
          notes: formData.notes || null,
          entry_date: `${formData.entry_date}T12:00:00`,
        })
        .select()
        .single()

      if (entryError) throw entryError

      // Update material stock - always use dry_stock for materials with humidity control
      if (requiresGranulometry) {
        // Get current dry_stock and update it
        const { data: materialData } = await supabase
          .from("materials")
          .select("dry_stock, current_stock")
          .eq("id", formData.material_id)
          .single()
        
        const currentDryStock = materialData?.dry_stock || 0
        const newDryStock = currentDryStock + dryQuantity
        
        await supabase
          .from("materials")
          .update({ 
            dry_stock: newDryStock,
            current_stock: newDryStock // Keep current_stock in sync for now
          })
          .eq("id", formData.material_id)
      } else {
        // For non-humidity materials, update current_stock normally
        const { data: materialData } = await supabase
          .from("materials")
          .select("current_stock")
          .eq("id", formData.material_id)
          .single()
        
        const currentStock = materialData?.current_stock || 0
        await supabase
          .from("materials")
          .update({ current_stock: currentStock + originalQuantity })
          .eq("id", formData.material_id)
      }

      // If humidity exceeds tolerance, log the excess
      if (isSandMaterial && formData.humidity_percentage) {
        const humidity = Number.parseFloat(formData.humidity_percentage)
        if (humidity > HUMIDITY_TOLERANCE) {
          const excessHumidity = humidity - HUMIDITY_TOLERANCE
          const excessQuantityKg = originalQuantity * (excessHumidity / 100)
          const excessQuantityTn = excessQuantityKg / 1000

          await supabase.from("humidity_excess_log").insert({
            stock_entry_id: entryData.id,
            entry_date: formData.entry_date,
            material_id: formData.material_id,
            supplier_id: formData.supplier_id,
            remito: formData.remito.trim(),
            original_quantity_kg: originalQuantity,
            humidity_percentage: humidity,
            tolerance_percentage: HUMIDITY_TOLERANCE,
            excess_humidity_percentage: excessHumidity,
            excess_quantity_kg: excessQuantityKg,
            excess_quantity_tn: excessQuantityTn,
            plant_id: selectedMaterial?.plant_id,
          })
        }
      }

      // If granulometry sample was taken, create pending test
      if (requiresGranulometry && formData.sample_taken_granulometry === "yes") {
        const { data: testData, error: testError } = await supabase
          .from("granulometria_tests")
          .insert({
            extraction_date: formData.entry_date,
            material_id: formData.material_id,
            supplier_id: formData.supplier_id,
            provider: filteredSuppliers.find(s => s.id === formData.supplier_id)?.name || "",
            aggregate_type: selectedMaterial?.name || "",
            remito: formData.remito.trim(),
            plant_id: selectedMaterial?.plant_id,
            stock_entry_id: entryData.id,
            comments: "Pendiente de completar ensayo",
          })
          .select()
          .single()

        if (!testError && testData) {
          await supabase
            .from("stock_entries")
            .update({ granulometry_test_id: testData.id })
            .eq("id", entryData.id)
        }
      }

      const displayQuantity = `${originalQuantity.toLocaleString("es-AR")} ${selectedMaterial?.unit}`

      toast({
        title: "Ingreso registrado",
        description: `Se agregaron ${displayQuantity} de ${selectedMaterial?.name}`,
      })

      setFormData({
        material_id: "",
        quantity: "",
        supplier_id: "",
        carrier_id: "",
        remito: "",
        humidity_percentage: "",
        sample_taken_granulometry: "",
        notes: "",
        entry_date: new Date().toISOString().slice(0, 10),
      })
      setOpen(false)
      router.refresh()
      onSuccess?.()
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo registrar el ingreso",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSupplierAdded = (supplierId: string) => {
    setFormData({ ...formData, supplier_id: supplierId, carrier_id: "" })
    router.refresh()
  }

  const handleCarrierAdded = (carrierId: string) => {
    setFormData({ ...formData, carrier_id: carrierId })
    router.refresh()
  }

  const selectedMaterial = materials.find((m) => m.id === formData.material_id)
  const selectedSupplier = filteredSuppliers.find((s) => s.id === formData.supplier_id)
  const isSandMaterial = selectedMaterial?.name.toLowerCase().includes("arena")
  const requiresGranulometry = isSandMaterial || selectedMaterial?.name.toLowerCase().includes("piedra") || selectedMaterial?.name.toLowerCase().includes("triturac")
  
  const humidity = Number.parseFloat(formData.humidity_percentage) || 0
  const hasExcessHumidity = isSandMaterial && humidity > HUMIDITY_TOLERANCE

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button className="bg-green-600 hover:bg-green-700">
            <Plus className="h-4 w-4 mr-2" />
            Registrar Ingreso
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-lg">
          <DialogHeader>
            <DialogTitle>Registrar Ingreso</DialogTitle>
            <DialogDescription>Registra la entrada de materia prima al acopio</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="entry-material">Material</Label>
              <Select
                value={formData.material_id}
                onValueChange={(value) =>
                  setFormData({
                    ...formData,
                    material_id: value,
                    supplier_id: "",
                    carrier_id: "",
                    humidity_percentage: "",
                    sample_taken_granulometry: "",
                  })
                }
              >
                <SelectTrigger id="entry-material">
                  <SelectValue placeholder="Seleccionar material..." />
                </SelectTrigger>
                <SelectContent>
                  {materials.map((material) => (
                    <SelectItem key={material.id} value={material.id}>
                      {material.name} ({material.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {formData.material_id && (
              <div className="space-y-2">
                <Label htmlFor="entry-supplier">
                  Proveedor <span className="text-red-500">*</span>
                </Label>
                <div className="flex gap-2">
                  <Select
                    value={formData.supplier_id}
                    onValueChange={(value) => {
                      if (value === "ADD_NEW") {
                        setAddSupplierOpen(true)
                      } else {
                        setFormData({ ...formData, supplier_id: value, carrier_id: "" })
                      }
                    }}
                  >
                    <SelectTrigger id="entry-supplier" className="flex-1">
                      <SelectValue placeholder="Seleccionar proveedor..." />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredSuppliers.length === 0 ? (
                        <SelectItem value="ADD_NEW" className="text-blue-600 font-medium">
                          <div className="flex items-center">
                            <UserPlus className="h-4 w-4 mr-2" />
                            Agregar nuevo proveedor
                          </div>
                        </SelectItem>
                      ) : (
                        <>
                          {filteredSuppliers.map((supplier) => (
                            <SelectItem key={supplier.id} value={supplier.id}>
                              {supplier.name}
                            </SelectItem>
                          ))}
                          <SelectItem value="ADD_NEW" className="text-blue-600 font-medium border-t mt-1 pt-2">
                            <div className="flex items-center">
                              <UserPlus className="h-4 w-4 mr-2" />
                              Agregar nuevo proveedor
                            </div>
                          </SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                {filteredSuppliers.length === 0 && !formData.supplier_id && (
                  <p className="text-xs text-muted-foreground">
                    No hay proveedores registrados para {selectedMaterial?.name}
                  </p>
                )}
              </div>
            )}

            {formData.supplier_id && (
              <div className="space-y-2">
                <Label htmlFor="entry-carrier">
                  Flete <span className="text-red-500">*</span>
                </Label>
                <div className="flex gap-2">
                  <Select
                    value={formData.carrier_id}
                    onValueChange={(value) => {
                      if (value === "ADD_NEW") {
                        setAddCarrierOpen(true)
                      } else {
                        setFormData({ ...formData, carrier_id: value })
                      }
                    }}
                  >
                    <SelectTrigger id="entry-carrier" className="flex-1">
                      <SelectValue placeholder="Seleccionar flete..." />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredCarriers.length === 0 ? (
                        <SelectItem value="ADD_NEW" className="text-blue-600 font-medium">
                          <div className="flex items-center">
                            <Truck className="h-4 w-4 mr-2" />
                            Agregar nuevo flete
                          </div>
                        </SelectItem>
                      ) : (
                        <>
                          {filteredCarriers.map((carrier) => (
                            <SelectItem key={carrier.id} value={carrier.id}>
                              {carrier.name}
                            </SelectItem>
                          ))}
                          <SelectItem value="ADD_NEW" className="text-blue-600 font-medium border-t mt-1 pt-2">
                            <div className="flex items-center">
                              <Truck className="h-4 w-4 mr-2" />
                              Agregar nuevo flete
                            </div>
                          </SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                {filteredCarriers.length === 0 && !formData.carrier_id && (
                  <p className="text-xs text-muted-foreground">
                    No hay fletes registrados para {selectedSupplier?.name}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="quantity">Cantidad (kg)</Label>
              <Input
                id="quantity"
                type="number"
                step="0.01"
                value={formData.quantity}
                onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                placeholder="0"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="entry-date">Fecha</Label>
              <Input
                id="entry-date"
                type="date"
                value={formData.entry_date}
                onChange={(e) => setFormData({ ...formData, entry_date: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="remito">
                Numero de Remito <span className="text-red-500">*</span>
              </Label>
              <Input
                id="remito"
                value={formData.remito}
                onChange={(e) => setFormData({ ...formData, remito: e.target.value })}
                placeholder="Ingrese el numero de remito"
                required
              />
            </div>

            {isSandMaterial && (
              <div className="space-y-2">
                <Label htmlFor="humidity">
                  Humedad (%) <span className="text-red-500">*</span>
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="humidity"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={formData.humidity_percentage}
                    onChange={(e) => setFormData({ ...formData, humidity_percentage: e.target.value })}
                    placeholder="0.00"
                    required
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowHumidityCalc(!showHumidityCalc)}
                  >
                    <Calculator className="h-4 w-4 mr-2" />
                    Calcular
                  </Button>
                </div>

                {showHumidityCalc && (
                  <Card className="mt-2 bg-muted/50">
                    <CardContent className="pt-4 space-y-3">
                      <p className="text-sm font-medium">Calculadora de Humedad</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Peso Muestra Humeda (g)</Label>
                          <Input
                            type="number"
                            value={WET_SAMPLE_WEIGHT}
                            disabled
                            className="bg-muted h-8 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Peso Muestra Seca (g)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={drySampleWeight}
                            onChange={(e) => setDrySampleWeight(e.target.value)}
                            placeholder="Ej: 475"
                            className="h-8 text-sm"
                          />
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        {drySampleWeight && Number.parseFloat(drySampleWeight) < WET_SAMPLE_WEIGHT && Number.parseFloat(drySampleWeight) > 0 && (
                          <p className="text-sm">
                            Humedad:{" "}
                            <span className="font-semibold">
                              {(((WET_SAMPLE_WEIGHT - Number.parseFloat(drySampleWeight)) / Number.parseFloat(drySampleWeight)) * 100).toFixed(2)}%
                            </span>
                          </p>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          onClick={calculateHumidity}
                          disabled={!drySampleWeight || Number.parseFloat(drySampleWeight) <= 0 || Number.parseFloat(drySampleWeight) >= WET_SAMPLE_WEIGHT}
                        >
                          Aplicar
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {hasExcessHumidity && formData.quantity && (
                  <Card className="border-amber-500 bg-amber-50 dark:bg-amber-950/20">
                    <CardContent className="pt-3 pb-3">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                        <div className="text-sm">
                          <p className="font-medium text-amber-800 dark:text-amber-200">
                            Humedad excede tolerancia del {HUMIDITY_TOLERANCE}%
                          </p>
                          <p className="text-amber-700 dark:text-amber-300 mt-1">
                            Exceso: {(humidity - HUMIDITY_TOLERANCE).toFixed(2)}% = {" "}
                            <span className="font-semibold">
                              {((Number.parseFloat(formData.quantity) * (humidity - HUMIDITY_TOLERANCE)) / 100 / 1000).toFixed(4)} Tn
                            </span>
                            {" "}a reconocer por proveedor
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {requiresGranulometry && (
              <div className="space-y-2">
                <Label>
                  Se extrajo muestra para ensayo de granulometria? <span className="text-red-500">*</span>
                </Label>
                <RadioGroup
                  value={formData.sample_taken_granulometry}
                  onValueChange={(value) => setFormData({ ...formData, sample_taken_granulometry: value })}
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="yes" id="granulo-yes" />
                    <Label htmlFor="granulo-yes" className="font-normal cursor-pointer">Si</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="no" id="granulo-no" />
                    <Label htmlFor="granulo-no" className="font-normal cursor-pointer">No</Label>
                  </div>
                </RadioGroup>
                {formData.sample_taken_granulometry === "yes" && (
                  <p className="text-xs text-blue-600">
                    Se creara un ensayo pendiente en Calidad - Granulometria
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="notes">Notas</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Informacion adicional (opcional)"
                rows={2}
              />
              {(isSandMaterial || requiresGranulometry) && (
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-xs text-muted-foreground">Sugerencias:</span>
                  {["Con barro", "Material sucio", "Muy fino", "Grueso", "Buena calidad", "Humedo"].map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setFormData({ 
                        ...formData, 
                        notes: formData.notes ? `${formData.notes}, ${suggestion}` : suggestion 
                      })}
                      className="text-xs px-2 py-0.5 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={loading} className="bg-green-600 hover:bg-green-700">
                {loading ? "Guardando..." : "Registrar"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {selectedMaterial && (
        <AddSupplierDialog
          open={addSupplierOpen}
          onOpenChange={setAddSupplierOpen}
          materials={materials}
          selectedMaterialId={formData.material_id}
          onSupplierAdded={handleSupplierAdded}
          plantId={selectedMaterial.plant_id}
        />
      )}

      {selectedSupplier && (
        <AddCarrierDialog
          open={addCarrierOpen}
          onOpenChange={setAddCarrierOpen}
          supplierId={formData.supplier_id}
          supplierName={selectedSupplier.name}
          onCarrierAdded={handleCarrierAdded}
        />
      )}
    </>
  )
}
