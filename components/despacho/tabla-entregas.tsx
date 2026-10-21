"use client"

import { hhmm, m3txt, tipoPorNumero } from "@/lib/despacho"
import { cn } from "@/lib/utils"
import { MarcaTipo } from "./columna-viajes"
import { COLOR_ESTADO } from "./columna-camiones"
import type { CamionT, DespachoT, PedidoT } from "./tipos"

/** Remitos del día de la planta, el último arriba (manuales y por árido incluidos, con su marca). */
export function TablaEntregas({
  despachos, pedidos, camiones, choferes, viajeDe, gps, plantaNombre, filtroPedido, onQuitarFiltro, nueva,
}: {
  despachos: DespachoT[]
  pedidos: Record<string, PedidoT>
  camiones: CamionT[]
  choferes: Record<string, string>
  /** "3/4" por id de despacho */
  viajeDe: Record<string, string>
  /** llegada a obra y vuelta reales (4a) por id de despacho */
  gps: Record<string, { llegada_obra?: string | null; llegada_planta?: string | null }>
  plantaNombre: string
  filtroPedido: string | null
  onQuitarFiltro: () => void
  nueva: string | null
}) {
  const filas = [...despachos]
    .filter((d) => !filtroPedido || d.scheduled_dispatch_id === filtroPedido)
    .sort((a, b) => new Date(b.dispatch_date).getTime() - new Date(a.dispatch_date).getTime())
  const tot = filas.filter((d) => !d.is_test_dispatch).reduce((s, d) => s + Number(d.quantity_m3 || 0), 0)
  const camionPorId = Object.fromEntries(camiones.map((c) => [c.id, c]))
  return (
    <section className="d3c-card overflow-hidden rounded-md border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-2.5 py-1">
        <h2 className="text-sm font-semibold">Entregas del día</h2>
        <span className="text-xs text-muted-foreground">{filas.length} remito{filas.length === 1 ? "" : "s"} · {m3txt(tot)} m³ · {plantaNombre}</span>
        <span className="flex-1" />
        {filtroPedido && (
          <button className="min-h-[28px] rounded-md border px-2.5 text-xs" onClick={onQuitarFiltro}>
            Solo {pedidos[filtroPedido]?.construction_sites?.name || "ese pedido"} ✕
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-[12px]">
          <thead>
            <tr className="text-left text-[11px] font-medium text-muted-foreground">
              {["Salió", "Remito", "Camión", "Chofer", "Cliente · obra", "Fórmula", "m³", "Viaje", "Muestra", "Ahora", "En obra / volvió", ""].map((h) => (
                <th key={h} className="whitespace-nowrap border-b px-2 py-1 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!filas.length && (
              <tr><td colSpan={12} className="py-4 text-center text-muted-foreground">Todavía no salió ningún camión.</td></tr>
            )}
            {filas.map((d) => {
              const p = d.scheduled_dispatch_id ? pedidos[d.scheduled_dispatch_id] : null
              const c = d.mixer_id ? camionPorId[d.mixer_id] : null
              // Solo en los despachos de pedido: el manual se carga con las 12:00 del día elegido
              const cargadoDif = d.created_at ? (new Date(d.created_at).getTime() - new Date(d.dispatch_date).getTime()) / 60000 : 0
              const enCurso = c && c.despachoId === d.id && ["yendo", "obra", "volviendo"].includes(c.e.clave)
              const tipo = d.remito_tipo || (d.is_test_dispatch ? null : tipoPorNumero(d.remito))
              const g = gps[d.id]
              return (
                <tr key={d.id} className={cn("border-b", nueva === d.id && "bg-green-50")}>
                  <td className="whitespace-nowrap px-2 py-1 font-semibold tabular-nums">
                    {hhmm(d.dispatch_date)}
                    {d.scheduled_dispatch_id && Math.abs(cargadoDif) > 10 && <div className="text-xs font-semibold text-muted-foreground">cargado {hhmm(d.created_at!)}</div>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 font-semibold tabular-nums">
                    {!d.is_test_dispatch && <MarcaTipo tipo={tipo} className="mr-1" />}
                    {d.remito || "—"}
                    {!d.scheduled_dispatch_id && !d.is_test_dispatch && <span className="ml-1 rounded bg-slate-200 px-1 text-[10px] font-semibold text-slate-600">manual</span>}
                    {d.is_test_dispatch && <span className="ml-1 rounded bg-slate-200 px-1 text-[10px] font-semibold text-slate-600">por árido / prueba</span>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1">{c?.patente || "—"}</td>
                  <td className="whitespace-nowrap px-2 py-1">{(d.chofer_id && choferes[d.chofer_id]) || "—"}</td>
                  <td className="whitespace-nowrap px-2 py-1">{d.clients?.name || "—"} · <span className="text-muted-foreground">{d.construction_sites?.name || "—"}</span></td>
                  <td className="whitespace-nowrap px-2 py-1">{d.formulas?.code || "—"}</td>
                  <td className="whitespace-nowrap px-2 py-1 font-semibold tabular-nums">{m3txt(d.quantity_m3)}</td>
                  <td className="whitespace-nowrap px-2 py-1">{viajeDe[d.id] || (p ? "—" : "")}</td>
                  <td className="whitespace-nowrap px-2 py-1">{d.sample_taken && d.sample_number ? d.sample_number : <span className="text-muted-foreground">—</span>}</td>
                  <td className="whitespace-nowrap px-2 py-1">
                    {enCurso ? <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", COLOR_ESTADO[c!.e.clave])}>{c!.e.etiqueta}{c!.e.fuente === "estimado" ? " (est.)" : ""}</span> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-muted-foreground">
                    {g?.llegada_obra ? `${hhmm(g.llegada_obra)}${g.llegada_planta ? ` / ${hhmm(g.llegada_planta)}` : ""}` : "—"}
                  </td>
                  <td className="px-2 py-1">
                    {!d.is_test_dispatch && (
                      <button className="h-7 w-8 rounded-md border text-sm" title="Ver remito" onClick={() => window.open(`/api/remito/${d.id}`, "_blank")}>🖨</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
