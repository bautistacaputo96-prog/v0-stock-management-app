"use client"

import { useState, useEffect } from "react"
import { getSupabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { Calendar, Save, X, Loader2 } from "lucide-react"

const PIPE_SIZES = ["300", "400", "500", "600", "800", "1000", "1200"]
const SILKE_PIPE_SIZES = ["300", "400", "500", "600"]
const VILLA_ROSA_PIPE_SIZES = ["800", "1000", "1200"]
const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
]
const DAY_NAMES = ["D", "L", "M", "M", "J", "V", "S"]

// Feriados nacionales de Argentina (formato: "MM-DD" o funcion para feriados moviles)
const FERIADOS_FIJOS: Record<string, string> = {
  "01-01": "Año Nuevo",
  "02-24": "Carnaval", // 2025
  "02-25": "Carnaval", // 2025
  "03-24": "Día de la Memoria",
  "04-02": "Día del Veterano",
  "04-18": "Viernes Santo", // 2025
  "05-01": "Día del Trabajador",
  "05-25": "Revolución de Mayo",
  "06-16": "Paso a la Inmortalidad del Gral. Güemes", // Puente 2025
  "06-17": "Paso a la Inmortalidad del Gral. Güemes",
  "06-20": "Paso a la Inmortalidad del Gral. Belgrano",
  "07-09": "Día de la Independencia",
  "08-17": "Paso a la Inmortalidad del Gral. San Martín", // 2025
  "10-12": "Día del Respeto a la Diversidad Cultural", // 2025 se pasa
  "11-20": "Día de la Soberanía Nacional", // 2025
  "11-21": "Día de la Soberanía Nacional", // Puente 2025
  "12-08": "Día de la Inmaculada Concepción",
  "12-25": "Navidad",
}

// Feriados por año (para feriados móviles como Semana Santa, etc.)
const FERIADOS_POR_ANO: Record<number, Record<string, string>> = {
  2025: {
    "02-24": "Carnaval",
    "02-25": "Carnaval",
    "04-18": "Viernes Santo",
    "06-16": "Puente Turístico",
    "08-18": "Paso a la Inmortalidad San Martín (trasladado)",
    "10-13": "Día Diversidad Cultural (trasladado)",
    "11-21": "Puente Turístico",
  },
  2026: {
    "02-16": "Carnaval",
    "02-17": "Carnaval",
    "04-03": "Viernes Santo",
    "08-17": "Paso a la Inmortalidad San Martín",
    "10-12": "Día Diversidad Cultural",
    "11-23": "Día Soberanía Nacional (trasladado)",
  },
}

