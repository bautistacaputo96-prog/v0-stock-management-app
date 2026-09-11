"use client"

/**
 * Muestras sacadas vs. m³ y camiones despachados, por planta y período.
 * Una muestra = un camión con su juego de probetas (un Probeta ID).
 * Objetivo de la planta: 1 muestra cada 3 camiones.
 */

import { useState, useEffect, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Beaker, Truck } from "lucide-react"
import { format, subDays, startOfWeek, startOfMonth, endOfMonth, subMonths, startOfDay } from "date-fns"
import { cn } from "@/lib/utils"

const CAMIONES_POR_MUESTRA = 3

type Fila = { planta: string; m3: number; camiones: number; muestras: number }

const PRESETS = [
  { v: "7", l: "Últimos 7 días" },
  { v: "30", l: "Últimos 30 días" },
  { v: "semana", l: "Esta semana" },
  { v: "mes", l: "Este mes" },
  { v: "mesAnterior", l: "Mes pasado" },
  { v: "custom", l: "Elegir fechas" },
]

function rangoDe(preset: string, custom: { from: string; to: string }): { from: string; to: string } {
  const hoy = startOfDay(new Date())
  const f = (d: Date) => format(d, "yyyy-MM-dd")
  switch (preset) {
    case "7": return { from: f(subDays(hoy, 6)), to: f(hoy) }
    case "30": return { from: f(subDays(hoy, 29)), to: f(hoy) }
    case "semana": return { from: f(startOfWeek(hoy, { weekStartsOn: 1 })), to: f(hoy) }
    case "mes": return { from: f(startOfMonth(hoy)), to: f(hoy) }
    case "mesAnterior": { const m = subMonths(hoy, 1); return { from: f(startOfMonth(m)), to: f(endOfMonth(m)) } }
    default: return custom
  }
}

