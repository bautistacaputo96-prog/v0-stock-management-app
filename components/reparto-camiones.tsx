"use client"

/**
 * Camiones por planta (docs/specs/2026-11-04-camiones-por-planta.md, fase 1).
 *
 * useRepartoDia: carga lo necesario de las DOS plantas (pedidos del día y del siguiente, viajes, tiempos, camiones,
 * reparto guardado de ese día y del anterior, traslado) y arma con lib/reparto.ts la sugerencia y, si hay un reparto
 * guardado o en edición, el resultado respetándolo. RepartoCamiones: el bloque de la vista Día (sugerencia con el
 * porqué, editor, guardar). Solo con el interruptor de funciones nuevas. Si la migración no está aplicada, el bloque
 * muestra la sugerencia y no deja guardar; la programación sigue como antes.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { NuevoBadge } from "@/components/nuevo-badge"
import { useToast } from "@/hooks/use-toast"
import { currentUserName, usePermisos } from "@/lib/current-user"
import { parametrosDePlanta, aMin, aHora, type Parametros } from "@/lib/planificador"
import { cargarViajes, conTiemposGps, parametrosConGps, type PedidoParaViajes, type ViajeRow } from "@/lib/viajes"
import { cargarTiemposGps, type TiemposGps } from "@/lib/gps-viajes"
import {
  armarDia, dondeDuermen, repartoDe, contarTraslados, franjasDe, textoNoche, textoComparacion, avisosEdicion,
  avisosSuperposicion, viajesDia, trasladoDe, mismoReparto, cargarReparto, guardarReparto, cargarTraslado, guardarTraslado,
  entradaConPantalla, propuestaDePlanta, validarReparto, escenarioConMas, textoResumenDia, estadoPedido, lineaTraslados,
  bloquesDiagrama, TEXTO_ESCENARIO, REGLAS_REPARTO, type EntradaDia,
  type PlantaReparto, type CamionReparto, type Reparto, type PedidoReparto, type ContextoReparto, type RepartoGuardado,
  type FilaTraslado, type Aviso, type ViajeDia,
} from "@/lib/reparto"
import { addDays, format, startOfDay } from "date-fns"
import { es } from "date-fns/locale"
import { AlertTriangle, ArrowLeftRight, CircleHelp, Loader2, Moon, Plus, RefreshCw, Truck, X } from "lucide-react"
import { cn } from "@/lib/utils"

const H = 36 * 60
type Plant = { id: string; name: string }
type MixerRow = { id: string; license_plate: string; capacity_m3: number | null; active: boolean | null; status: string | null }

const SELECT_PEDIDOS = "*, construction_sites(name, travel_time_minutes, requires_pump)"
/** Colores por planta (andan en modo oscuro): Canning verde suave (teal), Hudson violeta suave */
const ESTILOS_PLANTA = {
  teal: { bloque: "bg-teal-100 text-teal-900 border-teal-300 dark:bg-teal-900/40 dark:text-teal-100 dark:border-teal-700", punto: "bg-teal-300 dark:bg-teal-700" },
  violeta: { bloque: "bg-violet-100 text-violet-900 border-violet-300 dark:bg-violet-900/40 dark:text-violet-100 dark:border-violet-700", punto: "bg-violet-300 dark:bg-violet-700" },
}
const ESTILO_TRASLADO = { bloque: "bg-muted text-muted-foreground border-border", punto: "bg-muted-foreground/40" }
const fecha = (d: Date) => format(d, "yyyy-MM-dd")
const clonar = (r: Reparto): Reparto => JSON.parse(JSON.stringify(r))

export type TrasladoForm = { minutos: string; km: string; litros: string }