function getFeriado(year: number, month: number, day: number): string | null {
  const mmdd = `${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  
  // Primero verificar feriados específicos del año
  if (FERIADOS_POR_ANO[year]?.[mmdd]) {
    return FERIADOS_POR_ANO[year][mmdd]
  }
  
  // Luego verificar feriados fijos
  if (FERIADOS_FIJOS[mmdd]) {
    return FERIADOS_FIJOS[mmdd]
  }
  
  return null
}

interface PlanningData {
  [pipeSize: string]: {
    [day: number]: number
  }
}

interface ProductionPlanningProps {
  lineType: "bloques" | "caños"
}

export function ProductionPlanning({ lineType }: ProductionPlanningProps) {
  const [open, setOpen] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth())
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [planningData, setPlanningData] = useState<PlanningData>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()
  const supabase = getSupabase()

  // Get days in month
  const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate()

  // Get day of week for each day (0 = Sunday, 6 = Saturday)
  const getDayOfWeek = (day: number) => {
    return new Date(selectedYear, selectedMonth, day).getDay()
  }

  // Check if day is weekend
  const isWeekend = (day: number) => {
    const dow = getDayOfWeek(day)
    return dow === 0 || dow === 6
  }

  // Check if day is holiday
  const isHoliday = (day: number) => {
    return getFeriado(selectedYear, selectedMonth, day) !== null
  }

  // Check if day is non-working (weekend or holiday)
  const isNonWorkingDay = (day: number) => {
    return isWeekend(day) || isHoliday(day)
  }

  // Get holiday name if exists
  const getHolidayName = (day: number) => {
    return getFeriado(selectedYear, selectedMonth, day)
  }

  // Load planning data when month/year changes
  useEffect(() => {
    if (open) {
      loadPlanningData()
    }
  }, [selectedMonth, selectedYear, open])

  async function loadPlanningData() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from("production_planning")
        .select("*")
        .eq("year", selectedYear)
        .eq("month", selectedMonth + 1)

      if (error) throw error

      // Convert to grid format
      const gridData: PlanningData = {}
      PIPE_SIZES.forEach(size => {
        gridData[size] = {}
      })

      if (data) {
        data.forEach((row: any) => {
          const size = row.pipe_size
          if (gridData[size]) {
            for (let day = 1; day <= 31; day++) {
              const dayValue = row[`day_${day}`]
              if (dayValue && dayValue > 0) {
                gridData[size][day] = dayValue
              }
            }
          }
        })
      }

      setPlanningData(gridData)
    } catch (error) {
      console.error("Error loading planning:", error)
      toast({
        title: "Error",
        description: "No se pudo cargar la planificación",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  function handleCellChange(pipeSize: string, day: number, value: string) {
    const numValue = value === "" ? 0 : parseInt(value, 10)
    if (isNaN(numValue)) return

    setPlanningData(prev => ({
      ...prev,
      [pipeSize]: {
        ...prev[pipeSize],
        [day]: numValue
      }
    }))
  }

  // Copy value to all working days for a pipe size (excluding weekends and holidays)
  function fillRow(pipeSize: string, value: number) {
    const newRow: { [day: number]: number } = {}
    for (let day = 1; day <= daysInMonth; day++) {
      if (!isNonWorkingDay(day)) {
        newRow[day] = value
      }
    }
    setPlanningData(prev => ({
      ...prev,
      [pipeSize]: newRow
    }))
  }

  // Clear row
  function clearRow(pipeSize: string) {
    setPlanningData(prev => ({
      ...prev,
      [pipeSize]: {}
    }))
  }

  async function savePlanning() {
    setSaving(true)
    try {
      // Build rows with day_1, day_2, etc. structure
      for (const pipeSize of PIPE_SIZES) {
        const rowData = planningData[pipeSize] || {}
        
        // Build day columns object
        const dayColumns: Record<string, number> = {}
        for (let day = 1; day <= 31; day++) {
          dayColumns[`day_${day}`] = rowData[day] || 0
        }

        // Upsert row for this pipe size
        const { error } = await supabase
          .from("production_planning")
          .upsert({
            year: selectedYear,
            month: selectedMonth + 1,
            pipe_size: pipeSize,
            ...dayColumns,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'year,month,pipe_size'
          })

        if (error) throw error
      }

      toast({
        title: "Guardado",
        description: `Planificación de ${MONTHS[selectedMonth]} ${selectedYear} guardada correctamente`,
      })
    } catch (error) {
      console.error("Error saving planning:", error)
      toast({
        title: "Error",
        description: "No se pudo guardar la planificación",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  // Calculate totals
  function getRowTotal(pipeSize: string) {
    const rowData = planningData[pipeSize] || {}
    return Object.values(rowData).reduce((sum, val) => sum + (val || 0), 0)
  }

  function getColumnTotal(day: number) {
    return PIPE_SIZES.reduce((sum, size) => {
      return sum + (planningData[size]?.[day] || 0)
    }, 0)
  }

  function getGrandTotal() {
    return PIPE_SIZES.reduce((sum, size) => sum + getRowTotal(size), 0)
  }

  function getPlantTotal(pipeSizes: string[]) {
    return pipeSizes.reduce((sum, size) => sum + getRowTotal(size), 0)
  }

  function getPlantColumnTotal(day: number, pipeSizes: string[]) {
    return pipeSizes.reduce((sum, size) => {
      return sum + (planningData[size]?.[day] || 0)
    }, 0)
  }

  if (lineType !== "caños") return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 bg-transparent">
          <Calendar className="h-4 w-4" />
          Planificación Mensual
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[98vw] max-w-none max-h-[95vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Planificación de Producción - Caños</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-4 py-2 border-b">
          <div className="flex items-center gap-2">
            <Label>Mes:</Label>
            <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(parseInt(v))}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((month, idx) => (
                  <SelectItem key={idx} value={String(idx)}>{month}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label>Año:</Label>
            <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(parseInt(v))}>
              <SelectTrigger className="w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[2024, 2025, 2026, 2027].map(year => (
                  <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1" />
          <Button onClick={savePlanning} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar Planificación
          </Button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex-1 overflow-auto space-y-6">
            {/* SILKE - Caños 300 a 600 */}
            <div>
              <h3 className="text-sm font-semibold mb-2 px-2 py-1 bg-blue-100 text-blue-800 rounded">SILKE - Caños Chicos (300 a 600)</h3>
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-background z-10">
                  <tr>
                    <th className="border px-2 py-1 bg-muted text-left font-medium w-[80px] sticky left-0 z-20">Tipo</th>
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                      const holiday = getHolidayName(day)
                      const isNonWorking = isNonWorkingDay(day)
                      return (
                        <th 
                          key={day} 
                          className={`border px-1 py-1 text-center font-normal min-w-[32px] ${isNonWorking ? 'bg-red-200 text-red-700' : 'bg-muted'}`}
                          title={holiday || (isWeekend(day) ? 'Fin de semana' : '')}
                        >
                          <div className="text-[10px] text-muted-foreground">{DAY_NAMES[getDayOfWeek(day)]}</div>
                          <div className={holiday ? 'font-bold' : ''}>{day}</div>
                          {holiday && <div className="text-[7px] leading-tight truncate max-w-[30px]" title={holiday}>F</div>}
                        </th>
                      )
                    })}
                    <th className="border px-2 py-1 bg-blue-600 text-white font-medium w-[60px]">Total</th>
                    <th className="border px-1 py-1 bg-muted font-normal w-[80px]">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {SILKE_PIPE_SIZES.map((size, rowIdx) => (
                    <tr key={size} className={rowIdx % 2 === 0 ? 'bg-background' : 'bg-muted/30'}>
                      <td className="border px-2 py-1 font-medium bg-blue-50 text-blue-800 sticky left-0 z-10">
                        CC{size}
                      </td>
                      {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                        const isNonWorking = isNonWorkingDay(day)
                        const holiday = getHolidayName(day)
                        return (
                          <td 
                            key={day} 
                            className={`border p-0 ${isNonWorking ? 'bg-red-200' : ''}`}
                            title={holiday || ''}
                          >
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              className={`h-7 w-full text-center text-xs border-0 rounded-none outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset ${isNonWorking ? 'bg-red-200 text-red-400 cursor-not-allowed' : 'bg-transparent'}`}
                              value={planningData[size]?.[day] || ""}
                              onChange={(e) => {
                                const val = e.target.value.replace(/[^0-9]/g, '')
                                handleCellChange(size, day, val)
                              }}
                              placeholder=""
                              disabled={isNonWorking}
                            />
                          </td>
                        )
                      })}
                      <td className="border px-2 py-1 text-center font-bold bg-blue-100">
                        {getRowTotal(size)}
                      </td>
                      <td className="border px-1 py-1">
                        <div className="flex gap-1">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-6 px-2 text-[10px]"
                            onClick={() => {
                              const value = prompt(`Llenar CC${size} con cantidad diaria:`)
                              if (value) fillRow(size, parseInt(value))
                            }}
                          >
                            Llenar
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-6 px-1 text-destructive"
                            onClick={() => clearRow(size)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-blue-50 font-bold">
                    <td className="border px-2 py-1 bg-blue-600 text-white sticky left-0 z-10">SILKE</td>
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => (
                      <td 
                        key={day} 
                        className={`border px-1 py-1 text-center ${isNonWorkingDay(day) ? 'bg-red-300 text-red-500' : ''}`}
                      >
                        {getPlantColumnTotal(day, SILKE_PIPE_SIZES) || ""}
                      </td>
                    ))}
                    <td className="border px-2 py-1 text-center bg-blue-600 text-white">
                      {getPlantTotal(SILKE_PIPE_SIZES)}
                    </td>
                    <td className="border"></td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* VILLA ROSA - Caños 800 a 1200 */}
            <div>
              <h3 className="text-sm font-semibold mb-2 px-2 py-1 bg-emerald-100 text-emerald-800 rounded">VILLA ROSA - Caños Grandes (800 a 1200)</h3>
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-background z-10">
                  <tr>
                    <th className="border px-2 py-1 bg-muted text-left font-medium w-[80px] sticky left-0 z-20">Tipo</th>
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                      const holiday = getHolidayName(day)
                      const isNonWorking = isNonWorkingDay(day)
                      return (
                        <th 
                          key={day} 
                          className={`border px-1 py-1 text-center font-normal min-w-[32px] ${isNonWorking ? 'bg-red-200 text-red-700' : 'bg-muted'}`}
                          title={holiday || (isWeekend(day) ? 'Fin de semana' : '')}
                        >
                          <div className="text-[10px] text-muted-foreground">{DAY_NAMES[getDayOfWeek(day)]}</div>
                          <div className={holiday ? 'font-bold' : ''}>{day}</div>
                          {holiday && <div className="text-[7px] leading-tight truncate max-w-[30px]" title={holiday}>F</div>}
                        </th>
                      )
                    })}
                    <th className="border px-2 py-1 bg-emerald-600 text-white font-medium w-[60px]">Total</th>
                    <th className="border px-1 py-1 bg-muted font-normal w-[80px]">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {VILLA_ROSA_PIPE_SIZES.map((size, rowIdx) => (
                    <tr key={size} className={rowIdx % 2 === 0 ? 'bg-background' : 'bg-muted/30'}>
                      <td className="border px-2 py-1 font-medium bg-emerald-50 text-emerald-800 sticky left-0 z-10">
                        CC{size}
                      </td>
                      {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                        const isNonWorking = isNonWorkingDay(day)
                        const holiday = getHolidayName(day)
                        return (
                          <td 
                            key={day} 
                            className={`border p-0 ${isNonWorking ? 'bg-red-200' : ''}`}
                            title={holiday || ''}
                          >
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              className={`h-7 w-full text-center text-xs border-0 rounded-none outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-inset ${isNonWorking ? 'bg-red-200 text-red-400 cursor-not-allowed' : 'bg-transparent'}`}
                              value={planningData[size]?.[day] || ""}
                              onChange={(e) => {
                                const val = e.target.value.replace(/[^0-9]/g, '')
                                handleCellChange(size, day, val)
                              }}
                              placeholder=""
                              disabled={isNonWorking}
                            />
                          </td>
                        )
                      })}
                      <td className="border px-2 py-1 text-center font-bold bg-emerald-100">
                        {getRowTotal(size)}
                      </td>
                      <td className="border px-1 py-1">
                        <div className="flex gap-1">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-6 px-2 text-[10px]"
                            onClick={() => {
                              const value = prompt(`Llenar CC${size} con cantidad diaria:`)
                              if (value) fillRow(size, parseInt(value))
                            }}
                          >
                            Llenar
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-6 px-1 text-destructive"
                            onClick={() => clearRow(size)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-emerald-50 font-bold">
                    <td className="border px-2 py-1 bg-emerald-600 text-white sticky left-0 z-10">V.ROSA</td>
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => (
                      <td 
                        key={day} 
                        className={`border px-1 py-1 text-center ${isNonWorkingDay(day) ? 'bg-red-300 text-red-500' : ''}`}
                      >
                        {getPlantColumnTotal(day, VILLA_ROSA_PIPE_SIZES) || ""}
                      </td>
                    ))}
                    <td className="border px-2 py-1 text-center bg-emerald-600 text-white">
                      {getPlantTotal(VILLA_ROSA_PIPE_SIZES)}
                    </td>
                    <td className="border"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="border-t pt-2 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 bg-red-200 border rounded"></div>
              <span>Fin de semana / Feriado (F)</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 bg-blue-50 border rounded"></div>
              <span>SILKE</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 bg-emerald-50 border rounded"></div>
              <span>VILLA ROSA</span>
            </div>
          </div>
          <div className="flex gap-4">
            <span>SILKE: <strong className="text-blue-600">{getPlantTotal(SILKE_PIPE_SIZES)}</strong></span>
            <span>VILLA ROSA: <strong className="text-emerald-600">{getPlantTotal(VILLA_ROSA_PIPE_SIZES)}</strong></span>
            <span>Total: <strong>{getGrandTotal()}</strong></span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
