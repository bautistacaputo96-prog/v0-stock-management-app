"use client"

import { useState, useEffect, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Loader2, TrendingUp, TrendingDown, Package, Calendar, ExternalLink } from "lucide-react"
import { format, subDays, startOfDay, endOfDay } from "date-fns"
import { es } from "date-fns/locale"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
  Area,
  ComposedChart,
  Bar,
} from "recharts"

interface Material {
  id: string
  name: string
  current_stock: number
  min_stock: number
  unit: string
}

interface StockEvolutionChartProps {
  plantId: string
}

export function StockEvolutionChart({ plantId }: StockEvolutionChartProps) {
  const [materials, setMaterials] = useState<Material[]>([])
  const [selectedMaterial, setSelectedMaterial] = useState<string>("")
  const [dateRange, setDateRange] = useState<number>(30) // days
  const [loading, setLoading] = useState(true)
  const [chartData, setChartData] = useState<any[]>([])
  const [materialInfo, setMaterialInfo] = useState<Material | null>(null)
  const [showConsumptionDetail, setShowConsumptionDetail] = useState(false)
  const [consumptionDetails, setConsumptionDetails] = useState<any[]>([])
  const [loadingDetails, setLoadingDetails] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    if (plantId) loadMaterials()
  }, [plantId])

  useEffect(() => {
    if (selectedMaterial) loadChartData()
  }, [selectedMaterial, dateRange])

  async function loadMaterials() {
    const { data } = await supabase
      .from("materials")
      .select("*")
      .eq("plant_id", plantId)
      .neq("name", "Agua")
      .order("name")
    
    if (data && data.length > 0) {
      setMaterials(data)
      setSelectedMaterial(data[0].id)
      setMaterialInfo(data[0])
    }
    setLoading(false)
  }

  async function loadChartData() {
    setLoading(true)
    const material = materials.find(m => m.id === selectedMaterial)
    if (!material) return
    
    setMaterialInfo(material)
    
    const endDate = new Date()
    const startDate = subDays(endDate, dateRange)

    // Get all stock entries for this material in the date range
    const { data: entries } = await supabase
      .from("stock_entries")
      .select("quantity, dry_quantity, entry_date")
      .eq("material_id", selectedMaterial)
      .gte("entry_date", startDate.toISOString())
      .lte("entry_date", endDate.toISOString())
      .order("entry_date")

    // Get all consumption (stock_movements) for this material
    const { data: consumption } = await supabase
      .from("stock_movements")
      .select("quantity_kg, movement_date")
      .eq("material_id", selectedMaterial)
      .eq("movement_type", "consumo")
      .gte("movement_date", format(startDate, "yyyy-MM-dd"))
      .lte("movement_date", format(endDate, "yyyy-MM-dd"))
      .order("movement_date")

    // Build daily data
    const dailyData: Record<string, { date: string; entries: number; consumption: number; stock: number }> = {}
    
    // Initialize all days
    for (let i = dateRange; i >= 0; i--) {
      const date = subDays(endDate, i)
      const dateStr = format(date, "yyyy-MM-dd")
      dailyData[dateStr] = {
        date: dateStr,
        entries: 0,
        consumption: 0,
        stock: 0,
      }
    }

    // Sum entries by day
    entries?.forEach(e => {
      const dateStr = String(e.entry_date).substring(0, 10)
      if (dailyData[dateStr]) {
        dailyData[dateStr].entries += e.quantity || 0
      }
    })

    // Sum consumption by day
    consumption?.forEach(c => {
      const dateStr = String(c.movement_date).substring(0, 10)
      if (dailyData[dateStr]) {
        dailyData[dateStr].consumption += c.quantity_kg || 0
      }
    })

    // Calculate running stock (working backwards from current stock)
    const sortedDays = Object.values(dailyData).sort((a, b) => b.date.localeCompare(a.date))
    let runningStock = material.current_stock

    for (const day of sortedDays) {
      day.stock = runningStock
      // Go back in time: add consumption, subtract entries
      runningStock = runningStock + day.consumption - day.entries
    }

    // Convert to array and sort ascending for chart
    const result = Object.values(dailyData)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({
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

    // Get consumption details with dispatch and formula info
    const { data } = await supabase
      .from("stock_movements")
      .select(`
        id,
        quantity_kg,
        movement_date,
        notes,
        reference_id
      `)
      .eq("material_id", selectedMaterial)
      .eq("movement_type", "consumo")
      .gte("movement_date", format(startDate, "yyyy-MM-dd"))
      .lte("movement_date", format(endDate, "yyyy-MM-dd"))
      .order("movement_date", { ascending: false })

    if (data && data.length > 0) {
      // Get dispatch details for each movement
      const dispatchIds = data.map(d => d.reference_id).filter(Boolean)
      
      const { data: dispatches } = await supabase
        .from("dispatches")
        .select(`
          id,
          remito,
          quantity_m3,
          dispatch_date,
          formulas (
            id,
            name
          ),
          clients (
            id,
            name
          ),
          construction_sites (
            id,
            name
          )
        `)
        .in("id", dispatchIds)

      // Merge data
      const detailsWithDispatch = data.map(movement => {
        const dispatch = dispatches?.find(d => d.id === movement.reference_id)
        return {
          ...movement,
          dispatch,
        }
      })

      setConsumptionDetails(detailsWithDispatch)
    } else {
      setConsumptionDetails([])
    }
    
    setLoadingDetails(false)
  }

  const stats = useMemo(() => {
    if (chartData.length === 0) return null
    
    const totalEntries = chartData.reduce((sum, d) => sum + d.entries, 0)
    const totalConsumption = chartData.reduce((sum, d) => sum + d.consumption, 0)
    const avgDailyConsumption = totalConsumption / chartData.length
    const netChange = totalEntries - totalConsumption
    const firstStock = chartData[0]?.stock || 0
    const lastStock = chartData[chartData.length - 1]?.stock || 0
    const stockChange = lastStock - firstStock
    const stockChangePercent = firstStock > 0 ? (stockChange / firstStock) * 100 : 0

    return {
      totalEntries,
      totalConsumption,
      avgDailyConsumption,
      netChange,
      stockChange,
      stockChangePercent,
    }
  }, [chartData])

  if (loading && materials.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <label className="text-sm font-medium mb-2 block">Material</label>
          <Select value={selectedMaterial} onValueChange={setSelectedMaterial}>
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar material" />
            </SelectTrigger>
            <SelectContent>
              {materials.map(m => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
              <p className="text-2xl font-bold">
                {(materialInfo.current_stock / 1000).toFixed(1)} t
              </p>
              <p className="text-xs text-muted-foreground">
                Min: {(materialInfo.min_stock / 1000).toFixed(1)} t
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-green-600 text-sm mb-1">
                <TrendingUp className="h-4 w-4" />
                Total Ingresos
              </div>
              <p className="text-2xl font-bold text-green-600">
                {(stats.totalEntries / 1000).toFixed(1)} t
              </p>
              <p className="text-xs text-muted-foreground">
                Ultimos {dateRange} dias
              </p>
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
              <p className="text-2xl font-bold text-red-600">
                {(stats.totalConsumption / 1000).toFixed(1)} t
              </p>
              <p className="text-xs text-muted-foreground">
                Prom: {(stats.avgDailyConsumption / 1000).toFixed(2)} t/dia
              </p>
              <p className="text-xs text-blue-600 mt-1">
                Click para ver detalle
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Calendar className="h-4 w-4" />
                Variacion Stock
              </div>
              <p className={`text-2xl font-bold ${stats.stockChange >= 0 ? "text-green-600" : "text-red-600"}`}>
                {stats.stockChange >= 0 ? "+" : ""}{(stats.stockChange / 1000).toFixed(1)} t
              </p>
              <p className="text-xs text-muted-foreground">
                {stats.stockChangePercent >= 0 ? "+" : ""}{stats.stockChangePercent.toFixed(1)}%
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
                    domain={['auto', 'auto']}
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
                      label={{ value: "Stock Min", position: "insideTopRight", fontSize: 10, fill: "#ef4444" }}
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
          <CardTitle className="text-base font-medium">Movimientos Diarios</CardTitle>
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
                  <tr key={day.date} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="py-2 px-3 font-medium">
                      {format(new Date(day.date + "T12:00:00"), "EEEE dd/MM", { locale: es })}
                    </td>
                    <td className="py-2 px-3 text-right text-green-600">
                      {day.entries > 0 ? `+${(day.entries / 1000).toFixed(2)} t` : "-"}
                    </td>
                    <td className="py-2 px-3 text-right text-red-600">
                      {day.consumption > 0 ? `-${(day.consumption / 1000).toFixed(2)} t` : "-"}
                    </td>
                    <td className="py-2 px-3 text-right font-medium">
                      {(day.stock / 1000).toFixed(2)} t
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Consumption Detail Dialog */}
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
                        <tr key={item.id} className={`border-b hover:bg-muted/50 ${idx % 2 === 0 ? 'bg-muted/20' : ''}`}>
                          <td className="py-3 px-4 font-medium whitespace-nowrap">
                            {format(new Date(item.movement_date + "T12:00:00"), "dd/MM/yyyy")}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <Badge variant="outline">
                              {item.dispatch?.remito || "-"}
                            </Badge>
                          </td>
                          <td className="py-3 px-4">
                            {item.dispatch?.clients?.name || "-"}
                          </td>
                          <td className="py-3 px-4 text-muted-foreground">
                            {item.dispatch?.construction_sites?.name || "-"}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <Badge variant="secondary">
                              {item.dispatch?.formulas?.name || "-"}
                            </Badge>
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
              
              {/* Summary */}
              <div className="border-t bg-muted/30 p-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">
                    {consumptionDetails.length} despachos
                  </span>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Total consumido</p>
                    <p className="text-2xl font-bold text-red-600">
                      {(consumptionDetails.reduce((sum, d) => sum + (d.quantity_kg || 0), 0) / 1000).toFixed(2)} t
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
