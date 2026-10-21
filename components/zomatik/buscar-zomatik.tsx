"use client"

/**
 * Zomatik Z0 · Buscador del alta de cliente: mientras se escribe el nombre (o el CUIT), muestra
 *   - "Ya está en Rebucret": los clientes nuestros que se parecen (para no cargar uno repetido);
 *   - "En Zomatik (no está en Rebucret)": de la copia local de Zomatik, con "Traer de Zomatik".
 * "Traer de Zomatik" crea el cliente en NUESTRA base, vinculado al código. No escribe nada en Zomatik.
 * Solo para quien tiene clientes.cargar (el servidor lo vuelve a controlar).
 */
import { useEffect, useMemo, useState } from "react"
import { Download, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { usePermisos } from "@/lib/current-user"
import { buscarEnZomatik, yaEstaEnRebucret } from "@/lib/zomatik/vinculos"
import { tokensNombre, soloDigitos } from "@/lib/zomatik/parseo"
import { toast } from "sonner"

type ZCliente = { codigo: number; razon_social: string; cuit: string | null; tipo_iva: string | null; localidad: string | null; vendedor: string | null; remitos_12m: number; ultimo_remito: string | null; activo: boolean }
type Nuestro = { id: string; name: string; razon_social: string | null; cuit: string | null; zomatik_codigo: number | null; active: boolean | null; unificado_en?: string | null }

// Una sola carga por pestaña (se comparte entre los diálogos)
let cacheZ: Promise<ZCliente[] | null> | null = null
function cargarZomatik(): Promise<ZCliente[] | null> {
  if (!cacheZ)
    cacheZ = fetch("/api/zomatik/clientes", { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()).clientes as ZCliente[]) : null))
      .catch(() => null)
      .then((x) => {
        if (!x) cacheZ = null // si falló, se reintenta la próxima vez que se abre
        return x
      })
  return cacheZ
}

const fechaCorta = (f: string | null) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}` : "")

export function BuscarZomatik({ texto, plantId, onTraido }: { texto: string; plantId?: string | null; onTraido: (c: { id: string; name: string }) => void }) {
  const { puede, listo } = usePermisos()
  const habilitado = listo && puede("clientes", "cargar")
  const [zomatik, setZomatik] = useState<ZCliente[] | null>(null)
  const [nuestros, setNuestros] = useState<Nuestro[]>([])
  const [trayendo, setTrayendo] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!habilitado) return
    let vivo = true
    cargarZomatik().then((z) => vivo && setZomatik(z))
    // Solo las columnas que hacen falta; unificado_en existe recién con la migración de alias (si no, sin ella)
    const sb = createClient()
    const COLS = "id, name, razon_social, cuit, zomatik_codigo, active"
    sb.from("clients")
      .select(`${COLS}, unificado_en`)
      .then(async ({ data, error }) => {
        const filas = error ? (await sb.from("clients").select(COLS)).data : data
        if (vivo) setNuestros(((filas as any[]) || []) as Nuestro[])
      })
    return () => {
      vivo = false
    }
  }, [habilitado])

  const q = texto.trim()
  const { enRebucret, enZomatik } = useMemo(() => {
    if (q.length < 3) return { enRebucret: [] as Nuestro[], enZomatik: [] as ZCliente[] }
    const tq = tokensNombre(q)
    const dig = soloDigitos(q)
    // Contra todos, también los dados de baja (no se trae uno que ya está, aunque esté de baja)
    const enR = nuestros
      .filter((c) => {
        if (dig.length >= 6 && soloDigitos(c.cuit).includes(dig)) return true
        if (tq.length === 0) return false
        const tc = [...tokensNombre(c.name), ...tokensNombre(c.razon_social)]
        return tq.every((t) => tc.some((w) => w.startsWith(t)))
      })
      .slice(0, 4)
    const enZ = buscarEnZomatik(q, (zomatik || []).filter((z) => z.activo), 12)
      .filter((z) => !yaEstaEnRebucret(z, nuestros))
      .slice(0, 6)
    return { enRebucret: enR, enZomatik: enZ }
  }, [q, nuestros, zomatik])

  async function traer(z: ZCliente) {
    setTrayendo(z.codigo)
    setError(null)
    try {
      const r = await fetch("/api/zomatik/traer-cliente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo: z.codigo, plantId: plantId && plantId !== "all" ? plantId : null }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(d?.error || "No se pudo traer el cliente")
        return
      }
      toast.success(d.yaEstaba ? `${d.cliente.name} ya estaba en Rebucret` : `${d.cliente.name} traído de Zomatik`, d.aviso ? { description: d.aviso } : undefined)
      cacheZ = null
      onTraido(d.cliente)
    } finally {
      setTrayendo(null)
    }
  }

  if (!habilitado || q.length < 3 || (enRebucret.length === 0 && enZomatik.length === 0 && !error)) return null
  return (
    <div className="rounded-md border text-xs divide-y">
      {enRebucret.length > 0 && (
        <div className="px-2 py-1.5 space-y-0.5">
          <div className="font-semibold text-amber-700">Ya está en Rebucret · no lo cargues de nuevo</div>
          {enRebucret.map((c) => (
            <div key={c.id} className="flex gap-2 truncate">
              <span className="font-medium truncate">{c.name}</span>
              {c.active === false && (c.unificado_en ? (
                <span className="text-amber-700">unificado en «{nuestros.find((x) => x.id === c.unificado_en)?.name || "otro cliente"}»: usá ese</span>
              ) : (
                <span className="text-red-700">dado de baja: reactivalo en Clientes</span>
              ))}
              {c.cuit && <span className="text-muted-foreground">CUIT {c.cuit}</span>}
            </div>
          ))}
        </div>
      )}
      {enZomatik.length > 0 && (
        <div className="px-2 py-1.5 space-y-1">
          <div className="font-semibold text-blue-700">En Zomatik (no está en Rebucret)</div>
          {enZomatik.map((z) => (
            <div key={z.codigo} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{z.razon_social}</div>
                <div className="text-muted-foreground truncate">
                  {[z.cuit && `CUIT ${z.cuit}`, z.tipo_iva, z.localidad, z.vendedor && `vend. ${z.vendedor}`, z.ultimo_remito && `último remito ${fechaCorta(z.ultimo_remito)}`].filter(Boolean).join(" · ") || `código ${z.codigo}`}
                </div>
              </div>
              <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs shrink-0" disabled={trayendo !== null} onClick={() => traer(z)}>
                {trayendo === z.codigo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}
                Traer de Zomatik
              </Button>
            </div>
          ))}
          <div className="text-muted-foreground">Se crea en Rebucret con los datos de Zomatik. En Zomatik no se toca nada.</div>
        </div>
      )}
      {error && <div className="px-2 py-1.5 text-red-700 font-medium">{error}</div>}
    </div>
  )
}
