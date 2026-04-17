"use client"

import { useState, useEffect } from "react"
import { usePlant } from "@/lib/plant-context"
import { createClient } from "@/lib/supabase"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ArrowLeft,
  FlaskConical,
  Droplets,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from "lucide-react"
import { toast } from "sonner"

interface PendingTest {
  id: number
  mp_receipt_id: number
  test_type: "humedad" | "granulometria"
  material_type: string
  plant: string
  remito_number: string
  supplier_id: number
  supplier_name: string | null
  sample_date: string
  status: "pending" | "completed"
  completed_at: string | null
  completed_by: string | null
  test_result_id: number | null
  observations: string | null
}

const MATERIAL_LABELS: Record<string, string> = {
  arena_especial: "Arena Especial",
  piedra_0_10: "Piedra 0/10",
  piedra_0_6: "Piedra 0/6",
  piedra_0_20: "Piedra 0/20",
}

const SIEVES = [
  { key: "sieve_9500", label: '3/8"', mm: 9.5 },
  { key: "sieve_4750", label: "#4", mm: 4.75 },
  { key: "sieve_2360", label: "#8", mm: 2.36 },
  { key: "sieve_1180", label: "#16", mm: 1.18 },
  { key: "sieve_600", label: "#30", mm: 0.6 },
  { key: "sieve_300", label: "#50", mm: 0.3 },
  { key: "sieve_150", label: "#100", mm: 0.15 },
  { key: "sieve_pan", label: "Fondo", mm: 0 },
]

function calculateFinenessModulus(sieves: Record<string, number>, totalWeight: number): number {
  if (totalWeight <= 0) return 0
  const retainedKeys = ["sieve_9500", "sieve_4750", "sieve_2360", "sieve_1180", "sieve_600", "sieve_300", "sieve_150"]
  const retainedPcts = retainedKeys.map((k) => ((sieves[k] || 0) / totalWeight) * 100)
  const cumulative: number[] = []
  let sum = 0
  for (const pct of retainedPcts) {
    sum += pct
    cumulative.push(sum)
  }
  return Math.round((cumulative.reduce((a, b) => a + b, 0) / 100) * 100) / 100
}