export function useRepartoDia({ dia, plants, activo }: { dia: Date; plants: Plant[]; activo: boolean }) {
  const [cargando, setCargando] = useState(false)
  // Para qué día y plantas ya se cargó una vez: mientras recarga se sigue usando lo último (no vuelve a "como antes")
  const [cargadoPara, setCargadoPara] = useState<string | null>(null)
  const [plantRows, setPlantRows] = useState<any[]>([])
  const [tiempos, setTiempos] = useState<TiemposGps | null>(null)
  const [mixers, setMixers] = useState<MixerRow[]>([])
  const [pedidosHoy, setPedidosHoy] = useState<PedidoParaViajes[]>([])
  const [pedidosManana, setPedidosManana] = useState<PedidoParaViajes[]>([])
  const [viajes, setViajes] = useState<Record<string, ViajeRow[]>>({})
  const [guardado, setGuardado] = useState<RepartoGuardado | null>(null)
  const [ayer, setAyer] = useState<RepartoGuardado | null>(null)
  const [trasladoFila, setTrasladoFila] = useState<{ disponible: boolean; fila: FilaTraslado | null }>({ disponible: false, fila: null })
  const [ruta, setRuta] = useState<{ minutos: number; km: number } | null>(null)
  const [edicion, setEdicion] = useState<Reparto | null>(null)
  const [trasladoForm, setTrasladoForm] = useState<TrasladoForm>({ minutos: "", km: "", litros: "" })
  const [guardando, setGuardando] = useState(false)

  const ids = plants.map((p) => p.id)
  const clavePlantas = ids.join(",")
  const base = startOfDay(dia).getTime()

  /**
   * Lee todo de nuevo. limpiar = descarta la edición sin guardar (cambio de día, "Recalcular", después de guardar);
   * sin limpiar (después de guardar el traslado, una hora o el plan del día) lo editado se conserva.
   */
  const cargar = useCallback(async (limpiar = false) => {
    if (!activo || !clavePlantas) return
    setCargando(true)
    const sb = createClient()
    const ini = startOfDay(dia), fin = addDays(ini, 1), fin2 = addDays(ini, 2)
    const plantIds = clavePlantas.split(",")
    const [{ data: pls }, { data: ms }, { data: ph }, { data: pm }, tg, g, a, tr] = await Promise.all([
      sb.from("plants").select("*").in("id", plantIds),
      sb.from("mixers").select("id, license_plate, capacity_m3, active, status").eq("active", true).order("license_plate"),
      sb.from("scheduled_dispatches").select(SELECT_PEDIDOS).in("plant_id", plantIds).gte("scheduled_arrival_time", ini.toISOString()).lt("scheduled_arrival_time", fin.toISOString()).neq("status", "cancelled"),
      sb.from("scheduled_dispatches").select(SELECT_PEDIDOS).in("plant_id", plantIds).gte("scheduled_arrival_time", fin.toISOString()).lt("scheduled_arrival_time", fin2.toISOString()).neq("status", "cancelled"),
      cargarTiemposGps(sb),
      cargarReparto(sb, fecha(ini)),
      cargarReparto(sb, fecha(addDays(ini, -1))),
      plantIds.length === 2 ? cargarTraslado(sb, plantIds[0], plantIds[1]) : Promise.resolve({ disponible: false, fila: null }),
    ])
    const hoy = ((ph as any[]) || []) as PedidoParaViajes[], man = ((pm as any[]) || []) as PedidoParaViajes[]
    const vs = await cargarViajes(sb, [...hoy, ...man].map((p) => p.id))
    setPlantRows((pls as any[]) || [])
    setMixers(((ms as any[]) || []) as MixerRow[])
    setPedidosHoy(hoy)
    setPedidosManana(man)
    setViajes(vs)
    setTiempos(tg)
    setGuardado(g)
    setAyer(a)
    setTrasladoFila(tr)
    setTrasladoForm({ minutos: tr.fila ? String(tr.fila.minutos) : "", km: tr.fila?.km != null ? String(tr.fila.km) : "", litros: tr.fila?.litros != null ? String(tr.fila.litros) : "" })
    if (limpiar) setEdicion(null)
    setCargadoPara(`${fecha(ini)}|${clavePlantas}`)
    setCargando(false)
  }, [activo, clavePlantas, dia]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { cargar(true) }, [cargar])

  // Ruta del mapa entre las dos plantas (solo para mostrar y como respaldo del traslado)
  useEffect(() => {
    if (!activo || plantRows.length !== 2) return
    const [a, b] = plantRows
    if (a.gps_lat == null || a.gps_lng == null || b.gps_lat == null || b.gps_lng == null) return
    let vivo = true
    fetch(`/api/geo/ruta?desde=${a.gps_lat},${a.gps_lng}&hasta=${b.gps_lat},${b.gps_lng}`)
      .then((r) => r.json())
      .then((d) => { if (vivo && Number(d?.minutos) > 0) setRuta({ minutos: Number(d.minutos), km: Number(d.km) || 0 }) })
      .catch(() => {})
    return () => { vivo = false }
  }, [activo, plantRows])

  const plantas: PlantaReparto[] = useMemo(() => plants.map((p) => {
    const row = plantRows.find((x) => x.id === p.id)
    return { id: p.id, nombre: p.name, prm: parametrosConGps(parametrosDePlanta(row), p.id, tiempos) }
  }), [plants, plantRows, tiempos])
  const nombres = useMemo(() => Object.fromEntries(plantas.map((p) => [p.id, p.nombre])), [plantas])
  const patentes = useMemo(() => Object.fromEntries(mixers.map((m) => [m.id, m.license_plate])), [mixers])
  const traslado = useMemo(() => trasladoDe(trasladoFila.fila, ruta), [trasladoFila, ruta])

  const amanece = useMemo(() => Object.fromEntries(mixers.map((m) => [m.id, ayer?.reparto?.[m.id]?.duerme ?? null])) as Record<string, string | null>, [mixers, ayer])
  // Camiones del día: activos que no están en taller ni fuera de servicio
  const delDia = useMemo(() => mixers.filter((m) => m.status !== "maintenance" && m.status !== "unavailable"), [mixers])
  const efectivo: Reparto | null = edicion ?? guardado?.reparto ?? null
  const noSalen = useMemo(() => new Set(delDia.filter((m) => efectivo?.[m.id]?.sale === false).map((m) => m.id)), [delDia, efectivo])
  const aCamion = (m: MixerRow): CamionReparto => ({ id: m.id, patente: m.license_plate, capacidad: Number(m.capacity_m3) || 8, amanece: amanece[m.id] ?? null })
  const camiones = useMemo(() => delDia.filter((m) => !noSalen.has(m.id)).map(aCamion), [delDia, noSalen, amanece]) // eslint-disable-line react-hooks/exhaustive-deps
  const camionesNoSalen = useMemo(() => delDia.filter((m) => noSalen.has(m.id)).map(aCamion), [delDia, noSalen, amanece]) // eslint-disable-line react-hooks/exhaustive-deps

  const prmDe = useCallback((id: string) => plantas.find((p) => p.id === id)?.prm, [plantas])
  const aPedidos = useCallback((ps: PedidoParaViajes[]): PedidoReparto[] => ps
    .filter((p) => prmDe(p.plant_id))
    .map((p) => ({ p: conTiemposGps(p, prmDe(p.plant_id)!, tiempos), existentes: viajes[p.id] || [], obra: p.construction_sites?.name || "Pedido" })), [prmDe, tiempos, viajes])
  const pedidosR = useMemo(() => aPedidos(pedidosHoy), [aPedidos, pedidosHoy])
  const fijos = useMemo(() => pedidosHoy.flatMap((p) => (viajes[p.id] || []).filter((v) => v.estado === "despachado")), [pedidosHoy, viajes])
  // Listo = ya se cargó este día (aunque esté recargando: se sigue con lo último hasta que llegue lo nuevo)
  const listo = activo && cargadoPara === `${fecha(startOfDay(dia))}|${clavePlantas}` && plantas.length > 0 && plantRows.length > 0

  const entrada: EntradaDia | null = useMemo(() => (listo ? { base, plantas, camiones, pedidos: pedidosR, traslado, fijos } : null), [listo, base, plantas, camiones, pedidosR, traslado, fijos])
  const sugerencia = useMemo(() => (entrada ? armarDia(entrada) : null), [entrada])
  const noche = useMemo(() => {
    if (!sugerencia) return null
    const man = aPedidos(pedidosManana)
    return dondeDuermen(sugerencia, camiones, plantas, man.length ? { base: addDays(startOfDay(dia), 1).getTime(), plantas, pedidos: man, traslado } : null)
  }, [sugerencia, camiones, plantas, aPedidos, pedidosManana, dia, traslado])
  const sugerido = useMemo(() => (sugerencia && noche ? repartoDe(sugerencia, camiones, noche.duerme, camionesNoSalen) : null), [sugerencia, noche, camiones, camionesNoSalen])
  const resultado = useMemo(() => (listo && efectivo ? armarDia({ base, plantas, camiones, pedidos: pedidosR, traslado, fijos, reparto: efectivo }) : sugerencia), [listo, efectivo, base, plantas, camiones, pedidosR, traslado, fijos, sugerencia])
  const vigente: Reparto | null = efectivo ?? sugerido

  // Viajes con que se compara (los guardados o, si el pedido no tiene pendientes, los de la sugerencia)
  const plantDe = useCallback((pid: string) => pedidosHoy.find((p) => p.id === pid)?.plant_id || null, [pedidosHoy])
  const guardadosIds = useMemo(() => new Set(pedidosHoy.filter((p) => (viajes[p.id] || []).some((v) => v.estado === "planificado")).map((p) => p.id)), [pedidosHoy, viajes])
  const referencia: ViajeDia[] = useMemo(() => {
    const guardadosDia = viajesDia(pedidosHoy.flatMap((p) => (viajes[p.id] || []).filter((v) => v.estado !== "cancelado" && (v.estado === "despachado" || guardadosIds.has(p.id)))), base, plantDe)
    return [...guardadosDia, ...(sugerencia?.viajes || []).filter((v) => !v.fijo && !guardadosIds.has(v.pedidoId))]
  }, [pedidosHoy, viajes, guardadosIds, base, plantDe, sugerencia])
  const obraDe = useCallback((pid: string) => pedidosHoy.find((p) => p.id === pid)?.construction_sites?.name || "otra obra", [pedidosHoy])

  const avisos: Aviso[] = useMemo(() => {
    if (!resultado) return []
    const guardadosDia = pedidosHoy.flatMap((p) => (viajes[p.id] || []).filter((v) => v.estado !== "cancelado"))
    return [
      // Los avisos por pedido (atrasos, fin de jornada) van en la tabla; acá quedan los del día (traslado a confirmar)
      ...resultado.avisos.filter((a) => !a.pedidoId),
      ...(efectivo ? avisosEdicion(efectivo, referencia, guardadosIds, [...camiones], plantas, traslado, obraDe) : []),
      ...avisosSuperposicion(guardadosDia, obraDe, (id) => patentes[id] || "—"),
    ]
  }, [resultado, efectivo, referencia, guardadosIds, camiones, plantas, traslado, obraDe, pedidosHoy, viajes, patentes])

  const contexto: ContextoReparto | null = useMemo(() => (resultado && vigente ? {
    base, plantas, traslado, camiones, reparto: vigente,
    sugeridos: Object.fromEntries(resultado.pedidos.map((x) => [x.id, x.camiones])),
    otros: referencia,
  } : null), [resultado, vigente, base, plantas, traslado, camiones, referencia])

  /** Camiones del reparto en una planta a la hora t (para la línea de "Disponibles"). */
  const disponiblesEn = useCallback((plantId: string, t: number) => {
    if (!efectivo) return null
    return camiones.filter((c) => {
      const ts = efectivo[c.id]?.tramos || []
      if (!ts.length) return true
      return ts.some((x, i) => x.plantId === plantId && (x.desde ?? -H) <= t && t < (ts[i + 1]?.desde != null ? ts[i + 1].desde! - traslado.minutos : H))
    }).length
  }, [efectivo, camiones, traslado])

  // ---- Edición (sobre lo vigente) ----
  const editar = (f: (r: Reparto) => void) => {
    const base0 = vigente ? clonar(vigente) : {}
    for (const m of delDia) if (!base0[m.id]) base0[m.id] = { sale: true, tramos: [], duerme: amanece[m.id] ?? null }
    f(base0)
    setEdicion(base0)
  }
  const otraPlanta = (id: string) => plantas.find((p) => p.id !== id)?.id || id
  const alternar = (ts: { plantId: string; desde: number | null }[], arranca: string) => ts.map((t, i) => ({ ...t, plantId: i % 2 === 0 ? arranca : otraPlanta(arranca) }))
  const acciones = {
    setSale: (id: string, sale: boolean) => editar((r) => { r[id] = { ...r[id], sale } }),
    setArranca: (id: string, plantId: string) => editar((r) => { const ts = r[id].tramos.length ? r[id].tramos : [{ plantId, desde: null }]; r[id].tramos = alternar(ts, plantId) }),
    agregarCambio: (id: string) => editar((r) => {
      const ts = r[id].tramos
      if (!ts.length || ts.length > REGLAS_REPARTO.maxCambios) return
      const ult = ts[ts.length - 1]
      const vuelta = (resultado?.tramos[id] || []).find((t) => t.plantId === ult.plantId && (t.desde ?? null) === ult.desde)?.ultimaVuelta
      const sale = Math.max((ult.desde ?? aMin("07:00")) + 30, vuelta ?? aMin("12:00"))
      ts.push({ plantId: otraPlanta(ult.plantId), desde: Math.round(sale + traslado.minutos) })
    }),
    setCambio: (id: string, i: number, salida: string) => editar((r) => { if (/^\d{2}:\d{2}$/.test(salida)) r[id].tramos[i].desde = aMin(salida) + traslado.minutos }),
    quitarCambio: (id: string, i: number) => editar((r) => { const ts = r[id].tramos; ts.splice(i, 1); r[id].tramos = ts.length ? alternar(ts, ts[0].plantId) : ts }),
    setDuerme: (id: string, plantId: string | null) => editar((r) => { r[id].duerme = plantId }),
    usarSugerencia: () => { if (sugerido) setEdicion(clonar(sugerido)) },
    descartar: () => setEdicion(null),
  }

  async function guardar(): Promise<string | null> {
    if (!vigente) return "No hay reparto para guardar"
    const invalido = validarReparto(vigente, (id) => patentes[id] || "Un camión", (id) => nombres[id] || "la otra planta", traslado)
    if (invalido) return invalido
    setGuardando(true)
    const origen = mismoReparto(vigente, sugerido) ? "sugerido" : "a_mano"
    const { error } = await guardarReparto(createClient(), fecha(dia), vigente, currentUserName(), origen)
    setGuardando(false)
    if (!error) await cargar(true)
    return error
  }

  // ---- Traslado (se guarda con "Guardar tiempos", con el motivo de siempre) ----
  const nf = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")))
  const trasladoNuevo = { minutos: nf(trasladoForm.minutos), km: nf(trasladoForm.km), litros: nf(trasladoForm.litros) }
  const trasladoCambiado = activo && trasladoFila.disponible && (
    trasladoNuevo.minutos !== (trasladoFila.fila?.minutos ?? null) || trasladoNuevo.km !== (trasladoFila.fila?.km ?? null) || trasladoNuevo.litros !== (trasladoFila.fila?.litros ?? null))
  const trasladoValido = trasladoNuevo.minutos != null && trasladoNuevo.minutos > 0 && [trasladoNuevo.km, trasladoNuevo.litros].every((x) => x == null || x > 0)
  const textoTrasladoFila = (f: { minutos: number | null; km: number | null; litros: number | null } | null) =>
    f && f.minutos ? `${f.minutos} min${f.km ? ` · ${f.km} km` : ""}${f.litros ? ` · ${f.litros} L` : ""}` : "sin cargar"
  async function guardarTrasladoForm(): Promise<{ error: string | null; detalle?: string }> {
    if (!trasladoCambiado) return { error: null }
    if (!trasladoValido || plants.length !== 2) return { error: "Revisá el traslado: los minutos son obligatorios y todo tiene que ser mayor a 0" }
    const { error } = await guardarTraslado(createClient(), plants[0].id, plants[1].id, { minutos: trasladoNuevo.minutos!, km: trasladoNuevo.km, litros: trasladoNuevo.litros }, currentUserName())
    if (error) return { error }
    const detalle = `${textoTrasladoFila(trasladoFila.fila)} → ${textoTrasladoFila(trasladoNuevo)}`
    await cargar()
    return { error: null, detalle }
  }

  return {
    entrada, obraDe, activo, cargando, listo, disponible: !!guardado?.disponible, guardado, ayer, plantas, nombres, patentes, camiones, delDia,
    traslado, trasladoFila, ruta, trasladoForm, setTrasladoForm, trasladoCambiado, trasladoValido, guardarTrasladoForm,
    sugerencia, sugerido, resultado, noche, efectivo, edicion, vigente, amanece, avisos, contexto, disponiblesEn,
    idsSalen: camiones.map((c) => c.id), noSalen, guardando, guardar, cargar, ...acciones,
    nombreTraslado: plants.length === 2 ? `${plants[0].name} ↔ ${plants[1].name}` : "entre plantas",
  }
}

