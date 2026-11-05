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
import { parametrosDePlanta, aMin, aHora } from "@/lib/planificador"
import { cargarViajes, conTiemposGps, parametrosConGps, type PedidoParaViajes, type ViajeRow } from "@/lib/viajes"
import { cargarTiemposGps, type TiemposGps } from "@/lib/gps-viajes"
import {
  armarDia, dondeDuermen, repartoDe, contarTraslados, franjasDe, textoFranja, textoTraslado, textoTraslados, textoNoche,
  textoComparacion, avisosEdicion, avisosSuperposicion, viajesDia, trasladoDe, mismoReparto, cargarReparto, guardarReparto,
  cargarTraslado, guardarTraslado, REGLAS_REPARTO,
  type PlantaReparto, type CamionReparto, type Reparto, type PedidoReparto, type ContextoReparto, type RepartoGuardado,
  type FilaTraslado, type Aviso, type ViajeDia,
} from "@/lib/reparto"
import { addDays, format, startOfDay } from "date-fns"
import { AlertTriangle, ArrowLeftRight, CircleHelp, Loader2, Moon, Plus, RefreshCw, Truck, X } from "lucide-react"
import { cn } from "@/lib/utils"

const H = 36 * 60
type Plant = { id: string; name: string }
type MixerRow = { id: string; license_plate: string; capacity_m3: number | null; active: boolean | null; status: string | null }

const SELECT_PEDIDOS = "*, construction_sites(name, travel_time_minutes, requires_pump)"
const COLORES_PLANTA = ["bg-sky-500", "bg-amber-500", "bg-emerald-500"]
const fecha = (d: Date) => format(d, "yyyy-MM-dd")
const clonar = (r: Reparto): Reparto => JSON.parse(JSON.stringify(r))

export type TrasladoForm = { minutos: string; km: string; litros: string }

export function useRepartoDia({ dia, plants, activo }: { dia: Date; plants: Plant[]; activo: boolean }) {
  const [cargando, setCargando] = useState(false)
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

  const cargar = useCallback(async () => {
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
    setEdicion(null)
    setCargando(false)
  }, [activo, clavePlantas, dia]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { cargar() }, [cargar])

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
  const listo = activo && !cargando && plantas.length > 0 && plantRows.length > 0

  const sugerencia = useMemo(() => (listo ? armarDia({ base, plantas, camiones, pedidos: pedidosR, traslado, fijos }) : null), [listo, base, plantas, camiones, pedidosR, traslado, fijos])
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
      ...resultado.avisos,
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
    setGuardando(true)
    const origen = mismoReparto(vigente, sugerido) ? "sugerido" : "a_mano"
    const { error } = await guardarReparto(createClient(), fecha(dia), vigente, currentUserName(), origen)
    setGuardando(false)
    if (!error) await cargar()
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
    activo, cargando, listo, disponible: !!guardado?.disponible, guardado, ayer, plantas, nombres, patentes, camiones, delDia,
    traslado, trasladoFila, ruta, trasladoForm, setTrasladoForm, trasladoCambiado, trasladoValido, guardarTrasladoForm,
    sugerencia, sugerido, resultado, noche, efectivo, edicion, vigente, amanece, avisos, contexto, disponiblesEn,
    idsSalen: camiones.map((c) => c.id), noSalen, guardando, guardar, cargar, ...acciones,
    nombreTraslado: plants.length === 2 ? `${plants[0].name} ↔ ${plants[1].name}` : "entre plantas",
  }
}

export type RepartoDia = ReturnType<typeof useRepartoDia>

/** Filas para "Ordenar el día" con el reparto (3.4): los viajes de los pedidos de esta planta. */
export function propuestaConReparto(rep: RepartoDia, plantId: string): Record<string, ViajeRow[]> | null {
  if (!rep.efectivo || !rep.resultado) return null
  const out: Record<string, ViajeRow[]> = {}
  for (const p of rep.resultado.pedidos) if (p.plantId === plantId && p.filas.length) out[p.id] = p.filas
  return out
}

const negritaPrimera = (t: string) => {
  const i = t.indexOf(" · ")
  return i < 0 ? <>{t}</> : <><strong>{t.slice(0, i)}</strong>{t.slice(i)}</>
}

