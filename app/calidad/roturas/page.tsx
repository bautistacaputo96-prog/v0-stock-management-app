"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowLeft, Search, Loader2, FlaskConical, X } from "lucide-react"
import Link from "next/link"
import { getSupabase } from "@/lib/supabase"

interface CylinderResult {
  id: string
  cylinder_number: number
  test_age_days: number
  scheduled_test_date: string | null
  actual_test_date: string | null
  strength_mpa: number | null
  dial_reading: number | null
  weight_grams: number | null
  comments: string | null
  dispatch: {
    id: string
    dispatch_date: string
    remito: string | null
    sample_number: string | null
    actual_slump_cm: number | null
    formula: {
      id: string
      name: string
      code: string
    }
  }
}

export default function ResultadosRoturasPage() {
  const supabase = getSupabase()

  const [results, setResults] = useState<CylinderResult[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [search, setSearch] = useState("")
  const [filterTipo, setFilterTipo] = useState("all")
  const [filterCodigo, setFilterCodigo] = useState("all")
  const [filterYear, setFilterYear] = useState("all")

  // Options derived from loaded data
  const [tipoOptions, setTipoOptions] = useState<string[]>([])
  const [codigoOptions, setCodigoOptions] = useState<string[]>([])

  const loadResults = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from("test_cylinders")
        .select(`
          id,
          cylinder_number,
          test_age_days,
          scheduled_test_date,
          actual_test_date,
          strength_mpa,
          dial_reading,
          weight_grams,
          comments,
          dispatch:dispatch_id (
            id,
            dispatch_date,
            remito,
            sample_number,
            actual_slump_cm,
            formula:formula_id (
              id,
              name,
              code
            )
          )
        `)
        .eq("test_age_days", 28)
        .order("actual_test_date", { ascending: false })
        .limit(2000)

      if (error) throw error

      const rows = (data || []) as unknown as CylinderResult[]
      setResults(rows)

      // Build filter options
      const tipos = [...new Set(rows.map(r => r.dispatch?.formula?.name).filter(Boolean))].sort()
      const codigos = [...new Set(rows.map(r => r.dispatch?.formula?.code).filter(Boolean))].sort()
      setTipoOptions(tipos as string[])
      setCodigoOptions(codigos as string[])
    } catch (err) {
      console.error("Error loading results:", err)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    loadResults()
  }, [loadResults])

  // Filter logic
  const filtered = results.filter(r => {
    const tipo = r.dispatch?.formula?.name || ""
    const codigo = r.dispatch?.formula?.code || ""
    const probetaId = r.dispatch?.sample_number || ""
    const remito = r.dispatch?.remito || ""
    const year = r.dispatch?.dispatch_date ? r.dispatch.dispatch_date.substring(0, 4) : ""

    if (filterTipo !== "all" && tipo !== filterTipo) return false
    if (filterCodigo !== "all" && codigo !== filterCodigo) return false
    if (filterYear !== "all" && year !== filterYear) return false
    if (search) {
      const q = search.toLowerCase()
      if (
        !tipo.toLowerCase().includes(q) &&
        !codigo.toLowerCase().includes(q) &&
        !probetaId.toLowerCase().includes(q) &&
        !remito.toLowerCase().includes(q)
      ) return false
    }
    return true
  })

  // Filter codigos based on selected tipo
  const filteredCodigoOptions = filterTipo === "all"
    ? codigoOptions
    : codigoOptions.filter(code => {
        const row = results.find(r => r.dispatch?.formula?.code === code)
        return row?.dispatch?.formula?.name === filterTipo
      })

  const clearFilters = () => {
    setSearch("")
    setFilterTipo("all")
    setFilterCodigo("all")
    setFilterYear("all")
  }

  const hasActiveFilters = search || filterTipo !== "all" || filterCodigo !== "all" || filterYear !== "all"

  const yearOptions = [...new Set(
    results.map(r => r.dispatch?.dispatch_date?.substring(0, 4)).filter(Boolean)
  )].sort((a, b) => Number(b) - Number(a)) as string[]

  const formatDate = (d: string | null) => {
    if (!d) return "-"
    const [y, m, day] = d.split("-")
    return `${day}/${m}/${y}`
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/calidad">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
          <FlaskConical className="h-6 w-6 text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Resultados de Roturas</h1>
          <p className="text-muted-foreground">Ensayos de compresión a 28 días</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-48">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por probeta, remito, tipo..."
                  className="pl-8"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="w-40">
              <Select value={filterTipo} onValueChange={v => { setFilterTipo(v); setFilterCodigo("all") }}>
                <SelectTrigger>
                  <SelectValue placeholder="Tipo de Hormigón" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los tipos</SelectItem>
                  {tipoOptions.map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-52">
              <Select value={filterCodigo} onValueChange={setFilterCodigo}>
                <SelectTrigger>
                  <SelectValue placeholder="Código" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los códigos</SelectItem>
                  {filteredCodigoOptions.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-28">
              <Select value={filterYear} onValueChange={setFilterYear}>
                <SelectTrigger>
                  <SelectValue placeholder="Año" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {yearOptions.map(y => (
                    <SelectItem key={y} value={y}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
                <X className="h-3 w-3" /> Limpiar
              </Button>
            )}
          </div>

          {!loading && (
            <p className="text-xs text-muted-foreground mt-2">
              Mostrando {filtered.length} de {results.length} resultados
            </p>
          )}
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Cargando resultados...
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              No se encontraron resultados
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha Moldeo</TableHead>
                  <TableHead>Probeta ID</TableHead>
                  <TableHead>Tipo de Hormigón</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead className="text-right">Resistencia (MPa)</TableHead>
                  <TableHead>Fecha Rotura</TableHead>
                  <TableHead>Cil. #</TableHead>
                  <TableHead>Asentamiento</TableHead>
                  <TableHead>Observaciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">
                      {formatDate(r.dispatch?.dispatch_date ?? null)}
                    </TableCell>
                    <TableCell className="text-sm font-mono">
                      {r.dispatch?.sample_number || r.dispatch?.remito || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs font-semibold">
                        {r.dispatch?.formula?.name || "-"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.dispatch?.formula?.code || "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.strength_mpa != null ? (
                        <span className={`font-semibold ${r.strength_mpa >= 21 ? "text-emerald-600" : "text-amber-600"}`}>
                          {r.strength_mpa.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">Pendiente</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDate(r.actual_test_date)}
                    </TableCell>
                    <TableCell className="text-sm text-center">
                      {r.cylinder_number}
                    </TableCell>
                    <TableCell className="text-sm text-center">
                      {r.dispatch?.actual_slump_cm != null ? `${r.dispatch.actual_slump_cm} cm` : "-"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-48 truncate">
                      {r.comments || "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
