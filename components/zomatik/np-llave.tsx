"use client"
/**
 * Zomatik Z2 · "NP automática" en Vínculos con Zomatik (solo gerenciales): la llave por planta (apagada por
 * defecto; la prende Bautista), el modo (aviso 2 semanas, después duro) y las NP para revisar o con error.
 */
import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { linkNp } from "@/lib/zomatik/web"
import { revisarNp } from "@/lib/zomatik/np-cliente"
import { NpVendedores } from "@/components/zomatik/np-vendedores"

type Planta = { id: string; name: string; activo: boolean; desde: string | null; deposito: number | null; modo: "apagado" | "aviso" | "duro"; aviso_hasta: string | null }
type Np = { id: string; scheduled_dispatch_id: string | null; n: number; estado: string; numero: string | null; zomatik_codigo: number | null; mensaje: string | null; m3: number; fecha: string; sucursal: string | null; updated_at: string }

const fecha = (s: string | null) => (s ? new Date(`${s.slice(0, 10)}T12:00:00Z`).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }) : "")

export function NpLlave() {
  const [plantas, setPlantas] = useState<Planta[] | null>(null)
  const [bandeja, setBandeja] = useState<Np[]>([])
  const [sinMigracion, setSinMigracion] = useState(false)
  const [trabajando, setTrabajando] = useState<string | null>(null)
  const [confirmar, setConfirmar] = useState<Planta | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const r = await fetch("/api/zomatik/np/llave", { cache: "no-store" })
      const j = await r.json().catch(() => ({}))
      setPlantas(j?.plantas || [])
      setBandeja(j?.bandeja || [])
      setSinMigracion(!!j?.sinMigracion)
    } catch {
      setPlantas([])
    }
  }, [])
  useEffect(() => {
    cargar()
  }, [cargar])

  async function cambiar(p: Planta, cambios: { activo: boolean; duro?: boolean }) {
    setTrabajando(p.id)
    setErr(null)
    const r = await fetch("/api/zomatik/np/llave", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plant_id: p.id, ...cambios }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) setErr(j?.error || `Error ${r.status}`)
    setTrabajando(null)
    setConfirmar(null)
    cargar()
  }

  async function revisar(n: Np, decision: "otra" | "buena") {
    setTrabajando(n.id)
    const e = await revisarNp(n.id, decision)
    if (e) setErr(e)
    setTrabajando(null)
    cargar()
  }

  if (plantas === null) return null
  return (
    <details className="rounded-md border px-3 py-2" open={bandeja.some((b) => b.estado === "revisar")}>
      <summary className="cursor-pointer text-sm font-semibold">
        NP automática en Zomatik{" "}
        <span className="text-xs font-normal text-muted-foreground">
          {sinMigracion ? "falta aplicar la migración de Z2" : plantas.map((p) => `${p.name}: ${p.activo ? (p.modo === "duro" ? "prendida (sin NP no se despacha)" : `prendida, modo aviso hasta el ${fecha(p.aviso_hasta)}`) : "apagada"}`).join(" · ")}
          {bandeja.length ? ` · ${bandeja.length} para mirar` : ""}
        </span>
      </summary>
      <div className="mt-2 space-y-2 text-xs">
        <p className="text-muted-foreground">
          Apagada, el sistema no escribe nada en Zomatik y la NP se carga a mano como hoy. Prendida, cada pedido nuevo de la planta genera su NP al programar
          (los pedidos de antes no). Las 2 primeras semanas son de aviso: el despacho muestra la NP pendiente en rojo pero deja despachar.
        </p>
        {plantas.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-2">
            <span className="w-20 font-medium">{p.name}</span>
            <span className={cn("rounded px-1.5 py-0.5", p.activo ? "bg-emerald-50 text-emerald-800" : "bg-muted text-muted-foreground")}>{p.activo ? "Prendida" : "Apagada"}</span>
            {p.activo && <span className="text-muted-foreground">desde {p.desde ? new Date(p.desde).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }) : "—"} · {p.modo === "duro" ? "modo duro" : `aviso hasta el ${fecha(p.aviso_hasta)}`}</span>}
            {!p.deposito && <span className="text-amber-700">sin depósito de Zomatik</span>}
            <span className="flex-1" />
            <Button size="sm" variant={p.activo ? "outline" : "default"} className="h-7 text-xs" disabled={!!trabajando || sinMigracion || (!p.activo && !p.deposito)} onClick={() => (p.activo ? cambiar(p, { activo: false }) : setConfirmar(p))}>
              {trabajando === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : p.activo ? "Apagar" : "Prender"}
            </Button>
          </div>
        ))}
        {confirmar && (
          <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-2">
            <p>
              ¿Prender la NP automática en <b>{confirmar.name}</b>? Desde ahora, al programar un pedido el sistema crea su NP en Zomatik (sucursal REBUCRET,
              depósito {confirmar.deposito}). {confirmar.aviso_hasta ? "" : "Arrancan las 2 semanas de modo aviso."}
            </p>
            <div className="flex gap-1">
              <Button size="sm" className="h-7 text-xs" disabled={!!trabajando} onClick={() => cambiar(confirmar, { activo: true })}>Sí, prender</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setConfirmar(null)}>No</Button>
            </div>
          </div>
        )}
        {err && <p className="text-red-700">{err}</p>}
        {!sinMigracion && <NpVendedores />}
        {bandeja.length > 0 && (
          <div className="space-y-1">
            <div className="font-semibold">Para mirar</div>
            {bandeja.map((n) => (
              <div key={n.id} className="flex flex-wrap items-center gap-2 border-t pt-1">
                <span className={cn("rounded px-1", n.estado === "revisar" ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700")}>{n.estado === "revisar" ? "Revisar" : n.estado === "vaciar" ? "Falta vaciar" : "Error"}</span>
                <span className="tabular-nums">{n.numero || `NP ${n.n}`} · {n.m3} m³ · {fecha(n.fecha)}</span>
                <span className="min-w-0 flex-1 text-muted-foreground">{n.mensaje}</span>
                {linkNp(n.zomatik_codigo) && <a className="underline" href={linkNp(n.zomatik_codigo)!} target="_blank" rel="noreferrer">Ver en Zomatik</a>}
                {n.estado === "revisar" && (
                  <>
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={!!trabajando} onClick={() => revisar(n, "otra")} title="La NP equivocada ya se vació a mano: el sistema genera otra">Ya la vacié: generar otra</Button>
                    {n.sucursal === "18" && <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={!!trabajando} onClick={() => revisar(n, "buena")}>Está bien así</Button>}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  )
}
