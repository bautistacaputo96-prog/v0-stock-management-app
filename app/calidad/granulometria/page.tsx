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
import { Plus, ArrowLeft, AlertTriangle, CheckCircle2, Settings, Download, Pencil, Trash2, BarChart3 } from "lucide-react"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, ComposedChart } from "recharts"
import Link from "next/link"
import { toast } from "sonner"

// Standard sieve sizes in mm
const SIEVE_SIZES = [
  { size: 25.4, label: "1\"" },
  { size: 19.0, label: "3/4\"" },
  { size: 12.7, label: "1/2\"" },
  { size: 9.5, label: "3/8\"" },
  { size: 4.75, label: "N°4" },
  { size: 2.36, label: "N°8" },
  { size: 1.18, label: "N°16" },
  { size: 0.6, label: "N°30" },
  { size: 0.3, label: "N°50" },
  { size: 0.15, label: "N°100" },
  { size: 0.075, label: "N°200" },
]

const MATERIAL_TYPES = [
  { value: "arena", label: "Arena" },
  { value: "piedra_0_6", label: "Piedra 0/6" },
  { value: "piedra_0_10", label: "Piedra 0/10" },
  { value: "piedra_0_20", label: "Piedra 0/20" },
]

// Default specification bands (can be customized)
const DEFAULT_BANDS: Record<string, { min: number[]; max: number[] }> = {
  arena: {
    min: [100, 100, 100, 100, 95, 80, 50, 25, 10, 2, 0],
    max: [100, 100, 100, 100, 100, 100, 85, 60, 30, 10, 3],
  },
  piedra_0_6: {
    min: [100, 100, 100, 90, 20, 5, 0, 0, 0, 0, 0],
    max: [100, 100, 100, 100, 50, 15, 5, 0, 0, 0, 0],
  },
  piedra_0_10: {
    min: [100, 100, 100, 85, 10, 0, 0, 0, 0, 0, 0],
    max: [100, 100, 100, 100, 30, 5, 0, 0, 0, 0, 0],
  },
  piedra_0_20: {
    min: [100, 90, 20, 0, 0, 0, 0, 0, 0, 0, 0],
    max: [100, 100, 55, 15, 5, 0, 0, 0, 0, 0, 0],
  },
}

interface GranulometryTest {
  id: string
  test_date: string
  material_type: string
  supplier: string | null
  lot_number: string | null
  sample_weight_g: number
  sieve_results: Record<string, number>
  passing_percentages: Record<string, number>
  fineness_modulus: number | null
  observations: string | null
  is_within_spec: boolean
  created_at: string
}

