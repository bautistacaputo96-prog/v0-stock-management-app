"use client"

/**
 * 22/10: sin negritas (solo la obra en peso 500), 12 px y 11 px. Línea 1: hora chica · obra · m³ a la derecha; línea 2,
 * en gris: cliente · fórmula · finalidad · bomba/directo · R/X. El atraso, un punto y "+15'" chicos (y la franja roja).
 * Despachar, chico y con borde. El ▾ muestra solo lo útil para despachar (dirección y mapa, observaciones, bomba,
 * contacto de obra y fibra).
 * Columna Viajes, compacta (21/10, Bautista: "que entre mucha más información sin scrollear", pensada para PC): una
 * fila de dos líneas por viaje con todo lo que importa a la vista (hora, obra, cliente, m³, R/X, estado / fórmula,
 * finalidad, bomba o directo). Lo que se achicó es el espacio, no los datos. El resto (dirección, horarios, camión
 * sugerido completo) se despliega con ▾.
 * Tocar la fila la elige (para tocar después el camión). Para arrastrarla: con el mouse, moverla apretada; con el
 * dedo, dejarlo apretado un momento (sin manija, para que la fila entre en una tarjeta angosta).
 */
import { useState } from "react"
import { atraso, hhmm, m3txt, TIPO_TEXTO, type TipoRemito } from "@/lib/despacho"
import { textoBomba, type EmpresaBombeo } from "@/lib/maestros"
import { cn } from "@/lib/utils"
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
  viajes, pedidos, totalPorPedido, tipos, empresas, enPausa, ahora, esHoy, puedeDespachar, elegido, patentes,
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
  onDespachar: (clave: string) => void
  onTocar: (clave: string) => void
  onPointerDown: (e: React.PointerEvent, clave: string, manija?: boolean) => void
  recienSoltado: React.MutableRefObject<boolean>
  onSoltar: () => void
  plantaNombre: string
}) {
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({})
  const atrasados = esHoy ? viajes.filter((v) => atraso(v.hora_carga, ahora).tipo === "atrasado").length : 0
  const sel = elegido ? viajes.find((v) => v.clave === elegido) : null
  return (
    <>
      <div className="flex items-center gap-2 border-b px-2.5 py-1.5">
        <h2 className="text-[13px] font-medium">Viajes</h2>
        <span className="text-xs text-muted-foreground">{viajes.length}</span>
        {atrasados > 0 && <span className="text-xs text-red-700">· {atrasados} atrasado{atrasados > 1 ? "s" : ""}</span>}
        <span className="flex-1" />
        <span className="text-[11px] text-muted-foreground">por hora de carga</span>
      </div>
      <div className="flex flex-1 flex-col gap-[3px] overflow-auto p-1.5">
        {sel && (
          <div className="flex items-center gap-2 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] text-blue-900">
            <span className="min-w-0 flex-1 truncate">Elegido: {sel.n}/{totalPorPedido[sel.pedido_id] || "?"} · {pedidos[sel.pedido_id]?.construction_sites?.name}. Tocá un camión.</span>
            <button className="h-6 px-2 underline" onClick={onSoltar}>Soltar</button>
          </div>
        )}
        {!viajes.length && <div className="py-6 text-center text-xs text-muted-foreground">No quedan viajes por despachar en {plantaNombre}.</div>}
        {viajes.map((v) => {
          const p = pedidos[v.pedido_id]
          if (!p) return null
          const at = esHoy ? atraso(v.hora_carga, ahora) : { tipo: null, texto: null, min: 0 }
          const tipo = tipos[p.id]?.tipo ?? null
          const bomba = p.metodo_descarga === "bomba"
          const sug = v.mixer_id ? patentes[v.mixer_id] : null
          const abierto = !!abiertos[v.clave]
          return (
            <div
              key={v.clave}
              data-viaje={v.clave}
              onPointerDown={(e) => onPointerDown(e, v.clave)}
              onClick={(e) => {
                if (recienSoltado.current) return
                if ((e.target as HTMLElement).closest("button")) return
                onTocar(v.clave)
              }}
              onContextMenu={(e) => e.preventDefault()}
              style={{ touchAction: "pan-y", WebkitTouchCallout: "none" } as React.CSSProperties}
              className={cn(
                "d3c-card relative select-none rounded-md border border-l-[2px] border-l-violet-300 bg-card",
                puedeDespachar && "cursor-pointer",
                at.tipo === "atrasado" && "border-l-red-600",
                at.tipo === "ahora" && "border-l-amber-500",
                elegido === v.clave && "ring-2 ring-blue-500",
              )}
            >
              <div className="flex items-center gap-1.5 py-[3px] pl-2 pr-1">
                {/* 22/10: sin negritas (solo la obra en 500), 12 px y 11 px. Línea 1: hora · obra · m³. Línea 2, en gris:
                    cliente · fórmula · finalidad · bomba/directo · R/X */}
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="flex items-baseline gap-1.5 text-[12px]">
                    <span className="w-[30px] shrink-0 text-[11px] tabular-nums text-muted-foreground" title={at.texto || `Carga ${hhmm(v.hora_carga)} · viaje ${v.n}/${totalPorPedido[v.pedido_id] || "?"}`}>{hhmm(v.hora_carga)}</span>
                    {at.tipo === "atrasado" && <span className="inline-flex shrink-0 items-center gap-0.5 text-[10.5px] tabular-nums text-red-700" title={at.texto || undefined}><i className="inline-block h-[5px] w-[5px] rounded-full bg-red-600" />+{at.min}&apos;</span>}
                    {at.tipo === "ahora" && <span className="inline-flex shrink-0 items-center gap-0.5 text-[10.5px] tabular-nums text-amber-800" title={at.texto || undefined}><i className="inline-block h-[5px] w-[5px] rounded-full bg-amber-500" />{at.min > 0 ? `${at.min}'` : "ya"}</span>}
                    <span className="min-w-0 truncate font-medium">{p.construction_sites?.name || "Obra"}</span>
                    <span className="ml-auto shrink-0 tabular-nums">{m3txt(v.m3)} m³</span>
                  </div>
                  <div className="truncate pl-[36px] text-[11px] text-muted-foreground">
                    {p.clients?.name}
                    {` · ${p.formulas?.code || ""}`}
                    {p.finalidad ? ` · ${p.finalidad}` : ""}
                    {bomba ? " · bomba" : " · directo"}
                    {` · ${tipo || "R/X?"}`}
                    {Number(p.fiber_kg_per_m3) > 0 ? " · fibra" : ""}
                    {p.confirmado_at ? " · 👍" : ""}
                    {sug ? ` · sug. ${sug}` : ""}
                    {` · ${v.n}/${totalPorPedido[v.pedido_id] || "?"}`}
                  </div>
                </div>
                <button
                  className="flex h-6 w-5 shrink-0 items-center justify-center rounded text-[11px] text-muted-foreground hover:bg-muted"
                  title={abierto ? "Ocultar el detalle" : "Ver el detalle"}
                  aria-expanded={abierto}
                  onClick={(e) => { e.stopPropagation(); setAbiertos((a) => ({ ...a, [v.clave]: !a[v.clave] })) }}
                >
                  {abierto ? "▴" : "▾"}
                </button>
                {puedeDespachar && (
                  <button
                    className="h-6 shrink-0 rounded border border-blue-300 bg-transparent px-2 text-[11.5px] text-blue-800 hover:bg-blue-50"
                    onClick={(e) => { e.stopPropagation(); onDespachar(v.clave) }}
                  >
                    Despachar
                  </button>
                )}
              </div>
              {abierto && (() => {
                // Solo lo útil para despachar: dirección (con el mapa), observaciones, bomba, contacto de obra y fibra
                const o = p.construction_sites
                const mapa = o?.gps_lat != null && o?.gps_lng != null ? `https://www.google.com/maps?q=${o.gps_lat},${o.gps_lng}`
                  : o?.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([o.address, o.localidad].filter(Boolean).join(", "))}` : null
                const contacto = [o?.site_contact, o?.site_phone].filter(Boolean).join(" · ")
                return (
                  <div className="space-y-0.5 border-t px-2 py-1 text-[11px] leading-snug text-muted-foreground">
                    <div>
                      {o?.address ? [o.address, o.localidad].filter(Boolean).join(", ") : "Sin dirección cargada"}
                      {mapa && <> · <a href={mapa} target="_blank" rel="noreferrer" className="text-blue-800 underline" onClick={(e) => e.stopPropagation()}>mapa</a></>}
                    </div>
                    {p.observations && <div>Obs.: {p.observations}</div>}
                    {bomba && <div>{textoBomba(p, empresas, "Bomba")}</div>}
                    {contacto && <div>Contacto de obra: {contacto}</div>}
                    {Number(p.fiber_kg_per_m3) > 0 && <div>Lleva fibra: {m3txt(p.fiber_kg_per_m3)} kg/m³</div>}
                  </div>
                )
              })()}
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
