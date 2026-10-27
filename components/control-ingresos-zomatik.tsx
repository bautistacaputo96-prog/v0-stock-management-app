"use client"
/**
 * Materias Primas › Control con Zomatik. Diferencias entre nuestros ingresos y los remitos de compra de Zomatik,
 * por las 4 categorías de Juan. "Revisado" con nota opcional y "Controlar ahora". Todo por /api/control-ingresos
 * (la base no la lee el navegador). Docs: docs/control-ingresos-mp.md.
 */
import { useCallback, useEffect, useState } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CATEGORIAS, ddmm, proveedoresTexto, type Lado } from "@/lib/control-ingresos/cruce"

type Dif = {
  id: string
  categoria: string
  tipo: string
  fecha: string
  plant_id: string | null
  detalle: string
  nuestro: Lado[]
  zomatik: Lado[]
  estado: "abierta" | "revisada" | "resuelta"
  nota: string | null
  revisada_por: string | null
  revisada_at: string | null
  resuelta_at: string | null
}
type Corrida = { inicio: string; fin: string | null; ok: boolean | null; origen: string; usuario: string | null; error: string | null; mail_at: string | null }

const fmtT = (l: Lado) => (l.unidad === "t" ? `${l.t.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} t` : `${l.t.toLocaleString("es-AR")}${l.unidad ? ` ${l.unidad}` : ""}`)
const unico = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x && !!x.trim()))].join(" / ") || "-"
const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }) : "-"

function CeldaLado({ ls }: { ls: Lado[] }) {
  if (!ls.length) return <span className="text-muted-foreground">no está</span>
  return (
    <div className="space-y-0.5">
      {ls.map((l) => (
        <div key={l.ref}>
          {l.remito || "sin Nº"} · {fmtT(l)}
          <span className="text-muted-foreground"> · {l.planta} {ddmm(l.fecha)}</span>
        </div>
      ))}
    </div>
  )
}

