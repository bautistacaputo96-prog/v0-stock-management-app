"use client"

import { useState, useEffect, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Package,
  Calendar,
  ExternalLink,
  Pencil,
  Lock,
  AlertTriangle,
  LayoutDashboard,
  BarChart3,
  Clock,
} from "lucide-react"
import { AdjustStockDialog } from "@/components/adjust-stock-dialog"
import { format, subDays } from "date-fns"
import { es } from "date-fns/locale"
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

interface Material {
  id: string
  name: string
  current_stock: number
  min_stock: number
  unit: string
}

interface DashboardMaterial extends Material {
  totalConsumption30d: number
  avgDailyConsumption: number
  daysRemaining: number | null
  status: "ok" | "warning" | "critical"
}

interface StockEvolutionChartProps {
  plantId: string
}

const ADJUST_PASSWORD = "18/12/2018"

export function StockEvolutionChart({ plantId }: StockEvolutionChartProps) {
  const [view, setView] = useState<"dashboard" | "detail">("dashboard")
  const [materials, setMaterials] = useState<Material[]>([])
  const [selectedMaterial, setSelectedMaterial] = useState<string>("")
  const [dateRange, setDateRange] = useState<number>(30)
  const [loading, setLoading] = useState(true)
  const [chartData, setChartData] = useState<any[]>([])
  const [materialInfo, setMaterialInfo] = useState<Material | null>(null)
  const [showConsumptionDetail, setShowConsumptionDetail] = useState(false)
  const [consumptionDetails, setConsumptionDetails] = useState<any[]>([])
  const [loadingDetails, setLoadingDetails] = useState(false)

  // Day drill-down
  const [showDayDetail, setShowDayDetail] = useState(false)
  const [dayDetailDate, setDayDetailDate] = useState<string>("")
  const [dayDetailData, setDayDetailData] = useState<any[]>([])
  const [loadingDayDetail, setLoadingDayDetail] = useState(false)

  // Password gate
  const [showPasswordDialog, setShowPasswordDialog] = useState(false)
  const [passwordInput, setPasswordInput] = useState("")
  const [passwordError, setPasswordError] = useState(false)
  const [adjustTarget, setAdjustTarget] = useState<Material | null>(null)
  const [showAdjustDialog, setShowAdjustDialog] = useState(false)

  // Dashboard
  const [dashboardMetrics, setDashboardMetrics] = useState<DashboardMaterial[]>([])
  const [dashboardLoading, setDashboardLoading] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    if (plantId) loadMaterials()
  }, [plantId])

  useEffect(() => {
    if (selectedMaterial && view === "detail") loadChartData()
  }, [selectedMaterial, dateRange, view])

  useEffect(() => {
    if (materials.length > 0 && view === "dashboard") loadDashboardData()
  }, [materials, view])

  async function loadMaterials() {
    const { data } = await supabase
      .from("materials")
      .select("*")
      .eq("plant_id", plantId)
      .neq("name", "Agua")
      .order("name")

    if (data && data.length > 0) {
      setMaterials(data)
      if (!selectedMaterial) {
        setSelectedMaterial(data[0].id)
        setMaterialInfo(data[0])
      } else {
        // Refresh materialInfo in case stock changed after adjustment
        const current = data.find((m) => m.id === selectedMaterial)
        if (current) setMaterialInfo(current)
      }
    }
    setLoading(false)
  }

  async function loadDashboardData() {
    setDashboardLoading(true)

    const thirtyDaysAgo = format(subDays(new Date(), 30), "yyyy-MM-dd")
    const materialIds = materials.map((m) => m.id)

    const { data: movements } = await supabase
      .from("stock_movements")
      .select("material_id, quantity_kg")
      .eq("movement_type", "consumo")
      .gte("movement_date", thirtyDaysAgo)
      .in("material_id", materialIds)

    const consumptionByMaterial: Record<string, number> = {}
    movements?.forEach((m) => {
      consumptionByMaterial[m.material_id] = (consumptionByMaterial[m.material_id] || 0) + (m.quantity_kg || 0)
    })

    const metrics: DashboardMaterial[] = materials.map((mat) => {
      const totalConsumption30d = consumptionByMaterial[mat.id] || 0
      const avgDailyConsumption = totalConsumption30d / 30
      const daysRemaining = avgDailyConsumption > 0 ? mat.current_stock / avgDailyConsumption : null

      let status: "ok" | "warning" | "critical" = "ok"
      if (mat.current_stock <= mat.min_stock) {
        status = "critical"
      } else if (
        mat.current_stock <= mat.min_stock * 1.5 ||
        (daysRemaining !== null && daysRemaining <= 5)
      ) {
        status = "warning"
      } else if (daysRemaining !== null && daysRemaining <= 10) {
        status = "warning"
      }

      return { ...mat, totalConsumption30d, avgDailyConsumption, daysRemaining, status }
    })

    setDashboardMetrics(metrics)
    setDashboardLoading(false)
  }

  async function loadChartData() {
    setLoading(true)
    const material = materials.find((m) => m.id === selectedMaterial)
    if (!material) return

    setMaterialInfo(material)

    const endDate = new Date()
    const startDate = subDays(endDate, dateRange)

    const { data: entries } = await supabase
      .from("stock_entries")
      .select("quantity, dry_quantity, entry_date")
      .eq("material_id", selectedMaterial)
      .gte("entry_date", startDate.toISOString())
      .lte("entry_date", endDate.toISOString())
      .order("entry_date")

    const { data: consumption } = await supabase
      .from("stock_movements")
      .select("quantity_kg, movement_date")
      .eq("material_id", selectedMaterial)
      .eq("movement_type", "consumo")
      .gte("movement_date", format(startDate, "yyyy-MM-dd"))
      .lte("movement_date", format(endDate, "yyyy-MM-dd"))
      .order("movement_date")

    const dailyData: Record<string, { date: string; entries: number; consumption: number; stock: number }> = {}

    for (let i = dateRange; i >= 0; i--) {
      const date = subDays(endDate, i)
      const dateStr = format(date, "yyyy-MM-dd")
      dailyData[dateStr] = { date: dateStr, entries: 0, consumption: 0, stock: 0 }
    }

    entries?.forEach((e) => {
      const dateStr = String(e.entry_date).substring(0, 10)
      if (dailyData[dateStr]) {
        dailyData[dateStr].entries += e.quantity || 0
      }
    })

    consumption?.forEach((c) => {
      const dateStr = String(c.movement_date).substring(0, 10)
      if (dailyData[dateStr]) {
        dailyData[dateStr].consumption += c.quantity_kg || 0
      }
    })

    const sortedDays = Object.values(dailyData).sort((a, b) => b.date.localeCompare(a.date))
    let runningStock = material.current_stock

    for (const day of sortedDays) {
      day.stock = runningStock
      runningStock = runningStock + day.consumption - day.entries
    }

    const result = Object.values(dailyData)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        ...d,
        dateLabel: format(new Date(d.date + "T12:00:00"), "dd/MM", { locale: es }),
        stockTon: d.stock / 1000,
        entriesTon: d.entries / 1000,
        consumptionTon: d.consumption / 1000,
      }))

    setChartData(result)
    setLoading(false)
  }

  async function loadConsumptionDetails() {
    if (!selectedMaterial) return

    setLoadingDetails(true)
    setShowConsumptionDetail(true)

    const endDate = new Date()
    const startDate = subDays(endDate, dateRange)

    const { data } = await supabase
      .from("stock_movements")
      .select("id, quantity_kg, movement_date, notes, reference_id")
      .eq("material_id", selectedMaterial)
      .eq("movement_type", "consumo")
      .gte("movement_date", format(startDate, "yyyy-MM-dd"))
      .lte("movement_date", format(endDate, "yyyy-MM-dd"))
      .order("movement_date", { ascending: false })

    if (data && data.length > 0) {
      const dispatchIds = data.map((d) => d.reference_id).filter(Boolean)

      const { data: dispatches } = await supabase
        .from("dispatches")
        .select(
          "id, remito, quantity_m3, dispatch_date, formulas(id, name), clients(id, name), construction_sites(id, name)"
        )
        .in("id", dispatchIds)

      const detailsWithDispatch = data.map((movement) => {
        const dispatch = dispatches?.find((d) => d.id === movement.reference_id)
        return { ...movement, dispatch }
      })

      setConsumptionDetails(detailsWithDispatch)
    } else {
      setConsumptionDetails([])
    }

    setLoadingDetails(false)
  }

  async function loadDayDetail(date: string) {
    if (!selectedMaterial) return
    setDayDetailDate(date)
    setLoadingDayDetail(true)
    setShowDayDetail(true)

    const { data: movements } = await supabase
      .from("stock_movements")
      .select("id, quantity_kg, notes, reference_id, reference_type")
      .eq("material_id", selectedMaterial)
      .eq("movement_type", "consumo")
      .eq("movement_date", date)
      .order("quantity_kg", { ascending: false })

    if (!movements || movements.length === 0) {
      setDayDetailData([])
      setLoadingDayDetail(false)
      return
    }

    const dispatchIds = movements
      .filter((m) => m.reference_type === "dispatch")
      .map((m) => m.reference_id)
      .filter(Boolean)

    let dispatches: any[] = []
    if (dispatchIds.length > 0) {
      const { data } = await supabase
        .from("dispatches")
        .select("id, remito, quantity_m3, formulas(id, name, code), clients(name)")
        .in("id", dispatchIds)
      dispatches = data || []
    }

    const rows = movements.map((mov) => {
      if (mov.reference_type === "dispatch") {
        const dispatch = dispatches.find((d) => d.id === mov.reference_id)
        return {
          type: "dispatch",
          id: mov.id,
          remito: dispatch?.remito || "-",
          formula: dispatch?.formulas?.name || "-",
          formula_code: dispatch?.formulas?.code || "-",
          client: dispatch?.clients?.name || "-",
          m3: dispatch?.quantity_m3 || 0,
          kg: mov.quantity_kg || 0,
        }
      }
      return {
        type: "manual",
        id: mov.id,
        remito: "-",
        formula: "Descarga Manual",
        formula_code: "-",
        client: "-",
        m3: 0,
        kg: mov.quantity_kg || 0,
        notes: mov.notes,
      }
    })

    setDayDetailData(rows)
    setLoadingDayDetail(false)
  }

  const stats = useMemo(() => {
    if (chartData.length === 0) return null

    const totalEntries = chartData.reduce((sum, d) => sum + d.entries, 0)
    const totalConsumption = chartData.reduce((sum, d) => sum + d.consumption, 0)
    const avgDailyConsumption = totalConsumption / chartData.length
    const firstStock = chartData[0]?.stock || 0
    const lastStock = chartData[chartData.length - 1]?.stock || 0
    const stockChange = lastStock - firstStock
    const stockChangePercent = firstStock > 0 ? (stockChange / firstStock) * 100 : 0

    return { totalEntries, totalConsumption, avgDailyConsumption, stockChange, stockChangePercent }
  }, [chartData])

  const dayDetailByFormula = useMemo(() => {
    if (!dayDetailData.length) return []
    const grouped: Record<string, { formula: string; formula_code: string; count: number; totalM3: number; totalKg: number }> = {}
    dayDetailData.forEach((row) => {
      const key = row.formula || "Manual"
      if (!grouped[key]) {
        grouped[key] = { formula: row.formula, formula_code: row.formula_code, count: 0, totalM3: 0, totalKg: 0 }
      }
      grouped[key].count++
      grouped[key].totalM3 += row.m3 || 0
      grouped[key].totalKg += row.kg || 0
    })
    return Object.values(grouped).sort((a, b) => b.totalKg - a.totalKg)
  }, [dayDetailData])

  function handleAdjustClick(material: Material) {
    setAdjustTarget(material)
    setPasswordInput("")
    setPasswordError(false)
    setShowPasswordDialog(true)
  }

  function handlePasswordSubmit() {
    if (passwordInput === ADJUST_PASSWORD) {
      setShowPasswordDialog(false)
      setShowAdjustDialog(true)
    } else {
      setPasswordError(true)
    }
  }

  function getCardBorder(status: "ok" | "warning" | "critical") {
    if (status === "critical") return "border-red-300 bg-red-50/30"
    if (status === "warning") return "border-yellow-300 bg-yellow-50/30"
    return ""
  }

  if (loading && materials.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* View Toggle */}
      <div className="flex gap-2 border-b pb-4">
        <Button
          variant={view === "dashboard" ? "default" : "outline"}
          size="sm"
          className="gap-2"
          onClick={() => setView("dashboard")}
        >
          <LayoutDashboard className="h-4 w-4" />
          Dashboard
        </Button>
        <Button
          variant={view === "detail" ? "default" : "outline"}
          size="sm"
          className="gap-2"
          onClick={() => setView("detail")}
        >
          <BarChart3 className="h-4 w-4" />
          Evolución por Material
        </Button>
      </div>

      {/* ── DASHBOARD VIEW ─────────────────────────────────────────────────────── */}
      {view === "dashboard" && (
        <div className="space-y-4">
          {dashboardLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {dashboardMetrics.some((m) => m.status === "critical") && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm font-medium">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Stock crítico:{" "}
                  {dashboardMetrics
                    .filter((m) => m.status === "critical")
                    .map((m) => m.name)
                    .join(", ")}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {dashboardMetrics.map((mat) => (
                  <Card key={mat.id} className={`transition-all ${getCardBorder(mat.status)}`}>
                    <CardContent className="pt-5">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="font-semibold text-base">{mat.name}</h3>
                          {mat.status === "critical" && (
                            <Badge variant="destructive" className="mt-1 text-xs">
                              Crítico
                            </Badge>
                          )}
                          {mat.status === "warning" && (
                            <Badge className="mt-1 text-xs bg-yellow-500 hover:bg-yellow-600">Atención</Badge>
                          )}
                          {mat.status === "ok" && (
                            <Badge variant="secondary" className="mt-1 text-xs text-green-700 bg-green-100">
                              OK
                            </Badge>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold">{(mat.current_stock / 1000).toFixed(1)} t</p>
                          <p className="text-xs text-muted-foreground">Mín: {(mat.min_stock / 1000).toFixed(1)} t</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-sm border-t pt-3 mb-4">
                        <div>
                          <p className="text-muted-foreground flex items-center gap-1 text-xs">
                            <Clock className="h-3 w-3" />
                            Días de stock
                          </p>
                          <p
                            className={`font-bold text-xl ${
                              mat.daysRemaining === null
                                ? "text-muted-foreground"
                                : mat.daysRemaining <= 3
                                  ? "text-red-600"
                                  : mat.daysRemaining <= 7
                                    ? "text-yellow-600"
                                    : "text-green-600"
                            }`}
                          >
                            {mat.daysRemaining !== null ? Math.round(mat.daysRemaining) : "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground flex items-center gap-1 text-xs">
                            <TrendingDown className="h-3 w-3" />
                            Consumo diario
                          </p>
                          <p className="font-semibold text-sm">
                            {mat.avgDailyConsumption > 0
                              ? `${(mat.avgDailyConsumption / 1000).toFixed(2)} t/día`
                              : "Sin datos"}
                          </p>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 text-xs"
                          onClick={() => {
                            setSelectedMaterial(mat.id)
                            setMaterialInfo(mat)
                            setView("detail")
                          }}
                        >
                          <BarChart3 className="h-3 w-3 mr-1" />
                          Ver evolución
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs"
                          onClick={() => handleAdjustClick(mat)}
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          Ajustar
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <p className="text-xs text-muted-foreground text-right">
                Consumo basado en últimos 30 días · Stock mínimo como umbral de alerta crítica
              </p>
            </>
          )}
        </div>
      )}

      {/* ── DETAIL VIEW ────────────────────────────────────────────────────────── */}
      {view === "detail" && (
        <div className="space-y-6">
          {/* Controls */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium mb-2 block">Material</label>
              <div className="flex gap-2">
                <Select
                  value={selectedMaterial}
                  onValueChange={(v) => {
                    setSelectedMaterial(v)
                    setMaterialInfo(materials.find((m) => m.id === v) || null)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar material" />
                  </SelectTrigger>
                  <SelectContent>
                    {materials.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  className="shrink-0 gap-2"
                  disabled={!materialInfo}
                  onClick={() => materialInfo && handleAdjustClick(materialInfo)}
                >
                  <Pencil className="h-4 w-4" />
                  <span className="hidden sm:inline">Ajustar Stock</span>
                </Button>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Periodo</label>
              <div className="flex gap-2">
                <Button
                  variant={dateRange === 7 ? "default" : "outline"}
                  size="sm"
                  onClick={() => setDateRange(7)}
                >
                  7 dias
                </Button>
                <Button
                  variant={dateRange === 30 ? "default" : "outline"}
                  size="sm"
                  onClick={() => setDateRange(30)}
                >
                  30 dias
                </Button>
                <Button
                  variant={dateRange === 90 ? "default" : "outline"}
                  size="sm"
                  onClick={() => setDateRange(90)}
                >
                  90 dias
                </Button>
              </div>
            </div>
          </div>

          {/* Stats Cards */}
          {stats && materialInfo && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                    <Package className="h-4 w-4" />
                    Stock Actual
                  </div>
                  <p className="text-2xl font-bold">{(materialInfo.current_stock / 1000).toFixed(1)} t</p>
                  <p className="text-xs text-muted-foreground">Min: {(materialInfo.min_stock / 1000).toFixed(1)} t</p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 text-green-600 text-sm mb-1">
                    <TrendingUp className="h-4 w-4" />
                    Total Ingresos
                  </div>
                  <p className="text-2xl font-bold text-green-600">{(stats.totalEntries / 1000).toFixed(1)} t</p>
                  <p className="text-xs text-muted-foreground">Ultimos {dateRange} dias</p>
                </CardContent>
              </Card>

              <Card
                className="cursor-pointer hover:border-red-300 hover:bg-red-50/50 transition-colors"
                onClick={loadConsumptionDetails}
              >
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-red-600 text-sm mb-1">
                      <TrendingDown className="h-4 w-4" />
                      Total Consumo
                    </div>
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <p className="text-2xl font-bold text-red-600">{(stats.totalConsumption / 1000).toFixed(1)} t</p>
                  <p className="text-xs text-muted-foreground">
                    Prom: {(stats.avgDailyConsumption / 1000).toFixed(2)} t/dia
                  </p>
                  <p className="text-xs text-blue-600 mt-1">Click para ver detalle</p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                    <Calendar className="h-4 w-4" />
                    Variacion Stock
                  </div>
                  <p
                    className={`text-2xl font-bold ${stats.stockChange >= 0 ? "text-green-600" : "text-red-600"}`}
                  >
                    {stats.stockChange >= 0 ? "+" : ""}
                    {(stats.stockChange / 1000).toFixed(1)} t
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {stats.stockChangePercent >= 0 ? "+" : ""}
                    {stats.stockChangePercent.toFixed(1)}%
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Stock Evolution Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Evolucion del Stock</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center h-80">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis
                        dataKey="dateLabel"
                        tick={{ fontSize: 11 }}
                        interval={dateRange > 30 ? Math.floor(dateRange / 10) : "preserveStartEnd"}
                      />
                      <YAxis
                        yAxisId="stock"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => `${v.toFixed(0)}t`}
                        domain={["auto", "auto"]}
                      />
                      <YAxis
                        yAxisId="movement"
                        orientation="right"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => `${v.toFixed(1)}t`}
                      />
                      <Tooltip
                        formatter={(value: number, name: string) => {
                          const labels: Record<string, string> = {
                            stockTon: "Stock",
                            entriesTon: "Ingresos",
                            consumptionTon: "Consumo",
                          }
                          return [`${value.toFixed(2)} t`, labels[name] || name]
                        }}
                        labelFormatter={(label) => `Fecha: ${label}`}
                      />
                      <Legend />
                      {materialInfo && (
                        <ReferenceLine
                          yAxisId="stock"
                          y={materialInfo.min_stock / 1000}
                          stroke="#ef4444"
                          strokeDasharray="5 5"
                          label={{
                            value: "Stock Min",
                            position: "insideTopRight",
                            fontSize: 10,
                            fill: "#ef4444",
                          }}
                        />
                      )}
                      <Area
                        yAxisId="stock"
                        type="monotone"
                        dataKey="stockTon"
                        name="Stock"
                        fill="#3b82f6"
                        fillOpacity={0.2}
                        stroke="#3b82f6"
                        strokeWidth={2}
                      />
                      <Bar
                        yAxisId="movement"
                        dataKey="entriesTon"
                        name="Ingresos"
                        fill="#22c55e"
                        opacity={0.7}
                        barSize={dateRange > 30 ? 4 : 8}
                      />
                      <Bar
                        yAxisId="movement"
                        dataKey="consumptionTon"
                        name="Consumo"
                        fill="#ef4444"
                        opacity={0.7}
                        barSize={dateRange > 30 ? 4 : 8}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Daily Movements Table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">
                Movimientos Diarios
                <span className="text-xs font-normal text-muted-foreground ml-2">· clic en consumo para ver detalle</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b">
                      <th className="text-left py-2 px-3 font-medium">Fecha</th>
                      <th className="text-right py-2 px-3 font-medium text-green-600">Ingresos</th>
                      <th className="text-right py-2 px-3 font-medium text-red-600">Consumo</th>
                      <th className="text-right py-2 px-3 font-medium">Stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...chartData].reverse().map((day) => (
                      <tr
                        key={day.date}
                        className={`border-b last:border-0 hover:bg-muted/50 ${day.consumption > 0 ? "cursor-pointer" : ""}`}
                        onClick={() => day.consumption > 0 && loadDayDetail(day.date)}
                      >
                        <td className="py-2 px-3 font-medium">
                          {format(new Date(day.date + "T12:00:00"), "EEEE dd/MM", { locale: es })}
                        </td>
                        <td className="py-2 px-3 text-right text-green-600">
                          {day.entries > 0 ? `+${(day.entries / 1000).toFixed(2)} t` : "-"}
                        </td>
                        <td className="py-2 px-3 text-right text-red-600 font-medium">
                          {day.consumption > 0 ? (
                            <span className="inline-flex items-center gap-1">
                              -{(day.consumption / 1000).toFixed(2)} t
                              <ExternalLink className="h-3 w-3 opacity-50" />
                            </span>
                          ) : "-"}
                        </td>
                        <td className="py-2 px-3 text-right font-medium">{(day.stock / 1000).toFixed(2)} t</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── DAY DETAIL DIALOG ─────────────────────────────────────────────────── */}
      <Dialog open={showDayDetail} onOpenChange={setShowDayDetail}>
        <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="p-6 pb-4 border-b">
            <DialogTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-red-600" />
              Detalle {dayDetailDate ? format(new Date(dayDetailDate + "T12:00:00"), "EEEE d/MM/yyyy", { locale: es }) : ""} — {materialInfo?.name}
            </DialogTitle>
          </DialogHeader>

          {loadingDayDetail ? (
            <div className="flex items-center justify-center flex-1 p-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : dayDetailData.length === 0 ? (
            <div className="flex items-center justify-center flex-1 p-12 text-muted-foreground">
              Sin movimientos ese día
            </div>
          ) : (
            <div className="flex-1 overflow-auto p-6 space-y-6">
              {/* Summary by formula */}
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Resumen por Fórmula</h3>
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left py-2 px-3 font-semibold">Fórmula</th>
                      <th className="text-right py-2 px-3 font-semibold">Camiones</th>
                      <th className="text-right py-2 px-3 font-semibold">Total m³</th>
                      <th className="text-right py-2 px-3 font-semibold text-red-600">Total {materialInfo?.name}</th>
                      <th className="text-right py-2 px-3 font-semibold text-muted-foreground">kg/m³</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayDetailByFormula.map((row, idx) => (
                      <tr key={idx} className="border-b hover:bg-muted/20">
                        <td className="py-2 px-3 font-medium">
                          <Badge variant="secondary">{row.formula}</Badge>
                        </td>
                        <td className="py-2 px-3 text-right text-muted-foreground">{row.count}</td>
                        <td className="py-2 px-3 text-right font-medium">{row.totalM3.toFixed(1)} m³</td>
                        <td className="py-2 px-3 text-right font-bold text-red-600">
                          {(row.totalKg / 1000).toFixed(3)} t
                          <span className="text-xs font-normal text-muted-foreground ml-1">({Math.round(row.totalKg).toLocaleString()} kg)</span>
                        </td>
                        <td className="py-2 px-3 text-right text-muted-foreground text-xs">
                          {row.totalM3 > 0 ? `${(row.totalKg / row.totalM3).toFixed(0)} kg/m³` : "-"}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 bg-muted/20 font-bold">
                      <td className="py-2 px-3">TOTAL</td>
                      <td className="py-2 px-3 text-right">{dayDetailData.length}</td>
                      <td className="py-2 px-3 text-right">
                        {dayDetailByFormula.reduce((s, r) => s + r.totalM3, 0).toFixed(1)} m³
                      </td>
                      <td className="py-2 px-3 text-right text-red-600">
                        {(dayDetailByFormula.reduce((s, r) => s + r.totalKg, 0) / 1000).toFixed(3)} t
                      </td>
                      <td className="py-2 px-3 text-right text-muted-foreground text-xs">
                        {(() => {
                          const totalKg = dayDetailByFormula.reduce((s, r) => s + r.totalKg, 0)
                          const totalM3 = dayDetailByFormula.reduce((s, r) => s + r.totalM3, 0)
                          return totalM3 > 0 ? `${(totalKg / totalM3).toFixed(0)} kg/m³` : "-"
                        })()}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Individual dispatch rows */}
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Detalle por Camión</h3>
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left py-2 px-3 font-semibold">Remito</th>
                      <th className="text-left py-2 px-3 font-semibold">Fórmula</th>
                      <th className="text-left py-2 px-3 font-semibold">Cliente</th>
                      <th className="text-right py-2 px-3 font-semibold">m³</th>
                      <th className="text-right py-2 px-3 font-semibold text-red-600">kg {materialInfo?.name}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayDetailData.map((row, idx) => (
                      <tr key={row.id} className={`border-b hover:bg-muted/20 ${idx % 2 === 0 ? "bg-muted/10" : ""}`}>
                        <td className="py-2 px-3">
                          <Badge variant="outline">{row.remito}</Badge>
                        </td>
                        <td className="py-2 px-3">
                          <Badge variant="secondary">{row.formula}</Badge>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground text-xs">{row.client || row.notes || "-"}</td>
                        <td className="py-2 px-3 text-right">{row.m3 > 0 ? `${row.m3.toFixed(1)} m³` : "-"}</td>
                        <td className="py-2 px-3 text-right font-bold text-red-600">
                          {Math.round(row.kg).toLocaleString()} kg
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── CONSUMPTION DETAIL DIALOG ──────────────────────────────────────────── */}
      <Dialog open={showConsumptionDetail} onOpenChange={setShowConsumptionDetail}>
        <DialogContent className="max-w-6xl w-[95vw] h-[90vh] flex flex-col p-0">
          <DialogHeader className="p-6 pb-4 border-b">
            <DialogTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-red-600" />
              Detalle de Consumos - {materialInfo?.name}
              <Badge variant="outline" className="ml-2">
                Ultimos {dateRange} dias
              </Badge>
            </DialogTitle>
          </DialogHeader>

          {loadingDetails ? (
            <div className="flex items-center justify-center flex-1">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : consumptionDetails.length === 0 ? (
            <div className="flex items-center justify-center flex-1 text-muted-foreground">
              No hay consumos en el periodo seleccionado
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-auto p-6 pt-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[800px] border-collapse">
                    <thead className="sticky top-0 bg-background z-10">
                      <tr className="border-b">
                        <th className="text-left py-3 px-4 font-semibold text-sm">Fecha</th>
                        <th className="text-left py-3 px-4 font-semibold text-sm">Remito</th>
                        <th className="text-left py-3 px-4 font-semibold text-sm">Cliente</th>
                        <th className="text-left py-3 px-4 font-semibold text-sm">Obra</th>
                        <th className="text-left py-3 px-4 font-semibold text-sm">Formula</th>
                        <th className="text-right py-3 px-4 font-semibold text-sm">M3</th>
                        <th className="text-right py-3 px-4 font-semibold text-sm text-red-600">Consumo (kg)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {consumptionDetails.map((item, idx) => (
                        <tr
                          key={item.id}
                          className={`border-b hover:bg-muted/50 ${idx % 2 === 0 ? "bg-muted/20" : ""}`}
                        >
                          <td className="py-3 px-4 font-medium whitespace-nowrap">
                            {format(new Date(item.movement_date + "T12:00:00"), "dd/MM/yyyy")}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <Badge variant="outline">{item.dispatch?.remito || item.notes || "-"}</Badge>
                          </td>
                          <td className="py-3 px-4">{item.dispatch?.clients?.name || "-"}</td>
                          <td className="py-3 px-4 text-muted-foreground">
                            {item.dispatch?.construction_sites?.name || "-"}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <Badge variant="secondary">{item.dispatch?.formulas?.name || "-"}</Badge>
                          </td>
                          <td className="py-3 px-4 text-right font-medium whitespace-nowrap">
                            {item.dispatch?.quantity_m3?.toFixed(1) || "-"} m3
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-red-600 whitespace-nowrap">
                            {item.quantity_kg?.toLocaleString("es-AR", { maximumFractionDigits: 0 })} kg
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="border-t bg-muted/30 p-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">{consumptionDetails.length} movimientos</span>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Total consumido</p>
                    <p className="text-2xl font-bold text-red-600">
                      {(
                        consumptionDetails.reduce((sum, d) => sum + (d.quantity_kg || 0), 0) / 1000
                      ).toFixed(2)}{" "}
                      t
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── PASSWORD DIALOG ────────────────────────────────────────────────────── */}
      <Dialog
        open={showPasswordDialog}
        onOpenChange={(open) => {
          setShowPasswordDialog(open)
          if (!open) {
            setPasswordInput("")
            setPasswordError(false)
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Ajustar Stock — {adjustTarget?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="adjust-password">Contraseña</Label>
            <Input
              id="adjust-password"
              type="password"
              placeholder="Ingresá la contraseña"
              value={passwordInput}
              onChange={(e) => {
                setPasswordInput(e.target.value)
                setPasswordError(false)
              }}
              onKeyDown={(e) => e.key === "Enter" && handlePasswordSubmit()}
              autoFocus
            />
            {passwordError && (
              <p className="text-sm text-red-600 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Contraseña incorrecta
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPasswordDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handlePasswordSubmit}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── ADJUST STOCK DIALOG ────────────────────────────────────────────────── */}
      <AdjustStockDialog
        material={adjustTarget}
        open={showAdjustDialog}
        onOpenChange={setShowAdjustDialog}
        onSuccess={() => {
          loadMaterials()
          if (view === "detail") loadChartData()
          else loadDashboardData()
        }}
      />
    </div>
  )
}
