"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getSupabase } from "@/lib/supabase"
import { formatDateForDisplay } from "@/lib/date-utils"
import { Calendar, Search, ChevronDown, ChevronUp, Trash2, Download, AlertTriangle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { PaverProductionForm } from "@/components/paver-production-form"
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

export function RanchosProductionHistory() {
  const { toast } = useToast()
  const [records, setRecords] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [expandedRow, setExpandedRow] = useState<number | null>(null)
  const [editingRow, setEditingRow] = useState<number | null>(null)
  const [editFormData, setEditFormData] = useState<any>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  useEffect(() => { loadHistory() }, [])

  async function loadHistory() {
    setLoading(true)
    try {
      const supabase = getSupabase()
      let query = supabase
        .from("paver_production")
        .select("*, paver_downtime(*)")
        .order("production_date", { ascending: false })
        .limit(100)

      if (dateFrom) query = query.gte("production_date", dateFrom)
      if (dateTo) query = query.lte("production_date", dateTo)

      const { data, error } = await query
      if (error) throw error
      setRecords(data || [])
    } catch (err) {
      console.error("[v0] Error loading paver history:", err)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: number) {
    try {
      const supabase = getSupabase()
      const { error } = await supabase.from("paver_production").delete().eq("id", id)
      if (error) throw error
      setRecords(prev => prev.filter(r => r.id !== id))
      toast({ title: "Eliminado", description: "El parte fue eliminado" })
      setDeletingId(null)
    } catch {
      toast({ title: "Error", description: "No se pudo eliminar", variant: "destructive" })
    }
  }

  function handleEditSave() {
    setEditingRow(null)
    setEditFormData(null)
    loadHistory()
  }

  function exportCSV() {
    if (records.length === 0) return
    const rows = records.map(r => ({
      Fecha: r.production_date,
      Inicio: r.start_time || "",
      Fin: r.end_time || "",
      "Tiempo extra": r.extra_minutes || 0,
      Producto: r.product_type_code || "",
      Formula: r.paston_formula || "",
      Pastones: r.pastones_count || 0,
      "Silo 1 (tn)": r.cement_silo_1_tn || 0,
      "Silo 2 (tn)": r.cement_silo_2_tn || 0,
      "Min paradas": (r.paver_downtime || []).reduce((s: number, d: any) => s + (d.minutes || 0), 0),
      Observaciones: r.observations || "",
    }))

    const header = Object.keys(rows[0]).join(",")
    const body = rows.map(r => Object.values(r).map(v => `"${v}"`).join(",")).join("\n")
    const csv = `${header}\n${body}`
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `ranchos-adoquines-historial.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Adoquines - Registros</CardTitle>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={records.length === 0}>
            <Download className="h-3.5 w-3.5 mr-1" /> CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="space-y-1">
            <Label className="text-xs">Desde</Label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 text-sm w-[150px]" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Hasta</Label>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-8 text-sm w-[150px]" />
          </div>
          <Button variant="outline" size="sm" onClick={loadHistory} className="h-8">
            <Search className="h-3.5 w-3.5 mr-1" /> Buscar
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        ) : records.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <AlertTriangle className="h-8 w-8 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No hay registros de adoquines. Carga tu primer parte desde "Nueva Produccion".</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-3">Fecha</th>
                  <th className="pb-2 pr-3">Horario</th>
                  <th className="pb-2 pr-3">Producto</th>
                  <th className="pb-2 pr-3 text-right">Pastones</th>
                  <th className="pb-2 pr-3 text-right">Cemento (tn)</th>
                  <th className="pb-2 pr-3 text-right">Paradas</th>
                  <th className="pb-2 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {records.map(record => {
                  const isExpanded = expandedRow === record.id
                  const totalDowntime = (record.paver_downtime || []).reduce((s: number, d: any) => s + (d.minutes || 0), 0)
                  const cementoTotal = ((record.cement_silo_1_tn || 0) + (record.cement_silo_2_tn || 0)).toFixed(3)

                  return (
                    <React.Fragment key={record.id}>
                      <tr
                        className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => setExpandedRow(isExpanded ? null : record.id)}
                      >
                        <td className="py-2 pr-3 font-medium">
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-3 w-3 text-muted-foreground" />
                            {formatDateForDisplay(record.production_date)}
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          {record.start_time?.slice(0, 5)} - {record.end_time?.slice(0, 5)}
                          {record.extra_minutes > 0 && <span className="ml-1 text-primary">(+{record.extra_minutes}min)</span>}
                        </td>
                        <td className="py-2 pr-3">
                          <span className="flex items-center gap-1">
                            {record.product_type_code || "-"}
                            {record.supplier_changed && (
                              <span className="inline-block w-2 h-2 rounded-full bg-amber-400 shrink-0" title="Cambio de proveedor" />
                            )}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-right font-medium">{record.pastones_count || 0}</td>
                        <td className="py-2 pr-3 text-right">{cementoTotal}</td>
                        <td className="py-2 pr-3 text-right">{totalDowntime > 0 ? `${totalDowntime} min` : "-"}</td>
                        <td className="py-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </div>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr>
                          <td colSpan={7} className="py-3 px-4 bg-muted/20">
                            <div className="space-y-3">
                              {/* Details */}
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                                <div><span className="text-muted-foreground">Formula:</span> <span className="font-medium">{record.paston_formula || "-"}</span></div>
                                <div><span className="text-muted-foreground">Pastones:</span> <span className="font-medium">{record.pastones_count || 0}</span></div>
                                <div><span className="text-muted-foreground">Silo 1:</span> <span className="font-medium">{record.cement_silo_1_tn || 0} tn</span></div>
                                <div><span className="text-muted-foreground">Silo 2:</span> <span className="font-medium">{record.cement_silo_2_tn || 0} tn</span></div>
                              </div>

                              {/* Suppliers */}
                              {(record.cement_supplier || record.sand_supplier || record.stone_supplier) && (
                                <div className="flex items-center gap-3 flex-wrap text-xs">
                                  <span className="text-muted-foreground font-medium">Proveedores:</span>
                                  {record.cement_supplier && <span className="bg-muted px-1.5 py-0.5 rounded">Cemento: <strong>{record.cement_supplier}</strong></span>}
                                  {record.sand_supplier && <span className="bg-muted px-1.5 py-0.5 rounded">Arena: <strong>{record.sand_supplier}</strong></span>}
                                  {record.stone_supplier && <span className="bg-muted px-1.5 py-0.5 rounded">Piedra: <strong>{record.stone_supplier}</strong></span>}
                                  {record.supplier_changed && (
                                    <span className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded font-medium">
                                      Cambio de proveedor
                                    </span>
                                  )}
                                </div>
                              )}
                              {record.supplier_changed && record.supplier_change_notes && (
                                <div className="text-xs bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2">
                                  <span className="text-amber-700 dark:text-amber-400 font-medium">Nota cambio proveedor: </span>
                                  <span className="text-foreground">{record.supplier_change_notes}</span>
                                </div>
                              )}

                              {/* Downtimes */}
                              {record.paver_downtime?.length > 0 && (
                                <div>
                                  <h4 className="text-xs font-semibold text-muted-foreground mb-1">Paradas:</h4>
                                  <div className="space-y-0.5">
                                    {record.paver_downtime.map((dt: any, i: number) => (
                                      <div key={i} className="flex items-center gap-2 text-xs">
                                        <span className="text-muted-foreground w-20 shrink-0">[{dt.downtime_category}]</span>
                                        <span className="font-medium">{dt.custom_reason}</span>
                                        <span className="text-destructive font-semibold">{dt.minutes} min</span>
                                        {dt.comments && <span className="text-muted-foreground italic">- {dt.comments}</span>}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {record.observations && (
                                <div className="text-xs">
                                  <span className="text-muted-foreground">Obs: </span>
                                  <span>{record.observations}</span>
                                </div>
                              )}

                              {/* Actions */}
                              <div className="flex gap-2 pt-1">
                                <Dialog open={editingRow === record.id} onOpenChange={(open) => {
                                  if (!open) { setEditingRow(null); setEditFormData(null) }
                                }}>
                                  <DialogTrigger asChild>
                                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => {
                                      setEditingRow(record.id)
                                      setEditFormData(record)
                                    }}>
                                      Editar
                                    </Button>
                                  </DialogTrigger>
                                  <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                                    <DialogHeader>
                                      <DialogTitle>Editar Parte de Adoquines</DialogTitle>
                                    </DialogHeader>
                                    {editFormData && (
                                      <PaverProductionForm
                                        editingRecord={editFormData}
                                        onSaveComplete={handleEditSave}
                                      />
                                    )}
                                  </DialogContent>
                                </Dialog>

                                <AlertDialog open={deletingId === record.id} onOpenChange={(open) => { if (!open) setDeletingId(null) }}>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={() => setDeletingId(record.id)}>
                                      <Trash2 className="h-3 w-3 mr-1" /> Eliminar
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Eliminar parte</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Vas a eliminar el parte del {formatDateForDisplay(record.production_date)}. Esta accion no se puede deshacer.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => handleDelete(record.id)}>Eliminar</AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Need React import for Fragment
import React from "react"
