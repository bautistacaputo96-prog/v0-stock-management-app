"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { 
  FlaskConical, 
  Plus, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  Settings,
  TestTube2,
  FileText,
  Calendar,
  Loader2,
  ArrowLeft,
  Pencil,
  Trash2
} from "lucide-react"
import Link from "next/link"
import { usePlant } from "@/lib/plant-context"
import { getSupabase } from "@/lib/supabase"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine
} from "recharts"

interface PendingTest {
  id: string
  test_type: string
  material_type: string
  supplier_name: string
  receipt_date: string
  receipt_number: string
  status: string
  created_at: string
}

interface FlexionSample {
  id: string
  sample_code: string
  adoquin_type: string
  sample_date: string
  production_date: string
  observations: string | null
  specimens: FlexionSpecimen[]
}

interface FlexionSpecimen {
  id: string
  sample_id: string
  specimen_number: number
  test_age_days: number
  test_date: string | null
  dial_reading: number | null
  calibration_id: string | null
  load_kn: number | null
  area_mm2: number | null
  resistance_mpa: number | null
  complies_min: boolean | null
  weight_sss_g: number | null
  height_mm: number | null
  tested_by: string | null
  observations: string | null
  sample?: FlexionSample
}

interface Calibration {
  id: string
  calibration_date: string
  coef_a: number
  coef_b: number
  coef_c: number
  coef_d: number
  calibrated_by: string
  certificate_number: string
}

interface QualityParameters {
  flexion_min_individual_mpa: number
  flexion_min_group_mpa: number
}

const ADOQUIN_TYPES = [
  { code: "AH6", name: "Adoquin H6", height: 60 },
  { code: "AH6-R", name: "Adoquin H6 Rojo", height: 60 },
  { code: "AH6-A", name: "Adoquin H6 Amarillo", height: 60 },
  { code: "AH6-N", name: "Adoquin H6 Negro", height: 60 },
  { code: "AH8", name: "Adoquin H8", height: 80 },
  { code: "AH8-R", name: "Adoquin H8 Rojo", height: 80 },
  { code: "AH8-A", name: "Adoquin H8 Amarillo", height: 80 },
  { code: "AH8-N", name: "Adoquin H8 Negro", height: 80 },
]

