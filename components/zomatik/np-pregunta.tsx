"use client"
/**
 * Primera pregunta del alta del pedido (pedido de Bautista del 28/10), solo con la llave de la planta prendida:
 * "¿Qué NP?" — NP nueva, NP de un proyecto o Usar NP con saldo. Según lo elegido, el resto del formulario se acomoda:
 *   - de un proyecto: elegís el proyecto y completa el cliente y la obra (si el proyecto está vinculado a una obra);
 *   - con saldo: elegís la NP y completa el cliente, la obra, la fórmula y los m³ (el saldo).
 */
import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { coincideBusqueda } from "@/lib/buscar-texto"
import { cargarNpSaldos, type EleccionNp, type NpSaldo } from "@/lib/zomatik/np-cliente"

export type ProyectoAlta = { codigo: number; numero: string; obra: string | null; client_id: string; cliente: string; construction_site_id: string | null; saldo_m3: number | null; estimado: boolean }

const m3t = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 1 })
const dia = (s: string | null) => (s ? new Date(s.length === 10 ? `${s}T12:00:00Z` : s).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }) : "")

export function NpPregunta({ valor, plantId, onNueva, onProyecto, onSaldo }: {
  valor: EleccionNp
  plantId: string
  onNueva: () => void
  onProyecto: (p: ProyectoAlta) => void
  onSaldo: (x: NpSaldo) => void
}) {
  // Sin contestar al abrir (salvo que venga de "Reprogramar", que ya trae la NP con saldo)
  const [tipo, setTipo] = useState<EleccionNp["tipo"] | null>(valor.tipo === "nueva" ? null : valor.tipo)
  const [proyectos, setProyectos] = useState<ProyectoAlta[] | null>(null)
  const [saldos, setSaldos] = useState<NpSaldo[] | null>(null)
  const [buscar, setBuscar] = useState("")

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
    if (t === "nueva") onNueva()
  }
  const listaSaldos = (saldos || []).filter((x) => !x.plant_id || !plantId || x.plant_id === plantId).filter((x) => coincideBusqueda(buscar, x.cliente, x.obra, x.numero, x.formula))
  const listaProyectos = (proyectos || []).filter((p) => coincideBusqueda(buscar, p.cliente, p.numero, p.obra))

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-1 gap-1.5 md:grid-cols-3">
        {([["nueva", "NP nueva"], ["proyecto", "NP de un proyecto"], ["saldo", "Usar NP con saldo"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => elegir(k)} className={cn("h-8 rounded-md border-2 px-2 text-left text-xs font-medium", (tipo ?? valor.tipo) === k && tipo !== null ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50")}>
            {l}
          </button>
        ))}
      </div>
      {(tipo === "proyecto" || tipo === "saldo") && (
        <Input className="h-8 text-xs" placeholder={tipo === "proyecto" ? "Buscar cliente, proyecto u obra" : "Buscar cliente, obra o NP"} value={buscar} onChange={(e) => setBuscar(e.target.value)} />
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
