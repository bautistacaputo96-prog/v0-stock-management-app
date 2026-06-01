"use client"

import { useState, useEffect, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { 
  Package, 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle, 
  Clock,
  ArrowUp,
  ArrowDown,
  Calendar,
  Truck,
  Activity,
  X,
  FileText,
  Building2
} from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { format, subDays, startOfDay, endOfDay, parseISO } from "date-fns"
import { es } from "date-fns/locale"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
  Area,
  AreaChart,
} from "recharts"

interface Material {
  id: string
  name: string
  current_stock: number
  min_stock: number
  unit: string
  dry_stock?: number
  stockpile_humidity?: number
}

interface StockEntry {
  id: string
  material_id: string
  quantity: number
  entry_date: string
  dry_quantity?: number
}

interface DispatchMaterial {
  id: string
  material_id: string
  quantity: number
  created_at: string
}

interface MaterialsDashboardProps {
  plantId: string
}

interface MovementDetail {
  id: string
  type: "entry" | "consumption"
  date: string
  quantity: number
  dryQuantity?: number
  humidity?: number
  remito?: string
  supplier?: string
  dispatchRemito?: string
  client?: string
  formula?: string
  notes?: string
}

export function MaterialsDashboard({ plantId }: MaterialsDashboardProps) {
  const [materials, setMaterials] = useState<Material[]>([])
  const [stockEntries, setStockEntries] = useState<StockEntry[]>([])
  const [dispatchMaterials, setDispatchMaterials] = useState<DispatchMaterial[]>([])
  const [loading, setLoading] = useState(true)
  
  // Selected material for detail view
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null)
  const [materialMovements, setMaterialMovements] = useState<MovementDetail[]>([])
  const [loadingMovements, setLoadingMovements] = useState(false)

  useEffect(() => {
    if (plantId) loadData()
  }, [plantId])

  async function loadMaterialMovements(material: Material) {
    setSelectedMaterial(material)
    setLoadingMovements(true)
    
    const supabase = createClient()
    const thirtyDaysAgo = subDays(new Date(), 30)

    // Load detailed entries with supplier info
    const { data: entries } = await supabase
      .from("stock_entries")
      .select("id, quantity, entry_date, dry_quantity, humidity_percentage, remito, notes, suppliers(name)")
      .eq("material_id", material.id)
      .gte("entry_date", thirtyDaysAgo.toISOString())
      .order("entry_date", { ascending: false })

    // Load detailed consumption with dispatch info
    const { data: consumption } = await supabase
      .from("dispatch_materials")
      .select("id, quantity, dry_quantity, wet_quantity, humidity_at_dispatch, created_at, dispatches(remito, clients(name), formulas(code, name))")
      .eq("material_id", material.id)
      .gte("created_at", thirtyDaysAgo.toISOString())
      .order("created_at", { ascending: false })

    const movements: MovementDetail[] = []

    // Add entries
    entries?.forEach((e: any) => {
      movements.push({
        id: e.id,
        type: "entry",
        date: e.entry_date,
        quantity: e.quantity,
        dryQuantity: e.dry_quantity,
        humidity: e.humidity_percentage,
        remito: e.remito,
        supplier: e.suppliers?.name,
        notes: e.notes,
      })
    })

    // Add consumption
    consumption?.forEach((c: any) => {
      movements.push({
        id: c.id,
        type: "consumption",
        date: c.created_at,
        quantity: c.quantity || c.wet_quantity,
        dryQuantity: c.dry_quantity,
        humidity: c.humidity_at_dispatch,
        dispatchRemito: c.dispatches?.remito,
        client: c.dispatches?.clients?.name,
        formula: c.dispatches?.formulas?.code,
      })
    })

    // Sort by date descending
    movements.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    setMaterialMovements(movements)
    setLoadingMovements(false)
  }

  async function loadData() {
    setLoading(true)
    const supabase = createClient()
    const today = new Date()
    const sevenDaysAgo = subDays(today, 7)
    const thirtyDaysAgo = subDays(today, 30)

    const [materialsRes, entriesRes, dispatchesRes] = await Promise.all([
      supabase
        .from("materials")
        .select("*")
        .eq("plant_id", plantId)
        .order("name"),
      supabase
        .from("stock_entries")
        .select("id, material_id, quantity, entry_date, dry_quantity")
        .gte("entry_date", thirtyDaysAgo.toISOString())
        .order("entry_date", { ascending: false }),
      supabase
        .from("dispatch_materials")
        .select("id, material_id, quantity, created_at")
        .gte("created_at", thirtyDaysAgo.toISOString())
        .order("created_at", { ascending: false }),
    ])

    setMaterials(materialsRes.data || [])
    setStockEntries(entriesRes.data || [])
    setDispatchMaterials(dispatchesRes.data || [])
    setLoading(false)
  }

  // Calculate metrics for each material
  const materialMetrics = useMemo(() => {
    const today = new Date()
    const sevenDaysAgo = subDays(today, 7)
    const yesterdayStart = startOfDay(subDays(today, 1))
    const todayStart = startOfDay(today)

    return materials.map((material) => {
      // Filter entries and dispatches for this material
      const materialEntries = stockEntries.filter((e) => e.material_id === material.id)
      const materialDispatches = dispatchMaterials.filter((d) => d.material_id === material.id)

      // Entries today and this week
      const entriesToday = materialEntries
        .filter((e) => new Date(e.entry_date) >= todayStart)
        .reduce((sum, e) => sum + (e.quantity || 0), 0)

      const entriesWeek = materialEntries
        .filter((e) => new Date(e.entry_date) >= sevenDaysAgo)
        .reduce((sum, e) => sum + (e.quantity || 0), 0)

      const entriesLastWeek = materialEntries
        .filter((e) => {
          const date = new Date(e.entry_date)
          return date >= subDays(sevenDaysAgo, 7) && date < sevenDaysAgo
        })
        .reduce((sum, e) => sum + (e.quantity || 0), 0)

      // Consumption today and this week
      const consumptionToday = materialDispatches
        .filter((d) => new Date(d.created_at) >= todayStart)
        .reduce((sum, d) => sum + (d.quantity || 0), 0)

      const consumptionWeek = materialDispatches
        .filter((d) => new Date(d.created_at) >= sevenDaysAgo)
        .reduce((sum, d) => sum + (d.quantity || 0), 0)

      const consumptionLastWeek = materialDispatches
        .filter((d) => {
          const date = new Date(d.created_at)
          return date >= subDays(sevenDaysAgo, 7) && date < sevenDaysAgo
        })
        .reduce((sum, d) => sum + (d.quantity || 0), 0)

      // Average daily consumption (last 7 days)
      const avgDailyConsumption = consumptionWeek / 7

      // Days of stock remaining
      const daysRemaining = avgDailyConsumption > 0 
        ? Math.floor(material.current_stock / avgDailyConsumption) 
        : 999

      // Stock percentage
      const stockPercentage = material.min_stock > 0 
        ? Math.min((material.current_stock / (material.min_stock * 3)) * 100, 100)
        : 50

      // Consumption trend (% change vs last week)
      const consumptionTrend = consumptionLastWeek > 0
        ? ((consumptionWeek - consumptionLastWeek) / consumptionLastWeek) * 100
        : 0

      // Entry trend
      const entryTrend = entriesLastWeek > 0
        ? ((entriesWeek - entriesLastWeek) / entriesLastWeek) * 100
        : 0

      // Stock status
      let stockStatus: "critical" | "warning" | "ok" = "ok"
      if (daysRemaining <= 3 || material.current_stock <= material.min_stock) {
        stockStatus = "critical"
      } else if (daysRemaining <= 7 || material.current_stock <= material.min_stock * 2) {
        stockStatus = "warning"
      }

      // Estimated stockout date
      const stockoutDate = avgDailyConsumption > 0
        ? new Date(today.getTime() + daysRemaining * 24 * 60 * 60 * 1000)
        : null

      return {
        ...material,
        entriesToday,
        entriesWeek,
        entryTrend,
        consumptionToday,
        consumptionWeek,
        consumptionTrend,
        avgDailyConsumption,
        daysRemaining,
        stockPercentage,
        stockStatus,
        stockoutDate,
      }
    })
  }, [materials, stockEntries, dispatchMaterials])

  // Get alerts
  const alerts = useMemo(() => {
    return materialMetrics
      .filter((m) => m.stockStatus === "critical" || m.stockStatus === "warning" || Math.abs(m.consumptionTrend) > 20)
      .map((m) => {
        const alerts = []
        if (m.stockStatus === "critical") {
          alerts.push({ type: "critical", message: `${m.daysRemaining} dias de stock` })
        } else if (m.stockStatus === "warning") {
          alerts.push({ type: "warning", message: `${m.daysRemaining} dias de stock` })
        }
        if (m.consumptionTrend > 20) {
          alerts.push({ type: "warning", message: `Consumo +${m.consumptionTrend.toFixed(0)}% vs semana anterior` })
        }
        return { ...m, alerts }
      })
  }, [materialMetrics])

  // Chart data for last 7 days
  const chartData = useMemo(() => {
    const days = []
    const today = new Date()
    
    for (let i = 6; i >= 0; i--) {
      const date = subDays(today, i)
      const dayStart = startOfDay(date)
      const dayEnd = endOfDay(date)
      
      const dayData: Record<string, any> = {
        date: format(date, "EEE", { locale: es }),
        fullDate: format(date, "dd/MM"),
      }

      materials.forEach((material) => {
        const dayEntries = stockEntries
          .filter((e) => {
            const entryDate = new Date(e.entry_date)
            return e.material_id === material.id && entryDate >= dayStart && entryDate <= dayEnd
          })
          .reduce((sum, e) => sum + (e.quantity || 0), 0)

        const dayConsumption = dispatchMaterials
          .filter((d) => {
            const dispatchDate = new Date(d.created_at)
            return d.material_id === material.id && dispatchDate >= dayStart && dispatchDate <= dayEnd
          })
          .reduce((sum, d) => sum + (d.quantity || 0), 0)

        dayData[`${material.name}_entries`] = Math.round(dayEntries)
        dayData[`${material.name}_consumption`] = Math.round(dayConsumption)
      })

      days.push(dayData)
    }

    return days
  }, [materials, stockEntries, dispatchMaterials])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "critical": return "text-red-600 bg-red-50 dark:bg-red-950/30"
      case "warning": return "text-amber-600 bg-amber-50 dark:bg-amber-950/30"
      default: return "text-green-600 bg-green-50 dark:bg-green-950/30"
    }
  }

  const getProgressColor = (status: string) => {
    switch (status) {
      case "critical": return "bg-red-500"
      case "warning": return "bg-amber-500"
      default: return "bg-green-500"
    }
  }

  return (
    <div className="space-y-6">
      {/* Alerts Section */}
      {alerts.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2 text-amber-800 dark:text-amber-200">
              <AlertTriangle className="h-5 w-5" />
              Alertas Activas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {alerts.map((alert) => (
                <div key={alert.id} className="flex items-center gap-3 p-3 rounded-lg bg-background border">
                  <div className={`p-2 rounded-full ${alert.stockStatus === "critical" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"}`}>
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{alert.name}</p>
                    {alert.alerts.map((a, i) => (
                      <p key={i} className={`text-xs ${a.type === "critical" ? "text-red-600" : "text-amber-600"}`}>
                        {a.message}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stock Overview - Tank Style Cards */}
      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Package className="h-5 w-5" />
          Stock Actual
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {materialMetrics.map((material) => (
            <Card 
              key={material.id} 
              className="relative overflow-hidden cursor-pointer hover:border-primary/50 hover:shadow-md transition-all"
              onClick={() => loadMaterialMovements(material)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium truncate">{material.name}</CardTitle>
                  <Badge variant="outline" className={getStatusColor(material.stockStatus)}>
                    {material.stockStatus === "critical" ? "Critico" : material.stockStatus === "warning" ? "Bajo" : "OK"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {/* Tank visualization */}
                <div className="relative h-24 bg-muted rounded-lg overflow-hidden mb-3">
                  <div 
                    className={`absolute bottom-0 left-0 right-0 transition-all duration-500 ${getProgressColor(material.stockStatus)}`}
                    style={{ height: `${Math.min(material.stockPercentage, 100)}%`, opacity: 0.7 }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <p className="text-2xl font-bold">
                        {material.current_stock >= 1000 
                          ? `${(material.current_stock / 1000).toFixed(1)}t`
                          : `${Math.round(material.current_stock)}kg`
                        }
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Min: {material.min_stock >= 1000 
                          ? `${(material.min_stock / 1000).toFixed(1)}t`
                          : `${Math.round(material.min_stock)}kg`
                        }
                      </p>
                    </div>
                  </div>
                </div>
                
                {/* Autonomy indicator */}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Autonomia
                  </span>
                  <span className={`font-semibold ${
                    material.daysRemaining <= 3 ? "text-red-600" :
                    material.daysRemaining <= 7 ? "text-amber-600" : "text-green-600"
                  }`}>
                    {material.daysRemaining >= 999 ? "Sin consumo" : `${material.daysRemaining} dias`}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Autonomy Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Autonomia de Stock
          </CardTitle>
          <CardDescription>Dias de stock disponible segun consumo promedio</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium">Material</th>
                  <th className="text-right py-2 px-3 font-medium">Stock Actual</th>
                  <th className="text-right py-2 px-3 font-medium">Consumo Diario</th>
                  <th className="text-right py-2 px-3 font-medium">Dias Restantes</th>
                  <th className="text-right py-2 px-3 font-medium">Quiebre Estimado</th>
                </tr>
              </thead>
              <tbody>
                {materialMetrics.map((m) => (
                  <tr key={m.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="py-2 px-3 font-medium">{m.name}</td>
                    <td className="py-2 px-3 text-right">
                      {m.current_stock >= 1000 
                        ? `${(m.current_stock / 1000).toFixed(2)} t`
                        : `${Math.round(m.current_stock)} kg`
                      }
                    </td>
                    <td className="py-2 px-3 text-right">
                      {m.avgDailyConsumption >= 1000 
                        ? `${(m.avgDailyConsumption / 1000).toFixed(2)} t`
                        : `${Math.round(m.avgDailyConsumption)} kg`
                      }
                    </td>
                    <td className="py-2 px-3 text-right">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        m.daysRemaining <= 3 ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                        m.daysRemaining <= 7 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                        "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      }`}>
                        {m.daysRemaining >= 999 ? "N/A" : `${m.daysRemaining} dias`}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right text-muted-foreground">
                      {m.stockoutDate && m.daysRemaining < 999
                        ? format(m.stockoutDate, "dd/MM/yyyy", { locale: es })
                        : "-"
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Entries and Consumption Summary */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Entries Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-600" />
              Ingresos
            </CardTitle>
            <CardDescription>Ingresos de materia prima</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {materialMetrics.map((m) => (
                <div key={m.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <span className="font-medium text-sm">{m.name}</span>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="text-right">
                      <p className="font-semibold">
                        {m.entriesToday >= 1000 
                          ? `${(m.entriesToday / 1000).toFixed(1)}t`
                          : `${Math.round(m.entriesToday)}kg`
                        }
                      </p>
                      <p className="text-xs text-muted-foreground">Hoy</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">
                        {m.entriesWeek >= 1000 
                          ? `${(m.entriesWeek / 1000).toFixed(1)}t`
                          : `${Math.round(m.entriesWeek)}kg`
                        }
                      </p>
                      <p className="text-xs text-muted-foreground">Semana</p>
                    </div>
                    <div className={`flex items-center gap-1 ${m.entryTrend >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {m.entryTrend >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                      <span className="text-xs font-medium">{Math.abs(m.entryTrend).toFixed(0)}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Consumption Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-blue-600" />
              Consumo
            </CardTitle>
            <CardDescription>Consumo de materia prima</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {materialMetrics.map((m) => (
                <div key={m.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <span className="font-medium text-sm">{m.name}</span>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="text-right">
                      <p className="font-semibold">
                        {m.consumptionToday >= 1000 
                          ? `${(m.consumptionToday / 1000).toFixed(1)}t`
                          : `${Math.round(m.consumptionToday)}kg`
                        }
                      </p>
                      <p className="text-xs text-muted-foreground">Hoy</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">
                        {m.consumptionWeek >= 1000 
                          ? `${(m.consumptionWeek / 1000).toFixed(1)}t`
                          : `${Math.round(m.consumptionWeek)}kg`
                        }
                      </p>
                      <p className="text-xs text-muted-foreground">Semana</p>
                    </div>
                    <div className={`flex items-center gap-1 ${m.consumptionTrend <= 0 ? "text-green-600" : "text-amber-600"}`}>
                      {m.consumptionTrend >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                      <span className="text-xs font-medium">{Math.abs(m.consumptionTrend).toFixed(0)}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Tendencia Ultimos 7 Dias
          </CardTitle>
          <CardDescription>Ingresos y consumos diarios</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={materials[0]?.name || "chart"} className="w-full">
            <TabsList className="mb-4 flex-wrap h-auto gap-1">
              {materials.slice(0, 6).map((m) => (
                <TabsTrigger key={m.id} value={m.name} className="text-xs">
                  {m.name}
                </TabsTrigger>
              ))}
            </TabsList>
            {materials.slice(0, 6).map((m) => (
              <TabsContent key={m.id} value={m.name}>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="fullDate" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: "hsl(var(--background))", 
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px"
                        }}
                        formatter={(value: number) => [
                          value >= 1000 ? `${(value / 1000).toFixed(1)}t` : `${value}kg`,
                          ""
                        ]}
                      />
                      <Legend />
                      <Bar 
                        dataKey={`${m.name}_entries`} 
                        name="Ingresos" 
                        fill="hsl(142, 76%, 36%)" 
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar 
                        dataKey={`${m.name}_consumption`} 
                        name="Consumo" 
                        fill="hsl(221, 83%, 53%)" 
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      {/* Material Detail Dialog */}
      <Dialog open={!!selectedMaterial} onOpenChange={(open) => !open && setSelectedMaterial(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              {selectedMaterial?.name}
            </DialogTitle>
            <DialogDescription>
              Historial de movimientos de los ultimos 30 dias
            </DialogDescription>
          </DialogHeader>

          {loadingMovements ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Summary cards */}
              {selectedMaterial && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 rounded-lg bg-muted/50 text-center">
                    <p className="text-2xl font-bold">
                      {selectedMaterial.current_stock >= 1000 
                        ? `${(selectedMaterial.current_stock / 1000).toFixed(1)}t`
                        : `${Math.round(selectedMaterial.current_stock)}kg`
                      }
                    </p>
                    <p className="text-xs text-muted-foreground">Stock Actual</p>
                  </div>
                  <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/30 text-center">
                    <p className="text-2xl font-bold text-green-600">
                      {(() => {
                        const total = materialMovements
                          .filter(m => m.type === "entry")
                          .reduce((sum, m) => sum + m.quantity, 0)
                        return total >= 1000 ? `${(total / 1000).toFixed(1)}t` : `${Math.round(total)}kg`
                      })()}
                    </p>
                    <p className="text-xs text-muted-foreground">Ingresos (30d)</p>
                  </div>
                  <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-center">
                    <p className="text-2xl font-bold text-blue-600">
                      {(() => {
                        const total = materialMovements
                          .filter(m => m.type === "consumption")
                          .reduce((sum, m) => sum + m.quantity, 0)
                        return total >= 1000 ? `${(total / 1000).toFixed(1)}t` : `${Math.round(total)}kg`
                      })()}
                    </p>
                    <p className="text-xs text-muted-foreground">Consumos (30d)</p>
                  </div>
                </div>
              )}

              {/* Movements list */}
              <ScrollArea className="h-[400px] pr-4">
                {materialMovements.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    No hay movimientos en los ultimos 30 dias
                  </div>
                ) : (
                  <div className="space-y-2">
                    {materialMovements.map((movement) => (
                      <div 
                        key={movement.id} 
                        className={`p-3 rounded-lg border ${
                          movement.type === "entry" 
                            ? "bg-green-50/50 dark:bg-green-950/10 border-green-200 dark:border-green-900" 
                            : "bg-blue-50/50 dark:bg-blue-950/10 border-blue-200 dark:border-blue-900"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-full ${
                              movement.type === "entry" 
                                ? "bg-green-100 dark:bg-green-900" 
                                : "bg-blue-100 dark:bg-blue-900"
                            }`}>
                              {movement.type === "entry" ? (
                                <ArrowDown className={`h-4 w-4 ${movement.type === "entry" ? "text-green-600" : "text-blue-600"}`} />
                              ) : (
                                <ArrowUp className="h-4 w-4 text-blue-600" />
                              )}
                            </div>
                            <div>
                              <p className="font-medium text-sm">
                                {movement.type === "entry" ? "Ingreso" : "Consumo"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {format(parseISO(movement.date), "dd/MM/yyyy HH:mm", { locale: es })}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className={`font-bold ${movement.type === "entry" ? "text-green-600" : "text-blue-600"}`}>
                              {movement.type === "entry" ? "+" : "-"}
                              {movement.quantity >= 1000 
                                ? `${(movement.quantity / 1000).toFixed(2)}t`
                                : `${Math.round(movement.quantity)}kg`
                              }
                            </p>
                            {movement.humidity !== undefined && movement.humidity !== null && (
                              <p className="text-xs text-muted-foreground">
                                Hum: {movement.humidity.toFixed(1)}%
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Details */}
                        <div className="mt-2 pt-2 border-t border-dashed flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          {movement.supplier && (
                            <span className="flex items-center gap-1">
                              <Building2 className="h-3 w-3" />
                              {movement.supplier}
                            </span>
                          )}
                          {movement.remito && (
                            <span className="flex items-center gap-1">
                              <FileText className="h-3 w-3" />
                              R: {movement.remito}
                            </span>
                          )}
                          {movement.client && (
                            <span className="flex items-center gap-1">
                              <Building2 className="h-3 w-3" />
                              {movement.client}
                            </span>
                          )}
                          {movement.formula && (
                            <span className="flex items-center gap-1">
                              <FileText className="h-3 w-3" />
                              {movement.formula}
                            </span>
                          )}
                          {movement.dispatchRemito && (
                            <span className="flex items-center gap-1">
                              <Truck className="h-3 w-3" />
                              R: {movement.dispatchRemito}
                            </span>
                          )}
                          {movement.notes && (
                            <span className="italic">"{movement.notes}"</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
