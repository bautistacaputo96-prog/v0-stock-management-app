"use client"

// Dispatch scheduling component
import { useState, useEffect, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Plus, ChevronLeft, ChevronRight, Clock, MapPin, Truck, AlertTriangle, X, Calendar, Check, ChevronsUpDown, MoreHorizontal, Pencil, Trash2, UserPlus, TruckIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { format, addDays, startOfWeek, addWeeks, subWeeks, isSameDay, parseISO, setHours, setMinutes, addMinutes } from "date-fns"
import { es } from "date-fns/locale"
import { AddClientDialog } from "@/components/add-client-dialog"
import { AddMixerDialog } from "@/components/add-mixer-dialog"
import { AddConstructionSiteDialog } from "@/components/add-construction-site-dialog"
import { UserSelector } from "@/components/user-selector"

type Plant = { id: string; name: string }
type Client = { id: string; name: string; construction_sites?: ConstructionSite[] }
type ConstructionSite = {
  id: string; name: string; address: string | null; client_id: string;
  travel_time_minutes: number; unload_time_minutes: number; requires_pump: boolean;
  reception_hours_start: string | null; reception_hours_end: string | null;
}
type Mixer = { id: string; license_plate: string; capacity_m3: number; status: string }
type Formula = { id: string; name: string; code: string; useful_life_minutes: number }
type ScheduledDispatch = {
  id: string; plant_id: string; client_id: string; construction_site_id: string;
  formula_id: string; mixer_id: string | null; quantity_m3: number;
  scheduled_arrival_time: string; scheduled_departure_time: string; status: string;
  observations: string | null; is_urgent: boolean;
  clients?: Client; construction_sites?: ConstructionSite; formulas?: Formula; mixers?: Mixer;
}

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800 border-blue-300",
  confirmed: "bg-green-100 text-green-800 border-green-300",
  loading: "bg-yellow-100 text-yellow-800 border-yellow-300",
  in_transit: "bg-purple-100 text-purple-800 border-purple-300",
  delivered: "bg-gray-100 text-gray-800 border-gray-300",
  cancelled: "bg-red-100 text-red-800 border-red-300 line-through",
}

const HOURS = Array.from({ length: 14 }, (_, i) => i + 6) // 6:00 to 19:00

