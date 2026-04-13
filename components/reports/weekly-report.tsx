"use client"

import { useState, useEffect, useRef } from "react"
import { getSupabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FileDown, TrendingUp, TrendingDown, Minus, Calendar, ChevronLeft, ChevronRight, Eye, X } from "lucide-react"
import { ProductionTrendChart } from "./production-trend-chart"
import { PipeWeeklyExecutiveReport } from "./pipe-weekly-executive-report"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  calculateReportMetrics,
  getDowntimeDetails,
  getParetoDowntimes,
  calculateAverageMetrics,
  calculateRawMaterialConsumption,
  calculatePipeMetrics,
  calculatePipeRawMaterialConsumption,
  TARGETS,
  formatDateForDisplay,
  type ReportMetrics,
  type DowntimeDetail,
  type RawMaterialConsumption,
  type PipeReportMetrics,
  type PipeRawMaterialConsumption,
  type PipeFormulaConfig,
} from "@/lib/report-utils"
import { useToast } from "@/hooks/use-toast"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Cell,
  ComposedChart,
  Line,
  Tooltip,
} from "recharts"


interface WeeklyReportProps {
  lineType: "bloques" | "caños"
}

export function WeeklyReport({ lineType }: WeeklyReportProps) {
  const [weekStart, setWeekStart] = useState(() => {
    const today = new Date()
    const dayOfWeek = today.getDay()
    const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)
    const monday = new Date(today.setDate(diff))
    return monday.toISOString().split("T")[0]
  })
  const [records, setRecords] = useState<any[]>([])
  const [dailyMetrics, setDailyMetrics] = useState<ReportMetrics[]>([])
  const [averageMetrics, setAverageMetrics] = useState<ReportMetrics | null>(null)
  const [pipeMetrics, setPipeMetrics] = useState<PipeReportMetrics | null>(null)
  const [pipeWeights, setPipeWeights] = useState<Record<string, number>>({})
  const [pipeTargets, setPipeTargets] = useState<Record<string, number>>({})
  const [dailyPipeProduction, setDailyPipeProduction] = useState<{
    date: string
    production: Record<string, number>
    planned: Record<string, number>
  }[]>([])
  const [paretoDowntimes, setParetoDowntimes] = useState<DowntimeDetail[]>([])
  const [totalDowntime, setTotalDowntime] = useState(0)
  const [rawMaterialConsumption, setRawMaterialConsumption] = useState<RawMaterialConsumption | null>(null)
  const [pipeRawMaterialConsumption, setPipeRawMaterialConsumption] = useState<PipeRawMaterialConsumption | null>(null)
  const [loading, setLoading] = useState(false)
  const [prevRecords, setPrevRecords] = useState<any[]>([])
  const reportRef = useRef<HTMLDivElement>(null)
  const [showPreview, setShowPreview] = useState(false)
  const { toast } = useToast()
  
  // Datos históricos para comparaciones
  const [prevMonthDaysAvg, setPrevMonthDaysAvg] = useState<{trays: number, oee: number, scrap: number, downtime: number} | null>(null)
  const [prevWeekAvg, setPrevWeekAvg] = useState<{downtime: number, avgTrays: number} | null>(null)
  const [scrapTrend, setScrapTrend] = useState<"stable" | "increasing" | "decreasing">("stable")
  const [scrapOutlier, setScrapOutlier] = useState<{date: string, value: number} | null>(null)
  
  // Datos de calidad de caños desde control de calidad
  const [pipeQualityData, setPipeQualityData] = useState<{
    byDiameter: Record<number, { first: number; second: number; broken: number }>;
    totalFirst: number;
    totalSecond: number;
    totalBroken: number;
    topDefectReasons: { reason: string; count: number; percentage: number }[];
    wasteBoxes: number;
    wasteTons: number;
  } | null>(null)

  const supabase = getSupabase()

  const weekEnd = (() => {
    const start = new Date(weekStart)
    start.setDate(start.getDate() + 6)
    return start.toISOString().split("T")[0]
  })()

  useEffect(() => {
    loadReport()
  }, [weekStart, lineType])

  async function loadReport() {
    setLoading(true)
    try {
      const tableName = lineType === "bloques" ? "block_production" : "pipe_production"
      const selectQuery = lineType === "caños" 
        ? `*, pipe_downtime (id, custom_reason, minutes, comments, downtime_category), pipe_mold_breakage (id, diameter, reasons, comments)`
        : `*, block_downtime (id, custom_reason, minutes, comments, downtime_category)`

      // Cargar datos de la semana actual
      const { data, error } = await supabase
        .from(tableName)
        .select(selectQuery)
        .gte("production_date", weekStart)
        .lte("production_date", weekEnd)
        .order("production_date", { ascending: true })

      if (error) throw error

      setRecords(data || [])

      // Load previous week full records for interactive comparison
      const pwStart = new Date(weekStart)
      pwStart.setDate(pwStart.getDate() - 7)
      const pwEnd = new Date(weekStart)
      pwEnd.setDate(pwEnd.getDate() - 1)
      const { data: prevWeekFull } = await supabase
        .from(tableName)
        .select(selectQuery)
        .gte("production_date", pwStart.toISOString().split("T")[0])
        .lte("production_date", pwEnd.toISOString().split("T")[0])
        .order("production_date", { ascending: true })
      setPrevRecords(prevWeekFull || [])

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

          // Cargar planificación semanal desde production_planning
          // Obtener el mes y año de la semana
          const weekStartDate = new Date(weekStart)
          const weekEndDate = new Date(weekEnd)
          const startMonth = weekStartDate.getMonth() + 1
          const startYear = weekStartDate.getFullYear()
          const endMonth = weekEndDate.getMonth() + 1
          const endYear = weekEndDate.getFullYear()
          
          const targets: Record<string, number> = {}
          
          // Cargar planificación del mes de inicio
          const { data: planningData } = await supabase
            .from("production_planning")
            .select("*")
            .eq("year", startYear)
            .eq("month", startMonth)
          
          if (planningData) {
            planningData.forEach((row: any) => {
              let total = 0
              // Solo sumar los días que están dentro de la semana
              for (let day = 1; day <= 31; day++) {
                const dayDate = new Date(startYear, startMonth - 1, day)
                if (dayDate >= weekStartDate && dayDate <= weekEndDate) {
                  total += row[`day_${day}`] || 0
                }
              }
              if (total > 0) {
                if (!targets[row.pipe_size]) targets[row.pipe_size] = 0
                targets[row.pipe_size] += total
              }
            })
          }
          
          // Si la semana cruza meses, cargar también el mes final
          if (startMonth !== endMonth || startYear !== endYear) {
            const { data: planningData2 } = await supabase
              .from("production_planning")
              .select("*")
              .eq("year", endYear)
              .eq("month", endMonth)
            
            if (planningData2) {
              planningData2.forEach((row: any) => {
                let total = 0
                for (let day = 1; day <= 31; day++) {
                  const dayDate = new Date(endYear, endMonth - 1, day)
                  if (dayDate >= weekStartDate && dayDate <= weekEndDate) {
                    total += row[`day_${day}`] || 0
                  }
                }
                if (total > 0) {
                  if (!targets[row.pipe_size]) targets[row.pipe_size] = 0
                  targets[row.pipe_size] += total
                }
              })
            }
          }
          
          setPipeTargets(targets)
          const currentPipeMetrics = calculatePipeMetrics(data, weights)
          setPipeMetrics(currentPipeMetrics)
          // Calcular consumo de materia prima para caños usando fórmulas de product_config
          const pipeConsumption = calculatePipeRawMaterialConsumption(data, formulas)
          setPipeRawMaterialConsumption(pipeConsumption)
          setAverageMetrics(null)
          setDailyMetrics([])

          // Calculate daily production by pipe size
          const dailyProd: Record<string, Record<string, number>> = {}
          const pipeSizes = ["300", "400", "500", "600", "800", "1000", "1200"]
          
          data.forEach((record: any) => {
            const dateKey = record.production_date
            if (!dailyProd[dateKey]) {
              dailyProd[dateKey] = {}
              pipeSizes.forEach(size => { dailyProd[dateKey][size] = 0 })
            }
            pipeSizes.forEach(size => {
              const simple = record[`cc${size}_simples`] || 0
              const armado = record[`cc${size}_armado`] || 0
              dailyProd[dateKey][size] += simple + armado
            })
          })

          // Get daily planned values
          const dailyPlanned: Record<string, Record<string, number>> = {}
          const loadDailyPlanned = async (year: number, month: number) => {
            const { data: planData } = await supabase
              .from("production_planning")
              .select("*")
              .eq("year", year)
              .eq("month", month)
            
            if (planData) {
              planData.forEach((row: any) => {
                const size = row.pipe_size
                for (let day = 1; day <= 31; day++) {
                  const dayDate = new Date(year, month - 1, day)
                  if (dayDate >= weekStartDate && dayDate <= weekEndDate) {
                    const dateKey = dayDate.toISOString().split("T")[0]
                    if (!dailyPlanned[dateKey]) {
                      dailyPlanned[dateKey] = {}
                      pipeSizes.forEach(s => { dailyPlanned[dateKey][s] = 0 })
                    }
                    dailyPlanned[dateKey][size] += row[`day_${day}`] || 0
                  }
                }
              })
            }
          }

          await loadDailyPlanned(startYear, startMonth)
          if (startMonth !== endMonth || startYear !== endYear) {
            await loadDailyPlanned(endYear, endMonth)
          }

          // Build daily pipe production array
          const dailyArray: { date: string; production: Record<string, number>; planned: Record<string, number> }[] = []
          const currentDate = new Date(weekStart)
          while (currentDate <= weekEndDate) {
            const dateKey = currentDate.toISOString().split("T")[0]
            dailyArray.push({
              date: dateKey,
              production: dailyProd[dateKey] || pipeSizes.reduce((acc, s) => ({ ...acc, [s]: 0 }), {}),
              planned: dailyPlanned[dateKey] || pipeSizes.reduce((acc, s) => ({ ...acc, [s]: 0 }), {})
            })
            currentDate.setDate(currentDate.getDate() + 1)
          }
          setDailyPipeProduction(dailyArray)

          // Cargar datos de la semana anterior para caños
          const prevWeekStartPipe = new Date(weekStart)
          prevWeekStartPipe.setDate(prevWeekStartPipe.getDate() - 7)
          const prevWeekEndPipe = new Date(weekStart)
          prevWeekEndPipe.setDate(prevWeekEndPipe.getDate() - 1)

          const { data: prevPipeData } = await supabase
            .from("pipe_production")
            .select(`*, pipe_downtime (id, custom_reason, minutes, comments, downtime_category)`)
            .gte("production_date", prevWeekStartPipe.toISOString().split("T")[0])
            .lte("production_date", prevWeekEndPipe.toISOString().split("T")[0])

          if (prevPipeData && prevPipeData.length > 0) {
            const prevPipeMetricsCalc = calculatePipeMetrics(prevPipeData, weights)
            setPrevWeekAvg({
              downtime: prevPipeMetricsCalc.totalDowntimeMinutes,
              avgTrays: Math.round(prevPipeMetricsCalc.totalUnits / prevPipeData.length)
            })
          } else {
            setPrevWeekAvg(null)
          }

          // Cargar datos de calidad de caños (control de calidad)
          const { data: qualityControls } = await supabase
            .from("pipe_quality_control")
            .select(`
              *,
              items:pipe_quality_items(
                *,
                defects:pipe_quality_defects(
                  *,
                  reason:pipe_defect_reasons(reason, category)
                )
              )
            `)
            .gte("control_date", weekStart)
            .lte("control_date", weekEnd)

          if (qualityControls && qualityControls.length > 0) {
            const byDiameter: Record<number, { first: number; second: number; broken: number }> = {}
            let totalFirst = 0, totalSecond = 0, totalBroken = 0
            const defectCounts: Record<string, number> = {}

            qualityControls.forEach((control: any) => {
              control.items?.forEach((item: any) => {
                const diameter = item.diameter
                if (!byDiameter[diameter]) {
                  byDiameter[diameter] = { first: 0, second: 0, broken: 0 }
                }
                byDiameter[diameter].first += item.first_quality || 0
                byDiameter[diameter].second += item.second_quality || 0
                byDiameter[diameter].broken += item.broken || 0
                totalFirst += item.first_quality || 0
                totalSecond += item.second_quality || 0
                totalBroken += item.broken || 0

                // Contar razones de defectos
                item.defects?.forEach((defect: any) => {
                  const reasonName = defect.reason?.reason || defect.defect_type || "Sin especificar"
                  if (!defectCounts[reasonName]) defectCounts[reasonName] = 0
                  defectCounts[reasonName] += defect.quantity || 1
                })
              })
            })

            // Top 3 razones de defectos
            const totalDefects = Object.values(defectCounts).reduce((s, v) => s + v, 0)
            const topDefectReasons = Object.entries(defectCounts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([reason, count]) => ({
                reason,
                count,
                percentage: totalDefects > 0 ? (count / totalDefects) * 100 : 0
              }))

            // Calcular desperdicio en cajones y toneladas
            // Asumiendo 1 cajón = 1 caño roto o de segunda, y peso promedio por diámetro
            const wasteUnits = totalSecond + totalBroken
            const wasteBoxes = wasteUnits // 1 cajón por unidad defectuosa
            // Calcular toneladas basado en pesos promedio por diámetro
            let wasteTons = 0
            Object.entries(byDiameter).forEach(([diam, data]) => {
              const diamNum = parseInt(diam)
              const weight = weights[diam] || (diamNum * 2) // peso aproximado en kg
              wasteTons += (data.second + data.broken) * weight / 1000
            })

            setPipeQualityData({
              byDiameter,
              totalFirst,
              totalSecond,
              totalBroken,
              topDefectReasons,
              wasteBoxes,
              wasteTons
            })
          } else {
            setPipeQualityData(null)
          }
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
          
          // Cargar datos de días anteriores del mismo mes (antes de esta semana)
          const monthStart = weekStart.substring(0, 8) + "01"
          const dayBeforeWeek = new Date(weekStart)
          dayBeforeWeek.setDate(dayBeforeWeek.getDate() - 1)
          const prevDaysEnd = dayBeforeWeek.toISOString().split("T")[0]
          
          if (monthStart <= prevDaysEnd) {
            const { data: prevData } = await supabase
              .from("block_production")
              .select(`*, block_downtime (minutes)`)
              .gte("production_date", monthStart)
              .lte("production_date", prevDaysEnd)
          
            if (prevData && prevData.length > 0) {
              const prevMetrics = prevData.map(calculateReportMetrics)
              const avgPrev = calculateAverageMetrics(prevMetrics)
              const prevDowntime = prevData.reduce((sum, r) => 
                sum + (r.block_downtime?.reduce((s: number, d: any) => s + (d.minutes || 0), 0) || 0), 0)
            
              setPrevMonthDaysAvg({
                trays: Math.round(avgPrev.traysProduced / prevMetrics.length),
                oee: avgPrev.oee,
                scrap: 100 - avgPrev.quality,
                downtime: Math.round(prevDowntime / prevMetrics.length)
              })
            } else {
              setPrevMonthDaysAvg(null)
            }
          } else {
            setPrevMonthDaysAvg(null)
          }
          
          // Cargar datos de la semana anterior
          const prevWeekStart = new Date(weekStart)
          prevWeekStart.setDate(prevWeekStart.getDate() - 7)
          const prevWeekEnd = new Date(weekStart)
          prevWeekEnd.setDate(prevWeekEnd.getDate() - 1)
          
          const { data: prevWeekData } = await supabase
            .from("block_production")
            .select(`*, block_downtime (minutes)`)
            .gte("production_date", prevWeekStart.toISOString().split("T")[0])
            .lte("production_date", prevWeekEnd.toISOString().split("T")[0])
          
          if (prevWeekData && prevWeekData.length > 0) {
            const prevWeekDowntime = prevWeekData.reduce((sum, r) => 
              sum + (r.block_downtime?.reduce((s: number, d: any) => s + (d.minutes || 0), 0) || 0), 0)
            const prevWeekMetrics = prevWeekData.map(calculateReportMetrics)
            const prevWeekTotalTrays = prevWeekMetrics.reduce((sum, m) => sum + m.traysProduced, 0)
            setPrevWeekAvg({ 
              downtime: prevWeekDowntime,
              avgTrays: Math.round(prevWeekTotalTrays / prevWeekData.length)
            })
          } else {
            setPrevWeekAvg(null)
          }
          
          // Analizar tendencia de scrap
          const scrapValues = metrics.map(m => 100 - m.quality)
          const avgScrap = scrapValues.reduce((a, b) => a + b, 0) / scrapValues.length
          const stdDev = Math.sqrt(scrapValues.reduce((sum, v) => sum + Math.pow(v - avgScrap, 2), 0) / scrapValues.length)
          
          // Detectar outliers (> 2 desviaciones estándar)
          const outlierIdx = scrapValues.findIndex(v => Math.abs(v - avgScrap) > 2 * stdDev && stdDev > 0.5)
          if (outlierIdx >= 0) {
            setScrapOutlier({ date: metrics[outlierIdx].date, value: scrapValues[outlierIdx] })
          } else {
            setScrapOutlier(null)
          }
          
          // Calcular tendencia (comparar primera mitad vs segunda mitad)
          const firstHalf = scrapValues.slice(0, Math.ceil(scrapValues.length / 2))
          const secondHalf = scrapValues.slice(Math.ceil(scrapValues.length / 2))
          const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length
          const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length
          
          if (secondAvg > firstAvg * 1.15) {
            setScrapTrend("increasing")
          } else if (secondAvg < firstAvg * 0.85) {
            setScrapTrend("decreasing")
          } else {
            setScrapTrend("stable")
          }
        }
      } else {
        setDailyMetrics([])
        setAverageMetrics(null)
        setParetoDowntimes([])
        setTotalDowntime(0)
        setRawMaterialConsumption(null)
        setPrevMonthDaysAvg(null)
        setPrevWeekAvg(null)
        setScrapTrend("stable")
        setScrapOutlier(null)
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
        `informe-semanal-${weekStart}.pdf`
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

// Usar estilos inline con hex para evitar problemas con oklch en PDF export
  function getStatusColor(value: number, target: number, higherIsBetter = true) {
    const diff = higherIsBetter ? value - target : target - value
    if (diff >= 0) return { color: "#16a34a" } // green-600
    if (diff > -5) return { color: "#ca8a04" } // yellow-600
    return { color: "#dc2626" } // red-600
  }

  function getStatusIcon(value: number, target: number, higherIsBetter = true) {
    const diff = higherIsBetter ? value - target : target - value
    if (diff >= 0) return <TrendingUp className="h-4 w-4" style={{ color: "#22c55e" }} />
    if (diff > -5) return <Minus className="h-4 w-4" style={{ color: "#eab308" }} />
    return <TrendingDown className="h-4 w-4" style={{ color: "#ef4444" }} />
  }

  // Calcular datos para diagrama de Pareto con porcentaje acumulado
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

  const hasData = lineType === "caños" ? !!pipeMetrics : !!averageMetrics

  function goToPrevWeek() {
    const d = new Date(weekStart)
    d.setDate(d.getDate() - 7)
    setWeekStart(d.toISOString().split("T")[0])
  }

  function goToNextWeek() {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + 7)
    const today = new Date()
    if (d > today) return
    setWeekStart(d.toISOString().split("T")[0])
  }

  const isCurrentWeek = (() => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + 7)
    return d > new Date()
  })()

  const prevWeekLabel = (() => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() - 7)
    const e = new Date(weekStart)
    e.setDate(e.getDate() - 1)
    return `${formatDateForDisplay(d.toISOString().split("T")[0])} - ${formatDateForDisplay(e.toISOString().split("T")[0])}`
  })()

  return (
    <div className="space-y-6">
      {/* Dashboard-style header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">Informe Semanal</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {lineType === "bloques" ? "Linea de Bloques" : "Linea de Canos"} - {formatDateForDisplay(weekStart)} al {formatDateForDisplay(weekEnd)}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Week selector */}
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            <button onClick={goToPrevWeek} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-card transition-all" aria-label="Semana anterior">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1.5 px-2">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
              <input type="date" value={weekStart} onChange={e => setWeekStart(e.target.value)} className="bg-transparent text-xs font-medium text-foreground cursor-pointer focus:outline-none" />
            </div>
            <button onClick={goToNextWeek} disabled={isCurrentWeek} className={`p-1.5 rounded-md transition-all ${isCurrentWeek ? 'text-muted-foreground/30 cursor-not-allowed' : 'text-muted-foreground hover:text-foreground hover:bg-card'}`} aria-label="Semana siguiente">
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
          <div className="text-muted-foreground text-sm">No hay datos de produccion para la semana seleccionada</div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Trend chart */}
          <ProductionTrendChart
            lineType={lineType === "caños" ? "canos" : "bloques"}
            records={records}
            prevRecords={prevRecords}
            pipeWeights={pipeWeights}
            pipeTargets={pipeTargets}
            monthLabel={`${formatDateForDisplay(weekStart)} - ${formatDateForDisplay(weekEnd)}`}
            prevMonthLabel={prevWeekLabel}
          />

          {/* PDF export buttons */}
          {lineType === "caños" && pipeMetrics && (
            <div className="flex items-center gap-2">
              <Button onClick={() => setShowPreview(true)} disabled={!hasData} variant="outline" size="sm" className="gap-2 bg-card border-border text-foreground hover:bg-muted">
                <Eye className="h-3.5 w-3.5" />
                Previsualizar
              </Button>
              <Button onClick={exportToPDF} disabled={!hasData} variant="default" size="sm" className="gap-2">
                <FileDown className="h-3.5 w-3.5" />
                Descargar PDF
              </Button>
            </div>
          )}
          
          {lineType === "bloques" && averageMetrics && (
            <div className="flex items-center gap-2">
              <Button onClick={exportToPDF} disabled={!hasData} variant="outline" size="sm" className="gap-2 bg-card border-border text-foreground hover:bg-muted">
                <FileDown className="h-3.5 w-3.5" />
                Exportar PDF
              </Button>
            </div>
          )}

          {lineType === "caños" && pipeMetrics ? (
            <>
              {/* Preview Dialog */}
              <Dialog open={showPreview} onOpenChange={setShowPreview}>
                <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-auto p-0">
                  <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center justify-between">
                    <DialogTitle>Previsualización - Informe Semanal</DialogTitle>
                    <div className="flex items-center gap-2">
                      <Button onClick={exportToPDF} size="sm" className="gap-2">
                        <FileDown className="h-3.5 w-3.5" />
                        Descargar PDF
                      </Button>
                      <Button onClick={() => setShowPreview(false)} variant="ghost" size="sm">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="p-4 flex justify-center bg-gray-100">
                    <PipeWeeklyExecutiveReport
                      ref={reportRef}
                      weekStart={weekStart}
                      weekEnd={weekEnd}
                      daysWorked={records.length}
                      reportData={{
                        totalUnits: pipeMetrics.totalUnits,
                        totalPlanned: Object.values(pipeTargets).reduce((s, v) => s + v, 0),
                        byDiameter: pipeMetrics.productionByType.reduce((acc, p) => {
                          const diameter = parseInt(p.size)
                          const qualityData = pipeQualityData?.byDiameter[diameter]
                          acc[diameter] = {
                            produced: p.quantity,
                            planned: pipeTargets[p.size] || 0,
                            first: qualityData?.first ?? p.quantity,
                            second: qualityData?.second ?? 0,
                            broken: qualityData?.broken ?? 0
                          }
                          return acc
                        }, {} as Record<number, { produced: number; planned: number; first: number; second: number; broken: number }>),
                        qualityIndex: pipeQualityData 
                          ? (pipeQualityData.totalFirst / (pipeQualityData.totalFirst + pipeQualityData.totalSecond + pipeQualityData.totalBroken)) * 100 
                          : pipeMetrics.quality,
                        secondPercent: pipeQualityData 
                          ? (pipeQualityData.totalSecond / (pipeQualityData.totalFirst + pipeQualityData.totalSecond + pipeQualityData.totalBroken)) * 100 
                          : 0,
                        brokenPercent: pipeQualityData 
                          ? (pipeQualityData.totalBroken / (pipeQualityData.totalFirst + pipeQualityData.totalSecond + pipeQualityData.totalBroken)) * 100 
                          : 100 - pipeMetrics.quality,
                        wastePercent: pipeQualityData 
                          ? ((pipeQualityData.totalSecond + pipeQualityData.totalBroken) / (pipeQualityData.totalFirst + pipeQualityData.totalSecond + pipeQualityData.totalBroken)) * 100 
                          : 100 - pipeMetrics.quality,
                        wasteBoxes: pipeQualityData?.wasteBoxes ?? 0,
                        wasteTons: pipeQualityData?.wasteTons ?? 0,
                        topDowntimes: pipeMetrics.downtimes
                          .sort((a: any, b: any) => b.minutes - a.minutes)
                          .slice(0, 3)
                          .map((dt: any) => ({
                            reason: dt.reason,
                            minutes: dt.minutes,
                            percentage: pipeMetrics.totalDowntimeMinutes > 0 ? (dt.minutes / pipeMetrics.totalDowntimeMinutes) * 100 : 0
                          })),
                        topDefectReasons: pipeQualityData?.topDefectReasons ?? [],
                        totalDowntimeMinutes: pipeMetrics.totalDowntimeMinutes,
                        prevWeekUnits: prevWeekAvg?.avgTrays ? prevWeekAvg.avgTrays * 5 : 0,
                        prevWeekQuality: 0
                      }}
                    />
                  </div>
                </DialogContent>
              </Dialog>

              {/* Hidden report for PDF export */}
              <div className="hidden">
                <PipeWeeklyExecutiveReport
                  ref={reportRef}
                  weekStart={weekStart}
                  weekEnd={weekEnd}
                  daysWorked={records.length}
                  reportData={{
                    totalUnits: pipeMetrics.totalUnits,
                    totalPlanned: Object.values(pipeTargets).reduce((s, v) => s + v, 0),
                    byDiameter: pipeMetrics.productionByType.reduce((acc, p) => {
                      const diameter = parseInt(p.size)
                      const qualityData = pipeQualityData?.byDiameter[diameter]
                      acc[diameter] = {
                        produced: p.quantity,
                        planned: pipeTargets[p.size] || 0,
                        first: qualityData?.first ?? p.quantity,
                        second: qualityData?.second ?? 0,
                        broken: qualityData?.broken ?? 0
                      }
                      return acc
                    }, {} as Record<number, { produced: number; planned: number; first: number; second: number; broken: number }>),
                    qualityIndex: pipeQualityData 
                      ? (pipeQualityData.totalFirst / (pipeQualityData.totalFirst + pipeQualityData.totalSecond + pipeQualityData.totalBroken)) * 100 
                      : pipeMetrics.quality,
                    secondPercent: pipeQualityData 
                      ? (pipeQualityData.totalSecond / (pipeQualityData.totalFirst + pipeQualityData.totalSecond + pipeQualityData.totalBroken)) * 100 
                      : 0,
                    brokenPercent: pipeQualityData 
                      ? (pipeQualityData.totalBroken / (pipeQualityData.totalFirst + pipeQualityData.totalSecond + pipeQualityData.totalBroken)) * 100 
                      : 100 - pipeMetrics.quality,
                    wastePercent: pipeQualityData 
                      ? ((pipeQualityData.totalSecond + pipeQualityData.totalBroken) / (pipeQualityData.totalFirst + pipeQualityData.totalSecond + pipeQualityData.totalBroken)) * 100 
                      : 100 - pipeMetrics.quality,
                    wasteBoxes: pipeQualityData?.wasteBoxes ?? 0,
                    wasteTons: pipeQualityData?.wasteTons ?? 0,
                    topDowntimes: pipeMetrics.downtimes
                      .sort((a: any, b: any) => b.minutes - a.minutes)
                      .slice(0, 3)
                      .map((dt: any) => ({
                        reason: dt.reason,
                        minutes: dt.minutes,
                        percentage: pipeMetrics.totalDowntimeMinutes > 0 ? (dt.minutes / pipeMetrics.totalDowntimeMinutes) * 100 : 0
                      })),
                    topDefectReasons: pipeQualityData?.topDefectReasons ?? [],
                    totalDowntimeMinutes: pipeMetrics.totalDowntimeMinutes,
                    prevWeekUnits: prevWeekAvg?.avgTrays ? prevWeekAvg.avgTrays * 5 : 0,
                    prevWeekQuality: 0
                  }}
                />
              </div>

              {/* Dashboard view */}
              <div className="space-y-4 bg-background p-4">
                <div className="text-center border-b pb-4">
                  <h2 className="text-xl font-bold">SILKE - Informe Semanal - Canos</h2>
                  <p className="text-muted-foreground">
                    Semana del {formatDateForDisplay(weekStart)} al {formatDateForDisplay(weekEnd)}
                  </p>
                </div>

          {/* OEE Indicators */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Indicadores de Eficiencia (OEE)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="bg-muted/50 p-3 rounded-lg border border-border text-center">
                  <div className="text-muted-foreground text-[10px] uppercase tracking-widest font-medium mb-1">Disponibilidad</div>
                  <div className={`text-2xl font-bold ${pipeMetrics.availability >= 95 ? 'text-emerald-600' : pipeMetrics.availability >= 85 ? 'text-amber-600' : 'text-red-600'}`}>{pipeMetrics.availability}%</div>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg border border-border text-center">
                  <div className="text-muted-foreground text-[10px] uppercase tracking-widest font-medium mb-1">Rendimiento</div>
                  <div className={`text-2xl font-bold ${pipeMetrics.performance >= 75 ? 'text-emerald-600' : 'text-amber-600'}`}>{pipeMetrics.performance}%</div>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg border border-border text-center">
                  <div className="text-muted-foreground text-[10px] uppercase tracking-widest font-medium mb-1">Calidad</div>
                  <div className={`text-2xl font-bold ${pipeMetrics.quality >= 98 ? 'text-emerald-600' : 'text-amber-600'}`}>{pipeMetrics.quality}%</div>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg border border-border text-center">
                  <div className="text-muted-foreground text-[10px] uppercase tracking-widest font-medium mb-1">OEE</div>
                  <div className={`text-2xl font-bold ${pipeMetrics.oee >= 70 ? 'text-emerald-600' : 'text-amber-600'}`}>{pipeMetrics.oee}%</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Resumen de produccion */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Resumen de Produccion</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                <div className="bg-muted/50 p-3 rounded-lg">
                  <div className="text-muted-foreground text-xs">Canos Producidos</div>
                  <div className="text-xl font-bold">{pipeMetrics.totalUnits}</div>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg">
                  <div className="text-muted-foreground text-xs">Toneladas</div>
                  <div className="text-xl font-bold">{pipeMetrics.totalWeightTn} Tn</div>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg">
                  <div className="text-muted-foreground text-xs">TN/Hora</div>
                  <div className="text-xl font-bold text-foreground">{pipeMetrics.tnPerHour}</div>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg">
                  <div className="text-muted-foreground text-xs">TN/Hora/Operario</div>
                  <div className="text-xl font-bold text-foreground">{pipeMetrics.tnPerHourPerOperator}</div>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg">
                  <div className="text-muted-foreground text-xs">Operarios Prom.</div>
                  <div className="text-xl font-bold">{pipeMetrics.operators}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Produccion por tipo */}
          {pipeMetrics.productionByType.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Produccion por Tipo de Cano</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left py-2 px-2">Tipo</th>
                        <th className="text-center py-2 px-2">Producido</th>
                        <th className="text-center py-2 px-2">Planif.</th>
                        <th className="text-center py-2 px-2">Cumpl.</th>
                        <th className="text-center py-2 px-2">Peso (Tn)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pipeMetrics.productionByType.map((p) => {
                        const target = pipeTargets[p.size] || 0
                        const compliance = target > 0 ? (p.quantity / target) * 100 : 0
                        return (
                          <tr key={p.size} className="border-b">
                            <td className="py-2 px-2 font-medium">CC{p.size}</td>
                            <td className="text-center py-2 px-2">{p.quantity}</td>
                            <td className="text-center py-2 px-2 text-muted-foreground">{target || '-'}</td>
                            <td className={`text-center py-2 px-2 font-bold ${target > 0 ? (compliance >= 100 ? 'text-green-600' : compliance >= 80 ? 'text-yellow-600' : 'text-red-600') : 'text-muted-foreground'}`}>
                              {target > 0 ? `${compliance.toFixed(0)}%` : '-'}
                            </td>
                            <td className="text-center py-2 px-2">{p.weightTn.toFixed(2)}</td>
                          </tr>
                        )
                      })}
                      <tr className="border-t-2 font-bold bg-muted/50">
                        <td className="py-2 px-2">TOTAL</td>
                        <td className="text-center py-2 px-2">{pipeMetrics.totalUnits}</td>
                        <td className="text-center py-2 px-2 text-muted-foreground">
                          {Object.values(pipeTargets).reduce((a, b) => a + b, 0) || '-'}
                        </td>
                        <td className="text-center py-2 px-2">
                          {Object.values(pipeTargets).reduce((a, b) => a + b, 0) > 0
                            ? `${((pipeMetrics.totalUnits / Object.values(pipeTargets).reduce((a, b) => a + b, 0)) * 100).toFixed(0)}%`
                            : '-'}
                        </td>
                        <td className="text-center py-2 px-2">{pipeMetrics.totalWeightTn}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Producción Diaria por Tipo de Caño vs Planificado */}
          {dailyPipeProduction.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Produccion Diaria por Tipo de Cano vs Planificado</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left py-2 px-1 sticky left-0 bg-muted/50">Fecha</th>
                        {["300", "400", "500", "600", "800", "1000", "1200"].map(size => (
                          <th key={size} className="text-center py-2 px-1" colSpan={2}>CC{size}</th>
                        ))}
                        <th className="text-center py-2 px-1" colSpan={2}>Total</th>
                      </tr>
                      <tr className="border-b bg-muted/30 text-[10px]">
                        <th className="text-left py-1 px-1 sticky left-0 bg-muted/30"></th>
                        {["300", "400", "500", "600", "800", "1000", "1200"].map(size => (
                          <th key={size} className="text-center py-1 px-0.5" colSpan={2}>
                            <span className="text-emerald-600">Prod</span>/<span className="text-blue-600">Plan</span>
                          </th>
                        ))}
                        <th className="text-center py-1 px-0.5" colSpan={2}>
                          <span className="text-emerald-600">Prod</span>/<span className="text-blue-600">Plan</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyPipeProduction.map((day) => {
                        const dayName = new Date(day.date + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short" })
                        const dayNum = new Date(day.date + "T12:00:00").getDate()
                        const totalProd = Object.values(day.production).reduce((a, b) => a + b, 0)
                        const totalPlan = Object.values(day.planned).reduce((a, b) => a + b, 0)
                        const isWeekend = ["sáb", "dom", "Sat", "Sun"].some(d => dayName.toLowerCase().includes(d.toLowerCase()))
                        
                        return (
                          <tr key={day.date} className={`border-b ${isWeekend ? 'bg-muted/20' : ''}`}>
                            <td className="py-1.5 px-1 font-medium sticky left-0 bg-background whitespace-nowrap">
                              {dayName} {dayNum}
                            </td>
                            {["300", "400", "500", "600", "800", "1000", "1200"].map(size => {
                              const prod = day.production[size] || 0
                              const plan = day.planned[size] || 0
                              const diff = prod - plan
                              return (
                                <td key={size} className="text-center py-1.5 px-0.5" colSpan={2}>
                                  <span className="text-emerald-600 font-medium">{prod > 0 ? prod : '-'}</span>
                                  <span className="text-muted-foreground">/</span>
                                  <span className="text-blue-600">{plan > 0 ? plan : '-'}</span>
                                  {plan > 0 && (
                                    <span className={`ml-1 text-[10px] ${diff >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                      ({diff >= 0 ? '+' : ''}{diff})
                                    </span>
                                  )}
                                </td>
                              )
                            })}
                            <td className="text-center py-1.5 px-1 font-bold" colSpan={2}>
                              <span className="text-emerald-600">{totalProd}</span>
                              <span className="text-muted-foreground">/</span>
                              <span className="text-blue-600">{totalPlan || '-'}</span>
                              {totalPlan > 0 && (
                                <span className={`ml-1 text-[10px] ${totalProd - totalPlan >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                  ({totalProd - totalPlan >= 0 ? '+' : ''}{totalProd - totalPlan})
                                </span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                      {/* Totals row */}
                      <tr className="border-t-2 font-bold bg-muted/50">
                        <td className="py-2 px-1 sticky left-0 bg-muted/50">TOTAL</td>
                        {["300", "400", "500", "600", "800", "1000", "1200"].map(size => {
                          const totalProd = dailyPipeProduction.reduce((sum, day) => sum + (day.production[size] || 0), 0)
                          const totalPlan = dailyPipeProduction.reduce((sum, day) => sum + (day.planned[size] || 0), 0)
                          const diff = totalProd - totalPlan
                          const compliance = totalPlan > 0 ? Math.round((totalProd / totalPlan) * 100) : 0
                          return (
                            <td key={size} className="text-center py-2 px-0.5" colSpan={2}>
                              <div>
                                <span className="text-emerald-600">{totalProd}</span>
                                <span className="text-muted-foreground">/</span>
                                <span className="text-blue-600">{totalPlan || '-'}</span>
                              </div>
                              {totalPlan > 0 && (
                                <div className={`text-[10px] ${compliance >= 100 ? 'text-emerald-600' : compliance >= 80 ? 'text-amber-600' : 'text-red-500'}`}>
                                  {compliance}%
                                </div>
                              )}
                            </td>
                          )
                        })}
                        <td className="text-center py-2 px-1" colSpan={2}>
                          {(() => {
                            const grandTotalProd = dailyPipeProduction.reduce((sum, day) => 
                              sum + Object.values(day.production).reduce((a, b) => a + b, 0), 0)
                            const grandTotalPlan = dailyPipeProduction.reduce((sum, day) => 
                              sum + Object.values(day.planned).reduce((a, b) => a + b, 0), 0)
                            const compliance = grandTotalPlan > 0 ? Math.round((grandTotalProd / grandTotalPlan) * 100) : 0
                            return (
                              <>
                                <div>
                                  <span className="text-emerald-600">{grandTotalProd}</span>
                                  <span className="text-muted-foreground">/</span>
                                  <span className="text-blue-600">{grandTotalPlan || '-'}</span>
                                </div>
                                {grandTotalPlan > 0 && (
                                  <div className={`text-[10px] ${compliance >= 100 ? 'text-emerald-600' : compliance >= 80 ? 'text-amber-600' : 'text-red-500'}`}>
                                    {compliance}%
                                  </div>
                                )}
                              </>
                            )
                          })()}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tiempo de producción */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Tiempo de Produccion</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div className="bg-sky-50 p-3 rounded-lg border border-sky-200 text-center">
                  <div className="text-sky-700 text-xs">Tiempo Disponible</div>
                  <div className="text-xl font-bold text-sky-700">{(pipeMetrics.availableMinutes / 60).toFixed(1)} hrs</div>
                </div>
                <div className="bg-orange-50 p-3 rounded-lg border border-orange-200 text-center">
                  <div className="text-orange-700 text-xs">Paradas Totales</div>
                  <div className="text-xl font-bold text-orange-700">{(pipeMetrics.totalDowntimeMinutes / 60).toFixed(1)} hrs</div>
                </div>
                <div className="bg-green-50 p-3 rounded-lg border border-green-200 text-center">
                  <div className="text-green-700 text-xs">Tiempo Efectivo</div>
                  <div className="text-xl font-bold text-green-700">
                    {((pipeMetrics.availableMinutes - (pipeMetrics.totalDowntimeMinutes - pipeMetrics.externalDowntimeMinutes)) / 60).toFixed(1)} hrs
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Paradas - Top 4 */}
          {pipeMetrics.downtimes.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Top 4 Causas de Parada - Total: {pipeMetrics.totalDowntimeMinutes} min ({(pipeMetrics.totalDowntimeMinutes / 60).toFixed(1)} hrs)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {(() => {
                    const sorted = [...pipeMetrics.downtimes].sort((a, b) => b.minutes - a.minutes).slice(0, 4)
                    let cumPct = 0
                    return sorted.map((dt: any, idx: number) => {
                      const pct = pipeMetrics.totalDowntimeMinutes > 0 ? Number(((dt.minutes / pipeMetrics.totalDowntimeMinutes) * 100).toFixed(1)) : 0
                      cumPct += pct
                      return (
                        <div key={idx} className="border rounded-lg p-2">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-sm font-semibold">{dt.reason}</span>
                            <div className="flex gap-3 items-center text-sm">
                              <span className="font-bold text-red-600">{dt.minutes} min</span>
                              <span className="text-muted-foreground">({pct}%)</span>
                              <span className="text-blue-600 font-medium">Acum: {cumPct.toFixed(1)}%</span>
                            </div>
                          </div>
                          {dt.details && dt.details.length > 0 && (
                            <ul className="list-disc pl-4 text-xs text-muted-foreground">
                              {dt.details.map((detail: any, di: number) => (
                                <li key={di}>{detail.description} <span className="text-red-600 font-semibold">({detail.minutes} min)</span></li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )
                    })
                  })()}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Analisis de roturas de molde */}
          {(pipeMetrics.breakagesByMold.length > 0 || pipeMetrics.breakagesByType.length > 0) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Roturas de Molde - Total: {pipeMetrics.moldBreakages.length}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 gap-4">
                  {pipeMetrics.breakagesByMold.length > 0 && (
                    <div>
                      <h4 className="font-medium text-sm mb-2">Por Molde</h4>
                      <div className="space-y-1">
                        {pipeMetrics.breakagesByMold.map((b) => (
                          <div key={b.diameter} className="flex justify-between text-sm bg-muted/50 px-2 py-1 rounded">
                            <span className="text-foreground">CC{b.diameter}</span>
                            <span className="font-bold text-destructive">{b.count} roturas</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {pipeMetrics.breakagesByType.length > 0 && (
                    <div>
                      <h4 className="font-medium text-sm mb-2">Por Tipo de Rotura</h4>
                      <div className="space-y-1">
                        {pipeMetrics.breakagesByType.map((b) => (
                          <div key={b.reason} className="flex justify-between text-sm bg-muted/50 px-2 py-1 rounded">
                            <span className="text-foreground">{b.reason}</span>
                            <span className="font-bold text-destructive">{b.count} veces</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Consumo de materia prima */}
          {pipeRawMaterialConsumption && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Consumo de Materia Prima</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                  <div className="bg-muted/50 p-3 rounded-lg">
                    <div className="text-muted-foreground text-xs">Cemento</div>
                    <div className="text-lg font-bold">{(pipeRawMaterialConsumption.cement_kg / 1000).toFixed(2)} Tn</div>
                  </div>
                  <div className="bg-muted/50 p-3 rounded-lg">
                    <div className="text-muted-foreground text-xs">Piedra 0-10</div>
                    <div className="text-lg font-bold">{(pipeRawMaterialConsumption.stone_0_10_kg / 1000).toFixed(2)} Tn</div>
                  </div>
                  <div className="bg-muted/50 p-3 rounded-lg">
                    <div className="text-muted-foreground text-xs">Arena</div>
                    <div className="text-lg font-bold">{(pipeRawMaterialConsumption.sand_kg / 1000).toFixed(2)} Tn</div>
                  </div>
                  <div className="bg-muted/50 p-3 rounded-lg">
                    <div className="text-muted-foreground text-xs">Piedra 0-20</div>
                    <div className="text-lg font-bold">{(pipeRawMaterialConsumption.stone_0_20_kg / 1000).toFixed(2)} Tn</div>
                  </div>
                  <div className="bg-muted/50 p-3 rounded-lg">
                    <div className="text-muted-foreground text-xs">Total</div>
                    <div className="text-lg font-bold">{(pipeRawMaterialConsumption.total_kg / 1000).toFixed(2)} Tn</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
              </div>
            </>
      ) : (
        <div ref={reportRef} className="bg-white px-4 py-5 text-[13px]">
          {/* Encabezado del Informe */}
          <header className="mb-5 pb-4">
            {/* Periodo analizado */}
            <div className="text-xs text-gray-500 mb-2">
              Periodo analizado: {(() => {
                const dayNames = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]
                if (dailyMetrics.length === 0) return "Sin datos"
                const firstDay = new Date(dailyMetrics[0].date)
                const lastDay = new Date(dailyMetrics[dailyMetrics.length - 1].date)
                return `${dayNames[firstDay.getDay()]} a ${dayNames[lastDay.getDay()]}`
              })()}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <td style={{ verticalAlign: 'top' }}>
                    <h1 className="text-2xl font-bold text-gray-900">Informe Semanal</h1>
                  </td>
                  <td style={{ verticalAlign: 'top', textAlign: 'right' }}>
                    <div className="text-lg font-semibold text-gray-900">{formatDateForDisplay(weekStart)}</div>
                    <div className="text-sm text-gray-500">al {formatDateForDisplay(weekEnd)}</div>
                  </td>
                </tr>
                <tr>
                  <td colSpan={2} style={{ paddingTop: '8px' }}>
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium" style={{ backgroundColor: "#dcfce7", color: "#166534" }}>
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#22c55e" }}></span>
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

          {/* Alertas - Pico de Scrap */}
          {scrapOutlier && (
            <section className="mb-4">
              <div className="rounded-lg px-4 py-3 flex items-start gap-3" style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca" }}>
                <div className="flex-shrink-0 mt-0.5">
                  <svg className="h-5 w-5" style={{ color: "#dc2626" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold" style={{ color: "#991b1b" }}>Pico de Scrap Detectado</h3>
                  <p className="text-sm" style={{ color: "#b91c1c" }}>
                    El día <strong>{formatDateForDisplay(scrapOutlier.date)}</strong> se registró un scrap de <strong>{scrapOutlier.value.toFixed(1)}%</strong>, 
                    significativamente superior al promedio del periodo ({(100 - averageMetrics.quality).toFixed(1)}%).
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* Producción Acumulada */}
          <section className="mb-6">
            <h2 className="text-base font-semibold text-gray-900 mb-3">Producción Acumulada</h2>
            {(() => {
              const weeklyTarget = TARGETS.dailyTrays * 5 // Objetivo semanal (5 días)
              const accumulated = averageMetrics.traysProduced
              const dailyAvg = Math.round(accumulated / dailyMetrics.length)
              const expectedByNow = TARGETS.dailyTrays * dailyMetrics.length // Esperado hasta el día actual
              const percentOfWeekly = weeklyTarget > 0 ? ((accumulated / weeklyTarget) * 100).toFixed(1) : 0
              const gap = weeklyTarget - accumulated // Brecha para llegar al objetivo
              const isOnTrack = accumulated >= expectedByNow
              const dailyAvgMeetsTarget = dailyAvg >= TARGETS.dailyTrays
              
              return (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr className="border-b">
                        <th className="text-left py-2.5 px-4 font-medium text-gray-700">Concepto</th>
                        <th className="text-right py-2.5 px-4 font-medium text-gray-700">Bandejas</th>
                        <th className="text-center py-2.5 px-4 font-medium text-gray-700">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Promedio Diario */}
                      <tr className="border-b">
                        <td className="py-2.5 px-4 text-gray-900">Promedio Diario</td>
                        <td className="text-right py-2.5 px-4 font-semibold" style={{ color: dailyAvgMeetsTarget ? "#16a34a" : "#dc2626" }}>
                          {dailyAvg.toLocaleString()} <span className="text-gray-400 font-normal text-xs">/ {TARGETS.dailyTrays.toLocaleString()} obj.</span>
                        </td>
                        <td className="text-center py-2.5 px-4">
                          {prevWeekAvg ? (
                            <span className="inline-flex items-center gap-1 text-sm" style={{ color: dailyAvg >= prevWeekAvg.avgTrays ? '#16a34a' : '#dc2626' }}>
                              {prevWeekAvg.avgTrays > 0 ? (((dailyAvg - prevWeekAvg.avgTrays) / prevWeekAvg.avgTrays) * 100).toFixed(1) : 0}%
                              {dailyAvg >= prevWeekAvg.avgTrays ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                              <span className="text-xs text-gray-400">vs sem. ant.</span>
                            </span>
                          ) : (
                            <span style={{ color: dailyAvgMeetsTarget ? "#16a34a" : "#dc2626" }}>
                              {dailyAvgMeetsTarget ? "En objetivo" : "Bajo objetivo"}
                            </span>
                          )}
                        </td>
                      </tr>
                      <tr className="border-b bg-gray-50">
                        <td className="py-2.5 px-4 text-gray-900">Objetivo Semanal</td>
                        <td className="text-right py-2.5 px-4 font-medium">{weeklyTarget.toLocaleString()}</td>
                        <td className="text-center py-2.5 px-4 text-gray-500">100%</td>
                      </tr>
                      <tr className="border-b">
                        <td className="py-2.5 px-4 font-semibold text-gray-900">Acumulado ({dailyMetrics.length} días)</td>
                        <td className="text-right py-2.5 px-4 font-bold" style={{ color: isOnTrack ? "#16a34a" : "#dc2626" }}>
                          {accumulated.toLocaleString()}
                        </td>
                        <td className="text-center py-2.5 px-4 font-semibold" style={{ color: isOnTrack ? "#16a34a" : "#dc2626" }}>
                          {percentOfWeekly}%
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-4 text-gray-900">Esperado hasta hoy</td>
                        <td className="text-right py-2.5 px-4 font-medium">{expectedByNow.toLocaleString()}</td>
                        <td className="text-center py-2.5 px-4">
                          {(() => {
                            const diff = accumulated - expectedByNow
                            if (diff >= 0) {
                              return <span style={{ color: "#16a34a" }}>{diff.toLocaleString()} por encima</span>
                            } else {
                              return <span style={{ color: "#dc2626" }}>{Math.abs(diff).toLocaleString()} por debajo</span>
                            }
                          })()}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )
            })()}
          </section>

          {/* Scrap y Paradas */}
          <section className="mb-6">
            <h2 className="text-base font-semibold text-gray-900 mb-3">Scrap y Paradas</h2>
            <div className="grid grid-cols-2 gap-4">
              {/* Scrap */}
              <div className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Scrap Promedio</span>
                  <span className="text-lg font-bold" style={getStatusColor(100 - averageMetrics.quality, 100 - TARGETS.quality, false)}>
                    {(100 - averageMetrics.quality).toFixed(1)}%
                  </span>
                </div>
                <div className="text-xs text-gray-500 mb-3">Objetivo: {`<`}{(100 - TARGETS.quality).toFixed(1)}%</div>
                
                {/* Tendencia */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-gray-500">Tendencia:</span>
                  <span className="inline-flex items-center gap-1 text-sm font-medium" style={{ 
                    color: scrapTrend === "decreasing" ? '#16a34a' : scrapTrend === "increasing" ? '#dc2626' : '#6b7280' 
                  }}>
                    {scrapTrend === "stable" ? "Estable" : scrapTrend === "increasing" ? "Creciente" : "Decreciente"}
                    {scrapTrend === "decreasing" && <TrendingDown className="h-3 w-3" />}
                    {scrapTrend === "increasing" && <TrendingUp className="h-3 w-3" />}
                    {scrapTrend === "stable" && <Minus className="h-3 w-3" />}
                  </span>
                </div>
                
                {/* Pico si existe */}
                {scrapOutlier && (
                  <div className="mt-2 px-2 py-1.5 rounded text-xs" style={{ backgroundColor: "#fef3c7", color: "#92400e" }}>
                    <strong>Pico detectado:</strong> {scrapOutlier.value.toFixed(1)}% el {formatDateForDisplay(scrapOutlier.date)}
                  </div>
                )}
              </div>
              
              {/* Paradas */}
              <div className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Total Paradas</span>
                  <span className="text-lg font-bold" style={{ color: "#dc2626" }}>{totalDowntime} min</span>
                </div>
                <div className="text-xs text-gray-500 mb-3">
                  Promedio: {Math.round(totalDowntime / dailyMetrics.length)} min/día
                </div>
                
                {/* Comparación semana anterior */}
                {prevWeekAvg && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">vs Sem. Anterior:</span>
                    <span className="inline-flex items-center gap-1 text-sm font-medium" style={{ color: totalDowntime <= prevWeekAvg.downtime ? '#16a34a' : '#dc2626' }}>
                      {prevWeekAvg.downtime > 0 ? ((totalDowntime - prevWeekAvg.downtime) / prevWeekAvg.downtime * 100).toFixed(0) : 0}%
                      {totalDowntime <= prevWeekAvg.downtime ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Análisis de Paradas - igual que mensual con page break para PDF */}
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

              {/* Detalle de paradas con comentarios y minutos */}
              <div className="space-y-5">
                {paretoDowntimes.map((dt, idx) => (
                  <div key={idx} className="flex items-start gap-4">
                    <span className="flex items-center justify-center w-8 h-8 rounded-full text-base font-bold flex-shrink-0 mt-0.5" style={{ backgroundColor: "#fee2e2", color: "#b91c1c" }}>
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-lg font-semibold text-gray-900">{dt.reason}</span>
                        <div className="flex items-center gap-4 flex-shrink-0 ml-4">
                          <span className="text-lg font-bold" style={{ color: "#dc2626" }}>{dt.minutes} min</span>
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

              {/* Total */}
              <div className="mt-8 flex items-center justify-between bg-gray-900 text-white rounded-lg px-6 py-4">
                <span className="text-lg font-semibold">Total Paradas</span>
                <span className="text-2xl font-bold">{totalDowntime} min</span>
              </div>
            </section>
          )}

          {/* Consumo de Materia Prima */}
          {rawMaterialConsumption && rawMaterialConsumption.total_kg > 0 && (
            <section className="mb-6" style={{ pageBreakBefore: paretoDowntimes.length > 0 ? 'auto' : 'avoid' }}>
              <h2 className="text-base font-semibold text-gray-900 mb-3">Consumo de Materia Prima</h2>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="border-b">
                      <th className="text-left py-2.5 px-4 font-medium text-gray-700">Material</th>
                      <th className="text-right py-2.5 px-4 font-medium text-gray-700">Consumo (Tn)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b">
                      <td className="py-2 px-4 text-gray-900">Cemento</td>
                      <td className="text-right py-2 px-4 font-medium">{(rawMaterialConsumption.cement_kg / 1000).toFixed(2)}</td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 px-4 text-gray-900">Arena</td>
                      <td className="text-right py-2 px-4 font-medium">{(rawMaterialConsumption.sand_kg / 1000).toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-4 text-gray-900">Piedra 0-10</td>
                      <td className="text-right py-2 px-4 font-medium">{(rawMaterialConsumption.stone_0_10_kg / 1000).toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Pie de página */}
          <footer className="pt-4 text-center text-[10px] text-gray-400">
            <p>Generado el {new Date().toLocaleDateString('es-AR')} - SILKE S.A. - Sistema de Control de Producción</p>
          </footer>
        </div>
      )}
        </div>
      )}
    </div>
  )
}
