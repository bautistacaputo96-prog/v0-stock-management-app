"use client"

import { useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { Navigation } from "@/components/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Plus, Pencil, Trash2, Truck, Building2, Package, ClipboardList, AlertTriangle, TrendingDown, TrendingUp } from "lucide-react"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { usePlant } from "@/lib/plant-context"
import { getSupabase } from "@/lib/supabase"
import Link from "next/link"

interface Supplier {
  id: number
  name: string
  material_type: string
  product_detail: string | null
  line_type: string | null
  is_active: boolean
  created_at: string
}

interface Carrier {
  id: number
  name: string
  phone: string | null
  license_plate: string | null
  company: string | null
  is_active: boolean
  created_at: string
}

interface StockAlert {
  material: string
  stockTn: number
  daysOfStock: number
  status: "critical" | "warning" | "ok"
  dailyConsumptionTn: number
}

interface StockData {
  currentStockKg: Record<string, number>
  daysOfStock: Record<string, number>
  dailyConsumptionKg: Record<string, number>
  stockEvolution: Record<string, number | string>[]
  alerts: StockAlert[]
  planning: {
    material: string
    stockTn: number
    dailyConsumptionTn: number
    daysOfStock: number
    exhaustionDate: string | null
    suggestedOrderDate: string | null
  }[]
}

const MATERIAL_TYPES = [
  "Arena",
  "Piedra",
  "Cemento",
  "Aditivo",
  "Otro"
]

const LINE_TYPES = [
  { value: "canos", label: "Caños" },
  { value: "bloques", label: "Bloques" },
  { value: "ambos", label: "Ambos" }
]

export default function MateriaPrimaPage() {
  const { selectedPlant } = usePlant()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get("tab")
  const [activeTab, setActiveTab] = useState(tabParam || "stock")
  
  // Update tab when URL changes
  useEffect(() => {
    if (tabParam) {
      setActiveTab(tabParam)
    }
  }, [tabParam])
  
  // Suppliers state
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loadingSuppliers, setLoadingSuppliers] = useState(true)
  const [showSupplierDialog, setShowSupplierDialog] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [supplierForm, setSupplierForm] = useState({
    name: "",
    material_type: "",
    product_detail: "",
    line_type: "ambos"
  })
  
  // Carriers state
  const [carriers, setCarriers] = useState<Carrier[]>([])
  const [loadingCarriers, setLoadingCarriers] = useState(true)
  const [showCarrierDialog, setShowCarrierDialog] = useState(false)
  const [editingCarrier, setEditingCarrier] = useState<Carrier | null>(null)
  const [carrierForm, setCarrierForm] = useState({
    name: "",
    phone: "",
    license_plate: "",
    company: ""
  })
  
  // Stock state
  const [stockData, setStockData] = useState<StockData | null>(null)
  const [loadingStock, setLoadingStock] = useState(true)
  const [stockDateRange, setStockDateRange] = useState<"7d" | "30d" | "90d">("30d")

  // Load suppliers
  useEffect(() => {
    loadSuppliers()
  }, [])

  // Load carriers
  useEffect(() => {
    loadCarriers()
  }, [])
  
  // Load stock data
  useEffect(() => {
    loadStock()
  }, [selectedPlant])
  
  const loadStock = async () => {
    setLoadingStock(true)
    try {
      const res = await fetch(`/api/materia-prima/stock?plant=${selectedPlant}&lead_time=3`)
      if (res.ok) {
        const data = await res.json()
        setStockData(data)
      }
    } catch (error) {
      console.error("Error loading stock:", error)
    }
    setLoadingStock(false)
  }

  const loadSuppliers = async () => {
    setLoadingSuppliers(true)
    const supabase = getSupabase()
    const { data } = await supabase
      .from("suppliers")
      .select("*")
      .order("name")
    
    if (data) {
      setSuppliers(data)
    }
    setLoadingSuppliers(false)
  }

  const loadCarriers = async () => {
    setLoadingCarriers(true)
    const supabase = getSupabase()
    const { data } = await supabase
      .from("carriers")
      .select("*")
      .order("name")
    
    if (data) {
      setCarriers(data)
    }
    setLoadingCarriers(false)
  }

  const saveSupplier = async () => {
    const supabase = getSupabase()
    
    const dataToSave = {
      name: supplierForm.name,
      material_type: supplierForm.material_type,
      product_detail: supplierForm.product_detail || null,
      line_type: supplierForm.line_type,
      is_active: true
    }
    
    if (editingSupplier) {
      await supabase
        .from("suppliers")
        .update(dataToSave)
        .eq("id", editingSupplier.id)
    } else {
      await supabase
        .from("suppliers")
        .insert(dataToSave)
    }
    
    setShowSupplierDialog(false)
    setEditingSupplier(null)
    setSupplierForm({ name: "", material_type: "", product_detail: "", line_type: "ambos" })
    loadSuppliers()
  }

  const deleteSupplier = async (id: number) => {
    const supabase = getSupabase()
    await supabase
      .from("suppliers")
      .update({ is_active: false })
      .eq("id", id)
    loadSuppliers()
  }

  const saveCarrier = async () => {
    const supabase = getSupabase()
    
    const dataToSave = {
      name: carrierForm.name,
      phone: carrierForm.phone || null,
      license_plate: carrierForm.license_plate || null,
      company: carrierForm.company || null,
      is_active: true
    }
    
    if (editingCarrier) {
      await supabase
        .from("carriers")
        .update(dataToSave)
        .eq("id", editingCarrier.id)
    } else {
      await supabase
        .from("carriers")
        .insert(dataToSave)
    }
    
    setShowCarrierDialog(false)
    setEditingCarrier(null)
    setCarrierForm({ name: "", phone: "", license_plate: "", company: "" })
    loadCarriers()
  }

  const deleteCarrier = async (id: number) => {
    const supabase = getSupabase()
    await supabase
      .from("carriers")
      .update({ is_active: false })
      .eq("id", id)
    loadCarriers()
  }

  const openEditSupplier = (supplier: Supplier) => {
    setEditingSupplier(supplier)
    setSupplierForm({
      name: supplier.name,
      material_type: supplier.material_type,
      product_detail: supplier.product_detail || "",
      line_type: supplier.line_type || "ambos"
    })
    setShowSupplierDialog(true)
  }

  const openEditCarrier = (carrier: Carrier) => {
    setEditingCarrier(carrier)
    setCarrierForm({
      name: carrier.name,
      phone: carrier.phone || "",
      license_plate: carrier.license_plate || "",
      company: carrier.company || ""
    })
    setShowCarrierDialog(true)
  }

  const activeSuppliers = suppliers.filter(s => s.is_active)
  const activeCarriers = carriers.filter(c => c.is_active)

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Materia Prima</h1>
          <p className="text-muted-foreground">Gestión de proveedores, transportistas e ingresos de materia prima</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
            <TabsTrigger value="stock" className="gap-2">
              <Package className="w-4 h-4" />
              <span className="hidden sm:inline">Stock</span>
            </TabsTrigger>
            <TabsTrigger value="ingreso" className="gap-2">
              <ClipboardList className="w-4 h-4" />
              <span className="hidden sm:inline">Ingreso</span>
            </TabsTrigger>
            <TabsTrigger value="proveedores" className="gap-2">
              <Building2 className="w-4 h-4" />
              <span className="hidden sm:inline">Proveedores</span>
            </TabsTrigger>
            <TabsTrigger value="fletes" className="gap-2">
              <Truck className="w-4 h-4" />
              <span className="hidden sm:inline">Fletes</span>
            </TabsTrigger>
          </TabsList>

          {/* INGRESO - Redirect to existing page */}
          <TabsContent value="ingreso">
            <Card>
              <CardContent className="py-8 text-center">
                <ClipboardList className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">Registro de Ingresos</h3>
                <p className="text-muted-foreground mb-4">Registrá los ingresos de materia prima con remito y pesaje</p>
                <Link href="/materia-prima/ingreso">
                  <Button>Ir a Registro de Ingresos</Button>
                </Link>
              </CardContent>
            </Card>
          </TabsContent>

          {/* STOCK - Dashboard integrado */}
          <TabsContent value="stock" className="space-y-6">
            {loadingStock ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">Cargando datos de stock...</p>
              </div>
            ) : stockData ? (
              <>
                {/* STOCK ACTUAL - Cards grandes y prominentes */}
                <div>
                  <h2 className="text-lg font-semibold mb-4">Stock Actual</h2>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {stockData.alerts?.map(item => {
                      const bgColor = item.material === "arena" ? "from-amber-500/10 to-amber-500/5 border-amber-500/30" :
                                     item.material === "piedra" ? "from-indigo-500/10 to-indigo-500/5 border-indigo-500/30" :
                                     item.material === "cemento" ? "from-slate-500/10 to-slate-500/5 border-slate-500/30" :
                                     "from-emerald-500/10 to-emerald-500/5 border-emerald-500/30"
                      const iconColor = item.material === "arena" ? "text-amber-600" :
                                       item.material === "piedra" ? "text-indigo-600" :
                                       item.material === "cemento" ? "text-slate-600" :
                                       "text-emerald-600"
                      return (
                        <Card key={item.material} className={`bg-gradient-to-br ${bgColor} border-2 ${
                          item.status === "critical" ? "!border-red-500 animate-pulse" :
                          item.status === "warning" ? "!border-yellow-500" : ""
                        }`}>
                          <CardContent className="pt-6">
                            <div className="flex items-start justify-between mb-2">
                              <span className={`text-sm font-medium uppercase tracking-wide ${iconColor}`}>
                                {item.material}
                              </span>
                              {item.status === "critical" && <AlertTriangle className="w-5 h-5 text-red-500" />}
                              {item.status === "warning" && <AlertTriangle className="w-5 h-5 text-yellow-500" />}
                            </div>
                            <p className="text-4xl font-bold tracking-tight">{item.stockTn.toFixed(1)}</p>
                            <p className="text-lg text-muted-foreground -mt-1">toneladas</p>
                            <div className="mt-4 pt-4 border-t border-border/50">
                              <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Consumo diario:</span>
                                <span className="font-medium">{item.dailyConsumptionTn.toFixed(2)} Tn</span>
                              </div>
                              <div className="flex justify-between text-sm mt-1">
                                <span className="text-muted-foreground">Días de stock:</span>
                                <span className={`font-bold ${
                                  item.status === "critical" ? "text-red-600" :
                                  item.status === "warning" ? "text-yellow-600" : "text-green-600"
                                }`}>
                                  {item.daysOfStock} días
                                </span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                </div>

                {/* Alertas de stock crítico */}
                {stockData.alerts?.some(a => a.status === "critical" || a.status === "warning") && (
                  <Card className="border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="w-4 h-4" />
                        Alertas de Stock
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {stockData.alerts?.filter(a => a.status !== "ok").map(alert => (
                          <div key={alert.material} className={`flex items-center justify-between p-2 rounded ${
                            alert.status === "critical" ? "bg-red-100 dark:bg-red-950/30" : "bg-yellow-100 dark:bg-yellow-950/30"
                          }`}>
                            <span className="font-medium capitalize">{alert.material}</span>
                            <span className={alert.status === "critical" ? "text-red-600" : "text-yellow-600"}>
                              {alert.daysOfStock} días de stock - {alert.stockTn.toFixed(1)} Tn
                            </span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Gráfico de evolución con filtro de fechas */}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-sm font-medium">Evolución del Stock</CardTitle>
                    <div className="flex gap-1">
                      <Button 
                        variant={stockDateRange === "7d" ? "default" : "outline"} 
                        size="sm"
                        onClick={() => setStockDateRange("7d")}
                      >
                        7 días
                      </Button>
                      <Button 
                        variant={stockDateRange === "30d" ? "default" : "outline"} 
                        size="sm"
                        onClick={() => setStockDateRange("30d")}
                      >
                        30 días
                      </Button>
                      <Button 
                        variant={stockDateRange === "90d" ? "default" : "outline"} 
                        size="sm"
                        onClick={() => setStockDateRange("90d")}
                      >
                        90 días
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={
                          stockDateRange === "7d" ? stockData.stockEvolution?.slice(-7) :
                          stockDateRange === "30d" ? stockData.stockEvolution?.slice(-30) :
                          stockData.stockEvolution
                        }>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis 
                            dataKey="date" 
                            tick={{ fontSize: 10 }}
                            tickFormatter={(d) => new Date(d + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}
                          />
                          <YAxis tick={{ fontSize: 10 }} unit=" Tn" />
                          <Tooltip 
                            labelFormatter={(d) => new Date(d + "T12:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
                            formatter={(value: number, name: string) => [`${value.toFixed(1)} Tn`, name.charAt(0).toUpperCase() + name.slice(1)]}
                          />
                          <Line type="monotone" dataKey="arena" stroke="#f59e0b" strokeWidth={2} dot={stockDateRange === "7d"} name="Arena" />
                          <Line type="monotone" dataKey="piedra" stroke="#6366f1" strokeWidth={2} dot={stockDateRange === "7d"} name="Piedra" />
                          <Line type="monotone" dataKey="cemento" stroke="#94a3b8" strokeWidth={2} dot={stockDateRange === "7d"} name="Cemento" />
                          <Line type="monotone" dataKey="aditivo" stroke="#10b981" strokeWidth={2} dot={stockDateRange === "7d"} name="Aditivo" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-wrap gap-4 mt-4 justify-center">
                      <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-amber-500" /> Arena</div>
                      <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-indigo-500" /> Piedra</div>
                      <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-slate-400" /> Cemento</div>
                      <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-emerald-500" /> Aditivo</div>
                    </div>
                  </CardContent>
                </Card>

                {/* Tabla de planificación */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium">Planificación de Compras</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Material</TableHead>
                          <TableHead className="text-right">Stock Actual</TableHead>
                          <TableHead className="text-right">Consumo/Día</TableHead>
                          <TableHead className="text-right">Días de Stock</TableHead>
                          <TableHead>Fecha Agotamiento</TableHead>
                          <TableHead>Pedir Antes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {stockData.planning?.map(row => {
                          const today = new Date().toISOString().split("T")[0]
                          const isUrgent = row.suggestedOrderDate && row.suggestedOrderDate <= today
                          return (
                            <TableRow key={row.material} className={isUrgent ? "bg-red-50 dark:bg-red-950/30" : ""}>
                              <TableCell className="font-medium capitalize">{row.material}</TableCell>
                              <TableCell className="text-right">{row.stockTn.toFixed(1)} Tn</TableCell>
                              <TableCell className="text-right">{row.dailyConsumptionTn.toFixed(2)} Tn</TableCell>
                              <TableCell className="text-right">{Math.round(row.daysOfStock)}</TableCell>
                              <TableCell>{row.exhaustionDate ? new Date(row.exhaustionDate + "T12:00:00").toLocaleDateString("es-AR") : "—"}</TableCell>
                              <TableCell className={isUrgent ? "text-red-600 font-bold" : ""}>
                                {row.suggestedOrderDate ? new Date(row.suggestedOrderDate + "T12:00:00").toLocaleDateString("es-AR") : "—"}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                {/* Link a vista completa */}
                <div className="text-center">
                  <Link href="/materia-prima/stock">
                    <Button variant="outline">
                      Ver análisis completo de stock
                    </Button>
                  </Link>
                </div>
              </>
            ) : (
              <Card>
                <CardContent className="py-8 text-center">
                  <Package className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No hay datos de stock disponibles</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* PROVEEDORES */}
          <TabsContent value="proveedores" className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold">Proveedores de Materia Prima</h2>
              <Dialog open={showSupplierDialog} onOpenChange={setShowSupplierDialog}>
                <DialogTrigger asChild>
                  <Button onClick={() => {
                    setEditingSupplier(null)
                    setSupplierForm({ name: "", material_type: "", product_detail: "", line_type: "ambos" })
                  }}>
                    <Plus className="w-4 h-4 mr-2" />
                    Agregar Proveedor
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{editingSupplier ? "Editar Proveedor" : "Nuevo Proveedor"}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Nombre del Proveedor</Label>
                      <Input
                        value={supplierForm.name}
                        onChange={(e) => setSupplierForm(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Ej: Piatti, Cementos Avellaneda"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Tipo de Material</Label>
                      <Select
                        value={supplierForm.material_type}
                        onValueChange={(value) => setSupplierForm(prev => ({ ...prev, material_type: value }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar tipo" />
                        </SelectTrigger>
                        <SelectContent>
                          {MATERIAL_TYPES.map(type => (
                            <SelectItem key={type} value={type}>{type}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Detalle del Producto (opcional)</Label>
                      <Input
                        value={supplierForm.product_detail}
                        onChange={(e) => setSupplierForm(prev => ({ ...prev, product_detail: e.target.value }))}
                        placeholder="Ej: Arena de trituración, Piedra 0/10, CPC40"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Línea de Producción</Label>
                      <Select
                        value={supplierForm.line_type}
                        onValueChange={(value) => setSupplierForm(prev => ({ ...prev, line_type: value }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LINE_TYPES.map(lt => (
                            <SelectItem key={lt.value} value={lt.value}>{lt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button onClick={saveSupplier} className="w-full" disabled={!supplierForm.name || !supplierForm.material_type}>
                      {editingSupplier ? "Guardar Cambios" : "Agregar Proveedor"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Proveedor</TableHead>
                      <TableHead>Tipo Material</TableHead>
                      <TableHead>Producto</TableHead>
                      <TableHead>Línea</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingSuppliers ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          Cargando proveedores...
                        </TableCell>
                      </TableRow>
                    ) : suppliers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          No hay proveedores registrados
                        </TableCell>
                      </TableRow>
                    ) : (
                      suppliers.map(supplier => (
                        <TableRow key={supplier.id} className={!supplier.is_active ? "opacity-50" : ""}>
                          <TableCell className="font-medium">{supplier.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{supplier.material_type}</Badge>
                          </TableCell>
                          <TableCell>{supplier.product_detail || "-"}</TableCell>
                          <TableCell>
                            {supplier.line_type === "canos" && "Caños"}
                            {supplier.line_type === "bloques" && "Bloques"}
                            {supplier.line_type === "ambos" && "Ambos"}
                            {!supplier.line_type && "-"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={supplier.is_active ? "default" : "secondary"}>
                              {supplier.is_active ? "Activo" : "Inactivo"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" onClick={() => openEditSupplier(supplier)}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                            {supplier.is_active && (
                              <Button variant="ghost" size="sm" onClick={() => deleteSupplier(supplier.id)}>
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* FLETES / TRANSPORTISTAS */}
          <TabsContent value="fletes" className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold">Transportistas / Choferes</h2>
              <Dialog open={showCarrierDialog} onOpenChange={setShowCarrierDialog}>
                <DialogTrigger asChild>
                  <Button onClick={() => {
                    setEditingCarrier(null)
                    setCarrierForm({ name: "", phone: "", license_plate: "", company: "" })
                  }}>
                    <Plus className="w-4 h-4 mr-2" />
                    Agregar Chofer
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{editingCarrier ? "Editar Chofer" : "Nuevo Chofer"}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Nombre del Chofer</Label>
                      <Input
                        value={carrierForm.name}
                        onChange={(e) => setCarrierForm(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Nombre completo"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Teléfono (opcional)</Label>
                      <Input
                        value={carrierForm.phone}
                        onChange={(e) => setCarrierForm(prev => ({ ...prev, phone: e.target.value }))}
                        placeholder="Ej: 11-1234-5678"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Patente del Camión (opcional)</Label>
                      <Input
                        value={carrierForm.license_plate}
                        onChange={(e) => setCarrierForm(prev => ({ ...prev, license_plate: e.target.value }))}
                        placeholder="Ej: AA123BB"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Empresa de Transporte (opcional)</Label>
                      <Input
                        value={carrierForm.company}
                        onChange={(e) => setCarrierForm(prev => ({ ...prev, company: e.target.value }))}
                        placeholder="Nombre de la empresa"
                      />
                    </div>
                    <Button onClick={saveCarrier} className="w-full" disabled={!carrierForm.name}>
                      {editingCarrier ? "Guardar Cambios" : "Agregar Chofer"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Chofer</TableHead>
                      <TableHead>Teléfono</TableHead>
                      <TableHead>Patente</TableHead>
                      <TableHead>Empresa</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingCarriers ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          Cargando transportistas...
                        </TableCell>
                      </TableRow>
                    ) : carriers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          No hay transportistas registrados
                        </TableCell>
                      </TableRow>
                    ) : (
                      carriers.map(carrier => (
                        <TableRow key={carrier.id} className={!carrier.is_active ? "opacity-50" : ""}>
                          <TableCell className="font-medium">{carrier.name}</TableCell>
                          <TableCell>{carrier.phone || "-"}</TableCell>
                          <TableCell>{carrier.license_plate || "-"}</TableCell>
                          <TableCell>{carrier.company || "-"}</TableCell>
                          <TableCell>
                            <Badge variant={carrier.is_active ? "default" : "secondary"}>
                              {carrier.is_active ? "Activo" : "Inactivo"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" onClick={() => openEditCarrier(carrier)}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                            {carrier.is_active && (
                              <Button variant="ghost" size="sm" onClick={() => deleteCarrier(carrier.id)}>
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
