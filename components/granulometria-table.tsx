"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Loader2, Eye, Pencil, Clock, AlertTriangle, CheckCircle } from "lucide-react"
import { toast } from "@/hooks/use-toast"
import { AddGranulometriaDialog } from "@/components/add-granulometria-dialog"
import { ViewGranulometriaDialog } from "@/components/view-granulometria-dialog"
import { EditGranulometriaDialog } from "@/components/edit-granulometria-dialog"

interface GranulometriaTest {
  id: string
  extraction_date: string
  provider: string
  aggregate_type: string
  fineness_modulus: number | null
  sample_weight_grams: number | null
  dry_weight_grams: number | null
  moisture_percent: number | null
  remito: string | null
  comments: string | null
  plant_id: string | null
  stock_entry_id: string | null
}

interface GranulometriaTableProps {
  plants: Array<{ id: string; name: string }>
  selectedPlantId: string
  onPlantChange: (plantId: string) => void
}

export function GranulometriaTable({ plants, selectedPlantId: initialPlantId }: GranulometriaTableProps) {
  const [tests, setTests] = useState<GranulometriaTest[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPlantId, setSelectedPlantId] = useState(initialPlantId)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null)
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editTestId, setEditTestId] = useState<string | null>(null)

  useEffect(() => {
    loadTests()
  }, [selectedPlantId])

  const loadTests = async () => {
    setLoading(true)
    const supabase = createClient()

    let query = supabase.from("granulometria_tests").select("*").order("extraction_date", { ascending: false })

    if (selectedPlantId !== "all") {
      query = query.eq("plant_id", selectedPlantId)
    }

    const { data, error } = await query

    if (error) {
      console.error("Error loading granulometria tests:", error)
      toast({
        title: "Error",
        description: "No se pudieron cargar los ensayos",
        variant: "destructive",
      })
      setTests([])
    } else {
      // Sort: pending tests first, then by date
      const sortedTests = (data || []).sort((a, b) => {
        const aPending = a.fineness_modulus === null
        const bPending = b.fineness_modulus === null
        if (aPending && !bPending) return -1
        if (!aPending && bPending) return 1
        return new Date(b.extraction_date).getTime() - new Date(a.extraction_date).getTime()
      })
      setTests(sortedTests)
    }
    setLoading(false)
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return ""
    const date = new Date(dateStr)
    return date.toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
  }

  const getFinenessModulusColor = (fm: number | null) => {
    if (!fm) return ""
    if (fm < 1.8 || fm > 2.2) return "text-red-600 font-semibold"
    return "text-green-600 font-semibold"
  }

  const handleViewTest = (testId: string) => {
    setSelectedTestId(testId)
    setIsViewDialogOpen(true)
  }

  const handleEditTest = (testId: string) => {
    setEditTestId(testId)
    setIsEditDialogOpen(true)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <Select value={selectedPlantId} onValueChange={setSelectedPlantId}>
          <SelectTrigger className="w-[250px]">
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
        <Button onClick={() => setIsAddDialogOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Nuevo Ensayo
        </Button>
      </div>

      {tests.length === 0 ? (
        <div className="text-center p-8 text-muted-foreground">
          No hay ensayos de granulometría registrados para esta planta.
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="font-semibold">Fecha Extracción</TableHead>
                <TableHead className="font-semibold">Proveedor</TableHead>
                <TableHead className="font-semibold">Remito</TableHead>
                <TableHead className="font-semibold">Módulo Finura</TableHead>
                <TableHead className="font-semibold">Clasificación</TableHead>
                <TableHead className="font-semibold w-[100px]">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tests.map((test) => {
                const isPending = test.fineness_modulus === null
                return (
                  <TableRow key={test.id} className={isPending ? "bg-amber-50 dark:bg-amber-950/20" : ""}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {formatDate(test.extraction_date)}
                        {isPending && (
                          <Badge variant="outline" className="text-amber-600 border-amber-300 gap-1">
                            <Clock className="h-3 w-3" />
                            Pendiente
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{test.provider}</TableCell>
                    <TableCell>{test.remito || "-"}</TableCell>
                    <TableCell className={getFinenessModulusColor(test.fineness_modulus)}>
                      {test.fineness_modulus?.toFixed(2) || "-"}
                    </TableCell>
                    <TableCell>
                      {test.fineness_modulus ? (
                        <Badge variant="outline" className={
                          test.fineness_modulus > 3.0 
                            ? "bg-orange-50 text-orange-700 border-orange-300" 
                            : test.fineness_modulus >= 2.3 
                              ? "bg-blue-50 text-blue-700 border-blue-300" 
                              : "bg-purple-50 text-purple-700 border-purple-300"
                        }>
                          {test.fineness_modulus > 3.0 
                            ? "Arena Gruesa" 
                            : test.fineness_modulus >= 2.3 
                              ? "Arena Media" 
                              : "Arena Fina"}
                        </Badge>
                      ) : "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {!isPending && (
                          <Button size="sm" variant="ghost" onClick={() => handleViewTest(test.id)} className="h-8 w-8 p-0">
                            <Eye className="h-4 w-4" />
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => handleEditTest(test.id)} className="h-8 w-8 p-0">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AddGranulometriaDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        plants={plants}
        onTestAdded={loadTests}
      />

      {selectedTestId && (
        <ViewGranulometriaDialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen} testId={selectedTestId} />
      )}

      {editTestId && (
        <EditGranulometriaDialog
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          testId={editTestId}
          plants={plants}
          onTestUpdated={loadTests}
        />
      )}
    </div>
  )
}
