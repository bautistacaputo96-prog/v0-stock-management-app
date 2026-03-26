"use client"

import { useRef, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { FileDown, Loader2, Eye } from "lucide-react"
import { exportElementToPDF } from "@/lib/pdf-export"

interface Employee {
  id: number
  first_name: string
  last_name: string
  employee_id?: string
  branch: string
}

interface AttendanceRecord {
  id?: number
  employee_id: number
  attendance_date: string
  clock_in: string | null
  clock_out: string | null
  status: string
}

interface ScheduleInfo {
  start: string
  isOptional: boolean
}

const PRESENTISMO_TEXT = `PRESENTISMO
Para cobrar el mismo, se debe cumplir con el TOTAL de las horas de la quincena. No se deben registrar faltas ni llegadas tardes que superen las estipuladas por la empresa.
Es decir, se considera llegada tarde a cualquier operario que pasados los 5 minutos de horario de entrada, registre el ingreso en el fichero.
La acumulacion de 3 llegadas tardes en el mes implica la perdida del presentismo sin excepcion.`

const DAY_NAMES = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"]
const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number)
  return h * 60 + m
}

function normalizeClockTimes(clockIn: string | null, clockOut: string | null): { clockIn: string | null; clockOut: string | null } {
  if (clockIn && !clockOut) {
    const [hh] = clockIn.split(":").map(Number)
    if (hh >= 10) return { clockIn: null, clockOut: clockIn }
  }
  return { clockIn, clockOut }
}

function fmt(t: string | null): string {
  if (!t) return "-"
  return t.substring(0, 5)
}

// ===== Shared styles =====
const S = {
  page: { fontFamily: "system-ui, -apple-system, sans-serif", fontSize: "9px", color: "#111827", lineHeight: "1.4", padding: "14px 16px", background: "white" } as React.CSSProperties,
  h1: { fontSize: "14px", fontWeight: 700, marginBottom: "2px" } as React.CSSProperties,
  h2: { fontSize: "11px", fontWeight: 600, color: "#374151", marginBottom: "8px" } as React.CSSProperties,
  h3: { fontSize: "10px", fontWeight: 600, marginBottom: "4px", marginTop: "10px" } as React.CSSProperties,
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: "8px" },
  th: { padding: "3px 4px", backgroundColor: "#f3f4f6", borderBottom: "1px solid #d1d5db", fontWeight: 600, textAlign: "center" as const, fontSize: "7px" },
  thLeft: { padding: "3px 4px", backgroundColor: "#f3f4f6", borderBottom: "1px solid #d1d5db", fontWeight: 600, textAlign: "left" as const, fontSize: "7px" },
  td: { padding: "2px 3px", borderBottom: "1px solid #e5e7eb", textAlign: "center" as const, fontSize: "7.5px" },
  tdLeft: { padding: "2px 3px", borderBottom: "1px solid #e5e7eb", textAlign: "left" as const, fontSize: "7.5px" },
  late: { color: "#d97706", fontWeight: 700 },
  absent: { color: "#dc2626", fontWeight: 700 },
  noFich: { color: "#d97706", fontSize: "6px", fontWeight: 700 },
  badge: (color: string, bg: string) => ({ display: "inline-block", padding: "1px 5px", borderRadius: "3px", fontSize: "7px", fontWeight: 600, color, backgroundColor: bg }),
  footer: { marginTop: "12px", padding: "8px 10px", backgroundColor: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "4px", fontSize: "7.5px", lineHeight: "1.5", whiteSpace: "pre-line" as const },
  separator: { borderTop: "1px solid #e5e7eb", margin: "8px 0" },
}

// ===== REPORT 1: Quincena por planta =====
interface QuincenaReportProps {
  employees: Employee[]
  attendance: AttendanceRecord[]
  getScheduleForDate: (empId: number, date: string, dow: number) => ScheduleInfo
  month: number
  year: number
  quincena: "q1" | "q2"
  branch: string
}

