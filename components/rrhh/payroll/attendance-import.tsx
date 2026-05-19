"use client"

import { useState, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Upload, CheckCircle2, AlertTriangle, XCircle, FileSpreadsheet, ArrowRight, RefreshCw } from "lucide-react"
import { toast } from "sonner"

interface EmployeeOption {
  id: number
  employee_id: string
  first_name: string
  last_name: string
}

interface MatchEntry {
  fileNameRaw: string
  parsedLastName: string
  parsedFirstName: string
  matched: boolean
  employeeId: number | null
  employeeName: string | null
  confidence: "exact" | "partial" | "none"
}

interface PreviewData {
  dateRange: { min: string; max: string }
  totalRows: number
  rowsWithData: number
  employeeCount: number
  employeeMatches: MatchEntry[]
}

interface AttendanceImportProps {
  plant: string
  periodId: number
  periodDateFrom: string
  periodDateTo: string
  onImportComplete: () => void
}

const PLANTS = ["Villa Rosa", "Ranchos", "Olivera"]

export function AttendanceImport({
  plant,
  periodId,
  periodDateFrom,
  periodDateTo,
  onImportComplete,
}: AttendanceImportProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [mapping, setMapping] = useState<Record<string, number>>({}) // fileNameRaw → employeeId
  const [dbEmployees, setDbEmployees] = useState<EmployeeOption[]>([])
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload")
  const [loading, setLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setPreview(null)
    setStep("upload")
  }

  async function handlePreview() {
    if (!selectedFile) return
    setLoading(true)

    try {
      const fd = new FormData()
      fd.append("action", "preview")
      fd.append("file", selectedFile)
      fd.append("plant", plant)

      const res = await fetch("/api/rrhh/payroll/import", { method: "POST", body: fd })
      const data = await res.json()

      if (!res.ok) { toast.error(data.error); return }

      setPreview(data)

      // Inicializar mapping con los que ya matchearon automáticamente
      const initialMapping: Record<string, number> = {}
      data.employeeMatches.forEach((m: MatchEntry) => {
        if (m.employeeId) initialMapping[m.fileNameRaw] = m.employeeId
      })
      setMapping(initialMapping)

      // Cargar empleados de la planta para los selects manuales
      const empRes = await fetch(`/api/rrhh/employees?branch=${encodeURIComponent(plant)}`)
      if (empRes.ok) setDbEmployees(await empRes.json())

      setStep("preview")
    } finally {
      setLoading(false)
    }
  }

  async function handleImport() {
    if (!selectedFile || !preview) return

    const unmapped = preview.employeeMatches.filter(
      (m) => !mapping[m.fileNameRaw]
    )
    if (unmapped.length > 0) {
      const names = unmapped.map((m) => m.fileNameRaw).join(", ")
      if (!confirm(`Hay ${unmapped.length} empleado(s) sin mapear que serán OMITIDOS:\n${names}\n\n¿Continuar de todas formas?`)) return
    }

    setLoading(true)
    try {
      const fd = new FormData()
      fd.append("action", "import")
      fd.append("file", selectedFile)
      fd.append("plant", plant)
      fd.append("period_id", String(periodId))
      fd.append("mapping", JSON.stringify(mapping))

      const res = await fetch("/api/rrhh/payroll/import", { method: "POST", body: fd })
      const data = await res.json()

      if (!res.ok) { toast.error(data.error); return }

      toast.success(
        `Import completado: ${data.imported} registros importados, ${data.skipped} omitidos${data.errors?.length ? `, ${data.errors.length} errores` : ""}`
      )

      if (data.errors?.length > 0) {
        console.warn("Errores de import:", data.errors)
      }

      setStep("done")
      onImportComplete()
    } finally {
      setLoading(false)
    }
  }

  function handleReset() {
    setSelectedFile(null)
    setPreview(null)
    setMapping({})
    setStep("upload")
    if (fileRef.current) fileRef.current.value = ""
  }

  const matchedCount = preview?.employeeMatches.filter((m) => mapping[m.fileNameRaw]).length ?? 0
  const totalCount = preview?.employeeMatches.length ?? 0
  const unmappedCount = totalCount - matchedCount

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          Importar asistencia desde fichero
        </CardTitle>
        <CardDescription>
          Período: {formatDate(periodDateFrom)} → {formatDate(periodDateTo)} · Planta: {plant}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Step 1: Selección de archivo */}
        <div className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${step === "upload" ? "border-primary/40 bg-primary/5" : "border-muted bg-muted/20"}`}>
          <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground mb-3">
            Arrastrá el Excel del fichero o hacé clic para seleccionar
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFileSelect}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            Seleccionar archivo
          </Button>
          {selectedFile && (
            <p className="mt-2 text-sm font-medium text-green-700">
              ✓ {selectedFile.name} ({(selectedFile.size / 1024).toFixed(0)} KB)
            </p>
          )}
        </div>

        {selectedFile && step === "upload" && (
          <Button className="w-full gap-2" onClick={handlePreview} disabled={loading}>
            {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {loading ? "Analizando..." : "Analizar archivo"}
          </Button>
        )}

        {/* Step 2: Preview y mapeo */}
        {step === "preview" && preview && (
          <div className="space-y-4">
            {/* Resumen del archivo */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatBox label="Período del archivo" value={`${formatDate(preview.dateRange.min)} → ${formatDate(preview.dateRange.max)}`} />
              <StatBox label="Días en archivo" value={String(preview.totalRows / preview.employeeCount | 0)} />
              <StatBox label="Días con fichaje" value={String(preview.rowsWithData)} />
              <StatBox label="Empleados" value={String(preview.employeeCount)} />
            </div>

            {/* Estado del mapeo */}
            <div className={`flex items-center gap-3 p-3 rounded-lg border ${unmappedCount === 0 ? "bg-green-50 border-green-200" : "bg-yellow-50 border-yellow-200"}`}>
              {unmappedCount === 0
                ? <CheckCircle2 className="h-5 w-5 text-green-600" />
                : <AlertTriangle className="h-5 w-5 text-yellow-600" />
              }
              <span className="text-sm font-medium">
                {matchedCount}/{totalCount} empleados mapeados
                {unmappedCount > 0 && ` — ${unmappedCount} sin mapear (serán omitidos)`}
              </span>
            </div>

            {/* Tabla de mapeo */}
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs bg-muted/40">
                    <TableHead>Nombre en el fichero</TableHead>
                    <TableHead>Empleado en el sistema</TableHead>
                    <TableHead className="text-center w-24">Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.employeeMatches.map((match) => {
                    const mappedId = mapping[match.fileNameRaw]
                    return (
                      <TableRow key={match.fileNameRaw} className="text-sm">
                        <TableCell className="font-mono text-xs py-2">
                          {match.fileNameRaw}
                        </TableCell>
                        <TableCell className="py-2">
                          <Select
                            value={mappedId ? String(mappedId) : "__none__"}
                            onValueChange={(v) => {
                              if (v === "__none__") {
                                const next = { ...mapping }
                                delete next[match.fileNameRaw]
                                setMapping(next)
                              } else {
                                setMapping({ ...mapping, [match.fileNameRaw]: parseInt(v) })
                              }
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="— sin mapear —" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">— sin mapear —</SelectItem>
                              {dbEmployees.map((emp) => (
                                <SelectItem key={emp.id} value={String(emp.id)}>
                                  {emp.last_name}, {emp.first_name} (Leg. {emp.employee_id})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-center py-2">
                          {!mappedId ? (
                            <Badge variant="outline" className="text-xs border-red-300 text-red-600">
                              <XCircle className="h-3 w-3 mr-1" />Sin mapear
                            </Badge>
                          ) : match.confidence === "exact" ? (
                            <Badge variant="outline" className="text-xs border-green-300 text-green-700">
                              <CheckCircle2 className="h-3 w-3 mr-1" />Automático
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs border-yellow-300 text-yellow-700">
                              <AlertTriangle className="h-3 w-3 mr-1" />Parcial
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Botones */}
            <div className="flex gap-3">
              <Button variant="outline" onClick={handleReset} className="flex-1">
                Cancelar
              </Button>
              <Button
                className="flex-1 gap-2"
                onClick={handleImport}
                disabled={loading || matchedCount === 0}
              >
                {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {loading ? "Importando..." : `Importar ${matchedCount} empleados`}
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Listo */}
        {step === "done" && (
          <div className="text-center py-6 space-y-3">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
            <p className="font-semibold text-green-700">Import completado</p>
            <p className="text-sm text-muted-foreground">
              Los registros de asistencia fueron importados. Ahora podés calcular la liquidación.
            </p>
            <Button variant="outline" onClick={handleReset}>
              Importar otro archivo
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Helpers UI ───────────────────────────────────────────────────────────────

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/30 rounded-lg p-3 text-center">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-bold text-sm mt-1">{value}</div>
    </div>
  )
}

function formatDate(d: string) {
  if (!d) return "—"
  return new Date(d + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })
}
