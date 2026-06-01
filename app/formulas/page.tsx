"use client"

import { useEffect, useState, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { PlantSelector } from "@/components/plant-selector"
import { FormulasGroupedView } from "@/components/formulas-grouped-view"
import { AddFormulaDialog } from "@/components/add-formula-dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Search } from "lucide-react"

const RESISTENCIAS = ["H4", "H8", "H13", "H17", "H21", "H25", "H30", "H35", "H40", "H45", "H50"]
const METODOS = ["Todos", "Canaleta", "Bombeable"]

export default function FormulasPage() {
  const [formulas, setFormulas] = useState<any[]>([])
  const [materials, setMaterials] = useState<any[]>([])
  const [plants, setPlants] = useState<any[]>([])
  const [selectedPlant, setSelectedPlant] = useState<string>("")
  const [filterResistencia, setFilterResistencia] = useState<string>("Todos")
  const [filterMetodo, setFilterMetodo] = useState<string>("Todos")
  const [searchTerm, setSearchTerm] = useState("")
  const supabase = createClient()

  useEffect(() => {
    loadPlants()
  }, [])

  useEffect(() => {
    if (selectedPlant) {
      loadFormulas()
      loadMaterials()
    }
  }, [selectedPlant])

  async function loadPlants() {
    const { data } = await supabase.from("plants").select("*").order("name")
    if (data && data.length > 0) {
      setPlants(data)
      setSelectedPlant(data[0].id)
    }
  }

  async function loadFormulas() {
    const { data } = await supabase
      .from("formulas")
      .select(`
        *,
        formula_materials (
          id,
          quantity,
          materials (
            id,
            name,
            unit
          )
        )
      `)
      .eq("plant_id", selectedPlant)
      .order("code", { ascending: true })
    setFormulas(data || [])
  }

  async function loadMaterials() {
    const { data } = await supabase
      .from("materials")
      .select("*")
      .eq("plant_id", selectedPlant)
      .order("name", { ascending: true })
    setMaterials(data || [])
  }

  // Parse formula code to extract components
  const parseFormulaCode = (code: string) => {
    // Format: H21-6/20-10 C (nuevo formato con tipo piedra como "6/20")
    const newMatch = code.match(/^(H\d+)-([^-]+)-(\d+)\s*([CB])?$/i)
    if (newMatch) {
      return {
        resistencia: newMatch[1].toUpperCase(),
        tipoPiedra: newMatch[2],
        asentamiento: newMatch[3],
        metodo: newMatch[4]?.toUpperCase() === "B" ? "Bombeable" : newMatch[4]?.toUpperCase() === "C" ? "Canaleta" : null
      }
    }
    // Format legacy: H21-612-10 C or H21-612-10 B
    const match = code.match(/^(H\d+)-(\d)(\d+)-(\d+)\s*([CB])?$/i)
    if (match) {
      return {
        resistencia: match[1].toUpperCase(),
        tipoPiedra: `${match[2]}/${match[3]}`,
        asentamiento: match[4],
        metodo: match[5]?.toUpperCase() === "B" ? "Bombeable" : match[5]?.toUpperCase() === "C" ? "Canaleta" : null
      }
    }
    // Format: H21-6/20 (sin asentamiento ni método)
    const noAsentMatch = code.match(/^(H\d+)-([^-\s]+)\s*([CB])?$/i)
    if (noAsentMatch) {
      return {
        resistencia: noAsentMatch[1].toUpperCase(),
        tipoPiedra: noAsentMatch[2],
        asentamiento: null,
        metodo: noAsentMatch[3]?.toUpperCase() === "B" ? "Bombeable" : noAsentMatch[3]?.toUpperCase() === "C" ? "Canaleta" : null
      }
    }
    // Try simpler format H21 C or just H21
    const simpleMatch = code.match(/^(H\d+)\s*([CB])?$/i)
    if (simpleMatch) {
      return {
        resistencia: simpleMatch[1].toUpperCase(),
        tipoPiedra: null,
        asentamiento: null,
        metodo: simpleMatch[2]?.toUpperCase() === "B" ? "Bombeable" : simpleMatch[2]?.toUpperCase() === "C" ? "Canaleta" : null
      }
    }
    return null
  }

  // Filter and group formulas
  const filteredAndGrouped = useMemo(() => {
    let filtered = formulas

    // Filter by search
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(f => 
        f.code.toLowerCase().includes(term) || 
        f.name.toLowerCase().includes(term)
      )
    }

    // Filter by method
    if (filterMetodo !== "Todos") {
      filtered = filtered.filter(f => {
        const parsed = parseFormulaCode(f.code)
        return parsed?.metodo === filterMetodo
      })
    }

    // Filter by resistencia
    if (filterResistencia !== "Todos") {
      filtered = filtered.filter(f => {
        const parsed = parseFormulaCode(f.code)
        return parsed?.resistencia === filterResistencia
      })
    }

    // Group by resistencia
    const grouped: Record<string, any[]> = {}
    RESISTENCIAS.forEach(r => { grouped[r] = [] })
    
    filtered.forEach(f => {
      const parsed = parseFormulaCode(f.code)
      if (parsed && grouped[parsed.resistencia]) {
        grouped[parsed.resistencia].push({ ...f, parsed })
      } else {
        // Put unmatched formulas in a special group
        if (!grouped["Otros"]) grouped["Otros"] = []
        grouped["Otros"].push({ ...f, parsed: null })
      }
    })

    return grouped
  }, [formulas, filterResistencia, filterMetodo, searchTerm])

  return (
    <div className="py-6 px-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Formulas</h1>
          <p className="text-sm text-foreground/70 font-medium mt-1">Gestion de formulas de hormigon</p>
        </div>
        <AddFormulaDialog materials={materials} plantId={selectedPlant} onSuccess={loadFormulas} />
      </div>

      <PlantSelector plants={plants} selectedPlant={selectedPlant} onPlantChange={setSelectedPlant} />

      {/* Filters */}
      <div className="mt-6 space-y-4">
        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por codigo o nombre..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Resistencia filter pills */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant={filterResistencia === "Todos" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterResistencia("Todos")}
          >
            Todos
          </Button>
          {RESISTENCIAS.map(r => (
            <Button
              key={r}
              variant={filterResistencia === r ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterResistencia(r)}
            >
              {r}
            </Button>
          ))}
        </div>

        {/* Method filter */}
        <div className="flex gap-2">
          {METODOS.map(m => (
            <Button
              key={m}
              variant={filterMetodo === m ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setFilterMetodo(m)}
            >
              {m}
            </Button>
          ))}
        </div>
      </div>

      {/* Grouped view */}
      <div className="mt-6">
        <FormulasGroupedView 
          groupedFormulas={filteredAndGrouped} 
          materials={materials}
          onUpdate={loadFormulas}
          expandedGroup={filterResistencia !== "Todos" ? filterResistencia : null}
        />
      </div>
    </div>
  )
}
