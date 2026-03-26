"use client"

import { useMemo, useState } from "react"
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Area, AreaChart, ReferenceLine,
} from "recharts"
import { ArrowUpRight, ArrowDownRight, Calendar, Clock, TrendingUp, Minus } from "lucide-react"
import { calculateReportMetrics, calculatePipeMetrics, TARGETS, type ReportMetrics, type PipeReportMetrics } from "@/lib/report-utils"

// ── Types ──────────────────────────────────────────────────────────────────

interface ProductionTrendChartProps {
  lineType: "bloques" | "canos"
  records: any[]
  prevRecords?: any[]
  pipeWeights?: Record<string, number>
  pipeTargets?: Record<string, number>
  monthLabel?: string
  prevMonthLabel?: string
}

type BlockChartMetric = "bandejas" | "descartados" | "paradas" | "horasProducidas"
type PipeChartMetric = "tnHora" | "canos" | "tnTotal" | "paradas" | "canosVsPlan"
type PipeShiftFilter = "todos" | "1" | "2"
type PipeFilter = "todos" | "3" | "4"

const PIPE_SIZES = ["300", "400", "500", "600", "800", "1000", "1200"]
const PIPE_WEIGHTS_DEFAULT: Record<string, number> = {
  "300": 95, "400": 150, "500": 220, "600": 310, "800": 520, "1000": 1080, "1200": 1100
}

// ── Helpers ────────────────────────────────────────────────────────────────

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

function ComparisonCard({ label, current, previous, unit, decimals = 1, invert = false, prevLabel = "vs periodo ant." }: {
  label: string; current: number; previous: number; unit: string; decimals?: number; invert?: boolean; prevLabel?: string
}) {
  return (
    <div className="bg-card rounded-lg border border-border p-4 shadow-sm">
      <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1 font-medium">{label}</div>
      <div className="text-2xl font-bold text-foreground">{current.toFixed(decimals)}<span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span></div>
      <div className="flex items-center gap-2 mt-1">
        <DeltaBadge current={current} previous={previous} unit={unit} invert={invert} />
        <span className="text-[10px] text-muted-foreground">{prevLabel} ({previous.toFixed(decimals)})</span>
      </div>
    </div>
  )
}

// ── Process data ──────────────────────────────────────────────────────────

function processBlockData(records: any[]) {
  const metrics = records.map(r => calculateReportMetrics(r))

  const dtMap = new Map<string, number>()
  records.forEach(r => {
    (r.block_downtime || []).forEach((dt: any) => {
      const reason = dt.custom_reason || "Sin especificar"
      dtMap.set(reason, (dtMap.get(reason) || 0) + (dt.minutes || 0))
    })
  })
  const topDowntimes = Array.from(dtMap.entries()).map(([reason, minutes]) => ({ reason, minutes })).sort((a, b) => b.minutes - a.minutes).slice(0, 5)

  return { metrics, topDowntimes }
}

