"use client"

/**
 * Columna Viajes como los "Tickets" de Loop (22/10, Bautista: "copiar exactamente cómo lo hace Loop"):
 * - fila 1, chica y gris: número de pedido (y la bomba, si es bombeado) · 👍 si está confirmado y n/N; una línea finita;
 * - fila 2: cliente · "8 m³ › 14:13" (m³ del viaje y hora de carga), en 13 px y peso 500;
 * - fila 3, en gris: la obra; fila 4, gris chico: la fórmula · 📋 (observaciones, con tooltip) y ⋮ (menú);
 * - tarjeta gris clara con borde fino y barra violeta a la derecha; atrasado = todo el borde en rojo, sin texto.
 * Sin botón Despachar: se despacha arrastrando la tarjeta al camión, tocando la tarjeta y después el camión, o desde
 * ⋮ › Despachar. Con el mouse se arrastra apretada; con el dedo, dejándola apretada un momento.
 */
import { useState } from "react"
import { ChevronDown, ClipboardList, ThumbsUp, Truck } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { atraso, hhmm, m3txt, TIPO_TEXTO, type TipoRemito } from "@/lib/despacho"
import { textoBomba, type EmpresaBombeo } from "@/lib/maestros"
import { viajeMinDe } from "@/lib/viajes"
import { cn } from "@/lib/utils"
import { Buscador, coincide } from "./buscador"
import type { PedidoT, TipoResuelto, ViajeT } from "./tipos"

