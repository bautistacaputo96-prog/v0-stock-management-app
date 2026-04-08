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
import { Checkbox } from "@/components/ui/checkbox"
import { Plus, Search, ClipboardList, CheckCircle2, Clock, AlertCircle, Eye, Package } from "lucide-react"

interface Section {
  id: string
  name: string
}

interface InventoryItem {
  id: string
  name: string
  code: string | null
  unit: string
  current_stock: number
}

interface TaskItem {
  id: string
  item_id: string
  quantity_used: number
  item?: InventoryItem
}

interface Task {
  id: string
  task_date: string
  section_id: string
  task_type: string
  description: string
  status: "pendiente" | "en_progreso" | "completada"
  priority: "baja" | "media" | "alta" | "urgente"
  assigned_to: string | null
  completed_at: string | null
  notes: string | null
  section?: Section
  items_used?: TaskItem[]
}

interface TareasModuleProps {
  plant: string
}

const TASK_TYPES = [
  "Mantenimiento Preventivo",
  "Mantenimiento Correctivo",
  "Reparación",
  "Inspección",
  "Limpieza",
  "Lubricación",
  "Ajuste",
  "Cambio de Pieza",
  "Otro"
]

const PRIORITY_COLORS = {
  baja: "bg-slate-100 text-slate-700",
  media: "bg-blue-100 text-blue-700",
  alta: "bg-amber-100 text-amber-700",
  urgente: "bg-red-100 text-red-700"
}

const STATUS_COLORS = {
  pendiente: "bg-slate-100 text-slate-700",
  en_progreso: "bg-blue-100 text-blue-700",
  completada: "bg-green-100 text-green-700"
}

