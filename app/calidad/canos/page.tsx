"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useEnterNavigation } from "@/hooks/use-enter-navigation"
import { usePlant } from "@/lib/plant-context"
import { getSupabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Navigation } from "@/components/navigation"
import { PlusCircle, CheckCircle2, Loader2, FileDown, AlertTriangle, ChevronDown, ChevronUp, ClipboardList, UserPlus, BarChart3, History, Pencil, Trash2 } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
  import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { PipeQualityExecutiveReport } from "@/components/reports/pipe-quality-executive-report"
import { exportElementToPDF } from "@/lib/pdf-export"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts"

const PIPE_DIAMETERS = [300, 400, 500, 600, 800, 1000, 1200]

const MAX_UNITS: Record<number, number> = {
  300: 60,
  400: 140,
  500: 80,
  600: 80,
  800: 50,
  1000: 40,
  1200: 25,
}

interface PipeItem {
  diameter: number
  first_quality: number
  second_quality: number
  broken: number
}

interface DefectReason {
  id: number
  reason: string
  category: string
  display_order: number
}

interface DefectEntry {
  defect_reason_id: number
  quantity: number
}

interface DiameterDefects {
  diameter: number
  reasons: DefectEntry[]
}

// ID especial para "Otra" razón de defecto
const OTHER_DEFECT_REASON_ID = -999

interface PipeControlItem extends PipeItem {
  defects?: {
    id: number
    quantity: number
    reason: DefectReason
  }[]
}

interface PipeControl {
  id: number
  control_date: string
  lote: string
  fabrication_order: string
  production_responsible_id: number
  logistics_responsible_id: number
  observations: string | null
  items: PipeControlItem[]
}

interface Employee {
  id: number
  first_name: string
  last_name: string
  positions: string[]
  is_active: boolean
}

