"use client"

import type React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { getSupabase } from "@/lib/supabase"
import { Loader2, ChevronLeft, Check, Save, Grid3X3, AlertTriangle } from "lucide-react"

const PAVER_DOWNTIME_CATEGORIES: Record<string, string[]> = {
  "Factores Externos": ["Energia Electrica"],
  "Paradas Planificadas": [
    "Cambio de Molde", "Mantenimiento", "Capacitacion", "Reuniones",
    "Mto Autonomo (limp, lub y ajustes)", "Programador",
    "Calibracion de maquina x cambio molde", "Pruebas y/o ensayos varios",
  ].sort(),
  "Fallas de Proceso": [
    "Problema con Calidad de Hormigon", "Problema con Calidad de Materia Prima",
    "Falta mezcla", "Cambio de color", "Calidad de Producto",
    "Arranques y ajustes en prensa", "Espera de Materia Prima",
    "Espera de Insumos (Tolvas vacias)",
  ].sort(),
  "Gestion": [
    "Falta Personal", "Espera de Instrucciones", "Arranca Tarde",
    "Falta de tablas", "Termina Antes", "Pala", "Autoelevadores", "Factores Humanos",
  ].sort(),
  "Logistica": [
    "Reposicion int de pallets", "Transporte de pallets a playa",
    "Logistica interna de prod terminado",
  ].sort(),
  "Min no anotados": ["Paradas menores a 5 min"],
  "Fallas de Equipo": [
    "Tolvas de aridos", "Tolva de Prensa", "Balanza de aridos",
    "Cinta de balanza de aridos", "Cinta transportadora aridos", "Cinta mezcladora",
    "Cilindros hidraulicos", "Chimango de cemento", "Balanza de cemento",
    "Bomba de agua", "Central hidraulica", "Mezcladora", "Prensa",
    "Cajon alimentador", "Carro de tablas", "Tolva alimentador", "Tablas y racks",
    "Cepillo limpieza contra molde", "Molde", "Contramolde", "Correas",
    "Cajas vibradoras", "Motores de cajas", "Sensores", "Ascensor", "Descensor",
    "Paletizadora/paletizado", "Brazo de molde/contra molde", "Cinta salida de prensa",
    "Cinta paletizado", "Mangueras hidraulicas", "Dosificador aditivo",
    "Compresor de aire", "Tablas en ascensor", "Cilindros neumaticos", "Fallas Electricas",
  ].sort(),
}

function getPaverDowntimeCategory(reason: string): string {
  for (const category in PAVER_DOWNTIME_CATEGORIES) {
    if (PAVER_DOWNTIME_CATEGORIES[category].includes(reason)) return category
  }
  return "Otro"
}

interface ProductType {
  id: number
  product_code: string
  description: string
}

interface ProdRow {
  date: string
  dayLabel: string
  isSunday: boolean
  skip: boolean
  saved: boolean
  productTypeId: string
  startTime: string
  endTime: string
  extraMinutes: string
  formulaCementKg: string
  formulaSandKg: string
  formulaStoneKg: string
  formulaAdditiveLts: string
  pastonesCount: string
  tablesProduced: string
  wetPieceWeightKg: string
  palletizedFirst: string
  palletizedSecond: string
  wasteKg: string
  cementSilo1Tn: string
  cementSilo2Tn: string
  observations: string
}

interface DowntimeCell {
  minutes: string
  comments: string
}

// dtData[date][reason] = { minutes, comments }
type DtData = Record<string, Record<string, DowntimeCell>>

const PROD_FIELDS: { key: keyof ProdRow; label: string; type: string; step?: string; bgAlt?: boolean }[] = [
  { key: "productTypeId", label: "Producto", type: "select" },
  { key: "startTime", label: "Inicio", type: "time" },
  { key: "endTime", label: "Fin", type: "time" },
  { key: "extraMinutes", label: "Min +", type: "number" },
  { key: "tablesProduced", label: "Tablas", type: "number", bgAlt: true },
  { key: "wetPieceWeightKg", label: "Peso H. (kg)", type: "number", step: "0.001", bgAlt: true },
  { key: "palletizedFirst", label: "Pzas 1ra", type: "number" },
  { key: "palletizedSecond", label: "Pzas 2da", type: "number" },
  { key: "wasteKg", label: "Desp. (kg)", type: "number", step: "0.1" },
  { key: "observations", label: "Obs", type: "text" },
]

