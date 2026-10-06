"use client"

/**
 * Gerenciador de viajes de un pedido (fase 2, como el "Gerenciador de Tickets" de Loop).
 *
 * Gantt con una fila por viaje (carga gris, ida celeste, descarga amarilla con los m³, vuelta verde).
 * Los despachados se ven sólidos y no se mueven. Los pendientes se pueden correr ±5 min, ajustar a la
 * hora actual, agregar o quitar, cambiar m³ y camión sugerido. Nada se graba hasta "Guardar", que pasa
 * por guardar_viajes_pedido (todo o nada) y queda en Actividad. Los viajes no tocan stock.
 * Solo se muestra a los usuarios con el interruptor de funciones nuevas.
 */
import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { NuevoBadge } from "@/components/nuevo-badge"
import { logActivity } from "@/lib/activity-log"
import { currentUserName } from "@/lib/current-user"
import { parametrosDePlanta, PARAMETROS_BASE, type Parametros } from "@/lib/planificador"
import { cargarEmpresasBombeo, textoBomba, type EmpresaBombeo } from "@/lib/maestros"
import {
  generarViajes, correrPendientes, ajustarAHora, agregarViaje, quitarViaje, cambiarM3, m3Faltantes, m3Entregados, ordenarPorN,
  guardarViajes, totalViajes, choquesDeCamion, camionesLibresPara, claveViaje, explicarFlota, textoChoque, type PedidoParaViajes, type ViajeRow,
} from "@/lib/viajes"
import { AlertTriangle, CheckCircle2, Clock, Loader2, Minus, Plus, Trash2 } from "lucide-react"
import { format } from "date-fns"
import { cn } from "@/lib/utils"

export type PedidoGerenciador = PedidoParaViajes & {
  finalidad?: string | null
  bomba_la_pone?: "rebucret" | "cliente" | null
  bomba_empresa_id?: string | null
  bomba_hora?: string | null
  clients?: { name?: string | null } | null
  formulas?: { code?: string | null } | null
}
type Mixer = { id: string; license_plate: string }

const hh = (iso: string) => format(new Date(iso), "HH:mm")
const MIN = 60_000

