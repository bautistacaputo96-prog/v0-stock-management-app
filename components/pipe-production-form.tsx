"use client"

import type React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import { useEnterNavigation } from "@/hooks/use-enter-navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { getSupabase } from "@/lib/supabase"
import { Loader2, Zap, ListPlus, AlertTriangle } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface DowntimeEntry {
  minutes: number
  comments: string
}

interface MoldBreakage {
  size: string
  reasons: string[]
  comments: string
}

// Motivos de rotura de molde según el PDF actualizado
const MOLD_BREAKAGE_REASONS = [
  "Autoelevador",
  "Rodamiento",
  "Correas/poleas",
  "Motor vibrado",
  "Pulsador",
  "Cierre molde",
  "Traba aros",
  "Sist. Eléctrico",
  "Terminador",
  "Cono",
]

// Motivos de parada según el PDF de Caños actualizado - exactamente como aparecen
const DOWNTIME_CATEGORIES: Record<string, string[]> = {
  "Factores Externos": [
    "Energía Eléctrica",
    "Piedra en Materia Prima",
  ].sort(),
  "Paradas Planificadas": [
    "Cambio de Producto",
    "Capacitación",
    "Mto Autónomo (limp, lub y ajustes)",
    "Pruebas y/o ensayos varios",
    "Reuniones",
  ].sort(),
  "Fallas de Equipo (Paradas Mayores a 5 min.)": [
    "Sistema de agua",
    "Sistema de aire",
    "Tolva de hormigón",
    "Tolvas de áridos",
    "Tablero eléctrico principal",
  ].sort(),
  "Falla de Gestión": [
    "Espera de Materia Prima",
    "Espera de Instrucciones",
    "Espera de Insumos",
    "Factores Humanos",
  ].sort(),
  "Fallas de Equipo (Paradas Mayores a 5 min.) - Detalle": [
    "Autoelevador",
    "Balanza de áridos",
    "Balanza de cemento",
    "Bomba de agua de pozo",
    "Base y pistón terminación 300/400",
    "Cinta transportadora áridos",
    "Cinta transportadora hormigón",
    "Dosificador aditivo",
    "Embudos de carga y aros",
    "Mezcladora",
    "Cono",
  ].sort(),
  "Fallas de Proceso": [
    "Calidad de Producto",
    "Operario en capacitación",
    "Problema con Calidad de Hormigón",
    "Problema con Calidad de Materia Prima",
  ].sort(),
}

export const DEFAULT_PIPE_SIZES = ["300", "400", "500", "600"]
export const LARGE_PIPE_SIZES = ["800", "1000", "1200"]

// Motivos de parada específicos para Villa Rosa (menos opciones en fallas de equipo)
const VILLA_ROSA_DOWNTIME_CATEGORIES: Record<string, string[]> = {
  "Factores Externos": [
    "Energía Eléctrica",
    "Piedra en Materia Prima",
  ].sort(),
  "Paradas Planificadas": [
    "Cambio de Producto",
    "Capacitación",
    "Mto Autónomo (limp, lub y ajustes)",
    "Pruebas y/o ensayos varios",
    "Reuniones",
  ].sort(),
  "Fallas de Equipo": [
    "Sistema de agua",
    "Sistema de aire",
    "Tolva de hormigón",
    "Tolvas de áridos",
    "Tablero eléctrico principal",
    "Autoelevador",
    "Balanza de áridos",
    "Balanza de cemento",
    "Bomba de agua de pozo",
    "Cinta transportadora áridos",
    "Cinta transportadora hormigón",
    "Dosificador aditivo",
    "Mezcladora",
  ].sort(),
  "Falla de Gestión": [
    "Espera de Materia Prima",
    "Espera de Instrucciones",
    "Espera de Insumos",
    "Factores Humanos",
  ].sort(),
  "Fallas de Proceso": [
    "Calidad de Producto",
    "Operario en capacitación",
  ].sort(),
}

function getDowntimeCategory(reason: string): string {
  for (const category in DOWNTIME_CATEGORIES) {
    if (DOWNTIME_CATEGORIES[category].includes(reason)) {
      return category
    }
  }
  return "Otro"
}

interface PipeProductionFormProps {
  editingRecord?: any | null
  onSaveComplete?: () => void
  pipeSizes?: string[]
  plantName?: string
  selectedPlant?: string
  }


