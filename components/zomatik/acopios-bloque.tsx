"use client"

/**
 * Zomatik Z0 · Bloque "Acopios" abajo de la grilla de Programación (Semana y Día), como en la maqueta
 * (docs/migracion-loop/maqueta-zomatik.html). Solo lectura de la copia local: proyectos abiertos de Zomatik con
 * lo remitido en m³, el saldo en % y ≈ m³, lo programado contra la obra vinculada y los avisos (saldo bajo con
 * 7 días o 15 %, agotado). Sin precios ni $ (spec 20.1). Cada fila se despliega al detalle por día.
 * "Actualizar" (vuelve a leer Zomatik) y "Vínculos", solo gerenciales.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ChevronDown, ChevronRight, ExternalLink, Link2, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { usePermisos } from "@/lib/current-user"
import { cn } from "@/lib/utils"
import { detallePorDia, estadoAcopio, m3, programadoDesde, saldoAcopio, DIAS_AVISO, PCT_AVISO, type EstadoAcopio } from "@/lib/zomatik/acopios"
import { ZOMATIK_WEB } from "@/lib/zomatik/web"

type Proyecto = {
  codigo: number
  numero: string
  comprobante: string | null
  cliente_codigo: number | null
  cliente_nombre: string | null
  obra: string | null
  fecha: string | null
  tipo: "monto" | "cantidades" | null
  pactado_m3: number | null
  saldo_pct: number | null
  remitido_m3: number
  ultima_entrega: string | null
  estado: string
  construction_site_id: string | null
}
type Mov = { fecha: string; remito: string; pedido: string | null; articulo: string | null; m3: number; deposito: string | null; es_hormigon: boolean }

const hoyAR = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
const fechaCorta = (f: string | null | undefined) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : "—")
const pct = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`)

const TAG: Record<EstadoAcopio, { texto: string; cls: string }> = {
  abierto: { texto: "Abierto", cls: "bg-green-100 text-green-800" },
  bajo: { texto: "Saldo bajo", cls: "bg-amber-100 text-amber-800" },
  agotado: { texto: "Agotado", cls: "bg-red-100 text-red-800" },
  cerrado: { texto: "Cerrado", cls: "bg-muted text-muted-foreground" },
}

export function AcopiosBloque() {
  const { esGerencial } = usePermisos()
  const [proyectos, setProyectos] = useState<Proyecto[] | null>(null)
  const [obras, setObras] = useState<Map<string, { name: string; cliente: string }>>(new Map())
  const [clientesZ, setClientesZ] = useState<Map<number, string>>(new Map())
  const [programado, setProgramado] = useState<Map<string, { fecha: string; m3: number }[]>>(new Map())
  const [lectura, setLectura] = useState<{ fin: string; ok: boolean | null; error: string | null } | null>(null)
  const [filtro, setFiltro] = useState<"activos" | "todos">("activos")
  const [abierto, setAbierto] = useState<number | null>(null)
  const [movs, setMovs] = useState<Record<string, Mov[]>>({})
  const [verTodas, setVerTodas] = useState(false)
  const [actualizando, setActualizando] = useState(false)

  const cargar = useCallback(async () => {
    const sb = createClient()
    // Proyectos y última lectura: por el servidor, con sesión (el navegador no lee la copia de proyectos)
    const rp = await fetch("/api/zomatik/acopios", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    if (!rp?.proyectos) {
      setProyectos(null) // sin la migración o sin permiso: el bloque no se muestra
      return
    }
    const ps = rp.proyectos
    const lista = ((ps as any[]) || []).map((p) => ({ ...p, remitido_m3: Number(p.remitido_m3) || 0, saldo_pct: p.saldo_pct === null ? null : Number(p.saldo_pct), pactado_m3: p.pactado_m3 === null ? null : Number(p.pactado_m3) })) as Proyecto[]
    setProyectos(lista)
    const obraIds = [...new Set(lista.map((p) => p.construction_site_id).filter(Boolean))] as string[]
    const codigos = [...new Set(lista.map((p) => p.cliente_codigo).filter((c) => c != null))] as number[]
    const [os, cs, sd] = await Promise.all([
      obraIds.length ? sb.from("construction_sites").select("id, name, clients(name)").in("id", obraIds) : Promise.resolve({ data: [] as any[] }),
      codigos.length ? (sb as any).from("clients").select("name, zomatik_codigo").in("zomatik_codigo", codigos) : Promise.resolve({ data: [] as any[] }),
      obraIds.length
        ? sb
            .from("scheduled_dispatches")
            .select("construction_site_id, quantity_m3, dispatched_m3, scheduled_arrival_time, status")
            .in("construction_site_id", obraIds)
            .gte("scheduled_arrival_time", `${hoyAR()}T03:00:00Z`)
            .not("status", "in", "(cancelled,completed)")
            .is("suspendido_at", null) // los suspendidos (lluvia) no cuentan como programado
        : Promise.resolve({ data: [] as any[] }),
    ])
    setObras(new Map(((os.data as any[]) || []).map((o) => [o.id, { name: o.name, cliente: o.clients?.name || "" }])))
    setClientesZ(new Map(((cs.data as any[]) || []).map((c) => [Number(c.zomatik_codigo), c.name])))
    const prog = new Map<string, { fecha: string; m3: number }[]>()
    for (const d of (sd.data as any[]) || []) {
      const resta = Math.max(0, (Number(d.quantity_m3) || 0) - (Number(d.dispatched_m3) || 0))
      if (!resta) continue
      const fecha = new Date(new Date(d.scheduled_arrival_time).getTime() - 3 * 3600_000).toISOString().slice(0, 10)
      prog.set(d.construction_site_id, [...(prog.get(d.construction_site_id) || []), { fecha, m3: resta }])
    }
    setProgramado(prog)
    setLectura(rp.lectura || null)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const hoy = hoyAR()
  const filas = useMemo(() => {
    if (!proyectos) return []
    const limite90 = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10)
    return proyectos
      .map((p) => {
        const prog = programadoDesde(p.construction_site_id ? programado.get(p.construction_site_id) || [] : [], hoy)
        const saldo = saldoAcopio(p)
        const estado = estadoAcopio(p, prog.proximos)
        const obra = p.construction_site_id ? obras.get(p.construction_site_id) : undefined
        const cliente = obra?.cliente || (p.cliente_codigo != null ? clientesZ.get(p.cliente_codigo) : undefined) || p.cliente_nombre || "—"
        return { p, prog, saldo, estado, cliente, obraNombre: obra?.name || p.obra || "", vinculada: !!obra }
      })
      .filter((f) => filtro === "todos" || (f.p.ultima_entrega && f.p.ultima_entrega >= limite90) || f.prog.total > 0)
  }, [proyectos, programado, obras, clientesZ, filtro, hoy])

  async function abrir(p: Proyecto) {
    setVerTodas(false)
    if (abierto === p.codigo) {
      setAbierto(null)
      return
    }
    setAbierto(p.codigo)
    if (!movs[p.numero]) {
      const r = await fetch(`/api/zomatik/acopios?movimientos=${encodeURIComponent(p.numero)}`, { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null)
      const data = r?.movimientos || []
      setMovs((m) => ({ ...m, [p.numero]: ((data as any[]) || []).map((x) => ({ ...x, m3: Number(x.m3) || 0 })) }))
    }
  }

  async function actualizar() {
    setActualizando(true)
    try {
      const r = await fetch("/api/zomatik/leer", { method: "POST" })
      const d = await r.json().catch(() => ({}))
      if (r.ok) toast.success("Actualizado desde Zomatik")
      else toast.error(d?.error || (d?.errores || []).join(" · ") || "No se pudo leer Zomatik")
      setMovs({})
      await cargar()
    } finally {
      setActualizando(false)
    }
  }

  if (!proyectos) return null
  const leido = lectura?.fin
    ? new Date(lectura.fin).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" })
    : null

  return (
    <div className="rounded-lg border bg-card text-sm" id="acopios">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <h2 className="font-semibold">Acopios</h2>
        <span className="rounded bg-violet-100 px-1.5 text-[11px] font-medium text-violet-800">Zomatik</span>
        <span className="text-xs text-muted-foreground">
          Proyectos abiertos de Zomatik · {leido ? `leído ${leido}` : "todavía sin leer"} · en m³
          {lectura && lectura.ok === false && <span className="ml-1 text-red-700">· la última lectura tuvo errores</span>}
        </span>
        <span className="flex-1" />
        <select className="h-7 rounded border bg-background px-1.5 text-xs" value={filtro} onChange={(e) => setFiltro(e.target.value as any)}>
          <option value="activos">Con entregas en 90 días o programado</option>
          <option value="todos">Todos los abiertos ({proyectos.length})</option>
        </select>
        {esGerencial && (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={actualizar} disabled={actualizando}>
            {actualizando ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
            Actualizar
          </Button>
        )}
        {esGerencial && (
          <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
            <Link href="/zomatik"><Link2 className="mr-1 h-3 w-3" />Vínculos</Link>
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled title="Por ahora los proyectos se cargan en Zomatik">
          + Crear proyecto
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b text-left">
              <th className="w-5 px-2 py-1.5"></th>
              <th className="px-2 py-1.5 font-medium">Proyecto</th>
              <th className="px-2 py-1.5 font-medium">Cliente · obra</th>
              <th className="px-2 py-1.5 text-right font-medium">Remitido</th>
              <th className="w-32 px-2 py-1.5"></th>
              <th className="px-2 py-1.5 text-right font-medium">Saldo</th>
              <th className="px-2 py-1.5 text-right font-medium">Programado</th>
              <th className="px-2 py-1.5 font-medium">Última entrega</th>
              <th className="px-2 py-1.5 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-3 text-center text-muted-foreground">
                  {proyectos.length === 0 ? "Todavía no hay proyectos leídos de Zomatik." : "Ningún acopio con entregas en los últimos 90 días ni programado. Elegí «Todos los abiertos»."}
                </td>
              </tr>
            )}
            {filas.map(({ p, prog, saldo, estado, cliente, obraNombre, vinculada }) => {
              const sel = abierto === p.codigo
              const usado = saldo.consumidoPct ?? 0
              const colorSaldo = estado === "agotado" ? "text-red-700" : estado === "bajo" ? "text-amber-700" : ""
              const detalle = sel ? detallePorDia(movs[p.numero] || []) : []
              const falta = saldo.saldoM3 !== null ? Math.round((prog.proximos - saldo.saldoM3) * 10) / 10 : null
              return (
                <Fragment key={p.codigo}>
                  <tr className={cn("cursor-pointer border-b hover:bg-muted/40", sel && "bg-muted/40")} onClick={() => abrir(p)}>
                    <td className="px-2 py-1.5 text-muted-foreground">{sel ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-semibold">{p.numero}</td>
                    <td className="px-2 py-1.5">
                      <div className="font-medium">{cliente}</div>
                      <div className="text-muted-foreground">
                        {obraNombre || "—"}
                        {!vinculada && <span className="ml-1 text-[10px] text-amber-700">(obra sin vincular)</span>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{m3(p.remitido_m3)} m³</td>
                    <td className="px-2 py-1.5">
                      <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
                        <div className={cn("h-full", estado === "agotado" ? "bg-red-500" : estado === "bajo" ? "bg-amber-500" : "bg-green-600")} style={{ width: `${Math.min(100, Math.max(0, usado))}%` }} />
                      </div>
                      <div className="text-[10px] text-muted-foreground">{saldo.consumidoPct === null ? "—" : `${Math.round(usado)} % usado`}</div>
                    </td>
                    <td className={cn("whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums", colorSaldo)}>
                      {saldo.saldoM3 === null ? "—" : `${saldo.estimado ? "≈ " : ""}${m3(saldo.saldoM3)} m³`}
                      <div className="text-[10px] font-normal text-muted-foreground">{pct(saldo.saldoPct)}</div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{prog.total ? `${m3(prog.total)} m³` : "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{fechaCorta(p.ultima_entrega)}</td>
                    <td className="px-2 py-1.5">
                      <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", TAG[estado].cls)}>{TAG[estado].texto}</span>
                    </td>
                  </tr>
                  {sel && (
                    <tr className="border-b bg-muted/20">
                      <td></td>
                      <td colSpan={8} className="px-2 pb-3 pt-2">
                        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_280px]">
                          <table className="w-full text-xs">
                            <thead className="text-muted-foreground">
                              <tr className="border-b text-left">
                                <th className="py-1 pr-2 font-medium">Fecha</th>
                                <th className="py-1 pr-2 font-medium">Remito</th>
                                <th className="py-1 pr-2 font-medium">Fórmula</th>
                                <th className="py-1 pr-2 text-right font-medium">m³</th>
                                <th className="py-1 text-right font-medium">Remitido acumulado</th>
                              </tr>
                            </thead>
                            <tbody>
                              {!movs[p.numero] && (
                                <tr><td colSpan={5} className="py-2 text-muted-foreground"><Loader2 className="inline h-3 w-3 animate-spin" /> Cargando…</td></tr>
                              )}
                              {movs[p.numero] && detalle.length === 0 && (
                                <tr><td colSpan={5} className="py-2 text-muted-foreground">Sin remitos de hormigón contra este proyecto.</td></tr>
                              )}
                              {(verTodas ? detalle : detalle.slice(0, 8)).map((m) => (
                                <tr key={`${m.remito}-${m.articulo}`} className="border-b border-muted">
                                  <td className="py-1 pr-2 tabular-nums">{fechaCorta(m.fecha)}/{m.fecha.slice(2, 4)}</td>
                                  <td className="py-1 pr-2">{m.remito}</td>
                                  <td className="py-1 pr-2">{m.articulo}</td>
                                  <td className="py-1 pr-2 text-right tabular-nums">{m3(m.m3)}</td>
                                  <td className="py-1 text-right tabular-nums">{m3(m.acumulado)}</td>
                                </tr>
                              ))}
                              {!verTodas && detalle.length > 8 && (
                                <tr>
                                  <td colSpan={5} className="py-1 text-muted-foreground">
                                    … {detalle.length - 8} entregas más desde el {fechaCorta(detalle[detalle.length - 1].fecha)}/{detalle[detalle.length - 1].fecha.slice(2, 4)} ·{" "}
                                    <button className="text-blue-700 underline" onClick={(e) => { e.stopPropagation(); setVerTodas(true) }}>ver todas</button>
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                          <div className="space-y-2 rounded-md border bg-background p-2">
                            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                              <span className="text-muted-foreground">Remitido</span><span className="tabular-nums">{m3(p.remitido_m3)} m³</span>
                              <span className="text-muted-foreground">Saldo</span>
                              <span className="font-semibold tabular-nums">{saldo.saldoM3 === null ? "—" : `${saldo.estimado ? "≈ " : ""}${m3(saldo.saldoM3)} m³`} ({pct(saldo.saldoPct)})</span>
                              <span className="text-muted-foreground">Programado</span>
                              <span className="tabular-nums">{prog.total ? `${m3(prog.total)} m³ (${m3(prog.proximos)} en ${DIAS_AVISO} días)` : "—"}</span>
                            </div>
                            {saldo.estimado ? (
                              <p className="text-[11px] text-muted-foreground">≈ estimado: el proyecto está cargado por monto en Zomatik. Si se carga por m³, el saldo es exacto.</p>
                            ) : (
                              <p className="text-[11px] text-muted-foreground">Proyecto por m³: saldo exacto (pactado {m3(p.pactado_m3)} m³).</p>
                            )}
                            {!vinculada && <p className="text-[11px] text-amber-700">El proyecto no está vinculado a una obra de Rebucret: no se puede sumar lo programado.{esGerencial ? " Vinculalo en Vínculos." : ""}</p>}
                            {estado === "bajo" && (
                              <div className="rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
                                {falta !== null && falta > 0
                                  ? `Quedan ≈ ${m3(saldo.saldoM3)} m³ y hay ${m3(prog.proximos)} m³ programados en los próximos ${DIAS_AVISO} días: faltan ≈ ${m3(falta)} m³. `
                                  : `Le queda menos del ${PCT_AVISO} % del material. `}
                                Zomatik no va a dejar fabricar ni remitir lo que pase el saldo. Avisarle al vendedor para ampliar el proyecto.
                              </div>
                            )}
                            {estado === "agotado" && (
                              <div className="rounded bg-red-50 px-2 py-1.5 text-[11px] text-red-900">
                                Acopio agotado según Zomatik. No se pueden generar más NP contra este proyecto: lo que se programe va en una NP nueva común.
                              </div>
                            )}
                            <a
                              href={`${ZOMATIK_WEB}/reporte_detalleproyecto.php?proyecto=${p.codigo}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-blue-700 underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Ver en Zomatik <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-2 text-[11px] text-muted-foreground">
        Por ahora los proyectos se cargan en Zomatik (Clientes › Proyectos). Remitido y saldo salen de Zomatik; programado, de Rebucret (lo que falta
        despachar de los pedidos de la obra vinculada). Saldo ≈: estimado, porque los proyectos están cargados por monto. Saldo bajo: menos del {PCT_AVISO} % o no
        alcanza para lo de los próximos {DIAS_AVISO} días.
      </p>
    </div>
  )
}
