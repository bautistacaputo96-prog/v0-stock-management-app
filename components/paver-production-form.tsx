"use client"

import type React from "react"
import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { getSupabase } from "@/lib/supabase"
import { Loader2, Plus, X, Truck, ChevronDown, FlaskConical, Trash2, AlertTriangle } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"

// Tipos de adoquin disponibles
const ADOQUIN_TYPES = [
  { code: "AH6", name: "Adoquin H6" },
  { code: "AH6-R", name: "Adoquin H6 Rojo" },
  { code: "AH6-A", name: "Adoquin H6 Amarillo" },
  { code: "AH6-N", name: "Adoquin H6 Negro" },
  { code: "AH8", name: "Adoquin H8" },
  { code: "AH8-R", name: "Adoquin H8 Rojo" },
  { code: "AH8-A", name: "Adoquin H8 Amarillo" },
  { code: "AH8-N", name: "Adoquin H8 Negro" },
]

interface SampleEntry {
  id: string
  sample_code: string
  adoquin_type: string
  observations: string
}

interface CurrentSupplier {
  id?: number
  ingredient_name: string
  supplier_name: string
  changed_at?: string
}

interface DowntimeEntry {
  minutes: number
  comments: string
}

const PAVER_DOWNTIME_CATEGORIES: Record<string, string[]> = {
  "Factores Externos": ["Energia Electrica"],
  "Paradas Planificadas": [
    "Cambio de Molde",
    "Mantenimiento",
    "Capacitacion",
    "Reuniones",
    "Mto Autonomo (limp, lub y ajustes)",
    "Programador",
    "Calibracion de maquina x cambio molde",
    "Pruebas y/o ensayos varios",
  ].sort(),
  "Fallas de Proceso": [
    "Problema con Calidad de Hormigon",
    "Problema con Calidad de Materia Prima",
    "Falta mezcla",
    "Cambio de color",
    "Calidad de Producto",
    "Arranques y ajustes en prensa",
    "Espera de Materia Prima",
    "Espera de Insumos (Tolvas vacias)",
  ].sort(),
  "Gestion": [
    "Falta Personal",
    "Espera de Instrucciones",
    "Arranca Tarde",
    "Falta de tablas",
    "Termina Antes",
    "Pala",
    "Autoelevadores",
    "Factores Humanos",
  ].sort(),
  "Logistica": [
    "Reposicion int de pallets",
    "Transporte de pallets a playa",
    "Logistica interna de prod terminado",
  ].sort(),
  "Min no anotados": ["Paradas menores a 5 min"],
  "Fallas de Equipo": [
    "Tolvas de aridos",
    "Tolva de Prensa",
    "Balanza de aridos",
    "Cinta de balanza de aridos",
    "Cinta transportadora aridos",
    "Cinta mezcladora",
    "Cilindros hidraulicos",
    "Chimango de cemento",
    "Balanza de cemento",
    "Bomba de agua",
    "Central hidraulica",
    "Mezcladora",
    "Prensa",
    "Cajon alimentador",
    "Carro de tablas",
    "Tolva alimentador",
    "Tablas y racks",
    "Cepillo limpieza contra molde",
    "Molde",
    "Contramolde",
    "Correas",
    "Cajas vibradoras",
    "Motores de cajas",
    "Sensores",
    "Ascensor",
    "Descensor",
    "Paletizadora/paletizado",
    "Brazo de molde/contra molde",
    "Cinta salida de prensa",
    "Cinta paletizado",
    "Mangueras hidraulicas",
    "Dosificador aditivo",
    "Compresor de aire",
    "Tablas en ascensor",
    "Cilindros neumaticos",
    "Fallas Electricas",
  ].sort(),
}

function getPaverDowntimeCategory(reason: string): string {
  for (const category in PAVER_DOWNTIME_CATEGORIES) {
    if (PAVER_DOWNTIME_CATEGORIES[category].includes(reason)) {
      return category
    }
  }
  return "Otro"
}

interface ProductType {
  id: number
  product_code: string
  description: string
  paston_formula: string
  piece_weight_kg: number
}

interface PaverProductionFormProps {
  editingRecord?: any | null
  onSaveComplete?: () => void
}

