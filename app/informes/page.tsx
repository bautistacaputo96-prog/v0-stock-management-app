import { Suspense } from "react"
import { createClient } from "@/lib/supabase/server"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import ProductionReport from "@/components/production-report"
import CompressionReport from "@/components/compression-report"

export const dynamic = "force-dynamic"

async function loadData() {
  try {
    const supabase = await createClient()

    const { data: plants, error: plantsError } = await supabase.from("plants").select("id, name").order("name")
    const { data: formulas, error: formulasError } = await supabase
      .from("formulas")
      .select("id, code, plant_id")
      .order("code")
    const { data: mixers, error: mixersError } = await supabase
      .from("mixers")
      .select("id, license_plate")
      .order("license_plate")

    console.log("[v0] Informes data loaded:", { plants, formulas, mixers })

    if (plantsError) console.error("[v0] Plants error:", plantsError)
    if (formulasError) console.error("[v0] Formulas error:", formulasError)
    if (mixersError) console.error("[v0] Mixers error:", mixersError)

    return {
      plants: plants || [],
      formulas: formulas || [],
      mixers: mixers || [],
    }
  } catch (error) {
    console.error("[v0] Error in loadData:", error)
    return {
      plants: [],
      formulas: [],
      mixers: [],
    }
  }
}

export default async function InformesPage() {
  console.log("[v0] Rendering InformesPage")
  const { plants, formulas, mixers } = await loadData()

  return (
    <div className="py-6 px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Informes</h1>
        <p className="text-sm text-foreground/70 font-medium mt-1">Reportes de produccion y calidad</p>
      </div>

      <Tabs defaultValue="produccion" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="produccion">Producción</TabsTrigger>
          <TabsTrigger value="calidad">Calidad</TabsTrigger>
        </TabsList>

        <TabsContent value="produccion">
          <Card>
            <CardHeader>
              <CardTitle>Informe de Producción</CardTitle>
              <CardDescription>
                Visualiza el volumen de hormigón despachado por planta, fórmula y camión
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense fallback={<div>Cargando...</div>}>
                <ProductionReport plants={plants} formulas={formulas} mixers={mixers} />
              </Suspense>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calidad">
          <Card>
            <CardHeader>
              <CardTitle>Informe de Compresión</CardTitle>
              <CardDescription>Análisis estadístico de resistencia a la compresión de probetas</CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense fallback={<div>Cargando...</div>}>
                <CompressionReport formulas={formulas} />
              </Suspense>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
