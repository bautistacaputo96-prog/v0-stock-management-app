"use client"

import { useState, useEffect, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { Play, Truck, CheckCircle, Clock, MapPin, AlertTriangle, RefreshCw, ArrowRight, Plus, ChevronLeft, ChevronRight, CalendarDays, Pencil, X } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { format, parseISO, differenceInMinutes, addMinutes, addDays, subDays, isToday, isTomorrow, isYesterday } from "date-fns"
import { es } from "date-fns/locale"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { AddDispatchDialog } from "@/components/add-dispatch-dialog"

type Plant = { id: string; name: string }
type ScheduledDispatch = {
  id: string; client_id: string; construction_site_id: string; formula_id: string; mixer_id: string | null;
  quantity_m3: number; scheduled_arrival_time: string; scheduled_departure_time: string;
  actual_load_start_time: string | null; actual_departure_time: string | null;
  status: string; observations: string | null; is_urgent: boolean;
  clients?: { id: string; name: string };
  construction_sites?: { id: string; name: string; address: string | null; travel_time_minutes: number; unload_time_minutes: number; requires_pump: boolean };
  formulas?: { id: string; name: string; code: string; useful_life_minutes: number };
  mixers?: { id: string; license_plate: string; capacity_m3: number };
}
type Mixer = { id: string; license_plate: string; capacity_m3: number; status: string }

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  scheduled: { label: "Programado", color: "bg-blue-500", icon: Clock },
  confirmed: { label: "Confirmado", color: "bg-green-500", icon: CheckCircle },
  loading: { label: "Cargando", color: "bg-yellow-500", icon: Play },
  in_transit: { label: "En Transito", color: "bg-purple-500", icon: Truck },
  delivered: { label: "Entregado", color: "bg-gray-500", icon: CheckCircle },
  cancelled: { label: "Cancelado", color: "bg-red-500", icon: AlertTriangle },
}

