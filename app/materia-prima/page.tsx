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
    company: ""
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
    
    const dataToSave = {
      name: carrierForm.name,
      phone: carrierForm.phone || null,
      license_plate: carrierForm.license_plate || null,
      company: carrierForm.company || null,
      is_active: true,
      plant: selectedPlant
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

        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
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

          {/* PROVEEDORES */}
          <TabsContent value="proveedores" className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-semibold">Proveedores de Materia Prima</h2>
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
              <Dialog open={showSupplierDialog} onOpenChange={setShowSupplierDialog}>
                <DialogTrigger asChild>
                  <Button onClick={() => {
                    setEditingSupplier(null)
                    const defaultLineType = selectedPlant === "ranchos" ? "adoquines" : "ambos"
                    const defaultPlant = selectedPlant === "villa-rosa" ? "villa_rosa" : selectedPlant
                    setSupplierForm({ name: "", material_type: "", plant: defaultPlant, line_type: defaultLineType, density: "", unit: "kg" })
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
                        placeholder="Ej: Piedra 06, Piedra 010, CPC-40, Arena Especial"
                      />
                      <p className="text-xs text-muted-foreground mt-1">Nombre completo del material que provee</p>
                    </div>
                    <div>
                      <Label>Planta</Label>
                      <Select
                        value={supplierForm.plant}
                        onValueChange={(value) => setSupplierForm(prev => ({ ...prev, plant: value }))}
                      >
                        <SelectTrigger>
  <SelectValue placeholder="Seleccionar planta" />
  </SelectTrigger>
  <SelectContent>
  <SelectItem value="silke">Silke</SelectItem>
  <SelectItem value="villa_rosa">Villa Rosa</SelectItem>
  <SelectItem value="ranchos">Ranchos</SelectItem>
  </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Linea de Produccion</Label>
                      <Select
                        value={supplierForm.line_type}
                        onValueChange={(value) => setSupplierForm(prev => ({ ...prev, line_type: value }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {getLineTypes(selectedPlant).map(lt => (
                            <SelectItem key={lt.value} value={lt.value}>{lt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    {supplierForm.material_type.toLowerCase().includes("aditivo") && (
                      <>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label>Densidad (kg/L)</Label>
                            <Input
                              type="number"
                              step="0.01"
                              value={supplierForm.density}
                              onChange={(e) => setSupplierForm(prev => ({ ...prev, density: e.target.value }))}
                              placeholder="Ej: 1.045"
                            />
                            <p className="text-xs text-muted-foreground mt-1">Segun ficha tecnica</p>
                          </div>
                          <div>
                            <Label>Unidad de medida</Label>
                            <Select
                              value={supplierForm.unit}
                              onValueChange={(value) => setSupplierForm(prev => ({ ...prev, unit: value }))}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="kg">Kilogramos (kg)</SelectItem>
                                <SelectItem value="lts">Litros (lts)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </>
                    )}
                    
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
                      <TableHead>Material</TableHead>
                      <TableHead>Planta</TableHead>
                      <TableHead>Linea</TableHead>
                      <TableHead>Densidad</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingSuppliers ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          Cargando proveedores...
                        </TableCell>
                      </TableRow>
                    ) : suppliers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          No hay proveedores registrados
                        </TableCell>
                      </TableRow>
                    ) : (
                      // Agrupar por planta y luego por proveedor
                      (() => {
  const plantOrder = ["silke", "villa_rosa", "ranchos"]
  const plantNames: Record<string, string> = {
  silke: "Silke",
  villa_rosa: "Villa Rosa",
  ranchos: "Ranchos"
  }
                        
                        // Agrupar proveedores por planta
                        const byPlant = suppliers.reduce((acc, s) => {
                          const plant = s.plant || "otros"
                          if (!acc[plant]) acc[plant] = []
                          acc[plant].push(s)
                          return acc
                        }, {} as Record<string, Supplier[]>)
                        
                        // Ordenar cada grupo por nombre de proveedor
                        Object.keys(byPlant).forEach(plant => {
                          byPlant[plant].sort((a, b) => a.name.localeCompare(b.name))
                        })
                        
                        return plantOrder.filter(p => byPlant[p]?.length > 0).map(plant => (
                          <React.Fragment key={plant}>
                            {/* Header de planta */}
                            <TableRow className="bg-muted/50">
                              <TableCell colSpan={7} className="font-semibold text-sm py-2">
                                {plantNames[plant] || plant}
                                <span className="ml-2 text-muted-foreground font-normal">
                                  ({byPlant[plant].length} proveedores)
                                </span>
                              </TableCell>
                            </TableRow>
                            {/* Proveedores de esta planta */}
                            {byPlant[plant].map(supplier => (
                              <TableRow key={supplier.id} className={!supplier.is_active ? "opacity-50" : ""}>
                                <TableCell className="font-medium pl-6">{supplier.name}</TableCell>
                                <TableCell>
                                  <Badge variant="outline">{supplier.material_type}</Badge>
                                </TableCell>
                                <TableCell>
                                  <Badge variant="secondary">{plantNames[supplier.plant] || supplier.plant}</Badge>
                                </TableCell>
                                <TableCell>
                                  {supplier.line_type === "canos" && "Canos"}
                                  {supplier.line_type === "bloques" && "Bloques"}
                                  {supplier.line_type === "ambos" && "Ambos"}
                                  {supplier.line_type === "adoquines" && "Adoquines"}
                                  {!supplier.line_type && "-"}
                                </TableCell>
                                <TableCell>
                                  {supplier.density ? `${supplier.density} kg/L` : "-"}
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
                                  <Button variant="ghost" size="sm" onClick={() => toggleSupplierActive(supplier)}>
                                    {supplier.is_active ? <Ban className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                                  </Button>
                                  <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => setDeleteConfirm({ type: "supplier", id: supplier.id, name: supplier.name })}>
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </React.Fragment>
                        ))
                      })()
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
                    <div>
                      <Label>Nombre del Chofer</Label>
                      <Input
                        value={carrierForm.name}
                        onChange={(e) => setCarrierForm(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Nombre completo"
                      />
                    </div>
                    <div>
                      <Label>Telefono (opcional)</Label>
                      <Input
                        value={carrierForm.phone}
                        onChange={(e) => setCarrierForm(prev => ({ ...prev, phone: e.target.value }))}
                        placeholder="Ej: 11-1234-5678"
                      />
                    </div>
                    <div>
                      <Label>Patente del Camion (opcional)</Label>
                      <Input
                        value={carrierForm.license_plate}
                        onChange={(e) => setCarrierForm(prev => ({ ...prev, license_plate: e.target.value }))}
                        placeholder="Ej: AA123BB"
                      />
                    </div>
                    <div>
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
                      <TableHead>Telefono</TableHead>
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
                          Cargando choferes...
                        </TableCell>
                      </TableRow>
                    ) : carriers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          No hay choferes registrados
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
                            <Button variant="ghost" size="sm" onClick={() => toggleCarrierActive(carrier)}>
                              {carrier.is_active ? <Ban className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                            </Button>
                            <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => setDeleteConfirm({ type: "carrier", id: carrier.id, name: carrier.name })}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
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
