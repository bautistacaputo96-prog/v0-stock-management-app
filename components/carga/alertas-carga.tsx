"use client"

/**
 * Pestaña Alertas de la pantalla de Carga y el diálogo Resolver (6.5 con 19.4).
 * Resolver lo ve y lo puede hacer solo quien tiene Fórmulas · editar (lo controla también el servidor).
 */
import { useMemo, useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { CampoMotivo, motivoValido } from "@/components/motivo"
import { cn } from "@/lib/utils"
import { controlDeFormula, type Contexto } from "@/lib/carga/datos"
import { fichaParaIndumix } from "@/lib/carga/receta"
import { INFO_SALIDA, nf, type FormulaSistema } from "@/lib/carga/tipos"
import { Btn, Tag, hhmm } from "./comun"
import { MotivoDialog, TablaComparacion } from "./dialogos-carga"
import { Buscador, coincide } from "@/components/despacho/buscador"
import type { AlertaFila, CargaFila } from "./usar-datos-carga"

const ORDEN: Record<string, number> = { abierta: 0, esperando_planta: 1, resuelta: 2, cerrada_sola: 3 }
const ETQ: Record<string, string> = { abierta: "Abierta", esperando_planta: "Esperando a la planta", resuelta: "Resuelta", cerrada_sola: "Se cerró sola" }

export function AlertasCarga({ alertas, ctx, formulas, cargas, puedeResolver, puedeDescartar, simulada, onResuelto, onAviso }: {
  alertas: AlertaFila[]; ctx: Contexto; formulas: FormulaSistema[]; cargas: CargaFila[]
  puedeResolver: boolean; puedeDescartar: boolean; simulada: boolean; onResuelto: () => void; onAviso: (t: string, d?: string) => void
}) {
  const [resolver, setResolver] = useState<AlertaFila | null>(null)
  const [descartar, setDescartar] = useState<AlertaFila | null>(null)
  const [verCerradas, setVerCerradas] = useState(false)
  const [buscar, setBuscar] = useState("")
  const lista = useMemo(() => [...alertas].filter((a) => (verCerradas || ["abierta", "esperando_planta"].includes(a.estado)) && coincide(buscar, a.titulo, a.detalle?.motivo, a.detalle?.diferencias, a.receta_numero))
    .sort((a, b) => (ORDEN[a.estado] - ORDEN[b.estado]) || b.created_at.localeCompare(a.created_at)), [alertas, verCerradas, buscar])
  const cerradas = alertas.filter((a) => !["abierta", "esperando_planta"].includes(a.estado)).length

  async function enviar(a: AlertaFila, body: Record<string, unknown>) {
    const r = await fetch(`/api/carga/alertas/${a.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { onAviso("No se pudo", j?.error); return false }
    onResuelto()
    return true
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">Una alerta por receta y fórmula (no una por lectura). La resuelve quien tiene Fórmulas · editar{simulada ? "; las de la planta simulada no mandan mail" : ""}.</span>
        <span className="flex-1" />
        <label className="inline-flex items-center gap-1"><input type="checkbox" checked={verCerradas} onChange={(e) => setVerCerradas(e.target.checked)} /> Ver también las cerradas ({cerradas})</label>
      </div>
      <div className="-mx-1.5 max-w-md"><Buscador valor={buscar} onCambio={setBuscar} /></div>
      {!lista.length && <div className="py-8 text-center text-xs text-slate-500">No hay alertas abiertas.</div>}
      {lista.map((a) => {
        const frena = a.detalle?.frena !== false && a.tipo === "receta_no_coincide"
        const tono = a.estado === "resuelta" || a.estado === "cerrada_sola" ? "border-l-emerald-500 opacity-80" : a.tipo === "receta_cambiada" || (a.tipo === "receta_no_coincide" && !frena) ? "border-l-amber-500" : a.tipo === "carga_desde_indumix" || a.tipo === "receta_nueva" ? "border-l-slate-500" : "border-l-red-600"
        return (
          <div key={a.id} className={cn("d3c-card flex flex-wrap items-start gap-2 rounded-md border border-l-[3px] border-slate-200 bg-slate-50 px-2 py-1 text-xs", tono)}>
            <div className="min-w-[240px] flex-1">
              <b className="font-medium">{a.titulo}</b>
              {a.detalle?.motivo && <div className="mt-px text-[11px] text-slate-500">{a.detalle.motivo}</div>}
              {a.detalle?.diferencias && <div className="mt-px text-[11px] text-slate-500">{a.detalle.diferencias}{a.detalle.nota ? ` · ${a.detalle.nota}` : ""}</div>}
              {a.detalle?.despachos_frenados?.length > 0 && <div className="mt-px text-[11px] text-red-700">Despachado igual: {a.detalle?.despachos_frenados.map((d: any) => `remito ${d.remito} (${d.camion || "-"}, ${d.por} ${hhmm(d.at)})`).join(" · ")} · mail a Juan Oreguy</div>}
              {a.detalle?.ficha && (
                <div className="mt-1 rounded-md border border-dashed border-slate-400 px-2 py-1 font-mono text-[11px]">
                  FICHA PARA INDUMIX · RECETAS › <b className="font-medium">{a.detalle.ficha.numero}</b> «{a.detalle.ficha.nombre}»<br />
                  {a.detalle.ficha.lineas.map((l: any) => <span key={l.salida}>{l.nombre_planta} ({INFO_SALIDA[l.salida as keyof typeof INFO_SALIDA]?.nombre}): {nf(l.antes)} → <b className="font-medium">{nf(l.despues)}</b><br /></span>)}
                  {a.detalle.ficha.aguaPendiente && <>Agua: NO tocar hasta que confirme Grow<br /></>}→ GUARDAR · pedida por {a.detalle.ficha.pedida_por} {hhmm(a.detalle.ficha.pedida_at)}
                </div>
              )}
              {a.detalle?.autorizadas?.length > 0 && <div className="mt-px text-[11px] text-amber-800">Autorizada solo esa carga: {a.detalle?.autorizadas.map((x: any) => `remito ${x.remito || "—"} por ${x.por} («${x.motivo}»)`).join(" · ")}</div>}
              {(a.resuelta_por || a.motivo) && <div className="mt-px text-[11px] text-slate-500"><b className="font-medium">Hecho:</b> {[a.motivo, a.resuelta_por].filter(Boolean).join(" · ")}</div>}
              <div className="mt-px text-[11px] text-slate-500">{hhmm(a.created_at)}{a.detalle?.simulada ? " · planta simulada" : ""}</div>
            </div>
            <Tag tono={a.estado === "resuelta" || a.estado === "cerrada_sola" ? "ok" : a.estado === "esperando_planta" ? "blue" : frena || a.tipo !== "receta_no_coincide" ? "bad" : "warn"}>{ETQ[a.estado]}</Tag>
            {a.tipo === "receta_no_coincide" && ["abierta", "esperando_planta"].includes(a.estado) && puedeResolver && <Btn tono="pri" className="h-[26px] text-xs" onClick={() => setResolver(a)}>Resolver</Btn>}
            {["abierta", "esperando_planta"].includes(a.estado) && puedeDescartar && <Btn tono="ghost" className="h-[26px] text-xs" onClick={() => setDescartar(a)}>Descartar…</Btn>}
          </div>
        )
      })}
      {resolver && (
        <ResolverDialog alerta={resolver} ctx={ctx} formula={formulas.find((f) => f.id === resolver.formula_id) || null}
          cargas={cargas.filter((c) => c.formula_id === resolver.formula_id && ["pendiente", "bloqueada", "lista"].includes(c.estado))}
          simulada={simulada} onEnviar={(b) => enviar(resolver, b)} onCerrar={() => setResolver(null)} />
      )}
      {descartar && (
        <MotivoDialog titulo="Descartar la alerta" cuerpo={descartar.titulo} boton="Descartar" ejemplo="Ej.: ya se revisó con la planta"
          onConfirmar={(m) => enviar(descartar, { opcion: "descartar", motivo: m })} onCerrar={() => setDescartar(null)} />
      )}
    </div>
  )
}

export function ResolverDialog({ alerta, ctx, formula, cargas, simulada, onEnviar, onCerrar }: {
  alerta: AlertaFila; ctx: Contexto; formula: FormulaSistema | null; cargas: CargaFila[]; simulada: boolean
  onEnviar: (b: Record<string, unknown>) => Promise<boolean>; onCerrar: () => void
}) {
  const [opt, setOpt] = useState<"planta" | "autorizar" | "formula">("planta")
  const [grow, setGrow] = useState(false)
  const [growQuien, setGrowQuien] = useState("")
  const [motivo, setMotivo] = useState("")
  const [cargaId, setCargaId] = useState(cargas[0]?.id || "")
  const [env, setEnv] = useState(false)
  const receta = ctx.recetas.find((r) => r.numero === alerta.receta_numero) || null
  const ctl = formula ? controlDeFormula(ctx, formula) : null
  const ficha = receta && formula ? fichaParaIndumix(receta, formula, ctx.salidas, ctx.materiales, grow) : null
  const tolvaMal = (k: CargaFila) => (k.bloqueo?.items || []).some((i) => i.clave === "tolva" && !i.ok)
  const ops: [typeof opt, string, string][] = [
    ["planta", "1. Corregir la receta de la planta · recomendado", "Se arma la ficha para Indumix. Se desbloquea sola cuando el puente lee la receta corregida."],
    ["autorizar", "2. Autorizar solo esta carga", "Se carga con la receta de la planta. Una carga, con motivo, hasta el fin del día, marcada en la auditoría. No sirve para la Tolva 1."],
    ["formula", "3. Corregir nuestra fórmula · excepción", simulada ? "Con la planta simulada no se toca la fórmula real." : "Solo si Grow o el laboratorio cambiaron la dosificación. Se hace desde Fórmulas."],
  ]
  const puede = opt === "planta" ? !!ficha : opt === "autorizar" ? !!cargaId && motivoValido(motivo) : false
  async function confirmar() {
    setEnv(true)
    const ok = opt === "planta"
      ? await onEnviar({ opcion: "corregir_planta", grow_confirmo: grow, grow_quien: growQuien, motivo })
      : await onEnviar({ opcion: "autorizar_una_vez", carga_id: cargaId, motivo })
    setEnv(false)
    if (ok) onCerrar()
  }
  return (
    <Dialog open onOpenChange={(v) => !v && !env && onCerrar()}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-[820px]">
        <DialogHeader><DialogTitle>Resolver · receta {alerta.receta_numero} contra {formula?.code || "?"}</DialogTitle></DialogHeader>
        <div className="space-y-2 text-xs">
          <div className="rounded-md bg-muted/50 px-2 py-1.5 text-xs"><b className="font-medium">La que vale es la fórmula del sistema</b>: Indumix se adapta a ella (Bautista, 20/10). El cemento, los áridos y el aditivo frenan; el agua resalta y no frena.</div>
          {ctl?.cmp && <TablaComparacion cmp={ctl.cmp} />}
          {ctl?.aguaDistinta && ctl.ac && <div className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900"><b className="font-medium">Agua:</b> se compara la receta base, porque Indumix descuenta la humedad de los áridos. Relación agua/cemento {nf(ctl.ac.receta, 2)} en la planta contra {nf(ctl.ac.formula, 2)} de la fórmula: antes de pasarla a la planta conviene que lo confirme Grow.</div>}
          <div className="flex flex-col gap-1">
            {ops.map(([k, t, d]) => (
              <button key={k} disabled={k === "formula"} onClick={() => setOpt(k)} className={cn("w-full rounded-md border px-2.5 py-1.5 text-left disabled:opacity-60", opt === k && "border-blue-500 ring-2 ring-blue-100")}>
                <div className="font-medium">{t}</div><div className="text-[11px] text-slate-500">{d}</div>
              </button>
            ))}
          </div>
          {opt === "planta" && ficha && (
            <>
              {ctl?.aguaDistinta && (
                <label className="flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={grow} onChange={(e) => setGrow(e.target.checked)} />
                  <span><b className="font-medium">Grow confirmó el agua de la fórmula</b>. Sin esta casilla la ficha no lleva el agua (que igual no frena la carga).
                    {grow && <input className="mt-1 block h-[28px] w-full rounded-md border px-2 text-xs" placeholder="¿Quién de Grow confirmó?" value={growQuien} onChange={(e) => setGrowQuien(e.target.value)} />}
                  </span>
                </label>
              )}
              <div className="rounded-md border border-dashed border-slate-400 px-2 py-1.5 font-mono text-xs">
                FICHA PARA INDUMIX · RECETAS › <b className="font-medium">{receta?.numero}</b> «{receta?.nombre}»<br />
                {ficha.lineas.length ? ficha.lineas.map((l) => <span key={l.salida}>{l.nombre_planta} ({INFO_SALIDA[l.salida].nombre}): {nf(l.antes)} → <b className="font-medium">{nf(l.despues)}</b><br /></span>) : <>(sin cambios de cemento, áridos ni aditivo)<br /></>}
                {ficha.aguaPendiente && <>Agua: NO tocar hasta que confirme Grow<br /></>}→ GUARDAR
              </div>
              <div className="text-[11px] text-slate-500">Se puede imprimir o mandar por WhatsApp a mano. {simulada ? "En la planta simulada, la corrección se prueba con «Simular… › Aplicar la ficha en Indumix»." : ""}</div>
            </>
          )}
          {opt === "autorizar" && (
            <>
              {cargas.length ? (
                <label className="block text-[11px] font-medium">Carga
                  <select className="mt-0.5 block h-[30px] w-full rounded-md border bg-card px-1.5 text-xs" value={cargaId} onChange={(e) => setCargaId(e.target.value)}>
                    {cargas.map((k) => <option key={k.id} value={k.id} disabled={tolvaMal(k)}>{k.mixers?.license_plate || k.patente_planta || "—"} · remito {k.remito || "—"} · {k.m3} m³{tolvaMal(k) ? " (Tolva 1 equivocada: no se autoriza)" : ""}</option>)}
                  </select>
                </label>
              ) : <div className="text-xs text-slate-500">No hay cargas de esta fórmula esperando en la cola.</div>}
              <CampoMotivo value={motivo} onChange={setMotivo} ejemplo="Ej.: camión esperando y la ficha ya pedida" />
            </>
          )}
        </div>
        <DialogFooter><Btn onClick={onCerrar} disabled={env}>Cancelar</Btn><Btn tono="pri" disabled={!puede || env} onClick={confirmar}>Confirmar</Btn></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
