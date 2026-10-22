"use client"

/**
 * La planta en vivo (como la pantalla INICIO de Indumix y la maqueta): tolvas, roscas, aditivos y agua con nivel, H%,
 * Real y Objetivo; las balanzas; la cinta al camión y el trompo llenándose. Más la tabla de pesajes del ciclo.
 */
import { cn } from "@/lib/utils"
import { ARIDOS, INFO_SALIDA, SALIDAS, nf, type EstadoPlanta, type Salida, type SalidaMapa } from "@/lib/carga/tipos"
import { m3t, mmss } from "./comun"

export const nombreCorto = (n: string | null | undefined) => String(n || "—").replace("Piedra Partida", "Piedra").replace("Arena Trituración", "Arena").replace(" (obra)", "")
const colorDe = (n: string | null | undefined) => {
  const t = String(n || "").toLowerCase()
  if (t.includes("fina")) return "#e9c46a"
  if (t.includes("0/6")) return "#d6a77a"
  if (t.includes("6/12")) return "#a3a9b3"
  if (t.includes("6/20")) return "#7f8792"
  if (t.includes("10/30")) return "#6b7280"
  if (t.includes("cpc") || t.includes("cemento")) return "#cbd5e1"
  if (t.includes("espum")) return "#f0abfc"
  if (t.includes("sika") || t.includes("aditivo")) return "#a78bfa"
  if (t.includes("agua")) return "#93c5fd"
  return "#e5e7eb"
}

