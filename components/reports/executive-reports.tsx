"use client"

import { useState, useRef } from "react"
import { getSupabase } from "@/lib/supabase"
import { usePlant } from "@/lib/plant-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Eye, FileDown, Loader2, Factory, CheckCircle, Wrench } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import html2canvas from "html2canvas"
import jsPDF from "jspdf"

// Paleta de colores corporativa - Gris y Rojo opaco
const COLORS = {
  primary: "#4a4a4a",      // Gris oscuro principal
  secondary: "#6b6b6b",    // Gris medio
  accent: "#8b3a3a",       // Rojo opaco/bordo
  accentLight: "#a05050",  // Rojo opaco claro
  light: "#f5f5f5",        // Gris muy claro
  muted: "#9a9a9a",        // Gris para texto secundario
  success: "#4a7c59",      // Verde opaco
  warning: "#b08d57",      // Amarillo/dorado opaco
  danger: "#8b3a3a",       // Rojo opaco (mismo que accent)
}

// Interfaces
interface ReportData {
  dateFrom: string
  dateTo: string
  daysWorked: number
  // Produccion
  totalUnits: number
  totalWeightTn: number
  avgDailyUnits: number
  reprocessedUnits: number
  byDiameter: Record<number, { produced: number; reprocessed: number; weightKg: number }>
  dailyProduction: { date: string; units: number }[]
  // Calidad
  qualityIndex: number
  secondIndex: number
  brokenIndex: number
  totalClassified: number
  totalFirst: number
  totalSecond: number
  totalBroken: number
  byDiameterQuality: Record<number, { first: number; second: number; broken: number }>
  topDefects: { reason: string; count: number; percentage: number }[]
  moldBreakages: { diameter: string; count: number; reasons: string[]; comments: string[] }[]
  // Desperdicio
  wasteBins: {
    bin1Cinta: { boxes: number; kg: number }
    bin2Desmolde: { boxes: number; kg: number }
    bin3Cinta: { boxes: number; kg: number }
    bin4Rotos: { boxes: number; kg: number }
    bin5Mezcladora: { boxes: number; kg: number }
  }
  totalWasteKg: number
  // Mantenimiento
  totalDowntimeMinutes: number
  availabilityIndex: number
  avgDowntimePerDay: number
  effectiveHours: number
  topDowntimes: { reason: string; minutes: number; percentage: number; topComment: string }[]
}

const PIPE_DIAMETERS = [300, 400, 500, 600, 800, 1000, 1200]

// Peso por unidad segun diametro (kg)
function getWeightPerUnit(diameter: number): number {
  const weights: Record<number, number> = {
    300: 85, 400: 120, 500: 180, 600: 250, 800: 420, 1000: 650, 1200: 950
  }
  return weights[diameter] || 100
}

