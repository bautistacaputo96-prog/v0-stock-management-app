"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Plus, ChevronRight, Trash2, AlertTriangle } from "lucide-react"
import { toast } from "sonner"

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
  closed_at?: string
}

interface PeriodManagerProps {
  onSelectPeriod: (period: PayrollPeriod) => void
  selectedPeriodId?: number
}

const PLANTS = ["Villa Rosa", "Ranchos", "Olivera"]
const PERIOD_TYPES = [
  { value: "primera_quincena", label: "1ra Quincena (1-15)" },
  { value: "segunda_quincena", label: "2da Quincena (16-fin)" },
  { value: "mensual", label: "Mensual" },
]
const MONTH_NAMES = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
]
const STATUS_CONFIG = {
  borrador:  { label: "Borrador",  color: "bg-gray-100 text-gray-700 border-gray-300" },
  revision:  { label: "Revisión",  color: "bg-yellow-100 text-yellow-700 border-yellow-300" },
  cerrado:   { label: "Cerrado",   color: "bg-green-100 text-green-700 border-green-300" },
}

export function PeriodManager({ onSelectPeriod, selectedPeriodId }: PeriodManagerProps) {
  const [periods, setPeriods] = useState<PayrollPeriod[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [filterPlant, setFilterPlant] = useState<string>("all")
  const [newPeriod, setNewPeriod] = useState({
    plant: "Olivera",
    period_type: "primera_quincena",
    period_year: new Date().getFullYear(),
    period_month: new Date().getMonth() + 1,
  })

  useEffect(() => { loadPeriods() }, [])

  async function loadPeriods() {
    setLoading(true)
    const res = await fetch("/api/rrhh/payroll/periods")
    if (res.ok) setPeriods(await res.json())
    setLoading(false)
  }

  async function handleCreate() {
    const res = await fetch("/api/rrhh/payroll/periods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newPeriod),
    })
    const data = await res.json()
    if (!res.ok) { toast.error(data.error); return }
    toast.success("Período creado")
    setShowCreateDialog(false)
    loadPeriods()
  }

  async function handleDelete(period: PayrollPeriod) {
    if (!confirm(`¿Eliminar el período ${MONTH_NAMES[period.period_month - 1]} ${period.period_year} - ${period.plant}?`)) return
    const res = await fetch(`/api/rrhh/payroll/periods?id=${period.id}`, { method: "DELETE" })
    if (res.ok) { toast.success("Período eliminado"); loadPeriods() }
    else { const d = await res.json(); toast.error(d.error) }
  }

  const filtered = filterPlant === "all" ? periods : periods.filter((p) => p.plant === filterPlant)

  // Agrupar por año/mes
  const grouped: Record<string, PayrollPeriod[]> = {}
  filtered.forEach((p) => {
    const key = `${p.period_year}-${String(p.period_month).padStart(2, "0")}`
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(p)
  })

  return (
    <div className="space-y-4">
      {/* Barra de acciones */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Label>Planta:</Label>
          <Select value={filterPlant} onValueChange={setFilterPlant}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {PLANTS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button className="gap-2" onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-4 w-4" />
          Nuevo Período
        </Button>
      </div>

      {/* Lista de períodos */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Cargando...</div>
      ) : Object.keys(grouped).length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No hay períodos creados. Creá el primero con el botón de arriba.
          </CardContent>
        </Card>
      ) : (
        Object.entries(grouped)
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([key, groupPeriods]) => {
            const [year, month] = key.split("-")
            return (
              <div key={key}>
                <h3 className="text-sm font-semibold text-muted-foreground mb-2 mt-4">
                  {MONTH_NAMES[parseInt(month) - 1]} {year}
                </h3>
                <div className="grid gap-3">
                  {groupPeriods.map((period) => {
                    const statusCfg = STATUS_CONFIG[period.status]
                    const isSelected = period.id === selectedPeriodId
                    return (
                      <Card
                        key={period.id}
                        className={`cursor-pointer transition-all hover:shadow-md ${
                          isSelected ? "ring-2 ring-primary" : ""
                        }`}
                        onClick={() => onSelectPeriod(period)}
                      >
                        <CardContent className="py-3 px-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold">{period.plant}</span>
                                  <span className="text-muted-foreground">—</span>
                                  <span className="text-sm">
                                    {PERIOD_TYPES.find((t) => t.value === period.period_type)?.label}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className={`text-xs ${statusCfg.color}`}
                                  >
                                    {statusCfg.label}
                                  </Badge>
                                </div>
                                <div className="text-xs text-muted-foreground mt-0.5">
                                  {formatDate(period.date_from)} → {formatDate(period.date_to)}
                                  {period.employee_count > 0 && (
                                    <span className="ml-2">
                                      · {period.employee_count} empleados
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              {period.total_gross > 0 && (
                                <div className="text-right">
                                  <div className="text-xs text-muted-foreground">Bruto total</div>
                                  <div className="font-bold text-sm">
                                    {formatMoney(period.total_gross)}
                                  </div>
                                </div>
                              )}
                              {period.status === "borrador" && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-destructive hover:text-destructive"
                                  onClick={(e) => { e.stopPropagation(); handleDelete(period) }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              </div>
            )
          })
      )}

      {/* Dialog crear período */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nuevo Período de Liquidación</DialogTitle>
            <DialogDescription>
              Seleccioná la planta, tipo de período, año y mes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Planta</Label>
              <Select
                value={newPeriod.plant}
                onValueChange={(v) => setNewPeriod({ ...newPeriod, plant: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLANTS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tipo de período</Label>
              <Select
                value={newPeriod.period_type}
                onValueChange={(v) => setNewPeriod({ ...newPeriod, period_type: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERIOD_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Mes</Label>
                <Select
                  value={String(newPeriod.period_month)}
                  onValueChange={(v) => setNewPeriod({ ...newPeriod, period_month: parseInt(v) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTH_NAMES.map((m, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Año</Label>
                <Select
                  value={String(newPeriod.period_year)}
                  onValueChange={(v) => setNewPeriod({ ...newPeriod, period_year: parseInt(v) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[2025, 2026, 2027].map((y) => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancelar</Button>
            <Button onClick={handleCreate}>Crear Período</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function formatDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })
}

function formatMoney(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n)
}
