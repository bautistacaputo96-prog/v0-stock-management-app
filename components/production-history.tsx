"use client"

import React from "react"

import { useState, useEffect } from "react"
import { usePlant } from "@/lib/plant-context"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getSupabase } from "@/lib/supabase"
import type { CycleTime } from "@/lib/types"
import { calculateBlockOEE, calculatePipeOEE } from "@/lib/calculations"
import { PLANNED_DOWNTIME_CATEGORIES } from "@/lib/report-utils"
import { exportBlockProductionToCSV, exportPipeProductionToCSV, downloadCSV } from "@/lib/export-utils"
import { formatDateForDisplay } from "@/lib/date-utils"
import { Calendar, Search, ChevronDown, ChevronUp, Download, Trash2, Factory, Cylinder } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { BlockProductionForm } from "@/components/block-production-form" // Import the BlockProductionForm component
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
import { PipeProductionForm } from "@/components/pipe-production-form" // Import the PipeProductionForm component

const PIPE_WEIGHTS_KG = {
  "300": 0.3,
  "400": 0.4,
  "500": 0.5,
  "600": 0.6,
  "800": 0.8,
  "1000": 1.0,
  "1200": 1.2,
};

export function ProductionHistory() {
  const { toast } = useToast()
  const { selectedPlant } = usePlant()
  const [activeTab, setActiveTab] = useState<"bloques" | "caños">("caños")
  const [blockHistory, setBlockHistory] = useState<any[]>([])
  const [pipeHistory, setPipeHistory] = useState<any[]>([])
  const [cycleTimes, setCycleTimes] = useState<CycleTime[]>([])
  const [pipeWeightsKg, setPipeWeightsKg] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [expandedRow, setExpandedRow] = useState<number | null>(null)
  const [editingRow, setEditingRow] = useState<number | null>(null)
  const [editFormData, setEditFormData] = useState<any>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [editPipeFormData, setEditPipeFormData] = useState<any>(null)

  useEffect(() => {
    loadHistory()
  }, [])

  async function loadHistory() {
    try {
      const supabase = getSupabase()

      // Load cycle times
      const { data: cycleData } = await supabase.from("cycle_times").select("*")
      if (cycleData) setCycleTimes(cycleData)

      // Load pipe weights from product_config
      const { data: pipeProducts } = await supabase
        .from("product_config")
        .select("product_code, piece_weight_kg")
        .eq("line_type", "caños")
        .eq("is_active", true)
      
      if (pipeProducts) {
        const weights: Record<string, number> = {}
        pipeProducts.forEach((p: any) => {
          // Extract diameter from product_code (e.g., "CC400" -> "400", "CC1000" -> "1000")
          const match = p.product_code?.match(/CC(\d+)/)
          if (match && p.piece_weight_kg) {
            weights[match[1]] = p.piece_weight_kg
          }
        })
        setPipeWeightsKg(weights)
      }

      // Load block production with downtimes
      const { data: blockData } = await supabase
        .from("block_production")
        .select("*, block_downtime(*, downtime_reasons(*))")
        .order("production_date", { ascending: false })
        .order("shift", { ascending: false })
        .limit(500)

      if (blockData) {
        setBlockHistory(blockData)
      }

      // Load pipe production with downtimes (only SILKE plant)
      const { data: pipeData } = await supabase
        .from("pipe_production")
        .select("*, pipe_downtime(*, downtime_reasons(*)), pipe_mold_breakage(*)")
        .or("plant.is.null,plant.eq.silke")
        .order("production_date", { ascending: false })
        .order("shift", { ascending: false })
        .limit(500)

      // Load pipe quality control data to get waste info
      const { data: qualityData } = await supabase
        .from("pipe_quality_control")
        .select(`
          *,
          items:pipe_quality_items(*)
        `)
        .order("control_date", { ascending: false })
        .limit(500)

      if (pipeData) {
        // Merge quality data with production data by date
        const qualityByDate: Record<string, any> = {}
        qualityData?.forEach((qc: any) => {
          const date = qc.control_date
          if (!qualityByDate[date]) {
            qualityByDate[date] = { second: 0, broken: 0 }
          }
          qc.items?.forEach((item: any) => {
            qualityByDate[date].second += item.second_quality || 0
            qualityByDate[date].broken += item.broken || 0
          })
        })
        
        // Attach quality data to each production record
        const enrichedPipeData = pipeData.map((record: any) => ({
          ...record,
          quality_waste: qualityByDate[record.production_date] || null
        }))
        
        setPipeHistory(enrichedPipeData)
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

    let blockQuery = supabase
      .from("block_production")
      .select("*, block_downtime(*, downtime_reasons(*))")
      .order("production_date", { ascending: false })
      .order("shift", { ascending: false })

    let pipeQuery = supabase
      .from("pipe_production")
      .select("*, pipe_downtime(*, downtime_reasons(*)), pipe_mold_breakage(*)")
      .or("plant.is.null,plant.eq.silke")
      .order("production_date", { ascending: false })
      .order("shift", { ascending: false })

    if (dateFrom) {
      blockQuery = blockQuery.gte("production_date", dateFrom)
      pipeQuery = pipeQuery.gte("production_date", dateFrom)
    }

    if (dateTo) {
      blockQuery = blockQuery.lte("production_date", dateTo)
      pipeQuery = pipeQuery.lte("production_date", dateTo)
    }

    const { data: blockData } = await blockQuery
    const { data: pipeData } = await pipeQuery

    if (blockData) setBlockHistory(blockData)
    
    if (pipeData) {
      // Load quality data for the filtered date range
      let qualityQuery = supabase
        .from("pipe_quality_control")
        .select("*, items:pipe_quality_items(*)")
      
      if (dateFrom) qualityQuery = qualityQuery.gte("control_date", dateFrom)
      if (dateTo) qualityQuery = qualityQuery.lte("control_date", dateTo)
      
      const { data: qualityData } = await qualityQuery
      
      // Merge quality data with production data
      const qualityByDate: Record<string, any> = {}
      qualityData?.forEach((qc: any) => {
        const date = qc.control_date
        if (!qualityByDate[date]) {
          qualityByDate[date] = { second: 0, broken: 0 }
        }
        qc.items?.forEach((item: any) => {
          qualityByDate[date].second += item.second_quality || 0
          qualityByDate[date].broken += item.broken || 0
        })
      })
      
      const enrichedPipeData = pipeData.map((record: any) => ({
        ...record,
        quality_waste: qualityByDate[record.production_date] || null
      }))
      
      setPipeHistory(enrichedPipeData)
    }

    setLoading(false)
  }

  function toggleRow(id: number) {
    setExpandedRow(expandedRow === id ? null : id)
  }

  function handleEdit(record: any) {
    setEditFormData(record)
    setEditingRow(record.id)
  }

  async function handleCloseEdit() {
    setEditingRow(null)
    setEditFormData(null)
    await loadHistory()
  }

  async function handleSaveEdit() {
    if (!editFormData) return

    const supabase = getSupabase()
    setLoading(true)

    try {
      const { error } = await supabase
        .from("block_production")
        .update({
          product_type: editFormData.product_type,
          racks_to_camera: editFormData.racks_to_camera,
          scrap_units: editFormData.scrap_units,
          machine_operator: editFormData.machine_operator,
          internal_driver: editFormData.internal_driver,
          palletizer1: editFormData.palletizer1,
          palletizer2: editFormData.palletizer2,
        })
        .eq("id", editFormData.id)

      if (error) throw error

      toast({
        title: "Guardado",
        description: "El parte de producción se actualizó correctamente",
      })

      setEditingRow(null)
      setEditFormData(null)
      loadHistory()
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo guardar los cambios",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  function handleExportBlocks() {
    if (blockHistory.length === 0) {
      toast({
        title: "Sin datos",
        description: "No hay registros de bloques para exportar",
        variant: "destructive",
      })
      return
    }

    const csv = exportBlockProductionToCSV(blockHistory, cycleTimes)
    const filename = `bloques_${dateFrom || "inicio"}_${dateTo || "fin"}_${new Date().toISOString().split("T")[0]}.csv`
    downloadCSV(csv, filename)

    toast({
      title: "Exportado",
      description: `Se exportaron ${blockHistory.length} registros de bloques`,
    })
  }

  function handleExportPipes() {
    if (pipeHistory.length === 0) {
      toast({
        title: "Sin datos",
        description: "No hay registros de caños para exportar",
        variant: "destructive",
      })
      return
    }

    const csv = exportPipeProductionToCSV(pipeHistory, cycleTimes)
    const filename = `caños_${dateFrom || "inicio"}_${dateTo || "fin"}_${new Date().toISOString().split("T")[0]}.csv`
    downloadCSV(csv, filename)

    toast({
      title: "Exportado",
      description: `Se exportaron ${pipeHistory.length} registros de caños`,
    })
  }

  async function handleDeleteBlock(id: number) {
    const supabase = getSupabase()
    setLoading(true)

    try {
      // First delete related downtimes
      await supabase.from("block_downtime").delete().eq("block_production_id", id)

      // Then delete the production record
      const { error } = await supabase.from("block_production").delete().eq("id", id)

      if (error) throw error

      toast({
        title: "Eliminado",
        description: "El parte de producción se eliminó correctamente",
      })

      loadHistory()
    } catch (error) {
      console.error("[v0] Error deleting block production:", error)
      toast({
        title: "Error",
        description: "No se pudo eliminar el parte de producción",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
      setDeletingId(null)
    }
  }

  async function handleDeletePipe(id: number) {
    const supabase = getSupabase()
    setLoading(true)
    
    try {
      // First delete related downtimes and mold breakages
      await supabase.from("pipe_downtime").delete().eq("pipe_production_id", id)
      await supabase.from("pipe_mold_breakage").delete().eq("pipe_production_id", id)
      
      // Then delete the production record
      const { error } = await supabase.from("pipe_production").delete().eq("id", id)

      if (error) throw error

      toast({
        title: "Eliminado",
        description: "El parte de producción de caños se eliminó correctamente",
      })

      loadHistory()
    } catch (error) {
      console.error("[v0] Error deleting pipe production:", error)
      toast({
        title: "Error",
        description: "No se pudo eliminar el parte de producción de caños",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
      setDeletingId(null)
    }
  }

  function handleEditPipe(record: any) {
    setEditPipeFormData(record)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Cargando historial...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Filtros de Búsqueda</CardTitle>
          <CardDescription>Filtra los registros por rango de fechas</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="dateFrom">Desde</Label>
              <Input id="dateFrom" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dateTo">Hasta</Label>
              <Input id="dateTo" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>

            <div className="flex items-end">
              <Button onClick={handleFilter} className="w-full">
                <Search className="mr-2 h-4 w-4" />
                Buscar
              </Button>
            </div>

            <div className="flex items-end">
              <Button
                onClick={activeTab === "bloques" ? handleExportBlocks : handleExportPipes}
                variant="outline"
                className="w-full bg-transparent"
              >
                <Download className="mr-2 h-4 w-4" />
                Exportar CSV
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Selector de línea de producción — bloques solo si la planta lo tiene */}
      <div className="flex gap-3 mb-4">
        {selectedPlant !== "silke" && selectedPlant !== "villa-rosa" && (
          <button
            type="button"
            onClick={() => setActiveTab("bloques")}
            className={`flex-1 flex items-center justify-center gap-3 p-4 rounded-lg border-2 transition-all ${
              activeTab === "bloques"
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-muted bg-background hover:border-blue-200 hover:bg-blue-50/50 text-muted-foreground"
            }`}
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              activeTab === "bloques" ? "bg-blue-500 text-white" : "bg-muted text-muted-foreground"
            }`}>
              <Factory className="h-5 w-5" />
            </div>
            <div className="text-left">
              <div className={`font-bold text-lg ${activeTab === "bloques" ? "text-blue-700" : ""}`}>BLOQUES</div>
              <div className="text-xs text-muted-foreground">{blockHistory.length} registros</div>
            </div>
          </button>
        )}

        <button
          type="button"
          onClick={() => setActiveTab("caños")}
          className={`flex-1 flex items-center justify-center gap-3 p-4 rounded-lg border-2 transition-all ${
            activeTab === "caños"
              ? "border-amber-500 bg-amber-50 text-amber-700"
              : "border-muted bg-background hover:border-amber-200 hover:bg-amber-50/50 text-muted-foreground"
          }`}
        >
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
            activeTab === "caños" ? "bg-amber-500 text-white" : "bg-muted text-muted-foreground"
          }`}>
            <Cylinder className="h-5 w-5" />
          </div>
          <div className="text-left">
            <div className={`font-bold text-lg ${activeTab === "caños" ? "text-amber-700" : ""}`}>CAÑOS</div>
            <div className="text-xs text-muted-foreground">{pipeHistory.length} registros</div>
          </div>
        </button>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "bloques" | "caños")}>

        <TabsContent value="bloques" className="space-y-2">
          {blockHistory.length > 0 ? (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/50">
                      <tr>
                        <th className="text-left p-2 font-medium">Fecha</th>
                        <th className="text-left p-2 font-medium">Turno</th>
                        <th className="text-left p-2 font-medium">Producto</th>
                        <th className="text-right p-2 font-medium">Tablas</th>
                        <th className="text-right p-2 font-medium">Disp %</th>
                        <th className="text-right p-2 font-medium">Rend %</th>
                        <th className="text-right p-2 font-medium">Cal %</th>
                        <th className="text-right p-2 font-medium">OEE %</th>
                        <th className="text-center p-2 font-medium">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {blockHistory.map((record: any) => {
                        const blockCycleTime = cycleTimes.find((ct) => ct.line_type === "bloques")
                        
                        // Calcular paradas planificadas vs no planificadas desde block_downtime
                        let plannedDowntimeMinutes = 0
                        let calculatedTotalDowntime = 0
                        
                        if (record.block_downtime && Array.isArray(record.block_downtime) && record.block_downtime.length > 0) {
                          record.block_downtime.forEach((dt: any) => {
                            const reason = dt.custom_reason || ""
                            const category = dt.downtime_category || ""
                            const minutes = dt.minutes || 0
                            calculatedTotalDowntime += minutes
                            // Paradas planificadas o factores externos no afectan disponibilidad
                            const isPlanned = PLANNED_DOWNTIME_CATEGORIES.some((cat) => reason.toLowerCase().includes(cat.toLowerCase()))
                            const isExternal = category.toLowerCase().includes("externo") || 
                              reason.toLowerCase().includes("energía") || 
                              reason.toLowerCase().includes("energia")
                            if (isPlanned || isExternal) {
                              plannedDowntimeMinutes += minutes
                            }
                          })
                        }
                        
                        // Si no hay paradas detalladas, usar total_downtime_minutes como no planificadas
                        const totalDowntimeMinutes = calculatedTotalDowntime > 0 ? calculatedTotalDowntime : (record.total_downtime_minutes || 0)
                        
                        const metrics = calculateBlockOEE({
                          ...record,
                          planned_downtime_minutes: plannedDowntimeMinutes,
                          total_downtime_minutes: totalDowntimeMinutes,
                        }, blockCycleTime || null)
                        const isExpanded = expandedRow === record.id
                        const racks = record.racks_to_camera || 0
                        const bandejas = racks * 14
                        const produccionReal = bandejas * 5 // 5 bloques por bandeja
                        const bloquesDescartados = record.scrap_units || 0
                        const produccionNeta = produccionReal - bloquesDescartados
                        const scrapPercentage = produccionReal > 0 ? (bloquesDescartados / produccionReal) * 100 : 0

                        return (
                          <>
                            <tr key={record.id} className="border-b hover:bg-muted/30 transition-colors">
                              <td className="p-2">{formatDateForDisplay(record.production_date, "short")}</td>
                              <td className="p-2">{record.shift}</td>
                              <td className="p-2 font-medium">{record.product_type || "N/A"}</td>
                              <td className="p-2 text-right font-medium">{bandejas}</td>
                              <td className="p-2 text-right">{metrics.availability.toFixed(1)}</td>
                              <td className="p-2 text-right">{metrics.performance.toFixed(1)}</td>
                              <td className="p-2 text-right">{metrics.quality.toFixed(1)}</td>
                              <td className="p-2 text-right font-bold text-primary">{metrics.oee.toFixed(1)}</td>
                              <td className="p-2">
                                <div className="flex items-center justify-center gap-1">
                                  <Dialog
                                    open={editingRow === record.id}
                                    onOpenChange={(open) => !open && handleCloseEdit()}
                                  >
                                    <DialogTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 w-7 p-0"
                                        onClick={() => handleEdit(record)}
                                      >
                                        <span className="text-xs">✏️</span>
                                      </Button>
                                    </DialogTrigger>
                                    <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
                                      <DialogHeader>
                                        <DialogTitle>Editar Parte de Producción</DialogTitle>
                                      </DialogHeader>
                                      {editFormData && (
                                        <BlockProductionForm
                                          editingRecord={editFormData}
                                          onSaveComplete={handleCloseEdit}
                                        />
                                      )}
                                    </DialogContent>
                                  </Dialog>
                                  <AlertDialog open={deletingId === record.id}>
                                    <AlertDialogTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 w-7 p-0"
                                        onClick={() => setDeletingId(record.id)}
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>Eliminar Registro</AlertDialogTitle>
                                        <AlertDialogDescription>
                                          ¿Estás seguro de que quieres eliminar este registro de producción de bloques?
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel onClick={() => setDeletingId(null)}>
                                          Cancelar
                                        </AlertDialogCancel>
                                        <AlertDialogAction onClick={() => handleDeleteBlock(record.id)}>
                                          Eliminar
                                        </AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0"
                                    onClick={() => toggleRow(record.id)}
                                  >
                                    {isExpanded ? (
                                      <ChevronUp className="h-3 w-3" />
                                    ) : (
                                      <ChevronDown className="h-3 w-3" />
                                    )}
                                  </Button>
                                </div>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr>
                                <td colSpan={9} className="p-0">
                                  <div className="bg-muted/20 p-4 space-y-3 border-t">
                                    <div className="grid gap-4 md:grid-cols-3 text-xs">
                                      <div>
                                        <p className="font-medium mb-2">Datos de Producción</p>
                                        <div className="space-y-1">
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Horario:</span>
                                            <span>
                                              {record.start_time} - {record.end_time}
                                            </span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Racks a cámara:</span>
                                            <span>{racks}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Bandejas (tablas):</span>
                                            <span>{bandejas}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Prod. Real (a cámara):</span>
                                            <span>{produccionReal} bloques</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Bloques descartados:</span>
                                            <span className="text-destructive">{bloquesDescartados}</span>
                                          </div>
                                          <div className="flex justify-between border-t pt-1 mt-1">
                                            <span className="text-muted-foreground">Prod. Neta (a playa):</span>
                                            <span className="font-medium">{produccionNeta} bloques</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">% Scrap:</span>
                                            <span
                                              className={`font-bold ${scrapPercentage > 1.5 ? "text-destructive" : "text-green-600"}`}
                                            >
                                              {scrapPercentage.toFixed(2)}%
                                            </span>
                                          </div>
                                        </div>
                                      </div>

                                      <div>
                                        <p className="font-medium mb-2">Tiempos</p>
                                        <div className="space-y-1">
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Total paradas:</span>
                                            <span className="font-medium">{record.total_downtime_minutes} min</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Limpieza:</span>
                                            <span>{record.cleaning_minutes || 0} min</span>
                                          </div>
                                        </div>
                                      </div>
                                    </div>

                                    <div>
                                      <p className="font-medium mb-2 text-xs">Motivos de Parada</p>
                                      {record.block_downtime && record.block_downtime.length > 0 ? (
                                        <div className="grid gap-2 md:grid-cols-2">
                                          {record.block_downtime
                                            .filter((dt: any) => dt.minutes > 0)
                                            .map((downtime: any) => (
                                              <div
                                                key={downtime.id}
                                                className="text-xs p-2 rounded bg-background border"
                                              >
                                                <div className="flex justify-between items-start">
                                                  <span className="font-medium flex-1">
                                                    {downtime.downtime_reasons?.reason || downtime.custom_reason}
                                                  </span>
                                                  <span className="text-muted-foreground ml-2">
                                                    {downtime.minutes} min
                                                  </span>
                                                </div>
                                                {downtime.comments && (
                                                  <p className="text-xs text-muted-foreground italic pl-2">
                                                    {downtime.comments}
                                                  </p>
                                                )}
                                              </div>
                                            ))}
                                        </div>
                                      ) : (
                                        <p className="text-xs text-muted-foreground">Sin paradas registradas</p>
                                      )}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center h-48">
                <p className="text-muted-foreground">No se encontraron registros</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="caños" className="space-y-2">
          {pipeHistory.length > 0 ? (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/50">
                      <tr>
                        <th className="text-left p-2 font-medium">Fecha</th>
                        <th className="text-left p-2 font-medium">Turno</th>
                        <th className="text-right p-2 font-medium">Operarios</th>
                        <th className="text-right p-2 font-medium">Unidades</th>
                        <th className="text-right p-2 font-medium">Disp %</th>
                        <th className="text-right p-2 font-medium">Rend %</th>
                        <th className="text-right p-2 font-medium">Cal %</th>
                        <th className="text-right p-2 font-medium">OEE %</th>
                        <th className="text-center p-2 font-medium">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pipeHistory.map((record: any) => {
                        // Calcular paradas planificadas (incluyendo factores externos)
                        let plannedDowntimeMinutes = 0
                        let calculatedTotalDowntime = 0
                        if (record.pipe_downtime && Array.isArray(record.pipe_downtime) && record.pipe_downtime.length > 0) {
                          record.pipe_downtime.forEach((dt: any) => {
                            const reason = dt.custom_reason || ""
                            const category = dt.downtime_category || ""
                            const minutes = dt.minutes || 0
                            calculatedTotalDowntime += minutes
                            // Paradas planificadas o factores externos no afectan disponibilidad
                            const isPlanned = PLANNED_DOWNTIME_CATEGORIES.some((cat) => reason.toLowerCase().includes(cat.toLowerCase()))
                            const isExternal = category.toLowerCase().includes("externo") || 
                              reason.toLowerCase().includes("energía") || 
                              reason.toLowerCase().includes("energia")
                            if (isPlanned || isExternal) {
                              plannedDowntimeMinutes += minutes
                            }
                          })
                        }
                        const totalDowntimeMinutes = calculatedTotalDowntime > 0 ? calculatedTotalDowntime : (record.total_downtime_minutes || 0)
                        
                        const metrics = calculatePipeOEE({
                          ...record,
                          planned_downtime_minutes: plannedDowntimeMinutes,
                          total_downtime_minutes: totalDowntimeMinutes,
                        }, cycleTimes)
                        const totalUnits = (record.cc300_simples || 0) + (record.cc300_rotura || 0) + (record.cc300_armado || 0) + (record.cc300_rotura_armado || 0) +
                          (record.cc400_simples || 0) + (record.cc400_rotura || 0) + (record.cc400_armado || 0) + (record.cc400_rotura_armado || 0) +
                          (record.cc500_simples || 0) + (record.cc500_rotura || 0) + (record.cc500_armado || 0) + (record.cc500_rotura_armado || 0) +
                          (record.cc600_simples || 0) + (record.cc600_rotura || 0) + (record.cc600_armado || 0) + (record.cc600_rotura_armado || 0) +
                          (record.cc800_simples || 0) + (record.cc800_rotura || 0) + (record.cc800_armado || 0) + (record.cc800_rotura_armado || 0) +
                          (record.cc1000_simples || 0) + (record.cc1000_rotura || 0) + (record.cc1000_armado || 0) + (record.cc1000_rotura_armado || 0) +
                          (record.cc1200_simples || 0) + (record.cc1200_rotura || 0) + (record.cc1200_armado || 0) + (record.cc1200_rotura_armado || 0)
                        const isExpanded = expandedRow === record.id
                        const moldBreakages = record.pipe_mold_breakage || []
                        const totalMoldBreakages = moldBreakages.length

                        // Calcular producción por tipo de caño
                        const PIPE_SIZES = ["300", "400", "500", "600", "800", "1000", "1200"]
                        const pipeProduction = PIPE_SIZES.map(size => {
                          const simples = record[`cc${size}_simples`] || 0
                          const rotura = record[`cc${size}_rotura`] || 0
                          const armado = record[`cc${size}_armado`] || 0
                          const roturaArmado = record[`cc${size}_rotura_armado`] || 0
                          const total = simples + rotura + armado + roturaArmado
                          const weightKg = total * (pipeWeightsKg[size] || 0)
                          return { size, simples, rotura, armado, roturaArmado, total, weightKg }
                        }).filter(p => p.total > 0)

                        // Calcular toneladas totales
                        const totalWeightKg = pipeProduction.reduce((sum, p) => sum + p.weightKg, 0)
                        const totalWeightTn = totalWeightKg / 1000

                        // Calcular tiempo disponible en horas
                        const tprBase = record.shift === 1 ? 560 : 500
                        const tiempoDisponibleMin = tprBase - plannedDowntimeMinutes
                        const tiempoDisponibleHoras = tiempoDisponibleMin / 60

                        // Calcular TN/HORA
                        const tnPorHora = tiempoDisponibleHoras > 0 ? totalWeightTn / tiempoDisponibleHoras : 0

                        return (
                          <React.Fragment key={record.id}>
                            <tr className="border-b hover:bg-muted/30 transition-colors">
                              <td className="p-2">{formatDateForDisplay(record.production_date, "short")}</td>
                              <td className="p-2">{record.shift}</td>
                              <td className="p-2 text-right">{record.operators_count || 3}</td>
                              <td className="p-2 text-right font-medium">{totalUnits}</td>
                              <td className="p-2 text-right">{metrics.availability.toFixed(1)}</td>
                              <td className="p-2 text-right">{metrics.performance.toFixed(1)}</td>
                              <td className="p-2 text-right">{metrics.quality.toFixed(1)}</td>
                              <td className="p-2 text-right font-bold text-primary">{metrics.oee.toFixed(1)}</td>
                              <td className="p-2">
                                <div className="flex items-center justify-center gap-1">
                                  <Dialog
                                    open={editPipeFormData === record}
                                    onOpenChange={(open) => !open && setEditPipeFormData(null)}
                                  >
                                    <DialogTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 w-7 p-0"
                                        onClick={() => handleEditPipe(record)}
                                      >
                                        <span className="text-xs">✏️</span>
                                      </Button>
                                    </DialogTrigger>
                                    <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
                                      <DialogHeader>
                                        <DialogTitle>Editar Parte de Producción - Caños</DialogTitle>
                                      </DialogHeader>
                                      {editPipeFormData && (
                                        <PipeProductionForm
                                          editingRecord={editPipeFormData}
                                          onSaveComplete={() => {
                                            setEditPipeFormData(null)
                                            loadHistory()
                                          }}
                                        />
                                      )}
                                    </DialogContent>
                                  </Dialog>
                                  <AlertDialog
                                    open={deletingId === record.id}
                                    onOpenChange={(open) => !open && setDeletingId(null)}
                                  >
                                    <AlertDialogTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 w-7 p-0"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>Eliminar Registro</AlertDialogTitle>
                                        <AlertDialogDescription>
                                          ¿Estás seguro de que quieres eliminar este registro de producción de caños?
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => handleDeletePipe(record.id)}>
                                          Eliminar
                                        </AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0"
                                    onClick={() => toggleRow(record.id)}
                                  >
                                    {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                  </Button>
                                </div>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr className="bg-muted/20">
                                <td colSpan={9} className="p-4">
                                  <div className="grid gap-4 md:grid-cols-4">
                                    {/* Información General */}
                                    <div>
                                      <p className="text-sm font-medium mb-2">Información General</p>
                                      <div className="space-y-1 text-sm">
                                        <div className="flex justify-between">
                                          <span className="text-muted-foreground">Horario:</span>
                                          <span className="font-medium">{record.start_time} - {record.end_time}</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-muted-foreground">TPR base:</span>
                                          <span className="font-medium">{tprBase} min</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-muted-foreground">Tiempo disponible:</span>
                                          <span className="font-medium text-primary">{tiempoDisponibleMin} min</span>
                                        </div>
                                        {plannedDowntimeMinutes > 0 && (
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Paradas externas:</span>
                                            <span className="font-medium text-orange-600">{plannedDowntimeMinutes} min</span>
                                          </div>
                                        )}
                                        <div className="flex justify-between border-t pt-1 mt-1">
                                          <span className="text-muted-foreground">Toneladas:</span>
                                          <span className="font-bold">{totalWeightTn.toFixed(2)} Tn</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-muted-foreground">TN/HORA:</span>
                                          <span className="font-bold text-primary">{tnPorHora.toFixed(2)}</span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Producción por tipo de caño */}
                                    <div>
                                      <p className="text-sm font-medium mb-2">Producción por Tipo</p>
                                      {pipeProduction.length > 0 ? (
                                        <div className="space-y-1 text-sm">
                                          {pipeProduction.map((p) => (
                                            <div key={p.size} className="flex justify-between">
                                              <span className="text-muted-foreground">CC{p.size}:</span>
                                              <span className="font-medium">{p.total} ({(p.weightKg / 1000).toFixed(2)} Tn)</span>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <p className="text-sm text-muted-foreground">Sin producción</p>
                                      )}
                                    </div>

                                    {/* Paradas */}
                                    <div>
                                      <p className="text-sm font-medium mb-2">Paradas ({totalDowntimeMinutes} min)</p>
                                      {record.pipe_downtime && record.pipe_downtime.length > 0 ? (
                                        <div className="space-y-1 text-sm">
                                          {record.pipe_downtime.map((dt: any) => (
                                            <div key={dt.id} className="flex justify-between">
                                              <span className="text-muted-foreground">{dt.custom_reason}:</span>
                                              <span className="font-medium">{dt.minutes} min</span>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <p className="text-sm text-muted-foreground">Sin paradas</p>
                                      )}
                                    </div>

                                    {/* Roturas de Molde */}
                                    <div>
                                      <p className="text-sm font-medium mb-2">Roturas de Molde {totalMoldBreakages > 0 && <span className="text-destructive">({totalMoldBreakages})</span>}</p>
                                      {moldBreakages.length > 0 && moldBreakages.some((b: any) => b.diameter) ? (
                                        <div className="space-y-1 text-sm">
                                          {moldBreakages.filter((b: any) => b.diameter).map((b: any, idx: number) => (
                                            <div key={idx} className="space-y-0.5">
                                              <div className="flex justify-between">
                                                <span className="text-muted-foreground">CC{b.diameter}:</span>
                                                <span className="font-medium text-destructive">{b.reasons?.join(", ") || "Sin motivo"}</span>
                                              </div>
                                              {b.comments && (
                                                <p className="text-xs text-muted-foreground italic pl-2">{b.comments}</p>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <p className="text-sm text-muted-foreground">Sin roturas</p>
                                      )}
                                    </div>
                                  </div>
                                  
                                  {/* Cajones de Desperdicio del Parte Diario - suma de los 5 tipos */}
                                  {(() => {
                                    const totalBins = (record.waste_bin_1_cinta || 0) + (record.waste_bin_2_desmolde || 0) + 
                                                     (record.waste_bin_3_cinta || 0) + (record.waste_bin_4_rotos || 0) + 
                                                     (record.waste_bin_5_mezcladora || 0) || record.scrap_boxes || 0
                                    const totalKg = (record.waste_bin_1_cinta || 0) * 576.7 + (record.waste_bin_2_desmolde || 0) * 528.4 +
                                                   (record.waste_bin_3_cinta || 0) * 601.5 + (record.waste_bin_4_rotos || 0) * 1074.5 +
                                                   (record.waste_bin_5_mezcladora || 0) * 576.7
                                    return totalBins > 0 ? (
                                      <div className="mt-4 pt-4 border-t">
                                        <p className="text-sm font-medium mb-2 text-amber-600">Cajones de Desperdicio (Parte Diario)</p>
                                        <div className="flex gap-4">
                                          <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3">
                                            <p className="text-xs text-muted-foreground">Total Cajones</p>
                                            <p className="text-2xl font-bold text-amber-600">{totalBins}</p>
                                          </div>
                                          {totalKg > 0 && (
                                            <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3">
                                              <p className="text-xs text-muted-foreground">Peso Neto</p>
                                              <p className="text-2xl font-bold text-amber-600">{(totalKg / 1000).toFixed(2)} tn</p>
                                            </div>
                                          )}
                                        </div>
                                        {/* Desglose por tipo si hay nuevos campos */}
                                        {(record.waste_bin_1_cinta || record.waste_bin_2_desmolde || record.waste_bin_3_cinta || record.waste_bin_4_rotos || record.waste_bin_5_mezcladora) && (
                                          <div className="mt-2 text-xs text-muted-foreground">
                                            {record.waste_bin_1_cinta > 0 && <span className="mr-3">C1-Cinta: {record.waste_bin_1_cinta}</span>}
                                            {record.waste_bin_2_desmolde > 0 && <span className="mr-3">C2-Desmolde: {record.waste_bin_2_desmolde}</span>}
                                            {record.waste_bin_3_cinta > 0 && <span className="mr-3">C3-Cinta: {record.waste_bin_3_cinta}</span>}
                                            {record.waste_bin_4_rotos > 0 && <span className="mr-3">C4-Rotos: {record.waste_bin_4_rotos}</span>}
                                            {record.waste_bin_5_mezcladora > 0 && <span className="mr-3">C5-Mezcla: {record.waste_bin_5_mezcladora}</span>}
                                          </div>
                                        )}
                                      </div>
                                    ) : null
                                  })()}
                                  
                                  {/* Segunda y Rotos desde Control de Calidad */}
                                  {record.quality_waste && (record.quality_waste.second > 0 || record.quality_waste.broken > 0) && (
                                    <div className="mt-4 pt-4 border-t">
                                      <p className="text-sm font-medium mb-2 text-orange-600">Segunda y Rotos (Control de Calidad)</p>
                                      <div className="grid grid-cols-2 gap-4 text-sm">
                                        <div className="bg-orange-50 dark:bg-orange-950/30 rounded-lg p-3">
                                          <p className="text-xs text-muted-foreground">Segunda</p>
                                          <p className="text-lg font-bold text-orange-600">{record.quality_waste.second}</p>
                                          <p className="text-xs text-muted-foreground">unidades</p>
                                        </div>
                                        <div className="bg-red-50 dark:bg-red-950/30 rounded-lg p-3">
                                          <p className="text-xs text-muted-foreground">Rotos</p>
                                          <p className="text-lg font-bold text-red-600">{record.quality_waste.broken}</p>
                                          <p className="text-xs text-muted-foreground">unidades</p>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center h-48">
                <p className="text-muted-foreground">No se encontraron registros</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
