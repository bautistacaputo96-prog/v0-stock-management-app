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
import { planificar, aMin, aHora, PARAMETROS_BASE, type Parametros, type Pedido as PedidoPlan } from "@/lib/planificador"
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Loader2, Settings2, Truck, MapPin } from "lucide-react"
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
  clients: { name: string } | null
  construction_sites: { id: string; name: string; travel_time_minutes: number | null; gps_lat: number | null; requires_pump: boolean | null } | null
  formulas: { code: string } | null
}
type Mixer = { id: string; license_plate: string; capacity_m3: number | null; active: boolean }

const COLORES = ["#D85A30", "#1D9E75", "#534AB7", "#BA7517", "#993556", "#185FA5", "#3B6D11", "#5F5E5A"]
const LS_CAMIONES = (planta: string) => `prog-dia-camiones-${planta}`
const LS_PARAMS = "prog-dia-parametros"

export function ProgramacionDia({ plants }: { plants: Plant[] }) {
  const { toast } = useToast()
  const [planta, setPlanta] = useState<string>(plants[0]?.id || "")
  const [dia, setDia] = useState<Date>(() => addDays(startOfDay(new Date()), 1)) // por defecto, mañana
  const [pedidos, setPedidos] = useState<PedidoDB[]>([])
  const [mixers, setMixers] = useState<Mixer[]>([])
  const [disponibles, setDisponibles] = useState<string[]>([])
  const [prm, setPrm] = useState<Parametros>(PARAMETROS_BASE)
  const [verSupuestos, setVerSupuestos] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [horas, setHoras] = useState<Record<string, string>>({}) // hora editada (sin guardar)
  const [guardando, setGuardando] = useState<string | null>(null)
  // En días pasados se puede simular el día entero, incluidos los pedidos ya despachados
  const [simular, setSimular] = useState(false)
  const esPasado = startOfDay(dia) < startOfDay(new Date())

  // Supuestos guardados en este navegador
  useEffect(() => {
    try { const p = localStorage.getItem(LS_PARAMS); if (p) setPrm({ ...PARAMETROS_BASE, ...JSON.parse(p) }) } catch {}
  }, [])
  useEffect(() => { try { localStorage.setItem(LS_PARAMS, JSON.stringify(prm)) } catch {} }, [prm])

  const cargar = useCallback(async () => {
    if (!planta) return
    setCargando(true)
    const sb = createClient()
    const ini = startOfDay(dia), fin = addDays(ini, 1)
    const [{ data: ps }, { data: ms }] = await Promise.all([
      sb.from("scheduled_dispatches")
        .select("id, plant_id, quantity_m3, dispatched_m3, scheduled_arrival_time, status, metodo_descarga, clients(name), construction_sites(id, name, travel_time_minutes, gps_lat, requires_pump), formulas(code)")
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
    let guardados: string[] | null = null
    try { const g = localStorage.getItem(LS_CAMIONES(planta)); if (g) guardados = JSON.parse(g) } catch {}
    const ids = ((ms as any) || []).map((m: Mixer) => m.id)
    setDisponibles(guardados ? guardados.filter((id) => ids.includes(id)) : ids)
    setCargando(false)
  }, [planta, dia])

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
        viajeMin: p.construction_sites?.travel_time_minutes || 30,
        conBomba: (p.metodo_descarga || (p.construction_sites?.requires_pump ? "bomba" : "directo")) === "bomba",
      }))
      .filter((p) => p.m3 > 0.01)
    const cams = mixers.filter((m) => disponibles.includes(m.id)).map((m) => ({ id: m.id, patente: m.license_plate, capacidad: Number(m.capacity_m3) || 8 }))
    if (!entradas.length || !cams.length) return null
    return planificar(entradas, cams, prm)
  }, [pedidos, mixers, disponibles, prm, horas, simular]) // eslint-disable-line react-hooks/exhaustive-deps

  const colorDe = (pedidoId: string) => COLORES[Math.max(0, pedidos.findIndex((p) => p.id === pedidoId)) % COLORES.length]

  async function guardarHora(p: PedidoDB) {
    const h = horas[p.id]
    if (!h) return
    setGuardando(p.id)
    const [hh, mm] = h.split(":").map(Number)
    const llegada = new Date(dia); llegada.setHours(hh, mm, 0, 0)
    const salida = new Date(llegada.getTime() - (p.construction_sites?.travel_time_minutes || 30) * 60000)
    const { error } = await createClient().from("scheduled_dispatches")
      .update({ scheduled_arrival_time: llegada.toISOString(), scheduled_departure_time: salida.toISOString() })
      .eq("id", p.id)
    setGuardando(null)
    if (error) { toast({ title: "No se pudo guardar la hora", variant: "destructive" }); return }
    logActivity({ action: "editar", entity: "pedido", entityId: p.id, reference: p.construction_sites?.name || null, plantId: p.plant_id, details: { "Hora de llegada": `${format(new Date(p.scheduled_arrival_time), "HH:mm")} → ${h}` } })
    toast({ title: "Hora actualizada", description: `${p.construction_sites?.name}: llegada ${h}` })
    cargar()
  }

  async function guardarMetodo(p: PedidoDB, metodo: "bomba" | "directo") {
    await createClient().from("scheduled_dispatches").update({ metodo_descarga: metodo }).eq("id", p.id)
    setPedidos((ps) => ps.map((x) => (x.id === p.id ? { ...x, metodo_descarga: metodo } : x)))
  }

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
              <p className="text-sm font-medium mb-2">Tiempos usados para calcular <span className="font-normal text-muted-foreground">(valores de referencia hasta medirlos con el GPS)</span></p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {([["cargaMin", "Carga en planta"], ["descargaBombaMin", "Descarga con bomba (8 m³)"], ["descargaDirectaMin", "Descarga directa (8 m³)"], ["lavadoMin", "Lavado y salida de obra"]] as const).map(([k, l]) => (
                  <label key={k} className="text-xs space-y-1">
                    <span className="text-muted-foreground">{l}</span>
                    <div className="flex items-center gap-1">
                      <Input type="number" min={1} value={prm[k]} onChange={(e) => setPrm({ ...prm, [k]: Math.max(1, Number(e.target.value) || 1) })} className="h-8 w-20" />
                      <span className="text-muted-foreground">min</span>
                    </div>
                  </label>
                ))}
              </div>
              <Button variant="link" size="sm" className="px-0 h-auto mt-2 text-xs" onClick={() => setPrm(PARAMETROS_BASE)}>Volver a los valores de referencia</Button>
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
                ["Uso de mixers", `${usoProm}%`],
              ].map(([l, v]) => (
                <div key={l} className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">{l}</p><p className="text-lg font-semibold">{v}</p></div>
              ))}
            </div>
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
                        </p>
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
                  Pasá el mouse sobre un bloque para ver los horarios. La planta carga un camión por vez ({plan.plantaOcupacion}% de la jornada ocupada cargando). El uso es el tiempo ocupado de cada camión sobre la jornada {prm.inicioJornada}–{prm.finJornada}.
                </p>
              </CardContent>
            </Card>
          )}

          {!plan && pedidos.some((p) => p.status !== "completed") && (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Elegí al menos un camión disponible en "Tiempos y camiones".</CardContent></Card>
          )}
        </>
      )}
    </div>
  )
}
