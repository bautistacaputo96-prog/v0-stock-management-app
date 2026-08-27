"use client"

import { useState, useEffect, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { Truck, CheckCircle, Clock, MapPin, AlertTriangle, RefreshCw, ArrowRight, ChevronLeft, ChevronRight, CalendarDays, Pencil, X, MoreHorizontal, XCircle } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { format, parseISO, differenceInMinutes, addMinutes, addDays, subDays, isToday, isTomorrow, isYesterday } from "date-fns"
import { es } from "date-fns/locale"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { AddDispatchDialog } from "@/components/add-dispatch-dialog"
import { currentUserName } from "@/lib/current-user"
import { logActivity } from "@/lib/activity-log"

type Plant = { id: string; name: string }
type ScheduledDispatch = {
  id: string; client_id: string; construction_site_id: string; formula_id: string; mixer_id: string | null;
  quantity_m3: number; dispatched_m3: number;
  scheduled_arrival_time: string; scheduled_departure_time: string;
  status: string; observations: string | null; is_urgent: boolean;
  fiber_kg_per_m3?: number | null;
  clients?: { id: string; name: string };
  construction_sites?: { id: string; name: string; address: string | null; travel_time_minutes: number; unload_time_minutes: number; requires_pump: boolean };
  formulas?: { id: string; name: string; code: string; useful_life_minutes: number };
  mixers?: { id: string; license_plate: string; capacity_m3: number };
}
type Mixer = { id: string; license_plate: string; capacity_m3: number; status: string }

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
    quantity_m3: "",
    mixer_id: "",
    remito: "",
    extraWater: "0",
    sampleTaken: false,
    sampleNumber: "",
    actualSlump: "",
    // Fibra de vidrio agregada al camión, dosificada en kg por m³
    fiberEnabled: false,
    fiberKgPerM3: "",
  })
  const [submitting, setSubmitting] = useState(false)
  const [lastSampleNumber, setLastSampleNumber] = useState<string | null>(null)

  // Edit pedido total dialog
  const [editDialog, setEditDialog] = useState<ScheduledDispatch | null>(null)
  const [editQuantity, setEditQuantity] = useState("")
  const [finalizarDialog, setFinalizarDialog] = useState<ScheduledDispatch | null>(null)

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
    if (selectedPlant) loadData()
    const interval = setInterval(() => { if (selectedPlant) loadData() }, 30000)
    return () => clearInterval(interval)
  }, [selectedPlant, selectedDate])

  useEffect(() => {
    if (selectedPlant && isToday(selectedDate) && !humidityChecked) {
      checkDailyHumidity()
    }
  }, [selectedPlant])

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

  async function checkDailyHumidity() {
    if (humidityChecked) return
    const supabase = createClient()
    if (!supabase) return
    const today = new Date().toISOString().split("T")[0]
    const { data: materials } = await supabase
      .from("materials")
      .select("id, name, stockpile_humidity")
      .eq("plant_id", selectedPlant)
      .or("name.ilike.%arena%,name.ilike.%sand%")
      .order("name")
    if (!materials || materials.length === 0) { setHumidityChecked(true); return }
    const { data: todayLogs } = await supabase
      .from("daily_stockpile_humidity")
      .select("material_id")
      .eq("log_date", today)
      .eq("plant_id", selectedPlant)
      .in("material_id", materials.map(m => m.id))
    const loggedMaterialIds = new Set(todayLogs?.map(l => l.material_id) || [])
    const pendingMaterials = materials.filter(m => !loggedMaterialIds.has(m.id))
    if (pendingMaterials.length > 0) {
      setHumidityMaterials(pendingMaterials)
      const initialForm: Record<string, { mode: "direct" | "calculate"; humidity: string; wetWeight: string; dryWeight: string }> = {}
      pendingMaterials.forEach(m => {
        initialForm[m.id] = { mode: "direct", humidity: m.stockpile_humidity?.toString() || "", wetWeight: "", dryWeight: "" }
      })
      setHumidityForm(initialForm)
      setShowHumidityModal(true)
    } else {
      setHumidityChecked(true)
    }
  }

  async function saveHumidity() {
    setSavingHumidity(true)
    const supabase = createClient()
    if (!supabase) { setSavingHumidity(false); return }
    const today = new Date().toISOString().split("T")[0]
    try {
      for (const material of humidityMaterials) {
        const form = humidityForm[material.id]
        let humidity: number
        if (form.mode === "direct") {
          humidity = parseFloat(form.humidity) || 0
        } else {
          const wet = parseFloat(form.wetWeight) || 0
          const dry = parseFloat(form.dryWeight) || 0
          if (dry <= 0) {
            toast({ title: "Error", description: `Peso seco invalido para ${material.name}`, variant: "destructive" })
            setSavingHumidity(false)
            return
          }
          humidity = ((wet - dry) / dry) * 100
        }
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
      setHumidityChecked(true)
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
      supabase
        .from("dispatches")
        .select("*, formulas(id, name, code), clients(id, name), construction_sites(name, travel_time_minutes), mixers(id, license_plate, status)")
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

  /**
   * Cierra un pedido aunque falten m³ por despachar (ej: se pidieron 40 y la
   * obra recibió 38). El pedido queda como completado con lo realmente
   * despachado; los m³ pendientes se anotan en las observaciones.
   */
  async function finalizarPedido(pedido: ScheduledDispatch) {
    const supabase = createClient()
    if (!supabase) return
    const despachado = pedido.dispatched_m3 || 0
    const pendiente = Math.max(0, pedido.quantity_m3 - despachado)
    const nota = pendiente > 0
      ? `Cerrado con ${despachado.toFixed(1)} de ${pedido.quantity_m3} m3 (${pendiente.toFixed(1)} m3 sin despachar)`
      : `Cerrado con ${despachado.toFixed(1)} m3`
    await supabase
      .from("scheduled_dispatches")
      .update({
        status: "completed",
        observations: pedido.observations ? `${pedido.observations} · ${nota}` : nota,
      })
      .eq("id", pedido.id)
    setFinalizarDialog(null)
    toast({ title: "Pedido finalizado", description: nota })
    loadData()
  }

  async function cancelPedido(pedido: ScheduledDispatch) {
    const supabase = createClient()
    if (!supabase) return
    await supabase.from("scheduled_dispatches").update({ status: "cancelled" }).eq("id", pedido.id)
    toast({ title: "Pedido cancelado" })
    loadData()
  }

  async function confirmDelivery(mixerId: string) {
    const supabase = createClient()
    if (!supabase) return
    await supabase.from("mixers").update({ status: "available" }).eq("id", mixerId)
    toast({ title: "Entrega confirmada", description: "Camion disponible nuevamente" })
    loadData()
  }

  async function saveEditQuantity() {
    if (!editDialog) return
    const qty = parseFloat(editQuantity)
    if (isNaN(qty) || qty <= 0) {
      toast({ title: "Error", description: "Ingrese una cantidad valida", variant: "destructive" })
      return
    }
    const supabase = createClient()
    if (!supabase) return
    await supabase.from("scheduled_dispatches").update({ quantity_m3: qty }).eq("id", editDialog.id)
    toast({ title: "Total actualizado", description: `Nueva cantidad: ${qty} m3` })
    setEditDialog(null)
    loadData()
  }

  function openDispatchDialog(pedido: ScheduledDispatch) {
    const remaining = pedido.quantity_m3 - (pedido.dispatched_m3 || 0)
    const suggestedQty = Math.min(Math.max(0.5, remaining), 8)
    setDispatchForm({
      quantity_m3: suggestedQty.toFixed(1),
      mixer_id: pedido.mixer_id || "",
      remito: "",
      extraWater: "0",
      sampleTaken: false,
      sampleNumber: "",
      actualSlump: "",
      fiberEnabled: pedido.fiber_kg_per_m3 != null && pedido.fiber_kg_per_m3 > 0,
      fiberKgPerM3: pedido.fiber_kg_per_m3 != null ? String(pedido.fiber_kg_per_m3) : "",
    })
    setDispatchDialog(pedido)
    loadLastSampleNumber()
  }

  async function handleDispatch() {
    if (!dispatchDialog) return

    const quantityThisTruck = parseFloat(dispatchForm.quantity_m3)
    if (isNaN(quantityThisTruck) || quantityThisTruck <= 0) {
      toast({ title: "Error", description: "Ingrese una cantidad valida", variant: "destructive" })
      return
    }
    if (!dispatchForm.remito.trim()) {
      toast({ title: "Error", description: "El numero de remito es obligatorio", variant: "destructive" })
      return
    }
    if (!dispatchForm.mixer_id) {
      toast({ title: "Error", description: "Seleccione un camion", variant: "destructive" })
      return
    }
    if (dispatchForm.sampleTaken && (!dispatchForm.sampleNumber.trim() || !dispatchForm.actualSlump.trim())) {
      toast({ title: "Error", description: "Complete los datos de la muestra de probeta", variant: "destructive" })
      return
    }

    const remaining = dispatchDialog.quantity_m3 - (dispatchDialog.dispatched_m3 || 0)
    if (quantityThisTruck > remaining + 0.5) {
      toast({ title: "Error", description: `Supera el restante (${remaining.toFixed(1)} m3)`, variant: "destructive" })
      return
    }

    setSubmitting(true)
    const supabase = createClient()
    if (!supabase) { setSubmitting(false); return }
    const today = new Date()

    try {
      // 1. Create the dispatch record
      const { data: newDispatch, error: dispatchError } = await supabase.from("dispatches").insert({
        formula_id: dispatchDialog.formula_id,
        quantity_m3: quantityThisTruck,
        dispatch_date: today.toISOString(),
        remito: dispatchForm.remito.trim(),
        client_id: dispatchDialog.client_id,
        construction_site_id: dispatchDialog.construction_site_id,
        mixer_id: dispatchForm.mixer_id,
        extra_water_liters: parseFloat(dispatchForm.extraWater) || 0,
        sample_taken: dispatchForm.sampleTaken,
        sample_number: dispatchForm.sampleTaken ? dispatchForm.sampleNumber.trim() : null,
        actual_slump_cm: dispatchForm.sampleTaken ? parseFloat(dispatchForm.actualSlump) : null,
        scheduled_dispatch_id: dispatchDialog.id,
        plant_id: selectedPlant,
        created_by: currentUserName(),
      }).select().single()

      if (dispatchError) throw dispatchError

      // 2. Get formula materials and discount stock (with humidity compensation for sand)
      const { data: formulaData } = await supabase
        .from("formulas")
        .select("formula_materials(quantity, materials(id, name, stockpile_humidity))")
        .eq("id", dispatchDialog.formula_id)
        .single()

      if (formulaData?.formula_materials) {
        for (const fm of formulaData.formula_materials) {
          let requiredQty = fm.quantity * quantityThisTruck
          const materialName = fm.materials.name?.toLowerCase() || ""
          const humidity = fm.materials.stockpile_humidity || 0
          if ((materialName.includes("arena") || materialName.includes("sand")) && humidity > 0) {
            requiredQty = requiredQty * (1 + humidity / 100)
          }
          await supabase.rpc("update_material_stock", {
            p_material_id: fm.materials.id,
            p_quantity_change: -requiredQty,
          })
          await supabase.from("dispatch_materials").insert({
            dispatch_id: newDispatch.id,
            material_id: fm.materials.id,
            quantity: requiredQty,
          })
          await supabase.from("stock_movements").insert({
            material_id: fm.materials.id,
            movement_type: "consumo",
            quantity_kg: requiredQty,
            reference_type: "dispatch",
            reference_id: newDispatch.id,
            movement_date: format(today, "yyyy-MM-dd"),
            notes: `Despacho remito ${dispatchForm.remito}`,
          })
        }
      }

      // 2b. Fibra de vidrio agregada al camión (dosificada en kg por m³)
      const fiberPerM3 = parseFloat(dispatchForm.fiberKgPerM3) || 0
      if (dispatchForm.fiberEnabled && fiberPerM3 > 0 && newDispatch) {
        const fiberTotal = fiberPerM3 * quantityThisTruck
        const { data: fiberMaterial } = await supabase
          .from("materials")
          .select("id")
          .eq("plant_id", selectedPlant)
          .ilike("name", "%fibra de vidrio%")
          .maybeSingle()

        if (fiberMaterial) {
          await supabase.rpc("update_material_stock", {
            p_material_id: fiberMaterial.id,
            p_quantity_change: -fiberTotal,
          })
          await supabase.from("dispatch_materials").insert({
            dispatch_id: newDispatch.id,
            material_id: fiberMaterial.id,
            quantity: fiberTotal,
          })
          await supabase.from("stock_movements").insert({
            material_id: fiberMaterial.id,
            movement_type: "consumo",
            quantity_kg: fiberTotal,
            reference_type: "dispatch",
            reference_id: newDispatch.id,
            movement_date: format(today, "yyyy-MM-dd"),
            notes: `Fibra de vidrio ${fiberPerM3} kg/m³ × ${quantityThisTruck} m³ — remito ${dispatchForm.remito}`,
          })
        } else {
          toast({
            title: "Fibra no registrada",
            description: "No se encontró el material 'Fibra de vidrio' en esta planta. El despacho se guardó igual.",
            variant: "destructive",
          })
        }
      }

      // 3. Create test cylinders if sample taken (1×7d + 2×28d)
      if (dispatchForm.sampleTaken && newDispatch) {
        const { data: existing } = await supabase
          .from("test_cylinders")
          .select("id")
          .eq("dispatch_id", newDispatch.id)
          .limit(1)
        if (!existing || existing.length === 0) {
          await supabase.from("test_cylinders").insert([
            { dispatch_id: newDispatch.id, cylinder_number: 1, test_age_days: 7, scheduled_test_date: format(addDays(today, 7), "yyyy-MM-dd") },
            { dispatch_id: newDispatch.id, cylinder_number: 2, test_age_days: 28, scheduled_test_date: format(addDays(today, 28), "yyyy-MM-dd") },
            { dispatch_id: newDispatch.id, cylinder_number: 3, test_age_days: 28, scheduled_test_date: format(addDays(today, 28), "yyyy-MM-dd") },
          ])
        }
      }

      // 4. Increment dispatched_m3 on the scheduled dispatch; mark completed if done
      const newDispatched = (dispatchDialog.dispatched_m3 || 0) + quantityThisTruck
      const schedUpdates: Record<string, unknown> = { dispatched_m3: newDispatched }
      if (newDispatched >= dispatchDialog.quantity_m3 - 0.01) {
        schedUpdates.status = "completed"
      }
      await supabase.from("scheduled_dispatches").update(schedUpdates).eq("id", dispatchDialog.id)

      // 5. Set mixer in transit
      await supabase.from("mixers").update({ status: "in_transit" }).eq("id", dispatchForm.mixer_id)

      // 6. Log status change (non-critical)
      supabase.from("dispatch_status_log").insert({
        scheduled_dispatch_id: dispatchDialog.id,
        previous_status: dispatchDialog.status,
        new_status: schedUpdates.status || dispatchDialog.status,
      }).then(() => {}).catch(() => {})

      const remainingAfter = Math.max(0, remaining - quantityThisTruck)
      toast({
        title: "Camion despachado",
        description: dispatchForm.sampleTaken
          ? `Remito ${dispatchForm.remito} · Muestra ${dispatchForm.sampleNumber} · ${remainingAfter > 0 ? `Restante: ${remainingAfter.toFixed(1)}m3` : "Pedido completo"}`
          : `Remito ${dispatchForm.remito} · ${remainingAfter > 0 ? `Restante: ${remainingAfter.toFixed(1)}m3` : "Pedido completo"}`,
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

  // Derived data
  const pedidosActivos = dispatches.filter(d => !["completed", "cancelled"].includes(d.status))
  const pedidosCompletados = dispatches.filter(d => d.status === "completed")

  // Trucks currently in transit: pick the most recent dispatch per mixer where mixer.status = "in_transit"
  const seenMixers = new Set<string>()
  const inTransitTrucks = dailyDispatches
    .filter(d => d.mixers?.status === "in_transit" && d.mixer_id)
    .filter(d => {
      if (seenMixers.has(d.mixer_id)) return false
      seenMixers.add(d.mixer_id)
      return true
    })

  const availableMixers = mixers.filter(m => m.status === "available")
  const urgentCount = pedidosActivos.filter(p => p.is_urgent).length

  const dailySummary = useMemo(() => {
    const totalM3 = dailyDispatches.reduce((sum, d) => sum + (d.quantity_m3 || 0), 0)
    const totalDespachos = dailyDispatches.length
    const byFormula: Record<string, { code: string; name: string; count: number; m3: number }> = {}
    dailyDispatches.forEach(d => {
      const key = d.formula_id || "unknown"
      if (!byFormula[key]) byFormula[key] = { code: d.formulas?.code || "N/A", name: d.formulas?.name || "Sin formula", count: 0, m3: 0 }
      byFormula[key].count++
      byFormula[key].m3 += d.quantity_m3 || 0
    })
    const byClient: Record<string, { name: string; count: number; m3: number }> = {}
    dailyDispatches.forEach(d => {
      const key = d.client_id || "unknown"
      if (!byClient[key]) byClient[key] = { name: d.clients?.name || "Sin cliente", count: 0, m3: 0 }
      byClient[key].count++
      byClient[key].m3 += d.quantity_m3 || 0
    })
    return {
      totalM3, totalDespachos,
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
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Planta" /></SelectTrigger>
            <SelectContent>
              {plants.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2 bg-muted/50 rounded-lg p-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goToPreviousDay}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant={isToday(selectedDate) ? "default" : "outline"} size="sm" className="min-w-[120px]" onClick={goToToday}>
              <CalendarDays className="h-4 w-4 mr-2" />
              {getDateLabel(selectedDate)}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goToNextDay}><ChevronRight className="h-4 w-4" /></Button>
          </div>

          <div className="text-sm text-muted-foreground hidden sm:block">{format(now, "HH:mm", { locale: es })}</div>
        </div>

        <div className="flex gap-2">
          <AddDispatchDialog formulas={formulas} clients={clients} mixers={mixers} plantId={selectedPlant} onSuccess={loadData} triggerLabel="Carga despacho manual" />
          <Button variant="outline" onClick={loadData} className="gap-2"><RefreshCw className="h-4 w-4" />Actualizar</Button>
        </div>
      </div>

      {/* Sample Reminder Banner */}
      <div className="bg-red-50 border border-red-300 rounded-lg px-4 py-3 flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0" />
        <p className="text-red-800 font-medium text-sm">Se recomienda extraer 3 muestras cada 50 m3 despachados</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-blue-100"><Clock className="h-5 w-5 text-blue-600" /></div>
            <div><p className="text-2xl font-bold">{pedidosActivos.length}</p><p className="text-sm text-muted-foreground">Pedidos Activos</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-purple-100"><Truck className="h-5 w-5 text-purple-600" /></div>
            <div><p className="text-2xl font-bold">{inTransitTrucks.length}</p><p className="text-sm text-muted-foreground">En Ruta</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-green-100"><CheckCircle className="h-5 w-5 text-green-600" /></div>
            <div><p className="text-2xl font-bold">{availableMixers.length}</p><p className="text-sm text-muted-foreground">Camiones Disponibles</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-yellow-100"><AlertTriangle className="h-5 w-5 text-yellow-600" /></div>
            <div><p className="text-2xl font-bold">{urgentCount}</p><p className="text-sm text-muted-foreground">Urgentes</p></div>
          </div>
        </CardContent></Card>
      </div>

      {/* Daily Summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2"><CheckCircle className="h-5 w-5 text-green-600" />Resumen del Dia</span>
            <div className="flex items-center gap-4 text-sm font-normal">
              <span className="text-muted-foreground">Total: <strong className="text-foreground">{dailySummary.totalDespachos} despachos</strong></span>
              <span className="text-muted-foreground">Volumen: <strong className="text-foreground">{dailySummary.totalM3.toFixed(1)} m3</strong></span>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dailyDispatches.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">No hay despachos registrados para este dia</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-sm font-semibold mb-3">Por Formula</h4>
                <div className="space-y-2">
                  {dailySummary.byFormula.map(f => (
                    <div key={f.code} className="flex items-center justify-between p-2 rounded bg-muted/50">
                      <div><span className="font-medium text-sm">{f.code}</span><span className="text-xs text-muted-foreground ml-2">{f.name}</span></div>
                      <div className="text-right text-sm"><span className="font-semibold">{f.m3.toFixed(1)} m3</span><span className="text-muted-foreground ml-2">({f.count} viajes)</span></div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-semibold mb-3">Por Cliente</h4>
                <div className="space-y-2">
                  {dailySummary.byClient.map(c => (
                    <div key={c.name} className="flex items-center justify-between p-2 rounded bg-muted/50">
                      <span className="font-medium text-sm truncate max-w-[60%]">{c.name}</span>
                      <div className="text-right text-sm"><span className="font-semibold">{c.m3.toFixed(1)} m3</span><span className="text-muted-foreground ml-2">({c.count})</span></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {dailyDispatches.length > 0 && (
            <div className="mt-6 pt-4 border-t">
              <h4 className="text-sm font-semibold mb-3">Ultimos Despachos</h4>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {dailyDispatches.slice(0, 10).map(d => (
                  <div key={d.id} className="flex items-center justify-between text-sm p-2 rounded hover:bg-muted/30">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-14">{format(parseISO(d.dispatch_date), "HH:mm")}</span>
                      <Badge variant="outline" className="text-xs">{d.formulas?.code || "N/A"}</Badge>
                      <span className="truncate max-w-[150px]">{d.clients?.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{d.quantity_m3} m3</span>
                      {d.remito && <span className="text-xs text-muted-foreground">R: {d.remito}</span>}
                      {d.mixers?.license_plate && <span className="text-xs text-muted-foreground">{d.mixers.license_plate}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pedidos del Día */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2"><Clock className="h-5 w-5" />Pedidos del Dia</span>
              {pedidosCompletados.length > 0 && (
                <Badge variant="secondary">{pedidosCompletados.length} completado{pedidosCompletados.length > 1 ? "s" : ""}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pedidosActivos.length === 0 && pedidosCompletados.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No hay pedidos para este dia</p>
            ) : (
              <>
                {pedidosActivos.map(pedido => {
                  const dispatched = pedido.dispatched_m3 || 0
                  const total = pedido.quantity_m3
                  const remaining = Math.max(0, total - dispatched)
                  const progress = Math.min(100, (dispatched / total) * 100)
                  return (
                    <Card key={pedido.id} className={pedido.is_urgent ? "ring-2 ring-red-500" : ""}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-semibold truncate">{pedido.clients?.name}</span>
                              {pedido.is_urgent && <Badge variant="destructive" className="shrink-0">URGENTE</Badge>}
                              {!!pedido.fiber_kg_per_m3 && (
                                <Badge variant="outline" className="shrink-0 border-purple-400 text-purple-700 bg-purple-50">
                                  FIBRA {pedido.fiber_kg_per_m3} kg/m³
                                </Badge>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground flex items-center gap-1 mb-1">
                              <MapPin className="h-3 w-3 shrink-0" />
                              <span className="truncate">{pedido.construction_sites?.name}</span>
                            </div>
                            <div className="text-sm mb-3">
                              <span className="font-medium">{pedido.formulas?.code}</span>
                              {pedido.observations && <span className="text-muted-foreground text-xs ml-2">{pedido.observations}</span>}
                            </div>
                            <div className="space-y-1">
                              <div className="flex justify-between text-xs">
                                <span className="text-muted-foreground">Enviado: <strong className="text-foreground">{dispatched.toFixed(1)} m3</strong></span>
                                <span className="text-muted-foreground">Restante: <strong className="text-orange-600">{remaining.toFixed(1)}</strong> / {total} m3</span>
                              </div>
                              <div className="w-full bg-muted rounded-full h-2">
                                <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col gap-2 items-end shrink-0">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => { setEditQuantity(pedido.quantity_m3.toString()); setEditDialog(pedido) }}>
                                  <Pencil className="h-4 w-4 mr-2" />Editar total
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => cancelPedido(pedido)} className="text-destructive">
                                  <XCircle className="h-4 w-4 mr-2" />Cancelar pedido
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            {remaining > 0 && (
                              <Button size="sm" onClick={() => openDispatchDialog(pedido)} className="gap-1">
                                <Truck className="h-3 w-3" />Despachar
                              </Button>
                            )}
                            {dispatched > 0 && remaining > 0 && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setFinalizarDialog(pedido)}
                                className="gap-1 border-emerald-500 text-emerald-700 hover:bg-emerald-50 whitespace-nowrap"
                              >
                                <CheckCircle className="h-3 w-3" />
                                Finalizar ({remaining.toFixed(1)} m3 sin enviar)
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}

                {pedidosCompletados.length > 0 && (
                  <div className="mt-2 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Completados</p>
                    {pedidosCompletados.map(pedido => (
                      <div key={pedido.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/50 text-sm">
                        <div>
                          <span className="font-medium">{pedido.clients?.name}</span>
                          <span className="text-muted-foreground ml-2">{pedido.construction_sites?.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-green-600 font-medium">{pedido.quantity_m3} m3</span>
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Camiones en Ruta */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Truck className="h-5 w-5" />Camiones en Ruta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {inTransitTrucks.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No hay camiones en ruta</p>
            ) : (
              inTransitTrucks.map(dispatch => {
                const departureTime = parseISO(dispatch.dispatch_date)
                const travelMinutes = dispatch.construction_sites?.travel_time_minutes || 30
                const expectedArrival = addMinutes(departureTime, travelMinutes)
                const minutesRemaining = differenceInMinutes(expectedArrival, now)
                return (
                  <Card key={dispatch.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="gap-1"><Truck className="h-3 w-3" />{dispatch.mixers?.license_plate}</Badge>
                            <ArrowRight className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">{dispatch.construction_sites?.name}</span>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {dispatch.clients?.name} - {dispatch.quantity_m3} m3
                            {dispatch.remito && <span> - R: {dispatch.remito}</span>}
                          </div>
                          <div className="text-sm mt-1">
                            {minutesRemaining > 0 ? (
                              <span className="text-muted-foreground">Llega en ~{minutesRemaining} min</span>
                            ) : (
                              <span className="text-green-600">Deberia haber llegado</span>
                            )}
                          </div>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => confirmDelivery(dispatch.mixer_id)}>
                          <CheckCircle className="h-4 w-4 mr-1" />Entregado
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
            <DialogTitle>Despachar Camion</DialogTitle>
            <DialogDescription>
              {dispatchDialog && (
                <span>{dispatchDialog.clients?.name} · {dispatchDialog.construction_sites?.name} · {dispatchDialog.formulas?.code}</span>
              )}
            </DialogDescription>
          </DialogHeader>
          {dispatchDialog && (
            <div className="space-y-4 py-2">
              <div className="p-3 rounded-lg bg-muted/50 text-sm">
                <div className="flex justify-between">
                  <span>Total pedido: <strong>{dispatchDialog.quantity_m3} m3</strong></span>
                  <span>Restante: <strong className="text-orange-600">{Math.max(0, dispatchDialog.quantity_m3 - (dispatchDialog.dispatched_m3 || 0)).toFixed(1)} m3</strong></span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Cantidad este camion (m3) *</Label>
                  <Input
                    type="number" step="0.5" min="0.5"
                    value={dispatchForm.quantity_m3}
                    onChange={e => setDispatchForm({ ...dispatchForm, quantity_m3: e.target.value })}
                    placeholder="Ej: 8"
                    className="text-lg font-semibold"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Camion *</Label>
                  <Select value={dispatchForm.mixer_id} onValueChange={v => setDispatchForm({ ...dispatchForm, mixer_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                    <SelectContent>
                      {mixers.map(m => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.license_plate}{m.status === "in_transit" ? " (en ruta)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Numero de Remito *</Label>
                <Input value={dispatchForm.remito} onChange={e => setDispatchForm({ ...dispatchForm, remito: e.target.value })} placeholder="Ej: R-001234" />
              </div>

              <div className="space-y-2">
                <Label>Agua Extra en Planta (litros)</Label>
                <Input type="number" value={dispatchForm.extraWater} onChange={e => setDispatchForm({ ...dispatchForm, extraWater: e.target.value })} placeholder="0" />
              </div>

              {/* Fibra de vidrio: se carga por m³ y el sistema calcula el total del camión */}
              <div className="rounded-lg border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Fibra de Vidrio</Label>
                    <p className="text-xs text-muted-foreground">Se agrega al camion en el despacho</p>
                  </div>
                  <Switch
                    checked={dispatchForm.fiberEnabled}
                    onCheckedChange={checked => setDispatchForm({ ...dispatchForm, fiberEnabled: checked, fiberKgPerM3: checked ? dispatchForm.fiberKgPerM3 : "" })}
                  />
                </div>

                {dispatchForm.fiberEnabled && (() => {
                  const perM3 = parseFloat(dispatchForm.fiberKgPerM3) || 0
                  const m3 = parseFloat(dispatchForm.quantity_m3) || 0
                  const total = perM3 * m3
                  return (
                    <div className="flex items-end gap-3">
                      <div className="space-y-1 flex-1">
                        <Label className="text-xs">Dosificacion (kg por m³)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          inputMode="decimal"
                          value={dispatchForm.fiberKgPerM3}
                          onChange={e => setDispatchForm({ ...dispatchForm, fiberKgPerM3: e.target.value })}
                          placeholder="Ej: 0.5"
                        />
                      </div>
                      <div className="flex-1 pb-1">
                        {total > 0 ? (
                          <p className="text-xs text-muted-foreground leading-tight">
                            Total en el camion:{" "}
                            <span className="font-semibold text-foreground">
                              {total.toLocaleString("es-AR", { maximumFractionDigits: 2 })} kg
                            </span>
                            <br />
                            <span className="text-[11px]">
                              {perM3.toLocaleString("es-AR", { maximumFractionDigits: 2 })} kg/m³ × {m3.toLocaleString("es-AR", { maximumFractionDigits: 1 })} m³
                            </span>
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground leading-tight">
                            Ingresá los kg por m³ para ver el total del camion.
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })()}
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label>Muestra de Probeta</Label>
                  <p className="text-xs text-muted-foreground">Se extrajo muestra para ensayo de compresion</p>
                </div>
                <Switch checked={dispatchForm.sampleTaken} onCheckedChange={checked => setDispatchForm({ ...dispatchForm, sampleTaken: checked })} />
              </div>

              {dispatchForm.sampleTaken && (
                <div className="space-y-4 p-3 rounded-lg bg-muted/50">
                  {lastSampleNumber && (
                    <div className="flex items-center gap-2 p-2 rounded bg-blue-50 border border-blue-200">
                      <span className="text-xs text-blue-700">Ultima muestra:</span>
                      <span className="font-mono font-semibold text-blue-900">{lastSampleNumber}</span>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Numero de Muestra *</Label>
                      <Input value={dispatchForm.sampleNumber} onChange={e => setDispatchForm({ ...dispatchForm, sampleNumber: e.target.value })} placeholder="Ej: M-001" />
                    </div>
                    <div className="space-y-2">
                      <Label>Asentamiento Real (cm) *</Label>
                      <Input type="number" step="0.5" value={dispatchForm.actualSlump} onChange={e => setDispatchForm({ ...dispatchForm, actualSlump: e.target.value })} placeholder="Ej: 12.5" />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">Se crearan 3 probetas: 1 para 7 dias y 2 para 28 dias</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDispatchDialog(null)}>Cancelar</Button>
            <Button onClick={handleDispatch} disabled={submitting}>{submitting ? "Registrando..." : "Confirmar Despacho"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit quantity dialog */}
      {/* Confirmacion de cierre con m3 pendientes */}
      <Dialog open={!!finalizarDialog} onOpenChange={(open) => !open && setFinalizarDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Finalizar pedido</DialogTitle>
            <DialogDescription>
              El pedido se cierra con lo que ya se despacho. No se puede despachar mas sobre este pedido.
            </DialogDescription>
          </DialogHeader>
          {finalizarDialog && (() => {
            const despachado = finalizarDialog.dispatched_m3 || 0
            const pendiente = Math.max(0, finalizarDialog.quantity_m3 - despachado)
            return (
              <div className="space-y-3 py-2">
                <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-1">
                  <p><span className="text-muted-foreground">Cliente:</span> <strong>{finalizarDialog.clients?.name}</strong></p>
                  <p><span className="text-muted-foreground">Obra:</span> <strong>{finalizarDialog.construction_sites?.name}</strong></p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border p-2">
                    <p className="text-[11px] text-muted-foreground">Programado</p>
                    <p className="text-lg font-bold">{finalizarDialog.quantity_m3}</p>
                  </div>
                  <div className="rounded-lg border p-2">
                    <p className="text-[11px] text-muted-foreground">Despachado</p>
                    <p className="text-lg font-bold text-emerald-600">{despachado.toFixed(1)}</p>
                  </div>
                  <div className="rounded-lg border p-2">
                    <p className="text-[11px] text-muted-foreground">Sin enviar</p>
                    <p className="text-lg font-bold text-orange-600">{pendiente.toFixed(1)}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Queda registrado que se cerro con {pendiente.toFixed(1)} m3 sin despachar.
                </p>
              </div>
            )
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setFinalizarDialog(null)}>Cancelar</Button>
            <Button onClick={() => finalizarDialog && finalizarPedido(finalizarDialog)}>
              Finalizar pedido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editDialog} onOpenChange={(open) => !open && setEditDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil className="h-5 w-5" />Editar Total del Pedido</DialogTitle>
          </DialogHeader>
          {editDialog && (
            <div className="space-y-4 py-2">
              <div className="text-sm text-muted-foreground">{editDialog.clients?.name} · {editDialog.construction_sites?.name}</div>
              <div className="space-y-2">
                <Label>Cantidad Total (m3)</Label>
                <div className="flex items-center gap-2">
                  <Input type="number" step="0.5" value={editQuantity} onChange={e => setEditQuantity(e.target.value)} className="text-lg font-semibold" />
                  <span className="text-muted-foreground">m3</span>
                </div>
                <p className="text-xs text-muted-foreground">Valor actual: {editDialog.quantity_m3} m3</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(null)}>Cancelar</Button>
            <Button onClick={saveEditQuantity}>Guardar</Button>
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
                        onClick={() => setHumidityForm({ ...humidityForm, [material.id]: { ...form, mode: "direct" } })}
                      >
                        Ingresar %
                      </Button>
                      <Button
                        type="button"
                        variant={form.mode === "calculate" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setHumidityForm({ ...humidityForm, [material.id]: { ...form, mode: "calculate" } })}
                      >
                        Calcular
                      </Button>
                    </div>

                    {form.mode === "direct" ? (
                      <div className="space-y-2">
                        <Label className="text-xs">Humedad (%)</Label>
                        <Input
                          type="number" step="0.1" placeholder="Ej: 5.5"
                          value={form.humidity}
                          onChange={(e) => setHumidityForm({ ...humidityForm, [material.id]: { ...form, humidity: e.target.value } })}
                        />
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Peso Humedo (g)</Label>
                            <Input
                              type="number" placeholder="Ej: 500"
                              value={form.wetWeight}
                              onChange={(e) => setHumidityForm({ ...humidityForm, [material.id]: { ...form, wetWeight: e.target.value } })}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Peso Seco (g)</Label>
                            <Input
                              type="number" placeholder="Ej: 475"
                              value={form.dryWeight}
                              onChange={(e) => setHumidityForm({ ...humidityForm, [material.id]: { ...form, dryWeight: e.target.value } })}
                            />
                          </div>
                        </div>
                        {calculatedHumidity && (
                          <p className="text-sm font-medium text-primary">Humedad calculada: {calculatedHumidity}%</p>
                        )}
                        <p className="text-xs text-muted-foreground">Formula: (Peso Humedo - Peso Seco) / Peso Seco × 100</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowHumidityModal(false)}>Omitir por ahora</Button>
            <Button onClick={saveHumidity} disabled={savingHumidity}>{savingHumidity ? "Guardando..." : "Guardar Humedad"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
