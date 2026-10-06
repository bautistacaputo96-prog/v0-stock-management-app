"use client"

/**
 * Programación · vista del día.
 *
 * Se usa el día anterior (o a primera hora). Muestra los pedidos del día, deja
 * ajustar la hora de llegada a obra de cada uno (la que pide el cliente o la que
 * se puede cumplir) y ordena el día: qué camión carga a qué hora, cuándo llega,
 * dónde faltan camiones y qué tan ocupada está la flota.
 *
 * La hora que se edita acá es la misma del pedido: la ve Despacho diario.
 * Los tiempos (carga, descarga, lavado, jornada, tolerancia, bocas) son de cada planta y se
 * guardan en la base (fase 1): los ve igual cualquiera, desde cualquier computadora.
 * Los camiones disponibles del día siguen en este navegador hasta la fase 2.
 */
import { useEffect, useMemo, useState, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { logActivity } from "@/lib/activity-log"
import { planificar, aMin, aHora, PARAMETROS_BASE, parametrosDePlanta, columnasDePlanta, type Parametros, type Pedido as PedidoPlan } from "@/lib/planificador"
import { cargarEmpresasBombeo, textoBomba, bombaSinEmpresa, type EmpresaBombeo } from "@/lib/maestros"
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Loader2, Settings2, Truck, MapPin, ListOrdered, ThumbsUp, BarChart3 } from "lucide-react"
// Fase 2 (solo con el interruptor de funciones nuevas)
import { currentUserName, useFuncionesNuevas } from "@/lib/current-user"
import { NuevoBadge } from "@/components/nuevo-badge"
import { GerenciadorViajes, type PedidoGerenciador } from "@/components/gerenciador-viajes"
import { cargarViajes, generarViajes, guardarViajes, planDelDia, demandaPorMediaHora, regenerarViajesPedido, totalViajes, viajeMinDe, m3PorViajeDe, choquesDeCamion, camionesLibresPara, claveViaje, explicarFlota, textoChoque, textoConMenosCamiones, type ViajeRow, type PedidoParaViajes } from "@/lib/viajes"
import { type Ocupado } from "@/lib/planificador"
import { addDays, format, startOfDay } from "date-fns"
import { es } from "date-fns/locale"
import { cn } from "@/lib/utils"

type Plant = { id: string; name: string }
type PedidoDB = {
  id: string
  plant_id: string
  quantity_m3: number
  dispatched_m3: number | null
  scheduled_arrival_time: string
  status: string
  metodo_descarga: "bomba" | "directo" | null
  // Fase 1 (no vienen si la migración no está aplicada)
  finalidad?: string | null
  bomba_la_pone?: "rebucret" | "cliente" | null
  bomba_empresa_id?: string | null
  bomba_hora?: string | null
  // Fase 2 (no vienen si la migración no está aplicada)
  confirmado_at?: string | null
  confirmado_por?: string | null
  m3_por_viaje?: number | null
  espaciado_min?: number | null
  mixer_id?: string | null
  viaje_min?: number | null // fase 2b
  descarga_min?: number | null
  clients: { name: string } | null
  construction_sites: { id: string; name: string; travel_time_minutes: number | null; gps_lat: number | null; requires_pump: boolean | null } | null
  formulas: { code: string } | null
}
type Mixer = { id: string; license_plate: string; capacity_m3: number | null; active: boolean }

const COLORES = ["#D85A30", "#1D9E75", "#534AB7", "#BA7517", "#993556", "#185FA5", "#3B6D11", "#5F5E5A"]
const LS_CAMIONES = (planta: string) => `prog-dia-camiones-${planta}`

const CAMPOS_TIEMPO = [
  ["cargaMin", "Carga en planta"],
  ["descargaBombaMin", "Descarga con bomba (8 m³)"],
  ["descargaDirectaMin", "Descarga directa (8 m³)"],
  ["lavadoMin", "Lavado y salida de obra"],
] as const
const ETIQUETAS: Record<keyof Parametros, string> = {
  cargaMin: "Carga (min)",
  descargaBombaMin: "Descarga con bomba (min)",
  descargaDirectaMin: "Descarga directa (min)",
  lavadoMin: "Lavado (min)",
  inicioJornada: "Inicio de jornada",
  finJornada: "Fin de jornada",
  toleranciaMin: "Tolerancia de puntualidad (min)",
  bocasCarga: "Bocas de carga",
}

