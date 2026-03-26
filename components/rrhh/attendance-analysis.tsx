"use client"

import { useState, useMemo, useCallback } from "react"
import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ChevronLeft, ChevronRight, Clock, UserX, TrendingUp, User, CalendarDays, ArrowUpDown } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts"
import { QuincenaReportButton, IndividualReportButton, HistoryReportButton } from "./attendance-report-pdf"

interface Employee {
  id: number
  first_name: string
  last_name: string
  branch: string
  employee_id: string | null
  shift_start: string | null
  shift_end: string | null
}

interface AttendanceRecord {
  id?: number
  employee_id: number
  attendance_date: string
  clock_in: string | null
  clock_out: string | null
  status: string
  employees?: { first_name: string; last_name: string; branch: string; employee_id: string }
}

interface ScheduleRow {
  id: number
  employee_id: number
  day_of_week: number
  shift_start: string | null
  shift_end: string | null
  effective_from: string
  is_optional: boolean
}

const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"]
const DEFAULT_SHIFT_START = "05:00"

const fetcher = (url: string) => fetch(url).then(r => r.json())

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number)
  return h * 60 + m
}

// Normalize clock_in/clock_out: if only clock_in exists and it's after 10:00,
// it's actually the exit (employee forgot to clock in, only clocked out)
function normalizeClockTimes(clockIn: string | null, clockOut: string | null): { clockIn: string | null; clockOut: string | null } {
  if (clockIn && !clockOut) {
    const [hh] = clockIn.split(":").map(Number)
    if (hh >= 10) {
      return { clockIn: null, clockOut: clockIn }
    }
  }
  return { clockIn, clockOut }
}

function formatTime(t: string | null | undefined, fallback: string): string {
  if (!t) return fallback
  return t.substring(0, 5)
}