export function TareasModule({ plant }: TareasModuleProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [filterStatus, setFilterStatus] = useState<string>("all")
  const [filterSection, setFilterSection] = useState<string>("all")
  
  // Dialogs
  const [showAddTask, setShowAddTask] = useState(false)
  const [showViewTask, setShowViewTask] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  
  // Form states
  const [newTask, setNewTask] = useState({
    task_date: new Date().toISOString().split("T")[0],
    section_id: "",
    task_type: "",
    description: "",
    priority: "media" as "baja" | "media" | "alta" | "urgente",
    assigned_to: "",
    notes: ""
  })
  
  // Items used in task
  const [selectedItems, setSelectedItems] = useState<{ item_id: string; quantity: number }[]>([])
  const [showAddItem, setShowAddItem] = useState(false)
  const [newItemUsage, setNewItemUsage] = useState({ item_id: "", quantity: 1 })

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
        .order("name")
      setInventoryItems(itemsData || [])

      // Load tasks with sections and items used
      const { data: tasksData } = await supabase
        .from("maintenance_tasks")
        .select(`
          *,
          section:maintenance_sections(*),
          items_used:maintenance_task_items(
            *,
            item:maintenance_inventory(*)
          )
        `)
        .eq("plant", plant)
        .order("task_date", { ascending: false })
        .order("created_at", { ascending: false })
      setTasks(tasksData || [])
    } catch (error) {
      console.error("Error loading data:", error)
    } finally {
      setLoading(false)
    }
  }

  async function handleAddTask(e: React.FormEvent) {
    e.preventDefault()
    try {
      // Insert task
      const { data: taskData, error: taskError } = await supabase
        .from("maintenance_tasks")
        .insert({
          ...newTask,
          plant,
          status: "pendiente",
          assigned_to: newTask.assigned_to || null,
          notes: newTask.notes || null
        })
        .select()
        .single()

      if (taskError) throw taskError

      // Insert items used and update stock
      for (const item of selectedItems) {
        // Insert task item
        await supabase
          .from("maintenance_task_items")
          .insert({
            task_id: taskData.id,
            item_id: item.item_id,
            quantity_used: item.quantity
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
              reason: `Usado en tarea: ${newTask.description.substring(0, 50)}`,
              created_by: sessionStorage.getItem("maintenance_user") || "Sistema"
            })
        }
      }

      setShowAddTask(false)
      setNewTask({
        task_date: new Date().toISOString().split("T")[0],
        section_id: "",
        task_type: "",
        description: "",
        priority: "media",
        assigned_to: "",
        notes: ""
      })
      setSelectedItems([])
      loadData()
    } catch (error) {
      console.error("Error adding task:", error)
    }
  }

  async function handleUpdateStatus(task: Task, newStatus: "pendiente" | "en_progreso" | "completada") {
    try {
      const updateData: any = { status: newStatus }
      if (newStatus === "completada") {
        updateData.completed_at = new Date().toISOString()
      } else {
        updateData.completed_at = null
      }

      const { error } = await supabase
        .from("maintenance_tasks")
        .update(updateData)
        .eq("id", task.id)

      if (error) throw error
      loadData()
    } catch (error) {
      console.error("Error updating status:", error)
    }
  }

  function addItemToTask() {
    if (!newItemUsage.item_id || newItemUsage.quantity <= 0) return
    
    // Check if item already added
    const existing = selectedItems.find(i => i.item_id === newItemUsage.item_id)
    if (existing) {
      setSelectedItems(selectedItems.map(i => 
        i.item_id === newItemUsage.item_id 
          ? { ...i, quantity: i.quantity + newItemUsage.quantity }
          : i
      ))
    } else {
      setSelectedItems([...selectedItems, { ...newItemUsage }])
    }
    
    setNewItemUsage({ item_id: "", quantity: 1 })
    setShowAddItem(false)
  }

  function removeItemFromTask(itemId: string) {
    setSelectedItems(selectedItems.filter(i => i.item_id !== itemId))
  }

  // Filter tasks
  const filteredTasks = tasks.filter(task => {
    const matchesSearch = task.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      task.task_type.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = filterStatus === "all" || task.status === filterStatus
    const matchesSection = filterSection === "all" || task.section_id === filterSection
    return matchesSearch && matchesStatus && matchesSection
  })

  // Stats
  const pendingCount = tasks.filter(t => t.status === "pendiente").length
  const inProgressCount = tasks.filter(t => t.status === "en_progreso").length
  const completedToday = tasks.filter(t => 
    t.status === "completada" && 
    t.completed_at && 
    new Date(t.completed_at).toDateString() === new Date().toDateString()
  ).length

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Cargando tareas...
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pendientes</p>
                <p className="text-2xl font-bold text-slate-700">{pendingCount}</p>
              </div>
              <Clock className="h-8 w-8 text-slate-400" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">En Progreso</p>
                <p className="text-2xl font-bold text-blue-700">{inProgressCount}</p>
              </div>
              <AlertCircle className="h-8 w-8 text-blue-400" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Completadas Hoy</p>
                <p className="text-2xl font-bold text-green-700">{completedToday}</p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-green-400" />
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
                placeholder="Buscar tareas..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="pendiente">Pendiente</SelectItem>
                <SelectItem value="en_progreso">En Progreso</SelectItem>
                <SelectItem value="completada">Completada</SelectItem>
              </SelectContent>
            </Select>
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
            <Dialog open={showAddTask} onOpenChange={setShowAddTask}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Nueva Tarea
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Registrar Tarea de Mantenimiento</DialogTitle>
                  <DialogDescription>
                    Complete los datos de la tarea realizada o a realizar
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleAddTask} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="task_date">Fecha *</Label>
                      <Input
                        id="task_date"
                        type="date"
                        value={newTask.task_date}
                        onChange={(e) => setNewTask({ ...newTask, task_date: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="section">Sección *</Label>
                      <Select
                        value={newTask.section_id}
                        onValueChange={(value) => setNewTask({ ...newTask, section_id: value })}
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
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="task_type">Tipo de Tarea *</Label>
                      <Select
                        value={newTask.task_type}
                        onValueChange={(value) => setNewTask({ ...newTask, task_type: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar" />
                        </SelectTrigger>
                        <SelectContent>
                          {TASK_TYPES.map(type => (
                            <SelectItem key={type} value={type}>
                              {type}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="priority">Prioridad *</Label>
                      <Select
                        value={newTask.priority}
                        onValueChange={(value: "baja" | "media" | "alta" | "urgente") => setNewTask({ ...newTask, priority: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="baja">Baja</SelectItem>
                          <SelectItem value="media">Media</SelectItem>
                          <SelectItem value="alta">Alta</SelectItem>
                          <SelectItem value="urgente">Urgente</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Descripción *</Label>
                    <Textarea
                      id="description"
                      value={newTask.description}
                      onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                      placeholder="Describa la tarea realizada..."
                      rows={3}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="assigned_to">Asignado a</Label>
                    <Input
                      id="assigned_to"
                      value={newTask.assigned_to}
                      onChange={(e) => setNewTask({ ...newTask, assigned_to: e.target.value })}
                      placeholder="Nombre del responsable"
                    />
                  </div>
                  
                  {/* Items/Insumos usados */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Insumos/Repuestos Utilizados</Label>
                      <Dialog open={showAddItem} onOpenChange={setShowAddItem}>
                        <DialogTrigger asChild>
                          <Button type="button" variant="outline" size="sm">
                            <Plus className="h-4 w-4 mr-1" />
                            Agregar
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Agregar Insumo</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <Label>Item del Pañol</Label>
                              <Select
                                value={newItemUsage.item_id}
                                onValueChange={(value) => setNewItemUsage({ ...newItemUsage, item_id: value })}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Seleccionar item" />
                                </SelectTrigger>
                                <SelectContent>
                                  {inventoryItems.map(item => (
                                    <SelectItem key={item.id} value={item.id}>
                                      {item.name} (Stock: {item.current_stock} {item.unit})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label>Cantidad</Label>
                              <Input
                                type="number"
                                min="1"
                                value={newItemUsage.quantity}
                                onChange={(e) => setNewItemUsage({ ...newItemUsage, quantity: parseInt(e.target.value) || 1 })}
                              />
                            </div>
                            <DialogFooter>
                              <Button type="button" onClick={addItemToTask}>
                                Agregar
                              </Button>
                            </DialogFooter>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                    {selectedItems.length > 0 && (
                      <div className="border rounded-lg p-3 space-y-2">
                        {selectedItems.map(item => {
                          const inventoryItem = inventoryItems.find(i => i.id === item.item_id)
                          return (
                            <div key={item.item_id} className="flex items-center justify-between text-sm">
                              <span>{inventoryItem?.name}</span>
                              <div className="flex items-center gap-2">
                                <span>{item.quantity} {inventoryItem?.unit}</span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeItemFromTask(item.item_id)}
                                  className="h-6 w-6 p-0 text-destructive"
                                >
                                  ×
                                </Button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="notes">Notas Adicionales</Label>
                    <Textarea
                      id="notes"
                      value={newTask.notes}
                      onChange={(e) => setNewTask({ ...newTask, notes: e.target.value })}
                      placeholder="Observaciones, recomendaciones..."
                      rows={2}
                    />
                  </div>
                  
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setShowAddTask(false)}>
                      Cancelar
                    </Button>
                    <Button type="submit">Registrar Tarea</Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      {/* Tasks table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Sección</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead>Prioridad</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No se encontraron tareas
                  </TableCell>
                </TableRow>
              ) : (
                filteredTasks.map(task => (
                  <TableRow key={task.id}>
                    <TableCell>
                      {new Date(task.task_date + "T12:00:00").toLocaleDateString("es-AR")}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{task.section?.name}</Badge>
                    </TableCell>
                    <TableCell>{task.task_type}</TableCell>
                    <TableCell className="max-w-[200px] truncate" title={task.description}>
                      {task.description}
                    </TableCell>
                    <TableCell>
                      <Badge className={PRIORITY_COLORS[task.priority]}>
                        {task.priority}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={task.status}
                        onValueChange={(value: "pendiente" | "en_progreso" | "completada") => handleUpdateStatus(task, value)}
                      >
                        <SelectTrigger className={`w-[130px] h-7 text-xs ${STATUS_COLORS[task.status]}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pendiente">Pendiente</SelectItem>
                          <SelectItem value="en_progreso">En Progreso</SelectItem>
                          <SelectItem value="completada">Completada</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setSelectedTask(task)
                          setShowViewTask(true)
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* View task dialog */}
      <Dialog open={showViewTask} onOpenChange={setShowViewTask}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Detalle de Tarea</DialogTitle>
          </DialogHeader>
          {selectedTask && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Fecha</p>
                  <p className="font-medium">{new Date(selectedTask.task_date + "T12:00:00").toLocaleDateString("es-AR")}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Sección</p>
                  <p className="font-medium">{selectedTask.section?.name}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Tipo</p>
                  <p className="font-medium">{selectedTask.task_type}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Prioridad</p>
                  <Badge className={PRIORITY_COLORS[selectedTask.priority]}>
                    {selectedTask.priority}
                  </Badge>
                </div>
                <div>
                  <p className="text-muted-foreground">Estado</p>
                  <Badge className={STATUS_COLORS[selectedTask.status]}>
                    {selectedTask.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-muted-foreground">Asignado a</p>
                  <p className="font-medium">{selectedTask.assigned_to || "-"}</p>
                </div>
              </div>
              <div>
                <p className="text-muted-foreground text-sm">Descripción</p>
                <p className="font-medium">{selectedTask.description}</p>
              </div>
              {selectedTask.notes && (
                <div>
                  <p className="text-muted-foreground text-sm">Notas</p>
                  <p>{selectedTask.notes}</p>
                </div>
              )}
              {selectedTask.items_used && selectedTask.items_used.length > 0 && (
                <div>
                  <p className="text-muted-foreground text-sm mb-2 flex items-center gap-1">
                    <Package className="h-4 w-4" />
                    Insumos Utilizados
                  </p>
                  <div className="border rounded-lg p-3 space-y-1">
                    {selectedTask.items_used.map(item => (
                      <div key={item.id} className="flex justify-between text-sm">
                        <span>{item.item?.name}</span>
                        <span className="text-muted-foreground">{item.quantity_used} {item.item?.unit}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {selectedTask.completed_at && (
                <div>
                  <p className="text-muted-foreground text-sm">Completada</p>
                  <p className="font-medium text-green-600">
                    {new Date(selectedTask.completed_at).toLocaleString("es-AR")}
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
