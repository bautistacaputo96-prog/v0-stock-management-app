"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Plus, Search, FileText, Trash2, Eye, Calendar, User, MapPin, Package } from "lucide-react"

interface Section {
  id: number
  name: string
}

interface InventoryItem {
  id: number
  name: string
  code: string | null
  unit: string
  current_stock: number
}

interface ParteDiarioItem {
  id: number
  parte_id: number
  item_id: number
  quantity: number
  comment: string | null
  item?: InventoryItem
}

interface ParteDiario {
  id: number
  parte_date: string
  operator_name: string
  area: string
  general_comment: string | null
  created_at: string
  items?: ParteDiarioItem[]
}

interface ParteDiarioModuleProps {
  plant: string
}

// Areas predefinidas (el usuario puede escribir otras)
const AREAS_PREDEFINIDAS = [
  "Autoelevador",
  "Pala Cargadora",
  "Compresor",
  "Dosificación",
  "Mezcladora",
  "Cinta de carga",
  "Máquina vibradora",
  "Sistema hidráulico",
  "Sistema neumático",
  "Tablero eléctrico",
  "Instalación general",
  "Otro"
]

export function ParteDiarioModule({ plant }: ParteDiarioModuleProps) {
  const [partes, setPartes] = useState<ParteDiario[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [filterDate, setFilterDate] = useState("")
  
  // Dialogs
  const [showAddParte, setShowAddParte] = useState(false)
  const [showViewParte, setShowViewParte] = useState(false)
  const [selectedParte, setSelectedParte] = useState<ParteDiario | null>(null)
  
  // Form states
  const [newParte, setNewParte] = useState({
    parte_date: new Date().toISOString().split("T")[0],
    operator_name: "",
    area: "",
    general_comment: ""
  })
  
  // Items del parte
  const [parteItems, setParteItems] = useState<{ item_id: number; quantity: number; comment: string }[]>([])
  const [showAddItem, setShowAddItem] = useState(false)
  const [newItemEntry, setNewItemEntry] = useState({ item_id: 0, quantity: 1, comment: "" })

  const supabase = createClient()

  useEffect(() => {
    loadData()
  }, [plant])

  async function loadData() {
    setLoading(true)
    try {
      // Load sections
      const { data: sectionsData } = await supabase
        .from("maintenance_sections")
        .select("*")
        .eq("plant", plant)
        .order("name")
      setSections(sectionsData || [])

      // Load inventory items
      const { data: itemsData } = await supabase
        .from("maintenance_inventory")
        .select("id, name, code, unit, current_stock")
        .eq("plant", plant)
        .gt("current_stock", 0)
        .order("name")
      setInventoryItems(itemsData || [])

      // Load partes diarios
      const { data: partesData } = await supabase
        .from("maintenance_parte_diario")
        .select(`
          *,
          section:maintenance_sections(*),
          items:maintenance_parte_diario_items(
            *,
            item:maintenance_inventory(*)
          )
        `)
        .eq("plant", plant)
        .order("parte_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(100)
      setPartes(partesData || [])
    } catch (error) {
      console.error("Error loading data:", error)
    } finally {
      setLoading(false)
    }
  }

  async function handleAddParte(e: React.FormEvent) {
    e.preventDefault()
    
    if (parteItems.length === 0) {
      alert("Debe agregar al menos un insumo/repuesto")
      return
    }

    try {
      // Insert parte diario
      const { data: parteData, error: parteError } = await supabase
        .from("maintenance_parte_diario")
        .insert({
          plant,
          parte_date: newParte.parte_date,
          operator_name: newParte.operator_name,
          area: newParte.area,
          section_id: newParte.section_id || null,
          general_comment: newParte.general_comment || null
        })
        .select()
        .single()

      if (parteError) throw parteError

      // Insert items y actualizar stock
      for (const item of parteItems) {
        // Insert parte item
        await supabase
          .from("maintenance_parte_diario_items")
          .insert({
            parte_id: parteData.id,
            item_id: item.item_id,
            quantity: item.quantity,
            comment: item.comment || null
          })

        // Get current stock
        const inventoryItem = inventoryItems.find(i => i.id === item.item_id)
        if (inventoryItem) {
          const newStock = Math.max(0, inventoryItem.current_stock - item.quantity)
          
          // Update stock
          await supabase
            .from("maintenance_inventory")
            .update({ current_stock: newStock })
            .eq("id", item.item_id)

          // Record stock movement
          await supabase
            .from("maintenance_stock_movements")
            .insert({
              item_id: item.item_id,
              movement_type: "salida",
              quantity: item.quantity,
              previous_stock: inventoryItem.current_stock,
              new_stock: newStock,
              reason: `Parte Diario - ${newParte.operator_name} - ${newParte.area}${item.comment ? `: ${item.comment}` : ''}`,
              created_by: sessionStorage.getItem("maintenance_user") || "Sistema"
            })
        }
      }

      // Reset form
      setShowAddParte(false)
      setNewParte({
        parte_date: new Date().toISOString().split("T")[0],
        operator_name: "",
        area: "",
        section_id: "",
        general_comment: ""
      })
      setParteItems([])
      loadData()
    } catch (error) {
      console.error("Error adding parte diario:", error)
      alert("Error al guardar el parte diario")
    }
  }

  function addItemToParte() {
    if (!newItemEntry.item_id || newItemEntry.quantity <= 0) return
    
    // Check stock disponible
    const inventoryItem = inventoryItems.find(i => i.id === newItemEntry.item_id)
    if (inventoryItem) {
      const alreadyUsed = parteItems
        .filter(i => i.item_id === newItemEntry.item_id)
        .reduce((sum, i) => sum + i.quantity, 0)
      
      if (alreadyUsed + newItemEntry.quantity > inventoryItem.current_stock) {
        alert(`Stock insuficiente. Disponible: ${inventoryItem.current_stock - alreadyUsed} ${inventoryItem.unit}`)
        return
      }
    }
    
    // Add item (allow duplicates with different comments)
    setParteItems([...parteItems, { ...newItemEntry }])
    setNewItemEntry({ item_id: "", quantity: 1, comment: "" })
    setShowAddItem(false)
  }

  function removeItemFromParte(index: number) {
    setParteItems(parteItems.filter((_, i) => i !== index))
  }

  // Filter partes
  const filteredPartes = partes.filter(parte => {
    const matchesSearch = 
      parte.operator_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      parte.area.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesDate = !filterDate || parte.parte_date === filterDate
    return matchesSearch && matchesDate
  })

  // Stats
  const todayPartes = partes.filter(p => p.parte_date === new Date().toISOString().split("T")[0]).length
  const weekPartes = partes.filter(p => {
    const parteDate = new Date(p.parte_date)
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)
    return parteDate >= weekAgo
  }).length

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Cargando partes diarios...
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Partes Hoy</p>
                <p className="text-2xl font-bold text-blue-700">{todayPartes}</p>
              </div>
              <Calendar className="h-8 w-8 text-blue-400" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Últimos 7 días</p>
                <p className="text-2xl font-bold text-green-700">{weekPartes}</p>
              </div>
              <FileText className="h-8 w-8 text-green-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and actions */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por operario o área..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="w-[180px]"
            />
            <Dialog open={showAddParte} onOpenChange={setShowAddParte}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Nuevo Parte
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Registrar Parte Diario</DialogTitle>
                  <DialogDescription>
                    Complete los datos del trabajo realizado e insumos utilizados
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleAddParte} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="parte_date">Fecha *</Label>
                      <Input
                        id="parte_date"
                        type="date"
                        value={newParte.parte_date}
                        onChange={(e) => setNewParte({ ...newParte, parte_date: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="operator_name">Nombre del Operario *</Label>
                      <Input
                        id="operator_name"
                        value={newParte.operator_name}
                        onChange={(e) => setNewParte({ ...newParte, operator_name: e.target.value })}
                        placeholder="Nombre completo"
                        required
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="area">Área / Equipo Intervenido *</Label>
                      <Select
                        value={newParte.area}
                        onValueChange={(value) => setNewParte({ ...newParte, area: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar área" />
                        </SelectTrigger>
                        <SelectContent>
                          {AREAS_PREDEFINIDAS.map(area => (
                            <SelectItem key={area} value={area}>
                              {area}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {newParte.area === "Otro" && (
                        <Input
                          placeholder="Especifique el área..."
                          onChange={(e) => setNewParte({ ...newParte, area: e.target.value })}
                          className="mt-2"
                        />
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="section">Sección (opcional)</Label>
                      <Select
                        value={newParte.section_id}
                        onValueChange={(value) => setNewParte({ ...newParte, section_id: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar sección" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">Sin sección</SelectItem>
                          {sections.map(section => (
                            <SelectItem key={section.id} value={section.id}>
                              {section.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  {/* Items/Insumos usados */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-base font-semibold">Insumos/Repuestos Utilizados *</Label>
                      <Dialog open={showAddItem} onOpenChange={setShowAddItem}>
                        <DialogTrigger asChild>
                          <Button type="button" variant="outline" size="sm">
                            <Plus className="h-4 w-4 mr-1" />
                            Agregar Insumo
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Agregar Insumo del Pañol</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <Label>Item del Pañol *</Label>
                              <Select
                                value={newItemEntry.item_id}
                                onValueChange={(value) => setNewItemEntry({ ...newItemEntry, item_id: value })}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Seleccionar item" />
                                </SelectTrigger>
                                <SelectContent>
                                  {inventoryItems.map(item => (
                                    <SelectItem key={item.id} value={item.id}>
                                      {item.name} {item.code ? `(${item.code})` : ''} - Stock: {item.current_stock} {item.unit}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label>Cantidad *</Label>
                              <Input
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={newItemEntry.quantity}
                                onChange={(e) => setNewItemEntry({ ...newItemEntry, quantity: parseFloat(e.target.value) || 0 })}
                              />
                              {newItemEntry.item_id && (
                                <p className="text-xs text-muted-foreground">
                                  Unidad: {inventoryItems.find(i => i.id === newItemEntry.item_id)?.unit}
                                </p>
                              )}
                            </div>
                            <div className="space-y-2">
                              <Label>Comentario (opcional)</Label>
                              <Input
                                value={newItemEntry.comment}
                                onChange={(e) => setNewItemEntry({ ...newItemEntry, comment: e.target.value })}
                                placeholder="Ej: Cambio de filtro, reparación, etc."
                              />
                            </div>
                            <DialogFooter>
                              <Button type="button" variant="outline" onClick={() => setShowAddItem(false)}>
                                Cancelar
                              </Button>
                              <Button type="button" onClick={addItemToParte}>
                                Agregar
                              </Button>
                            </DialogFooter>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                    
                    {parteItems.length > 0 ? (
                      <div className="border rounded-lg overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Item</TableHead>
                              <TableHead className="w-[100px] text-right">Cantidad</TableHead>
                              <TableHead>Comentario</TableHead>
                              <TableHead className="w-[60px]"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {parteItems.map((item, index) => {
                              const invItem = inventoryItems.find(i => i.id === item.item_id)
                              return (
                                <TableRow key={index}>
                                  <TableCell className="font-medium">
                                    {invItem?.name || "Item no encontrado"}
                                    {invItem?.code && (
                                      <span className="text-muted-foreground ml-1">({invItem.code})</span>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {item.quantity} {invItem?.unit}
                                  </TableCell>
                                  <TableCell className="text-muted-foreground text-sm">
                                    {item.comment || "-"}
                                  </TableCell>
                                  <TableCell>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => removeItemFromParte(index)}
                                      className="h-8 w-8 text-destructive hover:text-destructive"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <div className="border rounded-lg p-8 text-center text-muted-foreground bg-muted/30">
                        <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>No hay insumos agregados</p>
                        <p className="text-xs">Use el botón "Agregar Insumo" para añadir items del pañol</p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="general_comment">Comentario General (opcional)</Label>
                    <Textarea
                      id="general_comment"
                      value={newParte.general_comment}
                      onChange={(e) => setNewParte({ ...newParte, general_comment: e.target.value })}
                      placeholder="Descripción general del trabajo realizado..."
                      rows={3}
                    />
                  </div>
                  
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setShowAddParte(false)}>
                      Cancelar
                    </Button>
                    <Button type="submit" disabled={parteItems.length === 0}>
                      Guardar Parte
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      {/* Partes Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Historial de Partes Diarios
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredPartes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No hay partes diarios registrados
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Operario</TableHead>
                    <TableHead>Área</TableHead>
                    <TableHead>Sección</TableHead>
                    <TableHead className="text-center">Items</TableHead>
                    <TableHead className="text-center">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPartes.map((parte) => (
                    <TableRow key={parte.id}>
                      <TableCell className="font-medium">
                        {new Date(parte.parte_date + 'T12:00:00').toLocaleDateString('es-AR')}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <User className="h-3.5 w-3.5 text-muted-foreground" />
                          {parte.operator_name}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                          {parte.area}
                        </div>
                      </TableCell>
                      <TableCell>
                        {parte.section?.name || "-"}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">
                          {parte.items?.length || 0} items
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setSelectedParte(parte)
                            setShowViewParte(true)
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* View Parte Dialog */}
      <Dialog open={showViewParte} onOpenChange={setShowViewParte}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalle del Parte Diario</DialogTitle>
          </DialogHeader>
          {selectedParte && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg">
                <div>
                  <p className="text-sm text-muted-foreground">Fecha</p>
                  <p className="font-medium">
                    {new Date(selectedParte.parte_date + 'T12:00:00').toLocaleDateString('es-AR', { 
                      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
                    })}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Operario</p>
                  <p className="font-medium">{selectedParte.operator_name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Área / Equipo</p>
                  <p className="font-medium">{selectedParte.area}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Sección</p>
                  <p className="font-medium">{selectedParte.section?.name || "-"}</p>
                </div>
              </div>
              
              {selectedParte.general_comment && (
                <div className="p-4 bg-blue-50 rounded-lg">
                  <p className="text-sm text-muted-foreground mb-1">Comentario General</p>
                  <p>{selectedParte.general_comment}</p>
                </div>
              )}

              <div>
                <h4 className="font-semibold mb-2 flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Insumos Utilizados
                </h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Cantidad</TableHead>
                      <TableHead>Comentario</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedParte.items?.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          {item.item?.name || "Item eliminado"}
                          {item.item?.code && (
                            <span className="text-muted-foreground ml-1">({item.item.code})</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.quantity} {item.item?.unit}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {item.comment || "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
