"use client"

import { Suspense, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { StockEntriesTable } from "@/components/stock-entries-table"
import { AddStockEntryDialog } from "@/components/add-stock-entry-dialog"
import { AddMaterialDialog } from "@/components/add-material-dialog"
import { PlantSelector } from "@/components/plant-selector"
import { DateRangeFilter } from "@/components/date-range-filter"
import { MaterialFilter } from "@/components/material-filter"
import { HumidityExcessTable } from "@/components/humidity-excess-table"
import { StockEvolutionChart } from "@/components/stock-evolution-chart"
import { SuppliersTable } from "@/components/suppliers-table"
import { TrendingUp, Droplets, Loader2, Package, BarChart3, Truck, Download, ClipboardCheck, Scale, RefreshCw } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import * as XLSX from "xlsx"
import { SeccionProtegida } from "@/components/seccion-protegida"
import { usePermisos } from "@/lib/current-user"
import { ControlIngresosZomatik } from "@/components/control-ingresos-zomatik"
import { ControlStockZomatik } from "@/components/control-stock-zomatik"
import { useToast } from "@/hooks/use-toast"
import { esArenaFina } from "@/lib/ingresos/muestras"

/** Estado de la importación de ingresos desde Zomatik (docs/ingresos-mp-zomatik.md), de /api/ingresos-zomatik. */
type EstadoImportacion = {
  modo: "apagado" | "sombra" | "real"
  desde: string | null
  activa: boolean
  avisosHumedad: { id: string; fecha: string; remito: string | null; planta: string; horas: number }[]
}

export default function MateriasPrimasPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
      <SeccionProtegida seccion="materia_prima">
        <MateriasPrimasContent />
      </SeccionProtegida>
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
  const { puede, esGerencial } = usePermisos()
  // Control con Zomatik: gerenciales o materia_prima.editar (el servidor lo vuelve a controlar)
  const veControl = esGerencial || puede("materia_prima", "editar")
  const supabase = createClient()
  const { toast } = useToast()
  // Importación desde Zomatik: sin la migración o sin el interruptor, apagada (todo como siempre)
  const [imp, setImp] = useState<EstadoImportacion>({ modo: "apagado", desde: null, activa: false, avisosHumedad: [] })
  const [trayendo, setTrayendo] = useState(false)
  const [soloSinHumedad, setSoloSinHumedad] = useState(false)

  useEffect(() => {
    loadPlants()
    fetch("/api/ingresos-zomatik", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setImp({ modo: j.modo || "apagado", desde: j.desde || null, activa: !!j.activa, avisosHumedad: j.avisosHumedad || [] }))
      .catch(() => {})
  }, [])

  async function traerDeZomatik() {
    setTrayendo(true)
    try {
      const r = await fetch("/api/ingresos-zomatik/pasada", { method: "POST" })
      const j = await r.json().catch(() => ({}))
      toast({ title: j?.mensaje || j?.error || (r.ok ? "Listo" : "No se pudo traer de Zomatik"), variant: r.ok || r.status === 409 ? undefined : "destructive" })
    } catch {
      toast({ title: "No se pudo traer de Zomatik. Probá en un rato.", variant: "destructive" })
    }
    setTrayendo(false)
    loadEntries()
  }

  // Lo importado de Zomatik entra sin humedad: se carga después desde la fila
  const sinHumedad = (e: any) => e.origen === "zomatik" && esArenaFina(e.materials?.name) && e.humidity_percentage === null && !e.anulado_at
  const cuantosSinHumedad = entries.filter(sinHumedad).length

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
    const consulta = (columnas: string) => {
      let q = supabase.from("stock_entries").select(columnas).in("material_id", matIds)
      if (startDate) q = q.gte("entry_date", `${startDate}T00:00:00`)
      if (endDate) q = q.lte("entry_date", `${endDate}T23:59:59`)
      if (scope === "current" && selectedMaterial && selectedMaterial !== "all") q = q.eq("material_id", selectedMaterial)
      return q.order("entry_date", { ascending: false }).limit(10000)
    }
    const base = "entry_date, quantity, humidity_percentage, remito, notes, supplier, materials(name, plant_id), suppliers(name)"
    // Con la migración de la importación, también el origen; sin ella, como siempre
    let { data, error } = (await consulta(`${base}, origen, anulado_at`)) as { data: any[] | null; error: any }
    if (error) ({ data } = (await consulta(base)) as { data: any[] | null; error: any })
    const plantName: Record<string, string> = {}
    plants.forEach((p: any) => (plantName[p.id] = p.name))
    const rows = (data || []).map((e: any) => ({
      Planta: plantName[e.materials?.plant_id] || "-",
      Fecha: e.entry_date ? e.entry_date.split("T")[0].split("-").reverse().join("/") : "-",
      Material: e.materials?.name || "-",
      Proveedor: e.suppliers?.name || e.supplier || "-",
      Remito: e.remito || "-",
      "Cantidad (kg)": e.quantity,
      "Humedad %": e.humidity_percentage ?? "-",
      Notas: e.notes || "-",
      Origen: e.origen === "zomatik" ? (e.anulado_at ? "Zomatik (anulado)" : "Zomatik") : e.anulado_at ? "A mano (anulado)" : "A mano",
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
    ...(veControl ? [{ id: "control", label: "Control con Zomatik", icon: ClipboardCheck }] : []),
    ...(veControl ? [{ id: "control-stock", label: "Control de stock", icon: Scale }] : []),
  ]

  return (
    <div className="py-4 px-4 md:py-6 md:px-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 md:mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">Materias Primas</h1>
          <p className="text-xs md:text-sm text-foreground/70 font-medium mt-1">Gestion de stock e ingresos de materia prima</p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === "stock" && puede("formulas", "cargar") && (
            <AddMaterialDialog plantId={selectedPlant} plants={plants} onSuccess={loadMaterials} />
          )}
          {activeTab === "ingresos" && veControl && imp.modo !== "apagado" && (
            <Button variant="outline" className="gap-2" disabled={trayendo} onClick={traerDeZomatik}>
              {trayendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Traer de Zomatik
            </Button>
          )}
          {activeTab === "ingresos" && puede("materia_prima", "cargar") && <AddStockEntryDialog materials={materials} onSuccess={loadEntries} plants={plants} importacionActiva={imp.activa} />}
        </div>
      </div>

      {imp.avisosHumedad.length > 0 && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Arena Fina sin humedad: {imp.avisosHumedad.length} {imp.avisosHumedad.length === 1 ? "ingreso" : "ingresos"} de {[...new Set(imp.avisosHumedad.map((a) => a.planta))].join(" y ")} de hace más de 24 h (
          {imp.avisosHumedad
            .slice(0, 5)
            .map((a) => `${a.fecha.split("-").reverse().slice(0, 2).join("/")} ${a.remito || ""}`.trim())
            .join(", ")}
          ). Cargala en Ingresos › menú de la fila › Cargar humedad.
        </div>
      )}

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
              {tab.id === "stock" ? "Stock" : tab.id === "ingresos" ? "Ingresos" : tab.id === "humedad" ? "Humedad" : tab.id === "control" ? "Control" : tab.id === "control-stock" ? "Stock MP" : "Proveedores"}
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
            {imp.activa && (
              <div className="text-xs text-muted-foreground">
                Arena, piedra, cemento, aditivos y fibra entran solos desde Zomatik. Acá cargás humedad y muestra.{" "}
                <span className="cursor-help" title="Se lee Zomatik cada 30 min, de 6 a 20.">
                  (?)
                </span>
              </div>
            )}
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
            {(cuantosSinHumedad > 0 || soloSinHumedad) && (
              <button
                className={cn("rounded-md border px-2 py-1 text-xs", soloSinHumedad ? "border-amber-400 bg-amber-50 text-amber-900" : "text-muted-foreground")}
                onClick={() => setSoloSinHumedad(!soloSinHumedad)}
              >
                {soloSinHumedad ? "Ver todos" : `Sin humedad (${cuantosSinHumedad} sin humedad)`}
              </button>
            )}
          </div>

          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <StockEntriesTable entries={soloSinHumedad ? entries.filter(sinHumedad) : entries} onRefresh={loadEntries} />
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

      {/* Control con Zomatik */}
      {activeTab === "control" && veControl && <ControlIngresosZomatik plants={plants} />}

      {/* Control de stock: nuestro sistema contra Zomatik */}
      {activeTab === "control-stock" && veControl && <ControlStockZomatik />}
    </div>
  )
}
