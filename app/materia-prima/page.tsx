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
import { Plus, Pencil, Trash2, Truck, Building2, Package, ClipboardList } from "lucide-react"
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
  truck_plate: string | null
  company: string | null
  is_active: boolean
  created_at: string
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
  const [activeTab, setActiveTab] = useState(tabParam || "resumen")
  
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
    truck_plate: "",
    company: ""
  })

  // Load suppliers
  useEffect(() => {
    loadSuppliers()
  }, [])

  // Load carriers
  useEffect(() => {
    loadCarriers()
  }, [])

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
      truck_plate: carrierForm.truck_plate || null,
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
    setCarrierForm({ name: "", phone: "", truck_plate: "", company: "" })
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
      truck_plate: carrier.truck_plate || "",
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
          <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:inline-grid">
            <TabsTrigger value="resumen" className="gap-2">
              <Package className="w-4 h-4" />
              <span className="hidden sm:inline">Resumen</span>
            </TabsTrigger>
            <TabsTrigger value="ingreso" className="gap-2">
              <ClipboardList className="w-4 h-4" />
              <span className="hidden sm:inline">Ingreso</span>
            </TabsTrigger>
            <TabsTrigger value="stock" className="gap-2">
              <Package className="w-4 h-4" />
              <span className="hidden sm:inline">Stock</span>
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

          {/* RESUMEN */}
          <TabsContent value="resumen" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Proveedores Activos</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">{activeSuppliers.length}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {activeSuppliers.filter(s => s.material_type === "Arena").length} arena, {" "}
                    {activeSuppliers.filter(s => s.material_type === "Piedra").length} piedra, {" "}
                    {activeSuppliers.filter(s => s.material_type === "Cemento").length} cemento
                  </p>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Transportistas Activos</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">{activeCarriers.length}</p>
                  <p className="text-xs text-muted-foreground mt-1">Choferes registrados</p>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Accesos Rápidos</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Link href="/materia-prima/ingreso">
                    <Button variant="outline" size="sm" className="w-full justify-start">
                      <ClipboardList className="w-4 h-4 mr-2" />
                      Registrar Ingreso
                    </Button>
                  </Link>
                  <Link href="/materia-prima/stock">
                    <Button variant="outline" size="sm" className="w-full justify-start">
                      <Package className="w-4 h-4 mr-2" />
                      Ver Stock
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            </div>

            {/* Lista rápida de proveedores por tipo */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {["Arena", "Piedra", "Cemento"].map(tipo => (
                <Card key={tipo}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{tipo}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {activeSuppliers
                        .filter(s => s.material_type === tipo)
                        .slice(0, 5)
                        .map(s => (
                          <div key={s.id} className="flex justify-between items-center text-sm">
                            <span>{s.product_detail || s.name}</span>
                            <Badge variant="outline" className="text-xs">{s.name}</Badge>
                          </div>
                        ))}
                      {activeSuppliers.filter(s => s.material_type === tipo).length === 0 && (
                        <p className="text-sm text-muted-foreground">Sin proveedores</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

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

          {/* STOCK - Redirect to existing page */}
          <TabsContent value="stock">
            <Card>
              <CardContent className="py-8 text-center">
                <Package className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">Control de Stock</h3>
                <p className="text-muted-foreground mb-4">Consultá el stock actual de materias primas</p>
                <Link href="/materia-prima/stock">
                  <Button>Ir a Control de Stock</Button>
                </Link>
              </CardContent>
            </Card>
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
                    setCarrierForm({ name: "", phone: "", truck_plate: "", company: "" })
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
                        value={carrierForm.truck_plate}
                        onChange={(e) => setCarrierForm(prev => ({ ...prev, truck_plate: e.target.value }))}
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
                          <TableCell>{carrier.truck_plate || "-"}</TableCell>
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
