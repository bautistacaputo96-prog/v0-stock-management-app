"use client"

/**
 * 21/10 · 6: el atraso y la hora pasan a un indicador chico (franja y punto rojos y "+15'"); lo que destaca es obra,
 * cliente, fórmula y m³. Finalidad y bomba siguen a la vista, en chico.
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
  if (!tipo) return <span className={cn("d3c-tag rounded border border-dashed border-border px-1 text-[10.5px] font-bold leading-4 text-muted-foreground", className)} title="Se pregunta al despachar">R/X?</span>
  return (
    <span title={TIPO_TEXTO[tipo]} className={cn("d3c-tag rounded px-1 text-[10.5px] font-bold leading-4", tipo === "R" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800", className)}>
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
        <h2 className="text-sm font-semibold">Viajes</h2>
        <span className="text-xs text-muted-foreground">{viajes.length}</span>
        {atrasados > 0 && <span className="text-xs font-semibold text-red-700">· {atrasados} atrasado{atrasados > 1 ? "s" : ""}</span>}
        <span className="flex-1" />
        <span className="text-[11px] text-muted-foreground">por hora de carga</span>
      </div>
      <div className="flex flex-1 flex-col gap-[3px] overflow-auto p-1.5">
        {sel && (
          <div className="flex items-center gap-2 rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-900">
            <span className="min-w-0 flex-1 truncate">Elegido: {sel.n}/{totalPorPedido[sel.pedido_id] || "?"} · {pedidos[sel.pedido_id]?.construction_sites?.name}. Tocá un camión.</span>
            <button className="h-7 px-2 underline" onClick={onSoltar}>Soltar</button>
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
                "d3c-card relative select-none rounded-md border border-l-[3px] border-l-violet-400 bg-card",
                puedeDespachar && "cursor-pointer",
                at.tipo === "atrasado" && "border-l-red-600",
                at.tipo === "ahora" && "border-l-amber-500",
                elegido === v.clave && "ring-2 ring-blue-500",
              )}
            >
              <div className="flex items-center gap-2 py-[3px] pl-2 pr-1">
                {/* Hora de carga y n/N */}
                <div className="w-[34px] shrink-0 leading-tight text-muted-foreground" title={at.texto || undefined}>
                  <div className="text-[11px] tabular-nums">{hhmm(v.hora_carga)}</div>
                  <div className="flex items-center gap-0.5 text-[10px] tabular-nums">
                    {at.tipo === "atrasado" ? <><i className="inline-block h-[6px] w-[6px] shrink-0 rounded-full bg-red-600" /><span className="font-semibold text-red-700">+{at.min}&apos;</span></>
                      : at.tipo === "ahora" ? <><i className="inline-block h-[6px] w-[6px] shrink-0 rounded-full bg-amber-500" /><span className="text-amber-800">{at.min > 0 ? `${at.min}'` : "ya"}</span></>
                      : <span>{v.n}/{totalPorPedido[v.pedido_id] || "?"}</span>}
                  </div>
                </div>
                {/* Línea 1: obra · cliente · m³ · R/X · estado. Línea 2: fórmula · finalidad · bomba/directo · sugerido */}
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-0 truncate text-[13px]">
                      <span className="font-semibold">{p.construction_sites?.name || "Obra"}</span>
                      <span className="font-medium"> · {p.clients?.name}</span>
                    </span>
                    <span className="ml-auto shrink-0 text-[14px] font-bold tabular-nums">{m3txt(v.m3)} m³</span>
                    <MarcaTipo tipo={tipo} />
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span className="min-w-0 truncate">
                      <span className="text-[12px] font-semibold text-foreground">{p.formulas?.code}</span>
                      {at.tipo ? <span className="ml-1">{v.n}/{totalPorPedido[v.pedido_id] || "?"}</span> : null}
                      {p.finalidad ? ` · ${p.finalidad}` : ""}
                      {bomba ? <> · <span className="font-medium text-cyan-800">bomba</span></> : " · directo"}
                      {Number(p.fiber_kg_per_m3) > 0 ? " · fibra" : ""}
                      {p.confirmado_at ? " · 👍" : ""}
                      {sug ? ` · sug. ${sug}` : ""}
                      {v.calculado ? " · calculado" : ""}
                    </span>
                  </div>
                </div>
                <button
                  className="flex h-8 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                  title={abierto ? "Ocultar el detalle" : "Ver el detalle"}
                  aria-expanded={abierto}
                  onClick={(e) => { e.stopPropagation(); setAbiertos((a) => ({ ...a, [v.clave]: !a[v.clave] })) }}
                >
                  {abierto ? "▴" : "▾"}
                </button>
                {puedeDespachar && (
                  <button
                    className="h-8 shrink-0 rounded-md bg-blue-600 px-2.5 text-[12.5px] font-medium text-white hover:bg-blue-700"
                    onClick={(e) => { e.stopPropagation(); onDespachar(v.clave) }}
                  >
                    Despachar
                  </button>
                )}
              </div>
              {abierto && (
                <div className="space-y-0.5 border-t px-2 py-1.5 text-[11.5px] leading-snug text-muted-foreground">
                  <div className="text-foreground">{p.construction_sites?.name}{p.construction_sites?.address ? ` · ${p.construction_sites.address}` : ""}</div>
                  <div>{p.clients?.name} · <b className="font-medium text-foreground">{p.formulas?.code}</b>{p.finalidad ? ` · ${p.finalidad}` : ""}</div>
                  <div>
                    Carga {hhmm(v.hora_carga)} · sale {hhmm(v.hora_salida)} · llega {hhmm(v.hora_llegada)} · vuelve {hhmm(v.hora_vuelta)}
                  </div>
                  <div>
                    {bomba ? textoBomba(p, empresas, "Bomba") : "Directo"}
                    {Number(p.fiber_kg_per_m3) > 0 ? ` · Fibra ${m3txt(p.fiber_kg_per_m3)} kg/m³` : ""}
                    {` · ${tipo ? `Remito ${tipo} (${TIPO_TEXTO[tipo].toLowerCase()})` : "Factura: se pregunta al despachar"}`}
                    {p.confirmado_at ? " · 👍 confirmado" : " · sin confirmar"}
                  </div>
                  <div>{sug ? <>Camión sugerido: <b className="font-medium text-foreground">{sug}</b></> : "Sin camión sugerido"}{v.calculado ? " · viajes calculados (el pedido no los tiene guardados)" : ""}</div>
                </div>
              )}
            </div>
          )
        })}
        {enPausa > 0 && (
          <div className="rounded-md border border-dashed px-2 py-1 text-[11.5px] text-muted-foreground">
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
