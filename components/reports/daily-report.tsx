"use client"

import { useState, useEffect, useRef } from "react"
import { getSupabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FileDown, TrendingUp, TrendingDown, Minus } from "lucide-react"
import {
  calculateReportMetrics,
  getDowntimeDetails,
  TARGETS,
  formatDateForDisplay,
  calculatePipeMetrics,
  type ReportMetrics,
  type DowntimeDetail,
} from "@/lib/report-utils"
import { useToast } from "@/hooks/use-toast"

interface DailyReportProps {
  lineType: "bloques" | "caños"
}

// Pesos de caños en kg
const PIPE_WEIGHTS_KG: Record<string, number> = {
  "300": 95,
  "400": 150,
  "500": 220,
  "600": 310,
  "800": 520,
  "1000": 1080,
  "1200": 1100,
}

interface PipeMetrics {
  availability: number
  performance: number
  quality: number
  oee: number
  totalUnits: number
  totalWeightTn: number
  tnPerHour: number
  tnPerHourPerOperator: number
  productionByType: { size: string; quantity: number; weightTn: number }[]
  moldBreakages: { diameter: string; reasons: string[]; comments: string }[]
  breakagesByType: { reason: string; count: number }[]
  breakagesByMold: { diameter: string; count: number }[]
  downtimes: { reason: string; minutes: number; category: string }[]
  totalDowntimeMinutes: number
  externalDowntimeMinutes: number
  availableMinutes: number
  operators: number
}

