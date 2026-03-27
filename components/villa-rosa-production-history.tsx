"use client"

import React from "react"
import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getSupabase } from "@/lib/supabase"
import { formatDateForDisplay } from "@/lib/date-utils"
import { Calendar, Search, ChevronDown, ChevronUp, Download, Trash2, Cylinder } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { PipeProductionForm, LARGE_PIPE_SIZES } from "@/components/pipe-production-form"

const PIPE_WEIGHTS_KG: Record<string, number> = {
  "800": 0.8,
  "1000": 1.0,
  "1200": 1.2,
}

export function VillaRosaProductionHistory() {
  const { toast } = useToast()
  const [pipeHistory, setPipeHistory] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [expandedRow, setExpandedRow] = useState<number | null>(null)
  const [editPipeFormData, setEditPipeFormData] = useState<any>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  useEffect(() => {
    loadHistory()
  }, [])

  async function loadHistory() {
    try {
      const supabase = getSupabase()

      // Load pipe production for Villa Rosa (large pipes: 800, 1000, 1200)
      const { data: pipeData } = await supabase
        .from("pipe_production")
        .select("*, pipe_downtime(*, downtime_reasons(*)), pipe_mold_breakage(*)")
        .eq("plant", "villa-rosa")
        .order("production_date", { ascending: false })
        .order("shift", { ascending: false })
        .limit(500)

      if (pipeData) {
        setPipeHistory(pipeData)
      }

      setLoading(false)
    } catch (error) {
      console.error("Error loading history:", error)
      setLoading(false)
    }
  }

  async function handleFilter() {
    if (!dateFrom && !dateTo) {
      loadHistory()
      return
    }

    setLoading(true)
    const supabase = getSupabase()

    let pipeQuery = supabase
      .from("pipe_production")
      .select("*, pipe_downtime(*, downtime_reasons(*)), pipe_mold_breakage(*)")
      .eq("plant", "villa-rosa")
      .order("production_date", { ascending: false })
      .order("shift", { ascending: false })

    if (dateFrom) {
      pipeQuery = pipeQuery.gte("production_date", dateFrom)
    }

    if (dateTo) {
      pipeQuery = pipeQuery.lte("production_date", dateTo)
    }

    const { data: pipeData } = await pipeQuery

    if (pipeData) setPipeHistory(pipeData)

    setLoading(false)
  }

  function toggleRow(id: number) {
    setExpandedRow(expandedRow === id ? null : id)
  }

  function handleEditPipe(record: any) {
    setEditPipeFormData(record)
  }

  async function handleClosePipeEdit() {
    setEditPipeFormData(null)
    await loadHistory()
  }

  async function handleDelete(id: number) {
    const supabase = getSupabase()
    setLoading(true)

    try {
      const { error } = await supabase.from("pipe_production").delete().eq("id", id)

      if (error) throw error

      toast({
        title: "Eliminado",
        description: "El parte de producción se eliminó correctamente",
      })

      loadHistory()
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo eliminar el registro",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
      setDeletingId(null)
    }
  }

  function calculateTotalPipes(record: any): number {
    let total = 0
    for (const size of LARGE_PIPE_SIZES) {
      total += (record[`cc${size}_simples`] || 0)
      total += (record[`cc${size}_rotura`] || 0)
      total += (record[`cc${size}_armado`] || 0)
      total += (record[`cc${size}_rotura_armado`] || 0)
    }
    return total
  }

  function calculateTotalDowntime(record: any): number {
    if (!record.pipe_downtime) return 0
    return record.pipe_downtime.reduce((sum: number, dt: any) => sum + (dt.minutes || 0), 0)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Cylinder className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Historial de Caños Grandes</CardTitle>
              <CardDescription>Villa Rosa - Caños de 800, 1000 y 1200mm</CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="flex flex-wrap items-end gap-4 mb-6">
          <div>
            <Label htmlFor="dateFrom" className="text-sm text-muted-foreground">Desde</Label>
            <Input
              id="dateFrom"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-40"
            />
          </div>
          <div>
            <Label htmlFor="dateTo" className="text-sm text-muted-foreground">Hasta</Label>
            <Input
              id="dateTo"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-40"
            />
          </div>
          <Button variant="outline" onClick={handleFilter} className="gap-2">
            <Search className="h-4 w-4" />
            Filtrar
          </Button>
        </div>

        {/* Table */}
        {pipeHistory.length === 0 ? (
          <div className="text-center py-12">
            <Calendar className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">No hay registros de producción</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-2 font-medium text-muted-foreground">Fecha</th>
                  <th className="text-center py-3 px-2 font-medium text-muted-foreground">Turno</th>
                  <th className="text-center py-3 px-2 font-medium text-muted-foreground">Total Caños</th>
                  <th className="text-center py-3 px-2 font-medium text-muted-foreground">Paradas (min)</th>
                  <th className="text-center py-3 px-2 font-medium text-muted-foreground">Operador</th>
                  <th className="text-center py-3 px-2 font-medium text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody>
                {pipeHistory.map((record) => (
                  <React.Fragment key={record.id}>
                    <tr
                      className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => toggleRow(record.id)}
                    >
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-2">
                          {expandedRow === record.id ? (
                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          )}
                          {formatDateForDisplay(record.production_date)}
                        </div>
                      </td>
                      <td className="py-3 px-2 text-center">{record.shift}</td>
                      <td className="py-3 px-2 text-center font-medium">{calculateTotalPipes(record)}</td>
                      <td className="py-3 px-2 text-center">{calculateTotalDowntime(record)}</td>
                      <td className="py-3 px-2 text-center">{record.machine_operator || "-"}</td>
                      <td className="py-3 px-2 text-center">
                        <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <Dialog open={editPipeFormData?.id === record.id} onOpenChange={(open) => !open && handleClosePipeEdit()}>
                            <DialogTrigger asChild>
                              <Button variant="ghost" size="sm" onClick={() => handleEditPipe(record)}>
                                Editar
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                              <DialogHeader>
                                <DialogTitle>Editar Parte de Caños - Villa Rosa</DialogTitle>
                              </DialogHeader>
                              {editPipeFormData && (
                                <PipeProductionForm
                                  editingRecord={editPipeFormData}
                                  onSaveComplete={handleClosePipeEdit}
                                  pipeSizes={LARGE_PIPE_SIZES}
                                  plantName="Villa Rosa"
                                />
                              )}
                            </DialogContent>
                          </Dialog>
                          <AlertDialog open={deletingId === record.id} onOpenChange={(open) => !open && setDeletingId(null)}>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeletingId(record.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Eliminar registro</AlertDialogTitle>
                                <AlertDialogDescription>
                                  ¿Estás seguro de eliminar este parte de producción? Esta acción no se puede deshacer.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDelete(record.id)} className="bg-destructive text-destructive-foreground">
                                  Eliminar
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </td>
                    </tr>
                    {expandedRow === record.id && (
                      <tr>
                        <td colSpan={6} className="bg-muted/20 p-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Production by size */}
                            <div>
                              <h4 className="font-medium mb-2">Producción por Medida</h4>
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b">
                                    <th className="text-left py-1">Medida</th>
                                    <th className="text-center py-1">Simples</th>
                                    <th className="text-center py-1">Rotura</th>
                                    <th className="text-center py-1">Armado</th>
                                    <th className="text-center py-1">Rot+Arm</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {LARGE_PIPE_SIZES.map((size) => (
                                    <tr key={size} className="border-b border-border/30">
                                      <td className="py-1">Ø {size}mm</td>
                                      <td className="text-center py-1">{record[`cc${size}_simples`] || "-"}</td>
                                      <td className="text-center py-1">{record[`cc${size}_rotura`] || "-"}</td>
                                      <td className="text-center py-1">{record[`cc${size}_armado`] || "-"}</td>
                                      <td className="text-center py-1">{record[`cc${size}_rotura_armado`] || "-"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            {/* Downtimes */}
                            <div>
                              <h4 className="font-medium mb-2">Paradas</h4>
                              {record.pipe_downtime && record.pipe_downtime.length > 0 ? (
                                <ul className="space-y-1 text-xs">
                                  {record.pipe_downtime.map((dt: any, idx: number) => (
                                    <li key={idx} className="flex justify-between">
                                      <span>{dt.downtime_reasons?.name || dt.reason || "Sin motivo"}</span>
                                      <span className="font-medium">{dt.minutes} min</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-xs text-muted-foreground">Sin paradas registradas</p>
                              )}
                            </div>

                            {/* Mold breakages */}
                            {record.pipe_mold_breakage && record.pipe_mold_breakage.length > 0 && (
                              <div>
                                <h4 className="font-medium mb-2">Roturas de Molde</h4>
                                <ul className="space-y-1 text-xs">
                                  {record.pipe_mold_breakage.map((mb: any, idx: number) => (
                                    <li key={idx}>
                                      <span className="font-medium">Ø {mb.pipe_size}mm:</span> {mb.reasons?.join(", ") || "Sin motivo"}
                                      {mb.comments && <span className="text-muted-foreground ml-1">({mb.comments})</span>}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Observations */}
                            {record.observations && (
                              <div>
                                <h4 className="font-medium mb-2">Observaciones</h4>
                                <p className="text-xs text-muted-foreground">{record.observations}</p>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
