"use client"

import React, { useState, useEffect, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
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
import { Plus, Pencil, Trash2, Truck, Building2, Package, ClipboardList, AlertTriangle, TrendingDown, TrendingUp, Ban, Check } from "lucide-react"
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
  plant: string
  line_type: string
  is_active: boolean
  created_at: string
  density: number | null
  unit: string | null
}

interface Carrier {
  id: number
  name: string
  phone: string | null
  license_plate: string | null
  company: string | null
  plant: string | null
  material_type: string | null
  is_active: boolean
  created_at: string
}

// Material categories for grouping
const MATERIAL_CATEGORIES: Record<string, string[]> = {
  "Arena": ["Arena Especial", "Arena Fina", "Arena Gruesa"],
  "Piedra": ["Piedra 010", "Piedra 06 Lavada", "Piedra 06 Limpia", "Piedra 0/10"],
  "Cemento": ["CPC-40", "CPF-40", "Cemento"]
}

const getCategoryForMaterial = (material: string): string => {
  const lower = material.toLowerCase()
  if (lower.includes("arena")) return "Arena"
  if (lower.includes("piedra") || lower.includes("canto")) return "Piedra"
  if (lower.includes("cemento") || lower.includes("cpc") || lower.includes("cpf")) return "Cemento"
  return "Otros"
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

// Line types per plant
const LINE_TYPES_PIPES = [
  { value: "canos", label: "Canos" },
  { value: "bloques", label: "Bloques" },
  { value: "ambos", label: "Ambos" }
]

const LINE_TYPES_PAVERS = [
  { value: "adoquines", label: "Adoquines" }
]

const getLineTypes = (plant: string) => {
  if (plant === "ranchos") return LINE_TYPES_PAVERS
  return LINE_TYPES_PIPES
}

function MateriaPrimaContent() {
  const { selectedPlant } = usePlant()
  const searchParams = useSearchParams()
  const router = useRouter()
  const tabParam = searchParams.get("tab")
  const [activeTab, setActiveTab] = useState(tabParam || "stock")
  
  // Update tab when URL changes
  useEffect(() => {
  if (tabParam) {
  setActiveTab(tabParam)
  }
  }, [tabParam])
  
  // Handle tab change - redirect to ingreso page if ingreso tab selected
  const handleTabChange = (value: string) => {
  if (value === "ingreso") {
  router.push("/materia-prima/ingreso")
  } else {
  setActiveTab(value)
  }
  }
  
  // Suppliers state
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loadingSuppliers, setLoadingSuppliers] = useState(true)
  const [showSupplierDialog, setShowSupplierDialog] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [supplierPlantFilter, setSupplierPlantFilter] = useState<string>("all") // "all", "silke", "villa_rosa", "ranchos"
  const [supplierForm, setSupplierForm] = useState({
  name: "",
  material_type: "",
  plant: "silke",  // Nueva: planta del proveedor
    line_type: "ambos",
    density: "",
    unit: "kg"
  })
  
  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: "supplier" | "carrier"; id: number; name: string } | null>(null)
  
  // Carriers state
  const [carriers, setCarriers] = useState<Carrier[]>([])
  const [loadingCarriers, setLoadingCarriers] = useState(true)
  const [showCarrierDialog, setShowCarrierDialog] = useState(false)
  const [editingCarrier, setEditingCarrier] = useState<Carrier | null>(null)
  const [carrierForm, setCarrierForm] = useState({
    name: "",
    phone: "",
    license_plate: "",
    company: "",
    material_type: ""
  })
  
  // Stock state
  const [stockData, setStockData] = useState<StockData | null>(null)
  const [loadingStock, setLoadingStock] = useState(true)
  const [stockDateRange, setStockDateRange] = useState<"7d" | "30d" | "90d">("30d")
  const [visibleMaterials, setVisibleMaterials] = useState<Record<string, boolean>>({
    arena: true,
    piedra: true,
    cemento: true,
    aditivo: true,
  })

  // Load suppliers when filter changes
  useEffect(() => {
    loadSuppliers()
  }, [supplierPlantFilter])

  // Load carriers when plant changes
  useEffect(() => {
    loadCarriers()
  }, [selectedPlant])
  
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
    let query = supabase
      .from("suppliers")
      .select("*")
    
    // Filtrar por planta si no es "all"
    if (supplierPlantFilter !== "all") {
      query = query.eq("plant", supplierPlantFilter)
    }
    
    const { data } = await query.order("plant").order("name")
    
    if (data) {
      setSuppliers(data)
    }
    setLoadingSuppliers(false)
  }

  const loadCarriers = async () => {
    if (!selectedPlant) return
    setLoadingCarriers(true)
    const supabase = getSupabase()
    const { data } = await supabase
      .from("carriers")
      .select("*")
      .eq("plant", selectedPlant)
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
  plant: supplierForm.plant,
  line_type: supplierForm.line_type,
  is_active: true,
  density: supplierForm.density ? parseFloat(supplierForm.density) : null,
      unit: supplierForm.unit || "kg",
      plant: selectedPlant
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
    const defaultLineType = selectedPlant === "ranchos" ? "adoquines" : "ambos"
    setSupplierForm({ name: "", material_type: "", line_type: defaultLineType, density: "", unit: "kg" })
    loadSuppliers()
  }

  const deleteSupplier = async (id: number) => {
  const supabase = getSupabase()
  const { error } = await supabase
  .from("suppliers")
  .delete()
  .eq("id", id)
  if (error) {
  alert("No se puede eliminar el proveedor porque tiene ingresos asociados. Puede desactivarlo en su lugar.")
  } else {
  loadSuppliers()
  }
  setDeleteConfirm(null)
  }
  
  const toggleSupplierActive = async (supplier: Supplier) => {
    const supabase = getSupabase()
    await supabase
      .from("suppliers")
      .update({ is_active: !supplier.is_active })
      .eq("id", supplier.id)
    loadSuppliers()
  }

