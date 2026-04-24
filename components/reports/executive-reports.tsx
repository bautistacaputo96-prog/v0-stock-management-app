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

// Interfaces
interface ReportData {
  dateFrom: string
  dateTo: string
  daysWorked: number
  // Producción
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
      
      // 1. Producción del parte diario
      const { data: productionData } = await supabase
        .from("pipe_production")
        .select("*, pipe_downtime(id, downtime_reason_id, custom_reason, minutes, comments, downtime_reasons:downtime_reason_id(reason)), pipe_mold_breakage(id, diameter, reasons, comments)")
        .eq("plant", selectedPlant || "mercedes")
        .gte("production_date", dateFrom)
        .lte("production_date", dateTo)
        .order("production_date", { ascending: true })

      // 2. Control de calidad
      const { data: qualityData } = await supabase
        .from("pipe_quality_control")
        .select("*, pipe_quality_defects(id, is_second, defect_reason)")
        .eq("plant", selectedPlant || "mercedes")
        .gte("control_date", dateFrom)
        .lte("control_date", dateTo)

      // Filtrar solo días laborales (Lunes a Sábado)
      const weekdayProductionData = productionData?.filter(record => {
        const dayOfWeek = new Date(record.production_date + "T12:00:00").getDay()
        return dayOfWeek >= 1 && dayOfWeek <= 6
      }) || []

      // Procesar datos
      const uniqueDates = new Set(weekdayProductionData.map(r => r.production_date))
      const daysWorked = uniqueDates.size

      // Producción por diámetro
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

      // Producción diaria
      const dailyProd: Record<string, number> = {}