export function ControlIngresosZomatik({ plants }: { plants: { id: string; name: string }[] }) {
  const [planta, setPlanta] = useState("all")
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")
  const [estado, setEstado] = useState<"abierta" | "revisada" | "resuelta">("abierta")
  const [difs, setDifs] = useState<Dif[] | null>(null)
  const [corrida, setCorrida] = useState<Corrida | null>(null)
  const [porEstado, setPorEstado] = useState<Record<string, number>>({})
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [controlando, setControlando] = useState(false)
  const [notas, setNotas] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setErr(null)
    const p = new URLSearchParams({ estado })
    if (planta !== "all") p.set("planta", planta)
    if (desde) p.set("desde", desde)
    if (hasta) p.set("hasta", hasta)
    try {
      const r = await fetch(`/api/control-ingresos?${p}`, { cache: "no-store" })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErr(j?.error || `Error ${r.status}`)
        setDifs([])
        return
      }
      setDifs(j.diferencias || [])
      setCorrida(j.ultimaCorrida || null)
      setPorEstado(j.porEstado || {})
    } catch {
      setErr("No se pudo cargar. Probá de nuevo.")
      setDifs([])
    }
  }, [estado, planta, desde, hasta])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function controlarAhora() {
    setControlando(true)
    setErr(null)
    setMsg(null)
    try {
      const r = await fetch("/api/control-ingresos/controlar", { method: "POST" })
      const j = await r.json().catch(() => ({}))
      if (j?.resumen) setMsg(`Listo: ${j.resumen.total} diferencias, ${j.resumen.nuevas} nuevas, ${j.resumen.resueltas} resueltas.`)
      const problema = j?.error || j?.motivo || j?.lectura?.error
      if (problema) setErr(problema)
    } catch {
      setErr("No se pudo controlar. Probá de nuevo en un rato.")
    }
    setControlando(false)
    cargar()
  }

  async function cambiar(d: Dif, accion: "revisar" | "reabrir") {
    setGuardando(d.id)
    setErr(null)
    try {
      const r = await fetch("/api/control-ingresos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: d.id, accion, nota: notas[d.id] || null }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) setErr(j?.error || `Error ${r.status}`)
    } catch {
      setErr("No se pudo guardar. Probá de nuevo.")
    }
    setGuardando(null)
    cargar()
  }

  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <select className="h-7 rounded-md border bg-background px-2 text-xs" value={planta} onChange={(e) => setPlanta(e.target.value)}>
          <option value="all">Todas las plantas</option>
          {plants.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Input type="date" className="h-7 w-36 text-xs" value={desde} onChange={(e) => setDesde(e.target.value)} title="Desde" />
        <Input type="date" className="h-7 w-36 text-xs" value={hasta} onChange={(e) => setHasta(e.target.value)} title="Hasta" />
        <div className="flex rounded-md border">
          {(["abierta", "revisada", "resuelta"] as const).map((e) => (
            <button key={e} className={`h-7 px-2 ${estado === e ? "bg-muted" : "text-muted-foreground"}`} onClick={() => setEstado(e)}>
              {e === "abierta" ? "Abiertas" : e === "revisada" ? "Revisadas" : "Resueltas"} ({porEstado[e] ?? 0})
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={controlando} onClick={controlarAhora}>
          {controlando ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Controlar ahora
        </Button>
        <span
          className="cursor-help text-muted-foreground"
          title="Cruza los remitos de materia prima de nuestro sistema con los de Zomatik (REBUCRET, Canning y Hudson) desde el 01/08/2026, últimos 90 días. Toneladas iguales ±0,02; la fecha puede variar ±3 días; lo de los últimos 2 días no se avisa como faltante. Todos los días a las 16:25 le llega el mail a Juan con lo abierto. Lo revisado no vuelve al mail; lo que se corrige en cualquiera de los dos sistemas pasa solo a resuelto."
        >
          (?)
        </span>
      </div>

      <div className="text-muted-foreground">
        {corrida
          ? `Último control: ${hora(corrida.inicio)} (${corrida.origen === "cron" ? "diario" : corrida.usuario || "a mano"})${corrida.fin ? "" : " · en curso"}${corrida.mail_at ? ` · mail ${hora(corrida.mail_at)}` : ""}`
          : "Todavía no se corrió el control."}
        {corrida?.error ? <span className="text-amber-700"> · {corrida.error}</span> : null}
      </div>
      {msg && <div className="text-emerald-700">{msg}</div>}
      {err && <div className="text-red-700">{err}</div>}

      {!difs ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : difs.length === 0 ? (
        <div className="text-muted-foreground">No hay diferencias {estado === "abierta" ? "abiertas" : estado === "revisada" ? "revisadas" : "resueltas"} con estos filtros.</div>
      ) : (
        CATEGORIAS.map((c) => {
          const ds = difs.filter((d) => d.categoria === c.clave)
          if (!ds.length) return null
          return (
            <div key={c.clave}>
              <div className="mb-1">
                {c.titulo} ({ds.length})
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="px-1.5 py-1 font-normal">Fecha</th>
                      <th className="px-1.5 py-1 font-normal">Material</th>
                      <th className="px-1.5 py-1 font-normal">Nuestro sistema</th>
                      <th className="px-1.5 py-1 font-normal">Zomatik</th>
                      <th className="px-1.5 py-1 font-normal">Proveedor</th>
                      <th className="px-1.5 py-1 font-normal">Transportista</th>
                      <th className="px-1.5 py-1 font-normal">Qué pasa</th>
                      <th className="w-64 px-1.5 py-1 font-normal"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {ds.map((d) => {
                      const todos = [...d.nuestro, ...d.zomatik]
                      return (
                        <tr key={d.id} className="border-b align-top">
                          <td className="px-1.5 py-1">{ddmm(d.fecha)}</td>
                          <td className="px-1.5 py-1">{unico(todos.map((l) => l.material))}</td>
                          <td className="px-1.5 py-1">
                            <CeldaLado ls={d.nuestro} />
                          </td>
                          <td className="px-1.5 py-1">
                            <CeldaLado ls={d.zomatik} />
                          </td>
                          <td className="px-1.5 py-1">{proveedoresTexto(todos)}</td>
                          <td className="px-1.5 py-1">{unico(todos.map((l) => l.transportista))}</td>
                          <td className="px-1.5 py-1">{d.detalle || "-"}</td>
                          <td className="px-1.5 py-1">
                            {d.estado === "abierta" ? (
                              <div className="flex items-center gap-1">
                                <Input
                                  className="h-7 w-40 text-xs"
                                  placeholder="Nota (opcional)"
                                  value={notas[d.id] || ""}
                                  onChange={(e) => setNotas((n) => ({ ...n, [d.id]: e.target.value }))}
                                />
                                <Button size="sm" className="h-7 px-2 text-xs" disabled={!!guardando} onClick={() => cambiar(d, "revisar")}>
                                  {guardando === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Revisado"}
                                </Button>
                              </div>
                            ) : d.estado === "revisada" ? (
                              <div className="flex items-start gap-1">
                                <span className="text-muted-foreground">
                                  {d.revisada_por} {hora(d.revisada_at)}
                                  {d.nota ? ` · ${d.nota}` : ""}
                                </span>
                                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" disabled={!!guardando} onClick={() => cambiar(d, "reabrir")}>
                                  Reabrir
                                </Button>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">Resuelta {hora(d.resuelta_at)}{d.nota ? ` · ${d.nota}` : ""}</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
