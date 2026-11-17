"use client"
/**
 * Primera pregunta del alta del pedido (pedido de Bautista del 28/10), solo con la llave de la planta prendida:
 * "¿Qué NP?" — NP nueva, NP de un proyecto o Traer NP de Zomatik. Según lo elegido, el resto del formulario se acomoda:
 *   - de un proyecto: elegís el proyecto y completa el cliente y la obra (si el proyecto está vinculado a una obra);
 *   - traer de Zomatik (17/11): elegís una NP con saldo o escribís el número de una NP de Zomatik y "Buscar NP … en
 *     Zomatik" (el cliente y la fórmula salen de la NP); completa el cliente, la obra, la fórmula y los m³ (el saldo).
 */
import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { coincideBusqueda } from "@/lib/buscar-texto"
import { cargarNpSaldos, traerNpDeZomatik, type EleccionNp, type NpSaldo } from "@/lib/zomatik/np-cliente"
import { MSJ_TRAER, numeroCompleto, numeroNpTipeado } from "@/lib/zomatik/np"

export type ProyectoAlta = { codigo: number; numero: string; obra: string | null; client_id: string; cliente: string; construction_site_id: string | null; saldo_m3: number | null; estimado: boolean }

const m3t = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 1 })
const dia = (s: string | null) => (s ? new Date(s.length === 10 ? `${s}T12:00:00Z` : s).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }) : "")

const OPCIONES_PREGUNTA = [
  ["nueva", "NP nueva", "Se crea una nota de pedido nueva en Zomatik por estos m³."],
  ["proyecto", "NP de un proyecto", "Para obras con proyecto (acopio) en Zomatik: la NP descuenta de lo que le queda al proyecto."],
  ["saldo", "Traer NP de Zomatik", "Una NP que ya está en Zomatik: cargada a mano o que quedó con m³ (por ejemplo, un pedido cancelado por lluvia)."],
] as const

