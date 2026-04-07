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
}

interface ShiftObjectives {
  [size: string]: { t1: number; t2: number; daily: number }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-")
  return `${d}/${m}/${y}`
}

function calcObjectives(planning: Record<string, number>): ShiftObjectives {
  const result: ShiftObjectives = {}
  for (const [size, planned] of Object.entries(planning)) {
    const daily = Math.round(planned * 1.2)
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
  if (pct >= 100) return "text-green-400"
  if (pct >= 80) return "text-yellow-400"
  return "text-red-400"
}

function complianceBg(pct: number | null) {
  if (pct === null) return "bg-gray-800"
  if (pct >= 100) return "bg-green-900/40 border border-green-600/30"
  if (pct >= 80) return "bg-yellow-900/40 border border-yellow-600/30"
  return "bg-red-900/40 border border-red-600/30"
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
    // Producción del día — columnas reales: cc{size}_simples, cc{size}_armado, etc.
    const sizeCols = SIZES.flatMap(s => [
      `cc${s}_simples`, `cc${s}_armado`, `cc${s}_rotura`, `cc${s}_rotura_armado`
    ]).join(", ")
    const plantFilter = plant === "villa-rosa" ? "plant.eq.villa-rosa" : "plant.eq.silke,plant.is.null"
    const { data: records } = await supabase
      .from("pipe_production")
      .select(`shift, ${sizeCols}`)
      .or(plantFilter)
      .eq("production_date", date)

    const shift1: ShiftData = {}
    const shift2: ShiftData = {}
    for (const r of records || []) {
      const target = r.shift === 1 ? shift1 : shift2
      for (const size of SIZES) {
        const val = sizeUnits(r, size)
        target[size] = (target[size] || 0) + val
      }
    }

    // Planificación del día
    const [y, m, d] = date.split("-").map(Number)
    const { data: planRows } = await supabase
      .from("production_planning")
      .select(`pipe_size, day_${d}`)
      .eq("year", y)
      .eq("month", m)
      .eq("plant", plant)

    const planning: Record<string, number> = {}
    for (const row of planRows || []) {
      const val = (row as any)[`day_${d}`] || 0
      if (val > 0) planning[row.pipe_size] = val
    }

    // Buscar fecha anterior y siguiente
    const [{ data: prevRecord }, { data: nextRecord }] = await Promise.all([
      supabase
        .from("pipe_production")
        .select("production_date")
        .or(plantFilter)
        .lt("production_date", date)
        .order("production_date", { ascending: false })
        .limit(1)
        .single(),
      supabase
        .from("pipe_production")
        .select("production_date")
        .or(plantFilter)
        .gt("production_date", date)
        .order("production_date", { ascending: true })
        .limit(1)
        .single(),
    ])

    const prevDate = (prevRecord as any)?.production_date ?? null
    const nextDate = (nextRecord as any)?.production_date ?? null

    return { shift1, shift2, planning, prevDate, nextDate }
  }, [supabase])

  const loadLastDay = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const plant = selectedPlant || "silke"

      // Obtener el último parte registrado para esta planta
      const plantFilter = plant === "villa-rosa" ? "plant.eq.villa-rosa" : "plant.eq.silke,plant.is.null"
      const { data: lastRecord, error: lastErr } = await supabase
        .from("pipe_production")
        .select("production_date")
        .or(plantFilter)
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

      const { shift1, shift2, planning, prevDate: pd, nextDate: nd } = await fetchDayData(plant, date)

      setDayData({ date, plant, shift1, shift2, planning })
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
      const { shift1, shift2, planning, prevDate: pd, nextDate: nd } = await fetchDayData(plant, date)
      setDayData({ date, plant, shift1, shift2, planning })
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
          className="fixed inset-0 z-50 bg-gray-950 text-white overflow-auto"
          style={{ fontFamily: "system-ui, sans-serif" }}
        >
          {/* Controles flotantes */}
          <div className="absolute top-4 right-4 flex gap-2 z-10">
            <button
              onClick={handleFullscreen}
              className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
              title="Pantalla completa"
            >
              <Maximize2 className="w-5 h-5" />
            </button>
            <button
              onClick={handleClose}
              className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
              title="Cerrar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Contenido */}
          <div className="min-h-screen p-6 md:p-10 flex flex-col">
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
  const objectives = calcObjectives(dayData.planning)

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
    <div className="flex flex-col gap-8 w-full max-w-7xl mx-auto">
      {/* Encabezado */}
      <header className="text-center border-b border-gray-700 pb-6">
        <div className="text-gray-400 text-lg font-medium uppercase tracking-widest mb-1">{plantLabel}</div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tight text-white mb-2">
          PRODUCCIÓN vs. OBJETIVO
        </h1>
        {/* Navegación de fechas */}
        <div className="flex items-center justify-center gap-4 mt-2">
          <button
            onClick={onPrev}
            disabled={!hasPrev || navLoading}
            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-gray-300 hover:text-white transition-colors"
            title="Día anterior"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div className="text-2xl text-gray-300 font-semibold min-w-[160px] text-center">
            {navLoading ? <Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-500" /> : formatDate(dayData.date)}
          </div>
          <button
            onClick={onNext}
            disabled={!hasNext || navLoading}
            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-gray-300 hover:text-white transition-colors"
            title="Día siguiente"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </div>
      </header>

      {/* Columnas por turno */}
      <div className="grid grid-cols-2 gap-6 flex-1">
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
      <footer className="mt-auto border-t border-gray-700 pt-6">
        <div className="flex items-center justify-center gap-8">
          <div className="text-center">
            <div className="text-gray-400 text-sm uppercase tracking-widest mb-1">Total producido</div>
            <div className="text-5xl font-black text-white">{totalProducedDay}</div>
            <div className="text-gray-500 text-sm">unidades</div>
          </div>
          <div className="w-px h-20 bg-gray-700" />
          <div className="text-center">
            <div className="text-gray-400 text-sm uppercase tracking-widest mb-1">Objetivo del día</div>
            <div className="text-5xl font-black text-white">{totalObjDay}</div>
            <div className="text-gray-500 text-sm">unidades</div>
          </div>
          <div className="w-px h-20 bg-gray-700" />
          <div className="text-center">
            <div className="text-gray-400 text-sm uppercase tracking-widest mb-1">Cumplimiento del día</div>
            <div className={`text-6xl font-black ${complianceColor(totalPctDay)}`}>
              {totalPctDay !== null ? `${totalPctDay}%` : "—"}
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

// ── Columna de turno ─────────────────────────────────────────────────────────

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
    <div className="flex flex-col gap-3">
      <div className="text-center pb-3 border-b border-gray-700">
        <div className="text-2xl md:text-3xl font-black text-white">{label}</div>
        <div className="text-gray-400 text-base">{minutes} min</div>
      </div>

      <div className="flex flex-col gap-2">
        {sizes.map((size) => {
          const prod = produced[size] || 0
          const obj = objectives[size]?.[shiftKey] || 0
          const pct = compliance(prod, obj)
          return (
            <div key={size} className={`rounded-xl p-4 ${complianceBg(pct)}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-xl font-bold text-white">DN {size}</div>
                <div className={`text-2xl font-black ${complianceColor(pct)}`}>
                  {pct !== null ? `${pct}%` : "—"}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-gray-400 text-xs uppercase tracking-wide mb-1">Objetivo</div>
                  <div className="text-xl font-bold text-gray-200">{obj}</div>
                </div>
                <div>
                  <div className="text-gray-400 text-xs uppercase tracking-wide mb-1">Producido</div>
                  <div className="text-xl font-bold text-white">{prod}</div>
                </div>
                <div>
                  <div className="text-gray-400 text-xs uppercase tracking-wide mb-1">Desvío</div>
                  <div className={`text-xl font-bold ${prod - obj >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {desvio(prod, obj)}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-auto pt-3 border-t border-gray-600 rounded-xl bg-gray-800/60 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-base font-bold text-gray-300 uppercase tracking-wide">TOTAL TURNO</div>
          <div className={`text-3xl font-black ${complianceColor(totalPct)}`}>
            {totalPct !== null ? `${totalPct}%` : "—"}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-gray-500 text-xs mb-1">Objetivo</div>
            <div className="text-2xl font-bold text-gray-200">{totalObj}</div>
          </div>
          <div>
            <div className="text-gray-500 text-xs mb-1">Producido</div>
            <div className="text-2xl font-bold text-white">{totalProduced}</div>
          </div>
          <div>
            <div className="text-gray-500 text-xs mb-1">Desvío</div>
            <div className={`text-2xl font-bold ${totalProduced - totalObj >= 0 ? "text-green-400" : "text-red-400"}`}>
              {desvio(totalProduced, totalObj)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