export function PlantistaView({ plants }: { plants: Plant[] }) {
  const [selectedPlant, setSelectedPlant] = useState(plants[0]?.id || "")
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [dispatches, setDispatches] = useState<ScheduledDispatch[]>([])
  const [mixers, setMixers] = useState<Mixer[]>([])
  const [formulas, setFormulas] = useState<any[]>([])
  const [clients, setClients] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [dailyDispatches, setDailyDispatches] = useState<any[]>([])
  const [now, setNow] = useState(new Date())
  const { toast } = useToast()
  
  // Helper functions for date navigation
  const goToPreviousDay = () => setSelectedDate(prev => subDays(prev, 1))
  const goToNextDay = () => setSelectedDate(prev => addDays(prev, 1))
  const goToToday = () => setSelectedDate(new Date())
  
  const getDateLabel = (date: Date) => {
    if (isToday(date)) return "Hoy"
    if (isTomorrow(date)) return "Manana"
    if (isYesterday(date)) return "Ayer"
    return format(date, "EEEE d 'de' MMMM", { locale: es })
  }

  // Dispatch dialog state
  const [dispatchDialog, setDispatchDialog] = useState<ScheduledDispatch | null>(null)
  const [dispatchForm, setDispatchForm] = useState({
    remito: "",
    extraWater: "",
    sampleTaken: false,
    sampleNumber: "",
    actualSlump: "",
  })
  const [submitting, setSubmitting] = useState(false)

  // Last sample number
  const [lastSampleNumber, setLastSampleNumber] = useState<string | null>(null)

  // Edit load dialog
  const [editLoadDialog, setEditLoadDialog] = useState<ScheduledDispatch | null>(null)
  const [editLoadValue, setEditLoadValue] = useState("")

  // Daily humidity state
  const [humidityMaterials, setHumidityMaterials] = useState<any[]>([])
  const [showHumidityModal, setShowHumidityModal] = useState(false)
  const [humidityChecked, setHumidityChecked] = useState(false)
  const [humidityForm, setHumidityForm] = useState<Record<string, { mode: "direct" | "calculate"; humidity: string; wetWeight: string; dryWeight: string }>>({})
  const [savingHumidity, setSavingHumidity] = useState(false)

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (selectedPlant) {
      loadData()
    }
    const interval = setInterval(() => { if (selectedPlant) loadData() }, 30000) // Refresh every 30s
    return () => clearInterval(interval)
  }, [selectedPlant, selectedDate])
  
  // Check humidity only once when component mounts and plant is selected (only for today)
  useEffect(() => {
    if (selectedPlant && isToday(selectedDate) && !humidityChecked) {
      checkDailyHumidity()
    }
  }, [selectedPlant])

  // Load last sample number
  async function loadLastSampleNumber() {
    const supabase = createClient()
    if (!supabase) return
    
    const { data } = await supabase
      .from("dispatches")
      .select("sample_number")
      .not("sample_number", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .single()
    
    setLastSampleNumber(data?.sample_number || null)
  }

  // Check if daily humidity has been recorded
  async function checkDailyHumidity() {
    if (humidityChecked) return
    
    const supabase = createClient()
    if (!supabase) return
    
    const today = new Date().toISOString().split("T")[0]

    // Get materials that require humidity tracking (arena types)
    const { data: materials } = await supabase
      .from("materials")
      .select("id, name, stockpile_humidity")
      .eq("plant_id", selectedPlant)
      .or("name.ilike.%arena%,name.ilike.%sand%")
      .order("name")

    if (!materials || materials.length === 0) {
      setHumidityChecked(true)
      return
    }

    // Check if humidity was logged today for these materials
    const { data: todayLogs } = await supabase
      .from("daily_stockpile_humidity")
      .select("material_id")
      .eq("log_date", today)
      .eq("plant_id", selectedPlant)
      .in("material_id", materials.map(m => m.id))

    const loggedMaterialIds = new Set(todayLogs?.map(l => l.material_id) || [])
    const pendingMaterials = materials.filter(m => !loggedMaterialIds.has(m.id))

    // Only show modal if there are materials pending humidity registration
    if (pendingMaterials.length > 0) {
      setHumidityMaterials(pendingMaterials)
      // Initialize form state
      const initialForm: Record<string, { mode: "direct" | "calculate"; humidity: string; wetWeight: string; dryWeight: string }> = {}
      pendingMaterials.forEach(m => {
        initialForm[m.id] = { mode: "direct", humidity: m.stockpile_humidity?.toString() || "", wetWeight: "", dryWeight: "" }
      })
      setHumidityForm(initialForm)
      setShowHumidityModal(true)
    } else {
      // All materials already have humidity logged for today
      setHumidityChecked(true)
    }
  }

  async function saveHumidity() {
    setSavingHumidity(true)
    const supabase = createClient()
    if (!supabase) {
      setSavingHumidity(false)
      return
    }
    const today = new Date().toISOString().split("T")[0]

    try {
      for (const material of humidityMaterials) {
        const form = humidityForm[material.id]
        let humidity: number

        if (form.mode === "direct") {
          humidity = parseFloat(form.humidity) || 0
        } else {
          // Calculate from wet and dry weight: humidity = (wet - dry) / dry * 100
          const wet = parseFloat(form.wetWeight) || 0
          const dry = parseFloat(form.dryWeight) || 0
          if (dry <= 0) {
            toast({ title: "Error", description: `Peso seco invalido para ${material.name}`, variant: "destructive" })
            setSavingHumidity(false)
            return
          }
          humidity = ((wet - dry) / dry) * 100
        }

        // Insert log
        await supabase.from("daily_stockpile_humidity").insert({
          material_id: material.id,
          plant_id: selectedPlant,
          log_date: today,
          humidity_percentage: humidity,
          wet_weight_grams: form.mode === "calculate" ? parseFloat(form.wetWeight) : null,
          dry_weight_grams: form.mode === "calculate" ? parseFloat(form.dryWeight) : null,
        })
      }

      toast({ title: "Humedad registrada", description: "Los valores de humedad del acopio fueron actualizados" })
      setShowHumidityModal(false)
      setHumidityChecked(true) // Mark as checked so modal doesn't show again
    } catch (error) {
      console.error("[v0] Error saving humidity:", error)
      toast({ title: "Error", description: "No se pudo guardar la humedad", variant: "destructive" })
    } finally {
      setSavingHumidity(false)
    }
  }

  async function loadData() {
    const supabase = createClient()
    if (!supabase) return
    
    const dayStart = new Date(selectedDate)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)

    const [dispatchesRes, mixersRes, formulasRes, clientsRes, dailyDispatchesRes] = await Promise.all([
      supabase
        .from("scheduled_dispatches")
        .select("*, clients(id, name), construction_sites(*), formulas(id, name, code, useful_life_minutes), mixers(id, license_plate, capacity_m3)")
        .eq("plant_id", selectedPlant)
        .gte("scheduled_arrival_time", dayStart.toISOString())
        .lt("scheduled_arrival_time", dayEnd.toISOString())
        .neq("status", "cancelled")
        .order("scheduled_departure_time"),
      supabase.from("mixers").select("*").eq("active", true).order("license_plate"),
      supabase.from("formulas").select("*, formula_materials(id, quantity, materials(id, name, unit))").eq("plant_id", selectedPlant).order("code"),
      supabase.from("clients").select("*").eq("plant_id", selectedPlant).order("name"),
      // Get completed dispatches for selected day summary
      supabase
        .from("dispatches")
        .select("*, formulas(id, name, code), clients(id, name), construction_sites(name), mixers(license_plate)")
        .gte("dispatch_date", dayStart.toISOString())
        .lt("dispatch_date", dayEnd.toISOString())
        .order("dispatch_date", { ascending: false }),
    ])

    setDispatches(dispatchesRes.data || [])
    setMixers(mixersRes.data || [])
    setFormulas(formulasRes.data || [])
    setClients(clientsRes.data || [])
    setDailyDispatches(dailyDispatchesRes.data || [])
    setLoading(false)
  }

  async function updateStatus(dispatch: ScheduledDispatch, newStatus: string) {
    const supabase = createClient()
    if (!supabase) return
    
    const updates: any = { status: newStatus }

    if (newStatus === "loading") {
      updates.actual_load_start_time = new Date().toISOString()
    } else if (newStatus === "in_transit") {
      updates.actual_departure_time = new Date().toISOString()
      // Update mixer status
      if (dispatch.mixer_id) {
        await supabase.from("mixers").update({ status: "in_transit" }).eq("id", dispatch.mixer_id)
      }
    } else if (newStatus === "delivered") {
      // Update mixer status back to available
      if (dispatch.mixer_id) {
        await supabase.from("mixers").update({ status: "available" }).eq("id", dispatch.mixer_id)
      }
    }

    const { error } = await supabase.from("scheduled_dispatches").update(updates).eq("id", dispatch.id)

    if (error) {
      toast({ title: "Error", description: "No se pudo actualizar", variant: "destructive" })
    } else {
      // Log status change
      await supabase.from("dispatch_status_log").insert({
        scheduled_dispatch_id: dispatch.id,
        previous_status: dispatch.status,
        new_status: newStatus,
      })
      loadData()
    }
  }

  async function openEditLoad(dispatch: ScheduledDispatch) {
    setEditLoadValue(dispatch.quantity_m3.toString())
    setEditLoadDialog(dispatch)
  }

  async function saveEditLoad() {
    if (!editLoadDialog) return
    const newQuantity = parseFloat(editLoadValue)
    if (isNaN(newQuantity) || newQuantity <= 0) {
      toast({ title: "Error", description: "Ingrese una cantidad valida", variant: "destructive" })
      return
    }

    const supabase = createClient()
    if (!supabase) return
    
    const { error } = await supabase
      .from("scheduled_dispatches")
      .update({ quantity_m3: newQuantity })
      .eq("id", editLoadDialog.id)

    if (error) {
      toast({ title: "Error", description: "No se pudo actualizar la carga", variant: "destructive" })
    } else {
      toast({ title: "Carga actualizada", description: `Nueva cantidad: ${newQuantity} m3` })
      setEditLoadDialog(null)
      loadData()
    }
  }

  async function assignMixer(dispatch: ScheduledDispatch, mixerId: string) {
    const supabase = createClient()
    if (!supabase) return
    
    const { error } = await supabase.from("scheduled_dispatches").update({ mixer_id: mixerId }).eq("id", dispatch.id)

    if (error) {
      toast({ title: "Error", description: "No se pudo asignar", variant: "destructive" })
    } else {
      toast({ title: "Camion asignado" })
      loadData()
    }
  }

  function openDispatchDialog(dispatch: ScheduledDispatch) {
    setDispatchForm({
      remito: "",
      extraWater: "0",
      sampleTaken: false,
      sampleNumber: "",
    actualSlump: "",
  })
  setDispatchDialog(dispatch)
  loadLastSampleNumber()
  }

  async function handleDispatch() {
    if (!dispatchDialog) return
    if (!dispatchForm.remito.trim()) {
      toast({ title: "Error", description: "El numero de remito es obligatorio", variant: "destructive" })
      return
    }
    if (dispatchForm.sampleTaken && (!dispatchForm.sampleNumber.trim() || !dispatchForm.actualSlump.trim())) {
      toast({ title: "Error", description: "Complete los datos de la muestra de probeta", variant: "destructive" })
      return
    }

    setSubmitting(true)
    const supabase = createClient()
    if (!supabase) {
      setSubmitting(false)
      return
    }
    const today = new Date()

    try {
      // 1. Create the dispatch record in dispatches table
      const { data: newDispatch, error: dispatchError } = await supabase.from("dispatches").insert({
        formula_id: dispatchDialog.formula_id,
        quantity_m3: dispatchDialog.quantity_m3,
        // Usar la fecha de programación original para que el historial refleje
        // la fecha en que se programó el camión, no la fecha de carga real
        dispatch_date: dispatchDialog.scheduled_arrival_time,
        remito: dispatchForm.remito.trim(),
        client_id: dispatchDialog.client_id,
        construction_site_id: dispatchDialog.construction_site_id,
        mixer_id: dispatchDialog.mixer_id,
        extra_water_liters: parseFloat(dispatchForm.extraWater) || 0,
        sample_taken: dispatchForm.sampleTaken,
        sample_number: dispatchForm.sampleTaken ? dispatchForm.sampleNumber.trim() : null,
        actual_slump_cm: dispatchForm.sampleTaken ? parseFloat(dispatchForm.actualSlump) : null,
      }).select().single()

      if (dispatchError) throw dispatchError

      // 2. Get formula materials and discount stock (considering humidity for sand/arena)
      const { data: formulaData } = await supabase
        .from("formulas")
        .select("formula_materials(quantity, materials(id, name, stockpile_humidity))")
        .eq("id", dispatchDialog.formula_id)
        .single()

      if (formulaData?.formula_materials) {
        for (const fm of formulaData.formula_materials) {
          let requiredQty = fm.quantity * dispatchDialog.quantity_m3
          
          // If material is sand/arena and has humidity, compensate for moisture content
          // The formula specifies dry weight, but we load wet material from stockpile
          const materialName = fm.materials.name?.toLowerCase() || ""
          const humidity = fm.materials.stockpile_humidity || 0
          if ((materialName.includes("arena") || materialName.includes("sand")) && humidity > 0) {
            // Add extra quantity to compensate: wet_qty = dry_qty * (1 + humidity/100)
            requiredQty = requiredQty * (1 + humidity / 100)
          }
          
          // Discount stock
          const { error: updateError } = await supabase.rpc("update_material_stock", {
            p_material_id: fm.materials.id,
            p_quantity_change: -requiredQty,
          })

          if (updateError) {
            console.error("[v0] Error updating stock:", updateError)
          }

          // Create dispatch_material record
          await supabase.from("dispatch_materials").insert({
            dispatch_id: newDispatch.id,
            material_id: fm.materials.id,
            quantity: requiredQty,
          })

          // Register stock movement for tracking
          await supabase.from("stock_movements").insert({
            material_id: fm.materials.id,
            movement_type: "consumo",
            quantity_kg: requiredQty,
            reference_type: "dispatch",
            reference_id: newDispatch.id,
            movement_date: format(today, "yyyy-MM-dd"),
            notes: `Despacho remito ${dispatchForm.remito || "N/A"}`,
          })
        }
      }

      // 3. If sample taken, create test cylinders (1 at 7 days, 2 at 28 days)
      if (dispatchForm.sampleTaken && newDispatch) {
        // Check if cylinders already exist for this dispatch
        const { data: existingCylinders } = await supabase
          .from("test_cylinders")
          .select("id")
          .eq("dispatch_id", newDispatch.id)
          .limit(1)

        if (!existingCylinders || existingCylinders.length === 0) {
          const cylinders = [
            {
              dispatch_id: newDispatch.id,
              cylinder_number: 1,
              test_age_days: 7,
              scheduled_test_date: format(addDays(today, 7), "yyyy-MM-dd"),
            },
            {
              dispatch_id: newDispatch.id,
              cylinder_number: 2,
              test_age_days: 28,
              scheduled_test_date: format(addDays(today, 28), "yyyy-MM-dd"),
            },
            {
              dispatch_id: newDispatch.id,
              cylinder_number: 3,
              test_age_days: 28,
              scheduled_test_date: format(addDays(today, 28), "yyyy-MM-dd"),
            },
          ]

          const { error: cylindersError } = await supabase.from("test_cylinders").insert(cylinders)
          if (cylindersError) {
            console.error("Error creating cylinders:", cylindersError)
          }
        }
      }

      // 4. Update scheduled dispatch status and link to dispatch
      const updates: Record<string, unknown> = {
        status: "in_transit",
        actual_departure_time: new Date().toISOString(),
        dispatch_id: newDispatch.id,
      }

      await supabase.from("scheduled_dispatches").update(updates).eq("id", dispatchDialog.id)

      // 5. Update mixer status
      if (dispatchDialog.mixer_id) {
        await supabase.from("mixers").update({ status: "in_transit" }).eq("id", dispatchDialog.mixer_id)
      }

      // 6. Log status change
      await supabase.from("dispatch_status_log").insert({
        scheduled_dispatch_id: dispatchDialog.id,
        previous_status: dispatchDialog.status,
        new_status: "in_transit",
      })

      toast({
        title: "Despacho registrado",
        description: dispatchForm.sampleTaken
          ? `Remito ${dispatchForm.remito} - Muestra ${dispatchForm.sampleNumber} registrada con 3 probetas`
          : `Remito ${dispatchForm.remito}`,
      })

      setDispatchDialog(null)
      loadData()
    } catch (error) {
      console.error("Error:", error)
      toast({ title: "Error", description: "No se pudo registrar el despacho", variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  function getTimeUntilDeparture(departureTime: string): { minutes: number; isOverdue: boolean; text: string } {
    const departure = parseISO(departureTime)
    const minutes = differenceInMinutes(departure, now)
    const isOverdue = minutes < 0

    if (isOverdue) {
      return { minutes: Math.abs(minutes), isOverdue: true, text: `${Math.abs(minutes)} min atrasado` }
    } else if (minutes <= 15) {
      return { minutes, isOverdue: false, text: `Sale en ${minutes} min` }
    } else {
      return { minutes, isOverdue: false, text: format(departure, "HH:mm") }
    }
  }

  const availableMixers = mixers.filter((m) => m.status === "available" || m.status === "in_transit")
  const allMixersForDisplay = mixers // All mixers for the selector
  const nextToDepart = dispatches.filter((d) => d.status === "scheduled" || d.status === "confirmed" || d.status === "loading")
  const inTransit = dispatches.filter((d) => d.status === "in_transit")
  const [mixerWarning, setMixerWarning] = useState<string | null>(null)
  
  const getMixerStatusLabel = (status: string) => {
    switch (status) {
      case "available": return "disponible"
      case "in_transit": return "en transito"
      case "inactive": return "descontinuado"
      case "maintenance": return "en mantenimiento"
      default: return status
    }
  }
  
  const handleMixerSelect = (dispatch: Dispatch, mixerId: string) => {
    const mixer = mixers.find(m => m.id === mixerId)
    if (mixer && mixer.status !== "available" && mixer.status !== "in_transit") {
      setMixerWarning(`El camion ${mixer.license_plate} no esta disponible. Ve a la seccion de Camiones para darlo de alta o confirmar el despacho en transito.`)
      return
    }
    setMixerWarning(null)
    assignMixer(dispatch, mixerId)
  }

  // Daily summary calculations
  const dailySummary = useMemo(() => {
    const totalM3 = dailyDispatches.reduce((sum, d) => sum + (d.quantity_m3 || 0), 0)
    const totalDespachos = dailyDispatches.length
    
    // Group by formula
    const byFormula: Record<string, { code: string; name: string; count: number; m3: number }> = {}
    dailyDispatches.forEach((d) => {
      const key = d.formula_id || "unknown"
      if (!byFormula[key]) {
        byFormula[key] = { 
          code: d.formulas?.code || "N/A", 
          name: d.formulas?.name || "Sin formula",
          count: 0, 
          m3: 0 
        }
      }
      byFormula[key].count++
      byFormula[key].m3 += d.quantity_m3 || 0
    })

    // Group by client
    const byClient: Record<string, { name: string; count: number; m3: number }> = {}
    dailyDispatches.forEach((d) => {
      const key = d.client_id || "unknown"
      if (!byClient[key]) {
        byClient[key] = { 
          name: d.clients?.name || "Sin cliente",
          count: 0, 
          m3: 0 
        }
      }
      byClient[key].count++
      byClient[key].m3 += d.quantity_m3 || 0
    })

    return {
      totalM3,
      totalDespachos,
      byFormula: Object.values(byFormula).sort((a, b) => b.m3 - a.m3),
      byClient: Object.values(byClient).sort((a, b) => b.m3 - a.m3),
    }
  }, [dailyDispatches])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div className="flex items-center gap-4">
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

          {/* Day Navigation */}
          <div className="flex items-center gap-2 bg-muted/50 rounded-lg p-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goToPreviousDay}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button 
              variant={isToday(selectedDate) ? "default" : "outline"} 
              size="sm" 
              className="min-w-[120px]"
              onClick={goToToday}
            >
              <CalendarDays className="h-4 w-4 mr-2" />
              {getDateLabel(selectedDate)}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goToNextDay}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="text-sm text-muted-foreground hidden sm:block">
            {format(now, "HH:mm", { locale: es })}
          </div>
        </div>

        <div className="flex gap-2">
          <AddDispatchDialog
            formulas={formulas}
            clients={clients}
            mixers={mixers}
            plantId={selectedPlant}
            onSuccess={loadData}
            triggerLabel="Carga despacho manual"
          />
          <Button variant="outline" onClick={loadData} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Actualizar
          </Button>
        </div>
      </div>

      {/* Sample Reminder Banner */}
      <div className="bg-red-50 border border-red-300 rounded-lg px-4 py-3 flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0" />
        <p className="text-red-800 font-medium text-sm">
          Se recomienda extraer 3 muestras cada 50 m3 despachados
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-blue-100">
                <Clock className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{nextToDepart.length}</p>
                <p className="text-sm text-muted-foreground">Pendientes</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-purple-100">
                <Truck className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{inTransit.length}</p>
                <p className="text-sm text-muted-foreground">En Transito</p>
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
                <p className="text-2xl font-bold">{availableMixers.length}</p>
                <p className="text-sm text-muted-foreground">Camiones Disponibles</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-yellow-100">
                <AlertTriangle className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{nextToDepart.filter((d) => d.is_urgent).length}</p>
                <p className="text-sm text-muted-foreground">Urgentes</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Daily Summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Resumen del Dia
            </span>
            <div className="flex items-center gap-4 text-sm font-normal">
              <span className="text-muted-foreground">
                Total: <strong className="text-foreground">{dailySummary.totalDespachos} despachos</strong>
              </span>
              <span className="text-muted-foreground">
                Volumen: <strong className="text-foreground">{dailySummary.totalM3.toFixed(1)} m3</strong>
              </span>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dailyDispatches.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">No hay despachos completados hoy</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* By Formula */}
              <div>
                <h4 className="text-sm font-semibold mb-3">Por Formula</h4>
                <div className="space-y-2">
                  {dailySummary.byFormula.map((f) => (
                    <div key={f.code} className="flex items-center justify-between p-2 rounded bg-muted/50">
                      <div>
                        <span className="font-medium text-sm">{f.code}</span>
                        <span className="text-xs text-muted-foreground ml-2">{f.name}</span>
                      </div>
                      <div className="text-right text-sm">
                        <span className="font-semibold">{f.m3.toFixed(1)} m3</span>
                        <span className="text-muted-foreground ml-2">({f.count} viajes)</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* By Client */}
              <div>
                <h4 className="text-sm font-semibold mb-3">Por Cliente</h4>
                <div className="space-y-2">
                  {dailySummary.byClient.map((c) => (
                    <div key={c.name} className="flex items-center justify-between p-2 rounded bg-muted/50">
                      <span className="font-medium text-sm truncate max-w-[60%]">{c.name}</span>
                      <div className="text-right text-sm">
                        <span className="font-semibold">{c.m3.toFixed(1)} m3</span>
                        <span className="text-muted-foreground ml-2">({c.count})</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Recent dispatches list */}
          {dailyDispatches.length > 0 && (
            <div className="mt-6 pt-4 border-t">
              <h4 className="text-sm font-semibold mb-3">Ultimos Despachos</h4>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {dailyDispatches.slice(0, 10).map((d) => (
                  <div key={d.id} className="flex items-center justify-between text-sm p-2 rounded hover:bg-muted/30">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-14">
                        {format(parseISO(d.dispatch_date), "HH:mm")}
                      </span>
                      <Badge variant="outline" className="text-xs">{d.formulas?.code || "N/A"}</Badge>
                      <span className="truncate max-w-[150px]">{d.clients?.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{d.quantity_m3} m3</span>
                      {d.remito && <span className="text-xs text-muted-foreground">R: {d.remito}</span>}
                      {d.mixers?.license_plate && (
                        <span className="text-xs text-muted-foreground">{d.mixers.license_plate}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Warning message for unavailable mixer */}
        {mixerWarning && (
          <div className="lg:col-span-2">
            <Alert variant="destructive" className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{mixerWarning}</AlertDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setMixerWarning(null)}>
                <X className="h-4 w-4" />
              </Button>
            </Alert>
          </div>
        )}
        
        {/* Queue - Proximos a salir */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Proximos a Salir
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {nextToDepart.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No hay despachos pendientes</p>
            ) : (
              nextToDepart.map((dispatch) => {
                const timeInfo = getTimeUntilDeparture(dispatch.scheduled_departure_time)
                const StatusIcon = STATUS_CONFIG[dispatch.status]?.icon || Clock

                return (
                  <Card key={dispatch.id} className={`${dispatch.is_urgent ? "ring-2 ring-red-500" : ""} ${timeInfo.isOverdue ? "bg-red-50" : ""}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold">{dispatch.clients?.name}</span>
                            {dispatch.is_urgent && <Badge variant="destructive">URGENTE</Badge>}
                          </div>
                          <div className="text-sm text-muted-foreground flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            <span className="font-medium">{dispatch.construction_sites?.name}</span>
                          </div>
                          {dispatch.construction_sites?.address && (
                            <div className="text-xs text-muted-foreground ml-4">
                              {dispatch.construction_sites.address}
                            </div>
                          )}
                          <div className="text-sm mt-1">
                            <span className="font-medium">{dispatch.formulas?.code}</span>
                            <span className="text-muted-foreground"> - {dispatch.quantity_m3} m3</span>
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            <Badge className={STATUS_CONFIG[dispatch.status]?.color + " text-white"}>
                              <StatusIcon className="h-3 w-3 mr-1" />
                              {STATUS_CONFIG[dispatch.status]?.label}
                            </Badge>
                            <span className={`text-sm ${timeInfo.isOverdue ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                              {timeInfo.text}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-col gap-2 items-end">
                          {/* Mixer assignment */}
                          {!dispatch.mixer_id ? (
                            <Select onValueChange={(v) => handleMixerSelect(dispatch, v)}>
                              <SelectTrigger className="w-[140px] h-8 text-xs">
                                <SelectValue placeholder="Asignar camion" />
                              </SelectTrigger>
                              <SelectContent>
                                {allMixersForDisplay.map((m) => (
                                  <SelectItem 
                                    key={m.id} 
                                    value={m.id}
                                    disabled={m.status !== "available" && m.status !== "in_transit"}
                                    className={m.status !== "available" && m.status !== "in_transit" ? "opacity-50" : ""}
                                  >
                                    {m.license_plate} ({getMixerStatusLabel(m.status)})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant="outline" className="gap-1">
                              <Truck className="h-3 w-3" />
                              {dispatch.mixers?.license_plate}
                            </Badge>
                          )}

                          {/* Status actions */}
                          {(dispatch.status === "scheduled" || dispatch.status === "loading") && (
                            <Button size="sm" variant="outline" onClick={() => openEditLoad(dispatch)} className="gap-1">
                              <Pencil className="h-3 w-3" />
                              Editar Carga
                            </Button>
                          )}
                          {dispatch.status === "scheduled" && dispatch.mixer_id && (
                            <Button size="sm" onClick={() => updateStatus(dispatch, "loading")} className="gap-1">
                              <Play className="h-3 w-3" />
                              Cargar
                            </Button>
                          )}
                          {dispatch.status === "loading" && (
                            <Button size="sm" onClick={() => openDispatchDialog(dispatch)} className="gap-1">
                              <Truck className="h-3 w-3" />
                              Despachar
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })
            )}
          </CardContent>
        </Card>

        {/* In Transit */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" />
              En Transito
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {inTransit.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No hay camiones en transito</p>
            ) : (
              inTransit.map((dispatch) => {
                const departureTime = dispatch.actual_departure_time ? parseISO(dispatch.actual_departure_time) : null
                const expectedArrival = departureTime ? addMinutes(departureTime, dispatch.construction_sites?.travel_time_minutes || 30) : null
                const minutesRemaining = expectedArrival ? differenceInMinutes(expectedArrival, now) : null

                return (
                  <Card key={dispatch.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="gap-1">
                              <Truck className="h-3 w-3" />
                              {dispatch.mixers?.license_plate}
                            </Badge>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <span className="font-medium">{dispatch.construction_sites?.name}</span>
                          {dispatch.construction_sites?.address && (
                            <p className="text-xs text-muted-foreground">{dispatch.construction_sites.address}</p>
                          )}
                        </div>
                      </div>
                          <div className="text-sm text-muted-foreground">
                            {dispatch.clients?.name} - {dispatch.quantity_m3} m3
                          </div>
                          {minutesRemaining !== null && (
                            <div className="text-sm mt-1">
                              {minutesRemaining > 0 ? (
                                <span>Llega en ~{minutesRemaining} min</span>
                              ) : (
                                <span className="text-green-600">Deberia haber llegado</span>
                              )}
                            </div>
                          )}
                        </div>
                        <Button size="sm" variant="outline" onClick={() => updateStatus(dispatch, "delivered")}>
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Entregado
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* Dispatch Dialog */}
      <Dialog open={!!dispatchDialog} onOpenChange={(open) => !open && setDispatchDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar Despacho</DialogTitle>
            <DialogDescription>
              {dispatchDialog && (
                <span>
                  {dispatchDialog.clients?.name} - {dispatchDialog.formulas?.code} - {dispatchDialog.quantity_m3}m3
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="remito">Numero de Remito *</Label>
              <Input
                id="remito"
                value={dispatchForm.remito}
                onChange={(e) => setDispatchForm({ ...dispatchForm, remito: e.target.value })}
                placeholder="Ej: R-001234"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="extraWater">Agua Extra en Planta (litros)</Label>
              <Input
                id="extraWater"
                type="number"
                value={dispatchForm.extraWater}
                onChange={(e) => setDispatchForm({ ...dispatchForm, extraWater: e.target.value })}
                placeholder="0"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="sampleTaken">Muestra de Probeta</Label>
                <p className="text-xs text-muted-foreground">Se extrajo muestra para ensayo de compresion</p>
              </div>
              <Switch
                id="sampleTaken"
                checked={dispatchForm.sampleTaken}
                onCheckedChange={(checked) => setDispatchForm({ ...dispatchForm, sampleTaken: checked })}
              />
            </div>

  {dispatchForm.sampleTaken && (
  <div className="space-y-4 p-3 rounded-lg bg-muted/50">
  {lastSampleNumber && (
    <div className="flex items-center gap-2 p-2 rounded bg-blue-50 border border-blue-200">
      <span className="text-xs text-blue-700">Ultima muestra:</span>
      <span className="font-mono font-semibold text-blue-900">{lastSampleNumber}</span>
    </div>
  )}
  <div className="space-y-2">
  <Label htmlFor="sampleNumber">Numero de Muestra *</Label>
  <Input
  id="sampleNumber"
  value={dispatchForm.sampleNumber}
  onChange={(e) => setDispatchForm({ ...dispatchForm, sampleNumber: e.target.value })}
  placeholder="Ej: M-001"
  />
  </div>

                <div className="space-y-2">
                  <Label htmlFor="actualSlump">Asentamiento Real (cm) *</Label>
                  <Input
                    id="actualSlump"
                    type="number"
                    step="0.5"
                    value={dispatchForm.actualSlump}
                    onChange={(e) => setDispatchForm({ ...dispatchForm, actualSlump: e.target.value })}
                    placeholder="Ej: 12.5"
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  Se crearan 3 probetas: 1 para rotura a 7 dias y 2 para rotura a 28 dias
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDispatchDialog(null)}>
              Cancelar
            </Button>
            <Button onClick={handleDispatch} disabled={submitting}>
              {submitting ? "Registrando..." : "Confirmar Despacho"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Daily Humidity Modal */}
      <Dialog open={showHumidityModal} onOpenChange={setShowHumidityModal}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Humedad del Acopio - Control Diario</DialogTitle>
            <DialogDescription>
              Registre la humedad actual de los materiales en acopio. Este control es obligatorio una vez por dia.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
            {humidityMaterials.map((material) => {
              const form = humidityForm[material.id] || { mode: "direct", humidity: "", wetWeight: "", dryWeight: "" }
              const calculatedHumidity = form.mode === "calculate" && form.wetWeight && form.dryWeight
                ? (((parseFloat(form.wetWeight) - parseFloat(form.dryWeight)) / parseFloat(form.dryWeight)) * 100).toFixed(2)
                : null

              return (
                <Card key={material.id}>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm font-medium">{material.name}</CardTitle>
                    {material.stockpile_humidity !== null && (
                      <p className="text-xs text-muted-foreground">Ultima humedad: {material.stockpile_humidity.toFixed(2)}%</p>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant={form.mode === "direct" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setHumidityForm({
                          ...humidityForm,
                          [material.id]: { ...form, mode: "direct" }
                        })}
                      >
                        Ingresar %
                      </Button>
                      <Button
                        type="button"
                        variant={form.mode === "calculate" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setHumidityForm({
                          ...humidityForm,
                          [material.id]: { ...form, mode: "calculate" }
                        })}
                      >
                        Calcular
                      </Button>
                    </div>

                    {form.mode === "direct" ? (
                      <div className="space-y-2">
                        <Label className="text-xs">Humedad (%)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          placeholder="Ej: 5.5"
                          value={form.humidity}
                          onChange={(e) => setHumidityForm({
                            ...humidityForm,
                            [material.id]: { ...form, humidity: e.target.value }
                          })}
                        />
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Peso Humedo (g)</Label>
                            <Input
                              type="number"
                              placeholder="Ej: 500"
                              value={form.wetWeight}
                              onChange={(e) => setHumidityForm({
                                ...humidityForm,
                                [material.id]: { ...form, wetWeight: e.target.value }
                              })}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Peso Seco (g)</Label>
                            <Input
                              type="number"
                              placeholder="Ej: 475"
                              value={form.dryWeight}
                              onChange={(e) => setHumidityForm({
                                ...humidityForm,
                                [material.id]: { ...form, dryWeight: e.target.value }
                              })}
                            />
                          </div>
                        </div>
                        {calculatedHumidity && (
                          <p className="text-sm font-medium text-primary">
                            Humedad calculada: {calculatedHumidity}%
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Formula: (Peso Humedo - Peso Seco) / Peso Seco × 100
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowHumidityModal(false)}>
              Omitir por ahora
            </Button>
            <Button onClick={saveHumidity} disabled={savingHumidity}>
              {savingHumidity ? "Guardando..." : "Guardar Humedad"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Load Dialog */}
      <Dialog open={!!editLoadDialog} onOpenChange={(open) => !open && setEditLoadDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5" />
              Editar Carga
            </DialogTitle>
            <DialogDescription>
              Modifique la cantidad de m3 antes de despachar
            </DialogDescription>
          </DialogHeader>

          {editLoadDialog && (
            <div className="space-y-4 py-4">
                <div className="p-3 rounded-lg bg-muted/50 space-y-1">
                  <p className="text-sm font-medium">{editLoadDialog.clients?.name}</p>
                  <p className="text-xs text-muted-foreground font-medium">{editLoadDialog.construction_sites?.name}</p>
                  {editLoadDialog.construction_sites?.address && (
                    <p className="text-xs text-muted-foreground">{editLoadDialog.construction_sites.address}</p>
                  )}
                <p className="text-sm">
                  <span className="font-medium">{editLoadDialog.formulas?.code}</span>
                  <span className="text-muted-foreground"> - {editLoadDialog.formulas?.name}</span>
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="editLoadQuantity">Cantidad (m3)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="editLoadQuantity"
                    type="number"
                    step="0.5"
                    min="0.5"
                    value={editLoadValue}
                    onChange={(e) => setEditLoadValue(e.target.value)}
                    className="text-lg font-semibold"
                  />
                  <span className="text-muted-foreground">m3</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Cantidad original: {editLoadDialog.quantity_m3} m3
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditLoadDialog(null)}>
              Cancelar
            </Button>
            <Button onClick={saveEditLoad}>
              Guardar Cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