export function NpPregunta({ valor, plantId, onNueva, onProyecto, onSaldo }: {
  valor: EleccionNp
  plantId: string
  onNueva: () => void
  onProyecto: (p: ProyectoAlta) => void
  /** `remito`: el de la NP traída (NP → R, NP2 → X), para ponerlo si el formulario no tiene R/X. */
  onSaldo: (x: NpSaldo, remito?: "R" | "X") => void
}) {
  // Sin contestar al abrir (salvo que venga de "Reprogramar", que ya trae la NP con saldo)
  const [tipo, setTipo] = useState<EleccionNp["tipo"] | null>(valor.tipo === "nueva" ? null : valor.tipo)
  const [proyectos, setProyectos] = useState<ProyectoAlta[] | null>(null)
  const [saldos, setSaldos] = useState<NpSaldo[] | null>(null)
  const [buscar, setBuscar] = useState("")
  // Traer NP de Zomatik: buscando, lo que pasó (sin montos) y, si hace falta, qué fórmula
  const [trayendo, setTrayendo] = useState(false)
  const [traida, setTraida] = useState<{ color: "gris" | "ambar" | "verde"; texto: string; avisos?: string[]; formulas?: { id: string; code: string }[] } | null>(null)

  useEffect(() => {
    if (tipo !== "proyecto" || proyectos) return
    fetch("/api/zomatik/np/proyectos?todos=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setProyectos(j?.proyectos || []))
      .catch(() => setProyectos([]))
  }, [tipo, proyectos])
  useEffect(() => {
    if (tipo !== "saldo" || saldos) return
    cargarNpSaldos().then(setSaldos)
  }, [tipo, saldos])

  const elegir = (t: EleccionNp["tipo"]) => {
    setTipo(t)
    setBuscar("")
    setTraida(null)
    if (t === "nueva") onNueva()
  }
  const tipeado = tipo === "saldo" ? numeroNpTipeado(buscar) : null
  /** "Buscar NP … en Zomatik": acá no hay cliente ni fórmula (salen de la NP); con varias fórmulas, se elige y se busca de nuevo. */
  async function traer(formulaId?: string) {
    if (!tipeado || !plantId || trayendo) return
    setTrayendo(true)
    setTraida({ color: "gris", texto: MSJ_TRAER.buscando })
    const r = await traerNpDeZomatik({ numero: buscar.trim(), plantId, formulaId: formulaId || null })
    setTrayendo(false)
    if (!r.ok) {
      setTraida({ color: r.motivo === "elegir_formula" ? "gris" : "ambar", texto: r.error, formulas: r.elegirFormula })
      return
    }
    setTraida({ color: "verde", texto: (r.yaEstaba ? MSJ_TRAER.ya_estaba : MSJ_TRAER.ok)(r.np.numero || buscar.trim(), r.np.libre), avisos: r.avisos })
    onSaldo(r.np, r.remito)
    setSaldos(null) // se vuelve a pedir la lista (la traída aparece ahí)
  }
  const listaSaldos = (saldos || []).filter((x) => !x.plant_id || !plantId || x.plant_id === plantId).filter((x) => coincideBusqueda(buscar, x.cliente, x.obra, x.numero, x.formula))
  const listaProyectos = (proyectos || []).filter((p) => coincideBusqueda(buscar, p.cliente, p.numero, p.obra))

  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-1.5">
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-1.5 md:grid-cols-3">
          {OPCIONES_PREGUNTA.map(([k, l, ayuda]) => (
            <button key={k} type="button" title={ayuda} onClick={() => elegir(k)} className={cn("h-8 rounded-md border-2 px-2 text-left text-xs font-medium", (tipo ?? valor.tipo) === k && tipo !== null ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50")}>
              {l}
            </button>
          ))}
        </div>
        <span className="mt-1 shrink-0 cursor-help rounded-full border px-1.5 text-[11px] text-muted-foreground" title="Elegí de dónde sale la nota de pedido. Si no sabés, NP nueva.">?</span>
      </div>
      {(tipo === "proyecto" || tipo === "saldo") && (
        <Input
          className="h-8 text-xs"
          placeholder={tipo === "proyecto" ? "Buscar cliente, proyecto u obra" : "N.º de NP, cliente u obra"}
          value={buscar}
          onChange={(e) => {
            setBuscar(e.target.value)
            if (!trayendo) setTraida(null)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && tipeado) {
              e.preventDefault()
              traer()
            }
          }}
        />
      )}
      {tipo === "saldo" && tipeado && (
        <button type="button" disabled={trayendo || !plantId} onClick={() => traer()} className="rounded border px-2 py-0.5 text-xs hover:bg-muted/50 disabled:opacity-50">
          {trayendo ? "Buscando…" : `Buscar ${tipeado.comprobante ? numeroCompleto(tipeado.comprobante, tipeado.numero) : `NP ${tipeado.numero}`} en Zomatik`}
        </button>
      )}
      {tipo === "saldo" && traida && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className={traida.color === "verde" ? "text-green-700" : traida.color === "ambar" ? "text-amber-700" : "text-muted-foreground"}>{traida.texto}</span>
          {traida.avisos?.length ? <span className="text-muted-foreground">{traida.avisos.join(" · ")}</span> : null}
          {traida.formulas?.map((f) => (
            <button key={f.id} type="button" disabled={trayendo} onClick={() => traer(f.id)} className="rounded border px-2 py-0.5 hover:bg-muted/50">{f.code}</button>
          ))}
        </div>
      )}
      {tipo === "proyecto" && (
        <div className="max-h-48 space-y-1 overflow-auto">
          {proyectos === null && <p className="text-xs text-muted-foreground">Buscando proyectos…</p>}
          {proyectos && !listaProyectos.length && <p className="text-xs text-muted-foreground">No hay proyectos abiertos (con el cliente vinculado){buscar ? ` que coincidan con «${buscar}»` : ""}.</p>}
          {listaProyectos.map((p) => (
            <button key={p.codigo} type="button" onClick={() => onProyecto(p)} className={cn("flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-xs", valor.tipo === "proyecto" && valor.proyecto_codigo === p.codigo ? "border-primary bg-primary/5" : "hover:bg-muted/50")}>
              <span className="font-medium">{p.cliente}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{p.numero}{p.obra ? ` · ${p.obra}` : ""}</span>
              <span className="shrink-0 tabular-nums">{p.saldo_m3 === null ? "" : `${p.estimado ? "≈ " : ""}${m3t(p.saldo_m3)} m³`}</span>
            </button>
          ))}
        </div>
      )}
      {tipo === "saldo" && (
        <div className="max-h-48 space-y-1 overflow-auto">
          {saldos === null && <p className="text-xs text-muted-foreground">Buscando NP con saldo…</p>}
          {saldos && !listaSaldos.length && <p className="text-xs text-muted-foreground">No hay NP con saldo pendientes{buscar ? ` que coincidan con «${buscar}»` : ""}.</p>}
          {listaSaldos.map((x) => (
            <button key={x.id} type="button" onClick={() => onSaldo(x)} className={cn("flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-xs", valor.tipo === "saldo" && valor.np_id === x.id ? "border-primary bg-primary/5" : "hover:bg-muted/50")}>
              <span className="font-medium">{x.cliente || ""}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{x.numero || "NP"}{x.obra ? ` · ${x.obra}` : ""} · {x.formula || ""} · desde el {dia(x.pendiente_desde)}</span>
              <span className="shrink-0 tabular-nums">{m3t(x.libre)} m³</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
