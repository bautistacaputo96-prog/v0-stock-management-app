"use client"

import { useState } from "react"
import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PlusCircle, Pencil, Search, X, UserPlus, Clock } from "lucide-react"

interface ScheduleRow {
  id: number
  employee_id: number
  day_of_week: number
  shift_start: string | null
  shift_end: string | null
  effective_from: string
  is_optional: boolean
}

const DAY_LABELS_SHORT = ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"]

interface Employee {
  id: number
  employee_id: string
  first_name: string
  last_name: string
  dni: string
  birth_date: string | null
  address: string | null
  branch: string
  real_start_date: string | null
  registration_date: string | null
  positions: string[]
  agreement: string | null
  increases_under_agreement: boolean
  remuneration_type: string | null
  cuit: string | null
  category: string | null
  salary_type: string | null
  salary_value: number | null
  is_active: boolean
}

const BRANCHES = ["Villa Rosa", "Ranchos", "Olivera"]
const POSITIONS = [
  "Operario de Bloques", "Operario de Caños", "Maquinista", "Ayudante", 
  "Supervisor", "Electricista", "Mecánico", "Chofer", "Administrativo",
  "Paletizador", "Mezclero", "Calderista", "Operario General"
]

const fetcher = (url: string) => fetch(url).then(r => r.json())

const emptyEmployee = {
  employee_id: "",
  first_name: "",
  last_name: "",
  dni: "",
  birth_date: "",
  address: "",
  branch: "Villa Rosa",
  real_start_date: "",
  registration_date: "",
  positions: [] as string[],
  agreement: "",
  increases_under_agreement: true,
  remuneration_type: "quincenal",
  cuit: "",
  category: "",
  salary_type: "por_hora",
  salary_value: 0,
  is_active: true,
}

