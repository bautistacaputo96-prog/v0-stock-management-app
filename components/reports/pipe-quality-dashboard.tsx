"use client"

import { useState, useEffect, forwardRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import {
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  AlertCircle,
  Package,
  Target,
  BarChart3,
  Users,
} from "lucide-react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  ReferenceLine,
  Cell,
  LabelList,
} from "recharts"

const PIPE_DIAMETERS = [300, 400, 500, 600, 800, 1000, 1200]
const QUALITY_TARGETS = {
  qualityIndex: 95, // >= 95%
  secondQuality: 3, // <= 3%
  broken: 2, // <= 2%
}

interface QualityData {
  byDiameter: Record<number, { first: number; second: number; broken: number; total: number }>
  byDiameterByDate: Record<number, { date: string; produced: number }[]>
  byReason: {
    reasonId: number
    reason: string
    category: string
    total: number
    byDiameter: Record<number, number>
  }[]
  totals: { first: number; second: number; broken: number; total: number }
  byDate: { date: string; first: number; second: number; broken: number; total: number }[]
  byWeek: { week: string; data: Record<number, number> }[]
  planningByDate: Record<string, number>
  planningByDateByDiameter: Record<string, Record<number, number>>
  responsibles: string[] // IDs as strings
}

interface PipeQualityDashboardProps {
  startDate: string
  endDate: string
  plant?: string
  onDataLoaded?: (data: QualityData | null) => void
}