export function PaverProductionForm({ editingRecord = null, onSaveComplete }: PaverProductionFormProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [totalProductionMinutes, setTotalProductionMinutes] = useState<number>(0)
  const [calculatedDowntimeTotal, setCalculatedDowntimeTotal] = useState<number>(0)
  const [lastRecord, setLastRecord] = useState<{ date: string } | null>(null)

  // Product types from DB
  const [productTypes, setProductTypes] = useState<ProductType[]>([])
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [newProduct, setNewProduct] = useState({ code: "", description: "", weight: "" })

  // Suppliers (persistent - loaded from paver_supplier_current)
  const [currentSuppliers, setCurrentSuppliers] = useState<CurrentSupplier[]>([])
  const [allSuppliers, setAllSuppliers] = useState<{ id: number; ingredient_name: string; supplier_name: string }[]>([])
  const [showSupplierPanel, setShowSupplierPanel] = useState(false)
  const [supplierChanged, setSupplierChanged] = useState(false)
  const [supplierChangeNotes, setSupplierChangeNotes] = useState("")

  const [formData, setFormData] = useState({
    productionDate: new Date().toISOString().split("T")[0],
    startTime: "06:00",
    endTime: "17:00",
    extraMinutes: "0",
    productTypeId: "",
    productTypeCode: "",
    formulaCementKg: "",
    formulaSandKg: "",
    formulaStoneKg: "",
    formulaAdditiveLts: "",
    formulaDaraccelGrams: "",
    pastonesCount: "",
    tablesProduced: "",
    wetPieceWeightKg: "",
    palletizedFirst: "",
    palletizedSecond: "",
    cementSilo1Tn: "",
    cementSilo2Tn: "",
  })

  const [downtimes, setDowntimes] = useState<Record<string, DowntimeEntry>>({})
  const [observations, setObservations] = useState("")

  // Formula from paver_mix_designs
  const [mixDesign, setMixDesign] = useState<{
    id?: string
    adoquin_type: string
    cement_kg: number
    sand_kg: number
    stone_kg: number
    additive_liters: number
    daraccel_grams: number
    modified_by: string
    modified_at: string
  } | null>(null)
  const [formulaModified, setFormulaModified] = useState(false)
  const [showFormulaChangeDialog, setShowFormulaChangeDialog] = useState(false)
  const [formulaChangedBy, setFormulaChangedBy] = useState("")
  const [formulaChangeReason, setFormulaChangeReason] = useState("")
  const [originalFormula, setOriginalFormula] = useState({ cement: "", sand: "", stone: "", additive: "", daraccel: "" })

  // Muestras de calidad
  const [samplesTaken, setSamplesTaken] = useState(false)
  const [samples, setSamples] = useState<SampleEntry[]>([])

  // Load product types, available suppliers, and current suppliers from DB
  useEffect(() => {
    const loadData = async () => {
      try {
        const supabase = getSupabase()
        const [prodRes, allSupRes, curSupRes] = await Promise.all([
          supabase.from("paver_product_types").select("*").eq("active", true).order("product_code"),
          supabase.from("paver_suppliers").select("id, ingredient_name, supplier_name").eq("active", true).order("ingredient_name").order("supplier_name"),
          supabase.from("paver_supplier_current").select("*").order("ingredient_name"),
        ])
        if (prodRes.data) setProductTypes(prodRes.data)
        if (allSupRes.data) {
          console.log("[v0] All paver suppliers loaded:", allSupRes.data)
          setAllSuppliers(allSupRes.data)
        }
        if (curSupRes.data) setCurrentSuppliers(curSupRes.data)
      } catch {}
    }
    loadData()
  }, [])

  // Load mix design formula when product type changes
  useEffect(() => {
    if (!formData.productTypeCode || editingRecord) return
    
    const loadMixDesign = async () => {
      try {
        const supabase = getSupabase()
        // Get the adoquin type based on the product code (e.g., "AH6" from "AH6" or "AH6-R")
        const baseType = formData.productTypeCode.split("-")[0] + (formData.productTypeCode.includes("-") ? "-" + formData.productTypeCode.split("-")[1] : "")
        
        const { data } = await supabase
          .from("paver_mix_designs")
          .select("*")
          .eq("plant", "ranchos")
          .eq("adoquin_type", formData.productTypeCode)
          .eq("is_active", true)
          .order("modified_at", { ascending: false })
          .limit(1)
          .single()
        
        if (data) {
          setMixDesign(data)
          const newFormula = {
            cement: data.cement_kg > 0 ? data.cement_kg.toString() : "",
            sand: data.sand_kg > 0 ? data.sand_kg.toString() : "",
            stone: data.stone_kg > 0 ? data.stone_kg.toString() : "",
            additive: data.additive_liters > 0 ? data.additive_liters.toString() : "",
            daraccel: data.daraccel_grams > 0 ? data.daraccel_grams.toString() : ""
          }
          setOriginalFormula(newFormula)
          setFormData(prev => ({
            ...prev,
            formulaCementKg: newFormula.cement,
            formulaSandKg: newFormula.sand,
            formulaStoneKg: newFormula.stone,
            formulaAdditiveLts: newFormula.additive,
            formulaDaraccelGrams: newFormula.daraccel
          }))
        }
      } catch {}
    }
    loadMixDesign()
  }, [formData.productTypeCode, editingRecord])
  
  // Detect if formula was modified
  useEffect(() => {
    if (mixDesign) {
      const changed = 
        formData.formulaCementKg !== originalFormula.cement ||
        formData.formulaSandKg !== originalFormula.sand ||
        formData.formulaStoneKg !== originalFormula.stone ||
        formData.formulaAdditiveLts !== originalFormula.additive ||
        formData.formulaDaraccelGrams !== originalFormula.daraccel
      setFormulaModified(changed)
    }
  }, [formData.formulaCementKg, formData.formulaSandKg, formData.formulaStoneKg, formData.formulaAdditiveLts, formData.formulaDaraccelGrams, originalFormula, mixDesign])

  // Load last record
  useEffect(() => {
    if (!editingRecord) {
      const loadLast = async () => {
        try {
          const supabase = getSupabase()
          const { data } = await supabase
            .from("paver_production")
            .select("production_date, start_time, end_time")
            .order("production_date", { ascending: false })
            .limit(1)
          if (data && data.length > 0) {
            setLastRecord({ date: data[0].production_date })
            if (data[0].start_time && data[0].end_time) {
              setFormData(prev => ({ ...prev, startTime: data[0].start_time, endTime: data[0].end_time }))
            }
          }
        } catch {}
      }
      loadLast()
    }
  }, [editingRecord])

  // Load saved draft from localStorage
  useEffect(() => {
    if (!editingRecord) {
      const saved = localStorage.getItem("paverProductionForm")
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          if (parsed.formData) setFormData(prev => ({ ...prev, ...parsed.formData }))
          if (parsed.downtimes) setDowntimes(parsed.downtimes)
          if (parsed.observations) setObservations(parsed.observations)
        } catch {}
      }
    }
  }, [editingRecord])

  // Save draft
  useEffect(() => {
    if (!editingRecord) {
      localStorage.setItem("paverProductionForm", JSON.stringify({ formData, downtimes, observations }))
    }
  }, [formData, downtimes, observations, editingRecord])

  // Load editing record
  useEffect(() => {
    if (editingRecord) {
      const productionDate = editingRecord.production_date?.includes("T")
        ? editingRecord.production_date.split("T")[0]
        : editingRecord.production_date

      setFormData({
        productionDate,
        startTime: editingRecord.start_time || "06:00",
        endTime: editingRecord.end_time || "17:00",
        extraMinutes: editingRecord.extra_minutes?.toString() || "0",
        productTypeId: editingRecord.product_type_id?.toString() || "",
        productTypeCode: editingRecord.product_type_code || "",
        formulaCementKg: editingRecord.formula_cement_kg?.toString() || "",
        formulaSandKg: editingRecord.formula_sand_kg?.toString() || "",
        formulaStoneKg: editingRecord.formula_stone_kg?.toString() || "",
        formulaAdditiveLts: editingRecord.formula_additive_lts?.toString() || "",
        pastonesCount: editingRecord.pastones_count?.toString() || "",
        tablesProduced: editingRecord.tables_produced?.toString() || "",
        wetPieceWeightKg: editingRecord.wet_piece_weight_kg?.toString() || "",
        palletizedFirst: editingRecord.palletized_first?.toString() || "",
        palletizedSecond: editingRecord.palletized_second?.toString() || "",
        cementSilo1Tn: editingRecord.cement_silo_1_tn?.toString() || "",
        cementSilo2Tn: editingRecord.cement_silo_2_tn?.toString() || "",
      })

      if (editingRecord.paver_downtime?.length > 0) {
        const dt: Record<string, DowntimeEntry> = {}
        editingRecord.paver_downtime.forEach((d: any) => {
          if (d.custom_reason) {
            dt[d.custom_reason] = { minutes: d.minutes || 0, comments: d.comments || "" }
          }
        })
        setDowntimes(dt)
      } else {
        setDowntimes({})
      }

      setObservations(editingRecord.observations || "")

      setSupplierChanged(editingRecord.supplier_changed || false)
      setSupplierChangeNotes(editingRecord.supplier_change_notes || "")
    }
  }, [editingRecord])

  // Calculate production minutes
  useEffect(() => {
    if (formData.startTime && formData.endTime) {
      const start = new Date(`2000-01-01T${formData.startTime}`)
      const end = new Date(`2000-01-01T${formData.endTime}`)
      let diff = (end.getTime() - start.getTime()) / 1000 / 60
      if (diff < 0) diff += 24 * 60
      setTotalProductionMinutes(Math.round(diff))
    } else {
      setTotalProductionMinutes(0)
    }
  }, [formData.startTime, formData.endTime])

  // Calculate downtime total
  useEffect(() => {
    const total = Object.values(downtimes).reduce((sum, entry) => sum + (entry.minutes || 0), 0)
    setCalculatedDowntimeTotal(total)
  }, [downtimes])

  // When product type selected, set the code
  useEffect(() => {
    if (formData.productTypeId) {
      const product = productTypes.find(p => p.id === Number(formData.productTypeId))
      if (product) {
        setFormData(prev => ({
          ...prev,
          productTypeCode: product.product_code,
        }))
      }
    }
  }, [formData.productTypeId, productTypes])

  // Helper: get current supplier for an ingredient
  function getCurrentSupplier(ingredient: string): string {
    const cur = currentSuppliers.find(s => s.ingredient_name === ingredient)
    return cur?.supplier_name || "Sin asignar"
  }

  // Generate sample code
  function generateSampleCode(): string {
    const date = new Date(formData.productionDate)
    const year = date.getFullYear().toString().slice(-2)
    const month = (date.getMonth() + 1).toString().padStart(2, "0")
    const day = date.getDate().toString().padStart(2, "0")
    const random = Math.floor(Math.random() * 100).toString().padStart(2, "0")
    return `F${year}${month}${day}-${random}`
  }

  // Add new sample
  function addSample() {
    const newSample: SampleEntry = {
      id: crypto.randomUUID(),
      sample_code: generateSampleCode(),
      adoquin_type: formData.productTypeCode || "",
      observations: ""
    }
    setSamples(prev => [...prev, newSample])
  }

  // Remove sample
  function removeSample(id: string) {
    setSamples(prev => prev.filter(s => s.id !== id))
  }

  // Update sample
  function updateSample(id: string, field: keyof SampleEntry, value: string) {
    setSamples(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s))
  }

  // Change a supplier persistently
  async function changeSupplier(ingredient: string, newSupplierName: string) {
    try {
      const supabase = getSupabase()
      // Upsert the current supplier
      const { error } = await supabase
        .from("paver_supplier_current")
        .upsert(
          { ingredient_name: ingredient, supplier_name: newSupplierName, changed_at: new Date().toISOString() },
          { onConflict: "ingredient_name" }
        )
      if (error) throw error
      // Update local state
      setCurrentSuppliers(prev => {
        const others = prev.filter(s => s.ingredient_name !== ingredient)
        return [...others, { ingredient_name: ingredient, supplier_name: newSupplierName, changed_at: new Date().toISOString() }]
      })
      setSupplierChanged(true)
      toast({ title: "Proveedor actualizado", description: `${ingredient}: ${newSupplierName}` })
    } catch {
      toast({ title: "Error", description: "No se pudo actualizar el proveedor", variant: "destructive" })
    }
  }

  async function addNewProductType() {
    if (!newProduct.code) return
    try {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("paver_product_types")
        .insert({
          product_code: newProduct.code,
          description: newProduct.description || newProduct.code,
          piece_weight_kg: newProduct.weight ? Number(newProduct.weight) : null,
        })
        .select()
        .single()

      if (error) throw error

      setProductTypes(prev => [...prev, data])
      setFormData(prev => ({ ...prev, productTypeId: data.id.toString(), productTypeCode: data.product_code }))
      setNewProduct({ code: "", description: "", weight: "" })
      setShowAddProduct(false)
      toast({ title: "Producto agregado", description: `${data.product_code} se agrego correctamente` })
    } catch (err) {
      toast({ title: "Error", description: "No se pudo agregar el producto", variant: "destructive" })
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const missingFields: string[] = []
    if (!formData.startTime) missingFields.push("Hora Inicio")
    if (!formData.endTime) missingFields.push("Hora Fin")
    if (!formData.productTypeCode && !formData.productTypeId) missingFields.push("Tipo de Producto")

    if (missingFields.length > 0) {
      alert(`Debe completar: ${missingFields.join(", ")}`)
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

      let totalDowntimeMinutes = 0
      Object.values(downtimes).forEach(entry => {
        totalDowntimeMinutes += entry.minutes || 0
      })

      const record = {
        production_date: formData.productionDate,
        start_time: formData.startTime,
        end_time: formData.endTime,
        extra_minutes: Number(formData.extraMinutes) || 0,
        product_type_id: formData.productTypeId ? Number(formData.productTypeId) : null,
        product_type_code: formData.productTypeCode || null,
        formula_cement_kg: formData.formulaCementKg ? Number(formData.formulaCementKg) : null,
        formula_sand_kg: formData.formulaSandKg ? Number(formData.formulaSandKg) : null,
        formula_stone_kg: formData.formulaStoneKg ? Number(formData.formulaStoneKg) : null,
        formula_additive_lts: formData.formulaAdditiveLts ? Number(formData.formulaAdditiveLts) : null,
        pastones_count: Number(formData.pastonesCount) || 0,
        tables_produced: formData.tablesProduced ? Number(formData.tablesProduced) : null,
        wet_piece_weight_kg: formData.wetPieceWeightKg ? Number(formData.wetPieceWeightKg) : null,
        palletized_first: formData.palletizedFirst ? Number(formData.palletizedFirst) : null,
        palletized_second: formData.palletizedSecond ? Number(formData.palletizedSecond) : null,
        cement_silo_1_tn: formData.cementSilo1Tn ? Number(formData.cementSilo1Tn) : 0,
        cement_silo_2_tn: formData.cementSilo2Tn ? Number(formData.cementSilo2Tn) : 0,
        cement_supplier: getCurrentSupplier("Cemento"),
        sand_supplier: getCurrentSupplier("Arena"),
        stone_supplier: getCurrentSupplier("Piedra (0-6)"),
        supplier_changed: supplierChanged,
        supplier_change_notes: supplierChanged ? supplierChangeNotes || null : null,
        observations: observations || null,
      }

      if (editingRecord) {
        const { error: updateErr } = await supabase
          .from("paver_production")
          .update(record)
          .eq("id", editingRecord.id)
        if (updateErr) throw updateErr

        await supabase.from("paver_downtime").delete().eq("paver_production_id", editingRecord.id)

        for (const [reason, data] of Object.entries(downtimes)) {
          if (data.minutes > 0) {
            await supabase.from("paver_downtime").insert({
              paver_production_id: editingRecord.id,
              custom_reason: reason,
              minutes: data.minutes,
              comments: data.comments || null,
              downtime_category: getPaverDowntimeCategory(reason),
            })
          }
        }

        toast({ title: "Actualizado", description: "El parte se actualizo correctamente" })
        if (onSaveComplete) onSaveComplete()
      } else {
        const { data: newRecord, error: insertErr } = await supabase
          .from("paver_production")
          .insert(record)
          .select()
          .single()
        if (insertErr) throw insertErr

        for (const [reason, data] of Object.entries(downtimes)) {
          if (data.minutes > 0) {
            await supabase.from("paver_downtime").insert({
              paver_production_id: newRecord.id,
              custom_reason: reason,
              minutes: data.minutes,
              comments: data.comments || null,
              downtime_category: getPaverDowntimeCategory(reason),
            })
          }
        }

        // Guardar muestras de calidad
        if (samplesTaken && samples.length > 0) {
          for (const sample of samples) {
            if (!sample.sample_code || !sample.adoquin_type) continue

            // Crear la muestra en quality_flexion_samples
            const { data: sampleData, error: sampleErr } = await supabase
              .from("quality_flexion_samples")
              .insert({
                sample_code: sample.sample_code,
                adoquin_type: sample.adoquin_type,
                sample_date: formData.productionDate,
                production_date: formData.productionDate,
                paver_production_id: newRecord.id,
                plant: "ranchos",
                status: "pending",
                observations: sample.observations || null,
                formula_cement_kg: formData.formulaCementKg ? Number(formData.formulaCementKg) : null,
                formula_sand_kg: formData.formulaSandKg ? Number(formData.formulaSandKg) : null,
                formula_stone_kg: formData.formulaStoneKg ? Number(formData.formulaStoneKg) : null,
                formula_additive_lts: formData.formulaAdditiveLts ? Number(formData.formulaAdditiveLts) : null,
              })
              .select()
              .single()

            if (sampleErr) {
              console.error("[v0] Error saving sample:", sampleErr)
              continue
            }

            // Crear especímenes para 7 y 28 días (3 probetas por cada edad)
            const specimens = []
            for (const age of [7, 28]) {
              for (let i = 1; i <= 3; i++) {
                specimens.push({
                  sample_id: sampleData.id,
                  specimen_number: age === 7 ? i : i + 3,
                  test_age_days: age,
                })
              }
            }

            await supabase.from("quality_flexion_specimens").insert(specimens)
          }
        }

        // Si hubo cambio de fórmula, guardar en historial
        if (formulaModified && formulaChangedBy && mixDesign) {
          await supabase.from("paver_formula_changes").insert({
            plant: "ranchos",
            formula_type: "mix_design",
            adoquin_type: formData.productTypeCode,
            previous_values: originalFormula,
            new_values: {
              cement: formData.formulaCementKg,
              sand: formData.formulaSandKg,
              stone: formData.formulaStoneKg,
              additive: formData.formulaAdditiveLts
            },
            change_reason: formulaChangeReason || "Cambio en parte diario",
            changed_by: formulaChangedBy
          })
        }

        localStorage.removeItem("paverProductionForm")
        toast({ 
          title: "Guardado", 
          description: samplesTaken && samples.length > 0 
            ? `Parte y ${samples.length} muestra(s) guardados correctamente` 
            : "El parte de adoquines se guardo correctamente" 
        })

        // Reset form and formula change state
        setFormulaChangedBy("")
        setFormulaChangeReason("")
        setFormulaModified(false)
        setFormData({
          productionDate: new Date().toISOString().split("T")[0],
          startTime: "06:00",
          endTime: "17:00",
          extraMinutes: "0",
          productTypeId: "",
          productTypeCode: "",
          formulaCementKg: "",
          formulaSandKg: "",
          formulaStoneKg: "",
          formulaAdditiveLts: "",
          pastonesCount: "",
          tablesProduced: "",
          wetPieceWeightKg: "",
          palletizedFirst: "",
          palletizedSecond: "",
          cementSilo1Tn: "",
          cementSilo2Tn: "",
        })
        setDowntimes({})
        setObservations("")
        setSupplierChanged(false)
        setSupplierChangeNotes("")
        setShowSupplierPanel(false)
        setSamplesTaken(false)
        setSamples([])
      }
    } catch (error) {
      console.error("[v0] Error submitting paver form:", error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo guardar el parte",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const formRef = useRef<HTMLFormElement>(null)
  
  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4" onKeyDown={(e) => {
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
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">{editingRecord ? "Editar" : "Nuevo"} Parte de Produccion - Adoquines</h2>
        {!editingRecord && lastRecord && (
          <span className="text-xs text-muted-foreground">
            Ultimo parte: {lastRecord.date.split("-").reverse().join("/")}
          </span>
        )}
      </div>

      {/* Date + Times + Extra minutes */}
      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="pv-date" className="text-xs">Fecha</Label>
          <Input id="pv-date" type="date" value={formData.productionDate}
            onChange={e => setFormData({ ...formData, productionDate: e.target.value })} required className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pv-start" className="text-xs">Hora Inicio <span className="text-destructive">*</span></Label>
          <Input id="pv-start" type="time" value={formData.startTime}
            onChange={e => setFormData({ ...formData, startTime: e.target.value })} required className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pv-end" className="text-xs">Hora Fin <span className="text-destructive">*</span></Label>
          <Input id="pv-end" type="time" value={formData.endTime}
            onChange={e => setFormData({ ...formData, endTime: e.target.value })} required className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pv-extra" className="text-xs">Tiempo Extra (min)</Label>
          <Input id="pv-extra" type="number" min="0" value={formData.extraMinutes}
            onChange={e => setFormData({ ...formData, extraMinutes: e.target.value })} className="h-8 text-sm" />
        </div>
      </div>

      {/* Time summary */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
        <span>Tiempo total: <strong className="text-foreground">{totalProductionMinutes} min</strong></span>
        <span>Paradas: <strong className="text-foreground">{calculatedDowntimeTotal} min</strong></span>
        <span>Tiempo productivo: <strong className="text-foreground">{totalProductionMinutes - calculatedDowntimeTotal + (Number(formData.extraMinutes) || 0)} min</strong></span>
      </div>

      {/* Product type + Pastones + Silos */}
      <div className="space-y-2 rounded-lg border border-border p-3 bg-muted/30">
        <h3 className="text-sm font-semibold text-foreground">Producto y Produccion</h3>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Tipo de Producto <span className="text-destructive">*</span></Label>
            <div className="flex gap-2">
              <select
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={formData.productTypeId}
                onChange={e => setFormData({ ...formData, productTypeId: e.target.value })}
              >
                <option value="">Seleccionar...</option>
                {productTypes.map(pt => (
                  <option key={pt.id} value={pt.id}>{pt.product_code} - {pt.description}</option>
                ))}
              </select>
              <Button type="button" variant="outline" size="sm" className="h-8 px-2 shrink-0"
                onClick={() => setShowAddProduct(!showAddProduct)}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pv-pastones" className="text-xs">Cant. Pastones</Label>
            <Input id="pv-pastones" type="number" min="0" value={formData.pastonesCount}
              onChange={e => setFormData({ ...formData, pastonesCount: e.target.value })} className="h-8 text-sm" />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="pv-tables" className="text-xs">Tablas Producidas</Label>
            <Input id="pv-tables" type="number" min="0" value={formData.tablesProduced}
              onChange={e => setFormData({ ...formData, tablesProduced: e.target.value })} className="h-8 text-sm" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pv-wet-weight" className="text-xs">Peso Prom. Humedo (kg)</Label>
            <Input id="pv-wet-weight" type="number" step="0.001" min="0" value={formData.wetPieceWeightKg}
              onChange={e => setFormData({ ...formData, wetPieceWeightKg: e.target.value })} className="h-8 text-sm" />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="pv-pal-1" className="text-xs">Pzas Paletizadas 1ra</Label>
            <Input id="pv-pal-1" type="number" min="0" value={formData.palletizedFirst}
              onChange={e => setFormData({ ...formData, palletizedFirst: e.target.value })} className="h-8 text-sm" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pv-pal-2" className="text-xs">Pzas Paletizadas 2da</Label>
            <Input id="pv-pal-2" type="number" min="0" value={formData.palletizedSecond}
              onChange={e => setFormData({ ...formData, palletizedSecond: e.target.value })} className="h-8 text-sm" />
          </div>
        </div>

        {/* Add new product inline */}
        {showAddProduct && (
          <div className="border border-dashed border-primary/30 rounded-md p-3 bg-primary/5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-primary">Agregar nuevo producto</span>
              <button type="button" onClick={() => setShowAddProduct(false)}><X className="h-3.5 w-3.5 text-muted-foreground" /></button>
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <Input placeholder="Codigo (ej: H10)" value={newProduct.code}
                onChange={e => setNewProduct({ ...newProduct, code: e.target.value })} className="h-8 text-sm" />
              <Input placeholder="Descripcion" value={newProduct.description}
                onChange={e => setNewProduct({ ...newProduct, description: e.target.value })} className="h-8 text-sm" />
              <Input placeholder="Peso pieza (kg)" type="number" step="0.001" value={newProduct.weight}
                onChange={e => setNewProduct({ ...newProduct, weight: e.target.value })} className="h-8 text-sm" />
            </div>
            <Button type="button" size="sm" onClick={addNewProductType} className="h-7 text-xs">Agregar producto</Button>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="pv-silo1" className="text-xs">Cemento Silo 1 (tn)</Label>
            <Input id="pv-silo1" type="number" step="0.001" min="0" value={formData.cementSilo1Tn}
              onChange={e => setFormData({ ...formData, cementSilo1Tn: e.target.value })} className="h-8 text-sm" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pv-silo2" className="text-xs">Cemento Silo 2 (tn)</Label>
            <Input id="pv-silo2" type="number" step="0.001" min="0" value={formData.cementSilo2Tn}
              onChange={e => setFormData({ ...formData, cementSilo2Tn: e.target.value })} className="h-8 text-sm" />
          </div>
        </div>
      </div>

      {/* Formula del Paston - cargada desde Formuleo */}
      <div className="space-y-2 rounded-lg border border-border p-3 bg-muted/30">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Dosificacion (desde Formuleo)</h3>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            {mixDesign?.modified_at && (
              <span>Ultima modificacion: {new Date(mixDesign.modified_at).toLocaleDateString("es-AR")} por {mixDesign.modified_by}</span>
            )}
            {formulaModified && (
              <span className="text-amber-600 font-medium">(Modificado en este parte)</span>
            )}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          <div className="space-y-1">
            <Label htmlFor="pv-f-cement" className="text-xs">Cemento (kg)</Label>
            <Input id="pv-f-cement" type="number" step="0.1" min="0" value={formData.formulaCementKg}
              onChange={e => setFormData({ ...formData, formulaCementKg: e.target.value })} className="h-8 text-sm" placeholder="kg" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pv-f-sand" className="text-xs">Arena (kg)</Label>
            <Input id="pv-f-sand" type="number" step="0.1" min="0" value={formData.formulaSandKg}
              onChange={e => setFormData({ ...formData, formulaSandKg: e.target.value })} className="h-8 text-sm" placeholder="kg" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pv-f-stone" className="text-xs">Piedra 0-6 (kg)</Label>
            <Input id="pv-f-stone" type="number" step="0.1" min="0" value={formData.formulaStoneKg}
              onChange={e => setFormData({ ...formData, formulaStoneKg: e.target.value })} className="h-8 text-sm" placeholder="kg" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pv-f-add" className="text-xs">Lts Solucion Aditivo</Label>
            <Input id="pv-f-add" type="number" step="0.01" min="0" value={formData.formulaAdditiveLts}
              onChange={e => setFormData({ ...formData, formulaAdditiveLts: e.target.value })} className="h-8 text-sm" placeholder="lts" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pv-f-daraccel" className="text-xs">Daraccel (g)</Label>
            <Input id="pv-f-daraccel" type="number" step="0.1" min="0" value={formData.formulaDaraccelGrams}
              onChange={e => setFormData({ ...formData, formulaDaraccelGrams: e.target.value })} className="h-8 text-sm" placeholder="gramos" />
          </div>
        </div>
      </div>

      {/* Proveedores - collapsible */}
      <div className="rounded-lg border border-border bg-muted/30">
        <button
          type="button"
          onClick={() => setShowSupplierPanel(!showSupplierPanel)}
          className="w-full flex items-center justify-between p-3 text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors rounded-lg"
        >
          <span className="flex items-center gap-1.5">
            <Truck className="h-3.5 w-3.5 text-muted-foreground" />
            Proveedores
            {supplierChanged && (
              <span className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded-full font-medium ml-1">
                Modificado
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground font-normal">
              {getCurrentSupplier("Cemento") !== "Sin asignar" ? `Cem: ${getCurrentSupplier("Cemento")}` : ""}
              {getCurrentSupplier("Piedra (0-6)") !== "Sin asignar" ? ` | Piedra: ${getCurrentSupplier("Piedra (0-6)")}` : ""}
            </span>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showSupplierPanel ? "rotate-180" : ""}`} />
          </div>
        </button>

        {showSupplierPanel && (
          <div className="border-t border-border p-3 space-y-3">
            <p className="text-[11px] text-muted-foreground">
              Cambia el proveedor solo cuando hubo un cambio real. El proveedor queda registrado a partir de hoy.
            </p>

            {["Cemento", "Arena", "Piedra (0-6)"].map(ingredient => {
              const current = getCurrentSupplier(ingredient)
              const options = allSuppliers.filter(s => s.ingredient_name === ingredient)
              return (
                <div key={ingredient} className="flex items-center gap-3">
                  <span className="text-xs font-medium w-24 shrink-0">{ingredient}</span>
                  <select
                    className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={current === "Sin asignar" ? "" : current}
                    onChange={e => { if (e.target.value) changeSupplier(ingredient, e.target.value) }}
                  >
                    <option value="">Sin asignar</option>
                    {options.map(s => (
                      <option key={s.id} value={s.supplier_name}>{s.supplier_name}</option>
                    ))}
                  </select>
                </div>
              )
            })}

            {supplierChanged && (
              <div className="space-y-1">
                <Label className="text-xs text-amber-700 dark:text-amber-400">Nota del cambio (opcional)</Label>
                <Textarea
                  value={supplierChangeNotes}
                  onChange={e => setSupplierChangeNotes(e.target.value)}
                  placeholder="Ej: Se cambio piedra de Piatti a Avellaneda por falta de stock..."
                  className="text-xs min-h-[50px] bg-background"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Downtimes - same format as block production */}
      <div className="space-y-2 rounded-lg border-2 border-border p-3 bg-background">
        <div className="border-b pb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">Motivos de Paradas</h2>
          <span className="text-xs text-muted-foreground">
            Total: <strong className="text-foreground">{calculatedDowntimeTotal} min</strong>
          </span>
        </div>

        {Object.entries(PAVER_DOWNTIME_CATEGORIES).map(([category, reasons]) => {
          const itemsPerColumn = Math.ceil(reasons.length / 2)
          const column1 = reasons.slice(0, itemsPerColumn)
          const column2 = reasons.slice(itemsPerColumn)

          return (
            <div key={category} className="space-y-2">
              <h4 className="text-base font-semibold text-primary bg-primary/10 px-3 py-2 rounded-md">{category}</h4>
              <div className="grid md:grid-cols-2 gap-x-4 gap-y-2">
                <div className="space-y-2">
                  {column1.map(reason => (
                    <div key={reason} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`pv-dt-${reason}`} className="text-xs flex-1">
                          {reason}
                        </Label>
                        <Input
                          id={`pv-dt-${reason}`}
                          type="number"
                          min="0"
                          placeholder="min"
                          value={downtimes[reason]?.minutes?.toString() || ""}
                          onChange={e => {
                            const value = e.target.value
                            const minutes = value === "" ? 0 : Number.parseInt(value) || 0
                            setDowntimes(prev => ({
                              ...prev,
                              [reason]: {
                                minutes,
                                comments: prev[reason]?.comments || "",
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
                          onChange={e => {
                            setDowntimes(prev => ({
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
                  {column2.map(reason => (
                    <div key={reason} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`pv-dt-${reason}`} className="text-xs flex-1">
                          {reason}
                        </Label>
                        <Input
                          id={`pv-dt-${reason}`}
                          type="number"
                          min="0"
                          placeholder="min"
                          value={downtimes[reason]?.minutes?.toString() || ""}
                          onChange={e => {
                            const value = e.target.value
                            const minutes = value === "" ? 0 : Number.parseInt(value) || 0
                            setDowntimes(prev => ({
                              ...prev,
                              [reason]: {
                                minutes,
                                comments: prev[reason]?.comments || "",
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
                          onChange={e => {
                            setDowntimes(prev => ({
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

      {/* Muestras de Calidad */}
      <div className="space-y-3 rounded-lg border-2 border-orange-200 p-3 bg-orange-50/30">
        <div className="flex items-center justify-between border-b border-orange-200 pb-2">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-orange-600" />
            <h2 className="text-lg font-bold text-foreground">Muestras de Calidad</h2>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="pv-samples-taken" className="text-sm">¿Se extrajeron muestras?</Label>
            <Switch
              id="pv-samples-taken"
              checked={samplesTaken}
              onCheckedChange={(checked) => {
                setSamplesTaken(checked)
                if (!checked) setSamples([])
              }}
            />
          </div>
        </div>

        {samplesTaken && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {samples.length} muestra{samples.length !== 1 ? "s" : ""} registrada{samples.length !== 1 ? "s" : ""}
              </span>
              <Button type="button" size="sm" variant="outline" onClick={addSample} className="gap-1">
                <Plus className="h-4 w-4" />
                Agregar Muestra
              </Button>
            </div>

            {samples.length > 0 && (
              <div className="space-y-3">
                {samples.map((sample, index) => (
                  <div key={sample.id} className="grid gap-3 p-3 border rounded-lg bg-background">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Muestra #{index + 1}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => removeSample(sample.id)}
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Nomenclatura / Codigo</Label>
                        <Input
                          value={sample.sample_code}
                          onChange={e => updateSample(sample.id, "sample_code", e.target.value)}
                          placeholder="Ej: F260420-01"
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Tipo de Adoquin</Label>
                        <Select
                          value={sample.adoquin_type}
                          onValueChange={v => updateSample(sample.id, "adoquin_type", v)}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="Seleccionar" />
                          </SelectTrigger>
                          <SelectContent>
                            {ADOQUIN_TYPES.map(t => (
                              <SelectItem key={t.code} value={t.code}>{t.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Observaciones</Label>
                        <Input
                          value={sample.observations}
                          onChange={e => updateSample(sample.id, "observations", e.target.value)}
                          placeholder="Notas de la muestra..."
                          className="h-8 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {samples.length === 0 && (
              <div className="text-center py-4 text-sm text-muted-foreground">
                No hay muestras registradas. Haga clic en "Agregar Muestra" para comenzar.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Observations */}
      <div className="space-y-1">
        <Label htmlFor="pv-observations" className="text-xs">Observaciones</Label>
        <Textarea
          id="pv-observations"
          value={observations}
          onChange={e => setObservations(e.target.value)}
          placeholder="Observaciones generales del dia..."
          className="text-sm min-h-[60px]"
        />
      </div>

      {/* Submit */}
      <div className="flex justify-end gap-2 pt-2">
        {editingRecord && onSaveComplete && (
          <Button type="button" variant="outline" onClick={onSaveComplete}>Cancelar</Button>
        )}
        <Button type="submit" disabled={loading} className="min-w-[120px]">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : editingRecord ? "Actualizar" : "Guardar Parte"}
        </Button>
      </div>

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
              <Label htmlFor="pv-formulaChangedBy">Nombre de quien modifica *</Label>
              <Input
                id="pv-formulaChangedBy"
                value={formulaChangedBy}
                onChange={(e) => setFormulaChangedBy(e.target.value)}
                placeholder="Ej: Juan Perez"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pv-formulaChangeReason">Motivo del cambio</Label>
              <Textarea
                id="pv-formulaChangeReason"
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
                setFormData(prev => ({
                  ...prev,
                  formulaCementKg: originalFormula.cement,
                  formulaSandKg: originalFormula.sand,
                  formulaStoneKg: originalFormula.stone,
                  formulaAdditiveLts: originalFormula.additive
                }))
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