export function AttendanceAnalysis() {
  const now = new Date()
  const [selectedMonth, setSelectedMonth] = useState(String(now.getMonth() + 1))
  const [selectedYear, setSelectedYear] = useState(String(now.getFullYear()))
  const [quincena, setQuincena] = useState<"q1" | "q2">("q1")
  const [filterBranch, setFilterBranch] = useState("all")
  const [sortField, setSortField] = useState<"name" | "present" | "absent" | "late" | "minsLate">("minsLate")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  // Employee history
  const [historyEmployee, setHistoryEmployee] = useState<Employee | null>(null)
  const [historyMonths, setHistoryMonths] = useState(6)

  const { data: employees } = useSWR<Employee[]>("/api/rrhh/employees", fetcher)
  const { data: attendance } = useSWR<AttendanceRecord[]>(
    `/api/rrhh/attendance?month=${selectedMonth}&year=${selectedYear}`,
    fetcher
  )
  const { data: allSchedules } = useSWR<ScheduleRow[]>("/api/rrhh/schedules", fetcher)

  // History data: fetch a date range
  const historyFrom = useMemo(() => {
    if (!historyEmployee) return ""
    const d = new Date(now.getFullYear(), now.getMonth() - historyMonths + 1, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
  }, [historyEmployee, historyMonths])

  const historyTo = useMemo(() => {
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
  }, [])

  const { data: historyData } = useSWR<AttendanceRecord[]>(
    historyEmployee ? `/api/rrhh/attendance?from_date=${historyFrom}&to_date=${historyTo}&employee_id=${historyEmployee.id}` : null,
    fetcher
  )

  // Exclude employees who have NO clock_in or clock_out data at all in the period
  // (they don't clock in because they're not evaluated by attendance)
  const hasClockData = useCallback((empId: number) => {
    return (attendance || []).some(a => a.employee_id === empId && (a.clock_in || a.clock_out))
  }, [attendance])

  const filteredEmployees = (employees || []).filter(emp =>
    (filterBranch === "all" ? true : emp.branch === filterBranch) && hasClockData(emp.id)
  ).sort((a, b) => a.last_name.localeCompare(b.last_name, "es") || a.first_name.localeCompare(b.first_name, "es"))

  const getScheduleForDate = (employeeId: number, dateStr: string, dayOfWeek: number) => {
    if (!allSchedules) {
      const emp = (employees || []).find(e => e.id === employeeId)
      return {
        start: formatTime(emp?.shift_start, DEFAULT_SHIFT_START),
        isOptional: dayOfWeek === 6,
      }
    }
    const candidates = allSchedules
      .filter(s => s.employee_id === employeeId && s.day_of_week === dayOfWeek && s.effective_from <= dateStr)
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))
    if (candidates.length === 0) {
      const emp = (employees || []).find(e => e.id === employeeId)
      return { start: formatTime(emp?.shift_start, DEFAULT_SHIFT_START), isOptional: dayOfWeek === 6 }
    }
    return {
      start: formatTime(candidates[0].shift_start, DEFAULT_SHIFT_START),
      isOptional: candidates[0].is_optional ?? (dayOfWeek === 6),
    }
  }

  // Compute stats per employee for the selected quincena
  const employeeStats = useMemo(() => {
    if (!attendance || !employees) return []

    const month = Number(selectedMonth)
    const year = Number(selectedYear)
    const daysInMonth = new Date(year, month, 0).getDate()
    const startDay = quincena === "q1" ? 1 : 16
    const endDay = quincena === "q1" ? 15 : daysInMonth

    return filteredEmployees.map(emp => {
      let presentDays = 0
      let absentDays = 0
      let lateDays = 0
      let totalMinutesLate = 0
      let noClockInDays = 0
      let workDays = 0

      for (let day = startDay; day <= endDay; day++) {
        const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
        const dow = new Date(year, month - 1, day).getDay()
        if (dow === 0) continue

        const schedule = getScheduleForDate(emp.id, dateStr, dow)

        const rec = attendance.find(a => a.employee_id === emp.id && a.attendance_date === dateStr)
        if (!rec || rec.status === "ausente") {
          // Only count absence on non-optional days
          if (!schedule.isOptional) {
            workDays++
            absentDays++
          }
          continue
        }

        // Employee came in - count as workday even if optional (Saturday)
        workDays++
        const normalized = normalizeClockTimes(rec.clock_in, rec.clock_out)

        if (normalized.clockIn) {
          presentDays++
          const shiftStart = timeToMinutes(schedule.start)
          const clockIn = timeToMinutes(normalized.clockIn.substring(0, 5))
          if (clockIn > shiftStart + 5) {
            lateDays++
            totalMinutesLate += clockIn - shiftStart
          }
        } else {
          presentDays++
          noClockInDays++
        }
      }

      const attendanceRate = workDays > 0 ? ((presentDays / workDays) * 100) : 100

      return {
        ...emp,
        presentDays,
        absentDays,
        lateDays,
        totalMinutesLate,
        noClockInDays,
        workDays,
        attendanceRate,
      }
    })
  }, [attendance, employees, selectedMonth, selectedYear, quincena, filterBranch, allSchedules, filteredEmployees])

  // Sort
  const sortedStats = useMemo(() => {
    return [...employeeStats].sort((a, b) => {
      let va: number | string, vb: number | string
      switch (sortField) {
        case "name": va = `${a.last_name} ${a.first_name}`; vb = `${b.last_name} ${b.first_name}`; break
        case "present": va = a.presentDays; vb = b.presentDays; break
        case "absent": va = a.absentDays; vb = b.absentDays; break
        case "late": va = a.lateDays; vb = b.lateDays; break
        case "minsLate": va = a.totalMinutesLate; vb = b.totalMinutesLate; break
        default: va = a.totalMinutesLate; vb = b.totalMinutesLate
      }
      if (va < vb) return sortDir === "asc" ? -1 : 1
      if (va > vb) return sortDir === "asc" ? 1 : -1
      return 0
    })
  }, [employeeStats, sortField, sortDir])

  // History monthly breakdown
  const historyBreakdown = useMemo(() => {
    if (!historyData || !historyEmployee) return []

    const byMonth = new Map<string, { present: number; absent: number; late: number; minsLate: number; workDays: number }>()

    for (const rec of historyData) {
      const [y, m] = rec.attendance_date.split("-")
      const key = `${y}-${m}`
      if (!byMonth.has(key)) byMonth.set(key, { present: 0, absent: 0, late: 0, minsLate: 0, workDays: 0 })
      const stats = byMonth.get(key)!

      const date = new Date(rec.attendance_date + "T12:00:00")
      const dow = date.getDay()
      if (dow === 0) continue

      const schedule = getScheduleForDate(historyEmployee.id, rec.attendance_date, dow)

      if (rec.status === "ausente") {
        if (!schedule.isOptional) {
          stats.workDays++
          stats.absent++
        }
        continue
      }

      // Employee came in - count as workday even on optional days
      stats.workDays++

      const normalized = normalizeClockTimes(rec.clock_in, rec.clock_out)

      if (normalized.clockIn) {
        stats.present++
        const shiftStart = timeToMinutes(schedule.start)
        const clockIn = timeToMinutes(normalized.clockIn.substring(0, 5))
        if (clockIn > shiftStart + 5) {
          stats.late++
          stats.minsLate += clockIn - shiftStart
        }
      } else {
        // Present but didn't clock in - count as present, no late penalty
        stats.present++
      }
    }

    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, stats]) => {
        const [y, m] = key.split("-")
        return {
          month: `${MONTHS[Number(m) - 1].substring(0, 3)} ${y}`,
          fullMonth: `${MONTHS[Number(m) - 1]} ${y}`,
          ...stats,
          attendanceRate: stats.workDays > 0 ? Math.round((stats.present / stats.workDays) * 100) : 100,
        }
      })
  }, [historyData, historyEmployee, allSchedules])

  // Late detail records for history
  const historyLateDetail = useMemo(() => {
    if (!historyData || !historyEmployee) return []
    const records: { date: string; clockIn: string; expected: string; minsLate: number }[] = []

    for (const rec of historyData) {
      if (rec.status === "ausente") continue
      const normalized = normalizeClockTimes(rec.clock_in, rec.clock_out)
      if (!normalized.clockIn) continue // No clock_in (only clocked out) - no late penalty
      
      const date = new Date(rec.attendance_date + "T12:00:00")
      const dow = date.getDay()
      if (dow === 0) continue

      const schedule = getScheduleForDate(historyEmployee.id, rec.attendance_date, dow)
      const shiftStart = timeToMinutes(schedule.start)
      const clockIn = timeToMinutes(normalized.clockIn.substring(0, 5))
      if (clockIn > shiftStart + 5) {
        records.push({
          date: date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }),
          clockIn: normalized.clockIn.substring(0, 5),
          expected: schedule.start,
          minsLate: clockIn - shiftStart,
        })
      }
    }
    return records.sort((a, b) => b.minsLate - a.minsLate)
  }, [historyData, historyEmployee, allSchedules])

  function toggleSort(field: typeof sortField) {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortField(field); setSortDir("desc") }
  }

  function changeMonth(delta: number) {
    let m = Number(selectedMonth) + delta
    let y = Number(selectedYear)
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    setSelectedMonth(String(m))
    setSelectedYear(String(y))
  }

  function presentismoBadge(rate: number) {
    if (rate >= 90) return <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100 text-[10px]">{rate.toFixed(0)}%</Badge>
    if (rate >= 75) return <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 text-[10px]">{rate.toFixed(0)}%</Badge>
    return <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100 text-[10px]">{rate.toFixed(0)}%</Badge>
  }

  const SortButton = ({ field, label }: { field: typeof sortField; label: string }) => (
    <button onClick={() => toggleSort(field)} className="flex items-center gap-1 hover:text-foreground transition-colors">
      {label}
      {sortField === field && <ArrowUpDown className="h-3 w-3" />}
    </button>
  )

  return (
    <div className="flex flex-col gap-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => changeMonth(-1)} className="bg-transparent">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[2024, 2025, 2026, 2027].map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => changeMonth(1)} className="bg-transparent">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <div className="h-6 w-px bg-border" />
          <div className="flex items-center bg-muted rounded-lg p-0.5 gap-0.5">
            <button
              onClick={() => setQuincena("q1")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${quincena === "q1" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              1ra Quincena (1-15)
            </button>
            <button
              onClick={() => setQuincena("q2")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${quincena === "q2" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              2da Quincena (16-{new Date(Number(selectedYear), Number(selectedMonth), 0).getDate()})
            </button>
          </div>
        </div>
        <Select value={filterBranch} onValueChange={setFilterBranch}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las plantas</SelectItem>
            <SelectItem value="Villa Rosa">Villa Rosa</SelectItem>
            <SelectItem value="Ranchos">Ranchos</SelectItem>
            <SelectItem value="Olivera">Olivera</SelectItem>
          </SelectContent>
        </Select>
        {filterBranch !== "all" && (
          <QuincenaReportButton
            employees={filteredEmployees}
            attendance={attendance || []}
            getScheduleForDate={getScheduleForDate}
            month={Number(selectedMonth)}
            year={Number(selectedYear)}
            quincena={quincena}
            branch={filterBranch}
          />
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <User className="h-4 w-4" />
              <span className="text-xs font-medium">Operarios</span>
            </div>
            <p className="text-2xl font-bold">{sortedStats.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Clock className="h-4 w-4" />
              <span className="text-xs font-medium">Llegadas Tarde</span>
            </div>
            <p className="text-2xl font-bold text-amber-600">{sortedStats.reduce((s, e) => s + e.lateDays, 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <UserX className="h-4 w-4" />
              <span className="text-xs font-medium">Faltas Totales</span>
            </div>
            <p className="text-2xl font-bold text-red-600">{sortedStats.reduce((s, e) => s + e.absentDays, 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp className="h-4 w-4" />
              <span className="text-xs font-medium">Presentismo Promedio</span>
            </div>
            <p className="text-2xl font-bold">
              {sortedStats.length > 0 ? Math.round(sortedStats.reduce((s, e) => s + e.attendanceRate, 0) / sortedStats.length) : 0}%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quincena Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            Presentismo {quincena === "q1" ? "1ra" : "2da"} Quincena - {MONTHS[Number(selectedMonth) - 1]} {selectedYear}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Click en un operario para ver su historial completo
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead className="w-[200px]"><SortButton field="name" label="Operario" /></TableHead>
                  <TableHead className="text-center"><SortButton field="present" label="Presentes" /></TableHead>
                  <TableHead className="text-center"><SortButton field="absent" label="Faltas" /></TableHead>
                  <TableHead className="text-center"><SortButton field="late" label="Tardes" /></TableHead>
  <TableHead className="text-center"><SortButton field="minsLate" label="Min. Tarde" /></TableHead>
  <TableHead className="text-center text-amber-700">S/Fich</TableHead>
  <TableHead className="text-center">Presentismo</TableHead>
                  <TableHead className="text-center">Historial</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedStats.map(emp => (
                  <TableRow key={emp.id} className="text-xs">
                    <TableCell className="font-medium">
                      {emp.last_name} {emp.first_name}
                      <span className="text-muted-foreground ml-2">{emp.branch}</span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-green-700 font-medium">{emp.presentDays}</span>
                      <span className="text-muted-foreground">/{emp.workDays}</span>
                    </TableCell>
                    <TableCell className="text-center">
                      {emp.absentDays > 0 ? (
                        <span className="text-red-600 font-semibold">{emp.absentDays}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {emp.lateDays > 0 ? (
                        <span className="text-amber-600 font-semibold">{emp.lateDays}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {emp.totalMinutesLate > 0 ? (
                        <span className="text-amber-700 font-semibold">{emp.totalMinutesLate} min</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {emp.noClockInDays > 0 ? (
                        <span className="text-amber-600 font-semibold">{emp.noClockInDays}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {presentismoBadge(emp.attendanceRate)}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center gap-1 justify-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-[10px] h-6 px-2"
                          onClick={() => setHistoryEmployee(emp)}
                        >
                          Historial
                        </Button>
                        <IndividualReportButton
                          employee={emp}
                          attendance={attendance || []}
                          getScheduleForDate={getScheduleForDate}
                          month={Number(selectedMonth)}
                          year={Number(selectedYear)}
                          quincena={quincena}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {sortedStats.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No hay datos de asistencia para esta quincena
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Employee History Dialog */}
      <Dialog open={!!historyEmployee} onOpenChange={(open) => { if (!open) setHistoryEmployee(null) }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Historial de {historyEmployee?.last_name} {historyEmployee?.first_name}
            </DialogTitle>
          </DialogHeader>

          {historyEmployee && (
            <div className="flex flex-col gap-6">
              {/* Period selector */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm text-muted-foreground">Periodo:</span>
                <div className="flex items-center bg-muted rounded-lg p-0.5 gap-0.5">
                  {[3, 6, 12].map(m => (
                    <button
                      key={m}
                      onClick={() => setHistoryMonths(m)}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${historyMonths === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {m} meses
                    </button>
                  ))}
                </div>
                {historyData && historyData.length > 0 && (() => {
                  const now = new Date()
                  const toM = now.getMonth() + 1
                  const toY = now.getFullYear()
                  let fromM = toM - historyMonths + 1
                  let fromY = toY
                  while (fromM < 1) { fromM += 12; fromY-- }
                  return (
                    <HistoryReportButton
                      employee={historyEmployee}
                      attendance={historyData}
                      getScheduleForDate={getScheduleForDate}
                      fromMonth={fromM}
                      fromYear={fromY}
                      toMonth={toM}
                      toYear={toY}
                    />
                  )
                })()}
              </div>

              {/* Monthly breakdown chart */}
              {historyBreakdown.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Minutos tarde por mes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={historyBreakdown}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                        <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                        <Tooltip
                          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))" }}
                          formatter={(value: number) => [`${value} min`, "Minutos tarde"]}
                        />
                        <Bar dataKey="minsLate" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} name="Min. tarde" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* Attendance trend */}
              {historyBreakdown.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Presentismo mensual (%)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={historyBreakdown}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                        <Tooltip
                          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))" }}
                          formatter={(value: number) => [`${value}%`, "Presentismo"]}
                        />
                        <Line
                          type="monotone"
                          dataKey="attendanceRate"
                          stroke="hsl(var(--chart-1))"
                          strokeWidth={2}
                          dot={{ r: 4 }}
                          name="Presentismo"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* Monthly stats table */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Detalle mensual</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs">
                        <TableHead>Mes</TableHead>
                        <TableHead className="text-center">Presentes</TableHead>
                        <TableHead className="text-center">Faltas</TableHead>
                        <TableHead className="text-center">Tardes</TableHead>
                        <TableHead className="text-center">Min. Tarde</TableHead>
                        <TableHead className="text-center">Presentismo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historyBreakdown.map((m, i) => (
                        <TableRow key={i} className="text-xs">
                          <TableCell className="font-medium">{m.fullMonth}</TableCell>
                          <TableCell className="text-center text-green-700">{m.present}/{m.workDays}</TableCell>
                          <TableCell className="text-center">
                            {m.absent > 0 ? <span className="text-red-600 font-semibold">{m.absent}</span> : <span className="text-muted-foreground">0</span>}
                          </TableCell>
                          <TableCell className="text-center">
                            {m.late > 0 ? <span className="text-amber-600 font-semibold">{m.late}</span> : <span className="text-muted-foreground">0</span>}
                          </TableCell>
                          <TableCell className="text-center">
                            {m.minsLate > 0 ? <span className="text-amber-700 font-semibold">{m.minsLate} min</span> : <span className="text-muted-foreground">-</span>}
                          </TableCell>
                          <TableCell className="text-center">{presentismoBadge(m.attendanceRate)}</TableCell>
                        </TableRow>
                      ))}
                      {historyBreakdown.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                            No hay datos en el periodo seleccionado
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Late detail */}
              {historyLateDetail.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Detalle de llegadas tarde ({historyLateDetail.length})</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="max-h-[300px] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="text-xs">
                            <TableHead>Fecha</TableHead>
                            <TableHead className="text-center">Hora entrada</TableHead>
                            <TableHead className="text-center">Hora esperada</TableHead>
                            <TableHead className="text-center">Min. tarde</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {historyLateDetail.map((rec, i) => (
                            <TableRow key={i} className="text-xs">
                              <TableCell>{rec.date}</TableCell>
                              <TableCell className="text-center font-mono text-amber-700">{rec.clockIn}</TableCell>
                              <TableCell className="text-center font-mono text-muted-foreground">{rec.expected}</TableCell>
                              <TableCell className="text-center">
                                <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-200">
                                  +{rec.minsLate} min
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
