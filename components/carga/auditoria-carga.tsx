"use client"

/**
 * Auditoría de carga (carga-planta.md 11, como Loop §2.12, con 19.5 agua extra y 19.6 tiempos).
 * Despacho ↔ carga, banderas por categoría, tiempos (inicio, fin, tiempo de carga, salida por GPS, espera), agua extra
 * por camión, fórmula y plantista, y cemento real contra teórico por fórmula. Se exporta a Excel.
 *
 * En la etapa simulada todas las cargas son simuladas (se marcan). "Sin carga" (despachos sin carga) se muestra solo si
 * se pide: con la planta simulada, casi todos los despachos reales del día salen sin carga.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { usePermisos } from "@/lib/current-user"
import { NuevoBadge } from "@/components/nuevo-badge"
import { SinAcceso } from "@/components/seccion-protegida"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { cargarPuesto, type Puesto } from "@/lib/carga/datos"
import { NOMBRE_BANDERA, banderas, resumenAguaExtra, tiempos, type Bandera, type CargaAuditoria, type FilaAuditoria, type MaterialAuditoria } from "@/lib/carga/auditoria"
import { INFO_SALIDA, SALIDAS, nf, type Salida } from "@/lib/carga/tipos"
import { Btn, CartelSimulada, Tag, hhmm, m3t, minTxt, mmss } from "./comun"
import { ReporteDialog, type FilaReporte } from "./dialogos-carga"

type Planta = { id: string; name: string }
const CATS: Bandera[] = ["sinRemito", "sinCarga", "difVol", "desv", "receta", "aguaDist", "aguaExtra", "indumix", "parada"]
const diaHoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` }

export function AuditoriaCarga({ plants }: { plants: Planta[] }) {
  const { listo, usuario } = usePermisos()
  if (!listo) return null
  if (!usuario?.veFuncionesNuevas) return <SinAcceso texto="La auditoría de carga está en prueba: por ahora la ven solo los usuarios con las funciones nuevas." />
  return <Auditoria plants={plants} />
}

function Auditoria({ plants }: { plants: Planta[] }) {
  const { toast } = useToast()
  const { puede } = usePermisos()
  const [planta, setPlanta] = useState(() => plants.find((p) => p.name === "Canning")?.id || plants[0]?.id || "")
  const [dia, setDia] = useState(diaHoy)
  const [soloProblemas, setSoloProblemas] = useState(false)
  const [conSinCarga, setConSinCarga] = useState(false)
  const [cat, setCat] = useState<Bandera | null>(null)
  const [puesto, setPuesto] = useState<Puesto | null>(null)
  const [filas, setFilas] = useState<FilaAuditoria[]>([])
  const [sinCargaFilas, setSinCargaFilas] = useState<FilaAuditoria[]>([])
  const [cemento, setCemento] = useState<{ formula: string; real: number; teorico: number; n: number }[]>([])
  const [cargando, setCargando] = useState(true)
  const [sinMigracion, setSinMigracion] = useState(false)
  const [abierta, setAbierta] = useState<FilaAuditoria | null>(null)
  const [extraInfo, setExtraInfo] = useState<Record<string, { formula: string; plantista: string | null; remitoTipo: string | null }>>({})

  const leer = useCallback(async () => {
    if (!planta) return
    setCargando(true)
    const sb = createClient()
    const p = await cargarPuesto(sb, planta)
    setPuesto(p)
    if (!p) {
      const { error } = await sb.from("puestos_carga").select("id").limit(1)
      setSinMigracion(!!error); setFilas([]); setSinCargaFilas([]); setCargando(false); return
    }
    const ini = new Date(`${dia}T00:00:00`), fin = new Date(ini.getTime() + 86400_000)
    const [cg, ds, mats] = await Promise.all([
      sb.from("cargas").select("*, formulas(code), mixers(license_plate)").eq("puesto_id", p.id).not("estado", "in", "(cancelada)")
        .or(`and(created_at.gte."${ini.toISOString()}",created_at.lt."${fin.toISOString()}"),and(fin_at.gte."${ini.toISOString()}",fin_at.lt."${fin.toISOString()}")`),
      sb.from("dispatches").select("id, remito, remito_tipo, created_at, dispatch_date, quantity_m3, mixer_id, mixers(license_plate), clients(name), construction_sites(name), formulas(code)")
        .eq("plant_id", planta).eq("is_test_dispatch", false).gte("dispatch_date", ini.toISOString()).lt("dispatch_date", fin.toISOString()),
      sb.from("materials").select("id, name, tipo").eq("plant_id", planta),
    ])
    const cargas = (cg.data || []) as any[]
    const ids = cargas.map((c) => c.id)
    const dIds = [...new Set([...cargas.map((c) => c.dispatch_id).filter(Boolean), ...((ds.data || []) as any[]).map((d) => d.id)])]
    const [cm, ex, gps, dExtra] = await Promise.all([
      ids.length ? sb.from("cargas_materiales").select("*").in("carga_id", ids).eq("ciclo", 0) : Promise.resolve({ data: [] }),
      ids.length ? sb.from("cargas_agua_extra").select("*").in("carga_id", ids).order("at") : Promise.resolve({ data: [] }),
      dIds.length ? sb.from("viajes_gps").select("dispatch_id, salida_planta").in("dispatch_id", dIds) : Promise.resolve({ data: [] }),
      // Despachos de las cargas que no son del día (se despachó ayer y se cargó hoy, raro pero posible)
      (() => { const faltan = cargas.map((c) => c.dispatch_id).filter((x) => x && !((ds.data || []) as any[]).some((d) => d.id === x)); return faltan.length ? sb.from("dispatches").select("id, remito, remito_tipo, created_at, dispatch_date, quantity_m3, mixer_id, mixers(license_plate), clients(name), construction_sites(name), formulas(code)").in("id", faltan) : Promise.resolve({ data: [] }) })(),
    ])
    const matN = new Map(((mats.data || []) as any[]).map((m) => [m.id, m.name]))
    const despachos = new Map([...((ds.data || []) as any[]), ...((dExtra.data || []) as any[])].map((d) => [d.id, d]))
    const salida = new Map(((gps.data || []) as any[]).map((g) => [g.dispatch_id, g.salida_planta]))
    const materialesDe = (id: string): MaterialAuditoria[] => ((cm.data || []) as any[]).filter((m) => m.carga_id === id)
      .sort((a, b) => SALIDAS.indexOf(a.salida) - SALIDAS.indexOf(b.salida))
      .map((m) => ({
        salida: m.salida as Salida, material_id: m.material_id, nombre: matN.get(m.material_id) || "—", grupo: INFO_SALIDA[m.salida as Salida].grupo, unidad: m.unidad || "",
        receta_por_m3: num(m.receta_por_m3), formula_por_m3: num(m.formula_por_m3), teorico: num(m.teorico), humedad_pct: num(m.humedad_pct), teorico_corregido: num(m.teorico_corregido), real: num(m.real),
      }))
    const aCarga = (c: any): CargaAuditoria => ({
      id: c.id, origen: c.origen, simulada: c.simulada, estado: c.estado, contador: c.contador_planta, inicio_at: c.inicio_at, fin_at: c.fin_at || c.parada_at, m3: num(c.m3), m3_cargados: num(c.m3_cargados),
      ciclos: c.ciclos, receta_numero: c.receta_numero, receta_ok: !((c.bloqueo?.items || []) as any[]).some((i) => i.clave === "receta" && (!i.ok || i.aviso)) && !!c.bloqueo, agua_distinta: !!c.agua_distinta,
      autorizada: !!c.autorizacion, parada: c.resolucion?.modo && c.resolucion.modo !== "cancelada" ? c.resolucion.modo : c.estado === "parada" ? "sin resolver" : null,
      completa_carga_id: c.completa_carga_id, materiales: materialesDe(c.id), plantista: c.arrancada_por, patente_planta: c.patente_planta, observacion_planta: c.observacion_planta, revisada: c.estado_auditoria === "revisada",
    })
    const aDesp = (d: any) => ({
      id: d.id, remito: d.remito, remito_tipo: d.remito_tipo, patente: d.mixers?.license_plate || null, despachado_at: d.created_at, salio_at: d.dispatch_date,
      cliente: d.clients?.name || "", obra: d.construction_sites?.name || "", formula: d.formulas?.code || "", m3: Number(d.quantity_m3) || 0,
    })
    const extras = (cargaIds: string[]) => ((ex.data || []) as any[]).filter((x) => cargaIds.includes(x.carga_id)).map((x) => ({ litros: Number(x.litros), at: x.at, despues_de_terminar: x.despues_de_terminar, usuario: x.usuario }))
    // Una fila por despacho (con sus cargas: la principal y la que la completa) y una por carga sin despacho
    const out: FilaAuditoria[] = []
    const info: Record<string, { formula: string; plantista: string | null; remitoTipo: string | null }> = {}
    const porDesp = new Map<string, any[]>()
    for (const c of cargas) {
      if (c.dispatch_id) { if (!porDesp.has(c.dispatch_id)) porDesp.set(c.dispatch_id, []); porDesp.get(c.dispatch_id)!.push(c) }
      else {
        out.push({ despacho: null, cargas: [aCarga(c)], extras: extras([c.id]), salida_gps: null, union: null })
        info[c.id] = { formula: c.formulas?.code || "—", plantista: c.arrancada_por, remitoTipo: null }
      }
    }
    for (const [did, cs] of porDesp) {
      const d = despachos.get(did)
      const ordenadas = [...cs].sort((a, b) => (a.completa_carga_id ? 1 : 0) - (b.completa_carga_id ? 1 : 0))
      out.push({ despacho: d ? aDesp(d) : null, cargas: ordenadas.map(aCarga), extras: extras(cs.map((c) => c.id)), salida_gps: salida.get(did) || null, union: (cs[0].union_remito as any) || "por id" })
      info[cs[0].id] = { formula: d?.formulas?.code || cs[0].formulas?.code || "—", plantista: cs[0].arrancada_por, remitoTipo: d?.remito_tipo || null }
    }
    const conCarga = new Set(porDesp.keys())
    const sc = ((ds.data || []) as any[]).filter((d) => !conCarga.has(d.id)).map((d) => ({ despacho: aDesp(d), cargas: [], extras: [], salida_gps: salida.get(d.id) || null, union: null } as FilaAuditoria))
    const t = (f: FilaAuditoria) => new Date(f.cargas[0]?.inicio_at || f.despacho?.despachado_at || 0).getTime()
    out.sort((a, b) => t(b) - t(a))
    // Cemento real contra teórico (fórmula × m³) por fórmula: el panel que se ocultó en la fase 0 vuelve con datos reales
    const cem = new Map<string, { real: number; teorico: number; n: number }>()
    for (const f of out) for (const c of f.cargas) {
      const ms = c.materiales.filter((m) => m.grupo === "cemento")
      if (!ms.length) continue
      const fo = f.despacho?.formula || info[c.id]?.formula || "—"
      const x = cem.get(fo) || { real: 0, teorico: 0, n: 0 }
      x.real += ms.reduce((s, m) => s + Number(m.real || 0), 0)
      x.teorico += ms.reduce((s, m) => s + Number(m.formula_por_m3 || 0), 0) * Number(c.m3_cargados ?? c.m3 ?? 0)
      x.n++
      cem.set(fo, x)
    }
    setCemento([...cem.entries()].map(([formula, x]) => ({ formula, ...x })).sort((a, b) => Math.abs(b.real - b.teorico) - Math.abs(a.real - a.teorico)))
    setExtraInfo(info)
    setFilas(out)
    setSinCargaFilas(out.length ? sc : []) // "sin carga" solo cuenta los días con el puente conectado (hubo cargas)
    setSinMigracion(false)
    setCargando(false)
  }, [planta, dia])
  useEffect(() => { leer() }, [leer])

  const ahora = Date.now()
  const todas = useMemo(() => (conSinCarga ? [...filas, ...sinCargaFilas] : filas).map((f) => ({ f, b: banderas(f, ahora, puesto?.tolerancias.pesaje) })), [filas, sinCargaFilas, conSinCarga, puesto]) // eslint-disable-line react-hooks/exhaustive-deps
  const vis = todas.filter((x) => (!cat || x.b.includes(cat)) && (!soloProblemas || x.b.some((b) => b !== "aguaExtra" && b !== "simulada")))
  const cnt = (b: Bandera) => todas.filter((x) => x.b.includes(b)).length
  const agua = useMemo(() => resumenAguaExtra(filas), [filas])
  const conT = filas.map((f) => tiempos(f)).filter((t) => t.cargaMin != null)
  const promCarga = conT.length ? conT.reduce((s, t) => s + (t.cargaMin || 0), 0) / conT.length : null
  const conC = filas.map((f) => tiempos(f).colaMin).filter((x): x is number => x != null)
  const promCola = conC.length ? conC.reduce((s, x) => s + x, 0) / conC.length : null
  const conE = filas.map((f) => tiempos(f).esperaSalidaMin).filter((x): x is number => x != null)
  const promEspera = conE.length ? conE.reduce((s, x) => s + x, 0) / conE.length : null
  const nCargas = filas.reduce((s, f) => s + f.cargas.length, 0)

  async function exportar() {
    const XLSX = await import("xlsx")
    const filasX = vis.map(({ f, b }) => {
      const c = f.cargas[0], t = tiempos(f)
      return {
        Remito: f.despacho ? `${f.despacho.remito_tipo || ""} ${f.despacho.remito || ""}`.trim() : "sin remito", Camión: f.despacho?.patente || c?.patente_planta || "",
        Despacho: f.despacho ? hhmm(f.despacho.despachado_at) : "", Fórmula: f.despacho?.formula || (c ? extraInfo[c.id]?.formula : "") || "", "m³ remito": f.despacho?.m3 ?? "",
        "Carga N°": c?.contador ?? "", "Espera en cola (min)": t.colaMin != null ? Math.round(t.colaMin) : "", Inicio: hhmm(c?.inicio_at), Fin: hhmm(c?.fin_at), "Tiempo de carga (min)": t.cargaMin != null ? Math.round(t.cargaMin * 10) / 10 : "",
        "Salió (GPS)": f.salida_gps ? hhmm(f.salida_gps) : "", "Espera hasta salir (min)": t.esperaSalidaMin != null ? Math.round(t.esperaSalidaMin) : "",
        "m³ carga": f.cargas.reduce((s, x) => s + Number(x.m3_cargados ?? x.m3 ?? 0), 0) || "", Receta: c?.receta_numero ?? "", "Agua extra (L)": f.extras.reduce((s, e) => s + e.litros, 0) || "",
        Plantista: c?.plantista || "", Unión: f.union || "", Simulada: c?.simulada ? "sí" : "", Problemas: b.map((x) => NOMBRE_BANDERA[x]).join(", "),
      }
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasX), "Auditoría de carga")
    XLSX.writeFile(wb, `auditoria-carga-${dia}.xlsx`)
  }

  async function revisar(id: string) {
    const r = await fetch(`/api/carga/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "revisar", pedido: crypto.randomUUID?.() || String(Date.now()) }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { toast({ title: "No se pudo", description: j?.error }); return }
    toast({ title: "Marcada revisada" })
    setAbierta(null)
    leer()
  }

  return (
    <div className="d3c space-y-2 text-[13px]">
      <div className="sticky top-0 z-30 -mx-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b bg-background/95 px-3 py-1 backdrop-blur">
        <h1 className="text-base font-semibold">Auditoría de carga</h1>
        <NuevoBadge />
        <div className="inline-flex rounded-md border p-0.5">
          {plants.map((p) => <button key={p.id} onClick={() => setPlanta(p.id)} className={cn("h-7 rounded px-2.5 text-[13px]", planta === p.id ? "bg-muted font-semibold" : "text-muted-foreground")}>{p.name}</button>)}
        </div>
        <input type="date" className="h-7 rounded-md border bg-card px-1.5 text-[12.5px]" value={dia} onChange={(e) => setDia(e.target.value || diaHoy())} />
        <label className="inline-flex items-center gap-1 text-[12px]"><input type="checkbox" checked={soloProblemas} onChange={(e) => setSoloProblemas(e.target.checked)} />Solo con problemas</label>
        <label className="inline-flex items-center gap-1 text-[12px]" title="Despachos del día sin carga unida"><input type="checkbox" checked={conSinCarga} onChange={(e) => setConSinCarga(e.target.checked)} />Incluir despachos sin carga</label>
        <span className="flex-1" />
        <Link href="/carga" className="text-[12.5px] text-blue-800 underline">Carga de planta</Link>
        <Btn className="h-7 text-[12px]" onClick={exportar} disabled={!vis.length}>Exportar a Excel</Btn>
      </div>
      {puesto?.sistema === "simulador" && <CartelSimulada />}
      {sinMigracion && <div className="rounded-md border border-l-[3px] border-l-red-600 bg-red-50 px-2.5 py-1 text-[12px] font-semibold text-red-700">Falta aplicar en la base la migración de la carga de planta. Avisale a Bautista.</div>}
      {!sinMigracion && !cargando && !puesto && <div className="rounded-md border px-2.5 py-1 text-[12px]">Esa planta no tiene un puesto de carga.</div>}
      {cargando ? <div className="py-10 text-center text-muted-foreground">Cargando…</div> : puesto && (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 rounded-md border px-2.5 py-1 text-[12px]">
            <span><span className="text-muted-foreground">Remitos </span><b>{filas.filter((f) => f.despacho).length}{conSinCarga ? ` (+${sinCargaFilas.length} sin carga)` : ""}</b></span>
            <span><span className="text-muted-foreground">Cargas </span><b>{nCargas}</b></span>
            <span><span className="text-muted-foreground">m³ remitos </span><b>{m3t(filas.reduce((s, f) => s + (f.despacho?.m3 || 0), 0))}</b></span>
            <span><span className="text-muted-foreground">m³ cargas </span><b>{m3t(filas.reduce((s, f) => s + f.cargas.reduce((a, c) => a + Number(c.m3_cargados ?? c.m3 ?? 0), 0), 0))}</b></span>
            <span><span className="text-muted-foreground">Espera en cola prom. </span><b>{promCola != null ? minTxt(promCola) : "—"}</b></span>
            <span><span className="text-muted-foreground">Tiempo de carga prom. </span><b>{promCarga != null ? mmss(promCarga * 60) : "—"}</b></span>
            <span><span className="text-muted-foreground">Espera hasta salir prom. </span><b>{promEspera != null ? `${nf(promEspera, 1)} min` : "—"}</b></span>
            <span><span className="text-muted-foreground">Con problemas </span><b className="text-red-700">{todas.filter((x) => x.b.some((b) => b !== "aguaExtra" && b !== "simulada")).length}</b></span>
          </div>
          <div className="flex flex-wrap gap-1">
            <button onClick={() => setCat(null)} className={cn("h-7 rounded-md border px-2 text-[12px]", !cat && "border-slate-900 bg-slate-900 text-white")}><b>{todas.length}</b> Todas</button>
            {CATS.map((k) => <button key={k} onClick={() => setCat(cat === k ? null : k)} className={cn("h-7 rounded-md border px-2 text-[12px]", cat === k && "border-slate-900 bg-slate-900 text-white")}><b className={cn(cnt(k) && cat !== k && "text-red-700")}>{cnt(k)}</b> {NOMBRE_BANDERA[k]}</button>)}
          </div>
          {cemento.length > 0 && (
            <div className="rounded-md border border-l-[3px] border-orange-200 border-l-orange-500 px-2.5 py-1 text-[12px] text-orange-950">
              <b>Cemento real contra teórico</b> (fórmula × m³ cargados): {cemento.map((c) => `${c.formula}: ${nf(c.real)} kg contra ${nf(c.teorico)} kg (${c.real - c.teorico >= 0 ? "+" : ""}${nf(c.real - c.teorico)} kg, ${c.n} carga${c.n > 1 ? "s" : ""})`).join(" · ")}.
            </div>
          )}
          <div className="rounded-md border border-l-[3px] border-blue-200 border-l-blue-600 px-2.5 py-1 text-[12px] text-blue-950">
            <b>Agua extra: {nf(agua.total)} L en {agua.camiones} camión{agua.camiones === 1 ? "" : "es"}</b>{agua.despues ? ` (${nf(agua.despues)} L después de terminar la carga)` : ""}. Por fórmula: {agua.porFormula.map(([k, v]) => `${k} ${nf(v)} L`).join(" · ") || "—"} · por camión: {agua.porCamion.map(([k, v]) => `${k} ${nf(v)} L`).join(" · ") || "—"} · por plantista: {agua.porPlantista.map(([k, v]) => `${k} ${nf(v)} L`).join(" · ") || "—"}.
          </div>
          <div className="d3c-card overflow-hidden rounded-md border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] border-collapse text-[12px]">
                <thead><tr className="bg-muted/50 text-left text-[11px] text-muted-foreground">
                  {["Remito", "Camión", "Despacho", "Fórmula", "m³"].map((h) => <th key={h} className={cn("border-b px-1.5 py-0.5 font-semibold", h === "m³" && "text-right")}>{h}</th>)}
                  {["Carga", "En cola", "Inicio", "Fin", "Carga", "Salió (GPS)", "Espera salir", "m³", "Receta", "Agua extra", "Problemas"].map((h, i) => <th key={h + i} className={cn("border-b px-1.5 py-0.5 font-semibold", i === 0 && "border-l-2", [1, 4, 6, 7, 9].includes(i) && "text-right")}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {vis.map(({ f, b }, i) => {
                    const c = f.cargas[0]
                    const t = tiempos(f)
                    const ex = f.extras.reduce((s, e) => s + e.litros, 0)
                    return (
                      <tr key={i} className={cn(c && "cursor-pointer hover:bg-muted/40")} onClick={() => c && setAbierta(f)}>
                        <td className="border-b px-1.5 py-0.5">{f.despacho ? <><Tag tono={f.despacho.remito_tipo === "X" ? "X" : "R"}>{f.despacho.remito_tipo || "R"}</Tag> {f.despacho.remito}</> : c?.origen === "prueba" ? <Tag tono="slate">PRUEBA</Tag> : <span className="font-semibold text-red-700">sin remito</span>}</td>
                        <td className="border-b px-1.5 py-0.5">{f.despacho?.patente || c?.patente_planta || "—"}</td>
                        <td className="border-b px-1.5 py-0.5 tabular-nums">{f.despacho ? hhmm(f.despacho.despachado_at) : "—"}</td>
                        <td className="border-b px-1.5 py-0.5">{f.despacho?.formula || (c ? extraInfo[c.id]?.formula : "") || "—"}</td>
                        <td className="border-b px-1.5 py-0.5 text-right tabular-nums">{f.despacho ? m3t(f.despacho.m3) : "—"}</td>
                        <td className="border-b border-l-2 px-1.5 py-0.5">{c ? (c.contador ? `N° ${c.contador}` : c.estado) : <span className="font-semibold text-red-700">sin carga</span>}{f.cargas.length > 1 ? ` +${f.cargas.length - 1}` : ""}</td>
                        <td className="border-b px-1.5 py-0.5 text-right tabular-nums">{t.colaMin != null ? minTxt(t.colaMin) : ""}</td>
                        <td className="border-b px-1.5 py-0.5 tabular-nums">{hhmm(c?.inicio_at)}</td>
                        <td className="border-b px-1.5 py-0.5 tabular-nums">{hhmm(c?.fin_at)}</td>
                        <td className="border-b px-1.5 py-0.5 text-right tabular-nums">{t.cargaMin != null ? mmss(t.cargaMin * 60) : "—"}</td>
                        <td className="border-b px-1.5 py-0.5 tabular-nums">{f.salida_gps ? hhmm(f.salida_gps) : c ? <span className="text-muted-foreground">—</span> : ""}</td>
                        <td className="border-b px-1.5 py-0.5 text-right tabular-nums">{t.esperaSalidaMin != null ? minTxt(t.esperaSalidaMin) : ""}</td>
                        <td className="border-b px-1.5 py-0.5 text-right tabular-nums">{c ? m3t(f.cargas.reduce((s, x) => s + Number(x.m3_cargados ?? x.m3 ?? 0), 0)) : "—"}</td>
                        <td className="border-b px-1.5 py-0.5">{c?.receta_numero ?? "—"}</td>
                        <td className="border-b px-1.5 py-0.5 text-right tabular-nums">{ex ? `${nf(ex)} L` : ""}</td>
                        <td className="whitespace-normal border-b px-1.5 py-0.5">{b.length ? b.map((x) => <span key={x} className={cn("d3c-tag mr-0.5 inline-block rounded px-1 text-[10.5px] font-semibold", x === "simulada" ? "bg-amber-100 text-amber-900" : x === "aguaExtra" ? "bg-blue-50 text-blue-800" : x === "indumix" ? "bg-sky-50 text-sky-900" : x === "parada" ? "bg-slate-800 text-white" : "bg-red-50 text-red-700")}>{NOMBRE_BANDERA[x]}</span>) : <Tag tono="ok">OK</Tag>}{c?.revisada ? <Tag tono="ok" className="ml-0.5">revisada</Tag> : null}</td>
                      </tr>
                    )
                  })}
                  {!vis.length && <tr><td colSpan={16} className="py-8 text-center text-muted-foreground">No hay cargas{cat ? " con esa categoría" : ""} ese día.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="px-2 py-1 text-[11px] text-muted-foreground">Secuencia A: despacho → cola → carga → salida. «Despacho» es la hora fija del remito (cuando se grabó); «En cola», del despacho al inicio de la carga; «Inicio» y «Fin», las de la carga (hora del puente); «Salió», la salida de la geocerca de la planta por GPS (viajes_gps). Unión: por id (la carga salió del sistema), por remito en «Observación» o por camión y hora. «Sin carga» cuenta solo los días con cargas.</div>
          </div>
        </>
      )}
      {abierta && abierta.cargas[0] && (() => {
        const c = abierta.cargas[0]
        const filasR: FilaReporte[] = abierta.cargas.length === 1 ? c.materiales.map((m) => ({ ...m })) : sumarMateriales(abierta.cargas)
        return (
          <ReporteDialog
            titulo={`Reporte de carga${c.contador ? ` N° ${c.contador}` : ""}${abierta.despacho ? ` · Remito ${abierta.despacho.remito_tipo || ""} ${abierta.despacho.remito}` : ""}`}
            cabecera={<>{abierta.despacho ? `${abierta.despacho.cliente} · ${abierta.despacho.obra}` : "—"} · <b>{abierta.despacho?.patente || c.patente_planta}</b>{c.patente_planta ? ` (Indumix «${c.patente_planta}»)` : ""} · {abierta.despacho?.formula || extraInfo[c.id]?.formula} · receta {c.receta_numero ?? "—"} · <b>{m3t(abierta.cargas.reduce((s, x) => s + Number(x.m3_cargados ?? x.m3 ?? 0), 0))} m³</b>{abierta.cargas.length > 1 ? ` en ${abierta.cargas.length} cargas` : ""} · {c.origen === "sistema" ? "desde el sistema" : c.origen === "prueba" ? "orden de prueba" : "leída del reporte de Indumix"} · plantista {c.plantista || "—"}{abierta.union ? ` · unión ${abierta.union}` : ""}{c.simulada ? " · PLANTA SIMULADA" : ""}</>}
            filas={filasR} extras={abierta.extras}
            tiempos={{ despachado: abierta.despacho?.despachado_at || null, inicio: c.inicio_at, fin: abierta.cargas[abierta.cargas.length - 1].fin_at, salida: abierta.salida_gps }}
            banderas={banderas(abierta, ahora, puesto?.tolerancias.pesaje)} onCerrar={() => setAbierta(null)}
            pie={puede("carga", "editar") && !c.revisada ? <Btn onClick={() => revisar(c.id)}>Marcar revisada</Btn> : c.revisada ? <div className="text-[12px] text-emerald-800">Revisada.</div> : null}
          />
        )
      })()}
    </div>
  )
}

const num = (x: unknown) => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x))

/** Dos cargas del mismo remito (completar): se suman por salida. */
function sumarMateriales(cs: CargaAuditoria[]): FilaReporte[] {
  const m = new Map<Salida, FilaReporte>()
  for (const c of cs) for (const x of c.materiales) {
    const p = m.get(x.salida)
    if (!p) m.set(x.salida, { ...x })
    else for (const k of ["teorico", "teorico_corregido", "real"] as const) p[k] = Number(p[k] || 0) + Number(x[k] || 0)
  }
  return SALIDAS.filter((s) => m.has(s)).map((s) => m.get(s)!)
}
