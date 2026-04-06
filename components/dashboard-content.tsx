"use client"

import { useEffect, useState, useMemo } from "react"
import { getSupabase } from "@/lib/supabase"
import { usePlant } from "@/lib/plant-context"
import { calculateReportMetrics, calculatePipeMetrics, TARGETS, type ReportMetrics, type PipeReportMetrics } from "@/lib/report-utils"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, Legend, ReferenceLine, Area, AreaChart,
} from "recharts"
import { ArrowUpRight, ArrowDownRight, Calendar, Clock, Factory, Cylinder, TrendingUp, Minus, ChevronLeft, ChevronRight, X, CheckCircle2, XCircle, CalendarDays, Tv2 } from "lucide-react"
import { ProductionPlanning } from "@/components/production-planning"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DailyProductionModal } from "@/components/daily-production-modal"

// ── Types ──────────────────────────────────────────────────────────────────

interface MonthData {
  blockRecords: any[]
  pipeRecords: any[]
  blockMetrics: ReportMetrics[]
  pipeMetrics: PipeReportMetrics | null
  pipeDailyData: { date: string; shift: number; totalUnits: number; totalWeightTn: number; downtimeMin: number; operatorsCount: number; availableMinutes: number; effectiveMinutes: number; productionBySize: Record<string, number> }[]
  blockDowntimes: { reason: string; minutes: number }[]
  pipeDowntimes: { reason: string; minutes: number }[]
  pipeTargets: Record<string, number>
  pipeDailyTargets: Record<number, number> // day -> total planificado ese dia
  }

type ActiveLine = "bloques" | "canos" | "produccion-diaria"
type BlockChartMetric = "bandejas" | "descartados" | "paradas" | "horasProducidas"
type PipeChartMetric = "tnHora" | "canos" | "tnTotal" | "paradas" | "canosVsPlan"
type PipeFilter = "todos" | "3" | "4"
type PipeShiftFilter = "todos" | "1" | "2"

const MONTH_NAMES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

const PIPE_WEIGHTS_DEFAULT: Record<string, number> = {
  "300": 95, "400": 150, "500": 220, "600": 310, "800": 520, "1000": 1080, "1200": 1100
}

// ── Delta Badge ────────────────────────────────────────────────────────────

function DeltaBadge({ current, previous, unit = "", invert = false }: { current: number; previous: number; unit?: string; invert?: boolean }) {
  if (previous === 0) return <span className="text-[10px] text-muted-foreground">sin ref.</span>
  const diff = current - previous
  const pct = ((diff / previous) * 100).toFixed(1)
  const isPositive = invert ? diff < 0 : diff > 0
  const isNeutral = Math.abs(diff) < 0.01

  if (isNeutral) return (
    <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground font-medium">
      <Minus className="w-3 h-3" /> 0%
    </span>
  )

  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
      {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {diff > 0 ? '+' : ''}{pct}%
    </span>
  )
}

// ── Comparison Card ────────────────────────────────────────────────────────

