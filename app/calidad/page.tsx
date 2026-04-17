"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { 
  Beaker, 
  FlaskConical, 
  Droplets, 
  TestTube2, 
  FileText, 
  Settings, 
  BarChart3,
  Cylinder,
  ArrowRight,
  Grid3X3,
  Clock,
  CheckCircle2,
  AlertTriangle
} from "lucide-react"
import Link from "next/link"
import { usePlant } from "@/lib/plant-context"
import { createClient } from "@/lib/supabase/client"

// Modules for Mercedes (canos)
const MERCEDES_MODULES = [
  {
    title: "Ensayos Pendientes",
    description: "Muestras de laboratorio por analizar",
    href: "/calidad/pendientes",
    icon: Clock,
    color: "bg-yellow-500",
    highlight: true,
  },
  {
    title: "Control de Canos",
    description: "Registro de calidad en produccion de canos",
    href: "/calidad/canos",
    icon: Cylinder,
    color: "bg-blue-500",
  },
  {
    title: "Dosificaciones",
    description: "Formulas de mezcla por diametro",
    href: "/calidad/dosificaciones",
    icon: Beaker,
    color: "bg-purple-500",
  },
  {
    title: "Granulometria",
    description: "Control granulometrico de aridos",
    href: "/calidad/granulometria",
    icon: FlaskConical,
    color: "bg-amber-500",
  },
  {
    title: "Humedad",
    description: "Seguimiento de humedad en materiales",
    href: "/calidad/humedad",
    icon: Droplets,
    color: "bg-cyan-500",
  },
  {
    title: "Ensayos",
    description: "Absorcion, flexion y otros ensayos",
    href: "/calidad/ensayos",
    icon: TestTube2,
    color: "bg-green-500",
  },
  {
    title: "Parametros",
    description: "Configuracion de limites y alertas",
    href: "/calidad/parametros",
    icon: Settings,
    color: "bg-slate-500",
  },
]

// Modules for Ranchos (adoquines)
const RANCHOS_MODULES = [
  {
    title: "Ensayos Pendientes",
    description: "Muestras de laboratorio por analizar",
    href: "/calidad/pendientes",
    icon: Clock,
    color: "bg-yellow-500",
    highlight: true,
  },
  {
    title: "Control de Adoquines",
    description: "Registro de calidad en produccion de adoquines",
    href: "/calidad/adoquines",
    icon: Grid3X3,
    color: "bg-orange-500",
  },
  {
    title: "Granulometria",
    description: "Control granulometrico de aridos",
    href: "/calidad/granulometria",
    icon: FlaskConical,
    color: "bg-amber-500",
  },
  {
    title: "Humedad",
    description: "Seguimiento de humedad en materiales",
    href: "/calidad/humedad",
    icon: Droplets,
    color: "bg-cyan-500",
  },
  {
    title: "Ensayos",
    description: "Absorcion, compresion y otros ensayos",
    href: "/calidad/ensayos",
    icon: TestTube2,
    color: "bg-green-500",
  },
  {
    title: "Parametros",
    description: "Configuracion de limites y alertas",
    href: "/calidad/parametros",
    icon: Settings,
    color: "bg-slate-500",
  },
]

const PROCEDURES = [
  {
    title: "Granulometría",
    steps: [
      "Tomar muestra representativa (500g mínimo)",
      "Secar a peso constante (105°C ± 5°C)",
      "Pesar muestra seca",
      "Tamizar por juego completo de tamices",
      "Pesar material retenido en cada tamiz",
      "Calcular % pasante acumulado",
      "Verificar contra bandas de especificación",
    ],
    norms: "IRAM 1505, IRAM 1627",
  },
  {
    title: "Humedad",
    steps: [
      "Tomar muestra representativa del acopio",
      "Pesar muestra húmeda (Ph)",
      "Secar en horno a 105°C ± 5°C hasta peso constante",
      "Pesar muestra seca (Ps)",
      "Calcular: H% = (Ph - Ps) / Ps × 100",
    ],
    norms: "IRAM 1520",
  },
  {
    title: "Absorción de Bloques",
    steps: [
      "Seleccionar 3 unidades representativas",
      "Secar a peso constante (Ms)",
      "Sumergir en agua 24hs",
      "Pesar saturado (Msat)",
      "Calcular: Abs% = (Msat - Ms) / Ms × 100",
      "Límite máximo según norma: 10%",
    ],
    norms: "IRAM 11561",
  },
  {
    title: "Resistencia a Flexión",
    steps: [
      "Edad mínima de ensayo: 28 días",
      "Verificar apoyo y carga centrada",
      "Aplicar carga progresiva",
      "Registrar carga de rotura",
      "Calcular MR según geometría",
    ],
    norms: "IRAM 11561, IRAM 11556",
  },
]