export function ExecutiveReports() {
  const { toast } = useToast()
  const { selectedPlant } = usePlant()
  
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().split("T")[0]
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split("T")[0])
  
  const [loading, setLoading] = useState(false)
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [previewType, setPreviewType] = useState<"production" | "quality" | "maintenance" | null>(null)
  
  const reportRef = useRef<HTMLDivElement>(null)

  // Cargar datos para los informes
  async function loadReportData() {
    setLoading(true)
    try {
      const supabase = getSupabase()
      
      // 1. Produccion del parte diario
      const { data: productionData, error: prodError } = await supabase
        .from("pipe_production")
        .select("*, pipe_downtime(id, downtime_reason_id, custom_reason, minutes, comments, downtime_reasons:downtime_reason_id(reason)), pipe_mold_breakage(id, diameter, reasons, comments)")
        .eq("plant", selectedPlant || "mercedes")
        .gte("production_date", dateFrom)
        .lte("production_date", dateTo)
        .order("production_date", { ascending: true })

      if (prodError) {
        console.error("Error loading production:", prodError)
      }

      // 2. Control de calidad con items
      const { data: qualityData, error: qualError } = await supabase
        .from("pipe_quality_control")
        .select("*, pipe_quality_items(id, diameter, first_quality, second_quality, broken), pipe_quality_defects(id, defect_type, defect_reason_id, pipe_defect_reasons:defect_reason_id(reason))")
        .gte("control_date", dateFrom)
        .lte("control_date", dateTo)

      if (qualError) {
        console.error("Error loading quality:", qualError)
      }

      // Filtrar solo dias laborales (Lunes a Sabado)
      const weekdayProductionData = productionData?.filter(record => {
        const dayOfWeek = new Date(record.production_date + "T12:00:00").getDay()
        return dayOfWeek >= 1 && dayOfWeek <= 6
      }) || []

      // Procesar datos
      const uniqueDates = new Set(weekdayProductionData.map(r => r.production_date))
      const daysWorked = uniqueDates.size

      // Produccion por diametro
      const byDiameter: Record<number, { produced: number; reprocessed: number; weightKg: number }> = {}
      PIPE_DIAMETERS.forEach(d => {
        byDiameter[d] = { produced: 0, reprocessed: 0, weightKg: 0 }
      })

      let totalUnits = 0
      let totalWeightKg = 0
      let reprocessedUnits = 0
      let totalDowntimeMinutes = 0

      // Cajones de desperdicio
      const wasteBins = {
        bin1Cinta: { boxes: 0, kg: 0 },
        bin2Desmolde: { boxes: 0, kg: 0 },
        bin3Cinta: { boxes: 0, kg: 0 },
        bin4Rotos: { boxes: 0, kg: 0 },
        bin5Mezcladora: { boxes: 0, kg: 0 }
      }

      // Paradas por motivo
      const downtimeByReason: Record<string, { minutes: number; comments: string[] }> = {}

      // Roturas de molde
      const moldBreakageData: Record<string, { count: number; reasons: string[]; comments: string[] }> = {}

      // Produccion diaria
      const dailyProd: Record<string, number> = {}

      weekdayProductionData.forEach((record: any) => {
        // Produccion por diametro
        PIPE_DIAMETERS.forEach(d => {
          const produced = record[`cc${d}_produced`] || 0
          const reproc = record[`cc${d}_reprocessed`] || 0
          const weightPerUnit = getWeightPerUnit(d)
          
          byDiameter[d].produced += produced
          byDiameter[d].reprocessed += reproc
          byDiameter[d].weightKg += produced * weightPerUnit
          
          totalUnits += produced
          totalWeightKg += produced * weightPerUnit
          reprocessedUnits += reproc
        })

        // Produccion diaria
        const date = record.production_date
        dailyProd[date] = (dailyProd[date] || 0) + PIPE_DIAMETERS.reduce((sum, d) => sum + (record[`cc${d}_produced`] || 0), 0)

        // Cajones de desperdicio (peso neto)
        const bin1 = record.waste_bin_1_cinta || 0
        const bin2 = record.waste_bin_2_desmolde || 0
        const bin3 = record.waste_bin_3_cinta || 0
        const bin4 = record.waste_bin_4_rotos || 0
        const bin5 = record.waste_bin_5_mezcladora || 0
        
        wasteBins.bin1Cinta.boxes += bin1
        wasteBins.bin1Cinta.kg += bin1 * 576.7
        wasteBins.bin2Desmolde.boxes += bin2
        wasteBins.bin2Desmolde.kg += bin2 * 528.4
        wasteBins.bin3Cinta.boxes += bin3
        wasteBins.bin3Cinta.kg += bin3 * 601.5
        wasteBins.bin4Rotos.boxes += bin4
        wasteBins.bin4Rotos.kg += bin4 * 1074.5
        wasteBins.bin5Mezcladora.boxes += bin5
        wasteBins.bin5Mezcladora.kg += bin5 * 576.7

        // Paradas
        record.pipe_downtime?.forEach((dt: any) => {
          const reason = dt.downtime_reasons?.reason || dt.custom_reason || "Otros"
          if (!downtimeByReason[reason]) {
            downtimeByReason[reason] = { minutes: 0, comments: [] }
          }
          downtimeByReason[reason].minutes += dt.minutes || 0
          if (dt.comments) downtimeByReason[reason].comments.push(dt.comments)
          totalDowntimeMinutes += dt.minutes || 0
        })

        // Roturas de molde
        record.pipe_mold_breakage?.forEach((mb: any) => {
          const diam = mb.diameter || "Sin especificar"
          if (!moldBreakageData[diam]) {
            moldBreakageData[diam] = { count: 0, reasons: [], comments: [] }
          }
          moldBreakageData[diam].count += 1
          if (mb.reasons && Array.isArray(mb.reasons)) {
            mb.reasons.forEach((r: string) => {
              if (r && !moldBreakageData[diam].reasons.includes(r)) {
                moldBreakageData[diam].reasons.push(r)
              }
            })
          }
          if (mb.comments) {
            moldBreakageData[diam].comments.push(mb.comments)
          }
        })
      })

      // Procesar calidad desde pipe_quality_items
      let totalFirst = 0, totalSecond = 0, totalBroken = 0
      const byDiameterQuality: Record<number, { first: number; second: number; broken: number }> = {}
      PIPE_DIAMETERS.forEach(d => {
        byDiameterQuality[d] = { first: 0, second: 0, broken: 0 }
      })
      const defectCounts: Record<string, number> = {}

      qualityData?.forEach((qc: any) => {
        // Procesar items de calidad (cada item tiene diameter, first_quality, second_quality, broken)
        qc.pipe_quality_items?.forEach((item: any) => {
          const diameter = item.diameter
          const first = item.first_quality || 0
          const second = item.second_quality || 0
          const broken = item.broken || 0
          
          totalFirst += first
          totalSecond += second
          totalBroken += broken
          
          if (byDiameterQuality[diameter]) {
            byDiameterQuality[diameter].first += first
            byDiameterQuality[diameter].second += second
            byDiameterQuality[diameter].broken += broken
          }
        })

        // Procesar defectos
        qc.pipe_quality_defects?.forEach((def: any) => {
          const reason = def.pipe_defect_reasons?.reason || def.defect_type || "Otros"
          defectCounts[reason] = (defectCounts[reason] || 0) + 1
        })
      })

      const totalClassified = totalFirst + totalSecond + totalBroken
      const qualityIndex = totalClassified > 0 ? (totalFirst / totalClassified) * 100 : 0
      const secondIndex = totalClassified > 0 ? (totalSecond / totalClassified) * 100 : 0
      const brokenIndex = totalClassified > 0 ? (totalBroken / totalClassified) * 100 : 0

      // Top defectos
      const totalDefects = Object.values(defectCounts).reduce((a, b) => a + b, 0)
      const topDefects = Object.entries(defectCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([reason, count]) => ({
          reason,
          count,
          percentage: totalDefects > 0 ? (count / totalDefects) * 100 : 0
        }))

      // Top paradas
      const topDowntimes = Object.entries(downtimeByReason)
        .sort((a, b) => b[1].minutes - a[1].minutes)
        .slice(0, 5)
        .map(([reason, data]) => ({
          reason,
          minutes: data.minutes,
          percentage: totalDowntimeMinutes > 0 ? (data.minutes / totalDowntimeMinutes) * 100 : 0,
          topComment: data.comments[0] || ""
        }))

      // Roturas de molde
      const moldBreakages = Object.entries(moldBreakageData)
        .sort((a, b) => b[1].count - a[1].count)
        .map(([diameter, data]) => ({
          diameter,
          count: data.count,
          reasons: data.reasons,
          comments: data.comments
        }))

      // Produccion diaria
      const dailyProduction = Object.entries(dailyProd)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, units]) => ({ date, units }))

      // Calculos de mantenimiento
      const availableMinutes = daysWorked * 8 * 60 // 8 horas por dia
      const effectiveMinutes = availableMinutes - totalDowntimeMinutes
      const availabilityIndex = availableMinutes > 0 ? (effectiveMinutes / availableMinutes) * 100 : 0

      const totalWasteKg = wasteBins.bin1Cinta.kg + wasteBins.bin2Desmolde.kg + 
                          wasteBins.bin3Cinta.kg + wasteBins.bin4Rotos.kg + wasteBins.bin5Mezcladora.kg

      setReportData({
        dateFrom,
        dateTo,
        daysWorked,
        totalUnits,
        totalWeightTn: totalWeightKg / 1000,
        avgDailyUnits: daysWorked > 0 ? Math.round(totalUnits / daysWorked) : 0,
        reprocessedUnits,
        byDiameter,
        dailyProduction,
        qualityIndex,
        secondIndex,
        brokenIndex,
        totalClassified,
        totalFirst,
        totalSecond,
        totalBroken,
        byDiameterQuality,
        topDefects,
        moldBreakages,
        wasteBins,
        totalWasteKg,
        totalDowntimeMinutes,
        availabilityIndex,
        avgDowntimePerDay: daysWorked > 0 ? Math.round(totalDowntimeMinutes / daysWorked) : 0,
        effectiveHours: effectiveMinutes / 60,
        topDowntimes
      })

      return true
    } catch (error) {
      console.log("[v0] Error loading report data:", error)
      toast({ title: "Error", description: "No se pudieron cargar los datos", variant: "destructive" })
      return false
    } finally {
      setLoading(false)
    }
  }

  // Abrir preview
  async function openPreview(type: "production" | "quality" | "maintenance") {
    const success = await loadReportData()
    if (success) {
      setPreviewType(type)
    }
  }

  // Descargar PDF
  async function downloadPDF() {
    if (!reportRef.current) return
    
    try {
      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff"
      })
      
      const imgData = canvas.toDataURL("image/png")
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4"
      })
      
      const imgWidth = 210
      const imgHeight = (canvas.height * imgWidth) / canvas.width
      
      pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight)
      
      const fileName = `informe-${previewType}-${dateFrom}-${dateTo}.pdf`
      pdf.save(fileName)
      
      toast({ title: "PDF descargado", description: fileName })
    } catch (error) {
      toast({ title: "Error", description: "No se pudo generar el PDF", variant: "destructive" })
    }
  }

  // Formatear fecha
  function formatDate(dateStr: string) {
    return new Date(dateStr + "T12:00:00").toLocaleDateString("es-AR", {
      day: "2-digit", month: "short", year: "numeric"
    })
  }

  function formatDateShort(dateStr: string) {
    return new Date(dateStr + "T12:00:00").toLocaleDateString("es-AR", {
      day: "2-digit", month: "2-digit"
    })
  }

  return (
    <div className="space-y-6">
      {/* Selector de fechas */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Informes Ejecutivos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Desde</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="h-9 w-40"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Hasta</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="h-9 w-40"
              />
            </div>
            
            {/* Botones de informes */}
            <div className="flex gap-2 ml-auto">
              <Button
                variant="outline"
                onClick={() => openPreview("production")}
                disabled={loading}
                className="gap-2"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Factory className="h-4 w-4" />}
                <Eye className="h-3 w-3" />
                Produccion
              </Button>
              
              <Button
                variant="outline"
                onClick={() => openPreview("quality")}
                disabled={loading}
                className="gap-2"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                <Eye className="h-3 w-3" />
                Calidad
              </Button>
              
              <Button
                variant="outline"
                onClick={() => openPreview("maintenance")}
                disabled={loading}
                className="gap-2"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
                <Eye className="h-3 w-3" />
                Mantenimiento
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dialog de preview */}
      <Dialog open={previewType !== null} onOpenChange={() => setPreviewType(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>
                {previewType === "production" && "Informe de Produccion"}
                {previewType === "quality" && "Informe de Calidad"}
                {previewType === "maintenance" && "Informe de Mantenimiento"}
              </span>
              <Button onClick={downloadPDF} size="sm" className="gap-2">
                <FileDown className="h-4 w-4" />
                Descargar PDF
              </Button>
            </DialogTitle>
          </DialogHeader>
          
          {/* Contenido del informe */}
          <div ref={reportRef} className="bg-white p-6">
            {reportData && previewType === "production" && (
              <ProductionReport data={reportData} formatDate={formatDate} formatDateShort={formatDateShort} />
            )}
            {reportData && previewType === "quality" && (
              <QualityReport data={reportData} formatDate={formatDate} />
            )}
            {reportData && previewType === "maintenance" && (
              <MaintenanceReport data={reportData} formatDate={formatDate} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// =============================================
// INFORME DE PRODUCCION
// =============================================
function ProductionReport({ data, formatDate, formatDateShort }: { 
  data: ReportData; 
  formatDate: (d: string) => string;
  formatDateShort: (d: string) => string;
}) {
  const activeDiameters = PIPE_DIAMETERS.filter(d => data.byDiameter[d]?.produced > 0)
  
  return (
    <div className="space-y-4 text-sm" style={{ fontFamily: "Arial, sans-serif" }}>
      {/* Header */}
      <div style={{ backgroundColor: COLORS.primary }} className="text-white p-4 rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-wide">INFORME DE PRODUCCION</h1>
            <p style={{ color: "#b0b0b0" }} className="text-xs mt-1">Planta Mercedes - Canos de Hormigon</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold">{formatDate(data.dateFrom)} - {formatDate(data.dateTo)}</p>
            <p style={{ color: "#b0b0b0" }} className="text-xs">{data.daysWorked} dias de produccion</p>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3">
        <div className="border rounded-lg p-3 text-center" style={{ backgroundColor: COLORS.light }}>
          <p className="text-xs uppercase" style={{ color: COLORS.muted }}>Total Canos</p>
          <p className="text-2xl font-bold" style={{ color: COLORS.primary }}>{data.totalUnits.toLocaleString()}</p>
          <p className="text-xs" style={{ color: COLORS.muted }}>unidades</p>
        </div>
        <div className="border rounded-lg p-3 text-center" style={{ backgroundColor: COLORS.light }}>
          <p className="text-xs uppercase" style={{ color: COLORS.muted }}>Toneladas</p>
          <p className="text-2xl font-bold" style={{ color: COLORS.primary }}>{data.totalWeightTn.toFixed(1)}</p>
          <p className="text-xs" style={{ color: COLORS.muted }}>tn producidas</p>
        </div>
        <div className="border rounded-lg p-3 text-center" style={{ backgroundColor: COLORS.light }}>
          <p className="text-xs uppercase" style={{ color: COLORS.muted }}>Promedio Diario</p>
          <p className="text-2xl font-bold" style={{ color: COLORS.primary }}>{data.avgDailyUnits}</p>
          <p className="text-xs" style={{ color: COLORS.muted }}>canos/dia</p>
        </div>
        <div className="border rounded-lg p-3 text-center" style={{ backgroundColor: "#f5eded" }}>
          <p className="text-xs uppercase" style={{ color: COLORS.muted }}>Reprocesados</p>
          <p className="text-2xl font-bold" style={{ color: COLORS.accent }}>{data.reprocessedUnits}</p>
          <p className="text-xs" style={{ color: COLORS.muted }}>unidades</p>
        </div>
      </div>

      {/* Produccion por diametro */}
      <div className="border rounded-lg overflow-hidden">
        <div style={{ backgroundColor: COLORS.primary }} className="text-white px-3 py-2">
          <h3 className="font-semibold text-xs uppercase tracking-wide">Produccion por Diametro</h3>
        </div>
        <table className="w-full text-xs">
          <thead style={{ backgroundColor: COLORS.light }}>
            <tr>
              <th className="text-left py-2 px-3 font-medium">Concepto</th>
              {activeDiameters.map(d => (
                <th key={d} className="text-center py-2 px-2 font-medium">CC{d}</th>
              ))}
              <th className="text-center py-2 px-3 font-medium" style={{ backgroundColor: "#e8e8e8" }}>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t">
              <td className="py-2 px-3 font-medium">Producidos</td>
              {activeDiameters.map(d => (
                <td key={d} className="py-2 px-2 text-center">{data.byDiameter[d].produced}</td>
              ))}
              <td className="py-2 px-3 text-center font-bold" style={{ backgroundColor: "#e8e8e8" }}>{data.totalUnits}</td>
            </tr>
            <tr className="border-t" style={{ backgroundColor: COLORS.light }}>
              <td className="py-2 px-3 font-medium">Toneladas</td>
              {activeDiameters.map(d => (
                <td key={d} className="py-2 px-2 text-center">{(data.byDiameter[d].weightKg / 1000).toFixed(1)}</td>
              ))}
              <td className="py-2 px-3 text-center font-bold" style={{ backgroundColor: "#e8e8e8" }}>{data.totalWeightTn.toFixed(1)}</td>
            </tr>
            <tr className="border-t">
              <td className="py-2 px-3 font-medium" style={{ color: COLORS.accent }}>Reprocesados</td>
              {activeDiameters.map(d => (
                <td key={d} className="py-2 px-2 text-center" style={{ color: COLORS.accent }}>{data.byDiameter[d].reprocessed || "-"}</td>
              ))}
              <td className="py-2 px-3 text-center font-bold" style={{ backgroundColor: "#e8e8e8", color: COLORS.accent }}>{data.reprocessedUnits}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Evolucion diaria */}
      {data.dailyProduction.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div style={{ backgroundColor: COLORS.primary }} className="text-white px-3 py-2">
            <h3 className="font-semibold text-xs uppercase tracking-wide">Evolucion Diaria</h3>
          </div>
          <div className="p-3">
            <div className="flex items-end gap-1 h-24">
              {data.dailyProduction.map((day, idx) => {
                const maxUnits = Math.max(...data.dailyProduction.map(d => d.units))
                const height = maxUnits > 0 ? (day.units / maxUnits) * 100 : 0
                return (
                  <div key={idx} className="flex-1 flex flex-col items-center">
                    <div 
                      className="w-full rounded-t"
                      style={{ 
                        height: `${height}%`, 
                        backgroundColor: COLORS.secondary,
                        minHeight: day.units > 0 ? "4px" : "0"
                      }}
                    />
                    <span className="text-[8px] mt-1" style={{ color: COLORS.muted }}>{formatDateShort(day.date)}</span>
                    <span className="text-[9px] font-medium">{day.units}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="text-center pt-2 border-t">
        <p className="text-[10px]" style={{ color: COLORS.muted }}>
          Generado el {new Date().toLocaleDateString("es-AR")} - Sistema de Control de Produccion
        </p>
      </div>
    </div>
  )
}

// =============================================
// INFORME DE CALIDAD
// =============================================
function QualityReport({ data, formatDate }: { data: ReportData; formatDate: (d: string) => string }) {
  const activeDiameters = PIPE_DIAMETERS.filter(d => {
    const q = data.byDiameterQuality[d]
    return q && (q.first + q.second + q.broken) > 0
  })

  const totalWasteBins = data.wasteBins.bin1Cinta.boxes + data.wasteBins.bin2Desmolde.boxes +
                         data.wasteBins.bin3Cinta.boxes + data.wasteBins.bin4Rotos.boxes +
                         data.wasteBins.bin5Mezcladora.boxes
  
  return (
    <div className="space-y-4 text-sm" style={{ fontFamily: "Arial, sans-serif" }}>
      {/* Header */}
      <div style={{ backgroundColor: COLORS.accent }} className="text-white p-4 rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-wide">INFORME DE CALIDAD</h1>
            <p style={{ color: "#d4b0b0" }} className="text-xs mt-1">Planta Mercedes - Canos de Hormigon</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold">{formatDate(data.dateFrom)} - {formatDate(data.dateTo)}</p>
            <p style={{ color: "#d4b0b0" }} className="text-xs">{data.daysWorked} dias de produccion</p>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3">
        <div className="border rounded-lg p-3 text-center" style={{ backgroundColor: "#eef5f0" }}>
          <p className="text-xs uppercase" style={{ color: COLORS.muted }}>Indice Primera</p>
          <p className="text-2xl font-bold" style={{ color: COLORS.success }}>{data.qualityIndex.toFixed(1)}%</p>
          <p className="text-xs" style={{ color: COLORS.muted }}>{data.totalFirst} canos</p>
        </div>
        <div className="border rounded-lg p-3 text-center" style={{ backgroundColor: "#f5f3ee" }}>
          <p className="text-xs uppercase" style={{ color: COLORS.muted }}>Indice Segunda</p>
          <p className="text-2xl font-bold" style={{ color: COLORS.warning }}>{data.secondIndex.toFixed(1)}%</p>
          <p className="text-xs" style={{ color: COLORS.muted }}>{data.totalSecond} canos</p>
        </div>
        <div className="border rounded-lg p-3 text-center" style={{ backgroundColor: "#f5eded" }}>
          <p className="text-xs uppercase" style={{ color: COLORS.muted }}>Indice Rotura</p>
          <p className="text-2xl font-bold" style={{ color: COLORS.danger }}>{data.brokenIndex.toFixed(1)}%</p>
          <p className="text-xs" style={{ color: COLORS.muted }}>{data.totalBroken} canos</p>
        </div>
        <div className="border rounded-lg p-3 text-center" style={{ backgroundColor: COLORS.light }}>
          <p className="text-xs uppercase" style={{ color: COLORS.muted }}>Total Clasificado</p>
          <p className="text-2xl font-bold" style={{ color: COLORS.primary }}>{data.totalClassified}</p>
          <p className="text-xs" style={{ color: COLORS.muted }}>canos</p>
        </div>
      </div>

      {/* Calidad por diametro */}
      {activeDiameters.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div style={{ backgroundColor: COLORS.accent }} className="text-white px-3 py-2">
            <h3 className="font-semibold text-xs uppercase tracking-wide">Calidad por Diametro</h3>
          </div>
          <table className="w-full text-xs">
            <thead style={{ backgroundColor: COLORS.light }}>
              <tr>
                <th className="text-left py-2 px-3 font-medium">Diametro</th>
                <th className="text-center py-2 px-2 font-medium" style={{ color: COLORS.success }}>1ra</th>
                <th className="text-center py-2 px-2 font-medium" style={{ color: COLORS.warning }}>2da</th>
                <th className="text-center py-2 px-2 font-medium" style={{ color: COLORS.danger }}>Rotos</th>
                <th className="text-center py-2 px-2 font-medium">Total</th>
                <th className="text-center py-2 px-2 font-medium" style={{ color: COLORS.success }}>% 1ra</th>
              </tr>
            </thead>
            <tbody>
              {activeDiameters.map((d, idx) => {
                const q = data.byDiameterQuality[d]
                const total = q.first + q.second + q.broken
                const pct = total > 0 ? (q.first / total) * 100 : 0
                return (
                  <tr key={d} className="border-t" style={{ backgroundColor: idx % 2 === 1 ? COLORS.light : "white" }}>
                    <td className="py-2 px-3 font-medium">CC{d}</td>
                    <td className="py-2 px-2 text-center" style={{ color: COLORS.success }}>{q.first}</td>
                    <td className="py-2 px-2 text-center" style={{ color: COLORS.warning }}>{q.second}</td>
                    <td className="py-2 px-2 text-center" style={{ color: COLORS.danger }}>{q.broken}</td>
                    <td className="py-2 px-2 text-center font-medium">{total}</td>
                    <td className="py-2 px-2 text-center font-bold" style={{ color: pct >= 95 ? COLORS.success : pct >= 90 ? COLORS.warning : COLORS.danger }}>
                      {pct.toFixed(1)}%
                    </td>
                  </tr>
                )
              })}
              <tr className="border-t-2 font-semibold" style={{ backgroundColor: "#e8e8e8" }}>
                <td className="py-2 px-3">TOTAL</td>
                <td className="py-2 px-2 text-center" style={{ color: COLORS.success }}>{data.totalFirst}</td>
                <td className="py-2 px-2 text-center" style={{ color: COLORS.warning }}>{data.totalSecond}</td>
                <td className="py-2 px-2 text-center" style={{ color: COLORS.danger }}>{data.totalBroken}</td>
                <td className="py-2 px-2 text-center">{data.totalClassified}</td>
                <td className="py-2 px-2 text-center" style={{ color: COLORS.success }}>{data.qualityIndex.toFixed(1)}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Dos columnas: Defectos y Cajones */}
      <div className="grid grid-cols-2 gap-3">
        {/* Top Defectos */}
        {data.topDefects.length > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <div style={{ backgroundColor: COLORS.secondary }} className="text-white px-3 py-2">
              <h3 className="font-semibold text-xs uppercase tracking-wide">Top 5 Defectos</h3>
            </div>
            <table className="w-full text-xs">
              <thead style={{ backgroundColor: COLORS.light }}>
                <tr>
                  <th className="text-left py-1.5 px-2 font-medium">Motivo</th>
                  <th className="text-center py-1.5 px-2 font-medium">Cant.</th>
                  <th className="text-center py-1.5 px-2 font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {data.topDefects.map((def, idx) => (
                  <tr key={idx} className="border-t" style={{ backgroundColor: idx % 2 === 1 ? COLORS.light : "white" }}>
                    <td className="py-1.5 px-2 truncate max-w-[120px]">{def.reason}</td>
                    <td className="py-1.5 px-2 text-center font-medium">{def.count}</td>
                    <td className="py-1.5 px-2 text-center">{def.percentage.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Cajones de Desperdicio - con porcentajes */}
        <div className="border rounded-lg overflow-hidden">
          <div style={{ backgroundColor: COLORS.accent }} className="text-white px-3 py-2">
            <h3 className="font-semibold text-xs uppercase tracking-wide">Cajones de Desperdicio</h3>
          </div>
          <table className="w-full text-xs">
            <thead style={{ backgroundColor: COLORS.light }}>
              <tr>
                <th className="text-left py-1.5 px-2 font-medium">Tipo</th>
                <th className="text-center py-1.5 px-2 font-medium">Kg</th>
                <th className="text-center py-1.5 px-2 font-medium">%</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: "C1 - Cinta", kg: data.wasteBins.bin1Cinta.kg },
                { name: "C2 - Desmolde", kg: data.wasteBins.bin2Desmolde.kg },
                { name: "C3 - Cinta", kg: data.wasteBins.bin3Cinta.kg },
                { name: "C4 - Rotos", kg: data.wasteBins.bin4Rotos.kg },
                { name: "C5 - Mezcladora", kg: data.wasteBins.bin5Mezcladora.kg }
              ].map((bin, idx) => {
                const pct = data.totalWasteKg > 0 ? (bin.kg / data.totalWasteKg) * 100 : 0
                return (
                  <tr key={idx} className="border-t" style={{ backgroundColor: idx % 2 === 1 ? COLORS.light : "white" }}>
                    <td className="py-1.5 px-2">{bin.name}</td>
                    <td className="py-1.5 px-2 text-center">{bin.kg > 0 ? Math.round(bin.kg) : "-"}</td>
                    <td className="py-1.5 px-2 text-center font-medium" style={{ color: pct > 30 ? COLORS.danger : COLORS.primary }}>
                      {bin.kg > 0 ? `${pct.toFixed(1)}%` : "-"}
                    </td>
                  </tr>
                )
              })}
              <tr className="border-t-2 font-semibold" style={{ backgroundColor: "#e8e8e8" }}>
                <td className="py-1.5 px-2">TOTAL</td>
                <td className="py-1.5 px-2 text-center" style={{ color: COLORS.accent }}>{data.totalWasteKg > 0 ? `${(data.totalWasteKg / 1000).toFixed(2)} tn` : "-"}</td>
                <td className="py-1.5 px-2 text-center" style={{ color: COLORS.accent }}>100%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Roturas por tipo de molde */}
      {data.moldBreakages.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div style={{ backgroundColor: COLORS.danger }} className="text-white px-3 py-2">
            <h3 className="font-semibold text-xs uppercase tracking-wide">Roturas por Tipo de Molde</h3>
          </div>
          <table className="w-full text-xs">
            <thead style={{ backgroundColor: COLORS.light }}>
              <tr>
                <th className="text-left py-1.5 px-2 font-medium">Diametro</th>
                <th className="text-center py-1.5 px-2 font-medium">Cant.</th>
                <th className="text-left py-1.5 px-2 font-medium">Motivos</th>
                <th className="text-left py-1.5 px-2 font-medium">Comentarios</th>
              </tr>
            </thead>
            <tbody>
              {data.moldBreakages.slice(0, 5).map((mb, idx) => (
                <tr key={idx} className="border-t" style={{ backgroundColor: idx % 2 === 1 ? COLORS.light : "white" }}>
                  <td className="py-1.5 px-2 font-medium">{mb.diameter}</td>
                  <td className="py-1.5 px-2 text-center font-bold" style={{ color: COLORS.danger }}>{mb.count}</td>
                  <td className="py-1.5 px-2 text-xs truncate max-w-[100px]">{mb.reasons.join(", ") || "-"}</td>
                  <td className="py-1.5 px-2 text-xs truncate max-w-[150px]" style={{ color: COLORS.muted }}>
                    {mb.comments.slice(0, 2).join("; ") || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer */}
      <div className="text-center pt-2 border-t">
        <p className="text-[10px]" style={{ color: COLORS.muted }}>
          Generado el {new Date().toLocaleDateString("es-AR")} - Sistema de Control de Produccion
        </p>
      </div>
    </div>
  )
}

// =============================================
// INFORME DE MANTENIMIENTO
// =============================================
function MaintenanceReport({ data, formatDate }: { data: ReportData; formatDate: (d: string) => string }) {
  return (
    <div className="space-y-4 text-sm" style={{ fontFamily: "Arial, sans-serif" }}>
      {/* Header */}
      <div style={{ backgroundColor: COLORS.secondary }} className="text-white p-4 rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-wide">INFORME DE MANTENIMIENTO</h1>
            <p style={{ color: "#c0c0c0" }} className="text-xs mt-1">Planta Mercedes - Canos de Hormigon</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold">{formatDate(data.dateFrom)} - {formatDate(data.dateTo)}</p>
            <p style={{ color: "#c0c0c0" }} className="text-xs">{data.daysWorked} dias de produccion</p>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3">
        <div className="border rounded-lg p-3 text-center" style={{ backgroundColor: "#f5eded" }}>
          <p className="text-xs uppercase" style={{ color: COLORS.muted }}>Tiempo Parada</p>
          <p className="text-2xl font-bold" style={{ color: COLORS.danger }}>{data.totalDowntimeMinutes}</p>
          <p className="text-xs" style={{ color: COLORS.muted }}>minutos</p>
        </div>
        <div className="border rounded-lg p-3 text-center" style={{ backgroundColor: "#eef5f0" }}>
          <p className="text-xs uppercase" style={{ color: COLORS.muted }}>Disponibilidad</p>
          <p className="text-2xl font-bold" style={{ color: data.availabilityIndex >= 85 ? COLORS.success : COLORS.danger }}>
            {data.availabilityIndex.toFixed(1)}%
          </p>
          <p className="text-xs" style={{ color: COLORS.muted }}>del tiempo</p>
        </div>
        <div className="border rounded-lg p-3 text-center" style={{ backgroundColor: COLORS.light }}>
          <p className="text-xs uppercase" style={{ color: COLORS.muted }}>Promedio/Dia</p>
          <p className="text-2xl font-bold" style={{ color: COLORS.primary }}>{data.avgDowntimePerDay}</p>
          <p className="text-xs" style={{ color: COLORS.muted }}>min/dia</p>
        </div>
        <div className="border rounded-lg p-3 text-center" style={{ backgroundColor: COLORS.light }}>
          <p className="text-xs uppercase" style={{ color: COLORS.muted }}>Horas Efectivas</p>
          <p className="text-2xl font-bold" style={{ color: COLORS.primary }}>{data.effectiveHours.toFixed(1)}</p>
          <p className="text-xs" style={{ color: COLORS.muted }}>horas</p>
        </div>
      </div>

      {/* Barra de disponibilidad */}
      <div className="border rounded-lg p-3">
        <div className="flex justify-between text-xs mb-2">
          <span style={{ color: COLORS.muted }}>Distribucion del Tiempo</span>
          <span className="font-medium">{data.daysWorked * 8} horas disponibles</span>
        </div>
        <div className="h-6 rounded-full overflow-hidden flex" style={{ backgroundColor: COLORS.light }}>
          <div 
            className="h-full flex items-center justify-center text-white text-xs font-medium"
            style={{ 
              width: `${data.availabilityIndex}%`, 
              backgroundColor: COLORS.success 
            }}
          >
            {data.availabilityIndex.toFixed(0)}% Efectivo
          </div>
          <div 
            className="h-full flex items-center justify-center text-white text-xs font-medium"
            style={{ 
              width: `${100 - data.availabilityIndex}%`, 
              backgroundColor: COLORS.danger 
            }}
          >
            {(100 - data.availabilityIndex).toFixed(0)}% Parada
          </div>
        </div>
      </div>

      {/* Top Paradas */}
      {data.topDowntimes.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div style={{ backgroundColor: COLORS.danger }} className="text-white px-3 py-2">
            <h3 className="font-semibold text-xs uppercase tracking-wide">Top 5 Motivos de Parada</h3>
          </div>
          <table className="w-full text-xs">
            <thead style={{ backgroundColor: COLORS.light }}>
              <tr>
                <th className="text-left py-2 px-3 font-medium">Motivo</th>
                <th className="text-center py-2 px-2 font-medium">Min</th>
                <th className="text-center py-2 px-2 font-medium">%</th>
                <th className="text-left py-2 px-2 font-medium">Comentario</th>
              </tr>
            </thead>
            <tbody>
              {data.topDowntimes.map((dt, idx) => (
                <tr key={idx} className="border-t" style={{ backgroundColor: idx % 2 === 1 ? COLORS.light : "white" }}>
                  <td className="py-2 px-3">{dt.reason}</td>
                  <td className="py-2 px-2 text-center font-bold" style={{ color: COLORS.danger }}>{dt.minutes}</td>
                  <td className="py-2 px-2 text-center">{dt.percentage.toFixed(1)}%</td>
                  <td className="py-2 px-2 truncate max-w-[200px]" style={{ color: COLORS.muted }}>
                    {dt.topComment || "-"}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 font-semibold" style={{ backgroundColor: "#e8e8e8" }}>
                <td className="py-2 px-3">TOTAL</td>
                <td className="py-2 px-2 text-center" style={{ color: COLORS.danger }}>{data.totalDowntimeMinutes}</td>
                <td className="py-2 px-2 text-center">100%</td>
                <td className="py-2 px-2" style={{ color: COLORS.muted }}>({(data.totalDowntimeMinutes / 60).toFixed(1)} horas)</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Roturas de molde */}
      {data.moldBreakages.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div style={{ backgroundColor: COLORS.secondary }} className="text-white px-3 py-2">
            <h3 className="font-semibold text-xs uppercase tracking-wide">Roturas de Molde por Diametro</h3>
          </div>
          <table className="w-full text-xs">
            <thead style={{ backgroundColor: COLORS.light }}>
              <tr>
                <th className="text-left py-2 px-3 font-medium">Diametro</th>
                <th className="text-center py-2 px-2 font-medium">Cantidad</th>
                <th className="text-left py-2 px-2 font-medium">Motivos</th>
                <th className="text-left py-2 px-2 font-medium">Comentarios</th>
              </tr>
            </thead>
            <tbody>
              {data.moldBreakages.map((mb, idx) => (
                <tr key={idx} className="border-t" style={{ backgroundColor: idx % 2 === 1 ? COLORS.light : "white" }}>
                  <td className="py-2 px-3 font-medium">{mb.diameter}</td>
                  <td className="py-2 px-2 text-center font-bold" style={{ color: COLORS.danger }}>{mb.count}</td>
                  <td className="py-2 px-2 truncate max-w-[120px]">{mb.reasons.join(", ") || "-"}</td>
                  <td className="py-2 px-2 truncate max-w-[180px]" style={{ color: COLORS.muted }}>
                    {mb.comments.slice(0, 2).join("; ") || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer */}
      <div className="text-center pt-2 border-t">
        <p className="text-[10px]" style={{ color: COLORS.muted }}>
          Generado el {new Date().toLocaleDateString("es-AR")} - Sistema de Control de Produccion
        </p>
      </div>
    </div>
  )
}
