"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

/**
 * Fase 0c-1 · Motivo obligatorio en toda edición o borrado (y en el recuento de stock).
 * Va a Actividad (details.Motivo), al mail de borrado y, donde hay stock, a la nota del movimiento.
 */

/** Al menos 5 caracteres sin contar espacios. */
export function motivoValido(texto: string | null | undefined): boolean {
  return String(texto ?? "").replace(/\s+/g, "").length >= 5
}

export function CampoMotivo({
  value,
  onChange,
  label = "Motivo (obligatorio)",
  ejemplo = "Ej: el remito se cargó con otro número",
  id = "motivo",
}: {
  value: string
  onChange: (v: string) => void
  label?: string
  ejemplo?: string
  id?: string
}) {
  const tocado = value.length > 0
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={ejemplo} rows={2} />
      {tocado && !motivoValido(value) && <p className="text-xs text-destructive">Escribí un poco más (al menos 5 letras).</p>}
    </div>
  )
}

/**
 * Confirmación con motivo para eliminar o cancelar. Reemplaza los AlertDialog de borrado.
 * `onConfirmar` recibe el motivo ya limpio; si devuelve una promesa, el botón espera.
 */
export function ConfirmarConMotivo({
  open,
  onOpenChange,
  titulo,
  descripcion,
  textoBoton = "Eliminar",
  destructivo = true,
  labelMotivo,
  ejemplo,
  onConfirmar,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  titulo: string
  descripcion?: React.ReactNode
  textoBoton?: string
  destructivo?: boolean
  labelMotivo?: string
  ejemplo?: string
  onConfirmar: (motivo: string) => void | Promise<void>
}) {
  const [motivo, setMotivo] = useState("")
  const [trabajando, setTrabajando] = useState(false)
  useEffect(() => {
    if (open) setMotivo("")
  }, [open])

  async function confirmar() {
    if (!motivoValido(motivo) || trabajando) return
    setTrabajando(true)
    try {
      await onConfirmar(motivo.trim())
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !trabajando && onOpenChange(v)}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          {descripcion && <DialogDescription asChild><div className="text-sm text-muted-foreground">{descripcion}</div></DialogDescription>}
        </DialogHeader>
        <CampoMotivo value={motivo} onChange={setMotivo} label={labelMotivo} ejemplo={ejemplo} id="motivo-confirmar" />
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={trabajando}>
            Volver
          </Button>
          <Button variant={destructivo ? "destructive" : "default"} onClick={confirmar} disabled={!motivoValido(motivo) || trabajando}>
            {trabajando ? <Loader2 className="h-4 w-4 animate-spin" /> : textoBoton}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
