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
import { Plus, ChevronLeft, ChevronRight, Clock, MapPin, Truck, AlertTriangle, X, Calendar, Check, ChevronsUpDown, MoreHorizontal, Pencil, Trash2, UserPlus, TruckIcon, Printer, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { format, addDays, startOfWeek, addWeeks, subWeeks, isSameDay, parseISO, setHours, setMinutes, addMinutes } from "date-fns"
import { es } from "date-fns/locale"
import { AddClientDialog } from "@/components/add-client-dialog"
import { AddMixerDialog } from "@/components/add-mixer-dialog"
import { AddConstructionSiteDialog } from "@/components/add-construction-site-dialog"
import { UserSelector } from "@/components/user-selector"
import { currentUserName, useFuncionesNuevas } from "@/lib/current-user"
import { logActivity } from "@/lib/activity-log"
import { FINALIDADES, cargarEmpresasBombeo, textoBomba, type EmpresaBombeo } from "@/lib/maestros"
// Fase 2 (solo con el interruptor de funciones nuevas)
import { NuevoBadge } from "@/components/nuevo-badge"
import { GerenciadorViajes, type PedidoGerenciador } from "@/components/gerenciador-viajes"
import { parametrosDePlanta, type Parametros } from "@/lib/planificador"
import { cargarViajes, generarViajes, chocaEnBoca, horariosSinChoque, regenerarViajesPedido, totalViajes, type ViajeRow, type OtroPedido, type PedidoParaViajes } from "@/lib/viajes"

type Plant = { id: string; name: string }
type Client = { id: string; name: string; cuit?: string | null; construction_sites?: ConstructionSite[] }
type ConstructionSite = {
  id: string; name: string; address: string | null; client_id: string;
  travel_time_minutes: number; unload_time_minutes: number; requires_pump: boolean;
  reception_hours_start: string | null; reception_hours_end: string | null;
}
type Mixer = { id: string; license_plate: string; capacity_m3: number; status: string }
type Formula = { id: string; name: string; code: string; useful_life_minutes: number; plant_id: string }
type ScheduledDispatch = {
  id: string; plant_id: string; client_id: string; construction_site_id: string;
  formula_id: string; mixer_id: string | null; quantity_m3: number;
  scheduled_arrival_time: string; scheduled_departure_time: string; status: string;
  observations: string | null; is_urgent: boolean; fiber_kg_per_m3?: number | null; metodo_descarga?: "bomba" | "directo" | null;
  created_by?: string | null;
  // Fase 1 (nulos hasta aplicar la migración)
  finalidad?: string | null; bomba_la_pone?: "rebucret" | "cliente" | null; bomba_empresa_id?: string | null; bomba_hora?: string | null;
  // Fase 2 (nulos hasta aplicar la migración)
  m3_por_viaje?: number | null; espaciado_min?: number | null; confirmado_at?: string | null; confirmado_por?: string | null;
  dispatched_m3?: number | null;
  clients?: Client; construction_sites?: ConstructionSite; formulas?: Formula; mixers?: Mixer;
}

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800 border-blue-300",
  confirmed: "bg-green-100 text-green-800 border-green-300",
  loading: "bg-yellow-100 text-yellow-800 border-yellow-300",
  in_transit: "bg-purple-100 text-purple-800 border-purple-300",
  delivered: "bg-gray-100 text-gray-800 border-gray-300",
  completed: "bg-green-100 text-green-800 border-green-400",
  cancelled: "bg-red-100 text-red-800 border-red-300 line-through",
}

