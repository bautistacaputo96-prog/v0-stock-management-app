"use client"

/**
 * Plan de mantenimiento preventivo.
 *
 * Cada tarea vence por calendario (días desde la última vez que se hizo) y,
 * las de service mayor, también por m³ dosificados desde entonces. Se avisa
 * por lo que ocurra primero: si la planta produce más de lo previsto, el
 * service por m³ se adelanta solo.
 */

import { useState, useEffect, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { currentUserName } from "@/lib/current-user"
import { CheckCircle2, AlertTriangle, Clock, Wrench, Package, ChevronDown, ChevronUp, History, ListChecks, Image as ImageIcon } from "lucide-react"
import { format, differenceInCalendarDays, parseISO } from "date-fns"
import { es } from "date-fns/locale"
import { cn } from "@/lib/utils"

type Equipo = { id: string; nombre: string; modelo: string | null; fabricante: string | null; plant_id: string; plants?: { name: string } }
type Item = { id: string; item: string; cantidad: number | null; unidad: string | null; tipo: string; codigo_repuesto: string | null }
type Foto = { id: string; url: string; epigrafe: string | null }
type Paso = { id: string; texto: string; orden: number }
type Tarea = {
  id: string; codigo: string | null; titulo: string; detalle: string | null; componente: string | null
  frecuencia_dias: number | null; frecuencia_m3: number | null; referencia_manual: string | null
  maint_task_items: Item[]
  maint_task_images: Foto[]
  maint_task_steps: Paso[]
  ultima?: { fecha: string; realizado_por: string | null; m3_acumulado: number | null } | null
}

/** Nombre legible de la frecuencia, para agrupar el plan. */
function etiquetaFrecuencia(dias: number | null): string {
  if (!dias) return "Sin frecuencia"
  if (dias <= 1) return "Diario"
  if (dias <= 7) return "Semanal"
  if (dias <= 15) return "Quincenal"
  if (dias <= 31) return "Mensual"
  if (dias <= 62) return "Bimestral"
  if (dias <= 93) return "Trimestral"
  if (dias <= 186) return "Semestral"
  if (dias <= 366) return "Anual — parada"
  if (dias <= 550) return "Cada 1 año y medio"
  if (dias <= 731) return "Cada 2 años"
  if (dias <= 1300) return "Cada 3 años y medio"
  return "Cada 7 años"
}

const ORDEN_FREQ = [
  "Diario", "Semanal", "Quincenal", "Mensual", "Bimestral", "Trimestral",
  "Semestral", "Anual — parada", "Cada 1 año y medio", "Cada 2 años",
  "Cada 3 años y medio", "Cada 7 años", "Sin frecuencia",
]

export function MantenimientoContent({ equipos }: { equipos: Equipo[] }) {
  const [equipoId, setEquipoId] = useState(equipos[0]?.id || "")
  const [tareas, setTareas] = useState<Tarea[]>([])
  const [m3Actual, setM3Actual] = useState(0)
  const [loading, setLoading] = useState(true)
  const [expandida, setExpandida] = useState<string | null>(null)
  const [registrar, setRegistrar] = useState<Tarea | null>(null)
  const [obs, setObs] = useState("")
  const [pasosMarcados, setPasosMarcados] = useState<Record<string, boolean>>({})
  const [fotoAmpliada, setFotoAmpliada] = useState<string | null>(null)
  const [fecha, setFecha] = useState(format(new Date(), "yyyy-MM-dd"))
  const [guardando, setGuardando] = useState(false)
  const { toast } = useToast()

  const equipo = equipos.find((e) => e.id === equipoId)

  useEffect(() => {
    if (equipoId) cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipoId])

  async function cargar() {
    setLoading(true)
    const supabase = createClient()
    const eq = equipos.find((e) => e.id === equipoId)

    const [{ data: ts }, { data: ejec }, { data: desp }] = await Promise.all([
      supabase
        .from("maint_tasks")
        .select("*, maint_task_items(*), maint_task_images(*), maint_task_steps(*)")
        .eq("equipment_id", equipoId)
        .eq("activo", true)
        .order("frecuencia_dias")
        .order("orden"),
      supabase
        .from("maint_executions")
        .select("task_id, fecha, realizado_por, m3_acumulado")
        .order("fecha", { ascending: false }),
      // m³ acumulados de la planta: sirven para los services por producción
      eq
        ? supabase.from("dispatches").select("quantity_m3").eq("plant_id", eq.plant_id).limit(20000)
        : Promise.resolve({ data: [] as { quantity_m3: number }[] }),
    ])

    const ultimaPorTarea: Record<string, { fecha: string; realizado_por: string | null; m3_acumulado: number | null }> = {}
    ;(ejec || []).forEach((e: any) => {
      if (!ultimaPorTarea[e.task_id]) ultimaPorTarea[e.task_id] = e
    })

    setM3Actual((desp || []).reduce((s: number, d: any) => s + Number(d.quantity_m3 || 0), 0))
    setTareas((ts || []).map((t: any) => ({ ...t, ultima: ultimaPorTarea[t.id] || null })))
    setLoading(false)
  }

  /** Estado de una tarea: cuánto falta (o hace cuánto venció). */
  function estado(t: Tarea) {
    if (!t.ultima) return { texto: "Sin registro", nivel: "pendiente" as const, detalle: "Nunca se registró" }

    const diasDesde = differenceInCalendarDays(new Date(), parseISO(t.ultima.fecha))
    const restanDias = t.frecuencia_dias ? t.frecuencia_dias - diasDesde : null

    // Si además vence por m³, gana el que esté más cerca
    let restanM3: number | null = null
    if (t.frecuencia_m3 && t.ultima.m3_acumulado != null) {
      restanM3 = t.frecuencia_m3 - (m3Actual - Number(t.ultima.m3_acumulado))
    }

    const vencidoDias = restanDias !== null && restanDias < 0
    const vencidoM3 = restanM3 !== null && restanM3 < 0
    if (vencidoDias || vencidoM3) {
      return {
        texto: vencidoM3 && restanM3 !== null && (restanDias === null || restanM3 < restanDias)
          ? `Vencida por ${Math.abs(Math.round(restanM3))} m³`
          : `Vencida hace ${Math.abs(restanDias || 0)} días`,
        nivel: "vencida" as const,
        detalle: `Última: ${format(parseISO(t.ultima.fecha), "dd/MM/yyyy")}`,
      }
    }

    const proximoPorDias = restanDias !== null && restanDias <= Math.max(1, (t.frecuencia_dias || 30) * 0.15)
    const proximoPorM3 = restanM3 !== null && restanM3 <= (t.frecuencia_m3 || 0) * 0.15
    if (proximoPorDias || proximoPorM3) {
      return {
        texto: restanM3 !== null && proximoPorM3 ? `Faltan ${Math.round(restanM3)} m³` : `Faltan ${restanDias} días`,
        nivel: "proxima" as const,
        detalle: `Última: ${format(parseISO(t.ultima.fecha), "dd/MM/yyyy")}`,
      }
    }

    return {
      texto: restanDias !== null ? `En ${restanDias} días` : "Al día",
      nivel: "ok" as const,
      detalle: `Última: ${format(parseISO(t.ultima.fecha), "dd/MM/yyyy")}${t.ultima.realizado_por ? ` · ${t.ultima.realizado_por}` : ""}`,
    }
  }

  const grupos = useMemo(() => {
    const g: Record<string, Tarea[]> = {}
    tareas.forEach((t) => {
      const k = etiquetaFrecuencia(t.frecuencia_dias)
      ;(g[k] = g[k] || []).push(t)
    })
    return ORDEN_FREQ.filter((k) => g[k]?.length).map((k) => ({ titulo: k, tareas: g[k] }))
  }, [tareas])

  const resumen = useMemo(() => {
    let vencidas = 0, proximas = 0
    tareas.forEach((t) => {
      const e = estado(t)
      if (e.nivel === "vencida" || e.nivel === "pendiente") vencidas++
      else if (e.nivel === "proxima") proximas++
    })
    return { vencidas, proximas, total: tareas.length }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tareas, m3Actual])

  async function guardarEjecucion() {
    if (!registrar) return
    setGuardando(true)
    const supabase = createClient()
    const { error } = await supabase.from("maint_executions").insert({
      task_id: registrar.id,
      fecha,
      realizado_por: currentUserName(),
      observaciones: obs || null,
      m3_acumulado: m3Actual,
      pasos: Object.keys(pasosMarcados).length ? pasosMarcados : null,
    })
    if (error) {
      toast({ title: "Error", description: "No se pudo registrar", variant: "destructive" })
    } else {
      toast({ title: "Registrado", description: registrar.titulo })
      setRegistrar(null)
      setObs("")
      setPasosMarcados({})
      cargar()
    }
    setGuardando(false)
  }

  if (!equipos.length) {
    return <p className="text-sm text-muted-foreground">No hay equipos cargados.</p>
  }

  return (
    <div className="space-y-4">
      {/* Encabezado del equipo */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Wrench className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-semibold">{equipo?.nombre}</p>
              <p className="text-xs text-muted-foreground">
                {equipo?.fabricante} · {equipo?.plants?.name}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-5 text-sm">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">m³ acumulados</p>
              <p className="font-bold">{m3Actual.toLocaleString("es-AR", { maximumFractionDigits: 0 })}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Vencidas</p>
              <p className={cn("font-bold", resumen.vencidas > 0 ? "text-red-600" : "text-emerald-600")}>{resumen.vencidas}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Próximas</p>
              <p className={cn("font-bold", resumen.proximas > 0 && "text-amber-600")}>{resumen.proximas}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Cargando plan...</p>
      ) : (
        grupos.map((g) => (
          <div key={g.titulo} className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide pt-2">
              {g.titulo}
            </h2>
            {g.tareas.map((t) => {
              const e = estado(t)
              const abierta = expandida === t.id
              return (
                <Card
                  key={t.id}
                  className={cn(
                    "transition-colors",
                    e.nivel === "vencida" && "border-red-300 bg-red-50/40",
                    e.nivel === "pendiente" && "border-slate-300",
                    e.nivel === "proxima" && "border-amber-300 bg-amber-50/40",
                  )}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-3">
                      <button
                        className="flex-1 text-left min-w-0"
                        onClick={() => setExpandida(abierta ? null : t.id)}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{t.titulo}</span>
                          {t.componente && (
                            <Badge variant="outline" className="text-[10px]">{t.componente}</Badge>
                          )}
                          {t.maint_task_items.length > 0 && (
                            <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-700 gap-1">
                              <Package className="h-3 w-3" />
                              {t.maint_task_items.length}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{e.detalle}</p>
                      </button>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge
                          variant={e.nivel === "ok" ? "outline" : "default"}
                          className={cn(
                            "text-[11px] whitespace-nowrap",
                            e.nivel === "vencida" && "bg-red-600",
                            e.nivel === "proxima" && "bg-amber-500",
                            e.nivel === "pendiente" && "bg-slate-500",
                            e.nivel === "ok" && "text-emerald-700 border-emerald-300",
                          )}
                        >
                          {e.nivel === "vencida" && <AlertTriangle className="h-3 w-3 mr-1" />}
                          {e.nivel === "ok" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                          {e.nivel === "proxima" && <Clock className="h-3 w-3 mr-1" />}
                          {e.texto}
                        </Badge>
                        <Button size="sm" variant="outline" onClick={() => { setRegistrar(t); setFecha(format(new Date(), "yyyy-MM-dd")) }}>
                          Registrar
                        </Button>
                        {abierta ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </div>
                    </div>

                    {abierta && (
                      <div className="mt-3 pt-3 border-t space-y-3 text-sm">
                        {t.detalle && <p className="text-muted-foreground">{t.detalle}</p>}
                        {t.maint_task_items.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                              <Package className="h-3 w-3" /> Insumos y repuestos necesarios
                            </p>
                            <div className="space-y-1">
                              {t.maint_task_items.map((i) => (
                                <div key={i.id} className="flex items-center justify-between text-xs bg-muted/50 rounded px-2 py-1.5">
                                  <span>
                                    {i.item}
                                    {i.codigo_repuesto && (
                                      <span className="text-muted-foreground ml-1.5">({i.codigo_repuesto})</span>
                                    )}
                                  </span>
                                  <span className="font-mono font-medium whitespace-nowrap ml-3">
                                    {i.cantidad} {i.unidad}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {t.maint_task_steps?.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                              <ListChecks className="h-3 w-3" /> Pasos
                            </p>
                            <ol className="space-y-1 list-decimal list-inside">
                              {[...t.maint_task_steps].sort((a,b)=>a.orden-b.orden).map((s) => (
                                <li key={s.id} className="text-xs text-muted-foreground">{s.texto}</li>
                              ))}
                            </ol>
                          </div>
                        )}

                        {t.maint_task_images?.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                              <ImageIcon className="h-3 w-3" /> Fotos del manual — tocá para ampliar
                            </p>
                            <div className="flex gap-2 flex-wrap">
                              {t.maint_task_images.map((f) => (
                                <button key={f.id} onClick={() => setFotoAmpliada(f.url)} className="shrink-0">
                                  <img
                                    src={f.url}
                                    alt={f.epigrafe || t.titulo}
                                    className="h-24 w-auto rounded border object-cover hover:opacity-80 transition-opacity"
                                  />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        <p className="text-[11px] text-muted-foreground">
                          {t.referencia_manual && <>Manual: {t.referencia_manual} · </>}
                          {t.frecuencia_m3 && <>También vence cada {t.frecuencia_m3.toLocaleString("es-AR")} m³</>}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        ))
      )}

      {/* Registrar ejecución */}
      <Dialog open={!!registrar} onOpenChange={(o) => !o && setRegistrar(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Registrar tarea realizada
            </DialogTitle>
            <DialogDescription>{registrar?.titulo}</DialogDescription>
          </DialogHeader>
          {registrar && (
            <div className="space-y-4 py-2">
              {registrar.maint_task_items.length > 0 && (
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs font-semibold text-muted-foreground mb-1.5">Insumos previstos</p>
                  {registrar.maint_task_items.map((i) => (
                    <p key={i.id} className="text-xs">
                      · {i.item} — <span className="font-mono">{i.cantidad} {i.unidad}</span>
                    </p>
                  ))}
                </div>
              )}
              {registrar.maint_task_steps?.length > 0 && (
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <ListChecks className="h-4 w-4" /> Checklist
                  </Label>
                  <div className="space-y-1.5 rounded-lg border p-3">
                    {[...registrar.maint_task_steps].sort((a,b)=>a.orden-b.orden).map((paso) => (
                      <label key={paso.id} className="flex items-start gap-2 cursor-pointer text-sm">
                        <Checkbox
                          checked={!!pasosMarcados[paso.id]}
                          onCheckedChange={(v) => setPasosMarcados((p) => ({ ...p, [paso.id]: !!v }))}
                          className="mt-0.5"
                        />
                        <span className={cn(pasosMarcados[paso.id] && "line-through text-muted-foreground")}>
                          {paso.texto}
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {Object.values(pasosMarcados).filter(Boolean).length} de {registrar.maint_task_steps.length} pasos marcados
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label>Fecha en que se hizo</Label>
                <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Observaciones (opcional)</Label>
                <Textarea
                  value={obs}
                  onChange={(e) => setObs(e.target.value)}
                  placeholder="Qué se encontró, qué se cambió..."
                  rows={3}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Se registra a nombre de <b>{currentUserName()}</b> con {m3Actual.toLocaleString("es-AR", { maximumFractionDigits: 0 })} m³ acumulados.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegistrar(null)}>Cancelar</Button>
            <Button onClick={guardarEjecucion} disabled={guardando}>
              {guardando ? "Guardando..." : "Registrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Foto ampliada */}
      <Dialog open={!!fotoAmpliada} onOpenChange={(o) => !o && setFotoAmpliada(null)}>
        <DialogContent className="max-w-3xl p-2">
          <DialogHeader className="sr-only">
            <DialogTitle>Foto del manual</DialogTitle>
          </DialogHeader>
          {fotoAmpliada && <img src={fotoAmpliada} alt="Detalle del manual" className="w-full h-auto rounded" />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
