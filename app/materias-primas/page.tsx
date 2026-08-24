"use client"

import { Suspense, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { StockEntriesTable } from "@/components/stock-entries-table"
import { AddStockEntryDialog } from "@/components/add-stock-entry-dialog"
import { PlantSelector } from "@/components/plant-selector"
import { DateRangeFilter } from "@/components/date-range-filter"
import { MaterialFilter } from "@/components/material-filter"
import { HumidityExcessTable } from "@/components/humidity-excess-table"
import { StockEvolutionChart } from "@/components/stock-evolution-chart"
import { SuppliersTable } from "@/components/suppliers-table"
import { TrendingUp, Droplets, Loader2, Package, BarChart3, Truck, Download } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import * as XLSX from "xlsx"

export default function MateriasPrimasPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
      <MateriasPrimasContent />
    </Suspense>
  )
}

/** Valor del selector de planta para "Todas las plantas" */
const ALL_PLANTS = "all"

function MateriasPrimasContent() {
  const [entries, setEntries] = useState<any[]>([])
  const [materials, setMaterials] = useState<any[]>([])
  const [plants, setPlants] = useState<any[]>([])
  const [selectedPlant, setSelectedPlant] = useState<string>("")
  const [startDate, setStartDate] = useState<string | null>(null)
  const [endDate, setEndDate] = useState<string | null>(null)
  const [selectedMaterial, setSelectedMaterial] = useState<string>("all")
  const searchParams = useSearchParams()
  const activeTab = searchParams.get("tab") || "stock"
  const supabase = createClient()

  useEffect(() => {
    loadPlants()
  }, [])

  useEffect(() => {
    if (selectedPlant) {
      loadEntries()
      loadMaterials()
    }
  }, [selectedPlant, startDate, endDate, selectedMaterial])

  async function loadPlants() {
    const { data } = await supabase.from("plants").select("*").order("name")
    if (data && data.length > 0) {
      setPlants(data)
      setSelectedPlant(data[0].id)
    }
  }

  async function loadEntries() {
    // First get material IDs for this plant ("all" = todas las plantas)
    let plantMaterialsQuery = supabase.from("materials").select("id")
    if (selectedPlant !== ALL_PLANTS) plantMaterialsQuery = plantMaterialsQuery.eq("plant_id", selectedPlant)
    const { data: plantMaterials } = await plantMaterialsQuery

    const materialIds = plantMaterials?.map(m => m.id) || []

    if (materialIds.length === 0) {
      setEntries([])
      return
    }

    let query = supabase
      .from("stock_entries")
      .select(`
        *,
        materials (
          id,
          name,
          unit,
          plant_id,
          current_stock
        ),
        suppliers (
          id,
          name
        ),
        granulometria_tests:granulometry_test_id (
          id,
          fineness_modulus,
          extraction_date
        )
      `)
      .in("material_id", materialIds)

    if (startDate) {
      query = query.gte("entry_date", `${startDate}T00:00:00`)
    }
    if (endDate) {
      query = query.lte("entry_date", `${endDate}T23:59:59`)
    }
    if (selectedMaterial && selectedMaterial !== "all") {
      query = query.eq("material_id", selectedMaterial)
    }

    const { data, error } = await query.order("entry_date", { ascending: false }).limit(10000)
    setEntries(data || [])
  }

  async function loadMaterials() {
    let query = supabase
      .from("materials")
      .select("*")
      .neq("name", "Agua")
      .order("name", { ascending: true })
    if (selectedPlant !== ALL_PLANTS) query = query.eq("plant_id", selectedPlant)
    const { data } = await query
    setMaterials(data || [])
  }

  const handleDateFilterChange = (start: string | null, end: string | null) => {
    setStartDate(start)
    setEndDate(end)
  }

  async function exportIngresos(scope: "current" | "both") {
    let matQuery = supabase.from("materials").select("id, name, plant_id")
    if (scope === "current" && selectedPlant !== ALL_PLANTS) matQuery = matQuery.eq("plant_id", selectedPlant)
    const { data: mats } = await matQuery
    const matIds = (mats || []).map((m: any) => m.id)
    if (matIds.length === 0) return
    let q = supabase
      .from("stock_entries")
      .select("entry_date, quantity, humidity_percentage, remito, notes, materials(name, plant_id), suppliers(name)")
      .in("material_id", matIds)
    if (startDate) q = q.gte("entry_date", `${startDate}T00:00:00`)
    if (endDate) q = q.lte("entry_date", `${endDate}T23:59:59`)
    if (scope === "current" && selectedMaterial && selectedMaterial !== "all") q = q.eq("material_id", selectedMaterial)
    const { data } = await q.order("entry_date", { ascending: false }).limit(10000)
    const plantName: Record<string, string> = {}
    plants.forEach((p: any) => (plantName[p.id] = p.name))
    const rows = (data || []).map((e: any) => ({
      Planta: plantName[e.materials?.plant_id] || "-",
      Fecha: e.entry_date ? e.entry_date.split("T")[0].split("-").reverse().join("/") : "-",
      Material: e.materials?.name || "-",
      Proveedor: e.suppliers?.name || "-",
      Remito: e.remito || "-",
      "Cantidad (kg)": e.quantity,
      "Humedad %": e.humidity_percentage ?? "-",
      Notas: e.notes || "-",
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Ingresos")
    XLSX.writeFile(wb, `ingresos_${scope === "both" ? "ambas" : "planta"}_${startDate || "todo"}_${endDate || "todo"}.xlsx`)
  }

  const tabs = [
    { id: "stock", label: "Evolucion Stock", icon: BarChart3 },
    { id: "ingresos", label: "Ingresos", icon: TrendingUp },
    { id: "humedad", label: "Excedentes de Humedad", icon: Droplets },
    { id: "proveedores", label: "Proveedores", icon: Truck },
  ]

  return (
    <div className="py-4 px-4 md:py-6 md:px-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 md:mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">Materias Primas</h1>
          <p className="text-xs md:text-sm text-foreground/70 font-medium mt-1">Gestion de stock e ingresos de materia prima</p>
        </div>
        {activeTab === "ingresos" && <AddStockEntryDialog materials={materials} onSuccess={loadEntries} plants={plants} />}
      </div>

      {/* Tabs */}
      <div className="flex h-10 items-center justify-start rounded-lg bg-muted/80 p-1 mb-4 md:mb-6 overflow-x-auto border border-border/50">
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={`/materias-primas?tab=${tab.id}`}
            className={cn(
              "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-xs md:text-sm font-semibold ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 gap-1.5 md:gap-2",
              activeTab === tab.id
                ? "bg-background text-foreground shadow-md border border-border"
                : "text-foreground/70 hover:bg-background/70 hover:text-foreground"
            )}
          >
            <tab.icon className="h-4 w-4" />
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">
              {tab.id === "stock" ? "Stock" : tab.id === "ingresos" ? "Ingresos" : tab.id === "humedad" ? "Humedad" : "Proveedores"}
            </span>
          </Link>
        ))}
      </div>

      {/* Stock Evolution Tab */}
      {activeTab === "stock" && (
        <>
          <div className="mb-4 md:mb-6">
            <PlantSelector plants={plants} selectedPlant={selectedPlant} onPlantChange={setSelectedPlant} />
          </div>
          
          {selectedPlant && <StockEvolutionChart plantId={selectedPlant} />}
        </>
      )}

      {/* Ingresos Tab */}
      {activeTab === "ingresos" && (
        <>
          <div className="space-y-3 md:space-y-4 mb-4 md:mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <PlantSelector plants={plants} selectedPlant={selectedPlant} onPlantChange={setSelectedPlant} />
              <DateRangeFilter onFilterChange={handleDateFilterChange} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <Download className="h-4 w-4" />
                    Exportar Excel
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => exportIngresos("current")}>
                    Planta actual
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportIngresos("both")}>
                    Ambas plantas
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <MaterialFilter
              materials={materials}
              selectedMaterial={selectedMaterial}
              onFilterChange={setSelectedMaterial}
            />
          </div>

          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <StockEntriesTable entries={entries} onRefresh={loadEntries} />
          </div>
        </>
      )}

      {/* Humedad Tab */}
      {activeTab === "humedad" && (
        <>
          <div className="mb-4 md:mb-6">
            <PlantSelector plants={plants} selectedPlant={selectedPlant} onPlantChange={setSelectedPlant} />
          </div>
          
          {selectedPlant && (
            <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
              <HumidityExcessTable plantId={selectedPlant} />
            </div>
          )}
        </>
      )}

      {/* Proveedores Tab */}
      {activeTab === "proveedores" && (
        <>
          <div className="mb-4 md:mb-6">
            <PlantSelector plants={plants} selectedPlant={selectedPlant} onPlantChange={setSelectedPlant} />
          </div>
          
          {selectedPlant && <SuppliersTable plantId={selectedPlant} />}
        </>
      )}
    </div>
  )
}
