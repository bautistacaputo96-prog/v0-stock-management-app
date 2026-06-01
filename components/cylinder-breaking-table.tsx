"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Check, Loader2, Settings2, AlertTriangle } from "lucide-react"
import { toast } from "@/hooks/use-toast"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface PressCalibration {
  id: string
  constant_a: number
  constant_b: number
  constant_c: number
  constant_d: number
  calibration_date: string
  cylinder_diameter_cm: number
  is_active: boolean
}

interface CylinderBreakingRow {
  id: string
  dispatch_id: string
  cylinder_number: number
  test_age_days: number
  scheduled_test_date: string
  weight_grams: number | null
  dial_reading: number | null
  comments: string | null
  dispatch: {
    sample_number: string
    dispatch_date: string
    formula: {
      plant_id: string
    }
  }
}

interface CylinderBreakingTableProps {
  plants: Array<{ id: string; name: string }>
  selectedPlantId: string
  onPlantChange: (plantId: string) => void
}

export function CylinderBreakingTable({ plants, selectedPlantId }: CylinderBreakingTableProps) {
  const [cylinders, setCylinders] = useState<CylinderBreakingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editingValues, setEditingValues] = useState<
    Record<string, { weight?: string; dial?: string; comments?: string; testDate?: string }>
  >({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  
  // Calibration state
  const [calibration, setCalibration] = useState<PressCalibration | null>(null)
  const [calibrationDialog, setCalibrationDialog] = useState(false)
  const [calibrationForm, setCalibrationForm] = useState({
    constant_a: "-5.07E-08",
    constant_b: "-1.85E-05",
    constant_c: "0.35732",
    constant_d: "1.0243",
    calibration_date: new Date().toISOString().split("T")[0],
    cylinder_diameter_cm: "10",
  })
  const [savingCalibration, setSavingCalibration] = useState(false)

  useEffect(() => {
    loadCylinders()
    loadCalibration()
  }, [selectedPlantId])

  const loadCalibration = async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("press_calibrations")
      .select("*")
      .eq("is_active", true)
      .order("calibration_date", { ascending: false })
      .limit(1)

    console.log("[v0] loadCalibration result:", { data, error })

    if (data && data.length > 0) {
      setCalibration(data[0])
      setCalibrationForm({
        constant_a: data[0].constant_a.toString(),
        constant_b: data[0].constant_b.toString(),
        constant_c: data[0].constant_c.toString(),
        constant_d: data[0].constant_d.toString(),
        calibration_date: data[0].calibration_date,
        cylinder_diameter_cm: data[0].cylinder_diameter_cm.toString(),
      })
    }
  }

  const saveCalibration = async () => {
    setSavingCalibration(true)
    const supabase = createClient()

    try {
      // Deactivate current active calibration
      await supabase.from("press_calibrations").update({ is_active: false }).eq("is_active", true)

      // Insert new calibration
      const { data, error } = await supabase
        .from("press_calibrations")
        .insert({
          constant_a: parseFloat(calibrationForm.constant_a),
          constant_b: parseFloat(calibrationForm.constant_b),
          constant_c: parseFloat(calibrationForm.constant_c),
          constant_d: parseFloat(calibrationForm.constant_d),
          calibration_date: calibrationForm.calibration_date,
          cylinder_diameter_cm: parseFloat(calibrationForm.cylinder_diameter_cm),
          is_active: true,
        })
        .select()
        .single()

      console.log("[v0] saveCalibration result:", { data, error })

      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" })
      } else {
        setCalibration(data)
        setCalibrationDialog(false)
        toast({ title: "Calibracion guardada", description: "La nueva calibracion esta activa" })
        // Reload to ensure state is correct
        await loadCalibration()
      }
    } catch (err) {
      console.error("[v0] saveCalibration error:", err)
      toast({ title: "Error", description: "No se pudo guardar la calibracion", variant: "destructive" })
    } finally {
      setSavingCalibration(false)
    }
  }

  // Check if calibration is expiring (within 1 month of 1 year anniversary)
  const isCalibrationExpiring = () => {
    if (!calibration) return false
    const calibrationDate = new Date(calibration.calibration_date)
    const expiryDate = new Date(calibrationDate)
    expiryDate.setFullYear(expiryDate.getFullYear() + 1)
    const warningDate = new Date(expiryDate)
    warningDate.setMonth(warningDate.getMonth() - 1)
    return new Date() >= warningDate
  }

  const getCalibrationExpiryDate = () => {
    if (!calibration) return null
    const expiryDate = new Date(calibration.calibration_date)
    expiryDate.setFullYear(expiryDate.getFullYear() + 1)
    return expiryDate
  }

  // Calculate MPa for preview (used in input field)
  const calculateMPaPreview = (dialReading: string): string => {
    if (!calibration || !dialReading) return ""
    const x = parseFloat(dialReading)
    if (isNaN(x)) return ""
    
    const a = calibration.constant_a
    const b = calibration.constant_b
    const c = calibration.constant_c
    const d = calibration.constant_d
    const tf = a * Math.pow(x, 3) + b * Math.pow(x, 2) + c * x + d
    const diameterM = calibration.cylinder_diameter_cm / 100
    const radius = diameterM / 2
    const area = Math.PI * Math.pow(radius, 2)
    const mpa = (tf * 9.80665) / area / 1000
    return mpa.toFixed(2)
  }

  // Calculate MPa from dial reading using calibration formula
  // Y = Ax³ + Bx² + Cx + D (tf - toneladas fuerza)
  // MPa = Y * 9.80665 / (π * r²) / 1000 where r is radius in meters
  const calculateMPa = (dialReading: number): number | null => {
    if (!calibration) return null

    const x = dialReading
    const a = calibration.constant_a
    const b = calibration.constant_b
    const c = calibration.constant_c
    const d = calibration.constant_d

    // Calculate tf (toneladas fuerza)
    const tf = a * Math.pow(x, 3) + b * Math.pow(x, 2) + c * x + d

    // Convert to MPa: tf * 9.80665 / Area (in m²) / 1000
    // Area = π * r² where r = diameter_cm / 100 / 2 (convert cm to m, then to radius)
    const diameterM = calibration.cylinder_diameter_cm / 100
    const radius = diameterM / 2
    const area = Math.PI * Math.pow(radius, 2)
    const mpa = (tf * 9.80665) / area / 1000

    return mpa
  }

  const loadCylinders = async () => {
    setLoading(true)
    const supabase = createClient()

    console.log("[v0] Loading cylinders for plant:", selectedPlantId)

    let query = supabase
      .from("test_cylinders")
      .select(`
        id,
        dispatch_id,
        cylinder_number,
        test_age_days,
        scheduled_test_date,
        weight_grams,
        dial_reading,
        comments,
        dispatch:dispatches!inner(
          sample_number,
          dispatch_date,
          formula:formulas!inner(
            plant_id
          )
        )
      `)
      .is("actual_test_date", null)
      .order("scheduled_test_date", { ascending: true })

    if (selectedPlantId !== "all") {
      query = query.filter("dispatch.formula.plant_id", "eq", selectedPlantId)
    }

    const { data, error } = await query

    if (error) {
      toast({
        title: "Error",
        description: "No se pudieron cargar las probetas",
        variant: "destructive",
      })
      setCylinders([])
    } else {
      console.log("[v0] Successfully loaded cylinders:", data?.length || 0)
      setCylinders(data || [])
    }
    setLoading(false)
  }

  const calculateDaysUntilTest = (scheduledDate: string) => {
    const scheduled = new Date(scheduledDate)
    const today = new Date()
    // Reset hours to compare only dates
    scheduled.setHours(0, 0, 0, 0)
    today.setHours(0, 0, 0, 0)
    const diffTime = scheduled.getTime() - today.getTime()
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
    return diffDays
  }

  const getRowColor = (daysUntil: number) => {
    if (daysUntil < 0) return "bg-red-50" // Overdue
    if (daysUntil === 0) return "bg-green-50" // Today
    if (daysUntil === 1) return "bg-yellow-50" // Tomorrow
    return "" // Default
  }

  const getPriority = (daysUntil: number) => {
    if (daysUntil < 0) return 0 // Overdue - highest priority
    if (daysUntil === 0) return 1 // Today
    if (daysUntil === 1) return 2 // Tomorrow
    return 3 // Future
  }

  const sortedCylinders = [...cylinders].sort((a, b) => {
    const daysA = calculateDaysUntilTest(a.scheduled_test_date)
    const daysB = calculateDaysUntilTest(b.scheduled_test_date)
    const priorityA = getPriority(daysA)
    const priorityB = getPriority(daysB)

    if (priorityA !== priorityB) {
      return priorityA - priorityB
    }

    // Within same priority, sort by scheduled date
    return new Date(a.scheduled_test_date).getTime() - new Date(b.scheduled_test_date).getTime()
  })

  const formatDate = (dateStr: string) => {
    if (!dateStr) return ""
    const date = new Date(dateStr)
    return date.toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
  }

  const handleInputChange = (cylinderId: string, field: "weight" | "dial" | "comments" | "testDate", value: string) => {
    setEditingValues((prev) => ({
      ...prev,
      [cylinderId]: {
        ...prev[cylinderId],
        [field]: value,
      },
    }))
  }

  const handleSave = async (cylinderId: string) => {
    const values = editingValues[cylinderId]
    if (!values || !values.dial) {
      toast({
        title: "Error",
        description: "Debe ingresar al menos la lectura del dial",
        variant: "destructive",
      })
      return
    }

    setSaving((prev) => ({ ...prev, [cylinderId]: true }))
    const supabase = createClient()

    const testDate = values.testDate || getTodayDate()
    const dialReading = Number.parseFloat(values.dial)

    const updateData: Record<string, unknown> = {
      actual_test_date: testDate,
      dial_reading: dialReading,
    }

    // Calculate MPa if calibration is available
    const mpa = calculateMPa(dialReading)
    if (mpa !== null) {
      updateData.strength_mpa = mpa
    }

    if (values.weight) updateData.weight_grams = Number.parseFloat(values.weight)
    if (values.comments) updateData.comments = values.comments

    const { error } = await supabase.from("test_cylinders").update(updateData).eq("id", cylinderId)

    setSaving((prev) => ({ ...prev, [cylinderId]: false }))

    if (error) {
      toast({
        title: "Error",
        description: "No se pudo guardar la información",
        variant: "destructive",
      })
    } else {
      toast({
        title: "Rotura registrada",
        description: "La probeta se ha ensayado y aparecerá en la tabla de extracción",
      })
      setCylinders((prev) => prev.filter((cyl) => cyl.id !== cylinderId))
      setEditingValues((prev) => {
        const newValues = { ...prev }
        delete newValues[cylinderId]
        return newValues
      })
    }
  }

  const getTodayDate = () => {
    const today = new Date()
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (cylinders.length === 0) {
    return (
      <div className="text-center p-8 text-muted-foreground">
        No hay probetas pendientes de rotura para esta planta.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Calibration Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg bg-muted/30 border">
        <div className="text-sm">
          {calibration ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
              <span className="text-muted-foreground">
                Calibracion: <strong className="text-foreground">{new Date(calibration.calibration_date).toLocaleDateString("es-AR")}</strong>
              </span>
              <span className="text-muted-foreground">
                Vence: <strong className={isCalibrationExpiring() ? "text-red-600" : "text-foreground"}>
                  {getCalibrationExpiryDate()?.toLocaleDateString("es-AR")}
                </strong>
              </span>
              {isCalibrationExpiring() && (
                <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                  <AlertTriangle className="h-4 w-4" />
                  Calibracion proxima a vencer
                </span>
              )}
            </div>
          ) : (
            <span className="text-amber-600 font-medium flex items-center gap-1">
              <AlertTriangle className="h-4 w-4" />
              Sin calibracion configurada - Configure la calibracion para calcular MPa
            </span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => setCalibrationDialog(true)}>
          <Settings2 className="h-4 w-4 mr-2" />
          Calibracion
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-xs font-semibold">Probeta ID</TableHead>
              <TableHead className="text-xs font-semibold">Fecha de Ensayo</TableHead>
              <TableHead className="text-xs font-semibold">Romper</TableHead>
              <TableHead className="text-xs font-semibold">Fecha de Rotura</TableHead>
              <TableHead className="text-xs font-semibold">Peso (g)</TableHead>
              <TableHead className="text-xs font-semibold">Lec. Dial</TableHead>
              <TableHead className="text-xs font-semibold">MPa</TableHead>
              <TableHead className="text-xs font-semibold">Observaciones</TableHead>
              <TableHead className="text-xs font-semibold w-[80px]">Accion</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedCylinders.map((cylinder) => {
              const daysUntilTest = calculateDaysUntilTest(cylinder.scheduled_test_date)
              const rowColor = getRowColor(daysUntilTest)
              const hasDialReading = !!editingValues[cylinder.id]?.dial || !!cylinder.dial_reading
              const isSaving = saving[cylinder.id]

              return (
                <TableRow key={cylinder.id} className={`text-xs ${rowColor}`}>
                  <TableCell className="font-medium py-2 px-3">
                    {cylinder.dispatch?.sample_number || "-"}-{cylinder.cylinder_number}
                  </TableCell>
                  <TableCell className="py-2 px-3">{formatDate(cylinder.scheduled_test_date)}</TableCell>
                  <TableCell className="py-2 px-3 text-center">
                    <span
                      className={
                        daysUntilTest < 0
                          ? "text-red-600 font-semibold"
                          : daysUntilTest === 0
                            ? "text-green-600 font-semibold"
                            : daysUntilTest === 1
                              ? "text-yellow-600 font-semibold"
                              : "text-muted-foreground"
                      }
                    >
                      {daysUntilTest} días
                    </span>
                  </TableCell>
                  <TableCell className="py-2 px-3">
                    <Input
                      type="date"
                      value={editingValues[cylinder.id]?.testDate ?? getTodayDate()}
                      onChange={(e) => handleInputChange(cylinder.id, "testDate", e.target.value)}
                      className="h-8 text-xs"
                    />
                  </TableCell>
                  <TableCell className="py-2 px-3">
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="Peso"
                      value={editingValues[cylinder.id]?.weight ?? cylinder.weight_grams ?? ""}
                      onChange={(e) => handleInputChange(cylinder.id, "weight", e.target.value)}
                      className="h-8 text-xs"
                    />
                  </TableCell>
                  <TableCell className="py-2 px-3">
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="Lectura"
                      value={editingValues[cylinder.id]?.dial ?? cylinder.dial_reading ?? ""}
                      onChange={(e) => handleInputChange(cylinder.id, "dial", e.target.value)}
                      className="h-8 text-xs w-20"
                    />
                  </TableCell>
                  <TableCell className="py-2 px-3">
                    {(() => {
                      const dialValue = editingValues[cylinder.id]?.dial ?? cylinder.dial_reading?.toString() ?? ""
                      const mpaValue = calculateMPaPreview(dialValue)
                      const savedMpa = cylinder.strength_mpa
                      return (
                        <div className="text-xs">
                          {mpaValue ? (
                            <span className="font-semibold text-primary">{mpaValue} MPa</span>
                          ) : savedMpa ? (
                            <span className="text-muted-foreground">{savedMpa.toFixed(2)} MPa</span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </div>
                      )
                    })()}
                  </TableCell>
                  <TableCell className="py-2 px-3">
                    <Input
                      type="text"
                      placeholder="Observaciones"
                      value={editingValues[cylinder.id]?.comments ?? cylinder.comments ?? ""}
                      onChange={(e) => handleInputChange(cylinder.id, "comments", e.target.value)}
                      className="h-8 text-xs"
                    />
                  </TableCell>
                  <TableCell className="py-2 px-3">
                    <Button
                      size="sm"
                      onClick={() => handleSave(cylinder.id)}
                      disabled={!hasDialReading || isSaving}
                      className="h-7 w-full text-xs"
                    >
                      {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Calibration Dialog */}
      <Dialog open={calibrationDialog} onOpenChange={setCalibrationDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Calibracion de Prensa</DialogTitle>
            <DialogDescription>
              Configure los coeficientes de la funcion de calibracion del INTI.
              Formula: Y = Ax3 + Bx2 + Cx + D (donde X es Lectura Dial, Y es KGF)
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Coeficientes de Calibracion</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="const_a" className="text-xs">Constante A</Label>
                  <Input
                    id="const_a"
                    value={calibrationForm.constant_a}
                    onChange={(e) => setCalibrationForm({ ...calibrationForm, constant_a: e.target.value })}
                    placeholder="-5.07E-08"
                    className="font-mono text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="const_b" className="text-xs">Constante B</Label>
                  <Input
                    id="const_b"
                    value={calibrationForm.constant_b}
                    onChange={(e) => setCalibrationForm({ ...calibrationForm, constant_b: e.target.value })}
                    placeholder="-1.85E-05"
                    className="font-mono text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="const_c" className="text-xs">Constante C</Label>
                  <Input
                    id="const_c"
                    value={calibrationForm.constant_c}
                    onChange={(e) => setCalibrationForm({ ...calibrationForm, constant_c: e.target.value })}
                    placeholder="0.35732"
                    className="font-mono text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="const_d" className="text-xs">Constante D</Label>
                  <Input
                    id="const_d"
                    value={calibrationForm.constant_d}
                    onChange={(e) => setCalibrationForm({ ...calibrationForm, constant_d: e.target.value })}
                    placeholder="1.0243"
                    className="font-mono text-sm"
                  />
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cal_date" className="text-xs">Fecha de Calibracion</Label>
                <Input
                  id="cal_date"
                  type="date"
                  value={calibrationForm.calibration_date}
                  onChange={(e) => setCalibrationForm({ ...calibrationForm, calibration_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="diameter" className="text-xs">Diametro Probeta (cm)</Label>
                <Input
                  id="diameter"
                  value={calibrationForm.cylinder_diameter_cm}
                  onChange={(e) => setCalibrationForm({ ...calibrationForm, cylinder_diameter_cm: e.target.value })}
                  placeholder="10"
                  className="font-mono text-sm"
                />
              </div>
            </div>

            {/* Preview calculation */}
            <Card className="bg-muted/50">
              <CardContent className="py-3">
                <p className="text-xs text-muted-foreground mb-2">Vista previa de calculo (Lectura Dial = 40):</p>
                <div className="font-mono text-sm">
                  {(() => {
                    const x = 40
                    const a = parseFloat(calibrationForm.constant_a) || 0
                    const b = parseFloat(calibrationForm.constant_b) || 0
                    const c = parseFloat(calibrationForm.constant_c) || 0
                    const d = parseFloat(calibrationForm.constant_d) || 0
                    const tf = a * Math.pow(x, 3) + b * Math.pow(x, 2) + c * x + d
                    const diameterM = (parseFloat(calibrationForm.cylinder_diameter_cm) || 10) / 100
                    const r = diameterM / 2
                    const area = Math.PI * Math.pow(r, 2)
                    const mpa = (tf * 9.80665) / area / 1000
                    return (
                      <>
                        <p>Y (tf) = {tf.toFixed(4)}</p>
                        <p>Area = {area.toFixed(6)} m2</p>
                        <p className="font-semibold">Resultado = {mpa.toFixed(2)} MPa</p>
                      </>
                    )
                  })()}
                </div>
              </CardContent>
            </Card>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCalibrationDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={saveCalibration} disabled={savingCalibration}>
              {savingCalibration ? "Guardando..." : "Guardar Calibracion"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
