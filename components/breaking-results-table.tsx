"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { format, parseISO, isValid } from "date-fns"
import { es } from "date-fns/locale"
import { Search, CheckCircle2, Trash2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { toast } from "@/hooks/use-toast"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

function safeFormatDate(dateStr: string | null | undefined, formatStr: string = "dd/MM/yyyy"): string {
  if (!dateStr) return "-"
  try {
    const date = parseISO(dateStr)
    if (!isValid(date)) return "-"
    return format(date, formatStr, { locale: es })
  } catch {
    return "-"
  }
}

interface Plant {
  id: string
  code: string
  name: string
}

interface BreakingResult {
  id: string
  remito: string | null
  formula_code: string | null
  formula_name: string | null
  slump: number | null
  actual_slump: number | null
  cylinder_number: number
  deposit: string | null
  molding_date: string | null
  test_age_days: number
  scheduled_test_date: string | null
  actual_test_date: string | null
  dial_reading: number | null
  weight_grams: number | null
  height_cm: number | null
  diameter_cm: number | null
  strength_mpa: number | null
  expected_strength: number | null
  client_name: string | null
  site_address: string | null
  comments: string | null
}

interface BreakingResultsTableProps {
  plants: Plant[]
  selectedPlantId: string
  onPlantChange: (plantId: string) => void
}

export function BreakingResultsTable({ plants, selectedPlantId, onPlantChange }: BreakingResultsTableProps) {
  const [results, setResults] = useState<BreakingResult[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [filterAge, setFilterAge] = useState<string>("all")
  const [filterStatus, setFilterStatus] = useState<string>("completed")
  const [deletingResult, setDeletingResult] = useState<BreakingResult | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    loadResults()
  }, [selectedPlantId, filterStatus])

  async function loadResults() {
    setLoading(true)
    
    try {
      const supabase = createClient()

      let query = supabase
        .from("test_cylinders")
        .select(`
          id,
          cylinder_number,
          test_age_days,
          scheduled_test_date,
          actual_test_date,
          dial_reading,
          weight_grams,
          strength_mpa,
          comments,
          dispatches (
            id,
            remito,
            dispatch_date,
            actual_slump_cm,
            client_id,
            construction_site_id,
            formula_id,
            clients (name),
            construction_sites (address, name),
            formulas (code, name, description)
          )
        `)
        .order("actual_test_date", { ascending: false, nullsFirst: false })

      // Filter by completed vs pending
      if (filterStatus === "completed") {
        query = query.not("actual_test_date", "is", null).not("strength_mpa", "is", null)
      } else if (filterStatus === "pending") {
        query = query.is("actual_test_date", null)
      }

      const { data, error } = await query.limit(10000)

      if (error) {
        console.error("[v0] Error loading results:", error)
        setLoading(false)
        return
      }

      // Parse and map data
      const mappedResults: BreakingResult[] = (data || []).map((item: any) => {
        // Parse formula description for expected strength and slump
        const formulaDesc = item.dispatches?.formulas?.description || ""
        const strengthMatch = formulaDesc.match(/H-?(\d+)/i)
        const expectedStrength = strengthMatch ? parseInt(strengthMatch[1]) : null
        
        // Parse slump from formula name/code
        const slumpMatch = (item.dispatches?.formulas?.name || "").match(/(\d+)\s*cm/i)
        const slump = slumpMatch ? parseInt(slumpMatch[1]) : null

        return {
          id: item.id,
          remito: item.dispatches?.remito || null,
          formula_code: item.dispatches?.formulas?.code || null,
          formula_name: item.dispatches?.formulas?.name || null,
          slump: slump,
          actual_slump: item.dispatches?.actual_slump_cm || null,
          cylinder_number: item.cylinder_number,
          deposit: null, // Not tracked currently
          molding_date: item.dispatches?.dispatch_date || null,
          test_age_days: item.test_age_days,
          scheduled_test_date: item.scheduled_test_date,
          actual_test_date: item.actual_test_date,
          dial_reading: item.dial_reading,
          weight_grams: item.weight_grams,
          height_cm: 20, // Standard cylinder height
          diameter_cm: 10, // Standard cylinder diameter
          strength_mpa: item.strength_mpa,
          expected_strength: expectedStrength,
          client_name: item.dispatches?.clients?.name || null,
          site_address: item.dispatches?.construction_sites?.address || item.dispatches?.construction_sites?.name || null,
          comments: item.comments,
        }
      })

      setResults(mappedResults)
    } catch (err) {
      console.error("[v0] Error in loadResults:", err)
    } finally {
      setLoading(false)
    }
  }

  // Filter results
  const filteredResults = results.filter((r) => {
    // Search filter
    if (searchTerm) {
      const search = searchTerm.toLowerCase()
      const matchesSearch =
        r.remito?.toLowerCase().includes(search) ||
        r.formula_code?.toLowerCase().includes(search) ||
        r.client_name?.toLowerCase().includes(search) ||
        r.site_address?.toLowerCase().includes(search)
      if (!matchesSearch) return false
    }

    // Age filter
    if (filterAge !== "all") {
      if (filterAge === "7" && r.test_age_days !== 7) return false
      if (filterAge === "28" && r.test_age_days !== 28) return false
    }

    return true
  })

  // Calculate summary stats
  const stats = {
    total: filteredResults.length,
    passed: filteredResults.filter((r) => r.strength_mpa && r.expected_strength && r.strength_mpa >= r.expected_strength).length,
    failed: filteredResults.filter((r) => r.strength_mpa && r.expected_strength && r.strength_mpa < r.expected_strength).length,
    avgStrength: filteredResults.length > 0
      ? filteredResults.filter((r) => r.strength_mpa).reduce((sum, r) => sum + (r.strength_mpa || 0), 0) /
        filteredResults.filter((r) => r.strength_mpa).length
      : 0,
  }

  async function handleDelete() {
    if (!deletingResult) return
    setDeleting(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.from("test_cylinders").delete().eq("id", deletingResult.id)
      if (error) throw error
      toast({ title: "Resultado eliminado", description: "La probeta se elimino correctamente" })
      setResults((prev) => prev.filter((r) => r.id !== deletingResult.id))
    } catch (err: any) {
      console.error("[v0] Error deleting result:", err)
      toast({ title: "Error", description: err?.message || "No se pudo eliminar", variant: "destructive" })
    } finally {
      setDeleting(false)
      setDeletingResult(null)
    }
  }

  const getStrengthStatus = (result: BreakingResult) => {
    if (!result.strength_mpa) return "pending"
    if (!result.expected_strength) return "unknown"
    // 90% of expected strength is acceptable
    if (result.strength_mpa >= result.expected_strength * 0.9) return "passed"
    return "failed"
  }

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-muted/30">
          <CardContent className="py-3 text-center">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Total Ensayos</p>
          </CardContent>
        </Card>
        <Card className="bg-green-50 dark:bg-green-950/30">
          <CardContent className="py-3 text-center">
            <p className="text-2xl font-bold text-green-600">{stats.passed}</p>
            <p className="text-xs text-muted-foreground">Aprobados</p>
          </CardContent>
        </Card>
        <Card className="bg-red-50 dark:bg-red-950/30">
          <CardContent className="py-3 text-center">
            <p className="text-2xl font-bold text-red-600">{stats.failed}</p>
            <p className="text-xs text-muted-foreground">No Conformes</p>
          </CardContent>
        </Card>
        <Card className="bg-blue-50 dark:bg-blue-950/30">
          <CardContent className="py-3 text-center">
            <p className="text-2xl font-bold text-blue-600">{stats.avgStrength.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground">Promedio MPa</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por remito, formula, cliente..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="completed">Completados</SelectItem>
            <SelectItem value="pending">Pendientes</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterAge} onValueChange={setFilterAge}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Edad" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="7">7 dias</SelectItem>
            <SelectItem value="28">28 dias</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-xs font-semibold whitespace-nowrap sticky left-0 z-20 bg-muted">N Remito</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap">Tipo Hormigon</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap text-center">Asent. Real</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap text-center">Prob ID</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap">Fecha Moldeo</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap text-center">7d</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap text-center">28d</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap">Debe Ensayarse</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap">Fecha Rotura</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap text-center">Lec. Dial</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap text-center">Peso (g)</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap text-center">Altura (cm)</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap text-center">Diametro (cm)</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap text-center">Resistencia (MPa)</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap">Direccion Obra</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap">Cliente</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap">Observaciones</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap text-center w-[60px]">Accion</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={18} className="text-center py-8">
                  <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                  </div>
                </TableCell>
              </TableRow>
            ) : filteredResults.length === 0 ? (
              <TableRow>
                <TableCell colSpan={18} className="text-center py-8 text-muted-foreground">
                  No se encontraron resultados
                </TableCell>
              </TableRow>
            ) : (
              filteredResults.map((result) => {
                const status = getStrengthStatus(result)
                return (
                  <TableRow key={result.id} className="hover:bg-muted/30">
                    <TableCell className="text-xs font-medium sticky left-0 z-10 bg-card">{result.remito || "-"}</TableCell>
                    <TableCell className="text-xs">
                      <div>
                        <Badge variant="outline" className="font-mono text-xs">
                          {result.formula_code || "N/A"}
                        </Badge>
                        {result.slump && (
                          <span className="text-muted-foreground ml-1">- {result.slump}cm</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-center">
                      {result.actual_slump ? `${result.actual_slump}cm` : "-"}
                    </TableCell>
                    <TableCell className="text-xs text-center font-medium">
                      {result.cylinder_number}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {safeFormatDate(result.molding_date)}
                    </TableCell>
                    <TableCell className="text-center">
                      {result.test_age_days === 7 ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600 mx-auto" />
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {result.test_age_days === 28 ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600 mx-auto" />
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {safeFormatDate(result.scheduled_test_date)}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {safeFormatDate(result.actual_test_date)}
                    </TableCell>
                    <TableCell className="text-xs text-center">{result.dial_reading ?? "-"}</TableCell>
                    <TableCell className="text-xs text-center">{result.weight_grams ?? "-"}</TableCell>
                    <TableCell className="text-xs text-center">{result.height_cm}</TableCell>
                    <TableCell className="text-xs text-center">{result.diameter_cm}</TableCell>
                    <TableCell className="text-center">
                      {result.strength_mpa ? (
                        <Badge
                          variant={status === "passed" ? "default" : status === "failed" ? "destructive" : "secondary"}
                          className="font-mono"
                        >
                          {result.strength_mpa.toFixed(1)}
                        </Badge>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell className="text-xs max-w-[150px] truncate" title={result.site_address || ""}>
                      {result.site_address || "-"}
                    </TableCell>
                    <TableCell className="text-xs max-w-[120px] truncate" title={result.client_name || ""}>
                      {result.client_name || "-"}
                    </TableCell>
                    <TableCell className="text-xs max-w-[150px] truncate" title={result.comments || ""}>
                      {result.comments || "-"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setDeletingResult(result)}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Eliminar</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground text-right">
        Mostrando {filteredResults.length} de {results.length} resultados
      </p>

      <AlertDialog open={!!deletingResult} onOpenChange={(open) => !open && setDeletingResult(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar Resultado</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingResult && (
                <>
                  Esta por eliminar el resultado del remito <strong>{deletingResult.remito || "N/A"}</strong> (Probeta #
                  {deletingResult.cylinder_number}, {deletingResult.test_age_days} dias). Esta accion no se puede
                  deshacer.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
