"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/hooks/use-toast"
import { Loader2, AlertCircle } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"

interface AddGranulometriaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  plants: Array<{ id: string; name: string }>
  onTestAdded: () => void
}

const SIEVES = ['3/8"', "#4", "#8", "#16", "#30", "#50", "#100", "#200", "Pasa #200"]
const SIEVE_OPENINGS = [9.5, 4.75, 2.36, 1.18, 0.6, 0.3, 0.15, 0.075, 0]
const DRAFT_STORAGE_KEY = "granulometria_draft"

interface Material {
  id: string
  name: string
}

interface Supplier {
  id: string
  name: string
}

export function AddGranulometriaDialog({ open, onOpenChange, plants, onTestAdded }: AddGranulometriaDialogProps) {
  const [loading, setLoading] = useState(false)
  const [materials, setMaterials] = useState<Material[]>([])
  const [allSuppliers, setAllSuppliers] = useState<Record<string, Supplier[]>>({})
  const [filteredSuppliers, setFilteredSuppliers] = useState<Supplier[]>([])
  const [moisturePercent, setMoisturePercent] = useState<number | null>(null)
  const [remitoError, setRemitoError] = useState<string>("")

  const [formData, setFormData] = useState({
    extraction_date: new Date().toISOString().split("T")[0],
    material_id: "",
    supplier_id: "",
    sample_weight_grams: "",
    dry_weight_grams: "",
    remito: "",
    plant_id: plants[0]?.id || "",
    comments: "",
  })

  const [sieveData, setSieveData] = useState<Record<string, string>>(
    SIEVES.reduce((acc, sieve) => ({ ...acc, [sieve]: "" }), {}),
  )

  useEffect(() => {
    const loadMaterials = async () => {
      const supabase = createClient()
      // Solo Arena Fina para ensayos granulométricos
      const { data, error } = await supabase
        .from("materials")
        .select("id, name")
        .eq("name", "Arena Fina")
        .order("name")

      if (error) {
        console.error("Error loading materials:", error)
        return
      }

      setMaterials(data || [])
      // Auto-select Arena Fina if it's the only material
      if (data && data.length === 1) {
        setFormData(prev => ({ ...prev, material_id: data[0].id }))
      }
    }

    loadMaterials()
  }, [])

  useEffect(() => {
    const loadSuppliers = async () => {
      const supabase = createClient()
      const suppliersByMaterial: Record<string, Supplier[]> = {}

      for (const material of materials) {
        const { data, error } = await supabase
          .from("stock_entries")
          .select(`
            supplier_id,
            suppliers (id, name)
          `)
          .eq("material_id", material.id)

        if (!error && data) {
          const uniqueSuppliers = Array.from(
            new Map(
              data.filter((entry: any) => entry.suppliers).map((entry: any) => [entry.suppliers.id, entry.suppliers]),
            ).values(),
          )
          suppliersByMaterial[material.id] = uniqueSuppliers
        }
      }

      setAllSuppliers(suppliersByMaterial)
    }

    if (materials.length > 0) {
      loadSuppliers()
    }
  }, [materials])

  useEffect(() => {
    if (formData.material_id) {
      const suppliers = allSuppliers[formData.material_id] || []
      setFilteredSuppliers(suppliers)
      if (suppliers.length === 1) {
        setFormData((prev) => ({ ...prev, supplier_id: suppliers[0].id }))
      } else {
        setFormData((prev) => ({ ...prev, supplier_id: "" }))
      }
    } else {
      setFilteredSuppliers([])
      setFormData((prev) => ({ ...prev, supplier_id: "" }))
    }
  }, [formData.material_id, allSuppliers])

  useEffect(() => {
    if (
      open &&
      (formData.material_id || formData.dry_weight_grams || formData.remito || Object.values(sieveData).some((v) => v))
    ) {
      const draft = {
        formData,
        sieveData,
      }
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
    }
  }, [formData, sieveData, open])

  useEffect(() => {
    const wetWeight = Number.parseFloat(formData.sample_weight_grams)
    const dryWeight = Number.parseFloat(formData.dry_weight_grams)
    if (wetWeight && dryWeight && dryWeight > 0 && wetWeight >= dryWeight) {
      const moisture = ((wetWeight - dryWeight) / dryWeight) * 100
      setMoisturePercent(moisture)
    } else {
      setMoisturePercent(null)
    }
  }, [formData.sample_weight_grams, formData.dry_weight_grams])

  useEffect(() => {
    if (open) {
      const savedDraft = localStorage.getItem(DRAFT_STORAGE_KEY)
      if (savedDraft) {
        try {
          const draft = JSON.parse(savedDraft)
          setFormData(draft.formData)
          setSieveData(draft.sieveData)
          toast({
            title: "Borrador recuperado",
            description: "Se han cargado los datos del último ensayo en progreso",
          })
        } catch (error) {
          console.error("Error loading draft:", error)
        }
      }
    }
  }, [open])

  const handleSieveChange = (sieve: string, value: string) => {
    setSieveData((prev) => ({ ...prev, [sieve]: value }))
  }

  const validateRemito = async (remito: string, materialId: string): Promise<boolean> => {
    if (!remito || !materialId) return true

    const supabase = createClient()
    const { data, error } = await supabase
      .from("stock_entries")
      .select("id, remito")
      .eq("material_id", materialId)
      .eq("remito", remito)
      .limit(1)

    if (error) {
      console.error("Error validating remito:", error)
      return false
    }

    return data && data.length > 0
  }

  const calculateResults = () => {
    const dryWeight = Number.parseFloat(formData.dry_weight_grams)
    if (!dryWeight || dryWeight === 0) return []

    const results: any[] = []
    let cumulativeRetained = 0

    SIEVES.forEach((sieve) => {
      const retainedGrams = Number.parseFloat(sieveData[sieve]) || 0
      cumulativeRetained += retainedGrams

      const percentRetained = (retainedGrams / dryWeight) * 100
      const percentRetainedCumulative = (cumulativeRetained / dryWeight) * 100
      const percentPassing = 100 - percentRetainedCumulative

      results.push({
        sieve_size: sieve,
        retained_grams: retainedGrams,
        retained_cumulative_grams: cumulativeRetained,
        percent_retained: percentRetained,
        percent_retained_cumulative: percentRetainedCumulative,
        percent_passing: percentPassing,
      })
    })

    return results
  }

  const calculateFinenessModulus = (results: any[]) => {
    // MF = sum of cumulative % retained on sieves #4, #8, #16, #30, #50, #100 divided by 100
    const mfSieves = ["#4", "#8", "#16", "#30", "#50", "#100"]
    let sum = 0
    results.forEach((result) => {
      if (mfSieves.includes(result.sieve_size)) {
        sum += result.percent_retained_cumulative
      }
    })
    return sum / 100
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setRemitoError("")

    try {
      console.log("[v0] Form data:", formData)
      console.log("[v0] Sieve data:", sieveData)

      if (!formData.material_id || !formData.supplier_id || !formData.sample_weight_grams || !formData.dry_weight_grams || !formData.remito) {
        console.log("[v0] Missing required fields:", {
          material_id: formData.material_id,
          supplier_id: formData.supplier_id,
          sample_weight_grams: formData.sample_weight_grams,
          dry_weight_grams: formData.dry_weight_grams,
          remito: formData.remito,
        })
        toast({
          title: "Error",
          description: "Todos los campos son obligatorios",
          variant: "destructive",
        })
        setLoading(false)
        return
      }

      const missingSieves = SIEVES.filter((sieve) => !sieveData[sieve] || sieveData[sieve].trim() === "")
      if (missingSieves.length > 0) {
        console.log("[v0] Missing sieve data:", missingSieves)
        toast({
          title: "Error",
          description: `Debe completar los valores de los tamices: ${missingSieves.join(", ")}`,
          variant: "destructive",
        })
        setLoading(false)
        return
      }

      console.log("[v0] Validating remito:", formData.remito)
      const isValidRemito = await validateRemito(formData.remito, formData.material_id)
      console.log("[v0] Remito validation result:", isValidRemito)

      if (!isValidRemito) {
        setRemitoError("No hay un remito asociado a ese agregado")
        toast({
          title: "Error",
          description: "No hay un remito asociado a ese agregado",
          variant: "destructive",
        })
        setLoading(false)
        return
      }

      const supabase = createClient()
      const dryWeight = Number.parseFloat(formData.dry_weight_grams)

      if (!dryWeight) {
        console.log("[v0] Invalid dry weight:", formData.dry_weight_grams)
        toast({
          title: "Error",
          description: "Debe ingresar el peso de muestra seca",
          variant: "destructive",
        })
        setLoading(false)
        return
      }

      const moisture = moisturePercent || 0
      const results = calculateResults()
      const finenessModulus = calculateFinenessModulus(results)

      console.log("[v0] Calculated results:", results)
      console.log("[v0] Fineness modulus:", finenessModulus)

      const selectedMaterial = materials.find((m) => m.id === formData.material_id)
      const selectedSupplier = filteredSuppliers.find((s) => s.id === formData.supplier_id)

      const extractionDate = `${formData.extraction_date}T12:00:00Z`

      const wetWeight = Number.parseFloat(formData.sample_weight_grams)

      console.log("[v0] Inserting test with data:", {
        extraction_date: extractionDate,
        provider: selectedSupplier?.name,
        aggregate_type: selectedMaterial?.name,
        sample_weight_grams: wetWeight,
        dry_weight_grams: dryWeight,
        moisture_percent: moisture,
        fineness_modulus: finenessModulus,
        remito: formData.remito,
        plant_id: formData.plant_id,
      })

      const { data: testData, error: testError } = await supabase
        .from("granulometria_tests")
        .insert({
          extraction_date: extractionDate,
          provider: selectedSupplier?.name || "",
          aggregate_type: selectedMaterial?.name || "",
          sample_weight_grams: wetWeight,
          dry_weight_grams: dryWeight,
          moisture_percent: moisture,
          fineness_modulus: finenessModulus,
          remito: formData.remito,
          plant_id: formData.plant_id,
          comments: formData.comments || null,
        })
        .select()
        .single()

      if (testError) {
        console.error("[v0] Error inserting test:", testError)
        throw testError
      }

      console.log("[v0] Test inserted successfully:", testData)

      const sieveResults = results.map((result) => ({
        test_id: testData.id,
        ...result,
      }))

      console.log("[v0] Inserting sieve results:", sieveResults)

      const { error: sieveError } = await supabase.from("granulometria_sieve_results").insert(sieveResults)

      if (sieveError) {
        console.error("[v0] Error inserting sieve results:", sieveError)
        throw sieveError
      }

      console.log("[v0] Sieve results inserted successfully")

      // Update the stock_entry to link the granulometry test
      const { error: updateError } = await supabase
        .from("stock_entries")
        .update({ granulometry_test_id: testData.id })
        .eq("remito", formData.remito)
        .eq("material_id", formData.material_id)

      if (updateError) {
        console.error("[v0] Error linking test to stock entry:", updateError)
      } else {
        console.log("[v0] Stock entry updated with granulometry_test_id")
      }

      toast({
        title: "Ensayo guardado",
        description: `Módulo de finura: ${finenessModulus.toFixed(2)} MF`,
      })

      onTestAdded()
      onOpenChange(false)
      resetForm()
    } catch (error) {
      console.error("[v0] Error saving test:", error)
      toast({
        title: "Error",
        description: "No se pudo guardar el ensayo",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setFormData({
      extraction_date: new Date().toISOString().split("T")[0],
      material_id: "",
      supplier_id: "",
      sample_weight_grams: "",
      dry_weight_grams: "",
      remito: "",
      plant_id: plants[0]?.id || "",
      comments: "",
    })
    setSieveData(SIEVES.reduce((acc, sieve) => ({ ...acc, [sieve]: "" }), {}))
    setMoisturePercent(null)
    setRemitoError("")
    localStorage.removeItem(DRAFT_STORAGE_KEY)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo Ensayo de Granulometría</DialogTitle>
          <DialogDescription>Ingrese los datos del ensayo y los pesos retenidos en cada tamiz</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="extraction_date">Fecha de Extracción *</Label>
              <Input
                id="extraction_date"
                type="date"
                value={formData.extraction_date}
                onChange={(e) => setFormData({ ...formData, extraction_date: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="plant_id">Planta *</Label>
              <Select
                value={formData.plant_id}
                onValueChange={(value) => setFormData({ ...formData, plant_id: value })}
                required
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {plants.map((plant) => (
                    <SelectItem key={plant.id} value={plant.id}>
                      {plant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="material_id">Tipo de Agregado *</Label>
              <Select
                value={formData.material_id}
                onValueChange={(value) => setFormData({ ...formData, material_id: value })}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccione un agregado" />
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

            <div className="space-y-2">
              <Label htmlFor="supplier_id">Proveedor *</Label>
              <Select
                value={formData.supplier_id}
                onValueChange={(value) => setFormData({ ...formData, supplier_id: value })}
                disabled={!formData.material_id || filteredSuppliers.length === 0}
                required
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      filteredSuppliers.length === 0 ? "Seleccione un agregado primero" : "Seleccione un proveedor"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {filteredSuppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {formData.material_id && filteredSuppliers.length === 0 && (
                <p className="text-sm text-muted-foreground">No hay proveedores disponibles para este agregado</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="sample_weight">Peso Muestra Humeda (g) *</Label>
              <Input
                id="sample_weight"
                type="number"
                step="0.01"
                value={formData.sample_weight_grams}
                onChange={(e) => setFormData({ ...formData, sample_weight_grams: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dry_weight">Peso Muestra Seco (g) *</Label>
              <Input
                id="dry_weight"
                type="number"
                step="0.01"
                value={formData.dry_weight_grams}
                onChange={(e) => setFormData({ ...formData, dry_weight_grams: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Humedad %</Label>
              <div className="h-10 flex items-center px-3 rounded-md border bg-muted text-sm">
                {moisturePercent !== null ? `${moisturePercent.toFixed(2)}%` : "-"}
              </div>
            </div>

            <div className="space-y-2 col-span-2">
              <Label htmlFor="remito">Número de Remito *</Label>
              <Input
                id="remito"
                value={formData.remito}
                onChange={(e) => {
                  setFormData({ ...formData, remito: e.target.value })
                  setRemitoError("")
                }}
                required
                className={remitoError ? "border-destructive" : ""}
              />
              {remitoError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{remitoError}</AlertDescription>
                </Alert>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Análisis Granulométrico - Retenido en cada tamiz (g) *</Label>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-semibold">Tamiz</TableHead>
                    <TableHead className="font-semibold">Retenido (g)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {SIEVES.map((sieve) => (
                    <TableRow key={sieve}>
                      <TableCell className="font-medium">{sieve}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          value={sieveData[sieve]}
                          onChange={(e) => handleSieveChange(sieve, e.target.value)}
                          className="h-9"
                          required
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="comments">Observaciones</Label>
            <Textarea
              id="comments"
              value={formData.comments}
              onChange={(e) => setFormData({ ...formData, comments: e.target.value })}
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Guardar Ensayo
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
