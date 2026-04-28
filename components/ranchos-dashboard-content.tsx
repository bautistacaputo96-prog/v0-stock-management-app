"use client"

import { useState, useEffect, useMemo } from "react"
import { getSupabase } from "@/lib/supabase"
import { LayoutGrid, Clock, TrendingUp, ChevronLeft, ChevronRight, AlertTriangle, Truck, ArrowUpRight, ArrowDownRight, Package, Boxes, FlaskConical, Target } from "lucide-react"
import { GranulometryDashboardWidget } from "@/components/granulometry-dashboard-widget"
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  BarChart,
  Bar,
} from "recharts"

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

// Constantes de produccion
const M2_PER_PIECE = 0.02 // 20cm x 10cm = 0.02 m2 por pieza
const DAILY_TARGET_TABLES = 1500 // Objetivo diario de bandejas/tablas

type PaverChartMetric = "tablas" | "m2Primera" | "pctSegunda" | "pastones" | "paradas"

interface DailyData {
  date: string
  fullDate: string
  tablas: number
  pastones: number
  piezasPrimera: number
  piezasSegunda: number
  m2Primera: number
  m2Segunda: number
  pctSegunda: number
  cementoSilo1: number
  cementoSilo2: number
  cementoTotal: number
  paradas: number
  productType: string
  extraMinutes: number
  productionMinutes: number
  observations: string
  topStopReason: string
  topStopMinutes: number
  supplierChanged: boolean
  supplierChangeNotes: string
  cementSupplier: string
  sandSupplier: string
  stoneSupplier: string
  // For analysis
  vsAvg: number // % vs promedio
  vsTarget: number // % vs objetivo
}

interface StockItem {
  name: string
  stockTn: number
  criticalLevel: number
  warningLevel: number
  daysOfCoverage: number
  subItems?: { name: string; stockTn: number }[]
}

interface QualityMetric {
  material: string
  mf: number
  minAcceptable: number
  maxAcceptable: number
  status: "ok" | "warning" | "critical"
  lastTests: number[]
}

interface FlexionMetric {
  avgMpa: number
  minIndividual: number
  minGroupal: number
  status: "ok" | "warning" | "critical"
  lastResults: number[]
}

// ── Helper components ──────────────────────────────────────────────────────

function KpiCard({ 
  label, 
  value, 
  unit = "", 
  prevValue, 
  prevLabel,
  highlight = false,
  size = "default",
  target,
  showAsPercentage = false,
  subValue,
  subUnit
}: { 
  label: string
  value: number | string
  unit?: string
  prevValue?: number
  prevLabel?: string
  highlight?: boolean
  size?: "default" | "large"
  target?: number
  showAsPercentage?: boolean
  subValue?: number
  subUnit?: string
}) {
  const pct = prevValue !== undefined && typeof value === "number" && prevValue > 0 
    ? ((value - prevValue) / prevValue * 100) 
    : 0
  const up = pct >= 0
  const atTarget = target !== undefined && typeof value === "number" && value >= target
  
  return (
    <div className={`rounded-lg p-4 ${highlight ? "bg-primary/5 border border-primary/15" : "bg-card border border-border shadow-sm"}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">{label}</div>
        {target !== undefined && (
          <div className={`flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded ${
            atTarget ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
          }`}>
            <Target className="w-2.5 h-2.5" />
            {target.toLocaleString("es-AR")}
          </div>
        )}
      </div>
      <div className={`font-bold text-foreground ${size === "large" ? "text-3xl" : "text-2xl"}`}>
        {typeof value === "number" ? (showAsPercentage ? `${value.toFixed(1)}%` : value.toLocaleString("es-AR")) : value}
        {unit && !showAsPercentage && <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>}
      </div>
      {subValue !== undefined && (
        <div className="text-xs text-muted-foreground mt-0.5">
          {subValue.toLocaleString("es-AR")} {subUnit}
        </div>
      )}
      {prevValue !== undefined && prevValue > 0 && (
        <div className="flex items-center gap-2 mt-1">
          <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${up ? "text-emerald-600" : "text-red-600"}`}>
            {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {Math.abs(pct).toFixed(1)}%
          </span>
          <span className="text-[10px] text-muted-foreground">
            vs {prevLabel || "mes ant."} ({prevValue.toLocaleString("es-AR")})
          </span>
        </div>
      )}
    </div>
  )
}

