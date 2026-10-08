"use client"

import { useState, useEffect, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { Truck, CheckCircle, Clock, MapPin, AlertTriangle, RefreshCw, ArrowRight, ChevronLeft, ChevronRight, CalendarDays, Pencil, X, MoreHorizontal, XCircle, Printer } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { format, parseISO, differenceInMinutes, addMinutes, addDays, subDays, isToday, isTomorrow, isYesterday } from "date-fns"
import { es } from "date-fns/locale"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { AddDispatchDialog } from "@/components/add-dispatch-dialog"
import { cn } from "@/lib/utils"
import { currentUserName, usePermisos } from "@/lib/current-user"
import { logActivity } from "@/lib/activity-log"
import { CampoMotivo, ConfirmarConMotivo, motivoValido } from "@/components/motivo"
import { ChoferSelect } from "@/components/chofer-select"
import { cargarChoferes, cargarEmpresasBombeo, choferPorCamionDelDia, textoBomba, type Chofer, type EmpresaBombeo } from "@/lib/maestros"
// Fase 2 (solo con el interruptor de funciones nuevas)
import { useFuncionesNuevas } from "@/lib/current-user"
import { NuevoBadge } from "@/components/nuevo-badge"
import { GerenciadorViajes, type PedidoGerenciador } from "@/components/gerenciador-viajes"
import { cargarViajes, pendientes, proximoViaje, regenerarViajesPedido, totalViajes, type ViajeRow } from "@/lib/viajes"

type Plant = { id: string; name: string }
type ScheduledDispatch = {
  id: string; client_id: string; construction_site_id: string; formula_id: string; mixer_id: string | null;
  quantity_m3: number; dispatched_m3: number;
  scheduled_arrival_time: string; scheduled_departure_time: string;
  status: string; observations: string | null; is_urgent: boolean;
  fiber_kg_per_m3?: number | null;
  metodo_descarga?: "bomba" | "directo" | null;
  // Fase 1 (nulos hasta aplicar la migración)
  finalidad?: string | null;
  bomba_la_pone?: "rebucret" | "cliente" | null;
  bomba_empresa_id?: string | null;
  bomba_hora?: string | null;
  // Fase 2 (nulos hasta aplicar la migración)
  confirmado_at?: string | null;
  confirmado_por?: string | null;
  plant_id?: string;
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
  // Fase 1: choferes (rotan, se elige en cada despacho) y empresas de bombeo
  const [choferes, setChoferes] = useState<Chofer[]>([])
  const [empresasBombeo, setEmpresasBombeo] = useState<EmpresaBombeo[]>([])
  const [choferPorCamion, setChoferPorCamion] = useState<Record<string, string>>({})
  const [choferTocado, setChoferTocado] = useState(false)
  const [now, setNow] = useState(new Date())
  const { toast } = useToast()
  // Fase 2: próximo viaje de cada pedido, elección del viaje al despachar y gerenciador
  const ve = useFuncionesNuevas()
  const [viajesPorPedido, setViajesPorPedido] = useState<Record<string, ViajeRow[]>>({})
  const [gerenciar, setGerenciar] = useState<PedidoGerenciador | null>(null)

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
    chofer_id: "",
    remito: "",
    extraWater: "0",
    sampleTaken: false,
    sampleNumber: "",
    actualSlump: "",
    // Fibra agregada al camión, dosificada en kg por m³
    fiberEnabled: false,
    fiberKgPerM3: "",
    viaje_n: "", // fase 2: el número del viaje que sale (solo con el interruptor; se resuelve al despachar)
  })
  const [submitting, setSubmitting] = useState(false)
  const [lastSampleNumber, setLastSampleNumber] = useState<string | null>(null)

  // Edit pedido total dialog
  const [editDialog, setEditDialog] = useState<ScheduledDispatch | null>(null)
  const [editQuantity, setEditQuantity] = useState("")
  const [finalizarDialog, setFinalizarDialog] = useState<ScheduledDispatch | null>(null)
  // Al confirmar una carga se abre esto para que el operario imprima el remito en el momento
  const [remitoListo, setRemitoListo] = useState<{ id: string; remito: string; m3: number; cliente: string; obra: string; patente: string; chofer?: string } | null>(null)

  // Daily humidity state
  const [humidityMaterials, setHumidityMaterials] = useState<any[]>([])
  const [showHumidityModal, setShowHumidityModal] = useState(false)
  const [humidityChecked, setHumidityChecked] = useState(false)
  const [humidityForm, setHumidityForm] = useState<Record<string, { mode: "direct" | "calculate"; humidity: string; wetWeight: string; dryWeight: string }>>({})
  const [savingHumidity, setSavingHumidity] = useState(false)
  // Fase 0c-1: permisos
  const { puede } = usePermisos()
  const puedeDespachar = puede("despacho", "cargar")
  const puedeHumedad = puede("materia_prima", "cargar")
  const [motivoTotal, setMotivoTotal] = useState("")
  const [cancelarPedido, setCancelarPedido] = useState<ScheduledDispatch | null>(null)

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (selectedPlant) loadData()
    const interval = setInterval(() => { if (selectedPlant) loadData() }, 30000)
    return () => clearInterval(interval)
  }, [selectedPlant, selectedDate, ve])

  useEffect(() => {
    // Fase 0c-1: el aviso de humedad solo le aparece a quien carga materia prima
    if (selectedPlant && isToday(selectedDate) && !humidityChecked && puedeHumedad) {
      checkDailyHumidity()
    }
  }, [selectedPlant, puedeHumedad]) // eslint-disable-line react-hooks/exhaustive-deps

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
    // Fecha local (Argentina), no UTC: a la noche toISOString ya daría el día siguiente
    const today = format(new Date(), "yyyy-MM-dd")
    const { data: materials } = await supabase
      .from("materials")
      .select("id, name, stockpile_humidity")
      .eq("plant_id", selectedPlant)
      // Solo la Arena Fina: es la única a la que se le mide la humedad (la de la 0/6 no se toma)
      .ilike("name", "arena fina")
      .order("name")
    if (!materials || materials.length === 0) { setHumidityChecked(true); return }
    const { data: todayLogs } = await supabase
      .from("daily_stockpile_humidity")
      .select("material_id")
      .eq("reading_date", today)
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
    if (!puedeHumedad) return
    setSavingHumidity(true)
    const supabase = createClient()
    if (!supabase) { setSavingHumidity(false); return }
    const today = format(new Date(), "yyyy-MM-dd")
    try {
      for (const material of humidityMaterials) {
        const form = humidityForm[material.id]
        let humidity: number
        if (form.mode === "direct") {
          humidity = parseFloat(form.humidity)
          if (isNaN(humidity) || humidity < 0) {
            toast({ title: "Error", description: `Ingresá la humedad de ${material.name}`, variant: "destructive" })
            setSavingHumidity(false)
            return
          }
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
        // Una lectura por material, planta y día (índice único): si ya había una, se reemplaza.
        // El trigger trg_update_stockpile_humidity copia el valor a materials.stockpile_humidity,
        // que es la humedad que usa el despacho para corregir la arena.
        const { error } = await supabase.from("daily_stockpile_humidity").upsert({
          material_id: material.id,
          plant_id: selectedPlant,
          reading_date: today,
          humidity_percent: humidity,
          wet_weight_grams: form.mode === "calculate" ? parseFloat(form.wetWeight) : null,
          dry_weight_grams: form.mode === "calculate" ? parseFloat(form.dryWeight) : null,
          recorded_by: currentUserName(),
        }, { onConflict: "plant_id,material_id,reading_date" })
        if (error) throw error
        logActivity({
          action: "crear",
          entity: "humedad",
          entityId: material.id,
          reference: material.name,
          plantId: selectedPlant,
          details: { Material: material.name, "Humedad (%)": Math.round(humidity * 100) / 100, Fecha: today },
        })
      }
      toast({ title: "Humedad registrada", description: "Los valores de humedad del acopio fueron actualizados" })
      setShowHumidityModal(false)
      setHumidityChecked(true)
    } catch (error: any) {
      console.error("[v0] Error saving humidity:", error)
      toast({ title: "Error", description: `No se pudo guardar la humedad${error?.message ? `: ${error.message}` : ""}`, variant: "destructive" })
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
        .eq("plant_id", selectedPlant)
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
    // Fase 1: si la migración no está aplicada, quedan vacíos y todo sigue como antes
    const [chs, emps] = await Promise.all([cargarChoferes(supabase), cargarEmpresasBombeo(supabase)])
    setChoferes(chs)
    setEmpresasBombeo(emps)
    // Fase 2: viajes de los pedidos del día (solo con el interruptor)
    if (ve) setViajesPorPedido(await cargarViajes(supabase, (dispatchesRes.data || []).map((d: any) => d.id)))
  }

  const nombreChofer = (id?: string | null) => (id ? choferes.find((c) => c.id === id)?.nombre || null : null)
  const hayChoferesActivos = choferes.some((c) => c.activo)

  /**
   * Cierra un pedido aunque falten m³ por despachar (ej: se pidieron 40 y la
   * obra recibió 38). El pedido queda como completado con lo realmente
   * despachado; los m³ pendientes se anotan en las observaciones.
   */
  async function finalizarPedido(pedido: ScheduledDispatch) {
    if (!puedeDespachar) return
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
    logActivity({
      action: "editar",
      entity: "pedido",
      entityId: pedido.id,
      reference: `${pedido.clients?.name || "-"} · ${pedido.construction_sites?.name || "-"}`,
      plantId: pedido.plant_id || selectedPlant,
      details: { Estado: "→ completado", Finalizado: `con ${despachado.toFixed(1)} de ${pedido.quantity_m3} m³` },
    })
    loadData()
  }

  async function cancelPedido(pedido: ScheduledDispatch, motivo: string) {
    if (!puede("programacion", "borrar")) return
    const supabase = createClient()
    if (!supabase) return
    const { error } = await supabase.from("scheduled_dispatches").update({ status: "cancelled" }).eq("id", pedido.id)
    if (error) {
      toast({ title: "No se pudo cancelar", description: error.message, variant: "destructive" })
      return
    }
    toast({ title: "Pedido cancelado" })
    // Sin mail: el pedido no se borra
    logActivity({
      action: "editar",
      entity: "pedido",
      entityId: pedido.id,
      reference: `${pedido.clients?.name || "-"} · ${pedido.construction_sites?.name || "-"}`,
      plantId: pedido.plant_id || selectedPlant,
      details: { Estado: `${pedido.status} → cancelado`, "m³": pedido.quantity_m3, Enviado: pedido.dispatched_m3 || 0, Motivo: motivo },
    })
    loadData()
  }

  async function confirmDelivery(mixerId: string) {
    if (!puedeDespachar) return
    const supabase = createClient()
    if (!supabase) return
    await supabase.from("mixers").update({ status: "available" }).eq("id", mixerId)
    toast({ title: "Entrega confirmada", description: "Camion disponible nuevamente" })
    loadData()
  }

  async function saveEditQuantity() {
    if (!editDialog || !puede("programacion", "editar")) return
    const qty = parseFloat(editQuantity)
    if (isNaN(qty) || qty <= 0) {
      toast({ title: "Error", description: "Ingrese una cantidad valida", variant: "destructive" })
      return
    }
    if (!motivoValido(motivoTotal)) {
      toast({ title: "Falta el motivo", description: "Escribí por qué se cambia el total.", variant: "destructive" })
      return
    }
    const supabase = createClient()
    if (!supabase) return
    const { error } = await supabase.from("scheduled_dispatches").update({ quantity_m3: qty }).eq("id", editDialog.id)
    if (error) {
      toast({ title: "No se pudo guardar", description: error.message, variant: "destructive" })
      return
    }
    toast({ title: "Total actualizado", description: `Nueva cantidad: ${qty} m3` })
    if (qty !== Number(editDialog.quantity_m3))
      logActivity({
        action: "editar",
        entity: "pedido",
        entityId: editDialog.id,
        reference: `${editDialog.clients?.name || "-"} · ${editDialog.construction_sites?.name || "-"}`,
        plantId: editDialog.plant_id || selectedPlant,
        details: { "m³": `${editDialog.quantity_m3} → ${qty}`, Origen: "Editar total (Despacho diario)", Motivo: motivoTotal.trim() },
      })
    // Fase 2: si el pedido ya tenía viajes y cambió el total, los pendientes se rearman
    if (qty !== Number(editDialog.quantity_m3)) {
      const rv = await regenerarViajesPedido(supabase, editDialog.id, currentUserName(), { soloSiTiene: true, motivo: "cantidad" })
      if (rv.error) toast({ title: "Los viajes no se actualizaron", description: rv.error, variant: "destructive" })
      else if (ve && rv.generados != null) toast({ title: "Se recalcularon los viajes de este pedido" })
    }
    setEditDialog(null)
    loadData()
  }

  async function openDispatchDialog(pedido: ScheduledDispatch) {
    const remaining = pedido.quantity_m3 - (pedido.dispatched_m3 || 0)
    // Fase 2 (con el interruptor): se propone el próximo viaje, con sus m³ y su camión sugerido
    const prox = ve ? proximoViaje(viajesPorPedido[pedido.id] || []) : null
    const suggestedQty = Math.min(Math.max(0.5, remaining), prox ? Number(prox.m3) : 8)
    setDispatchForm({
      quantity_m3: suggestedQty.toFixed(1),
      mixer_id: pedido.mixer_id || prox?.mixer_id || "",
      viaje_n: prox ? String(prox.n) : "",
      chofer_id: "",
      remito: "",
      extraWater: "0",
      sampleTaken: false,
      sampleNumber: "",
      actualSlump: "",
      fiberEnabled: pedido.fiber_kg_per_m3 != null && pedido.fiber_kg_per_m3 > 0,
      fiberKgPerM3: pedido.fiber_kg_per_m3 != null ? String(pedido.fiber_kg_per_m3) : "",
    })
    setDispatchDialog(pedido)
    setChoferTocado(false)
    loadLastSampleNumber()
    // Chofer por defecto: el del último viaje de ese camión hoy (se puede cambiar: rotan)
    const supabase = createClient()
    if (supabase) {
      const mapa = await choferPorCamionDelDia(supabase)
      setChoferPorCamion(mapa)
      // Con el camión elegido en ese momento (el operario pudo cambiarlo mientras cargaba la consulta)
      setDispatchForm((f) => (f.chofer_id || !f.mixer_id || !mapa[f.mixer_id] ? f : { ...f, chofer_id: mapa[f.mixer_id] }))
    }
  }

  /** Al cambiar de camión se propone su último chofer del día, salvo que ya se haya elegido uno a mano. */
  function elegirCamion(mixerId: string) {
    setDispatchForm((f) => ({
      ...f,
      mixer_id: mixerId,
      // Si no se eligió a mano, no queda el chofer del camión anterior
      chofer_id: choferTocado ? f.chofer_id : (choferPorCamion[mixerId] || ""),
    }))
  }

  async function handleDispatch() {
    if (!dispatchDialog || !puedeDespachar) return

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
    // Chofer obligatorio solo cuando hay choferes cargados (si la lista está vacía se despacha igual)
    if (hayChoferesActivos && !dispatchForm.chofer_id) {
      toast({ title: "Error", description: "Elegí el chofer", variant: "destructive" })
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

    try {
      // Fase 2: el viaje elegido se busca de nuevo por número (los viajes se pudieron rearmar mientras tanto).
      // Si ya no está pendiente, sale el primer pendiente y se avisa.
      let viajeElegidoId: string | null = null
      if (ve && dispatchForm.viaje_n) {
        const frescos = pendientes((await cargarViajes(supabase, [dispatchDialog.id]))[dispatchDialog.id] || [])
        const elegido = frescos.find((v) => String(v.n) === dispatchForm.viaje_n) || frescos[0] || null
        if (elegido && String(elegido.n) !== dispatchForm.viaje_n) {
          toast({ title: `El viaje ${dispatchForm.viaje_n} ya no está pendiente`, description: `Se despacha como viaje ${elegido.n}.` })
        }
        viajeElegidoId = elegido?.id || null
      }
      // Todo el despacho en una sola transacción de la base (fase 0b): remito no repetido,
      // m³ contra el restante, materiales de la fórmula en el stock de ESTA planta (con la
      // humedad de la Arena Fina), fibra, probetas (trigger), pedido, camión en ruta y actividad.
      // Si algo falla no queda nada grabado.
      const fiberPerM3 = parseFloat(dispatchForm.fiberKgPerM3) || 0
      const { data: result, error: rpcError } = await supabase.rpc("registrar_despacho", {
        p: {
          plant_id: selectedPlant,
          scheduled_dispatch_id: dispatchDialog.id,
          formula_id: dispatchDialog.formula_id,
          client_id: dispatchDialog.client_id,
          construction_site_id: dispatchDialog.construction_site_id,
          mixer_id: dispatchForm.mixer_id,
          ...(dispatchForm.chofer_id ? { chofer_id: dispatchForm.chofer_id } : {}),
          // Fase 2: el viaje elegido (si no viene, la base marca el primer viaje pendiente del pedido, si tiene)
          ...(viajeElegidoId ? { viaje_id: viajeElegidoId } : {}),
          quantity_m3: quantityThisTruck,
          remito: dispatchForm.remito.trim(),
          extra_water_liters: parseFloat(dispatchForm.extraWater) || 0,
          fiber_kg_per_m3: dispatchForm.fiberEnabled && fiberPerM3 > 0 ? fiberPerM3 : 0,
          sample_taken: dispatchForm.sampleTaken,
          sample_number: dispatchForm.sampleTaken ? dispatchForm.sampleNumber.trim() : null,
          actual_slump_cm: dispatchForm.sampleTaken ? parseFloat(dispatchForm.actualSlump) : null,
          created_by: currentUserName(),
          usuario: currentUserName(),
        },
      })
      if (rpcError) {
        toast({ title: "Error", description: rpcError.message || "No se pudo registrar el despacho", variant: "destructive" })
        return
      }
      const newDispatch = result as { id: string; restante: number | null; completo: boolean; viaje_n?: number; viaje_m3_planificado?: number | null } | null
      // Fase 2: si el camión salió con otros m³ que los del viaje, se rearman los pendientes (para todos, si el pedido tiene viajes)
      if (newDispatch?.viaje_n != null && newDispatch.viaje_m3_planificado != null && !newDispatch.completo
          && Math.abs(Number(newDispatch.viaje_m3_planificado) - quantityThisTruck) > 0.01) {
        const rv = await regenerarViajesPedido(supabase, dispatchDialog.id, currentUserName(), { soloSiTiene: true, motivo: `m³ del viaje ${newDispatch.viaje_n} (${newDispatch.viaje_m3_planificado} → ${quantityThisTruck})` })
        if (ve && rv.generados != null) toast({ title: "Se recalcularon los viajes de este pedido", description: `El viaje ${newDispatch.viaje_n} salió con ${quantityThisTruck} m³.` })
      }

      const remainingAfter = Math.max(0, newDispatch?.restante ?? remaining - quantityThisTruck)
      toast({
        title: "Camion despachado",
        description: dispatchForm.sampleTaken
          ? `Remito ${dispatchForm.remito} · Muestra ${dispatchForm.sampleNumber} · ${remainingAfter > 0 ? `Restante: ${remainingAfter.toFixed(1)}m3` : "Pedido completo"}`
          : `Remito ${dispatchForm.remito} · ${remainingAfter > 0 ? `Restante: ${remainingAfter.toFixed(1)}m3` : "Pedido completo"}`,
      })

      setDispatchDialog(null)
      if (newDispatch?.id) {
        setRemitoListo({
          id: newDispatch.id,
          remito: dispatchForm.remito,
          m3: quantityThisTruck,
          cliente: dispatchDialog.clients?.name || "",
          obra: dispatchDialog.construction_sites?.name || "",
          patente: mixers.find(m => m.id === dispatchForm.mixer_id)?.license_plate || "",
          chofer: nombreChofer(dispatchForm.chofer_id) || "",
        })
      }
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
  // Despachos del día cargados a mano (sin pedido programado). No son pedidos, pero salieron.
  const despachosManuales = dailyDispatches.filter(d => !d.scheduled_dispatch_id && !d.is_test_dispatch)

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
          {puedeDespachar && (
            <AddDispatchDialog
              formulas={formulas}
              clients={clients}
              mixers={mixers}
              plantId={selectedPlant}
              onSuccess={(d) => { loadData(); if (d?.id) setRemitoListo(d) }}
              triggerLabel="Carga despacho manual"
            />
          )}
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
              <h4 className="text-sm font-semibold mb-3">Ultimos Despachos <span className="font-normal text-muted-foreground text-xs">(el último cargado, primero)</span></h4>
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {[...dailyDispatches]
                  .sort((a, b) => (b.created_at || b.dispatch_date).localeCompare(a.created_at || a.dispatch_date))
                  .slice(0, 15)
                  .map(d => (
                  <div key={d.id} className="flex items-center justify-between text-sm p-2 rounded hover:bg-muted/30 gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs text-muted-foreground w-14 shrink-0">{format(parseISO(d.dispatch_date), "HH:mm")}</span>
                      <Badge variant="outline" className="text-xs shrink-0">{d.formulas?.code || "N/A"}</Badge>
                      <span className="truncate">{d.clients?.name}</span>
                      {!d.scheduled_dispatch_id && <Badge variant="secondary" className="text-[10px] shrink-0">manual</Badge>}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-medium">{d.quantity_m3} m3</span>
                      {d.remito && <span className="text-xs text-muted-foreground">R: {d.remito}</span>}
                      {d.mixers?.license_plate && <span className="text-xs text-muted-foreground">{d.mixers.license_plate}</span>}
                      {nombreChofer(d.chofer_id) && <span className="text-xs text-muted-foreground">· {nombreChofer(d.chofer_id)}</span>}
                      {!d.is_test_dispatch && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Ver remito" onClick={() => window.open(`/api/remito/${d.id}`, "_blank")}>
                          <Printer className="h-4 w-4" />
                        </Button>
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
            {pedidosActivos.length === 0 && pedidosCompletados.length === 0 && despachosManuales.length === 0 ? (
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
                              {pedido.metodo_descarga && (
                                <Badge variant="outline" className={pedido.metodo_descarga === "bomba" ? "shrink-0 border-sky-400 text-sky-700 bg-sky-50" : "shrink-0"}>
                                  {pedido.metodo_descarga === "bomba" ? textoBomba(pedido, empresasBombeo) : "DIRECTO"}
                                </Badge>
                              )}
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
                              {pedido.finalidad && <Badge variant="outline" className="ml-2 text-[10px] py-0">{pedido.finalidad}</Badge>}
                              {pedido.observations && <span className="text-muted-foreground text-xs ml-2">{pedido.observations}</span>}
                            </div>
                            {/* Fase 2: próximo viaje y confirmación (solo con el interruptor) */}
                            {ve && (() => {
                              const vs = viajesPorPedido[pedido.id] || []
                              const prox = proximoViaje(vs)
                              if (!prox && !pedido.confirmado_at) return null
                              const atrasado = !!prox && isToday(selectedDate) && now.getTime() > new Date(prox.hora_carga).getTime()
                              const patente = prox?.mixer_id ? mixers.find((m) => m.id === prox.mixer_id)?.license_plate : null
                              return (
                                <div className={cn("mb-2 flex items-center gap-2 flex-wrap rounded-md border px-2 py-1 text-xs", atrasado ? "border-red-400 bg-red-50 text-red-800" : "border-violet-200 bg-violet-50/50")}>
                                  {prox && (
                                    <span className="font-medium">
                                      Próximo: viaje {prox.n}/{totalViajes(vs)} · cargar {format(new Date(prox.hora_carga), "HH:mm")}{patente ? ` · ${patente}` : ""}
                                      {atrasado && " · ya pasó la hora de carga"}
                                    </span>
                                  )}
                                  {pedido.confirmado_at && <span className="text-emerald-700">👍 Confirmado</span>}
                                  <NuevoBadge />
                                </div>
                              )
                            })()}
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
                            {(puede("programacion", "editar") || puede("programacion", "borrar") || ve) && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {puede("programacion", "editar") && (
                                  <DropdownMenuItem onClick={() => { setEditQuantity(pedido.quantity_m3.toString()); setMotivoTotal(""); setEditDialog(pedido) }}>
                                    <Pencil className="h-4 w-4 mr-2" />Editar total
                                  </DropdownMenuItem>
                                )}
                                {ve && (
                                  <DropdownMenuItem onClick={() => setGerenciar({ ...(pedido as any), plant_id: pedido.plant_id || selectedPlant })}>
                                    <Truck className="h-4 w-4 mr-2" />Viajes <NuevoBadge className="ml-2" />
                                  </DropdownMenuItem>
                                )}
                                {puede("programacion", "borrar") && (
                                  <DropdownMenuItem onClick={() => setCancelarPedido(pedido)} className="text-destructive">
                                    <XCircle className="h-4 w-4 mr-2" />Cancelar pedido
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                            )}
                            {remaining > 0 && puedeDespachar && (
                              <Button size="sm" onClick={() => openDispatchDialog(pedido)} className="gap-1">
                                <Truck className="h-3 w-3" />Despachar
                              </Button>
                            )}
                            {dispatched > 0 && remaining > 0 && puedeDespachar && (
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

                {despachosManuales.length > 0 && (
                  <div className="mt-2 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Despachos manuales (sin pedido)</p>
                    {despachosManuales.map(d => (
                      <div key={d.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/50 text-sm gap-2">
                        <div className="min-w-0">
                          <span className="font-medium">{d.clients?.name || "Sin cliente"}</span>
                          <span className="text-muted-foreground ml-2">{d.formulas?.code}{d.remito ? ` · R: ${d.remito}` : ""}{d.mixers?.license_plate ? ` · ${d.mixers.license_plate}` : ""}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-green-600 font-medium">{d.quantity_m3} m3</span>
                          <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => window.open(`/api/remito/${d.id}`, "_blank")}>
                            <Printer className="h-3 w-3" />Remito
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

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
                            {nombreChofer(dispatch.chofer_id) && <span> · Chofer: {nombreChofer(dispatch.chofer_id)}</span>}
                          </div>
                          <div className="text-sm mt-1">
                            {minutesRemaining > 0 ? (
                              <span className="text-muted-foreground">Llega en ~{minutesRemaining} min</span>
                            ) : (
                              <span className="text-green-600">Deberia haber llegado</span>
                            )}
                          </div>
                        </div>
                        {puedeDespachar && (
                          <Button size="sm" variant="outline" onClick={() => confirmDelivery(dispatch.mixer_id)}>
                            <CheckCircle className="h-4 w-4 mr-1" />Entregado
                          </Button>
                        )}
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
                  <Select value={dispatchForm.mixer_id} onValueChange={elegirCamion}>
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

              {/* Fase 2: qué viaje sale (solo con el interruptor y si el pedido tiene viajes pendientes) */}
              {ve && pendientes(viajesPorPedido[dispatchDialog.id] || []).length > 0 && (
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">Viaje <NuevoBadge /></Label>
                  <Select value={dispatchForm.viaje_n} onValueChange={(v) => setDispatchForm((f) => ({ ...f, viaje_n: v }))}>
                    <SelectTrigger><SelectValue placeholder="Elegí el viaje" /></SelectTrigger>
                    <SelectContent>
                      {pendientes(viajesPorPedido[dispatchDialog.id] || []).map((v) => (
                        <SelectItem key={v.id} value={String(v.n)}>
                          Viaje {v.n}/{totalViajes(viajesPorPedido[dispatchDialog.id] || [])} · {v.m3} m³ · cargar {format(new Date(v.hora_carga), "HH:mm")}{v.mixer_id ? ` · ${mixers.find((m) => m.id === v.mixer_id)?.license_plate || ""}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Chofer, junto al camión (fase 1). Rotan: por defecto el del último viaje de ese camión hoy */}
              <ChoferSelect
                choferes={choferes}
                value={dispatchForm.chofer_id}
                onChange={(v) => { setChoferTocado(true); setDispatchForm((f) => ({ ...f, chofer_id: v })) }}
                obligatorio
              />

              <div className="space-y-2">
                <Label>Numero de Remito *</Label>
                <Input value={dispatchForm.remito} onChange={e => setDispatchForm({ ...dispatchForm, remito: e.target.value })} placeholder="Ej: R-001234" />
              </div>

              <div className="space-y-2">
                <Label>Agua Extra en Planta (litros)</Label>
                <Input type="number" value={dispatchForm.extraWater} onChange={e => setDispatchForm({ ...dispatchForm, extraWater: e.target.value })} placeholder="0" />
              </div>

              {/* Fibra: se carga por m³ y el sistema calcula el total del camión */}
              <div className="rounded-lg border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Fibra</Label>
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

      {/* Fase 2: gerenciador de viajes */}
      <GerenciadorViajes pedido={gerenciar} open={!!gerenciar} onOpenChange={(v) => !v && setGerenciar(null)} onGuardado={() => loadData()} />

      {/* Remito listo para imprimir: aparece apenas se confirma la carga */}
      <Dialog open={!!remitoListo} onOpenChange={(open) => !open && setRemitoListo(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-emerald-600" /> Camión despachado
            </DialogTitle>
            <DialogDescription>El camión ya está registrado. Imprimí el remito antes de que salga.</DialogDescription>
          </DialogHeader>
          {remitoListo && (
            <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-1">
              <p><span className="text-muted-foreground">Remito:</span> <strong className="text-base">{remitoListo.remito || "sin número"}</strong></p>
              <p><span className="text-muted-foreground">Camión:</span> <strong>{remitoListo.patente || "-"}</strong> · <strong>{remitoListo.m3} m³</strong>{remitoListo.chofer ? <> · {remitoListo.chofer}</> : null}</p>
              <p><span className="text-muted-foreground">Cliente:</span> {remitoListo.cliente}</p>
              {remitoListo.obra && <p><span className="text-muted-foreground">Obra:</span> {remitoListo.obra}</p>}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" className="text-muted-foreground" onClick={() => setRemitoListo(null)}>Sin remito</Button>
            <Button
              className="h-11 text-base flex-1"
              onClick={() => {
                if (remitoListo) window.open(`/api/remito/${remitoListo.id}`, "_blank")
                setRemitoListo(null)
              }}
            >
              <Printer className="h-5 w-5 mr-2" /> Imprimir remito
            </Button>
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
              <CampoMotivo value={motivoTotal} onChange={setMotivoTotal} id="motivo-total" ejemplo="Ej: la obra pidió 4 m³ más" />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(null)}>Cancelar</Button>
            <Button onClick={saveEditQuantity} disabled={!motivoValido(motivoTotal)}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmarConMotivo
        open={!!cancelarPedido}
        onOpenChange={(v) => !v && setCancelarPedido(null)}
        titulo="Cancelar pedido"
        descripcion={cancelarPedido && `${cancelarPedido.clients?.name || ""} · ${cancelarPedido.construction_sites?.name || ""} · ${cancelarPedido.quantity_m3} m³. El pedido no se borra: queda cancelado.`}
        textoBoton="Cancelar pedido"
        ejemplo="Ej: se suspende por lluvia"
        onConfirmar={async (m) => {
          if (cancelarPedido) await cancelPedido(cancelarPedido, m)
          setCancelarPedido(null)
        }}
      />

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
