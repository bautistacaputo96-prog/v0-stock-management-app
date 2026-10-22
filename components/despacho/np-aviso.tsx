"use client"
/**
 * Zomatik Z2 · Aviso de la NP en la Entrega (21.3): un pedido sin NP se ve en rojo, "NP pendiente: avisale a
 * Programación". En modo aviso (las 2 primeras semanas) deja despachar y queda anotado; en modo duro no deja, salvo
 * la excepción de un gerencial con motivo, para ese pedido y ese día. El plantista no genera NP.
 */
import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { usePermisos } from "@/lib/current-user"
import type { EstadoPedidoNp } from "@/lib/zomatik/np-cliente"

const MOTIVOS = [
  ["zomatik_caido", "Zomatik caído"],
  ["cliente_sin_alta", "Cliente sin alta en Zomatik"],
  ["otro", "Otro"],
] as const

export function NpAviso({ pedidoId, estado, onCambio }: { pedidoId: string; estado: EstadoPedidoNp | null | undefined; onCambio: () => void }) {
  const { esGerencial } = usePermisos()
  const [abierto, setAbierto] = useState(false)
  const [tipo, setTipo] = useState<string>("")
  const [motivo, setMotivo] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (!estado?.control?.aviso) return null
  if (estado.excepcion)
    return <div className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">Sin NP: autorizó {estado.excepcion.autorizado_por} para hoy. La NP la regulariza Programación.</div>
  const pendiente = estado.nps.find((x) => ["pendiente", "error", "revisar", "generando"].includes(x.estado))

  async function autorizar() {
    setEnviando(true)
    setErr(null)
    try {
      const r = await fetch("/api/zomatik/np/excepcion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pedido_id: pedidoId, motivo_tipo: tipo, motivo }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) setErr(j?.error || `Error ${r.status}`)
      else {
        setAbierto(false)
        onCambio()
      }
    } catch {
      setErr("Sin conexión")
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="space-y-1 rounded-md border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-800">
      <div className="font-medium">NP pendiente: avisale a Programación</div>
      {pendiente?.mensaje && <div className="text-red-700">{pendiente.mensaje}</div>}
      <div>{estado.control.bloquea ? "No se puede despachar hasta que el pedido tenga su NP en Zomatik." : "Modo aviso: se puede despachar igual y queda anotado en Actividad."}</div>
      {estado.control.bloquea && !abierto && (esGerencial
        ? <Button type="button" variant="outline" className="h-7 border-red-300 bg-white px-2 text-xs" onClick={() => setAbierto(true)}>Despachar sin NP (autorizo yo)</Button>
        : <div>Si Zomatik está caído, la excepción la da un gerencial (Bautista, Juan o Fernando).</div>)}
      {abierto && (
        <div className="space-y-1 rounded border border-red-200 bg-white p-1.5 text-slate-800">
          <div className="flex flex-wrap gap-1">
            {MOTIVOS.map(([k, l]) => (
              <Button key={k} type="button" variant={tipo === k ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setTipo(k)}>{l}</Button>
            ))}
          </div>
          {tipo === "otro" && <Input className="h-7 text-xs" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Contá el motivo" />}
          {err && <div className="text-red-700">{err}</div>}
          <div className="flex gap-1">
            <Button type="button" className="h-7 px-2 text-xs" disabled={enviando || !tipo || (tipo === "otro" && motivo.trim().length < 5)} onClick={autorizar}>
              {enviando ? <Loader2 className="h-3 w-3 animate-spin" /> : "Autorizar para hoy"}
            </Button>
            <Button type="button" variant="outline" className="h-7 px-2 text-xs" onClick={() => setAbierto(false)}>Cancelar</Button>
          </div>
        </div>
      )}
    </div>
  )
}