function processPipeData(records: any[], weights: Record<string, number>) {
  const dailyData = records.map(record => {
    let totalUnits = 0
    let totalWeightKg = 0
    const productionBySize: Record<string, number> = {}
    for (const size of PIPE_SIZES) {
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

  const dtMap = new Map<string, number>()
  records.forEach(r => {
    (r.pipe_downtime || []).forEach((dt: any) => {
      const reason = dt.custom_reason || "Sin especificar"
      dtMap.set(reason, (dtMap.get(reason) || 0) + (dt.minutes || 0))
    })
  })
  const topDowntimes = Array.from(dtMap.entries()).map(([reason, minutes]) => ({ reason, minutes })).sort((a, b) => b.minutes - a.minutes).slice(0, 5)

  return { dailyData, topDowntimes }
}

// ── Main Component ────────────────────────────────────────────────────────

export function ProductionTrendChart({
  lineType,
  records,
  prevRecords = [],
  pipeWeights = PIPE_WEIGHTS_DEFAULT,
  pipeTargets = {},
  monthLabel = "este periodo",
  prevMonthLabel = "periodo anterior",
}: ProductionTrendChartProps) {

  // Block state
  const [blockChartMetric, setBlockChartMetric] = useState<BlockChartMetric>("bandejas")

  // Pipe state
  const [pipeChartMetric, setPipeChartMetric] = useState<PipeChartMetric>("tnHora")
  const [pipeShiftFilter, setPipeShiftFilter] = useState<PipeShiftFilter>("todos")
  const [pipeFilter, setPipeFilter] = useState<PipeFilter>("todos")
  const [pipeMoldFilter, setPipeMoldFilter] = useState("todos")

  // ── Block data ──────────────────────────────────────────────────────
  const blockData = useMemo(() => {
    if (lineType !== "bloques") return null
    return processBlockData(records)
  }, [lineType, records])

  const prevBlockData = useMemo(() => {
    if (lineType !== "bloques" || prevRecords.length === 0) return null
    return processBlockData(prevRecords)
  }, [lineType, prevRecords])

  const blockChartData = useMemo(() => {
    if (!blockData) return []
    return blockData.metrics.map((m, idx) => {
      const record = records[idx]
      const downtimes = (record?.block_downtime || []) as any[]
      const topStop = downtimes.length > 0 ? downtimes.sort((a: any, b: any) => (b.minutes || 0) - (a.minutes || 0))[0] : null
      return {
        date: new Date(m.date + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }),
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
      }
    })
  }, [blockData, records])

  const cmBlockStats = useMemo(() => {
    if (!blockData || blockData.metrics.length === 0) return null
    const m = blockData.metrics
    const days = m.length
    return {
      days,
      avgBandejas: m.reduce((s, x) => s + x.traysProduced, 0) / days,
      avgDowntime: m.reduce((s, x) => s + x.totalDowntimeMinutes, 0) / days,
      avgOEE: m.reduce((s, x) => s + x.oee, 0) / days,
      avgRacks: m.reduce((s, x) => s + x.racksPerHour, 0) / days,
      totalDowntime: m.reduce((s, x) => s + x.totalDowntimeMinutes, 0),
    }
  }, [blockData])

  const pmBlockStats = useMemo(() => {
    if (!prevBlockData || prevBlockData.metrics.length === 0) return null
    const m = prevBlockData.metrics
    const days = m.length
    return {
      days,
      avgBandejas: m.reduce((s, x) => s + x.traysProduced, 0) / days,
      avgDowntime: m.reduce((s, x) => s + x.totalDowntimeMinutes, 0) / days,
      avgOEE: m.reduce((s, x) => s + x.oee, 0) / days,
      avgRacks: m.reduce((s, x) => s + x.racksPerHour, 0) / days,
    }
  }, [prevBlockData])

  // ── Pipe data ───────────────────────────────────────────────────────
  const pipeData = useMemo(() => {
    if (lineType !== "canos") return null
    return processPipeData(records, pipeWeights)
  }, [lineType, records, pipeWeights])

  const prevPipeData = useMemo(() => {
    if (lineType !== "canos" || prevRecords.length === 0) return null
    return processPipeData(prevRecords, pipeWeights)
  }, [lineType, prevRecords, pipeWeights])

  const pipeChartData = useMemo(() => {
    if (!pipeData) return []
    let data = pipeData.dailyData
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
  }, [pipeData, pipeShiftFilter, pipeFilter, pipeMoldFilter])

  const pipeMoldOptions = useMemo(() => {
    if (!pipeData) return []
    const sizes = new Set<string>()
    pipeData.dailyData.forEach(d => Object.keys(d.productionBySize).forEach(s => sizes.add(s)))
    return Array.from(sizes).sort((a, b) => Number(a) - Number(b))
  }, [pipeData])

  const cmPipeStats = useMemo(() => {
    if (!pipeData || pipeData.dailyData.length === 0) return null
    const d = pipeData.dailyData
    const days = new Set(d.map(x => x.date)).size
    const totalTn = d.reduce((s, x) => s + x.totalWeightTn, 0)
    const totalAvailH = d.reduce((s, x) => s + x.availableMinutes, 0) / 60
    const totalDowntime = d.reduce((s, x) => s + x.downtimeMin, 0)
    const totalUnits = d.reduce((s, x) => s + x.totalUnits, 0)
    return {
      days,
      avgDowntime: totalDowntime / days,
      tnPerHour: totalAvailH > 0 ? totalTn / totalAvailH : 0,
      totalDowntime,
      totalTn,
      totalUnits,
    }
  }, [pipeData])

  const pmPipeStats = useMemo(() => {
    if (!prevPipeData || prevPipeData.dailyData.length === 0) return null
    const d = prevPipeData.dailyData
    const days = new Set(d.map(x => x.date)).size
    const totalTn = d.reduce((s, x) => s + x.totalWeightTn, 0)
    const totalAvailH = d.reduce((s, x) => s + x.availableMinutes, 0) / 60
    return {
      days,
      avgDowntime: d.reduce((s, x) => s + x.downtimeMin, 0) / days,
      tnPerHour: totalAvailH > 0 ? totalTn / totalAvailH : 0,
      totalTn,
    }
  }, [prevPipeData])

  const filteredPipeAvg = useMemo(() => {
    if (pipeChartData.length === 0) return null
    const n = pipeChartData.length
    return {
      avgTnHora: pipeChartData.reduce((s, d) => s + d.tnHora, 0) / n,
      avgCanos: pipeChartData.reduce((s, d) => s + d.canos, 0) / n,
      avgTnTotal: pipeChartData.reduce((s, d) => s + d.tnTotal, 0) / n,
      avgParadas: pipeChartData.reduce((s, d) => s + d.paradas, 0) / n,
    }
  }, [pipeChartData])

  const pipeVsPlanData = useMemo(() => {
    if (!pipeData) return []
    const produced: Record<string, number> = {}
    pipeData.dailyData.forEach(d => {
      for (const [size, qty] of Object.entries(d.productionBySize)) {
        produced[size] = (produced[size] || 0) + qty
      }
    })
    return PIPE_SIZES
      .filter(size => (produced[size] || 0) > 0 || (pipeTargets[size] || 0) > 0)
      .map(size => ({
        size: `CC${size}`,
        producido: produced[size] || 0,
        planificado: pipeTargets[size] || 0,
        cumplimiento: pipeTargets[size] ? Math.round(((produced[size] || 0) / pipeTargets[size]) * 100) : 0,
      }))
  }, [pipeData, pipeTargets])

  const chartMetricLabels: Record<BlockChartMetric, string> = {
    bandejas: "Bandejas", descartados: "Descartados", paradas: "Paradas", horasProducidas: "Horas prod."
  }
  const pipeChartLabels: Record<PipeChartMetric, string> = {
    tnHora: "Tn/Hora", canos: "Canos", tnTotal: "Tn total", paradas: "Paradas", canosVsPlan: "vs Plan"
  }

  const prevLabel = `vs ${prevMonthLabel}`

  // ── RENDER BLOCKS ───────────────────────────────────────────────────
  if (lineType === "bloques") {
    if (!blockData || blockData.metrics.length === 0) {
      return <div className="text-center py-12 text-muted-foreground text-sm">Sin datos de bloques en este periodo</div>
    }

    return (
      <div className="space-y-6">
        {/* Comparison cards */}
        {cmBlockStats && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
              <h2 className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">
                Comparacion con {prevMonthLabel}
              </h2>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <ComparisonCard label="Bandejas prom./dia" current={cmBlockStats.avgBandejas} previous={pmBlockStats?.avgBandejas || 0} unit="band." decimals={0} prevLabel={prevLabel} />
              <ComparisonCard label="Min. parada prom./dia" current={cmBlockStats.avgDowntime} previous={pmBlockStats?.avgDowntime || 0} unit="min" decimals={0} invert prevLabel={prevLabel} />
              <ComparisonCard label="OEE promedio" current={cmBlockStats.avgOEE} previous={pmBlockStats?.avgOEE || 0} unit="%" prevLabel={prevLabel} />
              <ComparisonCard label="Racks/Hora promedio" current={cmBlockStats.avgRacks} previous={pmBlockStats?.avgRacks || 0} unit="r/h" decimals={2} prevLabel={prevLabel} />
            </div>
          </section>
        )}

        {/* Days + Total downtime */}
        {cmBlockStats && (
          <div className="grid grid-cols-2 gap-3">
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
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Total paradas</div>
              </div>
            </div>
          </div>
        )}

        {/* Chart + Top 5 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-card rounded-lg border border-border p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground">Tendencia diaria</h3>
              <div className="flex gap-1">
                {(["bandejas", "descartados", "paradas", "horasProducidas"] as BlockChartMetric[]).map(m => (
                  <button key={m} onClick={() => setBlockChartMetric(m)} className={`px-2.5 py-1 rounded text-[10px] font-medium transition-all ${blockChartMetric === m ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
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
                      <linearGradient id="reportBlockFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={blockChartMetric === "descartados" || blockChartMetric === "paradas" ? "#dc2626" : "#1e3a5f"} stopOpacity={0.15} />
                        <stop offset="95%" stopColor={blockChartMetric === "descartados" || blockChartMetric === "paradas" ? "#dc2626" : "#1e3a5f"} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip content={({ active, payload }) => {
                      if (!active || !payload || !payload[0]) return null
                      const d = payload[0].payload as (typeof blockChartData)[0]
                      const avgBandejas = cmBlockStats ? cmBlockStats.avgBandejas : 0
                      const avgDowntime = cmBlockStats ? cmBlockStats.avgDowntime : 0
                      const avgDescartados = blockChartData.length > 0 ? blockChartData.reduce((s, x) => s + x.descartados, 0) / blockChartData.length : 0
                      const insights: string[] = []
                      if (d.bandejas === 0) insights.push("No hubo produccion este dia")
                      else {
                        if (d.bandejas < avgBandejas * 0.7) insights.push(`Produccion muy baja (${Math.round((1 - d.bandejas/avgBandejas)*100)}% debajo del promedio)`)
                        else if (d.bandejas > avgBandejas * 1.1) insights.push("Produccion por encima del promedio")
                      }
                      if (d.paradas > avgDowntime * 1.5 && d.paradas > 0) insights.push(`Paradas elevadas: ${d.paradas} min`)
                      if (d.descartados > avgDescartados * 2 && d.descartados > 0) insights.push(`Descarte elevado: ${d.descartados} bloques`)
                      if (d.topStopReason && d.topStopMinutes > 15) insights.push(`Parada ppal: ${d.topStopReason} (${d.topStopMinutes} min)`)
                      if (d.observations) insights.push(`Obs: ${d.observations}`)
                      return (
                        <div className="bg-card border border-border rounded-lg shadow-lg p-3 max-w-[280px]">
                          <div className="text-xs font-semibold text-foreground mb-1.5">{d.date}</div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] mb-2">
                            <span className="text-muted-foreground">Bandejas:</span><span className="font-semibold text-foreground">{d.bandejas}</span>
                            <span className="text-muted-foreground">Descartados:</span><span className="font-semibold text-foreground">{d.descartados}</span>
                            <span className="text-muted-foreground">Paradas:</span><span className="font-semibold text-foreground">{d.paradas} min</span>
                            <span className="text-muted-foreground">OEE:</span><span className="font-semibold text-foreground">{d.oee}%</span>
                          </div>
                          {insights.length > 0 && (
                            <div className="border-t border-border pt-1.5 mt-1.5 space-y-0.5">
                              {insights.map((ins, i) => <p key={i} className="text-[10px] text-muted-foreground leading-snug">{ins}</p>)}
                            </div>
                          )}
                        </div>
                      )
                    }} />
                    <Area type="monotone" dataKey={blockChartMetric} stroke={blockChartMetric === "descartados" || blockChartMetric === "paradas" ? "#dc2626" : "#1e3a5f"} strokeWidth={2} fill="url(#reportBlockFill)" dot={{ r: 2.5, fill: blockChartMetric === "descartados" || blockChartMetric === "paradas" ? "#dc2626" : "#1e3a5f" }} />
                    {blockChartMetric === "bandejas" && <ReferenceLine y={TARGETS.dailyTrays} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: `Obj: ${TARGETS.dailyTrays}`, position: 'right', fontSize: 9, fill: '#94a3b8' }} />}
                    {blockChartMetric === "bandejas" && cmBlockStats && <ReferenceLine y={Math.round(cmBlockStats.avgBandejas)} stroke="#1e3a5f" strokeDasharray="2 2" strokeOpacity={0.4} label={{ value: `Prom: ${Math.round(cmBlockStats.avgBandejas)}`, position: 'left', fontSize: 9, fill: '#1e3a5f' }} />}
                    {blockChartMetric === "paradas" && cmBlockStats && <ReferenceLine y={Math.round(cmBlockStats.avgDowntime)} stroke="#dc2626" strokeDasharray="4 4" label={{ value: `Prom: ${Math.round(cmBlockStats.avgDowntime)} min`, position: 'right', fontSize: 9, fill: '#dc2626' }} />}
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-xs">Sin datos</div>
              )}
            </div>
          </div>

          {/* Top 5 */}
          <div className="bg-card rounded-lg border border-border p-5 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-foreground">Top 5 Paradas</h3>
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <p className="text-[10px] text-muted-foreground mb-3 uppercase tracking-wide">{monthLabel}</p>
            {blockData.topDowntimes.length > 0 ? (
              <div className="space-y-2">
                {blockData.topDowntimes.map((dt, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="w-5 h-5 rounded-md bg-destructive/10 text-destructive text-[10px] flex items-center justify-center font-semibold shrink-0">{idx + 1}</span>
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
      </div>
    )
  }

  // ── RENDER PIPES ────────────────────────────────────────────────────
  if (!pipeData || pipeData.dailyData.length === 0) {
    return <div className="text-center py-12 text-muted-foreground text-sm">Sin datos de canos en este periodo</div>
  }

  return (
    <div className="space-y-6">
      {/* Comparison cards */}
      {cmPipeStats && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
            <h2 className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">Comparacion con {prevMonthLabel}</h2>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <ComparisonCard label="Tn/Hora disponible" current={cmPipeStats.tnPerHour} previous={pmPipeStats?.tnPerHour || 0} unit="tn/h" decimals={2} prevLabel={prevLabel} />
            <ComparisonCard label="Min. parada prom./dia" current={cmPipeStats.avgDowntime} previous={pmPipeStats?.avgDowntime || 0} unit="min" decimals={0} invert prevLabel={prevLabel} />
            <ComparisonCard label="Tn totales" current={cmPipeStats.totalTn} previous={pmPipeStats?.totalTn || 0} unit="tn" decimals={1} prevLabel={prevLabel} />
            <ComparisonCard label="Canos totales" current={cmPipeStats.totalUnits} previous={0} unit="un." decimals={0} prevLabel={prevLabel} />
          </div>
        </section>
      )}

      {/* Days + Downtime */}
      {cmPipeStats && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-primary/5 border border-primary/15 rounded-lg p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center"><Calendar className="w-5 h-5 text-primary" /></div>
            <div>
              <div className="text-2xl font-bold text-foreground">{cmPipeStats.days}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Dias producidos</div>
            </div>
          </div>
          <div className="bg-destructive/5 border border-destructive/15 rounded-lg p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center"><Clock className="w-5 h-5 text-destructive" /></div>
            <div>
              <div className="text-2xl font-bold text-foreground">{cmPipeStats.totalDowntime}<span className="text-sm font-normal text-muted-foreground ml-1">min</span></div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Total paradas</div>
            </div>
          </div>
        </div>
      )}

      {/* Chart + Top 5 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-card rounded-lg border border-border p-5 shadow-sm">
          <div className="flex flex-col gap-3 mb-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-sm font-semibold text-foreground">{pipeChartMetric === "canosVsPlan" ? "Producido vs Planificado" : "Tendencia diaria"}</h3>
              <div className="flex gap-1 flex-wrap">
                {(["tnHora", "canos", "tnTotal", "paradas", "canosVsPlan"] as PipeChartMetric[]).map(m => (
                  <button key={m} onClick={() => setPipeChartMetric(m)} className={`px-2.5 py-1 rounded text-[10px] font-medium transition-all ${pipeChartMetric === m ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
                    {pipeChartLabels[m]}
                  </button>
                ))}
              </div>
            </div>
            {pipeChartMetric !== "canosVsPlan" && (
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Turno:</span>
                  {(["todos", "1", "2"] as PipeShiftFilter[]).map(f => (
                    <button key={f} onClick={() => setPipeShiftFilter(f)} className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${pipeShiftFilter === f ? "bg-accent/15 text-accent border border-accent/30" : "bg-muted/50 text-muted-foreground"}`}>
                      {f === "todos" ? "Todos" : `T${f}`}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Operarios:</span>
                  {(["todos", "3", "4"] as PipeFilter[]).map(f => (
                    <button key={f} onClick={() => setPipeFilter(f)} className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${pipeFilter === f ? "bg-accent/15 text-accent border border-accent/30" : "bg-muted/50 text-muted-foreground"}`}>
                      {f === "todos" ? "Todos" : f}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Molde:</span>
                  <button onClick={() => setPipeMoldFilter("todos")} className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${pipeMoldFilter === "todos" ? "bg-accent/15 text-accent border border-accent/30" : "bg-muted/50 text-muted-foreground"}`}>Todos</button>
                  {pipeMoldOptions.map(size => (
                    <button key={size} onClick={() => setPipeMoldFilter(size)} className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${pipeMoldFilter === size ? "bg-accent/15 text-accent border border-accent/30" : "bg-muted/50 text-muted-foreground"}`}>CC{size}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="h-64">
            {pipeChartMetric === "canosVsPlan" ? (
              pipeVsPlanData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={pipeVsPlanData} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="size" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip content={({ active, payload }) => {
                      if (!active || !payload || !payload[0]) return null
                      const d = payload[0].payload as (typeof pipeVsPlanData)[0]
                      return (
                        <div className="bg-card border border-border rounded-lg shadow-lg p-3 max-w-[220px]">
                          <div className="text-xs font-semibold text-foreground mb-1.5">{d.size}</div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                            <span className="text-muted-foreground">Producido:</span><span className="font-semibold">{d.producido}</span>
                            <span className="text-muted-foreground">Planificado:</span><span className="font-semibold">{d.planificado || "-"}</span>
                            {d.planificado > 0 && (<><span className="text-muted-foreground">Cumplimiento:</span><span className={`font-bold ${d.cumplimiento >= 100 ? 'text-emerald-600' : d.cumplimiento >= 80 ? 'text-amber-600' : 'text-destructive'}`}>{d.cumplimiento}%</span></>)}
                          </div>
                        </div>
                      )
                    }} />
                    <Bar dataKey="producido" name="Producido" fill="#1e3a5f" radius={[3, 3, 0, 0]} barSize={28} />
                    <Bar dataKey="planificado" name="Planificado" fill="#94a3b8" radius={[3, 3, 0, 0]} barSize={28} fillOpacity={0.5} stroke="#94a3b8" strokeDasharray="3 3" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-xs">Sin datos de planificacion</div>
              )
            ) : (
              pipeChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={pipeChartData}>
                    <defs>
                      <linearGradient id="reportPipeFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={pipeChartMetric === "paradas" ? "#dc2626" : "#1e3a5f"} stopOpacity={0.15} />
                        <stop offset="95%" stopColor={pipeChartMetric === "paradas" ? "#dc2626" : "#1e3a5f"} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip content={({ active, payload }) => {
                      if (!active || !payload || !payload[0]) return null
                      const d = payload[0].payload as (typeof pipeChartData)[0]
                      const avgTnHora = filteredPipeAvg?.avgTnHora || 0
                      const avgCanos = filteredPipeAvg?.avgCanos || 0
                      const avgDowntime = filteredPipeAvg?.avgParadas || 0
                      const insights: string[] = []
                      if (d.canos === 0) insights.push("No hubo produccion")
                      else {
                        if (d.tnHora > 0 && d.tnHora < avgTnHora * 0.8) insights.push(`Tn/h baja (${((1 - d.tnHora / avgTnHora) * 100).toFixed(0)}% debajo)`)
                        if (d.canos < avgCanos * 0.7) insights.push(`Produccion baja: ${d.canos} canos`)
                        else if (d.canos > avgCanos * 1.15) insights.push(`Produccion alta: ${d.canos} canos`)
                      }
                      if (d.paradas > avgDowntime * 1.5 && d.paradas > 0) insights.push(`Paradas elevadas: ${d.paradas} min`)
                      const sizeEntries = Object.entries(d.productionBySize).filter(([, qty]) => qty > 0).sort(([a], [b]) => Number(a) - Number(b))
                      return (
                        <div className="bg-card border border-border rounded-lg shadow-lg p-3 max-w-[280px]">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-semibold text-foreground">{d.date}</span>
                            <span className="text-[10px] text-muted-foreground">T{d.shift} - {d.operators} op.</span>
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] mb-2">
                            <span className="text-muted-foreground">Canos:</span><span className="font-semibold">{d.canos}</span>
                            <span className="text-muted-foreground">Tn/h:</span><span className="font-semibold">{d.tnHora}</span>
                            <span className="text-muted-foreground">Tn total:</span><span className="font-semibold">{d.tnTotal}</span>
                            <span className="text-muted-foreground">Paradas:</span><span className="font-semibold">{d.paradas} min</span>
                          </div>
                          {sizeEntries.length > 0 && (
                            <div className="border-t border-border pt-1.5 mt-1">
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Por tipo</p>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
                                {sizeEntries.map(([size, qty]) => (<span key={size} className="contents"><span className="text-muted-foreground">CC{size}:</span><span className="font-semibold">{qty} u.</span></span>))}
                              </div>
                            </div>
                          )}
                          {insights.length > 0 && (
                            <div className="border-t border-border pt-1.5 mt-1.5 space-y-0.5">
                              {insights.map((ins, i) => <p key={i} className="text-[10px] text-muted-foreground leading-snug">{ins}</p>)}
                            </div>
                          )}
                        </div>
                      )
                    }} />
                    <Area type="monotone" dataKey={pipeChartMetric} stroke={pipeChartMetric === "paradas" ? "#dc2626" : "#1e3a5f"} strokeWidth={2} fill="url(#reportPipeFill)" dot={{ r: 2.5, fill: pipeChartMetric === "paradas" ? "#dc2626" : "#1e3a5f" }} />
                    {pipeChartMetric === "tnHora" && filteredPipeAvg && <ReferenceLine y={Number(filteredPipeAvg.avgTnHora.toFixed(2))} stroke="#1e3a5f" strokeDasharray="4 4" strokeOpacity={0.4} label={{ value: `Prom: ${filteredPipeAvg.avgTnHora.toFixed(2)}`, position: 'right', fontSize: 9, fill: '#1e3a5f' }} />}
                    {pipeChartMetric === "paradas" && filteredPipeAvg && <ReferenceLine y={Math.round(filteredPipeAvg.avgParadas)} stroke="#dc2626" strokeDasharray="4 4" label={{ value: `Prom: ${Math.round(filteredPipeAvg.avgParadas)} min`, position: 'right', fontSize: 9, fill: '#dc2626' }} />}
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-xs">Sin datos</div>
              )
            )}
          </div>
        </div>

        {/* Top 5 */}
        <div className="bg-card rounded-lg border border-border p-5 shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-foreground">Top 5 Paradas</h3>
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <p className="text-[10px] text-muted-foreground mb-3 uppercase tracking-wide">{monthLabel}</p>
          {pipeData.topDowntimes.length > 0 ? (
            <div className="space-y-2">
              {pipeData.topDowntimes.map((dt, idx) => (
                <div key={idx} className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="w-5 h-5 rounded-md bg-destructive/10 text-destructive text-[10px] flex items-center justify-center font-semibold shrink-0">{idx + 1}</span>
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
    </div>
  )
}
