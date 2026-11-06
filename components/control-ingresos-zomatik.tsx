"use client"
/**
 * Materias Primas › Control con Zomatik. Diferencias entre nuestros ingresos y los remitos de compra de Zomatik,
 * por las 4 categorías de Juan. "Revisado" con nota opcional y "Controlar ahora". Todo por /api/control-ingresos
 * (la base no la lee el navegador). Docs: docs/control-ingresos-mp.md.
 *
 * Arriba, el bloque de la importación de ingresos desde Zomatik (docs/ingresos-mp-zomatik.md): en prueba (sombra) qué
 * haría; prendida, lo que no se pudo importar (con "Es el mismo" / "Son distintos" / "Descartar"), los cambios, los
 * cargados a mano sin Zomatik (Eliminar, gerencial) y las densidades de los aditivos. Desde F el cruce viejo queda
 * plegado en "Antes del dd/mm".
 */
import type React from "react"
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
type Importacion = {
  interruptor: { modo: "apagado" | "sombra" | "real"; desde: string | null }
  ultimaPasada: { inicio: string; fin: string | null; ok: boolean | null; origen: string; usuario: string | null; error: string | null; importacion: { texto?: string; motivo?: string; detalle?: { tipo: string; clave: string; texto: string; ok?: boolean; motivo?: string }[] } | null } | null
  pendientes: {
    id: number
    fecha: string | null
    remito: string | null
    proveedor: string | null
    cantidad: string
    planta: string
    motivo: string
    motivo_codigo: string | null
    queHacer: string
    resolucion: string | null
    resuelto_por: string | null
    candidato: { id: string; fecha: string; remito: string | null; cantidad: string; material: string; planta: string } | null
  }[]
  cambios: { creado: string; fecha: string; material: string; planta: string; kg: number; nota: string }[]
  antesDeF: { fecha: string | null; remito: string | null; motivo: string }[]
  noAplicados?: { fecha: string | null; remito: string | null; proveedor: string | null; cantidad: string; planta: string; motivo: string }[]
  manuales: { id: string; fecha: string; material: string; planta: string; cantidad: number; unidad: string; remito: string | null; cargadoPor: string | null; dias: number; remitoZomatik?: string }[]
  copias?: Importacion["manuales"]
  sinVincular: { proveedor: string; renglones: number }[]
  densidades: { material_id: string; material: string; planta: string; densidad: number | null }[]
  error?: string
}

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
  const [sinMaterial, setSinMaterial] = useState<{ articulo: string; codigo: string | null; renglones: number; ultima: string }[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [controlando, setControlando] = useState(false)
  const [notas, setNotas] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState<string | null>(null)
  const [importacion, setImportacion] = useState<Importacion | null>(null)
  const [gerencial, setGerencial] = useState(false)

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
      setSinMaterial(j.sinMaterial || [])
      setImportacion(j.importacion || null)
      setGerencial(!!j.gerencial)
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

  const prendida = importacion?.interruptor?.modo === "real" && !!importacion.interruptor.desde
  const listaDifs = !difs ? (
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
  )

  return (
    <div className="space-y-3 text-xs">
      {importacion && (importacion.interruptor?.modo !== "apagado" || importacion.ultimaPasada) && <BloqueImportacion d={importacion} gerencial={gerencial} onCambio={cargar} />}
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
          title="Cruza los remitos de materia prima de nuestro sistema con los de Zomatik (REBUCRET, Canning y Hudson) desde el 01/08/2026, últimos 90 días. Por ahora se controlan áridos y cemento. Toneladas iguales ±0,02; la fecha sola no cuenta (se empareja con ±10 días); con el mismo número, material y toneladas, un proveedor distinto no cuenta (Fenomix = Cementos Avellaneda); “falta en Zomatik” se avisa después de 7 días y “falta en nuestro sistema” después de 2. Mails: todos los días a las 16:25, a Juan (con copia a Bautista), las inconsistencias de remitos detectadas ese día, o “sin inconsistencias hoy”; los lunes, en su lugar, el semanal con las nuevas, todas las abiertas y la tabla de stock. Lo revisado no vuelve al mail; lo que se corrige en cualquiera de los dos sistemas pasa solo a resuelto."
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
      {sinMaterial.length > 0 && (
        <details className="text-muted-foreground">
          <summary className="cursor-pointer">Artículos de Zomatik sin material ({sinMaterial.length}): no se controlan</summary>
          <div className="mt-1 space-y-0.5 pl-3">
            {sinMaterial.map((a) => (
              <div key={`${a.codigo}|${a.articulo}`}>
                {a.codigo ? `${a.codigo} · ` : ""}
                {a.articulo} · {a.renglones} {a.renglones === 1 ? "renglón" : "renglones"} · último {ddmm(a.ultima)}
              </div>
            ))}
          </div>
        </details>
      )}
      {msg && <div className="text-emerald-700">{msg}</div>}
      {err && <div className="text-red-700">{err}</div>}

      {prendida ? (
        <details>
          <summary className="cursor-pointer text-muted-foreground">
            Antes del {ddmm(importacion!.interruptor.desde)}: el cruce de siempre ({difs?.length ?? 0}). Desde esa fecha los ingresos salen de Zomatik.
          </summary>
          <div className="mt-2 space-y-3">{listaDifs}</div>
        </details>
      ) : (
        listaDifs
      )}
    </div>
  )
}

