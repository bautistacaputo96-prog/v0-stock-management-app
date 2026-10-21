"use client"

/**
 * Columna Pedidos, compacta: dos líneas por pedido (llegada, cliente, entregado/total, R/X / obra, fórmula y barra).
 * Lo demás (bomba, fibra, confirmado, puntualidad, próximo viaje) se despliega con ▾.
 */
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
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({})
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
    const abierto = !!abiertos[p.id]
    return (
      <div key={p.id} className={cn("d3c-card relative rounded-md border bg-card", susp && "border-dashed", cerr && "opacity-70")}>
        <div className="flex items-center gap-1.5 py-[3px] pl-2 pr-0.5">
          <div className="w-[38px] shrink-0 text-[12.5px] font-semibold tabular-nums leading-tight" title="Llegada pedida">{hhmm(p.scheduled_arrival_time)}</div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="flex items-center gap-1">
              <span className="min-w-0 truncate text-[13px] font-medium">{p.clients?.name || "Cliente"}</span>
              <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground"><b className="font-semibold text-foreground">{m3txt(desp)}</b>/{m3txt(p.quantity_m3)} m³</span>
            </div>
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              {est !== "cancelado" && <MarcaTipo tipo={tipo} />}
              {p.confirmado_at && <span title="Confirmado">👍</span>}
              {pt && est !== "cancelado" && <span className={cn("shrink-0", pt.clase === "ok" ? "text-emerald-700" : pt.clase === "mal" ? "text-red-700" : "")} title={pt.texto}>●</span>}
              <span className="min-w-0 truncate">{p.construction_sites?.name} · <span className="text-foreground/80">{p.formulas?.code}</span>{p.finalidad ? ` · ${p.finalidad}` : ""}{bomba ? <> · <span className="font-medium text-cyan-800">bomba</span></> : " · directo"}</span>
            </div>
          </div>
          <button
            className="flex h-8 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
            title={abierto ? "Ocultar el detalle" : "Ver el detalle"}
            aria-expanded={abierto}
            onClick={() => setAbiertos((a) => ({ ...a, [p.id]: !a[p.id] }))}
          >
            {abierto ? "▴" : "▾"}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-8 w-7 shrink-0 rounded text-lg leading-none text-muted-foreground hover:bg-muted" title="Más opciones">⋮</button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[230px]">
              {ajusta && (act || susp) && (
                <DropdownMenuItem className="min-h-[32px]" onClick={() => onConfirmar(p)}>{p.confirmado_at ? "Quitar 👍 confirmación" : "👍 Confirmar"}</DropdownMenuItem>
              )}
              {ajusta && act && <DropdownMenuItem className="min-h-[32px]" onClick={() => onGerenciador(p)}>🚚 Viajes (gerenciador)</DropdownMenuItem>}
              {ajusta && act && <DropdownMenuItem className="min-h-[32px]" onClick={() => onEditarTotal(p)}>✏️ Editar total</DropdownMenuItem>}
              <DropdownMenuItem className="min-h-[32px]" onClick={() => onVerEntregas(p)}>📋 Ver entregas</DropdownMenuItem>
              {permisos.despachar && act && <><DropdownMenuSeparator /><DropdownMenuItem className="min-h-[32px]" onClick={() => onSuspender(p)}>⏸ Suspender (lluvia, obra…)</DropdownMenuItem></>}
              {permisos.despachar && susp && <><DropdownMenuSeparator /><DropdownMenuItem className="min-h-[32px]" onClick={() => onReabrir(p)}>▶ Reabrir</DropdownMenuItem></>}
              {permisos.despachar && (act || susp) && desp > 0 && <DropdownMenuItem className="min-h-[32px]" onClick={() => onFinalizar(p)}>✓ Finalizar con lo enviado</DropdownMenuItem>}
              {permisos.cancelar && (act || susp) && <DropdownMenuItem className="min-h-[32px] text-red-600" onClick={() => onCancelar(p)}>⊘ Cancelar pedido</DropdownMenuItem>}
              {!permisos.cancelar && permisos.despachar && (act || susp) && <DropdownMenuItem disabled className="text-xs">Cancelar: solo gerenciales</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* Barra de lo entregado */}
        <div className="mx-2 mb-1 h-[3px] overflow-hidden rounded-full bg-muted"><i className="block h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
        {susp && (
          <div className="flex items-center gap-2 border-t px-2 py-0.5 text-[11.5px]">
            <span className="min-w-0 flex-1 truncate">⏸ <b className="font-semibold">Suspendido</b> · {textoMotivo(p.suspendido_motivo_tipo)}{p.suspendido_motivo ? ` — ${p.suspendido_motivo}` : ""} · {p.suspendido_at ? hhmm(p.suspendido_at) : ""} · {p.suspendido_por || ""}</span>
            {permisos.despachar && <button className="h-8 shrink-0 rounded-md border px-2.5 text-xs font-medium" onClick={() => onReabrir(p)}>Reabrir</button>}
          </div>
        )}
        {(est === "completo" || est === "cancelado") && (
          <div className="px-2 pb-1 text-[11px] text-muted-foreground">
            {est === "completo" && !finalizado && "✓ Completo"}
            {finalizado && `Finalizado con ${m3txt(desp)} de ${m3txt(p.quantity_m3)} m³${p.cierre_motivo_tipo ? ` · ${textoMotivo(p.cierre_motivo_tipo)}` : ""}`}
            {est === "cancelado" && <span className="text-red-700">Cancelado{p.cierre_motivo_tipo ? ` · ${textoMotivo(p.cierre_motivo_tipo)}` : ""}{p.cierre_motivo ? ` — ${p.cierre_motivo}` : ""}</span>}
          </div>
        )}
        {abierto && (
          <div className="space-y-0.5 border-t px-2 py-1.5 text-[11.5px] leading-snug text-muted-foreground">
            <div className="text-foreground">{p.construction_sites?.name}</div>
            <div><b className="font-medium text-foreground">{p.formulas?.code}</b>{p.finalidad ? ` · ${p.finalidad}` : ""} · llegada {hhmm(p.scheduled_arrival_time)} · {bomba || "Directo"}{Number(p.fiber_kg_per_m3) > 0 ? ` · Fibra ${m3txt(p.fiber_kg_per_m3)} kg/m³` : ""}</div>
            <div>Entregado {m3txt(desp)} de {m3txt(p.quantity_m3)} m³{!cerr && falta > 0 ? ` · falta ${m3txt(falta)}` : ""}</div>
            <div>{tipo ? `Remito ${tipo} · ${TIPO_TEXTO[tipo]}` : "Factura: se pregunta al despachar"} · {p.confirmado_at ? "👍 Confirmado" : "Sin confirmar"}</div>
            {pt && est !== "cancelado" && <div className={cn(pt.clase === "ok" ? "text-emerald-700" : pt.clase === "mal" ? "text-red-700" : "")}>{pt.texto}</div>}
            {prox && act && <div>Próximo: viaje {prox.n}/{totalPorPedido[p.id] || "?"} · carga {hhmm(prox.hora_carga)}</div>}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b px-2.5 py-1.5">
        <h2 className="text-sm font-semibold">Pedidos</h2>
        <span className="text-xs text-muted-foreground">{activos.length}</span>
        <span className="flex-1" />
        <span className="text-[11px] text-muted-foreground">👍 {conf} de {noCanc.length} confirmados</span>
      </div>
      <div className="flex flex-1 flex-col gap-[3px] overflow-auto p-1.5">
        {activos.map(tarjeta)}
        {cerrados.length > 0 && (
          <details>
            <summary className="flex min-h-[28px] cursor-pointer list-none items-center px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              ▸ Completos y finalizados ({cerrados.length})
            </summary>
            <div className="flex flex-col gap-[3px]">{cerrados.map(tarjeta)}</div>
          </details>
        )}
        {cancelados.length > 0 && (
          <>
            <button className="min-h-[28px] self-start px-1 text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={() => setVerCancelados((v) => !v)}>
              ⊘ {verCancelados ? "Ocultar" : "Ver"} cancelados ({cancelados.length})
            </button>
            {verCancelados && cancelados.map(tarjeta)}
          </>
        )}
        {!ordenados.length && <div className="py-6 text-center text-xs text-muted-foreground">No hay pedidos para este día.</div>}
      </div>
    </>
  )
}
