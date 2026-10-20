"use client"

/**
 * Despacho diario en tres columnas (fase 3, como Loop): Viajes · Camiones · Pedidos, con los contadores del día
 * arriba y la tabla de entregas abajo. Especificación: docs/migracion-loop/fase-3.md (13 y 14 mandan).
 *
 * - Datos: la base cada 30 s y el GPS cada 60 s, solo con la pestaña visible.
 * - Despachar: botón del viaje, tocar viaje → camión (o al revés) o arrastrar el viaje sobre el camión. Siempre pasa
 *   por el formulario Entrega y por `registrar_despacho` (el mismo motor de la pantalla de siempre).
 * - Los estados del camión salen de lib/despacho.ts (estadoCamion): GPS si hay señal, si no lo estimado.
 * - Permisos con usePermisos(): despacho.cargar despacha, suspende, reabre, finaliza, manda a taller; programacion
 *   para confirmar, viajes y editar total (los propios con cargar, todos con editar); cancelar es programacion.borrar.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { addDays, format, isToday, isTomorrow, isYesterday, subDays } from "date-fns"
import { es } from "date-fns/locale"
import { RefreshCw } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { AddDispatchDialog } from "@/components/add-dispatch-dialog"
import { GerenciadorViajes, type PedidoGerenciador } from "@/components/gerenciador-viajes"
import { CampoMotivo, motivoValido } from "@/components/motivo"
import { NuevoBadge } from "@/components/nuevo-badge"
import { currentUserName, usePermisos } from "@/lib/current-user"
import { logActivity } from "@/lib/activity-log"
import { cargarChoferes, cargarEmpresasBombeo, type Chofer, type EmpresaBombeo } from "@/lib/maestros"
import { parametrosDePlanta, PARAMETROS_BASE } from "@/lib/planificador"
import { cargarTiemposGps, type TiemposGps } from "@/lib/gps-viajes"
import { ajustarAHora, cargarViajes, guardarViajes, regenerarViajesPedido, viajeMinDe, type ViajeRow } from "@/lib/viajes"
import {
  camionPropuesto, contadoresDia, duracion, estadoCamion, vistoFueraDePlanta, hhmm, m3txt, ordenCamion, puntualidadPrimerCamion, textoFuenteEstado,
  textoMotivo, viajesDelDia, viajesEnPausa, viajesPendientes, TIPO_TEXTO, numeroImpreso,
  type DespachoCamion, type GpsCamion, type MixerDia, type MotivoTipo, type Puntualidad, type TipoRemito,
} from "@/lib/despacho"
import { cn } from "@/lib/utils"
import { ContadoresDia } from "./contadores-dia"
import { ColumnaViajes, FantasmaViaje } from "./columna-viajes"
import { ColumnaCamiones, type FiltroCamion } from "./columna-camiones"
import { ColumnaPedidos } from "./columna-pedidos"
import { TablaEntregas } from "./tabla-entregas"
import { EntregaDialog, type EntregaAbierta, type ResultadoDespacho } from "./entrega-dialog"
import { ReabrirDialog, SuspenderDialog } from "./suspender-dialog"
import { CancelarDialog, FinalizarDialog } from "./finalizar-dialog"
import { HumedadAcopio } from "./humedad-acopio"
import { usarArrastre } from "./usar-arrastre"
import type { CamionT, DespachoT, PedidoT, Planta, TipoResuelto, ViajeT } from "./tipos"

const MIN = 60_000
const CLAVE_PLANTA = "rebucret_despacho_planta"
const CLAVE_VISTOS = "rebucret_despacho_gps_afuera"
const inicioDia = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const leer = (k: string) => { try { return window.localStorage.getItem(k) } catch { return null } }
const guardar = (k: string, v: string) => { try { window.localStorage.setItem(k, v) } catch { /* sin almacenamiento */ } }

type Tab = "viajes" | "camiones" | "pedidos"

