"use client"

import React, { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { FlaskConical, Grid3X3, Save, Plus, History, Loader2, FileText, Upload, AlertTriangle, Info } from "lucide-react"
import { getSupabase } from "@/lib/supabase"
import { usePlant } from "@/lib/plant-context"

// Adoquin types
const ADOQUIN_TYPES = [
  { code: "AH6", name: "Adoquin H6", height: 6 },
  { code: "AH6-R", name: "Adoquin H6 Rojo", height: 6, color: "rojo" },
  { code: "AH6-A", name: "Adoquin H6 Amarillo", height: 6, color: "amarillo" },
  { code: "AH6-N", name: "Adoquin H6 Negro", height: 6, color: "negro" },
  { code: "AH8", name: "Adoquin H8", height: 8 },
  { code: "AH8-R", name: "Adoquin H8 Rojo", height: 8, color: "rojo" },
  { code: "AH8-A", name: "Adoquin H8 Amarillo", height: 8, color: "amarillo" },
  { code: "AH8-N", name: "Adoquin H8 Negro", height: 8, color: "negro" },
]

interface PastonFormula {
  id?: number
  plant: string
  sand_kg: number
  stone_kg: number
  cement_kg: number
  sand_supplier: string
  stone_supplier: string
  cement_supplier: string
  additive_1_name: string
  additive_1_kg: number
  additive_1_pdf_url?: string
  additive_2_name: string
  additive_2_kg: number
  additive_2_pdf_url?: string
  water_liters: number
  tank_capacity_liters: number
  diluted_additive_per_paston_liters: number
  modified_by: string
  modified_at: string
}

interface AdoquinFormula {
  id?: number
  plant: string
  adoquin_type: string
  adoquin_name: string
  height_cm: number
  color?: string
  weight_kg: number
  cement_kg: number
  sand_kg: number
  stone_kg: number
  pigment_kg: number
  additive_liters: number
  cycle_time_min: number
  pieces_per_batch: number
  spec_pdf_url: string | null
  modified_by: string
  modified_at: string
}

interface Supplier {
  id: number
  name: string
  material_type: string
  product_detail: string | null
  density?: number
}

const defaultPastonFormula: PastonFormula = {
  plant: "ranchos",
  sand_kg: 0,
  stone_kg: 0,
  cement_kg: 0,
  sand_supplier: "",
  stone_supplier: "",
  cement_supplier: "",
  additive_1_name: "Mark V",
  additive_1_kg: 0,
  additive_1_pdf_url: "",
  additive_2_name: "Daraccel",
  additive_2_kg: 0,
  additive_2_pdf_url: "",
  water_liters: 0,
  tank_capacity_liters: 1000,
  diluted_additive_per_paston_liters: 0,
  modified_by: "",
  modified_at: ""
}

export function FormuleoRanchosContent() {
  const { selectedPlant } = usePlant()
  const plantValue = "ranchos"
  
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<"paston" | "adoquines">("paston")
  
  // Paston formula state
  const [pastonFormula, setPastonFormula] = useState<PastonFormula>(defaultPastonFormula)
  
  // Adoquin formulas state
  const [adoquinFormulas, setAdoquinFormulas] = useState<Record<string, AdoquinFormula>>({})
  
  // Suppliers
  const [sandSuppliers, setSandSuppliers] = useState<Supplier[]>([])
  const [stoneSuppliers, setStoneSuppliers] = useState<Supplier[]>([])
  const [cementSuppliers, setCementSuppliers] = useState<Supplier[]>([])
  
  // Additive settings
  const [additive1Unit, setAdditive1Unit] = useState<"kg" | "lts">("kg")
  const [additive2Unit, setAdditive2Unit] = useState<"kg" | "lts">("kg")
  const [additive1Density, setAdditive1Density] = useState(1.045)
  const [additive2Density, setAdditive2Density] = useState(1.35)
  
  // UI state
  const [operators, setOperators] = useState<string[]>(["Juan", "Pedro", "Carlos"])
  const [selectedOperator, setSelectedOperator] = useState("")
  const [showAddOperator, setShowAddOperator] = useState(false)
  const [newOperatorName, setNewOperatorName] = useState("")
  const [showHistory, setShowHistory] = useState(false)
  
  // Formula change tracking
  const [showFormulaChangeDialog, setShowFormulaChangeDialog] = useState(false)
  const [formulaChangeReason, setFormulaChangeReason] = useState("")
  const [formulaChangedBy, setFormulaChangedBy] = useState("")
  const [pendingFormulaSave, setPendingFormulaSave] = useState<"paston" | "adoquin" | null>(null)
  const [pendingAdoquinType, setPendingAdoquinType] = useState<string | null>(null)
  
  // Calculate additive percentage per kg of cement (same formula as Silke)
  const calculateAdditivePercentage = (additiveKg: number) => {
    if (pastonFormula.cement_kg <= 0 || pastonFormula.tank_capacity_liters <= 0 || pastonFormula.diluted_additive_per_paston_liters <= 0) return 0
    // Proporcion de aditivo en el tanque
    const additiveRatio = additiveKg / pastonFormula.tank_capacity_liters
    // Litros de este aditivo por paston
    const additivePerPaston = additiveRatio * pastonFormula.diluted_additive_per_paston_liters
    // Porcentaje sobre kg de cemento
    return (additivePerPaston / pastonFormula.cement_kg) * 100
  }
  
  const markVPercentage = calculateAdditivePercentage(pastonFormula.additive_1_kg)
  const daraccelPercentage = calculateAdditivePercentage(pastonFormula.additive_2_kg)

  // Load data
  useEffect(() => {
    loadData()
  }, [])
  
  const loadData = async () => {
    setLoading(true)
    const supabase = getSupabase()
    
    // Load paston formula
    const { data: pastonData } = await supabase
      .from("paston_formulas")
      .select("*")
      .eq("plant", plantValue)
      .order("modified_at", { ascending: false })
      .limit(1)
      .single()
    
    if (pastonData) {
      setPastonFormula(pastonData)
    }
    
    // Load adoquin formulas
    const { data: adoquinData } = await supabase
      .from("paver_mix_designs")
      .select("*")
      .eq("plant", plantValue)
      .eq("is_active", true)
    
    if (adoquinData) {
      const formulas: Record<string, AdoquinFormula> = {}
      adoquinData.forEach((f: AdoquinFormula) => {
        formulas[f.adoquin_type] = f
      })
      setAdoquinFormulas(formulas)
    }
    
    // Load suppliers
    const { data: suppliers } = await supabase
      .from("suppliers")
      .select("*")
      .eq("plant", plantValue)
      .eq("is_active", true)
    
    if (suppliers) {
      setSandSuppliers(suppliers.filter((s: Supplier) => s.material_type === "Arena"))
      setStoneSuppliers(suppliers.filter((s: Supplier) => s.material_type === "Piedra"))
      setCementSuppliers(suppliers.filter((s: Supplier) => s.material_type === "Cemento"))
    }
    
    setLoading(false)
  }
  
  // Request paston save - always ask for name and reason
  const requestPastonSave = () => {
    setShowFormulaChangeDialog(true)
    setPendingFormulaSave("paston")
  }
  
  // Save paston formula (called after dialog confirmation)
  const savePastonFormula = async () => {
    if (!formulaChangedBy) {
      return // Safety check - should have name from dialog
    }
    
    setSaving(true)
    const supabase = getSupabase()
    
    const dataToSave = {
      plant: plantValue,
      sand_kg: pastonFormula.sand_kg,
      sand_supplier: pastonFormula.sand_supplier,
      stone_kg: pastonFormula.stone_kg,
      stone_supplier: pastonFormula.stone_supplier,
      cement_kg: pastonFormula.cement_kg,
      cement_supplier: pastonFormula.cement_supplier,
      tank_capacity_liters: pastonFormula.tank_capacity_liters,
      additive_1_kg: pastonFormula.additive_1_kg,
      additive_1_name: pastonFormula.additive_1_name || "Mark V",
      additive_1_pdf_url: pastonFormula.additive_1_pdf_url || null,
      additive_2_kg: pastonFormula.additive_2_kg,
      additive_2_name: pastonFormula.additive_2_name || "Daraccel",
      additive_2_pdf_url: pastonFormula.additive_2_pdf_url || null,
      water_in_tank_liters: pastonFormula.tank_capacity_liters - pastonFormula.additive_1_kg - pastonFormula.additive_2_kg,
      diluted_additive_per_paston_liters: pastonFormula.diluted_additive_per_paston_liters,
      modified_by: formulaChangedBy,
      modified_at: new Date().toISOString(),
      is_active: true
    }
    
    let savedData = null
    
    if (pastonFormula.id) {
      const { data, error } = await supabase
        .from("paston_formulas")
        .update(dataToSave)
        .eq("id", pastonFormula.id)
        .select()
        .single()
      
      if (error) {
        console.error("[v0] Error updating paston formula:", error)
      } else {
        savedData = data
      }
    } else {
      const { data, error } = await supabase
        .from("paston_formulas")
        .insert(dataToSave)
        .select()
        .single()
      
      if (error) {
        console.error("[v0] Error inserting paston formula:", error)
      } else {
        savedData = data
      }
    }
    
    if (savedData) {
      setPastonFormula(savedData)
    }
    
    // Log formula change (always log when saving)
    await supabase
      .from("paver_formula_changes")
      .insert({
        plant: plantValue,
        formula_type: "paston",
        changed_by: formulaChangedBy,
        change_reason: formulaChangeReason || "Actualizacion de formula",
        previous_values: JSON.stringify(pastonFormula),
        new_values: JSON.stringify(dataToSave)
      })
    
    setFormulaChangeReason("")
    setFormulaChangedBy("")
    setSaving(false)
  }
  
  // Request adoquin save with change tracking
  const requestAdoquinSave = (adoquinType: string) => {
    if (!selectedOperator) {
      setShowFormulaChangeDialog(true)
      setPendingFormulaSave("adoquin")
      setPendingAdoquinType(adoquinType)
      return
    }
    saveAdoquinFormula(adoquinType)
  }
  
  // Save adoquin formula
  const saveAdoquinFormula = async (adoquinType: string) => {
    setSaving(true)
    const supabase = getSupabase()
    
    const formula = adoquinFormulas[adoquinType]
    if (!formula) {
      setSaving(false)
      return
    }
    
    const dataToSave = {
      ...formula,
      plant: plantValue,
      modified_by: formulaChangedBy || selectedOperator,
      modified_at: new Date().toISOString()
    }
    
    if (formula.id) {
      await supabase
        .from("paver_mix_designs")
        .update(dataToSave)
        .eq("id", formula.id)
    } else {
      const adoquinInfo = ADOQUIN_TYPES.find(a => a.code === adoquinType)
      const { data } = await supabase
        .from("paver_mix_designs")
        .insert({
          ...dataToSave,
          adoquin_type: adoquinType,
          adoquin_name: adoquinInfo?.name || adoquinType,
          height_cm: adoquinInfo?.height || 6,
          color: adoquinInfo?.color || null,
          is_active: true
        })
        .select()
        .single()
      
      if (data) {
        setAdoquinFormulas(prev => ({
          ...prev,
          [adoquinType]: data
        }))
      }
    }
    
    // Log formula change if reason provided
    if (formulaChangeReason) {
      await supabase
        .from("paver_formula_changes")
        .insert({
          plant: plantValue,
          formula_type: "adoquin",
          adoquin_type: adoquinType,
          changed_by: formulaChangedBy || selectedOperator,
          change_reason: formulaChangeReason,
          previous_values: JSON.stringify(formula),
          new_values: JSON.stringify(dataToSave)
        })
    }
    
    setFormulaChangeReason("")
    setFormulaChangedBy("")
    setPendingAdoquinType(null)
    setSaving(false)
  }
  
  // Handle formula change dialog confirm
  const handleFormulaChangeConfirm = () => {
    if (!formulaChangedBy) return
    
    setShowFormulaChangeDialog(false)
    
    if (pendingFormulaSave === "paston") {
      savePastonFormula()
    } else if (pendingFormulaSave === "adoquin" && pendingAdoquinType) {
      saveAdoquinFormula(pendingAdoquinType)
    }
    
    setPendingFormulaSave(null)
  }
  
  // Update adoquin formula field
  const updateAdoquinFormula = (adoquinType: string, field: keyof AdoquinFormula, value: number | string) => {
    setAdoquinFormulas(prev => {
      const current = prev[adoquinType] || {
        plant: plantValue,
        adoquin_type: adoquinType,
        adoquin_name: ADOQUIN_TYPES.find(a => a.code === adoquinType)?.name || adoquinType,
        height_cm: ADOQUIN_TYPES.find(a => a.code === adoquinType)?.height || 6,
        color: ADOQUIN_TYPES.find(a => a.code === adoquinType)?.color || null,
        weight_kg: 0,
        cement_kg: 0,
        sand_kg: 0,
        stone_kg: 0,
        pigment_kg: 0,
        additive_liters: 0,
        cycle_time_min: 0,
        pieces_per_batch: 0,
        spec_pdf_url: null,
        modified_by: "",
        modified_at: ""
      }
      
      return {
        ...prev,
        [adoquinType]: {
          ...current,
          [field]: value
        }
      }
    })
  }
  
  // Calculate from paston
  const calculateAdoquinFromPaston = (adoquinType: string) => {
    const adoquinInfo = ADOQUIN_TYPES.find(a => a.code === adoquinType)
    if (!adoquinInfo) return
    
    const formula = adoquinFormulas[adoquinType]
    if (!formula?.weight_kg || formula.weight_kg <= 0) return
    
    // Assuming paston formula is for a standard batch
    const totalPastonKg = pastonFormula.cement_kg + pastonFormula.sand_kg + pastonFormula.stone_kg
    if (totalPastonKg <= 0) return
    
    const ratio = formula.weight_kg / totalPastonKg
    
    setAdoquinFormulas(prev => ({
      ...prev,
      [adoquinType]: {
        ...prev[adoquinType],
        cement_kg: pastonFormula.cement_kg * ratio,
        sand_kg: pastonFormula.sand_kg * ratio,
        stone_kg: pastonFormula.stone_kg * ratio,
        additive_liters: (pastonFormula.additive_1_kg + pastonFormula.additive_2_kg) * ratio / additive1Density
      }
    }))
  }
  
  // Save PDF URL
  const savePdfUrl = async (adoquinType: string, pdfUrl: string) => {
    const supabase = getSupabase()
    const formula = adoquinFormulas[adoquinType]
    
    if (formula?.id) {
      await supabase
        .from("paver_mix_designs")
        .update({ spec_pdf_url: pdfUrl })
        .eq("id", formula.id)
    }
    
    setAdoquinFormulas(prev => ({
      ...prev,
      [adoquinType]: { ...prev[adoquinType], spec_pdf_url: pdfUrl }
    }))
  }
  
  // Add operator
  const addOperator = () => {
    if (newOperatorName && !operators.includes(newOperatorName)) {
      setOperators(prev => [...prev, newOperatorName])
      setSelectedOperator(newOperatorName)
      setNewOperatorName("")
      setShowAddOperator(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FlaskConical className="w-5 h-5" />
            Formuleo - Ranchos
          </h2>
          <p className="text-sm text-muted-foreground">
            Configuracion de formulas de paston y adoquines
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <Select value={selectedOperator} onValueChange={setSelectedOperator}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Operario" />
            </SelectTrigger>
            <SelectContent>
              {operators.map(op => (
                <SelectItem key={op} value={op}>{op}</SelectItem>
              ))}
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full justify-start mt-1"
                onClick={() => setShowAddOperator(true)}
              >
                <Plus className="w-3 h-3 mr-1" /> Agregar operario
              </Button>
            </SelectContent>
          </Select>
          
          <Button variant="outline" size="sm" onClick={() => setShowHistory(true)}>
            <History className="w-4 h-4 mr-1" /> Historial
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "paston" | "adoquines")}>
        <TabsList>
          <TabsTrigger value="paston" className="gap-1">
            <FlaskConical className="w-4 h-4" /> Formula Paston
          </TabsTrigger>
          <TabsTrigger value="adoquines" className="gap-1">
            <Grid3X3 className="w-4 h-4" /> Formulas Adoquines
          </TabsTrigger>
        </TabsList>

        {/* PASTON TAB */}
        <TabsContent value="paston" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Formula del Paston</CardTitle>
                {pastonFormula.modified_at && (
                  <Badge variant="outline" className="text-[10px]">
                    Modificado: {new Date(pastonFormula.modified_at).toLocaleDateString("es-AR")} por {pastonFormula.modified_by}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Agregados */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Arena */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Arena</Label>
                  <Select
                    value={pastonFormula.sand_supplier}
                    onValueChange={(value) => setPastonFormula(prev => ({ ...prev, sand_supplier: value }))}
                  >
                    <SelectTrigger className="text-xs">
                      <SelectValue placeholder="Seleccionar arena" />
                    </SelectTrigger>
                    <SelectContent>
                      {sandSuppliers.length > 0 ? (
                        sandSuppliers.map((s) => (
                          <SelectItem key={s.id} value={`${s.product_detail || s.material_type} - ${s.name}`}>
                            {s.product_detail || s.material_type} - {s.name}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="sin-proveedor" disabled>No hay proveedores cargados</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    value={pastonFormula.sand_kg || ""}
                    onChange={(e) => setPastonFormula(prev => ({ ...prev, sand_kg: parseFloat(e.target.value) || 0 }))}
                    placeholder="Kg por paston"
                    className="text-xs"
                  />
                </div>
                
                {/* Piedra */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Piedra</Label>
                  <Select
                    value={pastonFormula.stone_supplier}
                    onValueChange={(value) => setPastonFormula(prev => ({ ...prev, stone_supplier: value }))}
                  >
                    <SelectTrigger className="text-xs">
                      <SelectValue placeholder="Seleccionar piedra" />
                    </SelectTrigger>
                    <SelectContent>
                      {stoneSuppliers.length > 0 ? (
                        stoneSuppliers.map((s) => (
                          <SelectItem key={s.id} value={`${s.product_detail || s.material_type} - ${s.name}`}>
                            {s.product_detail || s.material_type} - {s.name}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="sin-proveedor" disabled>No hay proveedores cargados</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    value={pastonFormula.stone_kg || ""}
                    onChange={(e) => setPastonFormula(prev => ({ ...prev, stone_kg: parseFloat(e.target.value) || 0 }))}
                    placeholder="Kg por paston"
                    className="text-xs"
                  />
                </div>
                
                {/* Cemento */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Cemento</Label>
                  <Select
                    value={pastonFormula.cement_supplier}
                    onValueChange={(value) => setPastonFormula(prev => ({ ...prev, cement_supplier: value }))}
                  >
                    <SelectTrigger className="text-xs">
                      <SelectValue placeholder="Seleccionar cemento" />
                    </SelectTrigger>
                    <SelectContent>
                      {cementSuppliers.length > 0 ? (
                        cementSuppliers.map((s) => (
                          <SelectItem key={s.id} value={`${s.product_detail || s.material_type} - ${s.name}`}>
                            {s.product_detail || s.material_type} - {s.name}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="sin-proveedor" disabled>No hay proveedores cargados</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    value={pastonFormula.cement_kg || ""}
                    onChange={(e) => setPastonFormula(prev => ({ ...prev, cement_kg: parseFloat(e.target.value) || 0 }))}
                    placeholder="Kg por paston"
                    className="text-xs"
                  />
                </div>
              </div>

              {/* Tanque de aditivos */}
              <div className="border rounded-lg p-4 bg-muted/30">
                <div className="flex items-center gap-3 mb-3">
                  <h4 className="font-medium text-sm">Tanque de Aditivo Diluido</h4>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      value={pastonFormula.tank_capacity_liters || ""}
                      onChange={(e) => setPastonFormula(prev => ({ ...prev, tank_capacity_liters: parseFloat(e.target.value) || 1000 }))}
                      className="h-7 w-20 text-xs text-center"
                    />
                    <span className="text-xs text-muted-foreground">L</span>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {/* Mark V */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium">Mark V</Label>
                      <div className="flex items-center gap-1">
                        {pastonFormula.additive_1_pdf_url && (
                          <a href={pastonFormula.additive_1_pdf_url} target="_blank" rel="noopener noreferrer">
                            <Button variant="outline" size="sm" className="h-6 px-2 text-blue-600 gap-1">
                              <FileText className="w-3 h-3" />
                              <span className="text-[10px]">Ver ficha</span>
                            </Button>
                          </a>
                        )}
                        <label className="cursor-pointer">
                          <input
                            type="file"
                            accept=".pdf"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0]
                              if (!file) return
                              const formData = new FormData()
                              formData.append("file", file)
                              formData.append("folder", "fichas-tecnicas/aditivos")
                              const response = await fetch("/api/upload-pdf", { method: "POST", body: formData })
                              if (response.ok) {
                                const { url } = await response.json()
                                setPastonFormula(prev => ({ ...prev, additive_1_pdf_url: url }))
                              }
                            }}
                          />
                          <Button variant="ghost" size="sm" className="h-6 px-2 gap-1" asChild>
                            <span>
                              <Upload className="w-3 h-3" />
                              <span className="text-[10px]">{pastonFormula.additive_1_pdf_url ? "Cambiar" : "Subir"}</span>
                            </span>
                          </Button>
                        </label>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        value={pastonFormula.additive_1_kg || ""}
                        onChange={(e) => setPastonFormula(prev => ({ ...prev, additive_1_kg: parseFloat(e.target.value) || 0 }))}
                        placeholder="0"
                        className="flex-1"
                      />
                      <Select value={additive1Unit} onValueChange={(v) => setAdditive1Unit(v as "kg" | "lts")}>
                        <SelectTrigger className="w-20 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="kg">Kg</SelectItem>
                          <SelectItem value="lts">Lts</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2 text-[10px]">
                      <Label className="text-[10px] text-muted-foreground">Densidad:</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={additive1Density}
                        onChange={(e) => setAdditive1Density(parseFloat(e.target.value) || 1)}
                        className="h-6 w-16 text-[10px]"
                      />
                      <span className="text-muted-foreground">kg/L</span>
                    </div>
                    <p className={`text-xs font-medium ${markVPercentage > 0 ? "text-green-600" : "text-muted-foreground"}`}>
                      {markVPercentage.toFixed(4)}% sobre cemento
                    </p>
                  </div>
                  
                  {/* Daraccel */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium">Daraccel</Label>
                      <div className="flex items-center gap-1">
                        {pastonFormula.additive_2_pdf_url && (
                          <a href={pastonFormula.additive_2_pdf_url} target="_blank" rel="noopener noreferrer">
                            <Button variant="outline" size="sm" className="h-6 px-2 text-blue-600 gap-1">
                              <FileText className="w-3 h-3" />
                              <span className="text-[10px]">Ver ficha</span>
                            </Button>
                          </a>
                        )}
                        <label className="cursor-pointer">
                          <input
                            type="file"
                            accept=".pdf"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0]
                              if (!file) return
                              const formData = new FormData()
                              formData.append("file", file)
                              formData.append("folder", "fichas-tecnicas/aditivos")
                              const response = await fetch("/api/upload-pdf", { method: "POST", body: formData })
                              if (response.ok) {
                                const { url } = await response.json()
                                setPastonFormula(prev => ({ ...prev, additive_2_pdf_url: url }))
                              }
                            }}
                          />
                          <Button variant="ghost" size="sm" className="h-6 px-2 gap-1" asChild>
                            <span>
                              <Upload className="w-3 h-3" />
                              <span className="text-[10px]">{pastonFormula.additive_2_pdf_url ? "Cambiar" : "Subir"}</span>
                            </span>
                          </Button>
                        </label>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        value={pastonFormula.additive_2_kg || ""}
                        onChange={(e) => setPastonFormula(prev => ({ ...prev, additive_2_kg: parseFloat(e.target.value) || 0 }))}
                        placeholder="0"
                        className="flex-1"
                      />
                      <Select value={additive2Unit} onValueChange={(v) => setAdditive2Unit(v as "kg" | "lts")}>
                        <SelectTrigger className="w-20 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="kg">Kg</SelectItem>
                          <SelectItem value="lts">Lts</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2 text-[10px]">
                      <Label className="text-[10px] text-muted-foreground">Densidad:</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={additive2Density}
                        onChange={(e) => setAdditive2Density(parseFloat(e.target.value) || 1)}
                        className="h-6 w-16 text-[10px]"
                      />
                      <span className="text-muted-foreground">kg/L</span>
                    </div>
                    <p className={`text-xs font-medium ${daraccelPercentage > 0 ? "text-green-600" : "text-muted-foreground"}`}>
                      {daraccelPercentage.toFixed(4)}% sobre cemento
                    </p>
                  </div>
                  
                  {/* Agua (calculada automaticamente) */}
                  <div className="space-y-2">
                    <Label className="text-xs font-medium">Agua (L)</Label>
                    <Input
                      type="number"
                      value={(() => {
                        const add1Liters = pastonFormula.additive_1_kg / additive1Density
                        const add2Liters = pastonFormula.additive_2_kg / additive2Density
                        return (pastonFormula.tank_capacity_liters - add1Liters - add2Liters).toFixed(1)
                      })()}
                      disabled
                      className="bg-muted"
                    />
                    <p className="text-[10px] text-muted-foreground">Calculado automaticamente</p>
                  </div>
                  
                  {/* Litros por paston */}
                  <div className="space-y-2">
                    <Label className="text-xs font-medium">Diluido/Paston (L)</Label>
                    <Input
                      type="number"
                      value={pastonFormula.diluted_additive_per_paston_liters || ""}
                      onChange={(e) => setPastonFormula(prev => ({ ...prev, diluted_additive_per_paston_liters: parseFloat(e.target.value) || 0 }))}
                      placeholder="0"
                    />
                    <p className="text-[10px] text-muted-foreground">Litros de mezcla por paston</p>
                  </div>
                </div>
                
                {/* Resumen de dosificacion */}
                <div className="mt-4 p-3 bg-background rounded border">
                  <div className="flex items-center gap-2 mb-2">
                    <Info className="w-4 h-4 text-blue-500" />
                    <span className="text-xs font-medium">Dosificacion de aditivos por kg de cemento:</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="flex justify-between">
                      <span>Mark V:</span>
                      <span className="font-mono font-medium">{markVPercentage.toFixed(3)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Daraccel:</span>
                      <span className="font-mono font-medium">{daraccelPercentage.toFixed(3)}%</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Save button */}
              <div className="flex justify-end">
                <Button onClick={requestPastonSave} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  Guardar Formula Paston
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ADOQUINES TAB */}
        <TabsContent value="adoquines" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Formulas por Tipo de Adoquin</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-2 px-2 font-medium">Tipo</th>
                      <th className="text-center py-2 px-2 font-medium">Peso (kg)</th>
                      <th className="text-center py-2 px-2 font-medium">Modificado</th>
                      <th className="py-2 px-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {ADOQUIN_TYPES.map((adoquin, idx) => {
                      const formula = adoquinFormulas[adoquin.code] || {
                        plant: plantValue,
                        adoquin_type: adoquin.code,
                        adoquin_name: adoquin.name,
                        height_cm: adoquin.height,
                        color: adoquin.color || null,
                        weight_kg: 0,
                        cement_kg: 0,
                        sand_kg: 0,
                        stone_kg: 0,
                        pigment_kg: 0,
                        additive_liters: 0,
                        cycle_time_min: 0,
                        pieces_per_batch: 0,
                        spec_pdf_url: null,
                        modified_by: "",
                        modified_at: ""
                      }
                      
                      // Calculate aggregates from paston formula based on adoquin weight
                      // Total weight of aggregates in 1 paston
                      const pastonTotalAggregates = pastonFormula.cement_kg + pastonFormula.sand_kg + pastonFormula.stone_kg
                      
                      // If we have paston formula, calculate proportions for this adoquin
                      const adoquinWeight = formula.weight_kg || 0
                      
                      // Percentages from paston formula
                      const cementPct = pastonTotalAggregates > 0 ? (pastonFormula.cement_kg / pastonTotalAggregates * 100) : 0
                      const sandPct = pastonTotalAggregates > 0 ? (pastonFormula.sand_kg / pastonTotalAggregates * 100) : 0
                      const stonePct = pastonTotalAggregates > 0 ? (pastonFormula.stone_kg / pastonTotalAggregates * 100) : 0
                      
                      // Calculate kg per adoquin based on weight and percentages
                      const cementKgPerAdoquin = adoquinWeight * (cementPct / 100)
                      const sandKgPerAdoquin = adoquinWeight * (sandPct / 100)
                      const stoneKgPerAdoquin = adoquinWeight * (stonePct / 100)
                      
                      return (
                        <React.Fragment key={adoquin.code}>
                          <tr className={idx % 2 === 1 ? "bg-muted/30" : ""}>
                            <td className="py-2 px-2 font-medium" rowSpan={2}>
                              <div>
                                {adoquin.name}
                                {adoquin.color && (
                                  <Badge 
                                    variant="outline" 
                                    className={`ml-2 text-[10px] ${
                                      adoquin.color === "rojo" ? "border-red-500 text-red-600" :
                                      adoquin.color === "amarillo" ? "border-yellow-500 text-yellow-600" :
                                      "border-gray-500 text-gray-600"
                                    }`}
                                  >
                                    {adoquin.color}
                                  </Badge>
                                )}
                              </div>
                            </td>
                            <td className="py-1 px-1" rowSpan={2}>
                              <Input
                                type="number"
                                value={formula.weight_kg || ""}
                                onChange={(e) => updateAdoquinFormula(adoquin.code, "weight_kg", parseFloat(e.target.value) || 0)}
                                className="h-8 w-20 text-center text-xs"
                                placeholder="0"
                              />
                            </td>
                            <td className="py-2 px-2 text-center text-[10px] text-muted-foreground" rowSpan={2}>
                              {formula.modified_at ? (
                                <>
                                  {new Date(formula.modified_at).toLocaleDateString("es-AR")}
                                  <br />
                                  {formula.modified_by}
                                </>
                              ) : "-"}
                            </td>
                            <td className="py-1 px-1" rowSpan={2}>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => requestAdoquinSave(adoquin.code)}
                                disabled={saving}
                                className="h-8 w-8 p-0"
                              >
                                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                              </Button>
                            </td>
                          </tr>
                          {/* Detail row with aggregates */}
                          <tr className={`${idx % 2 === 1 ? "bg-muted/30" : ""} border-b`}>
                            <td colSpan={3} className="py-2 px-3">
                              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                                {/* Cemento */}
                                <div className="bg-slate-100 dark:bg-slate-800 p-2 rounded">
                                  <div className="font-medium text-slate-600 dark:text-slate-400">Cemento</div>
                                  <div className="text-[10px] text-muted-foreground truncate">
                                    {pastonFormula.cement_supplier || "Sin especificar"}
                                  </div>
                                  <div className="font-mono font-bold">{cementKgPerAdoquin.toFixed(2)} kg</div>
                                  <div className="text-muted-foreground">{cementPct.toFixed(1)}%</div>
                                </div>
                                {/* Arena */}
                                <div className="bg-amber-100 dark:bg-amber-900/30 p-2 rounded">
                                  <div className="font-medium text-amber-600 dark:text-amber-400">Arena</div>
                                  <div className="text-[10px] text-muted-foreground truncate">
                                    {pastonFormula.sand_supplier || "Sin especificar"}
                                  </div>
                                  <div className="font-mono font-bold">{sandKgPerAdoquin.toFixed(2)} kg</div>
                                  <div className="text-muted-foreground">{sandPct.toFixed(1)}%</div>
                                </div>
                                {/* Piedra */}
                                <div className="bg-indigo-100 dark:bg-indigo-900/30 p-2 rounded">
                                  <div className="font-medium text-indigo-600 dark:text-indigo-400">Piedra</div>
                                  <div className="text-[10px] text-muted-foreground truncate">
                                    {pastonFormula.stone_supplier || "Sin especificar"}
                                  </div>
                                  <div className="font-mono font-bold">{stoneKgPerAdoquin.toFixed(2)} kg</div>
                                  <div className="text-muted-foreground">{stonePct.toFixed(1)}%</div>
                                </div>
                                {/* Pigmento (solo para colores) */}
                                {adoquin.color && (
                                  <div className={`p-2 rounded ${
                                    adoquin.color === "rojo" ? "bg-red-100 dark:bg-red-900/30" :
                                    adoquin.color === "amarillo" ? "bg-yellow-100 dark:bg-yellow-900/30" :
                                    "bg-gray-100 dark:bg-gray-900/30"
                                  }`}>
                                    <div className={`font-medium ${
                                      adoquin.color === "rojo" ? "text-red-600" :
                                      adoquin.color === "amarillo" ? "text-yellow-600" :
                                      "text-gray-600"
                                    }`}>Pigmento</div>
                                    <Input
                                      type="number"
                                      value={formula.pigment_kg || ""}
                                      onChange={(e) => updateAdoquinFormula(adoquin.code, "pigment_kg", parseFloat(e.target.value) || 0)}
                                      className="h-6 w-16 text-xs mt-1"
                                      placeholder="kg"
                                    />
                                  </div>
                                )}
                                {/* Aditivos */}
                                <div className="bg-emerald-100 dark:bg-emerald-900/30 p-2 rounded">
                                  <div className="font-medium text-emerald-600 dark:text-emerald-400">Aditivos</div>
                                  <div className="space-y-1 text-[10px]">
                                    <div>
                                      <span className="text-muted-foreground">Mark V:</span>{" "}
                                      <span className="font-mono font-bold">
                                        {markVPercentage.toFixed(2)}% cem.
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Daraccel:</span>{" "}
                                      <span className="font-mono font-bold">
                                        {daraccelPercentage.toFixed(2)}% cem.
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Formula Change Dialog */}
      <Dialog open={showFormulaChangeDialog} onOpenChange={setShowFormulaChangeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Registrar Cambio de Formula
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Estas por modificar la formula. Por favor indica quien realiza el cambio y el motivo.
            </p>
            <div className="space-y-2">
              <Label>Nombre de quien realiza el cambio</Label>
              <Input
                value={formulaChangedBy}
                onChange={(e) => setFormulaChangedBy(e.target.value)}
                placeholder="Tu nombre"
              />
            </div>
            <div className="space-y-2">
              <Label>Motivo del cambio</Label>
              <Textarea
                value={formulaChangeReason}
                onChange={(e) => setFormulaChangeReason(e.target.value)}
                placeholder="Explica porque se realiza esta modificacion..."
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => {
                setShowFormulaChangeDialog(false)
                setPendingFormulaSave(null)
                setPendingAdoquinType(null)
              }}>
                Cancelar
              </Button>
              <Button onClick={handleFormulaChangeConfirm} disabled={!formulaChangedBy}>
                Confirmar y Guardar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Operator Dialog */}
      <Dialog open={showAddOperator} onOpenChange={setShowAddOperator}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar Operario</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nombre del operario</Label>
              <Input
                value={newOperatorName}
                onChange={(e) => setNewOperatorName(e.target.value)}
                placeholder="Nombre completo"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAddOperator(false)}>
                Cancelar
              </Button>
              <Button onClick={addOperator} disabled={!newOperatorName}>
                Agregar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