const saveCarrier = async () => {
  const supabase = getSupabase()
  const plantValue = selectedPlant === "villa-rosa" ? "villa_rosa" : selectedPlant
  
  const dataToSave = {
  name: carrierForm.name,
  phone: carrierForm.phone || null,
  license_plate: carrierForm.license_plate || null,
  company: carrierForm.company || null,
  material_type: carrierForm.material_type || null,
  is_active: true,
  plant: plantValue
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
  const { error } = await supabase
  .from("carriers")
  .delete()
  .eq("id", id)
  if (error) {
  alert("No se puede eliminar el flete porque tiene ingresos asociados.")
  } else {
  loadCarriers()
  }
  setDeleteConfirm(null)
  }

  const openEditSupplier = (supplier: Supplier) => {
    setEditingSupplier(supplier)
setSupplierForm({
  name: supplier.name,
  material_type: supplier.material_type,
  plant: supplier.plant || "silke",
  line_type: supplier.line_type || "ambos",
  density: supplier.density?.toString() || "",
  unit: supplier.unit || "kg"
})
    setShowSupplierDialog(true)
  }

const openEditCarrier = (carrier: Carrier) => {
  setEditingCarrier(carrier)
  setCarrierForm({
    name: carrier.name,
    phone: carrier.phone || "",
    license_plate: carrier.license_plate || "",
    company: carrier.company || "",
    material_type: carrier.material_type || ""
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

        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
<TabsList className="grid w-full grid-cols-3 lg:w-auto lg:inline-grid">
<TabsTrigger value="stock" className="gap-2">
  <Package className="w-4 h-4" />
  <span className="hidden sm:inline">Stock</span>
</TabsTrigger>
<TabsTrigger value="ingreso" className="gap-2">
  <ClipboardList className="w-4 h-4" />
  <span className="hidden sm:inline">Ingreso</span>
</TabsTrigger>
<TabsTrigger value="materiales" className="gap-2">
  <Building2 className="w-4 h-4" />
  <span className="hidden sm:inline">Proveedores y Fletes</span>
</TabsTrigger>
</TabsList>

      {/* INGRESO - Redirects automatically via handleTabChange */}
      <TabsContent value="ingreso">
      <div className="py-8 text-center text-muted-foreground">Redirigiendo...</div>
      </TabsContent>

          {/* STOCK - Dashboard integrado */}
          <TabsContent value="stock" className="space-y-6">
            {loadingStock ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">Cargando datos de stock...</p>
              </div>
            ) : stockData ? (
              <>
            <Card>
              <CardHeader className="space-y-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">Evolución de Stock</CardTitle>
                  <div className="flex gap-2">
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
                </div>
                {/* Filtros de material */}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={visibleMaterials.arena ? "default" : "outline"}
                    size="sm"
                    className={visibleMaterials.arena ? "bg-amber-500 hover:bg-amber-600" : ""}
                    onClick={() => setVisibleMaterials(prev => ({ ...prev, arena: !prev.arena }))}
                  >
                    Arena
                  </Button>
                  <Button
                    variant={visibleMaterials.piedra ? "default" : "outline"}
                    size="sm"
                    className={visibleMaterials.piedra ? "bg-indigo-500 hover:bg-indigo-600" : ""}
                    onClick={() => setVisibleMaterials(prev => ({ ...prev, piedra: !prev.piedra }))}
                  >
                    Piedra
                  </Button>
                  <Button
                    variant={visibleMaterials.cemento ? "default" : "outline"}
                    size="sm"
                    className={visibleMaterials.cemento ? "bg-slate-500 hover:bg-slate-600" : ""}
                    onClick={() => setVisibleMaterials(prev => ({ ...prev, cemento: !prev.cemento }))}
                  >
                    Cemento
                  </Button>
                  <Button
                    variant={visibleMaterials.aditivo ? "default" : "outline"}
                    size="sm"
                    className={visibleMaterials.aditivo ? "bg-emerald-500 hover:bg-emerald-600" : ""}
                    onClick={() => setVisibleMaterials(prev => ({ ...prev, aditivo: !prev.aditivo }))}
                  >
                    Aditivo
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
                      {visibleMaterials.arena && (
                        <Line type="monotone" dataKey="arena" stroke="#f59e0b" strokeWidth={2} dot={stockDateRange === "7d"} name="Arena" />
                      )}
                      {visibleMaterials.piedra && (
                        <Line type="monotone" dataKey="piedra" stroke="#6366f1" strokeWidth={2} dot={stockDateRange === "7d"} name="Piedra" />
                      )}
                      {visibleMaterials.cemento && (
                        <Line type="monotone" dataKey="cemento" stroke="#94a3b8" strokeWidth={2} dot={stockDateRange === "7d"} name="Cemento" />
                      )}
                      {visibleMaterials.aditivo && (
                        <Line type="monotone" dataKey="aditivo" stroke="#10b981" strokeWidth={2} dot={stockDateRange === "7d"} name="Aditivo" />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Tabla de planificación */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Planificacion de Compras</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Material</TableHead>
                      <TableHead className="text-right">Stock Actual</TableHead>
                      <TableHead className="text-right">Consumo/Dia</TableHead>
                      <TableHead className="text-right">Dias de Stock</TableHead>
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
                          <TableCell>{row.exhaustionDate ? new Date(row.exhaustionDate + "T12:00:00").toLocaleDateString("es-AR") : "-"}</TableCell>
                          <TableCell className={isUrgent ? "text-red-600 font-bold" : ""}>
                            {row.suggestedOrderDate ? new Date(row.suggestedOrderDate + "T12:00:00").toLocaleDateString("es-AR") : "-"}
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
                  Ver analisis completo de stock
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

          {/* MATERIALES - Vista unificada agrupada por categoria */}
          <TabsContent value="materiales" className="space-y-4">
            <div className="flex justify-between items-center flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-semibold">Proveedores y Fletes por Material</h2>
                <Select value={supplierPlantFilter} onValueChange={setSupplierPlantFilter}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Filtrar por planta" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las plantas</SelectItem>
                    <SelectItem value="silke">Silke</SelectItem>
                    <SelectItem value="villa_rosa">Villa Rosa</SelectItem>
                    <SelectItem value="ranchos">Ranchos</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                {/* Dialog Proveedor */}
                <Dialog open={showSupplierDialog} onOpenChange={setShowSupplierDialog}>
                  <DialogTrigger asChild>
                    <Button variant="outline" onClick={() => {
                      setEditingSupplier(null)
                      const defaultLineType = selectedPlant === "ranchos" ? "adoquines" : "ambos"
                      const defaultPlant = selectedPlant === "villa-rosa" ? "villa_rosa" : selectedPlant
                      setSupplierForm({ name: "", material_type: "", plant: defaultPlant, line_type: defaultLineType, density: "", unit: "kg" })
                    }}>
                      <Building2 className="w-4 h-4 mr-2" />
                      Agregar Proveedor
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{editingSupplier ? "Editar Proveedor" : "Nuevo Proveedor"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div>
                        <Label>Nombre del Proveedor</Label>
                        <Input
                          value={supplierForm.name}
                          onChange={(e) => setSupplierForm(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="Ej: Piatti, Cementos Avellaneda"
                        />
                      </div>
                      <div>
                        <Label>Material</Label>
                        <Input
                          value={supplierForm.material_type}
                          onChange={(e) => setSupplierForm(prev => ({ ...prev, material_type: e.target.value }))}
                          placeholder="Ej: Piedra 010, CPC-40, Arena Especial"
                        />
                      </div>
                      <div>
                        <Label>Planta</Label>
                        <Select value={supplierForm.plant} onValueChange={(value) => setSupplierForm(prev => ({ ...prev, plant: value }))}>
                          <SelectTrigger><SelectValue placeholder="Seleccionar planta" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="silke">Silke</SelectItem>
                            <SelectItem value="villa_rosa">Villa Rosa</SelectItem>
                            <SelectItem value="ranchos">Ranchos</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Linea de Produccion</Label>
                        <Select value={supplierForm.line_type} onValueChange={(value) => setSupplierForm(prev => ({ ...prev, line_type: value }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {getLineTypes(selectedPlant).map(lt => (
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
                
                {/* Dialog Flete */}
                <Dialog open={showCarrierDialog} onOpenChange={setShowCarrierDialog}>
                  <DialogTrigger asChild>
                    <Button variant="outline" onClick={() => {
                      setEditingCarrier(null)
                      setCarrierForm({ name: "", phone: "", license_plate: "", company: "", material_type: "" })
                    }}>
                      <Truck className="w-4 h-4 mr-2" />
                      Agregar Flete
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{editingCarrier ? "Editar Flete" : "Nuevo Flete"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div>
                        <Label>Nombre del Chofer</Label>
                        <Input
                          value={carrierForm.name}
                          onChange={(e) => setCarrierForm(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="Nombre completo"
                        />
                      </div>
                      <div>
                        <Label>Material que transporta</Label>
                        <Select value={carrierForm.material_type} onValueChange={(value) => setCarrierForm(prev => ({ ...prev, material_type: value }))}>
                          <SelectTrigger><SelectValue placeholder="Seleccionar material" /></SelectTrigger>
                          <SelectContent>
                            {[...new Set(suppliers.map(s => s.material_type))].sort().map(mat => (
                              <SelectItem key={mat} value={mat}>{mat}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Telefono</Label>
                          <Input
                            value={carrierForm.phone}
                            onChange={(e) => setCarrierForm(prev => ({ ...prev, phone: e.target.value }))}
                            placeholder="11-1234-5678"
                          />
                        </div>
                        <div>
                          <Label>Patente</Label>
                          <Input
                            value={carrierForm.license_plate}
                            onChange={(e) => setCarrierForm(prev => ({ ...prev, license_plate: e.target.value }))}
                            placeholder="AA123BB"
                          />
                        </div>
                      </div>
                      <div>
                        <Label>Empresa de Transporte</Label>
                        <Input
                          value={carrierForm.company}
                          onChange={(e) => setCarrierForm(prev => ({ ...prev, company: e.target.value }))}
                          placeholder="Nombre de la empresa"
                        />
                      </div>
                      <Button onClick={saveCarrier} className="w-full" disabled={!carrierForm.name}>
                        {editingCarrier ? "Guardar Cambios" : "Agregar Flete"}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            {/* Tabla agrupada por categoria de material */}
            {loadingSuppliers || loadingCarriers ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  Cargando datos...
                </CardContent>
              </Card>
            ) : (
              (() => {
                const plantNames: Record<string, string> = { silke: "Silke", villa_rosa: "Villa Rosa", ranchos: "Ranchos" }
                const categoryOrder = ["Arena", "Piedra", "Cemento", "Otros"]
                
                // Agrupar proveedores por categoria y luego por tipo de material
                const byCategory: Record<string, Record<string, { suppliers: Supplier[], carriers: Carrier[] }>> = {}
                
                suppliers.forEach(s => {
                  const cat = getCategoryForMaterial(s.material_type)
                  if (!byCategory[cat]) byCategory[cat] = {}
                  if (!byCategory[cat][s.material_type]) byCategory[cat][s.material_type] = { suppliers: [], carriers: [] }
                  byCategory[cat][s.material_type].suppliers.push(s)
                })
                
                carriers.forEach(c => {
                  if (c.material_type) {
                    const cat = getCategoryForMaterial(c.material_type)
                    if (!byCategory[cat]) byCategory[cat] = {}
                    if (!byCategory[cat][c.material_type]) byCategory[cat][c.material_type] = { suppliers: [], carriers: [] }
                    byCategory[cat][c.material_type].carriers.push(c)
                  }
                })
                
                return (
                  <div className="space-y-4">
                    {categoryOrder.filter(cat => byCategory[cat]).map(category => (
                      <Card key={category}>
                        <CardHeader className="py-3 bg-muted/50">
                          <CardTitle className="text-base flex items-center gap-2">
                            {category === "Arena" && <Package className="w-4 h-4" />}
                            {category === "Piedra" && <Package className="w-4 h-4" />}
                            {category === "Cemento" && <Package className="w-4 h-4" />}
                            {category}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                          <Table>
                            <TableHeader>
                              <TableRow className="text-xs">
                                <TableHead className="w-[180px]">Tipo</TableHead>
                                <TableHead>Proveedores</TableHead>
                                <TableHead>Fletes</TableHead>
                                <TableHead className="w-[100px] text-right">Acciones</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {Object.entries(byCategory[category]).sort((a, b) => a[0].localeCompare(b[0])).map(([materialType, data]) => (
                                <TableRow key={materialType}>
                                  <TableCell className="font-medium align-top py-3">
                                    <Badge variant="outline" className="text-sm">{materialType}</Badge>
                                  </TableCell>
                                  <TableCell className="align-top py-3">
                                    <div className="flex flex-wrap gap-1">
                                      {data.suppliers.length > 0 ? data.suppliers.map(s => (
                                        <div key={s.id} className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${s.is_active ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-gray-100 border-gray-200 text-gray-400"}`}>
                                          <Building2 className="w-3 h-3" />
                                          {s.name}
                                          <span className="text-[10px] opacity-70">({plantNames[s.plant] || s.plant})</span>
                                          <button onClick={() => openEditSupplier(s)} className="ml-1 hover:text-blue-900"><Pencil className="w-3 h-3" /></button>
                                          <button onClick={() => setDeleteConfirm({ type: "supplier", id: s.id, name: s.name })} className="hover:text-red-600"><Trash2 className="w-3 h-3" /></button>
                                        </div>
                                      )) : <span className="text-xs text-muted-foreground">Sin proveedores</span>}
                                    </div>
                                  </TableCell>
                                  <TableCell className="align-top py-3">
                                    <div className="flex flex-wrap gap-1">
                                      {data.carriers.length > 0 ? data.carriers.map(c => (
                                        <div key={c.id} className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${c.is_active ? "bg-green-50 border-green-200 text-green-700" : "bg-gray-100 border-gray-200 text-gray-400"}`}>
                                          <Truck className="w-3 h-3" />
                                          {c.name}
                                          {c.license_plate && <span className="text-[10px] opacity-70">({c.license_plate})</span>}
                                          <button onClick={() => openEditCarrier(c)} className="ml-1 hover:text-green-900"><Pencil className="w-3 h-3" /></button>
                                          <button onClick={() => setDeleteConfirm({ type: "carrier", id: c.id, name: c.name })} className="hover:text-red-600"><Trash2 className="w-3 h-3" /></button>
                                        </div>
                                      )) : <span className="text-xs text-muted-foreground">Sin fletes</span>}
                                    </div>
                                  </TableCell>
                                  <TableCell className="align-top py-3 text-right">
                                    <Button 
                                      variant="ghost" 
                                      size="sm"
                                      className="h-7 text-xs"
                                      onClick={() => {
                                        setEditingCarrier(null)
                                        setCarrierForm({ name: "", phone: "", license_plate: "", company: "", material_type: materialType })
                                        setShowCarrierDialog(true)
                                      }}
                                    >
                                      <Plus className="w-3 h-3 mr-1" />
                                      Flete
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )
              })()
            )}
          </TabsContent>
        </Tabs>
        
        {/* Delete Confirmation Dialog */}
        {deleteConfirm && (
          <Dialog open={true} onOpenChange={() => setDeleteConfirm(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-red-600">
                  <AlertTriangle className="w-5 h-5" />
                  Confirmar Eliminación
                </DialogTitle>
              </DialogHeader>
              <div className="py-4">
                <p className="text-sm text-muted-foreground mb-4">
                  ¿Estás seguro que querés eliminar <span className="font-semibold text-foreground">{deleteConfirm.name}</span>?
                </p>
                <p className="text-xs text-muted-foreground">
                  Esta acción no se puede deshacer. Si el {deleteConfirm.type === "supplier" ? "proveedor" : "flete"} tiene ingresos asociados, no podrá ser eliminado.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
                  Cancelar
                </Button>
                <Button 
                  variant="destructive" 
                  onClick={() => {
                    if (deleteConfirm.type === "supplier") {
                      deleteSupplier(deleteConfirm.id)
                    } else {
                      deleteCarrier(deleteConfirm.id)
                    }
                  }}
                >
                  Eliminar
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </main>
    </div>
  )
}

export default function MateriaPrimaPage() {
  return (
    <Suspense 
      fallback={
        <div className="min-h-screen bg-background">
          <Navigation />
          <main className="container mx-auto p-6">
            <div className="text-center py-12">
              <p className="text-muted-foreground">Cargando...</p>
            </div>
          </main>
        </div>
      }
    >
      <MateriaPrimaContent />
    </Suspense>
  )
}
