"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Plus, Fuel, Truck, Settings, TrendingUp, Edit2, Trash2, AlertTriangle, DollarSign } from "lucide-react"
import { format } from "date-fns"
import { es } from "date-fns/locale"

interface Equipment {
  id: string
  name: string
  equipment_type: string
  plate_number: string | null
  fuel_type: string
  plant: string
}

interface FuelRecord {
  id: string
  equipment_id: string
  record_date: string
  liters: number
  cost_per_liter: number | null
  total_cost: number | null
  odometer_reading: number | null
  hours_reading: number | null
  horometer_reading: number | null
  responsible_name: string | null
  fuel_type: string | null
  notes: string | null
  equipment?: Equipment
}

interface FuelPrice {
  id: string
  plant: string
  fuel_type: string
  price_per_liter: number
  updated_at: string
}

interface CombustibleModuleProps {
  plant: string
}

const FUEL_TYPES = ["Gasoil", "Nafta Super", "Nafta Premium", "GNC"]
const EQUIPMENT_TYPES = ["Pala Cargadora", "Autoelevador", "Camión", "Camioneta", "Grupo Electrógeno", "Compresor", "Otro"]

export function CombustibleModule({ plant }: CombustibleModuleProps) {
  const [equipment, setEquipment] = useState<Equipment[]>([])
  const [fuelRecords, setFuelRecords] = useState<FuelRecord[]>([])
  const [fuelPrices, setFuelPrices] = useState<FuelPrice[]>([])
  const [loading, setLoading] = useState(true)
  const [activeSubTab, setActiveSubTab] = useState("registros")
  
  // Dialogs
  const [showAddRecord, setShowAddRecord] = useState(false)
  const [showAddEquipment, setShowAddEquipment] = useState(false)
  const [showEditEquipment, setShowEditEquipment] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showPricesDialog, setShowPricesDialog] = useState(false)
  const [equipmentToDelete, setEquipmentToDelete] = useState<Equipment | null>(null)
  
  // Form states
  const [newRecord, setNewRecord] = useState({
    equipment_id: "",
    record_date: new Date().toISOString().split("T")[0],
    liters: 0,
    responsible_name: "",
    fuel_type: "Gasoil",
    odometer_reading: "",
    hours_reading: "",
    notes: ""
  })
  
  const [newEquipment, setNewEquipment] = useState({
    name: "",
    equipment_type: "",
    plate_number: "",
    fuel_type: "Gasoil"
  })

  const [editEquipmentData, setEditEquipmentData] = useState({
    id: "",
    name: "",
    equipment_type: "",
    plate_number: "",
    fuel_type: "Gasoil"
  })

  const [editingPrices, setEditingPrices] = useState<Record<string, string>>({})

  const supabase = createClient()

  useEffect(() => {
    loadData()
  }, [plant])

  async function loadData() {
    setLoading(true)
    try {
      // Load equipment for current plant
      const { data: equipmentData } = await supabase
        .from("maintenance_fuel_equipment")
        .select("*")
        .eq("plant", plant)
        .eq("is_active", true)
        .order("name")
      setEquipment(equipmentData || [])

      // Load fuel records with equipment
      const { data: recordsData } = await supabase
        .from("maintenance_fuel_records")
        .select(`
          *,
          equipment:maintenance_fuel_equipment(*)
        `)
        .eq("plant", plant)
        .order("record_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(100)
      setFuelRecords(recordsData || [])

      // Load fuel prices
      const { data: pricesData } = await supabase
        .from("maintenance_fuel_prices")
        .select("*")
        .eq("plant", plant)
      
      if (pricesData) {
        setFuelPrices(pricesData)
        const prices: Record<string, string> = {}
        pricesData.forEach(p => {
          prices[p.fuel_type] = p.price_per_liter.toString()
        })
        setEditingPrices(prices)
      }
    } catch (error) {
      console.error("Error loading data:", error)
    } finally {
      setLoading(false)
    }
  }

  async function handleAddRecord(e: React.FormEvent) {
    e.preventDefault()
    
    if (!newRecord.responsible_name.trim()) {
      alert("Ingrese el nombre del responsable")
      return
    }

    try {
      // Get current fuel price
      const currentPrice = fuelPrices.find(p => p.fuel_type === newRecord.fuel_type)
      const costPerLiter = currentPrice?.price_per_liter || 0
      const totalCost = newRecord.liters * costPerLiter

      const { error } = await supabase
        .from("maintenance_fuel_records")
        .insert({
          equipment_id: newRecord.equipment_id,
          record_date: newRecord.record_date,
          liters: newRecord.liters,
          cost_per_liter: costPerLiter || null,
          total_cost: totalCost || null,
          odometer_reading: newRecord.odometer_reading ? parseFloat(newRecord.odometer_reading) : null,
          horometer_reading: newRecord.hours_reading ? parseFloat(newRecord.hours_reading) : null,
          responsible_name: newRecord.responsible_name,
          fuel_type: newRecord.fuel_type,
          notes: newRecord.notes || null,
          plant,
          created_by: sessionStorage.getItem("maintenance_user") || "Sistema"
        })

      if (error) throw error

      setShowAddRecord(false)
      setNewRecord({
        equipment_id: "",
        record_date: new Date().toISOString().split("T")[0],
        liters: 0,
        responsible_name: "",
        fuel_type: "Gasoil",
        odometer_reading: "",
        hours_reading: "",
        notes: ""
      })
      loadData()
    } catch (error) {
      console.error("Error adding record:", error)
      alert("Error al registrar la carga")
    }
  }

  async function handleAddEquipment(e: React.FormEvent) {
    e.preventDefault()
    try {
      const { error } = await supabase
        .from("maintenance_fuel_equipment")
        .insert({
          ...newEquipment,
          plant,
          plate_number: newEquipment.plate_number || null
        })

      if (error) throw error

      setShowAddEquipment(false)
      setNewEquipment({
        name: "",
        equipment_type: "",
        plate_number: "",
        fuel_type: "Gasoil"
      })
      loadData()
    } catch (error) {
      console.error("Error adding equipment:", error)
      alert("Error al agregar equipo")
    }
  }

  async function handleUpdateEquipment(e: React.FormEvent) {
    e.preventDefault()
    try {
      const { error } = await supabase
        .from("maintenance_fuel_equipment")
        .update({
          name: editEquipmentData.name,
          equipment_type: editEquipmentData.equipment_type,
          plate_number: editEquipmentData.plate_number || null,
          fuel_type: editEquipmentData.fuel_type
        })
        .eq("id", editEquipmentData.id)

      if (error) throw error

      setShowEditEquipment(false)
      loadData()
    } catch (error) {
      console.error("Error updating equipment:", error)
      alert("Error al actualizar equipo")
    }
  }

  async function handleDeleteEquipment() {
    if (!equipmentToDelete) return
    
    try {
      const { error } = await supabase
        .from("maintenance_fuel_equipment")
        .update({ is_active: false })
        .eq("id", equipmentToDelete.id)

      if (error) throw error

      setShowDeleteConfirm(false)
      setEquipmentToDelete(null)
      loadData()
    } catch (error) {
      console.error("Error deleting equipment:", error)
      alert("Error al eliminar equipo")
    }
  }

  async function handleSaveFuelPrice(fuelType: string) {
    const price = parseFloat(editingPrices[fuelType] || "0")
    if (isNaN(price) || price <= 0) {
      alert("Ingrese un precio válido")
      return
    }

    const existingPrice = fuelPrices.find(p => p.fuel_type === fuelType)

    try {
      if (existingPrice) {
        const { error } = await supabase
          .from("maintenance_fuel_prices")
          .update({ price_per_liter: price, updated_at: new Date().toISOString() })
          .eq("id", existingPrice.id)
        
        if (error) throw error
      } else {
        const { error } = await supabase
          .from("maintenance_fuel_prices")
          .insert({
            plant,
            fuel_type: fuelType,
            price_per_liter: price
          })
        
        if (error) throw error
      }

      loadData()
    } catch (error) {
      console.error("Error saving price:", error)
      alert("Error al guardar precio")
    }
  }

  function openEditEquipment(eq: Equipment) {
    setEditEquipmentData({
      id: eq.id,
      name: eq.name,
      equipment_type: eq.equipment_type,
      plate_number: eq.plate_number || "",
      fuel_type: eq.fuel_type || "Gasoil"
    })
    setShowEditEquipment(true)
  }

  function openDeleteConfirm(eq: Equipment) {
    setEquipmentToDelete(eq)
    setShowDeleteConfirm(true)
  }

  // Stats
  const thisMonthRecords = fuelRecords.filter(r => {
    const recordDate = new Date(r.record_date)
    const now = new Date()
    return recordDate.getMonth() === now.getMonth() && recordDate.getFullYear() === now.getFullYear()
  })
  
  const totalLitersThisMonth = thisMonthRecords.reduce((sum, r) => sum + r.liters, 0)
  const totalCostThisMonth = thisMonthRecords.reduce((sum, r) => sum + (r.total_cost || 0), 0)
  
  // By equipment this month
  const byEquipment = equipment.map(eq => {
    const records = thisMonthRecords.filter(r => r.equipment_id === eq.id)
    return {
      ...eq,
      totalLiters: records.reduce((sum, r) => sum + r.liters, 0),
      totalCost: records.reduce((sum, r) => sum + (r.total_cost || 0), 0),
      recordCount: records.length
    }
  }).filter(eq => eq.totalLiters > 0)

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Cargando datos de combustible...
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header with Prices button */}
      <div className="flex justify-end">
        <Button variant="outline" onClick={() => setShowPricesDialog(true)} className="gap-2">
          <DollarSign className="h-4 w-4" />
          Precios Combustible
        </Button>
      </div>

      <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
        <TabsList>
          <TabsTrigger value="registros">Registros</TabsTrigger>
          <TabsTrigger value="resumen">Resumen Mensual</TabsTrigger>
          <TabsTrigger value="equipos">
            <Settings className="h-4 w-4 mr-1" />
            Equipos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="registros" className="space-y-4">
          {/* Stats cards */}
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Litros Este Mes</p>
                    <p className="text-2xl font-bold">{totalLitersThisMonth.toFixed(1)} L</p>
                  </div>
                  <Fuel className="h-8 w-8 text-amber-500" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Costo Este Mes</p>
                    <p className="text-2xl font-bold">${totalCostThisMonth.toLocaleString("es-AR")}</p>
                  </div>
                  <TrendingUp className="h-8 w-8 text-green-500" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Add record button */}
          <div className="flex justify-end">
            <Dialog open={showAddRecord} onOpenChange={setShowAddRecord}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Registrar Carga
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Registrar Carga de Combustible</DialogTitle>
                  <DialogDescription>
                    Ingrese los datos de la carga de combustible
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleAddRecord} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="record_date">Fecha *</Label>
                      <Input
                        id="record_date"
                        type="date"
                        value={newRecord.record_date}
                        onChange={(e) => setNewRecord({ ...newRecord, record_date: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="equipment">Equipo *</Label>
                      <Select
                        value={newRecord.equipment_id}
                        onValueChange={(value) => {
                          if (value === "__new__") {
                            setShowAddRecord(false)
                            setShowAddEquipment(true)
                          } else {
                            setNewRecord({ ...newRecord, equipment_id: value })
                          }
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar" />
                        </SelectTrigger>
                        <SelectContent>
                          {equipment.map(eq => (
                            <SelectItem key={eq.id} value={eq.id}>
                              {eq.name} ({eq.equipment_type})
                            </SelectItem>
                          ))}
                          <SelectItem value="__new__" className="text-primary font-medium border-t mt-1 pt-1">
                            <span className="flex items-center gap-2">
                              <Plus className="h-4 w-4" />
                              Agregar nuevo equipo...
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="responsible">Responsable *</Label>
                      <Input
                        id="responsible"
                        value={newRecord.responsible_name}
                        onChange={(e) => setNewRecord({ ...newRecord, responsible_name: e.target.value })}
                        placeholder="Nombre del responsable"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="fuel_type">Tipo Combustible *</Label>
                      <Select
                        value={newRecord.fuel_type}
                        onValueChange={(value) => setNewRecord({ ...newRecord, fuel_type: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FUEL_TYPES.map(ft => (
                            <SelectItem key={ft} value={ft}>{ft}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="liters">Litros *</Label>
                    <Input
                      id="liters"
                      type="number"
                      step="0.1"
                      min="0"
                      value={newRecord.liters || ""}
                      onChange={(e) => setNewRecord({ ...newRecord, liters: parseFloat(e.target.value) || 0 })}
                      required
                    />
                    {newRecord.liters > 0 && newRecord.fuel_type && (
                      <p className="text-sm text-muted-foreground">
                        Precio actual: ${fuelPrices.find(p => p.fuel_type === newRecord.fuel_type)?.price_per_liter?.toFixed(0) || "No configurado"}/L
                        {fuelPrices.find(p => p.fuel_type === newRecord.fuel_type) && (
                          <> - Total estimado: <span className="font-medium text-foreground">${(newRecord.liters * (fuelPrices.find(p => p.fuel_type === newRecord.fuel_type)?.price_per_liter || 0)).toLocaleString('es-AR', { minimumFractionDigits: 0 })}</span></>
                        )}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="odometer">Odómetro (km)</Label>
                      <Input
                        id="odometer"
                        type="number"
                        value={newRecord.odometer_reading}
                        onChange={(e) => setNewRecord({ ...newRecord, odometer_reading: e.target.value })}
                        placeholder="Lectura actual"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="hours">Horómetro (hs)</Label>
                      <Input
                        id="hours"
                        type="number"
                        step="0.1"
                        value={newRecord.hours_reading}
                        onChange={(e) => setNewRecord({ ...newRecord, hours_reading: e.target.value })}
                        placeholder="Horas de uso"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="notes">Notas</Label>
                    <Input
                      id="notes"
                      value={newRecord.notes}
                      onChange={(e) => setNewRecord({ ...newRecord, notes: e.target.value })}
                      placeholder="Observaciones..."
                    />
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setShowAddRecord(false)}>
                      Cancelar
                    </Button>
                    <Button type="submit">Registrar</Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          {/* Records table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Historial de Cargas</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Equipo</TableHead>
                    <TableHead>Responsable</TableHead>
                    <TableHead>Combustible</TableHead>
                    <TableHead className="text-center">Litros</TableHead>
                    <TableHead className="text-center">$/L</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-center">Odóm./Horím.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fuelRecords.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        No hay registros de combustible
                      </TableCell>
                    </TableRow>
                  ) : (
                    fuelRecords.map(record => (
                      <TableRow key={record.id}>
                        <TableCell>
                          {new Date(record.record_date + "T12:00:00").toLocaleDateString("es-AR")}
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{record.equipment?.name}</p>
                            <p className="text-xs text-muted-foreground">{record.equipment?.equipment_type}</p>
                          </div>
                        </TableCell>
                        <TableCell>{record.responsible_name || "-"}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{record.fuel_type || "Gasoil"}</Badge>
                        </TableCell>
                        <TableCell className="text-center font-medium">
                          {record.liters.toFixed(1)} L
                        </TableCell>
                        <TableCell className="text-center text-muted-foreground">
                          {record.cost_per_liter ? `$${record.cost_per_liter.toFixed(0)}` : "-"}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {record.total_cost ? `$${record.total_cost.toLocaleString("es-AR")}` : "-"}
                        </TableCell>
                        <TableCell className="text-center text-xs text-muted-foreground">
                          {record.odometer_reading ? `${record.odometer_reading} km` : ""}
                          {record.odometer_reading && record.horometer_reading ? " / " : ""}
                          {record.horometer_reading ? `${record.horometer_reading} hs` : ""}
                          {!record.odometer_reading && !record.horometer_reading ? "-" : ""}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="resumen">
          <Card>
            <CardHeader>
              <CardTitle>Consumo por Equipo - {new Date().toLocaleDateString("es-AR", { month: "long", year: "numeric" })}</CardTitle>
              <CardDescription>Resumen de consumo de combustible del mes actual</CardDescription>
            </CardHeader>
            <CardContent>
              {byEquipment.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">
                  No hay registros este mes
                </p>
              ) : (
                <div className="space-y-4">
                  {byEquipment.sort((a, b) => b.totalLiters - a.totalLiters).map(eq => (
                    <div key={eq.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center">
                          <Truck className="h-5 w-5 text-amber-600" />
                        </div>
                        <div>
                          <p className="font-medium">{eq.name}</p>
                          <p className="text-sm text-muted-foreground">{eq.equipment_type} - {eq.recordCount} cargas</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold">{eq.totalLiters.toFixed(1)} L</p>
                        {eq.totalCost > 0 && (
                          <p className="text-sm text-muted-foreground">${eq.totalCost.toLocaleString("es-AR")}</p>
                        )}
                      </div>
                    </div>
                  ))}
                  
                  {/* Total */}
                  <div className="flex items-center justify-between p-4 bg-muted rounded-lg font-bold">
                    <span>TOTAL</span>
                    <div className="text-right">
                      <p className="text-lg">{totalLitersThisMonth.toFixed(1)} L</p>
                      {totalCostThisMonth > 0 && (
                        <p className="text-sm">${totalCostThisMonth.toLocaleString("es-AR")}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="equipos">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Equipos</CardTitle>
                <CardDescription>Equipos que consumen combustible</CardDescription>
              </div>
              <Button size="sm" onClick={() => setShowAddEquipment(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Agregar Equipo
              </Button>
            </CardHeader>
            <CardContent>
              {equipment.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">
                  No hay equipos registrados
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Patente</TableHead>
                      <TableHead>Combustible</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {equipment.map(eq => (
                      <TableRow key={eq.id}>
                        <TableCell className="font-medium">{eq.name}</TableCell>
                        <TableCell>{eq.equipment_type}</TableCell>
                        <TableCell>{eq.plate_number || "-"}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{eq.fuel_type || "Gasoil"}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => openEditEquipment(eq)}>
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => openDeleteConfirm(eq)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog: Add Equipment */}
      <Dialog open={showAddEquipment} onOpenChange={setShowAddEquipment}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar Equipo</DialogTitle>
            <DialogDescription>
              Registre un nuevo equipo que consume combustible
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddEquipment} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="eq_name">Nombre *</Label>
              <Input
                id="eq_name"
                value={newEquipment.name}
                onChange={(e) => setNewEquipment({ ...newEquipment, name: e.target.value })}
                placeholder="Ej: Pala CAT 950"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tipo *</Label>
                <Select
                  value={newEquipment.equipment_type}
                  onValueChange={(value) => setNewEquipment({ ...newEquipment, equipment_type: value })}
                  required
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    {EQUIPMENT_TYPES.map(t => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Combustible</Label>
                <Select
                  value={newEquipment.fuel_type}
                  onValueChange={(value) => setNewEquipment({ ...newEquipment, fuel_type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FUEL_TYPES.map(ft => (
                      <SelectItem key={ft} value={ft}>{ft}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="eq_plate">Patente (opcional)</Label>
              <Input
                id="eq_plate"
                value={newEquipment.plate_number}
                onChange={(e) => setNewEquipment({ ...newEquipment, plate_number: e.target.value })}
                placeholder="ABC123"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddEquipment(false)}>
                Cancelar
              </Button>
              <Button type="submit">Agregar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: Edit Equipment */}
      <Dialog open={showEditEquipment} onOpenChange={setShowEditEquipment}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Equipo</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpdateEquipment} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit_eq_name">Nombre *</Label>
              <Input
                id="edit_eq_name"
                value={editEquipmentData.name}
                onChange={(e) => setEditEquipmentData({ ...editEquipmentData, name: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tipo *</Label>
                <Select
                  value={editEquipmentData.equipment_type}
                  onValueChange={(value) => setEditEquipmentData({ ...editEquipmentData, equipment_type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EQUIPMENT_TYPES.map(t => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Combustible</Label>
                <Select
                  value={editEquipmentData.fuel_type}
                  onValueChange={(value) => setEditEquipmentData({ ...editEquipmentData, fuel_type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FUEL_TYPES.map(ft => (
                      <SelectItem key={ft} value={ft}>{ft}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_eq_plate">Patente (opcional)</Label>
              <Input
                id="edit_eq_plate"
                value={editEquipmentData.plate_number}
                onChange={(e) => setEditEquipmentData({ ...editEquipmentData, plate_number: e.target.value })}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowEditEquipment(false)}>
                Cancelar
              </Button>
              <Button type="submit">Guardar Cambios</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: Delete Confirmation */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Confirmar Eliminación
            </DialogTitle>
            <DialogDescription>
              ¿Está seguro que desea eliminar el equipo <strong>{equipmentToDelete?.name}</strong>?
              <br /><br />
              Esta acción no eliminará los registros de carga asociados, pero el equipo ya no estará disponible para nuevas cargas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDeleteEquipment}>
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Fuel Prices */}
      <Dialog open={showPricesDialog} onOpenChange={setShowPricesDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Precios de Combustible
            </DialogTitle>
            <DialogDescription>
              Configure el precio por litro de cada tipo de combustible. Estos precios se aplicarán automáticamente al registrar cargas.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {FUEL_TYPES.map(fuelType => {
              const existingPrice = fuelPrices.find(p => p.fuel_type === fuelType)
              return (
                <div key={fuelType} className="space-y-2">
                  <Label>{fuelType}</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">$</span>
                    <Input
                      type="number"
                      step="0.01"
                      value={editingPrices[fuelType] || ""}
                      onChange={(e) => setEditingPrices({ ...editingPrices, [fuelType]: e.target.value })}
                      placeholder="0.00"
                      className="flex-1"
                    />
                    <span className="text-muted-foreground">/L</span>
                    <Button size="sm" onClick={() => handleSaveFuelPrice(fuelType)}>
                      Guardar
                    </Button>
                  </div>
                  {existingPrice && (
                    <p className="text-xs text-muted-foreground">
                      Última actualización: {format(new Date(existingPrice.updated_at), "dd/MM/yyyy HH:mm", { locale: es })}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
          <DialogFooter>
            <Button onClick={() => setShowPricesDialog(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
