"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Edit, Filter, Trash2, MoreHorizontal, Search } from "lucide-react"
import { EditCylinderDialog } from "./edit-cylinder-dialog"
import { DateRangeFilter } from "./date-range-filter"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"

interface TestCylinder {
  id: string
  dispatch_id: string
  cylinder_number: number
  test_age_days: number
  scheduled_test_date: string
  actual_test_date: string | null
  dial_reading: number | null
  strength_mpa: number | null
  weight_grams: number | null
  comments: string | null
  dispatch: {
    remito: string | null
    dispatch_date: string
    sample_number: string
    actual_slump_cm: number | null
    extra_water_liters: number | null
    client_id: string
    construction_site_id: string
    formula_id: string
    client: { name: string } | null
    construction_site: { name: string } | null
    formula: { code: string; name: string; plant_id: string }
    plant: { code: string; name: string }
  } | null
}

interface TestCylindersTableProps {
  plants: Array<{ id: string; code: string; name: string }>
  selectedPlantId: string
  onPlantChange: (plantId: string) => void
}

export function TestCylindersTable({ plants, selectedPlantId, onPlantChange }: TestCylindersTableProps) {
  const [cylinders, setCylinders] = useState<TestCylinder[]>([])
  const [filteredCylinders, setFilteredCylinders] = useState<TestCylinder[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [editingCylinder, setEditingCylinder] = useState<TestCylinder | null>(null)
  const [deletingCylinder, setDeletingCylinder] = useState<TestCylinder | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({
    from: "",
    to: "",
  })

  const [filters, setFilters] = useState({
    remito: [] as string[],
    formula: [] as string[],
    probetaId: [] as string[],
    planta: [] as string[],
    dias: [] as number[],
    cliente: [] as string[],
    obra: [] as string[],
    estado: [] as string[], // Pendiente/Ensayado
  })

  const loadCylinders = async () => {
    setLoading(true)
    const supabase = createClient()

    let query = supabase
      .from("test_cylinders")
      .select(`
        *,
        dispatch:dispatches(
          remito,
          dispatch_date,
          sample_number,
          actual_slump_cm,
          extra_water_liters,
          client_id,
          construction_site_id,
          formula_id,
          client:clients(name),
          construction_site:construction_sites(name),
          formula:formulas(code, name, plant_id),
          plant:formulas(plant_id)
        )
      `)
      .order("scheduled_test_date", { ascending: false })
      .limit(10000)

    if (selectedPlantId !== "all") {
      query = query.eq("dispatch.formula.plant_id", selectedPlantId)
    }

    const { data, error } = await query

    if (!error && data) {
      let filtered = data as any[]

      // Filter by date range
      if (dateRange.from) {
        filtered = filtered.filter((c) => c.scheduled_test_date >= dateRange.from)
      }
      if (dateRange.to) {
        filtered = filtered.filter((c) => c.scheduled_test_date <= dateRange.to)
      }

      const mappedData = filtered.map((c) => ({
        ...c,
        dispatch: c.dispatch
          ? {
              ...c.dispatch,
              formula: c.dispatch.formula || { code: "-", name: "-", plant_id: null },
              plant: plants.find((p) => p.id === c.dispatch.formula?.plant_id) || { code: "-", name: "-" },
            }
          : null,
      }))

      setCylinders(mappedData as TestCylinder[])
    }
    setLoading(false)
  }

  useEffect(() => {
    let filtered = [...cylinders]

    // Apply global search across all visible data
    const term = searchTerm.trim().toLowerCase()
    if (term !== "") {
      filtered = filtered.filter((c) => {
        const fields = [
          c.dispatch?.remito,
          c.dispatch?.formula?.code,
          c.dispatch?.formula?.name,
          c.dispatch?.sample_number,
          c.dispatch?.plant?.code,
          c.dispatch?.plant?.name,
          c.dispatch?.client?.name,
          c.dispatch?.construction_site?.name,
          c.comments,
          c.test_age_days?.toString(),
          c.dial_reading?.toString(),
          c.strength_mpa?.toString(),
          c.dispatch?.actual_slump_cm?.toString(),
          c.dispatch?.extra_water_liters?.toString(),
          formatDate(c.dispatch?.dispatch_date),
          formatDate(c.scheduled_test_date),
          formatDate(c.actual_test_date),
          c.actual_test_date ? "Ensayado" : "Pendiente",
        ]
        return fields.filter(Boolean).some((f) => String(f).toLowerCase().includes(term))
      })
    }

    // Apply remito filter
    if (filters.remito.length > 0) {
      filtered = filtered.filter((c) => c.dispatch && filters.remito.includes(c.dispatch.remito || ""))
    }

    // Apply formula filter
    if (filters.formula.length > 0) {
      filtered = filtered.filter((c) => c.dispatch?.formula && filters.formula.includes(c.dispatch.formula.code))
    }

    // Apply probeta ID filter
    if (filters.probetaId.length > 0) {
      filtered = filtered.filter((c) => c.dispatch && filters.probetaId.includes(c.dispatch.sample_number || ""))
    }

    // Apply planta filter
    if (filters.planta.length > 0) {
      filtered = filtered.filter((c) => c.dispatch?.plant && filters.planta.includes(c.dispatch.plant.code))
    }

    // Apply dias filter
    if (filters.dias.length > 0) {
      filtered = filtered.filter((c) => filters.dias.includes(c.test_age_days))
    }

    // Apply cliente filter
    if (filters.cliente.length > 0) {
      filtered = filtered.filter((c) => c.dispatch && filters.cliente.includes(c.dispatch.client?.name || "-"))
    }

    // Apply obra filter
    if (filters.obra.length > 0) {
      filtered = filtered.filter((c) => c.dispatch && filters.obra.includes(c.dispatch.construction_site?.name || "-"))
    }

    // Apply estado filter
    if (filters.estado.length > 0) {
      filtered = filtered.filter((c) => {
        const estado = c.actual_test_date ? "Ensayado" : "Pendiente"
        return filters.estado.includes(estado)
      })
    }

    filtered.sort((a, b) => {
      // If either cylinder has no dispatch, sort them to the end
      if (!a.dispatch && !b.dispatch) return 0
      if (!a.dispatch) return 1
      if (!b.dispatch) return -1

      const dateA = new Date(a.dispatch.dispatch_date).getTime()
      const dateB = new Date(b.dispatch.dispatch_date).getTime()

      if (dateA !== dateB) {
        return dateB - dateA // Most recent first
      }

      // Then sort by sample_number (probeta ID)
      const sampleA = a.dispatch.sample_number || ""
      const sampleB = b.dispatch.sample_number || ""

      if (sampleA !== sampleB) {
        return sampleA.localeCompare(sampleB)
      }

      // Finally by cylinder_number (1 first - for 7 days)
      return a.cylinder_number - b.cylinder_number
    })

    setFilteredCylinders(filtered)
  }, [cylinders, filters, searchTerm])

  useEffect(() => {
    loadCylinders()
  }, [selectedPlantId, dateRange])

  const deleteCylinder = async (cylinder: TestCylinder) => {
    setDeleting(true)
    const supabase = createClient()
    if (!supabase) {
      setDeleting(false)
      return
    }

    const { error } = await supabase
      .from("test_cylinders")
      .delete()
      .eq("id", cylinder.id)

    if (error) {
      console.error("Error deleting cylinder:", error)
    } else {
      loadCylinders()
    }
    setDeleting(false)
    setDeletingCylinder(null)
  }

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return "-"

    try {
      // Handle both "YYYY-MM-DD" and "YYYY-MM-DDT12:00:00" formats
      const dateOnly = dateString.split("T")[0]
      const [year, month, day] = dateOnly.split("-")

      if (!year || !month || !day) return "-"

      const date = new Date(Number(year), Number(month) - 1, Number(day))
      return date.toLocaleDateString("es-AR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
    } catch (e) {
      return "-"
    }
  }

  const getUniqueValues = (key: keyof typeof filters) => {
    const values = new Set<string | number>()
    cylinders.forEach((c) => {
      switch (key) {
        case "remito":
          if (c.dispatch?.remito) values.add(c.dispatch.remito)
          break
        case "formula":
          if (c.dispatch?.formula?.code) values.add(c.dispatch.formula.code)
          break
        case "probetaId":
          if (c.dispatch?.sample_number) values.add(c.dispatch.sample_number)
          break
        case "planta":
          if (c.dispatch?.plant?.code) values.add(c.dispatch.plant.code)
          break
        case "dias":
          values.add(c.test_age_days)
          break
        case "cliente":
          values.add(c.dispatch?.client?.name || "-")
          break
        case "obra":
          values.add(c.dispatch?.construction_site?.name || "-")
          break
        case "estado":
          values.add(c.actual_test_date ? "Ensayado" : "Pendiente")
          break
      }
    })
    return Array.from(values).sort()
  }

  const ColumnFilter = ({ column, label }: { column: keyof typeof filters; label: string }) => {
    const uniqueValues = getUniqueValues(column)
    const selectedValues = filters[column]
    const [searchValue, setSearchValue] = useState("")

    const toggleValue = (value: string | number) => {
      const valueStr = String(value)
      const currentValues = selectedValues.map(String)

      if (currentValues.includes(valueStr)) {
        setFilters({
          ...filters,
          [column]: selectedValues.filter((v) => String(v) !== valueStr),
        })
      } else {
        setFilters({
          ...filters,
          [column]: [...selectedValues, column === "dias" ? Number(value) : value],
        })
      }
    }

    const clearFilter = () => {
      setFilters({ ...filters, [column]: [] })
      setSearchValue("")
    }

    const filteredUniqueValues = uniqueValues.filter((v) => 
      String(v).toLowerCase().includes(searchValue.toLowerCase())
    )

    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className={`h-8 ml-2 ${selectedValues.length > 0 ? "text-primary" : ""}`}>
            <Filter className="h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[250px] p-4" align="start">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-sm">Filtrar {label}</h4>
              {selectedValues.length > 0 && (
                <Button variant="ghost" size="sm" onClick={clearFilter} className="h-auto p-1 text-xs">
                  Limpiar
                </Button>
              )}
            </div>
            <Input 
              placeholder="Buscar..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              className="h-8 text-sm"
            />
            <div className="max-h-[250px] overflow-y-auto space-y-2">
              {filteredUniqueValues.map((value) => {
                const valueStr = String(value)
                const isChecked = selectedValues.map(String).includes(valueStr)
                return (
                  <div key={valueStr} className="flex items-center space-x-2">
                    <Checkbox
                      id={`${column}-${valueStr}`}
                      checked={isChecked}
                      onCheckedChange={() => toggleValue(value)}
                    />
                    <Label htmlFor={`${column}-${valueStr}`} className="text-sm font-normal cursor-pointer flex-1">
                      {valueStr}
                    </Label>
                  </div>
                )
              })}
              {filteredUniqueValues.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-2">Sin resultados</p>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    )
  }

  const hasActiveFilters = () => {
    return (
      filters.remito.length > 0 ||
      filters.formula.length > 0 ||
      filters.probetaId.length > 0 ||
      filters.planta.length > 0 ||
      filters.dias.length > 0 ||
      filters.cliente.length > 0 ||
      filters.obra.length > 0 ||
      filters.estado.length > 0 ||
      searchTerm.trim() !== "" ||
      dateRange.from !== "" ||
      dateRange.to !== ""
    )
  }

  const clearAllFilters = () => {
    setFilters({
      remito: [],
      formula: [],
      probetaId: [],
      planta: [],
      dias: [],
      cliente: [],
      obra: [],
      estado: [],
    })
    setSearchTerm("")
    setDateRange({ from: "", to: "" })
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-4 items-center flex-wrap">
        <Select value={selectedPlantId} onValueChange={onPlantChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Seleccionar planta" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las plantas</SelectItem>
            {plants.map((plant) => (
              <SelectItem key={plant.id} value={plant.id}>
                {plant.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />

        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar remito, probeta, formula, cliente, obra..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        <Button
          variant={hasActiveFilters() ? "default" : "outline"}
          size="sm"
          onClick={clearAllFilters}
          disabled={!hasActiveFilters()}
          className="ml-auto"
        >
          {hasActiveFilters() ? "Eliminar todos los filtros" : "Sin filtros activos"}
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="h-10">
              <TableHead className="w-[100px] py-2 px-3 text-xs sticky left-0 z-20 bg-card">
                <div className="flex items-center">
                  N° Remito
                  <ColumnFilter column="remito" label="Remito" />
                </div>
              </TableHead>
              <TableHead className="py-2 px-3 text-xs">
                <div className="flex items-center">
                  Tipo de Hormigón
                  <ColumnFilter column="formula" label="Tipo" />
                </div>
              </TableHead>
              <TableHead className="w-[90px] py-2 px-3 text-xs">Asentamiento</TableHead>
              <TableHead className="w-[90px] py-2 px-3 text-xs">
                <div className="flex items-center">
                  Probeta ID
                  <ColumnFilter column="probetaId" label="Probeta" />
                </div>
              </TableHead>
              <TableHead className="w-[80px] py-2 px-3 text-xs">
                <div className="flex items-center">
                  Planta
                  <ColumnFilter column="planta" label="Planta" />
                </div>
              </TableHead>
              <TableHead className="w-[100px] py-2 px-3 text-xs">Fecha Moldeo</TableHead>
              <TableHead className="w-[60px] py-2 px-3 text-xs text-center">
                <div className="flex items-center justify-center">
                  Días
                  <ColumnFilter column="dias" label="Días" />
                </div>
              </TableHead>
              <TableHead className="w-[100px] py-2 px-3 text-xs">Fecha Ensayo</TableHead>
              <TableHead className="w-[100px] py-2 px-3 text-xs">
                <div className="flex items-center">
                  Fecha Real
                  <ColumnFilter column="estado" label="Estado" />
                </div>
              </TableHead>
              <TableHead className="w-[80px] py-2 px-3 text-xs">Lec. Dial</TableHead>
              <TableHead className="w-[70px] py-2 px-3 text-xs">MPa</TableHead>
              <TableHead className="py-2 px-3 text-xs">
                <div className="flex items-center">
                  Cliente
                  <ColumnFilter column="cliente" label="Cliente" />
                </div>
              </TableHead>
              <TableHead className="py-2 px-3 text-xs">
                <div className="flex items-center">
                  Obra
                  <ColumnFilter column="obra" label="Obra" />
                </div>
              </TableHead>
              <TableHead className="w-[90px] py-2 px-3 text-xs">Agua Extra</TableHead>
              <TableHead className="py-2 px-3 text-xs">Comentario</TableHead>
              <TableHead className="w-[70px] py-2 px-3 text-xs">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={16} className="text-center py-8 text-sm">
                  Cargando probetas...
                </TableCell>
              </TableRow>
            ) : filteredCylinders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={16} className="text-center py-8 text-sm">
                  No hay probetas que coincidan con los filtros
                </TableCell>
              </TableRow>
            ) : (
              filteredCylinders.map((cylinder) => (
                <TableRow
                  key={cylinder.id}
                  className={`h-10 ${cylinder.dial_reading ? "bg-green-50 hover:bg-green-100" : ""}`}
                >
                  <TableCell className={`font-medium py-2 px-3 text-xs sticky left-0 z-10 ${cylinder.dial_reading ? "bg-green-50" : "bg-card"}`}>{cylinder.dispatch?.remito || "-"}</TableCell>
                  <TableCell className="py-2 px-3 text-xs">{cylinder.dispatch?.formula?.code || "-"}</TableCell>
                  <TableCell className="py-2 px-3 text-xs">
                    {cylinder.dispatch?.actual_slump_cm ? `${cylinder.dispatch.actual_slump_cm} cm` : "-"}
                  </TableCell>
                  <TableCell className="text-center font-semibold py-2 px-3 text-xs">
                    {cylinder.dispatch?.sample_number || "-"}
                  </TableCell>
                  <TableCell className="py-2 px-3 text-xs">{cylinder.dispatch?.plant?.code || "-"}</TableCell>
                  <TableCell className="py-2 px-3 text-xs">{formatDate(cylinder.dispatch?.dispatch_date)}</TableCell>
                  <TableCell className="text-center py-2 px-3 text-xs">{cylinder.test_age_days}</TableCell>
                  <TableCell className="py-2 px-3 text-xs">{formatDate(cylinder.scheduled_test_date)}</TableCell>
                  <TableCell className="py-2 px-3 text-xs">
                    {cylinder.actual_test_date ? (
                      formatDate(cylinder.actual_test_date)
                    ) : (
                      <span className="text-muted-foreground">Pendiente</span>
                    )}
                  </TableCell>
                  <TableCell className="py-2 px-3 text-xs">
                    {cylinder.dial_reading ? cylinder.dial_reading.toFixed(2) : "-"}
                  </TableCell>
                  <TableCell className="py-2 px-3 text-xs">
                    {cylinder.strength_mpa ? (
                      <span className="font-semibold">{cylinder.strength_mpa.toFixed(2)}</span>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell className="py-2 px-3 text-xs">{cylinder.dispatch?.client?.name || "-"}</TableCell>
                  <TableCell className="py-2 px-3 text-xs">
                    {cylinder.dispatch?.construction_site?.name || "-"}
                  </TableCell>
                  <TableCell className="text-center py-2 px-3 text-xs">
                    {cylinder.dispatch?.extra_water_liters ? `${cylinder.dispatch.extra_water_liters}L` : "-"}
                  </TableCell>
                  <TableCell className="max-w-[150px] truncate py-2 px-3 text-xs">{cylinder.comments || "-"}</TableCell>
                    <TableCell className="py-2 px-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditingCylinder(cylinder)}>
                            <Edit className="h-4 w-4 mr-2" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => setDeletingCylinder(cylinder)}
                            className="text-red-600 focus:text-red-600"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Eliminar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {editingCylinder && (
        <EditCylinderDialog
          cylinder={editingCylinder}
          onClose={() => setEditingCylinder(null)}
          onUpdate={loadCylinders}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingCylinder} onOpenChange={(open) => !open && setDeletingCylinder(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar Probeta</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingCylinder && (
                <>
                  Esta por eliminar la probeta <strong>{deletingCylinder.dispatch?.sample_number || "N/A"}</strong> 
                  {" "}(Cilindro #{deletingCylinder.cylinder_number}, {deletingCylinder.test_age_days} dias).
                  <br /><br />
                  Esta accion no se puede deshacer.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingCylinder && deleteCylinder(deletingCylinder)}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
