"use client"
/**
 * "NP con saldo" en Programación (sección 25, respuestas y precisión del 23/10): NP del sistema en Zomatik que quedaron
 * con m³ sin usar y sin pedido activo (pedido cancelado por lluvia, cambiado o finalizado con sobrante). Quedan
 * PENDIENTES todo el tiempo que haga falta, sin vencer, con desde cuándo, hasta que alguien toque:
 *   - Reprogramar: abre el formulario del pedido con esa NP (cliente, obra, fórmula y saldo precargados);
 *   - Devolver el saldo: sin despachos se vacía en Zomatik; con despachos hace falta una devolución (DEVOL) a mano.
 */
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { linkNp } from "@/lib/zomatik/web"
import { cargarNpSaldos, decidirSaldoNp, type NpSaldo } from "@/lib/zomatik/np-cliente"

const m3t = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 1 })
const dia = (s: string | null) => (s ? new Date(s.length === 10 ? `${s}T12:00:00Z` : s).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }) : "—")
const hace = (s: string | null) => {
  if (!s) return ""
  const d = Math.floor((Date.now() - Date.parse(s)) / 86400_000)
  return d <= 0 ? "hoy" : d === 1 ? "hace 1 día" : `hace ${d} días`
}

export function NpSaldos({ visible, puedeCargar, plantId, onReprogramar, recargarCon }: {
  /** Alguna planta con la llave prendida */
  visible: boolean
  puedeCargar: boolean
  /** Filtro de planta de Programación ("all" = todas) */
  plantId: string
  onReprogramar: (np: NpSaldo) => void
  /** Cambia cuando se guardó o canceló un pedido (para volver a leer) */
  recargarCon?: unknown
}) {
  const [nps, setNps] = useState<NpSaldo[] | null>(null)
  const [trabajando, setTrabajando] = useState<string | null>(null)
  const [msg, setMsg] = useState<Record<string, string>>({})
  const cargar = useCallback(async () => setNps(await cargarNpSaldos()), [])
  useEffect(() => {
    if (visible) cargar()
  }, [visible, cargar, recargarCon])
  if (!visible || !nps) return null
  const lista = nps.filter((x) => plantId === "all" || !x.plant_id || x.plant_id === plantId)
  if (!lista.length) return null

  async function decidir(x: NpSaldo, d: "devolver" | "cerrada") {
    setTrabajando(x.id)
    const r = await decidirSaldoNp(x.id, d)
    setMsg((m) => ({ ...m, [x.id]: r.texto }))
    setTrabajando(null)
    cargar()
  }

  return (
    <div className="rounded-md border px-3 py-2">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-sm font-semibold">NP con saldo</h3>
        <span className="text-xs text-muted-foreground">{lista.length} pendiente{lista.length === 1 ? "" : "s"} · quedan hasta que se reprogramen o se devuelvan</span>
      </div>
      <div className="divide-y text-xs">
        {lista.map((x) => (
          <div key={x.id} className="flex flex-wrap items-center gap-2 py-1">
            <span className={cn("rounded px-1", x.saldo_decision === "devolver" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800")}>{x.saldo_decision === "devolver" ? "Devolver" : "Pendiente"}</span>
            <span className="font-medium tabular-nums">{x.numero || "NP"}</span>
            <span className="min-w-0 flex-1 truncate">
              {x.cliente || ""}{x.obra ? ` · ${x.obra}` : ""} · {x.formula || ""} · <b className="tabular-nums">{m3t(x.libre)} m³</b> de {m3t(x.m3)} · desde el {dia(x.pendiente_desde)} ({hace(x.pendiente_desde)})
              {(msg[x.id] || x.saldo_mensaje) && <span className="block text-muted-foreground">{msg[x.id] || x.saldo_mensaje}</span>}
            </span>
            {linkNp(x.zomatik_codigo) && <a className="underline" href={linkNp(x.zomatik_codigo)!} target="_blank" rel="noreferrer">Ver en Zomatik</a>}
            {puedeCargar && (
              <>
                <Button size="sm" className="h-6 px-2 text-[11px]" disabled={!!trabajando} onClick={() => onReprogramar(x)}>Reprogramar</Button>
                {x.saldo_decision === "devolver"
                  ? <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={!!trabajando} onClick={() => decidir(x, "cerrada")}>Ya la devolví</Button>
                  : <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={!!trabajando} onClick={() => decidir(x, "devolver")}>Devolver el saldo</Button>}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
