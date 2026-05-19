import { createClient } from "@/lib/supabase"
import { NextResponse } from "next/server"
import * as XLSX from "xlsx"

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convierte serial numérico de Excel a "YYYY-MM-DD" */
function excelSerialToDate(serial: number): string {
  const d = new Date(Math.round((serial - 25569) * 86400 * 1000))
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** Convierte fracción decimal de día a "HH:MM" */
function decimalToTime(dec: number): string {
  const totalMin = Math.round(dec * 24 * 60)
  const h = String(Math.floor(totalMin / 60) % 24).padStart(2, "0")
  const m = String(totalMin % 60).padStart(2, "0")
  return `${h}:${m}`
}

/** Normaliza nombre para comparación: lowercase, sin acentos, sin espacios extra */
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // elimina diacríticos
    .replace(/[^a-z\s]/g, "")
    .trim()
    .replace(/\s+/g, " ")
}

/** Parsea "APELLIDO, NOMBRE" → { lastName, firstName } */
function parseName(raw: string): { lastName: string; firstName: string } {
  const parts = raw.split(",").map((s) => s.trim())
  if (parts.length >= 2) {
    return { lastName: parts[0], firstName: parts.slice(1).join(" ").trim() }
  }
  // Si no hay coma, asumimos que es solo un nombre
  return { lastName: raw, firstName: "" }
}

/** Detecta si una celda es un número que parece fracción de tiempo (< 2 = fracción de día) */
function isTimeFraction(val: unknown): val is number {
  return typeof val === "number" && val > 0 && val < 2
}

// ─── POST /api/rrhh/payroll/import ───────────────────────────────────────────
// Paso 1: Parse del Excel → devuelve preview con mapeo de empleados
// Paso 2: Con mapeo confirmado → inserta registros de asistencia

