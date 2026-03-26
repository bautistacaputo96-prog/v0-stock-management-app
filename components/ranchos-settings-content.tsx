"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getSupabase } from "@/lib/supabase"
import { useToast } from "@/hooks/use-toast"
import { Plus, LayoutGrid, Truck, FlaskConical, Save, X, Trash2 } from "lucide-react"

interface ProductType {
  id: number
  product_code: string
  description: string
  piece_weight_kg: number | null
  active: boolean
}

interface Ingredient {
  id: number
  product_type_id: number
  ingredient_name: string
  quantity_kg: number | null
  unit: string
  sort_order: number
}

interface Supplier {
  id: number
  ingredient_name: string
  supplier_name: string
  active: boolean
}

export function RanchosSettingsContent() {
  const { toast } = useToast()
  const [products, setProducts] = useState<ProductType[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [showAddSupplier, setShowAddSupplier] = useState(false)
  const [newProduct, setNewProduct] = useState({ code: "", description: "", weight: "" })
  const [newSupplier, setNewSupplier] = useState({ ingredient: "Cemento", name: "" })
  const [editingIngredients, setEditingIngredients] = useState<Record<number, Ingredient[]>>({})
  const [savingIngredients, setSavingIngredients] = useState<number | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const supabase = getSupabase()
      const [prodRes, ingRes, supRes] = await Promise.all([
        supabase.from("paver_product_types").select("*").order("product_code"),
        supabase.from("paver_formula_ingredients").select("*").order("sort_order"),
        supabase.from("paver_suppliers").select("*").order("ingredient_name, supplier_name"),
      ])
      setProducts(prodRes.data || [])
      setIngredients(ingRes.data || [])
      setSuppliers(supRes.data || [])
    } catch {} finally { setLoading(false) }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  // Group ingredients by product_type_id (only return saved data, not editing state)
  function getSavedIngredientsForProduct(productId: number): Ingredient[] {
    return ingredients.filter(i => i.product_type_id === productId)
  }

  function startEditIngredients(productId: number) {
    const existing = ingredients.filter(i => i.product_type_id === productId)
    if (existing.length === 0) {
      // Seed with default ingredient names
      const defaults = ["Cemento", "Arena", "Piedra (0-6)", "Aditivo 1 (Mark V)", "Aditivo 2 (Darasell)"]
      setEditingIngredients(prev => ({
        ...prev,
        [productId]: defaults.map((name, idx) => ({
          id: -(idx + 1),
          product_type_id: productId,
          ingredient_name: name,
          quantity_kg: null,
          unit: "kg",
          sort_order: idx,
        }))
      }))
    } else {
      setEditingIngredients(prev => ({ ...prev, [productId]: [...existing] }))
    }
  }

  function updateEditingIngredient(productId: number, idx: number, field: string, value: string | number | null) {
    setEditingIngredients(prev => {
      const list = [...(prev[productId] || [])]
      list[idx] = { ...list[idx], [field]: value }
      return { ...prev, [productId]: list }
    })
  }

  function addIngredientRow(productId: number) {
    setEditingIngredients(prev => {
      const list = [...(prev[productId] || [])]
      list.push({
        id: -(Date.now()),
        product_type_id: productId,
        ingredient_name: "",
        quantity_kg: null,
        unit: "kg",
        sort_order: list.length,
      })
      return { ...prev, [productId]: list }
    })
  }

  function removeIngredientRow(productId: number, idx: number) {
    setEditingIngredients(prev => {
      const list = [...(prev[productId] || [])]
      list.splice(idx, 1)
      return { ...prev, [productId]: list }
    })
  }

  async function saveIngredients(productId: number) {
    setSavingIngredients(productId)
    try {
      const supabase = getSupabase()
      // Delete all existing for this product
      await supabase.from("paver_formula_ingredients").delete().eq("product_type_id", productId)
      // Insert all
      const rows = (editingIngredients[productId] || []).filter(i => i.ingredient_name.trim())
      if (rows.length > 0) {
        const { error } = await supabase.from("paver_formula_ingredients").insert(
          rows.map((r, idx) => ({
            product_type_id: productId,
            ingredient_name: r.ingredient_name,
            quantity_kg: r.quantity_kg,
            unit: r.unit,
            sort_order: idx,
          }))
        )
        if (error) throw error
      }
      toast({ title: "Guardado", description: "Formula actualizada" })
      setEditingIngredients(prev => { const n = { ...prev }; delete n[productId]; return n })
      loadAll()
    } catch {
      toast({ title: "Error", description: "No se pudo guardar la formula", variant: "destructive" })
    } finally { setSavingIngredients(null) }
  }

  function cancelEditIngredients(productId: number) {
    setEditingIngredients(prev => { const n = { ...prev }; delete n[productId]; return n })
  }

  async function addProduct() {
    if (!newProduct.code) return
    try {
      const supabase = getSupabase()
      const { error } = await supabase.from("paver_product_types").insert({
        product_code: newProduct.code,
        description: newProduct.description || newProduct.code,
        piece_weight_kg: newProduct.weight ? Number(newProduct.weight) : null,
      })
      if (error) throw error
      toast({ title: "Agregado", description: `Producto ${newProduct.code} creado` })
      setNewProduct({ code: "", description: "", weight: "" })
      setShowAddProduct(false)
      loadAll()
    } catch {
      toast({ title: "Error", description: "No se pudo agregar", variant: "destructive" })
    }
  }

  async function toggleActive(product: ProductType) {
    try {
      const supabase = getSupabase()
      await supabase.from("paver_product_types").update({ active: !product.active }).eq("id", product.id)
      loadAll()
    } catch {}
  }

  async function updateWeight(id: number, weight: string) {
    try {
      const supabase = getSupabase()
      await supabase.from("paver_product_types").update({ piece_weight_kg: weight ? Number(weight) : null }).eq("id", id)
    } catch {}
  }

  async function addSupplier() {
    if (!newSupplier.name.trim()) return
    try {
      const supabase = getSupabase()
      const { error } = await supabase.from("paver_suppliers").insert({
        ingredient_name: newSupplier.ingredient,
        supplier_name: newSupplier.name.trim(),
      })
      if (error) throw error
      toast({ title: "Agregado", description: `Proveedor ${newSupplier.name} agregado para ${newSupplier.ingredient}` })
      setNewSupplier({ ingredient: "Cemento", name: "" })
      setShowAddSupplier(false)
      loadAll()
    } catch (err) {
      toast({ title: "Error", description: `No se pudo agregar el proveedor: ${err instanceof Error ? err.message : "desconocido"}`, variant: "destructive" })
    }
  }

  async function toggleSupplierActive(supplier: Supplier) {
    try {
      const supabase = getSupabase()
      await supabase.from("paver_suppliers").update({ active: !supplier.active }).eq("id", supplier.id)
      loadAll()
    } catch {}
  }

  // Get unique ingredient names from all products for supplier management
  const supplierIngredients = ["Cemento", "Arena", "Piedra (0-6)"]
  const groupedSuppliers: Record<string, Supplier[]> = {}
  for (const s of suppliers) {
    if (!groupedSuppliers[s.ingredient_name]) groupedSuppliers[s.ingredient_name] = []
    groupedSuppliers[s.ingredient_name].push(s)
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── Product Types ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <LayoutGrid className="h-4 w-4 text-primary" />
              <CardTitle className="text-lg">Tipos de Producto</CardTitle>
            </div>
            <Button size="sm" onClick={() => setShowAddProduct(!showAddProduct)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Nuevo Producto
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {showAddProduct && (
            <div className="border border-dashed border-primary/30 rounded-md p-4 bg-primary/5 space-y-3">
              <h4 className="text-sm font-semibold text-primary">Agregar producto</h4>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">Codigo <span className="text-destructive">*</span></Label>
                  <Input placeholder="Ej: H10" value={newProduct.code}
                    onChange={e => setNewProduct(p => ({ ...p, code: e.target.value }))} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Descripcion</Label>
                  <Input placeholder="Adoquin H10" value={newProduct.description}
                    onChange={e => setNewProduct(p => ({ ...p, description: e.target.value }))} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Peso pieza (kg)</Label>
                  <Input type="number" step="0.001" placeholder="0.000" value={newProduct.weight}
                    onChange={e => setNewProduct(p => ({ ...p, weight: e.target.value }))} className="h-8 text-sm" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={addProduct} className="h-7 text-xs">Guardar</Button>
                <Button size="sm" variant="ghost" onClick={() => setShowAddProduct(false)} className="h-7 text-xs">Cancelar</Button>
              </div>
            </div>
          )}

          {/* Products table with expandable formula editor */}
          {products.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No hay productos configurados</p>
          ) : (
            <div className="space-y-3">
              {products.map(product => {
                const prodIngredients = getSavedIngredientsForProduct(product.id)
                const isEditing = editingIngredients[product.id] != null

                return (
                  <div key={product.id} className="border border-border rounded-lg overflow-hidden">
                    {/* Product header row */}
                    <div className="flex items-center gap-3 px-4 py-3 bg-muted/30">
                      <span className="text-sm font-bold text-foreground min-w-[50px]">{product.product_code}</span>
                      <span className="text-xs text-muted-foreground flex-1">{product.description}</span>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          <Label className="text-[10px] text-muted-foreground">Peso:</Label>
                          <Input
                            type="number" step="0.001"
                            defaultValue={product.piece_weight_kg || ""}
                            onBlur={e => updateWeight(product.id, e.target.value)}
                            className="h-7 text-xs w-20 text-right"
                            placeholder="kg"
                          />
                        </div>
                        <button
                          onClick={() => isEditing ? cancelEditIngredients(product.id) : startEditIngredients(product.id)}
                          className={`text-xs px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 ${
                            isEditing
                              ? "bg-primary/10 text-primary border border-primary/30"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          }`}
                        >
                          <FlaskConical className="h-3 w-3" />
                          Formula
                        </button>
                        <button
                          onClick={() => toggleActive(product)}
                          className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
                            product.active
                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          }`}
                        >
                          {product.active ? "Activo" : "Inactivo"}
                        </button>
                      </div>
                    </div>

                    {/* Saved formula (always visible when ingredients exist) */}
                    {prodIngredients.length > 0 && (
                      <div className="px-4 py-2 border-t border-border bg-card">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Formula actual:</span>
                          {prodIngredients.map(ing => (
                            <span key={ing.id} className="text-xs bg-muted px-2 py-0.5 rounded">
                              {ing.ingredient_name}: <strong>{ing.quantity_kg != null ? `${ing.quantity_kg} ${ing.unit || "kg"}` : "sin cargar"}</strong>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {!isEditing && prodIngredients.length === 0 && (
                      <div className="px-4 py-2 border-t border-border bg-card">
                        <span className="text-xs text-muted-foreground italic">Sin formula cargada - click en "Formula" para cargar</span>
                      </div>
                    )}

                    {/* Editable ingredients */}
                    {isEditing && (
                      <div className="px-4 py-3 border-t border-primary/20 bg-primary/3 space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-semibold text-primary flex items-center gap-1">
                            <FlaskConical className="h-3 w-3" /> Ingredientes del Paston
                          </h4>
                          <button
                            onClick={() => addIngredientRow(product.id)}
                            className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                          >
                            <Plus className="h-3 w-3" /> Agregar ingrediente
                          </button>
                        </div>
                        <div className="space-y-1.5">
                          {(editingIngredients[product.id] || []).map((ing, idx) => (
                            <div key={ing.id} className="flex items-center gap-2">
                              <Input
                                value={ing.ingredient_name}
                                onChange={e => updateEditingIngredient(product.id, idx, "ingredient_name", e.target.value)}
                                placeholder="Nombre ingrediente"
                                className="h-7 text-xs flex-1"
                              />
                              <Input
                                type="number" step="0.01"
                                value={ing.quantity_kg ?? ""}
                                onChange={e => updateEditingIngredient(product.id, idx, "quantity_kg", e.target.value ? Number(e.target.value) : null)}
                                placeholder="Cant."
                                className="h-7 text-xs w-24 text-right"
                              />
                              <select
                                value={ing.unit}
                                onChange={e => updateEditingIngredient(product.id, idx, "unit", e.target.value)}
                                className="h-7 text-xs border border-border rounded-md bg-card px-1.5"
                              >
                                <option value="kg">kg</option>
                                <option value="lts">lts</option>
                                <option value="cc">cc</option>
                              </select>
                              <button
                                onClick={() => removeIngredientRow(product.id, idx)}
                                className="text-muted-foreground hover:text-destructive p-1 transition-colors"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            onClick={() => saveIngredients(product.id)}
                            disabled={savingIngredients === product.id}
                            className="h-7 text-xs"
                          >
                            <Save className="h-3 w-3 mr-1" />
                            {savingIngredients === product.id ? "Guardando..." : "Guardar Formula"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => cancelEditIngredients(product.id)} className="h-7 text-xs">
                            <X className="h-3 w-3 mr-1" /> Cancelar
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

      {/* ── Suppliers ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-accent" />
              <CardTitle className="text-lg">Proveedores de Materia Prima</CardTitle>
            </div>
            <Button size="sm" variant="outline" onClick={() => setShowAddSupplier(!showAddSupplier)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Nuevo Proveedor
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Administra los proveedores de Cemento, Arena y Piedra. Al cargar un parte diario se registra el proveedor activo y cualquier cambio.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {showAddSupplier && (
            <div className="border border-dashed border-accent/30 rounded-md p-4 bg-accent/5 space-y-3">
              <h4 className="text-sm font-semibold text-accent">Agregar proveedor</h4>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Material</Label>
                  <select
                    value={newSupplier.ingredient}
                    onChange={e => setNewSupplier(p => ({ ...p, ingredient: e.target.value }))}
                    className="w-full h-8 text-sm border border-border rounded-md bg-card px-2"
                  >
                    {supplierIngredients.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Nombre del proveedor <span className="text-destructive">*</span></Label>
                  <Input placeholder="Ej: Loma Negra" value={newSupplier.name}
                    onChange={e => setNewSupplier(p => ({ ...p, name: e.target.value }))} className="h-8 text-sm" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={addSupplier} className="h-7 text-xs">Guardar</Button>
                <Button size="sm" variant="ghost" onClick={() => setShowAddSupplier(false)} className="h-7 text-xs">Cancelar</Button>
              </div>
            </div>
          )}

          {/* Suppliers grouped by ingredient */}
          {supplierIngredients.map(ingredientName => {
            const sups = groupedSuppliers[ingredientName] || []
            return (
              <div key={ingredientName}>
                <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-accent" />
                  {ingredientName}
                  <span className="text-muted-foreground font-normal">({sups.length} proveedor{sups.length !== 1 ? "es" : ""})</span>
                </h4>
                {sups.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground ml-3.5 mb-3">Sin proveedores registrados</p>
                ) : (
                  <div className="flex flex-wrap gap-2 ml-3.5 mb-3">
                    {sups.map(sup => (
                      <button
                        key={sup.id}
                        onClick={() => toggleSupplierActive(sup)}
                        className={`text-xs px-3 py-1 rounded-md border transition-colors ${
                          sup.active
                            ? "bg-accent/10 border-accent/30 text-accent font-medium"
                            : "bg-muted/50 border-border text-muted-foreground line-through"
                        }`}
                      >
                        {sup.supplier_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
