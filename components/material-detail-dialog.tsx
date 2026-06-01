"use client"

import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TrendingUp, TrendingDown, ArrowUpCircle, ArrowDownCircle } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"

type Material = {
  id: string
  name: string
  unit: string
  current_stock: number
  min_stock: number
}

type StockEntry = {
  id: string
  quantity: number
  remito: string | null
  humidity_percentage: number | null
  entry_date: string
  suppliers: { name: string } | null
  carriers: { name: string } | null
}

type DispatchMovement = {
  id: string
  dispatch_id: string
  quantity: number
  dispatches: {
    dispatch_date: string
    remito: string
    client: string
    obra: string
    quantity_m3: number
    formulas: {
      code: string
      name: string
    }
  }
}

export function MaterialDetailDialog({
  material,
  open,
  onOpenChange,
}: {
  material: Material
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [stockEntries, setStockEntries] = useState<StockEntry[]>([])
  const [dispatches, setDispatches] = useState<DispatchMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const supabase = createClient()

  useEffect(() => {
    if (open) {
      loadData()
    }
  }, [open, material.id, dateFrom, dateTo])

  async function loadData() {
    setLoading(true)
    try {
      // Load stock entries
      let entriesQuery = supabase
        .from("stock_entries")
        .select(`
          id,
          quantity,
          remito,
          humidity_percentage,
          entry_date,
          suppliers (name),
          carriers (name)
        `)
        .eq("material_id", material.id)
        .order("entry_date", { ascending: false })

      if (dateFrom) {
        entriesQuery = entriesQuery.gte("entry_date", new Date(dateFrom).toISOString())
      }
      if (dateTo) {
        entriesQuery = entriesQuery.lte("entry_date", new Date(dateTo).toISOString())
      }

      const { data: entriesData } = await entriesQuery
      setStockEntries(entriesData || [])

      // Load dispatch movements
      const dispatchesQuery = supabase
        .from("dispatch_materials")
        .select(`
          id,
          dispatch_id,
          quantity,
          dispatches (
            dispatch_date,
            remito,
            client,
            obra,
            quantity_m3,
            formulas (
              code,
              name
            )
          )
        `)
        .eq("material_id", material.id)
        .order("dispatches(dispatch_date)", { ascending: false })

      const { data: dispatchData } = await dispatchesQuery
      const filtered = (dispatchData || []).filter((d: any) => {
        if (!d.dispatches) return false
        const dispatchDate = new Date(d.dispatches.dispatch_date)
        if (dateFrom && dispatchDate < new Date(dateFrom)) return false
        if (dateTo && dispatchDate > new Date(dateTo)) return false
        return true
      })
      setDispatches(filtered)
    } catch (error) {
      console.error("Error loading material data:", error)
    } finally {
      setLoading(false)
    }
  }

  const totalIn = stockEntries.reduce((sum, entry) => sum + entry.quantity, 0)
  const totalOut = dispatches.reduce((sum, dispatch) => sum + dispatch.quantity, 0)

  // Prepare chart data
  const chartData = prepareChartData()

  function prepareChartData() {
    // Combine all movements
    const movements: Array<{ date: Date; type: "entry" | "dispatch"; quantity: number }> = []

    stockEntries.forEach((entry) => {
      movements.push({
        date: new Date(entry.entry_date),
        type: "entry",
        quantity: entry.quantity,
      })
    })

    dispatches.forEach((dispatch) => {
      movements.push({
        date: new Date(dispatch.dispatches.dispatch_date),
        type: "dispatch",
        quantity: -dispatch.quantity,
      })
    })

    // Sort by date
    movements.sort((a, b) => a.date.getTime() - b.date.getTime())

    // Calculate cumulative stock
    let runningStock = 0
    const data = movements.map((movement) => {
      runningStock += movement.quantity
      return {
        date: format(movement.date, "dd/MM/yyyy"),
        stock: Math.round(runningStock * 100) / 100,
      }
    })

    return data
  }

  // Convert to display units if needed
  const getDisplayValue = (value: number) => {
    const isBulkMaterial =
      material.name.toLowerCase().includes("arena") ||
      material.name.toLowerCase().includes("piedra") ||
      material.name.toLowerCase().includes("cemento")

    if (isBulkMaterial && material.unit === "kg") {
      return `${(value / 1000).toFixed(2)} tn`
    }
    return `${value.toFixed(2)} ${material.unit}`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Detalle de Material: {material.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Stock Actual</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{getDisplayValue(material.current_stock)}</div>
              </CardContent>
            </Card>

            <Card className="bg-green-50 dark:bg-green-950">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-green-700 dark:text-green-300 flex items-center gap-2">
                  <ArrowUpCircle className="h-4 w-4" />
                  Total Ingresado
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-700 dark:text-green-300">{getDisplayValue(totalIn)}</div>
              </CardContent>
            </Card>

            <Card className="bg-red-50 dark:bg-red-950">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-red-700 dark:text-red-300 flex items-center gap-2">
                  <ArrowDownCircle className="h-4 w-4" />
                  Total Despachado
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-700 dark:text-red-300">{getDisplayValue(totalOut)}</div>
              </CardContent>
            </Card>
          </div>

          {/* Date Filters */}
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <Label htmlFor="date-from">Fecha desde</Label>
              <Input id="date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="flex-1">
              <Label htmlFor="date-to">Fecha hasta</Label>
              <Input id="date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setDateFrom("")
                setDateTo("")
              }}
            >
              Limpiar Filtros
            </Button>
          </div>

          {/* Chart */}
          {chartData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Evolución del Stock</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="stock"
                      stroke="#2563eb"
                      strokeWidth={2}
                      name={`Stock (${material.unit})`}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Movement Tables */}
          <Tabs defaultValue="entries" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="entries" className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Ingresos ({stockEntries.length})
              </TabsTrigger>
              <TabsTrigger value="dispatches" className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4" />
                Egresos ({dispatches.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="entries" className="mt-4">
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Proveedor</TableHead>
                      <TableHead>Flete</TableHead>
                      <TableHead>Remito</TableHead>
                      <TableHead>Humedad</TableHead>
                      <TableHead className="text-right">Cantidad</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stockEntries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          No hay ingresos en el período seleccionado
                        </TableCell>
                      </TableRow>
                    ) : (
                      stockEntries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell className="font-mono">
                            {format(new Date(entry.entry_date), "dd/MM/yyyy", { locale: es })}
                          </TableCell>
                          <TableCell>{entry.suppliers?.name || "-"}</TableCell>
                          <TableCell>{entry.carriers?.name || "-"}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{entry.remito || "-"}</Badge>
                          </TableCell>
                          <TableCell>{entry.humidity_percentage ? `${entry.humidity_percentage}%` : "-"}</TableCell>
                          <TableCell className="text-right font-mono text-green-600 font-semibold">
                            +{getDisplayValue(entry.quantity)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="dispatches" className="mt-4">
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Fórmula</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Obra</TableHead>
                      <TableHead>Remito</TableHead>
                      <TableHead className="text-right">m³</TableHead>
                      <TableHead className="text-right">Cantidad</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dispatches.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                          No hay despachos en el período seleccionado
                        </TableCell>
                      </TableRow>
                    ) : (
                      dispatches.map((dispatch) => (
                        <TableRow key={dispatch.id}>
                          <TableCell className="font-mono">
                            {format(new Date(dispatch.dispatches.dispatch_date), "dd/MM/yyyy", { locale: es })}
                          </TableCell>
                          <TableCell>
                            <div>
                              <div className="font-medium">{dispatch.dispatches.formulas.code}</div>
                              <div className="text-xs text-muted-foreground">{dispatch.dispatches.formulas.name}</div>
                            </div>
                          </TableCell>
                          <TableCell>{dispatch.dispatches.client}</TableCell>
                          <TableCell>{dispatch.dispatches.obra}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{dispatch.dispatches.remito}</Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">{dispatch.dispatches.quantity_m3}</TableCell>
                          <TableCell className="text-right font-mono text-red-600 font-semibold">
                            -{getDisplayValue(dispatch.quantity)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  )
}
