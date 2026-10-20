"use client"

import { atraso, hhmm, m3txt, TIPO_TEXTO, type TipoRemito } from "@/lib/despacho"
import { textoBomba, type EmpresaBombeo } from "@/lib/maestros"
import { cn } from "@/lib/utils"
import type { PedidoT, TipoResuelto, ViajeT } from "./tipos"

export function MarcaTipo({ tipo, className }: { tipo: TipoRemito | null | undefined; className?: string }) {
  if (!tipo) return <span className={cn("rounded px-1.5 py-px text-[11px] font-extrabold border border-dashed border-slate-400 text-slate-500 bg-slate-50", className)} title="Se pregunta al despachar">R/X ?</span>
  return (
    <span title={TIPO_TEXTO[tipo]} className={cn("rounded px-1.5 py-px text-[11px] font-extrabold", tipo === "R" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800", className)}>
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
  const atrasados = esHoy ? viajes.filter((v) => atraso(v.hora_carga, ahora).tipo === "atrasado").length : 0
  const sel = elegido ? viajes.find((v) => v.clave === elegido) : null
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
        <h2 className="text-base font-bold">Viajes</h2>
        <span className="rounded-full border bg-muted/40 px-2 text-xs font-bold text-muted-foreground">{viajes.length}</span>
        {atrasados > 0 && <span className="rounded-full border border-red-200 bg-red-50 px-2 text-xs font-bold text-red-700">{atrasados} atrasado{atrasados > 1 ? "s" : ""}</span>}
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground">por hora de carga</span>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-auto p-2.5">
        {sel && (
          <div className="rounded-lg bg-blue-100 px-3 py-2 text-sm font-semibold text-blue-900">
            Elegido: viaje {sel.n}/{totalPorPedido[sel.pedido_id] || "?"} · {pedidos[sel.pedido_id]?.construction_sites?.name}. Ahora tocá un camión.{" "}
            <button className="underline" onClick={onSoltar}>Soltar</button>
          </div>
        )}
        {!viajes.length && <div className="py-8 text-center text-sm text-muted-foreground">No quedan viajes por despachar en {plantaNombre}.</div>}
        {viajes.map((v) => {
          const p = pedidos[v.pedido_id]
          if (!p) return null
          const at = esHoy ? atraso(v.hora_carga, ahora) : { tipo: null, texto: null }
          const tipo = tipos[p.id]?.tipo ?? null
          const bomba = p.metodo_descarga === "bomba"
          const sug = v.mixer_id ? patentes[v.mixer_id] : null
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
                "relative select-none rounded-lg border border-l-[5px] border-l-violet-600 bg-card px-2.5 py-2",
                puedeDespachar && "cursor-pointer",
                at.tipo === "atrasado" && "border-red-600 border-l-red-600 bg-red-50/40 shadow-[inset_0_0_0_1px_#dc2626]",
                at.tipo === "ahora" && "border-l-amber-500",
                elegido === v.clave && "ring-[3px] ring-blue-600 border-blue-600",
              )}
            >
              <div className="flex items-center gap-1.5 text-[13px] font-bold text-muted-foreground">
                <span>{v.n}/{totalPorPedido[v.pedido_id] || "?"}</span>
                {bomba ? <span className="rounded bg-cyan-100 px-1.5 text-[11px] font-extrabold text-cyan-800">BOMBA</span> : <span className="rounded bg-slate-200 px-1.5 text-[11px] font-extrabold text-slate-600">DIRECTO</span>}
                {!!p.fiber_kg_per_m3 && <span className="rounded bg-violet-100 px-1.5 text-[11px] font-extrabold text-violet-800">FIBRA</span>}
                {p.confirmado_at && <span title="Confirmado">👍</span>}
                <MarcaTipo tipo={tipo} />
                {v.calculado && <span className="rounded border border-dashed border-slate-400 bg-slate-50 px-1.5 text-[11px] font-extrabold text-slate-500" title="El pedido no tiene viajes guardados: se calculan en el momento">calculado</span>}
                {puedeDespachar && (
                  <span
                    className="ml-auto cursor-grab px-1 text-lg leading-none text-slate-400"
                    style={{ touchAction: "none" }}
                    title="Arrastrar hasta un camión"
                    onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, v.clave, true) }}
                  >
                    ⠿
                  </span>
                )}
              </div>
              <div className="mt-0.5 line-clamp-2 text-base font-bold leading-tight">{p.construction_sites?.name || "Obra"}</div>
              <div className="truncate text-[13px] text-muted-foreground">{p.clients?.name} · {p.formulas?.code}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="text-lg font-extrabold tabular-nums">{m3txt(v.m3)} m³ › {hhmm(v.hora_carga)}</span>
                {at.texto && (
                  <span className={cn("rounded px-1.5 py-0.5 text-xs font-extrabold", at.tipo === "atrasado" ? "bg-red-600 text-white" : "bg-amber-100 text-amber-900")}>{at.texto}</span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                  {sug ? <>Sugerido: <b className="text-foreground">{sug}</b></> : "Sin camión sugerido"}
                  {bomba && textoBomba(p, empresas) ? <> · {textoBomba(p, empresas, "Bomba")}</> : null}
                </span>
                {puedeDespachar && (
                  <button
                    className="min-h-[40px] rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700"
                    onClick={(e) => { e.stopPropagation(); onDespachar(v.clave) }}
                  >
                    Despachar
                  </button>
                )}
              </div>
            </div>
          )
        })}
        {enPausa > 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-muted/40 px-3 py-2 text-[13px] text-slate-600">
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
      className="pointer-events-none fixed z-[60] w-[240px] -rotate-2 rounded-lg border border-l-[5px] border-l-violet-600 bg-card px-3 py-2 text-sm font-bold opacity-95 shadow-2xl"
      style={{ left: x - 40, top: y - 24 }}
    >
      {texto}
      <div className="text-xs font-normal text-muted-foreground">Soltalo sobre un camión</div>
    </div>
  )
}

