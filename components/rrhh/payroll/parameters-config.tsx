"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Pencil, Plus, Trash2, AlertCircle, CheckCircle2 } from "lucide-react"
import { toast } from "sonner"

interface UocraCategory {
  id: number
  category_name: string
  hourly_rate: number
  daily_rate: number
  effective_from: string
  is_current: boolean
}

interface PayrollParam {
  id: number
  parameter_key: string
  parameter_value: number
  description: string
}

interface Holiday {
  id: number
  holiday_date: string
  holiday_name: string
  holiday_type: string
}

const PARAM_LABELS: Record<string, string> = {
  presentismo_percent: "Premio Presentismo (%)",
  jubilacion_percent: "Jubilación (%)",
  obra_social_percent: "Obra Social (%)",
  inssjp_percent: "INSSJP / PAMI (%)",
  sindical_percent: "Cuota Sindical UOCRA (%)",
  overtime_weekly_threshold: "Umbral hs. extra/semana",
  late_tolerance_minutes: "Tolerancia tardanzas (min)",
  late_penalty_threshold: "Tardanzas que quitan presentismo",
}

export function ParametersConfig() {
  const [categories, setCategories] = useState<UocraCategory[]>([])
  const [params, setParams] = useState<PayrollParam[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [loading, setLoading] = useState(true)

  // Edit states
  const [editingCategory, setEditingCategory] = useState<UocraCategory | null>(null)
  const [editingParam, setEditingParam] = useState<PayrollParam | null>(null)
  const [showHolidayDialog, setShowHolidayDialog] = useState(false)
  const [newHoliday, setNewHoliday] = useState({ holiday_date: "", holiday_name: "", holiday_type: "nacional" })
  const [categoryForm, setCategoryForm] = useState({ hourly_rate: "", daily_rate: "", effective_from: "" })
  const [paramValue, setParamValue] = useState("")

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const res = await fetch("/api/rrhh/payroll/parameters")
    if (res.ok) {
      const data = await res.json()
      setCategories(data.categories || [])
      setParams(data.parameters_raw || [])
      setHolidays(data.holidays || [])
    }
    setLoading(false)
  }

  async function handleSaveCategory() {
    if (!editingCategory) return
    const hourly = parseFloat(categoryForm.hourly_rate)
    if (isNaN(hourly) || hourly <= 0) { toast.error("Ingresá un valor de hora válido"); return }

    const res = await fetch("/api/rrhh/payroll/parameters", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "category",
        category_name: editingCategory.category_name,
        hourly_rate: hourly,
        daily_rate: categoryForm.daily_rate || hourly * 8,
        effective_from: categoryForm.effective_from || new Date().toISOString().split("T")[0],
      }),
    })
    if (res.ok) {
      toast.success(`Categoría "${editingCategory.category_name}" actualizada`)
      setEditingCategory(null)
      loadAll()
    } else {
      const d = await res.json(); toast.error(d.error)
    }
  }

  async function handleSaveParam() {
    if (!editingParam) return
    const val = parseFloat(paramValue)
    if (isNaN(val)) { toast.error("Valor inválido"); return }

    const res = await fetch("/api/rrhh/payroll/parameters", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "parameter", parameter_key: editingParam.parameter_key, parameter_value: val }),
    })
    if (res.ok) {
      toast.success("Parámetro actualizado")
      setEditingParam(null)
      loadAll()
    } else {
      const d = await res.json(); toast.error(d.error)
    }
  }

  async function handleAddHoliday() {
    if (!newHoliday.holiday_date || !newHoliday.holiday_name) {
      toast.error("Completá fecha y nombre del feriado"); return
    }
    const res = await fetch("/api/rrhh/payroll/parameters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_holiday", ...newHoliday }),
    })
    if (res.ok) {
      toast.success("Feriado agregado")
      setShowHolidayDialog(false)
      setNewHoliday({ holiday_date: "", holiday_name: "", holiday_type: "nacional" })
      loadAll()
    }
  }

  async function handleDeleteHoliday(id: number) {
    if (!confirm("¿Eliminar este feriado?")) return
    const res = await fetch("/api/rrhh/payroll/parameters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_holiday", id }),
    })
    if (res.ok) { toast.success("Feriado eliminado"); loadAll() }
  }

  if (loading) return <div className="py-8 text-center text-muted-foreground">Cargando parámetros...</div>

  const unconfiguredCategories = categories.filter((c) => c.hourly_rate === 0)

  return (
    <div className="space-y-6">

      {/* Alerta si hay categorías sin configurar */}
      {unconfiguredCategories.length > 0 && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-semibold text-amber-800">Valores de hora no configurados</div>
            <div className="text-sm text-amber-700 mt-1">
              Las siguientes categorías tienen valor $0.00 — ingresá los valores actuales del convenio UOCRA antes de liquidar:{" "}
              <strong>{unconfiguredCategories.map((c) => c.category_name).join(", ")}</strong>
            </div>
          </div>
        </div>
      )}

      {/* ── Categorías UOCRA ── */}
      <Card>
        <CardHeader>
          <CardTitle>Categorías UOCRA — Valores de Hora</CardTitle>
          <CardDescription>
            Ingresá el valor de hora vigente según la última paritaria. Al actualizar, se guarda el historial.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Categoría</TableHead>
                <TableHead className="text-right">Valor hora</TableHead>
                <TableHead className="text-right">Jornal diario (8hs)</TableHead>
                <TableHead className="text-center">Vigente desde</TableHead>
                <TableHead className="text-center">Estado</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((cat) => (
                <TableRow key={cat.id}>
                  <TableCell className="font-medium">{cat.category_name}</TableCell>
                  <TableCell className="text-right font-mono">
                    {cat.hourly_rate > 0
                      ? `$${cat.hourly_rate.toLocaleString("es-AR", { minimumFractionDigits: 2 })}`
                      : <span className="text-amber-600 font-semibold">Sin configurar</span>
                    }
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    {cat.daily_rate > 0
                      ? `$${cat.daily_rate.toLocaleString("es-AR", { minimumFractionDigits: 2 })}`
                      : "—"
                    }
                  </TableCell>
                  <TableCell className="text-center text-sm text-muted-foreground">
                    {new Date(cat.effective_from + "T12:00:00").toLocaleDateString("es-AR")}
                  </TableCell>
                  <TableCell className="text-center">
                    {cat.hourly_rate > 0
                      ? <Badge variant="outline" className="border-green-300 text-green-700 text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />OK</Badge>
                      : <Badge variant="outline" className="border-amber-300 text-amber-700 text-xs">Pendiente</Badge>
                    }
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setEditingCategory(cat)
                        setCategoryForm({
                          hourly_rate: cat.hourly_rate > 0 ? String(cat.hourly_rate) : "",
                          daily_rate: cat.daily_rate > 0 ? String(cat.daily_rate) : "",
                          effective_from: new Date().toISOString().split("T")[0],
                        })
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Parámetros generales ── */}
      <Card>
        <CardHeader>
          <CardTitle>Parámetros Generales</CardTitle>
          <CardDescription>Porcentajes de descuentos y reglas de presentismo.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {params
              .filter((p) => PARAM_LABELS[p.parameter_key])
              .map((param) => (
                <div
                  key={param.id}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30"
                >
                  <div>
                    <div className="font-medium text-sm">{PARAM_LABELS[param.parameter_key]}</div>
                    <div className="text-xs text-muted-foreground">{param.description}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-lg">{param.parameter_value}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => { setEditingParam(param); setParamValue(String(param.parameter_value)) }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Feriados ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Feriados Nacionales</CardTitle>
              <CardDescription>Los días marcados como feriado se pagan con 100% de recargo si el empleado trabaja.</CardDescription>
            </div>
            <Button variant="outline" className="gap-2" onClick={() => setShowHolidayDialog(true)}>
              <Plus className="h-4 w-4" />
              Agregar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {holidays.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between p-2 border rounded-md text-sm"
              >
                <div>
                  <div className="font-medium">
                    {new Date(h.holiday_date + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}
                  </div>
                  <div className="text-xs text-muted-foreground truncate max-w-[120px]">{h.holiday_name}</div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDeleteHoliday(h.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Dialog editar categoría */}
      <Dialog open={!!editingCategory} onOpenChange={(o) => !o && setEditingCategory(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Actualizar valor — {editingCategory?.category_name}</DialogTitle>
            <DialogDescription>
              Al guardar se registra el historial del valor anterior.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Valor de hora ($)</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="Ej: 3500.00"
                value={categoryForm.hourly_rate}
                onChange={(e) => setCategoryForm({ ...categoryForm, hourly_rate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Jornal diario 8hs (opcional, se calcula si no ingresás)</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="Ej: 28000.00"
                value={categoryForm.daily_rate}
                onChange={(e) => setCategoryForm({ ...categoryForm, daily_rate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Vigente desde</Label>
              <Input
                type="date"
                value={categoryForm.effective_from}
                onChange={(e) => setCategoryForm({ ...categoryForm, effective_from: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCategory(null)}>Cancelar</Button>
            <Button onClick={handleSaveCategory}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog editar parámetro */}
      <Dialog open={!!editingParam} onOpenChange={(o) => !o && setEditingParam(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingParam && PARAM_LABELS[editingParam.parameter_key]}</DialogTitle>
            <DialogDescription>{editingParam?.description}</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label>Nuevo valor</Label>
            <Input
              type="number"
              step="0.01"
              className="mt-2"
              value={paramValue}
              onChange={(e) => setParamValue(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingParam(null)}>Cancelar</Button>
            <Button onClick={handleSaveParam}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog agregar feriado */}
      <Dialog open={showHolidayDialog} onOpenChange={setShowHolidayDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Agregar Feriado</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Fecha</Label>
              <Input
                type="date"
                value={newHoliday.holiday_date}
                onChange={(e) => setNewHoliday({ ...newHoliday, holiday_date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input
                placeholder="Ej: Día del Trabajador"
                value={newHoliday.holiday_name}
                onChange={(e) => setNewHoliday({ ...newHoliday, holiday_name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select
                value={newHoliday.holiday_type}
                onValueChange={(v) => setNewHoliday({ ...newHoliday, holiday_type: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nacional">Nacional</SelectItem>
                  <SelectItem value="puente">Puente</SelectItem>
                  <SelectItem value="provincial">Provincial</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowHolidayDialog(false)}>Cancelar</Button>
            <Button onClick={handleAddHoliday}>Agregar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
