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
import { currentUserName } from "@/lib/current-user"
import { logActivity } from "@/lib/activity-log"
import { useToast } from "@/hooks/use-toast"
import { AddSupplierDialog } from "./add-supplier-dialog"
import { AddCarrierDialog } from "./add-carrier-dialog"
import { Card, CardContent } from "@/components/ui/card"
import { claveMaterial, enToneladas } from "@/lib/control-ingresos/cruce"
import { TIPOS_IMPORTABLES } from "@/lib/ingresos-zomatik/plan"
import { crearMuestraGranulometria, grabarExcedente, insertarIngresoManual, moverStockSeco } from "@/lib/ingresos/muestras"
import { usePermisos } from "@/lib/current-user"

const HUMIDITY_TOLERANCE = 3.0 // 3% tolerance
const WET_SAMPLE_WEIGHT = 500 // Fixed wet sample weight in grams
/** Un árido o el cemento con menos de esto en kg seguramente se cargó en toneladas (32,76 en vez de 32760). */
const KG_SOSPECHOSO = 200

/** ¿El material viene en camiones de toneladas? (áridos y cemento) */
const vaEnToneladas = (m: { name: string; tipo?: string | null } | undefined) =>
  !!m && (["arido_fino", "arido_grueso", "cemento"].includes(m.tipo || "") || enToneladas(claveMaterial(m.name)))

/** ¿Entra solo desde Zomatik? (áridos, cemento, aditivos y fibra: docs/ingresos-mp-zomatik.md, 3.7) */
const entraDeZomatik = (m: { name: string; tipo?: string | null } | undefined) => !!m && (TIPOS_IMPORTABLES.includes(m.tipo || "") || claveMaterial(m.name) !== null)

type Material = {
  id: string
  name: string
  unit: string
  plant_id: string
  tipo?: string | null
}

type Supplier = {
  id: string
  name: string
}

type Carrier = {
  id: string
  name: string
}