export function ProgramacionDia({ plants }: { plants: Plant[] }) {
  const { toast } = useToast()
  const [planta, setPlanta] = useState<string>(plants[0]?.id || "")
  const [dia, setDia] = useState<Date>(() => addDays(startOfDay(new Date()), 1)) // por defecto, mañana
  const [pedidos, setPedidos] = useState<PedidoDB[]>([])
  const [mixers, setMixers] = useState<Mixer[]>([])
  const [disponibles, setDisponibles] = useState<string[]>([])
  const [prm, setPrm] = useState<Parametros>(PARAMETROS_BASE)
  // Lo guardado en la planta, para saber si hay cambios sin guardar
  const [prmGuardado, setPrmGuardado] = useState<Parametros>(PARAMETROS_BASE)
  const [ultimaMod, setUltimaMod] = useState<{ user_name: string; created_at: string } | null>(null)
  const [guardandoTiempos, setGuardandoTiempos] = useState(false)
  const [empresasBombeo, setEmpresasBombeo] = useState<EmpresaBombeo[]>([])
  const [verSupuestos, setVerSupuestos] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [horas, setHoras] = useState<Record<string, string>>({}) // hora editada (sin guardar)
  const [guardando, setGuardando] = useState<string | null>(null)
  // En días pasados se puede simular el día entero, incluidos los pedidos ya despachados
  const [simular, setSimular] = useState(false)
  const esPasado = startOfDay(dia) < startOfDay(new Date())
  // Fase 2: viajes guardados, propuesta de "Ordenar el día", gerenciador y confirmación
  const ve = useFuncionesNuevas()
  const [viajesPorPedido, setViajesPorPedido] = useState<Record<string, ViajeRow[]>>({})
  const [propuesta, setPropuesta] = useState<Record<string, ViajeRow[]> | null>(null)
  const [guardandoPlan, setGuardandoPlan] = useState(false)
  const [gerenciar, setGerenciar] = useState<PedidoGerenciador | null>(null)
  const [confirmando, setConfirmando] = useState<string | null>(null)
  // Fase 2b: viajes del mismo día de otros pedidos (la otra planta): sus camiones están ocupados
  const [otrosViajes, setOtrosViajes] = useState<(ViajeRow & { obra?: string })[]>([])

  // Tiempos de la planta elegida (en la base, no en el navegador)
  const cargarTiempos = useCallback(async () => {
    if (!planta) return
    const sb = createClient()
    const [{ data: pl }, { data: mod }] = await Promise.all([
      sb.from("plants").select("*").eq("id", planta).maybeSingle(),
      sb.from("activity_log").select("user_name, created_at").eq("entity", "planta").eq("entity_id", planta).order("created_at", { ascending: false }).limit(1),
    ])
    const p = parametrosDePlanta(pl as any)
    setPrm(p)
    setPrmGuardado(p)
    setUltimaMod(((mod as any) || [])[0] || null)
  }, [planta])
  useEffect(() => { cargarTiempos() }, [cargarTiempos])
  useEffect(() => { cargarEmpresasBombeo(createClient()).then(setEmpresasBombeo) }, [])

  const tiemposCambiados = (Object.keys(ETIQUETAS) as (keyof Parametros)[]).filter((k) => prm[k] !== prmGuardado[k])

  async function guardarTiempos() {
    if (aMin(prm.finJornada) <= aMin(prm.inicioJornada)) {
      toast({ title: "Revisá la jornada", description: "El fin tiene que ser después del inicio", variant: "destructive" })
      return
    }
    setGuardandoTiempos(true)
    const { error } = await createClient().from("plants").update(columnasDePlanta(prm)).eq("id", planta)
    setGuardandoTiempos(false)
    if (error) {
      toast({ title: "No se pudieron guardar los tiempos", description: error.message, variant: "destructive" })
      return
    }
    const nombre = plants.find((p) => p.id === planta)?.name || null
    const detalle: Record<string, string> = {}
    for (const k of tiemposCambiados) detalle[ETIQUETAS[k]] = `${prmGuardado[k]} → ${prm[k]}`
    await logActivity({ action: "editar", entity: "planta", entityId: planta, reference: nombre, plantId: planta, details: detalle })
    toast({ title: "Tiempos guardados", description: `${nombre}: los ve cualquiera que abra la programación` })
    cargarTiempos()
  }

  const cargar = useCallback(async () => {
    if (!planta) return
    setCargando(true)
    const sb = createClient()
    const ini = startOfDay(dia), fin = addDays(ini, 1)
    const [{ data: ps }, { data: ms }] = await Promise.all([
      sb.from("scheduled_dispatches")
        .select("*, clients(name), construction_sites(id, name, travel_time_minutes, gps_lat, requires_pump), formulas(code)")
        .eq("plant_id", planta)
        .gte("scheduled_arrival_time", ini.toISOString())
        .lt("scheduled_arrival_time", fin.toISOString())
        .neq("status", "cancelled")
        .order("scheduled_arrival_time"),
      sb.from("mixers").select("id, license_plate, capacity_m3, active").eq("active", true).order("license_plate"),
    ])
    setPedidos((ps as any) || [])
    setMixers((ms as any) || [])
    setHoras({})
    setPropuesta(null)
    if (ve) {
      const ids = ((ps as any) || []).map((p: PedidoDB) => p.id)
      const [vs, { data: ot }] = await Promise.all([
        cargarViajes(sb, ids),
        sb.from("viajes").select("*, scheduled_dispatches(construction_sites(name))").neq("estado", "cancelado")
          .gte("hora_carga", new Date(ini.getTime() - 6 * 3600000).toISOString()).lt("hora_carga", fin.toISOString()),
      ])
      setViajesPorPedido(vs)
      setOtrosViajes(((ot as any[]) || []).filter((v) => !ids.includes(v.pedido_id)).map((v) => ({ ...v, m3: Number(v.m3), obra: v.scheduled_dispatches?.construction_sites?.name || "otra obra" })))
    }
    let guardados: string[] | null = null
    try { const g = localStorage.getItem(LS_CAMIONES(planta)); if (g) guardados = JSON.parse(g) } catch {}
    const ids = ((ms as any) || []).map((m: Mixer) => m.id)
    setDisponibles(guardados ? guardados.filter((id) => ids.includes(id)) : ids)
    setCargando(false)
  }, [planta, dia, ve])

  useEffect(() => { cargar() }, [cargar])

  function alternarCamion(id: string) {
    setDisponibles((d) => {
      const n = d.includes(id) ? d.filter((x) => x !== id) : [...d, id]
      try { localStorage.setItem(LS_CAMIONES(planta), JSON.stringify(n)) } catch {}
      return n
    })
  }

  const horaDe = (p: PedidoDB) => horas[p.id] ?? format(new Date(p.scheduled_arrival_time), "HH:mm")

  // Solo lo que falta despachar entra al plan
  const plan = useMemo(() => {
    const entradas: PedidoPlan[] = pedidos
      .filter((p) => simular || p.status !== "completed")
      .map((p) => ({
        id: p.id,
        cliente: p.clients?.name || "",
        obra: p.construction_sites?.name || "",
        m3: simular ? Number(p.quantity_m3) : Math.max(0, Number(p.quantity_m3) - Number(p.dispatched_m3 || 0)),
        llegada: aMin(horaDe(p)),
        viajeMin: ve ? viajeMinDe(p as unknown as PedidoParaViajes) : p.construction_sites?.travel_time_minutes || 30,
        conBomba: (p.metodo_descarga || (p.construction_sites?.requires_pump ? "bomba" : "directo")) === "bomba",
        // Fase 2b (con el interruptor): descarga, m³ por camión y espaciado del pedido
        ...(ve ? { descargaMin: Number(p.descarga_min) > 0 ? Number(p.descarga_min) : null, m3PorViaje: m3PorViajeDe(p as unknown as PedidoParaViajes), espaciadoMin: Number(p.espaciado_min) > 0 ? Number(p.espaciado_min) : null } : {}),
      }))
      .filter((p) => p.m3 > 0.01)
    const cams = mixers.filter((m) => disponibles.includes(m.id)).map((m) => ({ id: m.id, patente: m.license_plate, capacidad: Number(m.capacity_m3) || 8 }))
    if (!entradas.length || !cams.length) return null
    // Con el interruptor, los camiones que están en viajes de la otra planta no se usan a esa hora
    const base = startOfDay(dia).getTime()
    const ocupados: Ocupado[] = ve
      ? otrosViajes.filter((v) => v.mixer_id).map((v) => ({ camionId: v.mixer_id!, desde: (new Date(v.hora_carga).getTime() - base) / 60000, hasta: (new Date(v.hora_vuelta).getTime() - base) / 60000 }))
      : []
    return planificar(entradas, cams, prm, ocupados)
  }, [pedidos, mixers, disponibles, prm, horas, simular, ve, otrosViajes, dia]) // eslint-disable-line react-hooks/exhaustive-deps

  const colorDe = (pedidoId: string) => COLORES[Math.max(0, pedidos.findIndex((p) => p.id === pedidoId)) % COLORES.length]

  async function guardarHora(p: PedidoDB) {
    const h = horas[p.id]
    if (!h) return
    setGuardando(p.id)
    const [hh, mm] = h.split(":").map(Number)
    const llegada = new Date(dia); llegada.setHours(hh, mm, 0, 0)
    const salida = new Date(llegada.getTime() - (p.construction_sites?.travel_time_minutes || 30) * 60000)
    // Si la bomba estaba a la misma hora que el primer camión, se mueve con él
    const moverBomba = "bomba_hora" in p && p.bomba_hora && new Date(p.bomba_hora).getTime() === new Date(p.scheduled_arrival_time).getTime()
    const { error } = await createClient().from("scheduled_dispatches")
      .update({ scheduled_arrival_time: llegada.toISOString(), scheduled_departure_time: salida.toISOString(), ...(moverBomba ? { bomba_hora: llegada.toISOString() } : {}) })
      .eq("id", p.id)
    setGuardando(null)
    if (error) { toast({ title: "No se pudo guardar la hora", variant: "destructive" }); return }
    logActivity({ action: "editar", entity: "pedido", entityId: p.id, reference: p.construction_sites?.name || null, plantId: p.plant_id, details: { "Hora de llegada": `${format(new Date(p.scheduled_arrival_time), "HH:mm")} → ${h}` } })
    // Fase 2: los viajes pendientes se corren con la hora (sin el interruptor, solo si el pedido ya tenía)
    const rv = await regenerarViajesPedido(createClient(), p.id, currentUserName(), { soloSiTiene: !ve, motivo: "hora de llegada" })
    if (rv.error) toast({ title: "La hora se guardó, pero los viajes no", description: rv.error, variant: "destructive" })
    else if (ve && rv.generados != null) toast({ title: "Se recalcularon los viajes de este pedido", description: rv.reemplazoManual ? "Se reemplazaron horarios o camiones ajustados a mano. Quedó en Actividad." : undefined })
    toast({ title: "Hora actualizada", description: `${p.construction_sites?.name}: llegada ${h}` })
    cargar()
  }

  async function guardarMetodo(p: PedidoDB, metodo: "bomba" | "directo") {
    const cambio = p.metodo_descarga !== metodo
    // Directo: no queda nada de bomba (solo si la base ya tiene esas columnas)
    const limpiarBomba = metodo === "directo" && "bomba_la_pone" in p ? { bomba_la_pone: null, bomba_empresa_id: null, bomba_hora: null } : {}
    await createClient().from("scheduled_dispatches").update({ metodo_descarga: metodo, ...limpiarBomba }).eq("id", p.id)
    setPedidos((ps) => ps.map((x) => (x.id === p.id ? { ...x, metodo_descarga: metodo, ...limpiarBomba } : x)))
    // Fase 2: cambia la descarga, cambia el espaciado de los viajes pendientes (si el pedido ya tenía)
    if (!cambio) return
    const rv = await regenerarViajesPedido(createClient(), p.id, currentUserName(), { soloSiTiene: true, motivo: "método de descarga" })
    if (rv.error) toast({ title: "Los viajes no se actualizaron", description: rv.error, variant: "destructive" })
    else if (rv.generados != null && ve) {
      toast({ title: "Se recalcularon los viajes de este pedido", description: rv.reemplazoManual ? "Se reemplazaron horarios o camiones ajustados a mano. Quedó en Actividad." : undefined })
      setViajesPorPedido(await cargarViajes(createClient(), pedidos.map((x) => x.id)))
    }
  }

  // ---------------- Fase 2 ----------------
  const camionesDisponibles = mixers.filter((m) => disponibles.includes(m.id)).map((m) => ({ id: m.id, patente: m.license_plate, capacidad: Number(m.capacity_m3) || 8 }))

  /** "Ordenar el día": planificar() con todos los pedidos; se muestra y recién se guarda con "Guardar plan del día". */
  function ordenarDia() {
    const { filas } = planDelDia(pedidos as unknown as PedidoParaViajes[], viajesPorPedido, camionesDisponibles, prm, otrosViajes)
    setPropuesta(filas)
    if (!Object.keys(filas).length) toast({ title: "No hay nada para ordenar", description: "Los pedidos del día ya están despachados o no hay camiones disponibles." })
  }

  async function guardarPlanDelDia() {
    if (!propuesta) return
    setGuardandoPlan(true)
    const sb = createClient()
    const errores: string[] = []
    let ok = 0
    for (const [pedidoId, nuevos] of Object.entries(propuesta)) {
      const fijos = (viajesPorPedido[pedidoId] || []).filter((v) => v.estado !== "planificado")
      const { error } = await guardarViajes(sb, pedidoId, [...fijos, ...nuevos], currentUserName(), "plan_dia")
      const p = pedidos.find((x) => x.id === pedidoId)
      if (error) { errores.push(`${p?.construction_sites?.name || "pedido"}: ${error}`); continue }
      ok++
      const detalle: Record<string, string> = { Origen: "Plan del día", Viajes: String(nuevos.length) }
      nuevos.slice(0, 10).forEach((v) => { detalle[`Viaje ${v.n}`] = `carga ${format(new Date(v.hora_carga), "HH:mm")} · ${v.m3} m³ · ${mixers.find((m) => m.id === v.mixer_id)?.license_plate || "sin camión"}` })
      await logActivity({ action: "editar", entity: "pedido", entityId: pedidoId, reference: p?.construction_sites?.name || null, plantId: p?.plant_id || planta, details: detalle })
    }
    setGuardandoPlan(false)
    if (errores.length) toast({ title: `Se guardaron ${ok} pedidos; ${errores.length} con error`, description: errores.join(" · "), variant: "destructive" })
    else toast({ title: "Plan del día guardado", description: `${ok} pedido${ok === 1 ? "" : "s"} con sus viajes y camiones sugeridos` })
    setPropuesta(null)
    setViajesPorPedido(await cargarViajes(sb, pedidos.map((x) => x.id)))
  }

  async function confirmarPedido(p: PedidoDB, confirmar: boolean) {
    setConfirmando(p.id)
    const cambios = confirmar ? { confirmado_at: new Date().toISOString(), confirmado_por: currentUserName() } : { confirmado_at: null, confirmado_por: null }
    const { error } = await createClient().from("scheduled_dispatches").update(cambios).eq("id", p.id)
    setConfirmando(null)
    if (error) { toast({ title: "No se pudo confirmar", description: error.message, variant: "destructive" }); return }
    setPedidos((ps) => ps.map((x) => (x.id === p.id ? { ...x, ...cambios } : x)))
    logActivity({ action: "editar", entity: "pedido", entityId: p.id, reference: p.construction_sites?.name || null, plantId: p.plant_id, details: { Confirmado: confirmar ? "no → sí (día anterior)" : "sí → no" } })
  }

  const activos = pedidos.filter((p) => p.status !== "completed")
  const confirmados = activos.filter((p) => p.confirmado_at).length

  // Demanda: con los viajes guardados (o los ideales a la hora pedida, si el pedido no tiene)
  const demanda = useMemo(() => {
    if (!ve) return []
    const vs = activos.flatMap((p) => {
      const g = viajesPorPedido[p.id]
      return g?.length ? g.filter((v) => v.estado === "planificado") : generarViajes(p as unknown as PedidoParaViajes, prm, [])
    })
    return demandaPorMediaHora(vs, dia)
  }, [ve, activos, viajesPorPedido, prm, dia]) // eslint-disable-line react-hooks/exhaustive-deps
  // +1 de aire arriba para que la línea de disponibles no quede pegada al borde
  const maxDemanda = Math.max(1, disponibles.length, ...demanda.map((d) => d.camiones)) + 1

  const cambiados = Object.keys(horas).filter((id) => {
    const p = pedidos.find((x) => x.id === id)
    return p && horas[id] !== format(new Date(p.scheduled_arrival_time), "HH:mm")
  })

  // Grilla horaria: desde la primera carga (o 06:00) hasta la última vuelta (o 18:00)
  const t0 = plan ? Math.min(aMin("06:00"), Math.floor(Math.min(...plan.viajes.map((v) => v.inicioCarga)) / 60) * 60) : aMin("06:00")
  const t1 = plan ? Math.max(aMin("18:00"), Math.ceil(Math.max(...plan.viajes.map((v) => v.vuelta)) / 60) * 60) : aMin("18:00")
  const pos = (m: number) => `${((m - t0) / (t1 - t0)) * 100}%`
  const anc = (a: number, b: number) => `${Math.max(0.3, ((b - a) / (t1 - t0)) * 100)}%`

  const ultimaVuelta = plan?.viajes.length ? Math.max(...plan.viajes.map((v) => v.vuelta)) : null
  // Fase 2b: plan por pedido con los camiones que hay (para "con N camiones termina…") y choques de camión
  const planVe = useMemo(() => (ve ? planDelDia(pedidos as unknown as PedidoParaViajes[], viajesPorPedido, camionesDisponibles, prm, otrosViajes) : null),
    [ve, pedidos, viajesPorPedido, disponibles, mixers, prm, otrosViajes]) // eslint-disable-line react-hooks/exhaustive-deps
  const todosDelDia = useMemo(() => [...Object.values(viajesPorPedido).flat().filter((v) => v.estado !== "cancelado"), ...otrosViajes], [viajesPorPedido, otrosViajes])
  const choques = useMemo(() => (ve ? choquesDeCamion(todosDelDia) : new Map()), [ve, todosDelDia])
  const obraDeViaje = (v: ViajeRow) => (v as any).obra || pedidos.find((x) => x.id === v.pedido_id)?.construction_sites?.name || "otra obra"
  const camionesUsados = plan ? plan.camiones.filter((c) => c.viajes > 0).length : 0
  const usoProm = plan ? Math.round(plan.camiones.filter((c) => c.viajes > 0).reduce((s, c) => s + c.utilizacion, 0) / Math.max(1, plan.camiones.filter((c) => c.viajes > 0).length)) : 0
  const tituloDia = (() => { const t = format(dia, "EEEE d 'de' MMMM", { locale: es }); return t.charAt(0).toUpperCase() + t.slice(1) })()

  return (
    <div className="space-y-4">
      {/* Controles */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={planta} onValueChange={setPlanta}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>{plants.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={() => setDia(addDays(dia, -1))}><ChevronLeft className="h-4 w-4" /></Button>
        <span className="font-semibold min-w-[200px] text-center">{tituloDia}</span>
        <Button variant="outline" size="icon" onClick={() => setDia(addDays(dia, 1))}><ChevronRight className="h-4 w-4" /></Button>
        <Button variant="ghost" size="sm" onClick={() => setDia(startOfDay(new Date()))}>Hoy</Button>
        <Button variant="ghost" size="sm" onClick={() => setDia(addDays(startOfDay(new Date()), 1))}>Mañana</Button>
        {esPasado && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer ml-2">
            <input type="checkbox" checked={simular} onChange={(e) => setSimular(e.target.checked)} />
            Simular el día completo (incluye lo ya despachado)
          </label>
        )}
        <Button variant="outline" size="sm" className="ml-auto gap-1.5" onClick={() => setVerSupuestos(!verSupuestos)}><Settings2 className="h-4 w-4" /> Tiempos y camiones</Button>
      </div>

      {/* Fase 2: ordenar el día y confirmación (solo con el interruptor) */}
      {ve && !cargando && pedidos.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap rounded-lg border border-violet-200 bg-violet-50/40 px-3 py-2">
          <NuevoBadge />
          <Button size="sm" variant="outline" className="gap-1.5 bg-background" onClick={ordenarDia} disabled={cambiados.length > 0 || camionesDisponibles.length === 0}>
            <ListOrdered className="h-4 w-4" /> Ordenar el día
          </Button>
          {cambiados.length > 0 && <span className="text-xs text-amber-700">Guardá las horas cambiadas antes de ordenar.</span>}
          <span className="text-sm ml-auto flex items-center gap-1.5">
            <ThumbsUp className="h-4 w-4 text-emerald-700" /> <strong>{confirmados}</strong> de {activos.length} pedido{activos.length === 1 ? "" : "s"} confirmado{activos.length === 1 ? "" : "s"}
          </span>
        </div>
      )}

      {verSupuestos && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">Camiones disponibles ese día</p>
              <div className="flex gap-2 flex-wrap">
                {mixers.map((m) => (
                  <button key={m.id} onClick={() => alternarCamion(m.id)} className={cn("rounded-md border px-3 py-1.5 text-sm", disponibles.includes(m.id) ? "border-primary bg-primary/5 font-medium" : "text-muted-foreground line-through")}>
                    {m.license_plate} <span className="text-xs text-muted-foreground">{Number(m.capacity_m3) || 8} m³</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">
                Tiempos de {plants.find((p) => p.id === planta)?.name} <span className="font-normal text-muted-foreground">(valores de referencia hasta medirlos con el GPS; se guardan en la planta)</span>
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {CAMPOS_TIEMPO.map(([k, l]) => (
                  <label key={k} className="text-xs space-y-1">
                    <span className="text-muted-foreground">{l}</span>
                    <div className="flex items-center gap-1">
                      <Input type="number" min={1} value={prm[k]} onChange={(e) => setPrm({ ...prm, [k]: Math.max(1, Number(e.target.value) || 1) })} className="h-8 w-20" />
                      <span className="text-muted-foreground">min</span>
                    </div>
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                <label className="text-xs space-y-1">
                  <span className="text-muted-foreground block">Inicio de jornada</span>
                  <Input type="time" value={prm.inicioJornada} onChange={(e) => e.target.value && setPrm({ ...prm, inicioJornada: e.target.value })} className="h-8 w-36" />
                </label>
                <label className="text-xs space-y-1">
                  <span className="text-muted-foreground block">Fin de jornada</span>
                  <Input type="time" value={prm.finJornada} onChange={(e) => e.target.value && setPrm({ ...prm, finJornada: e.target.value })} className="h-8 w-36" />
                </label>
                <label className="text-xs space-y-1">
                  <span className="text-muted-foreground block">Tolerancia de puntualidad</span>
                  <div className="flex items-center gap-1">
                    <Input type="number" min={0} value={prm.toleranciaMin} onChange={(e) => setPrm({ ...prm, toleranciaMin: Math.max(0, Number(e.target.value) || 0) })} className="h-8 w-20" />
                    <span className="text-muted-foreground">min</span>
                  </div>
                </label>
                <label className="text-xs space-y-1">
                  <span className="text-muted-foreground block">Bocas de carga</span>
                  <div className="flex items-center gap-1">
                    <Input type="number" min={1} value={prm.bocasCarga} onChange={(e) => setPrm({ ...prm, bocasCarga: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} className="h-8 w-20" />
                    <span className="text-muted-foreground">a la vez</span>
                  </div>
                </label>
              </div>
              <div className="flex items-center gap-3 flex-wrap mt-3">
                <Button size="sm" onClick={guardarTiempos} disabled={guardandoTiempos || tiemposCambiados.length === 0}>
                  {guardandoTiempos ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : `Guardar tiempos de ${plants.find((p) => p.id === planta)?.name}`}
                </Button>
                {tiemposCambiados.length > 0 && <span className="text-xs text-amber-700">Cambios sin guardar: el plan ya los usa.</span>}
                <Button variant="link" size="sm" className="px-0 h-auto text-xs" onClick={() => setPrm(PARAMETROS_BASE)}>Volver a los valores de referencia</Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {ultimaMod
                  ? `Última modificación: ${format(new Date(ultimaMod.created_at), "dd/MM/yyyy HH:mm")} · ${ultimaMod.user_name}`
                  : "Todavía no se modificaron: son los valores de referencia."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {cargando ? (
        <div className="py-16 text-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />Cargando pedidos...</div>
      ) : pedidos.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No hay pedidos programados para este día en {plants.find((p) => p.id === planta)?.name}. Cargalos en la vista Semana.</CardContent></Card>
      ) : (
        <>
          {/* Resumen del día */}
          {plan && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                ["Pedidos", `${pedidos.length} · ${pedidos.reduce((s, p) => s + Number(p.quantity_m3), 0).toLocaleString("es-AR")} m³`],
                ["Viajes", String(plan.viajes.length)],
                ["Primera carga", plan.primeraCarga != null ? aHora(plan.primeraCarga) : "—"],
                ["Última vuelta a planta", ultimaVuelta != null ? aHora(ultimaVuelta) : "—"],
                ve ? ["Camiones usados", `${camionesUsados} de ${plan.camiones.length} · uso ${usoProm}%`] : ["Uso de mixers", `${usoProm}%`],
              ].map(([l, v]) => (
                <div key={l} className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">{l}</p><p className="text-lg font-semibold">{v}</p></div>
              ))}
            </div>
          )}

          {/* Fase 2: gráfico de demanda (camiones necesarios por media hora contra los disponibles) */}
          {ve && demanda.some((d) => d.camiones > 0) && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                  <p className="text-sm font-medium flex items-center gap-1.5"><BarChart3 className="h-4 w-4" /> Camiones necesarios por media hora <NuevoBadge /></p>
                  <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-sky-500" />Necesarios</span>
                    <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-red-500" />Faltan camiones</span>
                    <span className="flex items-center gap-1"><span className="w-4 border-t-2 border-dashed border-slate-700" />Disponibles ({disponibles.length})</span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <div className="min-w-[640px]">
                    <div className="relative h-32 flex items-end gap-[3px] border-b">
                      <div className="absolute inset-x-0 border-t-2 border-dashed border-slate-700 z-10 pointer-events-none" style={{ bottom: `${(disponibles.length / maxDemanda) * 100}%` }} />
                      {demanda.map((d) => (
                        <div key={d.inicio} className="flex-1 flex flex-col justify-end h-full" title={`${aHora(d.inicio)}–${aHora(d.inicio + 30)}: ${d.camiones} camión${d.camiones === 1 ? "" : "es"} (hay ${disponibles.length})`}>
                          {d.camiones > 0 && <span className={cn("text-[10px] text-center leading-none mb-0.5", d.camiones > disponibles.length ? "text-red-600 font-semibold" : "text-muted-foreground")}>{d.camiones}</span>}
                          <div className={cn("rounded-t-sm", d.camiones > disponibles.length ? "bg-red-500" : "bg-sky-500")} style={{ height: `${(d.camiones / maxDemanda) * 100}%` }} />
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-[3px] text-[10px] text-muted-foreground mt-1">
                      {demanda.map((d, i) => <span key={d.inicio} className="flex-1 text-center">{i % 2 === 0 ? aHora(d.inicio) : ""}</span>)}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Cada camión cuenta desde que carga hasta que vuelve a planta, con los viajes guardados (o a la hora pedida si el pedido no tiene viajes). Donde la barra pasa la línea faltan camiones: conviene correr un pedido o conseguir otro camión.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Pedidos: hora editable y diagnóstico */}
          <Card>
            <CardContent className="p-0">
              <div className="px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm font-medium">Pedidos del día · ajustá la hora de llegada a obra y el día se reordena solo</p>
                {cambiados.length > 0 && <p className="text-xs text-amber-700">Tenés {cambiados.length} hora{cambiados.length > 1 ? "s" : ""} cambiada{cambiados.length > 1 ? "s" : ""} sin guardar: el plan ya las usa.</p>}
              </div>
              <div className="divide-y">
                {pedidos.map((p) => {
                  const r = plan?.pedidos.find((x) => x.pedidoId === p.id)
                  const cambiada = cambiados.includes(p.id)
                  const completo = p.status === "completed"
                  return (
                    <div key={p.id} className={cn("px-4 py-3 grid gap-3 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center", completo && !simular && "opacity-60")}>
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-sm shrink-0" style={{ background: colorDe(p.id) }} />
                        <Input type="time" value={horaDe(p)} disabled={completo} onChange={(e) => setHoras({ ...horas, [p.id]: e.target.value })} className={cn("h-9 w-[140px] font-medium", cambiada && "border-amber-400 bg-amber-50")} />
                        {cambiada && (
                          <Button size="sm" className="h-8" onClick={() => guardarHora(p)} disabled={guardando === p.id}>{guardando === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Guardar"}</Button>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{p.clients?.name} · {p.construction_sites?.name}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                          <span>{Number(p.quantity_m3)} m³{p.dispatched_m3 ? ` (${Number(p.dispatched_m3)} ya enviados)` : ""}</span>
                          <span>· {p.formulas?.code}</span>
                          <span>· viaje {p.construction_sites?.travel_time_minutes || 30} min</span>
                          {p.construction_sites?.gps_lat == null && <span className="text-amber-700 flex items-center gap-0.5"><MapPin className="h-3 w-3" />obra sin ubicar</span>}
                          <span className="inline-flex rounded border overflow-hidden">
                            {(["bomba", "directo"] as const).map((m) => (
                              <button key={m} disabled={completo} onClick={() => guardarMetodo(p, m)} className={cn("px-1.5 py-0.5 text-[11px]", p.metodo_descarga === m ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>{m === "bomba" ? "Bomba" : "Directo"}</button>
                            ))}
                          </span>
                          {!p.metodo_descarga && <span className="text-amber-700">sin método (se asume {p.construction_sites?.requires_pump ? "bomba" : "directo"})</span>}
                          {p.metodo_descarga === "bomba" && "bomba_la_pone" in p && <span className="text-sky-700">· {textoBomba(p, empresasBombeo, "Bomba")}</span>}
                          {p.finalidad && <span>· {p.finalidad}</span>}
                        </p>
                        {"bomba_la_pone" in p && bombaSinEmpresa(p) && !completo && (
                          <p className="text-xs text-amber-700 flex items-center gap-1 mt-0.5"><AlertTriangle className="h-3 w-3" />Pedido con bomba sin empresa asignada: confirmala el día anterior (vista Semana › editar pedido)</p>
                        )}
                        {/* Fase 2: viajes y confirmación del día anterior (solo con el interruptor) */}
                        {ve && !completo && (
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setGerenciar(p as unknown as PedidoGerenciador)}>
                              <Truck className="h-3.5 w-3.5" />{viajesPorPedido[p.id]?.length ? `Viajes (${totalViajes(viajesPorPedido[p.id])})` : "Armar viajes"}
                            </Button>
                            {p.confirmado_at ? (
                              <Button size="sm" variant="ghost" className="h-7 text-xs text-emerald-700" disabled={confirmando === p.id} title="Tocá para quitar la confirmación" onClick={() => confirmarPedido(p, false)}>
                                👍 Confirmado · {p.confirmado_por || "-"} · {format(new Date(p.confirmado_at), "dd/MM HH:mm")}
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={confirmando === p.id} onClick={() => confirmarPedido(p, true)}>👍 Confirmar</Button>
                            )}
                          </div>
                        )}
                        {/* Fase 2b: cuántos camiones hacen falta y qué pasa con los que hay */}
                        {ve && !completo && r && (() => {
                          const pv = p as unknown as PedidoParaViajes
                          const flota = explicarFlota(pv, prm, r.viajes)
                          const menos = planVe?.filas[p.id] ? textoConMenosCamiones(planVe.filas[p.id], generarViajes(pv, prm, viajesPorPedido[p.id] || []), new Set(planVe.filas[p.id].map((v) => v.mixer_id)).size) : null
                          return (
                            <div className="mt-1 text-[11px] text-muted-foreground space-y-0.5">
                              <p>{flota.texto}{Number(p.descarga_min) > 0 ? " (descarga corregida en el pedido)" : ""}</p>
                              {menos && <p className="text-amber-700">{menos}</p>}
                            </div>
                          )
                        })()}
                        {/* Fase 2b (D): camión asignado que en ese momento está en otro viaje */}
                        {ve && (viajesPorPedido[p.id] || []).filter((v) => v.estado === "planificado" && choques.has(claveViaje(v))).map((v) => {
                          const ch = choques.get(claveViaje(v))!
                          const libres = camionesLibresPara(v, todosDelDia, mixers.filter((m) => disponibles.includes(m.id))).slice(0, 4)
                          const pat = (id: string | null | undefined) => mixers.find((m) => m.id === id)?.license_plate || "—"
                          return (
                            <p key={v.n} className="mt-1 text-xs text-red-700 flex items-center gap-1 flex-wrap">
                              <AlertTriangle className="h-3 w-3" />Viaje {v.n}: {textoChoque(ch, pat(v.mixer_id), obraDeViaje(ch.otro))}
                              {libres.length ? <span className="text-muted-foreground"> · libres: {libres.map((m) => m.license_plate).join(", ")} (cambialo en Viajes u Ordená el día)</span> : <span className="text-muted-foreground"> · no hay camiones libres a esa hora</span>}
                            </p>
                          )
                        })}
                      </div>
                      <div className="text-xs md:text-right">
                        {completo && !simular ? (
                          <Badge variant="outline" className="text-emerald-700 border-emerald-300">Completado</Badge>
                        ) : r ? (
                          <>
                            <p>{r.viajes} viajes · carga desde <strong>{aHora(r.primeraLlegada - (p.construction_sites?.travel_time_minutes || 30) - prm.cargaMin)}</strong> · termina <strong>{aHora(r.finVaciado)}</strong></p>
                            {r.demoraInicio > prm.toleranciaMin ? (
                              <p className="text-red-600 flex items-center gap-1 md:justify-end"><AlertTriangle className="h-3 w-3" />El primer camión llega {aHora(r.primeraLlegada)}, {r.demoraInicio} min tarde</p>
                            ) : r.huecosMin > 0 ? (
                              <p className="text-amber-700 flex items-center gap-1 md:justify-end"><AlertTriangle className="h-3 w-3" />Para no cortar hacen falta {r.camionesIdeal} camiones (hay {Math.min(disponibles.length, r.viajes)}): {r.huecosMin} min de espera en total</p>
                            ) : (
                              <p className="text-emerald-700 flex items-center gap-1 md:justify-end"><CheckCircle2 className="h-3 w-3" />Sin cortes · {r.camionesUsados} {r.camionesUsados > 1 ? "camiones" : "camión"}{r.viajes > 1 ? `, uno cada ${r.ritmoIdealMin} min` : ""}</p>
                            )}
                          </>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* Fase 2: resultado de "Ordenar el día" (no se guarda solo) */}
          {ve && propuesta && Object.keys(propuesta).length > 0 && (
            <Card className="border-violet-300">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-sm font-medium flex items-center gap-1.5"><ListOrdered className="h-4 w-4" /> Plan del día propuesto <NuevoBadge /></p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setPropuesta(null)}>Descartar</Button>
                    <Button size="sm" onClick={guardarPlanDelDia} disabled={guardandoPlan}>{guardandoPlan ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Guardar plan del día"}</Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Respeta la boca de carga y los camiones disponibles. Al guardar quedan los viajes y el camión sugerido de cada uno; los ya despachados no se tocan.</p>
                <div className="divide-y">
                  {pedidos.filter((p) => propuesta[p.id]?.length).map((p) => (
                    <div key={p.id} className="py-2 space-y-1">
                      <p className="text-sm font-medium flex items-center gap-2"><span className="h-3 w-3 rounded-sm shrink-0" style={{ background: colorDe(p.id) }} />{p.clients?.name} · {p.construction_sites?.name}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {propuesta[p.id].map((v) => (
                          <span key={v.n} className="rounded border bg-muted/40 px-2 py-0.5 text-xs">
                            <strong>{v.n}</strong> · {v.m3} m³ · carga {format(new Date(v.hora_carga), "HH:mm")} · llega {format(new Date(v.hora_llegada), "HH:mm")} · {mixers.find((m) => m.id === v.mixer_id)?.license_plate || "sin camión"}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Grilla por camión */}
          {plan && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                  <p className="text-sm font-medium flex items-center gap-1.5"><Truck className="h-4 w-4" /> El día de cada camión</p>
                  <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-slate-500" />Carga</span>
                    <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-sky-300" />Viaje</span>
                    <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-slate-300" />Lavado y vuelta</span>
                    <span>Descarga: color del pedido</span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <div className="min-w-[640px]">
                    <div className="grid grid-cols-[84px_minmax(0,1fr)_56px] gap-2 text-[11px] text-muted-foreground mb-1">
                      <span />
                      <div className="relative h-4">
                        {Array.from({ length: (t1 - t0) / 60 + 1 }, (_, i) => t0 + i * 60).filter((_, i) => i % 2 === 0).map((t) => (
                          <span key={t} className="absolute -translate-x-1/2" style={{ left: pos(t) }}>{aHora(t)}</span>
                        ))}
                      </div>
                      <span className="text-right">uso</span>
                    </div>
                    {plan.camiones.map((c) => (
                      <div key={c.id} className="grid grid-cols-[84px_minmax(0,1fr)_56px] gap-2 items-center h-8">
                        <span className="text-xs font-medium">{c.patente}</span>
                        <div className="relative h-6 rounded bg-muted/60">
                          {plan.viajes.filter((v) => v.camionId === c.id).map((v, i) => {
                            const p = pedidos.find((x) => x.id === v.pedidoId)
                            const tip = `${p?.construction_sites?.name} · viaje ${v.n} · ${v.m3} m³ — carga ${aHora(v.inicioCarga)}, sale ${aHora(v.salida)}, llega ${aHora(v.llegada)}, termina ${aHora(v.finDescarga)}, vuelve ${aHora(v.vuelta)}`
                            return (
                              <div key={i} title={tip}>
                                <div className="absolute top-1 h-4 rounded-sm bg-slate-500" style={{ left: pos(v.inicioCarga), width: anc(v.inicioCarga, v.salida) }} />
                                <div className="absolute top-1 h-4 bg-sky-300" style={{ left: pos(v.salida), width: anc(v.salida, v.llegada) }} />
                                <div className="absolute top-1 h-4" style={{ left: pos(v.llegada), width: anc(v.llegada, v.finDescarga), background: colorDe(v.pedidoId) }} />
                                <div className="absolute top-1 h-4 rounded-r-sm bg-slate-300" style={{ left: pos(v.finDescarga), width: anc(v.finDescarga, v.vuelta) }} />
                              </div>
                            )
                          })}
                        </div>
                        <span className={cn("text-xs text-right", c.utilizacion >= 85 ? "text-red-600 font-medium" : c.utilizacion < 40 && c.viajes > 0 ? "text-muted-foreground" : "")}>{c.viajes ? `${c.utilizacion}%` : "libre"}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  Pasá el mouse sobre un bloque para ver los horarios. {prm.bocasCarga > 1 ? `La planta carga hasta ${prm.bocasCarga} camiones a la vez` : "La planta carga un camión por vez"} ({plan.plantaOcupacion}% de la jornada ocupada cargando). El uso es el tiempo ocupado de cada camión sobre la jornada {prm.inicioJornada}–{prm.finJornada}.
                </p>
              </CardContent>
            </Card>
          )}

          <GerenciadorViajes pedido={gerenciar} open={!!gerenciar} onOpenChange={(v) => !v && setGerenciar(null)} onGuardado={() => cargar()} />

          {!plan && pedidos.some((p) => p.status !== "completed") && (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Elegí al menos un camión disponible en "Tiempos y camiones".</CardContent></Card>
          )}
        </>
      )}
    </div>
  )
}