function QuincenaReportContent({ employees, attendance, getScheduleForDate, month, year, quincena, branch }: QuincenaReportProps) {
  const daysInMonth = new Date(year, month, 0).getDate()
  const startDay = quincena === "q1" ? 1 : 16
  const endDay = quincena === "q1" ? 15 : daysInMonth
  const days = Array.from({ length: endDay - startDay + 1 }, (_, i) => startDay + i)
  const qLabel = quincena === "q1" ? "1ra Quincena (1-15)" : `2da Quincena (16-${daysInMonth})`

  const sortedEmps = [...employees].sort((a, b) => a.last_name.localeCompare(b.last_name, "es") || a.first_name.localeCompare(b.first_name, "es"))

  // Compute stats per employee
  const empData = sortedEmps.map(emp => {
    let present = 0, absent = 0, late = 0, minsLate = 0, noFich = 0
    const lateDetails: { day: number; clockIn: string; expected: string; mins: number }[] = []
    const absentDays: number[] = []

    for (const day of days) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      const dow = new Date(year, month - 1, day).getDay()
      if (dow === 0) continue
      const schedule = getScheduleForDate(emp.id, dateStr, dow)

      const rec = attendance.find(a => a.employee_id === emp.id && a.attendance_date === dateStr)
      if (!rec || rec.status === "ausente") {
        if (!schedule.isOptional) { absent++; absentDays.push(day) }
        continue
      }

      const norm = normalizeClockTimes(rec.clock_in, rec.clock_out)
      if (norm.clockIn) {
        present++
        const shiftStart = timeToMinutes(schedule.start)
        const ci = timeToMinutes(norm.clockIn.substring(0, 5))
        if (ci > shiftStart + 5) {
          late++
          const m = ci - shiftStart
          minsLate += m
          lateDetails.push({ day, clockIn: norm.clockIn.substring(0, 5), expected: schedule.start, mins: m })
        }
      } else {
        present++
        noFich++
      }
    }
    return { emp, present, absent, late, minsLate, noFich, lateDetails, absentDays }
  })

  return (
    <div style={S.page}>
      <div style={{ textAlign: "center", marginBottom: "10px" }}>
        <div style={S.h1}>INFORME DE ASISTENCIA</div>
        <div style={S.h2}>{branch} - {qLabel} - {MONTHS[month - 1]} {year}</div>
      </div>

      {/* Grid dia por dia */}
      <table style={S.table}>
        <thead>
          <tr>
            <th style={{ ...S.thLeft, minWidth: "70px", position: "sticky" as const, left: 0 }}>Operario</th>
            {days.map(d => {
              const dow = new Date(year, month - 1, d).getDay()
              return (
                <th key={d} style={{ ...S.th, minWidth: "32px", backgroundColor: dow === 0 ? "#e5e7eb" : dow === 6 ? "#eff6ff" : "#f3f4f6" }}>
                  <div>{d}</div>
                  <div style={{ fontSize: "6px", fontWeight: 400, color: "#6b7280" }}>{DAY_NAMES[dow]}</div>
                </th>
              )
            })}
            <th style={{ ...S.th, minWidth: "28px" }}>P</th>
            <th style={{ ...S.th, minWidth: "28px" }}>F</th>
            <th style={{ ...S.th, minWidth: "28px" }}>T</th>
            <th style={{ ...S.th, minWidth: "32px" }}>Min</th>
          </tr>
        </thead>
        <tbody>
          {empData.map(({ emp, present, absent, late: lateCnt, minsLate }) => (
            <tr key={emp.id}>
              <td style={{ ...S.tdLeft, fontWeight: 600, fontSize: "7px", whiteSpace: "nowrap" as const }}>
                {emp.last_name} {emp.first_name}
              </td>
              {days.map(d => {
                const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`
                const dow = new Date(year, month - 1, d).getDay()
                if (dow === 0) return <td key={d} style={{ ...S.td, backgroundColor: "#f3f4f6" }}>-</td>
                const rec = attendance.find(a => a.employee_id === emp.id && a.attendance_date === dateStr)
                if (!rec || rec.status === "ausente") return <td key={d} style={{ ...S.td, backgroundColor: "#fee2e2", color: "#dc2626", fontWeight: 700, fontSize: "7px" }}>F</td>
                const norm = normalizeClockTimes(rec.clock_in, rec.clock_out)
                if (!norm.clockIn) {
                  return (
                    <td key={d} style={{ ...S.td, backgroundColor: "#fef3c7" }}>
                      <div style={S.noFich}>S/F</div>
                      <div style={{ fontSize: "6.5px" }}>{fmt(norm.clockOut)}</div>
                    </td>
                  )
                }
                const schedule = getScheduleForDate(emp.id, dateStr, dow)
                const isL = timeToMinutes(norm.clockIn.substring(0, 5)) > timeToMinutes(schedule.start) + 5
                return (
                  <td key={d} style={{ ...S.td, backgroundColor: isL ? "#fef9c3" : undefined }}>
                    <div style={isL ? S.late : { fontSize: "7px" }}>{fmt(norm.clockIn)}</div>
                    <div style={{ fontSize: "6.5px", color: "#6b7280" }}>{fmt(norm.clockOut)}</div>
                  </td>
                )
              })}
              <td style={{ ...S.td, fontWeight: 700, color: "#16a34a" }}>{present}</td>
              <td style={{ ...S.td, ...(absent > 0 ? S.absent : { color: "#9ca3af" }) }}>{absent}</td>
              <td style={{ ...S.td, ...(lateCnt > 0 ? S.late : { color: "#9ca3af" }) }}>{lateCnt}</td>
              <td style={{ ...S.td, ...(minsLate > 0 ? S.late : { color: "#9ca3af" }) }}>{minsLate}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Detail per employee */}
      {empData.filter(e => e.lateDetails.length > 0 || e.absentDays.length > 0 || e.noFich > 0).map(({ emp, lateDetails, absentDays, noFich, late: lateCnt }) => (
        <div key={emp.id} style={{ marginTop: "8px", padding: "6px 8px", border: "1px solid #e5e7eb", borderRadius: "4px" }}>
          <div style={{ fontSize: "8px", fontWeight: 700, marginBottom: "3px" }}>
            {emp.last_name} {emp.first_name}
            {lateCnt >= 3 && <span style={{ ...S.badge("#dc2626", "#fee2e2"), marginLeft: "6px" }}>PIERDE PRESENTISMO</span>}
          </div>
          {lateDetails.length > 0 && (
            <div style={{ marginBottom: "3px" }}>
              <span style={{ fontWeight: 600, fontSize: "7px" }}>Llegadas tarde ({lateDetails.length}):</span>
              {lateDetails.map((l, i) => (
                <span key={i} style={{ marginLeft: "4px", fontSize: "7px" }}>
                  Dia {l.day} ({l.clockIn} vs {l.expected}, +{l.mins}min){i < lateDetails.length - 1 ? ";" : ""}
                </span>
              ))}
            </div>
          )}
          {absentDays.length > 0 && (
            <div style={{ marginBottom: "3px" }}>
              <span style={{ fontWeight: 600, fontSize: "7px", color: "#dc2626" }}>Faltas ({absentDays.length}):</span>
              <span style={{ fontSize: "7px", marginLeft: "4px" }}>Dias: {absentDays.join(", ")}</span>
            </div>
          )}
          {noFich > 0 && (
            <div>
              <span style={{ fontWeight: 600, fontSize: "7px", color: "#d97706" }}>Sin fichar entrada ({noFich}) - Llamado de atencion</span>
            </div>
          )}
        </div>
      ))}

      {/* Footer */}
      <div style={S.footer}>{PRESENTISMO_TEXT}</div>
    </div>
  )
}

export function QuincenaReportButton({ employees, attendance, getScheduleForDate, month, year, quincena, branch }: QuincenaReportProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const handleExport = useCallback(async () => {
    if (!ref.current) return
    setExporting(true)
    try {
      const qLabel = quincena === "q1" ? "Q1" : "Q2"
      await exportElementToPDF(ref.current, `Asistencia_${branch}_${MONTHS[month - 1]}_${year}_${qLabel}.pdf`)
    } finally { setExporting(false) }
  }, [branch, month, year, quincena])

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2">
        <Eye className="h-4 w-4" />
        Informe Quincena
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[95vw] w-[1100px] max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle>Vista previa - Informe Quincenal por Planta</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto px-6 pb-2">
            <div className="border border-border rounded-lg bg-white" ref={ref}>
              <QuincenaReportContent employees={employees} attendance={attendance} getScheduleForDate={getScheduleForDate} month={month} year={year} quincena={quincena} branch={branch} />
            </div>
          </div>
          <DialogFooter className="px-6 pb-6 pt-2 border-t border-border">
            <Button variant="outline" onClick={() => setOpen(false)}>Cerrar</Button>
            <Button onClick={handleExport} disabled={exporting} className="gap-2">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
              Descargar PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}


// ===== REPORT 2: Individual quincenal =====
interface IndividualReportProps {
  employee: Employee
  attendance: AttendanceRecord[]
  getScheduleForDate: (empId: number, date: string, dow: number) => ScheduleInfo
  month: number
  year: number
  quincena: "q1" | "q2"
}

function IndividualReportContent({ employee, attendance, getScheduleForDate, month, year, quincena }: IndividualReportProps) {
  const daysInMonth = new Date(year, month, 0).getDate()
  const startDay = quincena === "q1" ? 1 : 16
  const endDay = quincena === "q1" ? 15 : daysInMonth
  const days = Array.from({ length: endDay - startDay + 1 }, (_, i) => startDay + i)
  const qLabel = quincena === "q1" ? "1ra Quincena (1-15)" : `2da Quincena (16-${daysInMonth})`

  let present = 0, absent = 0, late = 0, minsLate = 0, noFich = 0
  const lateDetails: { date: string; dayName: string; clockIn: string; expected: string; mins: number }[] = []
  const dailyRows: { day: number; dayName: string; clockIn: string; clockOut: string; status: string; isLate: boolean; minsLate: number }[] = []

  for (const day of days) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    const dow = new Date(year, month - 1, day).getDay()
    const dayName = DAY_NAMES[dow]

  if (dow === 0) { dailyRows.push({ day, dayName, clockIn: "-", clockOut: "-", status: "Domingo", isLate: false, minsLate: 0 }); continue }
  const schedule = getScheduleForDate(employee.id, dateStr, dow)
  
  const rec = attendance.find(a => a.employee_id === employee.id && a.attendance_date === dateStr)
  if (!rec || rec.status === "ausente") {
  if (schedule.isOptional) { dailyRows.push({ day, dayName, clockIn: "-", clockOut: "-", status: "Optativo", isLate: false, minsLate: 0 }); continue }
  absent++
  dailyRows.push({ day, dayName, clockIn: "-", clockOut: "-", status: "FALTA", isLate: false, minsLate: 0 })
      continue
    }

    const norm = normalizeClockTimes(rec.clock_in, rec.clock_out)
    if (!norm.clockIn) {
      present++; noFich++
      dailyRows.push({ day, dayName, clockIn: "S/FICHAR", clockOut: fmt(norm.clockOut), status: "Sin fichar", isLate: false, minsLate: 0 })
      continue
    }

    present++
    const shiftStart = timeToMinutes(schedule.start)
    const ci = timeToMinutes(norm.clockIn.substring(0, 5))
    const isL = ci > shiftStart + 5
    const mins = isL ? ci - shiftStart : 0
    if (isL) {
      late++; minsLate += mins
      lateDetails.push({ date: `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`, dayName, clockIn: norm.clockIn.substring(0, 5), expected: schedule.start, mins })
    }
    dailyRows.push({ day, dayName, clockIn: fmt(norm.clockIn), clockOut: fmt(norm.clockOut), status: isL ? "Tarde" : "OK", isLate: isL, minsLate: mins })
  }

  return (
    <div style={S.page}>
      <div style={{ textAlign: "center", marginBottom: "10px" }}>
        <div style={S.h1}>INFORME INDIVIDUAL DE ASISTENCIA</div>
        <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "2px" }}>{employee.last_name} {employee.first_name}</div>
        <div style={S.h2}>{employee.branch} - {qLabel} - {MONTHS[month - 1]} {year}</div>
      </div>

      {/* Daily grid */}
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.thLeft}>Dia</th>
            <th style={S.th}>Fecha</th>
            <th style={S.th}>Entrada</th>
            <th style={S.th}>Salida</th>
            <th style={S.th}>Estado</th>
            <th style={S.th}>Min. tarde</th>
          </tr>
        </thead>
        <tbody>
          {dailyRows.map(r => (
            <tr key={r.day}>
              <td style={{ ...S.tdLeft, fontWeight: 600 }}>{r.dayName}</td>
              <td style={S.td}>{String(r.day).padStart(2, "0")}/{String(month).padStart(2, "0")}/{year}</td>
              <td style={{ ...S.td, fontFamily: "monospace", ...(r.isLate ? S.late : r.clockIn === "S/FICHAR" ? S.noFich : {}) }}>{r.clockIn}</td>
              <td style={{ ...S.td, fontFamily: "monospace" }}>{r.clockOut}</td>
              <td style={{
                ...S.td,
                fontWeight: 600,
                color: r.status === "FALTA" ? "#dc2626" : r.status === "Tarde" ? "#d97706" : r.status === "Sin fichar" ? "#d97706" : r.status === "OK" ? "#16a34a" : "#9ca3af"
              }}>{r.status}</td>
              <td style={{ ...S.td, ...(r.minsLate > 0 ? S.late : { color: "#9ca3af" }) }}>
                {r.minsLate > 0 ? `+${r.minsLate}` : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Summary */}
      <div style={{ marginTop: "10px", display: "flex", gap: "12px", justifyContent: "center" }}>
        <div style={{ ...S.badge("#16a34a", "#dcfce7"), padding: "4px 10px" }}>Presentes: {present}</div>
        <div style={{ ...S.badge("#dc2626", "#fee2e2"), padding: "4px 10px" }}>Faltas: {absent}</div>
        <div style={{ ...S.badge("#d97706", "#fef3c7"), padding: "4px 10px" }}>Tardes: {late} ({minsLate} min)</div>
        {noFich > 0 && <div style={{ ...S.badge("#d97706", "#fef3c7"), padding: "4px 10px" }}>Sin fichar: {noFich}</div>}
        {late >= 3 && <div style={{ ...S.badge("#dc2626", "#fee2e2"), padding: "4px 10px" }}>PIERDE PRESENTISMO</div>}
      </div>

      {/* Late detail */}
      {lateDetails.length > 0 && (
        <div style={{ marginTop: "10px" }}>
          <div style={S.h3}>Detalle de llegadas tarde</div>
          <table style={S.table}>
            <thead><tr><th style={S.thLeft}>Fecha</th><th style={S.th}>Dia</th><th style={S.th}>Entrada</th><th style={S.th}>Esperada</th><th style={S.th}>Min. tarde</th></tr></thead>
            <tbody>
              {lateDetails.map((l, i) => (
                <tr key={i}>
                  <td style={S.tdLeft}>{l.date}</td>
                  <td style={S.td}>{l.dayName}</td>
                  <td style={{ ...S.td, ...S.late, fontFamily: "monospace" }}>{l.clockIn}</td>
                  <td style={{ ...S.td, fontFamily: "monospace", color: "#6b7280" }}>{l.expected}</td>
                  <td style={{ ...S.td, ...S.late }}>+{l.mins} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={S.footer}>{PRESENTISMO_TEXT}</div>
    </div>
  )
}

export function IndividualReportButton({ employee, attendance, getScheduleForDate, month, year, quincena }: IndividualReportProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const handleExport = useCallback(async () => {
    if (!ref.current) return
    setExporting(true)
    try {
      const qLabel = quincena === "q1" ? "Q1" : "Q2"
      await exportElementToPDF(ref.current, `Asistencia_${employee.last_name}_${employee.first_name}_${MONTHS[month - 1]}_${year}_${qLabel}.pdf`)
    } finally { setExporting(false) }
  }, [employee, month, year, quincena])

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="gap-1 text-[10px] h-6 px-2">
        <Eye className="h-3 w-3" />
        PDF
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[95vw] w-[750px] max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle>Vista previa - {employee.last_name} {employee.first_name}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto px-6 pb-2">
            <div className="border border-border rounded-lg bg-white" ref={ref}>
              <IndividualReportContent employee={employee} attendance={attendance} getScheduleForDate={getScheduleForDate} month={month} year={year} quincena={quincena} />
            </div>
          </div>
          <DialogFooter className="px-6 pb-6 pt-2 border-t border-border">
            <Button variant="outline" onClick={() => setOpen(false)}>Cerrar</Button>
            <Button onClick={handleExport} disabled={exporting} className="gap-2">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
              Descargar PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}


// ===== REPORT 3: Historial individual largo plazo =====
interface HistoryReportProps {
  employee: Employee
  attendance: AttendanceRecord[]
  getScheduleForDate: (empId: number, date: string, dow: number) => ScheduleInfo
  fromMonth: number
  fromYear: number
  toMonth: number
  toYear: number
}

function HistoryReportContent({ employee, attendance, getScheduleForDate, fromMonth, fromYear, toMonth, toYear }: HistoryReportProps) {
  // Build monthly data
  const months: { month: number; year: number; label: string; present: number; absent: number; late: number; minsLate: number; workDays: number; lateDetails: { date: string; clockIn: string; expected: string; mins: number }[] }[] = []

  let m = fromMonth, y = fromYear
  while (y < toYear || (y === toYear && m <= toMonth)) {
    const daysInM = new Date(y, m, 0).getDate()
    let present = 0, absent = 0, late = 0, minsLate = 0, workDays = 0
    const lateDetails: { date: string; clockIn: string; expected: string; mins: number }[] = []

    for (let d = 1; d <= daysInM; d++) {
      const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
      const dow = new Date(y, m - 1, d).getDay()
      if (dow === 0) continue
      const schedule = getScheduleForDate(employee.id, dateStr, dow)
      if (schedule.isOptional) continue
      workDays++

      const rec = attendance.find(a => a.employee_id === employee.id && a.attendance_date === dateStr)
      if (!rec || rec.status === "ausente") { absent++; continue }

      const norm = normalizeClockTimes(rec.clock_in, rec.clock_out)
      if (!norm.clockIn) { present++; continue }

      present++
      const shiftStart = timeToMinutes(schedule.start)
      const ci = timeToMinutes(norm.clockIn.substring(0, 5))
      if (ci > shiftStart + 5) {
        late++
        const mins = ci - shiftStart
        minsLate += mins
        lateDetails.push({ date: `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`, clockIn: norm.clockIn.substring(0, 5), expected: schedule.start, mins })
      }
    }

    months.push({
      month: m, year: y,
      label: `${MONTHS[m - 1]} ${y}`,
      present, absent, late, minsLate, workDays, lateDetails,
    })

    m++
    if (m > 12) { m = 1; y++ }
  }

  const periodLabel = fromMonth === toMonth && fromYear === toYear
    ? `${MONTHS[fromMonth - 1]} ${fromYear}`
    : `${MONTHS[fromMonth - 1]} ${fromYear} - ${MONTHS[toMonth - 1]} ${toYear}`

  return (
    <div style={S.page}>
      <div style={{ textAlign: "center", marginBottom: "10px" }}>
        <div style={S.h1}>HISTORIAL DE ASISTENCIA</div>
        <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "2px" }}>{employee.last_name} {employee.first_name}</div>
        <div style={S.h2}>{employee.branch} - {periodLabel}</div>
      </div>

      {/* Monthly summary table */}
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.thLeft}>Mes</th>
            <th style={S.th}>Presentes</th>
            <th style={S.th}>Faltas</th>
            <th style={S.th}>Tardes</th>
            <th style={S.th}>Min. tarde</th>
            <th style={S.th}>Presentismo</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m, i) => {
            const rate = m.workDays > 0 ? (m.present / m.workDays) * 100 : 100
            return (
              <tr key={i}>
                <td style={{ ...S.tdLeft, fontWeight: 600 }}>{m.label}</td>
                <td style={{ ...S.td, color: "#16a34a", fontWeight: 600 }}>{m.present}/{m.workDays}</td>
                <td style={{ ...S.td, ...(m.absent > 0 ? S.absent : { color: "#9ca3af" }) }}>{m.absent}</td>
                <td style={{ ...S.td, ...(m.late > 0 ? S.late : { color: "#9ca3af" }) }}>{m.late}</td>
                <td style={{ ...S.td, ...(m.minsLate > 0 ? S.late : { color: "#9ca3af" }) }}>{m.minsLate > 0 ? `${m.minsLate} min` : "-"}</td>
                <td style={S.td}>
                  <span style={S.badge(
                    rate >= 90 ? "#166534" : rate >= 75 ? "#92400e" : "#991b1b",
                    rate >= 90 ? "#dcfce7" : rate >= 75 ? "#fef3c7" : "#fee2e2"
                  )}>{rate.toFixed(0)}%</span>
                  {m.late >= 3 && <span style={{ ...S.badge("#dc2626", "#fee2e2"), marginLeft: "4px", fontSize: "6px" }}>PIERDE</span>}
                </td>
              </tr>
            )
          })}
          {/* Totals row */}
          <tr style={{ backgroundColor: "#f3f4f6", fontWeight: 700 }}>
            <td style={{ ...S.tdLeft, fontWeight: 700 }}>TOTAL</td>
            <td style={{ ...S.td, fontWeight: 700, color: "#16a34a" }}>{months.reduce((s, m) => s + m.present, 0)}/{months.reduce((s, m) => s + m.workDays, 0)}</td>
            <td style={{ ...S.td, fontWeight: 700, ...S.absent }}>{months.reduce((s, m) => s + m.absent, 0)}</td>
            <td style={{ ...S.td, fontWeight: 700, ...S.late }}>{months.reduce((s, m) => s + m.late, 0)}</td>
            <td style={{ ...S.td, fontWeight: 700, ...S.late }}>{months.reduce((s, m) => s + m.minsLate, 0)} min</td>
            <td style={S.td}>-</td>
          </tr>
        </tbody>
      </table>

      {/* Late details per month */}
      {months.filter(m => m.lateDetails.length > 0).map((m, i) => (
        <div key={i} style={{ marginTop: "8px" }}>
          <div style={{ fontSize: "8px", fontWeight: 700, marginBottom: "2px" }}>
            Llegadas tarde - {m.label} ({m.lateDetails.length})
            {m.late >= 3 && <span style={{ ...S.badge("#dc2626", "#fee2e2"), marginLeft: "6px" }}>PIERDE PRESENTISMO</span>}
          </div>
          <table style={S.table}>
            <thead><tr><th style={S.thLeft}>Fecha</th><th style={S.th}>Entrada</th><th style={S.th}>Esperada</th><th style={S.th}>Min. tarde</th></tr></thead>
            <tbody>
              {m.lateDetails.map((l, j) => (
                <tr key={j}>
                  <td style={S.tdLeft}>{l.date}</td>
                  <td style={{ ...S.td, ...S.late, fontFamily: "monospace" }}>{l.clockIn}</td>
                  <td style={{ ...S.td, fontFamily: "monospace", color: "#6b7280" }}>{l.expected}</td>
                  <td style={{ ...S.td, ...S.late }}>+{l.mins} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div style={S.footer}>{PRESENTISMO_TEXT}</div>
    </div>
  )
}

export function HistoryReportButton({ employee, attendance, getScheduleForDate, fromMonth, fromYear, toMonth, toYear }: HistoryReportProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const handleExport = useCallback(async () => {
    if (!ref.current) return
    setExporting(true)
    try {
      await exportElementToPDF(ref.current, `Historial_${employee.last_name}_${employee.first_name}_${MONTHS[fromMonth - 1]}${fromYear}_${MONTHS[toMonth - 1]}${toYear}.pdf`)
    } finally { setExporting(false) }
  }, [employee, fromMonth, fromYear, toMonth, toYear])

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2">
        <Eye className="h-4 w-4" />
        PDF Historial
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[95vw] w-[850px] max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle>Vista previa - Historial {employee.last_name} {employee.first_name}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto px-6 pb-2">
            <div className="border border-border rounded-lg bg-white" ref={ref}>
              <HistoryReportContent employee={employee} attendance={attendance} getScheduleForDate={getScheduleForDate} fromMonth={fromMonth} fromYear={fromYear} toMonth={toMonth} toYear={toYear} />
            </div>
          </div>
          <DialogFooter className="px-6 pb-6 pt-2 border-t border-border">
            <Button variant="outline" onClick={() => setOpen(false)}>Cerrar</Button>
            <Button onClick={handleExport} disabled={exporting} className="gap-2">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
              Descargar PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