export default function PipeQualityPage() {
  const { selectedPlant } = usePlant()
  const [controls, setControls] = useState<PipeControl[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [defectReasons, setDefectReasons] = useState<DefectReason[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [expandedControl, setExpandedControl] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState("historial")
  const [exportingPdf, setExportingPdf] = useState(false)
  const [showPdfPreview, setShowPdfPreview] = useState(false)
  const [editingControl, setEditingControl] = useState<any | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [controlToDelete, setControlToDelete] = useState<{ id: number; lote: string } | null>(null)
  const [otherDefectComments, setOtherDefectComments] = useState<Record<number, string>>({}) // diameter -> comment
  const [recoveredPipes, setRecoveredPipes] = useState<Record<number, { first: number; second: number; scrap: number }>>(() => {
    const initial: Record<number, { first: number; second: number; scrap: number }> = {}
    PIPE_DIAMETERS.forEach(d => { initial[d] = { first: 0, second: 0, scrap: 0 } })
    return initial
  })
  const pdfReportRef = useRef<HTMLDivElement>(null)
  
  // Report filter state
  const [reportFromDate, setReportFromDate] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    return d.toISOString().split("T")[0]
  })
  const [reportToDate, setReportToDate] = useState(new Date().toISOString().split("T")[0])
  
  // Production data for waste report
  const [productionRecords, setProductionRecords] = useState<any[]>([])
  const [productConfig, setProductConfig] = useState<Record<string, number>>({})
  const [wasteShiftFilter, setWasteShiftFilter] = useState<"todos" | "1" | "2">("todos")
  const [wasteBinFilter, setWasteBinFilter] = useState<"todos" | string>("todos")

  // Form state
  const [date, setDate] = useState(new Date().toISOString().split("T")[0])
  const [lote, setLote] = useState("")
  const [fabricationOrder, setFabricationOrder] = useState("")
  const [productionRespName, setProductionRespName] = useState("")
  const [logisticsRespName, setLogisticsRespName] = useState("")
  const [showProductionDropdown, setShowProductionDropdown] = useState(false)
  const [showLogisticsDropdown, setShowLogisticsDropdown] = useState(false)
  const [items, setItems] = useState<PipeItem[]>(
    PIPE_DIAMETERS.map((d) => ({ diameter: d, first_quality: 0, second_quality: 0, broken: 0 }))
  )
  const [defects, setDefects] = useState<DiameterDefects[]>(
    PIPE_DIAMETERS.map((d) => ({ diameter: d, reasons: [] }))
  )
  const formRef = useRef<HTMLDivElement>(null)

  // Handle Enter key to move to next input (Excel-like navigation)
  const handleEnterKey = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      const form = formRef.current
      if (!form) return
      
      const inputs = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="number"], input[type="text"]'))
      const currentIndex = inputs.indexOf(e.currentTarget)
      if (currentIndex >= 0 && currentIndex < inputs.length - 1) {
        inputs[currentIndex + 1].focus()
        inputs[currentIndex + 1].select()
      }
    }
  }, [])

  // Employee name helpers
  const getEmployeeFullNames = () => employees.map((e) => `${e.first_name} ${e.last_name}`)

  const getFilteredEmployees = (search: string) => {
    const names = getEmployeeFullNames()
    if (!search.trim()) return names
    return names.filter((n) => n.toLowerCase().includes(search.toLowerCase()))
  }

  const addEmployeeByName = async (fullName: string, target: "production" | "logistics") => {
    const parts = fullName.trim().split(/\s+/)
    if (parts.length < 2) return
    const firstName = parts[0]
    const lastName = parts.slice(1).join(" ")
    // Check if already exists
    const exists = employees.find(
      (e) => `${e.first_name} ${e.last_name}`.toLowerCase() === fullName.trim().toLowerCase()
    )
    if (exists) {
      if (target === "production") setProductionRespName(fullName.trim())
      else setLogisticsRespName(fullName.trim())
      return
    }
    try {
      const res = await fetch("/api/rrhh/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          positions: ["Operario"],
          branch: "Silke",
          is_active: true,
        }),
      })
      if (res.ok) {
        await fetchEmployees()
      }
    } catch { /* ignore */ }
  }

  const fetchControls = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/quality/pipe-control?plant=${selectedPlant}`)
      if (res.ok) setControls(await res.json())
    } catch { /* ignore */ }
    setLoading(false)
  }, [selectedPlant])

  const fetchEmployees = useCallback(async () => {
    try {
      const res = await fetch("/api/rrhh/employees")
      if (res.ok) {
        const data = await res.json()
        setEmployees(data.filter((e: Employee) => e.is_active))
      }
    } catch { /* ignore */ }
  }, [])

  const fetchDefectReasons = useCallback(async () => {
    try {
      const res = await fetch("/api/quality/defect-reasons")
      if (res.ok) setDefectReasons(await res.json())
    } catch { /* ignore */ }
  }, [])

// Fetch production records for waste report
  const fetchProductionRecords = useCallback(async () => {
  const supabase = getSupabase()
  const { data } = await supabase
  .from("pipe_production")
  .select("*")
  .eq("plant", selectedPlant)
  .order("production_date", { ascending: false })
  if (data) setProductionRecords(data)
  }, [selectedPlant])

  // Fetch product config (weights)
  const fetchProductConfig = useCallback(async () => {
    const supabase = getSupabase()
    const { data } = await supabase
      .from("product_config")
      .select("product_code, piece_weight_kg")
      .eq("line_type", "caños")
    if (data) {
      const config: Record<string, number> = {}
      data.forEach((p: any) => {
        config[p.product_code] = p.piece_weight_kg || 0
      })
      setProductConfig(config)
    }
  }, [])

  useEffect(() => {
    fetchControls()
    fetchEmployees()
    fetchDefectReasons()
    fetchProductionRecords()
    fetchProductConfig()
  }, [fetchControls, fetchEmployees, fetchDefectReasons, fetchProductionRecords, fetchProductConfig])
  
  // Refetch production records when plant changes
  useEffect(() => {
    fetchProductionRecords()
  }, [selectedPlant, fetchProductionRecords])

  const productionReasons = defectReasons.filter((r) => r.category === "produccion")
  const desmoldeReasons = defectReasons.filter((r) => r.category === "desmolde")

  // Report data calculation
  const reportData = useMemo(() => {
    const from = new Date(reportFromDate)
    const to = new Date(reportToDate)
    to.setHours(23, 59, 59) // Include full end day
    
    const filteredControls = controls.filter(c => {
      const d = new Date(c.control_date)
      return d >= from && d <= to
    })

    // Breakage by defect reason
    const byReason: Record<string, { reason: string, category: string, total: number, byDiameter: Record<number, number> }> = {}
    // Breakage by diameter (mold)
    const byDiameter: Record<number, { total: number, first: number, second: number, broken: number }> = {}
    
    PIPE_DIAMETERS.forEach(d => {
      byDiameter[d] = { total: 0, first: 0, second: 0, broken: 0 }
    })

    let totalFirst = 0, totalSecond = 0, totalBroken = 0

    filteredControls.forEach(control => {
      control.items?.forEach(item => {
        const d = item.diameter
        if (byDiameter[d]) {
          byDiameter[d].first += item.first_quality || 0
          byDiameter[d].second += item.second_quality || 0
          byDiameter[d].broken += item.broken || 0
          byDiameter[d].total += (item.first_quality || 0) + (item.second_quality || 0) + (item.broken || 0)
        }
        totalFirst += item.first_quality || 0
        totalSecond += item.second_quality || 0
        totalBroken += item.broken || 0

        // Defects
        item.defects?.forEach(defect => {
          const reasonKey = defect.reason?.reason || "Desconocido"
          if (!byReason[reasonKey]) {
            byReason[reasonKey] = {
              reason: reasonKey,
              category: defect.reason?.category || "otro",
              total: 0,
              byDiameter: {}
            }
            PIPE_DIAMETERS.forEach(dia => { byReason[reasonKey].byDiameter[dia] = 0 })
          }
          byReason[reasonKey].total += defect.quantity || 0
          byReason[reasonKey].byDiameter[d] = (byReason[reasonKey].byDiameter[d] || 0) + (defect.quantity || 0)
        })
      })
    })

    return {
      filteredControls,
      byReason: Object.values(byReason).sort((a, b) => b.total - a.total),
      byDiameter,
      totals: { first: totalFirst, second: totalSecond, broken: totalBroken, total: totalFirst + totalSecond + totalBroken }
    }
  }, [controls, reportFromDate, reportToDate])

  // Waste report calculation
  const wasteData = useMemo(() => {
    const from = new Date(reportFromDate)
    const to = new Date(reportToDate)
    to.setHours(23, 59, 59)

    // Get pipe weights from config (defaults based on actual product_config values)
    const pipeWeights: Record<number, number> = {
      300: productConfig["CC300"] || 162,
      400: productConfig["CC400"] || 215,
      500: productConfig["CC500"] || 345,
      600: productConfig["CC600"] || 395,
      800: productConfig["CC800"] || 718,
      1000: productConfig["CC1000"] || 1080,
1200: productConfig["CC1200"] || 1520,
  }
  
  // Filter production records by date
    const filteredProduction = productionRecords.filter(p => {
      const d = new Date(p.production_date)
      return d >= from && d <= to
    })

    // Filter control records by date
    const filteredControls = controls.filter(c => {
      const d = new Date(c.control_date)
      return d >= from && d <= to
    })

    // Calculate TOTAL PRODUCTION (for percentage calculation)
    const totalProduction: Record<number, number> = {}
    let totalProductionUnits = 0
    let totalProductionKg = 0

    PIPE_DIAMETERS.forEach(d => { totalProduction[d] = 0 })

    filteredProduction.forEach(p => {
      PIPE_DIAMETERS.forEach(d => {
        // Sum simple + armado production
        const produced = (p[`cc${d}_simple`] || 0) + (p[`cc${d}_armado`] || 0)
        totalProduction[d] += produced
        totalProductionUnits += produced
        totalProductionKg += produced * (pipeWeights[d] || 0)
      })
    })

    // Waste bin types
    const WASTE_BIN_TYPES = [
      { key: "waste_bin_1_cinta", label: "Cinta 1" },
      { key: "waste_bin_2_desmolde", label: "Desmolde" },
      { key: "waste_bin_3_cinta", label: "Cinta 2" },
      { key: "waste_bin_4_rotos", label: "Rotos" },
      { key: "waste_bin_5_mezcladora", label: "Mezcladora" },
    ]

    // Calculate breakage from PRODUCTION (rotura en producción)
    const productionBreakage: Record<number, number> = {}
    let totalProductionBreakageUnits = 0
    let totalProductionBreakageKg = 0
    
    // Waste bins by type
    const wasteBinsByType: Record<string, number> = {}
    WASTE_BIN_TYPES.forEach(t => { wasteBinsByType[t.key] = 0 })
    let totalWasteKg = 0

    PIPE_DIAMETERS.forEach(d => { productionBreakage[d] = 0 })

    filteredProduction.forEach(p => {
      PIPE_DIAMETERS.forEach(d => {
        const rotura = (p[`cc${d}_rotura`] || 0) + (p[`cc${d}_rotura_armado`] || 0)
        productionBreakage[d] += rotura
        totalProductionBreakageUnits += rotura
        totalProductionBreakageKg += rotura * (pipeWeights[d] || 0)
      })
      // Accumulate waste bins by type
      WASTE_BIN_TYPES.forEach(t => {
        wasteBinsByType[t.key] += parseFloat(p[t.key]) || 0
      })
      totalWasteKg += parseFloat(p.total_waste_kg) || 0
    })

    // Calculate breakage from CONTROL (rotura en desmolde/control)
    const controlBreakage: Record<number, number> = {}
    let totalControlBreakageUnits = 0
    let totalControlBreakageKg = 0

    PIPE_DIAMETERS.forEach(d => { controlBreakage[d] = 0 })

    filteredControls.forEach(c => {
      c.items?.forEach(item => {
        const broken = item.broken || 0
        controlBreakage[item.diameter] += broken
        totalControlBreakageUnits += broken
        totalControlBreakageKg += broken * (pipeWeights[item.diameter] || 0)
      })
    })

// By date aggregation
    const byDate: Record<string, { 
      productionBreakage: Record<number, number>, 
      controlBreakage: Record<number, number>,
      wasteBins: Record<string, number>,
      totalWasteKg: number,
      totalKg: number 
    }> = {}

    // By date, shift and waste bin type (for chart)
    const byDateShiftBin: Record<string, Record<number, Record<string, number>>> = {} // date -> shift -> binType -> qty
    
    // By date and pipe type aggregation (for chart filter)
    const byDatePipe: Record<string, Record<number, { rotura: number, kg: number }>> = {} // date -> diameter -> { rotura, kg }

    filteredProduction.forEach(p => {
      const dateKey = p.production_date
      const shift = p.shift || 1
      
      if (!byDate[dateKey]) {
        byDate[dateKey] = {
          productionBreakage: {},
          controlBreakage: {},
          wasteBins: {},
          totalWasteKg: 0,
          totalKg: 0,
        }
        PIPE_DIAMETERS.forEach(d => { 
          byDate[dateKey].productionBreakage[d] = 0
          byDate[dateKey].controlBreakage[d] = 0
        })
        WASTE_BIN_TYPES.forEach(t => { byDate[dateKey].wasteBins[t.key] = 0 })
      }
      
      // Track waste bins by date
      WASTE_BIN_TYPES.forEach(t => {
        byDate[dateKey].wasteBins[t.key] += parseFloat(p[t.key]) || 0
      })
      byDate[dateKey].totalWasteKg += parseFloat(p.total_waste_kg) || 0
      byDate[dateKey].totalKg += parseFloat(p.total_waste_kg) || 0
      
      // Track waste bins by date, shift and type (for chart)
      if (!byDateShiftBin[dateKey]) byDateShiftBin[dateKey] = {}
      if (!byDateShiftBin[dateKey][shift]) {
        byDateShiftBin[dateKey][shift] = {}
        WASTE_BIN_TYPES.forEach(t => { byDateShiftBin[dateKey][shift][t.key] = 0 })
      }
      WASTE_BIN_TYPES.forEach(t => {
        byDateShiftBin[dateKey][shift][t.key] += parseFloat(p[t.key]) || 0
      })
      
      // Track breakage by date and pipe type
      if (!byDatePipe[dateKey]) {
        byDatePipe[dateKey] = {}
        PIPE_DIAMETERS.forEach(d => { byDatePipe[dateKey][d] = { rotura: 0, kg: 0 } })
      }
      
      PIPE_DIAMETERS.forEach(d => {
        const rotura = (p[`cc${d}_rotura`] || 0) + (p[`cc${d}_rotura_armado`] || 0)
        byDate[dateKey].productionBreakage[d] += rotura
        byDatePipe[dateKey][d].rotura += rotura
        byDatePipe[dateKey][d].kg += rotura * (pipeWeights[d] || 0)
      })
    })

    filteredControls.forEach(c => {
      const dateKey = c.control_date
      
      if (!byDate[dateKey]) {
        byDate[dateKey] = {
          productionBreakage: {},
          controlBreakage: {},
          wasteBins: {},
          totalWasteKg: 0,
          totalKg: 0,
        }
        PIPE_DIAMETERS.forEach(d => { 
          byDate[dateKey].productionBreakage[d] = 0
          byDate[dateKey].controlBreakage[d] = 0
        })
        WASTE_BIN_TYPES.forEach(t => { byDate[dateKey].wasteBins[t.key] = 0 })
      }
      
      // Initialize byDatePipe if needed
      if (!byDatePipe[dateKey]) {
        byDatePipe[dateKey] = {}
        PIPE_DIAMETERS.forEach(d => { byDatePipe[dateKey][d] = { rotura: 0, kg: 0 } })
      }
      
      c.items?.forEach(item => {
        const broken = item.broken || 0
        byDate[dateKey].controlBreakage[item.diameter] += broken
        // Add control breakage to byDatePipe
        if (byDatePipe[dateKey][item.diameter]) {
          byDatePipe[dateKey][item.diameter].rotura += broken
          byDatePipe[dateKey][item.diameter].kg += broken * (pipeWeights[item.diameter] || 0)
        }
      })
    })

return {
      pipeWeights,
      WASTE_BIN_TYPES,
      // Production totals
      totalProduction,
      totalProductionUnits,
      totalProductionKg,
      // Waste bins by type
      wasteBinsByType,
      totalWasteKg,
      // Breakage totals
      productionBreakage,
      totalProductionBreakageUnits,
      totalProductionBreakageKg,
      controlBreakage,
      totalControlBreakageUnits,
      totalControlBreakageKg,
      // Combined totals
      totalBreakageUnits: totalProductionBreakageUnits + totalControlBreakageUnits,
      totalBreakageKg: totalProductionBreakageKg + totalControlBreakageKg,
      totalWasteAndBreakageKg: totalWasteKg + totalProductionBreakageKg + totalControlBreakageKg,
      // Percentage
      wastePercentage: totalProductionKg > 0 
        ? ((totalWasteKg + totalProductionBreakageKg + totalControlBreakageKg) / totalProductionKg * 100).toFixed(2)
        : "0",
      // By date
      byDate: Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0])),
      byDateShiftBin,
      byDatePipe,
    }
  }, [productionRecords, controls, reportFromDate, reportToDate, productConfig])

  // Handle edit control
  const handleEditControl = (control: any) => {
    // Load control data into form using existing state variables
    setDate(control.control_date)
    setLote(control.lote || "")
    setFabricationOrder(control.fabrication_order || "")
    
    // Find employee names by ID
    const prodResp = employees.find(e => e.id === control.production_responsible_id)
    const logResp = employees.find(e => e.id === control.logistics_responsible_id)
    setProductionRespName(prodResp ? `${prodResp.first_name} ${prodResp.last_name}` : "")
    setLogisticsRespName(logResp ? `${logResp.first_name} ${logResp.last_name}` : "")
    
    // Load items
    const newItems: PipeItem[] = PIPE_DIAMETERS.map(d => {
      const existingItem = control.items?.find((i: any) => i.diameter === d)
      return {
        diameter: d,
        first_quality: existingItem?.first_quality || 0,
        second_quality: existingItem?.second_quality || 0,
        broken: existingItem?.broken || 0,
      }
    })
    setItems(newItems)
    
    // Load defects
    const newDefects: DiameterDefects[] = PIPE_DIAMETERS.map(d => {
      const existingItem = control.items?.find((i: any) => i.diameter === d)
      const reasons: DefectEntry[] = existingItem?.defects?.map((def: any) => ({
        defect_reason_id: def.reason?.id || def.defect_reason_id,
        quantity: def.quantity
      })) || []
      return { diameter: d, reasons }
    })
  setDefects(newDefects)
  // Load recovered pipes
  if (control.recovered_pipes && typeof control.recovered_pipes === 'object') {
    const loaded: Record<number, { first: number; second: number; scrap: number }> = {}
    PIPE_DIAMETERS.forEach(d => {
      loaded[d] = control.recovered_pipes[d] || { first: 0, second: 0, scrap: 0 }
    })
    setRecoveredPipes(loaded)
  } else {
    const initialRecovered: Record<number, { first: number; second: number; scrap: number }> = {}
    PIPE_DIAMETERS.forEach(d => { initialRecovered[d] = { first: 0, second: 0, scrap: 0 } })
    setRecoveredPipes(initialRecovered)
  }
  
  setEditingControl(control)
  setShowForm(true)
  setActiveTab("historial")
  setExpandedControl(null)
  // Scroll al formulario
  setTimeout(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, 100)
  }

// Handle delete control - abre el diálogo de confirmación
  const handleDeleteControl = (control: { id: number; lote: string }) => {
    setControlToDelete(control)
    setDeleteConfirmOpen(true)
  }

  // Confirma y ejecuta la eliminación
  const confirmDeleteControl = async () => {
    if (!controlToDelete) return
    
    setDeletingId(controlToDelete.id)
    setDeleteConfirmOpen(false)
    
    try {
      const supabase = getSupabase()
      
      // First delete defects
      const { data: items } = await supabase
        .from("pipe_quality_items")
        .select("id")
        .eq("pipe_quality_control_id", controlToDelete.id)
      
      if (items && items.length > 0) {
        const itemIds = items.map((i: any) => i.id)
        await supabase
          .from("pipe_quality_defects")
          .delete()
          .in("pipe_quality_item_id", itemIds)
      }
      
      // Then delete items
      await supabase
        .from("pipe_quality_items")
        .delete()
        .eq("pipe_quality_control_id", controlToDelete.id)
      
      // Finally delete control
      const { error } = await supabase
        .from("pipe_quality_control")
        .delete()
        .eq("id", controlToDelete.id)
      
      if (error) throw error
      
      fetchControls()
    } catch (error) {
      console.error("Error deleting control:", error)
    } finally {
      setDeletingId(null)
      setControlToDelete(null)
    }
  }

  // Export PDF function
  const handleExportPDF = async () => {
    if (!pdfReportRef.current) return
    setExportingPdf(true)
    try {
      const fromStr = new Date(reportFromDate + "T12:00:00").toLocaleDateString("es-AR").replace(/\//g, "-")
      const toStr = new Date(reportToDate + "T12:00:00").toLocaleDateString("es-AR").replace(/\//g, "-")
      await exportElementToPDF(pdfReportRef.current, `informe-calidad-canos-${fromStr}-${toStr}.pdf`)
    } catch (error) {
      console.error("Error exporting PDF:", error)
    } finally {
      setExportingPdf(false)
    }
  }

  const updateItem = (diameterIdx: number, field: keyof PipeItem, value: number) => {
    setItems((prev) => {
      const updated = [...prev]
      updated[diameterIdx] = { ...updated[diameterIdx], [field]: value }
      return updated
    })
  }

  const updateDefect = (diameter: number, reasonId: number, quantity: number) => {
    setDefects((prev) =>
      prev.map((d) => {
        if (d.diameter !== diameter) return d
        const existing = d.reasons.find((r) => r.defect_reason_id === reasonId)
        if (existing) {
          return {
            ...d,
            reasons: d.reasons.map((r) =>
              r.defect_reason_id === reasonId ? { ...r, quantity } : r
            ),
          }
        }
        return {
          ...d,
          reasons: [...d.reasons, { defect_reason_id: reasonId, quantity }],
        }
      })
    )
  }

  const getDefectQuantity = (diameter: number, reasonId: number) => {
    const d = defects.find((d) => d.diameter === diameter)
    return d?.reasons.find((r) => r.defect_reason_id === reasonId)?.quantity || 0
  }

  const getTotalDefectsForDiameter = (diameter: number) => {
    const d = defects.find((d) => d.diameter === diameter)
    return d?.reasons.reduce((s, r) => s + r.quantity, 0) || 0
  }

 const resetForm = () => {
  setDate(new Date().toISOString().split("T")[0])
  setLote("")
  setFabricationOrder("")
  setProductionRespName("")
  setLogisticsRespName("")
  setItems(PIPE_DIAMETERS.map((d) => ({ diameter: d, first_quality: 0, second_quality: 0, broken: 0 })))
  setDefects(PIPE_DIAMETERS.map((d) => ({ diameter: d, reasons: [] })))
  setOtherDefectComments({})
  const initialRecovered: Record<number, { first: number; second: number; scrap: number }> = {}
  PIPE_DIAMETERS.forEach(d => { initialRecovered[d] = { first: 0, second: 0, scrap: 0 } })
  setRecoveredPipes(initialRecovered)
  setEditingControl(null)
  }

  const handleSubmit = async () => {
    if (!productionRespName.trim() || !logisticsRespName.trim()) return
    setSubmitting(true)
    try {
      // Resolve employee IDs from names, create if needed
      const findOrCreateEmployee = async (name: string) => {
        const existing = employees.find(
          (e) => `${e.first_name} ${e.last_name}`.toLowerCase() === name.trim().toLowerCase()
        )
        if (existing) return existing.id
        // Create new employee
        const parts = name.trim().split(/\s+/)
        const firstName = parts[0]
        const lastName = parts.slice(1).join(" ") || parts[0]
        const res = await fetch("/api/rrhh/employees", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            first_name: firstName,
            last_name: lastName,
            positions: ["Operario"],
            branch: "Silke",
            is_active: true,
          }),
        })
        if (res.ok) {
          const created = await res.json()
          await fetchEmployees()
          return created.id
        }
        return null
      }

      if (!lote.trim()) {
        alert("El campo Lote es obligatorio")
        setSubmitting(false)
        return
      }

      const prodId = await findOrCreateEmployee(productionRespName)
      const logId = await findOrCreateEmployee(logisticsRespName)
      if (!prodId || !logId) { setSubmitting(false); return }

      const activeItems = items.filter(
        (item) => item.first_quality > 0 || item.second_quality > 0 || item.broken > 0
      )
      const activeDefects = defects
        .filter((d) => {
          const item = activeItems.find((i) => i.diameter === d.diameter)
          return item && (item.second_quality > 0 || item.broken > 0) && d.reasons.some((r) => r.quantity > 0)
        })
        .map((d) => ({
          diameter: d.diameter,
          reasons: d.reasons.filter((r) => r.quantity > 0),
        }))

      // Build observations including "Otra" comments
      const otherCommentsList = Object.entries(otherDefectComments)
        .filter(([diameter, comment]) => {
          const qty = getDefectQuantity(parseInt(diameter), OTHER_DEFECT_REASON_ID)
          return qty > 0 && comment.trim()
        })
        .map(([diameter, comment]) => `Cano ${diameter}: ${comment.trim()}`)
      
      const observations = otherCommentsList.length > 0 
        ? `Otros defectos: ${otherCommentsList.join("; ")}` 
        : null

      const isEditing = !!editingControl
      const res = await fetch("/api/quality/pipe-control" + (isEditing ? `?id=${editingControl.id}` : ""), {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          control_date: date,
          lote: lote.trim(),
          fabrication_order: fabricationOrder,
          production_responsible_id: prodId,
          logistics_responsible_id: logId,
          items: activeItems,
          defects: activeDefects,
          observations,
          plant: selectedPlant,
          recovered_pipes: recoveredPipes,
        }),
      })
      if (res.ok) {
        resetForm()
        setShowForm(false)
        setEditingControl(null)
        fetchControls()
      }
    } catch { /* ignore */ }
    setSubmitting(false)
  }

  const totalFirst = items.reduce((s, i) => s + i.first_quality, 0)
  const totalSecond = items.reduce((s, i) => s + i.second_quality, 0)
  const totalBroken = items.reduce((s, i) => s + i.broken, 0)
  const totalUnits = totalFirst + totalSecond + totalBroken

  // Check if any diameter has second or broken but no defect reasons assigned
  const diametersMissingDefects = items.filter((item) => {
    const needsDefects = item.second_quality > 0 || item.broken > 0
    if (!needsDefects) return false
    const totalAssigned = getTotalDefectsForDiameter(item.diameter)
    return totalAssigned < (item.second_quality + item.broken)
  })

  const getEmployeeName = (id: number) => {
    const emp = employees.find((e) => e.id === id)
    return emp ? `${emp.first_name} ${emp.last_name}` : "-"
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">Control de Canos Terminados</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Planilla de produccion - Logistica</p>
        </div>
        <Button
          onClick={() => { setShowForm(!showForm); if (showForm) resetForm() }}
          size="sm"
          className="gap-2"
        >
          <PlusCircle className="h-4 w-4" />
          Nueva Planilla
        </Button>
      </div>

      {/* Form */}
      {showForm && (
        <Card className="border-primary/20">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">
                  {editingControl ? "Editar Planilla de Control" : "Produccion Canos - Nueva Planilla de Control"}
                </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4" ref={formRef} onKeyDown={(e) => {
            if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
              e.preventDefault()
              const form = formRef.current
              if (!form) return
              const current = e.target as HTMLInputElement
              const currentRect = current.getBoundingClientRect()
              const inputs = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="number"], input[type="text"]'))
              
              const tolerance = 50
              const inputsBelow = inputs.filter(inp => {
                const rect = inp.getBoundingClientRect()
                return Math.abs(rect.left - currentRect.left) < tolerance && rect.top > currentRect.top + 10
              }).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
              
              if (inputsBelow.length > 0) {
                inputsBelow[0].focus()
                inputsBelow[0].select()
              } else {
                const currentIndex = inputs.indexOf(current)
                if (currentIndex >= 0 && currentIndex < inputs.length - 1) {
                  inputs[currentIndex + 1].focus()
                  inputs[currentIndex + 1].select()
                }
              }
            }
          }}>
            {/* Header fields - Compacto */}
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-0.5">
                <Label className="text-[10px] text-muted-foreground">Fecha</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 text-xs w-36" />
              </div>
              <div className="space-y-0.5">
                <Label className="text-[10px] text-muted-foreground">Lote *</Label>
                <Input value={lote} onChange={(e) => setLote(e.target.value)} placeholder="L-2026-02" className="h-8 text-xs w-28" required />
              </div>
              <div className="space-y-0.5">
                <Label className="text-[10px] text-muted-foreground">OF</Label>
                <Input value={fabricationOrder} onChange={(e) => setFabricationOrder(e.target.value)} placeholder="OF-001" className="h-8 text-xs w-24" />
              </div>
            </div>

            {/* TABLA 1: Cantidades de produccion - Diámetros en columnas (eje X) */}
            <div>
              <h3 className="text-xs font-semibold text-foreground mb-1.5 flex items-center gap-1.5">
                <ClipboardList className="h-3.5 w-3.5" /> Tabla 1 - Produccion
              </h3>
              <table className="w-full text-xs border border-border rounded">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left py-1 px-2 font-medium w-16">Calidad</th>
                    {PIPE_DIAMETERS.map(d => (
                      <th key={d} className="text-center py-1 px-1 font-medium">{d}</th>
                    ))}
                    <th className="text-center py-1 px-1 font-medium w-14">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border/50">
                    <td className="py-1 px-2 font-medium text-emerald-600">1ra</td>
                    {items.map((item, idx) => (
                      <td key={item.diameter} className="py-0.5 px-0.5 text-center">
                        <Input type="number" min="0" value={item.first_quality || ""} onChange={(e) => updateItem(idx, "first_quality", parseInt(e.target.value) || 0)} onKeyDown={handleEnterKey} className="w-12 h-6 text-xs text-center" />
                      </td>
                    ))}
                    <td className="py-1 px-1 text-center font-semibold text-emerald-600">{totalFirst}</td>
                  </tr>
                  <tr className="border-t border-border/50">
                    <td className="py-1 px-2 font-medium text-amber-600">2da</td>
                    {items.map((item, idx) => (
                      <td key={item.diameter} className="py-0.5 px-0.5 text-center">
                        <Input type="number" min="0" value={item.second_quality || ""} onChange={(e) => updateItem(idx, "second_quality", parseInt(e.target.value) || 0)} onKeyDown={handleEnterKey} className="w-12 h-6 text-xs text-center" />
                      </td>
                    ))}
                    <td className="py-1 px-1 text-center font-semibold text-amber-600">{totalSecond}</td>
                  </tr>
                  <tr className="border-t border-border/50">
                    <td className="py-1 px-2 font-medium text-destructive">Rotos</td>
                    {items.map((item, idx) => (
                      <td key={item.diameter} className="py-0.5 px-0.5 text-center">
                        <Input type="number" min="0" value={item.broken || ""} onChange={(e) => updateItem(idx, "broken", parseInt(e.target.value) || 0)} onKeyDown={handleEnterKey} className="w-12 h-6 text-xs text-center" />
                      </td>
                    ))}
                    <td className="py-1 px-1 text-center font-semibold text-destructive">{totalBroken}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="bg-muted/50 border-t font-semibold">
                    <td className="py-1 px-2">Total</td>
                    {items.map((item) => (
                      <td key={item.diameter} className="py-1 px-1 text-center">{item.first_quality + item.second_quality + item.broken || "-"}</td>
                    ))}
                    <td className="py-1 px-1 text-center">{totalUnits}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Caños Recuperados - Tabla por tipo de caño */}
            <div>
              <h3 className="text-xs font-semibold text-emerald-800 mb-1.5">Caños Recuperados</h3>
              <table className="text-xs border border-emerald-200 rounded bg-emerald-50/50">
                <thead>
                  <tr className="bg-emerald-100/50">
                    <th className="text-left py-1 px-2 font-medium w-16">Salida</th>
                    {PIPE_DIAMETERS.map(d => (
                      <th key={d} className="text-center py-1 px-1 font-medium">{d}</th>
                    ))}
                    <th className="text-center py-1 px-1 font-medium w-14">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-emerald-200/50">
                    <td className="py-1 px-2 font-medium text-emerald-700">1ra</td>
                    {PIPE_DIAMETERS.map(d => (
                      <td key={d} className="py-0.5 px-0.5 text-center">
                        <Input type="number" min="0" value={recoveredPipes[d]?.first || ""} onChange={(e) => setRecoveredPipes(prev => ({ ...prev, [d]: { ...prev[d], first: parseInt(e.target.value) || 0 } }))} onKeyDown={handleEnterKey} className="w-12 h-6 text-xs text-center" />
                      </td>
                    ))}
                    <td className="py-1 px-1 text-center font-semibold text-emerald-700">{PIPE_DIAMETERS.reduce((s, d) => s + (recoveredPipes[d]?.first || 0), 0)}</td>
                  </tr>
                  <tr className="border-t border-emerald-200/50">
                    <td className="py-1 px-2 font-medium text-amber-600">2da</td>
                    {PIPE_DIAMETERS.map(d => (
                      <td key={d} className="py-0.5 px-0.5 text-center">
                        <Input type="number" min="0" value={recoveredPipes[d]?.second || ""} onChange={(e) => setRecoveredPipes(prev => ({ ...prev, [d]: { ...prev[d], second: parseInt(e.target.value) || 0 } }))} onKeyDown={handleEnterKey} className="w-12 h-6 text-xs text-center" />
                      </td>
                    ))}
                    <td className="py-1 px-1 text-center font-semibold text-amber-600">{PIPE_DIAMETERS.reduce((s, d) => s + (recoveredPipes[d]?.second || 0), 0)}</td>
                  </tr>
                  <tr className="border-t border-emerald-200/50">
                    <td className="py-1 px-2 font-medium text-destructive">Scrap</td>
                    {PIPE_DIAMETERS.map(d => (
                      <td key={d} className="py-0.5 px-0.5 text-center">
                        <Input type="number" min="0" value={recoveredPipes[d]?.scrap || ""} onChange={(e) => setRecoveredPipes(prev => ({ ...prev, [d]: { ...prev[d], scrap: parseInt(e.target.value) || 0 } }))} onKeyDown={handleEnterKey} className="w-12 h-6 text-xs text-center" />
                      </td>
                    ))}
                    <td className="py-1 px-1 text-center font-semibold text-destructive">{PIPE_DIAMETERS.reduce((s, d) => s + (recoveredPipes[d]?.scrap || 0), 0)}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="bg-emerald-100/50 border-t border-emerald-200 font-semibold">
                    <td className="py-1 px-2">Total</td>
                    {PIPE_DIAMETERS.map(d => (
                      <td key={d} className="py-1 px-1 text-center">{(recoveredPipes[d]?.first || 0) + (recoveredPipes[d]?.second || 0) + (recoveredPipes[d]?.scrap || 0) || "-"}</td>
                    ))}
                    <td className="py-1 px-1 text-center">{PIPE_DIAMETERS.reduce((s, d) => s + (recoveredPipes[d]?.first || 0) + (recoveredPipes[d]?.second || 0) + (recoveredPipes[d]?.scrap || 0), 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* TABLA 2: Clasificacion de Defectos - Compacta */}
            {(totalSecond > 0 || totalBroken > 0) && (
              <div>
                <h3 className="text-xs font-semibold text-foreground mb-1.5 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Tabla 2 - Defectos
                </h3>
                {(() => {
                  const diametersWithDefects = items.filter((i) => i.second_quality > 0 || i.broken > 0)
                  return (
                    <table className="w-full text-xs border border-border rounded">
                      <thead>
                        <tr className="bg-muted/50">
                          <th className="text-left py-1 px-2 font-medium text-muted-foreground">Motivo</th>
                          {diametersWithDefects.map((item) => (
                            <th key={item.diameter} className="text-center py-1 px-1 font-medium w-14">
                              {item.diameter} <span className="text-[9px] text-amber-600">({item.second_quality + item.broken})</span>
                            </th>
                          ))}
                          <th className="text-center py-1 px-1 font-medium w-10">Tot</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Rotura produccion */}
                        <tr className="bg-amber-50"><td colSpan={diametersWithDefects.length + 2} className="py-0.5 px-2 text-[9px] uppercase font-bold text-amber-700">Rotura Produccion</td></tr>
                        {productionReasons.map((reason) => {
                          const rowTotal = diametersWithDefects.reduce((s, item) => s + getDefectQuantity(item.diameter, reason.id), 0)
                          return (
                            <tr key={reason.id} className="border-t border-border/30">
                              <td className="py-0.5 px-2 text-[11px] text-muted-foreground">{reason.reason}</td>
                              {diametersWithDefects.map((item) => (
                                <td key={item.diameter} className="py-0.5 px-0.5 text-center">
                                  <Input type="number" min="0" value={getDefectQuantity(item.diameter, reason.id) || ""} onChange={(e) => updateDefect(item.diameter, reason.id, parseInt(e.target.value) || 0)} className="w-12 h-5 text-[10px] text-center" />
                                </td>
                              ))}
                              <td className="py-0.5 px-1 text-center font-semibold">{rowTotal || "-"}</td>
                            </tr>
                          )
                        })}
                        {/* Desmolde */}
                        <tr className="bg-red-50"><td colSpan={diametersWithDefects.length + 2} className="py-0.5 px-2 text-[9px] uppercase font-bold text-red-700">Rotura Desmolde</td></tr>
                        {desmoldeReasons.map((reason) => {
                          const rowTotal = diametersWithDefects.reduce((s, item) => s + getDefectQuantity(item.diameter, reason.id), 0)
                          return (
                            <tr key={reason.id} className="border-t border-border/30">
                              <td className="py-0.5 px-2 text-[11px] text-muted-foreground">{reason.reason}</td>
                              {diametersWithDefects.map((item) => (
                                <td key={item.diameter} className="py-0.5 px-0.5 text-center">
                                  <Input type="number" min="0" value={getDefectQuantity(item.diameter, reason.id) || ""} onChange={(e) => updateDefect(item.diameter, reason.id, parseInt(e.target.value) || 0)} className="w-12 h-5 text-[10px] text-center" />
                                </td>
                              ))}
                              <td className="py-0.5 px-1 text-center font-semibold">{rowTotal || "-"}</td>
                            </tr>
                          )
                        })}
                        {/* Otra */}
                        <tr className="bg-slate-50"><td colSpan={diametersWithDefects.length + 2} className="py-0.5 px-2 text-[9px] uppercase font-bold text-slate-700">Otro</td></tr>
                        {(() => {
                          const otherRowTotal = diametersWithDefects.reduce((s, item) => s + getDefectQuantity(item.diameter, OTHER_DEFECT_REASON_ID), 0)
                          const diametersWithOther = diametersWithDefects.filter(item => getDefectQuantity(item.diameter, OTHER_DEFECT_REASON_ID) > 0)
                          return (
                            <>
                              <tr className="border-t border-border/30">
                                <td className="py-0.5 px-2 text-[11px] text-muted-foreground">Otra</td>
                                {diametersWithDefects.map((item) => (
                                  <td key={item.diameter} className="py-0.5 px-0.5 text-center">
                                    <Input type="number" min="0" value={getDefectQuantity(item.diameter, OTHER_DEFECT_REASON_ID) || ""} onChange={(e) => updateDefect(item.diameter, OTHER_DEFECT_REASON_ID, parseInt(e.target.value) || 0)} className="w-12 h-5 text-[10px] text-center" />
                                  </td>
                                ))}
                                <td className="py-0.5 px-1 text-center font-semibold">{otherRowTotal || "-"}</td>
                              </tr>
                              {diametersWithOther.length > 0 && (
                                <tr className="border-t border-border/30 bg-slate-50">
                                  <td colSpan={diametersWithDefects.length + 2} className="py-1 px-2">
                                    <div className="flex flex-wrap gap-2">
                                      {diametersWithOther.map((item) => (
                                        <div key={item.diameter} className="flex items-center gap-1">
                                          <span className="text-[10px] text-muted-foreground">{item.diameter}:</span>
                                          <Input type="text" placeholder="Motivo..." value={otherDefectComments[item.diameter] || ""} onChange={(e) => setOtherDefectComments(prev => ({ ...prev, [item.diameter]: e.target.value }))} className="h-5 text-[10px] w-32" />
                                        </div>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </>
                          )
                        })()}
                      </tbody>
                      <tfoot>
                        <tr className="bg-muted/50 border-t font-semibold">
                          <td className="py-1 px-2 text-[10px]">Total</td>
                          {diametersWithDefects.map((item) => {
                            const colTotal = getTotalDefectsForDiameter(item.diameter)
                            const expected = item.second_quality + item.broken
                            const matches = colTotal === expected
                            return <td key={item.diameter} className="py-1 px-1 text-center"><span className={matches ? "text-emerald-600" : "text-destructive"}>{colTotal}/{expected}</span></td>
                          })}
                          <td className="py-1 px-1 text-center">{diametersWithDefects.reduce((s, i) => s + getTotalDefectsForDiameter(i.diameter), 0)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )
                })()}
                {/* Warning */}
                {diametersMissingDefects.length > 0 && (
                  <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">
                    <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                    <span className="text-[10px] text-amber-700">Defectos no coinciden: {diametersMissingDefects.map((i) => i.diameter).join(", ")}</span>
                  </div>
                )}
              </div>
            )}

            {/* Summary - inline compact */}
            {totalUnits > 0 && (
              <div className="flex gap-4 text-xs border border-border rounded px-3 py-2 bg-muted/30">
                <div className="text-center"><span className="text-muted-foreground">1ra:</span> <span className="font-bold text-emerald-600">{totalFirst}</span> <span className="text-[10px] text-muted-foreground">({((totalFirst / totalUnits) * 100).toFixed(0)}%)</span></div>
                <div className="text-center"><span className="text-muted-foreground">2da:</span> <span className="font-bold text-amber-600">{totalSecond}</span> <span className="text-[10px] text-muted-foreground">({((totalSecond / totalUnits) * 100).toFixed(0)}%)</span></div>
                <div className="text-center"><span className="text-muted-foreground">Rotos:</span> <span className="font-bold text-destructive">{totalBroken}</span> <span className="text-[10px] text-muted-foreground">({((totalBroken / totalUnits) * 100).toFixed(0)}%)</span></div>
                <div className="text-center"><span className="text-muted-foreground">Total:</span> <span className="font-bold">{totalUnits}</span></div>
              </div>
            )}

            {/* Signatures - compact */}
            <div className="flex gap-3 border-t border-border pt-3">
              <div className="flex-1 space-y-0.5 relative">
                <Label className="text-[10px] text-muted-foreground">Resp. Produccion *</Label>
                <Input
                  value={productionRespName}
                  onChange={(e) => { setProductionRespName(e.target.value); setShowProductionDropdown(true) }}
                  onFocus={() => setShowProductionDropdown(true)}
                  onBlur={() => setTimeout(() => setShowProductionDropdown(false), 200)}
                  placeholder="Nombre..."
                  className="h-8 text-xs"
                  autoComplete="off"
                />
                {showProductionDropdown && productionRespName.trim().length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-card border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                    {getFilteredEmployees(productionRespName).map((name) => (
                      <button
                        key={name}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { setProductionRespName(name); setShowProductionDropdown(false) }}
                      >
                        {name}
                      </button>
                    ))}
                    {getFilteredEmployees(productionRespName).length === 0 && productionRespName.trim().split(/\s+/).length >= 2 && (
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-muted/50 transition-colors flex items-center gap-2"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { addEmployeeByName(productionRespName, "production"); setShowProductionDropdown(false) }}
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        Agregar "{productionRespName.trim()}"
                      </button>
                    )}
                    {getFilteredEmployees(productionRespName).length > 0 && !getFilteredEmployees(productionRespName).some(n => n.toLowerCase() === productionRespName.trim().toLowerCase()) && productionRespName.trim().split(/\s+/).length >= 2 && (
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-muted/50 transition-colors flex items-center gap-2 border-t border-border/50"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { addEmployeeByName(productionRespName, "production"); setShowProductionDropdown(false) }}
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        Agregar "{productionRespName.trim()}"
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-0.5 relative">
                <Label className="text-[10px] text-muted-foreground">Resp. Logistica *</Label>
                <Input
                  value={logisticsRespName}
                  onChange={(e) => { setLogisticsRespName(e.target.value); setShowLogisticsDropdown(true) }}
                  onFocus={() => setShowLogisticsDropdown(true)}
                  onBlur={() => setTimeout(() => setShowLogisticsDropdown(false), 200)}
                  placeholder="Nombre..."
                  className="h-8 text-xs"
                  autoComplete="off"
                />
                {showLogisticsDropdown && logisticsRespName.trim().length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-card border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                    {getFilteredEmployees(logisticsRespName).map((name) => (
                      <button
                        key={name}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { setLogisticsRespName(name); setShowLogisticsDropdown(false) }}
                      >
                        {name}
                      </button>
                    ))}
                    {getFilteredEmployees(logisticsRespName).length === 0 && logisticsRespName.trim().split(/\s+/).length >= 2 && (
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-muted/50 transition-colors flex items-center gap-2"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { addEmployeeByName(logisticsRespName, "logistics"); setShowLogisticsDropdown(false) }}
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        Agregar "{logisticsRespName.trim()}"
                      </button>
                    )}
                    {getFilteredEmployees(logisticsRespName).length > 0 && !getFilteredEmployees(logisticsRespName).some(n => n.toLowerCase() === logisticsRespName.trim().toLowerCase()) && logisticsRespName.trim().split(/\s+/).length >= 2 && (
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-muted/50 transition-colors flex items-center gap-2 border-t border-border/50"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { addEmployeeByName(logisticsRespName, "logistics"); setShowLogisticsDropdown(false) }}
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        Agregar "{logisticsRespName.trim()}"
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Submit */}
            <div className="flex items-center gap-3 border-t border-border pt-4">
<Button onClick={handleSubmit} disabled={submitting || !productionRespName.trim() || !logisticsRespName.trim()} size="sm" className="gap-2">
  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
  {editingControl ? "Actualizar Planilla" : "Confirmar Planilla"}
  </Button>
              <Button variant="outline" size="sm" onClick={() => { setShowForm(false); resetForm() }}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs: Historial and Informe */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="historial" className="gap-2">
            <History className="h-4 w-4" />
            Historial
          </TabsTrigger>
          <TabsTrigger value="informe" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Informe de Roturas
          </TabsTrigger>
          <TabsTrigger value="desperdicio" className="gap-2">
            <AlertTriangle className="h-4 w-4" />
            Desperdicio
          </TabsTrigger>
        </TabsList>

        {/* Historial Tab */}
        <TabsContent value="historial">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Historial de Planillas</CardTitle>
                <Button variant="outline" size="sm" className="gap-2 text-xs">
                  <FileDown className="h-3.5 w-3.5" />
                  Exportar
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : controls.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  No hay planillas registradas
                </div>
              ) : (
                <div className="space-y-0">
                  {controls.map((c) => {
                    const first = c.items?.reduce((s, i) => s + (i.first_quality || 0), 0) || 0
                    const second = c.items?.reduce((s, i) => s + (i.second_quality || 0), 0) || 0
                    const broken = c.items?.reduce((s, i) => s + (i.broken || 0), 0) || 0
                    const total = first + second + broken
                    const isExpanded = expandedControl === c.id
                    const allDefects = c.items?.flatMap((i) => i.defects || []) || []

                    return (
                      <div key={c.id} className="border-b border-border/50">
                        <button
                          onClick={() => setExpandedControl(isExpanded ? null : c.id)}
                          className="w-full flex items-center gap-4 py-3 px-3 hover:bg-muted/30 transition-colors text-left"
                        >
                          <div className="flex-1 grid grid-cols-8 gap-2 items-center">
                            <span className="text-xs">{new Date(c.control_date + "T12:00:00").toLocaleDateString("es-AR")}</span>
                            <span className="text-xs font-mono">{c.lote}</span>
                            <span className="text-xs">{c.fabrication_order || "-"}</span>
                            <span className="text-xs text-center font-semibold text-emerald-600">{first}</span>
                            <span className="text-xs text-center font-semibold text-amber-600">{second}</span>
                            <span className="text-xs text-center font-semibold text-destructive">{broken}</span>
                            <span className="text-xs">{getEmployeeName(c.production_responsible_id)}</span>
                            <span className="text-xs">{getEmployeeName(c.logistics_responsible_id)}</span>
                          </div>
                          {allDefects.length > 0 && (
                            <Badge variant="secondary" className="text-[10px] shrink-0">
                              {allDefects.length} defectos
                            </Badge>
                          )}
                          {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                        </button>

                        {isExpanded && (
                          <div className="px-3 pb-4 space-y-3">
                            {/* Items detail */}
                            <div className="border border-border rounded-lg overflow-hidden">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="bg-muted/50">
                                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Diametro</th>
                                    <th className="text-center py-2 px-3 font-medium text-emerald-600">Primera</th>
                                    <th className="text-center py-2 px-3 font-medium text-amber-600">Segunda</th>
                                    <th className="text-center py-2 px-3 font-medium text-destructive">Rotos</th>
                                    <th className="text-center py-2 px-3 font-medium">Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {c.items?.map((item) => (
                                    <tr key={item.diameter} className="border-t border-border/50">
                                      <td className="py-1.5 px-3 font-medium">Cano {item.diameter}</td>
                                      <td className="py-1.5 px-3 text-center text-emerald-600">{item.first_quality}</td>
                                      <td className="py-1.5 px-3 text-center text-amber-600">{item.second_quality}</td>
                                      <td className="py-1.5 px-3 text-center text-destructive">{item.broken}</td>
                                      <td className="py-1.5 px-3 text-center font-semibold">{item.first_quality + item.second_quality + item.broken}</td>
                                    </tr>
                                  ))}
                                  <tr className="bg-muted/50 border-t border-border font-semibold">
                                    <td className="py-1.5 px-3">Total</td>
                                    <td className="py-1.5 px-3 text-center text-emerald-600">{first}</td>
                                    <td className="py-1.5 px-3 text-center text-amber-600">{second}</td>
                                    <td className="py-1.5 px-3 text-center text-destructive">{broken}</td>
                                    <td className="py-1.5 px-3 text-center">{total}</td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>

                            {/* Defects detail */}
                            {allDefects.length > 0 && (
                              <div className="border border-border rounded-lg overflow-hidden">
                                <div className="bg-muted/50 px-3 py-2 text-[10px] uppercase tracking-widest font-medium text-muted-foreground border-b border-border">
                                  Clasificacion de Defectos
                                </div>
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="bg-muted/30">
                                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Diametro</th>
                                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Categoria</th>
                                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Motivo</th>
                                      <th className="text-center py-2 px-3 font-medium text-muted-foreground">Cant.</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {c.items?.flatMap((item) =>
                                      (item.defects || []).map((defect) => (
                                        <tr key={defect.id} className="border-t border-border/50">
                                          <td className="py-1.5 px-3 font-medium">Cano {item.diameter}</td>
                                          <td className="py-1.5 px-3">
                                            <Badge variant="outline" className="text-[10px]">
                                              {defect.reason?.category === "produccion" ? "Produccion" : "Desmolde"}
                                            </Badge>
                                          </td>
                                          <td className="py-1.5 px-3">{defect.reason?.reason}</td>
                                          <td className="py-1.5 px-3 text-center font-semibold text-destructive">{defect.quantity}</td>
                                        </tr>
                                      ))
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {/* Action buttons */}
                            <div className="flex justify-end gap-2 pt-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5 text-xs"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleEditControl(c)
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                Editar
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                className="gap-1.5 text-xs"
onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteControl({ id: c.id, lote: c.lote })
                    }}
                                disabled={deletingId === c.id}
                              >
                                {deletingId === c.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" />
                                )}
                                Eliminar
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Informe de Roturas Tab */}
        <TabsContent value="informe">
          <div className="space-y-4">
            {/* Date Filters */}
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap">Desde:</Label>
                    <Input
                      type="date"
                      value={reportFromDate}
                      onChange={(e) => setReportFromDate(e.target.value)}
                      className="w-40 text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap">Hasta:</Label>
                    <Input
                      type="date"
                      value={reportToDate}
                      onChange={(e) => setReportToDate(e.target.value)}
                      className="w-40 text-sm"
                    />
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {reportData.filteredControls.length} planillas en el periodo
                  </Badge>
                  <div className="ml-auto flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="gap-2 text-xs"
                      onClick={() => setShowPdfPreview(true)}
                      disabled={reportData.totals.total === 0}
                    >
                      <FileDown className="h-3.5 w-3.5" />
                      Vista Previa PDF
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Summary Cards */}
            <div className="grid grid-cols-5 gap-4">
              <Card>
                <CardContent className="py-4 text-center">
                  <p className="text-2xl font-bold text-emerald-600">{reportData.totals.first}</p>
                  <p className="text-xs text-muted-foreground">Primera Calidad</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4 text-center">
                  <p className="text-2xl font-bold text-amber-600">{reportData.totals.second}</p>
                  <p className="text-xs text-muted-foreground">Segunda Calidad</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4 text-center">
                  <p className="text-2xl font-bold text-destructive">{reportData.totals.broken}</p>
                  <p className="text-xs text-muted-foreground">Rotos</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4 text-center">
                  <p className="text-2xl font-bold">{reportData.totals.total}</p>
                  <p className="text-xs text-muted-foreground">Total Producido</p>
                </CardContent>
              </Card>
              <Card className={reportData.totals.total > 0 && (reportData.totals.first / reportData.totals.total) * 100 >= 95 ? "bg-emerald-50 dark:bg-emerald-950/20" : (reportData.totals.first / reportData.totals.total) * 100 >= 90 ? "bg-amber-50 dark:bg-amber-950/20" : "bg-red-50 dark:bg-red-950/20"}>
                <CardContent className="py-4 text-center">
                  <p className={`text-2xl font-bold ${reportData.totals.total > 0 && (reportData.totals.first / reportData.totals.total) * 100 >= 95 ? "text-emerald-600" : (reportData.totals.first / reportData.totals.total) * 100 >= 90 ? "text-amber-600" : "text-destructive"}`}>
                    {reportData.totals.total > 0 ? ((reportData.totals.first / reportData.totals.total) * 100).toFixed(1) : "0.0"}%
                  </p>
                  <p className="text-xs text-muted-foreground">Indice de Calidad</p>
                  <p className="text-[10px] text-muted-foreground">(Primera / Total)</p>
                </CardContent>
              </Card>
            </div>

            {/* Roturas por Diametro (Molde) */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Produccion por Diametro (Molde)</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 font-medium text-muted-foreground">Diametro</th>
                      <th className="text-center py-2 font-medium text-emerald-600">Primera</th>
                      <th className="text-center py-2 font-medium text-amber-600">Segunda</th>
                      <th className="text-center py-2 font-medium text-destructive">Rotos</th>
                      <th className="text-center py-2 font-medium">Total</th>
                      <th className="text-center py-2 font-medium text-amber-600">% Segunda</th>
                      <th className="text-center py-2 font-medium text-destructive">% Rotura</th>
                      <th className="text-center py-2 font-medium text-emerald-600">Ind. Calidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PIPE_DIAMETERS.map((d) => {
                      const data = reportData.byDiameter[d]
                      const segundaPercent = data.total > 0 ? ((data.second / data.total) * 100).toFixed(1) : "0.0"
                      const roturaPercent = data.total > 0 ? ((data.broken / data.total) * 100).toFixed(1) : "0.0"
                      const calidadPercent = data.total > 0 ? ((data.first / data.total) * 100).toFixed(1) : "0.0"
                      return (
                        <tr key={d} className="border-b border-border/50">
                          <td className="py-2 font-medium">Cano {d}</td>
                          <td className="py-2 text-center text-emerald-600">{data.first}</td>
                          <td className="py-2 text-center text-amber-600">{data.second}</td>
                          <td className="py-2 text-center text-destructive">{data.broken}</td>
                          <td className="py-2 text-center font-semibold">{data.total}</td>
                          <td className="py-2 text-center">
                            <span className={`font-semibold ${Number(segundaPercent) > 5 ? "text-amber-600" : "text-muted-foreground"}`}>
                              {segundaPercent}%
                            </span>
                          </td>
                          <td className="py-2 text-center">
                            <span className={`font-semibold ${Number(roturaPercent) > 5 ? "text-destructive" : "text-muted-foreground"}`}>
                              {roturaPercent}%
                            </span>
                          </td>
                          <td className="py-2 text-center">
                            <span className={`font-semibold ${Number(calidadPercent) >= 95 ? "text-emerald-600" : Number(calidadPercent) >= 90 ? "text-amber-600" : "text-destructive"}`}>
                              {calidadPercent}%
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                    <tr className="bg-muted/50 font-semibold">
                      <td className="py-2">Total</td>
                      <td className="py-2 text-center text-emerald-600">{reportData.totals.first}</td>
                      <td className="py-2 text-center text-amber-600">{reportData.totals.second}</td>
                      <td className="py-2 text-center text-destructive">{reportData.totals.broken}</td>
                      <td className="py-2 text-center">{reportData.totals.total}</td>
                      <td className="py-2 text-center text-amber-600">
                        {reportData.totals.total > 0 ? ((reportData.totals.second / reportData.totals.total) * 100).toFixed(1) : "0.0"}%
                      </td>
                      <td className="py-2 text-center text-destructive">
                        {reportData.totals.total > 0 ? ((reportData.totals.broken / reportData.totals.total) * 100).toFixed(1) : "0.0"}%
                      </td>
                      <td className="py-2 text-center text-emerald-600">
                        {reportData.totals.total > 0 ? ((reportData.totals.first / reportData.totals.total) * 100).toFixed(1) : "0.0"}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* Roturas por Tipo de Defecto */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Roturas por Tipo de Defecto</CardTitle>
              </CardHeader>
              <CardContent>
                {reportData.byReason.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No hay defectos registrados en el periodo seleccionado
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 font-medium text-muted-foreground">Motivo</th>
                        <th className="text-left py-2 font-medium text-muted-foreground">Categoria</th>
                        {PIPE_DIAMETERS.map((d) => (
                          <th key={d} className="text-center py-2 font-medium text-muted-foreground w-16">{d}</th>
                        ))}
                        <th className="text-center py-2 font-medium text-destructive">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.byReason.map((r) => (
                        <tr key={r.reason} className="border-b border-border/50">
                          <td className="py-2 font-medium">{r.reason}</td>
                          <td className="py-2">
                            <Badge variant="outline" className="text-[10px]">
                              {r.category === "produccion" ? "Produccion" : "Desmolde"}
                            </Badge>
                          </td>
                          {PIPE_DIAMETERS.map((d) => (
                            <td key={d} className="py-2 text-center">
                              {r.byDiameter[d] > 0 ? (
                                <span className="text-destructive font-medium">{r.byDiameter[d]}</span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                          ))}
                          <td className="py-2 text-center font-bold text-destructive">{r.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Desperdicio Tab */}
        <TabsContent value="desperdicio">
          <div className="space-y-4">
            {/* Date Filters */}
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap">Desde:</Label>
                    <Input
                      type="date"
                      value={reportFromDate}
                      onChange={(e) => setReportFromDate(e.target.value)}
                      className="w-40 text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap">Hasta:</Label>
                    <Input
                      type="date"
                      value={reportToDate}
                      onChange={(e) => setReportToDate(e.target.value)}
                      className="w-40 text-sm"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* PARTE DIARIO - Cajones de Desperdicio */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-amber-700 uppercase tracking-wide flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                Parte Diario de Producción
              </h3>
              <p className="text-xs text-muted-foreground mb-3">Cajones de desperdicio cargados por el operario en el parte de producción</p>
              <div className="grid grid-cols-3 gap-4">
                <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200">
                  <CardContent className="py-4 text-center">
                    <p className="text-3xl font-bold text-amber-600">{Object.values(wasteData.wasteBinsByType).reduce((a, b) => a + b, 0).toFixed(1)}</p>
                    <p className="text-xs text-muted-foreground mt-1">Cajones Desperdicio</p>
                  </CardContent>
                </Card>
                <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200">
                  <CardContent className="py-4 text-center">
                    <p className="text-3xl font-bold text-amber-600">{(wasteData.totalWasteKg / 1000).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground mt-1">Toneladas Desperdicio</p>
                  </CardContent>
                </Card>
                <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200">
                  <CardContent className="py-4 text-center">
                    <p className="text-3xl font-bold text-amber-600">
                      {wasteData.totalProductionKg > 0 ? ((wasteData.totalWasteKg / wasteData.totalProductionKg) * 100).toFixed(2) : "0.00"}%
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">% vs Produccion Total</p>
                  </CardContent>
                </Card>
              </div>
              
              {/* Tabla de cajones por tipo */}
              <div className="mt-4">
                <h4 className="text-xs font-medium text-muted-foreground mb-2">Detalle por Tipo de Cajon</h4>
                <table className="w-full text-xs border border-border rounded">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left py-1.5 px-2 font-medium">Tipo</th>
                      <th className="text-center py-1.5 px-2 font-medium">Cajones</th>
                      <th className="text-center py-1.5 px-2 font-medium">Peso/Cajon (kg)</th>
                      <th className="text-center py-1.5 px-2 font-medium">Toneladas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const totalBins = Object.values(wasteData.wasteBinsByType).reduce((a, b) => a + b, 0)
                      const avgKgPerBin = totalBins > 0 ? wasteData.totalWasteKg / totalBins : 630
                      return wasteData.WASTE_BIN_TYPES.map((t) => {
                        const qty = wasteData.wasteBinsByType[t.key] || 0
                        const kg = qty * avgKgPerBin
                        return (
                          <tr key={t.key} className="border-t border-border/50">
                            <td className="py-1.5 px-2 font-medium">{t.label}</td>
                            <td className="py-1.5 px-2 text-center">{qty.toFixed(1)}</td>
                            <td className="py-1.5 px-2 text-center text-muted-foreground">{avgKgPerBin.toFixed(0)}</td>
                            <td className="py-1.5 px-2 text-center">{(kg / 1000).toFixed(2)}</td>
                          </tr>
                        )
                      })
                    })()}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/50 border-t font-semibold">
                      <td className="py-1.5 px-2">Total</td>
                      <td className="py-1.5 px-2 text-center">{Object.values(wasteData.wasteBinsByType).reduce((a, b) => a + b, 0).toFixed(1)}</td>
                      <td className="py-1.5 px-2 text-center text-muted-foreground">
                        {Object.values(wasteData.wasteBinsByType).reduce((a, b) => a + b, 0) > 0 
                          ? (wasteData.totalWasteKg / Object.values(wasteData.wasteBinsByType).reduce((a, b) => a + b, 0)).toFixed(0)
                          : "-"}
                      </td>
                      <td className="py-1.5 px-2 text-center">{(wasteData.totalWasteKg / 1000).toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              
              {/* Card de Toneladas Procesadas */}
              <div className="mt-4">
                <Card className="bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">Material Procesado (Produccion)</p>
                        <p className="text-2xl font-bold text-emerald-600">{(wasteData.totalProductionKg / 1000).toFixed(2)} Tn</p>
                        <p className="text-[10px] text-muted-foreground">{wasteData.totalProductionUnits.toLocaleString()} unidades producidas</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Desglose por tipo de cano:</p>
                        <div className="text-[10px] text-muted-foreground mt-1 space-y-0.5">
                          {PIPE_DIAMETERS.filter(d => (wasteData.totalProduction[d] || 0) > 0).map(d => (
                            <p key={d}>CC{d}: {wasteData.totalProduction[d]} u = {((wasteData.totalProduction[d] * (wasteData.pipeWeights[d] || 0)) / 1000).toFixed(2)} Tn</p>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* CONTROL DE CALIDAD - Segunda y Rotos */}
            <div className="space-y-2 mt-6">
              <h3 className="text-sm font-semibold text-orange-700 uppercase tracking-wide flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                Control de Calidad
              </h3>
              <p className="text-xs text-muted-foreground mb-3">Caños de segunda calidad y rotos registrados en el control de calidad</p>
              <div className="grid grid-cols-4 gap-4">
                <Card className="bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200">
                  <CardContent className="py-4 text-center">
                    <p className="text-2xl font-bold text-emerald-600">{(wasteData.totalProductionKg / 1000).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground mt-1">Producción Total (Tn)</p>
                    <p className="text-[10px] text-muted-foreground">{wasteData.totalProductionUnits.toLocaleString()} unidades</p>
                  </CardContent>
                </Card>
                <Card className="bg-orange-50 dark:bg-orange-950/20 border-orange-200">
                  <CardContent className="py-4 text-center">
                    <p className="text-2xl font-bold text-orange-600">{(wasteData.totalProductionBreakageKg / 1000).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground mt-1">Rotura Producción (Tn)</p>
                    <p className="text-[10px] text-muted-foreground">{wasteData.totalProductionBreakageUnits} unidades</p>
                  </CardContent>
                </Card>
                <Card className="bg-red-50 dark:bg-red-950/20 border-red-200">
                  <CardContent className="py-4 text-center">
                    <p className="text-2xl font-bold text-red-600">{(wasteData.totalControlBreakageKg / 1000).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground mt-1">Rotura Control (Tn)</p>
                    <p className="text-[10px] text-muted-foreground">{wasteData.totalControlBreakageUnits} unidades</p>
                  </CardContent>
                </Card>
                <Card className="bg-red-100 dark:bg-red-950/30 border-red-300">
                  <CardContent className="py-4 text-center">
                    <p className="text-2xl font-bold text-red-700">
                      {wasteData.totalProductionKg > 0 ? (((wasteData.totalProductionBreakageKg + wasteData.totalControlBreakageKg) / wasteData.totalProductionKg) * 100).toFixed(2) : "0.00"}%
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">% Rotura Total</p>
                    <p className="text-[10px] text-muted-foreground">{((wasteData.totalProductionBreakageKg + wasteData.totalControlBreakageKg) / 1000).toFixed(2)} Tn</p>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* RESUMEN TOTAL */}
            <div className="space-y-2 mt-6">
              <h3 className="text-sm font-semibold text-destructive uppercase tracking-wide flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-destructive"></span>
                Resumen Total de Desperdicio
              </h3>
              <Card className="bg-destructive/10 border-destructive/30">
                <CardContent className="py-4">
                  <div className="grid grid-cols-3 gap-6 text-center">
                    <div>
                      <p className="text-3xl font-bold text-destructive">{(wasteData.totalWasteAndBreakageKg / 1000).toFixed(2)}</p>
                      <p className="text-xs text-muted-foreground mt-1">Toneladas Totales</p>
                      <p className="text-[10px] text-muted-foreground">Cajones + Rotura Prod + Rotura Control</p>
                    </div>
                    <div>
                      <p className="text-3xl font-bold text-destructive">{wasteData.wastePercentage}%</p>
                      <p className="text-xs text-muted-foreground mt-1">% de Produccion Total</p>
                    </div>
                    <div className="text-left text-xs space-y-1">
                      <p className="text-muted-foreground">Desglose:</p>
                      <p className="text-amber-600">Cajones: {(wasteData.totalWasteKg / 1000).toFixed(2)} Tn ({Object.values(wasteData.wasteBinsByType).reduce((a, b) => a + b, 0).toFixed(1)} caj)</p>
                      <p className="text-orange-600">Rotura Prod: {(wasteData.totalProductionBreakageKg / 1000).toFixed(2)} Tn ({wasteData.totalProductionBreakageUnits} u)</p>
                      <p className="text-red-600">Rotura Control: {(wasteData.totalControlBreakageKg / 1000).toFixed(2)} Tn ({wasteData.totalControlBreakageUnits} u)</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Gráfico de Tendencia - Cajones de Desperdicio */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-base">Tendencia Diaria - Cajones de Desperdicio (Tn)</CardTitle>
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Tipo:</span>
                      <div className="flex gap-1 flex-wrap">
                        <Button
                          size="sm"
                          variant={wasteBinFilter === "todos" ? "default" : "outline"}
                          onClick={() => setWasteBinFilter("todos")}
                          className="h-7 px-2 text-xs"
                        >
                          Todos
                        </Button>
                        {wasteData.WASTE_BIN_TYPES.map((t) => (
                          <Button
                            key={t.key}
                            size="sm"
                            variant={wasteBinFilter === t.key ? "default" : "outline"}
                            onClick={() => setWasteBinFilter(t.key)}
                            className="h-7 px-2 text-xs"
                          >
                            {t.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Turno:</span>
                      <div className="flex gap-1">
                        {(["todos", "1", "2"] as const).map((t) => (
                          <Button
                            key={t}
                            size="sm"
                            variant={wasteShiftFilter === t ? "default" : "outline"}
                            onClick={() => setWasteShiftFilter(t)}
                            className="h-7 px-2 text-xs"
                          >
                            {t === "todos" ? "Todos" : `T${t}`}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {wasteData.byDate.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No hay datos en el periodo seleccionado
                  </div>
                ) : (
                  <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={wasteData.byDate.map(([date, data]) => {
                          const shiftBinData = wasteData.byDateShiftBin[date] || {}
                          
                          let totalKg = 0
                          
                          // Calculate kg per bin for this date
                          const totalBins = Object.values(data.wasteBins || {}).reduce((a: number, b: any) => a + (parseFloat(b) || 0), 0)
                          const kgPerBin = totalBins > 0 ? data.totalWasteKg / totalBins : 630
                          
                          if (wasteShiftFilter === "todos") {
                            if (wasteBinFilter === "todos") {
                              totalKg = data.totalWasteKg || 0
                            } else {
                              const binQty = data.wasteBins?.[wasteBinFilter] || 0
                              totalKg = binQty * kgPerBin
                            }
                          } else {
                            const shiftNum = Number(wasteShiftFilter)
                            const shiftData = shiftBinData[shiftNum] || {}
                            if (wasteBinFilter === "todos") {
                              const shiftBins = Object.values(shiftData).reduce((a: number, b: any) => a + (parseFloat(b) || 0), 0)
                              totalKg = shiftBins * kgPerBin
                            } else {
                              const binQty = shiftData[wasteBinFilter] || 0
                              totalKg = binQty * kgPerBin
                            }
                          }
                          
                          return {
                            date: new Date(date + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }),
                            tn: totalKg / 1000,
                          }
                        })}
                        margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="wasteGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                        <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" />
                        <Tooltip
                          contentStyle={{ fontSize: 12 }}
                          formatter={(val: number) => [`${val.toFixed(2)} Tn`, "Desperdicio"]}
                          labelFormatter={(label) => `Fecha: ${label}`}
                        />
                        <Area
                          type="monotone"
                          dataKey="tn"
                          stroke="#f59e0b"
                          strokeWidth={2}
                          fill="url(#wasteGradient)"
                          dot={{ r: 3, fill: "#f59e0b" }}
                          name="tn"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
                {(wasteBinFilter !== "todos" || wasteShiftFilter !== "todos") && (
                  <p className="text-xs text-muted-foreground mt-2 text-center">
                    Filtrando: {wasteBinFilter !== "todos" ? wasteData.WASTE_BIN_TYPES.find(t => t.key === wasteBinFilter)?.label : "Todos los tipos"}
                    {wasteShiftFilter !== "todos" ? ` - Turno ${wasteShiftFilter}` : ""}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Tabla de Rotura de Caños por Tipo */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Rotura de Caños por Tipo</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-xs border border-border rounded">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left py-1.5 px-2 font-medium">Tipo</th>
                      <th className="text-center py-1.5 px-2 font-medium">Rotura Prod</th>
                      <th className="text-center py-1.5 px-2 font-medium">Rotura Control</th>
                      <th className="text-center py-1.5 px-2 font-medium">Total Unidades</th>
                      <th className="text-center py-1.5 px-2 font-medium">Toneladas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PIPE_DIAMETERS.filter(d => d >= 800).map((d) => {
                      const prodBreak = wasteData.productionBreakage[d] || 0
                      const ctrlBreak = wasteData.controlBreakage[d] || 0
                      const total = prodBreak + ctrlBreak
                      const kg = total * (wasteData.pipeWeights[d] || 0)
                      return (
                        <tr key={d} className="border-t border-border/50">
                          <td className="py-1.5 px-2 font-medium">CC{d}</td>
                          <td className="py-1.5 px-2 text-center text-orange-600">{prodBreak}</td>
                          <td className="py-1.5 px-2 text-center text-red-600">{ctrlBreak}</td>
                          <td className="py-1.5 px-2 text-center font-semibold">{total}</td>
                          <td className="py-1.5 px-2 text-center">{(kg / 1000).toFixed(2)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/50 border-t font-semibold">
                      <td className="py-1.5 px-2">Total</td>
                      <td className="py-1.5 px-2 text-center text-orange-600">{wasteData.totalProductionBreakageUnits}</td>
                      <td className="py-1.5 px-2 text-center text-red-600">{wasteData.totalControlBreakageUnits}</td>
                      <td className="py-1.5 px-2 text-center">{wasteData.totalBreakageUnits}</td>
                      <td className="py-1.5 px-2 text-center">{(wasteData.totalBreakageKg / 1000).toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </CardContent>
            </Card>

            {/* Rotura por Molde */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Rotura por Molde (Diámetro)</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 font-medium text-muted-foreground">Diámetro</th>
                      <th className="text-right py-2 font-medium text-muted-foreground">Peso/u (kg)</th>
                      <th className="text-center py-2 font-medium text-orange-600">Prod (u)</th>
                      <th className="text-center py-2 font-medium text-orange-600">Prod (kg)</th>
                      <th className="text-center py-2 font-medium text-red-600">Control (u)</th>
                      <th className="text-center py-2 font-medium text-red-600">Control (kg)</th>
                      <th className="text-center py-2 font-medium text-destructive">Total (u)</th>
                      <th className="text-center py-2 font-medium text-destructive">Total (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PIPE_DIAMETERS.map((d) => {
                      const prodUnits = wasteData.productionBreakage[d] || 0
                      const controlUnits = wasteData.controlBreakage[d] || 0
                      const weight = wasteData.pipeWeights[d] || 0
                      const totalUnits = prodUnits + controlUnits
                      return (
                        <tr key={d} className="border-b border-border/50">
                          <td className="py-2 font-medium">Caño {d}</td>
                          <td className="py-2 text-right text-muted-foreground">{weight}</td>
                          <td className="py-2 text-center text-orange-600">{prodUnits || "-"}</td>
                          <td className="py-2 text-center text-orange-600">{prodUnits ? (prodUnits * weight).toLocaleString() : "-"}</td>
                          <td className="py-2 text-center text-red-600">{controlUnits || "-"}</td>
                          <td className="py-2 text-center text-red-600">{controlUnits ? (controlUnits * weight).toLocaleString() : "-"}</td>
                          <td className="py-2 text-center font-semibold text-destructive">{totalUnits || "-"}</td>
                          <td className="py-2 text-center font-semibold text-destructive">{totalUnits ? (totalUnits * weight).toLocaleString() : "-"}</td>
                        </tr>
                      )
                    })}
                    <tr className="bg-muted/50 font-semibold">
                      <td className="py-2" colSpan={2}>Total</td>
                      <td className="py-2 text-center text-orange-600">{wasteData.totalProductionBreakageUnits}</td>
                      <td className="py-2 text-center text-orange-600">{wasteData.totalProductionBreakageKg.toLocaleString()}</td>
                      <td className="py-2 text-center text-red-600">{wasteData.totalControlBreakageUnits}</td>
                      <td className="py-2 text-center text-red-600">{wasteData.totalControlBreakageKg.toLocaleString()}</td>
                      <td className="py-2 text-center text-destructive">{wasteData.totalProductionBreakageUnits + wasteData.totalControlBreakageUnits}</td>
                      <td className="py-2 text-center text-destructive">{(wasteData.totalProductionBreakageKg + wasteData.totalControlBreakageKg).toLocaleString()}</td>
                    </tr>
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* Desperdicio por Fecha */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Desperdicio por Fecha</CardTitle>
              </CardHeader>
              <CardContent>
                {wasteData.byDate.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No hay datos de desperdicio en el periodo seleccionado
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 font-medium text-muted-foreground">Fecha</th>
                        <th className="text-center py-2 font-medium text-orange-600">Rotura Prod.</th>
                        <th className="text-center py-2 font-medium text-red-600">Rotura Control</th>
                        <th className="text-center py-2 font-medium text-amber-600">Cajones</th>
                        <th className="text-right py-2 font-medium text-destructive">Total (kg)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wasteData.byDate.map(([date, data]) => {
                        const prodTotal = PIPE_DIAMETERS.reduce((sum, d) => sum + (data.productionBreakage[d] || 0), 0)
                        const controlTotal = PIPE_DIAMETERS.reduce((sum, d) => sum + (data.controlBreakage[d] || 0), 0)
                        return (
                          <tr key={date} className="border-b border-border/50">
                            <td className="py-2 font-medium">{new Date(date + "T12:00:00").toLocaleDateString("es-AR")}</td>
                            <td className="py-2 text-center text-orange-600">{prodTotal || "-"}</td>
                            <td className="py-2 text-center text-red-600">{controlTotal || "-"}</td>
                            <td className="py-2 text-center text-amber-600">{data.scrapBoxes || "-"}</td>
                            <td className="py-2 text-right font-semibold text-destructive">{data.totalKg.toLocaleString()}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            {/* Nota sobre pesos */}
            <Card className="bg-muted/30">
              <CardContent className="py-3">
                <p className="text-xs text-muted-foreground">
                  <strong>Nota:</strong> Los pesos de los caños se obtienen de la configuración de productos. 
                  Los cajones de desperdicio usan el campo total_waste_kg del parte de producción.
                  Puede ajustar estos valores en Configuración {'>'} Productos.
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* PDF Preview Dialog */}
      <Dialog open={showPdfPreview} onOpenChange={setShowPdfPreview}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Vista Previa - Informe de Calidad de Canos</span>
              <Button 
                variant="default" 
                size="sm" 
                className="gap-2"
                onClick={handleExportPDF}
                disabled={exportingPdf}
              >
                {exportingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                Descargar PDF
              </Button>
            </DialogTitle>
          </DialogHeader>
          <div className="border rounded-lg bg-white p-4 shadow-inner">
            <PipeQualityExecutiveReport
              ref={pdfReportRef}
              fromDate={reportFromDate}
              toDate={reportToDate}
              reportData={reportData}
              controlsCount={reportData.filteredControls.length}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Confirmar eliminacion
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>Esta a punto de eliminar la planilla de control:</p>
              <p className="font-semibold text-foreground">Lote: {controlToDelete?.lote}</p>
              <p className="text-destructive font-medium">Esta accion no se puede deshacer.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteControl}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Si, eliminar planilla
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