export function EmployeeManager() {
  const { data: employees, mutate } = useSWR<Employee[]>("/api/rrhh/employees", fetcher)
  const { data: allSchedules } = useSWR<ScheduleRow[]>("/api/rrhh/schedules", fetcher)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null)
  const [form, setForm] = useState(emptyEmployee)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState("")
  const [filterBranch, setFilterBranch] = useState("all")
  const [positionInput, setPositionInput] = useState("")

  function openNew() {
    setEditingEmployee(null)
    setForm(emptyEmployee)
    setDialogOpen(true)
  }

  function openEdit(emp: Employee) {
    setEditingEmployee(emp)
    setForm({
      employee_id: emp.employee_id || "",
      first_name: emp.first_name,
      last_name: emp.last_name,
      dni: emp.dni,
      birth_date: emp.birth_date || "",
      address: emp.address || "",
      branch: emp.branch,
      real_start_date: emp.real_start_date || "",
      registration_date: emp.registration_date || "",
      positions: emp.positions || [],
      agreement: emp.agreement || "",
      increases_under_agreement: emp.increases_under_agreement,
      remuneration_type: emp.remuneration_type || "quincenal",
      cuit: emp.cuit || "",
      category: emp.category || "",
      salary_type: emp.salary_type || "por_hora",
      salary_value: emp.salary_value || 0,
      is_active: emp.is_active,
    })
    setDialogOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const method = editingEmployee ? "PUT" : "POST"
      const body = editingEmployee ? { id: editingEmployee.id, ...form } : form

      const res = await fetch("/api/rrhh/employees", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        await mutate()
        setDialogOpen(false)
      }
    } finally {
      setSaving(false)
    }
  }

  function addPosition(pos: string) {
    if (pos && !form.positions.includes(pos)) {
      setForm({ ...form, positions: [...form.positions, pos] })
    }
    setPositionInput("")
  }

  function removePosition(pos: string) {
    setForm({ ...form, positions: form.positions.filter(p => p !== pos) })
  }

  function getScheduleSummary(empId: number): string {
    if (!allSchedules) return "-"
    const empSchedules = allSchedules.filter(s => s.employee_id === empId)
    if (empSchedules.length === 0) return "Sin horario"
    // Group by day_of_week, keep latest effective_from
    const byDay = new Map<number, ScheduleRow>()
    for (const s of empSchedules) {
      const existing = byDay.get(s.day_of_week)
      if (!existing || s.effective_from > existing.effective_from) {
        byDay.set(s.day_of_week, s)
      }
    }
    const weekdays = Array.from(byDay.values()).filter(d => d.day_of_week >= 1 && d.day_of_week <= 5)
    if (weekdays.length === 0) return "Sin horario"
    const fmt = (t: string | null) => t ? t.substring(0, 5) : "-"
    const allSame = weekdays.every(d => 
      d.shift_start === weekdays[0].shift_start && d.shift_end === weekdays[0].shift_end
    )
    if (allSame) return `${fmt(weekdays[0].shift_start)}-${fmt(weekdays[0].shift_end)}`
    return "Variable"
  }

  function getScheduleDetail(empId: number): { day: string; start: string; end: string }[] {
    if (!allSchedules) return []
    const empSchedules = allSchedules.filter(s => s.employee_id === empId)
    const byDay = new Map<number, ScheduleRow>()
    for (const s of empSchedules) {
      const existing = byDay.get(s.day_of_week)
      if (!existing || s.effective_from > existing.effective_from) {
        byDay.set(s.day_of_week, s)
      }
    }
    return Array.from(byDay.values())
      .filter(d => d.day_of_week >= 1 && d.day_of_week <= 6)
      .sort((a, b) => a.day_of_week - b.day_of_week)
      .map(d => ({
        day: DAY_LABELS_SHORT[d.day_of_week],
        start: d.shift_start ? d.shift_start.substring(0, 5) : "-",
        end: d.shift_end ? d.shift_end.substring(0, 5) : "-",
      }))
  }

  const filtered = (employees || []).filter(emp => {
    const matchSearch = !search || 
      `${emp.first_name} ${emp.last_name}`.toLowerCase().includes(search.toLowerCase()) ||
      emp.dni.includes(search) ||
      (emp.employee_id && emp.employee_id.includes(search))
    const matchBranch = filterBranch === "all" || emp.branch === filterBranch
    return matchSearch && matchBranch && emp.is_active
  }).sort((a, b) => a.last_name.localeCompare(b.last_name, "es") || a.first_name.localeCompare(b.first_name, "es"))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre, DNI o legajo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={filterBranch} onValueChange={setFilterBranch}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {BRANCHES.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew} className="gap-2">
              <UserPlus className="h-4 w-4" />
              Nuevo Empleado
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingEmployee ? "Editar Empleado" : "Nuevo Empleado"}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="flex flex-col gap-2">
                <Label>Nombre *</Label>
                <Input value={form.first_name} onChange={e => setForm({...form, first_name: e.target.value})} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Apellido *</Label>
                <Input value={form.last_name} onChange={e => setForm({...form, last_name: e.target.value})} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>DNI *</Label>
                <Input value={form.dni} onChange={e => setForm({...form, dni: e.target.value})} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>ID Empleado / Legajo</Label>
                <Input value={form.employee_id} onChange={e => setForm({...form, employee_id: e.target.value})} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>CUIT</Label>
                <Input value={form.cuit} onChange={e => setForm({...form, cuit: e.target.value})} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>F. Nacimiento</Label>
                <Input type="date" value={form.birth_date} onChange={e => setForm({...form, birth_date: e.target.value})} />
              </div>
              <div className="col-span-2 flex flex-col gap-2">
                <Label>Dirección</Label>
                <Input value={form.address} onChange={e => setForm({...form, address: e.target.value})} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Sucursal *</Label>
                <Select value={form.branch} onValueChange={v => setForm({...form, branch: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BRANCHES.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label>F. Ingreso Real</Label>
                <Input type="date" value={form.real_start_date} onChange={e => setForm({...form, real_start_date: e.target.value})} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Fecha de Alta</Label>
                <Input type="date" value={form.registration_date} onChange={e => setForm({...form, registration_date: e.target.value})} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Convenio en el Alta</Label>
                <Input value={form.agreement} onChange={e => setForm({...form, agreement: e.target.value})} />
              </div>
              <div className="col-span-2 flex flex-col gap-2">
                <Label>Puestos de Trabajo</Label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {form.positions.map(pos => (
                    <Badge key={pos} variant="secondary" className="gap-1 pr-1">
                      {pos}
                      <button type="button" onClick={() => removePosition(pos)} className="ml-1 hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Select value={positionInput} onValueChange={(v) => { addPosition(v); setPositionInput("") }}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Seleccionar puesto..." /></SelectTrigger>
                    <SelectContent>
                      {POSITIONS.filter(p => !form.positions.includes(p)).map(p => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Aumenta bajo convenio</Label>
                <Select value={form.increases_under_agreement ? "si" : "no"} onValueChange={v => setForm({...form, increases_under_agreement: v === "si"})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="si">Sí</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Remuneración</Label>
                <Select value={form.remuneration_type} onValueChange={v => setForm({...form, remuneration_type: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="quincenal">Quincenal</SelectItem>
                    <SelectItem value="mensual">Mensual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Categoría</Label>
                <Input value={form.category} onChange={e => setForm({...form, category: e.target.value})} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Tipo de Sueldo</Label>
                <Select value={form.salary_type} onValueChange={v => setForm({...form, salary_type: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="por_hora">Por Hora</SelectItem>
                    <SelectItem value="fijo">Fijo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label>{form.salary_type === "por_hora" ? "Valor por Hora ($)" : "Sueldo Fijo ($)"}</Label>
                <Input type="number" step="0.01" value={form.salary_value || ""} onChange={e => setForm({...form, salary_value: Number(e.target.value)})} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Estado</Label>
                <Select value={form.is_active ? "activo" : "inactivo"} onValueChange={v => setForm({...form, is_active: v === "activo"})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="activo">Activo</SelectItem>
                    <SelectItem value="inactivo">Inactivo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="outline" onClick={() => setDialogOpen(false)} className="bg-transparent">Cancelar</Button>
              <Button onClick={handleSave} disabled={saving || !form.first_name || !form.last_name || !form.dni}>
                {saving ? "Guardando..." : editingEmployee ? "Actualizar" : "Guardar"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Empleados Activos ({filtered.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!employees ? (
            <p className="text-center text-muted-foreground py-8">Cargando...</p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No se encontraron empleados</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Legajo</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>DNI</TableHead>
                    <TableHead>Sucursal</TableHead>
                    <TableHead>Puesto(s)</TableHead>
                    <TableHead>Horario Actual</TableHead>
                    <TableHead>Ingreso</TableHead>
                    <TableHead>Sueldo</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(emp => (
                    <TableRow key={emp.id}>
                      <TableCell className="font-mono text-xs">{emp.employee_id || "-"}</TableCell>
                      <TableCell className="font-medium">{emp.last_name}, {emp.first_name}</TableCell>
                      <TableCell>{emp.dni}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{emp.branch}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(emp.positions || []).map(p => (
                            <Badge key={p} variant="secondary" className="text-xs">{p}</Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const summary = getScheduleSummary(emp.id)
                          const detail = getScheduleDetail(emp.id)
                          if (summary === "Sin horario") {
                            return <span className="text-xs text-muted-foreground">Sin horario</span>
                          }
                          if (summary === "Variable") {
                            return (
                              <div className="flex flex-col gap-0.5">
                                {detail.map(d => (
                                  <div key={d.day} className="text-[10px]">
                                    <span className="font-medium text-muted-foreground w-5 inline-block">{d.day}</span>{" "}
                                    <span>{d.start}-{d.end}</span>
                                  </div>
                                ))}
                              </div>
                            )
                          }
                          return (
                            <div className="flex items-center gap-1">
                              <Clock className="h-3 w-3 text-muted-foreground" />
                              <span className="text-xs">{summary}</span>
                            </div>
                          )
                        })()}
                      </TableCell>
                      <TableCell className="text-xs">
                        {emp.real_start_date ? new Date(emp.real_start_date + "T12:00:00").toLocaleDateString("es-AR") : "-"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {emp.salary_type === "por_hora" 
                          ? `$${emp.salary_value}/h` 
                          : emp.salary_value ? `$${emp.salary_value} fijo` : "-"
                        }
                      </TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={() => openEdit(emp)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
