"use client"

/** Diálogos de la pantalla de Carga: camión abajo, extra agua, parada, cancelar, Tolva 1, orden de prueba, resolver y reporte. */
import { useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { CampoMotivo, motivoValido } from "@/components/motivo"
import { cn } from "@/lib/utils"
import { cantidadPorM3, type Comparacion } from "@/lib/carga/receta"
import { INFO_SALIDA, nf, type Salida } from "@/lib/carga/tipos"
import { NOMBRE_BANDERA, desvio, type Bandera } from "@/lib/carga/auditoria"
import { Btn, hhmm, hms, minTxt, mmss } from "./comun"
import { nombreCorto } from "./planta-vivo"

/** ¿El camión está abajo de la planta? Patente grande y botón mantenido 1 s (3.2.6). */
export function ConfirmarCamion({ patente, resumen, avisos, onBocina, onConfirmar, onCerrar }: {
  patente: string; resumen: React.ReactNode; avisos: string[]; onBocina: () => void; onConfirmar: () => void; onCerrar: () => void
}) {
  const [p, setP] = useState(0)
  const raf = useRef(0), t0 = useRef(0), hecho = useRef(false)
  const soltar = () => { cancelAnimationFrame(raf.current); if (!hecho.current) setP(0) }
  const paso = () => {
    const x = Math.min(1, (performance.now() - t0.current) / 1000)
    setP(x)
    if (x >= 1) { hecho.current = true; onConfirmar(); return }
    raf.current = requestAnimationFrame(paso)
  }
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  return (
    <Dialog open onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader><DialogTitle>¿El camión está abajo de la planta?</DialogTitle></DialogHeader>
        <div className="space-y-2 text-[13px]">
          <div className="rounded-lg border-2 border-foreground py-0.5 text-center text-[30px] font-extrabold tracking-[.08em]">{patente || "—"}</div>
          <div className="rounded-md bg-muted/50 px-2 py-1.5">{resumen}</div>
          {avisos.length > 0 && <div className="rounded-md bg-amber-50 px-2 py-1.5 text-[12px] text-amber-900">{avisos.join(" · ")}. Queda marcado en la auditoría.</div>}
          <Btn onClick={onBocina}>Tocar bocina</Btn>
          <button
            className="relative h-[42px] w-full select-none overflow-hidden rounded-[7px] bg-green-600 text-[14px] font-bold text-white"
            style={{ touchAction: "none" }}
            onPointerDown={(e) => { e.preventDefault(); t0.current = performance.now(); raf.current = requestAnimationFrame(paso) }}
            onPointerUp={soltar} onPointerLeave={soltar} onPointerCancel={soltar}
          >
            <i className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${p * 100}%` }} />
            <span className="relative">Sí, está abajo · mantené apretado</span>
          </button>
          <div className="text-[12px] text-muted-foreground">1 segundo apretado, así no arranca sin querer. Las seguridades de la planta siguen mandando.</div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ExtraAguaDialog({ camion, contexto, onAgregar, onCerrar }: { camion: string; contexto: React.ReactNode; onAgregar: (litros: number) => Promise<boolean>; onCerrar: () => void }) {
  const [l, setL] = useState("20")
  const [env, setEnv] = useState(false)
  const n = Number(l.replace(",", "."))
  const ok = n > 0 && n <= 300
  return (
    <Dialog open onOpenChange={(v) => !v && !env && onCerrar()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader><DialogTitle>Extra agua · {camion}</DialogTitle></DialogHeader>
        <div className="space-y-2 text-[13px]">
          <div className="rounded-md bg-muted/50 px-2 py-1.5">{contexto} Indumix lo agrega con su botón «Extra agua».</div>
          <div className="flex gap-1">{[10, 20, 30, 50].map((x) => <Btn key={x} onClick={() => setL(String(x))}>{x} L</Btn>)}</div>
          <label className="block text-[11.5px] font-semibold">Litros *
            <input className="mt-0.5 block h-[30px] w-full rounded-md border px-2 text-[13px]" inputMode="numeric" value={l} onChange={(e) => setL(e.target.value)} />
          </label>
          <div className="text-[12px] text-muted-foreground">Queda registrado con la hora y quién lo pidió. La auditoría suma el agua extra por camión, fórmula y plantista.</div>
        </div>
        <DialogFooter><Btn onClick={onCerrar} disabled={env}>Cancelar</Btn><Btn tono="pri" disabled={!ok || env} onClick={async () => { setEnv(true); const r = await onAgregar(n); setEnv(false); if (r) onCerrar() }}>Agregar agua</Btn></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Motivo obligatorio (parada, cancelar, autorizar, descartar). */
export function MotivoDialog({ titulo, cuerpo, boton, ejemplo, onConfirmar, onCerrar, peligro }: {
  titulo: string; cuerpo: React.ReactNode; boton: string; ejemplo?: string; onConfirmar: (motivo: string) => Promise<boolean | void>; onCerrar: () => void; peligro?: boolean
}) {
  const [m, setM] = useState("")
  const [env, setEnv] = useState(false)
  return (
    <Dialog open onOpenChange={(v) => !v && !env && onCerrar()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader><DialogTitle>{titulo}</DialogTitle></DialogHeader>
        <div className="space-y-2 text-[13px]">
          <div className="rounded-md bg-muted/50 px-2 py-1.5">{cuerpo}</div>
          <CampoMotivo value={m} onChange={setM} ejemplo={ejemplo} />
        </div>
        <DialogFooter>
          <Btn onClick={onCerrar} disabled={env}>Volver</Btn>
          <Btn tono={peligro ? "danger" : "pri"} disabled={!motivoValido(m) || env} onClick={async () => { setEnv(true); const r = await onConfirmar(m.trim()); setEnv(false); if (r !== false) onCerrar() }}>{boton}</Btn>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TolvaDialog({ opciones, actual, onElegir, onCerrar }: { opciones: { id: string; name: string }[]; actual: string | null; onElegir: (id: string) => void; onCerrar: () => void }) {
  return (
    <Dialog open onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader><DialogTitle>¿Qué hay en la Tolva 1?</DialogTitle></DialogHeader>
        <div className="space-y-1.5 text-[13px]">
          <div className="text-[12px] text-muted-foreground">En Indumix se llama «PIE 6/20 O 6/12». Queda en Actividad y vale para el control de receta y la auditoría.</div>
          {opciones.map((o) => (
            <button key={o.id} onClick={() => onElegir(o.id)} className={cn("w-full rounded-md border px-2.5 py-1.5 text-left", actual === o.id && "border-blue-500 ring-2 ring-blue-100")}>
              <div className="font-semibold">{o.name}</div>{actual === o.id && <div className="text-[11.5px] text-muted-foreground">es la que está ahora</div>}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function PruebaDialog({ formulas, mixers, onCrear, onCerrar }: {
  formulas: { id: string; code: string; numero: number | null }[]; mixers: { id: string; license_plate: string }[]
  onCrear: (d: { formula_id: string; m3: number; mixer_id: string | null }) => Promise<boolean>; onCerrar: () => void
}) {
  const conNum = formulas.filter((f) => f.numero != null).sort((a, b) => (a.numero || 0) - (b.numero || 0))
  const [f, setF] = useState(conNum.find((x) => x.code.startsWith("H30-612-15 B"))?.id || conNum[0]?.id || "")
  const [m3, setM3] = useState("3")
  const [mx, setMx] = useState("")
  const [env, setEnv] = useState(false)
  const n = Number(m3.replace(",", "."))
  return (
    <Dialog open onOpenChange={(v) => !v && !env && onCerrar()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader><DialogTitle>Orden de prueba (planta simulada)</DialogTitle></DialogHeader>
        <div className="space-y-2 text-[13px]">
          <div className="rounded-md bg-amber-50 px-2 py-1.5 text-[12px] text-amber-900">Una carga sin despacho, para probar la pantalla sin mandar un camión de verdad. Queda marcada «prueba» y «simulada».</div>
          <label className="block text-[11.5px] font-semibold">Fórmula (con su receta en la planta)
            <select className="mt-0.5 block h-[30px] w-full rounded-md border bg-card px-1.5 text-[13px]" value={f} onChange={(e) => setF(e.target.value)}>
              {conNum.map((x) => <option key={x.id} value={x.id}>{x.numero} · {x.code}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[11.5px] font-semibold">m³<input className="mt-0.5 block h-[30px] w-full rounded-md border px-2 text-[13px]" inputMode="decimal" value={m3} onChange={(e) => setM3(e.target.value)} /></label>
            <label className="block text-[11.5px] font-semibold">Camión (opcional)
              <select className="mt-0.5 block h-[30px] w-full rounded-md border bg-card px-1.5 text-[13px]" value={mx} onChange={(e) => setMx(e.target.value)}>
                <option value="">— sin camión —</option>{mixers.map((x) => <option key={x.id} value={x.id}>{x.license_plate}</option>)}
              </select>
            </label>
          </div>
        </div>
        <DialogFooter><Btn onClick={onCerrar} disabled={env}>Cancelar</Btn><Btn tono="pri" disabled={!f || !(n > 0 && n <= 12) || env} onClick={async () => { setEnv(true); const r = await onCrear({ formula_id: f, m3: n, mixer_id: mx || null }); setEnv(false); if (r) onCerrar() }}>Poner en la cola</Btn></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Comparación fórmula ↔ receta de la planta, por m³. El agua en ámbar (no frena). */
export function TablaComparacion({ cmp }: { cmp: Comparacion }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead><tr className="bg-muted/50 text-left text-[11px] text-muted-foreground">
          <th className="border-b px-1.5 py-0.5 font-semibold">Material</th><th className="border-b px-1.5 py-0.5 text-right font-semibold">Fórmula</th>
          <th className="border-b px-1.5 py-0.5 text-right font-semibold">Planta</th><th className="border-b px-1.5 py-0.5 text-right font-semibold">Dif.</th>
          <th className="border-b px-1.5 py-0.5 font-semibold">Tol.</th><th className="border-b px-1.5 py-0.5" />
        </tr></thead>
        <tbody>
          {cmp.filas.map((f) => (
            <tr key={f.material_id} className={cn(!f.ok && (f.agua ? "bg-amber-50" : "bg-red-50"))}>
              <td className="border-b px-1.5 py-0.5">{nombreCorto(f.nombre)}{f.agua && <span className="text-muted-foreground"> (base)</span>}</td>
              <td className="border-b px-1.5 py-0.5 text-right tabular-nums">{cantidadPorM3(f.grupo, f.formula)}</td>
              <td className="border-b px-1.5 py-0.5 text-right tabular-nums">{cantidadPorM3(f.grupo, f.receta)}</td>
              <td className={cn("border-b px-1.5 py-0.5 text-right tabular-nums", !f.ok && (f.agua ? "font-semibold text-amber-800" : "font-semibold text-red-700"))}>
                {f.dif > 0 ? "+" : ""}{cantidadPorM3(f.grupo, f.dif)}{f.pct != null && !f.ok ? ` (${f.dif > 0 ? "+" : ""}${nf(f.pct * 100, 1)} %)` : ""}
              </td>
              <td className="border-b px-1.5 py-0.5 text-muted-foreground">±{cantidadPorM3(f.grupo, f.tol)}</td>
              <td className="border-b px-1.5 py-0.5">{f.ok ? <span className="font-semibold text-green-700">✓</span> : f.agua ? <span className="font-semibold text-amber-800">agua</span> : <span className="font-semibold text-red-700">✕</span>}</td>
            </tr>
          ))}
          {cmp.sueltas.map((s) => <tr key={s} className="bg-red-50"><td colSpan={6} className="border-b px-1.5 py-0.5">La receta pesa en {INFO_SALIDA[s].nombre}, sin material asignado</td></tr>)}
        </tbody>
      </table>
    </div>
  )
}

export type FilaReporte = {
  salida: Salida; nombre: string | null; receta_por_m3: number | null; formula_por_m3: number | null; teorico: number | null; humedad_pct: number | null
  teorico_corregido: number | null; real: number | null; unidad: string | null
}

/** Reporte de una carga: material por material, tiempos, agua extra y banderas (5.6, 19.5, 19.6). */
export function ReporteDialog({ titulo, cabecera, filas, extras, tiempos, banderas, nota, onCerrar, pie }: {
  titulo: string; cabecera: React.ReactNode; filas: FilaReporte[]; extras: { litros: number; at: string; despues_de_terminar: boolean; usuario: string | null }[]
  tiempos: { despachado: string | null; inicio: string | null; fin: string | null; salida: string | null }; banderas: Bandera[]; nota?: string | null; onCerrar: () => void; pie?: React.ReactNode
}) {
  const ex = extras.reduce((s, e) => s + Number(e.litros || 0), 0)
  const agua = filas.find((f) => f.salida === "agua")?.real || 0
  const cem = filas.filter((f) => f.salida.startsWith("cemento")).reduce((s, f) => s + Number(f.real || 0), 0)
  const ini = tiempos.inicio ? new Date(tiempos.inicio).getTime() : null, fin = tiempos.fin ? new Date(tiempos.fin).getTime() : null, sal = tiempos.salida ? new Date(tiempos.salida).getTime() : null
  return (
    <Dialog open onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-[880px]">
        <DialogHeader><DialogTitle>{titulo}</DialogTitle></DialogHeader>
        <div className="space-y-2 text-[13px]">
          <div className="rounded-md bg-muted/50 px-2 py-1.5 text-[12.5px]">{cabecera}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 rounded-md border px-2.5 py-1 text-[12px]">
            <span><span className="text-muted-foreground">Despachado (remito) </span><b>{hhmm(tiempos.despachado)}</b></span>
            <span><span className="text-muted-foreground">Inicio de carga </span><b>{hms(tiempos.inicio)}</b></span>
            <span><span className="text-muted-foreground">Fin </span><b>{hms(tiempos.fin)}</b></span>
            <span><span className="text-muted-foreground">Tiempo de carga </span><b>{ini != null && fin != null ? mmss((fin - ini) / 1000) : "—"}</b></span>
            <span><span className="text-muted-foreground">Salió de planta (GPS) </span><b>{sal ? hhmm(sal) : "esperando GPS"}</b></span>
            <span><span className="text-muted-foreground">Espera hasta salir </span><b>{sal && fin ? minTxt((sal - fin) / 60000) : "—"}</b></span>
          </div>
          <div className="flex flex-wrap gap-1">{banderas.length ? banderas.map((b) => <span key={b} className={cn("d3c-tag rounded px-1 text-[10.5px] font-semibold", b === "simulada" ? "bg-amber-100 text-amber-900" : b === "aguaExtra" ? "bg-blue-50 text-blue-800" : "bg-red-50 text-red-700")}>{NOMBRE_BANDERA[b]}</span>) : <span className="d3c-tag rounded bg-emerald-50 px-1 text-[10.5px] font-semibold text-emerald-800">Sin problemas</span>}</div>
          {nota && <div className="rounded-md bg-amber-50 px-2 py-1.5 text-[12px] text-amber-900">{nota}</div>}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead><tr className="bg-muted/50 text-left text-[11px] text-muted-foreground">
                {["Material", "Fórmula /m³", "Receta /m³", "Teórico", "Humedad", "Teórico corregido", "Real", "Real − teórico"].map((h, i) => <th key={h} className={cn("border-b px-1.5 py-0.5 font-semibold", i > 0 && "text-right")}>{h}</th>)}
              </tr></thead>
              <tbody>
                {filas.map((f) => {
                  const g = INFO_SALIDA[f.salida].grupo
                  const d = f.teorico_corregido ? (Number(f.real || 0) - f.teorico_corregido) / f.teorico_corregido : 0
                  const bad = desvio({ grupo: g, teorico_corregido: f.teorico_corregido, real: f.real })
                  return (
                    <tr key={f.salida} className={cn(bad && "bg-red-50")}>
                      <td className="border-b px-1.5 py-0.5">{nombreCorto(f.nombre)} <span className="text-muted-foreground">{INFO_SALIDA[f.salida].nombre}</span></td>
                      <td className="border-b px-1.5 py-0.5 text-right tabular-nums">{f.formula_por_m3 == null ? "—" : nf(f.formula_por_m3, f.formula_por_m3 % 1 ? 1 : 0)}</td>
                      <td className="border-b px-1.5 py-0.5 text-right tabular-nums">{nf(f.receta_por_m3)}</td>
                      <td className="border-b px-1.5 py-0.5 text-right tabular-nums">{nf(f.teorico)}</td>
                      <td className="border-b px-1.5 py-0.5 text-right tabular-nums">{f.humedad_pct != null ? `${nf(f.humedad_pct)} %` : f.salida === "agua" && f.teorico != null && f.teorico_corregido != null ? `−${nf(f.teorico - f.teorico_corregido)}` : ""}</td>
                      <td className="border-b px-1.5 py-0.5 text-right tabular-nums">{nf(f.teorico_corregido)}</td>
                      <td className="border-b px-1.5 py-0.5 text-right font-semibold tabular-nums">{nf(f.real)} {f.unidad}</td>
                      <td className={cn("border-b px-1.5 py-0.5 text-right tabular-nums", bad && "font-semibold text-red-700")}>{d > 0 ? "+" : ""}{nf(d * 100, 1)} %</td>
                    </tr>
                  )
                })}
                <tr>
                  <td className="border-b px-1.5 py-0.5">Agua extra</td>
                  <td colSpan={5} className="border-b px-1.5 py-0.5 text-muted-foreground">{extras.map((e) => `${nf(e.litros)} L ${hhmm(e.at)}${e.despues_de_terminar ? " (después de terminar)" : ""} · ${e.usuario || "—"}`).join(" · ") || "no se agregó"}</td>
                  <td className="border-b px-1.5 py-0.5 text-right font-semibold tabular-nums">{nf(ex)} L</td>
                  <td className="border-b px-1.5 py-0.5 text-right text-[11px] text-muted-foreground">agua total {nf(agua + ex)} L · a/c {cem ? nf((agua + ex) / cem, 2) : "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="text-[11px] text-muted-foreground">Teórico corregido: árido húmedo = seco × (1 + H%) y agua descontada la de los áridos, como hace Indumix. Tolerancias de pesaje: cemento ±1 %, áridos ±2 %, agua ±3 %, aditivos ±3 %. Las horas son las del puente (la PC). Aditivo en g.</div>
          {pie}
        </div>
        <DialogFooter><Btn tono="pri" onClick={onCerrar}>Cerrar</Btn></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