export default function CalidadAdoquinesPage() {
  const { selectedPlant } = usePlant()
  const [activeTab, setActiveTab] = useState("pending")
  const [loading, setLoading] = useState(true)
  
  // Data states
  const [pendingTests, setPendingTests] = useState<PendingTest[]>([])
  const [flexionSamples, setFlexionSamples] = useState<FlexionSample[]>([])
  const [pendingSpecimens, setPendingSpecimens] = useState<FlexionSpecimen[]>([])
  const [calibration, setCalibration] = useState<Calibration | null>(null)
  const [parameters, setParameters] = useState<QualityParameters>({
    flexion_min_individual_mpa: 3.8,
    flexion_min_group_mpa: 4.2
  })
  const [flexionResults, setFlexionResults] = useState<FlexionSpecimen[]>([])

  // Dialog states
  const [showNewSampleDialog, setShowNewSampleDialog] = useState(false)
  const [showCalibrationDialog, setShowCalibrationDialog] = useState(false)
  const [showTestDialog, setShowTestDialog] = useState(false)
  const [selectedSpecimen, setSelectedSpecimen] = useState<FlexionSpecimen | null>(null)
  const [saving, setSaving] = useState(false)

  // Form states
  const [sampleForm, setSampleForm] = useState({
    sample_code: "",
    adoquin_type: "",
    sample_date: new Date().toISOString().split("T")[0],
    production_date: new Date().toISOString().split("T")[0],
    notes: ""
  })

  const [calibrationForm, setCalibrationForm] = useState({
    calibration_date: new Date().toISOString().split("T")[0],
    coef_a: "",
    coef_b: "",
    coef_c: "",
    coef_d: "",
    calibrated_by: "",
    certificate_number: ""
  })

  const [testForm, setTestForm] = useState({
    dial_reading: "",
    weight_sss_g: "",
    height_mm: "",
    width_mm: "100",
    tested_by: "",
    notes: ""
  })

  // Fetch data
  const fetchData = async () => {
    if (selectedPlant !== "ranchos") return
    setLoading(true)
    
    try {
      const [pendingRes, samplesRes, pendingSpecRes, calibRes, paramsRes, resultsRes] = await Promise.all([
        fetch("/api/calidad/ranchos?type=pending"),
        fetch("/api/calidad/ranchos?type=flexion-samples"),
        fetch("/api/calidad/ranchos?type=flexion-pending"),
        fetch("/api/calidad/ranchos?type=calibration"),
        fetch("/api/calidad/ranchos?type=parameters"),
        fetch("/api/calidad/ranchos?type=flexion-results")
      ])

      if (pendingRes.ok) setPendingTests(await pendingRes.json())
      if (samplesRes.ok) setFlexionSamples(await samplesRes.json())
      if (pendingSpecRes.ok) setPendingSpecimens(await pendingSpecRes.json())
      if (calibRes.ok) {
        const calib = await calibRes.json()
        if (calib) setCalibration(calib)
      }
      if (paramsRes.ok) {
        const params = await paramsRes.json()
        if (params.flexion_min_individual_mpa) {
          setParameters(params)
        }
      }
      if (resultsRes.ok) setFlexionResults(await resultsRes.json())
    } catch (error) {
      console.error("Error fetching quality data:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [selectedPlant])

  // Generate sample code
  const generateSampleCode = () => {
    const date = new Date()
    const year = date.getFullYear().toString().slice(-2)
    const month = (date.getMonth() + 1).toString().padStart(2, "0")
    const day = date.getDate().toString().padStart(2, "0")
    const random = Math.floor(Math.random() * 100).toString().padStart(2, "0")
    return `F${year}${month}${day}-${random}`
  }

  // Save new flexion sample
  const saveSample = async () => {
    if (!sampleForm.sample_code || !sampleForm.adoquin_type) return
    setSaving(true)

    try {
      // Get current formula from paver production or mix designs
      const supabase = getSupabase()
      const { data: formula } = await supabase
        .from("paver_mix_designs")
        .select("*")
        .eq("adoquin_type", sampleForm.adoquin_type)
        .eq("plant", "ranchos")
        .single()

      const res = await fetch("/api/calidad/ranchos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "flexion-sample",
          ...sampleForm,
          formula_snapshot: formula || null
        })
      })

      if (res.ok) {
        setShowNewSampleDialog(false)
        setSampleForm({
          sample_code: "",
          adoquin_type: "",
          sample_date: new Date().toISOString().split("T")[0],
          production_date: new Date().toISOString().split("T")[0],
          notes: ""
        })
        fetchData()
      }
    } catch (error) {
      console.error("Error saving sample:", error)
    } finally {
      setSaving(false)
    }
  }

  // Delete sample
  const deleteSample = async (sampleId: string) => {
    if (!confirm("¿Está seguro de eliminar esta muestra? Se eliminarán también todos los especímenes asociados.")) return
    
    try {
      const supabase = getSupabase()
      // First delete specimens
      await supabase.from("quality_flexion_specimens").delete().eq("sample_id", sampleId)
      // Then delete sample
      const { error } = await supabase.from("quality_flexion_samples").delete().eq("id", sampleId)
      
      if (error) throw error
      fetchData()
    } catch (error) {
      console.error("Error deleting sample:", error)
      alert("Error al eliminar la muestra")
    }
  }

  // Save calibration
  const saveCalibration = async () => {
    if (!calibrationForm.coef_a || !calibrationForm.coef_b || !calibrationForm.coef_c || !calibrationForm.coef_d) return
    setSaving(true)

    try {
      const res = await fetch("/api/calidad/ranchos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "calibration",
          calibration_date: calibrationForm.calibration_date,
          coef_a: parseFloat(calibrationForm.coef_a),
          coef_b: parseFloat(calibrationForm.coef_b),
          coef_c: parseFloat(calibrationForm.coef_c),
          coef_d: parseFloat(calibrationForm.coef_d),
          calibrated_by: calibrationForm.calibrated_by,
          certificate_number: calibrationForm.certificate_number
        })
      })

      if (res.ok) {
        setShowCalibrationDialog(false)
        fetchData()
      }
    } catch (error) {
      console.error("Error saving calibration:", error)
    } finally {
      setSaving(false)
    }
  }

  // Save test result
  const saveTestResult = async () => {
    if (!selectedSpecimen || !testForm.dial_reading) return
    setSaving(true)

    try {
      const adoquinType = selectedSpecimen.sample?.adoquin_type || ""
      const defaultHeight = adoquinType.includes("8") ? 80 : 60

      const res = await fetch("/api/calidad/ranchos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "flexion-result",
          specimen_id: selectedSpecimen.id,
          dial_reading: parseFloat(testForm.dial_reading),
          weight_sss_g: testForm.weight_sss_g ? parseFloat(testForm.weight_sss_g) : null,
          height_mm: testForm.height_mm ? parseFloat(testForm.height_mm) : defaultHeight,
          width_mm: parseFloat(testForm.width_mm) || 100,
          tested_by: testForm.tested_by,
          notes: testForm.notes,
          adoquin_type: adoquinType
        })
      })

      if (res.ok) {
        setShowTestDialog(false)
        setSelectedSpecimen(null)
        setTestForm({
          dial_reading: "",
          weight_sss_g: "",
          height_mm: "",
          width_mm: "100",
          tested_by: "",
          notes: ""
        })
        fetchData()
      }
    } catch (error) {
      console.error("Error saving test result:", error)
    } finally {
      setSaving(false)
    }
  }

  // Open test dialog
  const openTestDialog = (specimen: FlexionSpecimen) => {
    const adoquinType = specimen.sample?.adoquin_type || ""
    const defaultHeight = adoquinType.includes("8") ? "80" : "60"
    setSelectedSpecimen(specimen)
    setTestForm({
      dial_reading: "",
      weight_sss_g: "",
      height_mm: defaultHeight,
      width_mm: "100",
      tested_by: "",
      notes: ""
    })
    setShowTestDialog(true)
  }

  // Chart data
  const chartData = flexionResults
    .filter(r => r.resistance_mpa !== null)
    .map(r => ({
      date: r.test_date ? new Date(r.test_date).toLocaleDateString("es-AR") : "",
      mpa: r.resistance_mpa,
      age: r.test_age_days,
      code: r.sample?.sample_code || ""
    }))
    .reverse()

  if (selectedPlant !== "ranchos") {
    return (
      <div className="min-h-screen bg-background p-6">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Este modulo solo esta disponible para la planta de Ranchos.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link href="/calidad">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Volver
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                <FlaskConical className="h-6 w-6 text-orange-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Control de Calidad - Adoquines</h1>
                <p className="text-muted-foreground text-sm">Ensayos de flexion segun norma IRAM</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
                  <Clock className="h-5 w-5 text-yellow-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{pendingSpecimens.length}</p>
                  <p className="text-xs text-muted-foreground">Ensayos pendientes</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                  <TestTube2 className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{flexionSamples.length}</p>
                  <p className="text-xs text-muted-foreground">Muestras totales</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {flexionResults.filter(r => (r.resistance_mpa || 0) >= parameters.flexion_min_individual_mpa).length}
                  </p>
                  <p className="text-xs text-muted-foreground">Ensayos aprobados</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                  <Settings className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {calibration ? "OK" : "!"}
                  </p>
                  <p className="text-xs text-muted-foreground">Calibracion prensa</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Calibration Alert */}
        {!calibration && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between">
              <span>No hay calibracion de prensa activa. Configure los coeficientes antes de realizar ensayos.</span>
              <Button size="sm" variant="outline" onClick={() => setShowCalibrationDialog(true)}>
                Configurar
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="pending" className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Pendientes
              {pendingSpecimens.length > 0 && (
                <Badge variant="destructive" className="ml-1">{pendingSpecimens.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="samples">
              <TestTube2 className="w-4 h-4 mr-2" />
              Muestras
            </TabsTrigger>
            <TabsTrigger value="results">
              <FileText className="w-4 h-4 mr-2" />
              Resultados
            </TabsTrigger>
            <TabsTrigger value="config">
              <Settings className="w-4 h-4 mr-2" />
              Configuracion
            </TabsTrigger>
          </TabsList>

          {/* Pending Tests Tab */}
          <TabsContent value="pending" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Ensayos de Flexion Pendientes</CardTitle>
                <CardDescription>
                  Especimenes que alcanzaron su edad de ensayo (7 o 28 dias)
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : pendingSpecimens.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No hay ensayos pendientes
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Codigo Muestra</TableHead>
                        <TableHead>Tipo Adoquin</TableHead>
                        <TableHead>Especimen #</TableHead>
                        <TableHead>Edad</TableHead>
                        <TableHead>Fecha Programada</TableHead>
                        <TableHead>Dias Vencido</TableHead>
                        <TableHead className="text-right">Accion</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingSpecimens.map((specimen) => {
                        // Calculate scheduled date from sample_date + test_age_days
                        const sampleDate = specimen.sample?.sample_date ? new Date(specimen.sample.sample_date) : null
                        const scheduledDate = sampleDate ? new Date(sampleDate.getTime() + specimen.test_age_days * 24 * 60 * 60 * 1000) : null
                        const today = new Date()
                        const daysOverdue = scheduledDate ? Math.floor((today.getTime() - scheduledDate.getTime()) / (1000 * 60 * 60 * 24)) : 0
                        
                        return (
                          <TableRow key={specimen.id}>
                            <TableCell className="font-mono font-medium">
                              {specimen.sample?.sample_code}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {specimen.sample?.adoquin_type}
                              </Badge>
                            </TableCell>
                            <TableCell>#{specimen.specimen_number}</TableCell>
                            <TableCell>
                              <Badge variant={specimen.test_age_days === 7 ? "secondary" : "default"}>
                                {specimen.test_age_days} dias
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {scheduledDate ? scheduledDate.toLocaleDateString("es-AR") : "-"}
                            </TableCell>
                            <TableCell>
                              {daysOverdue > 0 ? (
                                <span className="text-red-600 font-medium">+{daysOverdue}</span>
                              ) : daysOverdue === 0 ? (
                                <span className="text-green-600">Hoy</span>
                              ) : (
                                <span className="text-muted-foreground">{daysOverdue}</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button 
                                size="sm" 
                                onClick={() => openTestDialog(specimen)}
                                disabled={!calibration}
                              >
                                Realizar Ensayo
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Samples Tab */}
          <TabsContent value="samples" className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold">Muestras de Flexion</h2>
              <Dialog open={showNewSampleDialog} onOpenChange={setShowNewSampleDialog}>
                <DialogTrigger asChild>
                  <Button onClick={() => setSampleForm(prev => ({ ...prev, sample_code: generateSampleCode() }))}>
                    <Plus className="w-4 h-4 mr-2" />
                    Nueva Muestra
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Registrar Nueva Muestra de Flexion</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Codigo de Muestra</Label>
                        <Input
                          value={sampleForm.sample_code}
                          onChange={(e) => setSampleForm(prev => ({ ...prev, sample_code: e.target.value }))}
                          placeholder="F240115-01"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Tipo de Adoquin</Label>
                        <Select
                          value={sampleForm.adoquin_type}
                          onValueChange={(v) => setSampleForm(prev => ({ ...prev, adoquin_type: v }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar" />
                          </SelectTrigger>
                          <SelectContent>
                            {ADOQUIN_TYPES.map(t => (
                              <SelectItem key={t.code} value={t.code}>{t.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Fecha de Extraccion</Label>
                        <Input
                          type="date"
                      value={sampleForm.sample_date}
                      onChange={(e) => setSampleForm(prev => ({ ...prev, sample_date: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Fecha de Produccion</Label>
                        <Input
                          type="date"
                          value={sampleForm.production_date}
                          onChange={(e) => setSampleForm(prev => ({ ...prev, production_date: e.target.value }))}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Notas (opcional)</Label>
                      <Textarea
                        value={sampleForm.notes}
                        onChange={(e) => setSampleForm(prev => ({ ...prev, notes: e.target.value }))}
                        placeholder="Observaciones adicionales..."
                        rows={2}
                      />
                    </div>

                    <Alert>
                      <Calendar className="h-4 w-4" />
                      <AlertDescription>
                        Se crearan 3 especimenes: 1 para ensayo a 7 dias y 2 para ensayo a 28 dias.
                      </AlertDescription>
                    </Alert>

                    <Button onClick={saveSample} className="w-full" disabled={saving || !sampleForm.sample_code || !sampleForm.adoquin_type}>
                      {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                      Registrar Muestra
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Codigo</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Fecha Extraccion</TableHead>
                      <TableHead>Especimen 1 (7d)</TableHead>
                      <TableHead>Especimen 2 (28d)</TableHead>
                      <TableHead>Especimen 3 (28d)</TableHead>
                      <TableHead>Promedio 28d</TableHead>
                      <TableHead className="text-center">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8">
                          <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                        </TableCell>
                      </TableRow>
                    ) : flexionSamples.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                          No hay muestras registradas
                        </TableCell>
                      </TableRow>
                    ) : (
                      flexionSamples.map((sample) => {
                        const spec7 = sample.specimens?.find(s => s.test_age_days === 7)
                        const specs28 = sample.specimens?.filter(s => s.test_age_days === 28) || []
                        const avg28 = specs28.filter(s => s.resistance_mpa).length > 0
                          ? specs28.reduce((sum, s) => sum + (s.resistance_mpa || 0), 0) / specs28.filter(s => s.resistance_mpa).length
                          : null

                        const renderResult = (spec: FlexionSpecimen | undefined) => {
                          if (!spec) return <span className="text-muted-foreground">-</span>
                          if (!spec.resistance_mpa) {
                            return <Badge variant="outline">Pendiente</Badge>
                          }
                          const passed = spec.resistance_mpa >= parameters.flexion_min_individual_mpa
                          return (
                            <span className={passed ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                              {spec.resistance_mpa.toFixed(2)} MPa
                            </span>
                          )
                        }

                        return (
                          <TableRow key={sample.id}>
                            <TableCell className="font-mono font-medium">{sample.sample_code}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{sample.adoquin_type}</Badge>
                            </TableCell>
                            <TableCell>
                              {new Date(sample.sample_date).toLocaleDateString("es-AR")}
                            </TableCell>
                            <TableCell>{renderResult(spec7)}</TableCell>
                            <TableCell>{renderResult(specs28[0])}</TableCell>
                            <TableCell>{renderResult(specs28[1])}</TableCell>
                            <TableCell>
                              {avg28 !== null ? (
                                <span className={avg28 >= parameters.flexion_min_group_mpa ? "text-green-600 font-bold" : "text-red-600 font-bold"}>
                                  {avg28.toFixed(2)} MPa
                                </span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-7 w-7 text-destructive hover:text-destructive" 
                                onClick={() => deleteSample(sample.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Results Tab */}
          <TabsContent value="results" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Resultados de Flexion</CardTitle>
                <CardDescription>
                  Grafico de resistencia a flexion. Linea roja: minimo individual ({parameters.flexion_min_individual_mpa} MPa). 
                  Linea verde: minimo grupal ({parameters.flexion_min_group_mpa} MPa).
                </CardDescription>
              </CardHeader>
              <CardContent>
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={400}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis domain={[0, 'auto']} />
                      <Tooltip 
                        formatter={(value: number) => [`${value.toFixed(2)} MPa`, "Resistencia"]}
                        labelFormatter={(label) => `Fecha: ${label}`}
                      />
                      <Legend />
                      <ReferenceLine 
                        y={parameters.flexion_min_individual_mpa} 
                        stroke="#ef4444" 
                        strokeDasharray="5 5"
                        label={{ value: `Min. Individual: ${parameters.flexion_min_individual_mpa} MPa`, position: "right", fill: "#ef4444" }}
                      />
                      <ReferenceLine 
                        y={parameters.flexion_min_group_mpa} 
                        stroke="#22c55e" 
                        strokeDasharray="5 5"
                        label={{ value: `Min. Grupal: ${parameters.flexion_min_group_mpa} MPa`, position: "right", fill: "#22c55e" }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="mpa" 
                        stroke="#3b82f6" 
                        strokeWidth={2}
                        dot={{ fill: "#3b82f6", strokeWidth: 2, r: 4 }}
                        name="Resistencia (MPa)"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    No hay resultados para mostrar
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Results Table */}
            <Card>
              <CardHeader>
                <CardTitle>Ultimos Resultados</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha Ensayo</TableHead>
                      <TableHead>Codigo</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Edad</TableHead>
                      <TableHead>Lectura Dial</TableHead>
                      <TableHead>Fuerza (kN)</TableHead>
                      <TableHead>Resultado (MPa)</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {flexionResults.slice(0, 20).map((result) => {
                      const passed = (result.resistance_mpa || 0) >= parameters.flexion_min_individual_mpa
                      return (
                        <TableRow key={result.id}>
                          <TableCell>
                            {result.test_date ? new Date(result.test_date).toLocaleDateString("es-AR") : "-"}
                          </TableCell>
                          <TableCell className="font-mono">{result.sample?.sample_code}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{result.sample?.adoquin_type}</Badge>
                          </TableCell>
                          <TableCell>{result.test_age_days}d</TableCell>
                          <TableCell>{result.dial_reading}</TableCell>
                          <TableCell>{result.load_kn?.toFixed(2)}</TableCell>
                          <TableCell className={passed ? "text-green-600 font-bold" : "text-red-600 font-bold"}>
                            {result.resistance_mpa?.toFixed(2)} MPa
                          </TableCell>
                          <TableCell>
                            <Badge variant={passed ? "default" : "destructive"}>
                              {passed ? "Aprobado" : "Rechazado"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Configuration Tab */}
          <TabsContent value="config" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Press Calibration */}
              <Card>
                <CardHeader>
                  <CardTitle>Calibracion de Prensa</CardTitle>
                  <CardDescription>
                    Formula cubica: F = A*dial^3 + B*dial^2 + C*dial + D
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {calibration ? (
                    <>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">Fecha calibracion:</p>
                          <p className="font-medium">{new Date(calibration.calibration_date).toLocaleDateString("es-AR")}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Certificado:</p>
                          <p className="font-medium">{calibration.certificate_number || "-"}</p>
                        </div>
                      </div>
                      <div className="bg-muted p-3 rounded-lg font-mono text-sm">
                        <p>F = {calibration.coef_a}×dial³ + {calibration.coef_b}×dial² + {calibration.coef_c}×dial + {calibration.coef_d}</p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Calibrado por: {calibration.calibrated_by || "No especificado"}
                      </p>
                    </>
                  ) : (
                    <p className="text-muted-foreground">No hay calibracion configurada</p>
                  )}
                  <Button variant="outline" className="w-full" onClick={() => setShowCalibrationDialog(true)}>
                    {calibration ? "Actualizar Calibracion" : "Configurar Calibracion"}
                  </Button>
                </CardContent>
              </Card>

              {/* IRAM Parameters */}
              <Card>
                <CardHeader>
                  <CardTitle>Parametros IRAM</CardTitle>
                  <CardDescription>
                    Valores minimos de resistencia a flexion
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-3 bg-muted rounded-lg">
                      <span>Minimo Individual</span>
                      <span className="font-bold text-lg">{parameters.flexion_min_individual_mpa} MPa</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-muted rounded-lg">
                      <span>Minimo Grupal (3+ muestras)</span>
                      <span className="font-bold text-lg">{parameters.flexion_min_group_mpa} MPa</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Segun norma IRAM para adoquines de hormigon - Ensayo de flexion a 28 dias
                  </p>
                </CardContent>
              </Card>

              {/* Adoquin Dimensions */}
              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle>Dimensiones de Adoquines</CardTitle>
                  <CardDescription>
                    Medidas estandar utilizadas para el calculo de resistencia
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Largo (mm)</TableHead>
                        <TableHead>Ancho (mm)</TableHead>
                        <TableHead>Alto (mm)</TableHead>
                        <TableHead>Luz ensayo (mm)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ADOQUIN_TYPES.map(t => (
                        <TableRow key={t.code}>
                          <TableCell className="font-medium">{t.name}</TableCell>
                          <TableCell>200</TableCell>
                          <TableCell>100</TableCell>
                          <TableCell>{t.height}</TableCell>
                          <TableCell>180</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        {/* Calibration Dialog */}
        <Dialog open={showCalibrationDialog} onOpenChange={setShowCalibrationDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Configurar Calibracion de Prensa</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <Alert>
                <AlertDescription>
                  Formula: F(kN) = A×dial³ + B×dial² + C×dial + D
                </AlertDescription>
              </Alert>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Coeficiente A</Label>
                  <Input
                    type="number"
                    step="0.0000001"
                    value={calibrationForm.coef_a}
                    onChange={(e) => setCalibrationForm(prev => ({ ...prev, coef_a: e.target.value }))}
                    placeholder="0.0000001"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Coeficiente B</Label>
                  <Input
                    type="number"
                    step="0.00001"
                    value={calibrationForm.coef_b}
                    onChange={(e) => setCalibrationForm(prev => ({ ...prev, coef_b: e.target.value }))}
                    placeholder="0.00001"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Coeficiente C</Label>
                  <Input
                    type="number"
                    step="0.001"
                    value={calibrationForm.coef_c}
                    onChange={(e) => setCalibrationForm(prev => ({ ...prev, coef_c: e.target.value }))}
                    placeholder="0.1"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Coeficiente D</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={calibrationForm.coef_d}
                    onChange={(e) => setCalibrationForm(prev => ({ ...prev, coef_d: e.target.value }))}
                    placeholder="0"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Fecha de Calibracion</Label>
                  <Input
                    type="date"
                    value={calibrationForm.calibration_date}
                    onChange={(e) => setCalibrationForm(prev => ({ ...prev, calibration_date: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Numero de Certificado</Label>
                  <Input
                    value={calibrationForm.certificate_number}
                    onChange={(e) => setCalibrationForm(prev => ({ ...prev, certificate_number: e.target.value }))}
                    placeholder="CERT-2024-001"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Calibrado por</Label>
                <Input
                  value={calibrationForm.calibrated_by}
                  onChange={(e) => setCalibrationForm(prev => ({ ...prev, calibrated_by: e.target.value }))}
                  placeholder="Nombre del responsable"
                />
              </div>

              <Button onClick={saveCalibration} className="w-full" disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Guardar Calibracion
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Test Dialog */}
        <Dialog open={showTestDialog} onOpenChange={setShowTestDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Registrar Ensayo de Flexion</DialogTitle>
            </DialogHeader>
            {selectedSpecimen && (
              <div className="space-y-4 py-4">
                <div className="bg-muted p-3 rounded-lg">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Muestra:</span>
                      <span className="ml-2 font-mono font-medium">{selectedSpecimen.sample?.sample_code}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Especimen:</span>
                      <span className="ml-2 font-medium">#{selectedSpecimen.specimen_number}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Tipo:</span>
                      <span className="ml-2">{selectedSpecimen.sample?.adoquin_type}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Edad:</span>
                      <span className="ml-2">{selectedSpecimen.test_age_days} dias</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Lectura del Dial *</Label>
                  <Input
                    type="number"
                    value={testForm.dial_reading}
                    onChange={(e) => setTestForm(prev => ({ ...prev, dial_reading: e.target.value }))}
                    placeholder="Valor del dial"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Altura (mm)</Label>
                    <Input
                      type="number"
                      value={testForm.height_mm}
                      onChange={(e) => setTestForm(prev => ({ ...prev, height_mm: e.target.value }))}
                      placeholder="60 o 80"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Ancho (mm)</Label>
                    <Input
                      type="number"
                      value={testForm.width_mm}
                      onChange={(e) => setTestForm(prev => ({ ...prev, width_mm: e.target.value }))}
                      placeholder="100"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Peso SSS (g) - opcional</Label>
                  <Input
                    type="number"
                    value={testForm.weight_sss_g}
                    onChange={(e) => setTestForm(prev => ({ ...prev, weight_sss_g: e.target.value }))}
                    placeholder="Peso saturado superficie seca"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Ensayado por</Label>
                  <Input
                    value={testForm.tested_by}
                    onChange={(e) => setTestForm(prev => ({ ...prev, tested_by: e.target.value }))}
                    placeholder="Nombre del operador"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Observaciones</Label>
                  <Textarea
                    value={testForm.notes}
                    onChange={(e) => setTestForm(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder="Notas adicionales..."
                    rows={2}
                  />
                </div>

                <Button onClick={saveTestResult} className="w-full" disabled={saving || !testForm.dial_reading}>
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Registrar Resultado
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  )
}
