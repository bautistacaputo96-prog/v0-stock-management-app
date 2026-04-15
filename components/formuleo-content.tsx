"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { getSupabase } from "@/lib/supabase"
import { usePlant } from "@/lib/plant-context"
import { Loader2, Save, FileText, Plus, Trash2, History, FlaskConical, Cylinder, Info } from "lucide-react"

// Operadores disponibles
const OPERATORS = ["Emanuel Perez", "Bautista Caputo"]

// Diámetros por planta
const PIPE_DIAMETERS_BY_PLANT: Record<string, number[]> = {
  "silke": [300, 400, 500, 600],
  "villa-rosa": [300, 400, 500, 600], // Mismos que Silke por defecto
  "mercedes": [800, 1000, 1200]
}

interface PastonFormula {
  id?: number
  plant: string
  sand_kg: number
  sand_supplier: string
  stone_kg: number
  stone_supplier: string
  cement_kg: number
  cement_supplier: string
  tank_capacity_liters: number // Tanque de 1000L generalmente
  additive_1_kg: number // Mark V (en kg/litros)
  additive_1_name: string
  additive_2_kg: number // Daraccel (en kg/litros)
  additive_2_name: string
  water_in_tank_liters: number // Calculado: tank - aditivos
  diluted_additive_per_paston_liters: number // Litros de aditivo diluido por pastón
  modified_by: string
  modified_at: string
  is_active: boolean
}

interface PipeFormula {
  id?: string
  plant: string
  pipe_size: number
  paston_formula_id: string
  pipe_weight_kg: number
  cement_kg: number
  sand_kg: number
  stone_kg: number
  additive_liters: number
  modified_by: string
  modified_at: string
}

interface Supplier {
  id: number
  name: string
  material_type: string
  product_detail: string | null
  line_type: string
  density: number | null
  unit: string | null
}