function ComparisonCard({ label, current, previous, unit, decimals = 1, invert = false }: {
  label: string; current: number; previous: number; unit: string; decimals?: number; invert?: boolean
}) {
  return (
    <div className="bg-card rounded-lg border border-border p-4 shadow-sm">
      <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1 font-medium">{label}</div>
      <div className="text-2xl font-bold text-foreground">{current.toFixed(decimals)}<span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span></div>
      <div className="flex items-center gap-2 mt-1">
        <DeltaBadge current={current} previous={previous} unit={unit} invert={invert} />
        <span className="text-[10px] text-muted-foreground">vs mes ant. ({previous.toFixed(decimals)})</span>
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export function DashboardContent() {
  const { selectedPlant, plantName, isPlantLoaded } = usePlant()
  const now = new Date()
  const [selectedMonthIdx, setSelectedMonthIdx] = useState(now.getMonth())
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [loading, setLoading] = useState(true)
  const [currentMonth, setCurrentMonth] = useState<MonthData | null>(null)
  const [prevMonth, setPrevMonth] = useState<MonthData | null>(null)
  const [pipeWeights, setPipeWeights] = useState<Record<string, number>>(PIPE_WEIGHTS_DEFAULT)
  const [showCumplimientoDetail, setShowCumplimientoDetail] = useState(false)
  
  // Determinar lineas disponibles segun planta:
  // Villa Rosa y Silke: solo canos | Ranchos: usa otro dashboard
  const availableLines = useMemo(() =>
    ["canos"] as const
  , [selectedPlant])

  // Siempre mostrar canos (bloques discontinuado en Silke)
  const [activeLine, setActiveLine] = useState<ActiveLine>("canos")

  // La linea efectiva: si está en produccion-diaria, consideramos canos para los datos
  const effectiveLine: ActiveLine = activeLine === "produccion-diaria" ? "canos" : activeLine

  // Mantener activeLine en canos cuando cambia la planta
  useEffect(() => {
    setActiveLine("canos")
  }, [selectedPlant])
  const [blockChartMetric, setBlockChartMetric] = useState<BlockChartMetric>("bandejas")
  const [pipeChartMetric, setPipeChartMetric] = useState<PipeChartMetric>("tnHora")
  const [pipeFilter, setPipeFilter] = useState<PipeFilter>("todos")
  const [pipeShiftFilter, setPipeShiftFilter] = useState<PipeShiftFilter>("todos")
  const [pipeMoldFilter, setPipeMoldFilter] = useState<string>("todos")
  useEffect(() => {
    // Solo cargar datos cuando la planta esté cargada del localStorage
    if (!isPlantLoaded) return
    
    let retries = 0
    const attempt = () => {
      loadData(selectedMonthIdx, selectedYear).catch(() => {
        if (retries < 3) {
          retries++
          setTimeout(attempt, 1000)
        }
      })
    }
    attempt()
  }, [selectedMonthIdx, selectedYear, selectedPlant, isPlantLoaded])

  function goToPrevMonth() {
    if (selectedMonthIdx === 0) {
      setSelectedMonthIdx(11)
      setSelectedYear(y => y - 1)
    } else {
      setSelectedMonthIdx(m => m - 1)
    }
  }

  function goToNextMonth() {
    const isCurrentMonth = selectedMonthIdx === now.getMonth() && selectedYear === now.getFullYear()
    if (isCurrentMonth) return
    if (selectedMonthIdx === 11) {
      setSelectedMonthIdx(0)
      setSelectedYear(y => y + 1)
    } else {
      setSelectedMonthIdx(m => m + 1)
    }
  }

  const isCurrentMonth = selectedMonthIdx === now.getMonth() && selectedYear === now.getFullYear()
  const prevMonthIdx = selectedMonthIdx === 0 ? 11 : selectedMonthIdx - 1
  const prevMonthYear = selectedMonthIdx === 0 ? selectedYear - 1 : selectedYear

  async function loadData(monthIdx: number, year: number) {
    setLoading(true)
    let supabase: ReturnType<typeof getSupabase>
    try {
      supabase = getSupabase()
    } catch {
      setLoading(false)
      throw new Error("Supabase not ready")
    }

    // Load pipe weights
    const { data: pipeProducts } = await supabase
      .from("product_config")
      .select("product_code, piece_weight_kg")
      .eq("line_type", "caños")
      .eq("is_active", true)

    const weights = { ...PIPE_WEIGHTS_DEFAULT }
    if (pipeProducts) {
      pipeProducts.forEach((p: any) => {
        const match = p.product_code?.match(/CC(\d+)/)
        if (match && p.piece_weight_kg) weights[match[1]] = p.piece_weight_kg
      })
    }
    setPipeWeights(weights)

    // Date ranges — use real last day of each month to avoid invalid dates like Feb 31
    const lastDayOfMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate()
    const cmStart = `${year}-${String(monthIdx + 1).padStart(2, "0")}-01`
    const cmEnd = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(lastDayOfMonth(year, monthIdx)).padStart(2, "0")}`
    const pmYear = monthIdx === 0 ? year - 1 : year
    const pmIdx = monthIdx === 0 ? 11 : monthIdx - 1
    const pmStart = `${pmYear}-${String(pmIdx + 1).padStart(2, "0")}-01`
    const pmEnd = `${pmYear}-${String(pmIdx + 1).padStart(2, "0")}-${String(lastDayOfMonth(pmYear, pmIdx)).padStart(2, "0")}`

    // Fetch all data in parallel (including production planning for pipe targets)
    // Filtrar por plant_id para mostrar solo datos de la planta seleccionada
    // Mapear plant_id a plant value para la consulta
    // villa-rosa -> villa-rosa, silke -> silke, olivera -> olivera (o silke como fallback)
    const plantValue = selectedPlant === "villa-rosa" ? "villa-rosa" : selectedPlant === "olivera" ? "silke" : selectedPlant
    
    const [cmBlocks, cmPipes, pmBlocks, pmPipes, cmPlanning] = await Promise.all([
      supabase.from("block_production").select("*, block_downtime(*)").gte("production_date", cmStart).lte("production_date", cmEnd).order("production_date"),
      supabase.from("pipe_production").select("*, pipe_downtime(*), pipe_mold_breakage(*)").eq("plant", plantValue).gte("production_date", cmStart).lte("production_date", cmEnd).order("production_date"),
      supabase.from("block_production").select("*, block_downtime(*)").gte("production_date", pmStart).lte("production_date", pmEnd).order("production_date"),
      supabase.from("pipe_production").select("*, pipe_downtime(*), pipe_mold_breakage(*)").eq("plant", plantValue).gte("production_date", pmStart).lte("production_date", pmEnd).order("production_date"),
      supabase.from("production_planning").select("*").eq("year", year).eq("month", monthIdx + 1),
    ])

    // Process pipe targets from planning
    // Filtrar por tamaños de caño segun planta: Villa Rosa = 800, 1000, 1200 | Silke = 300, 400, 500, 600
    const SILKE_SIZES = ["300", "400", "500", "600"]
    const VILLA_ROSA_SIZES = ["800", "1000", "1200"]
    const plantSizes = selectedPlant === "villa-rosa" ? VILLA_ROSA_SIZES : SILKE_SIZES
    
    const pipeTargets: Record<string, number> = {}
    // Guardar planificacion diaria para calcular cumplimiento por dia
    const pipeDailyTargets: Record<number, number> = {} // day -> total planificado ese dia
    
    if (cmPlanning.data) {
      cmPlanning.data.forEach((row: any) => {
        // Solo incluir tamaños correspondientes a la planta
        if (!plantSizes.includes(row.pipe_size)) return
        let total = 0
        for (let day = 1; day <= 31; day++) {
          const dayValue = row[`day_${day}`] || 0
          total += dayValue
          pipeDailyTargets[day] = (pipeDailyTargets[day] || 0) + dayValue
        }
        if (total > 0) pipeTargets[row.pipe_size] = total
      })
    }

    setCurrentMonth(processMonthData(cmBlocks.data || [], cmPipes.data || [], weights, pipeTargets, pipeDailyTargets, plantSizes))
    setPrevMonth(processMonthData(pmBlocks.data || [], pmPipes.data || [], weights, {}, {}, []))
    setLoading(false)
  }

  function processMonthData(blockRecords: any[], pipeRecords: any[], weights: Record<string, number>, pipeTargets: Record<string, number> = {}, pipeDailyTargets: Record<number, number> = {}, plantSizes: string[] = []): MonthData {
    const blockMetrics = blockRecords.map(r => calculateReportMetrics(r))
    const pipeMetrics = pipeRecords.length > 0 ? calculatePipeMetrics(pipeRecords, weights) : null

    // Pipe daily data for charts
    const PIPE_SIZES = ["300", "400", "500", "600", "800", "1000", "1200"]
    // Usar plantSizes si se pasó, sino todos los tamaños
    const sizesToCount = plantSizes.length > 0 ? plantSizes : PIPE_SIZES
    const pipeDailyData = pipeRecords.map(record => {
      let totalUnits = 0
      let totalWeightKg = 0
      const productionBySize: Record<string, number> = {}
      for (const size of sizesToCount) {
        const s = (record[`cc${size}_simples`] || 0) + (record[`cc${size}_rotura`] || 0) + (record[`cc${size}_armado`] || 0) + (record[`cc${size}_rotura_armado`] || 0)
        totalUnits += s
        totalWeightKg += s * (weights[size] || 0)
        if (s > 0) productionBySize[size] = s
      }

      const tprBase = record.shift === 1 ? 560 : 500
      const cleaning = record.cleaning_minutes || 0
      let dtMin = 0
      let extMin = 0
      for (const dt of (record.pipe_downtime || [])) {
        const cat = (dt.downtime_category || "").toLowerCase()
        const reason = (dt.custom_reason || "").toLowerCase()
        if (cat.includes("planificad") || reason.includes("capacitación") || reason.includes("capacitacion") || reason.includes("reunión") || reason.includes("reunion")) continue
        dtMin += dt.minutes || 0
        if (cat.includes("externo") || reason.includes("energía") || reason.includes("energia") || reason.includes("piedra")) extMin += dt.minutes || 0
      }
      const available = tprBase - cleaning - extMin
      const effective = Math.max(0, available - (dtMin - extMin))
      return {
        date: record.production_date,
        shift: record.shift || 1,
        totalUnits,
        totalWeightTn: totalWeightKg / 1000,
        downtimeMin: dtMin,
        operatorsCount: record.operators_count || 3,
        availableMinutes: available,
        effectiveMinutes: effective,
        productionBySize,
      }
    })

    // Block downtimes aggregated
    const blockDtMap = new Map<string, number>()
    blockRecords.forEach(r => {
      (r.block_downtime || []).forEach((dt: any) => {
        const reason = dt.custom_reason || "Sin especificar"
        blockDtMap.set(reason, (blockDtMap.get(reason) || 0) + (dt.minutes || 0))
      })
    })
    const blockDowntimes = Array.from(blockDtMap.entries()).map(([reason, minutes]) => ({ reason, minutes })).sort((a, b) => b.minutes - a.minutes).slice(0, 5)

    // Pipe downtimes aggregated
    const pipeDtMap = new Map<string, number>()
    pipeRecords.forEach(r => {
      (r.pipe_downtime || []).forEach((dt: any) => {
        const reason = dt.custom_reason || "Sin especificar"
        pipeDtMap.set(reason, (pipeDtMap.get(reason) || 0) + (dt.minutes || 0))
      })
    })
    const pipeDowntimes = Array.from(pipeDtMap.entries()).map(([reason, minutes]) => ({ reason, minutes })).sort((a, b) => b.minutes - a.minutes).slice(0, 5)

    return { blockRecords, pipeRecords, blockMetrics, pipeMetrics, pipeDailyData, blockDowntimes, pipeDowntimes, pipeTargets, pipeDailyTargets }
  }

  // ── Block chart data ──────────────────────────────────────────────────
  const blockChartData = useMemo(() => {
    if (!currentMonth) return []
    return currentMonth.blockMetrics.map((m, idx) => {
      const record = currentMonth.blockRecords[idx]
      const downtimes = (record?.block_downtime || []) as { custom_reason?: string; minutes?: number; comments?: string; downtime_category?: string }[]
      const topStop = downtimes.length > 0
        ? downtimes.sort((a, b) => (b.minutes || 0) - (a.minutes || 0))[0]
        : null
      return {
        date: new Date(m.date + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }),
        fullDate: m.date,
        bandejas: m.traysProduced,
        descartados: m.scrapUnits,
        paradas: m.totalDowntimeMinutes,
        horasProducidas: Number(m.productionHours.toFixed(1)),
        oee: m.oee,
        quality: m.quality,
        observations: record?.observations || "",
        topStopReason: topStop?.custom_reason || "",
        topStopMinutes: topStop?.minutes || 0,
        topStopComment: topStop?.comments || "",
        totalStops: downtimes.length,
      }
    })
  }, [currentMonth])

  // ── Pipe chart data (with filters) ────────────────────────────────────
  const pipeChartData = useMemo(() => {
    if (!currentMonth) return []
    let data = currentMonth.pipeDailyData
    if (pipeShiftFilter !== "todos") data = data.filter(d => d.shift === Number(pipeShiftFilter))
    if (pipeFilter !== "todos") data = data.filter(d => d.operatorsCount === Number(pipeFilter))
    if (pipeMoldFilter !== "todos") data = data.filter(d => d.productionBySize[pipeMoldFilter] != null)

    return data.map(d => {
      const availHours = d.availableMinutes / 60
      return {
        date: new Date(d.date + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }),
        tnHora: availHours > 0 ? Number((d.totalWeightTn / availHours).toFixed(2)) : 0,
        canos: d.totalUnits,
        tnTotal: Number(d.totalWeightTn.toFixed(2)),
        paradas: d.downtimeMin,
        shift: d.shift,
        operators: d.operatorsCount,
        productionBySize: d.productionBySize,
      }
    })
  }, [currentMonth, pipeShiftFilter, pipeFilter, pipeMoldFilter])

  // ── Pipe mold options ─────────────────────────────────────────────────
  const pipeMoldOptions = useMemo(() => {
    if (!currentMonth) return []
    const sizes = new Set<string>()
    currentMonth.pipeDailyData.forEach(d => {
      Object.keys(d.productionBySize).forEach(s => sizes.add(s))
    })
    return Array.from(sizes).sort((a, b) => Number(a) - Number(b))
  }, [currentMonth])

  // ── Aggregate stats ───────────────────────────────────────────────────
  const cmBlockStats = useMemo(() => {
    if (!currentMonth || currentMonth.blockMetrics.length === 0) return null
    const m = currentMonth.blockMetrics
    const days = m.length
    const avgBandejas = m.reduce((s, x) => s + x.traysProduced, 0) / days
    const avgDowntime = m.reduce((s, x) => s + x.totalDowntimeMinutes, 0) / days
    const avgOEE = m.reduce((s, x) => s + x.oee, 0) / days
    const avgRacks = m.reduce((s, x) => s + x.racksPerHour, 0) / days
    const totalDowntime = m.reduce((s, x) => s + x.totalDowntimeMinutes, 0)
    return { days, avgBandejas, avgDowntime, avgOEE, avgRacks, totalDowntime }
  }, [currentMonth])

  const pmBlockStats = useMemo(() => {
    if (!prevMonth || prevMonth.blockMetrics.length === 0) return null
    const m = prevMonth.blockMetrics
    const days = m.length
    const avgBandejas = m.reduce((s, x) => s + x.traysProduced, 0) / days
    const avgDowntime = m.reduce((s, x) => s + x.totalDowntimeMinutes, 0) / days
    const avgOEE = m.reduce((s, x) => s + x.oee, 0) / days
    const avgRacks = m.reduce((s, x) => s + x.racksPerHour, 0) / days
    return { days, avgBandejas, avgDowntime, avgOEE, avgRacks }
  }, [prevMonth])

  const cmPipeStats = useMemo(() => {
    if (!currentMonth || currentMonth.pipeDailyData.length === 0) return null
    const d = currentMonth.pipeDailyData
    const days = new Set(d.map(x => x.date)).size
    const totalTn = d.reduce((s, x) => s + x.totalWeightTn, 0)
    const totalAvailH = d.reduce((s, x) => s + x.availableMinutes, 0) / 60
    const avgDowntime = d.reduce((s, x) => s + x.downtimeMin, 0) / days
    const tnPerHour = totalAvailH > 0 ? totalTn / totalAvailH : 0
    const totalDowntime = d.reduce((s, x) => s + x.downtimeMin, 0)
    const totalUnits = d.reduce((s, x) => s + x.totalUnits, 0)
    const avgCanos = totalUnits / days
    const avgTnTotal = totalTn / days
    const avgTnHora = tnPerHour
    return { days, avgDowntime, tnPerHour, totalDowntime, totalTn, totalUnits, avgCanos, avgTnTotal, avgTnHora }
  }, [currentMonth])

  const pmPipeStats = useMemo(() => {
    if (!prevMonth || prevMonth.pipeDailyData.length === 0) return null
    const d = prevMonth.pipeDailyData
    const days = new Set(d.map(x => x.date)).size
    const totalTn = d.reduce((s, x) => s + x.totalWeightTn, 0)
    const totalAvailH = d.reduce((s, x) => s + x.availableMinutes, 0) / 60
    const avgDowntime = d.reduce((s, x) => s + x.downtimeMin, 0) / days
    const tnPerHour = totalAvailH > 0 ? totalTn / totalAvailH : 0
    return { days, avgDowntime, tnPerHour, totalTn }
  }, [prevMonth])

  // ── Filtered pipe averages (for reference lines based on visible data) ──
  const filteredPipeAvg = useMemo(() => {
    if (pipeChartData.length === 0) return null
    const n = pipeChartData.length
    const avgTnHora = pipeChartData.reduce((s, d) => s + d.tnHora, 0) / n
    const avgCanos = pipeChartData.reduce((s, d) => s + d.canos, 0) / n
    const avgTnTotal = pipeChartData.reduce((s, d) => s + d.tnTotal, 0) / n
    const avgParadas = pipeChartData.reduce((s, d) => s + d.paradas, 0) / n
    return { avgTnHora, avgCanos, avgTnTotal, avgParadas }
  }, [pipeChartData])

  // ── Pipe vs Plan aggregated by size ────────────────────────────────────
  const pipeVsPlanData = useMemo(() => {
    if (!currentMonth) return []
    const targets = currentMonth.pipeTargets
    // Filtrar por tamaños de caño segun planta: Villa Rosa = 800, 1000, 1200 | Silke = 300, 400, 500, 600
    const SILKE_SIZES = ["300", "400", "500", "600"]
    const VILLA_ROSA_SIZES = ["800", "1000", "1200"]
    const plantSizes = selectedPlant === "villa-rosa" ? VILLA_ROSA_SIZES : SILKE_SIZES
    // Aggregate produced by size
    const produced: Record<string, number> = {}
    currentMonth.pipeDailyData.forEach(d => {
      for (const [size, qty] of Object.entries(d.productionBySize)) {
        if (plantSizes.includes(size)) {
          produced[size] = (produced[size] || 0) + qty
        }
      }
    })
    return plantSizes
      .filter(size => (produced[size] || 0) > 0 || (targets[size] || 0) > 0)
      .map(size => ({
        size: `CC${size}`,
        producido: produced[size] || 0,
        planificado: targets[size] || 0,
        cumplimiento: targets[size] ? Math.round(((produced[size] || 0) / targets[size]) * 100) : 0,
      }))
  }, [currentMonth, selectedPlant])

  // ── Render ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <main className="min-h-screen bg-background">
        <div className="flex items-center justify-center h-96">
          <div className="text-muted-foreground text-sm">Cargando datos del mes...</div>
        </div>
      </main>
    )
  }

  const chartMetricLabels: Record<BlockChartMetric, string> = {
    bandejas: "Bandejas", descartados: "Bloques descartados", paradas: "Min. paradas", horasProducidas: "Horas producidas"
  }
  const pipeChartLabels: Record<PipeChartMetric, string> = {
    tnHora: "Tn/Hora disp.", canos: "Canos producidos", tnTotal: "Tn producidas", paradas: "Min. paradas", canosVsPlan: "Real vs Plan"
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">

        {/* Header */}
        <header className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-foreground tracking-tight">Dashboard de Produccion - {plantName || "Planta"}</h1>
              <p className="text-xs text-muted-foreground mt-0.5">Acumulado mensual</p>
            </div>

            <div className="flex items-center gap-3">
              {/* Month/Year Selector */}
              <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
                <button
                  onClick={goToPrevMonth}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-card transition-all"
                  aria-label="Mes anterior"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-1.5 px-2 min-w-[140px] justify-center">
                  <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                  <select
                    value={selectedMonthIdx}
                    onChange={e => setSelectedMonthIdx(Number(e.target.value))}
                    className="bg-transparent text-xs font-medium text-foreground cursor-pointer focus:outline-none appearance-none"
                  >
                    {MONTH_NAMES.map((name, idx) => (
                      <option key={idx} value={idx}>{name}</option>
                    ))}
                  </select>
                  <select
                    value={selectedYear}
                    onChange={e => setSelectedYear(Number(e.target.value))}
                    className="bg-transparent text-xs font-medium text-foreground cursor-pointer focus:outline-none appearance-none"
                  >
                    {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 4 + i).map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={goToNextMonth}
                  disabled={isCurrentMonth}
                  className={`p-1.5 rounded-md transition-all ${isCurrentMonth ? 'text-muted-foreground/30 cursor-not-allowed' : 'text-muted-foreground hover:text-foreground hover:bg-card'}`}
                  aria-label="Mes siguiente"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Line Tabs */}
              <div className="flex items-center gap-1.5 bg-muted rounded-lg p-1">
                {availableLines.includes("bloques") && (
                  <button
                    onClick={() => setActiveLine("bloques")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      effectiveLine === "bloques"
                        ? "bg-card text-foreground shadow-sm border border-border"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Factory className="w-3.5 h-3.5" />
                    Bloques
                  </button>
                )}
                <button
                  onClick={() => setActiveLine("canos")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    effectiveLine === "canos"
                      ? "bg-card text-foreground shadow-sm border border-border"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Cylinder className="w-3.5 h-3.5" />
                  Canos
                </button>
                <button
                  onClick={() => setActiveLine("produccion-diaria")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    activeLine === "produccion-diaria"
                      ? "bg-card text-foreground shadow-sm border border-border"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Tv2 className="w-3.5 h-3.5" />
                  Prod. Diaria
                </button>
              </div>

              {/* Boton de Planificacion - Solo para canos */}
              {effectiveLine === "canos" && (
                <ProductionPlanning lineType="caños" />
              )}
            </div>
          </div>
        </header>

        {/* ═══ BLOQUES ═══════════════════════════════════════════════════ */}
        {effectiveLine === "bloques" && (
          <>
            {/* Month comparison cards */}
            {cmBlockStats && (
              <section className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
                  <h2 className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">
                    Comparacion con {MONTH_NAMES[prevMonthIdx]}
                  </h2>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <ComparisonCard
                    label="Bandejas promedio/dia"
                    current={cmBlockStats.avgBandejas}
                    previous={pmBlockStats?.avgBandejas || 0}
                    unit="band."
                    decimals={0}
                  />
                  <ComparisonCard
                    label="Min. parada prom./dia"
                    current={cmBlockStats.avgDowntime}
                    previous={pmBlockStats?.avgDowntime || 0}
                    unit="min"
                    decimals={0}
                    invert
                  />
                  <ComparisonCard
                    label="OEE promedio"
                    current={cmBlockStats.avgOEE}
                    previous={pmBlockStats?.avgOEE || 0}
                    unit="%"
                  />
                  <ComparisonCard
                    label="Racks/Hora promedio"
                    current={cmBlockStats.avgRacks}
                    previous={pmBlockStats?.avgRacks || 0}
                    unit="r/h"
                    decimals={2}
                  />
                </div>
              </section>
            )}

            {/* Days produced + Total downtime */}
            {cmBlockStats && (
              <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="bg-primary/5 border border-primary/15 rounded-lg p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Calendar className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-foreground">{cmBlockStats.days}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Dias producidos</div>
                  </div>
                </div>
                <div className="bg-destructive/5 border border-destructive/15 rounded-lg p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center">
                    <Clock className="w-5 h-5 text-destructive" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-foreground">{cmBlockStats.totalDowntime}<span className="text-sm font-normal text-muted-foreground ml-1">min</span></div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Total paradas del mes</div>
                  </div>
                </div>
              </div>
            )}

            {/* Interactive Chart + Top Stops */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
              <div className="lg:col-span-2 bg-card rounded-lg border border-border p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-foreground">Tendencia diaria</h3>
                  <div className="flex gap-1">
                    {(["bandejas", "descartados", "paradas", "horasProducidas"] as BlockChartMetric[]).map(m => (
                      <button
                        key={m}
                        onClick={() => setBlockChartMetric(m)}
                        className={`px-2.5 py-1 rounded text-[10px] font-medium transition-all ${
                          blockChartMetric === m
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {chartMetricLabels[m]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="h-64">
                  {blockChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={blockChartData}>
                        <defs>
                          <linearGradient id="blockFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={blockChartMetric === "descartados" || blockChartMetric === "paradas" ? "#dc2626" : "#1e3a5f"} stopOpacity={0.15} />
                            <stop offset="95%" stopColor={blockChartMetric === "descartados" || blockChartMetric === "paradas" ? "#dc2626" : "#1e3a5f"} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                        <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload || !payload[0]) return null
                            const d = payload[0].payload as (typeof blockChartData)[0]
                            const avgBandejas = cmBlockStats ? cmBlockStats.avgBandejas : 0
                            const avgDowntime = cmBlockStats ? cmBlockStats.avgDowntime : 0
                            const avgDescartados = blockChartData.length > 0
                              ? blockChartData.reduce((s, x) => s + x.descartados, 0) / blockChartData.length
                              : 0

                            // Build intelligent analysis
                            const insights: string[] = []
                            if (d.bandejas === 0) {
                              insights.push("No hubo produccion este dia")
                            } else {
                              if (d.bandejas < avgBandejas * 0.7) insights.push(`Produccion muy baja (${Math.round((1 - d.bandejas/avgBandejas)*100)}% debajo del promedio)`)
                              else if (d.bandejas < avgBandejas * 0.9) insights.push(`Produccion por debajo del promedio`)
                              else if (d.bandejas > avgBandejas * 1.1) insights.push(`Produccion por encima del promedio`)
                            }
                            if (d.paradas > avgDowntime * 1.5 && d.paradas > 0) insights.push(`Paradas elevadas: ${d.paradas} min (prom. ${Math.round(avgDowntime)} min)`)
                            if (d.descartados > avgDescartados * 2 && d.descartados > 0) insights.push(`Descarte elevado: ${d.descartados} bloques (prom. ${Math.round(avgDescartados)})`)
                            if (d.topStopReason && d.topStopMinutes > 15) insights.push(`Parada ppal: ${d.topStopReason} (${d.topStopMinutes} min)`)
                            if (d.topStopComment) insights.push(`"${d.topStopComment}"`)
                            if (d.observations) insights.push(`Obs: ${d.observations}`)

                            return (
                              <div className="bg-card border border-border rounded-lg shadow-lg p-3 max-w-[280px]">
                                <div className="text-xs font-semibold text-foreground mb-1.5">{d.date}</div>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] mb-2">
                                  <span className="text-muted-foreground">Bandejas:</span>
                                  <span className="font-semibold text-foreground">{d.bandejas}</span>
                                  <span className="text-muted-foreground">Descartados:</span>
                                  <span className="font-semibold text-foreground">{d.descartados}</span>
                                  <span className="text-muted-foreground">Paradas:</span>
                                  <span className="font-semibold text-foreground">{d.paradas} min</span>
                                  <span className="text-muted-foreground">Horas prod.:</span>
                                  <span className="font-semibold text-foreground">{d.horasProducidas}h</span>
                                  <span className="text-muted-foreground">OEE:</span>
                                  <span className="font-semibold text-foreground">{d.oee}%</span>
                                </div>
                                {insights.length > 0 && (
                                  <div className="border-t border-border pt-1.5 mt-1.5 space-y-0.5">
                                    {insights.map((insight, i) => (
                                      <p key={i} className="text-[10px] text-muted-foreground leading-snug">{insight}</p>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey={blockChartMetric}
                          stroke={blockChartMetric === "descartados" || blockChartMetric === "paradas" ? "#dc2626" : "#1e3a5f"}
                          strokeWidth={2}
                          fill="url(#blockFill)"
                          dot={{ r: 2.5, fill: blockChartMetric === "descartados" || blockChartMetric === "paradas" ? "#dc2626" : "#1e3a5f" }}
                          name={chartMetricLabels[blockChartMetric]}
                        />
                        {blockChartMetric === "bandejas" && <ReferenceLine y={TARGETS.dailyTrays} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: `Obj: ${TARGETS.dailyTrays}`, position: 'right', fontSize: 9, fill: '#94a3b8' }} />}
                        {blockChartMetric === "bandejas" && cmBlockStats && <ReferenceLine y={Math.round(cmBlockStats.avgBandejas)} stroke="#1e3a5f" strokeDasharray="2 2" strokeOpacity={0.4} label={{ value: `Prom: ${Math.round(cmBlockStats.avgBandejas)}`, position: 'left', fontSize: 9, fill: '#1e3a5f' }} />}
                        {blockChartMetric === "paradas" && cmBlockStats && <ReferenceLine y={Math.round(cmBlockStats.avgDowntime)} stroke="#dc2626" strokeDasharray="4 4" label={{ value: `Prom: ${Math.round(cmBlockStats.avgDowntime)} min`, position: 'right', fontSize: 9, fill: '#dc2626' }} />}
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-xs">Sin datos de bloques este mes</div>
                  )}
                </div>
              </div>

              {/* Top 5 stops */}
              <div className="bg-card rounded-lg border border-border p-5 shadow-sm">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-semibold text-foreground">Top 5 Paradas</h3>
                  <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <p className="text-[10px] text-muted-foreground mb-3 uppercase tracking-wide">{MONTH_NAMES[selectedMonthIdx]}</p>
                {currentMonth && currentMonth.blockDowntimes.length > 0 ? (
                  <div className="space-y-2">
                    {currentMonth.blockDowntimes.map((dt, idx) => (
                      <div key={idx} className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="w-5 h-5 rounded-md bg-destructive/10 text-destructive text-[10px] flex items-center justify-center font-semibold flex-shrink-0">{idx + 1}</span>
                          <span className="text-[11px] text-foreground truncate">{dt.reason}</span>
                        </div>
                        <span className="text-[11px] font-semibold text-foreground ml-2 font-mono">{dt.minutes}m</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 text-muted-foreground text-xs">Sin paradas registradas</div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ═══ CANOS ═════════════════════════════════════════════════════ */}
        {effectiveLine === "canos" && (
          <>
            {/* Month comparison cards */}
            {cmPipeStats && (
              <section className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
                  <h2 className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">
                    Comparacion con {MONTH_NAMES[prevMonthIdx]}
                  </h2>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <ComparisonCard
                    label="Tn/Hora disponible"
                    current={cmPipeStats.tnPerHour}
                    previous={pmPipeStats?.tnPerHour || 0}
                    unit="tn/h"
                    decimals={2}
                  />
                  <ComparisonCard
                    label="Min. parada prom./dia"
                    current={cmPipeStats.avgDowntime}
                    previous={pmPipeStats?.avgDowntime || 0}
                    unit="min"
                    decimals={0}
                    invert
                  />
                  <ComparisonCard
                    label="Tn totales producidas"
                    current={cmPipeStats.totalTn}
                    previous={pmPipeStats?.totalTn || 0}
                    unit="tn"
                    decimals={1}
                  />
                  <ComparisonCard
                    label="Canos totales"
                    current={cmPipeStats.totalUnits}
                    previous={0}
                    unit="un."
                    decimals={0}
                  />
                </div>
              </section>
            )}

            {/* Days produced + Total downtime + Plan vs Actual */}
            {cmPipeStats && currentMonth && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                <div className="bg-primary/5 border border-primary/15 rounded-lg p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Calendar className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-foreground">{cmPipeStats.days}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Dias producidos</div>
                  </div>
                </div>
                <div className="bg-destructive/5 border border-destructive/15 rounded-lg p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center">
                    <Clock className="w-5 h-5 text-destructive" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-foreground">{cmPipeStats.totalDowntime}<span className="text-sm font-normal text-muted-foreground ml-1">min</span></div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Total paradas del mes</div>
                  </div>
                </div>
                {/* Planificado vs Producido - Calculo diario solo dias con produccion */}
                {(() => {
                  // Agrupar produccion por dia del mes
                  const productionByDay: Record<number, number> = {}
                  currentMonth.pipeDailyData.forEach(d => {
                    // Parsear dia directamente del string YYYY-MM-DD para evitar problemas de timezone
                    const dayNum = parseInt(d.date.split('-')[2], 10)
                    productionByDay[dayNum] = (productionByDay[dayNum] || 0) + d.totalUnits
                  })
                  
                  // Solo contar dias que tuvieron produccion
                  const daysWithProduction = Object.keys(productionByDay).map(Number)
                  
                  // Sumar planificado y producido solo para dias con produccion
                  let plannedForWorkedDays = 0
                  let producedTotal = 0
                  daysWithProduction.forEach(day => {
                    plannedForWorkedDays += currentMonth.pipeDailyTargets[day] || 0
                    producedTotal += productionByDay[day] || 0
                  })
                  
                  const diff = producedTotal - plannedForWorkedDays
                  const pct = plannedForWorkedDays > 0 ? ((producedTotal / plannedForWorkedDays) * 100) : 0
                  const isAhead = diff >= 0
                  
                  return (
                    <>
                      <div className={`${isAhead ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'} border rounded-lg p-4 flex items-center gap-4`}>
                        <div className={`w-10 h-10 rounded-lg ${isAhead ? 'bg-emerald-100' : 'bg-amber-100'} flex items-center justify-center`}>
                          <TrendingUp className={`w-5 h-5 ${isAhead ? 'text-emerald-600' : 'text-amber-600'}`} />
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-foreground">{plannedForWorkedDays}</div>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Plan ({daysWithProduction.length} dias)</div>
                        </div>
                      </div>
                      <button 
                        onClick={() => setShowCumplimientoDetail(true)}
                        className={`${isAhead ? 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100' : 'bg-amber-50 border-amber-200 hover:bg-amber-100'} border rounded-lg p-4 text-left transition-colors cursor-pointer`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-muted-foreground uppercase tracking-widest">Cumplimiento</span>
                          <span className={`text-xs font-semibold ${isAhead ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {isAhead ? '+' : ''}{diff} un.
                          </span>
                        </div>
                        <div className="text-2xl font-bold text-foreground">{pct.toFixed(1)}%</div>
                        <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                          <div 
                            className={`h-full ${isAhead ? 'bg-emerald-500' : 'bg-amber-500'} rounded-full transition-all`}
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                        <div className="text-[9px] text-muted-foreground mt-2 text-center">Click para ver detalle</div>
                      </button>
                    </>
                  )
                })()}
              </div>
            )}

            {/* Interactive Chart + Top Stops */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
              <div className="lg:col-span-2 bg-card rounded-lg border border-border p-5 shadow-sm">
                <div className="flex flex-col gap-3 mb-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{pipeChartMetric === "canosVsPlan" ? "Producido vs Planificado" : "Tendencia diaria"}</h3>
                    <div className="flex gap-1 flex-wrap">
                      {(["tnHora", "canos", "tnTotal", "paradas", "canosVsPlan"] as PipeChartMetric[]).map(m => (
                        <button
                          key={m}
                          onClick={() => setPipeChartMetric(m)}
                          className={`px-2.5 py-1 rounded text-[10px] font-medium transition-all ${
                            pipeChartMetric === m
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {pipeChartLabels[m]}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Filters row - hidden for vs plan */}
                  {pipeChartMetric !== "canosVsPlan" && (
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Turno:</span>
                        {(["todos", "1", "2"] as PipeShiftFilter[]).map(f => (
                          <button
                            key={f}
                            onClick={() => setPipeShiftFilter(f)}
                            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                              pipeShiftFilter === f
                                ? "bg-accent/15 text-accent border border-accent/30"
                                : "bg-muted/50 text-muted-foreground"
                            }`}
                          >
                            {f === "todos" ? "Todos" : `T${f}`}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Operarios:</span>
                        {(["todos", "3", "4"] as PipeFilter[]).map(f => (
                          <button
                            key={f}
                            onClick={() => setPipeFilter(f)}
                            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                              pipeFilter === f
                                ? "bg-accent/15 text-accent border border-accent/30"
                                : "bg-muted/50 text-muted-foreground"
                            }`}
                          >
                            {f === "todos" ? "Todos" : f}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Molde:</span>
                        <button
                          onClick={() => setPipeMoldFilter("todos")}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                            pipeMoldFilter === "todos"
                              ? "bg-accent/15 text-accent border border-accent/30"
                              : "bg-muted/50 text-muted-foreground"
                          }`}
                        >
                          Todos
                        </button>
                        {pipeMoldOptions.map(size => (
                          <button
                            key={size}
                            onClick={() => setPipeMoldFilter(size)}
                            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                              pipeMoldFilter === size
                                ? "bg-accent/15 text-accent border border-accent/30"
                                : "bg-muted/50 text-muted-foreground"
                            }`}
                          >
                            CC{size}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="h-64">
                  {/* ── Canos vs Plan chart ── */}
                  {pipeChartMetric === "canosVsPlan" ? (
                    pipeVsPlanData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={pipeVsPlanData} barGap={2}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="size" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                          <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload || !payload[0]) return null
                              const d = payload[0].payload as (typeof pipeVsPlanData)[0]
                              return (
                                <div className="bg-card border border-border rounded-lg shadow-lg p-3 max-w-[220px]">
                                  <div className="text-xs font-semibold text-foreground mb-1.5">{d.size}</div>
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                                    <span className="text-muted-foreground">Producido:</span>
                                    <span className="font-semibold text-foreground">{d.producido}</span>
                                    <span className="text-muted-foreground">Planificado:</span>
                                    <span className="font-semibold text-foreground">{d.planificado || "-"}</span>
                                    {d.planificado > 0 && (
                                      <>
                                        <span className="text-muted-foreground">Cumplimiento:</span>
                                        <span className={`font-bold ${d.cumplimiento >= 100 ? 'text-success' : d.cumplimiento >= 80 ? 'text-warning' : 'text-destructive'}`}>
                                          {d.cumplimiento}%
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              )
                            }}
                          />
                          <Bar dataKey="producido" name="Producido" fill="#1e3a5f" radius={[3, 3, 0, 0]} barSize={28} />
                          <Bar dataKey="planificado" name="Planificado" fill="#94a3b8" radius={[3, 3, 0, 0]} barSize={28} fillOpacity={0.5} stroke="#94a3b8" strokeDasharray="3 3" />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground text-xs">Sin datos de planificacion o produccion de canos este mes</div>
                    )
                  ) : (
                    /* ── Regular pipe daily chart (line/area) ── */
                    pipeChartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={pipeChartData}>
                          <defs>
                            <linearGradient id="pipeFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={pipeChartMetric === "paradas" ? "#dc2626" : "#1e3a5f"} stopOpacity={0.15} />
                              <stop offset="95%" stopColor={pipeChartMetric === "paradas" ? "#dc2626" : "#1e3a5f"} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                          <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload || !payload[0]) return null
                              const d = payload[0].payload as (typeof pipeChartData)[0]
                              const avgTnHora = filteredPipeAvg ? filteredPipeAvg.avgTnHora : 0
                              const avgCanos = filteredPipeAvg ? filteredPipeAvg.avgCanos : 0
                              const avgDowntime = filteredPipeAvg ? filteredPipeAvg.avgParadas : 0

                              const insights: string[] = []
                              if (d.canos === 0) {
                                insights.push("No hubo produccion este dia")
                              } else {
                                if (d.tnHora > 0 && d.tnHora < avgTnHora * 0.8) insights.push(`Tn/h baja (${((1 - d.tnHora / avgTnHora) * 100).toFixed(0)}% debajo del prom.)`)
                                if (d.canos < avgCanos * 0.7) insights.push(`Produccion baja: ${d.canos} canos (prom. ${Math.round(avgCanos)})`)
                                else if (d.canos > avgCanos * 1.15) insights.push(`Produccion alta: ${d.canos} canos (prom. ${Math.round(avgCanos)})`)
                              }
                              if (d.paradas > avgDowntime * 1.5 && d.paradas > 0) insights.push(`Paradas elevadas: ${d.paradas} min (prom. ${Math.round(avgDowntime)})`)

                              // Production by size entries
                              const sizeEntries = Object.entries(d.productionBySize)
                                .filter(([, qty]) => qty > 0)
                                .sort(([a], [b]) => Number(a) - Number(b))

                              return (
                                <div className="bg-card border border-border rounded-lg shadow-lg p-3 max-w-[280px]">
                                  <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-xs font-semibold text-foreground">{d.date}</span>
                                    <span className="text-[10px] text-muted-foreground">Turno {d.shift} - {d.operators} op.</span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] mb-2">
                                    <span className="text-muted-foreground">Canos total:</span>
                                    <span className="font-semibold text-foreground">{d.canos}</span>
                                    <span className="text-muted-foreground">Tn/h disp.:</span>
                                    <span className="font-semibold text-foreground">{d.tnHora}</span>
                                    <span className="text-muted-foreground">Tn total:</span>
                                    <span className="font-semibold text-foreground">{d.tnTotal}</span>
                                    <span className="text-muted-foreground">Paradas:</span>
                                    <span className="font-semibold text-foreground">{d.paradas} min</span>
                                  </div>
                                  {sizeEntries.length > 0 && (
                                    <div className="border-t border-border pt-1.5 mt-1">
                                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Detalle por tipo</p>
                                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
                                        {sizeEntries.map(([size, qty]) => (
                                          <span key={size} className="contents">
                                            <span className="text-muted-foreground">CC{size}:</span>
                                            <span className="font-semibold text-foreground">{qty} u.</span>
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {insights.length > 0 && (
                                    <div className="border-t border-border pt-1.5 mt-1.5 space-y-0.5">
                                      {insights.map((insight, i) => (
                                        <p key={i} className="text-[10px] text-muted-foreground leading-snug">{insight}</p>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )
                            }}
                          />
                          <Area
                            type="monotone"
                            dataKey={pipeChartMetric}
                            stroke={pipeChartMetric === "paradas" ? "#dc2626" : "#1e3a5f"}
                            strokeWidth={2}
                            fill="url(#pipeFill)"
                            dot={{ r: 2.5, fill: pipeChartMetric === "paradas" ? "#dc2626" : "#1e3a5f" }}
                            name={pipeChartLabels[pipeChartMetric]}
                          />
                          {/* Average reference lines from filtered data */}
                          {pipeChartMetric === "tnHora" && filteredPipeAvg && <ReferenceLine y={Number(filteredPipeAvg.avgTnHora.toFixed(2))} stroke="#1e3a5f" strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: `Prom: ${filteredPipeAvg.avgTnHora.toFixed(2)}`, position: 'insideTopRight', fontSize: 10, fill: '#1e3a5f', fontWeight: 600 }} />}
                          {pipeChartMetric === "canos" && filteredPipeAvg && <ReferenceLine y={Math.round(filteredPipeAvg.avgCanos)} stroke="#1e3a5f" strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: `Prom: ${Math.round(filteredPipeAvg.avgCanos)}`, position: 'insideTopRight', fontSize: 10, fill: '#1e3a5f', fontWeight: 600 }} />}
                          {pipeChartMetric === "tnTotal" && filteredPipeAvg && <ReferenceLine y={Number(filteredPipeAvg.avgTnTotal.toFixed(2))} stroke="#1e3a5f" strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: `Prom: ${filteredPipeAvg.avgTnTotal.toFixed(2)} tn`, position: 'insideTopRight', fontSize: 10, fill: '#1e3a5f', fontWeight: 600 }} />}
                          {pipeChartMetric === "paradas" && filteredPipeAvg && <ReferenceLine y={Math.round(filteredPipeAvg.avgParadas)} stroke="#dc2626" strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: `Prom: ${Math.round(filteredPipeAvg.avgParadas)} min`, position: 'insideTopRight', fontSize: 10, fill: '#dc2626', fontWeight: 600 }} />}
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground text-xs">Sin datos de canos este mes{pipeShiftFilter !== "todos" || pipeFilter !== "todos" || pipeMoldFilter !== "todos" ? " (con los filtros aplicados)" : ""}</div>
                    )
                  )}
                </div>
                {/* Vs plan legend + summary */}
                {pipeChartMetric === "canosVsPlan" && pipeVsPlanData.length > 0 && (
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-sm bg-[#1e3a5f]" />
                        <span className="text-[10px] text-muted-foreground">Producido</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-sm bg-[#94a3b8] opacity-50 border border-dashed border-[#94a3b8]" />
                        <span className="text-[10px] text-muted-foreground">Planificado</span>
                      </div>
                    </div>
                    {(() => {
                      const totalProd = pipeVsPlanData.reduce((s, d) => s + d.producido, 0)
                      const totalPlan = pipeVsPlanData.reduce((s, d) => s + d.planificado, 0)
                      const cumpl = totalPlan > 0 ? Math.round((totalProd / totalPlan) * 100) : 0
                      return (
                        <div className="flex items-center gap-3 text-[11px]">
                          <span className="text-muted-foreground">Total: <span className="font-semibold text-foreground">{totalProd}</span> / {totalPlan || "-"}</span>
                          {totalPlan > 0 && (
                            <span className={`font-bold px-2 py-0.5 rounded text-[10px] ${cumpl >= 100 ? 'bg-success/10 text-success' : cumpl >= 80 ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive'}`}>
                              {cumpl}%
                            </span>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>

              {/* Top 5 stops */}
              <div className="bg-card rounded-lg border border-border p-5 shadow-sm">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-semibold text-foreground">Top 5 Paradas</h3>
                  <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <p className="text-[10px] text-muted-foreground mb-3 uppercase tracking-wide">{MONTH_NAMES[selectedMonthIdx]}</p>
                {currentMonth && currentMonth.pipeDowntimes.length > 0 ? (
                  <div className="space-y-2">
                    {currentMonth.pipeDowntimes.map((dt, idx) => (
                      <div key={idx} className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="w-5 h-5 rounded-md bg-destructive/10 text-destructive text-[10px] flex items-center justify-center font-semibold flex-shrink-0">{idx + 1}</span>
                          <span className="text-[11px] text-foreground truncate">{dt.reason}</span>
                        </div>
                        <span className="text-[11px] font-semibold text-foreground ml-2 font-mono">{dt.minutes}m</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 text-muted-foreground text-xs">Sin paradas registradas</div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ═══ PRODUCCIÓN DIARIA ══════════════════════════════════════════ */}
        {activeLine === "produccion-diaria" && <DailyProductionModal />}

      </div>

      {/* Modal de Detalle de Cumplimiento */}
      <Dialog open={showCumplimientoDetail} onOpenChange={setShowCumplimientoDetail}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Detalle de Cumplimiento Diario - {plantName}
            </DialogTitle>
          </DialogHeader>
          
          {currentMonth && (() => {
            // Calcular datos por dia
            const SILKE_SIZES = ["300", "400", "500", "600"]
            const VILLA_ROSA_SIZES = ["800", "1000", "1200"]
            const plantSizes = selectedPlant === "villa-rosa" ? VILLA_ROSA_SIZES : SILKE_SIZES
            
            const productionByDay: Record<number, { produced: number; records: { shift: number; units: number }[] }> = {}
            currentMonth.pipeDailyData.forEach(d => {
              // Parsear dia directamente del string YYYY-MM-DD para evitar problemas de timezone
              const dayNum = parseInt(d.date.split('-')[2], 10)
              if (!productionByDay[dayNum]) {
                productionByDay[dayNum] = { produced: 0, records: [] }
              }
              productionByDay[dayNum].produced += d.totalUnits
              productionByDay[dayNum].records.push({ shift: d.shift, units: d.totalUnits })
            })
            
            const daysWithProduction = Object.keys(productionByDay).map(Number).sort((a, b) => a - b)
            
            let accumulatedPlanned = 0
            let accumulatedProduced = 0
            
            const dailyData = daysWithProduction.map(day => {
              const planned = currentMonth.pipeDailyTargets[day] || 0
              const produced = productionByDay[day].produced
              accumulatedPlanned += planned
              accumulatedProduced += produced
              const diff = produced - planned
              const pct = planned > 0 ? (produced / planned) * 100 : 0
              const accPct = accumulatedPlanned > 0 ? (accumulatedProduced / accumulatedPlanned) * 100 : 0
              
              return {
                day,
                planned,
                produced,
                diff,
                pct,
                accumulatedPlanned,
                accumulatedProduced,
                accPct,
                records: productionByDay[day].records
              }
            })
            
            const totalPlanned = accumulatedPlanned
            const totalProduced = accumulatedProduced
            const totalDiff = totalProduced - totalPlanned
            const totalPct = totalPlanned > 0 ? (totalProduced / totalPlanned) * 100 : 0
            
            return (
              <div className="space-y-4">
                {/* Resumen */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-muted/50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold">{totalPlanned}</div>
                    <div className="text-xs text-muted-foreground">Planificado</div>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold">{totalProduced}</div>
                    <div className="text-xs text-muted-foreground">Producido</div>
                  </div>
                  <div className={`rounded-lg p-3 text-center ${totalDiff >= 0 ? 'bg-emerald-50' : 'bg-amber-50'}`}>
                    <div className={`text-2xl font-bold ${totalDiff >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {totalPct.toFixed(1)}%
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {totalDiff >= 0 ? '+' : ''}{totalDiff} unidades
                    </div>
                  </div>
                </div>
                
                {/* Tabla detalle */}
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Dia</th>
                        <th className="px-3 py-2 text-right font-medium">Plan</th>
                        <th className="px-3 py-2 text-right font-medium">Prod.</th>
                        <th className="px-3 py-2 text-right font-medium">Dif.</th>
                        <th className="px-3 py-2 text-right font-medium">% Dia</th>
                        <th className="px-3 py-2 text-right font-medium">% Acum.</th>
                        <th className="px-3 py-2 text-center font-medium">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyData.map((d, idx) => (
                        <tr key={d.day} className={idx % 2 === 0 ? 'bg-background' : 'bg-muted/30'}>
                          <td className="px-3 py-2 font-medium">
                            Dia {d.day}
                            {d.records.length > 1 && (
                              <span className="text-[10px] text-muted-foreground ml-1">
                                ({d.records.map(r => `T${r.shift}`).join(', ')})
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">{d.planned}</td>
                          <td className="px-3 py-2 text-right font-medium">{d.produced}</td>
                          <td className={`px-3 py-2 text-right font-medium ${d.diff >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {d.diff >= 0 ? '+' : ''}{d.diff}
                          </td>
                          <td className="px-3 py-2 text-right">{d.pct.toFixed(0)}%</td>
                          <td className={`px-3 py-2 text-right font-medium ${d.accPct >= 100 ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {d.accPct.toFixed(1)}%
                          </td>
                          <td className="px-3 py-2 text-center">
                            {d.diff >= 0 ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                            ) : (
                              <XCircle className="w-4 h-4 text-amber-500 mx-auto" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted font-semibold">
                      <tr>
                        <td className="px-3 py-2">Total ({daysWithProduction.length} dias)</td>
                        <td className="px-3 py-2 text-right">{totalPlanned}</td>
                        <td className="px-3 py-2 text-right">{totalProduced}</td>
                        <td className={`px-3 py-2 text-right ${totalDiff >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {totalDiff >= 0 ? '+' : ''}{totalDiff}
                        </td>
                        <td className="px-3 py-2 text-right">-</td>
                        <td className={`px-3 py-2 text-right ${totalPct >= 100 ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {totalPct.toFixed(1)}%
                        </td>
                        <td className="px-3 py-2 text-center">
                          {totalDiff >= 0 ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                          ) : (
                            <XCircle className="w-4 h-4 text-amber-500 mx-auto" />
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                
                <p className="text-xs text-muted-foreground text-center">
                  Solo se muestran los dias con produccion cargada. El % acumulado indica como vas respecto a lo planificado hasta ese dia.
                </p>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>
    </main>
  )
}
