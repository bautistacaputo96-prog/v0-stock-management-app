"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  CheckCircle2, AlertTriangle, Clock, Lock,
  RefreshCw, Eye, Upload,
} from "lucide-react"
import { toast } from "sonner"
import { formatCurrency, formatHours } from "@/lib/payroll-engine"
import { AttendanceImport } from "./attendance-import"

interface PayrollPeriod {
  id: number
  plant: string
  period_type: string
  period_year: number
  period_month: number
  date_from: string
  date_to: string
  status: "borrador" | "revision" | "cerrado"
  total_gross: number
  total_net: number
  employee_count: number
}

interface PayrollLine {
  id: number
  employee_id: number
  normal_hours: number
  overtime_50_hours: number
  overtime_100_hours: number
  worked_days: number
  late_count: number
  absent_days: number
  applied_hourly_rate: number
  applied_category: string
  basic_amount: number
  overtime_50_amount: number
  overtime_100_amount: number
  holiday_extra_amount: number
  presentismo_amount: number
  presentismo_eligible: boolean
  sac_provision: number
  gross_total: number
  jubilacion_amount: number
  obra_social_amount: number
  inssjp_amount: number
  sindical_amount: number
  total_deductions: number
  net_total: number
  is_manual_override: boolean
  calculation_details?: string
  employees: {
    employee_id: string
    first_name: string
    last_name: string
    category: string
    salary_type: string
    agreement: string
  }
}

const MONTH_NAMES = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
]
const PERIOD_LABELS: Record<string, string> = {
  primera_quincena: "1ra Quincena (1-15)",
  segunda_quincena: "2da Quincena (16-fin de mes)",
  mensual: "Mensual",
}
const STATUS_CONFIG = {
  borrador:  { label: "Borrador",  icon: Clock,        color: "text-gray-600",  bg: "bg-gray-50" },
  revision:  { label: "Revisión",  icon: AlertTriangle, color: "text-yellow-600", bg: "bg-yellow-50" },
  cerrado:   { label: "Cerrado",   icon: Lock,          color: "text-green-600",  bg: "bg-green-50" },
}

interface LiquidationViewProps {
  period: PayrollPeriod
  onPeriodUpdated: (p: PayrollPeriod) => void
}