const fmtKg = (kg: number) => `${kg > 0 ? "+" : ""}${kg.toLocaleString("es-AR", { maximumFractionDigits: 2 })} kg`
const origenPasada = (o: string, u: string | null) => (o === "pasada" ? "automática" : o === "cron" ? "control diario" : o === "traer" ? `Traer de Zomatik, ${u || "a mano"}` : u || "a mano")

/** Bloque de la importación de ingresos desde Zomatik (fases 0 a 2). */
function BloqueImportacion({ d, gerencial, onCambio }: { d: Importacion; gerencial: boolean; onCambio: () => void }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [motivos, setMotivos] = useState<Record<string, string>>({})
  const [dens, setDens] = useState<Record<string, string>>({})
  const modo = d.interruptor?.modo || "apagado"
  const desde = d.interruptor?.desde
  const up = d.ultimaPasada
  const imp = up?.importacion

  async function post(clave: string, body: Record<string, unknown>) {
    setOcupado(clave)
    setErr(null)
    setMsg(null)
    try {
      const r = await fetch("/api/control-ingresos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) setErr(j?.error || `Error ${r.status}`)
      else setMsg(j?.mensaje || "Listo.")
    } catch {
      setErr("No se pudo guardar. Probá de nuevo.")
    }
    setOcupado(null)
    onCambio()
  }

  const titulo =
    modo === "real" ? `Importación desde Zomatik: prendida desde el ${ddmm(desde)}` : modo === "sombra" ? `Importación desde Zomatik: en prueba desde el ${ddmm(desde)} (no carga nada)` : "Importación desde Zomatik: apagada"

  // Función (no componente): así los campos de motivo no pierden el foco al escribir
  const tablaManuales = (filas: Importacion["manuales"]) => (
            <table className="w-full border-collapse">
              <tbody>
                {filas.map((m) => (
                  <tr key={m.id} className="border-b align-top">
                    <td className="px-1.5 py-1">{ddmm(m.fecha)}</td>
                    <td className="px-1.5 py-1">{m.material}</td>
                    <td className="px-1.5 py-1">{m.planta}</td>
                    <td className="px-1.5 py-1">
                      {m.cantidad.toLocaleString("es-AR")} {m.unidad}
                    </td>
                    <td className="px-1.5 py-1">
                      {m.remito || "-"}
                      {m.remitoZomatik ? <span className="text-muted-foreground"> · Zomatik {m.remitoZomatik}</span> : null}
                    </td>
                    <td className="px-1.5 py-1 text-muted-foreground">
                      {m.cargadoPor || "-"} · {m.dias === 0 ? "hoy" : `hace ${m.dias} d`}
                    </td>
                    <td className="px-1.5 py-1">
                      {gerencial && (
                        <div className="flex items-center gap-1">
                          <Input className="h-6 w-36 text-xs" placeholder="Motivo" value={motivos[m.id] || ""} onChange={(e) => setMotivos((x) => ({ ...x, [m.id]: e.target.value }))} />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-1.5 text-xs text-red-700"
                            disabled={!!ocupado || !(motivos[m.id] || "").trim()}
                            onClick={() => post(`m${m.id}`, { id: m.id, accion: "eliminar_manual", motivo: motivos[m.id], kg_visto: m.cantidad })}
                          >
                            {ocupado === `m${m.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : "Eliminar"}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
  )

  return (
    <div className="space-y-2 rounded-md border p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span>{titulo}</span>
        <span
          className="cursor-help text-muted-foreground"
          title="Se lee Zomatik cada 30 min, de 6 a 20 (y a las 5 la lectura completa). Arena, piedra, cemento, aditivos y fibra entran solos desde la fecha de arranque; lo cargado a mano que coincide pasa a ser el de Zomatik. Si Zomatik corrige o anula un remito, acá se corrige con asiento (un remito que falta se anula 2 h después). La humedad y la muestra se cargan en Ingresos."
        >
          (?)
        </span>
      </div>
      {up ? (
        <div className="text-muted-foreground">
          Última lectura: {hora(up.inicio)} ({origenPasada(up.origen, up.usuario)}){up.fin ? "" : " · en curso"}
          {up.error ? <span className="text-amber-700"> · {up.error}</span> : null}
        </div>
      ) : modo !== "apagado" ? (
        <div className="text-muted-foreground">Todavía no corrió ninguna lectura.</div>
      ) : null}
      {d.error && <div className="text-red-700">{d.error}</div>}
      {modo === "sombra" && imp && (
        <div>
          <div>Si estuviera prendida: {imp.texto || imp.motivo || "sin datos"}.</div>
          {!!imp.detalle?.length && (
            <details className="text-muted-foreground">
              <summary className="cursor-pointer">Qué haría ({imp.detalle.length})</summary>
              <div className="mt-1 space-y-0.5 pl-3">
                {imp.detalle.map((x) => (
                  <div key={`${x.tipo}|${x.clave}`}>{x.texto}</div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      {modo === "real" && imp?.texto && <div className="text-muted-foreground">Última pasada: {imp.texto}.</div>}
      {msg && <div className="text-emerald-700">{msg}</div>}
      {err && <div className="text-red-700">{err}</div>}

      {modo === "real" && (
        <>
          <Seccion titulo="No se pudo importar" n={d.pendientes.length}>
            <table className="w-full border-collapse">
              <tbody>
                {d.pendientes.map((p) => (
                  <tr key={p.id} className="border-b align-top">
                    <td className="px-1.5 py-1">{ddmm(p.fecha)}</td>
                    <td className="px-1.5 py-1">{p.remito || "sin Nº"}</td>
                    <td className="px-1.5 py-1">{p.proveedor || "-"}</td>
                    <td className="px-1.5 py-1">{p.cantidad}</td>
                    <td className="px-1.5 py-1">{p.planta}</td>
                    <td className="px-1.5 py-1">
                      {p.motivo}
                      {p.candidato && (
                        <div className="text-muted-foreground">
                          A mano: {p.candidato.remito || "sin Nº"} · {p.candidato.cantidad} · {p.candidato.material} · {p.candidato.planta} {ddmm(p.candidato.fecha)}
                        </div>
                      )}
                    </td>
                    <td className="px-1.5 py-1 text-muted-foreground">{p.queHacer}</td>
                    <td className="px-1.5 py-1">
                      {p.resolucion ? (
                        <span className="text-muted-foreground">
                          {p.resolucion === "mismo" ? "Es el mismo" : p.resolucion === "distintos" ? "Son distintos" : "Descartar"} ({p.resuelto_por}): en la próxima lectura
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {p.candidato && (
                            <>
                              <Button size="sm" className="h-6 px-1.5 text-xs" disabled={!!ocupado} onClick={() => post(`p${p.id}`, { id: p.id, accion: "mismo" })}>
                                Es el mismo
                              </Button>
                              <Button size="sm" variant="outline" className="h-6 px-1.5 text-xs" disabled={!!ocupado} onClick={() => post(`p${p.id}`, { id: p.id, accion: "distintos" })}>
                                Son distintos
                              </Button>
                            </>
                          )}
                          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" disabled={!!ocupado} onClick={() => post(`p${p.id}`, { id: p.id, accion: "descartar" })}>
                            Descartar
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Seccion>
          <Seccion titulo="Cambios de Zomatik (últimos 60 días)" n={d.cambios.length + d.antesDeF.length}>
            <div className="space-y-0.5">
              {d.cambios.slice(0, 100).map((c, i) => (
                <div key={i}>
                  {ddmm(c.fecha)} · {c.material} {c.planta} · {fmtKg(c.kg)} · <span className="text-muted-foreground">{c.nota}</span>
                </div>
              ))}
              {d.antesDeF.map((c, i) => (
                <div key={`f${i}`} className="text-muted-foreground">
                  {ddmm(c.fecha)} · {c.remito} · {c.motivo}
                </div>
              ))}
            </div>
          </Seccion>
          <Seccion titulo="Zomatik cambió y no se pudo aplicar" n={(d.noAplicados || []).length}>
            <div className="space-y-0.5">
              {(d.noAplicados || []).map((x, i) => (
                <div key={i}>
                  {ddmm(x.fecha)} · {x.remito || "sin Nº"} · {x.proveedor || "-"} · {x.cantidad} · {x.planta} · <span className="text-amber-700">{x.motivo}</span>
                </div>
              ))}
            </div>
          </Seccion>
          <Seccion titulo="Posible copia de un importado" n={(d.copias || []).length}>
            <div className="mb-1 text-muted-foreground">Cargados a mano con el mismo remito y material que uno que ya entró desde Zomatik: el stock está contado dos veces. Eliminalo (queda anulado con asiento).</div>
            {tablaManuales(d.copias || [])}
          </Seccion>
          <Seccion titulo="Cargados a mano sin Zomatik (más de 7 días)" n={d.manuales.length}>
            <div className="mb-1 text-muted-foreground">Desde el {ddmm(desde)} lo cargado a mano que a los 7 días no está en Zomatik. Si no tiene que estar, eliminalo (queda anulado con asiento, no se borra).</div>
            {tablaManuales(d.manuales)}
          </Seccion>
          <Seccion titulo="Proveedores sin vincular (entraron igual)" n={d.sinVincular.length}>
            {d.sinVincular.map((p) => (
              <div key={p.proveedor}>
                {p.proveedor} · {p.renglones} {p.renglones === 1 ? "ingreso" : "ingresos"}
              </div>
            ))}
          </Seccion>
        </>
      )}
      {modo !== "apagado" && d.densidades.length > 0 && (
        <details>
          <summary className="cursor-pointer text-muted-foreground">
            Densidades de aditivos ({d.densidades.filter((x) => x.densidad === null).length} a confirmar)
          </summary>
          <div className="mt-1 space-y-1 pl-3">
            <div className="text-muted-foreground">Zomatik trae los aditivos en litros (o tachos de 1000 L). Para pasarlos a kg hace falta la densidad. Sin densidad, el remito queda pendiente.</div>
            {d.densidades.map((x) => (
              <div key={x.material_id} className="flex items-center gap-1">
                <span className="w-56">
                  {x.material} · {x.planta}
                </span>
                {gerencial ? (
                  <>
                    <Input
                      className="h-6 w-24 text-xs"
                      placeholder={x.densidad === null ? "a confirmar" : String(x.densidad)}
                      value={dens[x.material_id] ?? (x.densidad === null ? "" : String(x.densidad))}
                      onChange={(e) => setDens((v) => ({ ...v, [x.material_id]: e.target.value }))}
                    />
                    <span className="text-muted-foreground">kg/L</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-1.5 text-xs"
                      disabled={!!ocupado || dens[x.material_id] === undefined}
                      onClick={() => post(`d${x.material_id}`, { material_id: x.material_id, accion: "densidad", valor: (dens[x.material_id] || "").trim() || null })}
                    >
                      Guardar
                    </Button>
                  </>
                ) : (
                  <span>{x.densidad === null ? "a confirmar" : `${x.densidad} kg/L`}</span>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function Seccion({ titulo, n, children }: { titulo: string; n: number; children: React.ReactNode }) {
  if (!n) return <div className="text-muted-foreground">{titulo}: nada.</div>
  return (
    <div>
      <div className="mb-1">
        {titulo} ({n})
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  )
}
