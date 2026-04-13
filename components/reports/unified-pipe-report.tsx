"use client"

import { useState, useEffect, useRef } from "react"
import { getSupabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { 
  FileDown, Search, Eye, X, TrendingUp, TrendingDown, Minus, 
  Calendar, Loader2, AlertTriangle, CheckCircle, XCircle 
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, ReferenceLine, Cell
} from "recharts"
import { formatDateForDisplay } from "@/lib/report-utils"

const PIPE_DIAMETERS = [300, 400, 500, 600, 800, 1000, 1200]

interface PipeReportData {
  // Producción (del parte diario)
  totalUnits: number
  totalWeightTn: number
  byDiameter: Record<number, { produced: number; weightKg: number }>
  dailyProduction: { date: string; units: number; weightTn: number; scrapBoxes: number }[]
  
  // Planificación
  totalPlanned: number
  byDiameterPlanned: Record<number, number>
  
  // Cajones de desperdicio (del parte diario)
  totalScrapBoxes: number
  totalScrapTn: number
  scrapBoxWeight: number
  
  // Calidad (del control de calidad)
  qualityData: {
    totalFirst: number
    totalSecond: number
    totalBroken: number
    byDiameter: Record<number, { first: number; second: number; broken: number }>
    topDefects: { reason: string; count: number; percentage: number }[]
  } | null
  
  // Paradas
  totalDowntimeMinutes: number
  topDowntimes: { reason: string; minutes: number; percentage: number }[]
  
  // Métricas calculadas
  qualityIndex: number // % de primera
  planCompliance: number // % cumplimiento plan
  daysWorked: number
}

export function UnifiedPipeReport() {
  const [startDate, setStartDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() - 7)
    return date.toISOString().split("T")[0]
  })
  const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [reportData, setReportData] = useState<PipeReportData | null>(null)
  const [pipeWeights, setPipeWeights] = useState<Record<number, number>>({})
  
  // Previews
  const [showFullPreview, setShowFullPreview] = useState(false)
  const [showExecutivePreview, setShowExecutivePreview] = useState(false)
  
  const reportRef = useRef<HTMLDivElement>(null)
  const executiveRef = useRef<HTMLDivElement>(null)
  const { toast } = useToast()
  const supabase = getSupabase()

  async function loadReport() {
    if (startDate > endDate) {
      toast({
        title: "Error",
        description: "La fecha de inicio debe ser anterior a la fecha de fin",
        variant: "destructive",
      })
      return
    }

    setLoading(true)
    setSearched(true)

    try {
      // 1. Cargar configuración de pesos
      const { data: productConfig } = await supabase
        .from("product_config")
        .select("product_code, piece_weight_kg")
        .eq("line_type", "caños")
        .eq("is_active", true)

      const weights: Record<number, number> = {
        300: 95, 400: 150, 500: 220, 600: 310, 800: 520, 1000: 1080, 1200: 1100
      }
      let scrapBoxWeight = 150

      if (productConfig) {
        productConfig.forEach((p: any) => {
          const match = p.product_code?.match(/CC(\d+)/)
          if (match && p.piece_weight_kg) {
            weights[parseInt(match[1])] = p.piece_weight_kg
          }
          if (p.product_code === "CAJON-DESP" && p.piece_weight_kg) {
            scrapBoxWeight = p.piece_weight_kg
          }
        })
      }
      setPipeWeights(weights)

      // 2. Cargar producción del parte diario (solo días laborables)
      const { data: productionData } = await supabase
        .from("pipe_production")
        .select("*, pipe_downtime(id, custom_reason, minutes, comments, downtime_category)")
        .gte("production_date", startDate)
        .lte("production_date", endDate)
        .order("production_date", { ascending: true })

      if (!productionData || productionData.length === 0) {
        setReportData(null)
        setLoading(false)
        return
      }

      // Obtener fechas únicas con producción
      const productionDates = new Set(productionData.map((p: any) => p.production_date))
      const daysWorked = productionDates.size

      // Calcular producción por diámetro y totales
      const byDiameter: Record<number, { produced: number; weightKg: number }> = {}
      let totalUnits = 0
      let totalWeightKg = 0
      let totalScrapBoxes = 0
      const dailyProd: Record<string, { units: number; weightKg: number; scrapBoxes: number }> = {}
      
      // Paradas
      const downtimeCounts: Record<string, number> = {}
      let totalDowntimeMinutes = 0

      productionData.forEach((record: any) => {
        const dateKey = record.production_date
        if (!dailyProd[dateKey]) {
          dailyProd[dateKey] = { units: 0, weightKg: 0, scrapBoxes: 0 }
        }

        PIPE_DIAMETERS.forEach(d => {
          const simple = record[`cc${d}_simples`] || 0
          const armado = record[`cc${d}_armado`] || 0
          const produced = simple + armado
          const weight = produced * (weights[d] || 0)

          if (!byDiameter[d]) byDiameter[d] = { produced: 0, weightKg: 0 }
          byDiameter[d].produced += produced
          byDiameter[d].weightKg += weight
          
          totalUnits += produced
          totalWeightKg += weight
          dailyProd[dateKey].units += produced
          dailyProd[dateKey].weightKg += weight
        })

        // Cajones de desperdicio
        const scrap = record.scrap_boxes || 0
        totalScrapBoxes += scrap
        dailyProd[dateKey].scrapBoxes += scrap

        // Paradas
        record.pipe_downtime?.forEach((dt: any) => {
          const reason = dt.custom_reason || "Sin especificar"
          if (!downtimeCounts[reason]) downtimeCounts[reason] = 0
          downtimeCounts[reason] += dt.minutes || 0
          totalDowntimeMinutes += dt.minutes || 0
        })
      })

      // Top paradas
      const topDowntimes = Object.entries(downtimeCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([reason, minutes]) => ({
          reason,
          minutes,
          percentage: totalDowntimeMinutes > 0 ? (minutes / totalDowntimeMinutes) * 100 : 0
        }))

      // Producción diaria
      const dailyProduction = Object.entries(dailyProd)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, data]) => ({
          date,
          units: data.units,
          weightTn: data.weightKg / 1000,
          scrapBoxes: data.scrapBoxes
        }))

      // 3. Cargar planificación
      const startDateObj = new Date(startDate)
      const endDateObj = new Date(endDate)
      const byDiameterPlanned: Record<number, number> = {}
      PIPE_DIAMETERS.forEach(d => { byDiameterPlanned[d] = 0 })

      // Obtener meses involucrados
      const months: { year: number; month: number }[] = []
      let currentMonth = new Date(startDateObj.getFullYear(), startDateObj.getMonth(), 1)
      while (currentMonth <= endDateObj) {
        months.push({ year: currentMonth.getFullYear(), month: currentMonth.getMonth() + 1 })
        currentMonth.setMonth(currentMonth.getMonth() + 1)
      }

      for (const { year, month } of months) {
        const { data: planningData } = await supabase
          .from("production_planning")
          .select("*")
          .eq("year", year)
          .eq("month", month)

        if (planningData) {
          planningData.forEach((row: any) => {
            const size = parseInt(row.pipe_size)
            for (let day = 1; day <= 31; day++) {
              const dayDate = new Date(year, month - 1, day)
              if (dayDate >= startDateObj && dayDate <= endDateObj) {
                const dayOfWeek = dayDate.getDay()
                // Solo días laborables
                if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                  byDiameterPlanned[size] = (byDiameterPlanned[size] || 0) + (row[`day_${day}`] || 0)
                }
              }
            }
          })
        }
      }

      const totalPlanned = Object.values(byDiameterPlanned).reduce((s, v) => s + v, 0)

      // 4. Cargar control de calidad (solo para días con producción)
      const { data: qualityControls } = await supabase
        .from("pipe_quality_control")
        .select(`
          *,
          items:pipe_quality_items(
            *,
            defects:pipe_quality_defects(
              *,
              reason:pipe_defect_reasons(reason, category)
            )
          )
        `)
        .gte("control_date", startDate)
        .lte("control_date", endDate)

      // Filtrar solo controles de días con producción
      const filteredQuality = qualityControls?.filter((qc: any) => 
        productionDates.has(qc.control_date)
      ) || []

      let qualityData: PipeReportData["qualityData"] = null
      if (filteredQuality.length > 0) {
        const qualityByDiameter: Record<number, { first: number; second: number; broken: number }> = {}
        let totalFirst = 0, totalSecond = 0, totalBroken = 0
        const defectCounts: Record<string, number> = {}

        filteredQuality.forEach((control: any) => {
          control.items?.forEach((item: any) => {
            const d = item.diameter
            if (!qualityByDiameter[d]) qualityByDiameter[d] = { first: 0, second: 0, broken: 0 }
            qualityByDiameter[d].first += item.first_quality || 0
            qualityByDiameter[d].second += item.second_quality || 0
            qualityByDiameter[d].broken += item.broken || 0
            totalFirst += item.first_quality || 0
            totalSecond += item.second_quality || 0
            totalBroken += item.broken || 0

            item.defects?.forEach((defect: any) => {
              const reason = defect.reason?.reason || "Sin especificar"
              if (!defectCounts[reason]) defectCounts[reason] = 0
              defectCounts[reason] += defect.quantity || 1
            })
          })
        })

        const totalDefects = Object.values(defectCounts).reduce((s, v) => s + v, 0)
        const topDefects = Object.entries(defectCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([reason, count]) => ({
            reason,
            count,
            percentage: totalDefects > 0 ? (count / totalDefects) * 100 : 0
          }))

        qualityData = {
          totalFirst,
          totalSecond,
          totalBroken,
          byDiameter: qualityByDiameter,
          topDefects
        }
      }

      // Calcular métricas
      const qualityTotal = qualityData 
        ? qualityData.totalFirst + qualityData.totalSecond + qualityData.totalBroken 
        : 0
      const qualityIndex = qualityTotal > 0 
        ? (qualityData!.totalFirst / qualityTotal) * 100 
        : 100
      const planCompliance = totalPlanned > 0 
        ? (totalUnits / totalPlanned) * 100 
        : 100

      setReportData({
        totalUnits,
        totalWeightTn: totalWeightKg / 1000,
        byDiameter,
        dailyProduction,
        totalPlanned,
        byDiameterPlanned,
        totalScrapBoxes,
        totalScrapTn: (totalScrapBoxes * scrapBoxWeight) / 1000,
        scrapBoxWeight,
        qualityData,
        totalDowntimeMinutes,
        topDowntimes,
        qualityIndex,
        planCompliance,
        daysWorked
      })

    } catch (error) {
      console.error("Error loading report:", error)
      toast({
        title: "Error",
        description: "No se pudo cargar el informe",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  async function exportPDF(type: "full" | "executive") {
    const targetRef = type === "full" ? reportRef : executiveRef
    if (!targetRef.current) return

    try {
      const { exportElementToPDF } = await import("@/lib/pdf-export")
      const filename = type === "full" 
        ? `informe-canos-${startDate}-a-${endDate}.pdf`
        : `informe-ejecutivo-canos-${startDate}-a-${endDate}.pdf`
      await exportElementToPDF(targetRef.current, filename)
      toast({ title: "PDF Generado", description: "El informe se ha exportado correctamente" })
    } catch (error) {
      console.error("Error exporting PDF:", error)
      toast({ title: "Error", description: "No se pudo generar el PDF", variant: "destructive" })
    }
  }

  const getStatusColor = (value: number, target: number) => {
    if (value >= target) return "text-green-600"
    if (value >= target * 0.9) return "text-amber-600"
    return "text-red-600"
  }

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Informe de Producción de Caños
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Fecha Inicio</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fecha Fin</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" />
            </div>
            <Button onClick={loadReport} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Generar Informe
            </Button>
            
            {reportData && (
              <>
                <div className="border-l pl-4 flex gap-2">
                  <Button variant="outline" onClick={() => setShowFullPreview(true)} className="gap-2">
                    <Eye className="h-4 w-4" />
                    Ver Informe
                  </Button>
                  <Button variant="outline" onClick={() => setShowExecutivePreview(true)} className="gap-2">
                    <Eye className="h-4 w-4" />
                    Ver Ejecutivo
                  </Button>
                </div>
                <div className="border-l pl-4 flex gap-2">
                  <Button variant="outline" onClick={() => exportPDF("full")} className="gap-2">
                    <FileDown className="h-4 w-4" />
                    PDF Informe
                  </Button>
                  <Button variant="outline" onClick={() => exportPDF("executive")} className="gap-2">
                    <FileDown className="h-4 w-4" />
                    PDF Ejecutivo
                  </Button>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Estado de carga */}
      {loading ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
            Cargando informe...
          </CardContent>
        </Card>
      ) : !searched ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Seleccione un rango de fechas y presione "Generar Informe"
          </CardContent>
        </Card>
      ) : !reportData ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No hay datos de producción para el período seleccionado
          </CardContent>
        </Card>
      ) : (
        /* Contenido del informe */
        <div ref={reportRef} className="space-y-4 bg-background">
          {/* Header */}
          <div className="text-center border-b pb-4">
            <h2 className="text-xl font-bold">SILKE - Informe de Producción de Caños</h2>
            <p className="text-muted-foreground">
              Período: {formatDateForDisplay(startDate)} - {formatDateForDisplay(endDate)} | {reportData.daysWorked} días trabajados
            </p>
          </div>

          {/* KPIs Principales */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="py-4 text-center">
                <p className="text-3xl font-bold text-primary">{reportData.totalUnits.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Caños Producidos</p>
                <p className="text-sm font-medium text-primary">{reportData.totalWeightTn.toFixed(2)} Tn</p>
              </CardContent>
            </Card>
            
            <Card className={reportData.planCompliance >= 90 ? "bg-green-50 border-green-200" : reportData.planCompliance >= 80 ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200"}>
              <CardContent className="py-4 text-center">
                <p className={`text-3xl font-bold ${getStatusColor(reportData.planCompliance, 90)}`}>
                  {reportData.planCompliance.toFixed(0)}%
                </p>
                <p className="text-xs text-muted-foreground">Cumplimiento Plan</p>
                <p className="text-sm text-muted-foreground">{reportData.totalPlanned.toLocaleString()} planificados</p>
              </CardContent>
            </Card>
            
            <Card className={reportData.qualityIndex >= 95 ? "bg-green-50 border-green-200" : reportData.qualityIndex >= 90 ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200"}>
              <CardContent className="py-4 text-center">
                <p className={`text-3xl font-bold ${getStatusColor(reportData.qualityIndex, 95)}`}>
                  {reportData.qualityIndex.toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground">Índice de Calidad</p>
                <p className="text-sm text-muted-foreground">Primera calidad</p>
              </CardContent>
            </Card>
            
            <Card className="bg-amber-50 border-amber-200">
              <CardContent className="py-4 text-center">
                <p className="text-3xl font-bold text-amber-600">{reportData.totalScrapBoxes}</p>
                <p className="text-xs text-muted-foreground">Cajones Desperdicio</p>
                <p className="text-sm font-medium text-amber-600">{reportData.totalScrapTn.toFixed(2)} Tn</p>
              </CardContent>
            </Card>
          </div>

          {/* Producción por Diámetro */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Producción por Diámetro</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-2 px-3 font-semibold">Diámetro</th>
                      <th className="text-center py-2 px-3 font-semibold">Producido</th>
                      <th className="text-center py-2 px-3 font-semibold">Planificado</th>
                      <th className="text-center py-2 px-3 font-semibold">Cumpl.</th>
                      <th className="text-center py-2 px-3 font-semibold text-green-600">1ra</th>
                      <th className="text-center py-2 px-3 font-semibold text-amber-600">2da</th>
                      <th className="text-center py-2 px-3 font-semibold text-red-600">Roto</th>
                      <th className="text-center py-2 px-3 font-semibold">% Calidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PIPE_DIAMETERS.map(d => {
                      const prod = reportData.byDiameter[d]
                      const planned = reportData.byDiameterPlanned[d] || 0
                      const quality = reportData.qualityData?.byDiameter[d]
                      if (!prod || prod.produced === 0) return null
                      
                      const compliance = planned > 0 ? (prod.produced / planned) * 100 : 100
                      const qualityTotal = quality ? quality.first + quality.second + quality.broken : 0
                      const qualityPct = qualityTotal > 0 ? (quality!.first / qualityTotal) * 100 : 100
                      
                      return (
                        <tr key={d} className="border-b hover:bg-muted/30">
                          <td className="py-2 px-3 font-medium">CC{d}</td>
                          <td className="py-2 px-3 text-center font-semibold">{prod.produced}</td>
                          <td className="py-2 px-3 text-center text-muted-foreground">{planned || "-"}</td>
                          <td className={`py-2 px-3 text-center font-medium ${getStatusColor(compliance, 90)}`}>
                            {planned > 0 ? `${compliance.toFixed(0)}%` : "-"}
                          </td>
                          <td className="py-2 px-3 text-center text-green-600">{quality?.first || "-"}</td>
                          <td className="py-2 px-3 text-center text-amber-600">{quality?.second || "-"}</td>
                          <td className="py-2 px-3 text-center text-red-600">{quality?.broken || "-"}</td>
                          <td className={`py-2 px-3 text-center font-medium ${getStatusColor(qualityPct, 95)}`}>
                            {qualityTotal > 0 ? `${qualityPct.toFixed(1)}%` : "-"}
                          </td>
                        </tr>
                      )
                    })}
                    <tr className="bg-muted/50 font-semibold">
                      <td className="py-2 px-3">TOTAL</td>
                      <td className="py-2 px-3 text-center">{reportData.totalUnits}</td>
                      <td className="py-2 px-3 text-center text-muted-foreground">{reportData.totalPlanned}</td>
                      <td className={`py-2 px-3 text-center ${getStatusColor(reportData.planCompliance, 90)}`}>
                        {reportData.planCompliance.toFixed(0)}%
                      </td>
                      <td className="py-2 px-3 text-center text-green-600">{reportData.qualityData?.totalFirst || "-"}</td>
                      <td className="py-2 px-3 text-center text-amber-600">{reportData.qualityData?.totalSecond || "-"}</td>
                      <td className="py-2 px-3 text-center text-red-600">{reportData.qualityData?.totalBroken || "-"}</td>
                      <td className={`py-2 px-3 text-center ${getStatusColor(reportData.qualityIndex, 95)}`}>
                        {reportData.qualityIndex.toFixed(1)}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Gráficos */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Tendencia de Producción */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Tendencia de Producción Diaria</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={reportData.dailyProduction.map(d => ({
                      ...d,
                      fecha: new Date(d.date + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })
                    }))}>
                      <defs>
                        <linearGradient id="prodGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#1e3a5f" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#1e3a5f" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="fecha" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(v: number) => [v, "Caños"]} />
                      <Area type="monotone" dataKey="units" stroke="#1e3a5f" strokeWidth={2} fill="url(#prodGradient)" />
                      <ReferenceLine 
                        y={reportData.totalUnits / reportData.daysWorked} 
                        stroke="#1e3a5f" 
                        strokeDasharray="4 4" 
                        strokeOpacity={0.6}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Cajones de Desperdicio */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Cajones de Desperdicio por Día</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reportData.dailyProduction.map(d => ({
                      ...d,
                      fecha: new Date(d.date + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="fecha" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <Tooltip formatter={(v: number) => [v, "Cajones"]} />
                      <Bar dataKey="scrapBoxes" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                      <ReferenceLine 
                        y={reportData.totalScrapBoxes / reportData.daysWorked} 
                        stroke="#f59e0b" 
                        strokeDasharray="4 4" 
                        strokeOpacity={0.6}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Top Paradas */}
          {reportData.topDowntimes.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Top 5 Paradas de Producción</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {reportData.topDowntimes.map((dt, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-red-100 text-red-600 text-xs font-bold flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <div className="flex-1">
                        <div className="flex justify-between text-sm">
                          <span>{dt.reason}</span>
                          <span className="font-medium">{dt.minutes} min ({dt.percentage.toFixed(1)}%)</span>
                        </div>
                        <div className="h-2 bg-red-100 rounded-full mt-1">
                          <div 
                            className="h-full bg-red-500 rounded-full" 
                            style={{ width: `${dt.percentage}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="pt-2 border-t text-sm text-muted-foreground">
                    Total paradas: <span className="font-semibold text-red-600">{reportData.totalDowntimeMinutes} min</span> ({(reportData.totalDowntimeMinutes / 60).toFixed(1)} hrs)
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Top Defectos */}
          {reportData.qualityData && reportData.qualityData.topDefects.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Top 5 Razones de Defectos</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {reportData.qualityData.topDefects.map((df, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-600 text-xs font-bold flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <div className="flex-1">
                        <div className="flex justify-between text-sm">
                          <span>{df.reason}</span>
                          <span className="font-medium">{df.count} ({df.percentage.toFixed(1)}%)</span>
                        </div>
                        <div className="h-2 bg-amber-100 rounded-full mt-1">
                          <div 
                            className="h-full bg-amber-500 rounded-full" 
                            style={{ width: `${df.percentage}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Preview Dialogs */}
      <Dialog open={showFullPreview} onOpenChange={setShowFullPreview}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              Vista Previa - Informe Completo
              <Button variant="outline" size="sm" onClick={() => exportPDF("full")} className="gap-2">
                <FileDown className="h-4 w-4" />
                Descargar PDF
              </Button>
            </DialogTitle>
          </DialogHeader>
          {reportData && (
            <div className="border rounded-lg p-4 bg-white">
              {/* Copia del contenido del informe para preview */}
              <div className="text-center border-b pb-4 mb-4">
                <h2 className="text-xl font-bold">SILKE - Informe de Producción de Caños</h2>
                <p className="text-muted-foreground">
                  Período: {formatDateForDisplay(startDate)} - {formatDateForDisplay(endDate)}
                </p>
              </div>
              <p className="text-sm text-muted-foreground text-center">
                El contenido completo se exportará al PDF
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showExecutivePreview} onOpenChange={setShowExecutivePreview}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              Vista Previa - Informe Ejecutivo
              <Button variant="outline" size="sm" onClick={() => exportPDF("executive")} className="gap-2">
                <FileDown className="h-4 w-4" />
                Descargar PDF
              </Button>
            </DialogTitle>
          </DialogHeader>
          {reportData && (
            <div ref={executiveRef} className="border rounded-lg p-6 bg-white space-y-4">
              {/* Header Ejecutivo */}
              <div className="flex items-center justify-between border-b pb-4">
                <div>
                  <h1 className="text-2xl font-bold">Informe Ejecutivo</h1>
                  <p className="text-muted-foreground">Línea de Caños | {formatDateForDisplay(startDate)} - {formatDateForDisplay(endDate)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">{reportData.daysWorked} días trabajados</p>
                </div>
              </div>

              {/* KPIs Ejecutivos */}
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-primary text-primary-foreground rounded-lg p-4 text-center">
                  <p className="text-3xl font-bold">{reportData.totalUnits.toLocaleString()}</p>
                  <p className="text-sm opacity-80">Producción Total</p>
                </div>
                <div className={`rounded-lg p-4 text-center ${reportData.planCompliance >= 90 ? "bg-green-600 text-white" : "bg-amber-500 text-white"}`}>
                  <p className="text-3xl font-bold">{reportData.planCompliance.toFixed(0)}%</p>
                  <p className="text-sm opacity-80">Cumpl. Plan</p>
                </div>
                <div className={`rounded-lg p-4 text-center ${reportData.qualityIndex >= 95 ? "bg-green-600 text-white" : "bg-amber-500 text-white"}`}>
                  <p className="text-3xl font-bold">{reportData.qualityIndex.toFixed(1)}%</p>
                  <p className="text-sm opacity-80">Calidad</p>
                </div>
                <div className="bg-amber-500 text-white rounded-lg p-4 text-center">
                  <p className="text-3xl font-bold">{reportData.totalScrapTn.toFixed(2)}</p>
                  <p className="text-sm opacity-80">Tn Desperdicio</p>
                </div>
              </div>

              {/* Tabla resumen por diámetro */}
              <table className="w-full text-sm border">
                <thead>
                  <tr className="bg-muted">
                    <th className="border p-2 text-left">Diámetro</th>
                    <th className="border p-2 text-center">Producido</th>
                    <th className="border p-2 text-center">Plan</th>
                    <th className="border p-2 text-center">Cumpl.</th>
                  </tr>
                </thead>
                <tbody>
                  {PIPE_DIAMETERS.map(d => {
                    const prod = reportData.byDiameter[d]
                    const planned = reportData.byDiameterPlanned[d] || 0
                    if (!prod || prod.produced === 0) return null
                    const compliance = planned > 0 ? (prod.produced / planned) * 100 : 100
                    return (
                      <tr key={d}>
                        <td className="border p-2 font-medium">CC{d}</td>
                        <td className="border p-2 text-center">{prod.produced}</td>
                        <td className="border p-2 text-center text-muted-foreground">{planned || "-"}</td>
                        <td className={`border p-2 text-center font-medium ${getStatusColor(compliance, 90)}`}>
                          {planned > 0 ? `${compliance.toFixed(0)}%` : "-"}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {/* Top 3 Paradas */}
              {reportData.topDowntimes.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-2">Top 3 Paradas</h3>
                  <div className="space-y-1">
                    {reportData.topDowntimes.slice(0, 3).map((dt, idx) => (
                      <div key={idx} className="flex justify-between text-sm">
                        <span>{idx + 1}. {dt.reason}</span>
                        <span className="font-medium text-red-600">{dt.minutes} min</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