export default function CalidadPage() {
  const { selectedPlant, plantInfo } = usePlant()
  const supabase = createClient()
  
  const [stockpileTests, setStockpileTests] = useState<any[]>([])
  const [selectedStockpile, setSelectedStockpile] = useState<any | null>(null)
  
  useEffect(() => {
    loadStockpileTests()
  }, [selectedPlant])
  
  async function loadStockpileTests() {
    const { data, error } = await supabase
      .from("stockpile_granulometry")
      .select("*")
      .eq("plant", selectedPlant || "mercedes")
      .order("test_date", { ascending: false })
    
    if (!error && data) {
      // Get latest test for each material type
      const latestByMaterial: Record<string, any> = {}
      data.forEach((test: any) => {
        const key = test.material_type.toLowerCase()
        if (!latestByMaterial[key]) {
          latestByMaterial[key] = test
        }
      })
      setStockpileTests(Object.values(latestByMaterial))
    }
  }
  
  // Select modules based on plant - Ranchos produces adoquines, others produce canos
  const isPaverPlant = selectedPlant === "ranchos"
  const QUALITY_MODULES = isPaverPlant ? RANCHOS_MODULES : MERCEDES_MODULES
  const plantName = plantInfo.name
  const productType = isPaverPlant ? "adoquines" : "canos"
  
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
          <Beaker className="h-6 w-6 text-green-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Control de Calidad - {plantName}</h1>
          <p className="text-muted-foreground">Gestion integral de calidad de materiales y {productType}</p>
        </div>
      </div>

      <div className="space-y-8">
        {/* Stockpile KPIs */}
        {stockpileTests.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <FlaskConical className="h-5 w-5" />
              Estado de Acopios
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {stockpileTests.map((test) => {
                const isWithinSpec = test.is_within_spec
                return (
                  <Card 
                    key={test.id}
                    className={`cursor-pointer hover:shadow-md transition-shadow ${
                      isWithinSpec ? "border-green-200 bg-green-50/50" : "border-yellow-200 bg-yellow-50/50"
                    }`}
                    onClick={() => setSelectedStockpile(test)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm capitalize">{test.material_type}</span>
                        {isWithinSpec ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-yellow-600" />
                        )}
                      </div>
                      <div className="text-2xl font-bold">
                        MF: {test.modulo_finura?.toFixed(2) || "-"}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {new Date(test.test_date).toLocaleDateString("es-AR")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {test.tested_by}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </section>
        )}
        
        {/* Stockpile Detail Dialog */}
        <Dialog open={!!selectedStockpile} onOpenChange={(open) => !open && setSelectedStockpile(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="capitalize">
                Acopio de {selectedStockpile?.material_type}
              </DialogTitle>
            </DialogHeader>
            {selectedStockpile && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-sm text-muted-foreground">Fecha del ensayo</span>
                    <p className="font-medium">{new Date(selectedStockpile.test_date).toLocaleDateString("es-AR", { 
                      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
                    })}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Responsable</span>
                    <p className="font-medium">{selectedStockpile.tested_by}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Módulo de Finura</span>
                    <p className="text-2xl font-bold">{selectedStockpile.modulo_finura?.toFixed(2) || "-"}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Estado</span>
                    <p className={`font-medium ${selectedStockpile.is_within_spec ? "text-green-600" : "text-yellow-600"}`}>
                      {selectedStockpile.is_within_spec ? "Dentro de especificación" : "Revisar curva"}
                    </p>
                  </div>
                </div>
                {selectedStockpile.notes && (
                  <div>
                    <span className="text-sm text-muted-foreground">Observaciones</span>
                    <p>{selectedStockpile.notes}</p>
                  </div>
                )}
                <div className="pt-2">
                  <Link href="/calidad/granulometria" className="text-sm text-blue-600 hover:underline">
                    Ver curva granulométrica completa →
                  </Link>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Quick Access Modules */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Modulos de Control</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {QUALITY_MODULES.map((module) => (
              <Link key={module.href} href={module.href}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer group h-full">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      <div className={`p-3 rounded-lg ${module.color} text-white`}>
                        <module.icon className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold group-hover:text-primary transition-colors flex items-center gap-2">
                          {module.title}
                          <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </h3>
                        <p className="text-sm text-muted-foreground">{module.description}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>

        {/* Procedures Guide */}
        <section>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Procedimientos de Ensayo
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {PROCEDURES.map((proc) => (
              <Card key={proc.title}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between">
                    {proc.title}
                    <Badge variant="outline" className="text-xs">{proc.norms}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ol className="space-y-1 text-sm">
                    {proc.steps.map((step, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-muted-foreground font-medium">{i + 1}.</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Quick Info */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Información Rápida</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Límites de Humedad</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Arena</span>
                  <span className="font-medium">3% - 6%</span>
                </div>
                <div className="flex justify-between">
                  <span>Piedra 0-10</span>
                  <span className="font-medium">0% - 2%</span>
                </div>
                <div className="flex justify-between">
                  <span>Piedra 0-20</span>
                  <span className="font-medium">0% - 2%</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Módulo de Finura (Arena)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Arena fina</span>
                  <span className="font-medium">1.5 - 2.2</span>
                </div>
                <div className="flex justify-between">
                  <span>Arena media</span>
                  <span className="font-medium">2.2 - 2.8</span>
                </div>
                <div className="flex justify-between">
                  <span>Arena gruesa</span>
                  <span className="font-medium">2.8 - 3.5</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Absorción Máxima</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Bloques portantes</span>
                  <span className="font-medium">≤ 10%</span>
                </div>
                <div className="flex justify-between">
                  <span>Bloques no portantes</span>
                  <span className="font-medium">≤ 12%</span>
                </div>
                <div className="flex justify-between">
                  <span>Adoquines</span>
                  <span className="font-medium">≤ 6%</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </div>
  )
}