export function FormuleoContent() {
  const { selectedPlant } = usePlant()
  const plantValue = selectedPlant === "villa-rosa" ? "villa_rosa" : selectedPlant || "silke"
  const pipeDiameters = PIPE_DIAMETERS_BY_PLANT[selectedPlant || "silke"] || [300, 400, 500, 600]
  
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<"paston" | "canos">("paston")
  
  // Paston formula state
  const [pastonFormula, setPastonFormula] = useState<PastonFormula>({
    plant: plantValue,
    sand_kg: 0,
    sand_supplier: "",
    stone_kg: 0,
    stone_supplier: "",
    cement_kg: 0,
    cement_supplier: "",
    tank_capacity_liters: 1000,
    additive_1_kg: 0,
    additive_1_name: "Mark V",
    additive_2_kg: 0,
    additive_2_name: "Daraccel",
    water_in_tank_liters: 1000,
    diluted_additive_per_paston_liters: 0,
    modified_by: OPERATORS[0],
    modified_at: new Date().toISOString(),
    is_active: true
  })
  
  // Pipe formulas state
  const [pipeFormulas, setPipeFormulas] = useState<Record<number, PipeFormula>>({})
  const [selectedOperator, setSelectedOperator] = useState(OPERATORS[0])
  const [customOperator, setCustomOperator] = useState("")
  const [showAddOperator, setShowAddOperator] = useState(false)
  const [operators, setOperators] = useState<string[]>(OPERATORS)
  
  // Additive unit state (kg or liters)
  const [additive1Unit, setAdditive1Unit] = useState<"kg" | "lts">("kg")
  const [additive2Unit, setAdditive2Unit] = useState<"kg" | "lts">("kg")
  const [additive1Density, setAdditive1Density] = useState<number>(1.2) // Default density for Mark V
  const [additive2Density, setAdditive2Density] = useState<number>(1.3) // Default density for Daraccel
  
  // History dialog
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<any[]>([])
  
  // Save confirmation dialog
  const [showSaveConfirm, setShowSaveConfirm] = useState(false)
  const [saveOperator, setSaveOperator] = useState("")
  const [saveReason, setSaveReason] = useState("")
  const [pendingSaveType, setPendingSaveType] = useState<"paston" | "pipe" | null>(null)
  const [pendingPipeDiameter, setPendingPipeDiameter] = useState<number | null>(null)
  
  // Technical sheet dialogs
  const [showMarkVSheet, setShowMarkVSheet] = useState(false)
  const [showDaraccelSheet, setShowDaraccelSheet] = useState(false)
  
  // Suppliers from materia prima
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [sandSuppliers, setSandSuppliers] = useState<Supplier[]>([])
  const [stoneSuppliers, setStoneSuppliers] = useState<Supplier[]>([])
  const [cementSuppliers, setCementSuppliers] = useState<Supplier[]>([])
  const [additiveSuppliers, setAdditiveSuppliers] = useState<Supplier[]>([])

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true)
    const supabase = getSupabase()
    
    try {
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
      
      // Load pipe formulas
      const { data: pipeData } = await supabase
        .from("pipe_mix_designs")
        .select("*")
        .eq("plant", plantValue)
      
      if (pipeData) {
        const formulas: Record<number, PipeFormula> = {}
        pipeData.forEach((p: any) => {
          formulas[p.diameter] = {
            id: p.id,
            plant: p.plant,
            pipe_size: p.diameter,
            paston_formula_id: pastonData?.id || "",
            pipe_weight_kg: p.pipe_weight_kg || 0,
            cement_kg: p.cement_kg || 0,
            sand_kg: p.sand_kg || 0,
            stone_kg: p.stone_kg || 0,
            additive_liters: p.additive_liters || 0,
            modified_by: p.modified_by || OPERATORS[0],
            modified_at: p.modified_at || new Date().toISOString()
          }
        })
        setPipeFormulas(formulas)
      }
      
      // Load operators
      const { data: opsData } = await supabase
        .from("formuleo_operators")
        .select("name")
        .eq("is_active", true)
      
      if (opsData && opsData.length > 0) {
        const customOps = opsData.map((o: any) => o.name).filter((n: string) => !OPERATORS.includes(n))
        setOperators([...OPERATORS, ...customOps])
      }
      
      // Load suppliers from materia prima - all active suppliers
      const { data: suppliersData, error: suppliersError } = await supabase
        .from("suppliers")
        .select("*")
        .eq("is_active", true)
      

      
      if (suppliersData) {
        setSuppliers(suppliersData)
        // Filter by material type or product detail - case insensitive
        const matchesMaterial = (s: Supplier, keywords: string[]) => {
          const type = s.material_type?.toLowerCase() || ""
          const detail = s.product_detail?.toLowerCase() || ""
          return keywords.some(k => type.includes(k) || detail.includes(k))
        }
        
        const sand = suppliersData.filter((s: Supplier) => 
          matchesMaterial(s, ["arena"])
        )
        const stone = suppliersData.filter((s: Supplier) => 
          matchesMaterial(s, ["piedra"])
        )
        const cement = suppliersData.filter((s: Supplier) => 
          matchesMaterial(s, ["cemento", "cpc"])
        )
        const additives = suppliersData.filter((s: Supplier) => 
          matchesMaterial(s, ["aditivo", "mark", "darac", "additive"])
        )
        

        
        setSandSuppliers(sand)
        setStoneSuppliers(stone)
        setCementSuppliers(cement)
        setAdditiveSuppliers(additives)
      }
      
    } catch (error) {
      console.error("Error loading formuleo data:", error)
    } finally {
      setLoading(false)
    }
  }, [plantValue])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Calculate water liters when additives change
  useEffect(() => {
    const water = pastonFormula.tank_capacity_liters - pastonFormula.additive_1_kg - pastonFormula.additive_2_kg
    setPastonFormula(prev => ({ ...prev, water_in_tank_liters: Math.max(0, water) }))
  }, [pastonFormula.tank_capacity_liters, pastonFormula.additive_1_kg, pastonFormula.additive_2_kg])

  // Calculate additive percentages per kg of cement
  const calculateAdditivePercentage = (additiveKg: number) => {
    if (pastonFormula.cement_kg <= 0 || pastonFormula.tank_capacity_liters <= 0 || pastonFormula.diluted_additive_per_paston_liters <= 0) return 0
    // Proporción de aditivo en el tanque
    const additiveRatio = additiveKg / pastonFormula.tank_capacity_liters
    // Litros de este aditivo por pastón
    const additivePerPaston = additiveRatio * pastonFormula.diluted_additive_per_paston_liters
    // Porcentaje sobre kg de cemento
    return (additivePerPaston / pastonFormula.cement_kg) * 100
  }

  const markVPercentage = calculateAdditivePercentage(pastonFormula.additive_1_kg)
  const daraccelPercentage = calculateAdditivePercentage(pastonFormula.additive_2_kg)

  // Request save confirmation for paston
  const requestPastonSave = () => {
    setPendingSaveType("paston")
    setPendingPipeDiameter(null)
    setSaveOperator("")
    setSaveReason("")
    setShowSaveConfirm(true)
  }

  // Request save confirmation for pipe
  const requestPipeSave = (diameter: number) => {
    setPendingSaveType("pipe")
    setPendingPipeDiameter(diameter)
    setSaveOperator("")
    setSaveReason("")
    setShowSaveConfirm(true)
  }

  // Confirm and execute save
  const confirmSave = async () => {
    if (!saveOperator.trim()) return
    
    if (pendingSaveType === "paston") {
      await executePastonSave()
    } else if (pendingSaveType === "pipe" && pendingPipeDiameter) {
      await executePipeSave(pendingPipeDiameter)
    }
    
    setShowSaveConfirm(false)
    setPendingSaveType(null)
    setPendingPipeDiameter(null)
  }

  // Execute paston formula save
  const executePastonSave = async () => {
    setSaving(true)
    const supabase = getSupabase()
    
    try {
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
        additive_2_kg: pastonFormula.additive_2_kg,
        additive_2_name: pastonFormula.additive_2_name || "Daraccel",
        water_in_tank_liters: pastonFormula.water_in_tank_liters,
        diluted_additive_per_paston_liters: pastonFormula.diluted_additive_per_paston_liters,
        modified_by: saveOperator,
        modified_at: new Date().toISOString(),
        is_active: true
      }
      
      // Get previous values for history
      const previousValues = pastonFormula.id ? { ...pastonFormula } : null
      
      if (pastonFormula.id) {
        // Update
        await supabase
          .from("paston_formulas")
          .update(dataToSave)
          .eq("id", pastonFormula.id)
          
        // Save to history
        await supabase.from("paston_formulas_history").insert({
          paston_formula_id: pastonFormula.id,
          plant: plantValue,
          previous_values: previousValues,
          new_values: dataToSave,
          change_reason: saveReason || "Actualización de fórmula",
          modified_by: saveOperator,
          modified_at: new Date().toISOString()
        })
      } else {
        // Insert
        const { data } = await supabase
          .from("paston_formulas")
          .insert(dataToSave)
          .select()
          .single()
        
        if (data) {
          setPastonFormula(data)
        }
      }
      
    } catch (error) {
      console.error("Error saving paston formula:", error)
    } finally {
      setSaving(false)
    }
  }

  // Execute pipe formula save
  const executePipeSave = async (diameter: number) => {
    setSaving(true)
    const supabase = getSupabase()
    const formula = pipeFormulas[diameter]
    
    if (!formula) {
      setSaving(false)
      return
    }
    
    try {
      // Get previous values for history
      const previousValues = formula.id ? { ...formula } : null
      
      const dataToSave = {
        plant: plantValue,
        diameter: diameter,
        pipe_weight_kg: formula.pipe_weight_kg,
        cement_kg: formula.cement_kg,
        sand_kg: formula.sand_kg,
        stone_kg: formula.stone_kg,
        additive_liters: formula.additive_liters,
        modified_by: saveOperator,
        modified_at: new Date().toISOString(),
        is_active: true
      }
      
      if (formula.id) {
        await supabase
          .from("pipe_mix_designs")
          .update(dataToSave)
          .eq("id", formula.id)
        
        // Save to history
        await supabase.from("pipe_mix_design_history").insert({
          pipe_mix_design_id: formula.id,
          diameter: diameter,
          pipe_weight_kg: previousValues?.pipe_weight_kg,
          cement_kg: previousValues?.cement_kg,
          sand_kg: previousValues?.sand_kg,
          stone_kg: previousValues?.stone_kg,
          additive_liters: previousValues?.additive_liters,
          modified_by: saveOperator,
          modified_at: new Date().toISOString()
        })
      } else {
        const { data } = await supabase
          .from("pipe_mix_designs")
          .insert(dataToSave)
          .select()
          .single()
        
        if (data) {
          setPipeFormulas(prev => ({
            ...prev,
            [diameter]: { ...formula, id: data.id }
          }))
        }
      }
      
    } catch (error) {
      console.error("Error saving pipe formula:", error)
    } finally {
      setSaving(false)
    }
  }

  // Add custom operator
  const addOperator = async () => {
    if (!customOperator.trim()) return
    
    const supabase = getSupabase()
    await supabase.from("formuleo_operators").insert({
      plant: plantValue,
      name: customOperator.trim()
    })
    
    setOperators(prev => [...prev, customOperator.trim()])
    setSelectedOperator(customOperator.trim())
    setCustomOperator("")
    setShowAddOperator(false)
  }

  // Load history
  const loadHistory = async () => {
    const supabase = getSupabase()
    const { data } = await supabase
      .from("paston_formulas_history")
      .select("*")
      .eq("plant", plantValue)
      .order("modified_at", { ascending: false })
      .limit(20)
    
    if (data) setHistory(data)
    setShowHistory(true)
  }

  // Update pipe formula field
  const updatePipeFormula = (diameter: number, field: keyof PipeFormula, value: number) => {
    setPipeFormulas(prev => ({
      ...prev,
      [diameter]: {
        ...prev[diameter] || {
          plant: plantValue,
          pipe_size: diameter,
          paston_formula_id: pastonFormula.id || "",
          pipe_weight_kg: 0,
          cement_kg: 0,
          sand_kg: 0,
          stone_kg: 0,
          additive_liters: 0,
          modified_by: selectedOperator,
          modified_at: new Date().toISOString()
        },
        [field]: value
      }
    }))
  }

  // Calculate percentages for pipe formula
  const calculatePipePercentages = (formula: PipeFormula) => {
    const total = formula.cement_kg + formula.sand_kg + formula.stone_kg
    if (total <= 0) return { cement: 0, sand: 0, stone: 0 }
    return {
      cement: (formula.cement_kg / total) * 100,
      sand: (formula.sand_kg / total) * 100,
      stone: (formula.stone_kg / total) * 100
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
            Formuleo
          </h2>
          <p className="text-sm text-muted-foreground">
            Configuración de fórmulas de pastón y caños para {selectedPlant === "mercedes" ? "Mercedes" : selectedPlant === "villa-rosa" ? "Villa Rosa" : "Silke"}
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
          
          <Button variant="outline" size="sm" onClick={loadHistory}>
            <History className="w-4 h-4 mr-1" /> Historial
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "paston" | "canos")}>
        <TabsList>
          <TabsTrigger value="paston" className="gap-1">
            <FlaskConical className="w-4 h-4" /> Fórmula Pastón
          </TabsTrigger>
          <TabsTrigger value="canos" className="gap-1">
            <Cylinder className="w-4 h-4" /> Fórmulas Caños
          </TabsTrigger>
        </TabsList>

        {/* PASTON TAB */}
        <TabsContent value="paston" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Fórmula del Pastón</CardTitle>
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
                    placeholder="Kg por pastón"
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
                    placeholder="Kg por pastón"
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
                    placeholder="Kg por pastón"
                    className="text-xs"
                  />
                </div>
              </div>

              {/* Tanque de aditivos */}
              <div className="border rounded-lg p-4 bg-muted/30">
                <h4 className="font-medium text-sm mb-3">Tanque de Aditivo Diluido ({pastonFormula.tank_capacity_liters}L)</h4>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {/* Mark V */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium">Mark V</Label>
                      <Dialog open={showMarkVSheet} onOpenChange={setShowMarkVSheet}>
                        <DialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-6 px-2">
                            <FileText className="w-3 h-3" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-4xl max-h-[80vh] overflow-auto">
                          <DialogHeader>
                            <DialogTitle>Ficha Técnica - MARK V</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                              <h4 className="font-semibold text-blue-800 mb-2">Dosificación Recomendada</h4>
                              <p className="text-sm"><strong>Concentrado:</strong> 13-33 cc/100 kg de cemento</p>
                              <p className="text-sm"><strong>Diluido (1:10):</strong> 196-447 cc/100 kg de cemento</p>
                              <p className="text-xs text-muted-foreground mt-2">Dilución: 1 parte MARK V en 10 partes de agua (20L en 200L total)</p>
                            </div>
                            <div className="p-4 bg-muted rounded-lg text-sm space-y-2">
                              <p><strong>Descripción:</strong> Aditivo plastificante concentrado para productos de hormigón de bajo asentamiento.</p>
                              <p><strong>Aplicaciones:</strong> Bloques de mampostería, tubos de hormigón, losetas.</p>
                              <p><strong>Ventajas:</strong> Impacto leve, ciclos más cortos, ángulos y aristas más agudos, menos piezas irregulares, superficie más densa.</p>
                              <p><strong>Especificaciones:</strong> ASTM C494:2015 tipo S</p>
                              <p><strong>Densidad:</strong> 1,025 - 1,065 g/cm³</p>
                            </div>
                            <a 
                              href="/fichas-tecnicas/mark-v.pdf" 
                              target="_blank" 
                              className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline"
                            >
                              <FileText className="w-4 h-4" /> Ver ficha técnica completa (PDF)
                            </a>
                          </div>
                        </DialogContent>
                      </Dialog>
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
                    {additive1Unit === "lts" && pastonFormula.additive_1_kg > 0 && (
                      <p className="text-[10px] text-blue-600">
                        = {(pastonFormula.additive_1_kg * additive1Density).toFixed(2)} kg
                      </p>
                    )}
                    {additive1Unit === "kg" && pastonFormula.additive_1_kg > 0 && (
                      <p className="text-[10px] text-blue-600">
                        = {(pastonFormula.additive_1_kg / additive1Density).toFixed(2)} lts
                      </p>
                    )}
                    <div className="space-y-1">
                      <p className={`text-xs font-medium ${markVPercentage > 0 ? (markVPercentage >= 0.013 && markVPercentage <= 0.033 ? "text-green-600" : "text-amber-600") : "text-muted-foreground"}`}>
                        {markVPercentage.toFixed(4)}% sobre cemento
                      </p>
                      <p className="text-[10px] text-muted-foreground">Rango: 0.013% - 0.033% (conc.)</p>
                    </div>
                  </div>
                  
                  {/* Daraccel */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium">Daraccel</Label>
                      <Dialog open={showDaraccelSheet} onOpenChange={setShowDaraccelSheet}>
                        <DialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-6 px-2">
                            <FileText className="w-3 h-3" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-4xl max-h-[80vh] overflow-auto">
                          <DialogHeader>
                            <DialogTitle>Ficha Técnica - DARACCEL</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                              <h4 className="font-semibold text-blue-800 mb-2">Dosificación Recomendada</h4>
                              <p className="text-sm"><strong>Rango:</strong> 0.7% a 3.5% del peso del cemento</p>
                              <p className="text-sm"><strong>Típico:</strong> 1% a 1.5% para reducir fraguado 2-3 horas a 10°C</p>
                              <p className="text-xs text-muted-foreground mt-2">Mayor dosificación = mayor aceleración de fraguado</p>
                            </div>
                            <div className="p-4 bg-muted rounded-lg text-sm space-y-2">
                              <p><strong>Descripción:</strong> Aditivo acelerante de fraguado líquido.</p>
                              <p><strong>Aplicaciones:</strong> Hormigonado en climas fríos, cuando se requiere aceleración de fraguado.</p>
                              <p><strong>Ventajas:</strong> Desmolde y terminación temprana, mayor resistencia inicial (25-50% a 3 días), reducción de costos.</p>
                              <p><strong>Especificaciones:</strong> ASTM C494:2015 Tipo C</p>
                              <p><strong>Densidad:</strong> 1,29 - 1,40 g/L</p>
                              <p><strong>Color:</strong> Azul</p>
                            </div>
                            <a 
                              href="/fichas-tecnicas/daraccel.pdf" 
                              target="_blank" 
                              className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline"
                            >
                              <FileText className="w-4 h-4" /> Ver ficha técnica completa (PDF)
                            </a>
                          </div>
                        </DialogContent>
                      </Dialog>
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
                    {additive2Unit === "lts" && pastonFormula.additive_2_kg > 0 && (
                      <p className="text-[10px] text-blue-600">
                        = {(pastonFormula.additive_2_kg * additive2Density).toFixed(2)} kg
                      </p>
                    )}
                    {additive2Unit === "kg" && pastonFormula.additive_2_kg > 0 && (
                      <p className="text-[10px] text-blue-600">
                        = {(pastonFormula.additive_2_kg / additive2Density).toFixed(2)} lts
                      </p>
                    )}
                    <div className="space-y-1">
                      <p className={`text-xs font-medium ${daraccelPercentage > 0 ? (daraccelPercentage >= 0.7 && daraccelPercentage <= 3.5 ? "text-green-600" : "text-amber-600") : "text-muted-foreground"}`}>
                        {daraccelPercentage.toFixed(2)}% sobre cemento
                      </p>
                      <p className="text-[10px] text-muted-foreground">Rango: 0.7% - 3.5%</p>
                    </div>
                  </div>
                  
                  {/* Agua */}
                  <div className="space-y-2">
                    <Label className="text-xs font-medium">Agua (L)</Label>
                    <Input
                      type="number"
                      value={pastonFormula.water_in_tank_liters.toFixed(1)}
                      disabled
                      className="bg-muted"
                    />
                    <p className="text-[10px] text-muted-foreground">Calculado automáticamente</p>
                  </div>
                  
                  {/* Litros por pastón */}
                  <div className="space-y-2">
                    <Label className="text-xs font-medium">Diluido/Pastón (L)</Label>
                    <Input
                      type="number"
                      value={pastonFormula.diluted_additive_per_paston_liters || ""}
                      onChange={(e) => setPastonFormula(prev => ({ ...prev, diluted_additive_per_paston_liters: parseFloat(e.target.value) || 0 }))}
                      placeholder="0"
                    />
                    <p className="text-[10px] text-muted-foreground">Litros de mezcla por pastón</p>
                  </div>
                </div>
                
                {/* Resumen de dosificación */}
                <div className="mt-4 p-3 bg-background rounded border">
                  <div className="flex items-center gap-2 mb-2">
                    <Info className="w-4 h-4 text-blue-500" />
                    <span className="text-xs font-medium">Dosificación de aditivos por kg de cemento:</span>
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

              <div className="flex justify-end">
                <Button onClick={requestPastonSave} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  Guardar Fórmula Pastón
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* CAÑOS TAB */}
        <TabsContent value="canos" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Fórmulas por Tipo de Caño</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-2 px-2 font-medium">Caño</th>
                      <th className="text-center py-2 px-2 font-medium">Peso (kg)</th>
                      <th className="text-center py-2 px-2 font-medium">Cemento (kg)</th>
                      <th className="text-center py-2 px-2 font-medium">Arena (kg)</th>
                      <th className="text-center py-2 px-2 font-medium">Piedra (kg)</th>
                      <th className="text-center py-2 px-2 font-medium">Aditivo (L)</th>
                      <th className="text-center py-2 px-2 font-medium">% Cem.</th>
                      <th className="text-center py-2 px-2 font-medium">% Arena</th>
                      <th className="text-center py-2 px-2 font-medium">% Piedra</th>
                      <th className="text-center py-2 px-2 font-medium">Modificado</th>
                      <th className="py-2 px-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pipeDiameters.map((diameter, idx) => {
                      const formula = pipeFormulas[diameter] || {
                        plant: plantValue,
                        pipe_size: diameter,
                        pipe_weight_kg: 0,
                        cement_kg: 0,
                        sand_kg: 0,
                        stone_kg: 0,
                        additive_liters: 0,
                        modified_by: "",
                        modified_at: ""
                      }
                      const percentages = calculatePipePercentages(formula as PipeFormula)
                      
                      return (
                        <tr key={diameter} className={idx % 2 === 1 ? "bg-muted/30" : ""}>
                          <td className="py-2 px-2 font-medium">CC{diameter}</td>
                          <td className="py-1 px-1">
                            <Input
                              type="number"
                              value={formula.pipe_weight_kg || ""}
                              onChange={(e) => updatePipeFormula(diameter, "pipe_weight_kg", parseFloat(e.target.value) || 0)}
                              className="h-8 text-center text-xs"
                              placeholder="0"
                            />
                          </td>
                          <td className="py-1 px-1">
                            <Input
                              type="number"
                              value={formula.cement_kg || ""}
                              onChange={(e) => updatePipeFormula(diameter, "cement_kg", parseFloat(e.target.value) || 0)}
                              className="h-8 text-center text-xs"
                              placeholder="0"
                            />
                          </td>
                          <td className="py-1 px-1">
                            <Input
                              type="number"
                              value={formula.sand_kg || ""}
                              onChange={(e) => updatePipeFormula(diameter, "sand_kg", parseFloat(e.target.value) || 0)}
                              className="h-8 text-center text-xs"
                              placeholder="0"
                            />
                          </td>
                          <td className="py-1 px-1">
                            <Input
                              type="number"
                              value={formula.stone_kg || ""}
                              onChange={(e) => updatePipeFormula(diameter, "stone_kg", parseFloat(e.target.value) || 0)}
                              className="h-8 text-center text-xs"
                              placeholder="0"
                            />
                          </td>
                          <td className="py-1 px-1">
                            <Input
                              type="number"
                              value={formula.additive_liters || ""}
                              onChange={(e) => updatePipeFormula(diameter, "additive_liters", parseFloat(e.target.value) || 0)}
                              className="h-8 text-center text-xs"
                              placeholder="0"
                            />
                          </td>
                          <td className="py-2 px-2 text-center text-xs font-mono">{percentages.cement.toFixed(1)}%</td>
                          <td className="py-2 px-2 text-center text-xs font-mono">{percentages.sand.toFixed(1)}%</td>
                          <td className="py-2 px-2 text-center text-xs font-mono">{percentages.stone.toFixed(1)}%</td>
                          <td className="py-2 px-2 text-center text-[10px] text-muted-foreground">
                            {formula.modified_at ? (
                              <>
                                {new Date(formula.modified_at).toLocaleDateString("es-AR")}
                                <br />
                                {formula.modified_by}
                              </>
                            ) : "-"}
                          </td>
                          <td className="py-1 px-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => requestPipeSave(diameter)}
                              disabled={saving}
                              className="h-8 w-8 p-0"
                            >
                              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Operator Dialog */}
      <Dialog open={showAddOperator} onOpenChange={setShowAddOperator}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar Operario</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre del operario</Label>
              <Input
                value={customOperator}
                onChange={(e) => setCustomOperator(e.target.value)}
                placeholder="Nombre completo"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAddOperator(false)}>Cancelar</Button>
              <Button onClick={addOperator}>Agregar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* History Dialog */}
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Historial de Modificaciones</DialogTitle>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto">
            {history.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No hay historial disponible</p>
            ) : (
              <div className="space-y-2">
                {history.map((h, idx) => (
                  <div key={idx} className="p-3 border rounded-lg text-sm">
                    <div className="flex justify-between items-center mb-2">
                      <Badge variant="outline">{new Date(h.modified_at).toLocaleString("es-AR")}</Badge>
                      <span className="text-muted-foreground">{h.modified_by}</span>
                    </div>
                    <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                      {JSON.stringify(h.formula_data, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Save Confirmation Dialog */}
      <Dialog open={showSaveConfirm} onOpenChange={setShowSaveConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar Cambios</DialogTitle>
            <DialogDescription>
              {pendingSaveType === "paston" 
                ? "Estás por guardar cambios en la fórmula del pastón." 
                : `Estás por guardar cambios en la fórmula del caño de ${pendingPipeDiameter}mm.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="save-operator">Operador que realiza el cambio *</Label>
              <Select value={saveOperator} onValueChange={setSaveOperator}>
                <SelectTrigger id="save-operator">
                  <SelectValue placeholder="Seleccionar operador..." />
                </SelectTrigger>
                <SelectContent>
                  {operators.map(op => (
                    <SelectItem key={op} value={op}>{op}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="save-reason">Motivo del cambio (opcional)</Label>
              <Input
                id="save-reason"
                value={saveReason}
                onChange={(e) => setSaveReason(e.target.value)}
                placeholder="Ej: Ajuste de dosificación..."
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowSaveConfirm(false)}>
              Cancelar
            </Button>
            <Button onClick={confirmSave} disabled={!saveOperator.trim() || saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Confirmar y Guardar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