export function AddStockEntryDialog({
  materials: todosLosMateriales,
  onSuccess,
  importacionActiva = false,
}: {
  materials: Material[]
  onSuccess?: () => void
  /** Ya entra solo desde Zomatik (modo real y hoy ≥ F): la MP la carga a mano solo un gerencial, con nota. */
  importacionActiva?: boolean
}) {
  const { esGerencial } = usePermisos()
  // Sin ser gerencial, con la importación prendida, no se ven los materiales que entran desde Zomatik
  const materials = importacionActiva && !esGerencial ? todosLosMateriales.filter((m) => !entraDeZomatik(m)) : todosLosMateriales
  const [open, setOpen] = useState(false)
  const [addSupplierOpen, setAddSupplierOpen] = useState(false)
  const [addCarrierOpen, setAddCarrierOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [filteredSuppliers, setFilteredSuppliers] = useState<Supplier[]>([])
  const [filteredCarriers, setFilteredCarriers] = useState<Carrier[]>([])
  const [showHumidityCalc, setShowHumidityCalc] = useState(false)
  const [drySampleWeight, setDrySampleWeight] = useState("")
  /** La persona confirmó que la cantidad chica está bien en kg (se vuelve a preguntar si cambia la cantidad). */
  const [kgConfirmados, setKgConfirmados] = useState(false)
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
    // Humedad (obligatoria y reclamo por exceso) solo en la Arena Fina: a la 0/6 no se le mide
    const isSandMaterial = selectedMaterial?.name.trim().toLowerCase() === "arena fina"
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

    const cantidad = Number.parseFloat(formData.quantity)
    if (vaEnToneladas(selectedMaterial) && cantidad > 0 && cantidad < KG_SOSPECHOSO && !kgConfirmados) {
      toast({
        variant: "destructive",
        title: "Revisá la cantidad",
        description: `¿Son toneladas? ${cantidad.toLocaleString("es-AR")} t = ${(cantidad * 1000).toLocaleString("es-AR")} kg. Tocá "Pasar a kg" o confirmá que son kg.`,
      })
      return
    }

    if (importacionActiva && entraDeZomatik(selectedMaterial) && !formData.notes.trim()) {
      toast({ variant: "destructive", title: "Falta la nota", description: "Este material entra solo desde Zomatik: escribí por qué lo cargás a mano." })
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
      // origen = 'manual' (sin la migración, como siempre)
      const { data: entryData, error: entryError } = await insertarIngresoManual(supabase as any, {
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
          created_by: currentUserName(),
          entry_date: `${formData.entry_date}T12:00:00`,
        })

      if (entryError) throw entryError

      // El stock (current_stock) lo suma la base sola al insertar el ingreso
      // (trigger update_stock_after_entry). Acá NO se vuelve a sumar: hacerlo
      // duplicaba cada camión (pasó entre el 03/08 y el 09/09/2026).
      // Lo único que la base no lleva es el stock seco de los materiales con humedad.
      // Stock seco, excedente y muestra: la misma lógica que las acciones del historial (lib/ingresos/muestras.ts)
      const ingreso = { id: entryData.id, material_id: formData.material_id, quantity: originalQuantity, dry_quantity: dryQuantity, remito: formData.remito.trim(), entry_date: formData.entry_date, supplier_id: formData.supplier_id, plant_id: selectedMaterial?.plant_id }
      // Como siempre, si esto falla el ingreso ya quedó registrado (no se corta)
      if (requiresGranulometry) await moverStockSeco(supabase as any, formData.material_id, dryQuantity).catch((e) => console.error("dry_stock:", e))

      // If humidity exceeds tolerance, log the excess
      if (isSandMaterial && formData.humidity_percentage) {
        const humidity = Number.parseFloat(formData.humidity_percentage)
        if (humidity > HUMIDITY_TOLERANCE) await grabarExcedente(supabase as any, ingreso, humidity, formData.supplier_id, selectedMaterial?.plant_id).catch((e) => console.error("excedente:", e))
      }

      // If granulometry sample was taken, create pending test
      if (requiresGranulometry && formData.sample_taken_granulometry === "yes") {
        await crearMuestraGranulometria(supabase as any, ingreso, {
          materialName: selectedMaterial?.name || "",
          providerName: filteredSuppliers.find((s) => s.id === formData.supplier_id)?.name || "",
          supplierId: formData.supplier_id,
          plantId: selectedMaterial?.plant_id,
          fecha: formData.entry_date,
        }).catch(() => null)
      }

      const displayQuantity = `${originalQuantity.toLocaleString("es-AR")} ${selectedMaterial?.unit}`

      await logActivity({
        action: "crear",
        entity: "ingreso",
        entityId: entryData?.id,
        reference: formData.remito.trim() || null,
        details: {
          Material: selectedMaterial?.name || "-",
          Cantidad: displayQuantity,
          Remito: formData.remito.trim() || "-",
        },
      })

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
      setKgConfirmados(false)
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
  // Humedad (obligatoria y reclamo por exceso) solo en la Arena Fina: a la 0/6 no se le mide
  const isSandMaterial = selectedMaterial?.name.trim().toLowerCase() === "arena fina"
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
                onChange={(e) => {
                  setFormData({ ...formData, quantity: e.target.value })
                  setKgConfirmados(false)
                }}
                placeholder="0"
                required
              />
              {(() => {
                const c = Number.parseFloat(formData.quantity)
                if (!vaEnToneladas(selectedMaterial) || !(c > 0 && c < KG_SOSPECHOSO) || kgConfirmados) return null
                return (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span>
                      ¿Son toneladas? {c.toLocaleString("es-AR", { maximumFractionDigits: 2 })} t = {(c * 1000).toLocaleString("es-AR")} kg
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => {
                        setFormData({ ...formData, quantity: String(Math.round(c * 1000 * 100) / 100) })
                        setKgConfirmados(false)
                      }}
                    >
                      Pasar a kg
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setKgConfirmados(true)}>
                      No, son kg
                    </Button>
                  </div>
                )
              })()}
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

            {importacionActiva && entraDeZomatik(selectedMaterial) && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Este material entra solo desde Zomatik. Cargalo acá solo si no va a estar en Zomatik (la nota es obligatoria).</span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="notes">Notas{importacionActiva && entraDeZomatik(selectedMaterial) ? <span className="text-red-500"> *</span> : null}</Label>
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