      weekdayProductionData.forEach((record: any) => {
        // Producción por diámetro
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

        // Producción diaria
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

      // Procesar calidad
      let totalFirst = 0, totalSecond = 0, totalBroken = 0
      const byDiameterQuality: Record<number, { first: number; second: number; broken: number }> = {}
      PIPE_DIAMETERS.forEach(d => {
        byDiameterQuality[d] = { first: 0, second: 0, broken: 0 }
      })
      const defectCounts: Record<string, number> = {}

      qualityData?.forEach((qc: any) => {
        PIPE_DIAMETERS.forEach(d => {
          const first = qc[`cc${d}_first`] || 0
          const second = qc[`cc${d}_second`] || 0
          const broken = qc[`cc${d}_broken`] || 0
          
          totalFirst += first
          totalSecond += second
          totalBroken += broken
          
          byDiameterQuality[d].first += first
          byDiameterQuality[d].second += second
          byDiameterQuality[d].broken += broken
        })

        qc.pipe_quality_defects?.forEach((def: any) => {
          const reason = def.defect_reason || "Otros"
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

      // Producción diaria
      const dailyProduction = Object.entries(dailyProd)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, units]) => ({ date, units }))

      // Cálculos de mantenimiento
      const availableMinutes = daysWorked * 8 * 60 // 8 horas por día
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
      console.error("Error loading report data:", error)
      toast({ title: "Error", description: "No se pudieron cargar los datos", variant: "destructive" })
      return false
    } finally {
      setLoading(false)
    }
  }

  // Peso por unidad según diámetro
  function getWeightPerUnit(diameter: number): number {
    const weights: Record<number, number> = {
      300: 80, 400: 140, 500: 220, 600: 320, 800: 560, 1000: 880, 1200: 1260
    }
    return weights[diameter] || 100
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
// INFORME DE PRODUCCIÓN
// =============================================
function ProductionReport({ data, formatDate, formatDateShort }: { 
  data: ReportData; 
  formatDate: (d: string) => string;
  formatDateShort: (d: string) => string;
}) {
  const activeDiameters = PIPE_DIAMETERS.filter(d => data.byDiameter[d]?.produced > 0)
  
  return (
    <div className="space-y-4 text-sm">
      {/* Header */}
      <div className="bg-[#1e3a5f] text-white p-4 rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">INFORME DE PRODUCCION</h1>
            <p className="text-blue-200 text-xs mt-1">Planta Mercedes - Canos de Hormigon</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold">{formatDate(data.dateFrom)} - {formatDate(data.dateTo)}</p>
            <p className="text-blue-200 text-xs">{data.daysWorked} dias de produccion</p>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3">
        <div className="border rounded-lg p-3 text-center bg-blue-50">
          <p className="text-xs text-muted-foreground uppercase">Total Canos</p>
          <p className="text-2xl font-bold text-[#1e3a5f]">{data.totalUnits.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">unidades</p>
        </div>
        <div className="border rounded-lg p-3 text-center bg-blue-50">
          <p className="text-xs text-muted-foreground uppercase">Toneladas</p>
          <p className="text-2xl font-bold text-[#1e3a5f]">{data.totalWeightTn.toFixed(1)}</p>
          <p className="text-xs text-muted-foreground">tn producidas</p>
        </div>
        <div className="border rounded-lg p-3 text-center bg-blue-50">
          <p className="text-xs text-muted-foreground uppercase">Promedio Diario</p>
          <p className="text-2xl font-bold text-[#1e3a5f]">{data.avgDailyUnits}</p>
          <p className="text-xs text-muted-foreground">canos/dia</p>
        </div>
        <div className="border rounded-lg p-3 text-center bg-amber-50">
          <p className="text-xs text-muted-foreground uppercase">Reprocesados</p>
          <p className="text-2xl font-bold text-amber-600">{data.reprocessedUnits}</p>
          <p className="text-xs text-muted-foreground">unidades</p>
        </div>
      </div>

      {/* Producción por diámetro */}
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-[#1e3a5f] text-white px-3 py-2">
          <h3 className="font-semibold text-xs uppercase">Produccion por Diametro</h3>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left py-2 px-3 font-medium">Diametro</th>
              {activeDiameters.map(d => (
                <th key={d} className="text-center py-2 px-2 font-medium">CC{d}</th>
              ))}
              <th className="text-center py-2 px-3 font-medium bg-blue-50">TOTAL</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t">
              <td className="py-2 px-3 font-medium">Unidades</td>
              {activeDiameters.map(d => (
                <td key={d} className="text-center py-2 px-2">{data.byDiameter[d].produced}</td>
              ))}
              <td className="text-center py-2 px-3 font-bold bg-blue-50">{data.totalUnits}</td>
            </tr>
            <tr className="border-t bg-gray-50">
              <td className="py-2 px-3 font-medium">Toneladas</td>
              {activeDiameters.map(d => (
                <td key={d} className="text-center py-2 px-2">{(data.byDiameter[d].weightKg / 1000).toFixed(1)}</td>
              ))}
              <td className="text-center py-2 px-3 font-bold bg-blue-50">{data.totalWeightTn.toFixed(1)}</td>
            </tr>
            <tr className="border-t">
              <td className="py-2 px-3 font-medium text-amber-600">Reprocesados</td>
              {activeDiameters.map(d => (
                <td key={d} className="text-center py-2 px-2 text-amber-600">{data.byDiameter[d].reprocessed || "-"}</td>
              ))}
              <td className="text-center py-2 px-3 font-bold text-amber-600 bg-amber-50">{data.reprocessedUnits}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Evolución diaria */}
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-[#1e3a5f] text-white px-3 py-2">
          <h3 className="font-semibold text-xs uppercase">Evolucion Diaria</h3>
        </div>
        <div className="p-3">
          <div className="flex items-end justify-between h-32 gap-1">
            {data.dailyProduction.map((day, idx) => {
              const maxUnits = Math.max(...data.dailyProduction.map(d => d.units))
              const height = maxUnits > 0 ? (day.units / maxUnits) * 100 : 0
              return (
                <div key={idx} className="flex-1 flex flex-col items-center">
                  <span className="text-[10px] text-muted-foreground mb-1">{day.units}</span>
                  <div 
                    className="w-full bg-[#1e3a5f] rounded-t"
                    style={{ height: `${height}%`, minHeight: day.units > 0 ? "4px" : "0" }}
                  />
                  <span className="text-[9px] text-muted-foreground mt-1">{formatDateShort(day.date)}</span>
                </div>
              )
            })}
          </div>
          <div className="flex justify-center mt-2">
            <div className="text-xs text-muted-foreground">
              Promedio: <span className="font-semibold text-[#1e3a5f]">{data.avgDailyUnits} canos/dia</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-[10px] text-muted-foreground pt-2 border-t">
        Generado el {new Date().toLocaleDateString("es-AR")} a las {new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
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

  return (
    <div className="space-y-4 text-sm">
      {/* Header */}
      <div className="bg-emerald-700 text-white p-4 rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">INFORME DE CALIDAD</h1>
            <p className="text-emerald-200 text-xs mt-1">Planta Mercedes - Control de Calidad</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold">{formatDate(data.dateFrom)} - {formatDate(data.dateTo)}</p>
            <p className="text-emerald-200 text-xs">{data.daysWorked} dias de produccion</p>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3">
        <div className="border rounded-lg p-3 text-center bg-green-50">
          <p className="text-xs text-muted-foreground uppercase">Indice Primera</p>
          <p className="text-2xl font-bold text-green-600">{data.qualityIndex.toFixed(1)}%</p>
          <p className="text-xs text-muted-foreground">{data.totalFirst} unidades</p>
        </div>
        <div className="border rounded-lg p-3 text-center bg-amber-50">
          <p className="text-xs text-muted-foreground uppercase">Indice Segunda</p>
          <p className="text-2xl font-bold text-amber-600">{data.secondIndex.toFixed(1)}%</p>
          <p className="text-xs text-muted-foreground">{data.totalSecond} unidades</p>
        </div>
        <div className="border rounded-lg p-3 text-center bg-red-50">
          <p className="text-xs text-muted-foreground uppercase">Indice Rotura</p>
          <p className="text-2xl font-bold text-red-600">{data.brokenIndex.toFixed(1)}%</p>
          <p className="text-xs text-muted-foreground">{data.totalBroken} unidades</p>
        </div>
        <div className="border rounded-lg p-3 text-center bg-gray-50">
          <p className="text-xs text-muted-foreground uppercase">Total Clasificado</p>
          <p className="text-2xl font-bold text-gray-700">{data.totalClassified}</p>
          <p className="text-xs text-muted-foreground">unidades</p>
        </div>
      </div>

      {/* Calidad por diámetro */}
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-emerald-700 text-white px-3 py-2">
          <h3 className="font-semibold text-xs uppercase">Calidad por Diametro</h3>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left py-2 px-3 font-medium">Diametro</th>
              <th className="text-center py-2 px-2 font-medium text-green-600">1ra</th>
              <th className="text-center py-2 px-2 font-medium text-amber-600">2da</th>
              <th className="text-center py-2 px-2 font-medium text-red-600">Rotos</th>
              <th className="text-center py-2 px-2 font-medium">Total</th>
              <th className="text-center py-2 px-2 font-medium text-green-600">%1ra</th>
            </tr>
          </thead>
          <tbody>
            {activeDiameters.map((d, idx) => {
              const q = data.byDiameterQuality[d]
              const total = q.first + q.second + q.broken
              const firstPct = total > 0 ? (q.first / total) * 100 : 0
              return (
                <tr key={d} className={idx % 2 === 1 ? "bg-gray-50" : ""}>
                  <td className="py-2 px-3 font-medium">CC{d}</td>
                  <td className="text-center py-2 px-2 text-green-600">{q.first}</td>
                  <td className="text-center py-2 px-2 text-amber-600">{q.second}</td>
                  <td className="text-center py-2 px-2 text-red-600">{q.broken}</td>
                  <td className="text-center py-2 px-2 font-medium">{total}</td>
                  <td className={`text-center py-2 px-2 font-bold ${firstPct >= 95 ? "text-green-600" : firstPct >= 90 ? "text-amber-600" : "text-red-600"}`}>
                    {firstPct.toFixed(1)}%
                  </td>
                </tr>
              )
            })}
            <tr className="border-t-2 bg-emerald-50 font-semibold">
              <td className="py-2 px-3">TOTAL</td>
              <td className="text-center py-2 px-2 text-green-600">{data.totalFirst}</td>
              <td className="text-center py-2 px-2 text-amber-600">{data.totalSecond}</td>
              <td className="text-center py-2 px-2 text-red-600">{data.totalBroken}</td>
              <td className="text-center py-2 px-2">{data.totalClassified}</td>
              <td className="text-center py-2 px-2 text-green-600">{data.qualityIndex.toFixed(1)}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Dos columnas: Defectos y Cajones */}
      <div className="grid grid-cols-2 gap-3">
        {/* Top defectos */}
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-amber-500 text-white px-3 py-2">
            <h3 className="font-semibold text-xs uppercase">Top 5 Defectos</h3>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-2 px-3 font-medium">Motivo</th>
                <th className="text-center py-2 px-2 font-medium">Cant</th>
                <th className="text-center py-2 px-2 font-medium">%</th>
              </tr>
            </thead>
            <tbody>
              {data.topDefects.length > 0 ? data.topDefects.map((def, idx) => (
                <tr key={idx} className={idx % 2 === 1 ? "bg-gray-50" : ""}>
                  <td className="py-1.5 px-3 truncate max-w-[120px]">{def.reason}</td>
                  <td className="text-center py-1.5 px-2 font-medium">{def.count}</td>
                  <td className="text-center py-1.5 px-2">{def.percentage.toFixed(1)}%</td>
                </tr>
              )) : (
                <tr><td colSpan={3} className="text-center py-3 text-muted-foreground">Sin defectos registrados</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Cajones de desperdicio */}
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-red-500 text-white px-3 py-2">
            <h3 className="font-semibold text-xs uppercase">Cajones de Desperdicio</h3>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-2 px-3 font-medium">Tipo</th>
                <th className="text-center py-2 px-2 font-medium">Cajones</th>
                <th className="text-center py-2 px-2 font-medium">Kg</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-1.5 px-3">C1-Cinta</td>
                <td className="text-center py-1.5 px-2">{data.wasteBins.bin1Cinta.boxes}</td>
                <td className="text-center py-1.5 px-2">{Math.round(data.wasteBins.bin1Cinta.kg)}</td>
              </tr>
              <tr className="bg-gray-50">
                <td className="py-1.5 px-3">C2-Desmolde</td>
                <td className="text-center py-1.5 px-2">{data.wasteBins.bin2Desmolde.boxes}</td>
                <td className="text-center py-1.5 px-2">{Math.round(data.wasteBins.bin2Desmolde.kg)}</td>
              </tr>
              <tr>
                <td className="py-1.5 px-3">C3-Cinta</td>
                <td className="text-center py-1.5 px-2">{data.wasteBins.bin3Cinta.boxes}</td>
                <td className="text-center py-1.5 px-2">{Math.round(data.wasteBins.bin3Cinta.kg)}</td>
              </tr>
              <tr className="bg-gray-50">
                <td className="py-1.5 px-3">C4-Rotos</td>
                <td className="text-center py-1.5 px-2">{data.wasteBins.bin4Rotos.boxes}</td>
                <td className="text-center py-1.5 px-2">{Math.round(data.wasteBins.bin4Rotos.kg)}</td>
              </tr>
              <tr>
                <td className="py-1.5 px-3">C5-Mezcla</td>
                <td className="text-center py-1.5 px-2">{data.wasteBins.bin5Mezcladora.boxes}</td>
                <td className="text-center py-1.5 px-2">{Math.round(data.wasteBins.bin5Mezcladora.kg)}</td>
              </tr>
              <tr className="border-t-2 bg-red-50 font-semibold">
                <td className="py-1.5 px-3">TOTAL</td>
                <td className="text-center py-1.5 px-2">
                  {data.wasteBins.bin1Cinta.boxes + data.wasteBins.bin2Desmolde.boxes + 
                   data.wasteBins.bin3Cinta.boxes + data.wasteBins.bin4Rotos.boxes + data.wasteBins.bin5Mezcladora.boxes}
                </td>
                <td className="text-center py-1.5 px-2">{Math.round(data.totalWasteKg)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Roturas por molde */}
      {data.moldBreakages.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-red-700 text-white px-3 py-2">
            <h3 className="font-semibold text-xs uppercase">Roturas por Tipo de Molde</h3>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-2 px-3 font-medium">Diametro</th>
                <th className="text-center py-2 px-2 font-medium">Cant</th>
                <th className="text-left py-2 px-2 font-medium">Motivos</th>
                <th className="text-left py-2 px-2 font-medium">Comentarios</th>
              </tr>
            </thead>
            <tbody>
              {data.moldBreakages.map((mb, idx) => (
                <tr key={idx} className={idx % 2 === 1 ? "bg-gray-50" : ""}>
                  <td className="py-1.5 px-3 font-medium">{mb.diameter}</td>
                  <td className="text-center py-1.5 px-2 text-red-600 font-semibold">{mb.count}</td>
                  <td className="py-1.5 px-2 text-muted-foreground truncate max-w-[150px]">
                    {mb.reasons.length > 0 ? mb.reasons.slice(0, 2).join(", ") : "-"}
                  </td>
                  <td className="py-1.5 px-2 text-muted-foreground truncate max-w-[150px]">
                    {mb.comments.length > 0 ? mb.comments[0] : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer */}
      <div className="text-center text-[10px] text-muted-foreground pt-2 border-t">
        Generado el {new Date().toLocaleDateString("es-AR")} a las {new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
      </div>
    </div>
  )
}

// =============================================
// INFORME DE MANTENIMIENTO
// =============================================
function MaintenanceReport({ data, formatDate }: { data: ReportData; formatDate: (d: string) => string }) {
  return (
    <div className="space-y-4 text-sm">
      {/* Header */}
      <div className="bg-orange-600 text-white p-4 rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">INFORME DE MANTENIMIENTO</h1>
            <p className="text-orange-200 text-xs mt-1">Planta Mercedes - Paradas y Disponibilidad</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold">{formatDate(data.dateFrom)} - {formatDate(data.dateTo)}</p>
            <p className="text-orange-200 text-xs">{data.daysWorked} dias de produccion</p>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3">
        <div className="border rounded-lg p-3 text-center bg-red-50">
          <p className="text-xs text-muted-foreground uppercase">Tiempo Parada</p>
          <p className="text-2xl font-bold text-red-600">{data.totalDowntimeMinutes}</p>
          <p className="text-xs text-muted-foreground">minutos totales</p>
        </div>
        <div className="border rounded-lg p-3 text-center bg-green-50">
          <p className="text-xs text-muted-foreground uppercase">Disponibilidad</p>
          <p className="text-2xl font-bold text-green-600">{data.availabilityIndex.toFixed(1)}%</p>
          <p className="text-xs text-muted-foreground">tiempo efectivo</p>
        </div>
        <div className="border rounded-lg p-3 text-center bg-orange-50">
          <p className="text-xs text-muted-foreground uppercase">Promedio/Dia</p>
          <p className="text-2xl font-bold text-orange-600">{data.avgDowntimePerDay}</p>
          <p className="text-xs text-muted-foreground">min parada/dia</p>
        </div>
        <div className="border rounded-lg p-3 text-center bg-blue-50">
          <p className="text-xs text-muted-foreground uppercase">Horas Efectivas</p>
          <p className="text-2xl font-bold text-blue-600">{data.effectiveHours.toFixed(1)}</p>
          <p className="text-xs text-muted-foreground">horas trabajadas</p>
        </div>
      </div>

      {/* Top paradas */}
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-orange-600 text-white px-3 py-2">
          <h3 className="font-semibold text-xs uppercase">Top 5 Paradas</h3>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left py-2 px-3 font-medium">Motivo</th>
              <th className="text-center py-2 px-2 font-medium">Min</th>
              <th className="text-center py-2 px-2 font-medium">%</th>
              <th className="text-left py-2 px-3 font-medium">Comentario frecuente</th>
            </tr>
          </thead>
          <tbody>
            {data.topDowntimes.length > 0 ? data.topDowntimes.map((dt, idx) => (
              <tr key={idx} className={idx % 2 === 1 ? "bg-gray-50" : ""}>
                <td className="py-2 px-3">{dt.reason}</td>
                <td className="text-center py-2 px-2 font-semibold text-red-600">{dt.minutes}</td>
                <td className="text-center py-2 px-2">{dt.percentage.toFixed(1)}%</td>
                <td className="py-2 px-3 text-muted-foreground truncate max-w-[200px]">{dt.topComment || "-"}</td>
              </tr>
            )) : (
              <tr><td colSpan={4} className="text-center py-4 text-muted-foreground">Sin paradas registradas</td></tr>
            )}
            {data.topDowntimes.length > 0 && (
              <tr className="border-t-2 bg-orange-50 font-semibold">
                <td className="py-2 px-3">TOTAL</td>
                <td className="text-center py-2 px-2 text-red-600">{data.totalDowntimeMinutes}</td>
                <td className="text-center py-2 px-2">100%</td>
                <td className="py-2 px-3 text-muted-foreground">({(data.totalDowntimeMinutes / 60).toFixed(1)} horas)</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Roturas de molde */}
      {data.moldBreakages.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-red-600 text-white px-3 py-2">
            <h3 className="font-semibold text-xs uppercase">Roturas de Molde por Diametro</h3>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-2 px-3 font-medium">Diametro</th>
                <th className="text-center py-2 px-2 font-medium">Cantidad</th>
                <th className="text-left py-2 px-2 font-medium">Motivos</th>
                <th className="text-left py-2 px-2 font-medium">Comentarios</th>
              </tr>
            </thead>
            <tbody>
              {data.moldBreakages.map((mb, idx) => (
                <tr key={idx} className={idx % 2 === 1 ? "bg-gray-50" : ""}>
                  <td className="py-2 px-3 font-medium">{mb.diameter}</td>
                  <td className="text-center py-2 px-2 text-red-600 font-semibold">{mb.count}</td>
                  <td className="py-2 px-2 text-muted-foreground">{mb.reasons.join(", ") || "-"}</td>
                  <td className="py-2 px-2 text-muted-foreground truncate max-w-[200px]">
                    {mb.comments.length > 0 ? mb.comments[0] : "-"}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 bg-red-50 font-semibold">
                <td className="py-2 px-3">TOTAL</td>
                <td className="text-center py-2 px-2 text-red-600">
                  {data.moldBreakages.reduce((sum, mb) => sum + mb.count, 0)}
                </td>
                <td colSpan={2}></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Resumen visual de disponibilidad */}
      <div className="border rounded-lg p-4">
        <h3 className="font-semibold text-xs uppercase mb-3 text-center">Distribucion del Tiempo</h3>
        <div className="flex items-center gap-2">
          <div 
            className="h-8 bg-green-500 rounded-l flex items-center justify-center text-white text-xs font-medium"
            style={{ width: `${data.availabilityIndex}%` }}
          >
            {data.availabilityIndex.toFixed(0)}% Efectivo
          </div>
          <div 
            className="h-8 bg-red-500 rounded-r flex items-center justify-center text-white text-xs font-medium"
            style={{ width: `${100 - data.availabilityIndex}%` }}
          >
            {(100 - data.availabilityIndex).toFixed(0)}% Parada
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-[10px] text-muted-foreground pt-2 border-t">
        Generado el {new Date().toLocaleDateString("es-AR")} a las {new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
      </div>
    </div>
  )
}