export function MarcaTipo({ tipo, className }: { tipo: TipoRemito | null | undefined; className?: string }) {
  if (!tipo) return <span className={cn("d3c-tag rounded border border-dashed border-border px-1 text-[10.5px] leading-4 text-muted-foreground", className)} title="Se pregunta al despachar">R/X?</span>
  return (
    <span title={TIPO_TEXTO[tipo]} className={cn("d3c-tag rounded px-1 text-[10.5px] leading-4", tipo === "R" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800", className)}>
      {tipo}
    </span>
  )
}

export function ColumnaViajes({
  viajes, pedidos, totalPorPedido, tipos, empresas, enPausa, ahora, esHoy, puedeDespachar, elegido, patentes, numeroPedido,
  onDespachar, onTocar, onPointerDown, recienSoltado, onSoltar, plantaNombre,
}: {
  viajes: ViajeT[]
  pedidos: Record<string, PedidoT>
  totalPorPedido: Record<string, number>
  tipos: Record<string, TipoResuelto>
  empresas: EmpresaBombeo[]
  enPausa: number
  ahora: number
  esHoy: boolean
  puedeDespachar: boolean
  elegido: string | null
  patentes: Record<string, string>
  /** número del pedido en el día (como el número de pedido de Loop) */
  numeroPedido: Record<string, number>
  onDespachar: (clave: string) => void
  onTocar: (clave: string) => void
  onPointerDown: (e: React.PointerEvent, clave: string, manija?: boolean) => void
  recienSoltado: React.MutableRefObject<boolean>
  onSoltar: () => void
  plantaNombre: string
}) {
  const [buscar, setBuscar] = useState("")
  // Detalle desplegable de cada viaje (Bautista 22/10): bomba, fibra si la lleva, tiempo hasta la obra y observaciones
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  const alternar = (clave: string) => setAbiertos((s) => { const n = new Set(s); if (n.has(clave)) n.delete(clave); else n.add(clave); return n })
  const atrasados = esHoy ? viajes.filter((v) => atraso(v.hora_carga, ahora).tipo === "atrasado").length : 0
  const sel = elegido ? viajes.find((v) => v.clave === elegido) : null
  const lista = viajes.filter((v) => {
    const p = pedidos[v.pedido_id]
    return !!p && coincide(buscar, numeroPedido[p.id], p.clients?.name, p.construction_sites?.name, p.formulas?.code, p.finalidad, hhmm(v.hora_carga))
  })
  return (
    <>
      <div className="flex items-center gap-2 border-b px-2.5 py-1.5">
        <h2 className="text-[13px] font-medium">Viajes</h2>
        <span className="text-xs text-muted-foreground">{viajes.length}</span>
        {atrasados > 0 && <span className="text-xs text-red-700">· {atrasados} atrasado{atrasados > 1 ? "s" : ""}</span>}
        <span className="flex-1" />
        <span className="text-[11px] text-muted-foreground">por hora de carga</span>
      </div>
      <Buscador valor={buscar} onCambio={setBuscar} />
      <div className="flex flex-1 flex-col gap-1 overflow-auto p-1.5">
        {sel && (
          <div className="flex items-center gap-2 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] text-blue-900">
            <span className="min-w-0 flex-1 truncate">Elegido: {sel.n}/{totalPorPedido[sel.pedido_id] || "?"} · {pedidos[sel.pedido_id]?.construction_sites?.name}. Tocá un camión.</span>
            <button className="h-6 px-2 underline" onClick={onSoltar}>Soltar</button>
          </div>
        )}
        {!viajes.length && <div className="py-6 text-center text-xs text-muted-foreground">No quedan viajes por despachar en {plantaNombre}.</div>}
        {viajes.length > 0 && !lista.length && <div className="py-6 text-center text-xs text-muted-foreground">Nada coincide con «{buscar}».</div>}
        {lista.map((v) => {
          const p = pedidos[v.pedido_id]!
          const at = esHoy ? atraso(v.hora_carga, ahora) : { tipo: null, texto: null, min: 0 }
          const tipo = tipos[p.id]?.tipo ?? null
          const bomba = p.metodo_descarga === "bomba"
          const sug = v.mixer_id ? patentes[v.mixer_id] : null
          const o = p.construction_sites
          const mapa = o?.gps_lat != null && o?.gps_lng != null ? `https://www.google.com/maps?q=${o.gps_lat},${o.gps_lng}`
            : o?.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([o.address, o.localidad].filter(Boolean).join(", "))}` : null
          // Lo que no entra en la tarjeta va en el tooltip (como Loop): dirección, finalidad, bomba, fibra, R/X, contacto
          const detalle = [
            o?.address ? [o.address, o.localidad].filter(Boolean).join(", ") : null,
            p.finalidad ? `Finalidad: ${p.finalidad}` : null,
            bomba ? textoBomba(p, empresas, "Bomba") : "Directo",
            Number(p.fiber_kg_per_m3) > 0 ? `Fibra ${m3txt(p.fiber_kg_per_m3)} kg/m³` : null,
            tipo ? `Remito ${tipo} (${TIPO_TEXTO[tipo].toLowerCase()})` : "R/X: se pregunta al despachar",
            [o?.site_contact, o?.site_phone].filter(Boolean).join(" · ") || null,
            sug ? `Camión sugerido: ${sug}` : null,
            at.texto,
            v.calculado ? "Viajes calculados (el pedido no los tiene guardados)" : null,
          ].filter(Boolean).join("\n")
          return (
            <div
              key={v.clave}
              data-viaje={v.clave}
              title={detalle}
              onPointerDown={(e) => onPointerDown(e, v.clave)}
              onClick={(e) => {
                if (recienSoltado.current) return
                if ((e.target as HTMLElement).closest("button,a,[role=menuitem]")) return
                onTocar(v.clave)
              }}
              onContextMenu={(e) => e.preventDefault()}
              style={{ touchAction: "pan-y", WebkitTouchCallout: "none" } as React.CSSProperties}
              className={cn(
                "d3c-card relative select-none rounded-md border border-r-[3px] border-slate-200 border-r-violet-700 bg-slate-50 px-2 py-0.5 leading-[1.15]",
                puedeDespachar && "cursor-pointer",
                at.tipo === "atrasado" && "border-red-400 border-r-red-500",
                elegido === v.clave && "ring-2 ring-blue-500",
              )}
            >
              {/* Fila 1: número de pedido (y bomba) · 👍 y n/N */}
              <div className="flex items-center gap-1 text-[10.5px] text-slate-500">
                <span className="tabular-nums">{numeroPedido[p.id] ?? "—"}</span>
                {bomba && <Truck className="h-3 w-3 text-blue-600" aria-label="bombeado" />}
                <span className="flex-1" />
                {p.confirmado_at && <ThumbsUp className="h-3 w-3 fill-blue-600 text-blue-600" aria-label="confirmado" />}
                <span className="tabular-nums">{v.n}/{totalPorPedido[v.pedido_id] || "?"}</span>
                <button
                  className="-mr-1 flex h-4 w-4 items-center justify-center rounded text-slate-500 hover:bg-slate-200"
                  title={abiertos.has(v.clave) ? "Ocultar el detalle" : "Ver el detalle"}
                  aria-expanded={abiertos.has(v.clave)}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); alternar(v.clave) }}
                >
                  <ChevronDown className={cn("h-3 w-3 transition-transform", abiertos.has(v.clave) && "rotate-180")} />
                </button>
              </div>
              {/* Fila 2: cliente · m³ › hora de carga */}
              <div className="flex items-baseline gap-2 text-[12px] font-medium">
                <span className="min-w-0 flex-1 truncate">{p.clients?.name || "Cliente"}</span>
                <span className="shrink-0 tabular-nums">{m3txt(v.m3)} m³ <span className="font-normal text-slate-400">›</span> {hhmm(v.hora_carga)}</span>
              </div>
              {/* Fila 3: obra · fórmula · 📋 · ⋮ (una sola línea, para que entren más viajes) */}
              <div className="flex items-center gap-1 text-[11px] text-slate-500">
                <span className="min-w-0 flex-1 truncate">{o?.name || "Obra"}<span className="text-slate-400"> · {p.formulas?.code}</span></span>
                {p.observations && <span title={p.observations} className="shrink-0"><ClipboardList className="h-3.5 w-3.5" aria-label="observaciones" /></span>}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="h-4 w-4 shrink-0 rounded text-[12px] leading-none text-slate-500 hover:bg-slate-200" title="Más opciones" onClick={(e) => e.stopPropagation()}>⋮</button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[200px]">
                    {puedeDespachar && <DropdownMenuItem className="min-h-[30px]" onClick={() => onDespachar(v.clave)}>Despachar</DropdownMenuItem>}
                    {mapa && <DropdownMenuItem className="min-h-[30px]" onClick={() => window.open(mapa, "_blank")}>Ver la obra en el mapa</DropdownMenuItem>}
                    {p.observations && <DropdownMenuItem disabled className="whitespace-normal text-[12px]">Obs.: {p.observations}</DropdownMenuItem>}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {abiertos.has(v.clave) && (
                <div className="mt-0.5 space-y-0.5 border-t border-slate-200 pt-0.5 text-[11px] text-slate-600" onPointerDown={(e) => e.stopPropagation()}>
                  <div>{bomba ? textoBomba(p, empresas, "Con bomba") : "Sin bomba (descarga directa)"}</div>
                  {Number(p.fiber_kg_per_m3) > 0 && <div>Fibra: {m3txt(p.fiber_kg_per_m3)} kg/m³</div>}
                  <div>Hasta la obra: {viajeMinDe(p as any)} min</div>
                  {p.observations && <div className="whitespace-pre-wrap text-slate-700">Obs.: {p.observations}</div>}
                </div>
              )}
            </div>
          )
        })}
        {enPausa > 0 && (
          <div className="rounded-md border border-dashed px-2 py-1 text-[11px] text-muted-foreground">
            ⏸ {enPausa} viaje{enPausa > 1 ? "s" : ""} en pausa (pedido suspendido). Se ven de nuevo al reabrir el pedido.
          </div>
        )}
      </div>
    </>
  )
}

/** Tarjeta que sigue al dedo o al mouse mientras se arrastra */
export function FantasmaViaje({ x, y, texto }: { x: number; y: number; texto: string }) {
  return (
    <div
      className="pointer-events-none fixed z-[60] w-[220px] -rotate-2 rounded-md border border-l-[3px] border-l-violet-400 bg-card px-2.5 py-1.5 text-xs font-medium opacity-95 shadow-xl"
      style={{ left: x - 40, top: y - 20 }}
    >
      {texto}
      <div className="text-[11px] font-normal text-muted-foreground">Soltalo sobre un camión</div>
    </div>
  )
}
