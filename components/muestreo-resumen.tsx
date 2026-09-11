"use client"

/**
 * Muestras sacadas vs. camiones y m³ despachados, por planta.
 * Una muestra = un camión con su juego de probetas (un Probeta ID).
 * Objetivo de la planta: 1 muestra cada 3 camiones.
 */

import { useState, useEffect, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ChevronLeft, ChevronRight, Beaker, CalendarDays } from "lucide-react"
import { format, startOfMonth, endOfMonth, addMonths, subMonths, startOfWeek, isSameMonth, parseISO } from "date-fns"
import { es } from "date-fns/locale"
import { cn } from "@/lib/utils"

const CAMIONES_POR_MUESTRA = 3

type Planta = { planta: string; m3: number; camiones: number; muestras: number; semanas: { semana: string; camiones: number; muestras: number; m3: number }[] }

const f = (n: number, d = 0) => n.toLocaleString("es-AR", { maximumFractionDigits: d })
const ymd = (d: Date) => format(d, "yyyy-MM-dd")

export function MuestreoResumen({ plants }: { plants: { id: string; name: string }[] }) {
  const hoy = new Date()
  const [rango, setRango] = useState<{ from: string; to: string }>({ from: ymd(startOfMonth(hoy)), to: ymd(hoy) })
  const [datos, setDatos] = useState<Planta[]>([])
  const [loading, setLoading] = useState(true)
  const [fechasLibres, setFechasLibres] = useState(false)

  // El rango es un mes calendario cuando arranca el 1 y termina a fin de mes (o hoy, si es el mes actual)
  const desde = parseISO(rango.from), hasta = parseISO(rango.to)
  const esMes = rango.from === ymd(startOfMonth(desde)) && (rango.to === ymd(endOfMonth(desde)) || (isSameMonth(desde, hoy) && rango.to === ymd(hoy)))
  const irMes = (d: Date) => {
    const ini = startOfMonth(d)
    setRango({ from: ymd(ini), to: isSameMonth(ini, hoy) ? ymd(hoy) : ymd(endOfMonth(ini)) })
  }

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
      const acc: Record<string, Planta> = {}
      ;(desp || []).filter((d: any) => !d.is_test_dispatch).forEach((d: any) => {
        const pl = nombre[d.plant_id] || "Sin planta"
        const p = (acc[pl] = acc[pl] || { planta: pl, m3: 0, camiones: 0, muestras: 0, semanas: [] })
        const m3 = Number(d.quantity_m3 || 0), tiene = conMuestra.has(d.id)
        p.m3 += m3; p.camiones += 1; if (tiene) p.muestras += 1
        const sem = ymd(startOfWeek(new Date(d.dispatch_date), { weekStartsOn: 1 }))
        let s = p.semanas.find((x) => x.semana === sem)
        if (!s) { s = { semana: sem, camiones: 0, muestras: 0, m3: 0 }; p.semanas.push(s) }
        s.camiones += 1; s.m3 += m3; if (tiene) s.muestras += 1
      })
      Object.values(acc).forEach((p) => p.semanas.sort((a, b) => a.semana.localeCompare(b.semana)))
      setDatos(Object.values(acc).sort((a, b) => b.m3 - a.m3))
      setLoading(false)
    })()
    return () => { vivo = false }
  }, [rango.from, rango.to, plants])

  const titulo = useMemo(() => {
    if (esMes) { const t = format(desde, "MMMM yyyy", { locale: es }); return t.charAt(0).toUpperCase() + t.slice(1) }
    return `${format(desde, "dd/MM/yyyy")} al ${format(hasta, "dd/MM/yyyy")}`
  }, [rango.from, rango.to])

  return (
    <div className="mb-6 space-y-3">
      {/* Período */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => irMes(subMonths(desde, 1))}><ChevronLeft className="h-4 w-4" /></Button>
          <h3 className="text-lg font-semibold min-w-[200px] text-center">{titulo}</h3>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => irMes(addMonths(desde, 1))} disabled={isSameMonth(desde, hoy) && esMes}><ChevronRight className="h-4 w-4" /></Button>
          {!(esMes && isSameMonth(desde, hoy)) && (
            <Button variant="ghost" size="sm" className="ml-1 text-xs" onClick={() => irMes(hoy)}>Este mes</Button>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          <span className="hidden sm:inline">Objetivo: 1 muestra cada {CAMIONES_POR_MUESTRA} camiones</span>
          {fechasLibres ? (
            <div className="flex items-center gap-1">
              <Input type="date" value={rango.from} max={rango.to} onChange={(e) => e.target.value && setRango((r) => ({ ...r, from: e.target.value }))} className="h-8 w-[135px] text-xs" />
              <span>a</span>
              <Input type="date" value={rango.to} min={rango.from} max={ymd(hoy)} onChange={(e) => e.target.value && setRango((r) => ({ ...r, to: e.target.value }))} className="h-8 w-[135px] text-xs" />
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setFechasLibres(false); irMes(hoy) }}>Cerrar</Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setFechasLibres(true)}>
              <CalendarDays className="h-3.5 w-3.5" /> Otras fechas
            </Button>
          )}
        </div>
      </div>

      {/* Una tarjeta por planta */}
      {loading ? (
        <p className="text-sm text-muted-foreground py-3">Calculando...</p>
      ) : datos.length === 0 ? (
        <p className="text-sm text-muted-foreground py-3">No hubo despachos en el período.</p>
      ) : (
        <div className={cn("grid gap-3", datos.length > 1 ? "md:grid-cols-2" : "")}>
          {datos.map((p) => {
            const objetivo = Math.floor(p.camiones / CAMIONES_POR_MUESTRA)
            const pct = objetivo > 0 ? Math.min(100, (p.muestras / objetivo) * 100) : null
            const cada = p.muestras > 0 ? p.camiones / p.muestras : null
            const color = pct === null ? "bg-slate-400" : pct >= 100 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500"
            const texto = pct === null ? "text-slate-500" : pct >= 100 ? "text-emerald-600" : pct >= 60 ? "text-amber-600" : "text-red-600"
            const maxSem = Math.max(1, ...p.semanas.map((s) => s.camiones))
            return (
              <Card key={p.planta} className="overflow-hidden">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-muted-foreground flex items-center gap-1.5"><Beaker className="h-4 w-4" />{p.planta}</p>
                      <p className="mt-1 flex items-baseline gap-2">
                        <span className={cn("text-4xl font-bold tracking-tight tabular-nums", p.muestras === 0 && p.camiones > 0 && "text-red-600")}>{p.muestras}</span>
                        <span className="text-base text-muted-foreground">{p.muestras === 1 ? "muestra" : "muestras"}</span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        en <strong className="text-foreground">{p.camiones}</strong> camiones · <strong className="text-foreground">{f(p.m3)}</strong> m³
                      </p>
                      <p className="mt-1 text-sm font-medium">
                        {cada !== null ? <>1 cada {f(cada, 1)} camiones <span className="text-muted-foreground font-normal">· 1 cada {f(p.m3 / p.muestras)} m³</span></> : p.camiones > 0 ? <span className="text-red-600">Sin muestras en el período</span> : "Sin despachos"}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={cn("text-3xl font-bold tabular-nums", texto)}>{pct === null ? "—" : `${f(pct)}%`}</p>
                      <p className="text-xs text-muted-foreground">del objetivo{objetivo > 0 && <> ({objetivo})</>}</p>
                    </div>
                  </div>

                  <div className="mt-3 h-2 w-full rounded-full bg-muted overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct ?? 0}%` }} />
                  </div>

                  {/* Semanas: camiones (gris) y muestras (color) */}
                  {p.semanas.length > 1 && (
                    <div className="mt-4">
                      <div className="flex items-end gap-2 h-16">
                        {p.semanas.map((s) => {
                          const obj = Math.floor(s.camiones / CAMIONES_POR_MUESTRA)
                          const ok = obj === 0 ? null : s.muestras >= obj ? "ok" : s.muestras >= obj * 0.6 ? "medio" : "bajo"
                          return (
                            <div key={s.semana} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`Semana del ${format(parseISO(s.semana), "dd/MM")}: ${s.muestras} muestras en ${s.camiones} camiones (${f(s.m3)} m³)`}>
                              <div className="relative w-full flex items-end justify-center" style={{ height: 44 }}>
                                <div className="w-full rounded-t bg-muted" style={{ height: `${(s.camiones / maxSem) * 100}%` }} />
                                <div
                                  className={cn("absolute bottom-0 w-full rounded-t", ok === "ok" ? "bg-emerald-500" : ok === "medio" ? "bg-amber-500" : ok === "bajo" ? "bg-red-500" : "bg-slate-400")}
                                  style={{ height: `${(s.muestras * CAMIONES_POR_MUESTRA / maxSem) * 100}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-muted-foreground whitespace-nowrap">{format(parseISO(s.semana), "dd/MM")}</span>
                            </div>
                          )
                        })}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">Por semana: en gris los camiones, en color las muestras (a escala de 1 cada {CAMIONES_POR_MUESTRA}). Pasá el mouse para ver los números.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