function FormulaCombobox({ formulas, value, onChange }: { formulas: Formula[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const selectedFormula = formulas.find((f) => f.id === value)
  
  // Ordenar por nombre primero, luego por código
  const sortedFormulas = [...formulas].sort((a, b) => {
    const nameCompare = a.name.localeCompare(b.name)
    if (nameCompare !== 0) return nameCompare
    return a.code.localeCompare(b.code)
  })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          {selectedFormula ? `${selectedFormula.name} (${selectedFormula.code})` : "Buscar formula..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar formula..." />
          <CommandList className="max-h-[200px]">
            <CommandEmpty>No se encontro formula.</CommandEmpty>
            <CommandGroup>
              {sortedFormulas.map((f) => (
                <CommandItem
                  key={f.id}
                  value={`${f.name} ${f.code}`}
                  onSelect={() => {
                    onChange(f.id)
                    setOpen(false)
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === f.id ? "opacity-100" : "opacity-0")} />
                  <span className="font-medium">{f.name}</span>
                  <span className="ml-2 text-muted-foreground text-xs">({f.code})</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function DispatchScheduling({ plants }: { plants: Plant[] }) {
  const [selectedPlant, setSelectedPlant] = useState("all") // "all" para todas las plantas
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [dispatches, setDispatches] = useState<ScheduledDispatch[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [mixers, setMixers] = useState<Mixer[]>([])
  const [formulas, setFormulas] = useState<Formula[]>([])
  const [loading, setLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [selectedHour, setSelectedHour] = useState<number | null>(null)
  const [editingDispatch, setEditingDispatch] = useState<ScheduledDispatch | null>(null)
  const [deleteDispatch, setDeleteDispatch] = useState<ScheduledDispatch | null>(null)
  const [newDispatchPlant, setNewDispatchPlant] = useState("") // Planta para nuevo despacho
  
  // Inicializar newDispatchPlant cuando las plantas estén disponibles
  useEffect(() => {
    if (plants.length > 0 && !newDispatchPlant) {
      setNewDispatchPlant(plants[0].id)
    }
  }, [plants, newDispatchPlant])
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  const [form, setForm] = useState({
    client_id: "",
    construction_site_id: "",
    formula_id: "",
    mixer_id: "",
    quantity_m3: "8",
    arrival_date: "",
    arrival_time: "08:00",
    observations: "",
    is_urgent: false,
    created_by: "",
  })

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i))
  }, [currentWeekStart])

  useEffect(() => {
    loadData()
  }, [selectedPlant, currentWeekStart])


  async function loadData() {
    setLoading(true)
    const supabase = createClient()

    const weekEnd = addDays(currentWeekStart, 7)

    // Query de despachos - filtrar por planta solo si no es "all"
    let dispatchesQuery = supabase
      .from("scheduled_dispatches")
      .select("*, clients(id, name), construction_sites(*), formulas(id, name, code), mixers(id, license_plate, capacity_m3)")
      .gte("scheduled_arrival_time", currentWeekStart.toISOString())
      .lt("scheduled_arrival_time", weekEnd.toISOString())
      .order("scheduled_arrival_time")
    
    if (selectedPlant !== "all") {
      dispatchesQuery = dispatchesQuery.eq("plant_id", selectedPlant)
    }

    const [dispatchesRes, clientsRes, mixersRes, formulasRes] = await Promise.all([
      dispatchesQuery,
      supabase.from("clients").select("*, construction_sites(*)").eq("active", true).order("name"),
      supabase.from("mixers").select("*").eq("plant_id", selectedPlant).order("license_plate"),
      // Cargar todas las fórmulas (la columna active no existe en formulas)
      supabase.from("formulas").select("id, name, code, useful_life_minutes").order("code"),
    ])

    setDispatches(dispatchesRes.data || [])
    setClients(clientsRes.data || [])
    setMixers(mixersRes.data || [])
    setFormulas(formulasRes.data || [])
    setLoading(false)
  }

  const MAX_CAPACITY_M3 = 8 // Capacidad máxima por camión
  const selectedClient = clients.find((c) => c.id === form.client_id)
  const selectedSite = selectedClient?.construction_sites?.find((s) => s.id === form.construction_site_id)
  
  // Calcular cantidad de viajes necesarios - llenar camiones al máximo
  const totalM3 = parseFloat(form.quantity_m3) || 0
  const numTrips = Math.ceil(totalM3 / MAX_CAPACITY_M3)
  
  // Calcular m3 por viaje: primeros viajes van llenos (8m3), último lleva el resto
  function getTripQuantities(): number[] {
    if (totalM3 <= 0) return []
    const trips: number[] = []
    let remaining = totalM3
    for (let i = 0; i < numTrips; i++) {
      const qty = Math.min(MAX_CAPACITY_M3, remaining)
      trips.push(Math.round(qty * 10) / 10) // Redondear a 1 decimal
      remaining -= qty
    }
    return trips
  }
  const tripQuantities = getTripQuantities()

  function calculateDepartureTime(arrivalTime: string, site: ConstructionSite | undefined): string {
    if (!site || !arrivalTime) return arrivalTime
    const arrival = parseISO(arrivalTime)
    const departure = addMinutes(arrival, -(site.travel_time_minutes || 30))
    return departure.toISOString()
  }
  
  // Calcular el intervalo entre viajes (tiempo de descarga + margen)
  function getTripInterval(): number {
    const unloadTime = selectedSite?.unload_time_minutes || 20
    return unloadTime + 10 // tiempo de descarga + 10 min margen
  }

  function openNewDispatch(date: Date, hour: number) {
    setSelectedDate(date)
    setSelectedHour(hour)
    setEditingDispatch(null)
    setForm({
      client_id: "",
      construction_site_id: "",
      formula_id: "",
      mixer_id: "",
      quantity_m3: "8",
      arrival_date: format(date, "yyyy-MM-dd"),
      arrival_time: `${hour.toString().padStart(2, "0")}:00`,
      observations: "",
      is_urgent: false,
      created_by: "",
    })
    setEditingDispatch(null)
    setIsDialogOpen(true)
  }

  function openEditDispatch(dispatch: ScheduledDispatch) {
    setEditingDispatch(dispatch)
    const arrival = parseISO(dispatch.scheduled_arrival_time)
    setForm({
      client_id: dispatch.client_id,
      construction_site_id: dispatch.construction_site_id,
      formula_id: dispatch.formula_id,
      mixer_id: dispatch.mixer_id || "",
      quantity_m3: dispatch.quantity_m3.toString(),
      arrival_date: format(arrival, "yyyy-MM-dd"),
      arrival_time: format(arrival, "HH:mm"),
      observations: dispatch.observations || "",
      is_urgent: dispatch.is_urgent,
      created_by: dispatch.created_by || "",
    })
    setEditingDispatch(dispatch)
    setIsDialogOpen(true)
  }

  async function handleSave() {
    if (saving) return // Prevenir doble click
    setSaving(true)
    
    try {
      const supabase = createClient()
      const tripInterval = getTripInterval()
      // Determinar planta a usar: si el filtro es "all", usar newDispatchPlant
      const plantToUse = selectedPlant === "all" ? newDispatchPlant : selectedPlant

      if (editingDispatch) {
      // Editar despacho existente (solo 1)
      const arrivalTime = `${form.arrival_date}T${form.arrival_time}:00`
      const departureTime = calculateDepartureTime(arrivalTime, selectedSite)
      
      const { error } = await supabase.from("scheduled_dispatches").update({
        plant_id: plantToUse,
        client_id: form.client_id,
        construction_site_id: form.construction_site_id,
        formula_id: form.formula_id,
        mixer_id: form.mixer_id || null,
        quantity_m3: parseFloat(form.quantity_m3),
        scheduled_arrival_time: arrivalTime,
        scheduled_departure_time: departureTime,
        observations: form.observations || null,
        is_urgent: form.is_urgent,
      }).eq("id", editingDispatch.id)
      
      if (error) {
        toast({ title: "Error", description: "No se pudo actualizar", variant: "destructive" })
        setSaving(false)
        return
      }
      toast({ title: "Despacho actualizado" })
    } else {
      // Crear nuevos despachos - dividir en viajes si es necesario
      const dispatches = []
      const baseArrival = parseISO(`${form.arrival_date}T${form.arrival_time}:00`)
      
      for (let i = 0; i < numTrips; i++) {
        // Cada viaje llega con intervalo de tiempo de descarga
        const tripArrival = addMinutes(baseArrival, i * tripInterval)
        const tripDeparture = calculateDepartureTime(tripArrival.toISOString(), selectedSite)
        
        dispatches.push({
          plant_id: plantToUse,
          client_id: form.client_id,
          construction_site_id: form.construction_site_id,
          formula_id: form.formula_id,
          mixer_id: null, // Los camiones se asignan después
          quantity_m3: tripQuantities[i], // 8m3 los primeros, resto el último
          scheduled_arrival_time: tripArrival.toISOString(),
          scheduled_departure_time: tripDeparture,
          observations: numTrips > 1 ? `Viaje ${i + 1} de ${numTrips} (${tripQuantities[i]}m3). ${form.observations || ""}`.trim() : (form.observations || null),
          is_urgent: form.is_urgent,
          created_by: form.created_by || null,
        })
      }
      
      const { error } = await supabase.from("scheduled_dispatches").insert(dispatches)
      if (error) {
        toast({ title: "Error", description: "No se pudo crear", variant: "destructive" })
        setSaving(false)
        return
      }
      
      if (numTrips > 1) {
        const breakdown = tripQuantities.map((q, i) => `Viaje ${i+1}: ${q}m3`).join(", ")
        toast({ title: `${numTrips} viajes programados`, description: breakdown })
      } else {
        toast({ title: "Despacho programado" })
      }
    }

      setIsDialogOpen(false)
      loadData()
    } catch (err) {
      console.error("[v0] Error saving dispatch:", err)
      toast({ title: "Error", description: "Ocurrió un error inesperado", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteDispatch) return
    setSaving(true)
    const supabase = createClient()
    const { error } = await supabase.from("scheduled_dispatches").delete().eq("id", deleteDispatch.id)
    if (error) {
      toast({ title: "Error", description: "No se pudo eliminar el despacho", variant: "destructive" })
    } else {
      toast({ title: "Despacho eliminado" })
      loadData()
    }
    setDeleteDispatch(null)
    setSaving(false)
  }

  async function cancelDispatch(dispatch: ScheduledDispatch) {
    const supabase = createClient()
    const { error } = await supabase.from("scheduled_dispatches").update({ status: "cancelled" }).eq("id", dispatch.id)
    if (error) {
      toast({ title: "Error", description: "No se pudo cancelar", variant: "destructive" })
    } else {
      toast({ title: "Despacho cancelado" })
      loadData()
    }
  }

  function getDispatchesForSlot(date: Date, hour: number) {
    return dispatches.filter((d) => {
      const arrival = parseISO(d.scheduled_arrival_time)
      return isSameDay(arrival, date) && arrival.getHours() === hour
    })
  }

  return (
    <div className="space-y-3 md:space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <Select value={selectedPlant} onValueChange={setSelectedPlant}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="Planta" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las plantas</SelectItem>
              {plants.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center justify-between sm:justify-start gap-2">
            <Button variant="outline" size="icon" onClick={() => setCurrentWeekStart(subWeeks(currentWeekStart, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="font-medium text-sm md:text-base min-w-[160px] md:min-w-[200px] text-center">
              {format(currentWeekStart, "d MMM", { locale: es })} - {format(addDays(currentWeekStart, 6), "d MMM yyyy", { locale: es })}
            </span>
            <Button variant="outline" size="icon" onClick={() => setCurrentWeekStart(addWeeks(currentWeekStart, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button onClick={() => setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))} variant="outline" size="sm" className="ml-2">
              Hoy
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground md:hidden">Desliza horizontalmente para ver toda la semana</p>
      </div>

      {/* Weekly Calendar */}
      <div className="overflow-x-auto -mx-4 md:mx-0">
        <Card className="min-w-[700px] mx-4 md:mx-0">
          <CardContent className="p-0">
            {/* Header */}
            <div className="grid grid-cols-8 border-b sticky top-0 bg-card z-10">
              <div className="p-1.5 md:p-2 text-center text-xs md:text-sm font-medium text-muted-foreground border-r">Hora</div>
              {weekDays.map((day) => (
                <div
                  key={day.toISOString()}
                  className={`p-1.5 md:p-2 text-center border-r last:border-r-0 ${
                    isSameDay(day, new Date()) ? "bg-primary/10" : ""
                  }`}
                >
                  <p className="text-xs md:text-sm font-medium">{format(day, "EEE", { locale: es })}</p>
                  <p className={`text-base md:text-lg ${isSameDay(day, new Date()) ? "text-primary font-bold" : ""}`}>
                    {format(day, "d")}
                  </p>
                </div>
              ))}
            </div>

            {/* Time slots */}
            {HOURS.map((hour) => (
              <div key={hour} className="grid grid-cols-8 border-b last:border-b-0">
                <div className="p-2 text-center text-sm text-muted-foreground border-r">
                  {hour.toString().padStart(2, "0")}:00
                </div>
                {weekDays.map((day) => {
                  const slotDispatches = getDispatchesForSlot(day, hour)
                  return (
                    <div
                      key={`${day.toISOString()}-${hour}`}
                      className={`p-1 border-r last:border-r-0 min-h-[60px] cursor-pointer hover:bg-muted/50 transition-colors ${
                        isSameDay(day, new Date()) ? "bg-primary/5" : ""
                      }`}
                      onClick={() => openNewDispatch(day, hour)}
                    >
                      {slotDispatches.map((d) => (
                        <div
                          key={d.id}
                          className={`text-xs p-1 rounded mb-1 border ${STATUS_COLORS[d.status] || "bg-gray-100"} ${d.is_urgent ? "ring-2 ring-red-500" : ""} group relative`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openEditDispatch(d)}>
                              <div className="font-medium truncate">{d.clients?.name}</div>
                              <div className="flex items-center gap-1 text-[10px]">
                                <span>{d.quantity_m3}m3</span>
                                {d.mixers && <span>| {d.mixers.license_plate}</span>}
                              </div>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100">
                                  <MoreHorizontal className="h-3 w-3" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEditDispatch(d)}>
                                  <Pencil className="h-4 w-4 mr-2" />
                                  Editar
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setDeleteDispatch(d)} className="text-destructive">
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Eliminar
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingDispatch ? "Editar Despacho" : "Nuevo Despacho Programado"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
            {/* Selector de planta solo si el filtro es "Todas" */}
            {selectedPlant === "all" && (
              <div className="space-y-2">
                <Label>Planta *</Label>
                <Select value={newDispatchPlant} onValueChange={setNewDispatchPlant}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar planta" /></SelectTrigger>
                  <SelectContent>
                    {plants.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Fecha de Llegada *</Label>
                <Input type="date" value={form.arrival_date} onChange={(e) => setForm({ ...form, arrival_date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Hora de Llegada *</Label>
                <Input type="time" value={form.arrival_time} onChange={(e) => setForm({ ...form, arrival_time: e.target.value })} />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Cliente *</Label>
                <AddClientDialog
                  plantId={selectedPlant === "all" ? newDispatchPlant : selectedPlant}
                  trigger={
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs">
                      <UserPlus className="h-3 w-3 mr-1" />
                      Agregar
                    </Button>
                  }
                  onClientAdded={(newClient) => {
                    setClients([...clients, { ...newClient, construction_sites: [] }])
                    setForm({ ...form, client_id: newClient.id, construction_site_id: "" })
                  }}
                />
              </div>
              <Select value={form.client_id} onValueChange={(v) => setForm({ ...form, client_id: v, construction_site_id: "" })}>
                <SelectTrigger><SelectValue placeholder="Seleccionar cliente" /></SelectTrigger>
                <SelectContent>
                  {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {selectedClient && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Obra *</Label>
                  <AddConstructionSiteDialog
                    clientId={form.client_id}
                    trigger={
                      <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs">
                        <Plus className="h-3 w-3 mr-1" />
                        Agregar
                      </Button>
                    }
                    onSiteAdded={(newSite) => {
                      const updatedClients = clients.map(c => {
                        if (c.id === form.client_id) {
                          return {
                            ...c,
                            construction_sites: [...(c.construction_sites || []), newSite]
                          }
                        }
                        return c
                      })
                      setClients(updatedClients)
                      setForm({ ...form, construction_site_id: newSite.id })
                    }}
                  />
                </div>
                <Select value={form.construction_site_id} onValueChange={(v) => setForm({ ...form, construction_site_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar obra" /></SelectTrigger>
                  <SelectContent>
                    {selectedClient.construction_sites?.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} ({s.travel_time_minutes} min)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {selectedSite && (
              <Card className="bg-muted/50">
                <CardContent className="p-3 text-sm space-y-1">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    <span>Tiempo viaje: {selectedSite.travel_time_minutes} min | Descarga: {selectedSite.unload_time_minutes} min</span>
                  </div>
                  {selectedSite.requires_pump && (
                    <div className="flex items-center gap-2 text-yellow-600">
                      <AlertTriangle className="h-4 w-4" />
                      <span>Requiere bomba</span>
                    </div>
                  )}
                  {selectedSite.reception_hours_start && (
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      <span>Horario: {selectedSite.reception_hours_start?.slice(0, 5)} - {selectedSite.reception_hours_end?.slice(0, 5)}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <div className="space-y-2">
              <Label>Formula *</Label>
              <FormulaCombobox 
                formulas={formulas} 
                value={form.formula_id} 
                onChange={(v) => setForm({ ...form, formula_id: v })} 
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Cantidad Total (m3) *</Label>
                <Input type="number" step="0.5" value={form.quantity_m3} onChange={(e) => setForm({ ...form, quantity_m3: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Capacidad por camion</Label>
                <Input type="number" value={MAX_CAPACITY_M3} disabled className="bg-muted" />
              </div>
            </div>

            {!editingDispatch && numTrips > 1 && (
              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="p-3 text-sm">
                  <div className="flex items-center gap-2 text-blue-800 font-medium">
                    <Truck className="h-4 w-4" />
                    <span>Se crearan {numTrips} viajes</span>
                  </div>
                  <p className="text-blue-600 text-xs mt-1">
                    {tripQuantities.map((q, i) => `Viaje ${i+1}: ${q}m3`).join(" | ")}
                  </p>
                  <p className="text-blue-600 text-xs">
                    Intervalo entre llegadas: {getTripInterval()} min
                  </p>
                </CardContent>
              </Card>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Camion (opcional)</Label>
                <AddMixerDialog
                  plantId={selectedPlant === "all" ? newDispatchPlant : selectedPlant}
                  trigger={
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs">
                      <TruckIcon className="h-3 w-3 mr-1" />
                      Agregar
                    </Button>
                  }
                  onMixerAdded={(newMixer) => {
                    setMixers([...mixers, { ...newMixer, capacity_m3: 8, status: "available" }])
                    setForm({ ...form, mixer_id: newMixer.id })
                  }}
                />
              </div>
              <Select value={form.mixer_id || "none"} onValueChange={(v) => setForm({ ...form, mixer_id: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Asignar despues" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin asignar</SelectItem>
                  {mixers.filter((m) => m.status === "available").map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.license_plate} ({m.capacity_m3}m3)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Observaciones</Label>
              <Textarea value={form.observations} onChange={(e) => setForm({ ...form, observations: e.target.value })} rows={2} />
            </div>
            
            {!editingDispatch && (
              <UserSelector
                value={form.created_by}
                onValueChange={(v) => setForm({ ...form, created_by: v })}
                label="Programado por"
                required
              />
            )}
          </div>

          <DialogFooter className="gap-2">
            {editingDispatch && editingDispatch.status !== "cancelled" && (
              <Button variant="destructive" onClick={() => { cancelDispatch(editingDispatch); setIsDialogOpen(false) }}>
                Cancelar Despacho
              </Button>
            )}
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cerrar</Button>
<Button onClick={handleSave} disabled={saving || !form.client_id || !form.construction_site_id || !form.formula_id}>
  {saving ? "Guardando..." : editingDispatch ? "Guardar" : "Programar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteDispatch} onOpenChange={(open) => !open && setDeleteDispatch(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar Despacho Programado</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <span>¿Estas seguro que deseas eliminar este despacho? Esta accion no se puede deshacer.</span>
                {deleteDispatch && (
                  <div className="mt-2 p-2 bg-muted rounded text-sm">
                    <div><strong>Cliente:</strong> {deleteDispatch.clients?.name}</div>
                    <div><strong>Obra:</strong> {deleteDispatch.construction_sites?.name}</div>
                    <div><strong>Cantidad:</strong> {deleteDispatch.quantity_m3}m3</div>
                    <div><strong>Fecha:</strong> {format(parseISO(deleteDispatch.scheduled_arrival_time), "dd/MM/yyyy HH:mm")}</div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={saving} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {saving ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