export async function POST(request: Request) {
  const supabase = createClient()
  const formData = await request.formData()
  const action = formData.get("action") as string

  // ── PASO 1: Parsear el archivo y devolver preview ──────────────────────
  if (action === "preview") {
    const file = formData.get("file") as File
    const plant = formData.get("plant") as string

    if (!file) return NextResponse.json({ error: "No se recibió archivo" }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const wb = XLSX.read(buffer, { type: "buffer" })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rawData: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

    // Recolectar nombres únicos del archivo
    const namesInFile = new Set<string>()
    const dateRange = { min: "", max: "" }

    for (const row of rawData) {
      const col0 = row[0]
      const col1 = row[1]
      if (typeof col0 === "number" && col0 > 40000 && col0 < 60000 && col1) {
        namesInFile.add(String(col1))
        const dateStr = excelSerialToDate(col0)
        if (!dateRange.min || dateStr < dateRange.min) dateRange.min = dateStr
        if (!dateRange.max || dateStr > dateRange.max) dateRange.max = dateStr
      }
    }

    // Buscar empleados en la DB para hacer el match
    const { data: employees } = await supabase
      .from("employees")
      .select("id, employee_id, first_name, last_name, branch")
      .eq("branch", plant)
      .eq("is_active", true)

    // Intentar matchear cada nombre del archivo con un empleado de la DB
    const employeeMatches: Array<{
      fileNameRaw: string
      parsedLastName: string
      parsedFirstName: string
      matched: boolean
      employeeId: number | null
      employeeName: string | null
      confidence: "exact" | "partial" | "none"
    }> = []

    for (const rawName of namesInFile) {
      const { lastName, firstName } = parseName(rawName)
      const normalLast = normalizeName(lastName)
      const normalFirst = normalizeName(firstName)

      let bestMatch: typeof employees extends (infer T)[] | null ? T : never | null = null
      let confidence: "exact" | "partial" | "none" = "none"

      if (employees) {
        // 1. Intento: match exacto de apellido + primera parte del nombre
        for (const emp of employees) {
          const empLast = normalizeName(emp.last_name)
          const empFirst = normalizeName(emp.first_name)

          if (empLast === normalLast && empFirst === normalFirst) {
            bestMatch = emp
            confidence = "exact"
            break
          }
        }

        // 2. Intento: apellido exacto + nombre parcial
        if (!bestMatch) {
          for (const emp of employees) {
            const empLast = normalizeName(emp.last_name)
            const empFirst = normalizeName(emp.first_name)

            if (
              empLast === normalLast &&
              (empFirst.includes(normalFirst) || normalFirst.includes(empFirst))
            ) {
              bestMatch = emp
              confidence = "partial"
              break
            }
          }
        }

        // 3. Intento: solo apellido (si hay un único empleado con ese apellido)
        if (!bestMatch) {
          const sameLastName = employees.filter(
            (e) => normalizeName(e.last_name) === normalLast
          )
          if (sameLastName.length === 1) {
            bestMatch = sameLastName[0]
            confidence = "partial"
          }
        }
      }

      employeeMatches.push({
        fileNameRaw: rawName,
        parsedLastName: lastName,
        parsedFirstName: firstName,
        matched: !!bestMatch,
        employeeId: bestMatch?.id ?? null,
        employeeName: bestMatch
          ? `${bestMatch.last_name}, ${bestMatch.first_name}`
          : null,
        confidence,
      })
    }

    // Contar registros y días del archivo
    let totalRows = 0
    let rowsWithData = 0
    for (const row of rawData) {
      if (typeof row[0] === "number" && row[0] > 40000) {
        totalRows++
        if (isTimeFraction(row[2])) rowsWithData++
      }
    }

    return NextResponse.json({
      success: true,
      dateRange,
      totalRows,
      rowsWithData,
      employeeCount: namesInFile.size,
      employeeMatches,
    })
  }

  // ── PASO 2: Confirmar import → insertar registros de asistencia ────────
  if (action === "import") {
    const file = formData.get("file") as File
    const plant = formData.get("plant") as string
    const periodId = formData.get("period_id") as string
    const mappingRaw = formData.get("mapping") as string // JSON: { fileNameRaw → employeeId }

    if (!file || !mappingRaw) {
      return NextResponse.json({ error: "Faltan datos para el import" }, { status: 400 })
    }

    const mapping: Record<string, number> = JSON.parse(mappingRaw)

    // Parsear Excel
    const buffer = Buffer.from(await file.arrayBuffer())
    const wb = XLSX.read(buffer, { type: "buffer" })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rawData: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

    // Obtener período para validar fechas
    let dateFrom = ""
    let dateTo = ""
    if (periodId) {
      const { data: period } = await supabase
        .from("payroll_periods")
        .select("date_from, date_to")
        .eq("id", periodId)
        .single()
      if (period) {
        dateFrom = period.date_from
        dateTo = period.date_to
      }
    }

    const results = {
      imported: 0,
      skipped: 0,
      errors: [] as string[],
    }

    // Procesar cada fila del Excel
    for (const row of rawData) {
      try {
        const col0 = row[0]
        const col1 = row[1] as string

        // Validar que la fila tiene fecha y nombre
        if (typeof col0 !== "number" || col0 < 40000 || !col1) continue

        const dateStr = excelSerialToDate(col0)

        // Filtrar por período si se especificó
        if (dateFrom && dateTo && (dateStr < dateFrom || dateStr > dateTo)) {
          results.skipped++
          continue
        }

        // Buscar mapeo de empleado
        const employeeId = mapping[col1]
        if (!employeeId) {
          results.skipped++
          continue
        }

        // Extraer todos los tiempos de la fila (cols 2, 3, 4, 5)
        const timeCols = [row[2], row[3], row[4], row[5]].filter(isTimeFraction) as number[]

        let clockIn: string | null = null
        let clockOut: string | null = null
        let status: string = "ausente"

        if (timeCols.length === 0) {
          // Sin fichaje → ausente (solo si es día laboral, sábado o especial)
          status = "ausente"
        } else if (timeCols.length === 1) {
          // Solo un fichaje → registrar sin salida
          clockIn = decimalToTime(timeCols[0])
          status = "presente"
        } else {
          // Múltiples fichajes → primero = entrada, último = salida
          clockIn = decimalToTime(timeCols[0])
          clockOut = decimalToTime(timeCols[timeCols.length - 1])
          status = "presente"
        }

        // Upsert del registro de asistencia
        const { error } = await supabase.from("attendance").upsert(
          {
            employee_id: employeeId,
            attendance_date: dateStr,
            clock_in: clockIn,
            clock_out: clockOut,
            status,
            observations: timeCols.length === 1 ? "Sin salida registrada" : null,
          },
          { onConflict: "employee_id,attendance_date" }
        )

        if (error) {
          results.errors.push(`${dateStr} ${col1}: ${error.message}`)
        } else {
          results.imported++
        }
      } catch (e: any) {
        results.errors.push(`Error en fila: ${e.message}`)
      }
    }

    // Registrar el import en el log
    await supabase.from("attendance_imports").insert({
      plant,
      period_from: dateFrom || new Date().toISOString().split("T")[0],
      period_to: dateTo || new Date().toISOString().split("T")[0],
      original_filename: file.name,
      records_imported: results.imported,
      records_skipped: results.skipped,
      records_errors: results.errors.length,
      import_log: { errors: results.errors },
    })

    return NextResponse.json({ success: true, ...results })
  }

  return NextResponse.json({ error: "Acción no válida" }, { status: 400 })
}