export function PipeProductionForm({ editingRecord = null, onSaveComplete, pipeSizes = DEFAULT_PIPE_SIZES, plantName = "SILKE", selectedPlant = "silke" }: PipeProductionFormProps) {
  const PIPE_SIZES = pipeSizes
  const { toast } = useToast()
  const formRef = useRef<HTMLFormElement>(null)
  const [loading, setLoading] = useState(false)

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
  const [totalProductionMinutes, setTotalProductionMinutes] = useState<number>(0)
  const [calculatedDowntimeTotal, setCalculatedDowntimeTotal] = useState<number>(0)
  const [lastRecord, setLastRecord] = useState<{ date: string; shift: number } | null>(null)

  // Cargar el último parte cargado
  useEffect(() => {
    if (!editingRecord) {
      const loadLastRecord = async () => {
        const supabase = getSupabase()
        const { data } = await supabase
          .from("pipe_production")
          .select("production_date, shift, created_at")
          .order("created_at", { ascending: false })
          .limit(1)
        
        if (data && data.length > 0) {
          setLastRecord({ date: data[0].production_date, shift: data[0].shift })
        }
      }
      loadLastRecord()
    }
  }, [editingRecord])

  const [quickMode, setQuickMode] = useState(false)
  const [formData, setFormData] = useState({
    productionDate: new Date().toISOString().split("T")[0],
    shift: "1",
    operatorsCount: "3",
    startTime: "05:00",
    endTime: "14:20",
    cleaningMinutes: "",
    tprMinutes: "",
    operatorName: "",
    productionEndTime: "",
    cementFinalShiftTn: "",
    // Cajones de desperdicio por tipo (precisión 0.5)
    wasteBin1Cinta: "",      // Cajón 1 - Sector Cinta (710kg)
    wasteBin2Desmolde: "",   // Cajón 2 - Sector Desmolde (656kg)
    wasteBin3Cinta: "",      // Cajón 3 - Sector Cinta (710kg)
    wasteBin4Rotos: "",      // Cajón 4 - Caños Rotos (1307kg)
    wasteBin5Mezcladora: "", // Cajón 5 - Mezcladora (710kg)
    blocones: "",
    cantidadPastones: "",
    silo1: "",
    silo2: "",
    totalPastones: "",
    fabricationOrderNumber: "",
  })
  
  // Actualizar horarios por defecto cuando cambia la planta
  useEffect(() => {
    if (!editingRecord) {
      if (plantName === "Villa Rosa") {
        setFormData(prev => ({ ...prev, startTime: "07:00", endTime: "12:00" }))
      }
    }
  }, [plantName, editingRecord])

  // Cargar horarios del último parte del mismo turno
  useEffect(() => {
    if (!editingRecord) {
      const loadLastShiftTimes = async () => {
        const supabase = getSupabase()
        const { data } = await supabase
          .from("pipe_production")
          .select("start_time, end_time, cleaning_minutes")
          .eq("shift", Number.parseInt(formData.shift))
          .order("created_at", { ascending: false })
          .limit(1)
        
        if (data && data.length > 0 && data[0].start_time && data[0].end_time) {
          setFormData(prev => ({
            ...prev,
            startTime: data[0].start_time,
            endTime: data[0].end_time,
            cleaningMinutes: data[0].cleaning_minutes?.toString() || (formData.shift === "2" ? "60" : ""),
          }))
        } else {
          // Valores por defecto si no hay datos previos
          if (plantName === "Villa Rosa") {
            // Villa Rosa: 7am inicio, 12pm fin produccion (luego limpieza hasta 16:00)
            setFormData(prev => ({ ...prev, startTime: "07:00", endTime: "12:00", cleaningMinutes: "" }))
          } else if (formData.shift === "1") {
            setFormData(prev => ({ ...prev, startTime: "05:00", endTime: "14:20", cleaningMinutes: "" }))
          } else if (formData.shift === "2") {
            setFormData(prev => ({ ...prev, startTime: "14:20", endTime: "23:40", cleaningMinutes: "60" }))
          }
        }
      }
      loadLastShiftTimes()
    }
  }, [formData.shift, editingRecord])

  // Dosificación única para todos los caños
  const emptyDosif = { cement: "", sand: "", stone010: "", stone020: "", additiveLiters: "", water: "" }
  const [dosificacion, setDosificacion] = useState({ ...emptyDosif })
  
  // Fórmula del pastón desde Formuleo
  const [pastonFormula, setPastonFormula] = useState<{
    id?: number
    cement_kg: number
    sand_kg: number
    stone_kg: number
    diluted_additive_per_paston_liters: number
    additive_1_name: string
    additive_2_name: string
    modified_by: string
    modified_at: string
  } | null>(null)
  const [formulaModified, setFormulaModified] = useState(false)
  const [showFormulaChangeDialog, setShowFormulaChangeDialog] = useState(false)
  const [formulaChangedBy, setFormulaChangedBy] = useState("")
  const [formulaChangeReason, setFormulaChangeReason] = useState("")
  const [originalDosificacion, setOriginalDosificacion] = useState({ ...emptyDosif })
  
  // Proveedores por ingrediente
  const [ingredientSuppliers, setIngredientSuppliers] = useState<Record<string, string[]>>({})
  const [currentSuppliers, setCurrentSuppliers] = useState<Record<string, string>>({
    Cemento: "",
    Arena: "",
    Piedra: ""
  })
  
  // Cargar proveedores desde la tabla suppliers
  useEffect(() => {
    const loadSuppliers = async () => {
      const supabase = getSupabase()
      const plantValue = plantName === "Villa Rosa" ? "villa_rosa" : (plantName === "Mercedes" ? "mercedes" : "silke")
      
      const { data } = await supabase
        .from("suppliers")
        .select("material_type, name")
        .eq("plant", plantValue)
        .eq("is_active", true)
        .order("material_type", { ascending: true })
        .order("name", { ascending: true })
      
      if (data) {
        // Categorizar materiales por tipo base
        const categorize = (materialType: string): string => {
          const mt = materialType.toLowerCase()
          if (mt.includes("arena")) return "Arena"
          if (mt.includes("piedra")) return "Piedra"
          if (mt.includes("cemento") || mt.includes("cpc")) return "Cemento"
          if (mt.includes("aditivo") || mt.includes("mark") || mt.includes("darac")) return "Aditivo"
          return materialType
        }
        
        const grouped: Record<string, string[]> = {
          Cemento: [],
          Arena: [],
          Piedra: []
        }
        
        data.forEach((s: { material_type: string; name: string }) => {
          const category = categorize(s.material_type)
          const displayValue = `${s.material_type} - ${s.name}`
          if (grouped[category] && !grouped[category].includes(displayValue)) {
            grouped[category].push(displayValue)
          }
        })
        setIngredientSuppliers(grouped)
      }
    }
    loadSuppliers()
  }, [plantName])
  
  // Cargar fórmula del pastón desde Formuleo
  useEffect(() => {
    const loadPastonFormula = async () => {
      const supabase = getSupabase()
      const plantValue = plantName === "Villa Rosa" ? "villa_rosa" : (plantName === "Mercedes" ? "mercedes" : "silke")
      
      const { data } = await supabase
        .from("paston_formulas")
        .select("*")
        .eq("plant", plantValue)
        .eq("is_active", true)
        .order("modified_at", { ascending: false })
        .limit(1)
        .single()
      
      if (data) {
        setPastonFormula(data)
        // Auto-llenar dosificación con valores de la fórmula (si no hay editingRecord)
        if (!editingRecord) {
          const newDosif = {
            cement: data.cement_kg?.toString() || "",
            sand: data.sand_kg?.toString() || "",
            stone010: data.stone_kg?.toString() || "",
            stone020: "",
            additiveLiters: data.diluted_additive_per_paston_liters?.toString() || "",
            water: ""
          }
          setDosificacion(newDosif)
          setOriginalDosificacion(newDosif)
        }
      }
    }
    loadPastonFormula()
  }, [plantName, editingRecord])
  
  // Detectar si la dosificación fue modificada respecto a la fórmula original
  useEffect(() => {
    if (pastonFormula && originalDosificacion.cement) {
      const changed = 
        dosificacion.cement !== originalDosificacion.cement ||
        dosificacion.sand !== originalDosificacion.sand ||
        dosificacion.stone010 !== originalDosificacion.stone010 ||
        dosificacion.additiveLiters !== originalDosificacion.additiveLiters
      setFormulaModified(changed)
    }
  }, [dosificacion, originalDosificacion, pastonFormula])

  // Producción por medida - inicializar vacío
  const [production, setProduction] = useState<Record<string, Record<string, string>>>({})

  // Transporte a playa - inicializar vacío
  const [transporte, setTransporte] = useState<Record<string, Record<string, string>>>({})

  // Initialize production and transporte when PIPE_SIZES changes
  useEffect(() => {
    setProduction(prev => {
      const initial: Record<string, Record<string, string>> = {}
      PIPE_SIZES.forEach((size) => {
        initial[size] = prev[size] || { simples: "", rotura: "", armado: "", rotura_armado: "" }
      })
      return initial
    })
    setTransporte(prev => {
      const initial: Record<string, Record<string, string>> = {}
      PIPE_SIZES.forEach((size) => {
        initial[size] = prev[size] || { simples: "", rotura: "", armado: "", rotura_armado: "" }
      })
      return initial
    })
  }, [PIPE_SIZES])

  const [downtimes, setDowntimes] = useState<Record<string, DowntimeEntry>>({})
  const [observationsComments, setObservationsComments] = useState("")
  const [moldBreakages, setMoldBreakages] = useState<MoldBreakage[]>([{ size: "", reasons: [], comments: "" }])

  // Funciones para manejar roturas de molde
  const addMoldBreakage = () => {
    setMoldBreakages([...moldBreakages, { size: "", reasons: [], comments: "" }])
  }

  const updateMoldBreakage = (index: number, field: keyof MoldBreakage, value: string | string[] | number) => {
    const updated = [...moldBreakages]
    updated[index] = { ...updated[index], [field]: value }
    setMoldBreakages(updated)
  }

  const toggleMoldBreakageReason = (index: number, reason: string) => {
    const updated = [...moldBreakages]
    const currentReasons = updated[index].reasons
    if (currentReasons.includes(reason)) {
      updated[index].reasons = currentReasons.filter(r => r !== reason)
    } else {
      updated[index].reasons = [...currentReasons, reason]
    }
    setMoldBreakages(updated)
  }

  const removeMoldBreakage = (index: number) => {
    setMoldBreakages(moldBreakages.filter((_, i) => i !== index))
  }

  // Load saved data from localStorage
  useEffect(() => {
    const savedData = localStorage.getItem("pipeProductionForm")
    if (savedData && !editingRecord) {
      try {
        const parsed = JSON.parse(savedData)
        if (parsed.formData) setFormData(parsed.formData)
        if (parsed.production) setProduction(parsed.production)
        if (parsed.transporte) setTransporte(parsed.transporte)
        if (parsed.downtimes) setDowntimes(parsed.downtimes)
        if (parsed.observationsComments) setObservationsComments(parsed.observationsComments)
        if (parsed.moldBreakages) setMoldBreakages(parsed.moldBreakages)
        if (parsed.dosificacion) setDosificacion(parsed.dosificacion)
      } catch (error) {
        console.error("Error loading saved form data:", error)
      }
    }
  }, [editingRecord])

  // Save to localStorage on change
  useEffect(() => {
    if (!editingRecord) {
      localStorage.setItem("pipeProductionForm", JSON.stringify({ formData, production, transporte, downtimes, observationsComments, moldBreakages, dosificacion }))
    }
  }, [formData, production, transporte, downtimes, observationsComments, editingRecord])

  // Load editing record
  useEffect(() => {
    if (editingRecord) {
      const productionDate = editingRecord.production_date?.includes("T")
        ? editingRecord.production_date.split("T")[0]
        : editingRecord.production_date

      setFormData({
        productionDate: productionDate || new Date().toISOString().split("T")[0],
        shift: editingRecord.shift?.toString() || "1",
        operatorsCount: editingRecord.operators_count?.toString() || "3",
        startTime: editingRecord.start_time || "",
        endTime: editingRecord.end_time || "",
        cleaningMinutes: editingRecord.cleaning_minutes?.toString() || "",
        tprMinutes: editingRecord.tpr_minutes?.toString() || "",
        operatorName: editingRecord.machine_operator || "",
  cementFinalShiftTn: editingRecord.cement_final_shift_tn?.toString() || "",
  wasteBin1Cinta: editingRecord.waste_bin_1_cinta?.toString() || "",
  wasteBin2Desmolde: editingRecord.waste_bin_2_desmolde?.toString() || "",
  wasteBin3Cinta: editingRecord.waste_bin_3_cinta?.toString() || "",
  wasteBin4Rotos: editingRecord.waste_bin_4_rotos?.toString() || "",
  wasteBin5Mezcladora: editingRecord.waste_bin_5_mezcladora?.toString() || "",
  })
      
      // Load dosificacion (usar dosif_chico como fuente, mantiene compatibilidad con registros antiguos)
      // Calcular litros de aditivo: suma de aditivo 1 y 2 (están en gramos, convertir a litros aprox)
      const totalAdditiveGrams = (editingRecord.dosif_chico_aditivo_1_kg || 0) + (editingRecord.dosif_chico_aditivo_2_kg || 0)
      setDosificacion({
        cement: editingRecord.dosif_chico_cemento_kg?.toString() || "",
        sand: editingRecord.dosif_chico_arena_kg?.toString() || "",
        stone010: editingRecord.dosif_chico_piedra_0_10_kg?.toString() || "",
        stone020: editingRecord.dosif_chico_piedra_0_20_kg?.toString() || "",
        additiveLiters: totalAdditiveGrams > 0 ? (totalAdditiveGrams / 1000).toFixed(2) : "",
        water: editingRecord.dosif_chico_agua_kg?.toString() || "",
      })
      
      // Load suppliers
      setCurrentSuppliers({
        Cemento: editingRecord.supplier_cement || "",
        Arena: editingRecord.supplier_sand || "",
        Piedra: editingRecord.supplier_stone || "",
      })
      
      // Load production data
      const newProduction: Record<string, Record<string, string>> = {}
      PIPE_SIZES.forEach((size) => {
        newProduction[size] = {
          simples: editingRecord[`cc${size}_simples`]?.toString() || editingRecord[`prod_${size}_simples`]?.toString() || "",
          rotura: editingRecord[`cc${size}_rotura`]?.toString() || editingRecord[`prod_${size}_rotura`]?.toString() || "",
          armado: editingRecord[`cc${size}_armado`]?.toString() || editingRecord[`prod_${size}_armado`]?.toString() || "",
          rotura_armado: editingRecord[`cc${size}_rotura_armado`]?.toString() || editingRecord[`prod_${size}_rotura_armado`]?.toString() || "",
        }
      })
      setProduction(newProduction)

      // Load transporte data
      const newTransporte: Record<string, Record<string, string>> = {}
      PIPE_SIZES.forEach((size) => {
        newTransporte[size] = {
          simples: editingRecord[`transp_${size}_simples`]?.toString() || "",
          rotura: editingRecord[`transp_${size}_rotura`]?.toString() || "",
          armado: editingRecord[`transp_${size}_armado`]?.toString() || "",
          rotura_armado: editingRecord[`transp_${size}_rotura_armado`]?.toString() || "",
        }
      })
      setTransporte(newTransporte)

      // Load downtimes
      if (editingRecord.pipe_downtime && editingRecord.pipe_downtime.length > 0) {
        const downtimesData: Record<string, DowntimeEntry> = {}
        editingRecord.pipe_downtime.forEach((dt: any) => {
          const reasonKey = dt.custom_reason || dt.downtime_reasons?.reason
          if (reasonKey) {
            downtimesData[reasonKey] = {
              minutes: dt.minutes || 0,
              comments: dt.comments || "",
            }
          }
        })
        setDowntimes(downtimesData)
      } else {
        setDowntimes({})
      }

      setObservationsComments(editingRecord.observations || "")

      // Load mold breakages
      if (editingRecord.pipe_mold_breakage && editingRecord.pipe_mold_breakage.length > 0) {
        const breakagesData = editingRecord.pipe_mold_breakage.map((b: any) => ({
          size: b.diameter?.toString() || "",
          reasons: b.reasons || [],
          comments: b.comments || "",
        }))
        setMoldBreakages(breakagesData)
      } else {
        setMoldBreakages([{ size: "", reasons: [], comments: "" }])
      }
    }
  }, [editingRecord])

  // Calculate TPR (Tiempo de Producción Real) = hora fin - hora inicio - limpieza
  useEffect(() => {
    if (formData.startTime && formData.endTime) {
      const start = new Date(`2000-01-01T${formData.startTime}`)
      const end = new Date(`2000-01-01T${formData.endTime}`)
      let diff = (end.getTime() - start.getTime()) / 1000 / 60
      if (diff < 0) diff += 24 * 60
      // Restar minutos de limpieza
      const cleaningMins = Number.parseInt(formData.cleaningMinutes) || 0
      const tpr = Math.round(diff - cleaningMins)
      setTotalProductionMinutes(tpr)
    } else {
      setTotalProductionMinutes(0)
    }
  }, [formData.startTime, formData.endTime, formData.cleaningMinutes])

  // Calculate total downtimes
  useEffect(() => {
    const total = Object.values(downtimes).reduce((sum, entry) => sum + (entry.minutes || 0), 0)
    setCalculatedDowntimeTotal(total)
  }, [downtimes])

  // Calculate totals
  const calculateTotals = (data: Record<string, Record<string, string>>) => {
    const totals = { simples: 0, rotura: 0, armado: 0, rotura_armado: 0 }
    PIPE_SIZES.forEach(size => {
      totals.simples += Number(data[size]?.simples) || 0
      totals.rotura += Number(data[size]?.rotura) || 0
      totals.armado += Number(data[size]?.armado) || 0
      totals.rotura_armado += Number(data[size]?.rotura_armado) || 0
    })
    return totals
  }

  const prodTotals = calculateTotals(production)
  const transpTotals = calculateTotals(transporte)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const missingFields: string[] = []
    if (!formData.startTime) missingFields.push("Hora Inicio")
    if (!formData.endTime) missingFields.push("Hora Fin")

    if (missingFields.length > 0) {
      alert(`Debe completar los siguientes campos: ${missingFields.join(", ")}`)
      toast({
        title: "Faltan datos obligatorios",
        description: `Debe completar: ${missingFields.join(", ")}`,
        variant: "destructive",
      })
      return
    }

    // Si la fórmula fue modificada, pedir nombre y razón del cambio
    if (formulaModified && !formulaChangedBy) {
      setShowFormulaChangeDialog(true)
      return
    }

    await executeSubmit()
  }

  async function executeSubmit() {
    setLoading(true)

    try {
      const supabase = getSupabase()

      const totalDowntimeMinutes = Object.values(downtimes).reduce((sum, entry) => sum + (entry.minutes || 0), 0)

      const productionData: Record<string, any> = {
        production_date: formData.productionDate,
        shift: Number.parseInt(formData.shift),
        operators_count: Number.parseInt(formData.operatorsCount) || 3,
        start_time: formData.startTime,
        end_time: formData.endTime,
        cleaning_minutes: Number.parseInt(formData.cleaningMinutes) || null,
        tpr_minutes: Number.parseInt(formData.tprMinutes) || null,
        machine_operator: formData.operatorName || null,
        // Dosificación única (guardamos en columnas dosif_chico para compatibilidad)
        // additiveLiters ahora es litros de solución diluida por pastón
        dosif_chico_cemento_kg: Number.parseFloat(dosificacion.cement) || null,
        dosif_chico_arena_kg: Number.parseFloat(dosificacion.sand) || null,
        dosif_chico_piedra_0_10_kg: Number.parseFloat(dosificacion.stone010) || null,
        dosif_chico_piedra_0_20_kg: Number.parseFloat(dosificacion.stone020) || null,
        dosif_chico_aditivo_1_kg: (Number.parseFloat(dosificacion.additiveLiters) || 0) * 1000, // Guardamos en gramos para compatibilidad
        dosif_chico_aditivo_2_kg: null, // Ya no separamos aditivos
        dosif_chico_agua_kg: Number.parseFloat(dosificacion.water) || null,
  // Métricas
  cement_final_shift_tn: Number.parseFloat(formData.cementFinalShiftTn) || null,
  // Cajones de desperdicio por tipo
  waste_bin_1_cinta: Number.parseFloat(formData.wasteBin1Cinta) || 0,
  waste_bin_2_desmolde: Number.parseFloat(formData.wasteBin2Desmolde) || 0,
  waste_bin_3_cinta: Number.parseFloat(formData.wasteBin3Cinta) || 0,
  waste_bin_4_rotos: Number.parseFloat(formData.wasteBin4Rotos) || 0,
  waste_bin_5_mezcladora: Number.parseFloat(formData.wasteBin5Mezcladora) || 0,
  // Peso NETO del material (bruto - tara del tacho vacío)
  // Tara: C1=133.3kg, C2=127.6kg, C3=108.5kg, C4=232.5kg, C5=133.3kg
  // Neto: C1=576.7kg, C2=528.4kg, C3=601.5kg, C4=1074.5kg, C5=576.7kg
  total_waste_kg: (
    (Number.parseFloat(formData.wasteBin1Cinta) || 0) * 576.7 +
    (Number.parseFloat(formData.wasteBin2Desmolde) || 0) * 528.4 +
    (Number.parseFloat(formData.wasteBin3Cinta) || 0) * 601.5 +
    (Number.parseFloat(formData.wasteBin4Rotos) || 0) * 1074.5 +
    (Number.parseFloat(formData.wasteBin5Mezcladora) || 0) * 576.7
  ),
  total_downtime_minutes: totalDowntimeMinutes,
  observations: observationsComments || null,
  plant: selectedPlant === "villa-rosa" ? "villa-rosa" : "silke",
  // Proveedores
  supplier_cement: currentSuppliers.Cemento || null,
  supplier_sand: currentSuppliers.Arena || null,
  supplier_stone: currentSuppliers.Piedra || null,
  }

      // Agregar producción por medida
      PIPE_SIZES.forEach((size) => {
        productionData[`cc${size}_simples`] = Number.parseInt(production[size]?.simples) || null
        productionData[`cc${size}_rotura`] = Number.parseInt(production[size]?.rotura) || null
        productionData[`cc${size}_armado`] = Number.parseInt(production[size]?.armado) || null
        productionData[`cc${size}_rotura_armado`] = Number.parseInt(production[size]?.rotura_armado) || null
        // Transport columns use transport_cc prefix
        productionData[`transport_cc${size}_simples`] = Number.parseInt(transporte[size]?.simples) || null
        productionData[`transport_cc${size}_rotura`] = Number.parseInt(transporte[size]?.rotura) || null
        productionData[`transport_cc${size}_armado`] = Number.parseInt(transporte[size]?.armado) || null
        productionData[`transport_cc${size}_rotura_armado`] = Number.parseInt(transporte[size]?.rotura_armado) || null
      })

      if (editingRecord) {
        const { error: pipeError } = await supabase
          .from("pipe_production")
          .update(productionData)
          .eq("id", editingRecord.id)

        if (pipeError) throw pipeError

        // Delete old downtimes and insert new ones
        await supabase.from("pipe_downtime").delete().eq("pipe_production_id", editingRecord.id)

        for (const [reason, data] of Object.entries(downtimes)) {
          if (data.minutes > 0) {
            await supabase.from("pipe_downtime").insert({
              pipe_production_id: editingRecord.id,
              custom_reason: reason,
              minutes: data.minutes,
              comments: data.comments || null,
              downtime_category: getDowntimeCategory(reason),
            })
          }
        }

        // Delete old mold breakages and insert new ones
        await supabase.from("pipe_mold_breakage").delete().eq("pipe_production_id", editingRecord.id)

        for (const breakage of moldBreakages) {
          if (breakage.size && breakage.reasons && breakage.reasons.length > 0) {
            await supabase.from("pipe_mold_breakage").insert({
              pipe_production_id: editingRecord.id,
              diameter: breakage.size,
              reasons: breakage.reasons,
              comments: breakage.comments || null,
            })
          }
        }

        toast({ title: "Actualizado", description: "El parte de producción se actualizó correctamente" })
        if (onSaveComplete) onSaveComplete()
      } else {
        // Retry logic for network errors
        let pipeData = null
        let lastError = null
        for (let attempt = 1; attempt <= 3; attempt++) {
          const { data, error: pipeError } = await supabase
            .from("pipe_production")
            .insert(productionData)
            .select()
            .single()

          if (!pipeError) {
            pipeData = data
            break
          }
          
          lastError = pipeError
          if (pipeError.message?.includes("Failed to fetch") && attempt < 3) {
            await new Promise(r => setTimeout(r, 1000 * attempt)) // Wait 1s, 2s before retry
            continue
          }
          throw pipeError
        }
        if (!pipeData) throw lastError || new Error("No se pudo guardar")

        for (const [reason, data] of Object.entries(downtimes)) {
          if (data.minutes > 0) {
            await supabase.from("pipe_downtime").insert({
              pipe_production_id: pipeData.id,
              custom_reason: reason,
              minutes: data.minutes,
              comments: data.comments || null,
              downtime_category: getDowntimeCategory(reason),
            })
          }
        }

// Save mold breakages
        for (const breakage of moldBreakages) {
          if (breakage.size && breakage.reasons.length > 0) {
            await supabase.from("pipe_mold_breakage").insert({
              pipe_production_id: pipeData.id,
              diameter: breakage.size,
              reasons: breakage.reasons,
              comments: breakage.comments || null,
            })
          }
        }

        // Si hubo cambio de fórmula, guardar en historial
        if (formulaModified && formulaChangedBy && pastonFormula) {
          const plantValue = plantName === "Villa Rosa" ? "villa_rosa" : (plantName === "Mercedes" ? "mercedes" : "silke")
          await supabase.from("paston_formulas_history").insert({
            paston_formula_id: pastonFormula.id,
            plant: plantValue,
            previous_values: originalDosificacion,
            new_values: dosificacion,
            change_reason: formulaChangeReason || "Cambio en parte diario",
            modified_by: formulaChangedBy,
            modified_at: new Date().toISOString()
          })
        }

        localStorage.removeItem("pipeProductionForm")
        toast({ title: "Guardado", description: "El parte de produccion se guardo correctamente" })

        // Reset form and formula change state
        setFormulaChangedBy("")
        setFormulaChangeReason("")
        setFormulaModified(false)
        resetForm()
      }
    } catch (error) {
      console.error("Error submitting form:", error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo guardar el parte de producción",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  function resetForm() {
    setFormData({
      productionDate: new Date().toISOString().split("T")[0],
      shift: "1",
    operatorsCount: "4",
      startTime: "",
      endTime: "",
    cleaningMinutes: "",
    tprMinutes: "",
    operatorName: "",
  cementFinalShiftTn: "",
  wasteBin1Cinta: "",
  wasteBin2Desmolde: "",
  wasteBin3Cinta: "",
  wasteBin4Rotos: "",
  wasteBin5Mezcladora: "",
  })
    const initialProduction: Record<string, Record<string, string>> = {}
    const initialTransporte: Record<string, Record<string, string>> = {}
    PIPE_SIZES.forEach((size) => {
      initialProduction[size] = { simples: "", rotura: "", armado: "", rotura_armado: "" }
      initialTransporte[size] = { simples: "", rotura: "", armado: "", rotura_armado: "" }
    })
    setProduction(initialProduction)
    setTransporte(initialTransporte)
    setDowntimes({})
    setObservationsComments("")
    setMoldBreakages([{ size: "", reasons: [], comments: "" }])
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4" onKeyDown={(e) => {
      if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
        e.preventDefault()
        const form = formRef.current
        if (!form) return
        const current = e.target as HTMLInputElement
        const currentRect = current.getBoundingClientRect()
        const inputs = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="number"], input[type="text"]'))
        
        // Find the input below: same X position (within tolerance), greater Y position
        const tolerance = 50 // pixels tolerance for column alignment
        const inputsBelow = inputs.filter(inp => {
          const rect = inp.getBoundingClientRect()
          return Math.abs(rect.left - currentRect.left) < tolerance && rect.top > currentRect.top + 10
        }).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
        
        if (inputsBelow.length > 0) {
          inputsBelow[0].focus()
          inputsBelow[0].select()
        } else {
          // No input below, go to next input in DOM order (next column, first row)
          const currentIndex = inputs.indexOf(current)
          if (currentIndex >= 0 && currentIndex < inputs.length - 1) {
            inputs[currentIndex + 1].focus()
            inputs[currentIndex + 1].select()
          }
        }
      }
    }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold">{editingRecord ? "Editar" : "Nuevo"} Parte de Producción - Caños</h2>
          {!editingRecord && plantName === "Villa Rosa" && (
            <div className="flex items-center gap-1 rounded-lg border p-0.5 bg-muted/50">
              <Button
                type="button"
                variant={!quickMode ? "secondary" : "ghost"}
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => setQuickMode(false)}
              >
                <ListPlus className="h-3.5 w-3.5" />
                Normal
              </Button>
              <Button
                type="button"
                variant={quickMode ? "secondary" : "ghost"}
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => setQuickMode(true)}
              >
                <Zap className="h-3.5 w-3.5" />
                Rapido
              </Button>
            </div>
          )}
        </div>
        {!editingRecord && lastRecord && (
          <span className="text-xs text-muted-foreground">
            Último parte: {lastRecord.date.split("-").reverse().join("/")} - T{lastRecord.shift}
          </span>
        )}
      </div>

      {/* MODO RAPIDO - Formulario simplificado para cargas acumuladas */}
      {quickMode && plantName === "Villa Rosa" ? (
        <div className="space-y-4 rounded-lg border-2 border-primary/20 p-4 bg-primary/5">
          <p className="text-xs text-muted-foreground mb-3">Modo rapido: Solo campos esenciales para carga de partes acumulados</p>
          
          {/* Fila 1: Fecha y Horarios */}
          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Fecha <span className="text-destructive">*</span></Label>
              <Input
                type="date"
                value={formData.productionDate || ""}
                onChange={(e) => setFormData({ ...formData, productionDate: e.target.value })}
                required
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Hora Inicio</Label>
              <input
                type="time"
                value={formData.startTime || ""}
                onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Hora Fin Prod.</Label>
              <input
                type="time"
                value={formData.endTime || ""}
                onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Operarios</Label>
              <select
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                value={formData.operatorsCount || "3"}
                onChange={(e) => setFormData({ ...formData, operatorsCount: e.target.value })}
              >
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
              </select>
            </div>
          </div>

          {/* Fila 2: Produccion de Canos - Todo en una sola fila compacta */}
          <div className="space-y-2 rounded border p-2 bg-background">
            <p className="text-xs font-semibold">Canos Humedos (Produccion)</p>
            <div className="grid grid-cols-4 gap-2">
              {PIPE_SIZES.map((size) => (
                <div key={`quick-${size}`} className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">CANO {size}</Label>
                  <div className="flex gap-1">
                    <Input 
                      type="number" 
                      min="0" 
                      placeholder="1ra" 
                      className="h-7 text-xs w-full" 
                      value={production[size]?.simples ?? ""} 
                      onChange={(e) => setProduction({ ...production, [size]: { ...(production[size] || { simples: "", rotura: "", armado: "", rotura_armado: "", descartados: "" }), simples: e.target.value } })} 
                    />
                    <Input 
                      type="number" 
                      min="0" 
                      placeholder="2da" 
                      className="h-7 text-xs w-full" 
                      value={production[size]?.rotura ?? ""} 
                      onChange={(e) => setProduction({ ...production, [size]: { ...(production[size] || { simples: "", rotura: "", armado: "", rotura_armado: "", descartados: "" }), rotura: e.target.value } })} 
                    />
                    <Input 
                      type="number" 
                      min="0" 
                      placeholder="Desc" 
                      className="h-7 text-xs w-14 border-destructive/30" 
                      value={production[size]?.descartados ?? ""} 
                      onChange={(e) => setProduction({ ...production, [size]: { ...(production[size] || { simples: "", rotura: "", armado: "", rotura_armado: "", descartados: "" }), descartados: e.target.value } })} 
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Fila 3: Canos Secos - Igual de compacto */}
          <div className="space-y-2 rounded border p-2 bg-background">
            <p className="text-xs font-semibold">Canos Secos en Playa</p>
            <div className="grid grid-cols-4 gap-2">
              {PIPE_SIZES.map((size) => (
                <div key={`quick-transp-${size}`} className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">CANO {size}</Label>
                  <div className="flex gap-1">
                    <Input 
                      type="number" 
                      min="0" 
                      placeholder="1ra" 
                      className="h-7 text-xs w-full" 
                      value={transporte[size]?.simples ?? ""} 
                      onChange={(e) => setTransporte({ ...transporte, [size]: { ...(transporte[size] || { simples: "", rotura: "", armado: "", rotura_armado: "" }), simples: e.target.value } })} 
                    />
                    <Input 
                      type="number" 
                      min="0" 
                      placeholder="2da" 
                      className="h-7 text-xs w-full" 
                      value={transporte[size]?.rotura ?? ""} 
                      onChange={(e) => setTransporte({ ...transporte, [size]: { ...(transporte[size] || { simples: "", rotura: "", armado: "", rotura_armado: "" }), rotura: e.target.value } })} 
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Fila 4: Cajones de Desperdicio */}
  <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/30 p-2">
  <Label className="text-[10px] font-semibold text-amber-700">Cajones de Desperdicio (0.5 precision) - Peso Neto Material</Label>
  <div className="grid grid-cols-5 gap-2">
  <div className="space-y-1">
  <Label className="text-[10px]">C1-Cinta (577kg)</Label>
  <Input type="number" min="0" step="0.5" value={formData.wasteBin1Cinta || ""} onChange={(e) => setFormData({ ...formData, wasteBin1Cinta: e.target.value })} className="h-7 text-xs" placeholder="0" />
  </div>
  <div className="space-y-1">
  <Label className="text-[10px]">C2-Desmolde (528kg)</Label>
  <Input type="number" min="0" step="0.5" value={formData.wasteBin2Desmolde || ""} onChange={(e) => setFormData({ ...formData, wasteBin2Desmolde: e.target.value })} className="h-7 text-xs" placeholder="0" />
  </div>
  <div className="space-y-1">
  <Label className="text-[10px]">C3-Cinta (602kg)</Label>
  <Input type="number" min="0" step="0.5" value={formData.wasteBin3Cinta || ""} onChange={(e) => setFormData({ ...formData, wasteBin3Cinta: e.target.value })} className="h-7 text-xs" placeholder="0" />
  </div>
  <div className="space-y-1">
  <Label className="text-[10px]">C4-Rotos (1075kg)</Label>
  <Input type="number" min="0" step="0.5" value={formData.wasteBin4Rotos || ""} onChange={(e) => setFormData({ ...formData, wasteBin4Rotos: e.target.value })} className="h-7 text-xs" placeholder="0" />
  </div>
  <div className="space-y-1">
  <Label className="text-[10px]">C5-Mezcla (577kg)</Label>
  <Input type="number" min="0" step="0.5" value={formData.wasteBin5Mezcladora || ""} onChange={(e) => setFormData({ ...formData, wasteBin5Mezcladora: e.target.value })} className="h-7 text-xs" placeholder="0" />
  </div>
  </div>
            {/* Total desperdicio calculado - peso neto material */}
            {(Number.parseFloat(formData.wasteBin1Cinta) || Number.parseFloat(formData.wasteBin2Desmolde) || Number.parseFloat(formData.wasteBin3Cinta) || Number.parseFloat(formData.wasteBin4Rotos) || Number.parseFloat(formData.wasteBin5Mezcladora)) ? (
              <div className="text-[10px] text-amber-700 font-medium text-right">
                Total: {(
                  (Number.parseFloat(formData.wasteBin1Cinta) || 0) * 576.7 +
                  (Number.parseFloat(formData.wasteBin2Desmolde) || 0) * 528.4 +
                  (Number.parseFloat(formData.wasteBin3Cinta) || 0) * 601.5 +
                  (Number.parseFloat(formData.wasteBin4Rotos) || 0) * 1074.5 +
                  (Number.parseFloat(formData.wasteBin5Mezcladora) || 0) * 576.7
                ).toLocaleString()} kg ({(
                  (Number.parseFloat(formData.wasteBin1Cinta) || 0) +
                  (Number.parseFloat(formData.wasteBin2Desmolde) || 0) +
                  (Number.parseFloat(formData.wasteBin3Cinta) || 0) +
                  (Number.parseFloat(formData.wasteBin4Rotos) || 0) +
                  (Number.parseFloat(formData.wasteBin5Mezcladora) || 0)
                )} cajones)
              </div>
            ) : null}
          </div>

          {/* Fila 5: Extras opcionales */}
          <div className="grid grid-cols-5 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px]">Blocones</Label>
              <Input type="number" min="0" value={formData.blocones || ""} onChange={(e) => setFormData({ ...formData, blocones: e.target.value })} className="h-7 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Pastones</Label>
              <Input type="number" min="0" value={formData.cantidadPastones || ""} onChange={(e) => setFormData({ ...formData, cantidadPastones: e.target.value })} className="h-7 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Silo 1</Label>
              <Input type="number" min="0" value={formData.silo1 || ""} onChange={(e) => setFormData({ ...formData, silo1: e.target.value })} className="h-7 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Silo 2</Label>
              <Input type="number" min="0" value={formData.silo2 || ""} onChange={(e) => setFormData({ ...formData, silo2: e.target.value })} className="h-7 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">OF N°</Label>
              <Input type="text" value={formData.fabricationOrderNumber || ""} onChange={(e) => setFormData({ ...formData, fabricationOrderNumber: e.target.value })} className="h-7 text-xs" />
            </div>
          </div>

          {/* Boton Guardar */}
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={resetForm} disabled={loading}>
              Limpiar
            </Button>
            <Button type="submit" disabled={loading} className="min-w-[200px]">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar Parte Rapido
            </Button>
          </div>
        </div>
      ) : (
      <>
      {/* Fecha, Turno, Operarios */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="productionDate" className="text-xs">Fecha</Label>
          <Input
            id="productionDate"
            type="date"
            value={formData.productionDate}
            onChange={(e) => setFormData({ ...formData, productionDate: e.target.value })}
            required
            className="h-8 text-sm"
          />
        </div>
        {plantName !== "Villa Rosa" && (
          <div className="space-y-1">
            <Label htmlFor="shift" className="text-xs">Turno</Label>
            <select
              id="shift"
              className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={formData.shift}
              onChange={(e) => setFormData({ ...formData, shift: e.target.value })}
              required
            >
              <option value="1">Turno 1 (560 min)</option>
              <option value="2">Turno 2 (500 min)</option>
            </select>
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="operatorsCount" className="text-xs">Operarios</Label>
          <select
            id="operatorsCount"
            className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={formData.operatorsCount}
            onChange={(e) => setFormData({ ...formData, operatorsCount: e.target.value })}
            required
          >
            <option value="2">2 operarios</option>
            <option value="3">3 operarios</option>
            <option value="4">4 operarios</option>
            <option value="5">5 operarios</option>
          </select>
        </div>
      </div>

      {/* Horarios */}
      <div className="grid gap-3 md:grid-cols-5">
        <div className="space-y-1">
          <Label htmlFor="startTime" className="text-xs">Hora Inicio <span className="text-destructive">*</span></Label>
          <input
            id="startTime"
            type="time"
            value={formData.startTime}
            onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
            required
            className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ WebkitAppearance: 'none' }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="endTime" className="text-xs">
            {plantName === "Villa Rosa" ? "Hora Fin Produccion" : "Hora Fin"} <span className="text-destructive">*</span>
          </Label>
          <input
            id="endTime"
            type="time"
            value={formData.endTime}
            onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
            required
            className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ WebkitAppearance: 'none' }}
          />
        </div>
        {plantName === "Villa Rosa" && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Hora Fin Turno</Label>
            <div className="flex h-8 items-center rounded-md border border-input bg-muted px-2 text-sm">
              16:00
            </div>
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="cleaningMinutes" className="text-xs">{plantName === "Villa Rosa" ? "Limpieza/Acomodo (min)" : "Limpieza (min)"}</Label>
          <Input
            id="cleaningMinutes"
            type="number"
            min="0"
            value={formData.cleaningMinutes}
            onChange={(e) => setFormData({ ...formData, cleaningMinutes: e.target.value })}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tprMinutes" className="text-xs">T.P.R. (min)</Label>
          <Input
            id="tprMinutes"
            type="number"
            min="0"
            value={formData.tprMinutes}
            onChange={(e) => setFormData({ ...formData, tprMinutes: e.target.value })}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">TPR Calculado</Label>
          <div className="flex h-8 items-center rounded-md border border-input bg-muted px-2 text-sm font-semibold text-primary">
            {totalProductionMinutes} min
          </div>
        </div>
      </div>

      {/* Nombre Operarios */}
      <div className="space-y-1">
        <Label htmlFor="operatorName" className="text-xs">Nombre y Apellido de Operarios</Label>
        <Input
          id="operatorName"
          type="text"
          value={formData.operatorName}
          onChange={(e) => setFormData({ ...formData, operatorName: e.target.value })}
          className="h-8 text-sm"
        />
      </div>

      {/* Dosificación única - cargada desde Formuleo */}
      <div className="space-y-2 rounded-lg border border-border p-2 bg-muted/30">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            {plantName === "Villa Rosa" ? "Produccion (Consumo por Paston)" : "Dosificacion (desde Formuleo)"}
          </h3>
          {pastonFormula?.modified_at && (
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>Ultima modificacion: {new Date(pastonFormula.modified_at).toLocaleDateString("es-AR")} por {pastonFormula.modified_by}</span>
              {formulaModified && (
                <span className="text-amber-600 font-medium">(Modificado en este parte)</span>
              )}
            </div>
          )}
        </div>
        {plantName === "Villa Rosa" && (
          <p className="text-[10px] text-muted-foreground">Valores predeterminados: Cemento 160kg, Arena 178kg, Piedra 0/10 1160kg, Aditivo 500g diluido en 1000ml</p>
        )}
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px]">Cemento (kg)</Label>
            <Input type="number" step="0.01" min="0" value={dosificacion.cement || ""} onChange={(e) => setDosificacion({ ...dosificacion, cement: e.target.value })} className="h-7 text-xs" placeholder={plantName === "Villa Rosa" ? "160" : ""} />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Arena (kg)</Label>
            <Input type="number" step="0.01" min="0" value={dosificacion.sand || ""} onChange={(e) => setDosificacion({ ...dosificacion, sand: e.target.value })} className="h-7 text-xs" placeholder={plantName === "Villa Rosa" ? "178" : ""} />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Piedra 0-10 (kg)</Label>
            <Input type="number" step="0.01" min="0" value={dosificacion.stone010 || ""} onChange={(e) => setDosificacion({ ...dosificacion, stone010: e.target.value })} className="h-7 text-xs" placeholder={plantName === "Villa Rosa" ? "1160" : ""} />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Piedra 0-20 (kg)</Label>
            <Input type="number" step="0.01" min="0" value={dosificacion.stone020 || ""} onChange={(e) => setDosificacion({ ...dosificacion, stone020: e.target.value })} className="h-7 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Lts Solucion Aditivo x Paston</Label>
            <Input type="number" step="0.01" min="0" value={dosificacion.additiveLiters || ""} onChange={(e) => setDosificacion({ ...dosificacion, additiveLiters: e.target.value })} className="h-7 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Agua (lts)</Label>
            <Input type="number" step="0.01" min="0" value={dosificacion.water || ""} onChange={(e) => setDosificacion({ ...dosificacion, water: e.target.value })} className="h-7 text-xs" />
          </div>
        </div>
      </div>

      {/* Proveedores */}
      {Object.keys(ingredientSuppliers).length > 0 && (
        <div className="space-y-2 rounded-lg border border-border p-2 bg-muted/30">
          <h3 className="text-sm font-semibold text-foreground">Proveedores</h3>
          <div className="grid grid-cols-3 gap-3">
            {["Cemento", "Arena", "Piedra"].map((ingredient) => (
              <div key={ingredient} className="space-y-1">
                <Label className="text-xs">{ingredient}</Label>
                <Select
                  value={currentSuppliers[ingredient] || ""}
                  onValueChange={(value) => setCurrentSuppliers(prev => ({ ...prev, [ingredient]: value }))}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder={`Seleccionar ${ingredient.toLowerCase()}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {(ingredientSuppliers[ingredient] || []).map((supplier) => (
                      <SelectItem key={supplier} value={supplier} className="text-xs">
                        {supplier}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Producción y Transporte side by side */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Producción - Caños Húmedos */}
        <div className="space-y-2 rounded-lg border border-border p-2 bg-muted/30">
          <h3 className="text-sm font-semibold text-foreground">
            {plantName === "Villa Rosa" ? "Canos Humedos (Produccion)" : "Produccion"}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-1">{plantName === "Villa Rosa" ? "Producto" : "Medida"}</th>
                  <th className="text-center p-1">{plantName === "Villa Rosa" ? "1ra" : "Simples"}</th>
                  <th className="text-center p-1">{plantName === "Villa Rosa" ? "2da" : "Rotura"}</th>
                  {plantName === "Villa Rosa" && <th className="text-center p-1 text-destructive">Desc.</th>}
                  {plantName !== "Villa Rosa" && (
                    <>
                      <th className="text-center p-1">Armado</th>
                      <th className="text-center p-1">Rotura</th>
                    </>
                  )}
                  {plantName === "Villa Rosa" && <th className="text-center p-1 bg-muted">Total</th>}
                </tr>
              </thead>
              <tbody>
                {PIPE_SIZES.map((size) => (
                  <tr key={`prod-${size}`} className="border-b">
                    <td className="p-1 font-medium">{plantName === "Villa Rosa" ? `CANO ${size}` : `Ø ${size} mm`}</td>
                    <td className="p-1"><Input type="number" min="0" className="h-7 text-xs w-14" value={production[size]?.simples ?? ""} onChange={(e) => setProduction({ ...production, [size]: { ...(production[size] || { simples: "", rotura: "", armado: "", rotura_armado: "", descartados: "" }), simples: e.target.value } })} /></td>
                    <td className="p-1"><Input type="number" min="0" className="h-7 text-xs w-14" value={production[size]?.rotura ?? ""} onChange={(e) => setProduction({ ...production, [size]: { ...(production[size] || { simples: "", rotura: "", armado: "", rotura_armado: "", descartados: "" }), rotura: e.target.value } })} /></td>
                    {plantName === "Villa Rosa" && (
                      <td className="p-1"><Input type="number" min="0" className="h-7 text-xs w-14 border-destructive/50" value={production[size]?.descartados ?? ""} onChange={(e) => setProduction({ ...production, [size]: { ...(production[size] || { simples: "", rotura: "", armado: "", rotura_armado: "", descartados: "" }), descartados: e.target.value } })} /></td>
                    )}
                    {plantName !== "Villa Rosa" && (
                      <>
                        <td className="p-1"><Input type="number" min="0" className="h-7 text-xs w-14" value={production[size]?.armado ?? ""} onChange={(e) => setProduction({ ...production, [size]: { ...(production[size] || { simples: "", rotura: "", armado: "", rotura_armado: "", descartados: "" }), armado: e.target.value } })} /></td>
                        <td className="p-1"><Input type="number" min="0" className="h-7 text-xs w-14" value={production[size]?.rotura_armado ?? ""} onChange={(e) => setProduction({ ...production, [size]: { ...(production[size] || { simples: "", rotura: "", armado: "", rotura_armado: "", descartados: "" }), rotura_armado: e.target.value } })} /></td>
                      </>
                    )}
                    {plantName === "Villa Rosa" && (
                      <td className="p-1 text-center bg-muted font-medium">
                        {(Number(production[size]?.simples || 0) + Number(production[size]?.rotura || 0))}
                      </td>
                    )}
                  </tr>
                ))}
                <tr className="bg-muted font-semibold">
                  <td className="p-1">TOTAL</td>
                  <td className="p-1 text-center">{prodTotals.simples}</td>
                  <td className="p-1 text-center">{prodTotals.rotura}</td>
                  {plantName === "Villa Rosa" && (
                    <td className="p-1 text-center text-destructive">{PIPE_SIZES.reduce((sum, s) => sum + Number(production[s]?.descartados || 0), 0)}</td>
                  )}
                  {plantName !== "Villa Rosa" && (
                    <>
                      <td className="p-1 text-center">{prodTotals.armado}</td>
                      <td className="p-1 text-center">{prodTotals.rotura_armado}</td>
                    </>
                  )}
                  {plantName === "Villa Rosa" && (
                    <td className="p-1 text-center">{prodTotals.simples + prodTotals.rotura}</td>
                  )}
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Transporte a Playa - Caños Secos */}
        <div className="space-y-2 rounded-lg border border-border p-2 bg-muted/30">
          <h3 className="text-sm font-semibold text-foreground">
            {plantName === "Villa Rosa" ? "Canos Secos en Playa" : "Transporte a Playa"}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-1">{plantName === "Villa Rosa" ? "Producto" : "Medida"}</th>
                  <th className="text-center p-1">{plantName === "Villa Rosa" ? "1ra" : "Simples"}</th>
                  <th className="text-center p-1">{plantName === "Villa Rosa" ? "2da" : "Rotura"}</th>
                  {plantName !== "Villa Rosa" && (
                    <>
                      <th className="text-center p-1">Armado</th>
                      <th className="text-center p-1">Rotura</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {PIPE_SIZES.map((size) => (
                  <tr key={`transp-${size}`} className="border-b">
                    <td className="p-1 font-medium">{plantName === "Villa Rosa" ? `CANO ${size}` : `Ø ${size} mm`}</td>
                    <td className="p-1"><Input type="number" min="0" className="h-7 text-xs w-14" value={transporte[size]?.simples ?? ""} onChange={(e) => setTransporte({ ...transporte, [size]: { ...(transporte[size] || { simples: "", rotura: "", armado: "", rotura_armado: "" }), simples: e.target.value } })} /></td>
                    <td className="p-1"><Input type="number" min="0" className="h-7 text-xs w-14" value={transporte[size]?.rotura ?? ""} onChange={(e) => setTransporte({ ...transporte, [size]: { ...(transporte[size] || { simples: "", rotura: "", armado: "", rotura_armado: "" }), rotura: e.target.value } })} /></td>
                    {plantName !== "Villa Rosa" && (
                      <>
                        <td className="p-1"><Input type="number" min="0" className="h-7 text-xs w-14" value={transporte[size]?.armado ?? ""} onChange={(e) => setTransporte({ ...transporte, [size]: { ...(transporte[size] || { simples: "", rotura: "", armado: "", rotura_armado: "" }), armado: e.target.value } })} /></td>
                        <td className="p-1"><Input type="number" min="0" className="h-7 text-xs w-14" value={transporte[size]?.rotura_armado ?? ""} onChange={(e) => setTransporte({ ...transporte, [size]: { ...(transporte[size] || { simples: "", rotura: "", armado: "", rotura_armado: "" }), rotura_armado: e.target.value } })} /></td>
                      </>
                    )}
                  </tr>
                ))}
                <tr className="bg-muted font-semibold">
                  <td className="p-1">TOTAL</td>
                  <td className="p-1 text-center">{transpTotals.simples}</td>
                  <td className="p-1 text-center">{transpTotals.rotura}</td>
                  {plantName !== "Villa Rosa" && (
                    <>
                      <td className="p-1 text-center">{transpTotals.armado}</td>
                      <td className="p-1 text-center">{transpTotals.rotura_armado}</td>
                    </>
                  )}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Cemento al Finalizar */}
      <div className="space-y-1">
        <Label htmlFor="cementFinalShiftTn" className="text-xs">Cemento al Finalizar el Turno (Tn)</Label>
        <Input
          id="cementFinalShiftTn"
          type="number"
          step="0.01"
          min="0"
          value={formData.cementFinalShiftTn}
          onChange={(e) => setFormData({ ...formData, cementFinalShiftTn: e.target.value })}
          className="h-8 text-sm w-48"
        />
      </div>

      {/* Cajones de Desperdicio */}
      <div className="space-y-3 rounded-lg border-2 border-amber-300 bg-amber-50/50 p-4">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold text-amber-800">Cajones de Desperdicio</Label>
          <span className="text-xs text-amber-600">Precisión: 0.5 cajones</span>
        </div>
        <div className="grid grid-cols-5 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-amber-700">C1 - Cinta</Label>
            <Input
              type="number"
              min="0"
              step="0.5"
              value={formData.wasteBin1Cinta}
              onChange={(e) => setFormData({ ...formData, wasteBin1Cinta: e.target.value })}
              className="h-8 text-sm"
              placeholder="0"
            />
            <span className="text-[10px] text-muted-foreground">710 kg/cajón</span>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-amber-700">C2 - Desmolde</Label>
            <Input
              type="number"
              min="0"
              step="0.5"
              value={formData.wasteBin2Desmolde}
              onChange={(e) => setFormData({ ...formData, wasteBin2Desmolde: e.target.value })}
              className="h-8 text-sm"
              placeholder="0"
            />
            <span className="text-[10px] text-muted-foreground">656 kg/cajón</span>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-amber-700">C3 - Cinta</Label>
            <Input
              type="number"
              min="0"
              step="0.5"
              value={formData.wasteBin3Cinta}
              onChange={(e) => setFormData({ ...formData, wasteBin3Cinta: e.target.value })}
              className="h-8 text-sm"
              placeholder="0"
            />
            <span className="text-[10px] text-muted-foreground">710 kg/cajón</span>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-amber-700">C4 - Caños Rotos</Label>
            <Input
              type="number"
              min="0"
              step="0.5"
              value={formData.wasteBin4Rotos}
              onChange={(e) => setFormData({ ...formData, wasteBin4Rotos: e.target.value })}
              className="h-8 text-sm"
              placeholder="0"
            />
            <span className="text-[10px] text-muted-foreground">1307 kg/cajón</span>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-amber-700">C5 - Mezcladora</Label>
            <Input
              type="number"
              min="0"
              step="0.5"
              value={formData.wasteBin5Mezcladora}
              onChange={(e) => setFormData({ ...formData, wasteBin5Mezcladora: e.target.value })}
              className="h-8 text-sm"
              placeholder="0"
            />
            <span className="text-[10px] text-muted-foreground">710 kg/cajón</span>
          </div>
        </div>
        {/* Total calculado */}
        <div className="flex justify-between items-center pt-2 border-t border-amber-200">
          <span className="text-sm text-amber-700">Total Desperdicio:</span>
          <span className="text-lg font-bold text-amber-800">
            {(
              (Number.parseFloat(formData.wasteBin1Cinta) || 0) * 710 +
              (Number.parseFloat(formData.wasteBin2Desmolde) || 0) * 656 +
              (Number.parseFloat(formData.wasteBin3Cinta) || 0) * 710 +
              (Number.parseFloat(formData.wasteBin4Rotos) || 0) * 1307 +
              (Number.parseFloat(formData.wasteBin5Mezcladora) || 0) * 710
            ).toLocaleString()} kg
          </span>
        </div>
      </div>

      {/* Extras Villa Rosa */}
      <div className="grid grid-cols-2 gap-4">
        {plantName === "Villa Rosa" && (
          <>
            <div className="space-y-1">
              <Label htmlFor="blocones" className="text-xs">Cantidad de Blocones</Label>
              <Input
                id="blocones"
                type="number"
                min="0"
                value={formData.blocones}
                onChange={(e) => setFormData({ ...formData, blocones: e.target.value })}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cantidadPastones" className="text-xs">Cantidad de Pastones</Label>
              <Input
                id="cantidadPastones"
                type="number"
                min="0"
                value={formData.cantidadPastones}
                onChange={(e) => setFormData({ ...formData, cantidadPastones: e.target.value })}
                className="h-8 text-sm"
              />
            </div>
          </>
        )}
      </div>

      {/* Control Cemento - Solo Villa Rosa */}
      {plantName === "Villa Rosa" && (
        <div className="space-y-2 rounded-lg border border-border p-3 bg-muted/30">
          <h3 className="text-sm font-semibold text-foreground">Control Cemento</h3>
          <div className="grid grid-cols-4 gap-4">
            <div className="space-y-1">
              <Label htmlFor="silo1" className="text-xs">Silo 1</Label>
              <Input
                id="silo1"
                type="number"
                min="0"
                value={formData.silo1}
                onChange={(e) => setFormData({ ...formData, silo1: e.target.value })}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="silo2" className="text-xs">Silo 2</Label>
              <Input
                id="silo2"
                type="number"
                min="0"
                value={formData.silo2}
                onChange={(e) => setFormData({ ...formData, silo2: e.target.value })}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="totalPastones" className="text-xs">Total de Pastones</Label>
              <Input
                id="totalPastones"
                type="number"
                min="0"
                value={formData.totalPastones}
                onChange={(e) => setFormData({ ...formData, totalPastones: e.target.value })}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fabricationOrderNumber" className="text-xs">OF (Orden Fabric.) N°</Label>
              <Input
                id="fabricationOrderNumber"
                type="text"
                value={formData.fabricationOrderNumber}
                onChange={(e) => setFormData({ ...formData, fabricationOrderNumber: e.target.value })}
                className="h-8 text-sm"
              />
            </div>
          </div>
        </div>
      )}

      {/* Rotura de Molde */}
      <div className="rounded-lg border p-3 bg-muted/30 space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">Rotura de Molde</Label>
          {moldBreakages.length === 0 && (
            <Button type="button" variant="outline" size="sm" onClick={addMoldBreakage} className="bg-transparent text-xs h-7">
              + Registrar Rotura
            </Button>
          )}
        </div>

        {moldBreakages.map((breakage, index) => (
          <div key={index} className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={breakage.size}
                onChange={(e) => updateMoldBreakage(index, "size", e.target.value)}
                className="h-8 w-28 rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="">Diámetro...</option>
                {PIPE_SIZES.map((size) => (
                  <option key={size} value={size}>CC {size}</option>
                ))}
              </select>

              {breakage.size && (
                <>
                  {MOLD_BREAKAGE_REASONS.map((reason) => (
                    <label key={reason} className="flex items-center gap-1 text-xs cursor-pointer whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={breakage.reasons.includes(reason)}
                        onChange={() => toggleMoldBreakageReason(index, reason)}
                        className="h-3.5 w-3.5 rounded border-gray-300"
                      />
                      {reason}
                    </label>
                  ))}
                </>
              )}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeMoldBreakage(index)}
                className="text-destructive hover:text-destructive h-7 px-2 ml-auto"
              >
                X
              </Button>
            </div>

            {breakage.size && breakage.reasons.length > 0 && (
              <Textarea
                placeholder="Comentarios sobre la rotura..."
                value={breakage.comments}
                onChange={(e) => updateMoldBreakage(index, "comments", e.target.value)}
                className="min-h-[50px] text-xs"
              />
            )}

            {breakage.size && breakage.reasons.length > 0 && index === moldBreakages.length - 1 && (
              <Button type="button" variant="outline" size="sm" onClick={addMoldBreakage} className="bg-transparent text-xs h-7">
                + Otra Rotura
              </Button>
            )}
          </div>
        ))}
      </div>

      {/* Motivos de Paradas - igual que bloques */}
      <div className="space-y-2 rounded-lg border-2 border-border p-3 bg-background">
        <div className="border-b pb-2">
          <h2 className="text-lg font-bold text-foreground">Motivos de Paradas</h2>
        </div>

        {Object.entries(plantName === "Villa Rosa" ? VILLA_ROSA_DOWNTIME_CATEGORIES : DOWNTIME_CATEGORIES).map(([category, reasons]) => {
          const itemsPerColumn = Math.ceil(reasons.length / 2)
          const column1 = reasons.slice(0, itemsPerColumn)
          const column2 = reasons.slice(itemsPerColumn)

          return (
            <div key={category} className="space-y-2">
              <h4 className="text-base font-semibold text-primary bg-primary/10 px-3 py-2 rounded-md">{category}</h4>
              <div className="grid md:grid-cols-2 gap-x-4 gap-y-2">
                <div className="space-y-2">
                  {column1.map((reason) => (
                    <div key={reason} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`downtime-${reason}`} className="text-xs flex-1">{reason}</Label>
                        <Input
                          id={`downtime-${reason}`}
                          type="number"
                          min="0"
                          placeholder="min"
                          value={downtimes[reason]?.minutes?.toString() || ""}
                          onChange={(e) => {
                            const value = e.target.value
                            const minutes = value === "" ? 0 : Number.parseInt(value) || 0
                            setDowntimes((prev) => ({
                              ...prev,
                              [reason]: { minutes, comments: prev[reason]?.comments || "" },
                            }))
                          }}
                          onKeyDown={handleEnterKey}
                          className="h-8 w-16 text-sm"
                        />
                      </div>
                      {downtimes[reason]?.minutes > 0 && (
                        <Textarea
                          placeholder="Observaciones..."
                          value={downtimes[reason]?.comments || ""}
                          onChange={(e) => {
                            setDowntimes((prev) => ({
                              ...prev,
                              [reason]: { ...prev[reason], comments: e.target.value },
                            }))
                          }}
                          className="text-xs min-h-[60px]"
                        />
                      )}
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  {column2.map((reason) => (
                    <div key={reason} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`downtime-${reason}`} className="text-xs flex-1">{reason}</Label>
                        <Input
                          id={`downtime-${reason}`}
                          type="number"
                          min="0"
                          placeholder="min"
                          value={downtimes[reason]?.minutes?.toString() || ""}
                          onChange={(e) => {
                            const value = e.target.value
                            const minutes = value === "" ? 0 : Number.parseInt(value) || 0
                            setDowntimes((prev) => ({
                              ...prev,
                              [reason]: { minutes, comments: prev[reason]?.comments || "" },
                            }))
                          }}
                          onKeyDown={handleEnterKey}
                          className="h-8 w-16 text-sm"
                        />
                      </div>
                      {downtimes[reason]?.minutes > 0 && (
                        <Textarea
                          placeholder="Observaciones..."
                          value={downtimes[reason]?.comments || ""}
                          onChange={(e) => {
                            setDowntimes((prev) => ({
                              ...prev,
                              [reason]: { ...prev[reason], comments: e.target.value },
                            }))
                          }}
                          className="text-xs min-h-[60px]"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Total de Paradas */}
      <div className="rounded-lg border-2 border-primary bg-primary/5 p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">Total de Minutos de Paradas:</span>
          <span className="text-2xl font-bold text-primary">{calculatedDowntimeTotal} min</span>
        </div>
      </div>

      {/* Observaciones */}
      <div className="space-y-2">
        <Label htmlFor="observations" className="text-sm font-semibold">Observaciones</Label>
        <Textarea
          id="observations"
          placeholder="Observaciones generales..."
          value={observationsComments}
          onChange={(e) => setObservationsComments(e.target.value)}
          className="min-h-[80px]"
        />
      </div>

      {/* Botones */}
      <div className="flex justify-end gap-3 pt-4">
        {!editingRecord && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (confirm("¿Está seguro que desea descartar todos los datos cargados?")) {
                resetForm()
                localStorage.removeItem("pipeProductionForm")
                toast({ title: "Datos descartados", description: "Todos los datos del formulario han sido eliminados" })
              }
            }}
            className="min-w-[200px] bg-transparent"
          >
            Descartar Producción
          </Button>
        )}
        <Button type="submit" disabled={loading} className="min-w-[200px]">
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {editingRecord ? "Actualizar Producción" : "Guardar Producción"}
        </Button>
      </div>
      </>
      )}

      {/* Dialogo de cambio de formula */}
      <Dialog open={showFormulaChangeDialog} onOpenChange={setShowFormulaChangeDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Cambio de Formula Detectado
            </DialogTitle>
            <DialogDescription>
              Los valores de dosificacion fueron modificados respecto a la formula cargada en Formuleo. 
              Por favor ingrese quien realiza el cambio y el motivo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="formulaChangedBy">Nombre de quien modifica *</Label>
              <Input
                id="formulaChangedBy"
                value={formulaChangedBy}
                onChange={(e) => setFormulaChangedBy(e.target.value)}
                placeholder="Ej: Juan Perez"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="formulaChangeReason">Motivo del cambio</Label>
              <Textarea
                id="formulaChangeReason"
                value={formulaChangeReason}
                onChange={(e) => setFormulaChangeReason(e.target.value)}
                placeholder="Ej: Ajuste por humedad de aridos..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button 
              variant="outline" 
              onClick={() => {
                setShowFormulaChangeDialog(false)
                // Restaurar valores originales
                setDosificacion({ ...originalDosificacion })
                setFormulaModified(false)
              }}
            >
              Cancelar y Restaurar
            </Button>
            <Button 
              onClick={() => {
                if (!formulaChangedBy.trim()) {
                  toast({ title: "Requerido", description: "Debe ingresar el nombre de quien modifica", variant: "destructive" })
                  return
                }
                setShowFormulaChangeDialog(false)
                executeSubmit()
              }}
              disabled={!formulaChangedBy.trim()}
            >
              Confirmar y Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  )
}
