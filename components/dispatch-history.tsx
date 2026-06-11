"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { Search, Download, TrendingUp, Clock, Truck, CheckCircle, XCircle, BarChart3, Pencil, Trash2, MoreHorizontal, FlaskConical, Filter } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { format, parseISO, differenceInMinutes, subDays, startOfMonth, endOfMonth, addDays } from "date-fns"
import { es } from "date-fns/locale"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from "recharts"

type Plant = { id: string; name: string }
type ScheduledDispatch = {
  id: string; quantity_m3: number; scheduled_arrival_time: string; scheduled_departure_time: string;
  actual_departure_time: string | null; actual_arrival_time: string | null; status: string;
  observations: string | null; is_urgent: boolean; source: "scheduled" | "manual";
  clients?: { name: string }; construction_sites?: { name: string; travel_time_minutes: number };
  formulas?: { name: string; code: string }; mixers?: { license_plate: string };
  created_by?: string | null; remito?: string | null; extra_water_liters?: number | null;
  client_id?: string; construction_site_id?: string; formula_id?: string; mixer_id?: string;
  dispatch_id?: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Programado",
  confirmed: "Confirmado",
  loading: "Cargando",
  in_transit: "En Transito",
  delivered: "Entregado",
  cancelled: "Cancelado",
}

