"use client"

import { useState, useEffect, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Package,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Clock,
  Truck,
  Calendar,
  CheckCircle2,
  XCircle,
  FlaskConical,
  Activity,
  BarChart3,
  Users,
  Beaker,
  Settings2,
  CalendarDays,
  Check,
} from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
  ComposedChart,
  Area,
} from "recharts"

// Types
interface Plant {
  id: string
  name: string
  code: string
}

interface Material {
  id: string
  name: string
  unit: string
  current_stock: number
  min_stock: number
  dry_stock?: number
  plant_id: string
  plants: Plant
}

interface Dispatch {
  id: string
  dispatch_date: string
  quantity_m3: number
  client: string
  obra: string
  remito: string
  formula_id: string
  client_id: string
  formulas: {
    id: string
    code: string
    name: string
    plant_id: string
    plants: { name: string }
  }
  clients?: { id: string; name: string }
  construction_sites?: { id: string; name: string }
  dispatch_materials: Array<{
    id: string
    material_id: string
    quantity: number
    materials: { id: string; name: string; unit: string }
  }>
}

interface StockEntry {
  id: string
  entry_date: string
  quantity: number
  supplier?: string
  materials: {
    name: string
    unit: string
    plant_id: string
    plants: { name: string }
  }
  suppliers?: { name: string }
}

interface TestCylinder {
  id: string
  dispatch_id: string
  cylinder_number: number
  test_age_days: number
  scheduled_test_date: string
  actual_test_date?: string
  strength_mpa?: number
  dispatches: {
    id: string
    formulas: { id: string; name: string; code: string }
  }
}

interface Formula {
  id: string
  name: string
  code: string
  yield_m3: number
  plant_id: string
  plants: { name: string }
  formula_materials: Array<{
    material_id: string
    quantity: number
    materials: { id: string; name: string; unit: string }
  }>
}

interface PressCalibration {
  id: string
  calibration_date: string
  is_active: boolean
}

interface DashboardClientProps {
  plants: Plant[]
  materials: Material[]
  dispatches: Dispatch[]
  recentEntries: StockEntry[]
  testCylinders: TestCylinder[]
  formulas: Formula[]
  granulometriaTests: any[]
  pressCalibration?: PressCalibration | null
}

const CHART_COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#be185d", "#65a30d"]