export function LiquidationView({ period, onPeriodUpdated }: LiquidationViewProps) {
  const [lines, setLines] = useState<PayrollLine[]>([])
  const [loading, setLoading] = useState(false)
  const [calculating, setCalculating] = useState(false)
  const [selectedLine, setSelectedLine] = useState<PayrollLine | null>(null)
  const [showImport, setShowImport] = useState(false)

  useEffect(() => {
    loadLines()
  }, [period.id])

  async function loadLines() {
    setLoading(true)
    const res = await fetch(`/api/rrhh/payroll/calculate?period_id=${period.id}`)
    if (res.ok) setLines(await res.json())
    setLoading(false)
  }

  async function handleCalculate() {
    setCalculating(true)
    try {
      const res = await fetch("/api/rrhh/payroll/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period_id: period.id }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error); return }
      toast.success(`Calculados ${data.calculated} empleados`)
      onPeriodUpdated({ ...period, total_gross: data.total_gross, total_net: data.total_net, employee_count: data.calculated })
      loadLines()
    } finally {
      setCalculating(false)
    }
  }

  async function handleStatusChange(newStatus: "revision" | "cerrado") {
    const msg = newStatus === "cerrado"
      ? "¿Cerrar el período? Esta acción no se puede revertir desde la interfaz."
      : "¿Pasar el período a revisión?"
    if (!confirm(msg)) return

    const res = await fetch("/api/rrhh/payroll/periods", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: period.id, status: newStatus, closed_by: "usuario" }),
    })
    if (res.ok) {
      const data = await res.json()
      toast.success(newStatus === "cerrado" ? "Período cerrado" : "Período en revisión")
      onPeriodUpdated({ ...period, status: newStatus })
    } else {
      const d = await res.json(); toast.error(d.error)
    }
  }

  const statusCfg = STATUS_CONFIG[period.status]
  const StatusIcon = statusCfg.icon

  const totalGross = lines.reduce((s, l) => s + (l.gross_total ?? 0), 0)
  const totalNet = lines.reduce((s, l) => s + (l.net_total ?? 0), 0)
  const totalDeductions = lines.reduce((s, l) => s + (l.total_deductions ?? 0), 0)

  return (
    <div className="space-y-4">
      {/* Header del período */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">{period.plant}</h2>
                <span className="text-muted-foreground">—</span>
                <span className="font-medium">
                  {PERIOD_LABELS[period.period_type]} · {MONTH_NAMES[period.period_month - 1]} {period.period_year}
                </span>
                <Badge variant="outline" className={`${statusCfg.color} border`}>
                  <StatusIcon className="h-3 w-3 mr-1" />
                  {statusCfg.label}
                </Badge>
              </div>
              <div className="text-sm text-muted-foreground mt-0.5">
                {formatDate(period.date_from)} → {formatDate(period.date_to)}
                {lines.length > 0 && <span className="ml-2">· {lines.length} empleados</span>}
              </div>
            </div>

            {/* Botones de acción según estado */}
            <div className="flex items-center gap-2">
              {period.status !== "cerrado" && (
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => setShowImport((v) => !v)}
                >
                  <Upload className="h-4 w-4" />
                  {showImport ? "Ocultar import" : "Importar fichero"}
                </Button>
              )}
              {period.status !== "cerrado" && (
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={handleCalculate}
                  disabled={calculating}
                >
                  <RefreshCw className={`h-4 w-4 ${calculating ? "animate-spin" : ""}`} />
                  {calculating ? "Calculando..." : "Calcular"}
                </Button>
              )}
              {period.status === "borrador" && lines.length > 0 && (
                <Button variant="outline" className="gap-2" onClick={() => handleStatusChange("revision")}>
                  <AlertTriangle className="h-4 w-4" />
                  Pasar a Revisión
                </Button>
              )}
              {period.status === "revision" && (
                <Button className="gap-2" onClick={() => handleStatusChange("cerrado")}>
                  <Lock className="h-4 w-4" />
                  Cerrar Período
                </Button>
              )}
            </div>
          </div>

          {/* KPIs del período */}
          {lines.length > 0 && (
            <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t">
              <div>
                <div className="text-xs text-muted-foreground">Total Bruto</div>
                <div className="text-xl font-bold">{formatCurrency(totalGross)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Total Descuentos</div>
                <div className="text-xl font-bold text-red-600">{formatCurrency(totalDeductions)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Total Neto a Pagar</div>
                <div className="text-xl font-bold text-green-700">{formatCurrency(totalNet)}</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Panel de importación del fichero */}
      {showImport && period.status !== "cerrado" && (
        <AttendanceImport
          plant={period.plant}
          periodId={period.id}
          periodDateFrom={period.date_from}
          periodDateTo={period.date_to}
          onImportComplete={() => {
            setShowImport(false)
            toast.info("Asistencia importada. Presioná Calcular para actualizar la liquidación.")
          }}
        />
      )}

      {/* Tabla de empleados */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Detalle por Empleado</CardTitle>
          {period.status === "cerrado" && (
            <CardDescription className="flex items-center gap-1 text-green-700">
              <Lock className="h-3 w-3" /> Período cerrado — solo lectura
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">Cargando...</div>
          ) : lines.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              Presioná <strong>Calcular</strong> para generar la liquidación de este período.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Empleado</TableHead>
                    <TableHead className="text-center">Categoría</TableHead>
                    <TableHead className="text-center">Días</TableHead>
                    <TableHead className="text-center">Hs Norm.</TableHead>
                    <TableHead className="text-center">HE 50%</TableHead>
                    <TableHead className="text-center">HE 100%</TableHead>
                    <TableHead className="text-center">Tardes</TableHead>
                    <TableHead className="text-center">Presentismo</TableHead>
                    <TableHead className="text-right">Bruto</TableHead>
                    <TableHead className="text-right">Desc.</TableHead>
                    <TableHead className="text-right font-bold">Neto</TableHead>
                    <TableHead className="text-center">Ver</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => (
                    <>
                      <TableRow
                        key={line.id}
                        className={line.is_manual_override ? "bg-amber-50" : ""}
                      >
                        <TableCell>
                          <div className="font-medium text-sm">
                            {line.employees.last_name}, {line.employees.first_name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Leg. {line.employees.employee_id}
                            {line.is_manual_override && (
                              <span className="ml-1 text-amber-600">• Manual</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="text-xs">{line.employees.category || "-"}</span>
                        </TableCell>
                        <TableCell className="text-center text-sm">{line.worked_days}</TableCell>
                        <TableCell className="text-center text-sm font-mono">
                          {line.employees.salary_type === "por_hora" ? formatHours(line.normal_hours) : "—"}
                        </TableCell>
                        <TableCell className="text-center text-sm font-mono">
                          {line.overtime_50_hours > 0
                            ? <span className="text-orange-600">{formatHours(line.overtime_50_hours)}</span>
                            : "—"
                          }
                        </TableCell>
                        <TableCell className="text-center text-sm font-mono">
                          {line.overtime_100_hours > 0
                            ? <span className="text-red-600">{formatHours(line.overtime_100_hours)}</span>
                            : "—"
                          }
                        </TableCell>
                        <TableCell className="text-center">
                          {line.late_count > 0 ? (
                            <Badge variant="outline" className={line.late_count >= 3 ? "bg-red-100 text-red-700 border-red-300" : "bg-yellow-100 text-yellow-700 border-yellow-300"}>
                              {line.late_count}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {line.presentismo_eligible ? (
                            <div className="flex items-center justify-center gap-1">
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                              <span className="text-xs text-green-700">{formatCurrency(line.presentismo_amount)}</span>
                            </div>
                          ) : (
                            <div className="flex items-center justify-center gap-1">
                              <AlertTriangle className="h-4 w-4 text-red-500" />
                              <span className="text-xs text-red-600">Sin premio</span>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium text-sm">
                          {formatCurrency(line.gross_total)}
                        </TableCell>
                        <TableCell className="text-right text-sm text-red-600">
                          -{formatCurrency(line.total_deductions)}
                        </TableCell>
                        <TableCell className="text-right font-bold text-sm text-green-700">
                          {formatCurrency(line.net_total)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setSelectedLine(line)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    </>
                  ))}
                  {/* Fila de totales */}
                  <TableRow className="font-bold bg-muted/40">
                    <TableCell colSpan={8} className="text-right text-sm">TOTALES</TableCell>
                    <TableCell className="text-right">{formatCurrency(totalGross)}</TableCell>
                    <TableCell className="text-right text-red-600">-{formatCurrency(totalDeductions)}</TableCell>
                    <TableCell className="text-right text-green-700">{formatCurrency(totalNet)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog de detalle de empleado */}
      <Dialog open={!!selectedLine} onOpenChange={(o) => !o && setSelectedLine(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedLine?.employees.last_name}, {selectedLine?.employees.first_name}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                Leg. {selectedLine?.employees.employee_id}
              </span>
            </DialogTitle>
          </DialogHeader>
          {selectedLine && <EmployeeDetailView line={selectedLine} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Vista detallada de un empleado ─────────────────────────────────────────

function EmployeeDetailView({ line }: { line: PayrollLine }) {
  const details = line.calculation_details
    ? JSON.parse(line.calculation_details)
    : []

  return (
    <Tabs defaultValue="recibo">
      <TabsList className="w-full grid grid-cols-2">
        <TabsTrigger value="recibo">Recibo</TabsTrigger>
        <TabsTrigger value="detalle">Detalle diario</TabsTrigger>
      </TabsList>

      {/* ── Vista recibo ── */}
      <TabsContent value="recibo" className="mt-4">
        <div className="border rounded-lg divide-y text-sm">
          {/* Haberes */}
          <div className="px-4 py-2 bg-muted/30 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
            Haberes
          </div>
          <ConceptRow label="Sueldo básico" amount={line.basic_amount} />
          {line.overtime_50_amount > 0 && (
            <ConceptRow label={`HE 50% (${formatHours(line.overtime_50_hours)})`} amount={line.overtime_50_amount} />
          )}
          {line.overtime_100_amount > 0 && (
            <ConceptRow label={`HE 100% (${formatHours(line.overtime_100_hours)})`} amount={line.overtime_100_amount} />
          )}
          {line.holiday_extra_amount > 0 && (
            <ConceptRow label="Plus feriado" amount={line.holiday_extra_amount} />
          )}
          {line.presentismo_amount > 0 && (
            <ConceptRow label="Premio presentismo (20%)" amount={line.presentismo_amount} />
          )}
          {!line.presentismo_eligible && (
            <div className="px-4 py-2 flex justify-between text-muted-foreground">
              <span>Premio presentismo</span>
              <span className="text-red-500">No corresponde ({line.late_count} tardanza/s)</span>
            </div>
          )}
          <div className="px-4 py-2 flex justify-between font-bold">
            <span>Total Haberes</span>
            <span>{formatCurrency(line.gross_total)}</span>
          </div>

          {/* SAC provisión (informativo) */}
          {line.sac_provision > 0 && (
            <div className="px-4 py-2 flex justify-between text-muted-foreground text-xs">
              <span>SAC proporcional del período (informativo)</span>
              <span>{formatCurrency(line.sac_provision)}</span>
            </div>
          )}

          {/* Descuentos */}
          <div className="px-4 py-2 bg-muted/30 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
            Descuentos
          </div>
          <ConceptRow label="Jubilación (11%)" amount={-line.jubilacion_amount} negative />
          <ConceptRow label="Obra Social (3%)" amount={-line.obra_social_amount} negative />
          <ConceptRow label="INSSJP / PAMI (3%)" amount={-line.inssjp_amount} negative />
          {line.sindical_amount > 0 && (
            <ConceptRow label="Cuota sindical UOCRA (2%)" amount={-line.sindical_amount} negative />
          )}
          <div className="px-4 py-2 flex justify-between font-bold text-red-700">
            <span>Total Descuentos</span>
            <span>-{formatCurrency(line.total_deductions)}</span>
          </div>

          {/* Neto */}
          <div className="px-4 py-3 flex justify-between font-bold text-lg bg-green-50">
            <span className="text-green-800">NETO A COBRAR</span>
            <span className="text-green-700">{formatCurrency(line.net_total)}</span>
          </div>
        </div>
      </TabsContent>

      {/* ── Detalle diario ── */}
      <TabsContent value="detalle" className="mt-4">
        {details.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Sin detalle disponible</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead>Fecha</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-center">Entrada</TableHead>
                  <TableHead className="text-center">Hs cont.</TableHead>
                  <TableHead className="text-center">Tarde</TableHead>
                  <TableHead className="text-center">Hs norm.</TableHead>
                  <TableHead className="text-center">HE 50%</TableHead>
                  <TableHead className="text-center">HE 100%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {details.map((d: any, i: number) => (
                  <TableRow
                    key={i}
                    className={`text-sm ${d.is_holiday ? "bg-blue-50" : d.is_saturday ? "bg-orange-50" : ""}`}
                  >
                    <TableCell className="font-medium whitespace-nowrap">
                      {d.day_name} {formatDateShort(d.date)}
                      {d.is_holiday && (
                        <span className="ml-1 text-xs text-blue-600">📅 Feriado</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-xs ${
                          d.status === "presente" ? "border-green-300 text-green-700" :
                          d.status === "ausente" ? "border-red-300 text-red-700" :
                          "border-gray-300 text-gray-600"
                        }`}
                      >
                        {STATUS_LABELS[d.status] || d.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center font-mono text-xs">
                      {d.no_clock ? <span className="text-amber-600">Sin fichar</span> : "-"}
                    </TableCell>
                    <TableCell className="text-center font-mono text-xs">
                      {d.counted_hours > 0 ? formatHours(d.counted_hours) : "—"}
                      {d.clocked_hours > 0 && d.counted_hours !== d.clocked_hours && (
                        <span className="text-muted-foreground ml-1">({formatHours(d.clocked_hours)})</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center text-xs">
                      {d.is_late ? (
                        <span className="text-red-600 font-medium">+{d.minutes_late}min</span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-center font-mono text-xs">
                      {d.normal_hours > 0 ? formatHours(d.normal_hours) : "—"}
                    </TableCell>
                    <TableCell className="text-center font-mono text-xs text-orange-600">
                      {d.overtime_50_hours > 0 ? formatHours(d.overtime_50_hours) : "—"}
                    </TableCell>
                    <TableCell className="text-center font-mono text-xs text-red-600">
                      {d.overtime_100_hours > 0 ? formatHours(d.overtime_100_hours) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </TabsContent>
    </Tabs>
  )
}

function ConceptRow({ label, amount, negative }: { label: string; amount: number; negative?: boolean }) {
  return (
    <div className="px-4 py-2 flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={negative ? "text-red-600" : "font-medium"}>
        {negative ? "-" : ""}{formatCurrency(Math.abs(amount))}
      </span>
    </div>
  )
}

function formatDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function formatDateShort(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })
}

const STATUS_LABELS: Record<string, string> = {
  presente: "Presente",
  ausente: "Ausente",
  justificado: "Justificado",
  vacaciones: "Vacaciones",
  licencia: "Licencia",
  feriado: "Feriado",
}
