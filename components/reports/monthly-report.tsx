"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import { getSupabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FileDown, TrendingUp, TrendingDown, Minus, Calendar, ChevronLeft, ChevronRight } from "lucide-react"

import {
  calculateReportMetrics,
  getDowntimeDetails,
  getParetoDowntimes,
  calculateAverageMetrics,
  calculateRawMaterialConsumption,
  groupRawMaterialByWeek,
  calculatePipeMetrics,
  calculatePipeWeeklyRawMaterialConsumption,
  TARGETS,
  type ReportMetrics,
  type DowntimeDetail,
  type RawMaterialConsumption,
  type WeeklyRawMaterialConsumption,
  type PipeReportMetrics,
  type PipeRawMaterialConsumption,
  type PipeFormulaConfig,
  formatDateForDisplay,
} from "@/lib/report-utils"
import { useToast } from "@/hooks/use-toast"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Cell,
  LineChart,
  Line,
  ComposedChart,
  Tooltip,
  AreaChart,
  Area,
  CartesianGrid,
  ReferenceLine,
} from "recharts"
import { ExecutiveReport } from "./executive-report"


const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
]

interface MonthlyReportProps {
  lineType: "bloques" | "caños"
}

export function MonthlyReport({ lineType }: MonthlyReportProps) {
  const currentDate = new Date()
  const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth().toString())
  const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear().toString())
  const [records, setRecords] = useState<any[]>([])
  const [dailyMetrics, setDailyMetrics] = useState<ReportMetrics[]>([])
  const [averageMetrics, setAverageMetrics] = useState<ReportMetrics | null>(null)
  const [pipeMetrics, setPipeMetrics] = useState<PipeReportMetrics | null>(null)
  const [pipeWeights, setPipeWeights] = useState<Record<string, number>>({})
  const [pipeTargets, setPipeTargets] = useState<Record<string, number>>({})
  const [paretoDowntimes, setParetoDowntimes] = useState<DowntimeDetail[]>([])
  const [totalDowntime, setTotalDowntime] = useState(0)
  const [rawMaterialConsumption, setRawMaterialConsumption] = useState<RawMaterialConsumption | null>(null)
  const [weeklyConsumption, setWeeklyConsumption] = useState<WeeklyRawMaterialConsumption[]>([])
  const [pipeWeeklyConsumption, setPipeWeeklyConsumption] = useState<{ weekNumber: number; weekLabel: string; consumption: PipeRawMaterialConsumption }[]>([])
  const [loading, setLoading] = useState(false)
  const [prevRecords, setPrevRecords] = useState<any[]>([])
  const reportRef = useRef<HTMLDivElement>(null)
  const executiveReportRef = useRef<HTMLDivElement>(null)
  const visualReportRef = useRef<HTMLDivElement>(null) // Declare visualReportRef here
  const { toast } = useToast()

  const supabase = getSupabase()

  const monthStart = `${selectedYear}-${String(Number.parseInt(selectedMonth) + 1).padStart(2, "0")}-01`
  const monthEnd = (() => {
    const year = Number.parseInt(selectedYear)
    const month = Number.parseInt(selectedMonth)
    const lastDay = new Date(year, month + 1, 0).getDate()
    return `${selectedYear}-${String(month + 1).padStart(2, "0")}-${lastDay}`
  })()

  useEffect(() => {
    loadReport()
  }, [selectedMonth, selectedYear, lineType])

  async function loadReport() {
    setLoading(true)
    try {
      const tableName = lineType === "bloques" ? "block_production" : "pipe_production"
      const selectQuery = lineType === "caños" 
        ? `*, pipe_downtime (id, custom_reason, minutes, comments, downtime_category), pipe_mold_breakage (id, diameter, reasons, comments)`
        : `*, block_downtime (id, custom_reason, minutes, comments, downtime_category)`

      const { data, error } = await supabase
        .from(tableName)
        .select(selectQuery)
        .gte("production_date", monthStart)
        .lte("production_date", monthEnd)
        .order("production_date", { ascending: true })

      if (error) throw error

      setRecords(data || [])

      // Load previous month records for comparison
      const pmMonth = Number.parseInt(selectedMonth) === 0 ? 11 : Number.parseInt(selectedMonth) - 1
      const pmYear = Number.parseInt(selectedMonth) === 0 ? Number.parseInt(selectedYear) - 1 : Number.parseInt(selectedYear)
      const pmLastDay = new Date(pmYear, pmMonth + 1, 0).getDate()
      const pmStart = `${pmYear}-${String(pmMonth + 1).padStart(2, "0")}-01`
      const pmEnd = `${pmYear}-${String(pmMonth + 1).padStart(2, "0")}-${pmLastDay}`
      const { data: prevData } = await supabase
        .from(tableName)
        .select(selectQuery)
        .gte("production_date", pmStart)
        .lte("production_date", pmEnd)
        .order("production_date", { ascending: true })
      setPrevRecords(prevData || [])

      if (data && data.length > 0) {
        if (lineType === "caños") {
          // Cargar pesos y fórmulas de caños desde product_config
          const { data: pipeProducts } = await supabase
            .from("product_config")
            .select("product_code, piece_weight_kg, formula_cement_kg, formula_sand_kg, formula_stone_0_10_kg, formula_stone_0_20_kg")
            .eq("line_type", "caños")
            .eq("is_active", true)
          
          const weights: Record<string, number> = {
            "300": 95, "400": 150, "500": 220, "600": 310, "800": 520, "1000": 1080, "1200": 1100
          }
          const formulas: Record<string, { piece_weight_kg: number; formula_cement_kg: number; formula_sand_kg: number; formula_stone_0_10_kg: number; formula_stone_0_20_kg: number }> = {}
          
          if (pipeProducts) {
            pipeProducts.forEach((p: any) => {
              const match = p.product_code?.match(/CC(\d+)/)
              if (match) {
                if (p.piece_weight_kg) weights[match[1]] = p.piece_weight_kg
                formulas[match[1]] = {
                  piece_weight_kg: p.piece_weight_kg || 0,
                  formula_cement_kg: p.formula_cement_kg || 0,
                  formula_sand_kg: p.formula_sand_kg || 0,
                  formula_stone_0_10_kg: p.formula_stone_0_10_kg || 0,
                  formula_stone_0_20_kg: p.formula_stone_0_20_kg || 0,
                }
              }
            })
          }
          setPipeWeights(weights)

          // Cargar planificación mensual desde production_planning
          const { data: planningData } = await supabase
            .from("production_planning")
            .select("*")
            .eq("year", Number.parseInt(selectedYear))
            .eq("month", Number.parseInt(selectedMonth) + 1)
          
          const targets: Record<string, number> = {}
          if (planningData) {
            planningData.forEach((row: any) => {
              let total = 0
              for (let day = 1; day <= 31; day++) {
                total += row[`day_${day}`] || 0
              }
              if (total > 0) {
                targets[row.pipe_size] = total
              }
            })
          }
          setPipeTargets(targets)
          setPipeMetrics(calculatePipeMetrics(data, weights))
          // Calcular consumo de materia prima por semana para caños usando fórmulas de product_config
          const pipeWeeklyData = calculatePipeWeeklyRawMaterialConsumption(data, formulas)
          setPipeWeeklyConsumption(pipeWeeklyData)
          setAverageMetrics(null)
          setDailyMetrics([])
        } else {
          const metrics = data.map(calculateReportMetrics)
          setDailyMetrics(metrics)
          setAverageMetrics(calculateAverageMetrics(metrics))
          setPipeMetrics(null)

          const allDowntimes = getDowntimeDetails(data)
          setParetoDowntimes(getParetoDowntimes(allDowntimes))
          setTotalDowntime(allDowntimes.reduce((sum, dt) => sum + dt.minutes, 0))

          // Calcular consumo de materia prima
          const { totalConsumption } = calculateRawMaterialConsumption(data)
          setRawMaterialConsumption(totalConsumption)
          
          // Calcular consumo por semana
          const weeklyData = groupRawMaterialByWeek(data)
          setWeeklyConsumption(weeklyData)
        }
      } else {
        setDailyMetrics([])
        setAverageMetrics(null)
        setPipeMetrics(null)
        setParetoDowntimes([])
        setTotalDowntime(0)
        setRawMaterialConsumption(null)
        setWeeklyConsumption([])
      }
    } catch (error) {
      console.error("Error loading report:", error)
      toast({
        title: "Error",
        description: "No se pudo cargar el informe",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  async function exportToPDF() {
    if (!reportRef.current) return

    try {
      const { exportElementToPDF } = await import("@/lib/pdf-export")
      await exportElementToPDF(
        reportRef.current,
        `informe-mensual-${MONTHS[Number.parseInt(selectedMonth)]}-${selectedYear}.pdf`
      )

      toast({
        title: "PDF Generado",
        description: "El informe se ha exportado correctamente",
      })
    } catch (error) {
      console.error("Error exporting PDF:", error)
      toast({
        title: "Error",
        description: "No se pudo generar el PDF",
        variant: "destructive",
      })
    }
  }

  async function exportExecutivePDF() {
    if (!executiveReportRef.current) return

    try {
      const { exportElementToPDF } = await import("@/lib/pdf-export")
      await exportElementToPDF(
        executiveReportRef.current,
        `tablero-ejecutivo-${MONTHS[Number.parseInt(selectedMonth)]}-${selectedYear}.pdf`
      )

      toast({
        title: "PDF Generado",
        description: "El tablero ejecutivo se ha exportado correctamente",
      })
    } catch (error) {
      console.error("Error exporting PDF:", error)
      toast({
        title: "Error",
        description: "No se pudo generar el PDF",
        variant: "destructive",
      })
    }
  }

  async function exportVisualPDF() {
    if (!visualReportRef.current) return

    try {
      const { exportElementToPDF } = await import("@/lib/pdf-export")
      await exportElementToPDF(
        visualReportRef.current,
        `informe-visual-${MONTHS[Number.parseInt(selectedMonth)]}-${selectedYear}.pdf`
      )

      toast({
        title: "PDF Generado",
        description: "El informe visual se ha exportado correctamente",
      })
    } catch (error) {
      console.error("Error exporting PDF:", error)
      toast({
        title: "Error",
        description: "No se pudo generar el PDF",
        variant: "destructive",
      })
    }
  }

  function getStatusColor(value: number, target: number, higherIsBetter = true) {
    const diff = higherIsBetter ? value - target : target - value
    if (diff >= 0) return "text-emerald-600"
    if (diff > -5) return "text-amber-600"
    return "text-red-600"
  }

  function getStatusIcon(value: number, target: number, higherIsBetter = true) {
    const diff = higherIsBetter ? value - target : target - value
    if (diff >= 0) return <TrendingUp className="h-4 w-4 text-green-500" />
    if (diff > -5) return <Minus className="h-4 w-4 text-yellow-500" />
    return <TrendingDown className="h-4 w-4 text-red-500" />
  }

  const oeeLineData = dailyMetrics.map((m) => ({
    date: m.date.split("-")[2],
    OEE: m.oee,
    Objetivo: TARGETS.oee,
    Disponibilidad: m.availability,
    ObjetivoDisp: TARGETS.availability,
    Tablas: m.traysProduced,
    ObjetivoTablas: TARGETS.dailyTrays,
  }))

  // Calcular datos para diagrama de Pareto con porcentaje acumulado (bloques)
  let cumulativePercentage = 0
  const paretoChartData = paretoDowntimes.map((dt) => {
    const percentage = totalDowntime > 0 ? Number(((dt.minutes / totalDowntime) * 100).toFixed(1)) : 0
    cumulativePercentage += percentage
    return {
      reason: dt.reason.length > 18 ? dt.reason.substring(0, 15) + "..." : dt.reason,
      fullReason: dt.reason,
      minutes: dt.minutes,
      percentage,
      cumulative: Number(cumulativePercentage.toFixed(1)),
    }
  })

  const years = Array.from({ length: 5 }, (_, i) => (currentDate.getFullYear() - 2 + i).toString())

  const prevMonthIdx = Number.parseInt(selectedMonth) === 0 ? 11 : Number.parseInt(selectedMonth) - 1
  const prevMonthLabel = MONTHS[prevMonthIdx]

  // Calculate previous month averages for comparison in the averages table
  const prevAvgMetrics = useMemo(() => {
    if (!prevRecords || prevRecords.length === 0 || lineType !== "bloques") return null
    const metrics = prevRecords.map(calculateReportMetrics)
    return calculateAverageMetrics(metrics)
  }, [prevRecords, lineType])

  const prevDailyCount = lineType === "bloques" ? prevRecords.filter(r => r).length : 0

  function goToPrevMonth() {
    const m = Number.parseInt(selectedMonth)
    if (m === 0) {
      setSelectedMonth("11")
      setSelectedYear(String(Number.parseInt(selectedYear) - 1))
    } else {
      setSelectedMonth(String(m - 1))
    }
  }

  function goToNextMonth() {
    const m = Number.parseInt(selectedMonth)
    const y = Number.parseInt(selectedYear)
    if (m === currentDate.getMonth() && y === currentDate.getFullYear()) return
    if (m === 11) {
      setSelectedMonth("0")
      setSelectedYear(String(y + 1))
    } else {
      setSelectedMonth(String(m + 1))
    }
  }

  const isCurrentMonth = Number.parseInt(selectedMonth) === currentDate.getMonth() && Number.parseInt(selectedYear) === currentDate.getFullYear()
  const hasData = lineType === "caños" ? !!pipeMetrics : !!averageMetrics

  return (
    <div className="space-y-6">
      {/* Dashboard-style header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">Informe Mensual</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {lineType === "bloques" ? "Linea de Bloques" : "Linea de Canos"} - {MONTHS[Number.parseInt(selectedMonth)]} {selectedYear}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Month selector */}
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            <button onClick={goToPrevMonth} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-card transition-all" aria-label="Mes anterior">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1.5 px-2 min-w-[140px] justify-center">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
              <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="bg-transparent text-xs font-medium text-foreground cursor-pointer focus:outline-none appearance-none">
                {MONTHS.map((name, idx) => <option key={idx} value={idx.toString()}>{name}</option>)}
              </select>
              <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} className="bg-transparent text-xs font-medium text-foreground cursor-pointer focus:outline-none appearance-none">
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <button onClick={goToNextMonth} disabled={isCurrentMonth} className={`p-1.5 rounded-md transition-all ${isCurrentMonth ? 'text-muted-foreground/30 cursor-not-allowed' : 'text-muted-foreground hover:text-foreground hover:bg-card'}`} aria-label="Mes siguiente">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>


        </div>
      </header>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground text-sm">Cargando informe...</div>
        </div>
      ) : !hasData ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground text-sm">No hay datos de produccion para el mes seleccionado</div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* PDF export buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={exportToPDF} disabled={!hasData} variant="outline" size="sm" className="gap-2 bg-card border-border text-foreground hover:bg-muted">
              <FileDown className="h-3.5 w-3.5" />
              PDF Informe
            </Button>
            <Button onClick={exportExecutivePDF} disabled={!hasData} variant="outline" size="sm" className="gap-2 bg-card border-border text-foreground hover:bg-muted">
              <FileDown className="h-3.5 w-3.5" />
              PDF Ejecutivo
            </Button>
            <Button onClick={exportVisualPDF} disabled={!hasData} variant="outline" size="sm" className="gap-2 bg-card border-border text-foreground hover:bg-muted">
              <FileDown className="h-3.5 w-3.5" />
              PDF Visual
            </Button>
          </div>

          {lineType === "caños" && pipeMetrics ? (
        <div ref={reportRef} className="bg-white text-[11px]" style={{ width: '210mm' }}>
          {/* ============ PÁGINA 1 ============ */}
          <div style={{ minHeight: '297mm', padding: '8mm', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
            {/* Encabezado */}
            <div style={{ textAlign: 'center', borderBottom: '3px solid #1e3a5f', paddingBottom: '16px', marginBottom: '20px' }}>
              <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1e3a5f', margin: 0 }}>SILKE S.A.</h1>
              <h2 style={{ fontSize: '18px', fontWeight: '600', color: '#374151', margin: '6px 0' }}>{"Informe Mensual de Producción - Línea de Caños"}</h2>
              <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>{MONTHS[Number.parseInt(selectedMonth)]} {selectedYear}</p>
            </div>

            {/* Indicadores OEE */}
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 'bold', color: '#1e3a5f', marginBottom: '12px', borderBottom: '2px solid #e5e7eb', paddingBottom: '6px' }}>{"Indicadores de Eficiencia (OEE)"}</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td style={{ width: '25%', padding: '16px 12px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                      <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '500', marginBottom: '4px' }}>Disponibilidad</div>
                      <div style={{ fontSize: '32px', fontWeight: 'bold', color: pipeMetrics.availability >= 95 ? '#16a34a' : pipeMetrics.availability >= 85 ? '#ca8a04' : '#dc2626' }}>
                        {pipeMetrics.availability}%
                      </div>
                    </td>
                    <td style={{ width: '25%', padding: '16px 12px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                      <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '500', marginBottom: '4px' }}>Rendimiento</div>
                      <div style={{ fontSize: '32px', fontWeight: 'bold', color: pipeMetrics.performance >= 75 ? '#16a34a' : '#ca8a04' }}>
                        {pipeMetrics.performance}%
                      </div>
                    </td>
                    <td style={{ width: '25%', padding: '16px 12px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                      <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '500', marginBottom: '4px' }}>Calidad</div>
                      <div style={{ fontSize: '32px', fontWeight: 'bold', color: pipeMetrics.quality >= 98 ? '#16a34a' : '#ca8a04' }}>
                        {pipeMetrics.quality}%
                      </div>
                    </td>
                    <td style={{ width: '25%', padding: '16px 12px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                      <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '500', marginBottom: '4px' }}>OEE</div>
                      <div style={{ fontSize: '32px', fontWeight: 'bold', color: pipeMetrics.oee >= 70 ? '#16a34a' : '#ca8a04' }}>
                        {pipeMetrics.oee}%
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Resumen de producción */}
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 'bold', color: '#1e3a5f', marginBottom: '12px', borderBottom: '2px solid #e5e7eb', paddingBottom: '6px' }}>{"Resumen de Producción"}</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td style={{ width: '20%', padding: '14px 10px', backgroundColor: '#f3f4f6', border: '1px solid #d1d5db', textAlign: 'center' }}>
                      <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>{"Caños Producidos"}</div>
                      <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827' }}>{pipeMetrics.totalUnits}</div>
                    </td>
                    <td style={{ width: '20%', padding: '14px 10px', backgroundColor: '#f3f4f6', border: '1px solid #d1d5db', textAlign: 'center' }}>
                      <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>Toneladas</div>
                      <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827' }}>{pipeMetrics.totalWeightTn} Tn</div>
                    </td>
                    <td style={{ width: '20%', padding: '14px 10px', backgroundColor: '#f3f4f6', border: '1px solid #d1d5db', textAlign: 'center' }}>
                      <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>TN/Hora</div>
                      <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#2563eb' }}>{pipeMetrics.tnPerHour}</div>
                    </td>
                    <td style={{ width: '20%', padding: '14px 10px', backgroundColor: '#f3f4f6', border: '1px solid #d1d5db', textAlign: 'center' }}>
                      <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>TN/Hora/Operario</div>
                      <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#2563eb' }}>{pipeMetrics.tnPerHourPerOperator}</div>
                    </td>
                    <td style={{ width: '20%', padding: '14px 10px', backgroundColor: '#f3f4f6', border: '1px solid #d1d5db', textAlign: 'center' }}>
                      <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>Operarios Prom.</div>
                      <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#111827' }}>{pipeMetrics.operators}</div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Producción por tipo de caño */}
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 'bold', color: '#1e3a5f', marginBottom: '12px', borderBottom: '2px solid #e5e7eb', paddingBottom: '6px' }}>{"Producción por Tipo de Caño vs Planificación Mensual"}</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #d1d5db' }}>
                <thead>
                  <tr style={{ backgroundColor: '#1e3a5f' }}>
                    <th style={{ padding: '10px', color: 'white', textAlign: 'left', fontSize: '12px' }}>Tipo</th>
                    <th style={{ padding: '10px', color: 'white', textAlign: 'center', fontSize: '12px' }}>Producido</th>
                    <th style={{ padding: '10px', color: 'white', textAlign: 'center', fontSize: '12px' }}>Planif.</th>
                    <th style={{ padding: '10px', color: 'white', textAlign: 'center', fontSize: '12px' }}>Cumpl.</th>
                    <th style={{ padding: '10px', color: 'white', textAlign: 'center', fontSize: '12px' }}>Peso (Tn)</th>
                  </tr>
                </thead>
                <tbody>
                  {pipeMetrics.productionByType.map((p, idx) => {
                    const target = pipeTargets[p.size] || 0
                    const compliance = target > 0 ? (p.quantity / target) * 100 : 0
                    return (
                      <tr key={p.size} style={{ backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid #e5e7eb', fontWeight: '600', fontSize: '12px' }}>CC{p.size}</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid #e5e7eb', textAlign: 'center', fontSize: '12px' }}>{p.quantity}</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid #e5e7eb', textAlign: 'center', color: '#6b7280', fontSize: '12px' }}>{target || '-'}</td>
                        <td style={{
                          padding: '8px 10px',
                          borderBottom: '1px solid #e5e7eb',
                          textAlign: 'center',
                          fontWeight: 'bold',
                          fontSize: '12px',
                          color: target > 0 ? (compliance >= 100 ? '#16a34a' : compliance >= 80 ? '#ca8a04' : '#dc2626') : '#6b7280'
                        }}>
                          {target > 0 ? `${compliance.toFixed(0)}%` : '-'}
                        </td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid #e5e7eb', textAlign: 'center', fontSize: '12px' }}>{p.weightTn.toFixed(2)}</td>
                      </tr>
                    )
                  })}
                  <tr style={{ backgroundColor: '#1e3a5f', color: 'white', fontWeight: 'bold' }}>
                    <td style={{ padding: '10px', fontSize: '12px' }}>TOTAL</td>
                    <td style={{ padding: '10px', textAlign: 'center', fontSize: '12px' }}>{pipeMetrics.totalUnits}</td>
                    <td style={{ padding: '10px', textAlign: 'center', fontSize: '12px' }}>{Object.values(pipeTargets).reduce((a, b) => a + b, 0) || '-'}</td>
                    <td style={{ padding: '10px', textAlign: 'center', fontSize: '12px' }}>
                      {Object.values(pipeTargets).reduce((a, b) => a + b, 0) > 0
                        ? `${((pipeMetrics.totalUnits / Object.values(pipeTargets).reduce((a, b) => a + b, 0)) * 100).toFixed(0)}%`
                        : '-'}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'center', fontSize: '12px' }}>{pipeMetrics.totalWeightTn}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Consumo de Materia Prima por Semana */}
            {pipeWeeklyConsumption.length > 0 && (
              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 'bold', color: '#1e3a5f', marginBottom: '12px', borderBottom: '2px solid #e5e7eb', paddingBottom: '6px' }}>{"Consumo de Materia Prima por Semana (Tn)"}</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #d1d5db' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#1e3a5f' }}>
                      <th style={{ padding: '10px 8px', color: 'white', textAlign: 'left', fontSize: '11px' }}>Semana</th>
                      <th style={{ padding: '10px 8px', color: 'white', textAlign: 'center', fontSize: '11px' }}>Cemento</th>
                      <th style={{ padding: '10px 8px', color: 'white', textAlign: 'center', fontSize: '11px' }}>Piedra 0-10</th>
                      <th style={{ padding: '10px 8px', color: 'white', textAlign: 'center', fontSize: '11px' }}>Arena</th>
                      <th style={{ padding: '10px 8px', color: 'white', textAlign: 'center', fontSize: '11px' }}>Piedra 0-20</th>
                      <th style={{ padding: '10px 8px', color: 'white', textAlign: 'center', fontSize: '11px' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pipeWeeklyConsumption.map((week, idx) => (
                      <tr key={week.weekNumber} style={{ backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                        <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb', fontSize: '11px' }}>{week.weekLabel}</td>
                        <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb', textAlign: 'center', fontSize: '11px' }}>{(week.consumption.cement_kg / 1000).toFixed(2)}</td>
                        <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb', textAlign: 'center', fontSize: '11px' }}>{(week.consumption.stone_0_10_kg / 1000).toFixed(2)}</td>
                        <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb', textAlign: 'center', fontSize: '11px' }}>{(week.consumption.sand_kg / 1000).toFixed(2)}</td>
                        <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb', textAlign: 'center', fontSize: '11px' }}>{(week.consumption.stone_0_20_kg / 1000).toFixed(2)}</td>
                        <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb', textAlign: 'center', fontSize: '11px', fontWeight: 'bold' }}>{(week.consumption.total_kg / 1000).toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr style={{ backgroundColor: '#1e3a5f', color: 'white', fontWeight: 'bold' }}>
                      <td style={{ padding: '10px 8px', fontSize: '11px' }}>TOTAL</td>
                      <td style={{ padding: '10px 8px', textAlign: 'center', fontSize: '11px' }}>{(pipeWeeklyConsumption.reduce((sum, w) => sum + w.consumption.cement_kg, 0) / 1000).toFixed(2)}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'center', fontSize: '11px' }}>{(pipeWeeklyConsumption.reduce((sum, w) => sum + w.consumption.stone_0_10_kg, 0) / 1000).toFixed(2)}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'center', fontSize: '11px' }}>{(pipeWeeklyConsumption.reduce((sum, w) => sum + w.consumption.sand_kg, 0) / 1000).toFixed(2)}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'center', fontSize: '11px' }}>{(pipeWeeklyConsumption.reduce((sum, w) => sum + w.consumption.stone_0_20_kg, 0) / 1000).toFixed(2)}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'center', fontSize: '11px' }}>{(pipeWeeklyConsumption.reduce((sum, w) => sum + w.consumption.total_kg, 0) / 1000).toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* Tiempo de producción */}
            <div style={{ marginBottom: '16px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 'bold', color: '#1e3a5f', marginBottom: '8px', borderBottom: '1px solid #e5e7eb', paddingBottom: '4px' }}>{"Tiempo de Producción"}</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td style={{ width: '33%', padding: '20px 16px', backgroundColor: '#f0f9ff', border: '1px solid #bae6fd', textAlign: 'center' }}>
                      <div style={{ fontSize: '12px', color: '#0369a1', marginBottom: '4px' }}>Tiempo Disponible</div>
                      <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#0369a1' }}>{(pipeMetrics.availableMinutes / 60).toFixed(1)} hrs</div>
                    </td>
                    <td style={{ width: '33%', padding: '20px 16px', backgroundColor: '#fff7ed', border: '1px solid #fed7aa', textAlign: 'center' }}>
                      <div style={{ fontSize: '12px', color: '#c2410c', marginBottom: '4px' }}>Paradas Totales</div>
                      <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#c2410c' }}>{(pipeMetrics.totalDowntimeMinutes / 60).toFixed(1)} hrs</div>
                    </td>
                    <td style={{ width: '33%', padding: '20px 16px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', textAlign: 'center' }}>
                      <div style={{ fontSize: '12px', color: '#16a34a', marginBottom: '4px' }}>Tiempo Efectivo</div>
                      <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#16a34a' }}>
                        {((pipeMetrics.availableMinutes - (pipeMetrics.totalDowntimeMinutes - pipeMetrics.externalDowntimeMinutes)) / 60).toFixed(1)} hrs
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Pie de página 1 */}
            <div style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '2px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#9ca3af' }}>
              <span>{"SILKE S.A. - Sistema de Gestión de Producción"}</span>
              <span>{"Página 1 de 2"}</span>
            </div>
          </div>

          {/* ============ PÁGINA 2 ============ */}
          <div style={{ minHeight: '297mm', padding: '9mm', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', pageBreakBefore: 'always' }}>
            {/* Encabezado página 2 */}
            <div style={{ textAlign: 'center', borderBottom: '2px solid #1e3a5f', paddingBottom: '12px', marginBottom: '18px' }}>
              <h1 style={{ fontSize: '18px', fontWeight: 'bold', color: '#1e3a5f', margin: 0 }}>{"Análisis de Paradas y Roturas"}</h1>
              <p style={{ fontSize: '13px', color: '#6b7280', margin: '4px 0 0 0' }}>{MONTHS[Number.parseInt(selectedMonth)]} {selectedYear}</p>
            </div>

            {/* Análisis de paradas - Top 4 motivos */}
            <div style={{ marginBottom: '24px', flex: '1' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 'bold', color: '#1e3a5f', marginBottom: '12px', borderBottom: '1px solid #e5e7eb', paddingBottom: '6px' }}>
                {"Top 4 Causas de Parada - Total: "}{pipeMetrics.totalDowntimeMinutes}{" min ("}{(pipeMetrics.totalDowntimeMinutes / 60).toFixed(1)}{" hrs)"}
                {pipeMetrics.externalDowntimeMinutes > 0 && (
                  <span style={{ color: '#ea580c', fontWeight: 'normal', marginLeft: '8px', fontSize: '11px' }}>
                    {"(Factores externos: "}{pipeMetrics.externalDowntimeMinutes}{" min)"}
                  </span>
                )}
              </h3>

              {(() => {
                const sortedDowntimes = [...pipeMetrics.downtimes].sort((a, b) => b.minutes - a.minutes).slice(0, 4)
                let cumPct = 0
                return sortedDowntimes.map((dt: any, idx: number) => {
                  const pct = pipeMetrics.totalDowntimeMinutes > 0 ? Number(((dt.minutes / pipeMetrics.totalDowntimeMinutes) * 100).toFixed(1)) : 0
                  cumPct += pct
                  return (
                    <div key={idx} style={{ marginBottom: '12px', padding: '10px', backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: '#1e3a5f' }}>{dt.reason}</span>
                        <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                          <span style={{ fontSize: '12px', fontWeight: '700', color: '#dc2626' }}>{dt.minutes} min</span>
                          <span style={{ fontSize: '11px', color: '#6b7280' }}>({pct}%)</span>
                          <span style={{ fontSize: '11px', color: '#2563eb', fontWeight: '500' }}>{"Acum: "}{cumPct.toFixed(1)}%</span>
                        </div>
                      </div>
                      {dt.details && dt.details.length > 0 && (
                        <ul style={{ margin: '0', paddingLeft: '18px', listStyleType: 'disc' }}>
                          {dt.details.map((detail: { description: string; minutes: number }, detailIdx: number) => (
                            <li key={detailIdx} style={{ fontSize: '10px', color: '#4b5563', marginBottom: '2px', lineHeight: '1.3' }}>
                              {detail.description} <span style={{ color: '#dc2626', fontWeight: '600' }}>({detail.minutes} min)</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )
                })
              })()}
            </div>

            {/* Análisis de roturas */}
            {(pipeMetrics.breakagesByMold.length > 0 || pipeMetrics.breakagesByType.length > 0) && (
              <div style={{ marginBottom: '16px' }}>
                <h3 style={{ fontSize: '13px', fontWeight: 'bold', color: '#dc2626', marginBottom: '10px', borderBottom: '1px solid #fecaca', paddingBottom: '6px' }}>
                  Analisis de Roturas de Molde - Total: {pipeMetrics.moldBreakages.length} roturas
                </h3>

                {/* Tabla cruzada: Tipo de Rotura por Molde */}
                {pipeMetrics.moldBreakages.length > 0 && (
                  <div style={{ marginBottom: '12px' }}>
                    <h4 style={{ fontSize: '11px', fontWeight: '600', marginBottom: '8px', color: '#374151' }}>Tipo de Rotura por Molde</h4>
                    <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #fecaca' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#fef2f2' }}>
                          <th style={{ padding: '7px 6px', textAlign: 'left', fontSize: '10px', color: '#991b1b', borderRight: '1px solid #fecaca' }}>Tipo de Rotura</th>
                          {pipeMetrics.breakagesByMold.map(m => (
                            <th key={m.diameter} style={{ padding: '7px 6px', textAlign: 'center', fontSize: '10px', color: '#991b1b', minWidth: '45px' }}>CC{m.diameter}</th>
                          ))}
                          <th style={{ padding: '7px 6px', textAlign: 'center', fontSize: '10px', color: '#991b1b', fontWeight: 'bold', borderLeft: '2px solid #dc2626' }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pipeMetrics.breakagesByType.map((type, idx) => {
                          const rowTotal = pipeMetrics.breakagesByMold.reduce((sum, mold) => {
                            const count = pipeMetrics.moldBreakages.filter(
                              b => b.reasons?.includes(type.reason) && b.diameter === mold.diameter
                            ).length
                            return sum + count
                          }, 0)
                          return (
                            <tr key={type.reason} style={{ backgroundColor: idx % 2 === 0 ? '#ffffff' : '#fef2f2' }}>
                              <td style={{ padding: '6px', borderBottom: '1px solid #fecaca', fontSize: '10px', borderRight: '1px solid #fecaca' }}>{type.reason}</td>
                              {pipeMetrics.breakagesByMold.map(mold => {
                                const count = pipeMetrics.moldBreakages.filter(
                                  b => b.reasons?.includes(type.reason) && b.diameter === mold.diameter
                                ).length
                                return (
                                  <td key={mold.diameter} style={{ padding: '6px', borderBottom: '1px solid #fecaca', textAlign: 'center', fontSize: '10px', fontWeight: count > 0 ? 'bold' : 'normal', color: count > 0 ? '#dc2626' : '#9ca3af' }}>
                                    {count > 0 ? count : '-'}
                                  </td>
                                )
                              })}
                              <td style={{ padding: '6px', borderBottom: '1px solid #fecaca', textAlign: 'center', fontSize: '10px', fontWeight: 'bold', color: '#dc2626', borderLeft: '2px solid #dc2626' }}>{rowTotal}</td>
                            </tr>
                          )
                        })}
                        {/* Fila de totales */}
                        <tr style={{ backgroundColor: '#fef2f2', fontWeight: 'bold' }}>
                          <td style={{ padding: '7px 6px', borderTop: '2px solid #dc2626', fontSize: '10px', color: '#991b1b', borderRight: '1px solid #fecaca' }}>Total</td>
                          {pipeMetrics.breakagesByMold.map(mold => (
                            <td key={mold.diameter} style={{ padding: '7px 6px', borderTop: '2px solid #dc2626', textAlign: 'center', fontSize: '10px', color: '#dc2626' }}>{mold.count}</td>
                          ))}
                          <td style={{ padding: '7px 6px', borderTop: '2px solid #dc2626', textAlign: 'center', fontSize: '10px', color: '#991b1b', borderLeft: '2px solid #dc2626' }}>{pipeMetrics.moldBreakages.length}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Pie de página 2 */}
            <div style={{ marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#9ca3af' }}>
              <span>{"SILKE S.A. - Sistema de Gestión de Producción"}</span>
              <span>{"Página 2 de 2"}</span>
            </div>
          </div>
        </div>
      ) : (
        <div ref={reportRef} className="bg-white p-6 max-w-4xl mx-auto text-[13px]">
          {/* Encabezado del Informe */}
          <header className="mb-6 pb-4">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <td style={{ verticalAlign: 'top' }}>
                    <h1 className="text-2xl font-bold text-gray-900">Informe Mensual</h1>
                  </td>
                  <td style={{ verticalAlign: 'top', textAlign: 'right' }}>
                    <div className="text-xl font-semibold text-gray-900">{MONTHS[Number.parseInt(selectedMonth)]}</div>
                    <div className="text-sm text-gray-500">{selectedYear}</div>
                  </td>
                </tr>
                <tr>
                  <td colSpan={2} style={{ paddingTop: '8px' }}>
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1.5 bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium">
                        <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                        {dailyMetrics.length} días producidos
                      </span>
                      <span className="text-sm text-gray-500">SILKE S.A.</span>
                      <span className="text-sm text-gray-400">|</span>
                      <span className="text-sm text-gray-500">Producción de Bloques</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </header>

          {/* Promedios del Mes - Tabla estilo informe semanal */}
          <section className="mb-6">
            <h2 className="text-base font-semibold text-gray-900 mb-3">Promedios del Mes</h2>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="border-b">
                    <th className="text-left py-2.5 px-4 font-medium text-gray-700">Indicador</th>
                    <th className="text-center py-2.5 px-4 font-medium text-gray-700">Promedio</th>
                    <th className="text-center py-2.5 px-4 font-medium text-gray-700">Objetivo</th>
                    <th className="text-center py-2.5 px-4 font-medium text-gray-700">vs {prevMonthLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "Racks/Hora", current: averageMetrics.racksPerHour, target: TARGETS.racksPerHour, prev: prevAvgMetrics?.racksPerHour, unit: "", decimals: 2 },
                    { label: "Bandejas Diarias", current: Math.round(averageMetrics.traysProduced / dailyMetrics.length), target: TARGETS.dailyTrays, prev: prevAvgMetrics && prevDailyCount > 0 ? Math.round(prevAvgMetrics.traysProduced / prevDailyCount) : null, unit: "", decimals: 0 },
                    { label: "Disponibilidad", current: averageMetrics.availability, target: TARGETS.availability, prev: prevAvgMetrics?.availability, unit: "%", decimals: 1 },
                    { label: "Rendimiento", current: averageMetrics.performance, target: TARGETS.performance, prev: prevAvgMetrics?.performance, unit: "%", decimals: 1 },
                    { label: "Calidad", current: averageMetrics.quality, target: TARGETS.quality, prev: prevAvgMetrics?.quality, unit: "%", decimals: 1 },
                  ].map((row, idx) => {
                    const diff = row.prev != null && row.prev > 0 ? ((row.current - row.prev) / row.prev * 100) : null
                    return (
                      <tr key={idx} className="border-b">
                        <td className="py-2.5 px-4 font-medium text-gray-900">{row.label}</td>
                        <td className={`text-center py-2.5 px-4 font-semibold ${getStatusColor(row.current, row.target)}`}>
                          {row.decimals === 0 ? row.current : Number(row.current).toFixed(row.decimals)}{row.unit}
                        </td>
                        <td className="text-center py-2.5 px-4 text-gray-500">{row.target}{row.unit}</td>
                        <td className="text-center py-2.5 px-4">
                          {diff !== null ? (
                            <span className={`text-xs font-semibold ${diff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {diff >= 0 ? '+' : ''}{diff.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  <tr className="bg-gray-100">
                    <td className="py-2.5 px-4 font-bold text-gray-900">OEE</td>
                    <td className={`text-center py-2.5 px-4 font-bold ${getStatusColor(averageMetrics.oee, TARGETS.oee)}`}>
                      {averageMetrics.oee}%
                    </td>
                    <td className="text-center py-2.5 px-4 text-gray-600 font-semibold">{TARGETS.oee}%</td>
                    <td className="text-center py-2.5 px-4">
                      {prevAvgMetrics && prevAvgMetrics.oee > 0 ? (
                        <span className={`text-xs font-bold ${((averageMetrics.oee - prevAvgMetrics.oee) / prevAvgMetrics.oee * 100) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {((averageMetrics.oee - prevAvgMetrics.oee) / prevAvgMetrics.oee * 100) >= 0 ? '+' : ''}{((averageMetrics.oee - prevAvgMetrics.oee) / prevAvgMetrics.oee * 100).toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Tendencia Diaria */}
          {oeeLineData.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Tendencia Diaria - Bandejas</h2>
              <div className="h-48 border rounded-lg p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={oeeLineData}>
                    <defs>
                      <linearGradient id="pdfTrendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#1e3a5f" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#1e3a5f" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#6b7280' }} axisLine={{ stroke: '#d1d5db' }} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: '#6b7280' }} axisLine={{ stroke: '#d1d5db' }} tickLine={false} />
                    <Tooltip content={({ active, payload }) => {
                      if (!active || !payload || !payload[0]) return null
                      const d = payload[0].payload
                      return (
                        <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-2 text-[11px]">
                          <div className="font-semibold text-gray-900 mb-1">Dia {d.date}</div>
                          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                            <span className="text-gray-500">Bandejas:</span><span className="font-semibold">{d.Tablas}</span>
                            <span className="text-gray-500">OEE:</span><span className="font-semibold">{d.OEE}%</span>
                            <span className="text-gray-500">Disp.:</span><span className="font-semibold">{d.Disponibilidad}%</span>
                          </div>
                        </div>
                      )
                    }} />
                    <Area type="monotone" dataKey="Tablas" stroke="#1e3a5f" strokeWidth={2} fill="url(#pdfTrendFill)" dot={{ r: 2, fill: '#1e3a5f' }} name="Bandejas" />
                    <ReferenceLine y={TARGETS.dailyTrays} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: `Obj: ${TARGETS.dailyTrays}`, position: 'right', fontSize: 9, fill: '#94a3b8' }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* Consumo de Materia Prima */}
          {rawMaterialConsumption && rawMaterialConsumption.total_kg > 0 && (
            <section className="mb-8">
              <h2 className="text-sm font-semibold text-gray-900 mb-3 border-b border-gray-200 pb-2">Consumo de Materia Prima (Tn)</h2>
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left py-2 px-3 font-medium text-gray-600 border border-gray-200">Periodo</th>
                    <th className="text-center py-2 px-3 font-medium text-gray-600 border border-gray-200">Dias</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-600 border border-gray-200">Cemento</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-600 border border-gray-200">Arena</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-600 border border-gray-200">Piedra</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-600 border border-gray-200">Agua</th>
                    <th className="text-right py-2 px-3 font-semibold text-gray-900 border border-gray-200">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyConsumption.map((week) => (
                    <tr key={week.weekNumber} className="border-b border-gray-100">
                      <td className="py-2 px-3 font-medium text-gray-900 border border-gray-200">Semana {week.weekNumber}</td>
                      <td className="text-center py-2 px-3 text-gray-500 border border-gray-200">{week.daysCount}</td>
                      <td className="text-right py-2 px-3 text-gray-700 border border-gray-200">{(week.consumption.cement_kg / 1000).toFixed(1)}</td>
                      <td className="text-right py-2 px-3 text-gray-700 border border-gray-200">{(week.consumption.sand_kg / 1000).toFixed(1)}</td>
                      <td className="text-right py-2 px-3 text-gray-700 border border-gray-200">{(week.consumption.stone_0_10_kg / 1000).toFixed(1)}</td>
                      <td className="text-right py-2 px-3 text-gray-700 border border-gray-200">{(week.consumption.water_kg / 1000).toFixed(1)}</td>
                      <td className="text-right py-2 px-3 font-semibold text-gray-900 border border-gray-200">{(week.consumption.total_kg / 1000).toFixed(1)}</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 font-semibold">
                    <td className="py-2.5 px-3 text-gray-900 border border-gray-200" colSpan={2}>Total del Mes</td>
                    <td className="text-right py-2.5 px-3 text-gray-900 border border-gray-200">{(rawMaterialConsumption.cement_kg / 1000).toFixed(1)}</td>
                    <td className="text-right py-2.5 px-3 text-gray-900 border border-gray-200">{(rawMaterialConsumption.sand_kg / 1000).toFixed(1)}</td>
                    <td className="text-right py-2.5 px-3 text-gray-900 border border-gray-200">{(rawMaterialConsumption.stone_0_10_kg / 1000).toFixed(1)}</td>
                    <td className="text-right py-2.5 px-3 text-gray-900 border border-gray-200">{(rawMaterialConsumption.water_kg / 1000).toFixed(1)}</td>
                    <td className="text-right py-2.5 px-3 font-bold text-gray-900 border border-gray-200">{(rawMaterialConsumption.total_kg / 1000).toFixed(1)}</td>
                  </tr>
                </tbody>
              </table>
            </section>
          )}

          {/* Salto de página para PDF - Análisis de Paradas en página 2 */}
          {paretoDowntimes.length > 0 && (
            <section className="pdf-page-break" style={{ pageBreakBefore: 'always', breakBefore: 'page', paddingTop: '20px' }}>
              <h2 className="text-xl font-bold text-gray-900 mb-6">Análisis de Paradas</h2>
              
              {/* Diagrama de Pareto - Barras + Línea Acumulativa */}
              <div className="h-72 mb-8">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={paretoChartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                    <XAxis 
                      dataKey="reason" 
                      tick={{ fontSize: 10, fill: '#374151' }} 
                      axisLine={{ stroke: '#d1d5db' }} 
                      tickLine={false}
                      angle={-45}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis 
                      yAxisId="left"
                      tick={{ fontSize: 11, fill: '#6b7280' }} 
                      axisLine={{ stroke: '#d1d5db' }} 
                      tickLine={false}
                      label={{ value: 'Minutos', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#6b7280' } }}
                    />
                    <YAxis 
                      yAxisId="right"
                      orientation="right"
                      domain={[0, 100]}
                      tick={{ fontSize: 11, fill: '#2563eb' }} 
                      axisLine={{ stroke: '#2563eb' }} 
                      tickLine={false}
                      tickFormatter={(value) => `${value}%`}
                      label={{ value: '% Acumulado', angle: 90, position: 'insideRight', style: { fontSize: 11, fill: '#2563eb' } }}
                    />
                    <Tooltip 
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload
                          return (
                            <div className="bg-white p-3 border rounded-lg shadow-lg">
                              <p className="font-semibold text-gray-900 text-sm">{data.fullReason}</p>
                              <p className="text-red-600 font-bold">{data.minutes} minutos</p>
                              <p className="text-gray-600 text-sm">{data.percentage}% del total</p>
                              <p className="text-blue-600 text-sm font-medium">{data.cumulative}% acumulado</p>
                            </div>
                          )
                        }
                        return null
                      }}
                    />
                    <Bar yAxisId="left" dataKey="minutes" radius={[4, 4, 0, 0]}>
                      {paretoChartData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={entry.cumulative <= 80 ? "#dc2626" : entry.cumulative <= 95 ? "#f97316" : "#fbbf24"}
                        />
                      ))}
                    </Bar>
                    <Line 
                      yAxisId="right"
                      type="monotone" 
                      dataKey="cumulative" 
                      stroke="#2563eb" 
                      strokeWidth={2.5}
                      dot={{ fill: '#2563eb', strokeWidth: 2, r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              
              {/* Leyenda del Pareto */}
              <div className="flex justify-center gap-6 mb-6 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded bg-red-600"></div>
                  <span className="text-gray-600">0-80% (Críticas)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded bg-orange-500"></div>
                  <span className="text-gray-600">80-95% (Importantes)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded bg-yellow-400"></div>
                  <span className="text-gray-600">95-100% (Menores)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-1 bg-blue-600"></div>
                  <span className="text-gray-600">% Acumulado</span>
                </div>
              </div>

              {/* Detalle de paradas con todos los comentarios - texto más grande */}
              <div className="space-y-5">
                {paretoDowntimes.map((dt, idx) => (
                  <div key={idx} className="flex items-start gap-4">
                    <span className="flex items-center justify-center w-8 h-8 rounded-full bg-red-100 text-red-700 text-base font-bold flex-shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-lg font-semibold text-gray-900">{dt.reason}</span>
                        <div className="flex items-center gap-4 flex-shrink-0 ml-4">
                          <span className="text-lg font-bold text-red-600">{dt.minutes} min</span>
                          <span className="text-base text-gray-500">
                            {totalDowntime > 0 ? ((dt.minutes / totalDowntime) * 100).toFixed(0) : 0}%
                          </span>
                        </div>
                      </div>
                      {dt.comments && dt.comments.length > 0 && (
                        <ul className="mt-3 space-y-1.5">
                          {dt.comments.map((comment, cIdx) => (
                            <li key={cIdx} className="text-base text-gray-600 flex items-start gap-2">
                              <span className="text-gray-400">-</span>
                              <span>{comment.text}</span>
                              <span className="text-gray-400 text-sm ml-1">({comment.minutes} min)</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Total - más grande */}
              <div className="mt-8 flex items-center justify-between bg-gray-900 text-white rounded-lg px-6 py-4">
                <span className="text-lg font-semibold">Total Paradas</span>
                <span className="text-2xl font-bold">{totalDowntime} min</span>
              </div>

              {/* Pie de página en página 2 */}
              <footer className="mt-auto pt-8 text-center text-xs text-gray-400">
                <p>Generado el {new Date().toLocaleDateString('es-AR')} - SILKE S.A. - Sistema de Control de Producción</p>
              </footer>
            </section>
          )}

          {/* Pie de página solo si no hay paradas */}
          {paretoDowntimes.length === 0 && (
            <footer className="pt-4 text-center text-[10px] text-gray-400">
              <p>Generado el {new Date().toLocaleDateString('es-AR')} - SILKE S.A. - Sistema de Control de Producción</p>
            </footer>
          )}
        </div>
      )}

          {/* Informe Ejecutivo oculto para exportar a PDF */}
          <div className="fixed left-[-9999px] top-0">
            <ExecutiveReport
              ref={executiveReportRef}
              selectedMonth={selectedMonth}
              selectedYear={selectedYear}
              dailyMetrics={dailyMetrics}
              averageMetrics={averageMetrics}
              paretoDowntimes={paretoDowntimes}
              totalDowntime={totalDowntime}
              rawMaterialConsumption={rawMaterialConsumption}
            />
          </div>
        </div>
      )}
    </div>
  )
}
