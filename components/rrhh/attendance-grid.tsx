"use client"

import { useState, useCallback, useMemo } from "react"
import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Label } from "@/components/ui/label"
import { Save, Clock, AlertTriangle, UserX, TrendingUp, ChevronLeft, ChevronRight, Upload, FileSpreadsheet, Loader2, Settings2, CalendarDays, Trash2, CheckCircle2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
/* xlsx is dynamically imported to avoid chunk loading issues */

interface Employee {
  id: number
  first_name: string
  last_name: string
  dni: string
  branch: string
  positions: string[]
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
  observations: string | null
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
const DAY_LABELS = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"]
const DAY_LABELS_FULL = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"]

const DEFAULT_SHIFT_START = "05:00"
const DEFAULT_SHIFT_END = "16:00"

const fetcher = (url: string) => fetch(url).then(r => r.json())

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number)
  return h * 60 + m
}

function formatTime(t: string | null | undefined, fallback: string): string {
  if (!t) return fallback
  return t.substring(0, 5)
}

export function AttendanceGrid() {
  const now = new Date()
  const [selectedMonth, setSelectedMonth] = useState(String(now.getMonth() + 1))
  const [selectedYear, setSelectedYear] = useState(String(now.getFullYear()))
  const [filterBranch, setFilterBranch] = useState("all")
  const [saving, setSaving] = useState(false)
  const [editedCells, setEditedCells] = useState<Record<string, { clock_in: string; clock_out: string; status: string }>>({})
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [importPlant, setImportPlant] = useState<string>("")
  const [importPreview, setImportPreview] = useState<{ headers: string[]; rows: string[][]; raw: unknown[][] } | null>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ matched: number; unmatched: string[]; records: number } | null>(null)
  const [detailEmployee, setDetailEmployee] = useState<Employee | null>(null)
  const [scheduleEmployee, setScheduleEmployee] = useState<Employee | null>(null)
  const [savingSchedule, setSavingSchedule] = useState(false)
  // Weekly schedule editor state
  const [scheduleEffectiveFrom, setScheduleEffectiveFrom] = useState("")
  const [weeklySchedule, setWeeklySchedule] = useState<{ day_of_week: number; shift_start: string; shift_end: string; is_optional: boolean }[]>([])
  // Schedule history viewer
  const [showScheduleHistory, setShowScheduleHistory] = useState(false)

  const { data: employees, mutate: mutateEmployees } = useSWR<Employee[]>("/api/rrhh/employees", fetcher)
  const { data: attendance, mutate: mutateAttendance } = useSWR<AttendanceRecord[]>(
    `/api/rrhh/attendance?month=${selectedMonth}&year=${selectedYear}`,
    fetcher
  )
  // Load ALL schedules for all employees
  const { data: allSchedules, mutate: mutateSchedules } = useSWR<ScheduleRow[]>("/api/rrhh/schedules", fetcher)

  const daysCount = getDaysInMonth(Number(selectedYear), Number(selectedMonth))
  const days = Array.from({ length: daysCount }, (_, i) => i + 1)
  
  // Quincena filter
  const [quincena, setQuincena] = useState<"all" | "q1" | "q2">("all")
  const filteredDays = quincena === "q1" ? days.filter(d => d <= 15) : quincena === "q2" ? days.filter(d => d >= 16) : days

  // Build a lookup: for a given employee + date, find the effective shift_start/shift_end
  // Logic: find the schedule rows for this employee where effective_from <= date,
  // group by day_of_week, and keep the one with the latest effective_from for each day
  const getScheduleForDate = useCallback((employeeId: number, dateStr: string, dayOfWeek: number): { start: string; end: string; isOptional: boolean } => {
    if (!allSchedules) {
      const emp = (employees || []).find(e => e.id === employeeId)
      return {
        start: formatTime(emp?.shift_start, DEFAULT_SHIFT_START),
        end: formatTime(emp?.shift_end, DEFAULT_SHIFT_END),
        isOptional: dayOfWeek === 6, // Saturday optional by default
      }
    }

    const candidates = allSchedules.filter(
      s => s.employee_id === employeeId && s.day_of_week === dayOfWeek && s.effective_from <= dateStr
    )

    if (candidates.length === 0) {
      const emp = (employees || []).find(e => e.id === employeeId)
      return {
        start: formatTime(emp?.shift_start, DEFAULT_SHIFT_START),
        end: formatTime(emp?.shift_end, DEFAULT_SHIFT_END),
        isOptional: dayOfWeek === 6,
      }
    }

    candidates.sort((a, b) => b.effective_from.localeCompare(a.effective_from))
    const best = candidates[0]
    return {
      start: formatTime(best.shift_start, DEFAULT_SHIFT_START),
      end: formatTime(best.shift_end, DEFAULT_SHIFT_END),
      isOptional: best.is_optional ?? (dayOfWeek === 6),
    }
  }, [allSchedules, employees])

  // Get the "current" schedule for an employee (latest effective_from for each day)
  const getCurrentSchedule = useCallback((employeeId: number): { day_of_week: number; start: string; end: string; effective_from: string; isOptional: boolean }[] => {
    if (!allSchedules) return []
    const empSchedules = allSchedules.filter(s => s.employee_id === employeeId)
    const byDay = new Map<number, ScheduleRow>()
    for (const s of empSchedules) {
      const existing = byDay.get(s.day_of_week)
      if (!existing || s.effective_from > existing.effective_from) {
        byDay.set(s.day_of_week, s)
      }
    }
    return Array.from(byDay.values()).map(s => ({
      day_of_week: s.day_of_week,
      start: formatTime(s.shift_start, DEFAULT_SHIFT_START),
      end: formatTime(s.shift_end, DEFAULT_SHIFT_END),
      effective_from: s.effective_from,
      isOptional: s.is_optional ?? (s.day_of_week === 6),
    })).sort((a, b) => a.day_of_week - b.day_of_week)
  }, [allSchedules])

  // Get unique effective_from dates for an employee (for history view)
  const getScheduleVersions = useCallback((employeeId: number): string[] => {
    if (!allSchedules) return []
    const dates = new Set<string>()
    for (const s of allSchedules) {
      if (s.employee_id === employeeId) dates.add(s.effective_from)
    }
    return Array.from(dates).sort((a, b) => b.localeCompare(a)) // newest first
  }, [allSchedules])

  // Get schedule for a specific effective_from version
  const getScheduleVersion = useCallback((employeeId: number, effectiveFrom: string): ScheduleRow[] => {
    if (!allSchedules) return []
    return allSchedules
      .filter(s => s.employee_id === employeeId && s.effective_from === effectiveFrom)
      .sort((a, b) => a.day_of_week - b.day_of_week)
  }, [allSchedules])

  // Exclude employees who have NO clock_in or clock_out data at all in the period
  // (they don't clock in because they're not evaluated by attendance)
  const hasClockData = useCallback((empId: number) => {
    return (attendance || []).some(a => a.employee_id === empId && (a.clock_in || a.clock_out))
  }, [attendance])

  const filteredEmployees = (employees || []).filter(emp => {
    return emp.branch === (filterBranch === "all" ? emp.branch : filterBranch) && hasClockData(emp.id)
  }).sort((a, b) => a.last_name.localeCompare(b.last_name, "es") || a.first_name.localeCompare(b.first_name, "es"))

  const getAttendance = useCallback((employeeId: number, day: number): AttendanceRecord | undefined => {
    const dateStr = `${selectedYear}-${selectedMonth.padStart(2, "0")}-${String(day).padStart(2, "0")}`
    return (attendance || []).find(a => a.employee_id === employeeId && a.attendance_date === dateStr)
  }, [attendance, selectedMonth, selectedYear])

  const cellKey = (empId: number, day: number) => `${empId}-${day}`

  function getCellValue(empId: number, day: number) {
  const key = cellKey(empId, day)
  if (editedCells[key]) return editedCells[key]
  const record = getAttendance(empId, day)
  let clockIn = record?.clock_in || ""
  let clockOut = record?.clock_out || ""

  // Normalize: if clock_in is after 10:00 and no clock_out, it's actually the exit time
  // (employee forgot to clock in, only clocked out)
  if (clockIn && !clockOut) {
    const [hh] = clockIn.split(":").map(Number)
    if (hh >= 10) {
      clockOut = clockIn
      clockIn = ""
    }
  }

  return {
  clock_in: clockIn,
  clock_out: clockOut,
  status: record?.status || "presente",
  }
  }

  function updateCell(empId: number, day: number, field: string, value: string) {
    const key = cellKey(empId, day)
    const current = getCellValue(empId, day)
    setEditedCells(prev => ({
      ...prev,
      [key]: { ...current, [field]: value }
    }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const records = Object.entries(editedCells).map(([key, val]) => {
        const [empId, day] = key.split("-").map(Number)
        const dateStr = `${selectedYear}-${selectedMonth.padStart(2, "0")}-${String(day).padStart(2, "0")}`
        return {
          employee_id: empId,
          attendance_date: dateStr,
          clock_in: val.clock_in || null,
          clock_out: val.clock_out || null,
          status: val.status || "presente",
        }
      })

      if (records.length === 0) return

      const res = await fetch("/api/rrhh/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(records),
      })

      if (res.ok) {
        setEditedCells({})
        await mutateAttendance()
      }
    } finally {
      setSaving(false)
    }
  }

  function getDayOfWeek(day: number) {
    const date = new Date(Number(selectedYear), Number(selectedMonth) - 1, day)
    return date.getDay()
  }

  // Helpers that use per-day schedule
  function getShiftForDay(empId: number, day: number): { start: string; end: string; isOptional: boolean } {
    const dow = getDayOfWeek(day)
    const dateStr = `${selectedYear}-${selectedMonth.padStart(2, "0")}-${String(day).padStart(2, "0")}`
    return getScheduleForDate(empId, dateStr, dow)
  }

  function isLate(clockIn: string | null, empId: number, day: number): boolean {
    const dow = getDayOfWeek(day)
    if (!clockIn || dow === 0) return false
    const shift = getShiftForDay(empId, day)
    // Late = more than 5 minutes after shift start (5:06+ is late, 5:05 is not)
    return timeToMinutes(clockIn) > timeToMinutes(shift.start) + 5
  }

  function minutesLate(clockIn: string | null, empId: number, day: number): number {
    if (!isLate(clockIn, empId, day)) return 0
    const shift = getShiftForDay(empId, day)
    return timeToMinutes(clockIn!) - timeToMinutes(shift.start)
  }

  function isEarlyDeparture(clockIn: string | null, clockOut: string | null, empId: number, day: number): boolean {
    const dow = getDayOfWeek(day)
    if (!clockIn || !clockOut || dow === 0) return false
    const shift = getShiftForDay(empId, day)
    return clockOut < shift.end
  }

  function minutesEarlyDeparture(clockIn: string | null, clockOut: string | null, empId: number, day: number): number {
    if (!isEarlyDeparture(clockIn, clockOut, empId, day)) return 0
    const shift = getShiftForDay(empId, day)
    return timeToMinutes(shift.end) - timeToMinutes(clockOut!)
  }

  // Calculate stats per employee
  function getEmployeeStats(emp: Employee, daysRange: number[] = filteredDays) {
    let presentDays = 0
    let absentDays = 0
    let lateDays = 0
    let totalMinutesLate = 0
    let earlyDepartures = 0
    let totalMinutesEarly = 0
    let noClockInDays = 0

    for (const day of daysRange) {
      const dow = getDayOfWeek(day)
      if (dow === 0) continue
      const shift = getShiftForDay(emp.id, day)

      const val = getCellValue(emp.id, day)
      if (val.status === "ausente") {
        if (!shift.isOptional) absentDays++
      } else if (val.status === "presente" || val.status === "justificado") {
        presentDays++
        if (!val.clock_in) {
          // Present but didn't clock in - count as on-time but flag it
          noClockInDays++
        } else {
          if (isLate(val.clock_in, emp.id, day)) {
            lateDays++
            totalMinutesLate += minutesLate(val.clock_in, emp.id, day)
          }
          if (isEarlyDeparture(val.clock_in, val.clock_out, emp.id, day)) {
            earlyDepartures++
            totalMinutesEarly += minutesEarlyDeparture(val.clock_in, val.clock_out, emp.id, day)
          }
        }
      }
    }

    return { presentDays, absentDays, lateDays, totalMinutesLate, earlyDepartures, totalMinutesEarly, noClockInDays }
  }

  function changeMonth(delta: number) {
    let m = Number(selectedMonth) + delta
    let y = Number(selectedYear)
    if (m > 12) { m = 1; y++ }
    if (m < 1) { m = 12; y-- }
    setSelectedMonth(String(m))
    setSelectedYear(String(y))
    setEditedCells({})
  }

  async function handleFileUpload(file: File) {
    setImportFile(file)
    const XLSX = await import("xlsx")
    const data = await file.arrayBuffer()
    const workbook = XLSX.read(data, { type: "array" })

    // For Ranchos, use "Registro asistencia" sheet
    let sheetName = workbook.SheetNames[0]
    if (importPlant === "Ranchos") {
      const regSheet = workbook.SheetNames.find(s => s.toLowerCase().includes("registro"))
      if (regSheet) sheetName = regSheet
    }

    const sheet = workbook.Sheets[sheetName]
    const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" })
    
    const raw = jsonData.slice(0, 40) as unknown[][]
    const headers = raw.length > 0 ? (raw[0] as string[]).map(h => String(h || "")) : []
    const rows = raw.slice(1).map(row => (row as unknown[]).map(cell => String(cell ?? "")))
    
    setImportPreview({ headers, rows, raw })
  }

  // Ranchos import: intermediate state for "no production" day confirmation
  const [ranchosParseResult, setRanchosParseResult] = useState<{
    records: { employee_id: number; attendance_date: string; clock_in: string | null; clock_out: string | null }[]
    unmatched: string[]
    suspiciousDays: { date: string; present: number; absent: number }[]
    allEmployeeIds: number[]
    totalDays: string[]
  } | null>(null)
  const [noProductionDays, setNoProductionDays] = useState<Set<string>>(new Set())

  async function processImportRanchos() {
    if (!importFile || !employees) return
    setImporting(true)
    try {
      const XLSX = await import("xlsx")
      const data = await importFile.arrayBuffer()
      const workbook = XLSX.read(data, { type: "array" })

      const regSheetName = workbook.SheetNames.find(s => s.toLowerCase().includes("registro")) || workbook.SheetNames[0]
      const sheet = workbook.Sheets[regSheetName]
      const allRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" }) as unknown[][]

      // Parse date range from first 5 rows
      let dateRangeMatch: RegExpMatchArray | null = null
      for (let r = 0; r < Math.min(5, allRows.length); r++) {
        const rowStr = (allRows[r] as unknown[]).map(c => String(c || "")).join(" ")
        dateRangeMatch = rowStr.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\s*~\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/)
        if (dateRangeMatch) break
      }

      if (!dateRangeMatch) {
        setImportResult({ matched: 0, unmatched: [], records: 0 })
        setImporting(false)
        return
      }

      const startDay = parseInt(dateRangeMatch[1])
      const startMonth = parseInt(dateRangeMatch[2])
      const startYear = parseInt(dateRangeMatch[3])
      const endDay = parseInt(dateRangeMatch[4])

      // Build all dates in range
      const allDates: string[] = []
      for (let d = startDay; d <= endDay; d++) {
        const dt = new Date(startYear, startMonth - 1, d)
        allDates.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`)
      }

      // Build employee map - by employee_id field and by name (strict matching)
      const empByExtId = new Map<string, (typeof employees)[0]>()
      const empByFullName = new Map<string, (typeof employees)[0]>()
      const empByLastName = new Map<string, (typeof employees)[0]>()
      const ranchosEmployees = employees.filter(e => e.branch === "Ranchos")

      for (const emp of ranchosEmployees) {
        if (emp.employee_id) {
          const eid = String(emp.employee_id)
          empByExtId.set(eid, emp)
          // Also map without prefix (e.g. "R5" -> also map "5")
          const numOnly = eid.replace(/^[A-Za-z]+/, "")
          if (numOnly && numOnly !== eid) empByExtId.set(numOnly, emp)
        }
        const fullName = `${emp.first_name} ${emp.last_name}`.toLowerCase().trim().replace(/\s+/g, " ")
        empByFullName.set(fullName, emp)
        // Only map by last name if it has 4+ chars to avoid false matches
        const lastName = emp.last_name.toLowerCase().trim()
        if (lastName.length >= 4) empByLastName.set(lastName, emp)
        const firstName = emp.first_name.toLowerCase().trim()
        if (firstName.length >= 4) empByLastName.set(firstName, emp)
      }

      const attendanceMap = new Map<string, { employee_id: number; attendance_date: string; clock_in: string | null; clock_out: string | null }>()
      const unmatchedNames = new Set<string>()
      const matchedEmployeeIds = new Set<number>()

      // Parse employee blocks
      // Format: Row with "ID :" has A="ID :", B="", C=<id number>, ... H="Nombre :", I="", J=<NAME>
      // Next row has times: col B=day1, col C=day2, etc. Each cell = "HH:MM\nHH:MM" (entry\nexit)
      // Then a spacer row with day numbers again
      let i = 3
      while (i < allRows.length) {
        const row = allRows[i] as unknown[]
        if (!row || row.length === 0) { i++; continue }

        const cellA = String(row[0] || "").trim()
        const isIdRow = cellA === "ID :" || cellA === "ID:" || cellA === "ID" ||
          (cellA.toUpperCase().startsWith("ID") && (cellA.includes(":") || cellA.includes(" ")))

        if (isIdRow) {
          // ID is in column C (index 2)
          const extId = String(row[2] || "").trim()

          // Name: scan all cells for "Nombre :" then take the next non-empty cells
          let empName = ""
          for (let c = 0; c < row.length - 1; c++) {
            const cellStr = String(row[c] || "").trim()
            if (cellStr.toLowerCase().includes("nombre")) {
              // Name can be in the cells after "Nombre :"
              const nameParts: string[] = []
              for (let nc = c + 1; nc < Math.min(c + 4, row.length); nc++) {
                const val = String(row[nc] || "").trim()
                if (val && !val.toLowerCase().includes("dept") && !val.toLowerCase().includes("not set")) {
                  nameParts.push(val)
                } else if (val.toLowerCase().includes("dept")) {
                  break
                }
              }
              empName = nameParts.join(" ").trim()
              break
            }
          }

          // Match employee: first by external ID, then by full name, then by last name (strict)
          let emp = empByExtId.get(extId)
          if (!emp && empName) {
            const nameLower = empName.toLowerCase().trim().replace(/\s+/g, " ")
            emp = empByFullName.get(nameLower)
            if (!emp) {
              // Try matching by significant parts (last name or first name, 4+ chars)
              const parts = nameLower.replace(/[.,]/g, " ").split(/\s+/).filter(p => p.length >= 3)
              for (const part of parts) {
                if (empByLastName.has(part)) { emp = empByLastName.get(part); break }
              }
            }
          }

          if (!emp) {
            if (empName) unmatchedNames.add(`ID ${extId}: ${empName}`)
            i += 3
            continue
          }

          matchedEmployeeIds.add(emp.id)

          // Next row has the times - column A (index 0) = day 1, column B (index 1) = day 2, etc.
          const timesRow = allRows[i + 1] as unknown[]
          if (timesRow) {
            for (let col = 0; col < timesRow.length; col++) {
              const cellValue = String(timesRow[col] || "").trim()
              if (!cellValue) continue

              const dayNum = col + 1 // col 0 = day 1, col 1 = day 2, etc.
              if (dayNum < 1 || dayNum > 31) continue

              const timeMatches = cellValue.match(/(\d{1,2}:\d{2})/g)
              if (!timeMatches || timeMatches.length === 0) continue

              let clockIn: string | null = null
              let clockOut: string | null = null

              if (timeMatches.length >= 2) {
                // Two times: first is entry, last is exit
                clockIn = timeMatches[0]
                clockOut = timeMatches[timeMatches.length - 1]
              } else {
                // Single time: determine if it's entry or exit based on time of day
                // Shift starts ~05:00, ends ~16:00. Midpoint ~10:30.
                // If the single time is after 10:00, it's likely a clock_out (forgot to clock in)
                // If before 10:00, it's likely a clock_in (forgot to clock out)
                const singleTime = timeMatches[0]
                const [hh] = singleTime.split(":").map(Number)
                if (hh >= 10) {
                  clockOut = singleTime  // Only clocked out, no entry
                } else {
                  clockIn = singleTime   // Only clocked in, no exit
                }
              }

              const actualDate = new Date(startYear, startMonth - 1, startDay + dayNum - 1)
              const dateStr = `${actualDate.getFullYear()}-${String(actualDate.getMonth() + 1).padStart(2, "0")}-${String(actualDate.getDate()).padStart(2, "0")}`

              const mapKey = `${emp.id}-${dateStr}`
              attendanceMap.set(mapKey, {
                employee_id: emp.id,
                attendance_date: dateStr,
                clock_in: clockIn,
                clock_out: clockOut,
              })
            }
          }

          i += 3
          continue
        }

        i++
      }

      // Build per-day stats for ALL days so user can review
      const presentByDay = new Map<string, number>()
      for (const rec of attendanceMap.values()) {
        presentByDay.set(rec.attendance_date, (presentByDay.get(rec.attendance_date) || 0) + 1)
      }
      const totalEmpCount = matchedEmployeeIds.size

      const allDayStats: { date: string; present: number; absent: number }[] = []
      for (const dateStr of allDates) {
        const present = presentByDay.get(dateStr) || 0
        const absent = totalEmpCount - present
        allDayStats.push({ date: dateStr, present, absent })
      }

      // Pre-mark days with 0 clock-ins as "no production" (likely weekends/holidays)
      const autoNoProd = new Set<string>()
      for (const day of allDayStats) {
        if (day.present === 0) {
          autoNoProd.add(day.date)
        }
      }

      const records = Array.from(attendanceMap.values())
      setRanchosParseResult({
        records,
        unmatched: Array.from(unmatchedNames),
        suspiciousDays: allDayStats,
        allEmployeeIds: Array.from(matchedEmployeeIds),
        totalDays: allDates,
      })
      setNoProductionDays(autoNoProd)

      // Always show confirmation step so user can review all days
      setImporting(false)
    } catch {
      setImporting(false)
    }
  }

  async function finalizeRanchosImport(
    records: { employee_id: number; attendance_date: string; clock_in: string | null; clock_out: string | null }[],
    unmatched: string[],
    allEmployeeIds: number[],
    allDates: string[],
    noProdDays: Set<string>
  ) {
    setImporting(true)
    try {
      // Filter out no-production days from records
      const filteredRecords = records.filter(r => !noProdDays.has(r.attendance_date))

      // For production days, mark missing employees as "ausente"
      const productionDays = allDates.filter(d => !noProdDays.has(d))
      const presentKeys = new Set(filteredRecords.map(r => `${r.employee_id}-${r.attendance_date}`))

      const absentRecords: typeof filteredRecords = []
      for (const dateStr of productionDays) {
        for (const empId of allEmployeeIds) {
          const key = `${empId}-${dateStr}`
          if (!presentKeys.has(key)) {
            absentRecords.push({
              employee_id: empId,
              attendance_date: dateStr,
              clock_in: null,
              clock_out: null,
            })
          }
        }
      }

      // For Ranchos: keep clock_out for display, early departures handled in stats logic
      const finalRecords = [
        ...filteredRecords.map(r => ({ ...r, status: "presente" })),
        ...absentRecords.map(r => ({ ...r, status: "ausente" })),
      ]

      if (finalRecords.length > 0) {
        let totalSaved = 0
        for (let b = 0; b < finalRecords.length; b += 100) {
          const batch = finalRecords.slice(b, b + 100)
          const res = await fetch("/api/rrhh/attendance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(batch),
          })
          if (res.ok) {
            totalSaved += batch.length
          } else {
            const errBody = await res.text()
            console.log(`[v0] Import batch ${b}-${b+batch.length} FAILED: status=${res.status}, body=${errBody}, sample=`, JSON.stringify(batch[0]))
          }
        }
        console.log(`[v0] Import complete: ${totalSaved}/${finalRecords.length} saved`)
        await mutateAttendance()
        setImportResult({
          matched: filteredRecords.length,
          unmatched,
          records: totalSaved,
        })
      } else {
        setImportResult({ matched: 0, unmatched, records: 0 })
      }
      setRanchosParseResult(null)
    } finally {
      setImporting(false)
    }
  }

  async function processImport() {
    // Route to plant-specific parser
    if (importPlant === "Ranchos") {
      return processImportRanchos()
    }

    if (!importFile || !employees) return
    setImporting(true)
    try {
      const XLSX = await import("xlsx")
      const data = await importFile.arrayBuffer()
      const workbook = XLSX.read(data, { type: "array" })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const allRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" }) as unknown[][]

      console.log("[v0] Import - Plant:", importPlant)
      console.log("[v0] Import - Sheet names:", workbook.SheetNames)
      console.log("[v0] Import - Total rows:", allRows.length)
      console.log("[v0] Import - First 10 rows:", allRows.slice(0, 10))

      // Filter employees by selected plant
      const plantEmployees = employees.filter(e => e.branch === importPlant)
      console.log("[v0] Import - Employees in", importPlant, ":", plantEmployees.length, plantEmployees.map(e => `${e.last_name}, ${e.first_name}`))

      const empMap = new Map<string, (typeof employees)[0]>()
      for (const emp of plantEmployees) {
        const key1 = `${emp.last_name}, ${emp.first_name}`.toLowerCase().trim()
        const key2 = `${emp.last_name},${emp.first_name}`.toLowerCase().trim()
        const key3 = `${emp.last_name} ${emp.first_name}`.toLowerCase().trim()
        const key4 = `${emp.first_name} ${emp.last_name}`.toLowerCase().trim()
        const key5 = emp.last_name.toLowerCase().trim()
        empMap.set(key1, emp)
        empMap.set(key2, emp)
        empMap.set(key3, emp)
        empMap.set(key4, emp)
        empMap.set(key5, emp)
      }
      console.log("[v0] Import - Employee map keys:", Array.from(empMap.keys()))

      function findEmployee(rawName: string) {
        const name = rawName.toLowerCase().trim()
        if (empMap.has(name)) return empMap.get(name)
        const normalized = name.replace(/\s+/g, " ")
        if (empMap.has(normalized)) return empMap.get(normalized)
        for (const [key, emp] of empMap.entries()) {
          if (name.includes(key) || key.includes(name)) return emp
        }
        return undefined
      }

      const attendanceMap = new Map<string, { employee_id: number; attendance_date: string; clock_in: string | null; clock_out: string | null }>()
      const unmatchedNames = new Set<string>()
      let currentDate = ""

      let rowIndex = 0
      for (const row of allRows) {
        rowIndex++
        const cells = row as unknown[]
        if (!cells || cells.length === 0) continue

        const col0 = String(cells[0] || "").trim()
        if (!col0) continue

        if (col0.toLowerCase().startsWith("personas presentes")) continue

        const dateMatch = col0.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
        if (dateMatch) {
          const day = dateMatch[1].padStart(2, "0")
          const month = dateMatch[2].padStart(2, "0")
          const year = dateMatch[3]
          currentDate = `${year}-${month}-${day}`
          console.log("[v0] Import - Found date:", currentDate, "at row", rowIndex)
          continue
        }

        if (!currentDate) continue

        const col1 = String(cells[1] || "").trim().toLowerCase()
        if (col1 === "persona" || col1 === "legajo") continue

        const empName = col0
        const emp = findEmployee(empName)

        if (!emp) {
          if (empName.length > 2 && !empName.match(/^\d+$/) && empName.includes(",")) {
            unmatchedNames.add(empName)
            console.log("[v0] Import - Unmatched name:", empName)
          }
          continue
        }

        const rawTimes = String(cells[4] || "").trim()
        console.log("[v0] Import - Row", rowIndex, "Employee:", empName, "Times col[4]:", rawTimes, "All cols:", cells.slice(0, 6))
        if (!rawTimes || rawTimes.toLowerCase() === "empleado" || rawTimes.toLowerCase() === "categoria") continue

        const timeMatches = rawTimes.match(/\d{1,2}:\d{2}/g)
        if (!timeMatches || timeMatches.length === 0) {
          console.log("[v0] Import - No time matches found in:", rawTimes)
          continue
        }

        const clockIn = timeMatches[0]
        const clockOut = timeMatches.length > 1 ? timeMatches[timeMatches.length - 1] : null
        console.log("[v0] Import - Parsed times:", clockIn, clockOut)

        const mapKey = `${emp.id}-${currentDate}`
        attendanceMap.set(mapKey, {
          employee_id: emp.id,
          attendance_date: currentDate,
          clock_in: clockIn,
          clock_out: clockOut,
        })
      }
      
      console.log("[v0] Import - Total records found:", attendanceMap.size)
      console.log("[v0] Import - Unmatched names:", Array.from(unmatchedNames))

      const records = Array.from(attendanceMap.values()).map(r => ({
        ...r,
        status: "presente",
      }))

      if (records.length > 0) {
        let totalSaved = 0
        for (let i = 0; i < records.length; i += 100) {
          const batch = records.slice(i, i + 100)
          const res = await fetch("/api/rrhh/attendance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(batch),
          })
          if (res.ok) totalSaved += batch.length
        }

        await mutateAttendance()
        setImportResult({
          matched: attendanceMap.size,
          unmatched: Array.from(unmatchedNames),
          records: totalSaved,
        })
      } else {
        setImportResult({
          matched: 0,
          unmatched: Array.from(unmatchedNames),
          records: 0,
        })
      }
    } finally {
      setImporting(false)
    }
  }

  // Get detailed late/absence records for an employee
  function getEmployeeDetail(emp: Employee) {
    const lateRecords: { date: string; dayName: string; clockIn: string; clockOut: string; minsLate: number; expectedStart: string }[] = []
    const absentRecords: { date: string; dayName: string }[] = []
    const earlyRecords: { date: string; dayName: string; clockIn: string; clockOut: string; minsEarly: number; expectedEnd: string }[] = []
    const noClockInRecords: { date: string; dayName: string; clockOut: string }[] = []

    for (const day of filteredDays) {
      const dow = getDayOfWeek(day)
      if (dow === 0) continue
      const val = getCellValue(emp.id, day)
      const shift = getShiftForDay(emp.id, day)

      if (val.status === "ausente" && !shift.isOptional) {
        absentRecords.push({ 
          date: `${String(day).padStart(2, "0")}/${selectedMonth.padStart(2, "0")}/${selectedYear}`, 
          dayName: DAY_LABELS_FULL[dow] 
        })
      }

      if ((val.status === "presente" || val.status === "justificado") && !val.clock_in) {
        noClockInRecords.push({
          date: `${String(day).padStart(2, "0")}/${selectedMonth.padStart(2, "0")}/${selectedYear}`,
          dayName: DAY_LABELS_FULL[dow],
          clockOut: val.clock_out || "-",
        })
      }

      if (val.clock_in) {
        if (isLate(val.clock_in, emp.id, day)) {
          lateRecords.push({
            date: `${String(day).padStart(2, "0")}/${selectedMonth.padStart(2, "0")}/${selectedYear}`,
            dayName: DAY_LABELS_FULL[dow],
            clockIn: val.clock_in,
            clockOut: val.clock_out || "-",
            minsLate: minutesLate(val.clock_in, emp.id, day),
            expectedStart: shift.start,
          })
        }
        if (isEarlyDeparture(val.clock_in, val.clock_out, emp.id, day)) {
          earlyRecords.push({
            date: `${String(day).padStart(2, "0")}/${selectedMonth.padStart(2, "0")}/${selectedYear}`,
            dayName: DAY_LABELS_FULL[dow],
            clockIn: val.clock_in,
            clockOut: val.clock_out || "-",
            minsEarly: minutesEarlyDeparture(val.clock_in, val.clock_out, emp.id, day),
            expectedEnd: shift.end,
          })
        }
      }
    }

    return { lateRecords, absentRecords, earlyRecords, noClockInRecords }
  }

  // Open schedule editor for an employee
  function openScheduleEditor(emp: Employee) {
    setScheduleEmployee(emp)
    setShowScheduleHistory(false)

    // Pre-fill with current schedule or defaults
    const current = getCurrentSchedule(emp.id)
    const firstOfMonth = `${selectedYear}-${selectedMonth.padStart(2, "0")}-01`
    setScheduleEffectiveFrom(firstOfMonth)

    // Build weekly schedule from current data
    const weekly: { day_of_week: number; shift_start: string; shift_end: string; is_optional: boolean }[] = []
    for (let d = 0; d <= 6; d++) {
      const existing = current.find(c => c.day_of_week === d)
      if (d === 0) {
        weekly.push({ day_of_week: d, shift_start: "", shift_end: "", is_optional: true })
      } else if (existing) {
        weekly.push({ day_of_week: d, shift_start: existing.start, shift_end: existing.end, is_optional: existing.isOptional })
      } else {
        const start = formatTime(emp.shift_start, d === 6 ? "" : DEFAULT_SHIFT_START)
        const end = formatTime(emp.shift_end, d === 6 ? "" : DEFAULT_SHIFT_END)
        weekly.push({ day_of_week: d, shift_start: start, shift_end: end, is_optional: d === 6 })
      }
    }
    setWeeklySchedule(weekly)
  }

  // Save weekly schedule
  async function saveWeeklySchedule() {
    if (!scheduleEmployee || !scheduleEffectiveFrom) return
    setSavingSchedule(true)
    try {
      // Only save days that have a schedule (non-empty start and end)
      const daysToSave = weeklySchedule
        .filter(d => d.shift_start && d.shift_end)
        .map(d => ({
          day_of_week: d.day_of_week,
          shift_start: d.shift_start,
          shift_end: d.shift_end,
          is_optional: d.is_optional,
        }))

      const res = await fetch("/api/rrhh/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: scheduleEmployee.id,
          effective_from: scheduleEffectiveFrom,
          days: daysToSave,
        }),
      })

      if (res.ok) {
        await mutateSchedules()
        setScheduleEmployee(null)
      }
    } finally {
      setSavingSchedule(false)
    }
  }

  // Delete a schedule version
  async function deleteScheduleVersion(empId: number, effectiveFrom: string) {
    const res = await fetch("/api/rrhh/schedules", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_id: empId, effective_from: effectiveFrom }),
    })
    if (res.ok) await mutateSchedules()
  }

  // Helper: get a display summary of current schedule for an employee
  function getScheduleSummary(empId: number): string {
    const current = getCurrentSchedule(empId)
    if (current.length === 0) {
      const emp = (employees || []).find(e => e.id === empId)
      return `${formatTime(emp?.shift_start, DEFAULT_SHIFT_START)}-${formatTime(emp?.shift_end, DEFAULT_SHIFT_END)}`
    }
    // Check if all days have the same schedule
    const weekdays = current.filter(c => c.day_of_week >= 1 && c.day_of_week <= 5)
    if (weekdays.length > 0) {
      const allSame = weekdays.every(d => d.start === weekdays[0].start && d.end === weekdays[0].end)
      if (allSame) {
        return `${weekdays[0].start}-${weekdays[0].end}`
      }
    }
    return "Variable"
  }

  const hasEdits = Object.keys(editedCells).length > 0

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => changeMonth(-1)} className="bg-transparent">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Select value={selectedMonth} onValueChange={v => { setSelectedMonth(v); setEditedCells({}) }}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={selectedYear} onValueChange={v => { setSelectedYear(v); setEditedCells({}) }}>
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
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${quincena === "q1" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              1ra Quincena
            </button>
            <button
              onClick={() => setQuincena("all")}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${quincena === "all" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              Mes
            </button>
            <button
              onClick={() => setQuincena("q2")}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${quincena === "q2" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              2da Quincena
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            className="gap-2 bg-transparent"
            onClick={() => { setShowImportDialog(true); setImportPlant(""); setImportPreview(null); setImportFile(null); setImportResult(null) }}
          >
            <Upload className="h-4 w-4" />
            Importar Fichadas
          </Button>
          <Select value={filterBranch} onValueChange={setFilterBranch}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="Villa Rosa">Villa Rosa</SelectItem>
              <SelectItem value="Ranchos">Ranchos</SelectItem>
              <SelectItem value="Olivera">Olivera</SelectItem>
            </SelectContent>
          </Select>
          {hasEdits && (
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              <Save className="h-4 w-4" />
              {saving ? "Guardando..." : `Guardar (${Object.keys(editedCells).length})`}
            </Button>
          )}
        </div>
      </div>

      {/* Grid */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Grilla de Asistencia - {MONTHS[Number(selectedMonth) - 1]} {selectedYear}{quincena === "q1" ? " (1ra Quincena: 1-15)" : quincena === "q2" ? " (2da Quincena: 16-" + daysCount + ")" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[70vh]" style={{ scrollbarGutter: 'stable' }}>
            <table className="text-xs border-collapse" style={{ minWidth: 'max-content' }}>
              <thead className="sticky top-0 z-20">
                <tr className="border-b bg-muted">
                  <th className="sticky left-0 z-30 bg-muted px-2 py-2 text-left font-medium min-w-[160px] border-r shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">Empleado</th>
                  {filteredDays.map(day => {
                    const dow = getDayOfWeek(day)
                    const isSunday = dow === 0
                    const isSaturday = dow === 6
                    return (
                      <th key={day} className={`px-1 py-2 text-center font-medium min-w-[70px] ${isSunday ? 'bg-muted/80 text-muted-foreground' : isSaturday ? 'bg-muted' : 'bg-muted'}`}>
                        <div>{day}</div>
                        <div className="text-[10px] font-normal text-muted-foreground">
                          {DAY_LABELS[dow]}
                        </div>
                      </th>
                    )
                  })}
                  <th className="bg-muted px-2 py-2 text-center font-medium min-w-[80px] border-l">Horario</th>
                  <th className="bg-muted px-2 py-2 text-center font-medium min-w-[50px]">Pres.</th>
                  <th className="bg-muted px-2 py-2 text-center font-medium min-w-[50px]">Faltas</th>
                  <th className="bg-muted px-2 py-2 text-center font-medium min-w-[50px]">Tardes</th>
                  <th className="bg-muted px-2 py-2 text-center font-medium min-w-[60px]">Min Tarde</th>
                  <th className="bg-amber-100 px-2 py-2 text-center font-medium min-w-[50px] text-amber-800">S/Fich</th>
                  <th className="bg-muted px-2 py-2 text-center font-medium min-w-[60px]">Sal. Temp.</th>
                  <th className="bg-muted px-2 py-2 text-center font-medium min-w-[65px]">Min S.T.</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map(emp => {
                  const stats = getEmployeeStats(emp)
                  const summary = getScheduleSummary(emp.id)
                  return (
                    <tr key={emp.id} className="border-b hover:bg-muted/30">
                      <td className="sticky left-0 z-10 bg-card px-2 py-1.5 font-medium border-r shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">
                        <button
                          type="button"
                          className="text-left w-full group"
                          onClick={() => openScheduleEditor(emp)}
                        >
                          <div className="truncate max-w-[150px] group-hover:text-primary group-hover:underline underline-offset-2 transition-colors">
                            {emp.last_name}, {emp.first_name}
                          </div>
                          <div className="text-[9px] text-muted-foreground flex items-center gap-1">
                            <Clock className="h-2.5 w-2.5" />
                            {summary}
                          </div>
                        </button>
                      </td>
                      {filteredDays.map(day => {
                        const dow = getDayOfWeek(day)
                        const isSunday = dow === 0
                        const val = getCellValue(emp.id, day)
                        const late = isLate(val.clock_in, emp.id, day)
                        const earlyDep = isEarlyDeparture(val.clock_in, val.clock_out, emp.id, day)
                        const isEdited = !!editedCells[cellKey(emp.id, day)]

                        if (isSunday) {
                          return <td key={day} className="bg-muted/50 text-center text-muted-foreground px-1 py-1">-</td>
                        }

                        const noClockIn = (val.status === "presente" || val.status === "justificado") && !val.clock_in

                        return (
                          <td key={day} className={`px-0.5 py-0.5 ${dow === 6 ? 'bg-blue-50/50' : ''} ${isEdited ? 'bg-primary/5' : ''} ${val.status === 'ausente' ? 'bg-destructive/10' : ''} ${noClockIn ? 'bg-amber-50' : ''}`}>
                            <div className="flex flex-col gap-0.5">
                              {noClockIn && !val.clock_in ? (
                                <div className="h-6 flex items-center justify-center">
                                  <span className="text-[9px] font-bold text-amber-600 bg-amber-100 rounded px-1.5 py-0.5">S/FICHAR</span>
                                </div>
                              ) : (
                              <Input
                                type="time"
                                value={val.clock_in}
                                onChange={e => updateCell(emp.id, day, "clock_in", e.target.value)}
                                className={`h-6 text-[10px] px-1 border-0 bg-transparent ${late ? 'text-orange-600 font-bold' : ''}`}
                                placeholder="--:--"
                              />
                              )}
                              <Input
                                type="time"
                                value={val.clock_out}
                                onChange={e => updateCell(emp.id, day, "clock_out", e.target.value)}
                                className={`h-6 text-[10px] px-1 border-0 bg-transparent ${earlyDep ? 'text-purple-600 font-bold' : ''}`}
                                placeholder="--:--"
                              />
                              <select
                                value={val.status}
                                onChange={e => updateCell(emp.id, day, "status", e.target.value)}
                                className="h-5 text-[9px] bg-transparent border-0 cursor-pointer"
                              >
                                <option value="presente">Pres.</option>
                                <option value="ausente">Aus.</option>
                                <option value="justificado">Just.</option>
                                <option value="vacaciones">Vac.</option>
                                <option value="licencia">Lic.</option>
                                <option value="feriado">Fer.</option>
                              </select>
                            </div>
                          </td>
                        )
                      })}
                      <td className="text-center text-[10px] font-medium border-l">
                        <button
                          type="button"
                          className="hover:text-primary hover:underline underline-offset-2"
                          onClick={() => openScheduleEditor(emp)}
                        >
                          {summary}
                        </button>
                      </td>
                      <td className="text-center font-bold text-green-700">{stats.presentDays}</td>
                      <td className="text-center font-bold text-red-600">{stats.absentDays}</td>
                      <td className="text-center font-bold text-orange-600">{stats.lateDays}</td>
                      <td className="text-center font-bold text-orange-600">{stats.totalMinutesLate}</td>
                      <td className={`text-center font-bold ${stats.noClockInDays > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>{stats.noClockInDays}</td>
                      <td className="text-center font-bold text-purple-600">{stats.earlyDepartures}</td>
                      <td className="text-center font-bold text-purple-600">{stats.totalMinutesEarly}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Import Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Importar Fichadas desde Excel
            </DialogTitle>
            <DialogDescription>
              Subi el archivo Excel con las fichadas. Se mostrara una vista previa antes de procesar.
            </DialogDescription>
          </DialogHeader>

          {!importPreview && !importResult && !importPlant && (
            <div className="flex flex-col gap-4 py-4">
              <p className="text-sm text-muted-foreground">Selecciona la planta del archivo a importar. Cada planta puede tener un formato de Excel distinto.</p>
              <div className="grid grid-cols-3 gap-3">
                {["Villa Rosa", "Ranchos", "Olivera"].map(plant => (
                  <Button
                    key={plant}
                    variant="outline"
                    className="h-20 flex flex-col gap-1 bg-transparent hover:bg-primary/5 hover:border-primary"
                    onClick={() => setImportPlant(plant)}
                  >
                    <span className="font-semibold">{plant}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {plant === "Ranchos" ? "Registro asistencia" : "Formato estandar"}
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          )}

          {!importPreview && !importResult && importPlant && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className="text-xs">{importPlant}</Badge>
                <Button variant="ghost" size="sm" className="text-xs h-6 px-2" onClick={() => { setImportPlant(""); setImportFile(null) }}>
                  Cambiar planta
                </Button>
              </div>
              {importPlant === "Ranchos" && (
                <p className="text-xs text-muted-foreground text-center max-w-md">
                  Se importara desde la solapa &quot;Registro asistencia&quot;. El formato esperado es el del fichero de Ranchos con bloques por empleado (ID, Nombre, horarios por dia).
                </p>
              )}
              <div className="border-2 border-dashed border-muted-foreground/30 rounded-lg p-8 w-full text-center hover:border-primary/50 transition-colors">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  id="excel-upload"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) handleFileUpload(file)
                  }}
                />
                <label htmlFor="excel-upload" className="cursor-pointer flex flex-col items-center gap-3">
                  <Upload className="h-10 w-10 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Seleccionar archivo Excel</p>
                    <p className="text-xs text-muted-foreground mt-1">Formatos: .xlsx, .xls, .csv</p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {importPreview && !importResult && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 text-sm">
                <FileSpreadsheet className="h-4 w-4 text-green-600" />
                <span className="font-medium">{importFile?.name}</span>
                <span className="text-muted-foreground">- {importPreview.rows.length} filas de preview</span>
              </div>
              
              <div className="overflow-x-auto border rounded-lg max-h-[400px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50 sticky top-0">
                      <th className="px-2 py-1.5 text-left text-muted-foreground font-medium">#</th>
                      {importPreview.headers.map((h, i) => (
                        <th key={i} className="px-2 py-1.5 text-left font-medium min-w-[100px]">
                          {h || `Col ${i + 1}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.rows.map((row, ri) => (
                      <tr key={ri} className="border-t hover:bg-muted/30">
                        <td className="px-2 py-1 text-muted-foreground">{ri + 1}</td>
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-2 py-1 truncate max-w-[200px]">{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">{importPlant}</Badge>
                <p className="text-xs text-muted-foreground">
                  {importPlant === "Ranchos"
                    ? "Se procesara con el formato de Ranchos (bloques ID/Nombre/Horarios por dia)."
                    : "El sistema detectara automaticamente las columnas de nombre, fecha y horarios."}
                </p>
              </div>
            </div>
          )}

          {/* Ranchos: Day-by-day production confirmation */}
          {ranchosParseResult && !importResult && (
            <div className="flex flex-col gap-4 py-4">
              <div className="border border-border rounded-lg p-4">
                <h4 className="font-semibold text-foreground mb-1">Confirmar dias de produccion</h4>
                <p className="text-xs text-muted-foreground mb-3">
                  Revisa cada dia y marca los que <strong>NO tuvieron produccion</strong> (domingos, feriados, etc.). Los dias sin produccion se excluyen del control de asistencia.
                </p>
                <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
                  {ranchosParseResult.suspiciousDays.map(day => {
                    const d = new Date(day.date + "T12:00:00")
                    const dayLabel = d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })
                    const isNoProd = noProductionDays.has(day.date)
                    const isSunday = d.getDay() === 0
                    return (
                      <button
                        key={day.date}
                        type="button"
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                          isNoProd
                            ? "bg-red-50 border-red-200 text-red-900"
                            : "bg-green-50 border-green-200 text-green-900"
                        }`}
                        onClick={() => {
                          setNoProductionDays(prev => {
                            const next = new Set(prev)
                            if (next.has(day.date)) next.delete(day.date)
                            else next.add(day.date)
                            return next
                          })
                        }}
                      >
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                          isNoProd ? "border-red-400 bg-red-100" : "border-green-400 bg-green-100"
                        }`}>
                          {isNoProd && <span className="text-red-600 text-xs font-bold">X</span>}
                          {!isNoProd && <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
                        </div>
                        <span className="font-medium capitalize flex-1 text-left">{dayLabel}{isSunday ? " (domingo)" : ""}</span>
                        <span className="text-xs opacity-70">
                          {day.present} ficharon
                        </span>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                          isNoProd ? "bg-red-200 text-red-800" : "bg-green-200 text-green-800"
                        }`}>
                          {isNoProd ? "SIN PRODUCCION" : "CON PRODUCCION"}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                En dias con produccion, los operarios que no ficharon se registran como <strong>falta</strong>. Las salidas tempranas no se contabilizan para Ranchos. Hace click en un dia para cambiar su estado.
              </p>
            </div>
          )}

          {importResult && (
            <div className="flex flex-col gap-4 py-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h4 className="font-semibold text-green-800 mb-2">Importacion completada</h4>
                <div className="text-sm text-green-700 flex flex-col gap-1">
                  <p>Fichadas importadas: <span className="font-bold">{importResult.matched}</span></p>
                  <p>Total registros guardados: <span className="font-bold">{importResult.records}</span></p>
                </div>
              </div>
              {importResult.unmatched.length > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <h4 className="font-semibold text-orange-800 mb-2">Nombres no reconocidos ({importResult.unmatched.length})</h4>
                  <div className="text-xs text-orange-700 flex flex-col gap-0.5 max-h-[150px] overflow-y-auto">
                    {importResult.unmatched.map((name, i) => (
                      <p key={i}>- {name}</p>
                    ))}
                  </div>
                  <p className="text-xs text-orange-600 mt-2">Estos nombres no pudieron ser asociados a empleados registrados.</p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {importPreview && !importResult && !ranchosParseResult && (
              <div className="flex gap-2 w-full justify-between">
                <Button variant="outline" className="bg-transparent" onClick={() => { setImportPreview(null); setImportFile(null) }}>
                  Cambiar archivo
                </Button>
                <Button onClick={processImport} disabled={importing} className="gap-2">
                  {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {importing ? "Procesando..." : "Procesar e Importar"}
                </Button>
              </div>
            )}
            {ranchosParseResult && !importResult && (
              <div className="flex gap-2 w-full justify-between">
                <Button variant="outline" className="bg-transparent" onClick={() => { setRanchosParseResult(null); setImportPreview(null); setImportFile(null) }}>
                  Cancelar
                </Button>
                <Button
                  onClick={() => finalizeRanchosImport(
                    ranchosParseResult.records,
                    ranchosParseResult.unmatched,
                    ranchosParseResult.allEmployeeIds,
                    ranchosParseResult.totalDays,
                    noProductionDays
                  )}
                  disabled={importing}
                  className="gap-2"
                >
                  {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {importing ? "Importando..." : "Confirmar e Importar"}
                </Button>
              </div>
            )}
            {importResult && (
              <Button onClick={() => { setShowImportDialog(false); setImportPreview(null); setImportFile(null); setImportResult(null); setRanchosParseResult(null) }}>
                Cerrar
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Analysis Summary */}
      {filteredEmployees.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Llegadas tarde ranking */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-500" />
                Ranking Llegadas Tarde
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empleado</TableHead>
                    <TableHead className="text-center">Veces</TableHead>
                    <TableHead className="text-center">Min. Acum.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEmployees
                    .map(emp => ({ ...emp, stats: getEmployeeStats(emp) }))
                    .filter(emp => emp.stats.lateDays > 0)
                    .sort((a, b) => b.stats.lateDays - a.stats.lateDays)
                    .slice(0, 10)
                    .map(emp => (
                      <TableRow key={emp.id} className="cursor-pointer hover:bg-orange-50/50" onClick={() => setDetailEmployee(emp)}>
                        <TableCell className="font-medium text-primary underline underline-offset-2">{emp.last_name}, {emp.first_name}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">{emp.stats.lateDays}</Badge>
                        </TableCell>
                        <TableCell className="text-center text-orange-600 font-semibold">{emp.stats.totalMinutesLate} min</TableCell>
                      </TableRow>
                    ))
                  }
                  {filteredEmployees.every(emp => getEmployeeStats(emp).lateDays === 0) && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground py-4">Sin llegadas tarde registradas</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Ausencias ranking */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <UserX className="h-4 w-4 text-red-500" />
                Ranking Ausencias
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empleado</TableHead>
                    <TableHead className="text-center">Faltas</TableHead>
                    <TableHead className="text-center">Presentismo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEmployees
                    .map(emp => ({ ...emp, stats: getEmployeeStats(emp) }))
                    .filter(emp => emp.stats.absentDays > 0)
                    .sort((a, b) => b.stats.absentDays - a.stats.absentDays)
                    .slice(0, 10)
                    .map(emp => {
                      const total = emp.stats.presentDays + emp.stats.absentDays
                      const pct = total > 0 ? ((emp.stats.presentDays / total) * 100).toFixed(0) : "-"
                      return (
                        <TableRow key={emp.id} className="cursor-pointer hover:bg-red-50/50" onClick={() => setDetailEmployee(emp)}>
                          <TableCell className="font-medium text-primary underline underline-offset-2">{emp.last_name}, {emp.first_name}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">{emp.stats.absentDays}</Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={`font-semibold ${Number(pct) >= 90 ? 'text-green-600' : Number(pct) >= 75 ? 'text-orange-600' : 'text-red-600'}`}>
                              {pct}%
                            </span>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  }
                  {filteredEmployees.every(emp => getEmployeeStats(emp).absentDays === 0) && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground py-4">Sin ausencias registradas</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Weekly Schedule Editor Dialog */}
      <Dialog open={!!scheduleEmployee} onOpenChange={(open) => { if (!open) setScheduleEmployee(null) }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          {scheduleEmployee && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CalendarDays className="h-5 w-5" />
                  Horario Semanal - {scheduleEmployee.last_name}, {scheduleEmployee.first_name}
                </DialogTitle>
                <DialogDescription>
                  Configura el horario por dia de la semana. Marca como &quot;Opcional&quot; los dias donde la asistencia no es obligatoria (ej: sabados). Si no viene, no se contabiliza como falta, pero si viene se analizan tardanzas normalmente.
                </DialogDescription>
              </DialogHeader>

              {/* Effective From */}
              <div className="flex flex-col gap-2">
                <Label className="text-sm font-semibold">Vigente desde</Label>
                <Input
                  type="date"
                  value={scheduleEffectiveFrom}
                  onChange={e => setScheduleEffectiveFrom(e.target.value)}
                  className="max-w-[200px]"
                />
                <p className="text-xs text-muted-foreground">
                  Este horario se aplicara para calcular tardanzas y salidas tempranas desde esta fecha en adelante. Los periodos anteriores mantienen su horario original.
                </p>
              </div>

              {/* Weekly grid */}
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 text-xs">
                      <th className="px-3 py-2 text-left font-medium">Dia</th>
                      <th className="px-3 py-2 text-center font-medium">Ingreso</th>
                      <th className="px-3 py-2 text-center font-medium">Egreso</th>
                      <th className="px-3 py-2 text-center font-medium">Opcional</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeklySchedule.map((d, idx) => {
                      const isSunday = d.day_of_week === 0
                      return (
                        <tr key={d.day_of_week} className={`border-t ${isSunday ? 'bg-muted/30' : ''} ${d.is_optional && !isSunday ? 'bg-blue-50/30' : ''}`}>
                          <td className={`px-3 py-2 font-medium ${isSunday ? 'text-muted-foreground' : ''}`}>
                            <div className="flex items-center gap-1.5">
                              {DAY_LABELS_FULL[d.day_of_week]}
                              {d.is_optional && !isSunday && (
                                <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Opc.</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            <Input
                              type="time"
                              value={d.shift_start}
                              onChange={e => {
                                const updated = [...weeklySchedule]
                                updated[idx] = { ...updated[idx], shift_start: e.target.value }
                                setWeeklySchedule(updated)
                              }}
                              className="h-8 text-sm max-w-[120px] mx-auto"
                              disabled={isSunday}
                            />
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            <Input
                              type="time"
                              value={d.shift_end}
                              onChange={e => {
                                const updated = [...weeklySchedule]
                                updated[idx] = { ...updated[idx], shift_end: e.target.value }
                                setWeeklySchedule(updated)
                              }}
                              className="h-8 text-sm max-w-[120px] mx-auto"
                              disabled={isSunday}
                            />
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            <input
                              type="checkbox"
                              checked={d.is_optional}
                              onChange={e => {
                                const updated = [...weeklySchedule]
                                updated[idx] = { ...updated[idx], is_optional: e.target.checked }
                                setWeeklySchedule(updated)
                              }}
                              disabled={isSunday}
                              className="h-4 w-4 rounded border-muted-foreground accent-blue-600"
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Quick fill buttons */}
              <div className="flex flex-wrap gap-2">
                <span className="text-xs text-muted-foreground self-center mr-1">Carga rapida:</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs bg-transparent"
                  onClick={() => {
                    setWeeklySchedule(weeklySchedule.map(d => 
                      d.day_of_week >= 1 && d.day_of_week <= 5 
                        ? { ...d, shift_start: "05:00", shift_end: "16:00", is_optional: false } 
                        : d
                    ))
                  }}
                >
                  Manana (5-16)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs bg-transparent"
                  onClick={() => {
                    setWeeklySchedule(weeklySchedule.map(d => 
                      d.day_of_week >= 1 && d.day_of_week <= 5 
                        ? { ...d, shift_start: "14:00", shift_end: "22:00", is_optional: false } 
                        : d
                    ))
                  }}
                >
                  Tarde (14-22)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs bg-transparent"
                  onClick={() => {
                    setWeeklySchedule(weeklySchedule.map(d => 
                      d.day_of_week >= 1 && d.day_of_week <= 5 
                        ? { ...d, shift_start: "07:00", shift_end: "16:00", is_optional: false } 
                        : d
                    ))
                  }}
                >
                  Admin (7-16)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs bg-transparent"
                  onClick={() => {
                    setWeeklySchedule(weeklySchedule.map(d => 
                      d.day_of_week >= 1 && d.day_of_week <= 5 
                        ? { ...d, shift_start: "22:00", shift_end: "06:00", is_optional: false } 
                        : d
                    ))
                  }}
                >
                  Noche (22-6)
                </Button>
              </div>

              {/* Schedule History Toggle */}
              <div className="border-t pt-3">
                <button
                  type="button"
                  className="text-xs text-primary hover:underline underline-offset-2 flex items-center gap-1"
                  onClick={() => setShowScheduleHistory(!showScheduleHistory)}
                >
                  <Clock className="h-3 w-3" />
                  {showScheduleHistory ? "Ocultar historial de horarios" : "Ver historial de horarios"}
                </button>

                {showScheduleHistory && (
                  <div className="mt-3 flex flex-col gap-3">
                    {getScheduleVersions(scheduleEmployee.id).length === 0 ? (
                      <p className="text-xs text-muted-foreground">No hay horarios previos cargados para este empleado.</p>
                    ) : (
                      getScheduleVersions(scheduleEmployee.id).map(effectiveDate => {
                        const version = getScheduleVersion(scheduleEmployee.id, effectiveDate)
                        return (
                          <div key={effectiveDate} className="border rounded-lg overflow-hidden">
                            <div className="bg-muted/50 px-3 py-1.5 flex items-center justify-between">
                              <span className="text-xs font-semibold">
                                Vigente desde: {new Date(effectiveDate + "T12:00:00").toLocaleDateString("es-AR")}
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                                onClick={() => deleteScheduleVersion(scheduleEmployee.id, effectiveDate)}
                              >
                                <Trash2 className="h-3 w-3 mr-1" />
                                Eliminar
                              </Button>
                            </div>
                            <div className="px-3 py-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                              {version.map(v => (
                                <span key={v.day_of_week} className="text-muted-foreground">
                                  <span className="font-medium text-foreground">{DAY_LABELS[v.day_of_week]}:</span>{" "}
                                  {formatTime(v.shift_start, "-")}-{formatTime(v.shift_end, "-")}
                                  {v.is_optional && <span className="ml-1 text-[9px] bg-blue-100 text-blue-600 px-1 rounded">opc</span>}
                                </span>
                              ))}
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" className="bg-transparent" onClick={() => setScheduleEmployee(null)}>
                  Cancelar
                </Button>
                <Button onClick={saveWeeklySchedule} disabled={savingSchedule || !scheduleEffectiveFrom} className="gap-2">
                  {savingSchedule ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Guardar Horario
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Employee Detail Dialog */}
      <Dialog open={!!detailEmployee} onOpenChange={(open) => { if (!open) setDetailEmployee(null) }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {detailEmployee && (() => {
            const detail = getEmployeeDetail(detailEmployee)
            const stats = getEmployeeStats(detailEmployee)
            return (
              <>
                <DialogHeader>
                  <DialogTitle>{detailEmployee.last_name}, {detailEmployee.first_name}</DialogTitle>
                  <DialogDescription>
                    Detalle de asistencia - {MONTHS[Number(selectedMonth) - 1]} {selectedYear}
                  </DialogDescription>
                </DialogHeader>

                {/* Summary cards */}
                <div className="grid grid-cols-4 gap-3 my-2">
                  <div className="border rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-orange-600">{stats.lateDays}</div>
                    <div className="text-xs text-muted-foreground">Llegadas tarde</div>
                    <div className="text-xs font-semibold text-orange-600">{stats.totalMinutesLate} min</div>
                  </div>
                  <div className="border rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-red-600">{stats.absentDays}</div>
                    <div className="text-xs text-muted-foreground">Faltas</div>
                  </div>
                  <div className="border rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-purple-600">{stats.earlyDepartures}</div>
                    <div className="text-xs text-muted-foreground">Salidas tempranas</div>
                    <div className="text-xs font-semibold text-purple-600">{stats.totalMinutesEarly} min</div>
                  </div>
                  <div className={`border rounded-lg p-3 text-center ${stats.noClockInDays > 0 ? 'border-amber-300 bg-amber-50' : ''}`}>
                    <div className={`text-2xl font-bold ${stats.noClockInDays > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>{stats.noClockInDays}</div>
                    <div className="text-xs text-muted-foreground">Sin fichar entrada</div>
                    {stats.noClockInDays > 0 && <div className="text-[10px] text-amber-600 font-medium mt-0.5">Llamado de atencion</div>}
                  </div>
                </div>

                {/* Late records */}
                {detail.lateRecords.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-sm flex items-center gap-2 mb-2">
                      <Clock className="h-4 w-4 text-orange-500" />
                      Llegadas Tarde ({detail.lateRecords.length})
                    </h4>
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/50 text-xs">
                            <th className="px-3 py-2 text-left">Fecha</th>
                            <th className="px-3 py-2 text-left">Dia</th>
                            <th className="px-3 py-2 text-center">Hora esperada</th>
                            <th className="px-3 py-2 text-center">Entrada</th>
                            <th className="px-3 py-2 text-center">Min. Tarde</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.lateRecords.map((r, i) => (
                            <tr key={i} className="border-t hover:bg-orange-50/30">
                              <td className="px-3 py-1.5">{r.date}</td>
                              <td className="px-3 py-1.5 text-muted-foreground">{r.dayName}</td>
                              <td className="px-3 py-1.5 text-center font-mono text-muted-foreground">{r.expectedStart}</td>
                              <td className="px-3 py-1.5 text-center font-mono font-semibold text-orange-600">{r.clockIn}</td>
                              <td className="px-3 py-1.5 text-center font-bold text-orange-600">+{r.minsLate} min</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* No clock-in records */}
                {detail.noClockInRecords.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-sm flex items-center gap-2 mb-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      Sin fichar entrada ({detail.noClockInRecords.length}) - Llamado de atencion
                    </h4>
                    <p className="text-xs text-muted-foreground mb-2">
                      Se contabiliza como llegada en horario pero queda registrado que no ficho el ingreso.
                    </p>
                    <div className="border border-amber-200 rounded-lg overflow-hidden bg-amber-50/30">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-amber-100/50 text-xs">
                            <th className="px-3 py-2 text-left">Fecha</th>
                            <th className="px-3 py-2 text-left">Dia</th>
                            <th className="px-3 py-2 text-center">Salida</th>
                            <th className="px-3 py-2 text-center">Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.noClockInRecords.map((r, i) => (
                            <tr key={i} className="border-t border-amber-200 hover:bg-amber-50/50">
                              <td className="px-3 py-1.5">{r.date}</td>
                              <td className="px-3 py-1.5 text-muted-foreground">{r.dayName}</td>
                              <td className="px-3 py-1.5 text-center font-mono">{r.clockOut}</td>
                              <td className="px-3 py-1.5 text-center">
                                <span className="text-[10px] font-bold text-amber-700 bg-amber-200 rounded px-2 py-0.5">NO FICHO ENTRADA</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Absent records */}
                {detail.absentRecords.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-sm flex items-center gap-2 mb-2">
                      <UserX className="h-4 w-4 text-red-500" />
                      Faltas ({detail.absentRecords.length})
                    </h4>
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/50 text-xs">
                            <th className="px-3 py-2 text-left">Fecha</th>
                            <th className="px-3 py-2 text-left">Dia</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.absentRecords.map((r, i) => (
                            <tr key={i} className="border-t hover:bg-red-50/30">
                              <td className="px-3 py-1.5">{r.date}</td>
                              <td className="px-3 py-1.5 text-muted-foreground">{r.dayName}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Early departure records */}
                {detail.earlyRecords.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-sm flex items-center gap-2 mb-2">
                      <TrendingUp className="h-4 w-4 text-purple-500" />
                      Salidas Tempranas ({detail.earlyRecords.length})
                    </h4>
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/50 text-xs">
                            <th className="px-3 py-2 text-left">Fecha</th>
                            <th className="px-3 py-2 text-left">Dia</th>
                            <th className="px-3 py-2 text-center">Salida</th>
                            <th className="px-3 py-2 text-center">Hora esperada</th>
                            <th className="px-3 py-2 text-center">Min. Antes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.earlyRecords.map((r, i) => (
                            <tr key={i} className="border-t hover:bg-purple-50/30">
                              <td className="px-3 py-1.5">{r.date}</td>
                              <td className="px-3 py-1.5 text-muted-foreground">{r.dayName}</td>
                              <td className="px-3 py-1.5 text-center font-mono font-semibold text-purple-600">{r.clockOut}</td>
                              <td className="px-3 py-1.5 text-center font-mono text-muted-foreground">{r.expectedEnd}</td>
                              <td className="px-3 py-1.5 text-center font-bold text-purple-600">-{r.minsEarly} min</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {detail.lateRecords.length === 0 && detail.absentRecords.length === 0 && detail.earlyRecords.length === 0 && (
                  <p className="text-center text-muted-foreground py-6">Sin novedades registradas para este empleado en el periodo seleccionado.</p>
                )}
              </>
            )
          })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}
