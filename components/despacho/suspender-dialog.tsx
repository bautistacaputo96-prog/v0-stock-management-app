"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { faltaDe, hhmm, m3txt, MOTIVOS_SUSPENDER, type MotivoTipo } from "@/lib/despacho"
import { cn } from "@/lib/utils"
import type { PedidoT } from "./tipos"

export function ChipsMotivo({ opciones, valor, onChange }: { opciones: [MotivoTipo, string][]; valor: MotivoTipo; onChange: (v: MotivoTipo) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {opciones.map(([k, l]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={cn("min-h-[40px] rounded-full border px-3 text-sm font-semibold", valor === k ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground")}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

export function CabeceraPedido({ p, extra }: { p: PedidoT; extra?: string }) {
  return (
    <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
      <div className="text-base font-extrabold">{p.clients?.name}</div>
      <div>{p.construction_sites?.name} · {p.formulas?.code}{extra ? ` · ${extra}` : ""}</div>
    </div>
  )
}

/** Suspender (lluvia, obra que no está lista…): los viajes quedan en pausa y no se puede despachar hasta reabrir. */
export function SuspenderDialog({ pedido, onClose, onConfirmar }: {
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
    if (tipo === "otro" && detalle.trim().length < 5) { setErr("Contá brevemente el motivo."); return }
    setTrabajando(true)
    const e = await onConfirmar(tipo, detalle.trim())
    setTrabajando(false)
    if (e) setErr(e)
  }

  return (
    <Dialog open={!!pedido} onOpenChange={(v) => !v && !trabajando && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader><DialogTitle>Suspender pedido</DialogTitle></DialogHeader>
        {pedido && (
          <div className="space-y-3">
            <CabeceraPedido p={pedido} extra={`falta ${m3txt(faltaDe(pedido))} m³`} />
            <div className="space-y-1.5">
              <Label>¿Por qué se suspende? *</Label>
              <ChipsMotivo opciones={MOTIVOS_SUSPENDER} valor={tipo} onChange={setTipo} />
            </div>
            <div className="space-y-1.5">
              <Label>Detalle {tipo === "otro" ? "*" : "(opcional)"}</Label>
              <Input className="h-11" value={detalle} onChange={(e) => setDetalle(e.target.value)} placeholder="Ej: llueve desde las 7, la obra avisa a las 11" />
            </div>
            <p className="text-[13px] text-muted-foreground">Los viajes que faltan quedan en pausa y no se puede despachar hasta reabrirlo. No se borra nada.</p>
            {err && <div className="rounded-lg bg-red-100 px-3 py-2 text-sm font-semibold text-red-800">{err}</div>}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onClose} disabled={trabajando}>Volver</Button>
          <Button className="h-11 bg-amber-600 hover:bg-amber-700" onClick={confirmar} disabled={trabajando}>
            {trabajando ? <Loader2 className="h-4 w-4 animate-spin" /> : "⏸ Suspender"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Reabrir: vuelve a activo. Si el pedido tiene viajes guardados y la persona puede ajustarlo, ofrece correrlos
 * ("el próximo carga a las 10:20", con Ajustar a la hora actual del gerenciador) o dejarlos como estaban.
 */
export function ReabrirDialog({ pedido, proximaCarga, nuevaCarga, puedeCorrer, onClose, onConfirmar }: {
  pedido: PedidoT | null
  /** carga del próximo viaje pendiente (ISO), si tiene viajes guardados */
  proximaCarga: string | null
  /** a qué hora cargaría el próximo si se corren (ms) */
  nuevaCarga: number
  puedeCorrer: boolean
  onClose: () => void
  onConfirmar: (correr: boolean) => Promise<string | null>
}) {
  const [trabajando, setTrabajando] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { if (pedido) setErr(null) }, [pedido])
  async function confirmar(correr: boolean) {
    setTrabajando(true)
    const e = await onConfirmar(correr)
    setTrabajando(false)
    if (e) setErr(e)
  }
  return (
    <Dialog open={!!pedido} onOpenChange={(v) => !v && !trabajando && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader><DialogTitle>Reabrir pedido</DialogTitle></DialogHeader>
        {pedido && (
          <div className="space-y-3">
            <CabeceraPedido p={pedido} extra={`falta ${m3txt(faltaDe(pedido))} m³`} />
            {proximaCarga && puedeCorrer ? (
              <>
                <div>¿Qué hacemos con los horarios de los viajes?</div>
                <Button className="h-auto min-h-11 w-full justify-start whitespace-normal py-2 text-left" disabled={trabajando} onClick={() => confirmar(true)}>
                  Correr los viajes: el próximo carga a las <b className="ml-1">{hhmm(nuevaCarga)}</b>
                </Button>
                <Button variant="outline" className="h-auto min-h-11 w-full justify-start whitespace-normal py-2 text-left" disabled={trabajando} onClick={() => confirmar(false)}>
                  Dejar los horarios como estaban (el próximo era {hhmm(proximaCarga)})
                </Button>
              </>
            ) : (
              <>
                {proximaCarga && <p className="text-[13px] text-muted-foreground">Los viajes quedan con sus horarios (el próximo carga {hhmm(proximaCarga)}). Para correrlos hace falta poder ajustar el pedido.</p>}
                <Button className="h-11 w-full" disabled={trabajando} onClick={() => confirmar(false)}>Reabrir</Button>
              </>
            )}
            {err && <div className="rounded-lg bg-red-100 px-3 py-2 text-sm font-semibold text-red-800">{err}</div>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" className="h-11" onClick={onClose} disabled={trabajando}>Volver</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
