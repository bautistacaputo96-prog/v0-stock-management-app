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
import { Badge } from "@/components/ui/badge"
import { Plus, ArrowLeft, AlertTriangle, CheckCircle2, Droplets, TrendingUp, TrendingDown, Pencil, Trash2 } from "lucide-react"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts"
import Link from "next/link"
import { toast } from "sonner"
import { usePlant } from "@/lib/plant-context"

const ALL_MATERIAL_TYPES = [
  { value: "arena", label: "Arena", targetMin: 3, targetMax: 6, color: "#f59e0b", plants: ["mercedes", "silke", "ranchos"] },
  { value: "piedra_0_6", label: "Piedra 0/6", targetMin: 0, targetMax: 2, color: "#78716c", plants: ["ranchos"] },
  { value: "piedra_0_10", label: "Piedra 0/10", targetMin: 0, targetMax: 2, color: "#6b7280", plants: ["mercedes", "silke"] },
  { value: "piedra_0_20", label: "Piedra 0/20", targetMin: 0, targetMax: 2, color: "#374151", plants: ["mercedes", "silke"] },
]

interface HumidityTest {
  id: string
  test_date: string
  material_type: string
  wet_weight_g: number
  dry_weight_g: number
  humidity_percentage: number
  supplier: string | null
  lot_number: string | null
  observations: string | null
  is_within_spec: boolean
  created_at: string
}

