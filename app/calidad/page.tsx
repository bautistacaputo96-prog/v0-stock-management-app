"use client"

import { useState, useEffect, Suspense } from "react"
import { TestTube2, Hammer, Filter, BarChart3 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { TestCylindersTable } from "@/components/test-cylinders-table"
import { CylinderBreakingTable } from "@/components/cylinder-breaking-table"
import { GranulometriaTable } from "@/components/granulometria-table"
import { BreakingResultsTable } from "@/components/breaking-results-table"
import { useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"

interface Plant {
  id: string
  code: string
  name: string
}

function CalidadContent() {
  const searchParams = useSearchParams()
  const activeTab = searchParams.get("tab") || "probetas"
  
  const [plantsData, setPlantsData] = useState<Plant[]>([])
  const [initialPlantId, setInitialPlantId] = useState("all")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadPlants() {
      try {
        const supabase = createClient()
        const { data: plants } = await supabase.from("plants").select("*").order("name")
        setPlantsData(plants || [])
        setInitialPlantId(plants && plants.length > 0 ? plants[0].id : "all")
      } catch (error) {
        console.error("[v0] Error loading plants:", error)
      } finally {
        setLoading(false)
      }
    }
    loadPlants()
  }, [])

  const tabs = [
    { id: "probetas", label: "Extraccion de Probetas", icon: TestTube2 },
    { id: "rotura", label: "Rotura de Probetas", icon: Hammer },
    { id: "resultados", label: "Resultados de Roturas", icon: BarChart3 },
    { id: "granulometria", label: "Granulometria", icon: Filter },
  ]

  if (loading) {
    return (
      <div className="py-6 px-6 flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="py-6 px-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Control de Calidad</h1>
        <p className="text-sm text-foreground/70 font-medium mt-1">Gestion de probetas y ensayos de resistencia</p>
      </div>

      <div className="space-y-4">
        <div className="inline-flex h-10 items-center justify-center rounded-lg bg-muted/80 p-1 border border-border/50">
          {tabs.map((tab) => (
            <a
              key={tab.id}
              href={`/calidad?tab=${tab.id}`}
              className={cn(
                "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 gap-2",
                activeTab === tab.id
                  ? "bg-background text-foreground shadow-md border border-border"
                  : "text-foreground/70 hover:bg-background/70 hover:text-foreground"
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </a>
          ))}
        </div>

        {activeTab === "probetas" && (
          <Card>
            <CardHeader>
              <CardTitle>Probetas de Hormigon</CardTitle>
              <CardDescription>Gestion de probetas extraidas y resultados de ensayos de compresion</CardDescription>
            </CardHeader>
            <CardContent>
              <TestCylindersTable plants={plantsData} selectedPlantId={initialPlantId} onPlantChange={() => {}} />
            </CardContent>
          </Card>
        )}

        {activeTab === "rotura" && (
          <Card>
            <CardHeader>
              <CardTitle>Rotura de Probetas</CardTitle>
              <CardDescription>
                Probetas pendientes de ensayo ordenadas por fecha. Ingrese el peso y la lectura del dial para cada
                probeta.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CylinderBreakingTable plants={plantsData} selectedPlantId={initialPlantId} onPlantChange={() => {}} />
            </CardContent>
          </Card>
        )}

        {activeTab === "resultados" && (
          <Card>
            <CardHeader>
              <CardTitle>Resultados de Roturas</CardTitle>
              <CardDescription>
                Historial completo de ensayos de compresion con resultados de resistencia.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BreakingResultsTable plants={plantsData} selectedPlantId={initialPlantId} onPlantChange={() => {}} />
            </CardContent>
          </Card>
        )}

        {activeTab === "granulometria" && (
          <Card>
            <CardHeader>
              <CardTitle>Ensayos de Granulometria</CardTitle>
              <CardDescription>
                Control de modulo de finura de arena. El proveedor garantiza un modulo de finura entre 1.8 MF y 2.2 MF.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GranulometriaTable plants={plantsData} selectedPlantId={initialPlantId} onPlantChange={() => {}} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

export default function CalidadPage() {
  return (
    <Suspense
      fallback={
        <div className="py-6 px-6 flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      }
    >
      <CalidadContent />
    </Suspense>
  )
}
