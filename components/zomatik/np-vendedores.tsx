"use client"
/**
 * Zomatik Z2b · Vendedor de Zomatik de cada usuario (respuesta 4 del 23/10). Solo gerenciales, en Vínculos › NP
 * automática. La NP lleva el vendedor de quien programa; si no tiene, el del cliente; si tampoco, "cargale el vendedor".
 */
import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Fila = { id: string; name: string; vendedor_id: number | null; vendedor_nombre: string | null }

export function NpVendedores() {
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [editado, setEditado] = useState<Record<string, { id: string; nombre: string }>>({})
  const [guardando, setGuardando] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const cargar = useCallback(async () => {
    try {
      const r = await fetch("/api/zomatik/np/vendedores", { cache: "no-store" })
      const j = await r.json().catch(() => ({}))
      setFilas(j?.usuarios || [])
    } catch {
      setFilas([])
    }
  }, [])
  useEffect(() => {
    cargar()
  }, [cargar])
  if (!filas || !filas.length) return null

  async function guardar(f: Fila) {
    const e = editado[f.id]
    if (!e) return
    setGuardando(f.id)
    setErr(null)
    const r = await fetch("/api/zomatik/np/vendedores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_user_id: f.id, vendedor_id: e.id.trim() || null, vendedor_nombre: e.nombre }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) setErr(j?.error || `Error ${r.status}`)
    else setEditado((x) => { const y = { ...x }; delete y[f.id]; return y })
    setGuardando(null)
    cargar()
  }

  return (
    <div className="space-y-1">
      <div className="font-semibold">Vendedor de Zomatik de quien programa</div>
      <p className="text-muted-foreground">La NP sale con el vendedor de quien programa el pedido. Si no tiene, con el del cliente en Zomatik.</p>
      {filas.map((f) => {
        const e = editado[f.id] || { id: f.vendedor_id ? String(f.vendedor_id) : "", nombre: f.vendedor_nombre || "" }
        const cambia = !!editado[f.id]
        return (
          <div key={f.id} className="flex flex-wrap items-center gap-1.5">
            <span className="w-40 truncate">{f.name}</span>
            <Input className="h-7 w-20 text-xs" inputMode="numeric" placeholder="N.º" value={e.id} onChange={(ev) => setEditado((x) => ({ ...x, [f.id]: { ...e, id: ev.target.value.replace(/\D/g, "") } }))} />
            <Input className="h-7 w-44 text-xs" placeholder="Nombre en Zomatik" value={e.nombre} onChange={(ev) => setEditado((x) => ({ ...x, [f.id]: { ...e, nombre: ev.target.value } }))} />
            {cambia && (
              <Button size="sm" className="h-7 px-2 text-xs" disabled={!!guardando} onClick={() => guardar(f)}>
                {guardando === f.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Guardar"}
              </Button>
            )}
            {!f.vendedor_id && !cambia && <span className="text-muted-foreground">sin vendedor (va el del cliente)</span>}
          </div>
        )
      })}
      {err && <p className="text-red-700">{err}</p>}
    </div>
  )
}
