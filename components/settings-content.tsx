"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { ProductionPlanning } from "@/components/production-planning"
import { getSupabase } from "@/lib/supabase"
import type { CycleTime, DowntimeReason } from "@/lib/types"
import { Clock, Plus, AlertCircle, Loader2, Package, Pencil, Trash2, X, Check } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface ProductConfig {
  id: number
  line_type: "bloques" | "caños"
  product_code: string
  product_name: string
  cycle_time_seconds: number
  piece_weight_kg: number | null
  formula_cement_kg: number | null
  formula_stone_0_10_kg: number | null
  formula_stone_0_20_kg: number | null
  formula_sand_kg: number | null
  formula_additive_1_kg: number | null
  formula_additive_2_kg: number | null
  formula_water_kg: number | null
  daily_target: number | null
  weekly_target: number | null
  monthly_target: number | null
  is_active: boolean
}

export function SettingsContent() {
  const { toast } = useToast()
  const [cycleTimes, setCycleTimes] = useState<CycleTime[]>([])
  const [downtimeReasons, setDowntimeReasons] = useState<DowntimeReason[]>([])
  const [products, setProducts] = useState<ProductConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  async function loadSettings() {
    const supabase = getSupabase()

    const { data: cycleData } = await supabase.from("cycle_times").select("*").order("line_type").order("product_code")

    const { data: reasonData } = await supabase.from("downtime_reasons").select("*").order("line_type").order("reason")

    const { data: productData } = await supabase.from("product_config").select("*").order("line_type").order("product_code")

    if (cycleData) setCycleTimes(cycleData)
    if (reasonData) setDowntimeReasons(reasonData)
    if (productData) setProducts(productData)

    setLoading(false)
  }

  async function handleUpdateCycleTime(id: number, seconds: number) {
    setSaving(true)
    const supabase = getSupabase()

    const { error } = await supabase
      .from("cycle_times")
      .update({ cycle_time_seconds: seconds, updated_at: new Date().toISOString() })
      .eq("id", id)

    if (error) {
      toast({
        title: "Error",
        description: "No se pudo actualizar el tiempo de ciclo",
        variant: "destructive",
      })
    } else {
      toast({
        title: "Actualizado",
        description: "Tiempo de ciclo guardado exitosamente",
      })
      loadSettings()
    }

    setSaving(false)
  }

  async function handleAddDowntimeReason(lineType: "bloques" | "caños", reason: string) {
    if (!reason.trim()) return

    setSaving(true)
    const supabase = getSupabase()

    const { error } = await supabase.from("downtime_reasons").insert({
      reason: reason.trim(),
      line_type: lineType,
      is_active: true,
    })

    if (error) {
      toast({
        title: "Error",
        description: "No se pudo agregar el motivo de parada",
        variant: "destructive",
      })
    } else {
      toast({
        title: "Agregado",
        description: "Motivo de parada agregado exitosamente",
      })
      loadSettings()
    }

    setSaving(false)
  }

  async function handleToggleDowntimeReason(id: number, isActive: boolean) {
    setSaving(true)
    const supabase = getSupabase()

    const { error } = await supabase.from("downtime_reasons").update({ is_active: !isActive }).eq("id", id)

    if (error) {
      toast({
        title: "Error",
        description: "No se pudo actualizar el motivo de parada",
        variant: "destructive",
      })
    } else {
      toast({
        title: "Actualizado",
        description: `Motivo ${!isActive ? "activado" : "desactivado"} exitosamente`,
      })
      loadSettings()
    }

    setSaving(false)
  }

  async function handleSaveProduct(product: Partial<ProductConfig> & { line_type: "bloques" | "caños" }) {
    setSaving(true)
    const supabase = getSupabase()

    if (product.id) {
      // Update existing
      const { error } = await supabase
        .from("product_config")
        .update({
          product_code: product.product_code,
          product_name: product.product_name,
          cycle_time_seconds: product.cycle_time_seconds,
          piece_weight_kg: product.piece_weight_kg,
          formula_cement_kg: product.formula_cement_kg,
          formula_stone_0_10_kg: product.formula_stone_0_10_kg,
          formula_stone_0_20_kg: product.formula_stone_0_20_kg,
          formula_sand_kg: product.formula_sand_kg,
          formula_additive_1_kg: product.formula_additive_1_kg,
          formula_additive_2_kg: product.formula_additive_2_kg,
          formula_water_kg: product.formula_water_kg,
          daily_target: product.daily_target,
          weekly_target: product.weekly_target,
          monthly_target: product.monthly_target,
          updated_at: new Date().toISOString(),
        })
        .eq("id", product.id)

      if (error) {
        toast({ title: "Error", description: `No se pudo actualizar: ${error.message}`, variant: "destructive" })
      } else {
        toast({ title: "Actualizado", description: "Producto guardado exitosamente" })
        loadSettings()
      }
    } else {
      // Insert new
      const { error } = await supabase.from("product_config").insert({
        line_type: product.line_type,
        product_code: product.product_code,
        product_name: product.product_name,
        cycle_time_seconds: product.cycle_time_seconds,
        piece_weight_kg: product.piece_weight_kg,
        formula_cement_kg: product.formula_cement_kg,
        formula_stone_0_10_kg: product.formula_stone_0_10_kg,
        formula_stone_0_20_kg: product.formula_stone_0_20_kg,
        formula_sand_kg: product.formula_sand_kg,
        formula_additive_1_kg: product.formula_additive_1_kg,
        formula_additive_2_kg: product.formula_additive_2_kg,
        formula_water_kg: product.formula_water_kg,
        daily_target: product.daily_target,
        weekly_target: product.weekly_target,
        monthly_target: product.monthly_target,
        is_active: true,
      })

      if (error) {
        toast({ title: "Error", description: `No se pudo crear: ${error.message}`, variant: "destructive" })
      } else {
        toast({ title: "Creado", description: "Producto agregado exitosamente" })
        loadSettings()
      }
    }

    setSaving(false)
  }

  async function handleDeleteProduct(id: number) {
    setSaving(true)
    const supabase = getSupabase()

    const { error } = await supabase.from("product_config").delete().eq("id", id)

    if (error) {
      toast({ title: "Error", description: "No se pudo eliminar el producto", variant: "destructive" })
    } else {
      toast({ title: "Eliminado", description: "Producto eliminado exitosamente" })
      loadSettings()
    }

    setSaving(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Cargando configuración...</p>
      </div>
    )
  }

  return (
    <Tabs defaultValue="products" className="space-y-6">
      <TabsList className="grid w-full max-w-lg grid-cols-3">
        <TabsTrigger value="products">Productos</TabsTrigger>
        <TabsTrigger value="cycle-times">Tiempos de Ciclo</TabsTrigger>
        <TabsTrigger value="downtime-reasons">Motivos de Parada</TabsTrigger>
      </TabsList>

      <TabsContent value="products" className="space-y-6">
        <Tabs defaultValue="bloques" className="space-y-4">
          <TabsList className="grid w-full max-w-xs grid-cols-2">
            <TabsTrigger value="bloques">Bloques</TabsTrigger>
            <TabsTrigger value="caños">Caños</TabsTrigger>
          </TabsList>

          <TabsContent value="bloques">
            <ProductConfigCard
              lineType="bloques"
              products={products.filter((p) => p.line_type === "bloques")}
              onSave={handleSaveProduct}
              onDelete={handleDeleteProduct}
              saving={saving}
            />
          </TabsContent>

          <TabsContent value="caños">
            <ProductConfigCard
              lineType="caños"
              products={products.filter((p) => p.line_type === "caños")}
              onSave={handleSaveProduct}
              onDelete={handleDeleteProduct}
              saving={saving}
            />
          </TabsContent>
        </Tabs>
      </TabsContent>

      <TabsContent value="cycle-times" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Tiempos de Ciclo de Bloques
            </CardTitle>
            <CardDescription>Tiempo en segundos que tarda la máquina en completar un ciclo</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {cycleTimes
              .filter((ct) => ct.line_type === "bloques")
              .map((cycleTime) => (
                <CycleTimeRow
                  key={cycleTime.id}
                  cycleTime={cycleTime}
                  onUpdate={handleUpdateCycleTime}
                  saving={saving}
                />
              ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Tiempos de Ciclo de Caños
            </CardTitle>
            <CardDescription>Tiempo en segundos que tarda la máquina en producir cada tipo de caño</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {cycleTimes
              .filter((ct) => ct.line_type === "caños")
              .map((cycleTime) => (
                <CycleTimeRow
                  key={cycleTime.id}
                  cycleTime={cycleTime}
                  onUpdate={handleUpdateCycleTime}
                  saving={saving}
                />
              ))}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="downtime-reasons" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Motivos de Parada - Bloques
            </CardTitle>
            <CardDescription>Gestiona las razones predefinidas de parada para la línea de bloques</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <DowntimeReasonList
              reasons={downtimeReasons.filter((r) => r.line_type === "bloques")}
              lineType="bloques"
              onToggle={handleToggleDowntimeReason}
              onAdd={handleAddDowntimeReason}
              saving={saving}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Motivos de Parada - Caños
            </CardTitle>
            <CardDescription>Gestiona las razones predefinidas de parada para la línea de caños</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <DowntimeReasonList
              reasons={downtimeReasons.filter((r) => r.line_type === "caños")}
              lineType="caños"
              onToggle={handleToggleDowntimeReason}
              onAdd={handleAddDowntimeReason}
              saving={saving}
            />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )
}

function CycleTimeRow({
  cycleTime,
  onUpdate,
  saving,
}: {
  cycleTime: CycleTime
  onUpdate: (id: number, seconds: number) => void
  saving: boolean
}) {
  const [seconds, setSeconds] = useState(cycleTime.cycle_time_seconds)
  const [hasChanges, setHasChanges] = useState(false)

  function handleChange(value: number) {
    setSeconds(value)
    setHasChanges(value !== cycleTime.cycle_time_seconds)
  }

  function handleSave() {
    onUpdate(cycleTime.id, seconds)
    setHasChanges(false)
  }

  return (
    <div className="flex items-center gap-4 p-4 rounded-lg border border-border bg-muted/50">
      <div className="flex-1">
        <p className="font-medium text-foreground">{cycleTime.product_type}</p>
        <p className="text-sm text-muted-foreground">{cycleTime.product_code}</p>
      </div>

      <div className="flex items-center gap-3">
        <div className="space-y-1">
          <Label htmlFor={`cycle-${cycleTime.id}`} className="text-xs">
            Segundos
          </Label>
          <Input
            id={`cycle-${cycleTime.id}`}
            type="number"
            min="1"
            value={seconds}
            onChange={(e) => handleChange(Number.parseInt(e.target.value) || 0)}
            className="w-24"
          />
        </div>

        <Button onClick={handleSave} disabled={!hasChanges || saving} size="sm" className="mt-5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
        </Button>
      </div>
    </div>
  )
}

function ProductConfigCard({
  lineType,
  products,
  onSave,
  onDelete,
  saving,
}: {
  lineType: "bloques" | "caños"
  products: ProductConfig[]
  onSave: (product: Partial<ProductConfig> & { line_type: "bloques" | "caños" }) => void
  onDelete: (id: number) => void
  saving: boolean
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Partial<ProductConfig> | null>(null)

  const emptyProduct: Partial<ProductConfig> = {
    line_type: lineType,
    product_code: "",
    product_name: "",
    cycle_time_seconds: lineType === "bloques" ? 18 : 300,
    piece_weight_kg: null,
    formula_cement_kg: null,
    formula_stone_0_10_kg: null,
    formula_stone_0_20_kg: null,
    formula_sand_kg: null,
    formula_additive_1_kg: null,
    formula_additive_2_kg: null,
    formula_water_kg: null,
    daily_target: null,
    weekly_target: null,
    monthly_target: null,
  }

  function handleNew() {
    setEditingProduct(emptyProduct)
    setDialogOpen(true)
  }

  function handleEdit(product: ProductConfig) {
    // Crear copia completa del producto para edición
    setEditingProduct({
      id: product.id,
      line_type: product.line_type,
      product_code: product.product_code,
      product_name: product.product_name,
      cycle_time_seconds: product.cycle_time_seconds,
      piece_weight_kg: product.piece_weight_kg,
      formula_cement_kg: product.formula_cement_kg,
      formula_stone_0_10_kg: product.formula_stone_0_10_kg,
      formula_stone_0_20_kg: product.formula_stone_0_20_kg,
      formula_sand_kg: product.formula_sand_kg,
      formula_additive_1_kg: product.formula_additive_1_kg,
      formula_additive_2_kg: product.formula_additive_2_kg,
      formula_water_kg: product.formula_water_kg,
      daily_target: product.daily_target,
      weekly_target: product.weekly_target,
      monthly_target: product.monthly_target,
      is_active: product.is_active,
    })
    setDialogOpen(true)
  }

  function handleSave() {
    if (editingProduct) {
      onSave({ ...editingProduct, line_type: lineType } as Partial<ProductConfig> & { line_type: "bloques" | "caños" })
      setDialogOpen(false)
      setEditingProduct(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Productos de {lineType === "bloques" ? "Bloques" : "Caños"}
            </CardTitle>
            <CardDescription>
              Configura tiempo de ciclo, peso y fórmula del pastón para cada producto
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {lineType === "caños" && <ProductionPlanning lineType={lineType} />}
            <Button onClick={handleNew} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Agregar Producto
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {products.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            No hay productos configurados. Agregá uno nuevo.
          </p>
        ) : (
          <div className="space-y-3">
            {products.map((product) => (
              <div
                key={product.id}
                className="p-4 rounded-lg border border-border bg-muted/50"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground text-lg">{product.product_code}</p>
                      {!product.is_active && (
                        <span className="text-xs bg-muted px-2 py-0.5 rounded">Inactivo</span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{product.product_name}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleEdit(product)} className="bg-transparent">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onDelete(product.id)}
                      disabled={saving}
                      className="text-destructive hover:text-destructive bg-transparent"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div className="bg-background p-2 rounded border">
                    <p className="text-muted-foreground text-xs">Tiempo Ciclo</p>
                    <p className="font-medium">{product.cycle_time_seconds}s</p>
                  </div>
                  {product.piece_weight_kg && (
                    <div className="bg-background p-2 rounded border">
                      <p className="text-muted-foreground text-xs">Peso Pieza</p>
                      <p className="font-medium">{product.piece_weight_kg} kg</p>
                    </div>
                  )}
                </div>

                {(product.formula_cement_kg || product.formula_sand_kg || product.formula_stone_0_10_kg) && (
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-xs text-muted-foreground mb-2 font-medium">Formula del Paston</p>
                    <div className="grid grid-cols-3 md:grid-cols-7 gap-2 text-xs">
                      {product.formula_cement_kg && (
                        <div className="bg-background p-2 rounded border text-center">
                          <p className="text-muted-foreground">Cemento</p>
                          <p className="font-medium">{product.formula_cement_kg} kg</p>
                        </div>
                      )}
                      {product.formula_sand_kg && (
                        <div className="bg-background p-2 rounded border text-center">
                          <p className="text-muted-foreground">Arena</p>
                          <p className="font-medium">{product.formula_sand_kg} kg</p>
                        </div>
                      )}
                      {product.formula_stone_0_10_kg && (
                        <div className="bg-background p-2 rounded border text-center">
                          <p className="text-muted-foreground">Piedra 0-10</p>
                          <p className="font-medium">{product.formula_stone_0_10_kg} kg</p>
                        </div>
                      )}
                      {product.formula_stone_0_20_kg && (
                        <div className="bg-background p-2 rounded border text-center">
                          <p className="text-muted-foreground">Piedra 0-20</p>
                          <p className="font-medium">{product.formula_stone_0_20_kg} kg</p>
                        </div>
                      )}
                      {product.formula_additive_1_kg && (
                        <div className="bg-background p-2 rounded border text-center">
                          <p className="text-muted-foreground">MARK V</p>
                          <p className="font-medium">{product.formula_additive_1_kg} g</p>
                        </div>
                      )}
                      {product.formula_additive_2_kg && (
                        <div className="bg-background p-2 rounded border text-center">
                          <p className="text-muted-foreground">DARASELL</p>
                          <p className="font-medium">{product.formula_additive_2_kg} g</p>
                        </div>
                      )}
                      {product.formula_water_kg && (
                        <div className="bg-background p-2 rounded border text-center">
                          <p className="text-muted-foreground">Agua</p>
                          <p className="font-medium">{product.formula_water_kg} kg</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {dialogOpen && (
          <div className="fixed inset-0 flex items-center justify-center z-50">
            <div className="bg-background p-6 rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-medium text-foreground">
                  {editingProduct?.id ? "Editar Producto" : "Nuevo Producto"}
                </h2>
                <button onClick={() => setDialogOpen(false)} className="text-destructive hover:text-destructive">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="product_code">Código *</Label>
                    <Input
                      id="product_code"
                      value={editingProduct.product_code || ""}
                      onChange={(e) => setEditingProduct({ ...editingProduct, product_code: e.target.value })}
                      placeholder="Ej: B20T, Ø300"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="product_name">Nombre *</Label>
                    <Input
                      id="product_name"
                      value={editingProduct.product_name || ""}
                      onChange={(e) => setEditingProduct({ ...editingProduct, product_name: e.target.value })}
                      placeholder="Ej: Bloque 20 Tabique"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="cycle_time_seconds">Tiempo de Ciclo (seg) *</Label>
                    <Input
                      id="cycle_time_seconds"
                      type="number"
                      value={editingProduct.cycle_time_seconds || ""}
                      onChange={(e) => setEditingProduct({ ...editingProduct, cycle_time_seconds: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="piece_weight_kg">Peso por Pieza (kg)</Label>
                    <Input
                      id="piece_weight_kg"
                      type="number"
                      step="0.1"
                      value={editingProduct.piece_weight_kg || ""}
                      onChange={(e) => setEditingProduct({ ...editingProduct, piece_weight_kg: e.target.value ? Number(e.target.value) : null })}
                    />
                  </div>
                </div>

                {lineType === "caños" && (
                  <div className="border-t pt-4">
                    <h4 className="font-medium mb-3">Planificación de Producción</h4>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="daily_target">Diaria (unidades)</Label>
                        <Input
                          id="daily_target"
                          type="number"
                          min="0"
                          value={editingProduct?.daily_target || ""}
                          onChange={(e) => setEditingProduct({ ...editingProduct, daily_target: e.target.value ? Number(e.target.value) : null })}
                          placeholder="Ej: 10"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="weekly_target">Semanal (unidades)</Label>
                        <Input
                          id="weekly_target"
                          type="number"
                          min="0"
                          value={editingProduct?.weekly_target || ""}
                          onChange={(e) => setEditingProduct({ ...editingProduct, weekly_target: e.target.value ? Number(e.target.value) : null })}
                          placeholder="Ej: 50"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="monthly_target">Mensual (unidades)</Label>
                        <Input
                          id="monthly_target"
                          type="number"
                          min="0"
                          value={editingProduct?.monthly_target || ""}
                          onChange={(e) => setEditingProduct({ ...editingProduct, monthly_target: e.target.value ? Number(e.target.value) : null })}
                          placeholder="Ej: 200"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="border-t pt-4">
                  <h4 className="font-medium mb-3">Fórmula del Pastón</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="formula_cement_kg">Cemento (kg)</Label>
                      <Input
                        id="formula_cement_kg"
                        type="number"
                        step="0.1"
                        value={editingProduct.formula_cement_kg || ""}
                        onChange={(e) => setEditingProduct({ ...editingProduct, formula_cement_kg: e.target.value ? Number(e.target.value) : null })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="formula_sand_kg">Arena (kg)</Label>
                      <Input
                        id="formula_sand_kg"
                        type="number"
                        step="0.1"
                        value={editingProduct.formula_sand_kg || ""}
                        onChange={(e) => setEditingProduct({ ...editingProduct, formula_sand_kg: e.target.value ? Number(e.target.value) : null })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="formula_stone_0_10_kg">Piedra 0-10 (kg)</Label>
                      <Input
                        id="formula_stone_0_10_kg"
                        type="number"
                        step="0.1"
                        value={editingProduct.formula_stone_0_10_kg || ""}
                        onChange={(e) => setEditingProduct({ ...editingProduct, formula_stone_0_10_kg: e.target.value ? Number(e.target.value) : null })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="formula_stone_0_20_kg">Piedra 0-20 (kg)</Label>
                      <Input
                        id="formula_stone_0_20_kg"
                        type="number"
                        step="0.1"
                        value={editingProduct.formula_stone_0_20_kg || ""}
                        onChange={(e) => setEditingProduct({ ...editingProduct, formula_stone_0_20_kg: e.target.value ? Number(e.target.value) : null })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="formula_additive_1_kg">MARK V (g)</Label>
                      <Input
                        id="formula_additive_1_kg"
                        type="number"
                        step="0.01"
                        value={editingProduct.formula_additive_1_kg || ""}
                        onChange={(e) => setEditingProduct({ ...editingProduct, formula_additive_1_kg: e.target.value ? Number(e.target.value) : null })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="formula_additive_2_kg">DARASELL (g)</Label>
                      <Input
                        id="formula_additive_2_kg"
                        type="number"
                        step="0.01"
                        value={editingProduct.formula_additive_2_kg || ""}
                        onChange={(e) => setEditingProduct({ ...editingProduct, formula_additive_2_kg: e.target.value ? Number(e.target.value) : null })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="formula_water_kg">Agua (kg)</Label>
                      <Input
                        id="formula_water_kg"
                        type="number"
                        step="0.1"
                        value={editingProduct.formula_water_kg || ""}
                        onChange={(e) => setEditingProduct({ ...editingProduct, formula_water_kg: e.target.value ? Number(e.target.value) : null })}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end mt-6">
                <Button variant="outline" onClick={() => setDialogOpen(false)} className="bg-transparent mr-2">
                  Cancelar
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={saving || !editingProduct?.product_code || !editingProduct?.product_name}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Guardar
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function DowntimeReasonList({
  reasons,
  lineType,
  onToggle,
  onAdd,
  saving,
}: {
  reasons: DowntimeReason[]
  lineType: "bloques" | "caños"
  onToggle: (id: number, isActive: boolean) => void
  onAdd: (lineType: "bloques" | "caños", reason: string) => void
  saving: boolean
}) {
  const [newReason, setNewReason] = useState("")

  function handleAdd() {
    onAdd(lineType, newReason)
    setNewReason("")
  }

  return (
    <div className="space-y-4">
      {reasons.map((reason) => (
        <div
          key={reason.id}
          className={`flex items-center justify-between p-4 rounded-lg border ${
            reason.is_active ? "border-border bg-muted/50" : "border-border bg-muted/20 opacity-60"
          }`}
        >
          <p className={`font-medium ${reason.is_active ? "text-foreground" : "text-muted-foreground line-through"}`}>
            {reason.reason}
          </p>

          <Button
            variant={reason.is_active ? "destructive" : "default"}
            size="sm"
            onClick={() => onToggle(reason.id, reason.is_active)}
            disabled={saving}
          >
            {reason.is_active ? "Desactivar" : "Activar"}
          </Button>
        </div>
      ))}

      <div className="flex items-center gap-3 pt-4 border-t border-border">
        <Input
          placeholder="Nuevo motivo de parada..."
          value={newReason}
          onChange={(e) => setNewReason(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd()
          }}
        />
        <Button onClick={handleAdd} disabled={!newReason.trim() || saving}>
          <Plus className="h-4 w-4 mr-2" />
          Agregar
        </Button>
      </div>
    </div>
  )
}