export type RepartoDia = ReturnType<typeof useRepartoDia>

/**
 * Filas para "Ordenar el día" con el reparto guardado o en edición (3.4): los viajes de los pedidos de esta planta,
 * armados con lo que se ve en la pantalla (pedidos, viajes guardados y tiempos, aunque no estén guardados). Sin
 * reparto: null (se ordena como siempre).
 */
export function propuestaConReparto(rep: RepartoDia, plantId: string, pantalla: { pedidos: PedidoReparto[]; prm: Parametros }): Record<string, ViajeRow[]> | null {
  if (!rep.efectivo || !rep.entrada) return null
  return propuestaDePlanta(armarDia({ ...entradaConPantalla(rep.entrada, plantId, pantalla), reparto: rep.efectivo }), plantId)
}

/** Estilo de una planta: por nombre (Canning teal, Hudson violeta); si no, alternando */
function estiloPlanta(rep: RepartoDia, plantId: string) {
  const n = (rep.nombres[plantId] || "").toLowerCase()
  if (n.includes("canning")) return ESTILOS_PLANTA.teal
  if (n.includes("hudson")) return ESTILOS_PLANTA.violeta
  return rep.plantas.findIndex((p) => p.id === plantId) % 2 === 0 ? ESTILOS_PLANTA.teal : ESTILOS_PLANTA.violeta
}