export default function GranulometriaPage() {
  const supabase = createClient()
  const [tests, setTests] = useState<GranulometryTest[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedMaterial, setSelectedMaterial] = useState<string>("all")
  const [showDialog, setShowDialog] = useState(false)
  const [showBandsDialog, setShowBandsDialog] = useState(false)
  const [selectedTest, setSelectedTest] = useState<GranulometryTest | null>(null)
  const [editingTest, setEditingTest] = useState<GranulometryTest | null>(null)

  const [formData, setFormData] = useState({
    test_date: new Date().toISOString().split("T")[0],
    material_type: "arena",
    supplier: "",
    lot_number: "",
    sample_weight_g: 500,
    sieve_results: {} as Record<string, number>,
    observations: "",
  })

  useEffect(() => {
    loadTests()
  }, [])

  async function loadTests() {
    setLoading(true)
    const { data, error } = await supabase
      .from("granulometry_tests")
      .select("*")
      .order("test_date", { ascending: false })
      .limit(50)

    if (!error && data) {
      setTests(data)
    }
    setLoading(false)
  }

  function calculatePassingPercentages(sieveResults: Record<string, number>, sampleWeight: number) {
    const percentages: Record<string, number> = {}
    let cumulativeRetained = 0

    for (const sieve of SIEVE_SIZES) {
      const retained = sieveResults[sieve.label] || 0
      cumulativeRetained += retained
      const passing = ((sampleWeight - cumulativeRetained) / sampleWeight) * 100
      percentages[sieve.label] = Math.max(0, Math.min(100, passing))
    }

    return percentages
  }

  function calculateFinenessModulus(passingPercentages: Record<string, number>) {
    // FM = sum of cumulative retained percentages at standard sieves / 100
    const standardSieves = ["3/8\"", "N°4", "N°8", "N°16", "N°30", "N°50", "N°100"]
    let sumRetained = 0

    for (const sieve of standardSieves) {
      const passing = passingPercentages[sieve] || 100
      sumRetained += (100 - passing)
    }

    return sumRetained / 100
  }

  function checkWithinSpec(passingPercentages: Record<string, number>, materialType: string) {
    const bands = DEFAULT_BANDS[materialType]
    if (!bands) return true

    for (let i = 0; i < SIEVE_SIZES.length; i++) {
      const sieve = SIEVE_SIZES[i]
      const passing = passingPercentages[sieve.label] || 0
      if (passing < bands.min[i] || passing > bands.max[i]) {
        return false
      }
    }
    return true
  }

  async function handleSubmit() {
    const passingPercentages = calculatePassingPercentages(formData.sieve_results, formData.sample_weight_g)
    const finenessModulus = formData.material_type === "arena" ? calculateFinenessModulus(passingPercentages) : null
    const isWithinSpec = checkWithinSpec(passingPercentages, formData.material_type)

    const dataToSave = {
      test_date: formData.test_date,
      material_type: formData.material_type,
      supplier: formData.supplier || null,
      lot_number: formData.lot_number || null,
      sample_weight_g: formData.sample_weight_g,
      sieve_results: formData.sieve_results,
      passing_percentages: passingPercentages,
      fineness_modulus: finenessModulus,
      observations: formData.observations || null,
      is_within_spec: isWithinSpec,
    }

    let error
    if (editingTest) {
      const result = await supabase.from("granulometry_tests").update(dataToSave).eq("id", editingTest.id)
      error = result.error
    } else {
      const result = await supabase.from("granulometry_tests").insert(dataToSave)
      error = result.error
    }

    if (error) {
      toast.error("Error al guardar ensayo")
      return
    }

    toast.success(editingTest ? "Ensayo actualizado" : "Ensayo de granulometría guardado")
    setShowDialog(false)
    setEditingTest(null)
    resetForm()
    loadTests()
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Está seguro de eliminar este ensayo?")) return
    
    const { error } = await supabase.from("granulometry_tests").delete().eq("id", id)
    if (error) {
      toast.error("Error al eliminar ensayo")
      return
    }
    toast.success("Ensayo eliminado")
    loadTests()
  }

  function openEditGranu(test: GranulometryTest) {
    setEditingTest(test)
    setFormData({
      test_date: test.test_date,
      material_type: test.material_type,
      supplier: test.supplier || "",
      lot_number: test.lot_number || "",
      sample_weight_g: test.sample_weight_g,
      sieve_results: test.sieve_results || {},
      observations: test.observations || "",
    })
    setShowDialog(true)
  }

  function resetForm() {
    setFormData({
      test_date: new Date().toISOString().split("T")[0],
      material_type: "arena",
      supplier: "",
      lot_number: "",
      sample_weight_g: 500,
      sieve_results: {},
      observations: "",
    })
    setEditingTest(null)
  }

  function getChartData(test: GranulometryTest) {
    const bands = DEFAULT_BANDS[test.material_type] || { min: [], max: [] }
    return SIEVE_SIZES.map((sieve, i) => ({
      sieve: sieve.label,
      size: sieve.size,
      passing: test.passing_percentages[sieve.label] || 0,
      min: bands.min[i] || 0,
      max: bands.max[i] || 100,
    }))
  }

  const filteredTests = selectedMaterial === "all" 
    ? tests 
    : tests.filter(t => t.material_type === selectedMaterial)

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/calidad" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold">Granulometría</h1>
            <p className="text-sm text-muted-foreground">Control granulométrico de áridos</p>
          </div>
        </div>
        <div className="flex gap-2">
              <Link href="/calidad/granulometria/mezclas">
                <Button variant="outline" className="gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Análisis de Mezclas
                </Button>
              </Link>
              <Button variant="outline" onClick={() => setShowBandsDialog(true)} className="gap-2">
                <Settings className="h-4 w-4" />
                Bandas
              </Button>
              <Dialog open={showDialog} onOpenChange={(open) => { setShowDialog(open); if (!open) resetForm(); }}>
                <DialogTrigger asChild>
                  <Button className="gap-2">
                    <Plus className="h-4 w-4" />
                    Nuevo Ensayo
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Nuevo Ensayo de Granulometría</DialogTitle>
                    <DialogDescription>Registre los resultados del tamizado</DialogDescription>
                  </DialogHeader>

                  <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="space-y-2">
                        <Label>Fecha</Label>
                        <Input
                          type="date"
                          value={formData.test_date}
                          onChange={(e) => setFormData({ ...formData, test_date: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Material</Label>
                        <Select value={formData.material_type} onValueChange={(v) => setFormData({ ...formData, material_type: v })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MATERIAL_TYPES.map(m => (
                              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Proveedor</Label>
                        <Input
                          placeholder="Nombre del proveedor"
                          value={formData.supplier}
                          onChange={(e) => setFormData({ ...formData, supplier: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Peso muestra (g)</Label>
                        <Input
                          type="number"
                          value={formData.sample_weight_g || ""}
                          onChange={(e) => setFormData({ ...formData, sample_weight_g: Number(e.target.value) })}
                        />
                      </div>
                    </div>

                    <div className="border rounded-lg p-4">
                      <h4 className="font-medium mb-3">Resultados del Tamizado (g retenidos)</h4>
                      <div className="grid grid-cols-4 md:grid-cols-6 gap-3">
                        {SIEVE_SIZES.map((sieve) => (
                          <div key={sieve.label} className="space-y-1">
                            <Label className="text-xs">{sieve.label}</Label>
                            <Input
                              type="number"
                              step="0.1"
                              className="h-8 text-sm"
                              placeholder="0"
                              value={formData.sieve_results[sieve.label] || ""}
                              onChange={(e) => setFormData({
                                ...formData,
                                sieve_results: {
                                  ...formData.sieve_results,
                                  [sieve.label]: Number(e.target.value)
                                }
                              })}
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Live preview of curve */}
                    {Object.keys(formData.sieve_results).length > 0 && (
                      <div className="border rounded-lg p-4">
                        <h4 className="font-medium mb-3">Vista Previa de Curva</h4>
                        <div className="h-48">
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={(() => {
                              const passingPercentages = calculatePassingPercentages(formData.sieve_results, formData.sample_weight_g)
                              const bands = DEFAULT_BANDS[formData.material_type] || { min: [], max: [] }
                              return SIEVE_SIZES.map((sieve, i) => ({
                                sieve: sieve.label,
                                passing: passingPercentages[sieve.label] || 0,
                                min: bands.min[i] || 0,
                                max: bands.max[i] || 100,
                              }))
                            })()}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="sieve" tick={{ fontSize: 10 }} />
                              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                              <Tooltip />
                              <Area type="monotone" dataKey="max" fill="#dcfce7" stroke="none" />
                              <Area type="monotone" dataKey="min" fill="#ffffff" stroke="none" />
                              <Line type="monotone" dataKey="min" stroke="#22c55e" strokeDasharray="5 5" dot={false} />
                              <Line type="monotone" dataKey="max" stroke="#22c55e" strokeDasharray="5 5" dot={false} />
                              <Line type="monotone" dataKey="passing" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}
                  </div>

                  <DialogFooter>
                    <Button variant="outline" onClick={() => { setShowDialog(false); resetForm(); }}>
                      Cancelar
                    </Button>
                    <Button onClick={handleSubmit}>
                      Guardar Ensayo
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* Filter */}
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-4">
              <Label>Filtrar por material:</Label>
              <Select value={selectedMaterial} onValueChange={setSelectedMaterial}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {MATERIAL_TYPES.map(m => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground ml-auto">
                {filteredTests.length} ensayo(s)
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Tests Table */}
        <Card>
          <CardHeader>
            <CardTitle>Ensayos Realizados</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">Cargando...</div>
            ) : filteredTests.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No hay ensayos registrados</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead>Proveedor</TableHead>
                    <TableHead className="text-right">Peso (g)</TableHead>
                    <TableHead className="text-right">MF</TableHead>
                    <TableHead className="text-center">Estado</TableHead>
                    <TableHead className="text-center">Curva</TableHead>
                    <TableHead className="text-center">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTests.map((test) => (
                    <TableRow key={test.id}>
                      <TableCell>{new Date(test.test_date).toLocaleDateString("es-AR")}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {MATERIAL_TYPES.find(m => m.value === test.material_type)?.label || test.material_type}
                        </Badge>
                      </TableCell>
                      <TableCell>{test.supplier || "-"}</TableCell>
                      <TableCell className="text-right">{test.sample_weight_g}</TableCell>
                      <TableCell className="text-right font-medium">
                        {test.fineness_modulus?.toFixed(2) || "-"}
                      </TableCell>
                      <TableCell className="text-center">
                        {test.is_within_spec ? (
                          <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            OK
                          </Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Fuera
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button variant="ghost" size="sm" onClick={() => setSelectedTest(test)}>
                          Ver
                        </Button>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditGranu(test)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(test.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Selected Test Curve */}
        {selectedTest && (
          <Card>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle>Curva Granulométrica</CardTitle>
                  <CardDescription>
                    {MATERIAL_TYPES.find(m => m.value === selectedTest.material_type)?.label} - {new Date(selectedTest.test_date).toLocaleDateString("es-AR")}
                    {selectedTest.supplier && ` - ${selectedTest.supplier}`}
                  </CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedTest(null)}>
                  Cerrar
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={getChartData(selectedTest)} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="sieve" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} label={{ value: '% Pasa', angle: -90, position: 'insideLeft' }} />
                    <Tooltip 
                      formatter={(value: number, name: string) => [
                        `${value.toFixed(1)}%`,
                        name === "passing" ? "Muestra" : name === "min" ? "Mín. Banda" : "Máx. Banda"
                      ]}
                    />
                    <Legend />
                    <Area type="monotone" dataKey="max" fill="#dcfce7" stroke="none" name="Banda Superior" />
                    <Area type="monotone" dataKey="min" fill="#ffffff" stroke="none" name="Banda Inferior" />
                    <Line type="monotone" dataKey="min" stroke="#22c55e" strokeDasharray="5 5" dot={false} name="Límite Inf." />
                    <Line type="monotone" dataKey="max" stroke="#22c55e" strokeDasharray="5 5" dot={false} name="Límite Sup." />
                    <Line type="monotone" dataKey="passing" stroke="#2563eb" strokeWidth={2} dot={{ r: 4, fill: "#2563eb" }} name="Muestra" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Passing percentages table */}
              <div className="mt-4 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tamiz</TableHead>
                      {SIEVE_SIZES.map(s => (
                        <TableHead key={s.label} className="text-center text-xs">{s.label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-medium">% Pasa</TableCell>
                      {SIEVE_SIZES.map(s => {
                        const passing = selectedTest.passing_percentages[s.label] || 0
                        const bands = DEFAULT_BANDS[selectedTest.material_type]
                        const idx = SIEVE_SIZES.findIndex(x => x.label === s.label)
                        const isOutside = bands && (passing < bands.min[idx] || passing > bands.max[idx])
                        return (
                          <TableCell 
                            key={s.label} 
                            className={`text-center text-xs ${isOutside ? 'bg-red-100 text-red-700 font-bold' : ''}`}
                          >
                            {passing.toFixed(1)}
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Bands Configuration Dialog */}
      <Dialog open={showBandsDialog} onOpenChange={setShowBandsDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Configuración de Bandas</DialogTitle>
            <DialogDescription>Define los límites de aceptación para cada material</DialogDescription>
          </DialogHeader>
          <div className="py-4 text-sm text-muted-foreground">
            <p>Las bandas de especificación definen los límites mínimos y máximos de porcentaje que pasa para cada tamiz.</p>
            <p className="mt-2">Actualmente se usan valores por defecto. La edición personalizada estará disponible próximamente.</p>
            
            <div className="mt-4 space-y-4">
              {MATERIAL_TYPES.map(mat => (
                <div key={mat.value} className="border rounded-lg p-3">
                  <h4 className="font-medium mb-2">{mat.label}</h4>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Tamiz</TableHead>
                          {SIEVE_SIZES.slice(0, 7).map(s => (
                            <TableHead key={s.label} className="text-center text-xs">{s.label}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow>
                          <TableCell className="text-xs">Mín %</TableCell>
                          {DEFAULT_BANDS[mat.value]?.min.slice(0, 7).map((v, i) => (
                            <TableCell key={i} className="text-center text-xs">{v}</TableCell>
                          ))}
                        </TableRow>
                        <TableRow>
                          <TableCell className="text-xs">Máx %</TableCell>
                          {DEFAULT_BANDS[mat.value]?.max.slice(0, 7).map((v, i) => (
                            <TableCell key={i} className="text-center text-xs">{v}</TableCell>
                          ))}
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