export const PipeQualityDashboard = forwardRef<HTMLDivElement, PipeQualityDashboardProps>(
  function PipeQualityDashboard({ startDate, endDate, plant, onDataLoaded }, ref) {
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState<QualityData | null>(null)
    const [prevPeriodData, setPrevPeriodData] = useState<QualityData | null>(null)
    const [selectedDiameter, setSelectedDiameter] = useState<string>("all")
    const [selectedResponsible, setSelectedResponsible] = useState<string>("all")
    const [allEmployees, setAllEmployees] = useState<{ id: number; name: string }[]>([])
    const [periodResponsibleIds, setPeriodResponsibleIds] = useState<string[]>([])
    const supabase = createClient()

    // Load employees once on mount
    useEffect(() => {
      supabase
        .from("employees")
        .select("id, first_name, last_name")
        .order("last_name")
        .then(({ data: emps }) => {
          if (emps) {
            setAllEmployees(
              emps.map((e) => ({
                id: e.id,
                name: `${e.first_name} ${e.last_name}`.trim(),
              }))
            )
          }
        })
    }, [])

    // Load unique responsibles for the period (unfiltered, for the dropdown)
    useEffect(() => {
      let q = supabase
        .from("pipe_quality_control")
        .select("production_responsible_id")
        .gte("control_date", startDate)
        .lte("control_date", endDate)
      if (plant) q = q.eq("plant", plant)
      q.then(({ data: rows }) => {
          if (rows) {
            const ids = Array.from(
              new Set(rows.map((r) => String(r.production_responsible_id)).filter(Boolean))
            )
            setPeriodResponsibleIds(ids)
          }
        })
    }, [startDate, endDate])

    // Load data when dates, plant or responsible filter changes
    useEffect(() => {
      loadData()
    }, [startDate, endDate, plant, selectedResponsible])

    async function loadData() {
      setLoading(true)
      try {
        const start = new Date(startDate + "T12:00:00")
        const end = new Date(endDate + "T12:00:00")
        const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
        const prevEnd = new Date(start)
        prevEnd.setDate(prevEnd.getDate() - 1)
        const prevStart = new Date(prevEnd)
        prevStart.setDate(prevStart.getDate() - daysDiff + 1)

        const responsibleId =
          selectedResponsible !== "all" ? parseInt(selectedResponsible) : undefined

        const currentData = await loadPeriodData(startDate, endDate, responsibleId)
        setData(currentData)
        onDataLoaded?.(currentData)

        const prevData = await loadPeriodData(
          prevStart.toISOString().split("T")[0],
          prevEnd.toISOString().split("T")[0],
          responsibleId
        )
        setPrevPeriodData(prevData)
      } catch (error) {
        console.error("Error loading quality data:", error)
      } finally {
        setLoading(false)
      }
    }

    async function loadPeriodData(
      from: string,
      to: string,
      responsibleId?: number
    ): Promise<QualityData | null> {
      let query = supabase
        .from("pipe_quality_control")
        .select(`
          *,
          pipe_quality_items (
            diameter,
            first_quality,
            second_quality,
            broken,
            pipe_quality_defects (
              defect_reason_id,
              quantity
            )
          )
        `)
        .gte("control_date", from)
        .lte("control_date", to)
        .order("control_date", { ascending: true })

      if (plant) query = query.eq("plant", plant)
      if (responsibleId !== undefined) {
        query = query.eq("production_responsible_id", responsibleId)
      }

      const { data: controls, error } = await query
      if (error || !controls || controls.length === 0) return null

      // Load defect reasons
      const { data: defectReasons } = await supabase
        .from("pipe_defect_reasons")
        .select("id, reason, category, display_order")
        .eq("is_active", true)
        .order("display_order", { ascending: true })

      const reasonsMap = new Map(defectReasons?.map((r) => [r.id, r]) || [])

      // Load planning data — per diameter per date
      const startMonth = new Date(from + "T12:00:00")
      const endMonth = new Date(to + "T12:00:00")
      const months: { year: number; month: number }[] = []
      let cur = new Date(startMonth)
      while (cur <= endMonth) {
        months.push({ year: cur.getFullYear(), month: cur.getMonth() + 1 })
        cur.setMonth(cur.getMonth() + 1)
      }

      const planningByDate: Record<string, number> = {}
      const planningByDateByDiameter: Record<string, Record<number, number>> = {}

      for (const { year, month } of months) {
        let planQuery = supabase
          .from("production_planning")
          .select("*")
          .eq("year", year)
          .eq("month", month)
        if (plant) planQuery = planQuery.eq("plant", plant)
        const { data: planning } = await planQuery

        if (planning) {
          const daysInMonth = new Date(year, month, 0).getDate()
          for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
            if (dateStr >= from && dateStr <= to) {
              if (!planningByDateByDiameter[dateStr]) planningByDateByDiameter[dateStr] = {}
              let dayTotal = 0
              for (const row of planning) {
                const dayVal = (row as Record<string, number>)[`day_${day}`] || 0
                if (dayVal > 0) {
                  const pipeSize = row.pipe_size as number
                  planningByDateByDiameter[dateStr][pipeSize] =
                    (planningByDateByDiameter[dateStr][pipeSize] || 0) + dayVal
                  dayTotal += dayVal
                }
              }
              if (dayTotal > 0) planningByDate[dateStr] = dayTotal
            }
          }
        }
      }

      // Aggregate production data
      const byDiameter: Record<number, { first: number; second: number; broken: number; total: number }> = {}
      const byDiameterByDateMap: Record<number, Map<string, number>> = {}
      const byReasonMap = new Map<
        number,
        { reasonId: number; reason: string; category: string; total: number; byDiameter: Record<number, number> }
      >()
      const byDateMap = new Map<string, { first: number; second: number; broken: number; total: number }>()
      const responsiblesSet = new Set<string>()
      const totals = { first: 0, second: 0, broken: 0, total: 0 }

      for (const control of controls) {
        const dateStr = control.control_date
        if (!byDateMap.has(dateStr)) byDateMap.set(dateStr, { first: 0, second: 0, broken: 0, total: 0 })
        const dateEntry = byDateMap.get(dateStr)!

        for (const item of control.pipe_quality_items || []) {
          const d = item.diameter as number
          const f = item.first_quality || 0
          const s = item.second_quality || 0
          const b = item.broken || 0

          if (!byDiameter[d]) byDiameter[d] = { first: 0, second: 0, broken: 0, total: 0 }
          byDiameter[d].first += f
          byDiameter[d].second += s
          byDiameter[d].broken += b
          byDiameter[d].total += f + s + b

          // Track per-diameter production by date (first + second, no broken)
          if (!byDiameterByDateMap[d]) byDiameterByDateMap[d] = new Map()
          byDiameterByDateMap[d].set(dateStr, (byDiameterByDateMap[d].get(dateStr) || 0) + f + s)

          dateEntry.first += f
          dateEntry.second += s
          dateEntry.broken += b
          dateEntry.total += f + s + b

          totals.first += f
          totals.second += s
          totals.broken += b
          totals.total += f + s + b

          for (const defect of item.pipe_quality_defects || []) {
            const reasonInfo = reasonsMap.get(defect.defect_reason_id)
            if (!reasonInfo) continue
            if (!byReasonMap.has(defect.defect_reason_id)) {
              byReasonMap.set(defect.defect_reason_id, {
                reasonId: defect.defect_reason_id,
                reason: reasonInfo.reason,
                category: reasonInfo.category,
                total: 0,
                byDiameter: {},
              })
            }
            const entry = byReasonMap.get(defect.defect_reason_id)!
            entry.total += defect.quantity || 0
            entry.byDiameter[d] = (entry.byDiameter[d] || 0) + (defect.quantity || 0)
          }
        }

        if (control.production_responsible_id) {
          responsiblesSet.add(String(control.production_responsible_id))
        }
      }

      // Convert byDiameterByDateMap to arrays
      const byDiameterByDate: Record<number, { date: string; produced: number }[]> = {}
      for (const [d, dateMap] of Object.entries(byDiameterByDateMap)) {
        byDiameterByDate[Number(d)] = Array.from(dateMap.entries())
          .map(([date, produced]) => ({ date, produced }))
          .sort((a, b) => a.date.localeCompare(b.date))
      }

      const byReason = Array.from(byReasonMap.values()).sort((a, b) => b.total - a.total)
      const byDate = Array.from(byDateMap.entries())
        .map(([date, d]) => ({ date, ...d }))
        .sort((a, b) => a.date.localeCompare(b.date))

      // Group by week for trend tab
      const byWeekMap = new Map<string, Record<number, number>>()
      for (const { date } of byDate) {
        const d = new Date(date + "T12:00:00")
        const weekStart = new Date(d)
        weekStart.setDate(d.getDate() - d.getDay())
        const weekKey = weekStart.toISOString().split("T")[0]
        if (!byWeekMap.has(weekKey)) byWeekMap.set(weekKey, {})
        const weekData = byWeekMap.get(weekKey)!
        for (const control of controls.filter((c) => c.control_date === date)) {
          for (const item of control.pipe_quality_items || []) {
            for (const defect of item.pipe_quality_defects || []) {
              weekData[defect.defect_reason_id] =
                (weekData[defect.defect_reason_id] || 0) + (defect.quantity || 0)
            }
          }
        }
      }

      const byWeek = Array.from(byWeekMap.entries())
        .map(([week, data]) => ({ week, data }))
        .sort((a, b) => a.week.localeCompare(b.week))

      return {
        byDiameter,
        byDiameterByDate,
        byReason,
        totals,
        byDate,
        byWeek,
        planningByDate,
        planningByDateByDiameter,
        responsibles: Array.from(responsiblesSet),
      }
    }

    if (loading) {
      return (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Cargando datos de calidad...
          </CardContent>
        </Card>
      )
    }

    if (!data || data.totals.total === 0) {
      return (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No hay datos de control de calidad para el período seleccionado
          </CardContent>
        </Card>
      )
    }

    // ── KPIs ──────────────────────────────────────────────────────────────────
    const qualityIndex = (data.totals.first / data.totals.total) * 100
    const secondPercent = (data.totals.second / data.totals.total) * 100
    const brokenPercent = (data.totals.broken / data.totals.total) * 100

    const prevQualityIndex = prevPeriodData
      ? (prevPeriodData.totals.first / prevPeriodData.totals.total) * 100
      : null
    const prevSecondPercent = prevPeriodData
      ? (prevPeriodData.totals.second / prevPeriodData.totals.total) * 100
      : null
    const prevBrokenPercent = prevPeriodData
      ? (prevPeriodData.totals.broken / prevPeriodData.totals.total) * 100
      : null
    const prevTotal = prevPeriodData?.totals.total || null

    // ── Producción vs Programación — respects selectedDiameter ───────────────
    const allDates = Array.from(
      new Set([...Object.keys(data.planningByDate), ...data.byDate.map((d) => d.date)])
    ).sort()

    const productionVsPlanningData = allDates
      .map((dateStr) => {
        let planned: number
        let produced: number

        if (selectedDiameter === "all") {
          planned = data.planningByDate[dateStr] || 0
          const dayData = data.byDate.find((d) => d.date === dateStr)
          produced = dayData ? dayData.first + dayData.second : 0
        } else {
          const d = parseInt(selectedDiameter)
          planned = (data.planningByDateByDiameter[dateStr] || {})[d] || 0
          const dayDiamData = data.byDiameterByDate[d]?.find((x) => x.date === dateStr)
          produced = dayDiamData ? dayDiamData.produced : 0
        }

        const compliance = planned > 0 ? (produced / planned) * 100 : 0
        const dayNum = parseInt(dateStr.split("-")[2], 10)
        const dayNames = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]
        const dateObj = new Date(dateStr + "T12:00:00")
        return {
          date: dateStr,
          label: `${dayNames[dateObj.getDay()]} ${dayNum}`,
          planned,
          produced,
          compliance,
        }
      })
      .filter((d) => d.planned > 0 || d.produced > 0)

    // ── Tabla de calidad por diámetro ─────────────────────────────────────────
    const diameterTableData = PIPE_DIAMETERS.map((d) => {
      const dData = data.byDiameter[d]
      if (!dData || dData.total === 0) return null
      return {
        diameter: d,
        first: dData.first,
        second: dData.second,
        broken: dData.broken,
        total: dData.total,
        secondPct: (dData.second / dData.total) * 100,
        brokenPct: (dData.broken / dData.total) * 100,
        qualityIndex: (dData.first / dData.total) * 100,
      }
    })
      .filter(Boolean)
      .sort((a, b) => a!.qualityIndex - b!.qualityIndex) as NonNullable<(typeof diameterTableData)[0]>[]

    // ── Análisis de defectos ──────────────────────────────────────────────────
    const defectRankingData = data.byReason.map((r) => ({
      ...r,
      percentage:
        data.totals.second + data.totals.broken > 0
          ? (r.total / (data.totals.second + data.totals.broken)) * 100
          : 0,
    }))
    const totalDefects = defectRankingData.reduce((sum, r) => sum + r.total, 0)

    const diametersWithDefects = PIPE_DIAMETERS.filter((d) =>
      defectRankingData.some((r) => r.byDiameter[d] > 0)
    )
    const maxDefectValue = Math.max(
      ...defectRankingData.flatMap((r) => Object.values(r.byDiameter)),
      0
    )

    // ── Tendencia semanal — colores dinámicos por dirección ───────────────────
    const reasonsWithData = data.byReason.filter((r) => r.total > 0).slice(0, 6)
    const weeklyTrendData = data.byWeek.map((w, idx) => {
      const entry: Record<string, number | string> = { week: `Sem ${idx + 1}` }
      for (const reason of reasonsWithData) {
        entry[reason.reason] = w.data[reason.reasonId] || 0
      }
      return entry
    })

    // Color per reason: red if increasing (worse), green if decreasing (better), gray if unchanged
    const weeklyReasonColors = reasonsWithData.map((reason) => {
      if (weeklyTrendData.length < 2) return "#9ca3af"
      const lastVal = (weeklyTrendData[weeklyTrendData.length - 1][reason.reason] as number) || 0
      const prevVal = (weeklyTrendData[weeklyTrendData.length - 2][reason.reason] as number) || 0
      if (lastVal > prevVal) return "#ef4444"
      if (lastVal < prevVal) return "#22c55e"
      return "#9ca3af"
    })

    // ── Tendencia general diaria ───────────────────────────────────────────────
    const dailyTrendData = data.byDate.map((d) => {
      const total = d.total || 1
      return {
        date: d.date.split("-").slice(1).join("/"),
        qualityIndex: (d.first / total) * 100,
        secondPct: (d.second / total) * 100,
        brokenPct: (d.broken / total) * 100,
      }
    })

    // ── Filtro responsable — solo los presentes en el período ─────────────────
    const availableResponsibles = allEmployees.filter((e) =>
      periodResponsibleIds.includes(String(e.id))
    )

    return (
      <div ref={ref} className="space-y-4">
        {/* ── Filtros ── */}
        <div className="flex flex-wrap gap-4 items-end p-1">
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1 text-muted-foreground">
              <Users className="h-3 w-3" />
              Responsable de producción
            </Label>
            <Select value={selectedResponsible} onValueChange={setSelectedResponsible}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {availableResponsibles.map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ── Section 1: KPI Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Índice de Calidad */}
          <Card
            className={
              qualityIndex >= QUALITY_TARGETS.qualityIndex
                ? "border-green-200 bg-green-50/50"
                : "border-red-200 bg-red-50/50"
            }
          >
            <CardContent className="pt-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    Índice de Calidad
                  </p>
                  <p
                    className={`text-2xl font-bold ${
                      qualityIndex >= QUALITY_TARGETS.qualityIndex
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    {qualityIndex.toFixed(1)}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Objetivo: ≥{QUALITY_TARGETS.qualityIndex}%
                  </p>
                </div>
                {prevQualityIndex !== null && (
                  <div className="flex items-center gap-1 text-xs">
                    {qualityIndex > prevQualityIndex ? (
                      <TrendingUp className="h-4 w-4 text-green-500" />
                    ) : qualityIndex < prevQualityIndex ? (
                      <TrendingDown className="h-4 w-4 text-red-500" />
                    ) : (
                      <Minus className="h-4 w-4 text-gray-400" />
                    )}
                    <span className="text-muted-foreground">
                      {prevQualityIndex.toFixed(1)}%
                    </span>
                  </div>
                )}
              </div>
              {qualityIndex >= QUALITY_TARGETS.qualityIndex ? (
                <CheckCircle2 className="h-5 w-5 text-green-500 mt-2" />
              ) : (
                <AlertCircle className="h-5 w-5 text-red-500 mt-2" />
              )}
            </CardContent>
          </Card>

          {/* % Segunda Calidad */}
          <Card
            className={
              secondPercent <= QUALITY_TARGETS.secondQuality
                ? "border-green-200 bg-green-50/50"
                : "border-red-200 bg-red-50/50"
            }
          >
            <CardContent className="pt-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    % Segunda Calidad
                  </p>
                  <p
                    className={`text-2xl font-bold ${
                      secondPercent <= QUALITY_TARGETS.secondQuality
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    {secondPercent.toFixed(1)}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Objetivo: ≤{QUALITY_TARGETS.secondQuality}%
                  </p>
                </div>
                {prevSecondPercent !== null && (
                  <div className="flex items-center gap-1 text-xs">
                    {secondPercent < prevSecondPercent ? (
                      <TrendingDown className="h-4 w-4 text-green-500" />
                    ) : secondPercent > prevSecondPercent ? (
                      <TrendingUp className="h-4 w-4 text-red-500" />
                    ) : (
                      <Minus className="h-4 w-4 text-gray-400" />
                    )}
                    <span className="text-muted-foreground">
                      {prevSecondPercent.toFixed(1)}%
                    </span>
                  </div>
                )}
              </div>
              {secondPercent <= QUALITY_TARGETS.secondQuality ? (
                <CheckCircle2 className="h-5 w-5 text-green-500 mt-2" />
              ) : (
                <AlertCircle className="h-5 w-5 text-red-500 mt-2" />
              )}
            </CardContent>
          </Card>

          {/* % Rotura */}
          <Card
            className={
              brokenPercent <= QUALITY_TARGETS.broken
                ? "border-green-200 bg-green-50/50"
                : "border-red-200 bg-red-50/50"
            }
          >
            <CardContent className="pt-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    % Rotura/Desperdicio
                  </p>
                  <p
                    className={`text-2xl font-bold ${
                      brokenPercent <= QUALITY_TARGETS.broken
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    {brokenPercent.toFixed(1)}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Objetivo: ≤{QUALITY_TARGETS.broken}%
                  </p>
                </div>
                {prevBrokenPercent !== null && (
                  <div className="flex items-center gap-1 text-xs">
                    {brokenPercent < prevBrokenPercent ? (
                      <TrendingDown className="h-4 w-4 text-green-500" />
                    ) : brokenPercent > prevBrokenPercent ? (
                      <TrendingUp className="h-4 w-4 text-red-500" />
                    ) : (
                      <Minus className="h-4 w-4 text-gray-400" />
                    )}
                    <span className="text-muted-foreground">
                      {prevBrokenPercent.toFixed(1)}%
                    </span>
                  </div>
                )}
              </div>
              {brokenPercent <= QUALITY_TARGETS.broken ? (
                <CheckCircle2 className="h-5 w-5 text-green-500 mt-2" />
              ) : (
                <AlertCircle className="h-5 w-5 text-red-500 mt-2" />
              )}
            </CardContent>
          </Card>

          {/* Total Producido */}
          <Card className="border-slate-200 bg-slate-50/50">
            <CardContent className="pt-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    Total Producido
                  </p>
                  <p className="text-2xl font-bold text-slate-700">
                    {data.totals.total.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">unidades</p>
                </div>
                {prevTotal !== null && (
                  <div className="flex items-center gap-1 text-xs">
                    {data.totals.total > prevTotal ? (
                      <TrendingUp className="h-4 w-4 text-green-500" />
                    ) : data.totals.total < prevTotal ? (
                      <TrendingDown className="h-4 w-4 text-amber-500" />
                    ) : (
                      <Minus className="h-4 w-4 text-gray-400" />
                    )}
                    <span className="text-muted-foreground">
                      {prevTotal.toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
              <Package className="h-5 w-5 text-slate-500 mt-2" />
            </CardContent>
          </Card>
        </div>

        {/* ── Section 2: Producción vs Programación ── */}
        {productionVsPlanningData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  Producción vs Programación
                </CardTitle>
                <Select value={selectedDiameter} onValueChange={setSelectedDiameter}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {PIPE_DIAMETERS.map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        CC{d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={productionVsPlanningData}
                    margin={{ top: 20, right: 10, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ fontSize: "12px" }}
                      formatter={(value: number, name: string) => [
                        value.toLocaleString(),
                        name,
                      ]}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar
                      dataKey="planned"
                      fill="#94a3b8"
                      name="Programado"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="produced"
                      fill="#3b82f6"
                      name="Producido"
                      radius={[4, 4, 0, 0]}
                    >
                      <LabelList
                        dataKey="compliance"
                        position="top"
                        fontSize={9}
                        formatter={(val: number) =>
                          val > 0 ? `${val.toFixed(0)}%` : ""
                        }
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Section 3: Calidad por Diámetro ── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Calidad por Diámetro
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-2 px-3 font-medium">Diámetro</th>
                    <th className="text-right py-2 px-3 font-medium text-green-600">Primera</th>
                    <th className="text-right py-2 px-3 font-medium text-amber-600">Segunda</th>
                    <th className="text-right py-2 px-3 font-medium text-red-600">Rotos</th>
                    <th className="text-right py-2 px-3 font-medium">Total</th>
                    <th className="text-right py-2 px-3 font-medium text-amber-600">% Seg.</th>
                    <th className="text-right py-2 px-3 font-medium text-red-600">% Rot.</th>
                    <th className="text-right py-2 px-3 font-medium">Ind. Calidad</th>
                  </tr>
                </thead>
                <tbody>
                  {diameterTableData.map((row, idx) => (
                    <tr key={row.diameter} className={idx % 2 === 0 ? "" : "bg-muted/20"}>
                      <td className="py-2 px-3 font-medium">CC{row.diameter}</td>
                      <td className="text-right py-2 px-3 text-green-600">{row.first}</td>
                      <td className="text-right py-2 px-3 text-amber-600">{row.second}</td>
                      <td className="text-right py-2 px-3 text-red-600">{row.broken}</td>
                      <td className="text-right py-2 px-3 font-semibold">{row.total}</td>
                      <td className="text-right py-2 px-3 text-amber-600">
                        {row.secondPct.toFixed(1)}%
                      </td>
                      <td className="text-right py-2 px-3 text-red-600">
                        {row.brokenPct.toFixed(1)}%
                      </td>
                      <td className="text-right py-2 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-sm font-semibold ${
                            row.qualityIndex >= 95
                              ? "bg-green-100 text-green-700"
                              : row.qualityIndex >= 90
                              ? "bg-amber-100 text-amber-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {row.qualityIndex.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 bg-muted/50 font-semibold">
                    <td className="py-2 px-3">TOTAL</td>
                    <td className="text-right py-2 px-3 text-green-600">{data.totals.first}</td>
                    <td className="text-right py-2 px-3 text-amber-600">{data.totals.second}</td>
                    <td className="text-right py-2 px-3 text-red-600">{data.totals.broken}</td>
                    <td className="text-right py-2 px-3">{data.totals.total}</td>
                    <td className="text-right py-2 px-3 text-amber-600">
                      {secondPercent.toFixed(1)}%
                    </td>
                    <td className="text-right py-2 px-3 text-red-600">
                      {brokenPercent.toFixed(1)}%
                    </td>
                    <td className="text-right py-2 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-sm font-semibold ${
                          qualityIndex >= 95
                            ? "bg-green-100 text-green-700"
                            : qualityIndex >= 90
                            ? "bg-amber-100 text-amber-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {qualityIndex.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* ── Section 4: Análisis de Defectos ── */}
        {defectRankingData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Análisis de Defectos</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="ranking" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="ranking">Ranking</TabsTrigger>
                  <TabsTrigger value="diameter">Por Diámetro</TabsTrigger>
                  <TabsTrigger value="trend">Tendencia Semanal</TabsTrigger>
                </TabsList>

                {/* Tab: Ranking */}
                <TabsContent value="ranking" className="mt-4">
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={defectRankingData.slice(0, 10)}
                        layout="vertical"
                        margin={{ top: 5, right: 60, left: 10, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" tick={{ fontSize: 10 }} />
                        <YAxis
                          type="category"
                          dataKey="reason"
                          tick={{ fontSize: 9 }}
                          width={120}
                          tickFormatter={(val: string) =>
                            val.length > 18 ? val.substring(0, 15) + "..." : val
                          }
                        />
                        <Tooltip
                          contentStyle={{ fontSize: "12px" }}
                          formatter={(value: number, _name: string, props: { payload?: { percentage?: number } }) => {
                            const pct = props.payload?.percentage?.toFixed(1) || 0
                            return [`${value} (${pct}%)`, "Cantidad"]
                          }}
                        />
                        <Bar dataKey="total" name="Cantidad" radius={[0, 4, 4, 0]}>
                          {defectRankingData.slice(0, 10).map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={entry.category === "produccion" ? "#3b82f6" : "#f97316"}
                            />
                          ))}
                          <LabelList
                            dataKey="total"
                            position="right"
                            fontSize={10}
                            formatter={(val: number) => {
                              const pct =
                                totalDefects > 0
                                  ? ((val / totalDefects) * 100).toFixed(1)
                                  : 0
                              return `${val} (${pct}%)`
                            }}
                          />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex gap-4 justify-center mt-2 text-xs">
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 rounded-sm bg-blue-500 inline-block" />
                      Producción
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 rounded-sm bg-orange-500 inline-block" />
                      Desmolde
                    </span>
                  </div>
                </TabsContent>

                {/* Tab: Por Diámetro (Heatmap) */}
                <TabsContent value="diameter" className="mt-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left py-2 px-2 font-medium">Motivo</th>
                          {diametersWithDefects.map((d) => (
                            <th key={d} className="text-center py-2 px-2 font-medium">
                              CC{d}
                            </th>
                          ))}
                          <th className="text-center py-2 px-2 font-medium bg-muted">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {defectRankingData.map((row, idx) => (
                          <tr key={row.reasonId} className={idx % 2 === 0 ? "" : "bg-muted/10"}>
                            <td
                              className="py-1.5 px-2 font-medium truncate max-w-[150px]"
                              title={row.reason}
                            >
                              {row.reason}
                            </td>
                            {diametersWithDefects.map((d) => {
                              const val = row.byDiameter[d] || 0
                              const intensity = maxDefectValue > 0 ? val / maxDefectValue : 0
                              const bgColor =
                                val === 0
                                  ? ""
                                  : `rgba(239, 68, 68, ${Math.max(0.1, intensity)})`
                              return (
                                <td
                                  key={d}
                                  className="text-center py-1.5 px-2"
                                  style={{ backgroundColor: bgColor }}
                                >
                                  {val > 0 ? val : "-"}
                                </td>
                              )
                            })}
                            <td className="text-center py-1.5 px-2 font-semibold bg-muted/50">
                              {row.total}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 bg-muted/50 font-semibold">
                          <td className="py-2 px-2">TOTAL</td>
                          {diametersWithDefects.map((d) => {
                            const total = defectRankingData.reduce(
                              (sum, r) => sum + (r.byDiameter[d] || 0),
                              0
                            )
                            return (
                              <td key={d} className="text-center py-2 px-2">
                                {total}
                              </td>
                            )
                          })}
                          <td className="text-center py-2 px-2 bg-red-100 text-red-700">
                            {totalDefects}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </TabsContent>

                {/* Tab: Tendencia Semanal */}
                <TabsContent value="trend" className="mt-4">
                  {weeklyTrendData.length > 1 ? (
                    <>
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart
                            data={weeklyTrendData}
                            margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} />
                            <Tooltip contentStyle={{ fontSize: "11px" }} />
                            <Legend wrapperStyle={{ fontSize: 10 }} />
                            {reasonsWithData.map((reason, idx) => (
                              <Line
                                key={reason.reasonId}
                                type="monotone"
                                dataKey={reason.reason}
                                stroke={weeklyReasonColors[idx]}
                                strokeWidth={2}
                                dot={{ r: 3 }}
                              />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex gap-4 justify-center mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <span className="w-4 h-0.5 bg-red-500 inline-block" />
                          Tendencia creciente
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-4 h-0.5 bg-green-500 inline-block" />
                          Tendencia decreciente
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-4 h-0.5 bg-gray-400 inline-block" />
                          Sin cambio
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="text-center text-muted-foreground py-8">
                      Se necesitan datos de al menos 2 semanas para mostrar la tendencia
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}

        {/* ── Section 5: Tendencia General Diaria ── */}
        {dailyTrendData.length > 1 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Tendencia General Diaria</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={dailyTrendData}
                    margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ fontSize: "12px" }}
                      formatter={(value: number) => [`${value.toFixed(1)}%`]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine
                      y={95}
                      stroke="#22c55e"
                      strokeDasharray="5 5"
                      label={{
                        value: "Obj. Calidad 95%",
                        position: "insideTopRight",
                        fontSize: 9,
                      }}
                    />
                    <ReferenceLine
                      y={3}
                      stroke="#f97316"
                      strokeDasharray="5 5"
                      label={{
                        value: "Obj. 2da 3%",
                        position: "insideBottomRight",
                        fontSize: 9,
                      }}
                    />
                    <ReferenceLine
                      y={2}
                      stroke="#ef4444"
                      strokeDasharray="5 5"
                      label={{
                        value: "Obj. Rot. 2%",
                        position: "insideBottomRight",
                        fontSize: 9,
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="qualityIndex"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      name="Índ. Calidad"
                    />
                    <Line
                      type="monotone"
                      dataKey="secondPct"
                      stroke="#f97316"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      name="% Segunda"
                    />
                    <Line
                      type="monotone"
                      dataKey="brokenPct"
                      stroke="#ef4444"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      name="% Rotura"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    )
  }
)
