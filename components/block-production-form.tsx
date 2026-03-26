"use client"

import type React from "react"
import { useState, useEffect, useRef, useCallback, type KeyboardEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { getSupabase } from "@/lib/supabase"
import { Loader2 } from "lucide-react"

interface DowntimeEntry {
  minutes: number
  comments: string
  forkliftModel?: string
}

const DOWNTIME_CATEGORIES = {
  "Factores Externos": ["Energía Eléctrica", "Piedra en Materia Prima"].sort(),
  "Paradas Planificadas": [
    "Cambio de Producto",
    "Capacitación",
    "Mantenimiento",
    "Mant. Aut (Limp, Lub. Y Ajustes)",
    "Pruebas y/o Ensayos varios",
    "Puesta a punto (set up)",
    "Reuniones",
  ].sort(),
  "Fallas de Equipo (Paradas Mayores a 5 min.)": [
    "Ascensor",
    "Autoelevador",
    "Balanza de áridos",
    "Balanza de cemento",
    "Bomba de agua pozo",
    "Cangilón ( skyp)",
    "Cargador (cajón)",
    "Cinta transp.áridos",
    "Descensor",
    "Bloquera",
    "Dosificador aditivos",
    "Gira tablas",
    "Mesa avanza retrocede",
    "Mesa retorna tabla",
    "Mesa vibración",
    "Mezcladora",
    "Molde-Zapata",
    "Paletizadora",
    "Sinfín cemento",
    "Sistema de agua",
    "Sistema de aire",
    "Sistema de vibración",
    "Tablero eléctrico mezcladora",
    "Tablero eléctrico principal",
    "Tolva bloquera",
    "Tolva de áridos",
    "Transportador frontal",
    "Tranportador retorna teblas cassetera",
    "Otros",
  ].sort(),
  "Fallas de Proceso": [
    "Arranques y ajustes en moldeadora",
    "Calidad de producto",
    "Operario en capacitación",
    "Problema calidad de hormigón",
    "Problema con calidad de materia prima",
  ].sort(),
  "Fallas de Gestión": [
    "Espera de insumos",
    "Espera de instrucciones",
    "Espera de materia prima",
    "Factores humanos",
  ].sort(),
  "Falla Logística": ["Logística interna"],
}

function getDowntimeCategory(reason: string): string {
  for (const category in DOWNTIME_CATEGORIES) {
    if (DOWNTIME_CATEGORIES[category].includes(reason)) {
      return category
    }
  }
  return "Otro"
}

interface BlockProductionFormProps {
  editingRecord?: any | null
  onSaveComplete?: () => void
}

export function BlockProductionForm({ editingRecord = null, onSaveComplete }: BlockProductionFormProps) {
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
  const [calculatedTables, setCalculatedTables] = useState<number>(0)
  const [lastRecord, setLastRecord] = useState<{ date: string; shift: number } | null>(null)

  const [formData, setFormData] = useState({
    productionDate: new Date().toISOString().split("T")[0],
    shift: "1",
    startTime: "05:00",
    endTime: "16:00",
    cleaningMinutes: "",
    productType: "",
    pallets: "",
    theoreticalUnits: "",
    realUnits: "",
    scrapUnits: "",
    scrapPercentage: 0,
    racksToCamera: "",
    productionUnits: "",
    cementKg: "",
    sandKg: "",
    stone010Kg: "",
    waterKg: "",
    additive1Kg: "",
    additive2Kg: "",
    machineOperator: "",
    internalDriver: "",
    palletizer1: "",
    palletizer2: "",
    cementFinalShiftTn: "",
    totalDowntimeMinutes: 0,
    emptyTables: "",
  })

  const [downtimes, setDowntimes] = useState<Record<string, DowntimeEntry>>({})
  const [observationsComments, setObservationsComments] = useState("")

  const [forkliftModels, setForkliftModels] = useState<string[]>(["Yale 1", "Heli"])
  const [newForkliftModel, setNewForkliftModel] = useState("")
  const [showAddForklift, setShowAddForklift] = useState(false)

  // Cargar el último parte cargado
  useEffect(() => {
    if (!editingRecord) {
      const loadLastRecord = async () => {
        const supabase = getSupabase()
        const { data } = await supabase
          .from("block_production")
          .select("production_date, shift")
          .order("production_date", { ascending: false })
          .order("shift", { ascending: false })
          .limit(1)
        
        if (data && data.length > 0) {
          setLastRecord({ date: data[0].production_date, shift: data[0].shift })
        }
      }
      loadLastRecord()
    }
  }, [editingRecord])

  // Cargar horarios del último parte del mismo turno
  useEffect(() => {
    if (!editingRecord) {
      const loadLastShiftTimes = async () => {
        const supabase = getSupabase()
        const { data } = await supabase
          .from("block_production")
          .select("start_time, end_time")
          .eq("shift", Number.parseInt(formData.shift))
          .order("created_at", { ascending: false })
          .limit(1)
        
        if (data && data.length > 0 && data[0].start_time && data[0].end_time) {
          setFormData(prev => ({
            ...prev,
            startTime: data[0].start_time,
            endTime: data[0].end_time,
          }))
        }
      }
      loadLastShiftTimes()
    }
  }, [editingRecord, formData.shift])

  useEffect(() => {
    const savedData = localStorage.getItem("blockProductionForm")
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData)
        if (parsed.formData) {
          setFormData({
            productionDate: parsed.formData.productionDate || new Date().toISOString().split("T")[0],
            shift: parsed.formData.shift || "1",
            startTime: parsed.formData.startTime || "05:00",
            endTime: parsed.formData.endTime || "16:00",
            cleaningMinutes: parsed.formData.cleaningMinutes || "",
            productType: parsed.formData.productType || "",
            pallets: parsed.formData.pallets || "",
            theoreticalUnits: parsed.formData.theoreticalUnits || "",
            realUnits: parsed.formData.realUnits || "",
            scrapUnits: parsed.formData.scrapUnits || "",
            scrapPercentage: parsed.formData.scrapPercentage || 0,
            racksToCamera: parsed.formData.racksToCamera || "",
            productionUnits: parsed.formData.productionUnits || "",
            cementKg: parsed.formData.cementKg || "",
            sandKg: parsed.formData.sandKg || "",
            stone010Kg: parsed.formData.stone010Kg || "",
            waterKg: parsed.formData.waterKg || "",
            additive1Kg: parsed.formData.additive1Kg || "",
            additive2Kg: parsed.formData.additive2Kg || "",
            machineOperator: parsed.formData.machineOperator || "",
            internalDriver: parsed.formData.internalDriver || "",
            palletizer1: parsed.formData.palletizer1 || "",
            palletizer2: parsed.formData.palletizer2 || "",
            cementFinalShiftTn: parsed.formData.cementFinalShiftTn || "",
            totalDowntimeMinutes: parsed.formData.totalDowntimeMinutes || 0,
            emptyTables: parsed.formData.emptyTables || "",
          })
        }
        if (parsed.downtimes) {
          setDowntimes(parsed.downtimes)
        }
        if (parsed.observationsComments !== undefined) {
          setObservationsComments(parsed.observationsComments)
        }
      } catch (error) {
        console.error("Error loading saved form data:", error)
      }
    }
  }, [])

  useEffect(() => {
    localStorage.setItem("blockProductionForm", JSON.stringify({ formData, downtimes, observationsComments }))
  }, [formData, downtimes, observationsComments])

  useEffect(() => {
    if (editingRecord) {
      console.log("[v0] Loading editing record:", editingRecord)
      console.log("[v0] Downtimes in record:", editingRecord.block_downtime)

      const productionDate = editingRecord.production_date.includes("T")
        ? editingRecord.production_date.split("T")[0]
        : editingRecord.production_date

      setFormData({
        productionDate: productionDate,
        shift: editingRecord.shift?.toString() || "1",
        startTime: editingRecord.start_time || "",
        endTime: editingRecord.end_time || "",
        cleaningMinutes: editingRecord.cleaning_minutes?.toString() || "",
        productType: editingRecord.product_type || "",
        pallets: editingRecord.pallets?.toString() || "",
        theoreticalUnits: editingRecord.theoretical_units?.toString() || "",
        realUnits: editingRecord.real_units?.toString() || "",
        scrapUnits: editingRecord.scrap_units?.toString() || "",
        scrapPercentage: editingRecord.scrap_percentage || 0,
        racksToCamera: editingRecord.racks_to_camera?.toString() || "",
        productionUnits: editingRecord.production_units?.toString() || "",
        cementKg: editingRecord.cement_kg?.toString() || "",
        sandKg: editingRecord.sand_kg?.toString() || "",
        stone010Kg: editingRecord.stone_0_10_kg?.toString() || "",
        waterKg: editingRecord.water_kg?.toString() || "",
        additive1Kg: editingRecord.additive_1_kg?.toString() || "",
        additive2Kg: editingRecord.additive_2_kg?.toString() || "",
        machineOperator: editingRecord.machine_operator || "",
        internalDriver: editingRecord.internal_driver || "",
        palletizer1: editingRecord.palletizer_1 || "",
        palletizer2: editingRecord.palletizer_2 || "",
        cementFinalShiftTn: editingRecord.cement_final_shift_tn?.toString() || "",
        totalDowntimeMinutes: 0,
        emptyTables: editingRecord.empty_tables?.toString() || "",
      })

      if (editingRecord.block_downtime && editingRecord.block_downtime.length > 0) {
        const downtimesData: Record<string, DowntimeEntry> = {}
        editingRecord.block_downtime.forEach((dt: any) => {
          const reasonKey = dt.custom_reason || dt.downtime_reasons?.reason
          if (reasonKey) {
            downtimesData[reasonKey] = {
              minutes: dt.minutes || 0,
              comments: dt.comments || "",
              forkliftModel: dt.forklift_model || "",
            }
          }
        })
        console.log("[v0] Loaded downtimes:", downtimesData)
        setDowntimes(downtimesData)
      } else {
        console.log("[v0] No downtimes found, clearing state")
        setDowntimes({})
      }

      if (editingRecord.observations) {
        setObservationsComments(editingRecord.observations)
      } else {
        setObservationsComments("")
      }
    }
  }, [editingRecord])

  useEffect(() => {
    if (formData.startTime && formData.endTime) {
      const start = new Date(`2000-01-01T${formData.startTime}`)
      const end = new Date(`2000-01-01T${formData.endTime}`)
      let diff = (end.getTime() - start.getTime()) / 1000 / 60

      if (diff < 0) {
        diff += 24 * 60
      }

      setTotalProductionMinutes(Math.round(diff))
    } else {
      setTotalProductionMinutes(0)
    }
  }, [formData.startTime, formData.endTime])

  useEffect(() => {
    const theoretical = Number.parseFloat(formData.theoreticalUnits) || 0
    const scrap = Number.parseFloat(formData.scrapUnits) || 0

    if (theoretical > 0) {
      const percentage = (scrap / theoretical) * 100
      setFormData((prev) => ({ ...prev, scrapPercentage: Math.round(percentage * 100) / 100 }))
    } else {
      setFormData((prev) => ({ ...prev, scrapPercentage: 0 }))
    }
  }, [formData.scrapUnits, formData.theoreticalUnits])

  useEffect(() => {
    const total = Object.values(downtimes).reduce((sum, entry) => sum + (entry.minutes || 0), 0)
    setCalculatedDowntimeTotal(total)
  }, [downtimes])

  useEffect(() => {
    const tables = formData.racksToCamera ? Number.parseInt(formData.racksToCamera) * 14 : 0
    setCalculatedTables(isNaN(tables) ? 0 : tables)
  }, [formData.racksToCamera])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    console.log("[v0] Starting form submit", { editingRecord: !!editingRecord })

    const missingFields: string[] = []

    if (!formData.startTime) missingFields.push("Hora Inicio")
    if (!formData.endTime) missingFields.push("Hora Fin")
    if (!formData.cementKg) missingFields.push("Cemento (kg)")
    if (!formData.sandKg) missingFields.push("Arena (kg)")
    if (!formData.stone010Kg) missingFields.push("Piedra 0-10 (kg)")
    if (!formData.productType) missingFields.push("Producto")
    if (!formData.racksToCamera) missingFields.push("Racks a Cámara")
    if (!formData.scrapUnits && formData.scrapUnits !== "0") missingFields.push("Unidades Descartadas")

    if (missingFields.length > 0) {
      const message = `Debe completar los siguientes campos: ${missingFields.join(", ")}`
      console.log("[v0] Validation failed", { missingFields })
      alert(message)
      toast({
        title: "Faltan datos obligatorios",
        description: message,
        variant: "destructive",
      })
      return
    }

    console.log("[v0] Validation passed, proceeding with save")
    setLoading(true)

    try {
      const supabase = getSupabase()

      const plannedDowntimeReasons = [
        "Cambio de Producto",
        "Mantenimiento",
        "Capacitación",
        "Reuniones",
        "Mant. Aut (Limp, Lub. Y Ajustes)",
        "Pruebas y/o Ensayos varios",
        "Puesta a punto (set up)",
      ]

      let plannedDowntimeMinutes = 0
      let totalDowntimeMinutes = 0

      Object.entries(downtimes).forEach(([reason, entry]) => {
        const minutes = entry.minutes || 0
        totalDowntimeMinutes += minutes
        if (plannedDowntimeReasons.includes(reason)) {
          plannedDowntimeMinutes += minutes
        }
      })

      console.log("[v0] Downtime calculated", { totalDowntimeMinutes, plannedDowntimeMinutes })

      if (editingRecord) {
        console.log("[v0] Updating existing record", editingRecord.id)

        const updateData = {
          production_date: formData.productionDate,
          shift: Number.parseInt(formData.shift),
          start_time: formData.startTime,
          end_time: formData.endTime,
          cleaning_minutes: Number.parseInt(formData.cleaningMinutes) || null,
          product_type: formData.productType,
          pallets: formData.pallets ? Number.parseInt(formData.pallets) : null,
          theoretical_units: formData.theoreticalUnits ? Number.parseInt(formData.theoreticalUnits) : null,
          real_units: formData.realUnits ? Number.parseInt(formData.realUnits) : null,
          scrap_units: formData.scrapUnits ? Number.parseInt(formData.scrapUnits) : null,
          scrap_percentage: formData.scrapPercentage,
          racks_to_camera: formData.racksToCamera ? Number.parseInt(formData.racksToCamera) : null,
          production_units: formData.productionUnits ? Number.parseInt(formData.productionUnits) : null,
          cement_kg: Number.parseInt(formData.cementKg) || null,
          sand_kg: Number.parseInt(formData.sandKg) || null,
          stone_0_10_kg: Number.parseInt(formData.stone010Kg) || null,
          water_kg: Number.parseInt(formData.waterKg) || null,
          additive_1_kg: Number.parseInt(formData.additive1Kg) || null,
          additive_2_kg: Number.parseInt(formData.additive2Kg) || null,
          machine_operator: formData.machineOperator,
          internal_driver: formData.internalDriver,
          palletizer_1: formData.palletizer1,
          palletizer_2: formData.palletizer2 || null,
          cement_final_shift_tn: formData.cementFinalShiftTn ? Number.parseFloat(formData.cementFinalShiftTn) : null,
          total_downtime_minutes: totalDowntimeMinutes,
          empty_tables: formData.emptyTables ? Number.parseInt(formData.emptyTables) : null,
        }

        console.log("[v0] Update data prepared", updateData)

        const { error: blockError } = await supabase
          .from("block_production")
          .update(updateData)
          .eq("id", editingRecord.id)

        if (blockError) {
          console.error("[v0] Error updating block production", blockError)
          throw blockError
        }

        console.log("[v0] Block production updated, deleting old downtimes")

        const { error: deleteError } = await supabase
          .from("block_downtime")
          .delete()
          .eq("block_production_id", editingRecord.id)

        if (deleteError) {
          console.error("[v0] Error deleting downtimes", deleteError)
          throw deleteError
        }

        console.log("[v0] Inserting new downtimes")

        for (const [reason, data] of Object.entries(downtimes)) {
          if (data.minutes > 0) {
            const { error: downtimeError } = await supabase.from("block_downtime").insert({
              block_production_id: editingRecord.id,
              custom_reason: reason,
              minutes: data.minutes,
              comments: data.comments || null,
              forklift_model: reason === "Autoelevador" ? data.forkliftModel || null : null,
              downtime_category: getDowntimeCategory(reason),
            })

            if (downtimeError) {
              console.error("[v0] Error inserting downtime", downtimeError)
              throw downtimeError
            }
          }
        }

        console.log("[v0] Update complete, showing toast")

        toast({
          title: "Actualizado",
          description: "El parte de producción se actualizó correctamente",
        })

        console.log("[v0] Calling onSaveComplete")

        if (onSaveComplete) {
          onSaveComplete()
        }
      } else {
        const { data: blockData, error: blockError } = await supabase
          .from("block_production")
          .insert({
            production_date: formData.productionDate,
            shift: Number.parseInt(formData.shift),
            start_time: formData.startTime,
            end_time: formData.endTime,
            cleaning_minutes: Number.parseInt(formData.cleaningMinutes) || null,
            product_type: formData.productType,
            pallets: Number.parseInt(formData.pallets) || null,
            theoretical_units: Number.parseInt(formData.theoreticalUnits) || null,
            real_units: Number.parseInt(formData.realUnits) || null,
            scrap_units: formData.scrapUnits ? Number.parseInt(formData.scrapUnits) : null,
            scrap_percentage: formData.scrapPercentage,
            racks_to_camera: formData.racksToCamera ? Number.parseInt(formData.racksToCamera) : null,
            production_units: formData.productionUnits ? Number.parseInt(formData.productionUnits) : null,
            cement_kg: Number.parseInt(formData.cementKg) || null,
            sand_kg: Number.parseInt(formData.sandKg) || null,
            stone_0_10_kg: Number.parseInt(formData.stone010Kg) || null,
            water_kg: Number.parseInt(formData.waterKg) || null,
            additive_1_kg: Number.parseInt(formData.additive1Kg) || null,
            additive_2_kg: Number.parseInt(formData.additive2Kg) || null,
            machine_operator: formData.machineOperator,
            internal_driver: formData.internalDriver,
            palletizer_1: formData.palletizer1,
            palletizer_2: formData.palletizer2 || null,
            cement_final_shift_tn: Number.parseFloat(formData.cementFinalShiftTn) || null,
            total_downtime_minutes: totalDowntimeMinutes,
            empty_tables: formData.emptyTables ? Number.parseInt(formData.emptyTables) : null,
          })
          .select()
          .single()

        if (blockError) throw blockError

        for (const [reason, data] of Object.entries(downtimes)) {
          if (data.minutes > 0) {
            const { error: dtError } = await supabase.from("block_downtime").insert({
              block_production_id: blockData.id,
              custom_reason: reason,
              minutes: data.minutes,
              comments: data.comments || null,
              forklift_model: reason === "Autoelevador" ? data.forkliftModel || null : null,
              downtime_category: getDowntimeCategory(reason),
            })
            if (dtError) {
              console.error("[v0] Error inserting downtime:", dtError)
            }
          }
        }

        localStorage.removeItem("blockProductionDraft")

        toast({
          title: "Guardado",
          description: "El parte de producción se guardó correctamente",
        })

        setFormData({
          productionDate: new Date().toISOString().split("T")[0],
          shift: "1",
          startTime: "",
          endTime: "",
          cleaningMinutes: "",
          productType: "",
          pallets: "",
          theoreticalUnits: "",
          realUnits: "",
          scrapUnits: "",
          scrapPercentage: 0,
          racksToCamera: "",
          productionUnits: "",
          cementKg: "",
          sandKg: "",
          stone010Kg: "",
          waterKg: "",
          additive1Kg: "",
          additive2Kg: "",
          machineOperator: "",
          internalDriver: "",
          palletizer1: "",
          palletizer2: "",
          cementFinalShiftTn: "",
          totalDowntimeMinutes: 0,
          emptyTables: "",
        })
        setDowntimes({})
      }
    } catch (error) {
      console.error("[v0] Error submitting form:", error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo guardar el parte de producción",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
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
        const tolerance = 50
        const inputsBelow = inputs.filter(inp => {
          const rect = inp.getBoundingClientRect()
          return Math.abs(rect.left - currentRect.left) < tolerance && rect.top > currentRect.top + 10
        }).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
        
        if (inputsBelow.length > 0) {
          inputsBelow[0].focus()
          inputsBelow[0].select()
        } else {
          // No input below, go to next input in DOM order
          const currentIndex = inputs.indexOf(current)
          if (currentIndex >= 0 && currentIndex < inputs.length - 1) {
            inputs[currentIndex + 1].focus()
            inputs[currentIndex + 1].select()
          }
        }
      }
    }}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">{editingRecord ? "Editar" : "Nuevo"} Parte de Producción - Bloques</h2>
        {!editingRecord && lastRecord && (
          <span className="text-xs text-muted-foreground">
            Último parte: {lastRecord.date.split("-").reverse().join("/")} - T{lastRecord.shift}
          </span>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="productionDate" className="text-xs">
            Fecha
          </Label>
          <Input
            id="productionDate"
            type="date"
            value={formData.productionDate}
            onChange={(e) => setFormData({ ...formData, productionDate: e.target.value })}
            required
            className="h-8 text-sm"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="shift" className="text-xs">
            Turno
          </Label>
          <select
            id="shift"
            className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={formData.shift}
            onChange={(e) => setFormData({ ...formData, shift: e.target.value })}
            required
          >
            <option value="1">Turno 1</option>
            <option value="2">Turno 2</option>
          </select>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="startTime" className="text-xs">
            Hora Inicio <span className="text-destructive">*</span>
          </Label>
          <Input
            id="startTime"
            type="time"
            value={formData.startTime}
            onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
            required
            className="h-8 text-sm"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="endTime" className="text-xs">
            Hora Fin <span className="text-destructive">*</span>
          </Label>
          <Input
            id="endTime"
            type="time"
            value={formData.endTime}
            onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
            required
            className="h-8 text-sm"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="cleaningMinutes" className="text-xs">
            Limpieza (min)
          </Label>
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
          <Label className="text-xs">Diferencia</Label>
          <div className="flex h-8 items-center rounded-md border border-input bg-muted px-2 text-sm font-semibold text-primary">
            {totalProductionMinutes} min
          </div>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-border p-2 bg-muted/30">
        <h3 className="text-sm font-semibold text-foreground">Dosificación</h3>
        <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-6">
          <div className="space-y-1">
            <Label htmlFor="cementKg" className="text-xs">
              Cemento (kg) <span className="text-destructive">*</span>
            </Label>
            <Input
              id="cementKg"
              type="number"
              step="0.01"
              min="0"
              value={formData.cementKg}
              onChange={(e) => setFormData({ ...formData, cementKg: e.target.value })}
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="sandKg" className="text-xs">
              Arena (kg) <span className="text-destructive">*</span>
            </Label>
            <Input
              id="sandKg"
              type="number"
              step="0.01"
              min="0"
              value={formData.sandKg}
              onChange={(e) => setFormData({ ...formData, sandKg: e.target.value })}
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="stone010Kg" className="text-xs">
              Piedra 0-10 (kg) <span className="text-destructive">*</span>
            </Label>
            <Input
              id="stone010Kg"
              type="number"
              step="0.01"
              min="0"
              value={formData.stone010Kg}
              onChange={(e) => setFormData({ ...formData, stone010Kg: e.target.value })}
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="waterKg" className="text-xs">
              Agua (kg)
            </Label>
            <Input
              id="waterKg"
              type="number"
              step="0.01"
              min="0"
              value={formData.waterKg}
              onChange={(e) => setFormData({ ...formData, waterKg: e.target.value })}
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="additive1Kg" className="text-xs">
              Aditivo 1 (kg)
            </Label>
            <Input
              id="additive1Kg"
              type="number"
              step="0.01"
              min="0"
              value={formData.additive1Kg}
              onChange={(e) => setFormData({ ...formData, additive1Kg: e.target.value })}
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="additive2Kg" className="text-xs">
              Aditivo 2 (kg)
            </Label>
            <Input
              id="additive2Kg"
              type="number"
              step="0.01"
              min="0"
              value={formData.additive2Kg}
              onChange={(e) => setFormData({ ...formData, additive2Kg: e.target.value })}
              className="h-8 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-border p-2 bg-muted/30">
        <h3 className="text-sm font-semibold text-foreground">Producción</h3>
        <div className="grid gap-2 md:grid-cols-4 lg:grid-cols-6">
          <div className="space-y-1">
            <Label htmlFor="productType" className="text-xs">
              Producto <span className="text-destructive">*</span>
            </Label>
            <select
              id="productType"
              className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={formData.productType}
              onChange={(e) => setFormData({ ...formData, productType: e.target.value })}
              required
            >
              <option value="">Seleccionar...</option>
              <option value="B20T">B20T</option>
              <option value="B15T">B15T</option>
              <option value="B12T">B12T</option>
              <option value="Adoquín">Adoquín</option>
              <option value="Bordillo">Bordillo</option>
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="racksToCamera" className="text-xs">
              Racks a Cámara <span className="text-destructive">*</span>
            </Label>
            <Input
              id="racksToCamera"
              type="number"
              min="0"
              value={formData.racksToCamera}
              onChange={(e) => setFormData({ ...formData, racksToCamera: e.target.value })}
              onKeyDown={handleEnterKey}
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Tablas</Label>
            <div className="flex h-8 items-center rounded-md border border-input bg-muted px-2 text-sm font-semibold">
              {!isNaN(Number.parseInt(formData.racksToCamera)) ? Number.parseInt(formData.racksToCamera) * 14 : 0}
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="scrapUnits" className="text-xs">
              Unidades Descartadas <span className="text-destructive">*</span>
            </Label>
            <Input
              id="scrapUnits"
              type="number"
              min="0"
              value={formData.scrapUnits}
              onChange={(e) => setFormData({ ...formData, scrapUnits: e.target.value })}
              onKeyDown={handleEnterKey}
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">% Scrap</Label>
            <div className="flex h-8 items-center rounded-md border border-input bg-muted px-2 text-sm font-semibold">
              {formData.scrapPercentage.toFixed(2)}%
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="emptyTables" className="text-xs">
              Tablas Vacías
            </Label>
            <Input
              id="emptyTables"
              type="number"
              min="0"
              value={formData.emptyTables || ""}
              onChange={(e) => setFormData({ ...formData, emptyTables: e.target.value })}
              onKeyDown={handleEnterKey}
              className="h-8 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Cemento al Finalizar el Turno */}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">Cemento al Finalizar el Turno</h3>
        <div className="flex items-center gap-2">
          <Label htmlFor="cementFinalShiftTn" className="text-xs whitespace-nowrap">
            Toneladas
          </Label>
          <Input
            id="cementFinalShiftTn"
            type="number"
            step="0.01"
            className="h-7 text-sm w-24"
            value={formData.cementFinalShiftTn}
            onChange={(e) => setFormData({ ...formData, cementFinalShiftTn: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2 rounded-lg border-2 border-border p-3 bg-background">
        <div className="border-b pb-2">
          <h2 className="text-lg font-bold text-foreground">Motivos de Paradas</h2>
        </div>

        {Object.entries(DOWNTIME_CATEGORIES).map(([category, reasons]) => {
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
                        <Label htmlFor={`downtime-${reason}`} className="text-xs flex-1">
                          {reason}
                        </Label>
                        {reason === "Autoelevador" && (
                          <select
                            value={downtimes[reason]?.forkliftModel || ""}
                            onChange={(e) => {
                              if (e.target.value === "__add_new__") {
                                const newModel = prompt("Ingrese el nuevo modelo de autoelevador:")
                                if (newModel && newModel.trim()) {
                                  const trimmedModel = newModel.trim()
                                  setForkliftModels((prev) => [...prev, trimmedModel].sort())
                                  setDowntimes((prev) => ({
                                    ...prev,
                                    [reason]: { ...prev[reason], forkliftModel: trimmedModel },
                                  }))
                                }
                              } else {
                                setDowntimes((prev) => ({
                                  ...prev,
                                  [reason]: { ...prev[reason], forkliftModel: e.target.value },
                                }))
                              }
                            }}
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs w-24"
                          >
                            <option value="">-</option>
                            {forkliftModels.map((model) => (
                              <option key={model} value={model}>
                                {model}
                              </option>
                            ))}
                            <option value="__add_new__">+ Nuevo</option>
                          </select>
                        )}
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
                              [reason]: {
                                minutes,
                                comments: prev[reason]?.comments || "",
                                forkliftModel: prev[reason]?.forkliftModel || "",
                              },
                            }))
                          }}
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
                        <Label htmlFor={`downtime-${reason}`} className="text-xs flex-1">
                          {reason}
                        </Label>
                        {reason === "Autoelevador" && (
                          <select
                            value={downtimes[reason]?.forkliftModel || ""}
                            onChange={(e) => {
                              if (e.target.value === "__add_new__") {
                                const newModel = prompt("Ingrese el nuevo modelo de autoelevador:")
                                if (newModel && newModel.trim()) {
                                  const trimmedModel = newModel.trim()
                                  setForkliftModels((prev) => [...prev, trimmedModel].sort())
                                  setDowntimes((prev) => ({
                                    ...prev,
                                    [reason]: { ...prev[reason], forkliftModel: trimmedModel },
                                  }))
                                }
                              } else {
                                setDowntimes((prev) => ({
                                  ...prev,
                                  [reason]: { ...prev[reason], forkliftModel: e.target.value },
                                }))
                              }
                            }}
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs w-24"
                          >
                            <option value="">-</option>
                            {forkliftModels.map((model) => (
                              <option key={model} value={model}>
                                {model}
                              </option>
                            ))}
                            <option value="__add_new__">+ Nuevo</option>
                          </select>
                        )}
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
                              [reason]: {
                                minutes,
                                comments: prev[reason]?.comments || "",
                                forkliftModel: prev[reason]?.forkliftModel || "",
                              },
                            }))
                          }}
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

      <div className="rounded-lg border-2 border-primary bg-primary/5 p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">Total de Minutos de Paradas:</span>
          <span className="text-2xl font-bold text-primary">{calculatedDowntimeTotal} min</span>
        </div>
      </div>

      {/* Comentario General */}
      <div className="space-y-2">
        <Label htmlFor="generalComments" className="text-sm font-semibold">Comentario General</Label>
        <Textarea
          id="generalComments"
          placeholder="Comentarios generales sobre la producción del turno..."
          value={observationsComments}
          onChange={(e) => setObservationsComments(e.target.value)}
          className="min-h-[80px]"
        />
      </div>

      <div className="flex justify-end gap-3 pt-4">
        {!editingRecord && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (confirm("¿Está seguro que desea descartar todos los datos cargados?")) {
                // Clear form data
                setFormData({
                  productionDate: new Date().toISOString().split("T")[0],
                  shift: "1",
                  startTime: "",
                  endTime: "",
                  cleaningMinutes: "",
                  productType: "",
                  pallets: "",
                  theoreticalUnits: "",
                  realUnits: "",
                  scrapUnits: "",
                  scrapPercentage: 0,
                  racksToCamera: "",
                  productionUnits: "",
                  cementKg: "",
                  sandKg: "",
                  stone010Kg: "",
                  waterKg: "",
                  additive1Kg: "",
                  additive2Kg: "",
                  machineOperator: "",
                  internalDriver: "",
                  palletizer1: "",
                  palletizer2: "",
                  cementFinalShiftTn: "",
                  totalDowntimeMinutes: 0,
                  emptyTables: "",
                })

                // Clear downtimes
                setDowntimes({})

                // Clear localStorage
                localStorage.removeItem("blockProductionDraft")

                toast({
                  title: "Datos descartados",
                  description: "Todos los datos del formulario han sido eliminados",
                })
              }
            }}
            className="min-w-[200px]"
          >
            Descartar Producción
          </Button>
        )}

        <Button type="submit" disabled={loading} className="min-w-[200px]">
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {editingRecord ? "Actualizar Producción" : "Guardar Producción"}
        </Button>
      </div>
    </form>
  )
}