export default function HumedadPage() {
  const supabase = createClient()
  const { selectedPlant } = usePlant()
  const MATERIAL_TYPES = ALL_MATERIAL_TYPES.filter(m => m.plants.includes(selectedPlant || "mercedes"))
  const [tests, setTests] = useState<HumidityTest[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedMaterial, setSelectedMaterial] = useState<string>("all")
  const [showDialog, setShowDialog] = useState(false)
  const [editingTest, setEditingTest] = useState<HumidityTest | null>(null)
  const [dateRange, setDateRange] = useState({ start: "", end: "" })

  const [formData, setFormData] = useState({
    test_date: new Date().toISOString().split("T")[0],
    material_type: "arena",
    wet_weight_g: 0,
    dry_weight_g: 0,
    supplier: "",
    lot_number: "",
    observations: "",
  })

  useEffect(() => {
    // Set default date range to last 30 days
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - 30)
    setDateRange({
      start: start.toISOString().split("T")[0],
      end: end.toISOString().split("T")[0],
    })
  }, [])

  useEffect(() => {
    if (dateRange.start && dateRange.end) {
      loadTests()
    }
  }, [dateRange, selectedPlant])

  async function loadTests() {
    setLoading(true)
    const { data, error } = await supabase
      .from("humidity_tests")
      .select("*")
      .eq("plant", selectedPlant || "mercedes")
      .gte("test_date", dateRange.start)
      .lte("test_date", dateRange.end)
      .order("test_date", { ascending: false })

    if (!error && data) {
      setTests(data)
    }
    setLoading(false)
  }

  function calculateHumidity(wet: number, dry: number) {
    if (dry === 0) return 0
    return ((wet - dry) / dry) * 100
  }

  function checkWithinSpec(humidity: number, materialType: string) {
    const material = MATERIAL_TYPES.find(m => m.value === materialType)
    if (!material) return true
    return humidity >= material.targetMin && humidity <= material.targetMax
  }

  async function handleSubmit() {
    const humidity = calculateHumidity(formData.wet_weight_g, formData.dry_weight_g)
    const isWithinSpec = checkWithinSpec(humidity, formData.material_type)

    const dataToSave = {
      test_date: formData.test_date,
      material_type: formData.material_type,
      wet_weight_g: formData.wet_weight_g,
      dry_weight_g: formData.dry_weight_g,
      humidity_percentage: humidity,
      supplier: formData.supplier || null,
      lot_number: formData.lot_number || null,
      observations: formData.observations || null,
      is_within_spec: isWithinSpec,
      plant: selectedPlant || "mercedes",
    }

    let error
    if (editingTest) {
      const result = await supabase.from("humidity_tests").update(dataToSave).eq("id", editingTest.id)
      error = result.error
    } else {
      const result = await supabase.from("humidity_tests").insert(dataToSave)
      error = result.error
    }

    if (error) {
      toast.error("Error al guardar ensayo")
      return
    }

    toast.success(editingTest ? "Ensayo actualizado" : "Ensayo de humedad guardado")
    setShowDialog(false)
    setEditingTest(null)
    resetForm()
    loadTests()
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Está seguro de eliminar este ensayo?")) return
    
    const { error } = await supabase.from("humidity_tests").delete().eq("id", id)
    if (error) {
      toast.error("Error al eliminar ensayo")
      return
    }
    toast.success("Ensayo eliminado")
    loadTests()
  }

  function openEdit(test: HumidityTest) {
    setEditingTest(test)
    setFormData({
      test_date: test.test_date,
      material_type: test.material_type,
      wet_weight_g: test.wet_weight_g,
      dry_weight_g: test.dry_weight_g,
      supplier: test.supplier || "",
      lot_number: test.lot_number || "",
      observations: test.observations || "",
    })
    setShowDialog(true)
  }

  function resetForm() {
    setFormData({
      test_date: new Date().toISOString().split("T")[0],
      material_type: "arena",
      wet_weight_g: 0,
      dry_weight_g: 0,
      supplier: "",
      lot_number: "",
      observations: "",
    })
    setEditingTest(null)
  }

  const filteredTests = selectedMaterial === "all"
    ? tests
    : tests.filter(t => t.material_type === selectedMaterial)

  // Calculate statistics
  function getStats(materialType: string) {
    const materialTests = tests.filter(t => t.material_type === materialType)
    if (materialTests.length === 0) return null

    const values = materialTests.map(t => t.humidity_percentage)
    const avg = values.reduce((a, b) => a + b, 0) / values.length
    const min = Math.min(...values)
    const max = Math.max(...values)
    const outOfSpec = materialTests.filter(t => !t.is_within_spec).length

    return { avg, min, max, count: materialTests.length, outOfSpec }
  }

  // Chart data
  function getChartData(materialType: string) {
    return tests
      .filter(t => t.material_type === materialType)
      .sort((a, b) => a.test_date.localeCompare(b.test_date))
      .map(t => ({
        date: new Date(t.test_date).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }),
        humidity: t.humidity_percentage,
        isOutside: !t.is_within_spec,
      }))
  }

  const currentHumidity = formData.wet_weight_g > 0 && formData.dry_weight_g > 0
    ? calculateHumidity(formData.wet_weight_g, formData.dry_weight_g)
    : null

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/calidad" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold">Control de Humedad</h1>
            <p className="text-sm text-muted-foreground">Seguimiento de humedad en áridos</p>
          </div>
        </div>
        <Dialog open={showDialog} onOpenChange={(open) => { setShowDialog(open); if (!open) resetForm(); }}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Plus className="h-4 w-4" />
                  Nuevo Ensayo
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Nuevo Ensayo de Humedad</DialogTitle>
                  <DialogDescription>Registre los pesos húmedo y seco de la muestra</DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
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
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Peso Húmedo (g)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={formData.wet_weight_g || ""}
                        onChange={(e) => setFormData({ ...formData, wet_weight_g: Number(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Peso Seco (g)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={formData.dry_weight_g || ""}
                        onChange={(e) => setFormData({ ...formData, dry_weight_g: Number(e.target.value) })}
                      />
                    </div>
                  </div>

                  {currentHumidity !== null && (
                    <div className={`p-4 rounded-lg ${checkWithinSpec(currentHumidity, formData.material_type) ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-medium">Humedad calculada:</span>
                        <span className={`text-2xl font-bold ${checkWithinSpec(currentHumidity, formData.material_type) ? 'text-green-600' : 'text-red-600'}`}>
                          {currentHumidity.toFixed(2)}%
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Rango aceptable: {MATERIAL_TYPES.find(m => m.value === formData.material_type)?.targetMin}% - {MATERIAL_TYPES.find(m => m.value === formData.material_type)?.targetMax}%
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Proveedor</Label>
                      <Input
                        placeholder="Opcional"
                        value={formData.supplier}
                        onChange={(e) => setFormData({ ...formData, supplier: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Lote</Label>
                      <Input
                        placeholder="Opcional"
                        value={formData.lot_number}
                        onChange={(e) => setFormData({ ...formData, lot_number: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => { setShowDialog(false); resetForm(); }}>
                    Cancelar
                  </Button>
                  <Button onClick={handleSubmit} disabled={formData.dry_weight_g === 0}>
                    Guardar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
      </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {MATERIAL_TYPES.map(mat => {
            const stats = getStats(mat.value)
            return (
              <Card key={mat.value}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Droplets className="h-4 w-4" style={{ color: mat.color }} />
                    {mat.label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {stats ? (
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Promedio:</span>
                        <span className="text-xl font-bold">{stats.avg.toFixed(2)}%</span>
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Mín: {stats.min.toFixed(1)}%</span>
                        <span>Máx: {stats.max.toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span>{stats.count} ensayos</span>
                        {stats.outOfSpec > 0 && (
                          <span className="text-red-600 font-medium">{stats.outOfSpec} fuera de rango</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Rango: {mat.targetMin}% - {mat.targetMax}%
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">Sin datos</div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>

        {/* Date Range and Filter */}
        <Card>
          <CardContent className="py-3">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Label className="text-sm">Desde:</Label>
                <Input
                  type="date"
                  value={dateRange.start}
                  onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                  className="w-36"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-sm">Hasta:</Label>
                <Input
                  type="date"
                  value={dateRange.end}
                  onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                  className="w-36"
                />
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <Label>Material:</Label>
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
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Chart */}
        {selectedMaterial !== "all" && (
          <Card>
            <CardHeader>
              <CardTitle>Tendencia de Humedad - {MATERIAL_TYPES.find(m => m.value === selectedMaterial)?.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={getChartData(selectedMaterial)} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} domain={[0, 'auto']} />
                    <Tooltip formatter={(value: number) => [`${value.toFixed(2)}%`, "Humedad"]} />
                    <ReferenceLine 
                      y={MATERIAL_TYPES.find(m => m.value === selectedMaterial)?.targetMin || 0} 
                      stroke="#22c55e" 
                      strokeDasharray="5 5" 
                      label={{ value: "Mín", fontSize: 10 }}
                    />
                    <ReferenceLine 
                      y={MATERIAL_TYPES.find(m => m.value === selectedMaterial)?.targetMax || 0} 
                      stroke="#22c55e" 
                      strokeDasharray="5 5"
                      label={{ value: "Máx", fontSize: 10 }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="humidity" 
                      stroke={MATERIAL_TYPES.find(m => m.value === selectedMaterial)?.color || "#2563eb"} 
                      strokeWidth={2} 
                      dot={{ r: 4 }} 
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tests Table */}
        <Card>
          <CardHeader>
            <CardTitle>Ensayos Realizados</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">Cargando...</div>
            ) : filteredTests.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No hay ensayos en el período seleccionado</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead className="text-right">P. Húmedo (g)</TableHead>
                    <TableHead className="text-right">P. Seco (g)</TableHead>
                    <TableHead className="text-right">Humedad %</TableHead>
                    <TableHead>Proveedor</TableHead>
                    <TableHead className="text-center">Estado</TableHead>
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
                      <TableCell className="text-right">{test.wet_weight_g.toFixed(1)}</TableCell>
                      <TableCell className="text-right">{test.dry_weight_g.toFixed(1)}</TableCell>
                      <TableCell className="text-right font-bold">{test.humidity_percentage.toFixed(2)}%</TableCell>
                      <TableCell>{test.supplier || "-"}</TableCell>
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
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(test)}>
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
    </div>
  )
}
