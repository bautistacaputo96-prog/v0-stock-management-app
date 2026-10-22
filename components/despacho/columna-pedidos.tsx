"use client"

/**
 * Columna Pedidos como las "Programações" de Loop (22/10): número de pedido (y hora pedida), cliente en gris y
 * "14 / 35 m³"; a la derecha ⓘ (detalle) y ⋮ (menú); barra violeta a la izquierda.
 */
import { useState } from "react"
import { Info } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { estadoPedido, faltaDe, hhmm, m3txt, textoMotivo, TIPO_TEXTO, type Puntualidad } from "@/lib/despacho"
import { textoBomba, type EmpresaBombeo } from "@/lib/maestros"
import { cn } from "@/lib/utils"
import { Buscador, coincide } from "./buscador"
import type { PedidoT, TipoResuelto, ViajeT } from "./tipos"

export type PermisosPedido = {
  despachar: boolean
  ajusta: (p: PedidoT) => boolean
  cancelar: boolean
}

export function ColumnaPedidos({
  pedidos, viajesPorPedido, totalPorPedido, tipos, empresas, puntualidad, permisos, numeroPedido,
  onConfirmar, onGerenciador, onEditarTotal, onVerEntregas, onSuspender, onReabrir, onFinalizar, onCancelar,
}: {
  pedidos: PedidoT[]
  viajesPorPedido: Record<string, ViajeT[]>
  totalPorPedido: Record<string, number>
  tipos: Record<string, TipoResuelto>
  empresas: EmpresaBombeo[]
  puntualidad: Record<string, Puntualidad>
  permisos: PermisosPedido
  /** número del pedido en el día */
  numeroPedido: Record<string, number>
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
  const [buscar, setBuscar] = useState("")
  const ordenados = [...pedidos].filter((p) => coincide(buscar, numeroPedido[p.id], p.clients?.name, p.construction_sites?.name, p.formulas?.code)).sort((a, b) => new Date(a.scheduled_arrival_time).getTime() - new Date(b.scheduled_arrival_time).getTime())
  const activos = ordenados.filter((p) => ["activo", "suspendido"].includes(estadoPedido(p)))
  const cerrados = ordenados.filter((p) => estadoPedido(p) === "completo")
  const cancelados = ordenados.filter((p) => estadoPedido(p) === "cancelado")
  const noCanc = ordenados.filter((p) => estadoPedido(p) !== "cancelado")
  const conf = noCanc.filter((p) => p.confirmado_at).length

  const tarjeta = (p: PedidoT) => {
    const est = estadoPedido(p)
    const cerr = est === "completo" || est === "cancelado"
    const desp = Number(p.dispatched_m3 || 0)
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
      <div key={p.id} className={cn("d3c-card relative rounded-md border border-l-[3px] border-slate-200 border-l-violet-700 bg-slate-50", susp && "border-dashed", cerr && "opacity-70")}>
        <div className="flex items-center gap-1.5 py-1 pl-2 pr-0.5">
          <div className="min-w-0 flex-1 leading-tight">
            <div className="flex items-center gap-1 text-[12.5px] font-medium">
              <span className="tabular-nums">{numeroPedido[p.id] ?? "—"} – {hhmm(p.scheduled_arrival_time)}</span>
              {p.confirmado_at && <span title="Confirmado" className="text-[11px]">👍</span>}
              {pt && est !== "cancelado" && <span className={cn("shrink-0 text-[10px]", pt.clase === "ok" ? "text-emerald-700" : pt.clase === "mal" ? "text-red-700" : "text-slate-400")} title={pt.texto}>●</span>}
            </div>
            <div className="truncate text-[11px] text-slate-500">{p.clients?.name || "Cliente"}</div>
            <div className="text-[11px] tabular-nums">{m3txt(desp)} / {m3txt(p.quantity_m3)} m³</div>
          </div>
          <button
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-200"
            title={abierto ? "Ocultar el detalle" : "Ver el detalle"}
            aria-expanded={abierto}
            onClick={() => setAbiertos((a) => ({ ...a, [p.id]: !a[p.id] }))}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-6 w-6 shrink-0 rounded text-base leading-none text-muted-foreground hover:bg-muted" title="Más opciones">⋮</button>
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
        {susp && (
          <div className="flex items-center gap-2 border-t px-2 py-0.5 text-[11px]">
            <span className="min-w-0 flex-1 truncate">⏸ Suspendido · {textoMotivo(p.suspendido_motivo_tipo)}{p.suspendido_motivo ? ` — ${p.suspendido_motivo}` : ""} · {p.suspendido_at ? hhmm(p.suspendido_at) : ""} · {p.suspendido_por || ""}</span>
            {permisos.despachar && <button className="h-6 shrink-0 rounded border px-2 text-[11px]" onClick={() => onReabrir(p)}>Reabrir</button>}
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
          <div className="space-y-0.5 border-t px-2 py-1 text-[11px] leading-snug text-muted-foreground">
            <div className="text-foreground">{p.construction_sites?.name}{p.construction_sites?.address ? ` · ${p.construction_sites.address}` : ""}</div>
            <div><span className="text-foreground">{p.formulas?.code}</span>{p.finalidad ? ` · ${p.finalidad}` : ""} · llegada {hhmm(p.scheduled_arrival_time)} · {bomba || "Directo"}{Number(p.fiber_kg_per_m3) > 0 ? ` · Fibra ${m3txt(p.fiber_kg_per_m3)} kg/m³` : ""}</div>
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
        <h2 className="text-[12px] font-medium">Pedidos</h2>
        <span className="text-xs text-muted-foreground">{activos.length}</span>
        <span className="flex-1" />
        <span className="text-[11px] text-muted-foreground">👍 {conf} de {noCanc.length} confirmados</span>
      </div>
      <Buscador valor={buscar} onCambio={setBuscar} />
      <div className="flex flex-1 flex-col gap-1 overflow-auto p-1.5">
        {activos.map(tarjeta)}
        {cerrados.length > 0 && (
          <details>
            <summary className="flex min-h-[28px] cursor-pointer list-none items-center px-1 text-[11px] uppercase tracking-wide text-muted-foreground">
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
        {!ordenados.length && <div className="py-6 text-center text-xs text-muted-foreground">{buscar ? `Nada coincide con «${buscar}».` : "No hay pedidos para este día."}</div>}
      </div>
    </>
  )
}
