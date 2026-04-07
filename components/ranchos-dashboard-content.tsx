"use client"

import { useState, useEffect, useMemo } from "react"
import { getSupabase } from "@/lib/supabase"
import { LayoutGrid, Clock, TrendingUp, ChevronLeft, ChevronRight, AlertTriangle, Truck, ArrowUpRight, ArrowDownRight } from "lucide-react"
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

type PaverChartMetric = "pastones" | "cementoTotal" | "paradas"

interface DailyData {
  date: string
  fullDate: string
  pastones: number
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

// ── Helper components ──────────────────────────────────────────────────────

function OeeGauge({ label, value, target = 85 }: { label: string; value: number; target?: number }) {
  const isOk = value >= target
  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">{label}</div>
      <div className={`text-3xl font-bold ${isOk ? "text-emerald-500" : "text-amber-500"}`}>
        {value}<span className="text-sm font-normal text-muted-foreground ml-0.5">%</span>
      </div>
      <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${isOk ? "bg-emerald-500" : "bg-amber-500"} rounded-full`}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
      <div className="text-[10px] text-muted-foreground mt-1">Obj: {target}%</div>
    </div>
  )
}

function MpCard({ name, stockTn }: { name: string; stockTn: number }) {
  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">{name}</div>
      {stockTn > 0 ? (
        <div className="text-xl font-bold text-foreground">
          {stockTn.toFixed(1)}<span className="text-sm font-normal text-muted-foreground ml-1">tn</span>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground mt-2">Sin datos de stock</div>
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
  const [selectedMonthIdx, setSelectedMonthIdx] = useState(now.getMonth())
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [loading, setLoading] = useState(true)
  const [records, setRecords] = useState<any[]>([])
  const [prevRecords, setPrevRecords] = useState<any[]>([])
  const [mpData, setMpData] = useState<{ name: string; stockTn: number }[]>([])
  const [chartMetric, setChartMetric] = useState<PaverChartMetric>("pastones")

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
        .select("pastones_count, production_date")
        .gte("production_date", pmStart)
        .lte("production_date", pmEnd),
    ])

    if (cmResult.error) { setLoading(false); return }
    setRecords(cmResult.data || [])
    setPrevRecords(pmResult.data || [])

    // Independent mp_receipts fetch — graceful fallback
    try {
      const { data: mpResult } = await supabase
        .from("mp_receipts")
        .select("material_name, quantity_tn, receipt_date")
        .eq("plant", "ranchos")
        .gte("receipt_date", start)
        .lte("receipt_date", end)

      if (mpResult && mpResult.length > 0) {
        const MATERIALS = ["Arena", "Piedra 0/6", "Cemento", "Aditivos"]
        const stockMap: Record<string, number> = {}
        mpResult.forEach((r: any) => {
          stockMap[r.material_name] = (stockMap[r.material_name] || 0) + (r.quantity_tn || 0)
        })
        setMpData(MATERIALS.map(name => ({ name, stockTn: stockMap[name] || 0 })))
      } else {
        setMpData([
          { name: "Arena", stockTn: 0 },
          { name: "Piedra 0/6", stockTn: 0 },
          { name: "Cemento", stockTn: 0 },
          { name: "Aditivos", stockTn: 0 },
        ])
      }
    } catch {
      setMpData([
        { name: "Arena", stockTn: 0 },
        { name: "Piedra 0/6", stockTn: 0 },
        { name: "Cemento", stockTn: 0 },
        { name: "Aditivos", stockTn: 0 },
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
        pastones: r.pastones_count || 0,
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
    const totalPastones = dailyData.reduce((s, d) => s + d.pastones, 0)
    const totalCemento = dailyData.reduce((s, d) => s + d.cementoTotal, 0)
    const totalParadas = dailyData.reduce((s, d) => s + d.paradas, 0)
    return {
      days: n,
      totalPastones,
      avgPastones: totalPastones / n,
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
    const totalPastones = prevRecords.reduce((s: number, r: any) => s + (r.pastones_count || 0), 0)
    return { days: n, avgPastones: totalPastones / n, totalPastones }
  }, [prevRecords])

  // Filtered averages for reference lines
  const filteredAvg = useMemo(() => {
    if (dailyData.length === 0) return null
    const n = dailyData.length
    return {
      avgPastones: dailyData.reduce((s, d) => s + d.pastones, 0) / n,
      avgCemento: dailyData.reduce((s, d) => s + d.cementoTotal, 0) / n,
      avgParadas: dailyData.reduce((s, d) => s + d.paradas, 0) / n,
    }
  }, [dailyData])

  // Weekly data
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
        .reduce((s, d) => s + d.pastones, 0)

    return weeks.map((w, i) => ({
      label: w.label,
      current: getTotForRange(w.range),
      previous: i > 0 ? getTotForRange(weeks[i - 1].range) : 0,
    }))
  }, [dailyData])

  // OEE for adoquines
  const oeeData = useMemo(() => {
    const daysWithTime = dailyData.filter(d => d.productionMinutes > 0)
    if (daysWithTime.length === 0) return null
    const totalProd = daysWithTime.reduce((s, d) => s + d.productionMinutes, 0)
    const totalParadas = daysWithTime.reduce((s, d) => s + d.paradas, 0)
    const id = ((totalProd - totalParadas) / totalProd) * 100
    const totalPastones = daysWithTime.reduce((s, d) => s + d.pastones, 0)
    const objetivo = daysWithTime.length * 35 * 2 // 35 pastones/turno, 2 turnos
    const ir = Math.min((totalPastones / objetivo) * 100, 100)
    const oee = (id * ir) / 100
    return { id: Math.round(id), ir: Math.round(ir), oee: Math.round(oee) }
  }, [dailyData])

  // Top 5 paradas agrupadas
  const top5Paradas = useMemo(() => {
    const map = new Map<string, number>()
    records.forEach(r => {
      ;(r.paver_downtime || []).forEach((dt: any) => {
        const reason = dt.custom_reason || "Sin especificar"
        map.set(reason, (map.get(reason) || 0) + (dt.minutes || 0))
      })
    })
    const total = Array.from(map.values()).reduce((s, v) => s + v, 0)
    return Array.from(map.entries())
      .map(([reason, minutes]) => ({ reason, minutes, pct: total > 0 ? Math.round((minutes / total) * 100) : 0 }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 5)
  }, [records])

  // Alerts
  const alerts = useMemo(() => {
    const result: string[] = []
    if (dailyData.length >= 2) {
      // Check consecutive days without production
      let maxConsecutive = 0
      let current = 0
      dailyData.forEach(d => {
        if (d.pastones === 0) { current++; maxConsecutive = Math.max(maxConsecutive, current) }
        else current = 0
      })
      if (maxConsecutive >= 2) result.push(`${maxConsecutive} dias consecutivos sin produccion`)
    }
    return result
  }, [dailyData])

  const chartLabels: Record<PaverChartMetric, string> = {
    pastones: "Pastones", cementoTotal: "Cemento total (tn)", paradas: "Min. paradas"
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
            No hay partes de produccion cargados para este mes. Anda a "Nueva Produccion" para cargar el primer parte de adoquines.
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

          {/* ═══ SECCION 2 — KPIs del mes ══════════════════════════════════ */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
              <h2 className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">
                KPIs del mes — comparacion con {MONTH_NAMES[prevMonthIdx]}
              </h2>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              {/* Dias producidos */}
              <div className="bg-primary/5 border border-primary/15 rounded-lg p-4">
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Dias producidos</div>
                <div className="text-2xl font-bold text-foreground">{stats?.days || 0}</div>
                {prevStats && (
                  <div className="text-[10px] text-muted-foreground mt-1">Mes ant.: {prevStats.days}</div>
                )}
              </div>

              {/* Pastones del mes */}
              <div className="bg-card rounded-lg border border-border p-4 shadow-sm">
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1 font-medium">Pastones totales</div>
                <div className="text-2xl font-bold text-foreground">{stats?.totalPastones || 0}</div>
                {prevStats && (
                  <div className="flex items-center gap-2 mt-1">
                    {stats && prevStats.totalPastones > 0 ? (
                      <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${stats.totalPastones >= prevStats.totalPastones ? "text-emerald-600" : "text-red-600"}`}>
                        {stats.totalPastones >= prevStats.totalPastones ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                        {(((stats.totalPastones - prevStats.totalPastones) / prevStats.totalPastones) * 100).toFixed(1)}%
                      </span>
                    ) : null}
                    <span className="text-[10px] text-muted-foreground">vs mes ant. ({prevStats.totalPastones})</span>
                  </div>
                )}
              </div>

              {/* Promedio pastones/dia */}
              <div className="bg-card rounded-lg border border-border p-4 shadow-sm">
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1 font-medium">Prom. pastones/dia</div>
                <div className="text-2xl font-bold text-foreground">{Math.round(stats?.avgPastones || 0)}</div>
                {prevStats && (
                  <div className="flex items-center gap-2 mt-1">
                    {stats && prevStats.avgPastones > 0 ? (
                      <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${stats.avgPastones >= prevStats.avgPastones ? "text-emerald-600" : "text-red-600"}`}>
                        {stats.avgPastones >= prevStats.avgPastones ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                        {(((stats.avgPastones - prevStats.avgPastones) / prevStats.avgPastones) * 100).toFixed(1)}%
                      </span>
                    ) : null}
                    <span className="text-[10px] text-muted-foreground">vs mes ant. ({Math.round(prevStats.avgPastones)})</span>
                  </div>
                )}
              </div>

              {/* Cemento total */}
              <div className="bg-card rounded-lg border border-border p-4 shadow-sm">
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1 font-medium">Cemento total</div>
                <div className="text-2xl font-bold text-foreground">{(stats?.totalCemento || 0).toFixed(2)}<span className="text-sm font-normal text-muted-foreground ml-1">tn</span></div>
                <div className="text-[10px] text-muted-foreground mt-1">Prom: {(stats?.avgCemento || 0).toFixed(2)} tn/dia</div>
              </div>

              {/* Paradas total */}
              <div className="bg-destructive/5 border border-destructive/15 rounded-lg p-4">
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Min. paradas total</div>
                <div className="text-2xl font-bold text-foreground">{stats?.totalParadas || 0}<span className="text-sm font-normal text-muted-foreground ml-1">min</span></div>
                <div className="text-[10px] text-muted-foreground mt-1">Prom: {Math.round(stats?.avgParadas || 0)} min/dia</div>
              </div>
            </div>
          </div>

          {/* ═══ SECCION 3 — Tendencia semanal ════════════════════════════ */}
          <div className="bg-card rounded-lg border border-border p-5 shadow-sm mb-6">
            <h3 className="text-sm font-semibold text-foreground mb-4">Tendencia semanal — pastones</h3>
            <div className="h-48 mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyData} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      return (
                        <div className="bg-card border border-border rounded-lg shadow-lg p-3 text-[11px]">
                          <div className="font-semibold mb-1">{payload[0]?.payload?.label}</div>
                          <div className="text-muted-foreground">Esta semana: <span className="font-bold text-foreground">{payload[0]?.value}</span></div>
                          {payload[1] && <div className="text-muted-foreground">Semana ant.: <span className="font-bold text-foreground">{payload[1]?.value}</span></div>}
                        </div>
                      )
                    }}
                  />
                  <Bar dataKey="current" name="Esta semana" fill="#1e3a5f" radius={[3, 3, 0, 0]} barSize={22} />
                  <Bar dataKey="previous" name="Semana ant." fill="#94a3b8" radius={[3, 3, 0, 0]} barSize={22} fillOpacity={0.6} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-4 gap-2 pt-3 border-t border-border">
              {weeklyData.map(w => (
                <WeekTrend key={w.label} label={w.label} current={w.current} previous={w.previous} />
              ))}
            </div>
          </div>

          {/* ═══ SECCION 4 — OEE + Gráfico diario + Top 5 Paradas ════════ */}
          {oeeData && (
            <div className="grid grid-cols-3 gap-3 mb-6">
              <OeeGauge label="ID — Disponibilidad" value={oeeData.id} target={85} />
              <OeeGauge label="IR — Rendimiento" value={oeeData.ir} target={80} />
              <OeeGauge label="OEE" value={oeeData.oee} target={68} />
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            {/* Gráfico de área diaria */}
            <div className="lg:col-span-2 bg-card rounded-lg border border-border p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-foreground">Tendencia diaria</h3>
                <div className="flex gap-1">
                  {(["pastones", "cementoTotal", "paradas"] as PaverChartMetric[]).map(m => (
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
                        const insights: string[] = []
                        if (d.pastones === 0) insights.push("No hubo produccion este dia")
                        if (filteredAvg) {
                          if (d.pastones > 0 && d.pastones < filteredAvg.avgPastones * 0.7) insights.push("Pastones muy bajos vs promedio")
                          if (d.paradas > filteredAvg.avgParadas * 1.5 && d.paradas > 0) insights.push(`Paradas elevadas: ${d.paradas} min (prom. ${Math.round(filteredAvg.avgParadas)})`)
                        }
                        if (d.topStopReason && d.topStopMinutes > 10) insights.push(`Parada ppal: ${d.topStopReason} (${d.topStopMinutes} min)`)
                        if (d.observations) insights.push(`Obs: ${d.observations}`)

                        return (
                          <div className="bg-card border border-border rounded-lg shadow-lg p-3 max-w-[300px]">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-semibold text-foreground">{d.date}</span>
                              <div className="flex items-center gap-1.5">
                                {d.productType && <span className="text-[10px] text-muted-foreground">{d.productType}</span>}
                                {d.supplierChanged && (
                                  <span className="text-[9px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded-full font-medium">
                                    Cambio proveedor
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] mb-2">
                              <span className="text-muted-foreground">Pastones:</span>
                              <span className="font-semibold text-foreground">{d.pastones}</span>
                              <span className="text-muted-foreground">Cemento:</span>
                              <span className="font-semibold text-foreground">{d.cementoTotal} tn</span>
                              <span className="text-muted-foreground">Paradas:</span>
                              <span className="font-semibold text-foreground">{d.paradas} min</span>
                              <span className="text-muted-foreground">Tiempo extra:</span>
                              <span className="font-semibold text-foreground">{d.extraMinutes} min</span>
                            </div>
                            {(d.cementSupplier || d.sandSupplier || d.stoneSupplier) && (
                              <div className="border-t border-border pt-1.5 mt-1 mb-1">
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Proveedores</p>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
                                  {d.cementSupplier && <><span className="text-muted-foreground">Cemento:</span><span className="font-medium text-foreground">{d.cementSupplier}</span></>}
                                  {d.sandSupplier && <><span className="text-muted-foreground">Arena:</span><span className="font-medium text-foreground">{d.sandSupplier}</span></>}
                                  {d.stoneSupplier && <><span className="text-muted-foreground">Piedra:</span><span className="font-medium text-foreground">{d.stoneSupplier}</span></>}
                                </div>
                              </div>
                            )}
                            {d.supplierChanged && d.supplierChangeNotes && (
                              <div className="border-t border-amber-200 dark:border-amber-800 pt-1.5 mt-1 bg-amber-50/50 dark:bg-amber-900/10 -mx-3 px-3 pb-1 rounded-b-lg">
                                <p className="text-[10px] text-amber-700 dark:text-amber-400 leading-snug">
                                  <strong>Cambio:</strong> {d.supplierChangeNotes}
                                </p>
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
                      dataKey={chartMetric}
                      stroke={chartMetric === "paradas" ? "#dc2626" : "#1e3a5f"}
                      strokeWidth={2}
                      fill="url(#paverFill)"
                      dot={{ r: 2.5, fill: chartMetric === "paradas" ? "#dc2626" : "#1e3a5f" }}
                      name={chartLabels[chartMetric]}
                    />
                    {chartMetric === "pastones" && filteredAvg && <ReferenceLine y={Math.round(filteredAvg.avgPastones)} stroke="#1e3a5f" strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: `Prom: ${Math.round(filteredAvg.avgPastones)}`, position: "insideTopRight", fontSize: 10, fill: "#1e3a5f", fontWeight: 600 }} />}
                    {chartMetric === "cementoTotal" && filteredAvg && <ReferenceLine y={Number(filteredAvg.avgCemento.toFixed(2))} stroke="#1e3a5f" strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: `Prom: ${filteredAvg.avgCemento.toFixed(2)} tn`, position: "insideTopRight", fontSize: 10, fill: "#1e3a5f", fontWeight: 600 }} />}
                    {chartMetric === "paradas" && filteredAvg && <ReferenceLine y={Math.round(filteredAvg.avgParadas)} stroke="#dc2626" strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: `Prom: ${Math.round(filteredAvg.avgParadas)} min`, position: "insideTopRight", fontSize: 10, fill: "#dc2626", fontWeight: 600 }} />}
                    {dailyData.filter(d => d.supplierChanged).map(d => (
                      <ReferenceLine
                        key={`sup-${d.date}`}
                        x={d.date}
                        stroke="#d97706"
                        strokeDasharray="3 3"
                        strokeWidth={2}
                        strokeOpacity={0.7}
                        label={{ value: "Cambio prov.", position: "top", fontSize: 8, fill: "#d97706", fontWeight: 600 }}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
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
                          <span className="text-[10px] text-muted-foreground">({dt.pct}%)</span>
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

          {/* Supplier Changes Summary */}
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

          {/* ═══ SECCION 5 — Materia prima ═════════════════════════════════ */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <LayoutGrid className="w-3.5 h-3.5 text-muted-foreground" />
              <h2 className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">Materia prima — ingresos del mes</h2>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {mpData.map(mp => (
                <MpCard key={mp.name} name={mp.name} stockTn={mp.stockTn} />
              ))}
            </div>
          </div>
        </>
      )}
    </main>
  )
}

