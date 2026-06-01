"use client"

import type React from "react"
import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Plus, X, Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"

type Material = {
  id: string
  name: string
  unit: string
}

type FormulaMaterial = {
  material_id: string
  quantity: string
}

interface AddFormulaDialogProps {
  materials: Material[]
  plantId: string
  onSuccess: () => void
}

const RESISTENCIAS_COMUNES = ["H4", "H8", "H13", "H17", "H21", "H25", "H30", "H35", "H40", "H45", "H50"]
const METODOS = [
  { value: "C", label: "Canaleta" },
  { value: "B", label: "Bombeable" },
]

export function AddFormulaDialog({ materials, plantId, onSuccess }: AddFormulaDialogProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [resistenciaOpen, setResistenciaOpen] = useState(false)
  const [resistenciaInput, setResistenciaInput] = useState("")
  const [formData, setFormData] = useState({
    resistencia: "",
    tipoPiedra: "",
    asentamiento: "",
    metodo: "none",
    yield_m3: "1.0",
  })
  const [formulaMaterials, setFormulaMaterials] = useState<FormulaMaterial[]>([])
  const { toast } = useToast()

  // Auto-generate code
  const generatedCode = useMemo(() => {
    if (!formData.resistencia) return ""
    
    const parts = [formData.resistencia]
    
    if (formData.tipoPiedra) {
      parts.push(formData.tipoPiedra)
    }
    
    if (formData.asentamiento) {
      parts.push(formData.asentamiento)
    }
    
    const code = parts.join("-")
    return formData.metodo && formData.metodo !== "none" ? `${code} ${formData.metodo}` : code
  }, [formData])

  // Auto-generate name
  const generatedName = useMemo(() => {
    if (!formData.resistencia) return ""
    
    let name = `Hormigon ${formData.resistencia}`
    
    if (formData.tipoPiedra) {
      name += ` Piedra ${formData.tipoPiedra}`
    }
    
    if (formData.asentamiento) {
      name += ` Asentamiento ${formData.asentamiento}cm`
    }
    
    if (formData.metodo && formData.metodo !== "none") {
      const metodoText = formData.metodo === "B" ? "Bombeable" : "Canaleta"
      name += ` ${metodoText}`
    }
    
    return name
  }, [formData])

  const addMaterial = () => {
    setFormulaMaterials([...formulaMaterials, { material_id: "", quantity: "0" }])
  }

  const removeMaterial = (index: number) => {
    setFormulaMaterials(formulaMaterials.filter((_, i) => i !== index))
  }

  const updateMaterial = (index: number, field: keyof FormulaMaterial, value: string) => {
    const updated = [...formulaMaterials]
    updated[index][field] = value
    setFormulaMaterials(updated)
  }

  const resetForm = () => {
    setFormData({
      resistencia: "",
      tipoPiedra: "",
      asentamiento: "",
      metodo: "none",
      yield_m3: "1.0",
    })
    setFormulaMaterials([])
    setResistenciaInput("")
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.resistencia) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Debes seleccionar una resistencia",
      })
      return
    }

    if (formulaMaterials.length === 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Debes agregar al menos un material a la formula",
      })
      return
    }

    if (formulaMaterials.some((m) => !m.material_id || Number.parseFloat(m.quantity) <= 0)) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Todos los materiales deben tener un material seleccionado y una cantidad valida",
      })
      return
    }

    setLoading(true)

    try {
      const supabase = createClient()

      // Insert formula
      const { data: formula, error: formulaError } = await supabase
        .from("formulas")
        .insert({
          code: generatedCode,
          name: generatedName,
          description: null,
          yield_m3: Number.parseFloat(formData.yield_m3),
          plant_id: plantId,
        })
        .select()
        .single()

      if (formulaError) throw formulaError

      // Insert formula materials
      const { error: materialsError } = await supabase.from("formula_materials").insert(
        formulaMaterials.map((m) => ({
          formula_id: formula.id,
          material_id: m.material_id,
          quantity: Number.parseFloat(m.quantity),
        })),
      )

      if (materialsError) throw materialsError

      toast({
        title: "Formula agregada",
        description: `${generatedCode} se agrego correctamente`,
      })

      resetForm()
      setOpen(false)
      onSuccess()
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo agregar la formula",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm() }}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Agregar Formula
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Agregar Formula</DialogTitle>
          <DialogDescription>Crea una nueva formula de hormigon con su composicion</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Code preview */}
          {generatedCode && (
            <div className="bg-muted p-3 rounded-lg">
              <p className="text-sm text-muted-foreground">Codigo generado:</p>
              <p className="text-lg font-mono font-bold">{generatedCode}</p>
            </div>
          )}

          {/* Formula parameters */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Resistencia *</Label>
              <Popover open={resistenciaOpen} onOpenChange={setResistenciaOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={resistenciaOpen}
                    className="w-full justify-between font-normal"
                  >
                    {formData.resistencia || "Seleccionar o escribir..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[200px] p-0" align="start">
                  <Command>
                    <CommandInput 
                      placeholder="Buscar o escribir (ej: H35)..." 
                      value={resistenciaInput}
                      onValueChange={setResistenciaInput}
                    />
                    <CommandList>
                      <CommandEmpty>
                        {resistenciaInput && (
                          <Button
                            variant="ghost"
                            className="w-full justify-start"
                            onClick={() => {
                              const value = resistenciaInput.toUpperCase().startsWith("H") 
                                ? resistenciaInput.toUpperCase() 
                                : `H${resistenciaInput}`
                              setFormData({ ...formData, resistencia: value })
                              setResistenciaInput("")
                              setResistenciaOpen(false)
                            }}
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            Crear "{resistenciaInput.toUpperCase().startsWith("H") ? resistenciaInput.toUpperCase() : `H${resistenciaInput}`}"
                          </Button>
                        )}
                      </CommandEmpty>
                      <CommandGroup>
                        {RESISTENCIAS_COMUNES.map((r) => (
                          <CommandItem
                            key={r}
                            value={r}
                            onSelect={() => {
                              setFormData({ ...formData, resistencia: r })
                              setResistenciaInput("")
                              setResistenciaOpen(false)
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", formData.resistencia === r ? "opacity-100" : "opacity-0")} />
                            {r}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>Metodo (opcional)</Label>
              <Select 
                value={formData.metodo} 
                onValueChange={(v) => setFormData({ ...formData, metodo: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sin metodo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin metodo</SelectItem>
                  {METODOS.map(m => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tipo de Piedra</Label>
              <Input
                value={formData.tipoPiedra}
                onChange={(e) => setFormData({ ...formData, tipoPiedra: e.target.value })}
                placeholder="Ej: 6/20"
              />
            </div>
            <div className="space-y-2">
              <Label>Asentamiento (cm)</Label>
              <Input
                type="number"
                min="1"
                max="30"
                value={formData.asentamiento}
                onChange={(e) => setFormData({ ...formData, asentamiento: e.target.value })}
                placeholder="Ej: 10"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Rinde (m3)</Label>
            <Input
              type="number"
              step="0.001"
              value={formData.yield_m3}
              onChange={(e) => setFormData({ ...formData, yield_m3: e.target.value })}
              required
            />
          </div>

          {/* Materials */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Composicion</Label>
              <Button type="button" variant="outline" size="sm" onClick={addMaterial}>
                <Plus className="h-4 w-4 mr-1" />
                Agregar Material
              </Button>
            </div>

            {formulaMaterials.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4 border rounded-lg">
                No hay materiales agregados. Haz clic en "Agregar Material" para comenzar.
              </p>
            ) : (
              <div className="space-y-2">
                {formulaMaterials.map((fm, index) => (
                  <div key={index} className="flex gap-2 items-end">
                    <div className="flex-1 space-y-2">
                      <Label className="text-xs">Material</Label>
                      <Select
                        value={fm.material_id}
                        onValueChange={(value) => updateMaterial(index, "material_id", value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar..." />
                        </SelectTrigger>
                        <SelectContent>
                          {materials.map((material) => (
                            <SelectItem key={material.id} value={material.id}>
                              {material.name} ({material.unit})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-32 space-y-2">
                      <Label className="text-xs">Cantidad</Label>
                      <Input
                        type="number"
                        step="0.001"
                        value={fm.quantity}
                        onChange={(e) => updateMaterial(index, "quantity", e.target.value)}
                        placeholder="0"
                      />
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeMaterial(index)}>
                      <X className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