export function DailyReport({ lineType }: DailyReportProps) {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0])
  const [selectedShift, setSelectedShift] = useState<string>("all")
  const [records, setRecords] = useState<any[]>([])
  const [metrics, setMetrics] = useState<ReportMetrics | null>(null)
  const [pipeMetrics, setPipeMetrics] = useState<PipeMetrics | null>(null)
  const [downtimes, setDowntimes] = useState<DowntimeDetail[]>([])
  const [loading, setLoading] = useState(false)
  const [pipeWeights, setPipeWeights] = useState<Record<string, number>>(PIPE_WEIGHTS_KG)
  const reportRef = useRef<HTMLDivElement>(null)
  const { toast } = useToast()

  useEffect(() => {
    loadReport()
  }, [selectedDate, selectedShift, lineType])

  async function loadReport() {
    setLoading(true)
    try {
      const supabase = getSupabase()
      
      const tableName = lineType === "bloques" ? "block_production" : "pipe_production"
      
      const selectQuery = lineType === "caños" 
        ? `*, pipe_downtime (id, custom_reason, minutes, comments, downtime_category), pipe_mold_breakage (id, diameter, reasons, comments)`
        : `*, block_downtime (id, custom_reason, minutes, comments, downtime_category)`
      
      let query = supabase
        .from(tableName)
        .select(selectQuery)
        .eq("production_date", selectedDate)

      if (selectedShift !== "all") {
        query = query.eq("shift", Number.parseInt(selectedShift))
      }

      const { data, error } = await query

      if (error) throw error

      setRecords(data || [])

      if (data && data.length > 0) {
        if (lineType === "caños") {
          // Cargar pesos de caños desde la base de datos
          const { data: pipeProducts } = await supabase
            .from("product_config")
            .select("product_code, piece_weight_kg")
            .eq("line_type", "caños")
            .eq("is_active", true)
          
          if (pipeProducts) {
            const weights: Record<string, number> = { ...PIPE_WEIGHTS_KG }
            pipeProducts.forEach((p: any) => {
              const match = p.product_code?.match(/CC(\d+)/)
              if (match && p.piece_weight_kg) {
                weights[match[1]] = p.piece_weight_kg
              }
            })
            setPipeWeights(weights)
          }

          // Calcular métricas de caños
          const pipeData = calculatePipeMetrics(data, pipeWeights)
          setPipeMetrics(pipeData)
          setMetrics(null)
        } else {
          // Calcular métricas combinadas si hay múltiples turnos
          const allMetrics = data.map(calculateReportMetrics)

          if (allMetrics.length === 1) {
            setMetrics(allMetrics[0])
          } else {
            // Sumar racks, bandejas, tiempos; promediar porcentajes
            const combined: ReportMetrics = {
              date: selectedDate,
              shift: "Todos",
              racksProduced: allMetrics.reduce((s, m) => s + m.racksProduced, 0),
              traysProduced: allMetrics.reduce((s, m) => s + m.traysProduced, 0),
              productionHours: allMetrics.reduce((s, m) => s + m.productionHours, 0),
              racksPerHour: 0,
              availability: Number((allMetrics.reduce((s, m) => s + m.availability, 0) / allMetrics.length).toFixed(2)),
              performance: Number((allMetrics.reduce((s, m) => s + m.performance, 0) / allMetrics.length).toFixed(2)),
              quality: Number((allMetrics.reduce((s, m) => s + m.quality, 0) / allMetrics.length).toFixed(2)),
              oee: Number((allMetrics.reduce((s, m) => s + m.oee, 0) / allMetrics.length).toFixed(2)),
              totalDowntimeMinutes: allMetrics.reduce((s, m) => s + m.totalDowntimeMinutes, 0),
              plannedDowntimeMinutes: allMetrics.reduce((s, m) => s + m.plannedDowntimeMinutes, 0),
              unplannedDowntimeMinutes: allMetrics.reduce((s, m) => s + m.unplannedDowntimeMinutes, 0),
              scrapUnits: allMetrics.reduce((s, m) => s + m.scrapUnits, 0),
              totalBlocks: allMetrics.reduce((s, m) => s + m.totalBlocks, 0),
              goodBlocks: allMetrics.reduce((s, m) => s + m.goodBlocks, 0),
            }
            combined.racksPerHour = Number((combined.racksProduced / combined.productionHours).toFixed(2))
            setMetrics(combined)
          }
          setPipeMetrics(null)
          setDowntimes(getDowntimeDetails(data))
        }
      } else {
        setMetrics(null)
        setPipeMetrics(null)
        setDowntimes([])
      }
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

  async function exportToPDF() {
    if (!reportRef.current) return

    try {
      const { exportElementToPDF } = await import("@/lib/pdf-export")
      await exportElementToPDF(reportRef.current, `informe-diario-${selectedDate}.pdf`)

      toast({
        title: "PDF Generado",
        description: "El informe se ha exportado correctamente",
      })
    } catch (error) {
      console.error("Error exporting PDF:", error)
      toast({
        title: "Error",
        description: "No se pudo generar el PDF",
        variant: "destructive",
      })
    }
  }

  function getStatusIcon(value: number, target: number, higherIsBetter = true) {
    const diff = higherIsBetter ? value - target : target - value
    if (diff >= 0) return <TrendingUp className="h-4 w-4 text-green-500" />
    if (diff > -5) return <Minus className="h-4 w-4 text-yellow-500" />
    return <TrendingDown className="h-4 w-4 text-red-500" />
  }

  function getStatusColor(value: number, target: number, higherIsBetter = true) {
    const diff = higherIsBetter ? value - target : target - value
    if (diff >= 0) return "text-emerald-600"
    if (diff > -5) return "text-amber-600"
    return "text-red-600"
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Seleccionar Fecha</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Fecha</Label>
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Turno</Label>
              <Select value={selectedShift} onValueChange={setSelectedShift}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="1">Turno 1</SelectItem>
                  <SelectItem value="2">Turno 2</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={exportToPDF} disabled={!metrics && !pipeMetrics} variant="outline" className="gap-2 bg-transparent">
              <FileDown className="h-4 w-4" />
              Exportar PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">Cargando informe...</CardContent>
        </Card>
      ) : !metrics && !pipeMetrics ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No hay datos de producción para la fecha seleccionada
          </CardContent>
        </Card>
      ) : lineType === "caños" && pipeMetrics ? (
        <div ref={reportRef} className="space-y-4 bg-background p-4">
          <div className="text-center border-b pb-4">
            <h2 className="text-xl font-bold">SILKE - Informe Diario de Producción - Caños</h2>
            <p className="text-muted-foreground">
              Fecha: {formatDateForDisplay(selectedDate)} | Turno: {selectedShift === "all" ? "Todos" : selectedShift}
            </p>
          </div>

          {/* Métricas principales de caños */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Indicadores de Producción</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="bg-muted/50 p-3 rounded-lg border border-border">
                  <div className="text-muted-foreground text-[10px] uppercase tracking-widest font-medium mb-1">Disponibilidad</div>
                  <div className={`text-2xl font-bold ${getStatusColor(pipeMetrics.availability, 95)}`}>
                    {pipeMetrics.availability}%
                  </div>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg border border-border">
                  <div className="text-muted-foreground text-[10px] uppercase tracking-widest font-medium mb-1">Rendimiento</div>
                  <div className={`text-2xl font-bold ${getStatusColor(pipeMetrics.performance, 75)}`}>
                    {pipeMetrics.performance}%
                  </div>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg border border-border">
                  <div className="text-muted-foreground text-[10px] uppercase tracking-widest font-medium mb-1">Calidad</div>
                  <div className={`text-2xl font-bold ${getStatusColor(pipeMetrics.quality, 98)}`}>
                    {pipeMetrics.quality}%
                  </div>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg border border-border">
                  <div className="text-muted-foreground text-[10px] uppercase tracking-widest font-medium mb-1">OEE</div>
                  <div className={`text-2xl font-bold ${getStatusColor(pipeMetrics.oee, 70)}`}>
                    {pipeMetrics.oee}%
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Resumen de producción */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Resumen de Producción</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                <div className="bg-muted/50 p-3 rounded-lg">
                  <div className="text-muted-foreground text-xs">Caños Producidos</div>
                  <div className="text-xl font-bold">{pipeMetrics.totalUnits}</div>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg">
                  <div className="text-muted-foreground text-xs">Toneladas</div>
                  <div className="text-xl font-bold">{pipeMetrics.totalWeightTn} Tn</div>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg">
                  <div className="text-muted-foreground text-xs">TN/Hora</div>
                  <div className="text-xl font-bold text-primary">{pipeMetrics.tnPerHour}</div>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg">
                  <div className="text-muted-foreground text-xs">TN/Hora/Operario</div>
                  <div className="text-xl font-bold text-primary">{pipeMetrics.tnPerHourPerOperator}</div>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg">
                  <div className="text-muted-foreground text-xs">Operarios</div>
                  <div className="text-xl font-bold">{pipeMetrics.operators}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Producción por tipo de caño */}
          {pipeMetrics.productionByType.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Producción por Tipo de Caño</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-2">Tipo</th>
                        <th className="text-center py-2 px-2">Cantidad</th>
                        <th className="text-center py-2 px-2">Peso (Tn)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pipeMetrics.productionByType.map((p) => (
                        <tr key={p.size} className="border-b">
                          <td className="py-2 px-2 font-medium">CC{p.size}</td>
                          <td className="text-center py-2 px-2">{p.quantity}</td>
                          <td className="text-center py-2 px-2">{p.weightTn.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Análisis de paradas */}
          {pipeMetrics.downtimes.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Análisis de Paradas - Total: {pipeMetrics.totalDowntimeMinutes} min
                  {pipeMetrics.externalDowntimeMinutes > 0 && (
                    <span className="text-orange-600 text-sm font-normal ml-2">
                      (Factores externos: {pipeMetrics.externalDowntimeMinutes} min)
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-2">Motivo</th>
                        <th className="text-center py-2 px-2">Minutos</th>
                        <th className="text-left py-2 px-2">Categoría</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pipeMetrics.downtimes.map((dt, idx) => (
                        <tr key={idx} className="border-b">
                          <td className="py-2 px-2 font-medium">{dt.reason}</td>
                          <td className="text-center py-2 px-2">{dt.minutes}</td>
                          <td className="py-2 px-2 text-muted-foreground">{dt.category || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Análisis de roturas de molde */}
          {(pipeMetrics.breakagesByMold.length > 0 || pipeMetrics.breakagesByType.length > 0) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-destructive">
                  Análisis de Roturas de Molde ({pipeMetrics.moldBreakages.length} total)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 gap-4">
                  {/* Por molde */}
                  {pipeMetrics.breakagesByMold.length > 0 && (
                    <div>
                      <h4 className="font-medium text-sm mb-2">Por Molde (Diámetro)</h4>
                      <div className="space-y-1">
                        {pipeMetrics.breakagesByMold.map((b) => (
                          <div key={b.diameter} className="flex justify-between text-sm bg-muted/50 px-2 py-1 rounded">
                            <span>CC{b.diameter}</span>
                            <span className="font-bold text-destructive">{b.count} roturas</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Por tipo de rotura */}
                  {pipeMetrics.breakagesByType.length > 0 && (
                    <div>
                      <h4 className="font-medium text-sm mb-2">Por Tipo de Rotura</h4>
                      <div className="space-y-1">
                        {pipeMetrics.breakagesByType.map((b) => (
                          <div key={b.reason} className="flex justify-between text-sm bg-muted/50 px-2 py-1 rounded">
                            <span>{b.reason}</span>
                            <span className="font-bold text-destructive">{b.count} veces</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tiempo disponible */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Tiempo de Producción</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div className="bg-muted/50 p-3 rounded-lg text-center">
                  <div className="text-muted-foreground text-xs">Tiempo Disponible</div>
                  <div className="text-xl font-bold">{pipeMetrics.availableMinutes} min</div>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg text-center">
                  <div className="text-muted-foreground text-xs">Paradas Totales</div>
                  <div className="text-xl font-bold text-orange-600">{pipeMetrics.totalDowntimeMinutes} min</div>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg text-center">
                  <div className="text-muted-foreground text-xs">Tiempo Efectivo</div>
                  <div className="text-xl font-bold text-green-600">
                    {pipeMetrics.availableMinutes - (pipeMetrics.totalDowntimeMinutes - pipeMetrics.externalDowntimeMinutes)} min
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div ref={reportRef} className="space-y-4 bg-background p-4">
          <div className="text-center border-b pb-4">
            <h2 className="text-xl font-bold">SILKE - Informe Diario de Producción - {lineType === "bloques" ? "Bloques" : "Caños"}</h2>
            <p className="text-muted-foreground">
              Fecha: {formatDateForDisplay(selectedDate)} | Turno: {selectedShift === "all" ? "Todos" : selectedShift}
            </p>
          </div>

          {/* Métricas principales */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Indicadores de Producción</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-2">Indicador</th>
                      <th className="text-center py-2 px-2">Real</th>
                      <th className="text-center py-2 px-2">Objetivo</th>
                      <th className="text-center py-2 px-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b">
                      <td className="py-2 px-2 font-medium">Racks/Hora</td>
                      <td
                        className={`text-center py-2 px-2 font-semibold ${getStatusColor(metrics.racksPerHour, TARGETS.racksPerHour)}`}
                      >
                        {metrics.racksPerHour}
                      </td>
                      <td className="text-center py-2 px-2 text-muted-foreground">{TARGETS.racksPerHour}</td>
                      <td className="text-center py-2 px-2">
                        {getStatusIcon(metrics.racksPerHour, TARGETS.racksPerHour)}
                      </td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 px-2 font-medium">Bandejas Producidas</td>
                      <td
                        className={`text-center py-2 px-2 font-semibold ${getStatusColor(metrics.traysProduced, TARGETS.dailyTrays)}`}
                      >
                        {metrics.traysProduced}
                      </td>
                      <td className="text-center py-2 px-2 text-muted-foreground">{TARGETS.dailyTrays}</td>
                      <td className="text-center py-2 px-2">
                        {getStatusIcon(metrics.traysProduced, TARGETS.dailyTrays)}
                      </td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 px-2 font-medium">Disponibilidad</td>
                      <td
                        className={`text-center py-2 px-2 font-semibold ${getStatusColor(metrics.availability, TARGETS.availability)}`}
                      >
                        {metrics.availability}%
                      </td>
                      <td className="text-center py-2 px-2 text-muted-foreground">{TARGETS.availability}%</td>
                      <td className="text-center py-2 px-2">
                        {getStatusIcon(metrics.availability, TARGETS.availability)}
                      </td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 px-2 font-medium">Rendimiento</td>
                      <td
                        className={`text-center py-2 px-2 font-semibold ${getStatusColor(metrics.performance, TARGETS.performance)}`}
                      >
                        {metrics.performance}%
                      </td>
                      <td className="text-center py-2 px-2 text-muted-foreground">{TARGETS.performance}%</td>
                      <td className="text-center py-2 px-2">
                        {getStatusIcon(metrics.performance, TARGETS.performance)}
                      </td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 px-2 font-medium">Calidad</td>
                      <td
                        className={`text-center py-2 px-2 font-semibold ${getStatusColor(metrics.quality, TARGETS.quality)}`}
                      >
                        {metrics.quality}%
                      </td>
                      <td className="text-center py-2 px-2 text-muted-foreground">{TARGETS.quality}%</td>
                      <td className="text-center py-2 px-2">{getStatusIcon(metrics.quality, TARGETS.quality)}</td>
                    </tr>
                    <tr className="bg-muted/50">
                      <td className="py-2 px-2 font-bold">OEE</td>
                      <td className={`text-center py-2 px-2 font-bold ${getStatusColor(metrics.oee, TARGETS.oee)}`}>
                        {metrics.oee}%
                      </td>
                      <td className="text-center py-2 px-2 text-muted-foreground font-semibold">{TARGETS.oee}%</td>
                      <td className="text-center py-2 px-2">{getStatusIcon(metrics.oee, TARGETS.oee)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Resumen de producción */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Resumen de Producción</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div className="bg-muted/50 p-3 rounded-lg">
                  <div className="text-muted-foreground text-xs">Racks Producidos</div>
                  <div className="text-xl font-bold">{metrics.racksProduced}</div>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg">
                  <div className="text-muted-foreground text-xs">Horas Producción</div>
                  <div className="text-xl font-bold">{metrics.productionHours.toFixed(1)}h</div>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg">
                  <div className="text-muted-foreground text-xs">Bloques Buenos</div>
                  <div className="text-xl font-bold text-green-600">{metrics.goodBlocks}</div>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg">
                  <div className="text-muted-foreground text-xs">Bloques Descartados</div>
                  <div className="text-xl font-bold text-red-600">{metrics.scrapUnits}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Motivos de paradas */}
          {downtimes.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Motivos de Paradas - Total: {metrics.totalDowntimeMinutes} minutos
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-2">Motivo</th>
                        <th className="text-center py-2 px-2">Minutos</th>
                        <th className="text-left py-2 px-2">Observaciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {downtimes.map((dt, idx) => (
                        <tr key={idx} className="border-b">
                          <td className="py-2 px-2 font-medium">{dt.reason}</td>
                          <td className="text-center py-2 px-2">{dt.minutes}</td>
                          <td className="py-2 px-2 text-muted-foreground">
                            {dt.comments.length > 0 ? dt.comments.map(c => c.text).join(" | ") : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