export function GerenciadorViajes({ pedido, open, onOpenChange, onGuardado, onEditarPedido }: {
  pedido: PedidoGerenciador | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onGuardado?: () => void
  /** Fase 2b: desde la grilla de Semana se abre el gerenciador; desde acá se puede ir al pedido */
  onEditarPedido?: () => void
}) {
  const { toast } = useToast()
  const [cargando, setCargando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [prm, setPrm] = useState<Parametros>(PARAMETROS_BASE)
  const [mixers, setMixers] = useState<Mixer[]>([])
  const [empresas, setEmpresas] = useState<EmpresaBombeo[]>([])
  const [original, setOriginal] = useState<ViajeRow[]>([])
  const [viajes, setViajes] = useState<ViajeRow[]>([])
  const [sinGuardar, setSinGuardar] = useState(false) // propuesta nueva (el pedido todavía no tenía viajes)
  // m³ tal como se tipean (se puede borrar y volver a escribir); vacío o 0 = error en línea y no se guarda
  const [m3Texto, setM3Texto] = useState<Record<number, string>>({})
  // Fase 2b (D): viajes de otros pedidos del mismo día (cualquier planta: los camiones son compartidos)
  const [otros, setOtros] = useState<(ViajeRow & { obra?: string })[]>([])

  useEffect(() => {
    if (!open || !pedido) return
    let vivo = true
    ;(async () => {
      setCargando(true)
      const sb = createClient()
      const ini = new Date(pedido.scheduled_arrival_time); ini.setHours(0, 0, 0, 0)
      const fin = new Date(ini.getTime() + 24 * 60 * MIN)
      const [{ data: pl }, { data: ms }, { data: vs, error }, emps, { data: ot }] = await Promise.all([
        sb.from("plants").select("*").eq("id", pedido.plant_id).maybeSingle(),
        sb.from("mixers").select("id, license_plate").eq("active", true).order("license_plate"),
        sb.from("viajes").select("*").eq("pedido_id", pedido.id).order("n"),
        cargarEmpresasBombeo(sb),
        sb.from("viajes").select("*, scheduled_dispatches(construction_sites(name))").neq("pedido_id", pedido.id).neq("estado", "cancelado")
          .gte("hora_carga", new Date(ini.getTime() - 6 * 60 * MIN).toISOString()).lt("hora_carga", fin.toISOString()),
      ])
      if (!vivo) return
      const p = parametrosDePlanta(pl as any)
      const existentes = error ? [] : ((vs as ViajeRow[]) || []).map((v) => ({ ...v, m3: Number(v.m3) }))
      setPrm(p)
      setMixers((ms as any) || [])
      setOtros(((ot as any[]) || []).map((v) => ({ ...v, m3: Number(v.m3), obra: v.scheduled_dispatches?.construction_sites?.name || "otra obra" })))
      setEmpresas(emps)
      setOriginal(existentes)
      setM3Texto({})
      if (existentes.length === 0 && pedido.status !== "completed" && pedido.status !== "cancelled") {
        setViajes(generarViajes(pedido, p, []))
        setSinGuardar(true)
      } else {
        setViajes(existentes)
        setSinGuardar(false)
      }
      setCargando(false)
    })()
    return () => { vivo = false }
  }, [open, pedido])

  const ordenados = useMemo(() => ordenarPorN(viajes.filter((v) => v.estado !== "cancelado")), [viajes])
  const total = totalViajes(viajes)
  // Entregado = m³ reales de los camiones despachados (o lo despachado del pedido, si es más)
  const enviadoPedido = pedido ? m3Entregados(pedido, viajes) : 0
  const m3Invalidos = Object.entries(m3Texto).filter(([n, t]) => viajes.some((v) => v.n === Number(n) && v.estado === "planificado") && !(Number(t.replace(",", ".")) > 0)).map(([n]) => Number(n))
  const faltan = pedido ? m3Faltantes(viajes, pedido) : 0
  // Pedido completo o cancelado: solo se miran los viajes (no se guarda nada)
  const soloLectura = pedido?.status === "completed" || pedido?.status === "cancelled"
  const hayPendientes = viajes.some((v) => v.estado === "planificado")
  const cambiado = sinGuardar || JSON.stringify(ordenarPorN(original)) !== JSON.stringify(ordenarPorN(viajes))
  // Fase 2b (D): un camión no puede estar en dos viajes que se pisan (en este pedido o en otro)
  const todosDelDia = useMemo(() => [...viajes.filter((v) => v.estado !== "cancelado"), ...otros], [viajes, otros])
  const choques = useMemo(() => choquesDeCamion(todosDelDia), [todosDelDia])
  const obraDe = (v: ViajeRow) => (v.pedido_id === pedido?.id ? `${pedido?.construction_sites?.name || "esta obra"} (viaje ${v.n})` : (v as any).obra || "otra obra")
  const choquesPendientes = viajes.filter((v) => v.estado === "planificado" && choques.has(claveViaje(v)))
  const flota = pedido ? explicarFlota(pedido, prm, total) : null

  // Escala horaria del Gantt
  const t0 = ordenados.length ? Math.floor(Math.min(...ordenados.map((v) => new Date(v.hora_carga).getTime())) / (60 * MIN)) * 60 * MIN : 0
  const t1 = ordenados.length ? Math.ceil(Math.max(...ordenados.map((v) => new Date(v.hora_vuelta).getTime())) / (60 * MIN)) * 60 * MIN : 1
  const pos = (iso: string) => `${((new Date(iso).getTime() - t0) / (t1 - t0)) * 100}%`
  const anc = (a: string, b: string) => `${Math.max(0.4, ((new Date(b).getTime() - new Date(a).getTime()) / (t1 - t0)) * 100)}%`
  const horasEje = Array.from({ length: Math.round((t1 - t0) / (60 * MIN)) + 1 }, (_, i) => t0 + i * 60 * MIN)

  const patente = (id: string | null | undefined) => (id ? mixers.find((m) => m.id === id)?.license_plate || "—" : "—")

  async function guardar() {
    if (!pedido) return
    setGuardando(true)
    const sb = createClient()
    const { error } = await guardarViajes(sb, pedido.id, viajes, currentUserName(), "gerenciador")
    setGuardando(false)
    if (error) {
      toast({ title: "No se guardaron los viajes", description: error, variant: "destructive" })
      return
    }
    // Actividad: quién movió qué (solo lo que cambió)
    const antes = ordenarPorN(original.filter((v) => v.estado === "planificado"))
    const despues = ordenarPorN(viajes.filter((v) => v.estado === "planificado"))
    const detalle: Record<string, string> = { Origen: "Gerenciador de viajes" }
    if (antes.length !== despues.length || sinGuardar) detalle["Viajes pendientes"] = `${sinGuardar ? 0 : antes.length} → ${despues.length}`
    let k = 0
    for (const v of despues) {
      const a = antes.find((x) => x.n === v.n)
      const cambios: string[] = []
      if (!a) cambios.push(`nuevo · carga ${hh(v.hora_carga)} · ${v.m3} m³`)
      else {
        if (a.hora_carga !== v.hora_carga) cambios.push(`carga ${hh(a.hora_carga)} → ${hh(v.hora_carga)}`)
        if (Number(a.m3) !== Number(v.m3)) cambios.push(`${a.m3} → ${v.m3} m³`)
        if ((a.mixer_id || null) !== (v.mixer_id || null)) cambios.push(`camión ${patente(a.mixer_id)} → ${patente(v.mixer_id)}`)
      }
      if (cambios.length && k++ < 12) detalle[`Viaje ${v.n}`] = cambios.join(" · ")
    }
    for (const a of antes) if (!despues.some((v) => v.n === a.n) && k++ < 12) detalle[`Viaje ${a.n}`] = "quitado"
    await logActivity({ action: "editar", entity: "pedido", entityId: pedido.id, reference: pedido.construction_sites?.name || null, plantId: pedido.plant_id, details: detalle })
    toast({ title: "Viajes guardados", description: `${pedido.construction_sites?.name || "Pedido"}: ${totalViajes(viajes)} viajes` })
    onGuardado?.()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">Viajes del pedido <NuevoBadge /></DialogTitle>
          {pedido && (
            <DialogDescription asChild>
              <div className="text-sm space-y-1">
                <p className="text-foreground font-medium">{pedido.clients?.name} · {pedido.construction_sites?.name}</p>
                <p className="flex flex-wrap gap-x-3 gap-y-1">
                  <span>{pedido.formulas?.code}</span>
                  {pedido.finalidad && <span>· {pedido.finalidad}</span>}
                  <span>· {pedido.metodo_descarga === "bomba" ? textoBomba(pedido, empresas, "Bomba") : "Directo"}</span>
                  <span>· llegada pedida {hh(pedido.scheduled_arrival_time)}</span>
                  <span className="font-medium text-foreground">· entregado {enviadoPedido.toLocaleString("es-AR")} / {Number(pedido.quantity_m3).toLocaleString("es-AR")} m³</span>
                </p>
                {flota && total > 0 && <p className="text-xs">{flota.texto}{Number(pedido.descarga_min) > 0 ? " (descarga corregida en el pedido)" : ""}</p>}
              </div>
            </DialogDescription>
          )}
        </DialogHeader>

        {cargando || !pedido ? (
          <div className="py-12 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />Cargando viajes...</div>
        ) : (
          <div className="space-y-3">
            {soloLectura && (
              <p className="text-xs rounded-md border bg-muted/50 px-3 py-2">El pedido está {pedido.status === "cancelled" ? "cancelado" : "completo"}: los viajes se pueden ver pero no cambiar.</p>
            )}
            {sinGuardar && !soloLectura && (
              <p className="text-xs rounded-md border border-amber-300 bg-amber-50 text-amber-800 px-3 py-2">
                Este pedido todavía no tiene viajes guardados. Esta es la propuesta con los tiempos de la planta: revisala y tocá Guardar.
              </p>
            )}
            {!soloLectura && (
            /* Acciones */
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" className="gap-1" disabled={!hayPendientes} onClick={() => setViajes((vs) => correrPendientes(vs, -5))}><Minus className="h-3.5 w-3.5" />5 min</Button>
              <Button size="sm" variant="outline" className="gap-1" disabled={!hayPendientes} onClick={() => setViajes((vs) => correrPendientes(vs, 5))}><Plus className="h-3.5 w-3.5" />5 min</Button>
              <Button size="sm" variant="outline" className="gap-1" disabled={!hayPendientes} onClick={() => setViajes((vs) => ajustarAHora(vs, new Date()))} title="El próximo viaje pendiente carga ahora y los demás se corren lo mismo">
                <Clock className="h-3.5 w-3.5" />Ajustar a la hora actual
              </Button>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setViajes((vs) => agregarViaje(vs, pedido, prm))}>
                <Plus className="h-3.5 w-3.5" />{faltan > 0.01 ? `Agregar viaje faltante (${faltan} m³)` : "Agregar viaje"}
              </Button>
              {faltan < -0.01 && <span className="text-xs text-amber-700">Sobran {Math.abs(faltan)} m³ planificados: quitá un viaje o bajá los m³.</span>}
              {faltan > 0.01 && <span className="text-xs text-amber-700">Faltan {faltan} m³ por planificar.</span>}
            </div>
            )}

            {/* Gantt */}
            {ordenados.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No quedan viajes por planificar.</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[760px]">
                  <div className="grid grid-cols-[64px_minmax(0,1fr)_84px_140px_32px] gap-2 text-[11px] text-muted-foreground mb-1 items-end">
                    <span>Viaje</span>
                    <div className="relative h-4">
                      {horasEje.map((t) => <span key={t} className="absolute -translate-x-1/2" style={{ left: `${((t - t0) / (t1 - t0)) * 100}%` }}>{format(new Date(t), "HH:mm")}</span>)}
                    </div>
                    <span>m³</span>
                    <span>Camión sugerido</span>
                    <span />
                  </div>
                  {ordenados.map((v) => {
                    const fijo = soloLectura || v.estado !== "planificado"
                    const tip = `Viaje ${v.n}/${total} · ${v.m3} m³ — carga ${hh(v.hora_carga)}, sale ${hh(v.hora_salida)}, llega ${hh(v.hora_llegada)}, termina ${hh(v.hora_fin_descarga)}, vuelve ${hh(v.hora_vuelta)}`
                    const choque = !fijo ? choques.get(claveViaje(v)) : undefined
                    const libres = choque ? camionesLibresPara(v, todosDelDia, mixers).slice(0, 4) : []
                    return (
                      <div key={`${v.n}-${v.estado}`}>
                      <div className="grid grid-cols-[64px_minmax(0,1fr)_84px_140px_32px] gap-2 items-center h-9">
                        <span className="text-xs font-medium flex items-center gap-1">
                          {fijo && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}{v.n}/{total}
                        </span>
                        <div className="relative h-6 rounded bg-muted/60" title={tip}>
                          <div className={cn("absolute top-1 h-4 rounded-l-sm bg-slate-400", !fijo && "opacity-60")} style={{ left: pos(v.hora_carga), width: anc(v.hora_carga, v.hora_salida) }} />
                          <div className={cn("absolute top-1 h-4 bg-sky-300", !fijo && "opacity-60")} style={{ left: pos(v.hora_salida), width: anc(v.hora_salida, v.hora_llegada) }} />
                          <div className={cn("absolute top-1 h-4 bg-amber-400 text-[10px] font-semibold text-amber-950 flex items-center justify-center overflow-hidden", !fijo && "opacity-70")} style={{ left: pos(v.hora_llegada), width: anc(v.hora_llegada, v.hora_fin_descarga) }}>{v.m3}</div>
                          <div className={cn("absolute top-1 h-4 rounded-r-sm bg-emerald-400", !fijo && "opacity-60")} style={{ left: pos(v.hora_fin_descarga), width: anc(v.hora_fin_descarga, v.hora_vuelta) }} />
                          {!fijo && <div className="absolute top-0.5 h-5 rounded-sm border border-dashed border-slate-500/60" style={{ left: pos(v.hora_carga), width: anc(v.hora_carga, v.hora_vuelta) }} />}
                        </div>
                        {fijo ? (
                          <span className="text-sm">{v.m3}</span>
                        ) : (
                          <div>
                            <Input
                              type="text" inputMode="decimal"
                              value={m3Texto[v.n] ?? String(v.m3)}
                              onChange={(e) => {
                                const t = e.target.value
                                setM3Texto((m) => ({ ...m, [v.n]: t }))
                                const x = Number(t.replace(",", "."))
                                if (x > 0) setViajes((vs) => cambiarM3(vs, v.n, x, pedido, prm))
                              }}
                              className={cn("h-8 w-20", m3Invalidos.includes(v.n) && "border-red-500 focus-visible:ring-red-500")}
                            />
                            {m3Invalidos.includes(v.n) && <p className="text-[10px] text-red-600 leading-tight">Poné los m³</p>}
                          </div>
                        )}
                        {fijo ? (
                          <span className="text-xs text-muted-foreground">{patente(v.mixer_id)} · {v.estado === "despachado" ? "despachado" : v.estado === "cancelado" ? "cancelado" : "pendiente"}</span>
                        ) : (
                          <Select value={v.mixer_id || "none"} onValueChange={(m) => setViajes((vs) => vs.map((x) => (x.n === v.n && x.estado === "planificado" ? { ...x, mixer_id: m === "none" ? null : m } : x)))}>
                            <SelectTrigger className={cn("h-8 text-xs", choque && "border-red-500 text-red-700")}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Sin asignar</SelectItem>
                              {/* Un camión que en ese momento está en otro viaje no se puede elegir */}
                              {(() => { const libresIds = new Set(camionesLibresPara(v, todosDelDia, mixers).map((m) => m.id)); return mixers.map((m) => (
                                <SelectItem key={m.id} value={m.id} disabled={!libresIds.has(m.id) && m.id !== v.mixer_id}>
                                  {m.license_plate}{!libresIds.has(m.id) ? " (ocupado)" : ""}
                                </SelectItem>
                              )) })()}
                            </SelectContent>
                          </Select>
                        )}
                        {fijo ? <span /> : (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" title="Quitar este viaje" onClick={() => { setViajes((vs) => quitarViaje(vs, v.n)); setM3Texto({}) }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                      {choque && (
                        <div className="ml-[72px] mb-1 flex items-center gap-2 flex-wrap text-xs text-red-700">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {textoChoque(choque, patente(v.mixer_id), obraDe(choque.otro))}
                          {libres.length > 0 ? (
                            <>
                              <span className="text-muted-foreground">· libres:</span>
                              {libres.map((m) => (
                                <Button key={m.id} size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => setViajes((vs) => vs.map((x) => (x.n === v.n && x.estado === "planificado" ? { ...x, mixer_id: m.id } : x)))}>{m.license_plate}</Button>
                              ))}
                            </>
                          ) : <span className="text-muted-foreground">· no hay camiones libres a esa hora: corré el viaje o dejalo sin camión</span>}
                        </div>
                      )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-slate-400" />Carga</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-sky-300" />Ida</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400" />Descarga (m³)</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" />Vuelta</span>
              <span>· Sólido: despachado (no se mueve) · Claro: pendiente</span>
              <Badge variant="outline" className="text-[10px] py-0">Los viajes no tocan stock</Badge>
            </div>
          </div>
        )}

        <DialogFooter>
          {onEditarPedido && <Button variant="ghost" className="mr-auto" onClick={() => { onOpenChange(false); onEditarPedido() }}>Editar pedido</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
          {choquesPendientes.length > 0 && <span className="text-xs text-red-600 self-center">Hay camiones en dos viajes a la vez: cambialos para guardar.</span>}
          {m3Invalidos.length > 0 && <span className="text-xs text-red-600 self-center">Completá los m³ de cada viaje para guardar.</span>}
          {!soloLectura && <Button onClick={guardar} disabled={guardando || cargando || !cambiado || m3Invalidos.length > 0 || choquesPendientes.length > 0}>{guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