export function DashboardClient({
  plants,
  materials,
  dispatches,
  recentEntries,
  testCylinders,
  formulas,
  pressCalibration,
}: DashboardClientProps) {
  const [selectedPlant, setSelectedPlant] = useState("all")
  const [dispatchView, setDispatchView] = useState<"day" | "week" | "month">("day")
  const [currentTime, setCurrentTime] = useState(new Date())
  
  // Month selection - default to current month
  const currentMonth = new Date().getMonth()
  const currentYear = new Date().getFullYear()
  const [selectedMonths, setSelectedMonths] = useState<string[]>([`${currentYear}-${currentMonth}`])
  
  // Generate last 12 months for selection
  const availableMonths = useMemo(() => {
    const months: { value: string; label: string; year: number; month: number }[] = []
    const now = new Date()
    for (let i = 0; i < 12; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const value = `${date.getFullYear()}-${date.getMonth()}`
      const label = date.toLocaleDateString("es-AR", { month: "long", year: "numeric" })
      months.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1), year: date.getFullYear(), month: date.getMonth() })
    }
    return months
  }, [])
  
  // Calculate date range from selected months
  const { dateRangeStart, dateRangeEnd } = useMemo(() => {
    if (selectedMonths.length === 0) {
      const now = new Date()
      return {
        dateRangeStart: new Date(now.getFullYear(), now.getMonth(), 1),
        dateRangeEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
      }
    }
    
    const parsedMonths = selectedMonths.map(m => {
      const [year, month] = m.split("-").map(Number)
      return { year, month }
    })
    
    const minMonth = parsedMonths.reduce((min, m) => 
      new Date(m.year, m.month) < new Date(min.year, min.month) ? m : min
    )
    const maxMonth = parsedMonths.reduce((max, m) => 
      new Date(m.year, m.month) > new Date(max.year, max.month) ? m : max
    )
    
    return {
      dateRangeStart: new Date(minMonth.year, minMonth.month, 1),
      dateRangeEnd: new Date(maxMonth.year, maxMonth.month + 1, 0, 23, 59, 59)
    }
  }, [selectedMonths])
  
  const toggleMonth = (value: string) => {
    setSelectedMonths(prev => 
      prev.includes(value) 
        ? prev.filter(m => m !== value)
        : [...prev, value]
    )
  }

  // Check if calibration is expiring (within 1 month of 1 year anniversary)
  const calibrationAlert = useMemo(() => {
    if (!pressCalibration) return { show: true, message: "Prensa sin calibrar", type: "warning" as const }
    
    const calibrationDate = new Date(pressCalibration.calibration_date)
    const expiryDate = new Date(calibrationDate)
    expiryDate.setFullYear(expiryDate.getFullYear() + 1)
    const warningDate = new Date(expiryDate)
    warningDate.setMonth(warningDate.getMonth() - 1)
    
    if (new Date() >= expiryDate) {
      return { show: true, message: `Calibracion vencida (${expiryDate.toLocaleDateString("es-AR")})`, type: "error" as const }
    }
    if (new Date() >= warningDate) {
      return { show: true, message: `Calibracion vence el ${expiryDate.toLocaleDateString("es-AR")}`, type: "warning" as const }
    }
    return { show: false, message: "", type: "info" as const }
  }, [pressCalibration])

  // Update time every minute
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  // Auto-refresh data every 5 minutes
  useEffect(() => {
    const refreshTimer = setInterval(() => {
      window.location.reload()
    }, 5 * 60 * 1000)
    return () => clearInterval(refreshTimer)
  }, [])

  // Filter data by selected plant
  const filteredMaterials = useMemo(() => {
    const mats = materials.filter((m) => m.name.toLowerCase() !== "agua")
    return selectedPlant === "all" ? mats : mats.filter((m) => m.plant_id === selectedPlant)
  }, [materials, selectedPlant])

  const filteredDispatches = useMemo(() => {
    return selectedPlant === "all"
      ? dispatches
      : dispatches.filter((d) => d.formulas?.plant_id === selectedPlant)
  }, [dispatches, selectedPlant])

  const filteredEntries = useMemo(() => {
    return selectedPlant === "all"
      ? recentEntries
      : recentEntries.filter((e) => e.materials?.plant_id === selectedPlant)
  }, [recentEntries, selectedPlant])

  // Calculate KPIs
  const kpis = useMemo(() => {
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    // Today's dispatches
    const todayDispatches = filteredDispatches.filter(
      (d) => new Date(d.dispatch_date) >= startOfToday
    )
    const m3Today = todayDispatches.reduce((sum, d) => sum + (d.quantity_m3 || 0), 0)
    const dispatchCountToday = todayDispatches.length

    // Selected period dispatches
    const periodDispatches = filteredDispatches.filter((d) => {
      const date = new Date(d.dispatch_date)
      return date >= dateRangeStart && date <= dateRangeEnd
    })
    const m3Period = periodDispatches.reduce((sum, d) => sum + (d.quantity_m3 || 0), 0)

    // Calculate days in selected period
    const daysInPeriod = Math.ceil((dateRangeEnd.getTime() - dateRangeStart.getTime()) / (1000 * 60 * 60 * 24)) + 1
    const dailyAverage = daysInPeriod > 0 ? m3Period / daysInPeriod : 0

    // Critical stock count
    const criticalStockCount = filteredMaterials.filter((m) => m.current_stock <= m.min_stock).length

    return {
      m3Today,
      dailyAverage,
      m3Period,
      dispatchCountToday,
      criticalStockCount,
      daysInPeriod,
    }
  }, [filteredDispatches, filteredMaterials, dateRangeStart, dateRangeEnd])

  // Stock alerts with days remaining
  const stockAlerts = useMemo(() => {
    const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    return filteredMaterials
      .filter((m) => m.current_stock <= m.min_stock)
      .map((m) => {
        // Calculate average daily consumption from dispatches
        const materialDispatches = filteredDispatches.filter(
          (d) => new Date(d.dispatch_date) >= last7Days
        )
        let totalConsumed = 0
        materialDispatches.forEach((d) => {
          d.dispatch_materials?.forEach((dm) => {
            if (dm.material_id === m.id) {
              totalConsumed += dm.quantity || 0
            }
          })
        })
        const avgDailyConsumption = totalConsumed / 7
        const daysRemaining = avgDailyConsumption > 0 ? m.current_stock / avgDailyConsumption : null

        const percentOfMin = m.min_stock > 0 ? (m.current_stock / m.min_stock) * 100 : 0

        return {
          ...m,
          percentOfMin,
          avgDailyConsumption,
          daysRemaining,
        }
      })
      .sort((a, b) => a.percentOfMin - b.percentOfMin)
  }, [filteredMaterials, filteredDispatches])

  // Dispatch evolution data
  const dispatchEvolution = useMemo(() => {
    const now = new Date()
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    // Group by date
    const byDate: Record<string, { date: string; m3: number; count: number }> = {}

    filteredDispatches
      .filter((d) => new Date(d.dispatch_date) >= last30Days)
      .forEach((d) => {
        // Extract date directly from string to avoid timezone issues
        // Format from DB: "2026-04-13 12:00:00+00" or "2026-04-13T12:00:00"
        const dateStr = String(d.dispatch_date).substring(0, 10) // Gets "2026-04-13"
        if (!byDate[dateStr]) {
          byDate[dateStr] = { date: dateStr, m3: 0, count: 0 }
        }
        byDate[dateStr].m3 += d.quantity_m3 || 0
        byDate[dateStr].count += 1
      })

    // Fill missing dates
    const result: Array<{ date: string; m3: number; count: number; movingAvg: number }> = []
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
      // Use local date to avoid timezone offset issues
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      const data = byDate[dateStr] || { date: dateStr, m3: 0, count: 0 }
      result.push({ ...data, movingAvg: 0 })
    }

    // Calculate 7-day moving average
    for (let i = 0; i < result.length; i++) {
      const start = Math.max(0, i - 6)
      const slice = result.slice(start, i + 1)
      const sum = slice.reduce((acc, d) => acc + d.m3, 0)
      result[i].movingAvg = sum / slice.length
    }

    return result
  }, [filteredDispatches])

  // Formula distribution
  const formulaDistribution = useMemo(() => {
  const byFormula: Record<string, { name: string; m3: number; count: number }> = {}
  
  filteredDispatches
  .filter((d) => {
    const date = new Date(d.dispatch_date)
    return date >= dateRangeStart && date <= dateRangeEnd
  })
      .forEach((d) => {
        const formulaName = d.formulas?.code || "Sin fórmula"
        if (!byFormula[formulaName]) {
          byFormula[formulaName] = { name: formulaName, m3: 0, count: 0 }
        }
        byFormula[formulaName].m3 += d.quantity_m3 || 0
        byFormula[formulaName].count += 1
      })

    const total = Object.values(byFormula).reduce((sum, f) => sum + f.m3, 0)

    return Object.values(byFormula)
      .map((f) => ({
        ...f,
        percentage: total > 0 ? (f.m3 / total) * 100 : 0,
      }))
      .sort((a, b) => b.m3 - a.m3)
  }, [filteredDispatches])

  // Top clients
  const topClients = useMemo(() => {
  const byClient: Record<string, { name: string; m3: number; count: number; obra: string }> = {}
  
  filteredDispatches
  .filter((d) => {
    const date = new Date(d.dispatch_date)
    return date >= dateRangeStart && date <= dateRangeEnd
  })
      .forEach((d) => {
        const clientName = d.clients?.name || d.client || "Sin cliente"
        if (!byClient[clientName]) {
          byClient[clientName] = { name: clientName, m3: 0, count: 0, obra: "" }
        }
        byClient[clientName].m3 += d.quantity_m3 || 0
        byClient[clientName].count += 1
        if (!byClient[clientName].obra && d.construction_sites?.name) {
          byClient[clientName].obra = d.construction_sites.name
        } else if (!byClient[clientName].obra && d.obra) {
          byClient[clientName].obra = d.obra
        }
      })

    return Object.values(byClient)
.sort((a, b) => b.m3 - a.m3)
  .slice(0, 8)
  }, [filteredDispatches, dateRangeStart, dateRangeEnd])

  // Quality panel data
  const qualityData = useMemo(() => {
    const now = new Date()
    const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

    // Filter cylinders for selected period
    const periodCylinders = testCylinders.filter((c) => {
      if (!c.actual_test_date) return false
      const date = new Date(c.actual_test_date)
      return date >= dateRangeStart && date <= dateRangeEnd
    })

    const tested = periodCylinders.filter((c) => c.strength_mpa !== null).length
    const passed = periodCylinders.filter((c) => c.strength_mpa && c.strength_mpa >= 21).length // Assuming 21 MPa as minimum
    const failed = tested - passed

    // Upcoming tests
    const upcoming = testCylinders.filter((c) => {
      if (c.actual_test_date) return false
      const scheduled = new Date(c.scheduled_test_date)
      return scheduled >= now && scheduled <= in3Days
    })

    return {
      tested,
      passed,
      failed,
      passRate: tested > 0 ? (passed / tested) * 100 : 0,
      failRate: tested > 0 ? (failed / tested) * 100 : 0,
      upcoming,
    }
  }, [testCylinders, dateRangeStart, dateRangeEnd])

  // Consumption real vs theoretical
  const consumptionAnalysis = useMemo(() => {
  const result: Array<{
      formulaCode: string
      formulaName: string
      theoreticalCement: number
      actualCement: number
      m3Produced: number
      deviation: number
    }> = []

    // Group dispatches by formula
    const byFormula: Record<string, { m3: number; cementUsed: number }> = {}

  filteredDispatches
  .filter((d) => {
    const date = new Date(d.dispatch_date)
    return date >= dateRangeStart && date <= dateRangeEnd
  })
      .forEach((d) => {
        if (!d.formula_id) return
        if (!byFormula[d.formula_id]) {
          byFormula[d.formula_id] = { m3: 0, cementUsed: 0 }
        }
        byFormula[d.formula_id].m3 += d.quantity_m3 || 0

        // Sum cement usage
        d.dispatch_materials?.forEach((dm) => {
          if (dm.materials?.name?.toLowerCase().includes("cemento")) {
            byFormula[d.formula_id].cementUsed += dm.quantity || 0
          }
        })
      })

    // Calculate deviation
    formulas.forEach((f) => {
      const usage = byFormula[f.id]
      if (!usage || usage.m3 === 0) return

      // Find cement in formula
      const cementMaterial = f.formula_materials?.find((fm) =>
        fm.materials?.name?.toLowerCase().includes("cemento")
      )
      if (!cementMaterial) return

      const theoreticalPerM3 = cementMaterial.quantity / (f.yield_m3 || 1)
      const actualPerM3 = usage.cementUsed / usage.m3
      const deviation = theoreticalPerM3 > 0 ? ((actualPerM3 - theoreticalPerM3) / theoreticalPerM3) * 100 : 0

      result.push({
        formulaCode: f.code,
        formulaName: f.name,
        theoreticalCement: theoreticalPerM3,
        actualCement: actualPerM3,
        m3Produced: usage.m3,
        deviation,
      })
    })

    return result.sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation))
  }, [filteredDispatches, formulas, dateRangeStart, dateRangeEnd])

  // Recent activity feed
  const recentActivity = useMemo(() => {
    const activities: Array<{
      type: "entry" | "dispatch" | "alert" | "test"
      description: string
      plant: string
      time: Date
      icon: any
      color: string
    }> = []

    // Add entries
    filteredEntries.slice(0, 5).forEach((e) => {
      activities.push({
        type: "entry",
        description: `Ingreso de ${e.quantity} ${e.materials?.unit} de ${e.materials?.name}`,
        plant: e.materials?.plants?.name || "",
        time: new Date(e.entry_date),
        icon: TrendingUp,
        color: "text-green-600",
      })
    })

    // Add dispatches
    filteredDispatches.slice(0, 5).forEach((d) => {
      activities.push({
        type: "dispatch",
        description: `Despacho de ${d.quantity_m3} m³ de ${d.formulas?.code} a ${d.client}`,
        plant: d.formulas?.plants?.name || "",
        time: new Date(d.dispatch_date),
        icon: Truck,
        color: "text-blue-600",
      })
    })

    // Sort by time and take top 10
    return activities.sort((a, b) => b.time.getTime() - a.time.getTime()).slice(0, 10)
  }, [filteredEntries, filteredDispatches])

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("es-AR", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    })
  }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
  }

  return (
    <div className="p-4 md:p-6 bg-muted/30 min-h-screen">
      <div className="max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 md:mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
            <p className="text-foreground/70 font-medium mt-1 text-xs md:text-sm">
              {new Date().toLocaleDateString("es-AR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full sm:w-[280px] justify-start bg-background">
                  <CalendarDays className="mr-2 h-4 w-4" />
                  {selectedMonths.length === 0 
                    ? "Seleccionar meses"
                    : selectedMonths.length === 1
                      ? availableMonths.find(m => m.value === selectedMonths[0])?.label
                      : `${selectedMonths.length} meses seleccionados`
                  }
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[280px] p-3" align="end">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-sm">Seleccionar meses</h4>
                    {selectedMonths.length > 0 && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => setSelectedMonths([`${currentYear}-${currentMonth}`])}
                        className="h-auto p-1 text-xs"
                      >
                        Solo mes actual
                      </Button>
                    )}
                  </div>
                  <div className="max-h-[300px] overflow-y-auto space-y-1">
                    {availableMonths.map((month) => (
                      <div key={month.value} className="flex items-center space-x-2 py-1">
                        <Checkbox
                          id={`month-${month.value}`}
                          checked={selectedMonths.includes(month.value)}
                          onCheckedChange={() => toggleMonth(month.value)}
                        />
                        <Label 
                          htmlFor={`month-${month.value}`} 
                          className="text-sm font-normal cursor-pointer flex-1"
                        >
                          {month.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            
            <Select value={selectedPlant} onValueChange={setSelectedPlant}>
              <SelectTrigger className="w-full sm:w-[220px] bg-background">
                <SelectValue placeholder="Seleccionar planta" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las plantas</SelectItem>
                {plants.map((plant) => (
                  <SelectItem key={plant.id} value={plant.id}>
                    {plant.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid gap-3 md:gap-4 grid-cols-2 lg:grid-cols-4 mb-4 md:mb-6">
          <Card className="bg-background shadow-sm">
            <CardContent className="p-4 md:pt-6">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs md:text-sm font-medium text-muted-foreground truncate">M3 Hoy</p>
                  <p className="text-2xl md:text-3xl font-bold tracking-tight mt-1">{kpis.m3Today.toFixed(1)}</p>
                  <div className="flex items-center gap-1 mt-1">
                    {kpis.m3Today >= kpis.dailyAverage ? (
                      <>
                        <TrendingUp className="h-3 w-3 text-green-600" />
                        <span className="text-xs text-green-600">vs prom. {kpis.dailyAverage.toFixed(1)}</span>
                      </>
                    ) : (
                      <>
                        <TrendingDown className="h-3 w-3 text-red-600" />
                        <span className="text-xs text-red-600">vs prom. {kpis.dailyAverage.toFixed(1)}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="hidden sm:flex h-10 w-10 md:h-12 md:w-12 items-center justify-center rounded-xl bg-primary/10">
                  <BarChart3 className="h-5 w-5 md:h-6 md:w-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-background shadow-sm">
            <CardContent className="p-4 md:pt-6">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs md:text-sm font-medium text-muted-foreground truncate">M3 Periodo</p>
                  <p className="text-2xl md:text-3xl font-bold tracking-tight mt-1">{kpis.m3Period.toFixed(0)}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {selectedMonths.length === 1 
                      ? availableMonths.find(m => m.value === selectedMonths[0])?.label
                      : `${kpis.daysInPeriod} dias`
                    }
                  </p>
                </div>
                <div className="hidden sm:flex h-10 w-10 md:h-12 md:w-12 items-center justify-center rounded-xl bg-green-600/10">
                  <TrendingUp className="h-5 w-5 md:h-6 md:w-6 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-background shadow-sm">
            <CardContent className="p-4 md:pt-6">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs md:text-sm font-medium text-muted-foreground truncate">Despachos</p>
                  <p className="text-2xl md:text-3xl font-bold tracking-tight mt-1">{kpis.dispatchCountToday}</p>
                  <p className="text-xs text-muted-foreground mt-1 hidden sm:block">viajes hoy</p>
                </div>
                <div className="hidden sm:flex h-10 w-10 md:h-12 md:w-12 items-center justify-center rounded-xl bg-blue-600/10">
                  <Truck className="h-5 w-5 md:h-6 md:w-6 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className={`bg-background shadow-sm ${kpis.criticalStockCount > 0 ? "ring-2 ring-red-500" : ""}`}>
            <CardContent className="p-4 md:pt-6">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs md:text-sm font-medium text-muted-foreground truncate">Stock Critico</p>
                  <p className={`text-2xl md:text-3xl font-bold tracking-tight mt-1 ${kpis.criticalStockCount > 0 ? "text-red-600" : "text-green-600"}`}>
                    {kpis.criticalStockCount}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 hidden sm:block">bajo minimo</p>
                </div>
                <div className={`hidden sm:flex h-10 w-10 md:h-12 md:w-12 items-center justify-center rounded-xl ${kpis.criticalStockCount > 0 ? "bg-red-600/10" : "bg-green-600/10"}`}>
                  <AlertTriangle className={`h-5 w-5 md:h-6 md:w-6 ${kpis.criticalStockCount > 0 ? "text-red-600" : "text-green-600"}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Calibration Alert */}
        {calibrationAlert.show && (
          <div className={`mb-4 md:mb-6 p-3 rounded-lg border flex items-center gap-3 ${
            calibrationAlert.type === "error" 
              ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200"
              : "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200"
          }`}>
            <Settings2 className="h-5 w-5 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-sm">Calibracion de Prensa</p>
              <p className="text-xs opacity-80">{calibrationAlert.message}</p>
            </div>
            <a href="/calidad?tab=roturas" className="text-xs font-medium underline hover:no-underline">
              Ir a Calidad
            </a>
          </div>
        )}

        {/* Stock Alerts & Dispatch Evolution */}
        <div className="grid gap-3 md:gap-4 lg:grid-cols-2 mb-4 md:mb-6">
          {/* Stock Alerts */}
          <Card className="bg-background shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                Alertas de Stock Critico
              </CardTitle>
              <CardDescription className="text-xs">Materiales por debajo del stock minimo</CardDescription>
            </CardHeader>
            <CardContent>
              {stockAlerts.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-center">
                  <div>
                    <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-2" />
                    <p className="font-medium text-green-600">Todo el stock en orden</p>
                    <p className="text-sm text-muted-foreground">No hay materiales bajo minimo</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 max-h-[350px] overflow-y-auto">
                  {stockAlerts.map((alert) => (
                    <div key={alert.id} className="p-3 rounded-lg border bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="font-medium text-sm">{alert.name}</p>
                          <p className="text-xs text-muted-foreground">{alert.plants?.name}</p>
                        </div>
                        <Badge variant="destructive" className="text-xs">
                          {alert.daysRemaining !== null ? `${alert.daysRemaining.toFixed(0)} dias` : "Sin datos"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs mb-2">
                        <span>Actual: <strong>{(alert.current_stock / 1000).toFixed(1)} tn</strong></span>
                        <span className="text-muted-foreground">|</span>
                        <span>Min: <strong>{(alert.min_stock / 1000).toFixed(1)} tn</strong></span>
                      </div>
                      <Progress value={alert.percentOfMin} className="h-2" />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Dispatch Evolution Chart */}
          <Card className="bg-background shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold">Evolucion de Despachos</CardTitle>
                  <CardDescription className="text-xs">M³ despachados ultimos 30 dias</CardDescription>
                </div>
                <Tabs value={dispatchView} onValueChange={(v) => setDispatchView(v as any)}>
                  <TabsList className="h-8">
                    <TabsTrigger value="day" className="text-xs px-2 h-6">Dia</TabsTrigger>
                    <TabsTrigger value="week" className="text-xs px-2 h-6">Semana</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={dispatchEvolution}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 10 }}
                          tickFormatter={(v) => {
                            // Parse date string directly to avoid timezone issues
                            // v is in format "2026-04-13"
                            const [year, month, day] = String(v).split("-")
                            return `${day}/${month}`
                          }}
                        />
                    <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip
                          labelFormatter={(v) => {
                            // Parse date string directly to avoid timezone issues
                            const [year, month, day] = String(v).split("-")
                            return `${day}/${month}/${year}`
                          }}
                          formatter={(value: number, name: string) => {
                            const label = name === "m3" ? "M3" : "Promedio Movil"
                            return [value.toFixed(1), label]
                          }}
                        />
                    <Bar dataKey="m3" fill="#2563eb" radius={[4, 4, 0, 0]} />
                    <Line type="monotone" dataKey="movingAvg" stroke="#dc2626" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Formula Distribution & Top Clients */}
        <div className="grid gap-4 lg:grid-cols-2 mb-6">
          {/* Formula Distribution */}
          <Card className="bg-background shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Distribucion por Formula</CardTitle>
              <CardDescription className="text-xs">Porcentaje de m³ por tipo de formula este mes</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div className="h-[250px] flex-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={formulaDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={2}
                        dataKey="m3"
                        nameKey="name"
                      >
                        {formulaDistribution.map((entry, index) => (
                          <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number, _name: string, props: { payload: { percentage: number; name: string } }) => {
                          return [`${value.toFixed(1)} m3 (${props.payload.percentage.toFixed(1)}%)`, props.payload.name]
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2 min-w-[140px]">
                  {formulaDistribution.slice(0, 5).map((f, i) => (
                    <div key={f.name} className="flex items-center gap-2 text-sm">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span className="truncate flex-1">{f.name}</span>
                      <span className="font-medium">{f.percentage.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Top Clients */}
          <Card className="bg-background shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Users className="h-4 w-4" />
                Top Clientes del Mes
              </CardTitle>
              <CardDescription className="text-xs">Principales clientes por m³ despachados</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {topClients.map((client, i) => (
                  <div key={client.name} className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{client.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{client.obra || "Sin obra especificada"}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-sm">{client.m3.toFixed(0)} m³</p>
                      <p className="text-xs text-muted-foreground">{client.count} viajes</p>
                    </div>
                  </div>
                ))}
                {topClients.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">Sin despachos este mes</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quality Panel & Consumption Analysis */}
        <div className="grid gap-4 lg:grid-cols-2 mb-6">
          {/* Quality Panel */}
          <Card className="bg-background shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <FlaskConical className="h-4 w-4" />
                Panel de Calidad
              </CardTitle>
              <CardDescription className="text-xs">Resumen de probetas del mes</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold">{qualityData.tested}</p>
                  <p className="text-xs text-muted-foreground">Ensayadas</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-green-50 dark:bg-green-950/20">
                  <p className="text-2xl font-bold text-green-600">{qualityData.passRate.toFixed(0)}%</p>
                  <p className="text-xs text-muted-foreground">Aprobadas</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-red-50 dark:bg-red-950/20">
                  <p className="text-2xl font-bold text-red-600">{qualityData.failRate.toFixed(0)}%</p>
                  <p className="text-xs text-muted-foreground">Rechazadas</p>
                </div>
              </div>

              {qualityData.upcoming.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2 flex items-center gap-2">
                    <Clock className="h-4 w-4 text-amber-600" />
                    Proximos ensayos (3 dias)
                  </p>
                  <div className="space-y-2 max-h-[150px] overflow-y-auto">
                    {qualityData.upcoming.map((c) => (
                      <div key={c.id} className="flex items-center justify-between text-sm p-2 rounded bg-amber-50 dark:bg-amber-950/20">
                        <span>{c.dispatches?.formulas?.code} - Prob. #{c.cylinder_number}</span>
                        <Badge variant="outline">{new Date(c.scheduled_test_date).toLocaleDateString("es-AR")}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Consumption Analysis */}
          <Card className="bg-background shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Beaker className="h-4 w-4" />
                Consumo Real vs Teorico
              </CardTitle>
              <CardDescription className="text-xs">Desviacion de cemento por formula este mes</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[280px] overflow-y-auto">
                {consumptionAnalysis.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">Sin datos de consumo</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Formula</TableHead>
                        <TableHead className="text-xs text-right">Teorico</TableHead>
                        <TableHead className="text-xs text-right">Real</TableHead>
                        <TableHead className="text-xs text-right">Desvio</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {consumptionAnalysis.map((row) => {
                        const absDeviation = Math.abs(row.deviation)
                        const bgColor = absDeviation > 5 ? "bg-red-50 dark:bg-red-950/20" : absDeviation > 3 ? "bg-amber-50 dark:bg-amber-950/20" : ""
                        return (
                          <TableRow key={row.formulaCode} className={bgColor}>
                            <TableCell className="font-medium text-xs">{row.formulaCode}</TableCell>
                            <TableCell className="text-right text-xs">{row.theoreticalCement.toFixed(0)} kg</TableCell>
                            <TableCell className="text-right text-xs">{row.actualCement.toFixed(0)} kg</TableCell>
                            <TableCell className="text-right text-xs">
                              <span className={absDeviation > 5 ? "text-red-600 font-bold" : absDeviation > 3 ? "text-amber-600 font-medium" : ""}>
                                {row.deviation > 0 ? "+" : ""}{row.deviation.toFixed(1)}%
                              </span>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent Activity */}
        <Card className="bg-background shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Actividad Reciente
            </CardTitle>
            <CardDescription className="text-xs">Ultimos movimientos del sistema</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[300px] overflow-y-auto">
              {recentActivity.map((activity, i) => {
                const Icon = activity.icon
                return (
                  <div key={i} className="flex items-start gap-3 pb-3 border-b last:border-0">
                    <div className={`p-2 rounded-lg bg-muted`}>
                      <Icon className={`h-4 w-4 ${activity.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">{activity.description}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">{activity.plant}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {activity.time.toLocaleString("es-AR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
