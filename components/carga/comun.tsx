"use client"

/** Piezas chicas de la pantalla de Carga (mismo estilo que el despacho de la fase 3: 13 px, bordes finos, etiquetas suaves). */
import { cn } from "@/lib/utils"
import { INFO_SALIDA, nf, type Salida } from "@/lib/carga/tipos"

const pad = (n: number) => String(n).padStart(2, "0")
export const hhmm = (t: string | number | Date | null | undefined) => {
  if (t == null) return "—"
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? "—" : `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export const hms = (t: string | number | Date | null | undefined) => {
  if (t == null) return "—"
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? "—" : `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
export const mmss = (seg: number | null | undefined) => {
  if (seg == null || !Number.isFinite(seg)) return "—"
  const s = Math.max(0, Math.floor(seg))
  return `${Math.floor(s / 60)}:${pad(s % 60)}`
}
export const minTxt = (min: number | null | undefined) => (min == null ? "—" : min < 60 ? `${Math.round(min)} min` : `${Math.floor(min / 60)} h ${pad(Math.round(min % 60))}`)
export const m3t = (x: number | null | undefined) => (x == null ? "—" : nf(x, Math.round(Number(x) * 10) % 10 ? 1 : 0))
export const unidadSalida = (s: Salida) => INFO_SALIDA[s].unidad

type Tono = "ok" | "bad" | "warn" | "blue" | "violet" | "slate" | "cyan" | "dark" | "R" | "X"
const TONO: Record<Tono, string> = {
  ok: "bg-emerald-50 text-emerald-800", bad: "bg-red-50 text-red-700", warn: "bg-amber-50 text-amber-800", blue: "bg-blue-50 text-blue-800",
  violet: "bg-violet-50 text-violet-800", slate: "bg-slate-200 text-slate-800", cyan: "bg-cyan-50 text-cyan-800", dark: "bg-slate-200 text-slate-900",
  R: "bg-emerald-50 text-emerald-800", X: "bg-amber-50 text-amber-800",
}
export function Tag({ tono, children, className, title }: { tono: Tono; children: React.ReactNode; className?: string; title?: string }) {
  return <span title={title} className={cn("d3c-tag inline-block shrink-0 whitespace-nowrap rounded px-1 text-[10.5px] leading-4", TONO[tono], className)}>{children}</span>
}

/** Cartel fijo de la etapa simulada: que nadie lo confunda con la planta real. */
export function CartelSimulada({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md border border-l-[3px] border-amber-300 border-l-amber-500 bg-amber-50 px-2.5 py-0.5 text-amber-950", className)}>
      <span className="text-xs font-medium tracking-wide">PLANTA SIMULADA — no mueve la planta real</span>
      <span className="text-[11px]">Las cargas de esta pantalla son de prueba: no tocan Indumix, no ajustan el stock y no corrigen despachos. La conexión con Indumix se programa después del jueves 23/10.</span>
    </div>
  )
}

export function Chip({ ok, children, title }: { ok: boolean; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap text-[11px]", ok ? "text-slate-500" : "font-medium text-red-700")}>
      <i className={cn("inline-block h-[7px] w-[7px] rounded-full", ok ? "bg-emerald-500" : "bg-red-600")} />{children}
    </span>
  )
}

/**
 * Botón chico (26 px, como el despacho): con borde o fantasma, sin relleno fuerte. CARGAR y PARAR no usan este botón:
 * siguen grandes.
 */
export function Btn({ className, tono = "base", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tono?: "base" | "pri" | "ok" | "amb" | "ghost" | "danger" }) {
  const t = {
    base: "border-slate-300 bg-transparent text-foreground hover:bg-slate-100",
    pri: "border-blue-300 bg-transparent text-blue-800 hover:bg-blue-50",
    ok: "border-green-400 bg-transparent text-green-800 hover:bg-green-50",
    amb: "border-amber-300 bg-transparent text-amber-900 hover:bg-amber-50",
    ghost: "border-transparent bg-transparent text-slate-500 hover:border-slate-300 hover:bg-slate-100",
    danger: "border-red-300 bg-transparent text-red-700 hover:bg-red-50",
  }[tono]
  return <button {...p} className={cn("h-[26px] whitespace-nowrap rounded border px-2 text-xs disabled:cursor-not-allowed disabled:opacity-45", t, className)} />
}
