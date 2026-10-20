"use client"

import { useState } from "react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { estadoPedido, faltaDe, hhmm, m3txt, textoMotivo, TIPO_TEXTO, type Puntualidad } from "@/lib/despacho"
import { textoBomba, type EmpresaBombeo } from "@/lib/maestros"
import { cn } from "@/lib/utils"
import { MarcaTipo } from "./columna-viajes"
import type { PedidoT, TipoResuelto, ViajeT } from "./tipos"

export type PermisosPedido = {
  despachar: boolean
  ajusta: (p: PedidoT) => boolean
  cancelar: boolean
}

export function ColumnaPedidos({
  pedidos, viajesPorPedido, totalPorPedido, tipos, empresas, puntualidad, permisos,
  onConfirmar, onGerenciador, onEditarTotal, onVerEntregas, onSuspender, onReabrir, onFinalizar, onCancelar,
}: {
  pedidos: PedidoT[]
  viajesPorPedido: Record<string, ViajeT[]>
  totalPorPedido: Record<string, number>
  tipos: Record<string, TipoResuelto>
  empresas: EmpresaBombeo[]
  puntualidad: Record<string, Puntualidad>
  permisos: PermisosPedido
  onConfirmar: (p: PedidoT) => void
  onGerenciador: (p: PedidoT) => void
  onEditarTotal: (p: PedidoT) => void
  onVerEntregas: (p: PedidoT) => void
  onSuspender: (p: PedidoT) => void
  onReabrir: (p: PedidoT) => void
  onFinalizar: (p: PedidoT) => void
  onCancelar: (p: PedidoT) => void
}) {
  const [verCancelados, setVerCancelados] = useState(false)
  const ordenados = [...pedidos].sort((a, b) => new Date(a.scheduled_arrival_time).getTime() - new Date(b.scheduled_arrival_time).getTime())
  const activos = ordenados.filter((p) => ["activo", "suspendido"].includes(estadoPedido(p)))
  const cerrados = ordenados.filter((p) => estadoPedido(p) === "completo")
  const cancelados = ordenados.filter((p) => estadoPedido(p) === "cancelado")
  const noCanc = ordenados.filter((p) => estadoPedido(p) !== "cancelado")
  const conf = noCanc.filter((p) => p.confirmado_at).length

  const tarjeta = (p: PedidoT) => {
    const est = estadoPedido(p)
    const cerr = est === "completo" || est === "cancelado"
    const desp = Number(p.dispatched_m3 || 0)
    const pct = Math.min(100, (desp / Math.max(0.01, Number(p.quantity_m3))) * 100)
    const falta = faltaDe(p)
    const prox = (viajesPorPedido[p.id] || []).filter((v) => v.estado === "planificado").sort((a, b) => new Date(a.hora_carga).getTime() - new Date(b.hora_carga).getTime())[0]
    const tipo = tipos[p.id]?.tipo ?? (p.remito_tipo || null)
    const bomba = p.metodo_descarga === "bomba" ? textoBomba(p, empresas) : null
    const act = est === "activo", susp = est === "suspendido"
    const ajusta = permisos.ajusta(p)
    const finalizado = est === "completo" && (p.cierre_motivo_tipo || desp < Number(p.quantity_m3) - 0.01)
    const pt = puntualidad[p.id]
    return (
      <div key={p.id} className={cn("relative rounded-lg border bg-card px-2.5 py-2", susp && "border-dashed bg-slate-50", cerr && "opacity-75")}>
        <div className="flex items-start gap-1.5">
          <div className="min-w-0 flex-1 text-[15px] font-bold">{p.clients?.name || "Cliente"}</div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-9 w-9 shrink-0 rounded-md text-xl leading-none text-muted-foreground hover:bg-muted" title="Más opciones">⋮</button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[240px]">
              {ajusta && (act || susp) && (
                <DropdownMenuItem className="min-h-[42px]" onClick={() => onConfirmar(p)}>{p.confirmado_at ? "Quitar 👍 confirmación" : "👍 Confirmar"}</DropdownMenuItem>
              )}
              {ajusta && act && <DropdownMenuItem className="min-h-[42px]" onClick={() => onGerenciador(p)}>🚚 Viajes (gerenciador)</DropdownMenuItem>}
              {ajusta && act && <DropdownMenuItem className="min-h-[42px]" onClick={() => onEditarTotal(p)}>✏️ Editar total</DropdownMenuItem>}
              <DropdownMenuItem className="min-h-[42px]" onClick={() => onVerEntregas(p)}>📋 Ver entregas</DropdownMenuItem>
              {permisos.despachar && act && <><DropdownMenuSeparator /><DropdownMenuItem className="min-h-[42px]" onClick={() => onSuspender(p)}>⏸ Suspender (lluvia, obra…)</DropdownMenuItem></>}
              {permisos.despachar && susp && <><DropdownMenuSeparator /><DropdownMenuItem className="min-h-[42px]" onClick={() => onReabrir(p)}>▶ Reabrir</DropdownMenuItem></>}
              {permisos.despachar && (act || susp) && desp > 0 && <DropdownMenuItem className="min-h-[42px]" onClick={() => onFinalizar(p)}>✓ Finalizar con lo enviado</DropdownMenuItem>}
              {permisos.cancelar && (act || susp) && <DropdownMenuItem className="min-h-[42px] text-red-600" onClick={() => onCancelar(p)}>⊘ Cancelar pedido</DropdownMenuItem>}
              {!permisos.cancelar && permisos.despachar && (act || susp) && <DropdownMenuItem disabled className="text-xs">Cancelar: solo gerenciales</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="text-sm">{p.construction_sites?.name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
          <b className="text-foreground">{p.formulas?.code}</b>
          {p.finalidad && <span>· {p.finalidad}</span>}
          <span>· llegada {hhmm(p.scheduled_arrival_time)}</span>
          {bomba ? <span className="rounded bg-cyan-100 px-1.5 text-[11px] font-extrabold text-cyan-800">{bomba}</span> : <span className="rounded bg-slate-200 px-1.5 text-[11px] font-extrabold text-slate-600">DIRECTO</span>}
          {!!p.fiber_kg_per_m3 && <span className="rounded bg-violet-100 px-1.5 text-[11px] font-extrabold text-violet-800">FIBRA {m3txt(p.fiber_kg_per_m3)} kg/m³</span>}
        </div>
        <div className="mt-1.5 flex justify-between text-[13px]">
          <span>Entregado <b className="text-[15px]">{m3txt(desp)}</b> / {m3txt(p.quantity_m3)} m³</span>
          {!cerr && falta > 0 && <span>falta <b className="text-amber-600">{m3txt(falta)}</b></span>}
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200"><i className="block h-full rounded-full bg-green-600" style={{ width: `${pct}%` }} /></div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {tipo
            ? <span className="flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 text-xs font-bold text-muted-foreground"><MarcaTipo tipo={tipo} /> {TIPO_TEXTO[tipo]}</span>
            : est !== "cancelado" && <span className="rounded border border-dashed border-slate-300 bg-muted/40 px-1.5 py-0.5 text-xs font-bold text-muted-foreground">Factura: se pregunta al despachar</span>}
          {p.confirmado_at
            ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-bold text-emerald-700">👍 Confirmado</span>
            : <span className="rounded border border-dashed border-slate-300 px-1.5 py-0.5 text-xs font-bold text-muted-foreground">Sin confirmar</span>}
          {pt && est !== "cancelado" && (
            <span className={cn("rounded px-1.5 py-0.5 text-xs font-bold", pt.clase === "ok" ? "bg-green-100 text-green-800" : pt.clase === "mal" ? "bg-red-100 text-red-800" : "border bg-muted/40 text-muted-foreground")}>{pt.texto}</span>
          )}
          {prox && act && <span className="rounded border bg-muted/40 px-1.5 py-0.5 text-xs font-bold text-muted-foreground">Próximo: {prox.n}/{totalPorPedido[p.id] || "?"} · {hhmm(prox.hora_carga)}</span>}
        </div>
        {susp && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-200 px-2 py-1.5 text-[13px] text-slate-900">
            <span>⏸ <b>Suspendido</b> · {textoMotivo(p.suspendido_motivo_tipo)}{p.suspendido_motivo ? ` — ${p.suspendido_motivo}` : ""} · {p.suspendido_at ? hhmm(p.suspendido_at) : ""} · {p.suspendido_por || ""}</span>
            {permisos.despachar && <button className="min-h-[36px] rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white" onClick={() => onReabrir(p)}>Reabrir</button>}
          </div>
        )}
        {est === "completo" && !finalizado && <div className="mt-2 inline-block rounded bg-green-100 px-1.5 py-0.5 text-xs font-bold text-green-800">✓ Completo</div>}
        {finalizado && <div className="mt-2 inline-block rounded border bg-muted/40 px-1.5 py-0.5 text-xs font-bold text-muted-foreground">Finalizado con {m3txt(desp)} de {m3txt(p.quantity_m3)} m³{p.cierre_motivo_tipo ? ` · ${textoMotivo(p.cierre_motivo_tipo)}` : ""}</div>}
        {est === "cancelado" && <div className="mt-2 inline-block rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-red-800">Cancelado{p.cierre_motivo_tipo ? ` · ${textoMotivo(p.cierre_motivo_tipo)}` : ""}{p.cierre_motivo ? ` — ${p.cierre_motivo}` : ""}</div>}
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
        <h2 className="text-base font-bold">Pedidos</h2>
        <span className="rounded-full border bg-muted/40 px-2 text-xs font-bold text-muted-foreground">{activos.length}</span>
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground">👍 {conf} de {noCanc.length} confirmados</span>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-auto p-2.5">
        {activos.map(tarjeta)}
        {cerrados.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer list-none px-0.5 pt-2 text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
              ▸ Completos y finalizados ({cerrados.length})
            </summary>
            <div className="mt-2 flex flex-col gap-2">{cerrados.map(tarjeta)}</div>
          </details>
        )}
        {cancelados.length > 0 && (
          <>
            <button className="min-h-[32px] self-start rounded-full border bg-card px-3 text-[13px] font-semibold text-muted-foreground" onClick={() => setVerCancelados((v) => !v)}>
              ⊘ {verCancelados ? "Ocultar" : "Ver"} cancelados ({cancelados.length})
            </button>
            {verCancelados && cancelados.map(tarjeta)}
          </>
        )}
        {!ordenados.length && <div className="py-8 text-center text-sm text-muted-foreground">No hay pedidos para este día.</div>}
      </div>
    </>
  )
}