export default function PendingTestsPage() {
  const { selectedPlant } = usePlant()
  const [pendingTests, setPendingTests] = useState<PendingTest[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTest, setSelectedTest] = useState<PendingTest | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Humidity form
  const [wetWeightG, setWetWeightG] = useState("500")
  const [dryWeightG, setDryWeightG] = useState("")
  const [humidityObservations, setHumidityObservations] = useState("")

  // Granulometry form
  const [totalSampleWeight, setTotalSampleWeight] = useState("500")
  const [sieveResults, setSieveResults] = useState<Record<string, number>>({})
  const [granuObservations, setGranuObservations] = useState("")

  const supabase = createClient()

  useEffect(() => {
    loadPendingTests()
  }, [selectedPlant])

  async function loadPendingTests() {
    setLoading(true)
    try {
      let query = supabase
        .from("quality_pending_tests")
        .select("*")
        .eq("status", "pending")
        .order("sample_date", { ascending: false })

      if (selectedPlant && selectedPlant !== "all") {
        query = query.eq("plant", selectedPlant)
      }

      const { data, error } = await query
      if (error) throw error
      setPendingTests(data || [])
    } catch (error) {
      console.error("Error loading pending tests:", error)
      toast.error("Error al cargar ensayos pendientes")
    } finally {
      setLoading(false)
    }
  }

  // Calculate humidity
  const wetWeight = parseFloat(wetWeightG) || 0
  const dryWeight = parseFloat(dryWeightG) || 0
  const humidity = dryWeight > 0 ? ((wetWeight - dryWeight) / dryWeight) * 100 : 0

  // Calculate fineness modulus
  const totalWeight = parseFloat(totalSampleWeight) || 0
  const finenessModulus = calculateFinenessModulus(sieveResults, totalWeight)

  async function submitHumidityTest() {
    if (!selectedTest || !dryWeight) return
    setSubmitting(true)

    try {
      // Insert humidity test
      const { data: humidityTest, error: humError } = await supabase
        .from("humidity_tests")
        .insert({
          mp_receipt_id: selectedTest.mp_receipt_id,
          test_date: new Date().toISOString().split("T")[0],
          material_type: selectedTest.material_type,
          plant: selectedTest.plant,
          remito_number: selectedTest.remito_number,
          origin: selectedTest.supplier_name,
          wet_weight_g: wetWeight,
          dry_weight_g: dryWeight,
          humidity_percentage: humidity,
          observations: humidityObservations || null,
        })
        .select()
        .single()

      if (humError) throw humError

      // Update pending test as completed
      const { error: updateError } = await supabase
        .from("quality_pending_tests")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          test_result_id: humidityTest.id,
        })
        .eq("id", selectedTest.id)

      if (updateError) throw updateError

      toast.success("Ensayo de humedad registrado")
      setSelectedTest(null)
      resetForms()
      loadPendingTests()
    } catch (error) {
      console.error("Error submitting humidity test:", error)
      toast.error("Error al guardar el ensayo")
    } finally {
      setSubmitting(false)
    }
  }

  async function submitGranulometryTest() {
    if (!selectedTest || !totalWeight) return
    setSubmitting(true)

    try {
      // Insert granulometry test
      const { data: granuTest, error: granuError } = await supabase
        .from("granulometry_tests")
        .insert({
          mp_receipt_id: selectedTest.mp_receipt_id,
          test_date: new Date().toISOString().split("T")[0],
          material_type: selectedTest.material_type,
          plant: selectedTest.plant,
          remito_number: selectedTest.remito_number,
          origin: selectedTest.supplier_name,
          total_sample_weight_g: totalWeight,
          ...sieveResults,
          fineness_modulus: finenessModulus,
          observations: granuObservations || null,
        })
        .select()
        .single()

      if (granuError) throw granuError

      // Update pending test as completed
      const { error: updateError } = await supabase
        .from("quality_pending_tests")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          test_result_id: granuTest.id,
        })
        .eq("id", selectedTest.id)

      if (updateError) throw updateError

      toast.success("Ensayo de granulometría registrado")
      setSelectedTest(null)
      resetForms()
      loadPendingTests()
    } catch (error) {
      console.error("Error submitting granulometry test:", error)
      toast.error("Error al guardar el ensayo")
    } finally {
      setSubmitting(false)
    }
  }

  function resetForms() {
    setWetWeightG("500")
    setDryWeightG("")
    setHumidityObservations("")
    setTotalSampleWeight("500")
    setSieveResults({})
    setGranuObservations("")
  }

  const pendingHumidity = pendingTests.filter(t => t.test_type === "humedad").length
  const pendingGranulometry = pendingTests.filter(t => t.test_type === "granulometria").length

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <Link href="/calidad" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold">Ensayos Pendientes</h1>
          <p className="text-sm text-muted-foreground">
            Muestras de laboratorio pendientes de análisis
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
                <Clock className="h-6 w-6 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Pendientes</p>
                <p className="text-2xl font-bold">{pendingTests.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                <Droplets className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Humedad</p>
                <p className="text-2xl font-bold">{pendingHumidity}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                <FlaskConical className="h-6 w-6 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Granulometría</p>
                <p className="text-2xl font-bold">{pendingGranulometry}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ensayos Pendientes</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : pendingTests.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mx-auto mb-2 text-green-500" />
              <p>No hay ensayos pendientes</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha Muestra</TableHead>
                  <TableHead>Remito</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Tipo Ensayo</TableHead>
                  <TableHead>Planta</TableHead>
                  <TableHead className="text-center">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingTests.map((test) => (
                  <TableRow key={test.id}>
                    <TableCell>
                      {new Date(test.sample_date).toLocaleDateString("es-AR")}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {test.remito_number}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {MATERIAL_LABELS[test.material_type] || test.material_type}
                      </Badge>
                    </TableCell>
                    <TableCell>{test.supplier_name || "-"}</TableCell>
                    <TableCell>
                      <Badge 
                        variant="secondary"
                        className={test.test_type === "humedad" 
                          ? "bg-blue-100 text-blue-700" 
                          : "bg-purple-100 text-purple-700"
                        }
                      >
                        {test.test_type === "humedad" ? (
                          <><Droplets className="h-3 w-3 mr-1" />Humedad</>
                        ) : (
                          <><FlaskConical className="h-3 w-3 mr-1" />Granulometría</>
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell className="capitalize">{test.plant}</TableCell>
                    <TableCell className="text-center">
                      <Button 
                        size="sm" 
                        onClick={() => setSelectedTest(test)}
                      >
                        Cargar Resultado
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Humidity Test Dialog */}
      <Dialog 
        open={selectedTest?.test_type === "humedad"} 
        onOpenChange={(open) => { if (!open) { setSelectedTest(null); resetForms(); } }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar Ensayo de Humedad</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Remito:</span>
                <p className="font-medium">{selectedTest?.remito_number}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Material:</span>
                <p className="font-medium">
                  {MATERIAL_LABELS[selectedTest?.material_type || ""] || selectedTest?.material_type}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Proveedor:</span>
                <p className="font-medium">{selectedTest?.supplier_name || "-"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Fecha Muestra:</span>
                <p className="font-medium">
                  {selectedTest?.sample_date && new Date(selectedTest.sample_date).toLocaleDateString("es-AR")}
                </p>
              </div>
            </div>

            <div className="border-t pt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Peso Húmedo (g)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={wetWeightG}
                    onChange={(e) => setWetWeightG(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Peso Seco (g)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={dryWeightG}
                    onChange={(e) => setDryWeightG(e.target.value)}
                    placeholder="Ingresar..."
                  />
                </div>
              </div>

              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Humedad Calculada</p>
                <p className="text-2xl font-bold">
                  {humidity.toFixed(2)}%
                </p>
              </div>

              <div className="space-y-2">
                <Label>Observaciones</Label>
                <Input
                  value={humidityObservations}
                  onChange={(e) => setHumidityObservations(e.target.value)}
                  placeholder="Opcional..."
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => { setSelectedTest(null); resetForms(); }}>
                Cancelar
              </Button>
              <Button onClick={submitHumidityTest} disabled={!dryWeight || submitting}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Guardar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Granulometry Test Dialog */}
      <Dialog 
        open={selectedTest?.test_type === "granulometria"} 
        onOpenChange={(open) => { if (!open) { setSelectedTest(null); resetForms(); } }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Registrar Ensayo de Granulometría</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Remito:</span>
                <p className="font-medium">{selectedTest?.remito_number}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Material:</span>
                <p className="font-medium">
                  {MATERIAL_LABELS[selectedTest?.material_type || ""] || selectedTest?.material_type}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Proveedor:</span>
                <p className="font-medium">{selectedTest?.supplier_name || "-"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Fecha:</span>
                <p className="font-medium">
                  {selectedTest?.sample_date && new Date(selectedTest.sample_date).toLocaleDateString("es-AR")}
                </p>
              </div>
            </div>

            <div className="border-t pt-4 space-y-4">
              <div className="space-y-2">
                <Label>Peso Total Muestra (g)</Label>
                <Input
                  type="number"
                  value={totalSampleWeight}
                  onChange={(e) => setTotalSampleWeight(e.target.value)}
                  className="w-32"
                />
              </div>

              <div className="grid grid-cols-4 gap-3">
                {SIEVES.map((sieve) => (
                  <div key={sieve.key} className="space-y-1">
                    <Label className="text-xs">{sieve.label} ({sieve.mm}mm)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      placeholder="0"
                      value={sieveResults[sieve.key] || ""}
                      onChange={(e) => setSieveResults(prev => ({
                        ...prev,
                        [sieve.key]: parseFloat(e.target.value) || 0
                      }))}
                      className="text-sm"
                    />
                  </div>
                ))}
              </div>

              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Módulo de Finura</p>
                <p className="text-2xl font-bold">{finenessModulus.toFixed(2)}</p>
              </div>

              <div className="space-y-2">
                <Label>Observaciones</Label>
                <Input
                  value={granuObservations}
                  onChange={(e) => setGranuObservations(e.target.value)}
                  placeholder="Opcional..."
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => { setSelectedTest(null); resetForms(); }}>
                Cancelar
              </Button>
              <Button onClick={submitGranulometryTest} disabled={!totalWeight || submitting}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Guardar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
