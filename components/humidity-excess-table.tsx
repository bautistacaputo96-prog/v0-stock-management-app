"use client"

import { useState, useEffect } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { CheckCircle, AlertTriangle, FileSpreadsheet, FileText } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import * as XLSX from "xlsx"

type HumidityExcessEntry = {
  id: string
  entry_date: string
  remito: string | null
  original_quantity_kg: number
  humidity_percentage: number
  tolerance_percentage: number
  excess_humidity_percentage: number
  excess_quantity_kg: number
  excess_quantity_tn: number
  credited: boolean
  credit_note_number: string | null
  materials: { name: string }
  suppliers: { name: string }
}

type Supplier = {
  id: string
  name: string
}

export function HumidityExcessTable({ plantId }: { plantId: string }) {
  const [entries, setEntries] = useState<HumidityExcessEntry[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [selectedSupplier, setSelectedSupplier] = useState<string>("all")
  const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7))
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()
  const supabase = createClient()

  useEffect(() => {
    loadSuppliers()
  }, [plantId])

  useEffect(() => {
    if (plantId) {
      loadEntries()
    }
  }, [plantId, selectedSupplier, selectedMonth])

  async function loadSuppliers() {
    const { data } = await supabase
      .from("suppliers")
      .select("id, name")
      .eq("plant_id", plantId)
      .order("name")
    setSuppliers(data || [])
  }

  async function loadEntries() {
    setLoading(true)
    const startDate = `${selectedMonth}-01`
    const endDate = new Date(selectedMonth + "-01")
    endDate.setMonth(endDate.getMonth() + 1)
    endDate.setDate(0)
    const endDateStr = endDate.toISOString().slice(0, 10)

    let query = supabase
      .from("humidity_excess_log")
      .select(`
        *,
        materials (name),
        suppliers (name)
      `)
      .eq("plant_id", plantId)
      .gte("entry_date", startDate)
      .lte("entry_date", endDateStr)

    if (selectedSupplier !== "all") {
      query = query.eq("supplier_id", selectedSupplier)
    }

    const { data } = await query.order("entry_date", { ascending: false })
    setEntries(data || [])
    setLoading(false)
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString("es-AR")
  }

  const totalExcessTn = entries.filter(e => !e.credited).reduce((sum, e) => sum + e.excess_quantity_tn, 0)
  const totalCreditedTn = entries.filter(e => e.credited).reduce((sum, e) => sum + e.excess_quantity_tn, 0)

  const getMonthLabel = () => {
    const date = new Date(selectedMonth + "-01")
    const label = date.toLocaleDateString("es-AR", { month: "long", year: "numeric" })
    return label.charAt(0).toUpperCase() + label.slice(1)
  }

  const getSupplierName = () => {
    if (selectedSupplier === "all") return "Todos los proveedores"
    return suppliers.find(s => s.id === selectedSupplier)?.name || ""
  }

  const exportToExcel = () => {
    const data = entries.map(e => ({
      "Fecha": formatDate(e.entry_date),
      "Proveedor": e.suppliers?.name || "-",
      "Material": e.materials?.name || "-",
      "Remito": e.remito || "-",
      "Peso Camion (kg)": e.original_quantity_kg,
      "Humedad %": e.humidity_percentage,
      "Tolerancia %": e.tolerance_percentage,
      "Exceso %": e.excess_humidity_percentage,
      "Exceso (Tn)": e.excess_quantity_tn,
      "Estado": e.credited ? "Acreditado" : "Pendiente",
      "N° Nota Credito": e.credit_note_number || "-"
    }))

    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Exceso Humedad")
    
    // Ajustar anchos de columna
    ws["!cols"] = [
      { wch: 12 }, { wch: 20 }, { wch: 15 }, { wch: 15 },
      { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
      { wch: 12 }, { wch: 12 }, { wch: 15 }
    ]

    XLSX.writeFile(wb, `Exceso_Humedad_${selectedMonth}.xlsx`)
    toast({ title: "Excel exportado", description: "El archivo se descargo correctamente" })
  }

  const exportToPDF = () => {
    const doc = new jsPDF()
    const pageWidth = doc.internal.pageSize.getWidth()
    
    // Header - Logo placeholder (texto)
    doc.setFontSize(18)
    doc.setFont("helvetica", "bold")
    doc.text("REBUCRET S.A.", 14, 20)
    
    doc.setFontSize(10)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(100)
    doc.text("Hormigon Elaborado", 14, 26)
    
    // Fecha del reporte
    doc.setFontSize(9)
    doc.text(`Fecha de emision: ${new Date().toLocaleDateString("es-AR")}`, pageWidth - 14, 20, { align: "right" })
    
    // Linea separadora
    doc.setDrawColor(0)
    doc.setLineWidth(0.5)
    doc.line(14, 32, pageWidth - 14, 32)
    
    // Titulo del reporte
    doc.setFontSize(14)
    doc.setFont("helvetica", "bold")
    doc.setTextColor(0)
    doc.text("Informe de Exceso de Humedad", 14, 42)
    
    // Descripcion
    doc.setFontSize(10)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(60)
    const descripcion = `Periodo: ${getMonthLabel()} | Proveedor: ${getSupplierName()}`
    doc.text(descripcion, 14, 50)
    
    // Resumen ejecutivo
    doc.setFontSize(9)
    doc.setTextColor(0)
    const resumen = `Total Pendiente: ${totalExcessTn.toFixed(4)} Tn | Total Acreditado: ${totalCreditedTn.toFixed(4)} Tn | Total Periodo: ${(totalExcessTn + totalCreditedTn).toFixed(4)} Tn`
    doc.text(resumen, 14, 58)
    
    // Tabla
    const tableData = entries.map(e => [
      formatDate(e.entry_date),
      e.suppliers?.name || "-",
      e.materials?.name || "-",
      e.remito || "-",
      e.original_quantity_kg.toLocaleString("es-AR"),
      `${e.humidity_percentage.toFixed(2)}%`,
      `+${e.excess_humidity_percentage.toFixed(2)}%`,
      e.excess_quantity_tn.toFixed(4),
      e.credited ? "Acreditado" : "Pendiente"
    ])

    autoTable(doc, {
      startY: 65,
      head: [["Fecha", "Proveedor", "Material", "Remito", "Peso (kg)", "Humedad", "Exceso", "Exceso Tn", "Estado"]],
      body: tableData,
      styles: {
        fontSize: 8,
        cellPadding: 2,
        textColor: [0, 0, 0],
        lineColor: [0, 0, 0],
        lineWidth: 0.1,
      },
      headStyles: {
        fillColor: [240, 240, 240],
        textColor: [0, 0, 0],
        fontStyle: "bold",
        halign: "center",
      },
      alternateRowStyles: {
        fillColor: [250, 250, 250],
      },
      columnStyles: {
        0: { halign: "center" },
        4: { halign: "right" },
        5: { halign: "center" },
        6: { halign: "center" },
        7: { halign: "right" },
        8: { halign: "center" },
      },
    })

    // Footer
    const finalY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
    doc.setFontSize(8)
    doc.setTextColor(120)
    doc.text("Este documento es un informe interno de control de calidad.", 14, finalY)
    doc.text(`Generado el ${new Date().toLocaleString("es-AR")}`, 14, finalY + 5)

    doc.save(`Informe_Humedad_${selectedMonth}.pdf`)
    toast({ title: "PDF exportado", description: "El archivo se descargo correctamente" })
  }

  const markAsCredited = async (entryId: string, creditNoteNumber: string) => {
    const { error } = await supabase
      .from("humidity_excess_log")
      .update({ 
        credited: true, 
        credit_note_number: creditNoteNumber,
        credited_at: new Date().toISOString()
      })
      .eq("id", entryId)

    if (!error) {
      toast({ title: "Marcado como acreditado" })
      loadEntries()
    }
  }

  const generateMonthOptions = () => {
    const options = []
    const now = new Date()
    for (let i = 0; i < 12; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const value = date.toISOString().slice(0, 7)
      const label = date.toLocaleDateString("es-AR", { month: "long", year: "numeric" })
      options.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) })
    }
    return options
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Pendiente</CardDescription>
            <CardTitle className="text-2xl text-amber-600">
              {totalExcessTn.toFixed(4)} Tn
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {entries.filter(e => !e.credited).length} ingresos con exceso
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Acreditado</CardDescription>
            <CardTitle className="text-2xl text-green-600">
              {totalCreditedTn.toFixed(4)} Tn
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {entries.filter(e => e.credited).length} notas de credito
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total del Periodo</CardDescription>
            <CardTitle className="text-2xl">
              {(totalExcessTn + totalCreditedTn).toFixed(4)} Tn
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {entries.length} registros totales
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-4">
        <div className="space-y-1">
          <Label className="text-xs">Periodo</Label>
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {generateMonthOptions().map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Proveedor</Label>
          <Select value={selectedSupplier} onValueChange={setSelectedSupplier}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los proveedores</SelectItem>
              {suppliers.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={entries.length === 0}>
                Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportToExcel}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Exportar a Excel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportToPDF}>
                <FileText className="h-4 w-4 mr-2" />
                Exportar a PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Proveedor</TableHead>
              <TableHead>Material</TableHead>
              <TableHead>Remito</TableHead>
              <TableHead className="text-right">Peso Camion (kg)</TableHead>
              <TableHead className="text-center">Humedad %</TableHead>
              <TableHead className="text-center">Exceso %</TableHead>
              <TableHead className="text-right">Exceso (Tn)</TableHead>
              <TableHead className="text-center">Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  Cargando...
                </TableCell>
              </TableRow>
            ) : entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No hay registros de exceso de humedad para este periodo
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-mono">{formatDate(entry.entry_date)}</TableCell>
                  <TableCell className="font-medium">{entry.suppliers?.name || "-"}</TableCell>
                  <TableCell>{entry.materials?.name || "-"}</TableCell>
                  <TableCell>{entry.remito || "-"}</TableCell>
                  <TableCell className="text-right font-mono">
                    {entry.original_quantity_kg.toLocaleString("es-AR")}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className="text-amber-600 border-amber-300">
                      {entry.humidity_percentage.toFixed(2)}%
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center text-amber-600 font-medium">
                    +{entry.excess_humidity_percentage.toFixed(2)}%
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold text-amber-600">
                    {entry.excess_quantity_tn.toFixed(4)}
                  </TableCell>
                  <TableCell className="text-center">
                    {entry.credited ? (
                      <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Acreditado
                      </Badge>
                    ) : (
                      <CreditNoteInput 
                        onSubmit={(noteNumber) => markAsCredited(entry.id, noteNumber)} 
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function CreditNoteInput({ onSubmit }: { onSubmit: (noteNumber: string) => void }) {
  const [isEditing, setIsEditing] = useState(false)
  const [noteNumber, setNoteNumber] = useState("")

  if (!isEditing) {
    return (
      <Badge 
        variant="outline" 
        className="cursor-pointer text-amber-600 border-amber-300 hover:bg-amber-50"
        onClick={() => setIsEditing(true)}
      >
        <AlertTriangle className="h-3 w-3 mr-1" />
        Pendiente
      </Badge>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        className="h-7 w-24 text-xs"
        placeholder="N° NC"
        value={noteNumber}
        onChange={(e) => setNoteNumber(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && noteNumber) {
            onSubmit(noteNumber)
          }
          if (e.key === "Escape") {
            setIsEditing(false)
            setNoteNumber("")
          }
        }}
        autoFocus
      />
      <Button 
        size="sm" 
        className="h-7 px-2"
        onClick={() => {
          if (noteNumber) onSubmit(noteNumber)
        }}
        disabled={!noteNumber}
      >
        <CheckCircle className="h-3 w-3" />
      </Button>
    </div>
  )
}