function StockCard({ item }: { item: StockItem }) {
  const getStatus = () => {
    if (item.stockTn <= item.criticalLevel) return { color: "text-red-600", bg: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900", label: "Critico" }
    if (item.stockTn <= item.warningLevel) return { color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900", label: "Bajo" }
    return { color: "text-emerald-600", bg: "bg-card border-border", label: "OK" }
  }
  const status = getStatus()
  
  return (
    <div className={`rounded-lg border p-4 ${status.bg}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">{item.name}</div>
        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${status.color} bg-current/10`}>
          {status.label}
        </span>
      </div>
      <div className="text-xl font-bold text-foreground">
        {item.stockTn.toFixed(1)}<span className="text-sm font-normal text-muted-foreground ml-1">tn</span>
      </div>
      {item.subItems && item.subItems.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {item.subItems.map((sub, i) => (
            <div key={i} className="flex justify-between text-[10px] text-muted-foreground">
              <span>{sub.name}:</span>
              <span className="font-mono">{sub.stockTn.toFixed(2)} tn</span>
            </div>
          ))}
        </div>
      )}
      <div className="text-[10px] text-muted-foreground mt-1">
        {item.daysOfCoverage > 0 ? `~${item.daysOfCoverage} dias de cobertura` : "Sin consumo registrado"}
      </div>
      <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            item.stockTn <= item.criticalLevel ? "bg-red-500" :
            item.stockTn <= item.warningLevel ? "bg-amber-500" : "bg-emerald-500"
          }`}
          style={{ width: `${Math.min((item.stockTn / (item.warningLevel * 2)) * 100, 100)}%` }}
        />
      </div>
    </div>
  )
}

function QualityCard({ metric }: { metric: QualityMetric }) {
  const statusColors = {
    ok: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400",
    warning: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-400",
    critical: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-700 dark:text-red-400"
  }
  const statusLabels = { ok: "OK", warning: "Alerta", critical: "Fuera" }
  
  return (
    <div className={`rounded-lg border p-3 ${statusColors[metric.status]}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] uppercase tracking-widest font-medium opacity-70">{metric.material}</div>
        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-current/10">
          {statusLabels[metric.status]}
        </span>
      </div>
      <div className="text-2xl font-bold">MF {metric.mf.toFixed(2)}</div>
      <div className="text-[10px] opacity-70 mt-1">
        Limites: {metric.minAcceptable.toFixed(2)} - {metric.maxAcceptable.toFixed(2)}
      </div>
      {metric.lastTests.length > 0 && (
        <div className="flex gap-1 mt-2">
          {metric.lastTests.slice(-5).map((v, i) => (
            <div 
              key={i} 
              className={`flex-1 h-1 rounded-full ${
                v >= metric.minAcceptable && v <= metric.maxAcceptable ? "bg-emerald-500" : "bg-red-500"
              }`}
              title={`MF: ${v.toFixed(2)}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FlexionCard({ metric }: { metric: FlexionMetric }) {
  const statusColors = {
    ok: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900",
    warning: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900",
    critical: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900"
  }
  const statusLabels = { ok: "OK", warning: "Alerta", critical: "Fuera" }
  const statusTextColors = { ok: "text-emerald-700 dark:text-emerald-400", warning: "text-amber-700 dark:text-amber-400", critical: "text-red-700 dark:text-red-400" }
  
  return (
    <div className={`rounded-lg border p-3 ${statusColors[metric.status]}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Flexion (28 dias)</div>
        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded bg-current/10 ${statusTextColors[metric.status]}`}>
          {statusLabels[metric.status]}
        </span>
      </div>
      <div className={`text-2xl font-bold ${statusTextColors[metric.status]}`}>{metric.avgMpa.toFixed(2)} MPa</div>
      <div className="text-[10px] text-muted-foreground mt-1">
        Min individual: {metric.minIndividual} MPa | Min grupal: {metric.minGroupal} MPa
      </div>
      {metric.lastResults.length > 0 && (
        <div className="flex gap-1 mt-2">
          {metric.lastResults.slice(-5).map((v, i) => (
            <div 
              key={i} 
              className={`flex-1 h-1 rounded-full ${v >= metric.minIndividual ? "bg-emerald-500" : "bg-red-500"}`}
              title={`${v.toFixed(2)} MPa`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function WeekTrend({ label, current, previous }: { label: string; current: number; previous: number }) {
  const pct = previous > 0 ? ((current - previous) / previous * 100) : 0
  const up = pct > 0
  return (
    <div className="text-center">
      <div className="text-xs font-medium text-foreground">{label}</div>
      <div className="text-lg font-bold">{current}</div>
      {previous > 0 && (
        <div className={`text-[10px] font-semibold flex items-center justify-center gap-0.5 ${up ? "text-emerald-500" : "text-red-500"}`}>
          {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          {Math.abs(pct).toFixed(0)}%
        </div>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export function RanchosDashboardContent() {
  const now = new Date()
  // Default to current month - will find latest month with data on first load
  const [selectedMonthIdx, setSelectedMonthIdx] = useState(now.getMonth())
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [loading, setLoading] = useState(true)
  const [records, setRecords] = useState<any[]>([])
  const [prevRecords, setPrevRecords] = useState<any[]>([])
  const [stockData, setStockData] = useState<StockItem[]>([])
  const [chartMetric, setChartMetric] = useState<PaverChartMetric>("tablas")
  const [granulometryData, setGranulometryData] = useState<QualityMetric[]>([])
  const [flexionData, setFlexionData] = useState<FlexionMetric | null>(null)
  const [pastonFormula, setPastonFormula] = useState<any>(null)
  const [hasInitialized, setHasInitialized] = useState(false)

  // On first load, find the latest month with production data
  useEffect(() => {
    if (hasInitialized) return
    
    async function findLatestMonth() {
      try {
        const supabase = getSupabase()
        const { data } = await supabase
          .from("paver_production")
          .select("production_date")
          .order("production_date", { ascending: false })
          .limit(1)
        
        if (data && data.length > 0) {
          const latestDate = new Date(data[0].production_date)
          setSelectedMonthIdx(latestDate.getMonth())
          setSelectedYear(latestDate.getFullYear())
        }
      } catch {
        // Keep default (current month)
      }
      setHasInitialized(true)
    }
    
    findLatestMonth()
  }, [hasInitialized])

  useEffect(() => {
    if (!hasInitialized) return
    
    let retries = 0
    const attempt = () => {
      loadData(selectedMonthIdx, selectedYear).catch(() => {
        if (retries < 3) { retries++; setTimeout(attempt, 1000) }
      })
    }
    attempt()
  }, [selectedMonthIdx, selectedYear, hasInitialized])

  async function loadData(monthIdx: number, year: number) {
    setLoading(true)
    let supabase: ReturnType<typeof getSupabase>
    try { supabase = getSupabase() } catch { setLoading(false); throw new Error("Supabase not ready") }

    const lastDay = new Date(year, monthIdx + 1, 0).getDate()
    const start = `${year}-${String(monthIdx + 1).padStart(2, "0")}-01`
    const end = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`

    // Previous month
    const pmYear = monthIdx === 0 ? year - 1 : year
    const pmIdx = monthIdx === 0 ? 11 : monthIdx - 1
    const pmLastDay = new Date(pmYear, pmIdx + 1, 0).getDate()
    const pmStart = `${pmYear}-${String(pmIdx + 1).padStart(2, "0")}-01`
    const pmEnd = `${pmYear}-${String(pmIdx + 1).padStart(2, "0")}-${String(pmLastDay).padStart(2, "0")}`

    const [cmResult, pmResult, formulaResult] = await Promise.all([
      supabase
        .from("paver_production")
        .select("*, paver_downtime(*)")
        .gte("production_date", start)
        .lte("production_date", end)
        .order("production_date"),
      supabase
        .from("paver_production")
        .select("tables_produced, pastones_count, palletized_first, palletized_second, production_date, cement_silo_1_tn, cement_silo_2_tn")
        .gte("production_date", pmStart)
        .lte("production_date", pmEnd),
      supabase
        .from("paston_formulas")
        .select("*")
        .eq("plant", "ranchos")
        .eq("is_active", true)
        .single()
    ])

    if (cmResult.error) { setLoading(false); return }
    setRecords(cmResult.data || [])
    setPrevRecords(pmResult.data || [])
    if (formulaResult.data) setPastonFormula(formulaResult.data)

    // Calculate stock from mp_receipts and consumption based on pastones
    try {
      const formula = formulaResult.data
      const totalPastones = (cmResult.data || []).reduce((s: number, r: any) => s + (r.pastones_count || 0), 0)
      
      // Consumo basado en pastones x formula
      const cementConsumption = formula ? (totalPastones * (formula.cement_kg || 0) / 1000) : 0 // tn
      const sandConsumption = formula ? (totalPastones * (formula.sand_kg || 0) / 1000) : 0
      const stoneConsumption = formula ? (totalPastones * (formula.stone_kg || 0) / 1000) : 0
      
      const prodDays = (cmResult.data || []).length || 1
      const dailyCementConsumption = cementConsumption / prodDays
      const dailySandConsumption = sandConsumption / prodDays
      const dailyStoneConsumption = stoneConsumption / prodDays

      // Get receipts for stock calculation
      const { data: receipts } = await supabase
        .from("mp_receipts")
        .select("material_type, quantity_tn")
        .eq("plant", "ranchos")
        .gte("receipt_date", start)
        .lte("receipt_date", end)

      const stockMap: Record<string, number> = {}
      ;(receipts || []).forEach((r: any) => {
        // Normalize material type to handle case differences
        const rawKey = r.material_type || "Otro"
        const key = rawKey.charAt(0).toUpperCase() + rawKey.slice(1).toLowerCase()
        stockMap[key] = (stockMap[key] || 0) + (parseFloat(r.quantity_tn) || 0)
      })

      // Cemento discriminado por silo
      const totalCementoSilo1 = (cmResult.data || []).reduce((s: number, r: any) => s + (r.cement_silo_1_tn || 0), 0)
      const totalCementoSilo2 = (cmResult.data || []).reduce((s: number, r: any) => s + (r.cement_silo_2_tn || 0), 0)
      const cementoIngresado = stockMap["Cemento"] || 0
      const cementoStock = cementoIngresado - (totalCementoSilo1 + totalCementoSilo2)

      setStockData([
        { 
          name: "Arena", 
          stockTn: Math.max(0, (stockMap["Arena"] || 0) - sandConsumption), 
          criticalLevel: 50, 
          warningLevel: 100,
          daysOfCoverage: dailySandConsumption > 0 ? Math.round(Math.max(0, (stockMap["Arena"] || 0) - sandConsumption) / dailySandConsumption) : 0
        },
        { 
          name: "Piedra", 
          stockTn: Math.max(0, (stockMap["Piedra"] || stockMap["Piedra 0/6"] || 0) - stoneConsumption), 
          criticalLevel: 50, 
          warningLevel: 100,
          daysOfCoverage: dailyStoneConsumption > 0 ? Math.round(Math.max(0, (stockMap["Piedra"] || stockMap["Piedra 0/6"] || 0) - stoneConsumption) / dailyStoneConsumption) : 0
        },
        { 
          name: "Cemento", 
          stockTn: Math.max(0, cementoStock), 
          criticalLevel: 20, 
          warningLevel: 40,
          daysOfCoverage: dailyCementConsumption > 0 ? Math.round(Math.max(0, cementoStock) / dailyCementConsumption) : 0,
          subItems: [
            { name: "Silo 1", stockTn: totalCementoSilo1 },
            { name: "Silo 2", stockTn: totalCementoSilo2 }
          ]
        },
      ])
    } catch {
      setStockData([
        { name: "Arena", stockTn: 0, criticalLevel: 50, warningLevel: 100, daysOfCoverage: 0 },
        { name: "Piedra", stockTn: 0, criticalLevel: 50, warningLevel: 100, daysOfCoverage: 0 },
        { name: "Cemento", stockTn: 0, criticalLevel: 20, warningLevel: 40, daysOfCoverage: 0 },
      ])
    }

    // Load quality data - Granulometry
    try {
      const { data: granTests } = await supabase
        .from("granulometry_tests")
        .select("material_type, fineness_modulus")
        .eq("plant", "ranchos")
        .order("test_date", { ascending: false })
        .limit(20)

      const materials = ["Arena", "Piedra"]
      const granMetrics: QualityMetric[] = materials.map(mat => {
        const tests = (granTests || []).filter((t: any) => t.material_type === mat)
        const mfValues = tests.map((t: any) => t.fineness_modulus || 0).filter((v: number) => v > 0)
        const avgMf = mfValues.length > 0 ? mfValues.reduce((a: number, b: number) => a + b, 0) / mfValues.length : 0
        
        // Limites IRAM tipicos
        const limits = mat === "Arena" 
          ? { min: 2.3, max: 3.1 } // Arena fina a media
          : { min: 5.5, max: 7.5 } // Piedra
        
        const status = avgMf === 0 ? "warning" as const : 
          (avgMf >= limits.min && avgMf <= limits.max) ? "ok" as const : "critical" as const
        
        return {
          material: mat,
          mf: avgMf,
          minAcceptable: limits.min,
          maxAcceptable: limits.max,
          status,
          lastTests: mfValues.slice(0, 5)
        }
      })
      setGranulometryData(granMetrics)
    } catch {
      setGranulometryData([])
    }

    // Load flexion data
    try {
      const { data: flexTests } = await supabase
        .from("quality_flexion_specimens")
        .select("result_mpa, test_age_days")
        .eq("status", "completed")
        .order("tested_at", { ascending: false })
        .limit(10)

      const results28 = (flexTests || [])
        .filter((t: any) => t.test_age_days === 28 && t.result_mpa > 0)
        .map((t: any) => t.result_mpa)

      if (results28.length > 0) {
        const avgMpa = results28.reduce((a: number, b: number) => a + b, 0) / results28.length
        const minInd = 3.8
        const minGroup = 4.2
        const status = avgMpa >= minGroup ? "ok" as const : 
          avgMpa >= minInd ? "warning" as const : "critical" as const
        
        setFlexionData({
          avgMpa,
          minIndividual: minInd,
          minGroupal: minGroup,
          status,
          lastResults: results28.slice(0, 5)
        })
      }
    } catch {
      setFlexionData(null)
    }

    setLoading(false)
  }

  // Process daily data - convert pieces to m2
  const dailyData = useMemo<DailyData[]>(() => {
    const avgTablas = records.length > 0 
      ? records.reduce((s: number, r: any) => s + (r.tables_produced || 0), 0) / records.length 
      : 0

    return records.map(r => {
      const downtimes = (r.paver_downtime || []) as { custom_reason?: string; minutes?: number; comments?: string }[]
      const totalDowntime = downtimes.reduce((s: number, d: any) => s + (d.minutes || 0), 0)
      const topStop = downtimes.sort((a: any, b: any) => (b.minutes || 0) - (a.minutes || 0))[0]

      let prodMin = 0
      if (r.start_time && r.end_time) {
        const s = new Date(`2000-01-01T${r.start_time}`)
        const e = new Date(`2000-01-01T${r.end_time}`)
        let diff = (e.getTime() - s.getTime()) / 1000 / 60
        if (diff < 0) diff += 24 * 60
        prodMin = Math.round(diff)
      }

      const piezasPrimera = r.palletized_first || 0
      const piezasSegunda = r.palletized_second || 0
      const m2Primera = piezasPrimera * M2_PER_PIECE
      const m2Segunda = piezasSegunda * M2_PER_PIECE
      const totalPiezas = piezasPrimera + piezasSegunda
      const pctSegunda = totalPiezas > 0 ? (piezasSegunda / totalPiezas) * 100 : 0
      const tablas = r.tables_produced || 0

      return {
        date: new Date(r.production_date + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }),
        fullDate: r.production_date,
        tablas,
        pastones: r.pastones_count || 0,
        piezasPrimera,
        piezasSegunda,
        m2Primera,
        m2Segunda,
        pctSegunda,
        cementoSilo1: r.cement_silo_1_tn || 0,
        cementoSilo2: r.cement_silo_2_tn || 0,
        cementoTotal: Number(((r.cement_silo_1_tn || 0) + (r.cement_silo_2_tn || 0)).toFixed(3)),
        paradas: totalDowntime,
        productType: r.product_type_code || "",
        extraMinutes: r.extra_minutes || 0,
        productionMinutes: prodMin,
        observations: r.observations || "",
        topStopReason: topStop?.custom_reason || "",
        topStopMinutes: topStop?.minutes || 0,
        supplierChanged: r.supplier_changed || false,
        supplierChangeNotes: r.supplier_change_notes || "",
        cementSupplier: r.cement_supplier || "",
        sandSupplier: r.sand_supplier || "",
        stoneSupplier: r.stone_supplier || "",
        vsAvg: avgTablas > 0 ? ((tablas - avgTablas) / avgTablas) * 100 : 0,
        vsTarget: ((tablas - DAILY_TARGET_TABLES) / DAILY_TARGET_TABLES) * 100,
      }
    })
  }, [records])

  // Stats — current month
  const stats = useMemo(() => {
    if (dailyData.length === 0) return null
    const n = dailyData.length
    const totalTablas = dailyData.reduce((s, d) => s + d.tablas, 0)
    const totalPastones = dailyData.reduce((s, d) => s + d.pastones, 0)
    const totalPiezasPrimera = dailyData.reduce((s, d) => s + d.piezasPrimera, 0)
    const totalPiezasSegunda = dailyData.reduce((s, d) => s + d.piezasSegunda, 0)
    const totalM2Primera = dailyData.reduce((s, d) => s + d.m2Primera, 0)
    const totalM2Segunda = dailyData.reduce((s, d) => s + d.m2Segunda, 0)
    const totalCemento = dailyData.reduce((s, d) => s + d.cementoTotal, 0)
    const totalParadas = dailyData.reduce((s, d) => s + d.paradas, 0)
    const totalPiezas = totalPiezasPrimera + totalPiezasSegunda
    const pctSegunda = totalPiezas > 0 ? (totalPiezasSegunda / totalPiezas) * 100 : 0
    
    return {
      days: n,
      totalTablas,
      avgTablas: totalTablas / n,
      totalPastones,
      avgPastones: totalPastones / n,
      totalPiezasPrimera,
      totalPiezasSegunda,
      totalM2Primera,
      totalM2Segunda,
      pctSegunda,
      totalCemento,
      avgCemento: totalCemento / n,
      totalParadas,
      avgParadas: totalParadas / n,
    }
  }, [dailyData])

  // Stats — previous month
  const prevStats = useMemo(() => {
    if (prevRecords.length === 0) return null
    const n = prevRecords.length
    const totalTablas = prevRecords.reduce((s: number, r: any) => s + (r.tables_produced || 0), 0)
    const totalPastones = prevRecords.reduce((s: number, r: any) => s + (r.pastones_count || 0), 0)
    const totalPiezasPrimera = prevRecords.reduce((s: number, r: any) => s + (r.palletized_first || 0), 0)
    const totalPiezasSegunda = prevRecords.reduce((s: number, r: any) => s + (r.palletized_second || 0), 0)
    const totalM2Primera = totalPiezasPrimera * M2_PER_PIECE
    const totalM2Segunda = totalPiezasSegunda * M2_PER_PIECE
    const totalPiezas = totalPiezasPrimera + totalPiezasSegunda
    const pctSegunda = totalPiezas > 0 ? (totalPiezasSegunda / totalPiezas) * 100 : 0
    
    return { 
      days: n, 
      avgTablas: totalTablas / n, 
      totalTablas,
      totalPastones,
      avgPastones: totalPastones / n,
      totalM2Primera,
      totalM2Segunda,
      pctSegunda
    }
  }, [prevRecords])

  // Weekly data for tablas
  const weeklyData = useMemo(() => {
    const weeks = [
      { label: "Sem 1", range: [1, 7] },
      { label: "Sem 2", range: [8, 14] },
      { label: "Sem 3", range: [15, 21] },
      { label: "Sem 4", range: [22, 31] },
    ]
    const getTotForRange = (range: number[]) =>
      dailyData
        .filter(d => { const day = parseInt(d.fullDate.split("-")[2]); return day >= range[0] && day <= range[1] })
        .reduce((s, d) => s + d.tablas, 0)

    return weeks.map((w, i) => ({
      label: w.label,
      current: getTotForRange(w.range),
      previous: i > 0 ? getTotForRange(weeks[i - 1].range) : 0,
    }))
  }, [dailyData])

  // Top 5 paradas agrupadas
  const top5Paradas = useMemo(() => {
    const map = new Map<string, { minutes: number; count: number }>()
    records.forEach(r => {
      ;(r.paver_downtime || []).forEach((dt: any) => {
        const reason = dt.custom_reason || "Sin especificar"
        const existing = map.get(reason) || { minutes: 0, count: 0 }
        map.set(reason, { minutes: existing.minutes + (dt.minutes || 0), count: existing.count + 1 })
      })
    })
    const total = Array.from(map.values()).reduce((s, v) => s + v.minutes, 0)
    return Array.from(map.entries())
      .map(([reason, data]) => ({ 
        reason, 
        minutes: data.minutes, 
        count: data.count,
        pct: total > 0 ? Math.round((data.minutes / total) * 100) : 0 
      }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 5)
  }, [records])

  // Alerts
  const alerts = useMemo(() => {
    const result: string[] = []
    stockData.forEach(s => {
      if (s.stockTn > 0 && s.stockTn <= s.criticalLevel) {
        result.push(`Stock critico de ${s.name}`)
      }
    })
    if (dailyData.length >= 2) {
      let maxConsecutive = 0
      let current = 0
      dailyData.forEach(d => {
        if (d.tablas === 0) { current++; maxConsecutive = Math.max(maxConsecutive, current) }
        else current = 0
      })
      if (maxConsecutive >= 2) result.push(`${maxConsecutive} dias consecutivos sin produccion`)
    }
    return result
  }, [dailyData, stockData])

  const chartLabels: Record<PaverChartMetric, string> = {
    tablas: "Tablas", 
    m2Primera: "m2 1ra", 
    pctSegunda: "% 2da",
    pastones: "Pastones", 
    paradas: "Min. paradas"
  }

  const prevMonthIdx = selectedMonthIdx === 0 ? 11 : selectedMonthIdx - 1

  function prevMonth() {
    if (selectedMonthIdx === 0) { setSelectedMonthIdx(11); setSelectedYear(y => y - 1) }
    else setSelectedMonthIdx(m => m - 1)
  }
  function nextMonth() {
    if (selectedMonthIdx === 11) { setSelectedMonthIdx(0); setSelectedYear(y => y + 1) }
    else setSelectedMonthIdx(m => m + 1)
  }

  // Generate analysis comment for tooltip
  const getAnalysisComment = (d: DailyData): string => {
    const comments: string[] = []
    
    if (d.vsTarget >= 0) {
      comments.push(`Produccion por encima del objetivo (+${d.vsTarget.toFixed(0)}%)`)
    } else if (d.vsTarget < -20) {
      comments.push(`Produccion muy por debajo del objetivo (${d.vsTarget.toFixed(0)}%)`)
    }
    
    if (d.vsAvg > 10) {
      comments.push(`Por encima del promedio del mes (+${d.vsAvg.toFixed(0)}%)`)
    } else if (d.vsAvg < -10) {
      comments.push(`Por debajo del promedio del mes (${d.vsAvg.toFixed(0)}%)`)
    }
    
    if (d.extraMinutes > 30) {
      comments.push(`Se hicieron ${d.extraMinutes} min extra para llegar al objetivo`)
    }
    
    if (d.topStopMinutes > 30 && d.topStopReason) {
      comments.push(`Parada principal: ${d.topStopReason} (${d.topStopMinutes} min)`)
    }
    
    if (d.pctSegunda > 5) {
      comments.push(`Alta produccion de segunda calidad (${d.pctSegunda.toFixed(1)}%)`)
    }
    
    return comments.length > 0 ? comments[0] : "Dia de produccion normal"
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Ranchos - Adoquines</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Dashboard de produccion</p>
        </div>
        <div className="flex items-center gap-2 bg-card rounded-lg border border-border px-3 py-1.5">
          <button onClick={prevMonth} className="p-0.5 hover:bg-muted rounded transition-colors">
            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
          </button>
          <span className="text-sm font-semibold text-foreground min-w-[130px] text-center">
            {MONTH_NAMES[selectedMonthIdx]} {selectedYear}
          </span>
          <button onClick={nextMonth} className="p-0.5 hover:bg-muted rounded transition-colors">
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {records.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <AlertTriangle className="h-7 w-7 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-1">Sin datos para {MONTH_NAMES[selectedMonthIdx]}</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            No hay partes de produccion cargados para este mes. Anda a Produccion para cargar el primer parte de adoquines.
          </p>
        </div>
      ) : (
        <>
          {/* ═══ SECCION 1 — Alertas ═══════════════════════════════════════ */}
          {alerts.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-5 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0" />
              <span className="text-xs font-semibold text-red-700 dark:text-red-300 uppercase tracking-wide">Alertas activas:</span>
              {alerts.map((a, i) => (
                <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-600 text-white">
                  {a}
                </span>
              ))}
            </div>
          )}

          {/* ═══ SECCION 2 — KPIs Header ══════════════════════════════════ */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
              <h2 className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">
                KPIs del mes — comparacion con {MONTH_NAMES[prevMonthIdx]}
              </h2>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <KpiCard 
                label="Dias de produccion" 
                value={stats?.days || 0} 
                prevValue={prevStats?.days}
                highlight
              />
              <KpiCard 
                label="Prom. tablas/turno" 
                value={Math.round(stats?.avgTablas || 0)} 
                prevValue={prevStats ? Math.round(prevStats.avgTablas) : undefined}
                target={DAILY_TARGET_TABLES}
              />
              <KpiCard 
                label="Total tablas" 
                value={stats?.totalTablas || 0} 
                prevValue={prevStats?.totalTablas}
                size="large"
              />
              <KpiCard 
                label="m2 Primera calidad" 
                value={Math.round(stats?.totalM2Primera || 0)} 
                unit="m2"
                prevValue={prevStats ? Math.round(prevStats.totalM2Primera) : undefined}
              />
              <KpiCard 
                label="% Segunda calidad" 
                value={stats?.pctSegunda || 0}
                showAsPercentage
                prevValue={prevStats?.pctSegunda}
                subValue={Math.round(stats?.totalM2Segunda || 0)}
                subUnit="m2"
              />
            </div>
          </div>

          {/* ═══ SECCION 3 — Produccion: Grafico diario + Tendencia semanal ═══ */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            {/* Grafico de tendencia diaria */}
            <div className="lg:col-span-2 bg-card rounded-lg border border-border p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Tendencia diaria</h3>
                  <p className="text-[10px] text-muted-foreground">Objetivo diario: {DAILY_TARGET_TABLES.toLocaleString("es-AR")} tablas</p>
                </div>
                <div className="flex gap-1 flex-wrap">
                  {(["tablas", "m2Primera", "pctSegunda", "pastones", "paradas"] as PaverChartMetric[]).map(m => (
                    <button
                      key={m}
                      onClick={() => setChartMetric(m)}
                      className={`px-2.5 py-1 rounded text-[10px] font-medium transition-all ${
                        chartMetric === m
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {chartLabels[m]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyData}>
                    <defs>
                      <linearGradient id="paverFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={chartMetric === "paradas" ? "#dc2626" : "#1e3a5f"} stopOpacity={0.15} />
                        <stop offset="95%" stopColor={chartMetric === "paradas" ? "#dc2626" : "#1e3a5f"} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload[0]) return null
                        const d = payload[0].payload as DailyData
                        const analysisComment = getAnalysisComment(d)
                        return (
                          <div className="bg-card border border-border rounded-lg shadow-lg p-3 max-w-[320px]">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-semibold text-foreground">{d.date}</span>
                              {d.productType && <span className="text-[10px] text-muted-foreground">{d.productType}</span>}
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                              <span className="text-muted-foreground">Tablas:</span>
                              <span className="font-semibold text-foreground">{d.tablas.toLocaleString("es-AR")}</span>
                              <span className="text-muted-foreground">Pastones:</span>
                              <span className="font-semibold text-foreground">{d.pastones}</span>
                              <span className="text-muted-foreground">m2 1ra:</span>
                              <span className="font-semibold text-emerald-600">{d.m2Primera.toFixed(1)}</span>
                              <span className="text-muted-foreground">m2 2da:</span>
                              <span className="font-semibold text-amber-600">{d.m2Segunda.toFixed(1)} ({d.pctSegunda.toFixed(1)}%)</span>
                              <span className="text-muted-foreground">Paradas:</span>
                              <span className="font-semibold text-foreground">{d.paradas} min</span>
                            </div>
                            {/* Analysis comment */}
                            <div className="mt-2 pt-2 border-t border-border">
                              <p className="text-[10px] text-primary font-medium italic">
                                {analysisComment}
                              </p>
                            </div>
                          </div>
                        )
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey={chartMetric}
                      stroke={chartMetric === "paradas" ? "#dc2626" : chartMetric === "pctSegunda" ? "#d97706" : "#1e3a5f"}
                      strokeWidth={2}
                      fill="url(#paverFill)"
                      dot={{ r: 2.5, fill: chartMetric === "paradas" ? "#dc2626" : "#1e3a5f" }}
                    />
                    {chartMetric === "tablas" && (
                      <>
                        <ReferenceLine 
                          y={DAILY_TARGET_TABLES} 
                          stroke="#10b981" 
                          strokeDasharray="4 4" 
                          strokeWidth={2}
                          label={{ value: `Objetivo: ${DAILY_TARGET_TABLES}`, position: "insideTopRight", fontSize: 10, fill: "#10b981", fontWeight: 600 }}
                        />
                        {stats && (
                          <ReferenceLine 
                            y={Math.round(stats.avgTablas)} 
                            stroke="#1e3a5f" 
                            strokeDasharray="2 2" 
                            strokeOpacity={0.6}
                            label={{ value: `Prom: ${Math.round(stats.avgTablas)}`, position: "insideBottomRight", fontSize: 9, fill: "#1e3a5f" }}
                          />
                        )}
                      </>
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Tendencia semanal */}
            <div className="bg-card rounded-lg border border-border p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-foreground mb-4">Tendencia semanal — tablas</h3>
              <div className="h-40 mb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyData} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <Bar dataKey="current" name="Esta semana" fill="#1e3a5f" radius={[3, 3, 0, 0]} barSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-4 gap-2 pt-3 border-t border-border">
                {weeklyData.map(w => (
                  <WeekTrend key={w.label} label={w.label} current={w.current} previous={w.previous} />
                ))}
              </div>
            </div>
          </div>

          {/* ═══ SECCION 4 — Widget de Granulometria ═══════════════════════════ */}
          <div className="mb-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <GranulometryDashboardWidget />
              
              {/* Metricas de flexion */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <FlaskConical className="w-3.5 h-3.5 text-muted-foreground" />
                  <h2 className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">
                    Flexion - Ultimos ensayos
                  </h2>
                </div>
                {flexionData && (
                  <FlexionCard metric={flexionData} />
                )}
                {!flexionData && (
                  <div className="rounded-lg border border-dashed border-muted-foreground/30 p-4 flex items-center justify-center text-muted-foreground text-xs">
                    Sin ensayos de flexion registrados
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ═══ SECCION 5 — Stock + Top 5 Paradas ════════════════════════ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Stock de materia prima */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Package className="w-3.5 h-3.5 text-muted-foreground" />
                <h2 className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">
                  Stock de materia prima
                </h2>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {stockData.map(item => (
                  <StockCard key={item.name} item={item} />
                ))}
              </div>
            </div>

            {/* Top 5 paradas */}
            <div className="bg-card rounded-lg border border-border p-5 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold text-foreground">Top 5 Paradas</h3>
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <p className="text-[10px] text-muted-foreground mb-3 uppercase tracking-wide">{MONTH_NAMES[selectedMonthIdx]}</p>
              {top5Paradas.length > 0 ? (
                <div className="space-y-2">
                  {top5Paradas.map((dt, idx) => (
                    <div key={idx}>
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="w-5 h-5 rounded-md bg-destructive/10 text-destructive text-[10px] flex items-center justify-center font-semibold flex-shrink-0">{idx + 1}</span>
                          <span className="text-[11px] text-foreground truncate">{dt.reason}</span>
                        </div>
                        <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                          <span className="text-[11px] font-semibold text-foreground font-mono">{dt.minutes}m</span>
                          <span className="text-[10px] text-muted-foreground">({dt.count}x)</span>
                        </div>
                      </div>
                      <div className="ml-7 h-1 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-destructive/50 rounded-full" style={{ width: `${dt.pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground text-xs">Sin paradas registradas</div>
              )}
            </div>
          </div>

          {/* ═══ SECCION 6 — Cambios de proveedor ═════════════════════════ */}
          {dailyData.some(d => d.supplierChanged) && (
            <div className="bg-card rounded-lg border border-amber-200 dark:border-amber-800 p-5 shadow-sm mb-6">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
                <Truck className="h-4 w-4 text-amber-500" />
                Cambios de proveedor en {MONTH_NAMES[selectedMonthIdx]}
              </h3>
              <div className="space-y-2">
                {dailyData.filter(d => d.supplierChanged).map(d => (
                  <div key={d.fullDate} className="flex items-start gap-3 p-2.5 rounded-md bg-amber-50/50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30">
                    <div className="shrink-0 text-center">
                      <div className="text-xs font-bold text-amber-700 dark:text-amber-400">{d.date}</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap gap-2 text-[11px] mb-1">
                        {d.cementSupplier && <span className="bg-muted px-1.5 py-0.5 rounded">Cemento: <strong>{d.cementSupplier}</strong></span>}
                        {d.sandSupplier && <span className="bg-muted px-1.5 py-0.5 rounded">Arena: <strong>{d.sandSupplier}</strong></span>}
                        {d.stoneSupplier && <span className="bg-muted px-1.5 py-0.5 rounded">Piedra: <strong>{d.stoneSupplier}</strong></span>}
                      </div>
                      {d.supplierChangeNotes && (
                        <p className="text-[11px] text-muted-foreground">{d.supplierChangeNotes}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══ SECCION 7 — Tendencias: Comparacion mes actual vs anterior ═══ */}
          <div className="bg-card rounded-lg border border-border p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">
                Tendencias — {MONTH_NAMES[selectedMonthIdx]} vs {MONTH_NAMES[prevMonthIdx]}
              </h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-4 bg-muted/30 rounded-lg">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Tablas</div>
                <div className="text-2xl font-bold text-foreground">{(stats?.totalTablas || 0).toLocaleString("es-AR")}</div>
                {prevStats && prevStats.totalTablas > 0 && (
                  <div className={`text-sm font-semibold flex items-center justify-center gap-1 mt-1 ${
                    (stats?.totalTablas || 0) >= prevStats.totalTablas ? "text-emerald-600" : "text-red-600"
                  }`}>
                    {(stats?.totalTablas || 0) >= prevStats.totalTablas ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                    {Math.abs(((stats?.totalTablas || 0) - prevStats.totalTablas) / prevStats.totalTablas * 100).toFixed(1)}%
                  </div>
                )}
              </div>
              <div className="text-center p-4 bg-muted/30 rounded-lg">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">m2 Primera</div>
                <div className="text-2xl font-bold text-emerald-600">{Math.round(stats?.totalM2Primera || 0).toLocaleString("es-AR")}</div>
                {prevStats && prevStats.totalM2Primera > 0 && (
                  <div className={`text-sm font-semibold flex items-center justify-center gap-1 mt-1 ${
                    (stats?.totalM2Primera || 0) >= prevStats.totalM2Primera ? "text-emerald-600" : "text-red-600"
                  }`}>
                    {(stats?.totalM2Primera || 0) >= prevStats.totalM2Primera ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                    {Math.abs(((stats?.totalM2Primera || 0) - prevStats.totalM2Primera) / prevStats.totalM2Primera * 100).toFixed(1)}%
                  </div>
                )}
              </div>
              <div className="text-center p-4 bg-muted/30 rounded-lg">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">% Segunda</div>
                <div className="text-2xl font-bold text-amber-600">{(stats?.pctSegunda || 0).toFixed(1)}%</div>
                <div className="text-[10px] text-muted-foreground">{Math.round(stats?.totalM2Segunda || 0)} m2</div>
                {prevStats && prevStats.pctSegunda > 0 && (
                  <div className={`text-sm font-semibold flex items-center justify-center gap-1 mt-1 ${
                    (stats?.pctSegunda || 0) <= prevStats.pctSegunda ? "text-emerald-600" : "text-red-600"
                  }`}>
                    {(stats?.pctSegunda || 0) <= prevStats.pctSegunda ? <ArrowDownRight className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                    {Math.abs((stats?.pctSegunda || 0) - prevStats.pctSegunda).toFixed(1)}pp
                  </div>
                )}
              </div>
              <div className="text-center p-4 bg-muted/30 rounded-lg">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Min. Paradas</div>
                <div className="text-2xl font-bold text-foreground">{stats?.totalParadas || 0}</div>
                <div className="text-[10px] text-muted-foreground mt-1">Prom: {Math.round(stats?.avgParadas || 0)} min/dia</div>
              </div>
            </div>
          </div>
        </>
      )}
    </main>
  )
}
