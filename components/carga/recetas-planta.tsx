"use client"

/** Pestaña "Recetas de la planta": las 20 de Indumix contra nuestras fórmulas, el mapa de salidas y lo que no entra (6 y 7). */
import { useState } from "react"
import { cn } from "@/lib/utils"
import { controlReceta } from "@/lib/carga/receta"
import type { Contexto, Puesto } from "@/lib/carga/datos"
import { INFO_SALIDA, SALIDAS, type FormulaSistema } from "@/lib/carga/tipos"
import { Btn, Tag, hhmm } from "./comun"
import { TablaComparacion } from "./dialogos-carga"

const ETAPAS: [Puesto["etapa"], string][] = [["arranque", "C · Cargar desde el sistema"], ["orden", "B · Orden preparada"], ["lectura", "A · Solo lectura"], ["apagado", "Apagado"]]

export function RecetasPlanta({ ctx, formulas, puedeEditar, enPlanta, ultimaLectura, onLeer, onCambiarTolva, onArmar, onEtapa }: {
  ctx: Contexto; formulas: (FormulaSistema & { usos?: number })[]; puedeEditar: boolean; enPlanta: boolean; ultimaLectura: number | null
  onLeer: () => void; onCambiarTolva: (() => void) | null; onArmar: () => Promise<void>; onEtapa: (e: Puesto["etapa"]) => void
}) {
  const [abierta, setAbierta] = useState<number | null>(13)
  const [armando, setArmando] = useState(false)
  const porId = new Map(formulas.map((f) => [f.id, f]))
  const mat = (id: string | null) => (id ? ctx.materiales.find((m) => m.id === id)?.name || "?" : "—")
  const numeros = Array.from({ length: ctx.puesto.max_recetas }, (_, i) => i + 1)
  const asignadas = new Set(ctx.asignaciones.map((a) => a.formula_id).filter(Boolean))
  const sinLugar = formulas.filter((f) => !asignadas.has(f.id)).sort((a, b) => (b.usos || 0) - (a.usos || 0))
  const ultima = ctx.recetas.reduce<string | null>((m, r) => (!m || r.ultima_lectura_at > m ? r.ultima_lectura_at : m), null)

  return (
    <div className="space-y-2">
      <div className="d3c-card rounded-md border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b px-2.5 py-1">
          <h2 className="text-sm font-semibold">Las {ctx.puesto.max_recetas} recetas de la planta · {ctx.puesto.nombre}</h2>
          <span className="flex-1" />
          <span className="text-[11px] text-muted-foreground">el puente las lee cada 5 min y antes de cada carga · última {hhmm(ultimaLectura || ultima)}</span>
          {enPlanta && <Btn className="h-[26px] text-[12px]" onClick={onLeer}>Leer ahora</Btn>}
          {puedeEditar && (
            <label className="inline-flex items-center gap-1 text-[12px]">Etapa
              <select className="h-[26px] rounded-md border bg-card px-1 text-[12px]" value={ctx.puesto.etapa} onChange={(e) => onEtapa(e.target.value as Puesto["etapa"])}>
                {ETAPAS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          )}
        </div>
        {!ctx.recetas.length ? (
          <div className="space-y-1.5 px-3 py-4 text-[12.5px]">
            <p>La planta simulada todavía no tiene recetas. Se arman con las fórmulas de {ctx.puesto.nombre.split(" ·")[0]}: 1 a 16 las más usadas en 6 meses, 17 y 18 rotativas, 19 una receta sin fórmula y 20 vacía. La <b>13</b> es la H30-612-15 B con los valores reales de la foto de Indumix (CP 40 = 350 y Agua = 110), para ver el problema de verdad.</p>
            {puedeEditar ? <Btn tono="pri" disabled={armando} onClick={async () => { setArmando(true); await onArmar(); setArmando(false) }}>Armar las 20 recetas del simulador</Btn> : <p className="text-muted-foreground">Lo hace quien tiene Carga · editar.</p>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead><tr className="bg-muted/50 text-left text-[11px] text-muted-foreground">
                {["N°", "Nombre en Indumix", "Fórmula del sistema", "Tipo", "Estado", "Leída", ""].map((h) => <th key={h} className="border-b px-1.5 py-0.5 font-semibold">{h}</th>)}
              </tr></thead>
              <tbody>
                {numeros.map((n) => {
                  const r = ctx.recetas.find((x) => x.numero === n) || null
                  const a = ctx.asignaciones.find((x) => x.numero === n) || null
                  const f = a?.formula_id ? porId.get(a.formula_id) || null : null
                  const vacia = !r || !r.salidas.some((s) => s.valor > 0)
                  const ctl = f && r && !vacia ? controlReceta({ numero: n, receta: r, formula: f, salidas: ctx.salidas, materiales: ctx.materiales, tolerancias: ctx.puesto.tolerancias }) : null
                  const [est, tono] = vacia ? ["Vacía", "slate"] as const : !f ? ["Sin fórmula", "warn"] as const : ctl?.frenaReceta ? ["No coincide", "bad"] as const : ctl?.aguaDistinta ? ["Agua distinta", "warn"] as const : ["Coincide", "ok"] as const
                  const open = abierta === n
                  return [
                    <tr key={n} className="cursor-pointer hover:bg-muted/40" onClick={() => setAbierta(open ? null : n)}>
                      <td className="border-b px-1.5 py-0.5 font-semibold">{n}</td>
                      <td className="border-b px-1.5 py-0.5">{vacia ? <span className="text-muted-foreground">(vacía)</span> : r?.nombre || "(sin nombre)"}</td>
                      <td className="border-b px-1.5 py-0.5">{f?.code || "—"}</td>
                      <td className="border-b px-1.5 py-0.5 text-muted-foreground">{a?.tipo || (n <= 16 ? "fija" : "rotativa")}</td>
                      <td className="border-b px-1.5 py-0.5"><Tag tono={tono}>{est}</Tag></td>
                      <td className="border-b px-1.5 py-0.5 text-muted-foreground">{hhmm(r?.ultima_lectura_at)}</td>
                      <td className="border-b px-1.5 py-0.5">{open ? "▴" : "▾"}</td>
                    </tr>,
                    open && !vacia ? (
                      <tr key={`${n}-d`}><td colSpan={7} className="border-b px-2 py-1.5">
                        {ctl?.cmp ? <TablaComparacion cmp={ctl.cmp} /> : <span className="text-muted-foreground">Receta de Indumix sin fórmula en el sistema.</span>}
                        {ctl?.items.filter((i) => i.clave === "tolva").map((i) => <div key={i.texto} className={cn("mt-1 text-[11.5px]", i.ok ? "text-muted-foreground" : "font-semibold text-red-700")}>{i.texto}</div>)}
                      </td></tr>
                    ) : null,
                  ]
                })}
              </tbody>
            </table>
            <div className="px-2 py-1 text-[11px] text-muted-foreground">Se comparan solo los materiales que pasan por la planta (el aditivo de obra y la fibra, no). El agua se compara sobre la receta base. A confirmar el jueves: ¿las fórmulas de 6/20 usan la Tolva 1 o la 4?</div>
          </div>
        )}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <div className="d3c-card rounded-md border bg-card">
          <div className="border-b px-2.5 py-1"><h2 className="text-sm font-semibold">Qué hay en cada salida</h2></div>
          <table className="w-full border-collapse text-[12px]"><tbody>
            {SALIDAS.map((s) => {
              const x = ctx.salidas.find((y) => y.salida === s)
              const fila = ctx.salidasFilas.find((y) => y.salida === s)
              return (
                <tr key={s}>
                  <td className="border-b px-1.5 py-0.5 font-semibold">{INFO_SALIDA[s].nombre}</td>
                  <td className="border-b px-1.5 py-0.5 text-muted-foreground">«{x?.nombre_planta || ""}»</td>
                  <td className="border-b px-1.5 py-0.5">{mat(x?.material_id ?? null)}{x?.alternativas?.length && onCambiarTolva ? <button className="ml-1 h-[18px] rounded border bg-card px-1 text-[10.5px]" onClick={onCambiarTolva}>Cambiar</button> : null}
                    {x?.alternativas?.length ? <div className="text-[10.5px] text-muted-foreground">desde {hhmm(fila?.vigente_desde)} · {fila?.cambiado_por || ""}</div> : null}</td>
                  <td className="border-b px-1.5 py-0.5 text-muted-foreground">{x?.unidad_planta || INFO_SALIDA[s].unidad}</td>
                </tr>
              )
            })}
          </tbody></table>
        </div>
        <div className="d3c-card rounded-md border bg-card">
          <div className="flex items-center gap-2 border-b px-2.5 py-1"><h2 className="text-sm font-semibold">Fórmulas sin lugar entre las {ctx.puesto.max_recetas}</h2><span className="text-[12px] text-muted-foreground">{sinLugar.length}</span></div>
          <div className="px-2 py-1 text-[11px] text-muted-foreground">1–16 fijas (las más usadas) y 17–20 rotativas, cargadas a mano con la ficha.</div>
          <div className="max-h-[260px] overflow-auto">
            <table className="w-full border-collapse text-[12px]"><tbody>
              {sinLugar.map((f) => <tr key={f.id}><td className="border-b px-1.5 py-0.5">{f.code}</td><td className="border-b px-1.5 py-0.5 text-right tabular-nums text-muted-foreground">{f.usos || 0} despachos en 6 meses</td></tr>)}
            </tbody></table>
          </div>
        </div>
      </div>
    </div>
  )
}
