"use client"

import { useState, useEffect, useMemo } from "react"
import { getSupabase } from "@/lib/supabase"
import { LayoutGrid, Clock, TrendingUp, ChevronLeft, ChevronRight, AlertTriangle, Truck, ArrowUpRight, ArrowDownRight, Package, Boxes } from "lucide-react"
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
  Legend,
  ComposedChart,
  Line,
} from "recharts"

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

type PaverChartMetric = "tablas" | "m2Primera" | "m2Segunda" | "pastones" | "paradas"

interface DailyData {
  date: string
  fullDate: string
  tablas: number
  pastones: number
  m2Primera: number
  m2Segunda: number
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
}

interface StockItem {
  name: string
  stockTn: number
  criticalLevel: number
  warningLevel: number
  daysOfCoverage: number
}

// ── Helper components ──────────────────────────────────────────────────────

function KpiCard({ 
  label, 
  value, 
  unit = "", 
  prevValue, 
  prevLabel,
  highlight = false,
  size = "default"
}: { 
  label: string
  value: number | string
  unit?: string
  prevValue?: number
  prevLabel?: string
  highlight?: boolean
  size?: "default" | "large"
}) {
  const pct = prevValue && typeof value === "number" && prevValue > 0 
    ? ((value - prevValue) / prevValue * 100) 
    : 0
  const up = pct >= 0
  
  return (
    <div className={`rounded-lg p-4 ${highlight ? "bg-primary/5 border border-primary/15" : "bg-card border border-border shadow-sm"}`}>
      <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1 font-medium">{label}</div>
      <div className={`font-bold text-foreground ${size === "large" ? "text-3xl" : "text-2xl"}`}>
        {typeof value === "number" ? value.toLocaleString("es-AR") : value}
        {unit && <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>}
      </div>
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
  const [selectedMonthIdx, setSelectedMonthIdx] = useState(now.getMonth())
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [loading, setLoading] = useState(true)
  const [records, setRecords] = useState<any[]>([])
  const [prevRecords, setPrevRecords] = useState<any[]>([])
  const [stockData, setStockData] = useState<StockItem[]>([])
  const [chartMetric, setChartMetric] = useState<PaverChartMetric>("tablas")

  useEffect(() => {
    let retries = 0
    const attempt = () => {
      loadData(selectedMonthIdx, selectedYear).catch(() => {
        if (retries < 3) { retries++; setTimeout(attempt, 1000) }
      })
    }
    attempt()
  }, [selectedMonthIdx, selectedYear])

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

    const [cmResult, pmResult] = await Promise.all([
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
    ])

    if (cmResult.error) { setLoading(false); return }
    setRecords(cmResult.data || [])
    setPrevRecords(pmResult.data || [])

    // Calculate stock from mp_receipts and consumption
    try {
      const { data: receipts } = await supabase
        .from("mp_receipts")
        .select("material_type, quantity_tn")
        .eq("line_type", "adoquines")
        .gte("receipt_date", start)
        .lte("receipt_date", end)

      // Calculate daily consumption from production records
      const totalCement = (cmResult.data || []).reduce((s: number, r: any) => 
        s + (r.cement_silo_1_tn || 0) + (r.cement_silo_2_tn || 0), 0)
      const prodDays = (cmResult.data || []).length || 1
      const dailyCementConsumption = totalCement / prodDays

      // Estimate other materials based on typical ratios
      const dailySandConsumption = dailyCementConsumption * 2.5
      const dailyStoneConsumption = dailyCementConsumption * 3

      // Aggregate receipts by material
      const stockMap: Record<string, number> = {}
      ;(receipts || []).forEach((r: any) => {
        const key = r.material_type || "Otro"
        stockMap[key] = (stockMap[key] || 0) + (r.quantity_tn || 0)
      })

      setStockData([
        { 
          name: "Arena", 
          stockTn: stockMap["Arena"] || 0, 
          criticalLevel: 50, 
          warningLevel: 100,
          daysOfCoverage: dailySandConsumption > 0 ? Math.round((stockMap["Arena"] || 0) / dailySandConsumption) : 0
        },
        { 
          name: "Piedra", 
          stockTn: stockMap["Piedra"] || stockMap["Piedra 0/6"] || 0, 
          criticalLevel: 50, 
          warningLevel: 100,
          daysOfCoverage: dailyStoneConsumption > 0 ? Math.round((stockMap["Piedra"] || stockMap["Piedra 0/6"] || 0) / dailyStoneConsumption) : 0
        },
        { 
          name: "Cemento", 
          stockTn: stockMap["Cemento"] || 0, 
          criticalLevel: 20, 
          warningLevel: 40,
          daysOfCoverage: dailyCementConsumption > 0 ? Math.round((stockMap["Cemento"] || 0) / dailyCementConsumption) : 0
        },
      ])
    } catch {
      setStockData([
        { name: "Arena", stockTn: 0, criticalLevel: 50, warningLevel: 100, daysOfCoverage: 0 },
        { name: "Piedra", stockTn: 0, criticalLevel: 50, warningLevel: 100, daysOfCoverage: 0 },
        { name: "Cemento", stockTn: 0, criticalLevel: 20, warningLevel: 40, daysOfCoverage: 0 },
      ])
    }

    setLoading(false)
  }

  // Process daily data
  const dailyData = useMemo<DailyData[]>(() => {
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

      return {
        date: new Date(r.production_date + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }),
        fullDate: r.production_date,
        tablas: r.tables_produced || 0,
        pastones: r.pastones_count || 0,
        m2Primera: r.palletized_first || 0,
        m2Segunda: r.palletized_second || 0,
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
      }
    })
  }, [records])

  // Stats — current month
  const stats = useMemo(() => {
    if (dailyData.length === 0) return null
    const n = dailyData.length
    const totalTablas = dailyData.reduce((s, d) => s + d.tablas, 0)
    const totalPastones = dailyData.reduce((s, d) => s + d.pastones, 0)
    const totalM2Primera = dailyData.reduce((s, d) => s + d.m2Primera, 0)
    const totalM2Segunda = dailyData.reduce((s, d) => s + d.m2Segunda, 0)
    const totalCemento = dailyData.reduce((s, d) => s + d.cementoTotal, 0)
    const totalParadas = dailyData.reduce((s, d) => s + d.paradas, 0)
    return {
      days: n,
      totalTablas,
      avgTablas: totalTablas / n,
      totalPastones,
      avgPastones: totalPastones / n,
      totalM2Primera,
      totalM2Segunda,
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
    const totalM2Primera = prevRecords.reduce((s: number, r: any) => s + (r.palletized_first || 0), 0)
    const totalM2Segunda = prevRecords.reduce((s: number, r: any) => s + (r.palletized_second || 0), 0)
    return { 
      days: n, 
      avgTablas: totalTablas / n, 
      totalTablas,
      totalPastones,
      avgPastones: totalPastones / n,
      totalM2Primera,
      totalM2Segunda
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

  // Quality chart data (m2 primera vs segunda)
  const qualityChartData = useMemo(() => {
    return dailyData.map(d => ({
      date: d.date,
      primera: d.m2Primera,
      segunda: d.m2Segunda,
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
    // Check stock alerts
    stockData.forEach(s => {
      if (s.stockTn > 0 && s.stockTn <= s.criticalLevel) {
        result.push(`Stock critico de ${s.name}`)
      }
    })
    // Check production alerts
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
    m2Segunda: "m2 2da",
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
              />
              <KpiCard 
                label="Total tablas" 
                value={stats?.totalTablas || 0} 
                prevValue={prevStats?.totalTablas}
                size="large"
              />
              <KpiCard 
                label="m2 Primera calidad" 
                value={stats?.totalM2Primera || 0} 
                unit="m2"
                prevValue={prevStats?.totalM2Primera}
              />
              <KpiCard 
                label="m2 Segunda calidad" 
                value={stats?.totalM2Segunda || 0} 
                unit="m2"
                prevValue={prevStats?.totalM2Segunda}
              />
            </div>
          </div>

          {/* ═══ SECCION 3 — Produccion: Grafico diario + Tendencia semanal ═══ */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            {/* Grafico de tendencia diaria */}
            <div className="lg:col-span-2 bg-card rounded-lg border border-border p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-foreground">Tendencia diaria</h3>
                <div className="flex gap-1 flex-wrap">
                  {(["tablas", "m2Primera", "m2Segunda", "pastones", "paradas"] as PaverChartMetric[]).map(m => (
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
                        return (
                          <div className="bg-card border border-border rounded-lg shadow-lg p-3 max-w-[280px]">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-semibold text-foreground">{d.date}</span>
                              {d.productType && <span className="text-[10px] text-muted-foreground">{d.productType}</span>}
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                              <span className="text-muted-foreground">Tablas:</span>
                              <span className="font-semibold text-foreground">{d.tablas}</span>
                              <span className="text-muted-foreground">Pastones:</span>
                              <span className="font-semibold text-foreground">{d.pastones}</span>
                              <span className="text-muted-foreground">m2 1ra:</span>
                              <span className="font-semibold text-emerald-600">{d.m2Primera}</span>
                              <span className="text-muted-foreground">m2 2da:</span>
                              <span className="font-semibold text-amber-600">{d.m2Segunda}</span>
                              <span className="text-muted-foreground">Paradas:</span>
                              <span className="font-semibold text-foreground">{d.paradas} min</span>
                            </div>
                            {d.topStopReason && d.topStopMinutes > 10 && (
                              <div className="mt-2 pt-2 border-t border-border text-[10px] text-muted-foreground">
                                Parada ppal: {d.topStopReason} ({d.topStopMinutes} min)
                              </div>
                            )}
                          </div>
                        )
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey={chartMetric}
                      stroke={chartMetric === "paradas" ? "#dc2626" : chartMetric === "m2Segunda" ? "#d97706" : "#1e3a5f"}
                      strokeWidth={2}
                      fill="url(#paverFill)"
                      dot={{ r: 2.5, fill: chartMetric === "paradas" ? "#dc2626" : "#1e3a5f" }}
                    />
                    {stats && chartMetric === "tablas" && (
                      <ReferenceLine 
                        y={Math.round(stats.avgTablas)} 
                        stroke="#1e3a5f" 
                        strokeDasharray="4 4" 
                        strokeOpacity={0.6}
                        label={{ value: `Prom: ${Math.round(stats.avgTablas)}`, position: "insideTopRight", fontSize: 10, fill: "#1e3a5f", fontWeight: 600 }}
                      />
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

          {/* ═══ SECCION 4 — Calidad: m2 Primera vs Segunda ══════════════════ */}
          <div className="bg-card rounded-lg border border-border p-5 shadow-sm mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Calidad de produccion</h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">m2 primera vs segunda calidad por dia</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded bg-emerald-500" />
                  <span className="text-[10px] text-muted-foreground">1ra Calidad</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded bg-amber-500" />
                  <span className="text-[10px] text-muted-foreground">2da Calidad</span>
                </div>
              </div>
            </div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={qualityChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const total = (payload[0]?.value as number || 0) + (payload[1]?.value as number || 0)
                      const pctPrimera = total > 0 ? ((payload[0]?.value as number || 0) / total * 100).toFixed(1) : "0"
                      return (
                        <div className="bg-card border border-border rounded-lg shadow-lg p-3 text-[11px]">
                          <div className="font-semibold mb-1">{payload[0]?.payload?.date}</div>
                          <div className="text-emerald-600">1ra: {payload[0]?.value} m2 ({pctPrimera}%)</div>
                          <div className="text-amber-600">2da: {payload[1]?.value} m2</div>
                        </div>
                      )
                    }}
                  />
                  <Bar dataKey="primera" stackId="quality" fill="#10b981" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="segunda" stackId="quality" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
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
                <div className="text-2xl font-bold text-foreground">{stats?.totalTablas || 0}</div>
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
                <div className="text-2xl font-bold text-emerald-600">{stats?.totalM2Primera || 0}</div>
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
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">m2 Segunda</div>
                <div className="text-2xl font-bold text-amber-600">{stats?.totalM2Segunda || 0}</div>
                {prevStats && prevStats.totalM2Segunda > 0 && (
                  <div className={`text-sm font-semibold flex items-center justify-center gap-1 mt-1 ${
                    (stats?.totalM2Segunda || 0) <= prevStats.totalM2Segunda ? "text-emerald-600" : "text-red-600"
                  }`}>
                    {(stats?.totalM2Segunda || 0) <= prevStats.totalM2Segunda ? <ArrowDownRight className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                    {Math.abs(((stats?.totalM2Segunda || 0) - prevStats.totalM2Segunda) / prevStats.totalM2Segunda * 100).toFixed(1)}%
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