export function RepartoCamiones({ rep }: { rep: RepartoDia }) {
  const { toast } = useToast()
  const { puede } = usePermisos()
  const edita = (puede("programacion", "editar") || puede("despacho", "cargar")) && rep.disponible
  const [ayuda, setAyuda] = useState(false)
  const [verEditor, setVerEditor] = useState(false)
  const res = rep.resultado
  if (!rep.activo) return null
  if (!rep.listo || !res) {
    return (
      <Card className="border-violet-200"><CardContent className="p-4 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Armando el reparto de camiones…
      </CardContent></Card>
    )
  }
  const camiones = rep.camiones
  const franjas = franjasDe(res, camiones, rep.plantas)
  const vigente = rep.vigente || {}
  const conteo = contarTraslados(vigente, rep.amanece)
  const duerme = Object.fromEntries(rep.delDia.map((m) => [m.id, vigente[m.id]?.duerme ?? rep.amanece[m.id] ?? null]))
  const comparacion = rep.efectivo && rep.sugerencia ? textoComparacion(franjasDe(rep.sugerencia, camiones, rep.plantas), franjas, rep.nombres) : null
  const sinCambios = !rep.edicion
  const color = (plantId: string) => COLORES_PLANTA[Math.max(0, rep.plantas.findIndex((p) => p.id === plantId)) % COLORES_PLANTA.length]
  const t0 = aMin("06:00"), t1 = aMin("20:00")
  const pos = (m: number) => `${Math.max(0, Math.min(100, ((m - t0) / (t1 - t0)) * 100))}%`
  const anc = (a: number, b: number) => `${Math.max(0.3, ((Math.min(b, t1) - Math.max(a, t0)) / (t1 - t0)) * 100)}%`
  const estadoTxt = rep.edicion
    ? "Cambios sin guardar: las líneas de cada pedido ya los usan."
    : rep.guardado?.reparto
      ? `Guardado${rep.guardado.origen === "sugerido" ? " (la sugerencia)" : " a mano"}${rep.guardado.actualizadoPor ? ` por ${rep.guardado.actualizadoPor}` : ""}${rep.guardado.actualizado ? ` · ${format(new Date(rep.guardado.actualizado), "dd/MM HH:mm")}` : ""}`
      : "Es la sugerencia: todavía no se guardó (hasta guardarlo, el día se ordena como siempre)."

  async function guardar() {
    const error = await rep.guardar()
    if (error) toast({ title: "No se guardó el reparto", description: error, variant: "destructive" })
    else toast({ title: "Reparto guardado", description: "Lo ven las dos plantas, desde cualquier computadora. Quedó en Actividad." })
  }

  return (
    <Card className="border-violet-200">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium flex items-center gap-1.5"><Truck className="h-4 w-4" /> Camiones por planta <NuevoBadge /></p>
          <button type="button" className="text-muted-foreground hover:text-foreground" title="Cómo se calcula" onClick={() => setAyuda(!ayuda)}><CircleHelp className="h-4 w-4" /></button>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => rep.cargar()}><RefreshCw className="h-3.5 w-3.5" />Sugerir</Button>
            {edita && (rep.efectivo && !mismoReparto(rep.efectivo, rep.sugerido)) && <Button size="sm" variant="outline" onClick={rep.usarSugerencia}>Usar la sugerencia</Button>}
            {edita && <Button size="sm" variant="outline" onClick={() => setVerEditor(!verEditor)}>{verEditor ? "Cerrar edición" : "Editar"}</Button>}
            {edita && rep.edicion && <Button size="sm" variant="ghost" onClick={rep.descartar}>Descartar</Button>}
            {edita && (
              <Button size="sm" onClick={guardar} disabled={rep.guardando || (sinCambios && !!rep.guardado?.reparto)} title="Cambia el reparto de las dos plantas">
                {rep.guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Guardar reparto"}
              </Button>
            )}
          </div>
        </div>
        {ayuda && (
          <p className="text-xs text-muted-foreground rounded-md bg-muted/50 px-3 py-2">
            Para cada pedido se busca la menor cantidad de camiones que alcanza (bomba: sin cortes de más de {REGLAS_REPARTO.bomba.corteMax} min y no más de {REGLAS_REPARTO.bomba.demoraMax} min tarde; directo: {REGLAS_REPARTO.directo.corteMax} y {REGLAS_REPARTO.directo.demoraMax}). Los pedidos se arman en orden de hora, primero con los camiones que ya están en esa planta: cada traslado gasta. Si a una bomba no le alcanzan, se le saca un camión a un directo que se superpone. Un camión sin viajes no se mueve. A la noche cada camión queda donde termina, salvo que mañana a una planta le falten para arrancar.
          </p>
        )}
        <p className="text-xs text-muted-foreground">{estadoTxt}{edita && rep.efectivo ? " Guardar cambia el reparto de las dos plantas." : ""}</p>
        {!rep.disponible && <p className="text-xs text-amber-700">Para guardar el reparto falta aplicar la migración de la base. Mientras, es solo la sugerencia y la programación sigue como siempre.</p>}

        {/* Resumen */}
        <div className="text-sm space-y-0.5">
          {franjas.map((f, i) => (
            <div key={i}>
              <p>{negritaPrimera(textoFranja(f, i, franjas.length, rep.nombres, rep.patentes))}</p>
              {res.traslados.filter((t) => f.hasta != null && Math.round(t.sale) === Math.round(f.hasta)).map((t, k) => (
                <p key={k} className="flex items-center gap-1"><ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" />{negritaPrimera(textoTraslado(t, rep.nombres, rep.patentes))}</p>
              ))}
            </div>
          ))}
          {res.arranquesMovidos.map((id) => <p key={id} className="text-xs">{rep.patentes[id]} arranca en {rep.nombres[vigente[id]?.tramos[0]?.plantId || ""]} (durmió en {rep.nombres[rep.amanece[id] || ""]}): un traslado a primera hora</p>)}
          <p><strong>{textoTraslados(conteo.dia, conteo.noche, rep.traslado)}</strong></p>
          <p className="flex items-center gap-1"><Moon className="h-3.5 w-3.5 text-muted-foreground" />{textoNoche(duerme, rep.plantas)}</p>
          {comparacion && <p className="text-xs text-violet-700">{comparacion}</p>}
        </div>

        {/* Por pedido, el porqué */}
        {res.pedidos.length > 0 && (
          <div className="space-y-1">
            {res.pedidos.map((p) => (
              <p key={p.id} className={cn("text-xs rounded px-2 py-1", p.estado === "verde" ? "bg-emerald-50 text-emerald-800" : p.estado === "ambar" ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-800")}>
                <span className="text-muted-foreground">{rep.nombres[p.plantId]} · </span>{p.texto}
              </p>
            ))}
          </div>
        )}
        {res.pedidos.length === 0 && <p className="text-xs text-muted-foreground">No hay pedidos pendientes ese día en ninguna planta.</p>}

        {/* Avisos */}
        {rep.avisos.length > 0 && (
          <div className="space-y-0.5">
            {rep.avisos.map((a, i) => (
              <p key={i} className={cn("text-xs flex items-start gap-1", a.nivel === "rojo" ? "text-red-700" : a.nivel === "ambar" ? "text-amber-700" : "text-muted-foreground")}>
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />{a.texto}
              </p>
            ))}
          </div>
        )}

        {/* Una fila por camión: la barra del día y, para editar, sus cambios */}
        <div className="overflow-x-auto">
          <div className="min-w-[640px] space-y-1">
            <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-2 text-[11px] text-muted-foreground">
              <span />
              <div className="relative h-4">{Array.from({ length: (t1 - t0) / 120 + 1 }, (_, i) => t0 + i * 120).map((t) => <span key={t} className="absolute -translate-x-1/2" style={{ left: pos(t) }}>{aHora(t)}</span>)}</div>
            </div>
            {rep.delDia.map((m) => {
              const r = vigente[m.id]
              const sale = r?.sale !== false
              const ts = res.tramos[m.id] || []
              const tras = res.traslados.filter((t) => t.camionId === m.id)
              const vs = res.viajes.filter((v) => v.camionId === m.id)
              return (
                <div key={m.id} className="space-y-1">
                  <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-2 items-center">
                    <span className={cn("text-xs font-medium", !sale && "line-through text-muted-foreground")}>{m.license_plate}</span>
                    <div className="relative h-5 rounded bg-muted/60">
                      {sale && ts.map((t, i) => {
                        const a = t.desde ?? t0
                        const b = ts[i + 1]?.desde != null ? ts[i + 1].desde! - rep.traslado.minutos : t1
                        return <div key={i} className={cn("absolute top-0.5 h-4 rounded-sm opacity-40", color(t.plantId))} style={{ left: pos(a), width: anc(a, b) }} title={`${rep.nombres[t.plantId]}${t.desde != null ? ` desde ${aHora(Math.round(t.desde))}` : ""}`} />
                      })}
                      {sale && tras.map((t, i) => <div key={`t${i}`} className="absolute top-0.5 h-4 bg-slate-400" style={{ left: pos(t.sale), width: anc(t.sale, t.llega) }} title={textoTraslado(t, rep.nombres, rep.patentes)} />)}
                      {sale && vs.map((v, i) => <div key={`v${i}`} className={cn("absolute top-1.5 h-2 rounded-sm", color(v.plantId))} style={{ left: pos(v.inicioCarga), width: anc(v.inicioCarga, v.vuelta) }} title={`${rep.nombres[v.plantId]} · carga ${aHora(Math.round(v.inicioCarga))}, vuelve ${aHora(Math.round(v.vuelta))}`} />)}
                      {!sale && <span className="absolute inset-0 flex items-center px-2 text-[11px] text-muted-foreground">No sale hoy</span>}
                    </div>
                  </div>
                  {verEditor && edita && r && (
                    <div className="ml-[92px] flex items-center gap-2 flex-wrap text-xs">
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
                  )}
                </div>
              )
            })}
            <div className="flex gap-3 text-[11px] text-muted-foreground flex-wrap pt-1">
              {rep.plantas.map((p) => <span key={p.id} className="flex items-center gap-1"><span className={cn("h-2.5 w-2.5 rounded-sm", color(p.id))} />{p.nombre}</span>)}
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-slate-400" />Traslado</span>
              <span>· barra clara: en esa planta · barra fuerte: viaje</span>
            </div>
          </div>
        </div>

        {rep.noche && <p className="text-[11px] text-muted-foreground">{rep.noche.textos.join(" · ")}</p>}
      </CardContent>
    </Card>
  )
}
