"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { faltaDe, m3txt, MOTIVOS_CANCELAR, MOTIVOS_FINALIZAR, type MotivoTipo } from "@/lib/despacho"
import { motivoValido } from "@/components/motivo"
import { CabeceraPedido, ChipsMotivo } from "./suspender-dialog"
import type { PedidoT } from "./tipos"

/** Finalizar con lo enviado, con motivo (reemplaza al Finalizar de la pantalla de siempre). */
export function FinalizarDialog({ pedido, onClose, onConfirmar }: {
  pedido: PedidoT | null
  onClose: () => void
  onConfirmar: (tipo: MotivoTipo, detalle: string) => Promise<string | null>
}) {
  const [tipo, setTipo] = useState<MotivoTipo>("obra_pidio_menos")
  const [detalle, setDetalle] = useState("")
  const [err, setErr] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  useEffect(() => { if (pedido) { setTipo("obra_pidio_menos"); setDetalle(""); setErr(null) } }, [pedido])
  async function confirmar() {
    if (tipo === "otro" && detalle.trim().length < 5) { setErr("Contá brevemente el motivo."); return }
    setTrabajando(true)
    const e = await onConfirmar(tipo, detalle.trim())
    setTrabajando(false)
    if (e) setErr(e)
  }
  const desp = Number(pedido?.dispatched_m3 || 0)
  return (
    <Dialog open={!!pedido} onOpenChange={(v) => !v && !trabajando && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader><DialogTitle>Finalizar pedido</DialogTitle></DialogHeader>
        {pedido && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">El pedido se cierra con lo que ya salió. No se puede despachar más.</p>
            <CabeceraPedido p={pedido} />
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border p-2"><div className="text-[11px] text-muted-foreground">Programado</div><div className="text-lg font-bold">{m3txt(pedido.quantity_m3)}</div></div>
              <div className="rounded-lg border p-2"><div className="text-[11px] text-muted-foreground">Despachado</div><div className="text-lg font-bold text-green-600">{m3txt(desp)}</div></div>
              <div className="rounded-lg border p-2"><div className="text-[11px] text-muted-foreground">Sin enviar</div><div className="text-lg font-bold text-amber-600">{m3txt(faltaDe(pedido))}</div></div>
            </div>
            <div className="space-y-1.5">
              <Label>¿Por qué se cierra antes? *</Label>
              <ChipsMotivo opciones={MOTIVOS_FINALIZAR} valor={tipo} onChange={setTipo} />
            </div>
            <div className="space-y-1.5">
              <Label>Detalle {tipo === "otro" ? "*" : "(opcional)"}</Label>
              <Input className="h-11" value={detalle} onChange={(e) => setDetalle(e.target.value)} placeholder="Ej: con 30 m³ llenaron la platea" />
            </div>
            <p className="text-xs text-muted-foreground">Queda registrado que se cerró con {m3txt(faltaDe(pedido))} m³ sin despachar.</p>
            {err && <div className="rounded-lg bg-red-100 px-3 py-2 text-sm font-semibold text-red-800">{err}</div>}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onClose} disabled={trabajando}>Volver</Button>
          <Button className="h-11 bg-green-600 hover:bg-green-700" onClick={confirmar} disabled={trabajando}>
            {trabajando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Finalizar pedido"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Cancelar con motivo (solo gerenciales): el pedido no se borra, queda cancelado con el motivo guardado. */
export function CancelarDialog({ pedido, onClose, onConfirmar }: {
  pedido: PedidoT | null
  onClose: () => void
  onConfirmar: (tipo: MotivoTipo, detalle: string) => Promise<string | null>
}) {
  const [tipo, setTipo] = useState<MotivoTipo>("lluvia")
  const [detalle, setDetalle] = useState("")
  const [err, setErr] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  useEffect(() => { if (pedido) { setTipo("lluvia"); setDetalle(""); setErr(null) } }, [pedido])
  async function confirmar() {
    if (!motivoValido(detalle)) { setErr("El motivo es obligatorio (al menos 5 letras)."); return }
    setTrabajando(true)
    const e = await onConfirmar(tipo, detalle.trim())
    setTrabajando(false)
    if (e) setErr(e)
  }
  return (
    <Dialog open={!!pedido} onOpenChange={(v) => !v && !trabajando && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader><DialogTitle>Cancelar pedido</DialogTitle></DialogHeader>
        {pedido && (
          <div className="space-y-3">
            <CabeceraPedido p={pedido} extra={`${m3txt(pedido.quantity_m3)} m³`} />
            <p className="text-sm text-muted-foreground">El pedido no se borra: queda cancelado. Solo gerenciales.</p>
            <div className="space-y-1.5">
              <Label>Motivo *</Label>
              <ChipsMotivo opciones={MOTIVOS_CANCELAR} valor={tipo} onChange={setTipo} />
            </div>
            <div className="space-y-1.5">
              <Label>Detalle (obligatorio)</Label>
              <Input className="h-11" value={detalle} onChange={(e) => setDetalle(e.target.value)} placeholder="Ej: el cliente pasó la obra para la semana que viene" />
            </div>
            {err && <div className="rounded-lg bg-red-100 px-3 py-2 text-sm font-semibold text-red-800">{err}</div>}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onClose} disabled={trabajando}>Volver</Button>
          <Button variant="destructive" className="h-11" onClick={confirmar} disabled={trabajando}>
            {trabajando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cancelar pedido"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