const WEEKDAYS_SHORT = ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"]
const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

function getDaysInMonth(year: number, month: number): string[] {
  const days: string[] = []
  const numDays = new Date(year, month + 1, 0).getDate()
  for (let d = 1; d <= numDays; d++) {
    days.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`)
  }
  return days
}

function dayNum(date: string): number {
  return parseInt(date.split("-")[2])
}

function weekdayShort(date: string): string {
  const d = new Date(date + "T12:00:00")
  return WEEKDAYS_SHORT[d.getDay()]
}

function isSunday(date: string): boolean {
  return new Date(date + "T12:00:00").getDay() === 0
}

interface PaverRapidLoaderProps {
  onBack?: () => void
}

type ActiveTab = "produccion" | "paradas"

export function PaverRapidLoader({ onBack }: PaverRapidLoaderProps) {
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<ActiveTab>("produccion")

  const [selectedYear, setSelectedYear] = useState(2025)
  const [selectedMonth, setSelectedMonth] = useState(0)
  const allDays = getDaysInMonth(selectedYear, selectedMonth)

  const [productTypes, setProductTypes] = useState<ProductType[]>([])
  const [savedDays, setSavedDays] = useState<Set<string>>(new Set())

  const [prodRows, setProdRows] = useState<ProdRow[]>([])
  const [dtData, setDtData] = useState<DtData>({})

  // Active cell for comment bubble
  const [activeCell, setActiveCell] = useState<{ date: string; reason: string } | null>(null)
  const [commentDraft, setCommentDraft] = useState("")
  const bubbleRef = useRef<HTMLDivElement>(null)
  const activeCellRef = useRef<HTMLTableCellElement>(null)

  // Initialize rows when month changes
  useEffect(() => {
    const pRows: ProdRow[] = allDays.map(date => {
      const sun = isSunday(date)
      return {
        date,
        dayLabel: `${weekdayShort(date)} ${dayNum(date)}`,
        isSunday: sun,
        skip: sun,
        saved: false,
        productTypeId: "",
        startTime: "05:00",
        endTime: "16:00",
        extraMinutes: "0",
        formulaCementKg: "",
        formulaSandKg: "",
        formulaStoneKg: "",
        formulaAdditiveLts: "",
        pastonesCount: "",
        tablesProduced: "",
        wetPieceWeightKg: "",
  palletizedFirst: "",
  palletizedSecond: "",
  wasteKg: "",
  cementSilo1Tn: "",
  cementSilo2Tn: "",
  observations: "",
  }
  })
    setProdRows(pRows)

    const dt: DtData = {}
    allDays.forEach(date => { dt[date] = {} })
    setDtData(dt)
  }, [selectedYear, selectedMonth])

  // Load product types and existing data
  useEffect(() => {
    const load = async () => {
      const supabase = getSupabase()
      const days = getDaysInMonth(selectedYear, selectedMonth)
      if (days.length === 0) return
      const [prodRes, existingRes] = await Promise.all([
        supabase.from("paver_product_types").select("id, product_code, description").eq("active", true).order("product_code"),
        supabase.from("paver_production").select("production_date").gte("production_date", days[0]).lte("production_date", days[days.length - 1]),
      ])
      if (prodRes.data) setProductTypes(prodRes.data)
      if (existingRes.data) {
        const dates = new Set(existingRes.data.map((r: any) => r.production_date))
        setSavedDays(dates)
        setProdRows(prev => prev.map(row => ({ ...row, saved: dates.has(row.date) })))
      }
    }
    load()
  }, [selectedYear, selectedMonth])

  // Close bubble on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (activeCell && bubbleRef.current && !bubbleRef.current.contains(e.target as Node)) {
        commitComment()
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [activeCell, commentDraft])

  // Flag to skip onBlur bubble when navigating with Enter
  const skipBlurRef = useRef(false)

  // Navigate to the cell below on Enter
  function handleGridKeyDown(e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>, gridId: string, row: number, col: number) {
    if (e.key === "Enter") {
      e.preventDefault()
      skipBlurRef.current = true
      const next = document.querySelector<HTMLElement>(`[data-grid="${gridId}"][data-row="${row + 1}"][data-col="${col}"]`)
      if (next) next.focus()
      // Reset flag after focus settles
      requestAnimationFrame(() => { skipBlurRef.current = false })
    }
  }

  function updateProd(date: string, field: keyof ProdRow, value: string) {
    setProdRows(prev => prev.map(row => row.date === date ? { ...row, [field]: value } : row))
  }

  function fillDown(date: string, field: keyof ProdRow) {
    const sourceRow = prodRows.find(r => r.date === date)
    if (!sourceRow) return
    const value = sourceRow[field] as string
    const startIdx = prodRows.findIndex(r => r.date === date)
    setProdRows(prev => prev.map((row, i) => {
      if (i <= startIdx || row.saved || row.skip) return row
      return { ...row, [field]: value }
    }))
  }

  function updateDtMinutes(date: string, reason: string, value: string) {
    // Allow empty string for clearing, otherwise keep as-is for editing
    const minutes = value === "" ? "" : value
    setDtData(prev => ({
      ...prev,
      [date]: {
        ...prev[date],
        [reason]: { minutes, comments: prev[date]?.[reason]?.comments || "" },
      },
    }))
  }

  function openBubble(date: string, reason: string) {
    // If clicking same cell, toggle off
    if (activeCell?.date === date && activeCell?.reason === reason) {
      commitComment()
      return
    }
    // Commit previous first
    if (activeCell) commitComment()
    const existing = dtData[date]?.[reason]?.comments || ""
    setCommentDraft(existing)
    setActiveCell({ date, reason })
  }

  const commitComment = useCallback(() => {
    if (!activeCell) return
    const { date, reason } = activeCell
    setDtData(prev => ({
      ...prev,
      [date]: {
        ...prev[date],
        [reason]: {
          minutes: prev[date]?.[reason]?.minutes || "0",
          comments: commentDraft,
        },
      },
    }))
    setActiveCell(null)
    setCommentDraft("")
  }, [activeCell, commentDraft])

  // Save all
  async function saveAll() {
    const rowsToSave = prodRows.filter(r => !r.saved && !r.skip && r.productTypeId)
    if (rowsToSave.length === 0) {
      toast({ title: "Nada para guardar", description: "No hay filas con producto seleccionado", variant: "destructive" })
      return
    }

    setSaving(true)
    let savedCount = 0

    try {
      const supabase = getSupabase()
      const { data: curSup } = await supabase.from("paver_supplier_current").select("*")
      const getSupplier = (name: string) => curSup?.find((s: any) => s.ingredient_name === name)?.supplier_name || null

      for (const row of rowsToSave) {
        const pt = productTypes.find(p => p.id === Number(row.productTypeId))
        const record = {
          production_date: row.date,
          start_time: row.startTime,
          end_time: row.endTime,
          extra_minutes: Number(row.extraMinutes) || 0,
          product_type_id: Number(row.productTypeId),
          product_type_code: pt?.product_code || null,
          formula_cement_kg: row.formulaCementKg ? Number(row.formulaCementKg) : null,
          formula_sand_kg: row.formulaSandKg ? Number(row.formulaSandKg) : null,
          formula_stone_kg: row.formulaStoneKg ? Number(row.formulaStoneKg) : null,
          formula_additive_lts: row.formulaAdditiveLts ? Number(row.formulaAdditiveLts) : null,
          pastones_count: Number(row.pastonesCount) || 0,
          tables_produced: row.tablesProduced ? Number(row.tablesProduced) : null,
          wet_piece_weight_kg: row.wetPieceWeightKg ? Number(row.wetPieceWeightKg) : null,
  palletized_first: row.palletizedFirst ? Number(row.palletizedFirst) : null,
  palletized_second: row.palletizedSecond ? Number(row.palletizedSecond) : null,
  waste_kg: row.wasteKg ? Number(row.wasteKg) : 0,
  cement_silo_1_tn: row.cementSilo1Tn ? Number(row.cementSilo1Tn) : 0,
          cement_silo_2_tn: row.cementSilo2Tn ? Number(row.cementSilo2Tn) : 0,
          cement_supplier: getSupplier("Cemento"),
          sand_supplier: getSupplier("Arena"),
          stone_supplier: getSupplier("Piedra (0-6)"),
          supplier_changed: false,
          observations: row.observations || null,
        }

        const { data: newRecord, error } = await supabase
          .from("paver_production").insert(record).select().single()
        if (error) throw error

        // Insert downtimes for this day
        const dayDt = dtData[row.date]
        if (dayDt) {
          const entries = Object.entries(dayDt).filter(([, d]) => Number(d.minutes) > 0)
          if (entries.length > 0) {
            const inserts = entries.map(([reason, data]) => ({
              paver_production_id: newRecord.id,
              custom_reason: reason,
              minutes: Number(data.minutes),
              comments: data.comments || null,
              downtime_category: getPaverDowntimeCategory(reason),
            }))
            await supabase.from("paver_downtime").insert(inserts)
          }
        }

        savedCount++
      }

      const savedDates = new Set(rowsToSave.map(r => r.date))
      setProdRows(prev => prev.map(row => savedDates.has(row.date) ? { ...row, saved: true } : row))
      setSavedDays(prev => new Set([...prev, ...savedDates]))
      toast({ title: "Guardado", description: `${savedCount} dias guardados correctamente` })
    } catch (error) {
      toast({
        title: "Error",
        description: `Se guardaron ${savedCount} dias. Error: ${error instanceof Error ? error.message : "desconocido"}`,
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const savedCount = prodRows.filter(r => r.saved).length
  const readyCount = prodRows.filter(r => !r.saved && !r.skip && r.productTypeId).length
  const totalDays = allDays.length
  const progress = Math.round((savedCount / totalDays) * 100)

  const cellCls = "h-7 w-full min-w-0 text-xs text-center px-1 border-border"
  const headerCls = "text-[10px] font-semibold text-muted-foreground whitespace-nowrap px-1 py-1.5 text-center bg-muted/50 border-b border-r border-border"

  function rowBg(saved: boolean, skip: boolean, sun: boolean) {
    if (saved) return "bg-emerald-50/50 dark:bg-emerald-900/10"
    if (skip || sun) return "bg-muted/30"
    return "bg-card"
  }

  const containerRef = useRef<HTMLDivElement>(null)
  
  return (
    <div className="space-y-4" ref={containerRef} onKeyDown={(e) => {
      if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
        e.preventDefault()
        const container = containerRef.current
        if (!container) return
        const current = e.target as HTMLInputElement
        const currentRect = current.getBoundingClientRect()
        const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="number"], input[type="text"]'))
        
        const tolerance = 50
        const inputsBelow = inputs.filter(inp => {
          const rect = inp.getBoundingClientRect()
          return Math.abs(rect.left - currentRect.left) < tolerance && rect.top > currentRect.top + 10
        }).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
        
        if (inputsBelow.length > 0) {
          inputsBelow[0].focus()
          inputsBelow[0].select()
        } else {
          const currentIndex = inputs.indexOf(current)
          if (currentIndex >= 0 && currentIndex < inputs.length - 1) {
            inputs[currentIndex + 1].focus()
            inputs[currentIndex + 1].select()
          }
        }
      }
    }}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          {onBack && (
            <button type="button" onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
              <ChevronLeft className="h-4 w-4" /> Volver
            </button>
          )}
          <div className="flex items-center gap-2">
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              value={selectedMonth}
              onChange={e => setSelectedMonth(Number(e.target.value))}
            >
              {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
            </select>
            <Input
              type="number" min="2020" max="2030" value={selectedYear}
              onChange={e => setSelectedYear(Number(e.target.value))}
              className="h-8 w-20 text-sm"
            />
          </div>
        </div>
        <Button onClick={saveAll} disabled={saving || readyCount === 0} className="h-9">
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Guardar todo ({readyCount} dias)
        </Button>
      </div>

      {/* Progress */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{savedCount} de {totalDays} dias guardados</span>
          <span className="font-semibold text-foreground">{progress}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Tab selector */}
      <div className="flex gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab("produccion")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "produccion"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Grid3X3 className="h-3.5 w-3.5 inline mr-1.5" />
          Produccion
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("paradas")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "paradas"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5 inline mr-1.5" />
          Paradas
        </button>
      </div>

      {/* ==================== PRODUCTION GRID (transposed) ==================== */}
      {/* Fechas en eje X (columnas), campos en eje Y (filas) */}
      {activeTab === "produccion" && (
        <div className="overflow-auto border border-border rounded-lg max-h-[70vh]">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                <th className={`${headerCls} sticky left-0 top-0 z-30 bg-muted min-w-[90px] text-left px-2`}>
                  Campo / Dia
                </th>
                {prodRows.map(row => (
                  <th key={row.date} className={`${headerCls} min-w-[56px] sticky top-0 z-20 ${
                    row.saved ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600" :
                    row.isSunday ? "bg-muted/60 text-muted-foreground/50" : "bg-muted/50"
                  }`}>
                    <div className="leading-tight">
                      <div className="text-[9px] opacity-60">{weekdayShort(row.date)}</div>
                      <div className="flex items-center justify-center gap-0.5">
                        {row.saved && <Check className="h-2.5 w-2.5 text-emerald-500" />}
                        {dayNum(row.date)}
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PROD_FIELDS.map((field, rowIdx) => (
                <tr key={field.key} className={`border-b border-border ${field.bgAlt ? "bg-muted/10" : ""}`}>
                  <td className={`sticky left-0 z-10 border-r border-border px-2 py-1 text-[11px] font-semibold whitespace-nowrap ${field.bgAlt ? "bg-muted/20" : "bg-card"}`}>
                    {field.label}
                  </td>
                  {prodRows.map((row, colIdx) => {
                    const disabled = row.saved || row.skip
                    const cellCls = `h-7 w-full text-[10px] text-center border-0 outline-none bg-transparent focus:ring-1 focus:ring-primary/50 ${disabled ? "opacity-40 cursor-not-allowed" : ""}`
                    return (
                      <td key={row.date} className={`px-0.5 py-0.5 ${row.isSunday ? "bg-muted/20" : ""}`}>
                        {field.type === "select" ? (
                          <select
                            disabled={disabled}
                            data-grid="prod" data-row={rowIdx} data-col={colIdx}
                            className={cellCls}
                            value={row[field.key] as string}
                            onChange={e => updateProd(row.date, field.key, e.target.value)}
                            onKeyDown={e => handleGridKeyDown(e, "prod", rowIdx, colIdx)}
                          >
                            <option value="">-</option>
                            {productTypes.map(pt => <option key={pt.id} value={pt.id}>{pt.product_code}</option>)}
                          </select>
                        ) : (
                          <input
                            type={field.type}
                            disabled={disabled}
                            data-grid="prod" data-row={rowIdx} data-col={colIdx}
                            min={field.type === "number" ? "0" : undefined}
                            step={field.step}
                            value={row[field.key] as string}
                            onChange={e => updateProd(row.date, field.key, e.target.value)}
                            onKeyDown={e => handleGridKeyDown(e, "prod", rowIdx, colIdx)}
                            placeholder={field.type === "text" ? "..." : undefined}
                            className={cellCls}
                          />
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "produccion" && (
        <p className="text-[10px] text-muted-foreground">
          Horarios pre-cargados: 05:00 - 16:00. Los domingos se saltan. Los dias en verde ya estan guardados.
        </p>
      )}

      {/* ==================== DOWNTIME GRID ==================== */}
      {/* Dias en eje X (columnas arriba), motivos en eje Y (filas) */}
      {activeTab === "paradas" && (
        <>
          <div className="overflow-auto border border-border rounded-lg max-h-[70vh] relative">
            <table className="border-collapse text-xs">
              <thead>
                <tr>
                  <th className={`${headerCls} sticky left-0 top-0 z-30 bg-muted min-w-[180px] text-left px-2`}>
                    Motivo / Dia
                  </th>
                  {allDays.map(date => {
                    const sun = isSunday(date)
                    const saved = savedDays.has(date)
                    return (
                      <th key={date} className={`${headerCls} min-w-[44px] sticky top-0 z-20 ${
                        saved ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600" :
                        sun ? "bg-muted/60 text-muted-foreground/50" : "bg-muted/50"
                      }`}>
                        <div className="leading-tight">
                          <div className="text-[9px] opacity-60">{weekdayShort(date)}</div>
                          <div>{dayNum(date)}</div>
                        </div>
                      </th>
                    )
                  })}
                  <th className={`${headerCls} min-w-[44px] sticky top-0 z-20`}>Tot</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // Build a flat reason index for Enter navigation
                  let globalRowIdx = 0
                  return Object.entries(PAVER_DOWNTIME_CATEGORIES).map(([category, reasons]) => (
                  <>
                    {/* Category header row */}
                    <tr key={`cat-${category}`}>
                      <td
                        colSpan={allDays.length + 2}
                        className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-1.5 sticky left-0 border-b border-border"
                      >
                        {category}
                      </td>
                    </tr>
                    {reasons.map(reason => {
                      const currentRowIdx = globalRowIdx++
                      // Total minutes for this reason across all days
                      const reasonTotal = allDays.reduce((sum, date) => {
                        return sum + (Number(dtData[date]?.[reason]?.minutes) || 0)
                      }, 0)

                      return (
                        <tr key={reason} className="border-b border-border/50 last:border-b-0 hover:bg-muted/20">
                          <td className="sticky left-0 z-10 bg-card border-r border-border px-2 py-0.5 text-[11px] whitespace-nowrap max-w-[180px] truncate" title={reason}>
                            {reason}
                          </td>
                          {allDays.map((date, colIdx) => {
                            const sun = isSunday(date)
                            const saved = savedDays.has(date)
                            const disabled = saved || sun
                            const cell = dtData[date]?.[reason]
                            const mins = cell?.minutes || ""
                            const hasComment = !!cell?.comments
                            const hasMinutes = Number(mins) > 0
                            const isActive = activeCell?.date === date && activeCell?.reason === reason

                            return (
                              <td
                                key={date}
                                ref={isActive ? activeCellRef : undefined}
                                className={`px-0 py-0 relative ${sun ? "bg-muted/20" : ""}`}
                              >
                                <input
                                  type="number"
                                  min="0"
                                  disabled={disabled}
                                  data-grid="dt" data-row={currentRowIdx} data-col={colIdx}
                                  value={mins}
                                  onChange={e => updateDtMinutes(date, reason, e.target.value)}
                                  onKeyDown={e => handleGridKeyDown(e, "dt", currentRowIdx, colIdx)}
                                  onBlur={() => {
                                    // Open bubble after entering minutes (if > 0 and no comment yet), but not on Enter nav
                                    if (skipBlurRef.current) return
                                    if (Number(dtData[date]?.[reason]?.minutes) > 0 && !dtData[date]?.[reason]?.comments && !disabled) {
                                      openBubble(date, reason)
                                    }
                                  }}
                                  className={`w-full h-7 text-[11px] text-center border-0 outline-none focus:ring-1 focus:ring-primary/50 ${
                                    disabled ? "opacity-40 bg-transparent cursor-not-allowed" :
                                    hasComment ? "bg-primary/10 font-semibold" :
                                    hasMinutes ? "bg-amber-50 dark:bg-amber-900/20 font-semibold" :
                                    "bg-transparent"
                                  }`}
                                />
                                {hasMinutes && !disabled && (
                                  <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); openBubble(date, reason) }}
                                    className={`absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full text-[7px] leading-none flex items-center justify-center transition-colors ${
                                      hasComment
                                        ? "bg-primary text-primary-foreground shadow-sm"
                                        : "bg-muted-foreground/20 text-muted-foreground hover:bg-primary hover:text-primary-foreground"
                                    }`}
                                    title={hasComment ? "Editar comentario" : "Agregar comentario"}
                                  >
                                    {hasComment ? "C" : "+"}
                                  </button>
                                )}

                                {/* Comment bubble */}
                                {isActive && (
                                  <div
                                    ref={bubbleRef}
                                    className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1 w-52 bg-card border border-border rounded-lg shadow-xl p-2 space-y-1.5"
                                    onClick={e => e.stopPropagation()}
                                  >
                                    <div className="text-[10px] text-muted-foreground font-medium truncate">{reason}</div>
                                    <textarea
                                      value={commentDraft}
                                      onChange={e => setCommentDraft(e.target.value)}
                                      placeholder="Comentario..."
                                      className="w-full text-xs border border-input rounded-md px-2 py-1.5 min-h-[50px] resize-none focus:outline-none focus:ring-1 focus:ring-primary bg-background"
                                      autoFocus
                                      onKeyDown={e => {
                                        if (e.key === "Enter" && !e.shiftKey) {
                                          e.preventDefault()
                                          commitComment()
                                        }
                                        if (e.key === "Escape") {
                                          setActiveCell(null)
                                        }
                                      }}
                                    />
                                    <div className="flex justify-end gap-1">
                                      <button
                                        type="button"
                                        onClick={() => setActiveCell(null)}
                                        className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5"
                                      >
                                        Esc
                                      </button>
                                      <button
                                        type="button"
                                        onClick={commitComment}
                                        className="text-[10px] bg-primary text-primary-foreground px-2 py-0.5 rounded"
                                      >
                                        OK
                                      </button>
                                    </div>
                                    {/* Arrow */}
                                    <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-card border-r border-b border-border rotate-45 -mt-1" />
                                  </div>
                                )}
                              </td>
                            )
                          })}
                          <td className="px-1 py-0.5 text-center font-bold whitespace-nowrap border-l border-border">
                            {reasonTotal > 0 ? <span className="text-amber-600 dark:text-amber-400">{reasonTotal}</span> : <span className="text-muted-foreground/30">-</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </>
                  ))
                })()}

                {/* Grand total row */}
                <tr className="border-t-2 border-border bg-muted/30">
                  <td className="sticky left-0 z-10 bg-muted/50 border-r border-border px-2 py-1.5 text-[11px] font-bold">Total del dia</td>
                  {allDays.map(date => {
                    const dayTotal = Object.values(dtData[date] || {}).reduce((sum, d) => sum + (Number(d.minutes) || 0), 0)
                    return (
                      <td key={date} className="px-0.5 py-1 text-center font-bold text-[11px]">
                        {dayTotal > 0 ? <span className="text-amber-600 dark:text-amber-400">{dayTotal}</span> : <span className="text-muted-foreground/30">-</span>}
                      </td>
                    )
                  })}
                  <td className="px-1 py-1 text-center font-bold text-[11px] border-l border-border">
                    {(() => {
                      const grand = Object.values(dtData).reduce((sum, day) =>
                        sum + Object.values(day).reduce((s, d) => s + (Number(d.minutes) || 0), 0), 0)
                      return grand > 0 ? <span className="text-amber-600 dark:text-amber-400">{grand}</span> : "-"
                    })()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="text-[10px] text-muted-foreground">
            Ingresa minutos por celda. Al cargar minutos, click en el circulo o focus en la celda para agregar un comentario.
            Las celdas con comentario se resaltan en azul. Fila "Total del dia" abajo, columna "Tot" a la derecha.
          </p>
        </>
      )}
    </div>
  )
}
