"use client"

/** Crear una orden correctiva: algo se rompió o anda mal. */

import { useState, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { currentUserName } from "@/lib/current-user"
import { AlertTriangle, Camera, Loader2 } from "lucide-react"
import { COMPONENTES, subirFotoOrden } from "@/lib/mantenimiento"
import { cn } from "@/lib/utils"

type Props = { open: boolean; equipmentId: string; onClose: () => void; onCreada: () => void }

const PRIORIDADES = [
  { v: "baja", l: "Baja", d: "Se puede esperar", c: "border-slate-300" },
  { v: "normal", l: "Normal", d: "En los próximos días", c: "border-blue-300" },
  { v: "alta", l: "Alta", d: "Esta semana", c: "border-amber-400" },
  { v: "urgente", l: "Urgente", d: "La planta no puede trabajar", c: "border-red-500" },
]

export function ReportarFallaDialog({ open, equipmentId, onClose, onCreada }: Props) {
  const [componente, setComponente] = useState("")
  const [titulo, setTitulo] = useState("")
  const [descripcion, setDescripcion] = useState("")
  const [prioridad, setPrioridad] = useState("normal")
  const [foto, setFoto] = useState<File | null>(null)
  const [guardando, setGuardando] = useState(false)
  const inputFoto = useRef<HTMLInputElement>(null)
  const { toast } = useToast()

  async function crear() {
    if (!titulo.trim()) return toast({ title: "Escribí qué pasó", variant: "destructive" })
    setGuardando(true)
    const supabase = createClient()
    const usuario = currentUserName()
    const { data, error } = await supabase.from("maint_work_orders").insert({
      equipment_id: equipmentId,
      tipo: "correctiva",
      titulo: titulo.trim(),
      descripcion: descripcion.trim() || null,
      componente: componente || null,
      estado: "pendiente",
      prioridad,
      asignado_a: "Braian Peralta",
      creado_por: usuario,
    }).select("id").single()

    if (error || !data) {
      toast({ title: "No se pudo crear", description: error?.message, variant: "destructive" })
      setGuardando(false)
      return
    }
    if (foto) {
      try { await subirFotoOrden(supabase, data.id, foto, usuario, "Foto de la falla") } catch {}
    }
    toast({ title: "Falla reportada", description: "Le llega a Braian Peralta" })
    setTitulo(""); setDescripcion(""); setComponente(""); setPrioridad("normal"); setFoto(null)
    setGuardando(false)
    onCreada()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" /> Reportar una falla</DialogTitle>
          <DialogDescription>Se crea una orden de trabajo correctiva para mantenimiento.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>¿Qué pasó?</Label>
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej: se cortó la correa de la cinta" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>¿En qué parte de la planta?</Label>
            <Select value={componente} onValueChange={setComponente}>
              <SelectTrigger><SelectValue placeholder="Elegí el componente" /></SelectTrigger>
              <SelectContent>
                {Object.keys(COMPONENTES).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                <SelectItem value="Otro">Otro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>¿Qué tan urgente es?</Label>
            <div className="grid grid-cols-2 gap-2">
              {PRIORIDADES.map((p) => (
                <button key={p.v} onClick={() => setPrioridad(p.v)} className={cn("rounded-lg border-2 p-2 text-left", prioridad === p.v ? p.c + " bg-muted/60" : "border-transparent bg-muted/30")}>
                  <p className="text-sm font-medium">{p.l}</p>
                  <p className="text-xs text-muted-foreground">{p.d}</p>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Detalle (opcional)</Label>
            <Textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2} placeholder="Ruido, pérdida, desde cuándo..." />
          </div>
          <div>
            <input ref={inputFoto} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setFoto(e.target.files?.[0] || null)} />
            <Button variant="outline" size="sm" onClick={() => inputFoto.current?.click()}>
              <Camera className="h-4 w-4 mr-2" /> {foto ? "Foto lista · cambiar" : "Sacar foto"}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={crear} disabled={guardando}>{guardando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Crear orden</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