const PLANT_BADGE_COLORS = [
  "bg-emerald-100 text-emerald-800 border-emerald-300",
  "bg-orange-100 text-orange-800 border-orange-300",
  "bg-sky-100 text-sky-800 border-sky-300",
  "bg-pink-100 text-pink-800 border-pink-300",
]

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
          {selectedFormula ? (selectedFormula.name && selectedFormula.name !== selectedFormula.code ? `${selectedFormula.name} (${selectedFormula.code})` : selectedFormula.code) : "Buscar formula..."}
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
                  <span className="font-medium">{f.code}</span>
                  {f.name && f.name !== f.code && <span className="ml-2 text-muted-foreground text-xs">{f.name}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** Selector con búsqueda por texto, para listas largas (clientes, obras). */
export function SearchableSelect({
  items,
  value,
  onChange,
  placeholder = "Buscar...",
  emptyText = "Sin resultados",
  disabled = false,
}: {
  items: { id: string; label: string; hint?: string }[]
  value: string
  onChange: (v: string) => void
  placeholder?: string
  emptyText?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const selected = items.find((i) => i.id === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[280px] p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} />
          <CommandList className="max-h-[220px]">
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {items.map((i) => (
                <CommandItem
                  key={i.id}
                  value={`${i.label} ${i.hint || ""}`}
                  onSelect={() => {
                    onChange(i.id)
                    setOpen(false)
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === i.id ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{i.label}</span>
                  {i.hint && <span className="ml-2 text-muted-foreground text-xs truncate">{i.hint}</span>}
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
  const [empresasBombeo, setEmpresasBombeo] = useState<EmpresaBombeo[]>([])
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
  const [cuitPrompt, setCuitPrompt] = useState("")
  const { toast } = useToast()
  // Fase 2: viajes, solo para los usuarios con el interruptor de funciones nuevas
  const ve = useFuncionesNuevas()
  const [viajesPorPedido, setViajesPorPedido] = useState<Record<string, ViajeRow[]>>({})
  const [paramsPorPlanta, setParamsPorPlanta] = useState<Record<string, Parametros>>({})
  const [gerenciar, setGerenciar] = useState<PedidoGerenciador | null>(null)

  const [form, setForm] = useState({
    plant_id: "",
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
    fiber_kg_per_m3: "",
    metodo_descarga: "" as "" | "bomba" | "directo",
    // Fase 1
    finalidad: "",
    bomba_la_pone: "" as "" | "rebucret" | "cliente",
    bomba_empresa_id: "",
    bomba_hora: "", // HH:mm; por defecto, la hora de llegada del primer camión
    // Fase 2
    m3_por_viaje: "8",
    espaciado_min: "",
  })

  // Mapa de id de planta -> nombre, para mostrar referencia de planta en cada despacho
  const plantNameById = useMemo(() => {
    const map: Record<string, string> = {}
    plants.forEach((p) => (map[p.id] = p.name))
    return map
  }, [plants])

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i))
  }, [currentWeekStart])

  useEffect(() => {
    loadData()
  }, [selectedPlant, currentWeekStart, ve]) // eslint-disable-line react-hooks/exhaustive-deps


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

    const [dispatchesRes, clientsRes, mixersRes, formulasRes, empresasRes] = await Promise.all([
      dispatchesQuery,
      supabase.from("clients").select("*, construction_sites(*)").eq("active", true).order("name"),
      supabase.from("mixers").select("*").eq("active", true).order("license_plate"),
      // Cargar todas las fórmulas con su planta (para filtrar el combo por planta del despacho)
      supabase.from("formulas").select("id, name, code, useful_life_minutes, plant_id").order("code"),
      cargarEmpresasBombeo(supabase),
    ])

    setDispatches(dispatchesRes.data || [])
    setClients(clientsRes.data || [])
    setMixers(mixersRes.data || [])
    setFormulas(formulasRes.data || [])
    setEmpresasBombeo(empresasRes)
    setLoading(false)
    // Fase 2: viajes de la semana y tiempos de cada planta (solo con el interruptor)
    if (ve) {
      const [vs, { data: pls }] = await Promise.all([
        cargarViajes(supabase, (dispatchesRes.data || []).map((d: any) => d.id)),
        supabase.from("plants").select("*"),
      ])
      setViajesPorPedido(vs)
      setParamsPorPlanta(Object.fromEntries(((pls as any[]) || []).map((pl) => [pl.id, parametrosDePlanta(pl)])))
    }
  }

  const selectedClient = clients.find((c) => c.id === form.client_id)
  const selectedSite = selectedClient?.construction_sites?.find((s) => s.id === form.construction_site_id)

  // Fase 2: "Empieza a cargar a las…" y choque en la boca de carga con otro pedido de la misma planta
  const sugerencia = useMemo(() => {
    if (!ve || !isDialogOpen || !form.plant_id || !form.arrival_date || !form.arrival_time || !form.metodo_descarga) return null
    const prm = paramsPorPlanta[form.plant_id]
    const m3 = parseFloat(form.quantity_m3)
    if (!prm || !(m3 > 0)) return null
    const llegada = new Date(`${form.arrival_date}T${form.arrival_time}:00`)
    if (isNaN(llegada.getTime())) return null
    const base: PedidoParaViajes = {
      id: editingDispatch?.id || "nuevo", plant_id: form.plant_id, quantity_m3: m3,
      dispatched_m3: editingDispatch?.dispatched_m3 ?? 0, scheduled_arrival_time: llegada.toISOString(),
      metodo_descarga: form.metodo_descarga, m3_por_viaje: parseFloat(form.m3_por_viaje) || 8,
      espaciado_min: parseInt(form.espaciado_min) || null,
      construction_sites: selectedSite ? { travel_time_minutes: selectedSite.travel_time_minutes, requires_pump: selectedSite.requires_pump } : null,
    }
    const existentes = editingDispatch ? viajesPorPedido[editingDispatch.id] || [] : []
    const armar = (d: Date) => generarViajes({ ...base, scheduled_arrival_time: d.toISOString() }, prm, existentes)
    const otros: OtroPedido[] = dispatches
      .filter((d) => d.plant_id === form.plant_id && d.id !== editingDispatch?.id && d.status !== "cancelled" && isSameDay(parseISO(d.scheduled_arrival_time), llegada))
      .map((d) => ({
        id: d.id,
        obra: d.construction_sites?.name || d.clients?.name || "otro pedido",
        viajes: viajesPorPedido[d.id]?.length ? viajesPorPedido[d.id] : generarViajes(d as unknown as PedidoParaViajes, paramsPorPlanta[d.plant_id] || prm, []),
      }))
    const vs = armar(llegada)
    if (!vs.length) return null
    const choque = chocaEnBoca(vs, otros, prm)
    return { carga: vs[0].hora_carga, viajes: vs.length, choque, sug: choque ? horariosSinChoque(llegada, armar, otros, prm) : null }
  }, [ve, isDialogOpen, form, paramsPorPlanta, editingDispatch, viajesPorPedido, dispatches, selectedSite])

  function usarLlegada(d: Date) {
    const h = format(d, "HH:mm")
    setForm({ ...form, arrival_time: h, bomba_hora: form.bomba_hora === form.arrival_time ? h : form.bomba_hora })
  }

  function calculateDepartureTime(arrivalTime: string, site: ConstructionSite | undefined): string {
    if (!site || !arrivalTime) return arrivalTime
    const arrival = parseISO(arrivalTime)
    const departure = addMinutes(arrival, -(site.travel_time_minutes || 30))
    return departure.toISOString()
  }

  function openNewDispatch(date: Date, hour: number) {
    setSelectedDate(date)
    setSelectedHour(hour)
    setEditingDispatch(null)
    setForm({
      plant_id: selectedPlant === "all" ? (newDispatchPlant || plants[0]?.id || "") : selectedPlant,
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
      fiber_kg_per_m3: "",
      metodo_descarga: "",
      finalidad: "",
      bomba_la_pone: "",
      bomba_empresa_id: "",
      bomba_hora: "",
      m3_por_viaje: "8",
      espaciado_min: "",
    })
    setEditingDispatch(null)
    setCuitPrompt("")
    setIsDialogOpen(true)
  }

  function openEditDispatch(dispatch: ScheduledDispatch) {
    setEditingDispatch(dispatch)
    const arrival = parseISO(dispatch.scheduled_arrival_time)
    setForm({
      plant_id: dispatch.plant_id,
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
      fiber_kg_per_m3: dispatch.fiber_kg_per_m3 != null ? String(dispatch.fiber_kg_per_m3) : "",
      metodo_descarga: dispatch.metodo_descarga || "",
      finalidad: dispatch.finalidad || "",
      bomba_la_pone: dispatch.bomba_la_pone || "",
      bomba_empresa_id: dispatch.bomba_empresa_id || "",
      bomba_hora: dispatch.bomba_hora ? format(parseISO(dispatch.bomba_hora), "HH:mm") : "",
      m3_por_viaje: dispatch.m3_por_viaje != null ? String(dispatch.m3_por_viaje) : "8",
      espaciado_min: dispatch.espaciado_min != null ? String(dispatch.espaciado_min) : "",
    })
    setEditingDispatch(dispatch)
    setCuitPrompt("")
    setIsDialogOpen(true)
  }

  async function handleSave() {
    if (saving) return // Prevenir doble click
    if (!form.metodo_descarga) {
      toast({ title: "Falta el método de descarga", description: "Elegí si el pedido va con bomba o directo. Define cuánto tarda cada camión en obra.", variant: "destructive" })
      return
    }
    setSaving(true)
    
    try {
      const supabase = createClient()

      // Si el cliente seleccionado no tiene CUIT y se ingresó uno en el aviso, lo asociamos ahora (con anti-duplicado)
      if (selectedClient && !selectedClient.cuit && cuitPrompt.trim()) {
        const { data: dup } = await supabase
          .from("clients").select("id, name").eq("cuit", cuitPrompt.trim()).neq("active", false).limit(1)
        if (dup && dup.length > 0 && dup[0].id !== selectedClient.id) {
          toast({ title: "CUIT duplicado", description: `Ese CUIT ya es de ${dup[0].name}.`, variant: "destructive" })
          setSaving(false)
          return
        }
        await supabase.from("clients").update({ cuit: cuitPrompt.trim() }).eq("id", selectedClient.id)
        setClients(clients.map((c) => (c.id === selectedClient.id ? { ...c, cuit: cuitPrompt.trim() } : c)))
      }

      // La planta a usar viene del formulario (preseleccionada con la planta real del despacho al editar,
      // o con la planta del filtro/selector al crear). Esto evita reasignar la planta por accidente al editar.
      const plantToUse = form.plant_id || (selectedPlant === "all" ? newDispatchPlant : selectedPlant)
      // Convertir hora local del browser a UTC para guardar con timezone correcta
      const arrivalTime = new Date(`${form.arrival_date}T${form.arrival_time}:00`).toISOString()
      const departureTime = calculateDepartureTime(arrivalTime, selectedSite)
      // Fase 1: finalidad y bomba (con descarga directa no se guarda nada de bomba)
      const conBomba = form.metodo_descarga === "bomba"
      const datosFase1 = {
        finalidad: form.finalidad || null,
        bomba_la_pone: conBomba ? form.bomba_la_pone || null : null,
        bomba_empresa_id: conBomba && form.bomba_la_pone === "rebucret" ? form.bomba_empresa_id || null : null,
        bomba_hora: conBomba ? new Date(`${form.arrival_date}T${form.bomba_hora || form.arrival_time}:00`).toISOString() : null,
      }
      // Fase 2: m³ por camión y espaciado (solo los manda quien tiene el interruptor; si no, quedan como estaban)
      const datosFase2 = ve
        ? { m3_por_viaje: parseFloat(form.m3_por_viaje) > 0 ? parseFloat(form.m3_por_viaje) : 8, espaciado_min: parseInt(form.espaciado_min) > 0 ? parseInt(form.espaciado_min) : null }
        : {}
      let pedidoId: string | null = editingDispatch?.id || null

      if (editingDispatch) {
        // Editar despacho existente
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
          fiber_kg_per_m3: form.fiber_kg_per_m3 ? parseFloat(form.fiber_kg_per_m3) : null,
          metodo_descarga: form.metodo_descarga,
          ...datosFase1,
          ...datosFase2,
        }).eq("id", editingDispatch.id)
        if (error) {
          toast({ title: "Error", description: "No se pudo actualizar", variant: "destructive" })
          setSaving(false)
          return
        }
        toast({ title: "Despacho actualizado" })
      } else {
        // Crear un único pedido con el total de m3
        const fila = {
          plant_id: plantToUse,
          client_id: form.client_id,
          construction_site_id: form.construction_site_id,
          formula_id: form.formula_id,
          mixer_id: null,
          quantity_m3: parseFloat(form.quantity_m3),
          scheduled_arrival_time: arrivalTime,
          scheduled_departure_time: departureTime,
          observations: form.observations || null,
          is_urgent: form.is_urgent,
          created_by: form.created_by || currentUserName(),
          fiber_kg_per_m3: form.fiber_kg_per_m3 ? parseFloat(form.fiber_kg_per_m3) : null,
          metodo_descarga: form.metodo_descarga,
          ...datosFase1,
          ...datosFase2,
        }
        // Con el interruptor se pide el id para armar los viajes; sin él, el insert es el de siempre
        const { data: creado, error } = ve
          ? await supabase.from("scheduled_dispatches").insert(fila as any).select("id").single()
          : await supabase.from("scheduled_dispatches").insert(fila as any)
        pedidoId = (creado as any)?.id || null
        if (error) {
          toast({ title: "Error", description: "No se pudo crear", variant: "destructive" })
          setSaving(false)
          return
        }
        toast({ title: "Despacho programado", description: `${form.quantity_m3} m3` })
      }

      // Fase 2: viajes. Con el interruptor se arman siempre; sin él, solo se regeneran si el pedido ya tenía.
      if (pedidoId && (ve || editingDispatch)) {
        const r = await regenerarViajesPedido(supabase, pedidoId, currentUserName(), { soloSiTiene: !ve })
        if (r.error) toast({ title: "El pedido se guardó, pero los viajes no", description: r.error, variant: "destructive" })
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
            <Button onClick={() => loadData()} variant="outline" size="sm" className="gap-2" disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              <span className="hidden sm:inline">Actualizar</span>
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
                              {selectedPlant === "all" && plantNameById[d.plant_id] && (
                                <span
                                  className={cn(
                                    "inline-block text-[9px] font-semibold px-1 py-0 rounded border mb-0.5 leading-tight",
                                    PLANT_BADGE_COLORS[plants.findIndex((p) => p.id === d.plant_id) % PLANT_BADGE_COLORS.length] || "bg-gray-100 text-gray-700 border-gray-300",
                                  )}
                                >
                                  {plantNameById[d.plant_id]}
                                </span>
                              )}
                              <div className="font-medium truncate">{d.clients?.name}</div>
                              <div className="flex items-center gap-1 text-[10px]">
                                <span>{d.quantity_m3}m3</span>
                                {d.metodo_descarga && <span>· {d.metodo_descarga === "bomba" ? "bomba" : "directo"}</span>}
                                {d.mixers && <span>| {d.mixers.license_plate}</span>}
                              </div>
                              {/* Fase 2: viajes y confirmación (solo con el interruptor) */}
                              {ve && (viajesPorPedido[d.id]?.length || d.confirmado_at) ? (
                                <div className="flex items-center gap-1 text-[10px] text-violet-800">
                                  {viajesPorPedido[d.id]?.length ? <span>{totalViajes(viajesPorPedido[d.id])} viajes</span> : null}
                                  {d.confirmado_at && <span title={`Confirmado por ${d.confirmado_por || "-"}`}>· 👍</span>}
                                </div>
                              ) : null}
                              {/* Fase 1: quién pone la bomba, empresa y hora */}
                              {d.metodo_descarga === "bomba" && d.bomba_la_pone && (
                                <div className="text-[10px] truncate text-sky-800" title={textoBomba(d, empresasBombeo) || undefined}>
                                  {(textoBomba(d, empresasBombeo, "") || "").replace(/^ · /, "").replace(/^ \(cliente\)$/, "la trae el cliente")}
                                </div>
                              )}
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100">
                                  <MoreHorizontal className="h-3 w-3" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => window.open(`/api/remito/${d.id}`, '_blank')}>
                                  <Printer className="h-4 w-4 mr-2" />
                                  Visualizar Remito
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => openEditDispatch(d)}>
                                  <Pencil className="h-4 w-4 mr-2" />
                                  Editar
                                </DropdownMenuItem>
                                {ve && (
                                  <DropdownMenuItem onClick={() => setGerenciar(d as unknown as PedidoGerenciador)}>
                                    <Truck className="h-4 w-4 mr-2" />
                                    Viajes <NuevoBadge className="ml-2" />
                                  </DropdownMenuItem>
                                )}
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
            {/* Selector de planta: siempre visible para ver/elegir a qué planta pertenece el despacho */}
            <div className="space-y-2">
              <Label>Planta *</Label>
              <Select value={form.plant_id} onValueChange={(v) => setForm({ ...form, plant_id: v })}>
                <SelectTrigger><SelectValue placeholder="Seleccionar planta" /></SelectTrigger>
                <SelectContent>
                  {plants.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Fecha de Llegada *</Label>
                <Input type="date" value={form.arrival_date} onChange={(e) => setForm({ ...form, arrival_date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Hora de Llegada *</Label>
                <Input type="time" value={form.arrival_time} onChange={(e) => setForm({ ...form, arrival_time: e.target.value, bomba_hora: form.bomba_hora === form.arrival_time ? e.target.value : form.bomba_hora })} />
              </div>
            </div>

            {/* Fase 2: cuándo empieza a cargar y si choca en la boca de carga (solo con el interruptor) */}
            {ve && sugerencia && (
              <div className={cn("rounded-md border px-3 py-2 text-sm space-y-2", sugerencia.choque ? "border-red-300 bg-red-50" : "bg-muted/40")}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span>Empieza a cargar a las <strong>{format(parseISO(sugerencia.carga), "HH:mm")}</strong> · {sugerencia.viajes} {sugerencia.viajes === 1 ? "viaje" : "viajes"}</span>
                  <NuevoBadge />
                </div>
                {sugerencia.choque && (
                  <div className="space-y-1.5">
                    <p className="text-red-700 font-medium flex items-center gap-1"><AlertTriangle className="h-4 w-4" />Choca con {sugerencia.choque} en la boca de carga</p>
                    <div className="flex gap-2 flex-wrap">
                      {sugerencia.sug?.antes && <Button type="button" size="sm" variant="outline" className="h-7 bg-background" onClick={() => usarLlegada(sugerencia.sug!.antes!)}>Llegada {format(sugerencia.sug.antes, "HH:mm")} (antes)</Button>}
                      {sugerencia.sug?.despues && <Button type="button" size="sm" variant="outline" className="h-7 bg-background" onClick={() => usarLlegada(sugerencia.sug!.despues!)}>Llegada {format(sugerencia.sug.despues, "HH:mm")} (después)</Button>}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Cliente *</Label>
                <AddClientDialog
                  plantId={form.plant_id || (selectedPlant === "all" ? newDispatchPlant : selectedPlant)}
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

            {selectedClient && !selectedClient.cuit && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-2">
                <p className="text-xs text-amber-800 dark:text-amber-200 font-medium">
                  Este cliente no tiene CUIT. Agregalo para identificarlo y evitar duplicados.
                </p>
                <Input value={cuitPrompt} onChange={(e) => setCuitPrompt(e.target.value)} placeholder="CUIT del cliente" />
              </div>
            )}

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
              <Label>Descarga *</Label>
              <div className="grid grid-cols-2 gap-2">
                {([["bomba", "Con bomba", "Más rápido: ~15 min por camión"], ["directo", "Directo / canaleta", "~25 min por camión"]] as const).map(([v, l, d]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setForm({ ...form, metodo_descarga: v, bomba_hora: v === "bomba" && !form.bomba_hora ? form.arrival_time : form.bomba_hora })}
                    className={cn(
                      "rounded-lg border-2 p-2 text-left transition-colors",
                      form.metodo_descarga === v ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                    )}
                  >
                    <p className="text-sm font-medium">{l}</p>
                    <p className="text-xs text-muted-foreground">{d}</p>
                  </button>
                ))}
              </div>
              {!form.metodo_descarga && selectedSite?.requires_pump && (
                <p className="text-xs text-muted-foreground">Esta obra suele trabajar con bomba.</p>
              )}
            </div>

            {/* Bomba de terceros (fase 1): solo cuando el pedido va con bomba */}
            {form.metodo_descarga === "bomba" && (
              <div className="rounded-lg border border-sky-200 bg-sky-50/50 p-3 space-y-3">
                <div className="space-y-2">
                  <Label>¿Quién pone la bomba?</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {([["rebucret", "Rebucret la contrata"], ["cliente", "La trae el cliente"]] as const).map(([v, l]) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setForm({ ...form, bomba_la_pone: v, bomba_empresa_id: v === "cliente" ? "" : form.bomba_empresa_id })}
                        className={cn(
                          "rounded-lg border-2 p-2 text-left text-sm font-medium transition-colors bg-background",
                          form.bomba_la_pone === v ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                        )}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {form.bomba_la_pone === "rebucret" && (
                    <div className="space-y-2">
                      <Label>Empresa de bomba</Label>
                      <Select value={form.bomba_empresa_id || "none"} onValueChange={(v) => setForm({ ...form, bomba_empresa_id: v === "none" ? "" : v })}>
                        <SelectTrigger className="bg-background"><SelectValue placeholder="A confirmar" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">A confirmar</SelectItem>
                          {empresasBombeo
                            .filter((e) => e.activo || e.id === form.bomba_empresa_id)
                            .map((e) => <SelectItem key={e.id} value={e.id}>{e.nombre}{!e.activo ? " (de baja)" : ""}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {empresasBombeo.filter((e) => e.activo).length === 0 && (
                        <p className="text-xs text-muted-foreground">Cargá las empresas en Camiones › Bombas.</p>
                      )}
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Hora de la bomba en obra</Label>
                    <Input type="time" className="bg-background" value={form.bomba_hora || form.arrival_time} onChange={(e) => setForm({ ...form, bomba_hora: e.target.value })} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">La empresa se puede confirmar el día anterior: la vista Día avisa si falta.</p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Formula *</Label>
              <FormulaCombobox
                formulas={formulas.filter((f) => !form.plant_id || f.plant_id === form.plant_id)}
                value={form.formula_id}
                onChange={(v) => setForm({ ...form, formula_id: v })}
              />
            </div>

            {/* Finalidad (fase 1), opcional, junto a la fórmula */}
            <div className="space-y-2">
              <Label>Finalidad</Label>
              <Select value={form.finalidad || "none"} onValueChange={(v) => setForm({ ...form, finalidad: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Sin especificar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin especificar</SelectItem>
                  {FINALIDADES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  {form.finalidad && !(FINALIDADES as readonly string[]).includes(form.finalidad) && <SelectItem value={form.finalidad}>{form.finalidad}</SelectItem>}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Cantidad Total (m3) *</Label>
              <Input type="number" step="0.5" value={form.quantity_m3} onChange={(e) => setForm({ ...form, quantity_m3: e.target.value })} placeholder="Ej: 40" />
            </div>

            {/* Fase 2: cómo se parte en viajes (solo con el interruptor) */}
            {ve && (
              <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 space-y-2">
                <div className="flex items-center gap-2"><Label>Viajes</Label><NuevoBadge /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">m³ por camión</Label>
                    <Input type="number" step="0.5" min="0.5" className="bg-background" value={form.m3_por_viaje} onChange={(e) => setForm({ ...form, m3_por_viaje: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Minutos entre camiones</Label>
                    <Input type="number" min="1" className="bg-background" value={form.espaciado_min} onChange={(e) => setForm({ ...form, espaciado_min: e.target.value })} placeholder="Lo que tarda en descargar" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Al guardar se arman los viajes. El último camión lleva el resto. Los viajes no tocan stock.</p>
              </div>
            )}

            {/* Fibra: se define en el pedido para que el plantista sepa
                que ese hormigón la lleva; el valor se propone al cargar cada camión. */}
            <div className="space-y-2">
              <Label>Fibra (kg por m3)</Label>
              <Input
                type="number"
                step="0.1"
                min="0"
                value={form.fiber_kg_per_m3}
                onChange={(e) => setForm({ ...form, fiber_kg_per_m3: e.target.value })}
                placeholder="Dejar vacio si no lleva"
              />
              {form.fiber_kg_per_m3 && parseFloat(form.fiber_kg_per_m3) > 0 && parseFloat(form.quantity_m3) > 0 && (
                <p className="text-xs text-muted-foreground">
                  Total estimado del pedido:{" "}
                  <span className="font-semibold text-foreground">
                    {(parseFloat(form.fiber_kg_per_m3) * parseFloat(form.quantity_m3)).toLocaleString("es-AR", { maximumFractionDigits: 2 })} kg
                  </span>{" "}
                  ({form.fiber_kg_per_m3} kg/m³ × {form.quantity_m3} m³)
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Camion (opcional)</Label>
                <AddMixerDialog
                  plantId={form.plant_id || (selectedPlant === "all" ? newDispatchPlant : selectedPlant)}
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
<Button onClick={handleSave} disabled={saving || !form.plant_id || !form.client_id || !form.construction_site_id || !form.formula_id || !form.metodo_descarga}>
  {saving ? "Guardando..." : editingDispatch ? "Guardar" : "Programar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fase 2: gerenciador de viajes */}
      <GerenciadorViajes pedido={gerenciar} open={!!gerenciar} onOpenChange={(v) => !v && setGerenciar(null)} onGuardado={() => loadData()} />

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
