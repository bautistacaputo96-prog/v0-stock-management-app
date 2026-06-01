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

interface EditGranulometriaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  testId: string
  plants: Array<{ id: string; name: string }>
  onTestUpdated: () => void
}

const SIEVES = ['3/8"', "#4", "#8", "#16", "#30", "#50", "#100", "#200", "Pasa #200"]
const WET_SAMPLE_WEIGHT = 500

interface Material {
  id: string
  name: string
}

interface Supplier {
  id: string
  name: string
}

export function EditGranulometriaDialog({
  open,
  onOpenChange,
  testId,
  plants,
  onTestUpdated,
}: EditGranulometriaDialogProps) {
  const [loading, setLoading] = useState(false)
  const [loadingData, setLoadingData] = useState(true)
  const [materials, setMaterials] = useState<Material[]>([])
  const [allSuppliers, setAllSuppliers] = useState<Record<string, Supplier[]>>({})
  const [filteredSuppliers, setFilteredSuppliers] = useState<Supplier[]>([])
  const [moisturePercent, setMoisturePercent] = useState<number | null>(null)
  const [remitoError, setRemitoError] = useState<string>("")

  const [formData, setFormData] = useState({
    extraction_date: "",
    material_id: "",
    supplier_id: "",
    dry_weight_grams: "",
    remito: "",
    plant_id: "",
    comments: "",
  })

  const [sieveData, setSieveData] = useState<Record<string, string>>(
    SIEVES.reduce((acc, sieve) => ({ ...acc, [sieve]: "" }), {}),
  )

  // Load materials
  useEffect(() => {
    const loadMaterials = async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("materials")
        .select("id, name")
        .in("name", [
          "Arena Fina",
          "Arena Trituración 0/6",
          "Piedra Partida 6/12",
          "Piedra Partida 6/20",
          "Piedra Partida 10/30",
        ])
        .order("name")

      if (!error && data) {
        setMaterials(data)
      }
    }

    loadMaterials()
  }, [])

  // Load suppliers for each material
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

  // Load test data
  useEffect(() => {
    const loadTestData = async () => {
      if (!open || !testId) return

      setLoadingData(true)
      const supabase = createClient()

      // Load test data
      const { data: testData, error: testError } = await supabase
        .from("granulometria_tests")
        .select("*")
        .eq("id", testId)
        .single()

      if (testError) {
        console.error("Error loading test:", testError)
        toast({
          title: "Error",
          description: "No se pudo cargar el ensayo",
          variant: "destructive",
        })
        setLoadingData(false)
        return
      }

      // Load sieve results
      const { data: sieveResults, error: sieveError } = await supabase
        .from("granulometria_sieve_results")
        .select("*")
        .eq("test_id", testId)
        .order("id")

      if (sieveError) {
        console.error("Error loading sieve results:", sieveError)
      }

      // Find material and supplier IDs from the test data
      const material = materials.find((m) => m.name === testData.aggregate_type)
      const materialId = testData.material_id || material?.id || ""

      // Get supplier from test data or find by name
      let supplierId = testData.supplier_id || ""
      if (!supplierId && materialId && allSuppliers[materialId]) {
        const supplier = allSuppliers[materialId].find((s) => s.name === testData.provider)
        supplierId = supplier?.id || ""
      }

      const extractionDate = testData.extraction_date 
        ? new Date(testData.extraction_date).toISOString().split("T")[0]
        : new Date().toISOString().split("T")[0]

      setFormData({
        extraction_date: extractionDate,
        material_id: materialId,
        supplier_id: supplierId,
        dry_weight_grams: testData.dry_weight_grams?.toString() || "",
        remito: testData.remito || "",
        plant_id: testData.plant_id || "",
        comments: testData.comments || "",
      })

      // Set sieve data (empty for pending tests)
      const newSieveData: Record<string, string> = {}
      SIEVES.forEach(sieve => {
        const result = sieveResults?.find((r: any) => r.sieve_size === sieve)
        newSieveData[sieve] = result?.retained_grams?.toString() || ""
      })
      setSieveData(newSieveData)

      setLoadingData(false)
    }

    if (materials.length > 0) {
      loadTestData()
    }
  }, [open, testId, materials, allSuppliers])

  // Update filtered suppliers when material changes
  useEffect(() => {
    if (formData.material_id) {
      setFilteredSuppliers(allSuppliers[formData.material_id] || [])
    } else {
      setFilteredSuppliers([])
    }
  }, [formData.material_id, allSuppliers])

  // Calculate moisture percentage
  useEffect(() => {
    const dryWeight = Number.parseFloat(formData.dry_weight_grams)
    if (dryWeight && dryWeight > 0 && dryWeight < WET_SAMPLE_WEIGHT) {
      const moisture = ((WET_SAMPLE_WEIGHT - dryWeight) / dryWeight) * 100
      setMoisturePercent(moisture)
    } else {
      setMoisturePercent(null)
    }
  }, [formData.dry_weight_grams])

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
      if (!formData.material_id || !formData.supplier_id || !formData.dry_weight_grams || !formData.remito) {
        toast({
          title: "Error",
          description: "Todos los campos son obligatorios",
          variant: "destructive",
        })
        setLoading(false)
        return
      }

      const isValidRemito = await validateRemito(formData.remito, formData.material_id)
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

      const selectedMaterial = materials.find((m) => m.id === formData.material_id)
      const selectedSupplier = filteredSuppliers.find((s) => s.id === formData.supplier_id)

      const extractionDate = `${formData.extraction_date}T12:00:00Z`

      const { error: testError } = await supabase
        .from("granulometria_tests")
        .update({
          extraction_date: extractionDate,
          provider: selectedSupplier?.name || "",
          aggregate_type: selectedMaterial?.name || "",
          sample_weight_grams: WET_SAMPLE_WEIGHT,
          dry_weight_grams: dryWeight,
          moisture_percent: moisture,
          fineness_modulus: finenessModulus,
          remito: formData.remito,
          plant_id: formData.plant_id,
          comments: formData.comments || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", testId)

      if (testError) throw testError

      await supabase.from("granulometria_sieve_results").delete().eq("test_id", testId)

      const sieveResults = results.map((result) => ({
        test_id: testId,
        ...result,
      }))

      const { error: sieveError } = await supabase.from("granulometria_sieve_results").insert(sieveResults)

      if (sieveError) throw sieveError

      toast({
        title: "Ensayo actualizado",
        description: `Módulo de finura: ${finenessModulus.toFixed(2)} MF`,
      })

      onTestUpdated()
      onOpenChange(false)
    } catch (error) {
      console.error("Error updating test:", error)
      toast({
        title: "Error",
        description: "No se pudo actualizar el ensayo",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  if (loadingData) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {!formData.dry_weight_grams ? "Completar Ensayo de Granulometria" : "Editar Ensayo de Granulometria"}
          </DialogTitle>
          <DialogDescription>
            {!formData.dry_weight_grams 
              ? "Complete los datos del ensayo pendiente ingresando el peso de muestra seca y los pesos retenidos en cada tamiz"
              : "Modifique los datos del ensayo y los pesos retenidos en cada tamiz"
            }
          </DialogDescription>
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
                disabled={!formData.material_id}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccione un proveedor" />
                </SelectTrigger>
                <SelectContent>
                  {filteredSuppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sample_weight">Peso Muestra Humeda (g)</Label>
              <Input id="sample_weight" type="number" value={WET_SAMPLE_WEIGHT} disabled className="bg-muted" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dry_weight">Peso Muestra Seca (g) *</Label>
              <Input
                id="dry_weight"
                type="number"
                step="0.01"
                value={formData.dry_weight_grams}
                onChange={(e) => setFormData({ ...formData, dry_weight_grams: e.target.value })}
                placeholder="Ej: 475"
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
              Actualizar Ensayo
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