export function DispatchHistory({ plants }: { plants: Plant[] }) {
  const [selectedPlant, setSelectedPlant] = useState(plants[0]?.id || "")
  const [dispatches, setDispatches] = useState<ScheduledDispatch[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"))
  const [dateTo, setDateTo] = useState(format(new Date(), "yyyy-MM-dd"))
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [columnFilters, setColumnFilters] = useState<{
    remito: string[]
    cliente: string[]
    obra: string[]
    formula: string[]
    camion: string[]
    responsable: string[]
  }>({
    remito: [],
    cliente: [],
    obra: [],
    formula: [],
    camion: [],
    responsable: [],
  })
  const [editingDispatch, setEditingDispatch] = useState<ScheduledDispatch | null>(null)
  const [editForm, setEditForm] = useState({
    quantity_m3: "",
    remito: "",
    client_id: "",
    construction_site_id: "",
    formula_id: "",
    mixer_id: "",
    observations: "",
    extra_water_liters: "",
  })
  const [formulaSearch, setFormulaSearch] = useState("")
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [sites, setSites] = useState<{ id: string; name: string; client_id: string }[]>([])
  const [formulas, setFormulas] = useState<{ id: string; name: string; code: string }[]>([])
  const [mixers, setMixers] = useState<{ id: string; license_plate: string }[]>([])
  const [deleteDispatch, setDeleteDispatch] = useState<ScheduledDispatch | null>(null)
  const [sampleDispatch, setSampleDispatch] = useState<ScheduledDispatch | null>(null)
  const [sampleNumber, setSampleNumber] = useState("")
  const [lastSampleNumber, setLastSampleNumber] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    if (selectedPlant) loadData()
  }, [selectedPlant, dateFrom, dateTo])

  // Get unique values for column filters
  const getUniqueValues = (column: keyof typeof columnFilters): string[] => {
    const values = new Set<string>()
    dispatches.forEach((d) => {
      let value: string | undefined
      switch (column) {
        case "remito": value = d.remito || "-"; break
        case "cliente": value = d.clients?.name || "-"; break
        case "obra": value = d.construction_sites?.name || "-"; break
        case "formula": value = d.formulas?.code || "-"; break
        case "camion": value = d.mixers?.license_plate || "-"; break
        case "responsable": value = d.created_by || "-"; break
      }
      if (value) values.add(value)
    })
    return Array.from(values).sort()
  }

  // Column filter component
  const ColumnFilter = ({ column, label }: { column: keyof typeof columnFilters; label: string }) => {
    const uniqueValues = getUniqueValues(column)
    const selectedValues = columnFilters[column]
    const [searchValue, setSearchValue] = useState("")

    const toggleValue = (value: string) => {
      if (selectedValues.includes(value)) {
        setColumnFilters({
          ...columnFilters,
          [column]: selectedValues.filter((v) => v !== value),
        })
      } else {
        setColumnFilters({
          ...columnFilters,
          [column]: [...selectedValues, value],
        })
      }
    }

    const clearFilter = () => {
      setColumnFilters({ ...columnFilters, [column]: [] })
      setSearchValue("")
    }

    const filteredUniqueValues = uniqueValues.filter((v) =>
      v.toLowerCase().includes(searchValue.toLowerCase())
    )

    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className={`h-6 px-1 ${selectedValues.length > 0 ? "text-primary" : ""}`}>
            <Filter className="h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[220px] p-3" align="start">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-sm">Filtrar {label}</h4>
              {selectedValues.length > 0 && (
                <Button variant="ghost" size="sm" onClick={clearFilter} className="h-auto p-1 text-xs">
                  Limpiar
                </Button>
              )}
            </div>
            <Input
              placeholder="Buscar..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              className="h-7 text-xs"
            />
            <div className="max-h-[200px] overflow-y-auto space-y-1">
              {filteredUniqueValues.map((value) => (
                <div key={value} className="flex items-center space-x-2">
                  <Checkbox
                    id={`${column}-${value}`}
                    checked={selectedValues.includes(value)}
                    onCheckedChange={() => toggleValue(value)}
                  />
                  <Label htmlFor={`${column}-${value}`} className="text-xs font-normal cursor-pointer flex-1 truncate">
                    {value}
                  </Label>
                </div>
              ))}
              {filteredUniqueValues.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">Sin resultados</p>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    )
  }

  async function loadData() {
    setLoading(true)
    const supabase = createClient()

    // Load scheduled dispatches
    const { data: scheduledData, error: scheduledError } = await supabase
      .from("scheduled_dispatches")
      .select("id, quantity_m3, scheduled_arrival_time, scheduled_departure_time, actual_departure_time, actual_arrival_time, status, observations, is_urgent, client_id, construction_site_id, formula_id, mixer_id, created_by, dispatch_id, clients(name), construction_sites(name, travel_time_minutes), formulas(name, code), mixers(license_plate)")
      .eq("plant_id", selectedPlant)
      .gte("scheduled_arrival_time", `${dateFrom}T00:00:00`)
      .lte("scheduled_arrival_time", `${dateTo}T23:59:59`)
      .order("scheduled_arrival_time", { ascending: false })
      .limit(10000)

    // Load manual dispatches
    const { data: manualData, error: manualError } = await supabase
      .from("dispatches")
      .select("id, quantity_m3, dispatch_date, notes, remito, extra_water_liters, client_id, construction_site_id, formula_id, mixer_id, created_by, clients(name), construction_sites(name), formulas(name, code), mixers(license_plate)")
      .gte("dispatch_date", `${dateFrom}T00:00:00`)
      .lte("dispatch_date", `${dateTo}T23:59:59`)
      .order("dispatch_date", { ascending: false })
      .limit(10000)

    if (scheduledError || manualError) {
      toast({ title: "Error", description: "No se pudieron cargar los datos", variant: "destructive" })
    } else {
      // Transform manual dispatches to match scheduled format
      const transformedManual: ScheduledDispatch[] = (manualData || []).map((d: any) => ({
        id: d.id,
        quantity_m3: d.quantity_m3,
        scheduled_arrival_time: d.dispatch_date,
        scheduled_departure_time: d.dispatch_date,
        actual_departure_time: d.dispatch_date,
        actual_arrival_time: d.dispatch_date,
        status: "delivered",
        observations: d.notes,
        is_urgent: false,
        source: "manual" as const,
        clients: d.clients,
        construction_sites: d.construction_sites ? { name: d.construction_sites.name, travel_time_minutes: 0 } : undefined,
        formulas: d.formulas,
        mixers: d.mixers,
        created_by: d.created_by,
        remito: d.remito,
        extra_water_liters: d.extra_water_liters,
        client_id: d.client_id,
        construction_site_id: d.construction_site_id,
        formula_id: d.formula_id,
        mixer_id: d.mixer_id,
      }))

      // Add source to scheduled dispatches
      // Excluir los programados que ya fueron cargados (tienen dispatch_id),
      // porque esos aparecen desde la tabla "dispatches" con todos los datos editables (remito, etc.)
      const scheduledWithSource = (scheduledData || [])
        .filter((d: any) => !d.dispatch_id)
        .map((d: any) => ({ ...d, source: "scheduled" as const }))

      // Combine and sort by date
      const combined = [...scheduledWithSource, ...transformedManual].sort((a, b) => 
        new Date(b.scheduled_arrival_time).getTime() - new Date(a.scheduled_arrival_time).getTime()
      )
      
      setDispatches(combined)
    }
    setLoading(false)
  }

  const filteredDispatches = dispatches.filter((d) => {
    const term = searchTerm.trim().toLowerCase()
    const matchesSearch =
      term === "" ||
      [
        d.remito,
        d.clients?.name,
        d.construction_sites?.name,
        d.formulas?.code,
        d.formulas?.name,
        d.mixers?.license_plate,
        d.created_by,
        d.observations,
        STATUS_LABELS[d.status],
        d.quantity_m3?.toString(),
        d.scheduled_arrival_time ? format(parseISO(d.scheduled_arrival_time), "dd/MM/yyyy") : "",
      ]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term))
    const matchesStatus = statusFilter === "all" || d.status === statusFilter
    
    // Column filters (arrays)
    const matchesRemito = columnFilters.remito.length === 0 || columnFilters.remito.includes(d.remito || "-")
    const matchesCliente = columnFilters.cliente.length === 0 || columnFilters.cliente.includes(d.clients?.name || "-")
    const matchesObra = columnFilters.obra.length === 0 || columnFilters.obra.includes(d.construction_sites?.name || "-")
    const matchesFormula = columnFilters.formula.length === 0 || columnFilters.formula.includes(d.formulas?.code || "-")
    const matchesCamion = columnFilters.camion.length === 0 || columnFilters.camion.includes(d.mixers?.license_plate || "-")
    const matchesResponsable = columnFilters.responsable.length === 0 || columnFilters.responsable.includes(d.created_by || "-")
    
    return matchesSearch && matchesStatus && matchesRemito && matchesCliente && matchesObra && matchesFormula && matchesCamion && matchesResponsable
  })

  // Calculate metrics
  const totalDispatches = dispatches.length
  const deliveredDispatches = dispatches.filter((d) => d.status === "delivered")
  const cancelledDispatches = dispatches.filter((d) => d.status === "cancelled")
  const totalM3 = deliveredDispatches.reduce((sum, d) => sum + d.quantity_m3, 0)

  // Calculate on-time delivery
  const onTimeDeliveries = deliveredDispatches.filter((d) => {
    if (!d.actual_arrival_time) return true
    const scheduled = parseISO(d.scheduled_arrival_time)
    const actual = parseISO(d.actual_arrival_time)
    return differenceInMinutes(actual, scheduled) <= 15 // 15 min tolerance
  })
  const onTimePercentage = deliveredDispatches.length > 0 ? (onTimeDeliveries.length / deliveredDispatches.length) * 100 : 0

  // Chart data - dispatches per day
  const chartData = dispatches.reduce((acc: any[], d) => {
    const date = format(parseISO(d.scheduled_arrival_time), "dd/MM")
    const existing = acc.find((item) => item.date === date)
    if (existing) {
      existing.total++
      if (d.status === "delivered") existing.delivered++
      if (d.status === "cancelled") existing.cancelled++
      existing.m3 += d.quantity_m3
    } else {
      acc.push({
        date,
        total: 1,
        delivered: d.status === "delivered" ? 1 : 0,
        cancelled: d.status === "cancelled" ? 1 : 0,
        m3: d.quantity_m3,
      })
    }
    return acc
  }, []).reverse()

  async function handleDelete() {
    if (!deleteDispatch) return
    setSaving(true)
    const supabase = createClient()
    if (!supabase) {
      toast({ title: "Error", description: "No se pudo conectar con la base de datos", variant: "destructive" })
      setSaving(false)
      return
    }

    try {
      if (deleteDispatch.source === "manual") {
        // Es un despacho real (tabla "dispatches"): eliminar primero los registros hijos
        // para evitar errores de clave foránea.
        await supabase.from("test_cylinders").delete().eq("dispatch_id", deleteDispatch.id)
        await supabase.from("dispatch_materials").delete().eq("dispatch_id", deleteDispatch.id)

        // Eliminar la programación vinculada a este despacho (si existe), junto con su log.
        // Antes solo se desvinculaba (dispatch_id = null), lo que hacía que la programación
        // volviera a aparecer en el historial y pareciera que el despacho no se eliminaba.
        const { data: linkedScheduled } = await supabase
          .from("scheduled_dispatches")
          .select("id")
          .eq("dispatch_id", deleteDispatch.id)

        if (linkedScheduled && linkedScheduled.length > 0) {
          const scheduledIds = linkedScheduled.map((s: { id: string }) => s.id)
          await supabase.from("dispatch_status_log").delete().in("scheduled_dispatch_id", scheduledIds)
          await supabase.from("scheduled_dispatches").delete().in("id", scheduledIds)
        }

        const { error } = await supabase.from("dispatches").delete().eq("id", deleteDispatch.id)
        if (error) throw error
      } else {
        // Es una programación (tabla "scheduled_dispatches")
        await supabase.from("dispatch_status_log").delete().eq("scheduled_dispatch_id", deleteDispatch.id)
        const { error } = await supabase.from("scheduled_dispatches").delete().eq("id", deleteDispatch.id)
        if (error) throw error
      }

      toast({ title: "Despacho eliminado" })
      loadData()
    } catch (error: any) {
      console.error("[v0] Error deleting dispatch:", error)
      toast({ title: "Error", description: error?.message || "No se pudo eliminar", variant: "destructive" })
    } finally {
      setSaving(false)
      setDeleteDispatch(null)
    }
  }

  async function openEditDialog(dispatch: ScheduledDispatch) {
    setEditingDispatch(dispatch)
    setEditForm({
      quantity_m3: dispatch.quantity_m3.toString(),
      remito: dispatch.remito || "",
      client_id: dispatch.client_id || "",
      construction_site_id: dispatch.construction_site_id || "",
      formula_id: dispatch.formula_id || "",
      mixer_id: dispatch.mixer_id || "",
      observations: dispatch.observations || "",
      extra_water_liters: dispatch.extra_water_liters?.toString() || "",
    })
    setFormulaSearch("")
    
    // Load reference data
    const supabase = createClient()
    
    const [clientsRes, formulasRes, mixersRes, sitesRes] = await Promise.all([
      supabase.from("clients").select("id, name").eq("plant_id", selectedPlant).order("name"),
      supabase.from("formulas").select("id, name, code").order("name"),
      supabase.from("mixers").select("id, license_plate").eq("active", true).order("license_plate"),
      supabase.from("construction_sites").select("id, name, client_id").order("name"),
    ])
    
    setClients(clientsRes.data || [])
    setFormulas(formulasRes.data || [])
    setMixers(mixersRes.data || [])
    setSites(sitesRes.data || [])
  }

  async function handleUpdateDispatch() {
    if (!editingDispatch) return
    setSaving(true)
    const supabase = createClient()
    
    const updateData: any = {
      quantity_m3: parseFloat(editForm.quantity_m3),
    }
    
    // Different tables have different fields
    if (editingDispatch.source === "manual") {
      // Update dispatches table (usa "notes", no "observations")
      const { data, error } = await supabase.from("dispatches").update({
        ...updateData,
        notes: editForm.observations || null,
        remito: editForm.remito || null,
        extra_water_liters: editForm.extra_water_liters ? parseFloat(editForm.extra_water_liters) : null,
        client_id: editForm.client_id || null,
        construction_site_id: editForm.construction_site_id || null,
        formula_id: editForm.formula_id || null,
        mixer_id: editForm.mixer_id || null,
      }).eq("id", editingDispatch.id).select()
      
      if (error) {
        console.log("[v0] Error updating manual dispatch:", error.message, error.details, error.hint, error.code)
        toast({ title: "Error", description: error.message || "No se pudo actualizar", variant: "destructive" })
      } else if (!data || data.length === 0) {
        console.log("[v0] No rows updated for dispatch id:", editingDispatch.id)
        toast({ title: "Error", description: "No se encontro el despacho para actualizar", variant: "destructive" })
      } else {
        toast({ title: "Despacho actualizado" })
        loadData()
        setEditingDispatch(null)
      }
    } else {
      // Update scheduled_dispatches table (esta tabla si tiene "observations")
      const { error } = await supabase.from("scheduled_dispatches").update({
        ...updateData,
        observations: editForm.observations || null,
        client_id: editForm.client_id || null,
        construction_site_id: editForm.construction_site_id || null,
        formula_id: editForm.formula_id || null,
        mixer_id: editForm.mixer_id || null,
      }).eq("id", editingDispatch.id)
      
      if (error) {
        console.log("[v0] Error updating scheduled dispatch:", error.message, error.details, error.hint, error.code)
        toast({ title: "Error", description: error.message || "No se pudo actualizar", variant: "destructive" })
      } else {
        // Si el despacho programado tiene un despacho real asociado (dispatch_id),
        // tambien actualizamos el remito y agua en la tabla dispatches.
        if (editingDispatch.dispatch_id) {
          const { error: dispatchError } = await supabase.from("dispatches").update({
            remito: editForm.remito || null,
            extra_water_liters: editForm.extra_water_liters ? parseFloat(editForm.extra_water_liters) : null,
            quantity_m3: parseFloat(editForm.quantity_m3),
            notes: editForm.observations || null,
          }).eq("id", editingDispatch.dispatch_id)
          if (dispatchError) {
            console.log("[v0] Error updating linked dispatch:", dispatchError.message)
          }
        }
        toast({ title: "Despacho actualizado" })
        loadData()
        setEditingDispatch(null)
      }
    }
    
    setSaving(false)
  }

  async function openSampleDialog(dispatch: ScheduledDispatch) {
    setSampleNumber("")
    setSampleDispatch(dispatch)
    
    // Load last sample number
    const supabase = createClient()
    const { data } = await supabase
      .from("dispatches")
      .select("sample_number")
      .not("sample_number", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .single()
    
    setLastSampleNumber(data?.sample_number || null)
  }

  async function handleSaveSample() {
    if (!sampleDispatch || !sampleNumber.trim()) {
      toast({ title: "Error", description: "Ingrese el numero de muestra", variant: "destructive" })
      return
    }

    setSaving(true)
    const supabase = createClient()
    let dispatchId: string | null = null

    // First check if this dispatch exists in the dispatches table
    const { data: existingDispatch } = await supabase
      .from("dispatches")
      .select("id")
      .eq("id", sampleDispatch.id)
      .single()

    if (existingDispatch) {
      dispatchId = existingDispatch.id
      // Update existing dispatch
      const { error } = await supabase
        .from("dispatches")
        .update({ 
          sample_taken: true, 
          sample_number: sampleNumber.trim() 
        })
        .eq("id", sampleDispatch.id)

      if (error) {
        toast({ title: "Error", description: "No se pudo guardar la muestra", variant: "destructive" })
        setSaving(false)
        return
      }
    } else {
      // This is a scheduled_dispatch, we need to find the linked dispatch
      const { data: scheduledDispatch } = await supabase
        .from("scheduled_dispatches")
        .select("dispatch_id")
        .eq("id", sampleDispatch.id)
        .single()

      if (scheduledDispatch?.dispatch_id) {
        dispatchId = scheduledDispatch.dispatch_id
        // Update the linked dispatch
        const { error } = await supabase
          .from("dispatches")
          .update({ 
            sample_taken: true, 
            sample_number: sampleNumber.trim() 
          })
          .eq("id", scheduledDispatch.dispatch_id)

        if (error) {
          toast({ title: "Error", description: "No se pudo guardar la muestra", variant: "destructive" })
          setSaving(false)
          return
        }
      } else {
        toast({ title: "Error", description: "Este despacho no tiene un registro de entrega asociado", variant: "destructive" })
        setSaving(false)
        return
      }
    }

    // Create test cylinders if dispatch was found and updated
    if (dispatchId) {
      // Check if cylinders already exist
      const { data: existingCylinders } = await supabase
        .from("test_cylinders")
        .select("id")
        .eq("dispatch_id", dispatchId)
        .limit(1)

      if (!existingCylinders || existingCylinders.length === 0) {
        const today = new Date()
        const cylinders = [
          {
            dispatch_id: dispatchId,
            cylinder_number: 1,
            test_age_days: 7,
            scheduled_test_date: format(addDays(today, 7), "yyyy-MM-dd"),
          },
          {
            dispatch_id: dispatchId,
            cylinder_number: 2,
            test_age_days: 28,
            scheduled_test_date: format(addDays(today, 28), "yyyy-MM-dd"),
          },
          {
            dispatch_id: dispatchId,
            cylinder_number: 3,
            test_age_days: 28,
            scheduled_test_date: format(addDays(today, 28), "yyyy-MM-dd"),
          },
        ]

        const { error: cylindersError } = await supabase.from("test_cylinders").insert(cylinders)
        if (cylindersError) {
          console.error("Error creating test cylinders:", cylindersError)
        }
      }

      toast({ title: "Muestra registrada", description: `Muestra ${sampleNumber} con 3 probetas creadas` })
      setSampleDispatch(null)
      loadData()
    }

    setSaving(false)
  }

  function getDeliveryStatus(dispatch: ScheduledDispatch): { text: string; color: string } {
    if (dispatch.status === "cancelled") return { text: "Cancelado", color: "text-red-600" }
    if (dispatch.status !== "delivered") return { text: "-", color: "" }
    if (!dispatch.actual_arrival_time) return { text: "Sin datos", color: "text-muted-foreground" }

    const scheduled = parseISO(dispatch.scheduled_arrival_time)
    const actual = parseISO(dispatch.actual_arrival_time)
    const diff = differenceInMinutes(actual, scheduled)

    if (diff <= 0) return { text: `${Math.abs(diff)} min antes`, color: "text-green-600" }
    if (diff <= 15) return { text: "A tiempo", color: "text-green-600" }
    return { text: `${diff} min tarde`, color: "text-red-600" }
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <Select value={selectedPlant} onValueChange={setSelectedPlant}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Planta" />
          </SelectTrigger>
          <SelectContent>
            {plants.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-[150px]" />
          <span>a</span>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-[150px]" />
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-blue-100">
                <Truck className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalDispatches}</p>
                <p className="text-sm text-muted-foreground">Total Despachos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-green-100">
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{deliveredDispatches.length}</p>
                <p className="text-sm text-muted-foreground">Entregados</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-purple-100">
                <BarChart3 className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalM3.toLocaleString("es-AR")}</p>
                <p className="text-sm text-muted-foreground">m3 Despachados</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-yellow-100">
                <Clock className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{onTimePercentage.toFixed(0)}%</p>
                <p className="text-sm text-muted-foreground">A Tiempo</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      {chartData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* M3 por Dia Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Metros Cubicos por Dia
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}`} />
                  <Tooltip 
                    formatter={(value: number) => [`${value.toFixed(1)} m3`, "Volumen"]}
                    labelFormatter={(label) => `Fecha: ${label}`}
                  />
                  <Bar dataKey="m3" name="m3" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Despachos por Estado Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Truck className="h-4 w-4" />
                Despachos por Dia
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="delivered" name="Entregados" fill="#22c55e" stackId="a" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="cancelled" name="Cancelados" fill="#ef4444" stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Historial de Despachos</CardTitle>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar remito, cliente, obra, formula, camion, estado..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="relative max-h-[600px] overflow-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 z-30 bg-card">
                <TableRow>
                  <TableHead className="sticky left-0 z-40 bg-card w-[90px]">
                    <div className="flex items-center gap-1">
                      Remito
                      <ColumnFilter column="remito" label="Remito" />
                    </div>
                  </TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      Cliente
                      <ColumnFilter column="cliente" label="Cliente" />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      Obra
                      <ColumnFilter column="obra" label="Obra" />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      Formula
                      <ColumnFilter column="formula" label="Formula" />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">m3</TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      Camion
                      <ColumnFilter column="camion" label="Camion" />
                    </div>
                  </TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      Responsable
                      <ColumnFilter column="responsable" label="Responsable" />
                    </div>
                  </TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDispatches.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                      No hay despachos en el periodo seleccionado
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredDispatches.map((dispatch) => {
                    return (
                      <TableRow key={dispatch.id}>
                        <TableCell className="sticky left-0 z-10 bg-card font-mono font-medium w-[90px] truncate">
                          {dispatch.remito || "-"}
                        </TableCell>
                        <TableCell>
                          {format(parseISO(dispatch.scheduled_arrival_time), "dd/MM/yyyy")}
                        </TableCell>
                        <TableCell className="font-medium">{dispatch.clients?.name || "-"}</TableCell>
                        <TableCell>{dispatch.construction_sites?.name}</TableCell>
                        <TableCell>{dispatch.formulas?.code}</TableCell>
                        <TableCell className="text-right">{dispatch.quantity_m3}</TableCell>
                        <TableCell>{dispatch.mixers?.license_plate || "-"}</TableCell>
                        <TableCell>
                          <Badge variant={dispatch.status === "delivered" ? "default" : dispatch.status === "cancelled" ? "destructive" : "secondary"}>
                            {STATUS_LABELS[dispatch.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{dispatch.created_by || "-"}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openSampleDialog(dispatch)}>
                                <FlaskConical className="h-4 w-4 mr-2" />
                                Agregar Muestra
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openEditDialog(dispatch)}>
                                <Pencil className="h-4 w-4 mr-2" />
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setDeleteDispatch(dispatch)} className="text-destructive">
                                <Trash2 className="h-4 w-4 mr-2" />
                                Eliminar
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editingDispatch} onOpenChange={(open) => !open && setEditingDispatch(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar Despacho</DialogTitle>
          </DialogHeader>
          {editingDispatch && (
            <div className="space-y-4 py-4">
              <div className="text-sm text-muted-foreground mb-2">
                Fecha: {format(parseISO(editingDispatch.scheduled_arrival_time), "dd/MM/yyyy HH:mm")}
                <span className="ml-4">Tipo: {editingDispatch.source === "manual" ? "Manual" : "Programado"}</span>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Remito</Label>
                  <Input 
                    value={editForm.remito}
                    onChange={(e) => setEditForm({ ...editForm, remito: e.target.value })}
                    placeholder="Numero de remito"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Cantidad (m3)</Label>
                  <Input 
                    type="number" 
                    step="0.5"
                    value={editForm.quantity_m3}
                    onChange={(e) => setEditForm({ ...editForm, quantity_m3: e.target.value })}
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Cliente</Label>
                  <Select value={editForm.client_id} onValueChange={(v) => setEditForm({ ...editForm, client_id: v, construction_site_id: "" })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar cliente" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[200px]">
                      {clients.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Obra</Label>
                  <Select value={editForm.construction_site_id} onValueChange={(v) => setEditForm({ ...editForm, construction_site_id: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar obra" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[200px]">
                      {sites.filter(s => !editForm.client_id || s.client_id === editForm.client_id).map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Formula</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                        {editForm.formula_id 
                          ? formulas.find(f => f.id === editForm.formula_id)?.name || "Seleccionar..."
                          : "Seleccionar formula..."}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[300px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Buscar formula..." />
                        <CommandList className="max-h-[200px]">
                          <CommandEmpty>No se encontro formula.</CommandEmpty>
                          <CommandGroup>
                            {formulas.map((f) => (
                              <CommandItem
                                key={f.id}
                                value={`${f.name} ${f.code}`}
                                onSelect={() => setEditForm({ ...editForm, formula_id: f.id })}
                              >
                                <Check className={cn("mr-2 h-4 w-4", editForm.formula_id === f.id ? "opacity-100" : "opacity-0")} />
                                <span className="font-medium">{f.name}</span>
                                <span className="ml-2 text-muted-foreground text-xs">({f.code})</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label>Camion</Label>
                  <Select value={editForm.mixer_id} onValueChange={(v) => setEditForm({ ...editForm, mixer_id: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar camion" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[200px]">
                      {mixers.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.license_plate}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Agua agregada en planta (litros)</Label>
                  <Input 
                    type="number"
                    step="1"
                    value={editForm.extra_water_liters}
                    onChange={(e) => setEditForm({ ...editForm, extra_water_liters: e.target.value })}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Observaciones</Label>
                  <Input 
                    value={editForm.observations}
                    onChange={(e) => setEditForm({ ...editForm, observations: e.target.value })}
                    placeholder="Observaciones adicionales"
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingDispatch(null)}>Cancelar</Button>
            <Button disabled={saving} onClick={handleUpdateDispatch}>
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Sample Dialog */}
      <Dialog open={!!sampleDispatch} onOpenChange={(open) => !open && setSampleDispatch(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5" />
              Agregar Muestra de Probeta
            </DialogTitle>
          </DialogHeader>
          {sampleDispatch && (
            <div className="space-y-4 py-4">
              <div className="p-3 rounded-lg bg-muted/50 space-y-1 text-sm">
                <p><span className="text-muted-foreground">Cliente:</span> <span className="font-medium">{sampleDispatch.clients?.name}</span></p>
                <p><span className="text-muted-foreground">Obra:</span> <span className="font-medium">{sampleDispatch.construction_sites?.name}</span></p>
                <p><span className="text-muted-foreground">Formula:</span> <span className="font-medium">{sampleDispatch.formulas?.code} - {sampleDispatch.formulas?.name}</span></p>
                <p><span className="text-muted-foreground">Cantidad:</span> <span className="font-medium">{sampleDispatch.quantity_m3} m3</span></p>
                <p><span className="text-muted-foreground">Fecha:</span> <span className="font-medium">{format(parseISO(sampleDispatch.scheduled_arrival_time), "dd/MM/yyyy HH:mm")}</span></p>
              </div>

              {lastSampleNumber && (
                <div className="flex items-center gap-2 p-2 rounded bg-blue-50 border border-blue-200">
                  <span className="text-xs text-blue-700">Ultima muestra registrada:</span>
                  <span className="font-mono font-semibold text-blue-900">{lastSampleNumber}</span>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="sampleNumber">Numero de Muestra *</Label>
                <Input
                  id="sampleNumber"
                  value={sampleNumber}
                  onChange={(e) => setSampleNumber(e.target.value)}
                  placeholder="Ej: M-001"
                  className="font-mono"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSampleDispatch(null)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveSample} disabled={saving || !sampleNumber.trim()}>
              {saving ? "Guardando..." : "Guardar Muestra"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteDispatch} onOpenChange={(open) => !open && setDeleteDispatch(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar Despacho</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <span>¿Estas seguro que deseas eliminar este despacho? Esta accion no se puede deshacer.</span>
                {deleteDispatch && (
                  <div className="mt-2 p-2 bg-muted rounded text-sm">
                    <div><strong>Cliente:</strong> {deleteDispatch.clients?.name}</div>
                    <div><strong>Obra:</strong> {deleteDispatch.construction_sites?.name}</div>
                    <div><strong>Cantidad:</strong> {deleteDispatch.quantity_m3}m3</div>
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