export function RepartoCamiones({ rep, dia }: { rep: RepartoDia; dia: Date }) {
  const { toast } = useToast()
  const { puede } = usePermisos()
  const edita = (puede("programacion", "editar") || puede("despacho", "cargar")) && rep.disponible
  const [ayuda, setAyuda] = useState(false)
  const [verEditor, setVerEditor] = useState(false)
  // 0 = con los camiones que hay; 1 / 2 = escenario con camiones ficticios (solo para ver)
  const [escenario, setEscenario] = useState<0 | 1 | 2>(0)
  const ent = useMemo(() => (rep.entrada ? { ...rep.entrada, reparto: rep.efectivo } : null), [rep.entrada, rep.efectivo])
  const mas1 = useMemo(() => (ent ? escenarioConMas(ent, 1) : null), [ent])
  const mas2 = useMemo(() => (ent ? escenarioConMas(ent, 2) : null), [ent])

  if (!rep.activo) return null
  const base = rep.resultado
  if (!rep.listo || !base || !rep.sugerencia) {
    return (
      <Card><CardContent className="p-4 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Armando el reparto de camiones…
      </CardContent></Card>
    )
  }
  const esc = escenario === 1 ? mas1 : escenario === 2 ? mas2 : null
  const res = esc ? esc.resultado : base
  const camiones = esc ? esc.camiones : rep.camiones
  const patentes = { ...rep.patentes, ...Object.fromEntries((esc?.ficticios || []).map((c) => [c.id, c.patente])) }
  const amanece = { ...rep.amanece, ...Object.fromEntries((esc?.ficticios || []).map((c) => [c.id, c.amanece])) }
  const vigente = esc ? repartoDe(res, camiones, dondeDuermen(res, camiones, rep.plantas, null).duerme) : rep.vigente || {}
  const conteo = contarTraslados(vigente, amanece)
  const duerme = Object.fromEntries([...rep.delDia.map((m) => m.id), ...(esc?.ficticios || []).map((c) => c.id)].map((id) => [id, vigente[id]?.duerme ?? amanece[id] ?? null]))
  const resumen = textoResumenDia(camiones.length, res, esc ? null : mas1?.resultado ?? null, esc ? null : mas2?.resultado ?? null)
  const filasDiagrama = bloquesDiagrama(res, camiones, rep.nombres, rep.obraDe)
  const tituloDia = format(dia, "EEEE dd/MM", { locale: es })
  const comparacion = !esc && rep.efectivo ? textoComparacion(franjasDe(rep.sugerencia, rep.camiones, rep.plantas), franjasDe(base, rep.camiones, rep.plantas), rep.nombres) : null
  const estadoTxt = rep.edicion
    ? "Cambios sin guardar: la tabla y el diagrama ya los usan."
    : rep.guardado?.reparto
      ? `Guardado${rep.guardado.origen === "sugerido" ? " (la sugerencia)" : " a mano"}${rep.guardado.actualizadoPor ? ` por ${rep.guardado.actualizadoPor}` : ""}${rep.guardado.actualizado ? ` · ${format(new Date(rep.guardado.actualizado), "dd/MM HH:mm")}` : ""}.`
      : rep.disponible
        ? "Es la sugerencia, sin guardar. Hasta que se guarde, Ordenar el día usa todos los camiones que salen, como siempre, y Armar viajes propone los camiones de la sugerencia."
        : "Es solo la sugerencia: la programación sigue como siempre. Todavía no se puede guardar: falta un paso de Bautista."

  // Eje del diagrama: cada hora (o cada 2 si el día es largo)
  const todos = filasDiagrama.flatMap((f) => f.bloques)
  const t0 = Math.min(aMin("07:00"), ...todos.map((b) => Math.floor(b.desde / 60) * 60))
  const t1 = Math.max(aMin("18:00"), ...todos.map((b) => Math.ceil(b.hasta / 60) * 60))
  const paso = t1 - t0 > 10 * 60 ? 120 : 60
  const pos = (m: number) => `${((m - t0) / (t1 - t0)) * 100}%`
  const ancho = (a: number, b: number) => `calc(${Math.max(0.4, ((b - a) / (t1 - t0)) * 100)}% - 2px)`

  async function guardar() {
    const error = await rep.guardar()
    if (error) toast({ title: "No se guardó el reparto", description: error, variant: "destructive" })
    else toast({ title: "Reparto guardado", description: "Lo ven las dos plantas, desde cualquier computadora. Quedó en Actividad." })
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {/* Encabezado */}
        <div className="flex items-start gap-3 flex-wrap">
          <div>
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Truck className="h-4 w-4" /> Camiones por planta · {tituloDia} <NuevoBadge />
              <button type="button" className="text-muted-foreground hover:text-foreground" title="Cómo se calcula" onClick={() => setAyuda(!ayuda)}><CircleHelp className="h-4 w-4" /></button>
            </p>
            <p className="text-xs text-muted-foreground">
              {rep.camiones.length === 1 ? "1 camión disponible" : `${rep.camiones.length} camiones disponibles`}
              {esc ? ` · escenario con ${esc.extra === 1 ? "1 camión más" : "2 camiones más"} (${esc.ficticios.map((c) => `${c.patente} en ${rep.nombres[c.amanece || ""]}`).join(", ")})` : ""}
              {!esc && rep.edicion ? " · cambios sin guardar" : ""}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
            <div className="inline-flex rounded-md border overflow-hidden">
              {([[0, `Con los que hay (${rep.camiones.length})`], [1, "+1 camión"], [2, "+2 camiones"]] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setEscenario(k)} disabled={(k === 1 && !mas1) || (k === 2 && !mas2)}
                  className={cn("px-2.5 py-1 text-xs border-l first:border-l-0", escenario === k ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}>{l}</button>
              ))}
            </div>
            {edita && <Button size="sm" variant="outline" disabled={!!esc} onClick={() => setVerEditor(!verEditor)}>{verEditor ? "Cerrar edición" : "Editar"}</Button>}
            {edita && !esc && rep.efectivo && !mismoReparto(rep.efectivo, rep.sugerido) && <Button size="sm" variant="outline" onClick={rep.usarSugerencia}>Usar la sugerencia</Button>}
            {edita && !esc && rep.edicion && <Button size="sm" variant="ghost" onClick={rep.descartar}>Descartar</Button>}
            {edita && (
              <Button size="sm" onClick={guardar} disabled={!!esc || rep.guardando || (!rep.edicion && !!rep.guardado?.reparto)} title={esc ? TEXTO_ESCENARIO : "Cambia el reparto de las dos plantas"}>
                {rep.guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Guardar reparto"}
              </Button>
            )}
          </div>
        </div>
        {esc && edita && <p className="text-xs text-muted-foreground text-right">{TEXTO_ESCENARIO}.</p>}

        {/* Ayuda (?) */}
        {ayuda && (
          <div className="text-xs text-muted-foreground rounded-md bg-muted/50 px-3 py-2 space-y-1">
            <p>{estadoTxt}</p>
            <p>Para cada pedido se busca la menor cantidad de camiones que alcanza: a tiempo es, con bomba, sin cortes de más de {REGLAS_REPARTO.bomba.corteMax} min y no más de {REGLAS_REPARTO.bomba.demoraMax} min tarde; directo, {REGLAS_REPARTO.directo.corteMax} y {REGLAS_REPARTO.directo.demoraMax}. Los pedidos se arman en orden de hora, primero con los camiones que ya están en esa planta: cada traslado gasta. A la bomba se le da prioridad sobre un directo. Un camión sin viajes no se mueve. A la noche cada camión queda donde termina, salvo que mañana a una planta le falten para arrancar.</p>
            <p>"+1 camión" y "+2 camiones" muestran qué pasaría con camiones de 8 m³ disponibles desde las 07:00 en la planta donde más convenga. Son solo para ver: no se guardan.</p>
            {comparacion && <p>{comparacion}</p>}
            {!esc && rep.noche && <p>{rep.noche.textos.join(" · ")}</p>}
            <p>El traslado entre plantas (minutos, km y litros) se carga en Tiempos y camiones.</p>
          </div>
        )}

        {/* Resumen en una frase */}
        <p className={cn("text-sm rounded-md border px-3 py-2", resumen.tono === "verde"
          ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
          : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100")}>{resumen.texto}</p>

        {/* Tabla por pedido */}
        {res.pedidos.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b text-left">
                  <th className="py-1.5 pr-3 font-medium">Pedido</th>
                  <th className="py-1.5 pr-3 font-medium">Planta</th>
                  <th className="py-1.5 pr-3 font-medium">Camiones</th>
                  <th className="py-1.5 pr-3 font-medium">Termina</th>
                  <th className="py-1.5 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {res.pedidos.map((p) => {
                  const e = estadoPedido(p)
                  const chipAmarillo = "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
                  return (
                    <tr key={p.id} className="border-b last:border-0 align-top">
                      <td className="py-1.5 pr-3 font-medium">{p.obra}</td>
                      <td className="py-1.5 pr-3">{rep.nombres[p.plantId]}</td>
                      <td className="py-1.5 pr-3">{p.camiones.length} <span className="text-muted-foreground">{p.camiones.map((id) => patentes[id]).join(", ")}</span></td>
                      <td className="py-1.5 pr-3">{p.viajes.length ? aHora(Math.round(p.medida.fin)) : "—"}</td>
                      <td className="py-1.5">
                        <span className="flex flex-wrap gap-1">
                          <span className={cn("rounded-full px-2 py-0.5", e.aTiempo ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100" : chipAmarillo)}>{e.texto}</span>
                          {e.jornada && <span className={cn("rounded-full px-2 py-0.5", chipAmarillo)}>{e.jornada}</span>}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Traslados en una línea y la noche */}
        <div className="text-xs space-y-0.5">
          <p className="flex items-center gap-1.5"><ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />{lineaTraslados(res, conteo, rep.traslado, rep.nombres, patentes)}</p>
          <p className="flex items-center gap-1.5"><Moon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />{textoNoche(duerme, rep.plantas)}</p>
        </div>

        {/* Avisos del día (traslado a confirmar, cambios a mano, camiones en dos viajes) */}
        {rep.avisos.length > 0 && !esc && (
          <div className="space-y-0.5">
            {rep.avisos.map((a, i) => (
              <p key={i} className={cn("text-xs flex items-start gap-1", a.nivel === "info" ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400")}>
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />{a.texto}
              </p>
            ))}
          </div>
        )}

        {/* Diagrama: una fila por camión, un bloque por viaje (de la carga a la vuelta) */}
        <div className="overflow-x-auto">
          <div className="min-w-[680px] space-y-1">
            <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-2 text-[11px] text-muted-foreground">
              <span />
              <div className="relative h-4">
                {Array.from({ length: Math.floor((t1 - t0) / paso) + 1 }, (_, i) => t0 + i * paso).map((t) => <span key={t} className="absolute -translate-x-1/2" style={{ left: pos(t) }}>{aHora(t)}</span>)}
              </div>
            </div>
            {filasDiagrama.map((f) => (
              <div key={f.camionId} className="grid grid-cols-[84px_minmax(0,1fr)] gap-2 items-center">
                <span className={cn("text-xs font-medium truncate", f.ficticio && "italic text-muted-foreground")}>{f.patente}</span>
                <div className="relative h-7 border-b border-dashed border-border">
                  {f.bloques.map((b, i) => {
                    const est = b.tipo === "traslado" ? ESTILO_TRASLADO : estiloPlanta(rep, b.plantId)
                    return (
                      <div key={i} className={cn("absolute top-0.5 h-6 rounded border px-1 text-[10px] leading-6 truncate", est.bloque)} style={{ left: pos(b.desde), width: ancho(b.desde, b.hasta) }}
                        title={`${b.texto} · ${aHora(Math.round(b.desde))} a ${aHora(Math.round(b.hasta))}`}>
                        {b.texto}
                      </div>
                    )
                  })}
                  {!f.bloques.length && <span className="absolute inset-y-0 left-1 flex items-center text-[11px] text-muted-foreground">sin viajes</span>}
                </div>
              </div>
            ))}
            <div className="flex gap-3 text-[11px] text-muted-foreground flex-wrap pt-1">
              {rep.plantas.map((p) => <span key={p.id} className="flex items-center gap-1"><span className={cn("h-2.5 w-2.5 rounded-sm", estiloPlanta(rep, p.id).punto)} />{p.nombre}</span>)}
              <span className="flex items-center gap-1"><span className={cn("h-2.5 w-2.5 rounded-sm", ESTILO_TRASLADO.punto)} />Traslado</span>
            </div>
          </div>
        </div>

        {/* Editor del reparto (con los camiones reales; no en un escenario) */}
        {verEditor && edita && !esc && (
          <div className="rounded-md border px-3 py-2 space-y-1.5">
            <p className="text-xs font-medium">Editar el reparto <span className="font-normal text-muted-foreground">(las horas son de salida de la planta; el cambio se ve arriba al momento)</span></p>
            {rep.delDia.map((m) => {
              const r = (rep.vigente || {})[m.id]
              if (!r) return null
              const sale = r.sale !== false
              const ts = base.tramos[m.id] || []
              return (
                <div key={m.id} className="flex items-center gap-2 flex-wrap text-xs">
                  <span className={cn("w-[76px] font-medium", !sale && "line-through text-muted-foreground")}>{m.license_plate}</span>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={sale} onChange={(e) => rep.setSale(m.id, e.target.checked)} />Sale hoy</label>
                  {sale && (
                    <>
                      <span className="text-muted-foreground">Arranca en</span>
                      <Select value={r.tramos[0]?.plantId || "none"} onValueChange={(v) => v !== "none" && rep.setArranca(m.id, v)}>
                        <SelectTrigger className="h-7 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {!r.tramos.length && <SelectItem value="none">A confirmar</SelectItem>}
                          {rep.plantas.map((p) => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {r.tramos.slice(1).map((t, k) => (
                        <span key={k} className="flex items-center gap-1 rounded border px-1.5 py-0.5">
                          Pasa a {rep.nombres[t.plantId]} a las
                          <Input type="time" className="h-6 w-[96px] text-xs" value={t.desde != null ? aHora(Math.max(0, Math.round(t.desde - rep.traslado.minutos))) : ""} onChange={(e) => rep.setCambio(m.id, k + 1, e.target.value)} />
                          <span className="text-muted-foreground">(llega {t.desde != null ? aHora(Math.round(t.desde)) : "—"})</span>
                          <button type="button" className="text-muted-foreground hover:text-destructive" title="Quitar este cambio" onClick={() => rep.quitarCambio(m.id, k + 1)}><X className="h-3 w-3" /></button>
                        </span>
                      ))}
                      {r.tramos.length > 0 && r.tramos.length <= REGLAS_REPARTO.maxCambios && (
                        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs gap-0.5" onClick={() => rep.agregarCambio(m.id)}><Plus className="h-3 w-3" />Pasa a la otra planta</Button>
                      )}
                      {ts.map((t, i) => (i < ts.length - 1 && t.ultimaVuelta != null ? <span key={`s${i}`} className="text-muted-foreground">sale de {rep.nombres[t.plantId]} {aHora(Math.round(t.ultimaVuelta))}</span> : null))}
                    </>
                  )}
                  <span className="text-muted-foreground ml-2">Duerme en</span>
                  <Select value={r.duerme || "none"} onValueChange={(v) => rep.setDuerme(m.id, v === "none" ? null : v)}>
                    <SelectTrigger className="h-7 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">A confirmar</SelectItem>
                      {rep.plantas.map((p) => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="text-muted-foreground">durmió en: {rep.amanece[m.id] ? rep.nombres[rep.amanece[m.id]!] : "a confirmar"}</span>
                </div>
              )
            })}
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" className="gap-1.5 h-7 text-xs" onClick={() => {
                if (rep.edicion && !window.confirm("Tenés cambios sin guardar en el reparto. Si recalculás, se pierden. ¿Seguir?")) return
                rep.cargar(true)
              }}><RefreshCw className="h-3.5 w-3.5" />Recalcular</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
