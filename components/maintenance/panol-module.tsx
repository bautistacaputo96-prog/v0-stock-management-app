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
import { Plus, Search, Package, AlertTriangle, Edit, Trash2, Settings, ArrowUpCircle, ArrowDownCircle } from "lucide-react"

interface Section {
  id: string
  name: string
  plant: string
}

interface Category {
  id: string
  name: string
}

interface InventoryItem {
  id: string
  name: string
  code: string | null
  section_id: string
  category_id: string
  unit: string
  current_stock: number
  min_stock: number
  location: string | null
  section?: Section
  category?: Category
}

interface StockMovement {
  id: string
  item_id: string
  movement_type: "entrada" | "salida" | "ajuste"
  quantity: number
  reason: string | null
  created_at: string
  item?: InventoryItem
}

interface PanolModuleProps {
  plant: string
}

export function PanolModule({ plant }: PanolModuleProps) {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [filterSection, setFilterSection] = useState<string>("all")
  const [filterCategory, setFilterCategory] = useState<string>("all")
  const [activeSubTab, setActiveSubTab] = useState("inventario")
  
  // Dialogs
  const [showAddItem, setShowAddItem] = useState(false)
  const [showAddSection, setShowAddSection] = useState(false)
  const [showMovement, setShowMovement] = useState(false)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  
  // Form states
  const [newItem, setNewItem] = useState({
    name: "",
    code: "",
    section_id: "",
    category_id: "",
    unit: "unidad",
    current_stock: 0,
    min_stock: 0,
    location: ""
  })
  const [newSection, setNewSection] = useState("")
  const [movementData, setMovementData] = useState({
    type: "entrada" as "entrada" | "salida" | "ajuste",
    quantity: 0,
    reason: ""
  })

  const supabase = createClient()

  useEffect(() => {
    loadData()
  }, [plant])

  async function loadData() {
    setLoading(true)
    try {
      // Load sections for current plant
      const { data: sectionsData } = await supabase
        .from("maintenance_sections")
        .select("*")
        .eq("plant", plant)
        .order("name")
      setSections(sectionsData || [])

      // Load categories
      const { data: categoriesData } = await supabase
        .from("maintenance_categories")
        .select("*")
        .order("name")
      setCategories(categoriesData || [])

      // Load inventory items with sections and categories
      const { data: itemsData } = await supabase
        .from("maintenance_inventory")
        .select(`
          *,
          section:maintenance_sections(*),
          category:maintenance_categories(*)
        `)
        .eq("plant", plant)
        .order("name")
      setItems(itemsData || [])

      // Load recent movements
      const { data: movementsData } = await supabase
        .from("maintenance_stock_movements")
        .select(`
          *,
          item:maintenance_inventory(*)
        `)
        .order("created_at", { ascending: false })
        .limit(50)
      setMovements(movementsData || [])
    } catch (error) {
      console.error("Error loading data:", error)
    } finally {
      setLoading(false)
    }
  }

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault()
    try {
      const { error } = await supabase
        .from("maintenance_inventory")
        .insert({
          ...newItem,
          plant,
          code: newItem.code || null,
          location: newItem.location || null
        })

      if (error) throw error

      setShowAddItem(false)
      setNewItem({
        name: "",
        code: "",
        section_id: "",
        category_id: "",
        unit: "unidad",
        current_stock: 0,
        min_stock: 0,
        location: ""
      })
      loadData()
    } catch (error) {
      console.error("Error adding item:", error)
    }
  }

  async function handleUpdateItem(e: React.FormEvent) {
    e.preventDefault()
    if (!editingItem) return

    try {
      const { error } = await supabase
        .from("maintenance_inventory")
        .update({
          name: newItem.name,
          code: newItem.code || null,
          section_id: newItem.section_id,
          category_id: newItem.category_id,
          unit: newItem.unit,
          min_stock: newItem.min_stock,
          location: newItem.location || null
        })
        .eq("id", editingItem.id)

      if (error) throw error

      setEditingItem(null)
      setShowAddItem(false)
      loadData()
    } catch (error) {
      console.error("Error updating item:", error)
    }
  }

  async function handleAddSection(e: React.FormEvent) {
    e.preventDefault()
    try {
      const { error } = await supabase
        .from("maintenance_sections")
        .insert({
          name: newSection,
          plant
        })

      if (error) throw error

      setShowAddSection(false)
      setNewSection("")
      loadData()
    } catch (error) {
      console.error("Error adding section:", error)
    }
  }

  async function handleStockMovement(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedItem) return

    try {
      // Calculate new stock
      let newStock = selectedItem.current_stock
      if (movementData.type === "entrada") {
        newStock += movementData.quantity
      } else if (movementData.type === "salida") {
        newStock -= movementData.quantity
      } else {
        newStock = movementData.quantity // Ajuste directo
      }

      // Insert movement
      const { error: movementError } = await supabase
        .from("maintenance_stock_movements")
        .insert({
          item_id: selectedItem.id,
          movement_type: movementData.type,
          quantity: movementData.quantity,
          previous_stock: selectedItem.current_stock,
          new_stock: newStock,
          reason: movementData.reason || null,
          created_by: sessionStorage.getItem("maintenance_user") || "Sistema"
        })

      if (movementError) throw movementError

      // Update stock
      const { error: updateError } = await supabase
        .from("maintenance_inventory")
        .update({ current_stock: newStock })
        .eq("id", selectedItem.id)

      if (updateError) throw updateError

      setShowMovement(false)
      setSelectedItem(null)
      setMovementData({ type: "entrada", quantity: 0, reason: "" })
      loadData()
    } catch (error) {
      console.error("Error processing movement:", error)
    }
  }

  async function handleDeleteItem(item: InventoryItem) {
    if (!confirm(`¿Está seguro de eliminar "${item.name}"?`)) return

    try {
      const { error } = await supabase
        .from("maintenance_inventory")
        .delete()
        .eq("id", item.id)

      if (error) throw error
      loadData()
    } catch (error) {
      console.error("Error deleting item:", error)
    }
  }

  // Filter items
  const filteredItems = items.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.code && item.code.toLowerCase().includes(searchTerm.toLowerCase()))
    const matchesSection = filterSection === "all" || item.section_id === filterSection
    const matchesCategory = filterCategory === "all" || item.category_id === filterCategory
    return matchesSearch && matchesSection && matchesCategory
  })

  // Items with low stock
  const lowStockItems = items.filter(item => item.current_stock <= item.min_stock)

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Cargando inventario...
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
        <TabsList>
          <TabsTrigger value="inventario">Inventario</TabsTrigger>
          <TabsTrigger value="movimientos">Movimientos</TabsTrigger>
          <TabsTrigger value="configuracion">
            <Settings className="h-4 w-4 mr-1" />
            Config
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inventario" className="space-y-4">
          {/* Low stock alert */}
          {lowStockItems.length > 0 && (
            <Card className="border-amber-500 bg-amber-50 dark:bg-amber-950/20">
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4" />
                  {lowStockItems.length} item(s) con stock bajo
                </CardTitle>
              </CardHeader>
              <CardContent className="py-2">
                <div className="flex flex-wrap gap-2">
                  {lowStockItems.map(item => (
                    <Badge key={item.id} variant="outline" className="border-amber-500 text-amber-700">
                      {item.name}: {item.current_stock} {item.unit}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Filters and actions */}
          <Card>
            <CardContent className="py-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por nombre o código..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Select value={filterSection} onValueChange={setFilterSection}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Sección" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las secciones</SelectItem>
                    {sections.map(section => (
                      <SelectItem key={section.id} value={section.id}>
                        {section.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filterCategory} onValueChange={setFilterCategory}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las categorías</SelectItem>
                    {categories.map(category => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Dialog open={showAddItem} onOpenChange={setShowAddItem}>
                  <DialogTrigger asChild>
                    <Button onClick={() => {
                      setEditingItem(null)
                      setNewItem({
                        name: "",
                        code: "",
                        section_id: "",
                        category_id: "",
                        unit: "unidad",
                        current_stock: 0,
                        min_stock: 0,
                        location: ""
                      })
                    }}>
                      <Plus className="h-4 w-4 mr-2" />
                      Agregar Item
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{editingItem ? "Editar Item" : "Agregar Item al Pañol"}</DialogTitle>
                      <DialogDescription>
                        Complete los datos del item de inventario
                      </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={editingItem ? handleUpdateItem : handleAddItem} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="name">Nombre *</Label>
                          <Input
                            id="name"
                            value={newItem.name}
                            onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="code">Código</Label>
                          <Input
                            id="code"
                            value={newItem.code}
                            onChange={(e) => setNewItem({ ...newItem, code: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="section">Sección *</Label>
                          <Select
                            value={newItem.section_id}
                            onValueChange={(value) => setNewItem({ ...newItem, section_id: value })}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Seleccionar" />
                            </SelectTrigger>
                            <SelectContent>
                              {sections.map(section => (
                                <SelectItem key={section.id} value={section.id}>
                                  {section.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="category">Categoría *</Label>
                          <Select
                            value={newItem.category_id}
                            onValueChange={(value) => setNewItem({ ...newItem, category_id: value })}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Seleccionar" />
                            </SelectTrigger>
                            <SelectContent>
                              {categories.map(category => (
                                <SelectItem key={category.id} value={category.id}>
                                  {category.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="unit">Unidad</Label>
                          <Select
                            value={newItem.unit}
                            onValueChange={(value) => setNewItem({ ...newItem, unit: value })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unidad">Unidad</SelectItem>
                              <SelectItem value="kg">Kg</SelectItem>
                              <SelectItem value="litro">Litro</SelectItem>
                              <SelectItem value="metro">Metro</SelectItem>
                              <SelectItem value="rollo">Rollo</SelectItem>
                              <SelectItem value="caja">Caja</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {!editingItem && (
                          <div className="space-y-2">
                            <Label htmlFor="stock">Stock Inicial</Label>
                            <Input
                              id="stock"
                              type="number"
                              min="0"
                              value={newItem.current_stock}
                              onChange={(e) => setNewItem({ ...newItem, current_stock: parseInt(e.target.value) || 0 })}
                            />
                          </div>
                        )}
                        <div className="space-y-2">
                          <Label htmlFor="min_stock">Stock Mínimo</Label>
                          <Input
                            id="min_stock"
                            type="number"
                            min="0"
                            value={newItem.min_stock}
                            onChange={(e) => setNewItem({ ...newItem, min_stock: parseInt(e.target.value) || 0 })}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="location">Ubicación</Label>
                        <Input
                          id="location"
                          value={newItem.location}
                          onChange={(e) => setNewItem({ ...newItem, location: e.target.value })}
                          placeholder="Ej: Estante A, Cajón 3"
                        />
                      </div>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setShowAddItem(false)}>
                          Cancelar
                        </Button>
                        <Button type="submit">
                          {editingItem ? "Guardar Cambios" : "Agregar"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardContent>
          </Card>

          {/* Inventory table */}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Código</TableHead>
                    <TableHead>Sección</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead className="text-center">Stock</TableHead>
                    <TableHead>Ubicación</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No se encontraron items
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredItems.map(item => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell className="text-muted-foreground">{item.code || "-"}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{item.section?.name}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{item.category?.name}</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={item.current_stock <= item.min_stock ? "text-amber-600 font-bold" : ""}>
                            {item.current_stock} {item.unit}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{item.location || "-"}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Entrada de stock"
                              onClick={() => {
                                setSelectedItem(item)
                                setMovementData({ type: "entrada", quantity: 0, reason: "" })
                                setShowMovement(true)
                              }}
                            >
                              <ArrowUpCircle className="h-4 w-4 text-green-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Salida de stock"
                              onClick={() => {
                                setSelectedItem(item)
                                setMovementData({ type: "salida", quantity: 0, reason: "" })
                                setShowMovement(true)
                              }}
                            >
                              <ArrowDownCircle className="h-4 w-4 text-red-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setEditingItem(item)
                                setNewItem({
                                  name: item.name,
                                  code: item.code || "",
                                  section_id: item.section_id,
                                  category_id: item.category_id,
                                  unit: item.unit,
                                  current_stock: item.current_stock,
                                  min_stock: item.min_stock,
                                  location: item.location || ""
                                })
                                setShowAddItem(true)
                              }}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteItem(item)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Stock movement dialog */}
          <Dialog open={showMovement} onOpenChange={setShowMovement}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {movementData.type === "entrada" ? "Entrada" : movementData.type === "salida" ? "Salida" : "Ajuste"} de Stock
                </DialogTitle>
                <DialogDescription>
                  {selectedItem?.name} - Stock actual: {selectedItem?.current_stock} {selectedItem?.unit}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleStockMovement} className="space-y-4">
                <div className="space-y-2">
                  <Label>Tipo de Movimiento</Label>
                  <Select
                    value={movementData.type}
                    onValueChange={(value: "entrada" | "salida" | "ajuste") => setMovementData({ ...movementData, type: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="entrada">Entrada (agregar)</SelectItem>
                      <SelectItem value="salida">Salida (restar)</SelectItem>
                      <SelectItem value="ajuste">Ajuste (fijar cantidad)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="quantity">Cantidad</Label>
                  <Input
                    id="quantity"
                    type="number"
                    min="0"
                    value={movementData.quantity}
                    onChange={(e) => setMovementData({ ...movementData, quantity: parseInt(e.target.value) || 0 })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reason">Motivo</Label>
                  <Input
                    id="reason"
                    value={movementData.reason}
                    onChange={(e) => setMovementData({ ...movementData, reason: e.target.value })}
                    placeholder="Ej: Compra, uso en tarea, ajuste inventario"
                  />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setShowMovement(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit">Confirmar</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="movimientos">
          <Card>
            <CardHeader>
              <CardTitle>Historial de Movimientos</CardTitle>
              <CardDescription>Últimos 50 movimientos de stock</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-center">Cantidad</TableHead>
                    <TableHead>Motivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        No hay movimientos registrados
                      </TableCell>
                    </TableRow>
                  ) : (
                    movements.map(mov => (
                      <TableRow key={mov.id}>
                        <TableCell>
                          {new Date(mov.created_at).toLocaleDateString("es-AR", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </TableCell>
                        <TableCell className="font-medium">{mov.item?.name}</TableCell>
                        <TableCell>
                          <Badge variant={mov.movement_type === "entrada" ? "default" : mov.movement_type === "salida" ? "destructive" : "secondary"}>
                            {mov.movement_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={mov.movement_type === "entrada" ? "text-green-600" : mov.movement_type === "salida" ? "text-red-600" : ""}>
                            {mov.movement_type === "entrada" ? "+" : mov.movement_type === "salida" ? "-" : ""}{mov.quantity}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{mov.reason || "-"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="configuracion">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Secciones */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Secciones de Planta</CardTitle>
                <CardDescription>Áreas de la planta para organizar el inventario</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="Nueva sección..."
                    value={newSection}
                    onChange={(e) => setNewSection(e.target.value)}
                  />
                  <Button onClick={handleAddSection} disabled={!newSection.trim()}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="space-y-2">
                  {sections.map(section => (
                    <div key={section.id} className="flex items-center justify-between p-2 border rounded">
                      <span>{section.name}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Categorías (solo lectura por ahora) */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Categorías</CardTitle>
                <CardDescription>Tipos de items en el pañol</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {categories.map(category => (
                    <div key={category.id} className="flex items-center justify-between p-2 border rounded">
                      <span>{category.name}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