export function PlantaVivo({
  estado, salidas, materiales, conectado, patente, m3Total, previa, grande = true, onCambiarTolva, humedadAcopio,
}: {
  estado: EstadoPlanta | null
  salidas: SalidaMapa[]
  materiales: { id: string; name: string }[]
  conectado: boolean
  patente: string | null
  m3Total: number | null
  /** objetivo por ciclo de la orden elegida, antes de arrancar */
  previa?: Partial<Record<Salida, number>> | null
  grande?: boolean
  onCambiarTolva?: (() => void) | null
  /** humedad del acopio de la Arena Fina (para avisar si difiere de la de Indumix más de 1,5 puntos) */
  humedadAcopio?: number | null
}) {
  const mat = (s: Salida) => {
    const id = salidas.find((x) => x.salida === s)?.material_id
    return id ? materiales.find((m) => m.id === id)?.name || "?" : null
  }
  const enCurso = !!estado?.en_ciclo
  const vw = grande ? 78 : 54, th = grande ? 60 : 34
  const fila = (s: Salida) => {
    const info = INFO_SALIDA[s]
    const e = estado?.salidas.find((x) => x.salida === s)
    const usada = enCurso ? (e?.total || 0) > 0 : previa ? previa[s] != null : false
    const real = enCurso ? e?.real || 0 : 0
    const obj = enCurso ? e?.objetivo || 0 : previa?.[s] || 0
    const lvl = e?.nivel_pct ?? 0
    const m = mat(s)
    const h = info.grupo === "arido" ? e?.humedad_pct ?? 0 : null
    const humW = s === "arido_3" && h != null && humedadAcopio != null && Math.abs(h - humedadAcopio) > 1.5
    const forma = info.grupo === "cemento" ? "rounded-t-[16px]" : info.grupo === "agua" ? "rounded-[9px] border-b-[1.5px]" : "rounded-t"
    return (
      <div key={s} style={{ width: vw }} className={cn("rounded-[5px] border border-transparent p-0.5", e?.pesando && "border-blue-500 bg-blue-50", !usada && "opacity-40")} title={`${info.nombre} · Indumix «${salidas.find((x) => x.salida === s)?.nombre_planta || ""}»`}>
        <div className="flex justify-between gap-0.5 text-[10.5px] font-medium">
          <span>{grande ? info.nombre : info.corto}</span>
          {h != null && <span className={cn("text-[9.5px]", humW ? "font-medium text-amber-800" : "text-cyan-800")} title={humW ? `Indumix ${h} % · acopio ${humedadAcopio} %` : "H% que usa Indumix"}>H{nf(h)}</span>}
        </div>
        <div className="min-h-[23px] text-[10.5px] leading-tight">{nombreCorto(m)}</div>
        {s === "arido_1" && onCambiarTolva && <button className="mt-px h-[17px] rounded border bg-card px-1 text-[10px]" onClick={onCambiarTolva}>Cambiar</button>}
        <div className={cn("relative mt-0.5 overflow-hidden border-[1.5px] border-b-0 border-slate-400 bg-white", forma)} style={{ height: info.grupo === "cemento" ? th + 12 : th }}>
          <div className="absolute inset-x-0 bottom-0" style={{ height: `${lvl}%`, background: colorDe(m) }} />
          <span className="absolute right-0.5 top-px text-[9px] text-slate-700">{nf(lvl)}%</span>
        </div>
        {info.grupo === "arido" && <div className={cn("h-[9px]", e?.pesando ? "bg-blue-500" : "bg-slate-300")} style={{ clipPath: "polygon(0 0,100% 0,64% 100%,36% 100%)" }} />}
        <div className="mt-px flex justify-between text-[10px] leading-tight text-slate-500"><span>R</span><b className="font-medium text-xs font-medium tabular-nums text-foreground">{usada ? nf(real) : 0}</b></div>
        <div className="flex justify-between text-[10px] leading-tight text-slate-500"><span>O</span><span className="tabular-nums">{usada ? nf(obj, grande ? 1 : 0) : 0}</span></div>
      </div>
    )
  }
  const bal = (id: "aridos" | "cemento" | "aditivo", tit: string) => {
    const b = estado?.balanzas.find((x) => x.id === id)
    const est = b?.estado || "vacia"
    const pct = b && b.max ? Math.min(100, (b.valor / b.max) * 100) : 0
    return (
      <div key={id} className={cn("min-w-[92px] flex-1 rounded-[5px] border px-1.5 py-0.5 text-[10.5px]", est === "pesando" && "border-blue-500", est === "descargando" && "border-green-600")}>
        <div className="flex justify-between gap-1 text-slate-500"><span>{tit}</span>
          <span className={cn("rounded-sm px-1 text-[9.5px] tracking-wide", est === "vacia" ? "bg-emerald-50 text-emerald-800" : est === "pesando" ? "bg-blue-50 text-blue-800" : est === "llena" ? "bg-amber-50 text-amber-800" : "bg-green-50 text-green-800")}>{est === "vacia" ? "VACÍA" : est.toUpperCase()}</span>
        </div>
        <div className="text-sm font-medium tabular-nums">{nf(b?.valor ?? 0)} <span className="text-[11px] font-normal text-slate-500">{b?.unidad || (id === "aditivo" ? "g" : "kg")}</span></div>
        <div className="h-[3px] overflow-hidden rounded-full bg-slate-200"><i className={cn("block h-full", est === "descargando" ? "bg-green-600" : "bg-blue-500")} style={{ width: `${pct}%` }} /></div>
      </div>
    )
  }
  const agua = estado?.agua
  const aguaObj = enCurso ? agua?.objetivo || 0 : previa?.agua || 0
  const trompo = estado ? (estado.en_ciclo || estado.parada ? estado.m3_en_trompo : 0) : 0
  const frac = m3Total ? Math.min(1, trompo / m3Total) : 0
  const cinta = !!estado?.cinta_en_marcha
  return (
    <div className="relative rounded-md border p-1.5">
      <div className="flex flex-wrap items-end gap-1.5">
        {([["Áridos", ARIDOS], ["Cemento", ["cemento_1", "cemento_2"]], ["Aditivo", ["aditivo_1", "aditivo_2"]], ["Agua", ["agua"]]] as [string, Salida[]][]).map(([t, ss]) => (
          <div key={t} className="rounded-md border border-dashed px-1 py-0.5">
            <div className="mx-px mb-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">{t}</div>
            <div className="flex items-end gap-1">{ss.map(fila)}</div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {bal("aridos", "Bal. áridos")}{bal("cemento", "Bal. cemento")}{bal("aditivo", "Bal. aditivo")}
        <div className={cn("min-w-[92px] flex-1 rounded-[5px] border px-1.5 py-0.5 text-[10.5px]", enCurso && estado?.salidas.find((x) => x.salida === "agua")?.pesando && "border-blue-500")}>
          <div className="flex justify-between gap-1 text-slate-500"><span>Agua</span><span>obj {nf(aguaObj)} L</span></div>
          <div className="text-sm font-medium tabular-nums">{nf(enCurso ? agua?.real ?? 0 : 0)} <span className="text-[11px] font-normal text-slate-500">L</span>{agua?.extra ? <span className="ml-1 text-[10.5px] font-medium text-blue-800">+{nf(agua.extra)} extra</span> : null}</div>
          <div className="h-[3px] overflow-hidden rounded-full bg-slate-200"><i className="block h-full bg-blue-500" style={{ width: `${aguaObj ? Math.min(100, ((agua?.real || 0) / aguaObj) * 100) : 0}%` }} /></div>
        </div>
      </div>
      <div className="mt-1 flex items-end gap-1.5">
        <div className="min-w-[60px] flex-1 text-[10.5px] text-slate-500">
          Cinta al camión{cinta ? " · en marcha" : ""}
          <div className={cn("k3c-cinta mt-0.5 h-[10px] rounded-[5px] border-[1.5px] border-slate-400", cinta && "k3c-cinta-run")} />
          <div className="mt-[3px]">{estado?.en_ciclo || estado?.parada ? <>Trompo <b className="font-medium text-foreground">{nf(trompo, 2)}</b> de {m3t(m3Total)} m³</> : m3Total ? `Esperando · ${m3t(m3Total)} m³ a cargar` : ""}</div>
        </div>
        <div className={cn("relative shrink-0 text-center", estado?.bocina && "k3c-bocina")} style={{ width: grande ? 170 : 110 }}>
          <Camion frac={frac} gira={!!estado?.en_ciclo && !estado?.suspendida} />
          <div className="text-xs font-medium tracking-wider">{patente || ""}</div>
        </div>
      </div>
      {!conectado && (
        <div className="absolute inset-0 z-[5] flex items-center justify-center rounded-md bg-slate-900/85 p-2.5 text-center text-xs font-medium text-white">
          <div>Sin conexión con la planta: no se ven los pesos<small className="mt-1 block text-xs font-normal text-slate-300">La planta sigue con lo que hace Indumix. Al volver se muestra el estado real; no arranca nada solo.</small></div>
        </div>
      )}
    </div>
  )
}

function Camion({ frac, gira }: { frac: number; gira: boolean }) {
  const f = Math.max(0, Math.min(1, frac))
  return (
    <svg viewBox="0 0 230 112" className="block h-auto w-full" aria-hidden>
      <defs><clipPath id="k3c-trompo"><ellipse cx="96" cy="50" rx="70" ry="30" /></clipPath></defs>
      <rect x="18" y="82" width="190" height="9" rx="3" fill="#64748b" />
      <path d="M168 38 h34 l16 24 v24 h-50z" fill="#3b82f6" />
      <rect x="176" y="44" width="22" height="15" rx="2" fill="#dbeafe" />
      <ellipse cx="96" cy="50" rx="70" ry="30" fill="#f1f5f9" stroke="#94a3b8" strokeWidth="3" />
      <g clipPath="url(#k3c-trompo)">
        <rect x="20" y={80 - 60 * f} width="160" height={60 * f + 2} fill="#9ca3af" />
        <g className={gira ? "k3c-trompo-gira" : ""} stroke="#cbd5e1" strokeWidth="4" opacity=".7">
          {Array.from({ length: 10 }, (_, i) => <line key={i} x1={20 + i * 24} y1="18" x2={4 + i * 24} y2="84" />)}
        </g>
      </g>
      <circle cx="50" cy="94" r="11" fill="#334155" /><circle cx="80" cy="94" r="11" fill="#334155" /><circle cx="190" cy="94" r="11" fill="#334155" />
    </svg>
  )
}

/** Tabla de pesajes del ciclo en curso (vista grande). */
export function TablaPesajes({ estado, salidas, materiales }: { estado: EstadoPlanta | null; salidas: SalidaMapa[]; materiales: { id: string; name: string }[] }) {
  if (!estado?.en_ciclo) return null
  const filas = SALIDAS.map((s) => ({ s, e: estado.salidas.find((x) => x.salida === s)! })).filter((x) => x.e && x.e.total > 0)
  const mat = (s: Salida) => { const id = salidas.find((x) => x.salida === s)?.material_id; return id ? materiales.find((m) => m.id === id)?.name : null }
  return (
    <div className="mt-1.5 overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead><tr className="bg-muted/50 text-left text-[11px] text-slate-500">
          <th className="border-b px-1.5 py-0.5 font-medium">Material</th><th className="border-b px-1.5 py-0.5 text-right font-medium">Objetivo ciclo</th>
          <th className="border-b px-1.5 py-0.5 text-right font-medium">Real ciclo</th><th className="border-b px-1.5 py-0.5 text-right font-medium">Acumulado</th>
          <th className="border-b px-1.5 py-0.5 text-right font-medium">Total teórico</th><th className="border-b px-1.5 py-0.5 font-medium">Estado</th>
        </tr></thead>
        <tbody>
          {filas.map(({ s, e }) => (
            <tr key={s}>
              <td className="border-b px-1.5 py-0.5">{nombreCorto(mat(s))} <span className="text-slate-500">{INFO_SALIDA[s].nombre}</span></td>
              <td className="border-b px-1.5 py-0.5 text-right tabular-nums">{nf(e.objetivo, 1)}</td>
              <td className="border-b px-1.5 py-0.5 text-right font-medium tabular-nums">{nf(e.real)}</td>
              <td className="border-b px-1.5 py-0.5 text-right tabular-nums">{nf(e.acumulado)}</td>
              <td className="border-b px-1.5 py-0.5 text-right tabular-nums">{nf(e.total)} {INFO_SALIDA[s].unidad}</td>
              <td className="border-b px-1.5 py-0.5">{e.pesando ? <span className="rounded-sm bg-blue-50 px-1 text-[9.5px] text-blue-800">PESANDO</span> : e.real >= e.objetivo * 0.99 ? <span className="font-medium text-green-700">listo</span> : <span className="text-slate-500">espera</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-0.5 text-[11px] text-slate-500">Total = receta × m³ con la humedad de Indumix (agua ya descontada). Ciclo {estado.ciclo}/{estado.ciclos} · {mmss(estado.tiempo_ciclo_s)}.</div>
    </div>
  )
}