export function DespachoTablero({ plants, onPantallaVieja }: { plants: Planta[]; onPantallaVieja?: () => void }) {
  const { toast } = useToast()
  const { puede, ajustaPedido } = usePermisos()
  const puedeDespachar = puede("despacho", "cargar")
  const puedeCancelar = puede("programacion", "borrar")
  const puedeCambiarTipo = puede("programacion", "editar")
  const puedeHumedad = puede("materia_prima", "cargar")

  const [planta, setPlanta] = useState(plants[0]?.id || "")
  const [dia, setDia] = useState(() => new Date())
  const [ahora, setAhora] = useState(() => Date.now())
  const [angosta, setAngosta] = useState(false)
  const [tab, setTab] = useState<Tab>("viajes")

  // Datos
  const [pedidos, setPedidos] = useState<PedidoT[]>([])
  const [viajesPorPedido, setViajesPorPedido] = useState<Record<string, ViajeRow[]>>({})
  const [mixers, setMixers] = useState<MixerDia[]>([])
  const [despachosDia, setDespachosDia] = useState<DespachoT[]>([])
  const [despachosHoy, setDespachosHoy] = useState<DespachoT[]>([])
  const [viajeDeDespacho, setViajeDeDespacho] = useState<Record<string, ViajeRow>>({})
  const [plantasFull, setPlantasFull] = useState<Record<string, any>>({})
  const [choferes, setChoferes] = useState<Chofer[]>([])
  const [empresas, setEmpresas] = useState<EmpresaBombeo[]>([])
  const [tipos, setTipos] = useState<Record<string, TipoResuelto>>({})
  const [gpsReal, setGpsReal] = useState<Record<string, { llegada_obra?: string | null; llegada_planta?: string | null }>>({})
  const [notasTaller, setNotasTaller] = useState<Record<string, string>>({})
  const [tiempos, setTiempos] = useState<TiemposGps | null>(null)
  const [gps, setGps] = useState<Record<string, GpsCamion>>({})
  const [cargando, setCargando] = useState(true)

  // Pantalla
  const [selViaje, setSelViaje] = useState<string | null>(null)
  const [selCamion, setSelCamion] = useState<string | null>(null)
  const [filtroCam, setFiltroCam] = useState<FiltroCamion>("todos")
  const [filtroPedido, setFiltroPedido] = useState<string | null>(null)
  const [nueva, setNueva] = useState<string | null>(null)

  // Diálogos
  const [entrega, setEntrega] = useState<EntregaAbierta | null>(null)
  const [aviso, setAviso] = useState<{ viajeClave: string; camionId: string; tipo: "no_libre" | "taller" } | null>(null)
  const [suspender, setSuspender] = useState<PedidoT | null>(null)
  const [reabrir, setReabrir] = useState<PedidoT | null>(null)
  const [finalizar, setFinalizar] = useState<PedidoT | null>(null)
  const [cancelar, setCancelar] = useState<PedidoT | null>(null)
  const [editarTotal, setEditarTotal] = useState<PedidoT | null>(null)
  const [totalNuevo, setTotalNuevo] = useState("")
  const [motivoTotal, setMotivoTotal] = useState("")
  const [gerenciar, setGerenciar] = useState<PedidoGerenciador | null>(null)
  const [taller, setTaller] = useState<string | null>(null)
  const [notaTaller, setNotaTaller] = useState("")
  const [remitoListo, setRemitoListo] = useState<{ id: string; remito: string; tipo?: TipoRemito; m3: number; cliente: string; obra: string; patente: string; chofer?: string } | null>(null)

  const esHoy = isToday(dia)
  const plantaObj = plants.find((p) => p.id === planta) || { id: planta, name: "Planta" }
  const otraPlanta = plants.find((p) => p.id !== planta) || null

  // Planta recordada en el equipo
  useEffect(() => {
    const g = leer(CLAVE_PLANTA)
    if (g && plants.some((p) => p.id === g)) setPlanta(g)
  }, [plants])
  const elegirPlanta = (id: string) => { setPlanta(id); guardar(CLAVE_PLANTA, id); setSelViaje(null); setSelCamion(null); setFiltroPedido(null) }

  // Reloj (atrasos y tiempos) y ancho de pantalla (tres columnas o pestañas)
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 30_000); return () => clearInterval(t) }, [])
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 899px)")
    const f = () => setAngosta(mq.matches)
    f(); mq.addEventListener("change", f)
    return () => mq.removeEventListener("change", f)
  }, [])

  // ── Carga de datos ──
  const cargar = useCallback(async () => {
    if (!planta) return
    const sb = createClient()
    const ini = inicioDia(dia), fin = addDays(ini, 1)
    const hoyIni = inicioDia(new Date()), hoyFin = addDays(hoyIni, 1)
    const selDesp = "*, clients(name), construction_sites(name, travel_time_minutes), formulas(code)"
    const [pRes, mRes, dRes, hRes, plRes] = await Promise.all([
      sb.from("scheduled_dispatches").select("*, clients(*), construction_sites(*), formulas(id, name, code)")
        .eq("plant_id", planta).gte("scheduled_arrival_time", ini.toISOString()).lt("scheduled_arrival_time", fin.toISOString())
        .order("scheduled_arrival_time"),
      sb.from("mixers").select("*").eq("active", true).order("license_plate"),
      sb.from("dispatches").select(selDesp).gte("dispatch_date", ini.toISOString()).lt("dispatch_date", fin.toISOString()).order("dispatch_date", { ascending: false }),
      esHoy ? Promise.resolve(null) : sb.from("dispatches").select(selDesp).gte("dispatch_date", hoyIni.toISOString()).lt("dispatch_date", hoyFin.toISOString()),
      sb.from("plants").select("*"),
    ])
    const peds = ((pRes.data || []) as any[]).map((p) => ({ ...p, quantity_m3: Number(p.quantity_m3), dispatched_m3: Number(p.dispatched_m3 || 0) })) as PedidoT[]
    const dDia = ((dRes.data || []) as DespachoT[]).map((d) => ({ ...d, quantity_m3: Number(d.quantity_m3) }))
    const dHoy = esHoy ? dDia : (((hRes as any)?.data || []) as DespachoT[])
    const ids = peds.map((p) => p.id)
    const idsHoy = dHoy.map((d) => d.id)
    const idsDiaPlanta = dDia.filter((d) => d.plant_id === planta).map((d) => d.id)
    const enTaller = ((mRes.data || []) as MixerDia[]).filter((m) => m.status === "maintenance" || m.status === "unavailable").map((m) => m.id)
    const [vpp, vdd, tps, vg, nt] = await Promise.all([
      cargarViajes(sb, ids),
      idsHoy.length ? sb.from("viajes").select("*").in("dispatch_id", idsHoy).then((r: any) => r.data || []) : Promise.resolve([]),
      // Tipo de remito de cada pedido abierto: lo resuelve la base (pedido > obra > cliente > respuesta del día)
      Promise.all(peds.filter((p) => p.status !== "cancelled" && p.status !== "completed").map((p) =>
        sb.rpc("remito_tipo_para", { p_pedido_id: p.id, ...(esHoy ? {} : { p_fecha: format(dia, "yyyy-MM-dd") }) }).then((r: any) => [p.id, r.error ? null : r.data] as const))),
      idsDiaPlanta.length ? sb.from("viajes_gps").select("dispatch_id, llegada_obra, llegada_planta").in("dispatch_id", idsDiaPlanta).then((r: any) => r.data || []) : Promise.resolve([]),
      enTaller.length ? sb.from("activity_log").select("entity_id, details, created_at").eq("entity", "camion").in("entity_id", enTaller).order("created_at", { ascending: false }).limit(30).then((r: any) => r.data || []) : Promise.resolve([]),
    ])
    setPedidos(peds)
    setViajesPorPedido(vpp)
    setMixers((mRes.data || []) as MixerDia[])
    setDespachosDia(dDia)
    setDespachosHoy(dHoy)
    setViajeDeDespacho(Object.fromEntries((vdd as ViajeRow[]).map((v) => [v.dispatch_id!, v])))
    setPlantasFull(Object.fromEntries(((plRes.data || []) as any[]).map((p) => [p.id, p])))
    const tp: Record<string, TipoResuelto> = {}
    for (const [id, r] of tps) tp[id] = r && (r.tipo === "R" || r.tipo === "X") ? { tipo: r.tipo, origen: r.origen } : { tipo: null, origen: null }
    setTipos(tp)
    setGpsReal(Object.fromEntries((vg as any[]).map((x) => [x.dispatch_id, x])))
    const notas: Record<string, string> = {}
    for (const a of nt as any[]) if (!(a.entity_id in notas)) notas[a.entity_id] = a.details?.Nota && a.details.Nota !== "-" ? String(a.details.Nota) : ""
    setNotasTaller(notas)
    setCargando(false)
  }, [planta, dia, esHoy])

  useEffect(() => {
    cargar()
    const t = setInterval(() => { if (document.visibilityState === "visible") cargar() }, 30_000)
    return () => clearInterval(t)
  }, [cargar])
  useEffect(() => {
    const sb = createClient()
    cargarChoferes(sb).then(setChoferes)
    cargarEmpresasBombeo(sb).then(setEmpresas)
    cargarTiemposGps(sb).then(setTiempos)
  }, [])

  // GPS cada 60 s (posiciones() tiene caché en el servidor)
  const cargarGps = useCallback(async () => {
    try {
      const r = await fetch("/api/gps/posiciones", { cache: "no-store" })
      const j = await r.json()
      const m: Record<string, GpsCamion> = {}
      for (const c of j?.camiones || []) if (c.mixer_id) m[c.mixer_id] = { estado: c.estado, ultima_posicion: c.ultima_posicion, planta_id: c.planta_id || null, probable_obra: !!c.probable_obra }
      setGps(m)
    } catch { /* sin GPS: todo queda estimado */ }
  }, [])
  useEffect(() => {
    cargarGps()
    const t = setInterval(() => { if (document.visibilityState === "visible") cargarGps() }, 60_000)
    return () => clearInterval(t)
  }, [cargarGps])

  // ── Derivados ──
  const prmDePlanta = useCallback((id: string) => (plantasFull[id] ? parametrosDePlanta(plantasFull[id]) : PARAMETROS_BASE), [plantasFull])
  const pedidosPorId = useMemo(() => Object.fromEntries(pedidos.map((p) => [p.id, p])), [pedidos])
  const viajes = useMemo(() => viajesDelDia(pedidos, viajesPorPedido, prmDePlanta, tiempos), [pedidos, viajesPorPedido, prmDePlanta, tiempos])
  const pendientes = useMemo(() => viajesPendientes(viajes, pedidos), [viajes, pedidos])
  const enPausa = useMemo(() => viajesEnPausa(viajes, pedidos), [viajes, pedidos])
  const viajesDePedido = useMemo(() => {
    const m: Record<string, ViajeT[]> = {}
    for (const v of viajes) (m[v.pedido_id] ||= []).push(v)
    return m
  }, [viajes])
  const totalPorPedido = useMemo(() => Object.fromEntries(Object.entries(viajesDePedido).map(([k, vs]) => [k, vs.filter((v) => v.estado !== "cancelado").length])), [viajesDePedido])
  const despachosPlanta = useMemo(() => despachosDia.filter((d) => d.plant_id === planta), [despachosDia, planta])
  const contadores = useMemo(() => contadoresDia(pedidos, despachosPlanta, viajes), [pedidos, despachosPlanta, viajes])
  const choferPorId = useMemo(() => Object.fromEntries(choferes.map((c) => [c.id, c.nombre])), [choferes])
  const patentes = useMemo(() => Object.fromEntries(mixers.map((m) => [m.id, m.license_plate])), [mixers])

  // Último despacho de hoy de cada camión, con los minutos de su viaje (para lo estimado sin GPS)
  const despachoDeCamion = useMemo(() => {
    const out: Record<string, { suyos: DespachoT[]; d: DespachoT | null; dc: DespachoCamion }> = {}
    for (const m of mixers) {
      const suyos = despachosHoy
        .filter((d) => d.mixer_id === m.id && new Date(d.dispatch_date).getTime() <= ahora)
        .sort((a, b) => new Date(b.dispatch_date).getTime() - new Date(a.dispatch_date).getTime())
      const d = suyos[0] || null
      let dc: DespachoCamion = null
      if (d) {
        const v = viajeDeDespacho[d.id]
        const prm = prmDePlanta(d.plant_id)
        const dif = (a?: string, b?: string) => (a && b ? Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / MIN)) : null)
        const ida = dif(v?.hora_salida, v?.hora_llegada) ?? (Number(d.construction_sites?.travel_time_minutes) || 30)
        dc = {
          id: d.id, dispatch_date: d.dispatch_date, plant_id: d.plant_id, obra: d.construction_sites?.name || null,
          idaMin: ida,
          descargaMin: dif(v?.hora_llegada, v?.hora_fin_descarga) ?? prm.descargaDirectaMin,
          vueltaMin: dif(v?.hora_fin_descarga, v?.hora_vuelta) ?? prm.lavadoMin + ida,
        }
      }
      out[m.id] = { suyos, d, dc }
    }
    return out
  }, [mixers, despachosHoy, viajeDeDespacho, ahora, prmDePlanta])

  // El GPS lo vio FUERA de la planta después de la salida de su despacho (recién ahí, al volver, se libera solo).
  // Se recuerda en el equipo para que un refresco de la pantalla no lo pierda.
  const [vistos, setVistos] = useState<Record<string, { d: string; at: number }>>(() => {
    try { return JSON.parse(window.localStorage.getItem(CLAVE_VISTOS) || "{}") } catch { return {} }
  })
  useEffect(() => {
    setVistos((prev) => {
      let cambio = false
      const nuevo = { ...prev }
      for (const m of mixers) {
        const dc = despachoDeCamion[m.id]?.dc
        if (!dc) continue
        const ant = prev[m.id]?.d === dc.id ? prev[m.id].at : null
        const v = vistoFueraDePlanta(ant, gps[m.id] ?? null, dc, Date.now())
        if (v != null && v !== ant) { nuevo[m.id] = { d: dc.id, at: v }; cambio = true }
      }
      if (cambio) guardar(CLAVE_VISTOS, JSON.stringify(nuevo))
      return cambio ? nuevo : prev
    })
  }, [gps, despachoDeCamion, mixers])

  const camiones: CamionT[] = useMemo(() => {
    const out = mixers.map((m) => {
      const { suyos, d, dc } = despachoDeCamion[m.id] || { suyos: [], d: null, dc: null }
      const visto = !!dc && vistos[m.id]?.d === dc.id
      const e = estadoCamion(m, gps[m.id] ?? null, dc, ahora, visto)
      const conChofer = suyos.find((x) => x.chofer_id)
      return {
        id: m.id, patente: m.license_plate, status: m.status, e,
        chofer: conChofer?.chofer_id ? choferPorId[conChofer.chofer_id] || null : null,
        choferId: conChofer?.chofer_id || null,
        obra: d?.construction_sites?.name || null,
        despachoId: m.status === "in_transit" ? d?.id || null : null,
        notaTaller: notasTaller[m.id] || null,
      }
    })
    return out.sort((a, b) => ordenCamion(a.e, planta) - ordenCamion(b.e, planta) || a.patente.localeCompare(b.patente))
  }, [mixers, despachoDeCamion, vistos, gps, ahora, choferPorId, notasTaller, planta])

  const puntualidad = useMemo(() => {
    const out: Record<string, Puntualidad> = {}
    const tol = prmDePlanta(planta).toleranciaMin
    for (const p of pedidos) {
      const ds = despachosDia.filter((d) => d.scheduled_dispatch_id === p.id)
      const primero = [...ds].sort((a, b) => new Date(a.dispatch_date).getTime() - new Date(b.dispatch_date).getTime())[0]
      const camion = primero?.mixer_id ? camiones.find((c) => c.id === primero.mixer_id) : null
      const prox = (viajesDePedido[p.id] || []).filter((v) => v.estado === "planificado").sort((a, b) => new Date(a.hora_carga).getTime() - new Date(b.hora_carga).getTime())[0]
      out[p.id] = puntualidadPrimerCamion({
        llegadaPedida: p.scheduled_arrival_time, toleranciaMin: tol, viajeMin: viajeMinDe(p),
        despachos: ds, llegadaGps: Object.fromEntries(ds.map((d) => [d.id, gpsReal[d.id]?.llegada_obra])),
        enObraAhoraGps: !!camion && camion.despachoId === primero?.id && camion.e.clave === "obra" && camion.e.fuente === "gps" && !camion.e.probableObra,
        proximaCarga: prox?.hora_carga || null, ahora,
      })
    }
    return out
  }, [pedidos, despachosDia, camiones, viajesDePedido, gpsReal, ahora, planta, prmDePlanta])

  const viajeDe = useMemo(() => {
    const m: Record<string, string> = {}
    for (const v of viajes) if (v.dispatch_id) m[v.dispatch_id] = `${v.n}/${totalPorPedido[v.pedido_id] || "?"}`
    return m
  }, [viajes, totalPorPedido])

  // ── El GPS lo vio volver a la planta: queda libre solo (Actividad "fuente GPS") ──
  const liberados = useRef(new Set<string>())
  useEffect(() => {
    if (!puedeDespachar || !esHoy) return
    const sb = createClient()
    const aLiberar = camiones.filter((c) => c.e.liberarPorGps && c.status === "in_transit" && !liberados.current.has(`${c.id}:${c.despachoId}`))
    if (!aLiberar.length) return
    for (const c of aLiberar) liberados.current.add(`${c.id}:${c.despachoId}`)
    Promise.all(aLiberar.map((c) => sb.rpc("camion_volvio", {
      p_mixer_id: c.id, p_fuente: "gps", p_usuario: currentUserName(),
      p_visto_fuera_at: vistos[c.id] ? new Date(vistos[c.id].at).toISOString() : null,
    }).then((r: any) => (r.data?.cambiado ? c.patente : null))))
      .then((ok) => {
        const pats = ok.filter(Boolean)
        if (pats.length) { toast({ title: `${pats.join(" · ")} volvió a planta (GPS)`, description: "Quedó libre solo. En Actividad: «Volvió a planta · fuente GPS»" }); cargar() }
      })
  }, [camiones, vistos, puedeDespachar, esHoy, cargar, toast])

  // ── Despachar: botón, tocar o arrastrar ──
  const viajePorClave = (clave: string) => pendientes.find((v) => v.clave === clave) || null
  const camionPorId = (id: string) => camiones.find((c) => c.id === id) || null
  const abrirEntrega = (clave: string, camionId: string) => {
    const v = viajePorClave(clave)
    const p = v ? pedidosPorId[v.pedido_id] : null
    if (!v || !p) { toast({ title: "Ese viaje ya no está pendiente", description: "Actualizá la pantalla." }); return }
    setSelViaje(null); setSelCamion(null)
    setEntrega({ pedido: p, viajeClave: clave, camionId })
  }
  const intentar = (clave: string, camionId: string) => {
    const c = camionPorId(camionId)
    if (!c) return
    if (c.e.clave === "taller" || c.e.clave === "fuera") { setAviso({ viajeClave: clave, camionId, tipo: "taller" }); return }
    if (c.e.clave !== "planta") { setAviso({ viajeClave: clave, camionId, tipo: "no_libre" }); return }
    if (c.e.plantaId && c.e.plantaId !== planta) toast({ title: `${c.patente} está en ${plants.find((x) => x.id === c.e.plantaId)?.name || "la otra planta"}`, description: "Se puede despachar igual: los camiones se comparten" })
    abrirEntrega(clave, camionId)
  }
  const despacharViaje = (clave: string) => {
    if (!puedeDespachar) return
    const v = viajePorClave(clave)
    if (!v) return
    const est = camiones.map((c) => ({ id: c.id, e: c.e }))
    const prop = camionPropuesto(v.mixer_id, est, planta)
    if (prop) { intentar(clave, prop); return }
    const alguno = v.mixer_id || camiones.find((c) => c.e.clave !== "taller" && c.e.clave !== "fuera")?.id
    if (alguno) intentar(clave, alguno)
    else toast({ title: "No hay camiones disponibles", description: "Todos figuran en taller o fuera de servicio." })
  }
  const tocarViaje = (clave: string) => {
    if (!puedeDespachar) { toast({ title: "Modo consulta", description: "Podés ver todo, pero no despachar." }); return }
    if (selCamion) { const c = selCamion; setSelCamion(null); intentar(clave, c); return }
    setSelViaje((s) => (s === clave ? null : clave))
    if (angosta && selViaje !== clave) setTab("camiones")
  }
  const tocarCamion = (id: string) => {
    if (!puedeDespachar) { toast({ title: "Modo consulta", description: "Podés ver todo, pero no despachar." }); return }
    const c = camionPorId(id)
    if (!c) return
    if (selViaje) { const v = selViaje; setSelViaje(null); intentar(v, id); return }
    if (c.e.clave === "planta") {
      setSelCamion((s) => (s === id ? null : id))
      toast({ title: `${c.patente} elegido`, description: "Ahora tocá el viaje que lleva (o tocá «Despachar» en un viaje)" })
      if (angosta) setTab("viajes")
    } else toast({ title: `${c.patente} figura ${c.e.etiqueta.toLowerCase()}`, description: "Para despacharlo, primero tocá un viaje" })
  }
  const soltarSeleccion = () => { setSelViaje(null); setSelCamion(null) }
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") soltarSeleccion() }
    document.addEventListener("keydown", f)
    return () => document.removeEventListener("keydown", f)
  }, [])
  const arrastre = usarArrastre({ habilitado: puedeDespachar, onSoltar: (clave, camion) => intentar(clave, camion), onTocar: tocarViaje })

  // Lo que se ve enseguida después de despachar (sin esperar el refresco)
  function despachado(r: ResultadoDespacho) {
    setEntrega(null)
    const v = r.viajeClave ? viajes.find((x) => x.clave === r.viajeClave) : null
    if (v && !v.calculado && v.id)
      setViajesPorPedido((m) => ({ ...m, [r.pedidoId]: (m[r.pedidoId] || []).map((x) => (x.id === v.id ? { ...x, estado: "despachado", dispatch_id: r.id, m3: r.m3 } : x)) }))
    setPedidos((ps) => ps.map((p) => {
      if (p.id !== r.pedidoId) return p
      const desp = Number(p.dispatched_m3 || 0) + r.m3
      return { ...p, dispatched_m3: desp, status: r.completo || desp >= Number(p.quantity_m3) - 0.01 ? "completed" : p.status }
    }))
    setMixers((ms) => ms.map((m) => (m.id === r.mixerId ? { ...m, status: "in_transit", estado_desde: new Date().toISOString() } : m)))
    const p = pedidosPorId[r.pedidoId]
    const fila: DespachoT = {
      id: r.id, dispatch_date: r.salida, created_at: new Date().toISOString(), remito: r.remito, remito_tipo: r.tipo, quantity_m3: r.m3,
      mixer_id: r.mixerId, chofer_id: r.choferId, plant_id: planta, scheduled_dispatch_id: r.pedidoId, is_test_dispatch: false,
      clients: p?.clients ? { name: p.clients.name } : null, construction_sites: p?.construction_sites ? { name: p.construction_sites.name, travel_time_minutes: p.construction_sites.travel_time_minutes } : null,
      formulas: p?.formulas ? { code: p.formulas.code } : null,
    }
    // Sale hoy (con la hora de ahora o la corregida): entra en los despachos de hoy y, si se mira hoy, en la tabla
    setDespachosHoy((ds) => [fila, ...ds])
    if (esHoy) setDespachosDia((ds) => [fila, ...ds])
    setAhora(Date.now())
    setNueva(r.id)
    setTimeout(() => setNueva(null), 4000)
    cargar()
  }

  // ── Camión: volvió, taller, disponible ──
  async function volvio(id: string) {
    const c = camionPorId(id)
    const sb = createClient()
    const { data, error } = await sb.rpc("camion_volvio", { p_mixer_id: id, p_fuente: "manual", p_usuario: currentUserName() })
    if (error) { toast({ title: "No se pudo marcar", description: error.message, variant: "destructive" }); return }
    if ((data as any)?.cambiado === false) toast({ title: `${c?.patente || "El camión"} ya figuraba libre`, description: "No se cambió nada." })
    else toast({ title: `${c?.patente || "El camión"} volvió a planta`, description: "Marcado a mano. Queda libre para el próximo viaje" })
    cargar()
  }
  async function mandarTaller() {
    const id = taller
    if (!id) return
    const c = camionPorId(id)
    const sb = createClient()
    const { error } = await sb.from("mixers").update({ status: "maintenance", updated_at: new Date().toISOString() }).eq("id", id)
    if (error) { toast({ title: "No se pudo mandar a taller", description: error.message, variant: "destructive" }); return }
    logActivity({ action: "editar", entity: "camion", entityId: id, reference: c?.patente || null, plantId: planta, details: { Estado: `${c?.e.etiqueta || "-"} → taller`, Nota: notaTaller.trim() || "-", Origen: "Despacho diario" } })
    toast({ title: `${c?.patente} en taller`, description: "No aparece como libre para despachar" })
    setTaller(null); setNotaTaller("")
    cargar()
  }
  async function disponible(id: string) {
    const c = camionPorId(id)
    const sb = createClient()
    const { error } = await sb.from("mixers").update({ status: "available", updated_at: new Date().toISOString() }).eq("id", id)
    if (error) { toast({ title: "No se pudo cambiar", description: error.message, variant: "destructive" }); return }
    logActivity({ action: "editar", entity: "camion", entityId: id, reference: c?.patente || null, plantId: planta, details: { Estado: "taller → disponible", Origen: "Despacho diario" } })
    toast({ title: `${c?.patente} disponible`, description: `Libre en ${plantaObj.name}` })
    cargar()
  }

  // ── Pedido ──
  async function confirmarPedido(p: PedidoT) {
    if (!ajustaPedido(p)) return
    const conf = !p.confirmado_at
    const cambios = conf ? { confirmado_at: new Date().toISOString(), confirmado_por: currentUserName() } : { confirmado_at: null, confirmado_por: null }
    const { error } = await createClient().from("scheduled_dispatches").update(cambios).eq("id", p.id)
    if (error) { toast({ title: "No se pudo confirmar", description: error.message, variant: "destructive" }); return }
    setPedidos((ps) => ps.map((x) => (x.id === p.id ? { ...x, ...cambios } : x)))
    logActivity({ action: "editar", entity: "pedido", entityId: p.id, reference: p.construction_sites?.name || null, plantId: p.plant_id, details: { Confirmado: conf ? "no → sí (día anterior)" : "sí → no" } })
    toast({ title: conf ? "👍 Pedido confirmado" : "Se quitó la confirmación", description: p.clients?.name })
  }
  async function hacerSuspender(tipo: MotivoTipo, detalle: string) {
    if (!suspender) return null
    const p = suspender
    const { error } = await createClient().rpc("suspender_pedido", { p_id: p.id, p_tipo: tipo, p_motivo: detalle || null, p_usuario: currentUserName() })
    if (error) return error.message
    toast({ title: `Pedido suspendido · ${textoMotivo(tipo)}`, description: `${p.clients?.name}: ${m3txt(Math.max(0, p.quantity_m3 - Number(p.dispatched_m3 || 0)))} m³ en pausa` })
    setSuspender(null)
    cargar()
    return null
  }
  const nuevaCargaReabrir = Math.ceil((Date.now() + 10 * MIN) / (5 * MIN)) * 5 * MIN
  async function hacerReabrir(correr: boolean) {
    if (!reabrir) return null
    const p = reabrir
    const sb = createClient()
    const { error } = await sb.rpc("reabrir_pedido", { p_id: p.id, p_usuario: currentUserName() })
    if (error) return error.message
    let desc = "Con los horarios de antes"
    if (correr) {
      const vs = viajesPorPedido[p.id] || []
      const nuevos = ajustarAHora(vs, new Date(nuevaCargaReabrir))
      const r = await guardarViajes(sb, p.id, nuevos, currentUserName(), "gerenciador")
      if (r.error) toast({ title: "Se reabrió, pero los viajes no se corrieron", description: r.error, variant: "destructive" })
      else {
        desc = `Los viajes se corrieron: el próximo carga a las ${hhmm(nuevaCargaReabrir)}`
        logActivity({ action: "editar", entity: "pedido", entityId: p.id, reference: p.construction_sites?.name || null, plantId: p.plant_id, details: { Viajes: `corridos al reabrir: el próximo carga ${hhmm(nuevaCargaReabrir)}` } })
      }
    }
    toast({ title: "Pedido reabierto", description: desc })
    setReabrir(null)
    cargar()
    return null
  }
  async function hacerFinalizar(tipo: MotivoTipo, detalle: string) {
    if (!finalizar) return null
    const p = finalizar
    const { data, error } = await createClient().rpc("finalizar_pedido", { p_id: p.id, p_tipo: tipo, p_motivo: detalle || null, p_usuario: currentUserName() })
    if (error) return error.message
    toast({ title: "Pedido finalizado", description: `${(data as any)?.nota || ""} · ${textoMotivo(tipo)}` })
    setFinalizar(null)
    cargar()
    return null
  }
  async function hacerCancelar(tipo: MotivoTipo, detalle: string) {
    if (!cancelar || !puedeCancelar) return null
    const p = cancelar
    const { error } = await createClient().from("scheduled_dispatches").update({ status: "cancelled", cierre_motivo_tipo: tipo, cierre_motivo: detalle } as any).eq("id", p.id)
    if (error) return error.message
    // Sin mail: el pedido no se borra (como en la pantalla de siempre)
    logActivity({
      action: "editar", entity: "pedido", entityId: p.id, reference: `${p.clients?.name || "-"} · ${p.construction_sites?.name || "-"}`, plantId: p.plant_id,
      details: { Estado: `${p.status} → cancelado`, "m³": p.quantity_m3, Enviado: p.dispatched_m3 || 0, Motivo: `${textoMotivo(tipo)} — ${detalle}` },
    })
    toast({ title: "Pedido cancelado", description: `${p.clients?.name} · ${m3txt(Math.max(0, p.quantity_m3 - Number(p.dispatched_m3 || 0)))} m³ al contador «Cancelado»` })
    setCancelar(null)
    cargar()
    return null
  }
  async function guardarTotal() {
    const p = editarTotal
    if (!p || !ajustaPedido(p)) return
    const qty = parseFloat(totalNuevo.replace(",", "."))
    if (isNaN(qty) || qty <= 0) { toast({ title: "Error", description: "Ingresá una cantidad válida", variant: "destructive" }); return }
    if (!motivoValido(motivoTotal)) { toast({ title: "Falta el motivo", description: "Escribí por qué se cambia el total.", variant: "destructive" }); return }
    const sb = createClient()
    const { error } = await sb.from("scheduled_dispatches").update({ quantity_m3: qty }).eq("id", p.id)
    if (error) { toast({ title: "No se pudo guardar", description: error.message, variant: "destructive" }); return }
    toast({ title: "Total actualizado", description: `Nueva cantidad: ${m3txt(qty)} m³` })
    if (qty !== Number(p.quantity_m3)) {
      logActivity({ action: "editar", entity: "pedido", entityId: p.id, reference: `${p.clients?.name || "-"} · ${p.construction_sites?.name || "-"}`, plantId: p.plant_id, details: { "m³": `${p.quantity_m3} → ${qty}`, Origen: "Editar total (Despacho en tres columnas)", Motivo: motivoTotal.trim() } })
      const rv = await regenerarViajesPedido(sb, p.id, currentUserName(), { soloSiTiene: true, motivo: "cantidad" })
      if (rv.error) toast({ title: "Los viajes no se actualizaron", description: rv.error, variant: "destructive" })
      else if (rv.generados != null) toast({ title: "Se recalcularon los viajes de este pedido" })
    }
    setEditarTotal(null)
    cargar()
  }

  // ── Encabezado ──
  const etiquetaDia = isToday(dia) ? "Hoy" : isTomorrow(dia) ? "Mañana" : isYesterday(dia) ? "Ayer" : ""
  const avisoCamion = aviso ? camionPorId(aviso.camionId) : null
  const reabrirViajes = reabrir ? (viajesPorPedido[reabrir.id] || []).filter((v) => v.estado === "planificado").sort((a, b) => new Date(a.hora_carga).getTime() - new Date(b.hora_carga).getTime()) : []
  const fantasmaViaje = arrastre.fantasma ? pendientes.find((v) => v.clave === arrastre.fantasma!.clave) : null

  const columnas: Record<Tab, React.ReactNode> = {
    viajes: (
      <ColumnaViajes
        viajes={pendientes} pedidos={pedidosPorId} totalPorPedido={totalPorPedido} tipos={tipos} empresas={empresas} enPausa={enPausa}
        ahora={ahora} esHoy={esHoy} puedeDespachar={puedeDespachar} elegido={selViaje} patentes={patentes}
        onDespachar={despacharViaje} onTocar={tocarViaje} onPointerDown={arrastre.empezar} recienSoltado={arrastre.recienSoltado}
        onSoltar={soltarSeleccion} plantaNombre={plantaObj.name}
      />
    ),
    camiones: (
      <ColumnaCamiones
        camiones={camiones} planta={planta} plantas={plants} filtro={filtroCam} setFiltro={setFiltroCam} ahora={ahora}
        puedeDespachar={puedeDespachar} hayViajeElegido={!!selViaje || !!arrastre.fantasma} sobre={arrastre.sobre}
        onTocar={tocarCamion} onVolvio={volvio} onTaller={(id) => { setNotaTaller(""); setTaller(id) }} onDisponible={disponible}
      />
    ),
    pedidos: (
      <ColumnaPedidos
        pedidos={pedidos} viajesPorPedido={viajesDePedido} totalPorPedido={totalPorPedido} tipos={tipos} empresas={empresas} puntualidad={puntualidad}
        permisos={{ despachar: puedeDespachar, ajusta: (p) => ajustaPedido(p), cancelar: puedeCancelar }}
        onConfirmar={confirmarPedido}
        onGerenciador={(p) => setGerenciar({ ...(p as any), plant_id: p.plant_id || planta })}
        onEditarTotal={(p) => { setTotalNuevo(String(p.quantity_m3)); setMotivoTotal(""); setEditarTotal(p) }}
        onVerEntregas={(p) => { setFiltroPedido(p.id); document.getElementById("entregas-dia")?.scrollIntoView({ behavior: "smooth" }) }}
        onSuspender={setSuspender} onReabrir={setReabrir} onFinalizar={setFinalizar} onCancelar={setCancelar}
      />
    ),
  }

  return (
    <div className="space-y-3 text-[15px]">
      {/* Barra de arriba */}
      <div className="sticky top-0 z-30 -mx-3 flex flex-wrap items-center gap-2.5 border-b bg-background/95 px-3 py-2.5 backdrop-blur">
        <h1 className="mr-1 text-xl font-bold">Despacho</h1>
        <NuevoBadge />
        <div className="inline-flex rounded-lg border bg-muted/40 p-0.5">
          {plants.map((p) => (
            <button key={p.id} onClick={() => elegirPlanta(p.id)} className={cn("min-h-[38px] rounded-md px-3 font-semibold", planta === p.id ? "bg-background shadow-sm" : "text-muted-foreground")}>{p.name}</button>
          ))}
        </div>
        <div className="inline-flex items-center gap-1">
          <button className="h-10 w-10 rounded-lg text-xl text-muted-foreground hover:bg-muted" title="Día anterior" onClick={() => setDia((d) => subDays(d, 1))}>‹</button>
          <button className={cn("min-h-[40px] rounded-lg px-3 font-semibold", esHoy ? "bg-foreground text-background" : "border")} onClick={() => setDia(new Date())}>
            {etiquetaDia ? `${etiquetaDia} · ` : ""}{format(dia, "EEE d/M", { locale: es })}
          </button>
          <button className="h-10 w-10 rounded-lg text-xl text-muted-foreground hover:bg-muted" title="Día siguiente" onClick={() => setDia((d) => addDays(d, 1))}>›</button>
        </div>
        <span className="text-lg font-bold tabular-nums">{hhmm(ahora)}</span>
        <span className="flex-1" />
        {puedeDespachar && (
          <AddDispatchDialog formulas={[]} clients={[]} mixers={[]} plantId={planta} plants={plants}
            onSuccess={(d) => { cargar(); if (d?.id) setRemitoListo(d) }} triggerLabel="Carga despacho manual" />
        )}
        <Button variant="outline" className="min-h-[40px] gap-2" onClick={() => { cargar(); cargarGps() }}><RefreshCw className="h-4 w-4" />Actualizar</Button>
        {onPantallaVieja && <Button variant="ghost" className="min-h-[40px]" onClick={onPantallaVieja}>Pantalla de siempre</Button>}
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-800">
        ⚠ Se recomienda extraer 3 muestras cada 50 m³ despachados
      </div>

      <ContadoresDia c={contadores} />

      {angosta && (
        <div className="flex gap-1.5">
          {(["viajes", "camiones", "pedidos"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn("min-h-[44px] flex-1 rounded-lg border font-bold capitalize", tab === t ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground")}>
              {t === "viajes" ? "Viajes" : t === "camiones" ? "Camiones" : "Pedidos"}
            </button>
          ))}
        </div>
      )}

      {cargando ? (
        <div className="py-16 text-center text-muted-foreground">Cargando…</div>
      ) : angosta ? (
        <section className="flex flex-col rounded-xl border bg-card">{columnas[tab]}</section>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {(["viajes", "camiones", "pedidos"] as Tab[]).map((t) => (
            <section key={t} className="flex h-[calc(100vh-280px)] min-h-[440px] flex-col overflow-hidden rounded-xl border bg-card">{columnas[t]}</section>
          ))}
        </div>
      )}

      <details className="rounded-xl border bg-card px-3.5 py-2.5 text-[13px]">
        <summary className="cursor-pointer text-sm font-bold">¿Qué quiere decir cada color del camión y de dónde sale?</summary>
        <table className="mt-2 w-full border-collapse">
          <tbody>
            {[
              ["bg-green-600", "En planta · libre", "GPS: dentro de la planta (250 m). Si vuelve después de un viaje, queda libre solo. Sin GPS: cuando el plantista toca «Volvió a planta»."],
              ["bg-blue-600", "Yendo a obra", "GPS: salió de planta con remito y anda. Sin GPS: desde la hora de salida del remito hasta la llegada estimada."],
              ["bg-amber-500", "En obra", "GPS: a menos de 400 m de la obra. Si la obra no está ubicada: «parado fuera de planta (probable obra)». Sin GPS: estimado."],
              ["bg-cyan-600", "Volviendo", "GPS: anda de vuelta. Sin GPS: estimado, y pasada media hora de la vuelta estimada pregunta «¿Volvió?»."],
              ["bg-slate-700", "Taller", "A mano, desde ⋮ del camión (o desde Camiones). No se puede despachar hasta tocar «Disponible»."],
              ["", "Tiempo", "En viaje: desde la salida del remito (⏱ = ciclo hasta ahora). En planta o taller: desde que cambió el estado."],
            ].map(([c, t, d]) => (
              <tr key={t} className="border-t align-top">
                <td className="whitespace-nowrap py-1.5 pr-2 font-bold">{c && <span className={cn("mr-1.5 inline-block h-3 w-3 rounded-sm align-[-1px]", c)} />}{t}</td>
                <td className="py-1.5">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <div id="entregas-dia">
        <TablaEntregas
          despachos={despachosPlanta} pedidos={pedidosPorId} camiones={camiones} choferes={choferPorId} viajeDe={viajeDe} gps={gpsReal}
          plantaNombre={plantaObj.name} filtroPedido={filtroPedido} onQuitarFiltro={() => setFiltroPedido(null)} nueva={nueva}
        />
      </div>

      {fantasmaViaje && arrastre.fantasma && (
        <FantasmaViaje x={arrastre.fantasma.x} y={arrastre.fantasma.y}
          texto={`${fantasmaViaje.n}/${totalPorPedido[fantasmaViaje.pedido_id] || "?"} · ${pedidosPorId[fantasmaViaje.pedido_id]?.construction_sites?.name || ""} · ${m3txt(fantasmaViaje.m3)} m³`} />
      )}

      {/* Entrega */}
      {entrega && (
        <EntregaDialog
          abierta={entrega} onClose={() => setEntrega(null)} planta={plantaObj} otraPlanta={otraPlanta}
          viajes={viajesDePedido[entrega.pedido.id] || []} totalViajes={totalPorPedido[entrega.pedido.id] || 0}
          camiones={camiones} choferes={choferes} empresas={empresas} puedeCambiarTipo={puedeCambiarTipo}
          onDespachado={despachado} onRemitoListo={setRemitoListo}
        />
      )}

      {/* Camión que no figura libre (4.4) o en taller */}
      <Dialog open={!!aviso} onOpenChange={(v) => !v && setAviso(null)}>
        <DialogContent className="sm:max-w-[460px]">
          {aviso && avisoCamion && (aviso.tipo === "taller" ? (
            <>
              <DialogHeader><DialogTitle>{avisoCamion.patente} está {avisoCamion.e.clave === "taller" ? "en taller" : "fuera de servicio"}</DialogTitle></DialogHeader>
              <p className="text-sm">No se puede despachar un camión {avisoCamion.e.clave === "taller" ? "en taller" : "fuera de servicio"}. Si ya está bien, tocá ⋮ › <b>Disponible</b> en su tarjeta.</p>
              <DialogFooter><Button className="h-11" variant="outline" onClick={() => setAviso(null)}>Entendido</Button></DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader><DialogTitle>{avisoCamion.patente} no figura libre</DialogTitle></DialogHeader>
              <p className="text-sm">{avisoCamion.patente} figura <b>{avisoCamion.e.etiqueta.toLowerCase()}</b> ({textoFuenteEstado(avisoCamion.e)}{avisoCamion.e.desde ? `, hace ${duracion((ahora - avisoCamion.e.desde) / MIN)}` : ""}). ¿Despachar igual?</p>
              <p className="text-sm text-muted-foreground">Puede ser que haya vuelto sin señal. Si lo tenés en la planta, despachalo igual.</p>
              <DialogFooter className="gap-2">
                <Button className="h-11" variant="outline" onClick={() => setAviso(null)}>Elegir otro</Button>
                <Button className="h-11" onClick={() => { const a = aviso; setAviso(null); abrirEntrega(a.viajeClave, a.camionId) }}>Despachar igual</Button>
              </DialogFooter>
            </>
          ))}
        </DialogContent>
      </Dialog>

      {/* Mandar a taller */}
      <Dialog open={!!taller} onOpenChange={(v) => !v && setTaller(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader><DialogTitle>Mandar {camionPorId(taller || "")?.patente} a taller</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <Label>Nota (opcional)</Label>
            <Input className="h-11" value={notaTaller} onChange={(e) => setNotaTaller(e.target.value)} placeholder="Ej: pinchó una goma" />
          </div>
          <p className="text-[13px] text-muted-foreground">No se va a poder despachar hasta que lo pongas «Disponible». Queda en Actividad.</p>
          <DialogFooter className="gap-2">
            <Button className="h-11" variant="outline" onClick={() => setTaller(null)}>Cancelar</Button>
            <Button className="h-11 bg-amber-600 hover:bg-amber-700" onClick={mandarTaller}>Mandar a taller</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SuspenderDialog pedido={suspender} onClose={() => setSuspender(null)} onConfirmar={hacerSuspender} />
      <ReabrirDialog
        pedido={reabrir} proximaCarga={reabrirViajes[0]?.hora_carga || null} nuevaCarga={nuevaCargaReabrir}
        puedeCorrer={!!reabrir && ajustaPedido(reabrir)} onClose={() => setReabrir(null)} onConfirmar={hacerReabrir}
      />
      <FinalizarDialog pedido={finalizar} onClose={() => setFinalizar(null)} onConfirmar={hacerFinalizar} />
      <CancelarDialog pedido={cancelar} onClose={() => setCancelar(null)} onConfirmar={hacerCancelar} />

      {/* Editar total (como en la pantalla de siempre) */}
      <Dialog open={!!editarTotal} onOpenChange={(v) => !v && setEditarTotal(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Editar total del pedido</DialogTitle></DialogHeader>
          {editarTotal && (
            <div className="space-y-4 py-2">
              <div className="text-sm text-muted-foreground">{editarTotal.clients?.name} · {editarTotal.construction_sites?.name}</div>
              <div className="space-y-2">
                <Label>Cantidad total (m³)</Label>
                <Input className="h-11 text-lg font-semibold" inputMode="decimal" value={totalNuevo} onChange={(e) => setTotalNuevo(e.target.value)} />
                <p className="text-xs text-muted-foreground">Valor actual: {m3txt(editarTotal.quantity_m3)} m³</p>
              </div>
              <CampoMotivo value={motivoTotal} onChange={setMotivoTotal} id="motivo-total-3c" ejemplo="Ej: la obra pidió 4 m³ más" />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button className="h-11" variant="outline" onClick={() => setEditarTotal(null)}>Cancelar</Button>
            <Button className="h-11" onClick={guardarTotal} disabled={!motivoValido(motivoTotal)}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GerenciadorViajes pedido={gerenciar} open={!!gerenciar} onOpenChange={(v) => !v && setGerenciar(null)} onGuardado={() => cargar()} />

      {/* Remito para imprimir (despacho manual, o si el navegador no dejó abrir el PDF) */}
      <Dialog open={!!remitoListo} onOpenChange={(v) => !v && setRemitoListo(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>✅ Camión despachado</DialogTitle>
            <DialogDescription>El camión ya está registrado. Imprimí el remito antes de que salga.</DialogDescription>
          </DialogHeader>
          {remitoListo && (
            <div className="space-y-1 rounded-lg bg-muted/50 p-3 text-sm">
              <p><span className="text-muted-foreground">Remito:</span> <strong className="text-base">{remitoListo.tipo ? `${remitoListo.tipo} ` : ""}{remitoListo.remito || "sin número"}</strong>{remitoListo.tipo ? ` · ${TIPO_TEXTO[remitoListo.tipo]}` : ""}</p>
              {remitoListo.tipo && <p className="text-xs text-muted-foreground">Imprime {numeroImpreso(remitoListo.tipo, remitoListo.remito)} en la hoja pre-impresa.</p>}
              <p><span className="text-muted-foreground">Camión:</span> <strong>{remitoListo.patente || "-"}</strong> · <strong>{m3txt(remitoListo.m3)} m³</strong>{remitoListo.chofer ? <> · {remitoListo.chofer}</> : null}</p>
              <p><span className="text-muted-foreground">Cliente:</span> {remitoListo.cliente}{remitoListo.obra ? ` · ${remitoListo.obra}` : ""}</p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" className="text-muted-foreground" onClick={() => setRemitoListo(null)}>Sin remito</Button>
            <Button className="h-11 flex-1 text-base" onClick={() => { if (remitoListo) window.open(`/api/remito/${remitoListo.id}?doc=remitox&fondo=0`, "_blank"); setRemitoListo(null) }}>🖨 Imprimir remito</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <HumedadAcopio plantId={planta} habilitado={puedeHumedad && esHoy} />
    </div>
  )
}