export function MuestreoResumen({ plants }: { plants: { id: string; name: string }[] }) {
  const [preset, setPreset] = useState("30")
  const [custom, setCustom] = useState({ from: format(subDays(new Date(), 29), "yyyy-MM-dd"), to: format(new Date(), "yyyy-MM-dd") })
  const [filas, setFilas] = useState<Fila[]>([])
  const [semanas, setSemanas] = useState<{ semana: string; planta: string; m3: number; camiones: number; muestras: number }[]>([])
  const [loading, setLoading] = useState(true)

  const rango = useMemo(() => rangoDe(preset, custom), [preset, custom])

  useEffect(() => {
    if (!rango.from || !rango.to) return
    let vivo = true
    ;(async () => {
      setLoading(true)
      const supabase = createClient()
      const [{ data: desp }, { data: probetas }] = await Promise.all([
        supabase
          .from("dispatches")
          .select("id, plant_id, quantity_m3, dispatch_date, is_test_dispatch")
          .gte("dispatch_date", `${rango.from}T00:00:00-03:00`)
          .lte("dispatch_date", `${rango.to}T23:59:59-03:00`)
          .limit(10000),
        supabase.from("test_cylinders").select("dispatch_id").limit(20000),
      ])
      if (!vivo) return
      const conMuestra = new Set((probetas || []).map((p: any) => p.dispatch_id))
      const nombre: Record<string, string> = {}
      plants.forEach((p) => (nombre[p.id] = p.name))

      const porPlanta: Record<string, Fila> = {}
      const porSemana: Record<string, { semana: string; planta: string; m3: number; camiones: number; muestras: number }> = {}
      ;(desp || []).filter((d: any) => !d.is_test_dispatch).forEach((d: any) => {
        const pl = nombre[d.plant_id] || "Sin planta"
        const fila = (porPlanta[pl] = porPlanta[pl] || { planta: pl, m3: 0, camiones: 0, muestras: 0 })
        fila.m3 += Number(d.quantity_m3 || 0)
        fila.camiones += 1
        if (conMuestra.has(d.id)) fila.muestras += 1
        const sem = format(startOfWeek(new Date(d.dispatch_date), { weekStartsOn: 1 }), "yyyy-MM-dd")
        const k = `${sem}|${pl}`
        const s = (porSemana[k] = porSemana[k] || { semana: sem, planta: pl, m3: 0, camiones: 0, muestras: 0 })
        s.m3 += Number(d.quantity_m3 || 0); s.camiones += 1; if (conMuestra.has(d.id)) s.muestras += 1
      })
      setFilas(Object.values(porPlanta).sort((a, b) => b.m3 - a.m3))
      setSemanas(Object.values(porSemana).sort((a, b) => b.semana.localeCompare(a.semana) || a.planta.localeCompare(b.planta)))
      setLoading(false)
    })()
    return () => { vivo = false }
  }, [rango.from, rango.to, plants])

  const total = filas.reduce((t, f) => ({ planta: "Total", m3: t.m3 + f.m3, camiones: t.camiones + f.camiones, muestras: t.muestras + f.muestras }), { planta: "Total", m3: 0, camiones: 0, muestras: 0 } as Fila)
  const fmt = (n: number, d = 0) => n.toLocaleString("es-AR", { maximumFractionDigits: d })

  const Celda = ({ f, bold }: { f: Fila; bold?: boolean }) => {
    const objetivo = Math.floor(f.camiones / CAMIONES_POR_MUESTRA)
    const pct = objetivo > 0 ? (f.muestras / objetivo) * 100 : null
    const cadaCam = f.muestras > 0 ? f.camiones / f.muestras : null
    const cadaM3 = f.muestras > 0 ? f.m3 / f.muestras : null
    return (
      <div className={cn("grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-x-4 px-3 py-2 text-sm", bold ? "font-semibold border-t mt-1 pt-2" : "rounded-md bg-muted/40")}>
        <span className="truncate">{f.planta}</span>
        <span className="text-right tabular-nums w-20">{fmt(f.m3)} m³</span>
        <span className="text-right tabular-nums w-16 text-muted-foreground">{f.camiones} cam.</span>
        <span className={cn("text-right tabular-nums w-20", f.muestras === 0 && f.camiones > 0 && "text-red-600 font-semibold")}>{f.muestras} {f.muestras === 1 ? "muestra" : "muestras"}</span>
        <span className="text-right text-xs text-muted-foreground w-36 whitespace-nowrap">
          {cadaCam !== null ? `1 cada ${fmt(cadaCam, 1)} cam. · ${fmt(cadaM3)} m³` : f.camiones > 0 ? "sin muestras" : "—"}
        </span>
        <span className="w-24 text-right">
          {pct === null ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            <Badge className={cn("text-[11px] tabular-nums", pct >= 100 ? "bg-emerald-600" : pct >= 60 ? "bg-amber-500" : "bg-red-600")}>
              {fmt(pct)}% de {objetivo}
            </Badge>
          )}
        </span>
      </div>
    )
  }

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <Beaker className="h-4 w-4" /> Muestreo vs. despachos
            <span className="text-xs font-normal text-muted-foreground">objetivo: 1 muestra cada {CAMIONES_POR_MUESTRA} camiones</span>
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex rounded-lg border p-0.5 text-xs">
              {PRESETS.map((p) => (
                <button key={p.v} onClick={() => setPreset(p.v)} className={cn("px-2.5 py-1 rounded-md whitespace-nowrap", preset === p.v && "bg-muted font-medium")}>{p.l}</button>
              ))}
            </div>
            {preset === "custom" && (
              <div className="flex items-center gap-1">
                <Input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="h-8 w-[140px] text-xs" />
                <span className="text-xs text-muted-foreground">a</span>
                <Input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="h-8 w-[140px] text-xs" />
              </div>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Del {format(new Date(rango.from + "T12:00:00"), "dd/MM/yyyy")} al {format(new Date(rango.to + "T12:00:00"), "dd/MM/yyyy")} · una muestra = un camión con su juego de probetas
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <p className="text-sm text-muted-foreground py-4">Calculando...</p>
        ) : filas.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 flex items-center gap-2"><Truck className="h-4 w-4" /> No hubo despachos en el período.</p>
        ) : (
          <>
            <div className="space-y-1">
              {filas.map((f) => <Celda key={f.planta} f={f} />)}
              {filas.length > 1 && <Celda f={total} bold />}
            </div>
            {semanas.length > 1 && (
              <details className="mt-3">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">Ver por semana</summary>
                <div className="mt-2 space-y-0.5">
                  {semanas.map((s) => {
                    const obj = Math.floor(s.camiones / CAMIONES_POR_MUESTRA)
                    const pct = obj > 0 ? (s.muestras / obj) * 100 : null
                    return (
                      <div key={`${s.semana}|${s.planta}`} className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-x-4 items-center text-xs px-3 py-1">
                        <span className="text-muted-foreground w-24">Sem. {format(new Date(s.semana + "T12:00:00"), "dd/MM")}</span>
                        <span>{s.planta}</span>
                        <span className="text-right tabular-nums w-16">{fmt(s.m3)} m³</span>
                        <span className="text-right tabular-nums w-14 text-muted-foreground">{s.camiones} cam.</span>
                        <span className={cn("text-right tabular-nums w-20", s.muestras === 0 && "text-red-600 font-semibold")}>{s.muestras} muestras</span>
                        <span className={cn("text-right w-16 tabular-nums", pct !== null && (pct >= 100 ? "text-emerald-600" : pct >= 60 ? "text-amber-600" : "text-red-600"))}>{pct !== null ? `${fmt(pct)}%` : "—"}</span>
                      </div>
                    )
                  })}
                </div>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
