"use client"

import { useState, useCallback, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { usePlant } from "@/lib/plant-context"
import { Button } from "@/components/ui/button"
import { Tv2, X, Maximize2, Loader2, ChevronLeft, ChevronRight } from "lucide-react"

// ── Constantes ────────────────────────────────────────────────────────────────

const SHIFT_MINUTES = { 1: 560, 2: 500, total: 1060 }

const PLANT_SIZES: Record<string, string[]> = {
  silke: ["300", "400", "500", "600"],
  "villa-rosa": ["800", "1000", "1200"],
}

const SIZES = ["300", "400", "500", "600", "800", "1000", "1200"] as const

function sizeUnits(r: any, size: string): number {
  return (r[`cc${size}_simples`] || 0) + (r[`cc${size}_armado`] || 0)
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface ShiftData {
  [size: string]: number
}

interface DayData {
  date: string
  plant: string
  shift1: ShiftData
  shift2: ShiftData
  planning: Record<string, number>
  dailyTargetTotal: number | null // Objetivo diario definido por el operario
}

interface ShiftObjectives {
  [size: string]: { t1: number; t2: number; daily: number }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-")
  return `${d}/${m}/${y}`
}

function calcObjectives(planning: Record<string, number>, dailyTargetTotal: number | null): ShiftObjectives {
  const result: ShiftObjectives = {}
  
  // Calculate total planificado for the day
  const totalPlanificado = Object.values(planning).reduce((sum, val) => sum + val, 0)
  
  // If dailyTargetTotal is defined, distribute it proportionally
  // Otherwise, fall back to the old 1.2x logic
  const useCustomTarget = dailyTargetTotal && dailyTargetTotal > 0 && totalPlanificado > 0
  
  for (const [size, planned] of Object.entries(planning)) {
    let daily: number
    if (useCustomTarget) {
      // Distribute dailyTargetTotal proportionally based on planning
      daily = Math.round((planned / totalPlanificado) * dailyTargetTotal)
    } else {
      // Fallback to old logic (1.2x)
      daily = Math.round(planned * 1.2)
    }
    const t1 = Math.round(daily * (SHIFT_MINUTES[1] / SHIFT_MINUTES.total))
    const t2 = daily - t1
    result[size] = { t1, t2, daily }
  }
  return result
}

function compliance(produced: number, objective: number) {
  if (objective === 0) return produced > 0 ? 999 : null
  return Math.round((produced / objective) * 100)
}

function complianceColor(pct: number | null) {
  if (pct === null) return "text-gray-400"
  if (pct >= 100) return "text-green-600"
  if (pct >= 80) return "text-yellow-600"
  return "text-red-600"
}

function complianceBg(pct: number | null) {
  if (pct === null) return "bg-gray-50 border border-gray-200"
  if (pct >= 100) return "bg-green-50 border border-green-300"
  if (pct >= 80) return "bg-yellow-50 border border-yellow-300"
  return "bg-red-50 border border-red-300"
}

function desvio(produced: number, objective: number) {
  const d = produced - objective
  return d > 0 ? `+${d}` : `${d}`
}

// ── Componente Principal ──────────────────────────────────────────────────────

export function DailyProductionModal() {
  const { selectedPlant } = usePlant()
  const [loading, setLoading] = useState(false)
  const [navLoading, setNavLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [dayData, setDayData] = useState<DayData | null>(null)
  const [prevDate, setPrevDate] = useState<string | null>(null)
  const [nextDate, setNextDate] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  const fetchDayData = useCallback(async (plant: string, date: string) => {
    // Producción del día — sin filtro de plant (igual que daily-report)
    const sizeCols = SIZES.flatMap(s => [
      `cc${s}_simples`, `cc${s}_armado`, `cc${s}_rotura`, `cc${s}_rotura_armado`
    ]).join(", ")
    const { data: records } = await supabase
      .from("pipe_production")
      .select(`shift, plant, ${sizeCols}`)
      .eq("production_date", date)

    // Filtrar por planta en JS: silke incluye plant=null y plant="silke"
    const isMatch = (r: any) =>
      plant === "villa-rosa" ? r.plant === "villa-rosa" : r.plant !== "villa-rosa"

    const shift1: ShiftData = {}
    const shift2: ShiftData = {}
    for (const r of (records || []).filter(isMatch)) {
      const target = r.shift === 1 ? shift1 : shift2
      for (const size of SIZES) {
        const val = sizeUnits(r, size)
        target[size] = (target[size] || 0) + val
      }
    }

    // Planificación del día (no tiene columna plant, es global)
    const [y, m, d] = date.split("-").map(Number)
    const { data: planRows } = await supabase
      .from("production_planning")
      .select(`pipe_size, day_${d}, daily_target_total`)
      .eq("year", y)
      .eq("month", m)

    const planning: Record<string, number> = {}
    let dailyTargetTotal: number | null = null
    for (const row of planRows || []) {
      const val = (row as any)[`day_${d}`] || 0
      if (val > 0) planning[row.pipe_size] = val
      // Get daily_target_total from any row (they all share the same value)
      if ((row as any).daily_target_total && !dailyTargetTotal) {
        dailyTargetTotal = (row as any).daily_target_total
      }
    }

    // Buscar fecha anterior y siguiente filtrando por planta
    const plantFilter = plant === "villa-rosa" ? "villa-rosa" : "silke"
    const [{ data: prevRecord }, { data: nextRecord }] = await Promise.all([
      supabase
        .from("pipe_production")
        .select("production_date")
        .eq("plant", plantFilter)
        .lt("production_date", date)
        .order("production_date", { ascending: false })
        .limit(1)
        .single(),
      supabase
        .from("pipe_production")
        .select("production_date")
        .eq("plant", plantFilter)
        .gt("production_date", date)
        .order("production_date", { ascending: true })
        .limit(1)
        .single(),
    ])

    const prevDate = (prevRecord as any)?.production_date ?? null
    const nextDate = (nextRecord as any)?.production_date ?? null

    return { shift1, shift2, planning, dailyTargetTotal, prevDate, nextDate }
  }, [supabase])

  const loadLastDay = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const plant = selectedPlant || "silke"

      // Obtener el último parte de la planta seleccionada
      const plantFilter = plant === "villa-rosa" ? "villa-rosa" : "silke"
      const { data: lastRecord, error: lastErr } = await supabase
        .from("pipe_production")
        .select("production_date")
        .eq("plant", plantFilter)
        .order("production_date", { ascending: false })
        .limit(1)
        .single()

      if (lastErr || !lastRecord) {
        setError("No hay partes diarios registrados aún.")
        setOpen(true)
        setLoading(false)
        return
      }

      const date = lastRecord.production_date as string

      const { shift1, shift2, planning, dailyTargetTotal, prevDate: pd, nextDate: nd } = await fetchDayData(plant, date)

      setDayData({ date, plant, shift1, shift2, planning, dailyTargetTotal })
      setPrevDate(pd)
      setNextDate(nd)
      setError(null)
      setOpen(true)
    } catch {
      setError("Error al cargar los datos. Intentá nuevamente.")
      setOpen(true)
    } finally {
      setLoading(false)
    }
  }, [selectedPlant, supabase, fetchDayData])

  const navigateDay = useCallback(async (direction: "prev" | "next") => {
    if (!dayData || navLoading) return
    const date = direction === "prev" ? prevDate : nextDate
    if (!date) return
    setNavLoading(true)
    try {
      const plant = dayData.plant
      const { shift1, shift2, planning, dailyTargetTotal, prevDate: pd, nextDate: nd } = await fetchDayData(plant, date)
      setDayData({ date, plant, shift1, shift2, planning, dailyTargetTotal })
      setPrevDate(pd)
      setNextDate(nd)
    } catch {
      // silently ignore nav errors
    } finally {
      setNavLoading(false)
    }
  }, [dayData, navLoading, prevDate, nextDate, fetchDayData])

  const handleFullscreen = () => {
    if (modalRef.current) {
      if (!document.fullscreenElement) {
        modalRef.current.requestFullscreen().catch(() => {})
      } else {
        document.exitFullscreen().catch(() => {})
      }
    }
  }

  const handleClose = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    setOpen(false)
  }

  return (
    <>
      <div className="flex flex-col items-center justify-center py-16 gap-6">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-foreground mb-1">Producción del Día</h2>
          <p className="text-sm text-muted-foreground">
            Visualizá el desempeño del último parte diario en pantalla completa
          </p>
        </div>
        <Button
          size="lg"
          onClick={loadLastDay}
          disabled={loading}
          className="gap-2 text-base px-8 py-6 h-auto"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Tv2 className="w-5 h-5" />}
          {loading ? "Cargando..." : "Ver Producción del Día"}
        </Button>
      </div>

      {/* ── MODAL FULLSCREEN ──────────────────────────────────────────────── */}
      {open && (
        <div
          ref={modalRef}
          className="fixed inset-0 z-50 bg-white text-gray-900 overflow-hidden flex flex-col"
          style={{ fontFamily: "system-ui, sans-serif" }}
        >
          {/* Controles flotantes */}
          <div className="absolute top-3 right-3 flex gap-2 z-10">
            <button
              onClick={handleFullscreen}
              className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-900 transition-colors"
              title="Pantalla completa"
            >
              <Maximize2 className="w-5 h-5" />
            </button>
            <button
              onClick={handleClose}
              className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-900 transition-colors"
              title="Cerrar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Contenido */}
          <div className="flex-1 min-h-0 p-4 md:p-6 flex flex-col">
            {error || !dayData ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-xl text-gray-400">{error || "No hay partes diarios registrados aún."}</p>
              </div>
            ) : (
              <ModalContent
                dayData={dayData}
                hasPrev={!!prevDate}
                hasNext={!!nextDate}
                navLoading={navLoading}
                onPrev={() => navigateDay("prev")}
                onNext={() => navigateDay("next")}
              />
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ── Contenido del modal ───────────────────────────────────────────────────────

function ModalContent({
  dayData,
  hasPrev,
  hasNext,
  navLoading,
  onPrev,
  onNext,
}: {
  dayData: DayData
  hasPrev: boolean
  hasNext: boolean
  navLoading: boolean
  onPrev: () => void
  onNext: () => void
}) {
  const sizes = PLANT_SIZES[dayData.plant] || PLANT_SIZES["silke"]
  const objectives = calcObjectives(dayData.planning, dayData.dailyTargetTotal)

  const totalProducedT1 = sizes.reduce((s, sz) => s + (dayData.shift1[sz] || 0), 0)
  const totalProducedT2 = sizes.reduce((s, sz) => s + (dayData.shift2[sz] || 0), 0)
  const totalObjT1 = sizes.reduce((s, sz) => s + (objectives[sz]?.t1 || 0), 0)
  const totalObjT2 = sizes.reduce((s, sz) => s + (objectives[sz]?.t2 || 0), 0)
  const totalProducedDay = totalProducedT1 + totalProducedT2
  const totalObjDay = totalObjT1 + totalObjT2

  const totalPctT1 = compliance(totalProducedT1, totalObjT1)
  const totalPctT2 = compliance(totalProducedT2, totalObjT2)
  const totalPctDay = compliance(totalProducedDay, totalObjDay)

  const plantLabel = dayData.plant === "villa-rosa" ? "VILLA ROSA" : "SILKE"

  return (
    <div className="flex flex-col h-full w-full max-w-7xl mx-auto">
      {/* Encabezado */}
      <header className="flex-shrink-0 text-center border-b border-gray-200 pb-3 mb-3">
        <div className="text-gray-500 text-sm font-medium uppercase tracking-widest mb-0.5">{plantLabel}</div>
        <h1 className="text-3xl md:text-4xl font-black tracking-tight text-gray-900 mb-2">
          PRODUCCIÓN vs. OBJETIVO
        </h1>
        {/* Navegación de fechas */}
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={onPrev}
            disabled={!hasPrev || navLoading}
            className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed text-gray-600 hover:text-gray-900 transition-colors"
            title="Día anterior"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="text-xl text-gray-700 font-semibold min-w-[140px] text-center">
            {navLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" /> : formatDate(dayData.date)}
          </div>
          <button
            onClick={onNext}
            disabled={!hasNext || navLoading}
            className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed text-gray-600 hover:text-gray-900 transition-colors"
            title="Día siguiente"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Columnas por turno */}
      <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
        <ShiftColumn
          label="TURNO 1"
          minutes={SHIFT_MINUTES[1]}
          sizes={sizes}
          produced={dayData.shift1}
          objectives={objectives}
          shiftKey="t1"
          totalProduced={totalProducedT1}
          totalObj={totalObjT1}
          totalPct={totalPctT1}
        />
        <ShiftColumn
          label="TURNO 2"
          minutes={SHIFT_MINUTES[2]}
          sizes={sizes}
          produced={dayData.shift2}
          objectives={objectives}
          shiftKey="t2"
          totalProduced={totalProducedT2}
          totalObj={totalObjT2}
          totalPct={totalPctT2}
        />
      </div>

      {/* Pie: cumplimiento total del día */}
      <footer className="flex-shrink-0 border-t border-gray-200 pt-3 mt-3">
        <div className="flex items-center justify-center gap-8">
          <div className="text-center">
            <div className="text-gray-500 text-xs uppercase tracking-widest mb-1">Total producido</div>
            <div className="text-4xl font-black text-gray-900">{totalProducedDay}</div>
            <div className="text-gray-400 text-xs">unidades</div>
          </div>
          <div className="w-px h-14 bg-gray-200" />
          <div className="text-center">
            <div className="text-gray-500 text-xs uppercase tracking-widest mb-1">Objetivo del día</div>
            <div className="text-4xl font-black text-gray-900">{totalObjDay}</div>
            <div className="text-gray-400 text-xs">unidades</div>
          </div>
          <div className="w-px h-14 bg-gray-200" />
          <div className="text-center">
            <div className="text-gray-500 text-xs uppercase tracking-widest mb-1">Cumplimiento del día</div>
            <div className={`text-5xl font-black ${complianceColor(totalPctDay)}`}>
              {totalPctDay !== null ? `${totalPctDay}%` : "—"}
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

// ── Columna de turno ────────────��────────────────────────────────────────────

function ShiftColumn({
  label,
  minutes,
  sizes,
  produced,
  objectives,
  shiftKey,
  totalProduced,
  totalObj,
  totalPct,
}: {
  label: string
  minutes: number
  sizes: string[]
  produced: ShiftData
  objectives: ShiftObjectives
  shiftKey: "t1" | "t2"
  totalProduced: number
  totalObj: number
  totalPct: number | null
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="text-center pb-2 border-b border-gray-200 flex-shrink-0">
        <div className="text-xl md:text-2xl font-black text-gray-900">{label}</div>
        <div className="text-gray-500 text-sm">{minutes} min</div>
      </div>

      <div className="flex flex-col gap-2 flex-1 min-h-0 justify-evenly py-2">
        {sizes.map((size) => {
          const prod = produced[size] || 0
          const obj = objectives[size]?.[shiftKey] || 0
          const pct = compliance(prod, obj)
          return (
            <div key={size} className={`rounded-xl p-3 ${complianceBg(pct)}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-lg font-bold text-gray-900">DN {size}</div>
                <div className={`text-2xl font-black ${complianceColor(pct)}`}>
                  {pct !== null ? `${pct}%` : "—"}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-gray-500 text-xs uppercase tracking-wide mb-0.5">Objetivo</div>
                  <div className="text-lg font-bold text-gray-700">{obj}</div>
                </div>
                <div>
                  <div className="text-gray-500 text-xs uppercase tracking-wide mb-0.5">Producido</div>
                  <div className="text-lg font-bold text-gray-900">{prod}</div>
                </div>
                <div>
                  <div className="text-gray-500 text-xs uppercase tracking-wide mb-0.5">Desvío</div>
                  <div className={`text-lg font-bold ${prod - obj >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {desvio(prod, obj)}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex-shrink-0 pt-2 border-t border-gray-200 rounded-xl bg-gray-50 p-3 mt-1">
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-sm font-bold text-gray-700 uppercase tracking-wide">TOTAL TURNO</div>
          <div className={`text-2xl font-black ${complianceColor(totalPct)}`}>
            {totalPct !== null ? `${totalPct}%` : "—"}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-gray-500 text-xs mb-0.5">Objetivo</div>
            <div className="text-xl font-bold text-gray-700">{totalObj}</div>
          </div>
          <div>
            <div className="text-gray-500 text-xs mb-0.5">Producido</div>
            <div className="text-xl font-bold text-gray-900">{totalProduced}</div>
          </div>
          <div>
            <div className="text-gray-500 text-xs mb-0.5">Desvío</div>
            <div className={`text-xl font-bold ${totalProduced - totalObj >= 0 ? "text-green-600" : "text-red-600"}`}>
              {desvio(totalProduced, totalObj)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
