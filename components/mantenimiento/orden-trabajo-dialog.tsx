"use client"

/**
 * Una orden de trabajo abierta: lo que ve el operario mientras la hace.
 * Fotos del manual para ubicar el componente, qué va a necesitar, el
 * checklist que va tildando, fotos de evidencia, comentario y completar.
 */

import { useState, useEffect, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { currentUserName } from "@/lib/current-user"
import { Camera, Package, ListChecks, Image as ImageIcon, Play, CheckCircle2, History, X, Loader2, Wrench, AlertTriangle } from "lucide-react"
import { format, parseISO } from "date-fns"
import { es } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { subirFotoOrden, type OrdenTrabajo, type Tarea } from "@/lib/mantenimiento"

type Props = {
  orden: OrdenTrabajo | null
  tarea: Tarea | null
  m3Actual: number
  onClose: () => void
  onCambio: () => void
}

export function OrdenTrabajoDialog({ orden, tarea, m3Actual, onClose, onCambio }: Props) {
  const [pasos, setPasos] = useState<Record<string, boolean>>({})
  const [obs, setObs] = useState("")
  const [fotos, setFotos] = useState<{ id: string; url: string }[]>([])
  const [subiendo, setSubiendo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [fotoAmpliada, setFotoAmpliada] = useState<string | null>(null)
  const [modoYaHecha, setModoYaHecha] = useState(false)
  const [fechaYaHecha, setFechaYaHecha] = useState(format(new Date(), "yyyy-MM-dd"))
  const inputFoto = useRef<HTMLInputElement>(null)
  const { toast } = useToast()
  const usuario = currentUserName()

  useEffect(() => {
    if (!orden) return
    setPasos(orden.pasos || {})
    setObs(orden.observaciones || "")
    setFotos((orden.maint_work_order_photos || []).map((f) => ({ id: f.id, url: f.url })))
    setModoYaHecha(false)
  }, [orden])

  if (!orden) return null

  const listaPasos = [...(tarea?.maint_task_steps || [])].sort((a, b) => a.orden - b.orden)
  const items = tarea?.maint_task_items || []
  const imagenes = tarea?.maint_task_images || []
  const marcados = listaPasos.filter((p) => pasos[p.id]).length
  const cerrada = orden.estado === "completada" || orden.estado === "cancelada"

  async function togglePaso(id: string, v: boolean) {
    const nuevo = { ...pasos, [id]: v }
    setPasos(nuevo)
    const supabase = createClient()
    // Se guarda al instante para no perder el avance si se corta la conexión
    await supabase.from("maint_work_orders").update({ pasos: nuevo }).eq("id", orden!.id)
  }

  async function empezar() {
    setGuardando(true)
    const supabase = createClient()
    await supabase.from("maint_work_orders").update({ estado: "en_curso", fecha_inicio: new Date().toISOString(), asignado_a: orden!.asignado_a || usuario }).eq("id", orden!.id)
    setGuardando(false)
    onCambio()
  }

  async function subirFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSubiendo(true)
    try {
      const url = await subirFotoOrden(createClient(), orden!.id, file, usuario)
      setFotos((f) => [...f, { id: String(Date.now()), url }])
      toast({ title: "Foto guardada" })
    } catch (err: any) {
      toast({ title: "No se pudo subir la foto", description: err.message, variant: "destructive" })
    }
    setSubiendo(false)
    e.target.value = ""
  }

  async function completar(fechaManual?: string) {
    if (!fechaManual && listaPasos.length && marcados < listaPasos.length) {
      const ok = confirm(`Marcaste ${marcados} de ${listaPasos.length} pasos. ¿Completar igual?`)
      if (!ok) return
    }
    setGuardando(true)
    const supabase = createClient()
    const ahora = new Date().toISOString()
    const fechaEjec = fechaManual || format(new Date(), "yyyy-MM-dd")

    await supabase.from("maint_work_orders").update({
      estado: "completada",
      fecha_fin: fechaManual ? `${fechaManual}T12:00:00-03:00` : ahora,
      fecha_inicio: orden!.fecha_inicio || ahora,
      completado_por: usuario,
      observaciones: obs || null,
      pasos,
      m3_acumulado: m3Actual,
    }).eq("id", orden!.id)

    // La ejecución es lo que reinicia el contador de la tarea del plan
    if (orden!.task_id) {
      await supabase.from("maint_executions").insert({
        task_id: orden!.task_id,
        fecha: fechaEjec,
        realizado_por: usuario,
        observaciones: obs || (fechaManual ? "Registrada como ya realizada" : null),
        m3_acumulado: m3Actual,
        pasos: Object.keys(pasos).length ? pasos : null,
      })
    }
    setGuardando(false)
    toast({ title: "Orden completada", description: orden!.titulo })
    onCambio()
    onClose()
  }

  async function cancelar() {
    if (!confirm("¿Cancelar esta orden? No queda registrada como hecha.")) return
    const supabase = createClient()
    await supabase.from("maint_work_orders").update({ estado: "cancelada", observaciones: obs || null, completado_por: usuario, fecha_fin: new Date().toISOString() }).eq("id", orden!.id)
    onCambio()
    onClose()
  }

  return (
    <>
      <Dialog open={!!orden} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto p-0 gap-0">
          {/* Encabezado */}
          <DialogHeader className={cn("p-4 pb-3 space-y-1", orden.tipo === "correctiva" ? "bg-amber-50" : "bg-muted/40")}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">OT-{String(orden.numero).padStart(4, "0")}</span>
              {orden.componente && <><span>·</span><span>{orden.componente}</span></>}
              {orden.tipo === "correctiva" && <Badge variant="outline" className="border-amber-400 text-amber-700 text-[10px] ml-auto"><AlertTriangle className="h-3 w-3 mr-1" />Falla</Badge>}
              {orden.prioridad === "urgente" && <Badge className="bg-red-600 text-[10px]">Urgente</Badge>}
            </div>
            <DialogTitle className="text-lg leading-tight">{orden.titulo}</DialogTitle>
            <DialogDescription className="text-xs">
              {orden.estado === "en_curso" && orden.fecha_inicio && <>Empezada {format(parseISO(orden.fecha_inicio), "d/M HH:mm", { locale: es })} · </>}
              {orden.asignado_a && <>Asignada a {orden.asignado_a}</>}
              {cerrada && orden.completado_por && <> · {orden.estado === "completada" ? "Completada" : "Cancelada"} por {orden.completado_por}</>}
            </DialogDescription>
          </DialogHeader>

          <div className="p-4 space-y-5">
            {orden.descripcion && <p className="text-sm text-muted-foreground">{orden.descripcion}</p>}

            {/* Fotos del manual */}
            {imagenes.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5"><ImageIcon className="h-3.5 w-3.5" /> Dónde está · fotos del manual</p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {imagenes.map((f) => (
                    <button key={f.id} onClick={() => setFotoAmpliada(f.url)} className="shrink-0">
                      <img src={f.url} alt="" className="h-20 w-auto rounded border object-cover" />
                    </button>
                  ))}
                </div>
                {tarea?.referencia_manual && <p className="text-[11px] text-muted-foreground mt-1">Manual Indumix {tarea.referencia_manual}</p>}
              </div>
            )}

            {/* Insumos */}
            {items.length > 0 && (
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1.5"><Package className="h-3.5 w-3.5" /> Vas a necesitar</p>
                {items.map((i) => (
                  <div key={i.id} className="flex justify-between text-sm py-0.5">
                    <span>{i.item}{i.codigo_repuesto && <span className="text-muted-foreground text-xs ml-1">({i.codigo_repuesto})</span>}</span>
                    <span className="font-mono text-xs whitespace-nowrap ml-3">{i.cantidad} {i.unidad}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Checklist */}
            {listaPasos.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5"><ListChecks className="h-3.5 w-3.5" /> Pasos</p>
                  <span className={cn("text-xs font-medium", marcados === listaPasos.length ? "text-emerald-600" : "text-muted-foreground")}>{marcados} de {listaPasos.length}</span>
                </div>
                <div className="rounded-lg border divide-y">
                  {listaPasos.map((p, i) => (
                    <label key={p.id} className={cn("flex items-start gap-3 p-3 cursor-pointer", cerrada && "cursor-default")}>
                      <Checkbox checked={!!pasos[p.id]} disabled={cerrada} onCheckedChange={(v) => togglePaso(p.id, !!v)} className="mt-0.5 h-5 w-5" />
                      <span className={cn("text-sm leading-snug", pasos[p.id] && "line-through text-muted-foreground")}>
                        <span className="text-muted-foreground mr-1.5">{i + 1}.</span>{p.texto}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Fotos de evidencia */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5"><Camera className="h-3.5 w-3.5" /> Fotos de lo que hiciste</p>
              <div className="flex gap-2 flex-wrap">
                {fotos.map((f) => (
                  <button key={f.id} onClick={() => setFotoAmpliada(f.url)}>
                    <img src={f.url} alt="" className="h-20 w-20 rounded border object-cover" />
                  </button>
                ))}
                {!cerrada && (
                  <button
                    onClick={() => inputFoto.current?.click()}
                    disabled={subiendo}
                    className="h-20 w-20 rounded border-2 border-dashed flex flex-col items-center justify-center text-muted-foreground hover:bg-muted/50 text-xs gap-1"
                  >
                    {subiendo ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
                    {subiendo ? "Subiendo" : "Sacar foto"}
                  </button>
                )}
              </div>
              <input ref={inputFoto} type="file" accept="image/*" capture="environment" className="hidden" onChange={subirFoto} />
            </div>

            {/* Comentario */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Comentario</Label>
              <Textarea value={obs} onChange={(e) => setObs(e.target.value)} disabled={cerrada} placeholder="Qué encontraste, qué cambiaste, algo para avisar..." rows={3} />
            </div>

            {/* Registrar como ya hecha (puesta a cero) */}
            {!cerrada && modoYaHecha && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
                <p className="text-sm font-medium text-amber-900">¿Cuándo se hizo por última vez?</p>
                <p className="text-xs text-amber-800">Sirve para poner al día el plan sin repetir un trabajo que ya está hecho.</p>
                <div className="flex gap-2">
                  <Input type="date" value={fechaYaHecha} max={format(new Date(), "yyyy-MM-dd")} onChange={(e) => setFechaYaHecha(e.target.value)} className="bg-white" />
                  <Button onClick={() => completar(fechaYaHecha)} disabled={guardando}>Registrar</Button>
                  <Button variant="ghost" size="icon" onClick={() => setModoYaHecha(false)}><X className="h-4 w-4" /></Button>
                </div>
              </div>
            )}
          </div>

          {/* Acciones */}
          {!cerrada && (
            <div className="sticky bottom-0 bg-background border-t p-3 space-y-2">
              {orden.estado === "pendiente" ? (
                <Button className="w-full h-11 text-base" onClick={empezar} disabled={guardando}>
                  <Play className="h-4 w-4 mr-2" /> Empezar
                </Button>
              ) : (
                <Button className="w-full h-11 text-base bg-emerald-600 hover:bg-emerald-700" onClick={() => completar()} disabled={guardando}>
                  {guardando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />} Completar orden
                </Button>
              )}
              <div className="flex justify-between">
                {orden.tipo === "preventiva" && !modoYaHecha ? (
                  <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setModoYaHecha(true)}>
                    <History className="h-3.5 w-3.5 mr-1" /> Ya estaba hecha
                  </Button>
                ) : <span />}
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={cancelar}>Cancelar orden</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!fotoAmpliada} onOpenChange={(o) => !o && setFotoAmpliada(null)}>
        <DialogContent className="max-w-3xl p-2">
          <DialogHeader className="sr-only"><DialogTitle>Foto</DialogTitle></DialogHeader>
          {fotoAmpliada && <img src={fotoAmpliada} alt="" className="w-full h-auto rounded" />}
        </DialogContent>
      </Dialog>
    </>
  )
}
