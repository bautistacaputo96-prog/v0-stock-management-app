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
import { Plus, Fuel, Truck, Settings, TrendingUp } from "lucide-react"

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
  notes: string | null
  equipment?: Equipment
}

interface CombustibleModuleProps {
  plant: string
}

const FUEL_TYPES = ["Gasoil", "Nafta", "GNC"]
const EQUIPMENT_TYPES = ["Pala Cargadora", "Autoelevador", "Camión", "Camioneta", "Otro"]

export function CombustibleModule({ plant }: CombustibleModuleProps) {
  const [equipment, setEquipment] = useState<Equipment[]>([])
  const [fuelRecords, setFuelRecords] = useState<FuelRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [activeSubTab, setActiveSubTab] = useState("registros")
  
  // Dialogs
  const [showAddRecord, setShowAddRecord] = useState(false)
  const [showAddEquipment, setShowAddEquipment] = useState(false)
  
  // Form states
  const [newRecord, setNewRecord] = useState({
    equipment_id: "",
    record_date: new Date().toISOString().split("T")[0],
    liters: 0,
    cost_per_liter: 0,
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
    } catch (error) {
      console.error("Error loading data:", error)
    } finally {
      setLoading(false)
    }
  }

  async function handleAddRecord(e: React.FormEvent) {
    e.preventDefault()
    try {
      const totalCost = newRecord.liters * newRecord.cost_per_liter

      const { error } = await supabase
        .from("maintenance_fuel_records")
        .insert({
          equipment_id: newRecord.equipment_id,
          record_date: newRecord.record_date,
          liters: newRecord.liters,
          cost_per_liter: newRecord.cost_per_liter || null,
          total_cost: totalCost || null,
          odometer_reading: newRecord.odometer_reading ? parseFloat(newRecord.odometer_reading) : null,
          hours_reading: newRecord.hours_reading ? parseFloat(newRecord.hours_reading) : null,
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
        cost_per_liter: 0,
        odometer_reading: "",
        hours_reading: "",
        notes: ""
      })
      loadData()
    } catch (error) {
      console.error("Error adding record:", error)
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
    }
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
                        onValueChange={(value) => setNewRecord({ ...newRecord, equipment_id: value })}
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
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
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
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cost">Precio por Litro</Label>
                      <Input
                        id="cost"
                        type="number"
                        step="0.01"
                        min="0"
                        value={newRecord.cost_per_liter || ""}
                        onChange={(e) => setNewRecord({ ...newRecord, cost_per_liter: parseFloat(e.target.value) || 0 })}
                        placeholder="$/L"
                      />
                    </div>
                  </div>
                  {newRecord.liters > 0 && newRecord.cost_per_liter > 0 && (
                    <div className="bg-muted p-3 rounded-lg text-center">
                      <p className="text-sm text-muted-foreground">Costo Total</p>
                      <p className="text-xl font-bold">${(newRecord.liters * newRecord.cost_per_liter).toLocaleString("es-AR")}</p>
                    </div>
                  )}
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
                    <TableHead className="text-center">Litros</TableHead>
                    <TableHead className="text-center">$/L</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-center">Odóm./Horím.</TableHead>
                    <TableHead>Notas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fuelRecords.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
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
                        <TableCell className="text-center font-medium">
                          {record.liters.toFixed(1)} L
                        </TableCell>
                        <TableCell className="text-center text-muted-foreground">
                          {record.cost_per_liter ? `$${record.cost_per_liter.toFixed(2)}` : "-"}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {record.total_cost ? `$${record.total_cost.toLocaleString("es-AR")}` : "-"}
                        </TableCell>
                        <TableCell className="text-center text-xs text-muted-foreground">
                          {record.odometer_reading ? `${record.odometer_reading} km` : ""}
                          {record.odometer_reading && record.hours_reading ? " / " : ""}
                          {record.hours_reading ? `${record.hours_reading} hs` : ""}
                          {!record.odometer_reading && !record.hours_reading ? "-" : ""}
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-[150px] truncate">
                          {record.notes || "-"}
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
                          <p className="text-sm text-muted-foreground">{eq.equipment_type} • {eq.recordCount} cargas</p>
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
              <Dialog open={showAddEquipment} onOpenChange={setShowAddEquipment}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Agregar Equipo
                  </Button>
                </DialogTrigger>
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
                        placeholder="Ej: Pala CAT 1"
                        required
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="eq_type">Tipo *</Label>
                        <Select
                          value={newEquipment.equipment_type}
                          onValueChange={(value) => setNewEquipment({ ...newEquipment, equipment_type: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar" />
                          </SelectTrigger>
                          <SelectContent>
                            {EQUIPMENT_TYPES.map(type => (
                              <SelectItem key={type} value={type}>
                                {type}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="fuel_type">Combustible *</Label>
                        <Select
                          value={newEquipment.fuel_type}
                          onValueChange={(value) => setNewEquipment({ ...newEquipment, fuel_type: value })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FUEL_TYPES.map(type => (
                              <SelectItem key={type} value={type}>
                                {type}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="plate">Patente</Label>
                      <Input
                        id="plate"
                        value={newEquipment.plate_number}
                        onChange={(e) => setNewEquipment({ ...newEquipment, plate_number: e.target.value })}
                        placeholder="ABC 123"
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
            </CardHeader>
            <CardContent>
              {equipment.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">
                  No hay equipos registrados
                </p>
              ) : (
                <div className="space-y-2">
                  {equipment.map(eq => (
                    <div key={eq.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <Truck className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="font-medium">{eq.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {eq.equipment_type} • {eq.fuel_type}
                            {eq.plate_number && ` • ${eq.plate_number}`}
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline">{eq.fuel_type}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
