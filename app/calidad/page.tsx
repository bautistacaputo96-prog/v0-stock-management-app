"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { 
  Beaker, 
  FlaskConical, 
  Droplets, 
  TestTube2, 
  FileText, 
  Settings, 
  BarChart3,
  Cylinder,
  ArrowRight
} from "lucide-react"
import Link from "next/link"

const QUALITY_MODULES = [
  {
    title: "Control de Caños",
    description: "Registro de calidad en producción de caños",
    href: "/calidad/canos",
    icon: Cylinder,
    color: "bg-blue-500",
  },
  {
    title: "Dosificaciones",
    description: "Fórmulas de mezcla por diámetro",
    href: "/calidad/dosificaciones",
    icon: Beaker,
    color: "bg-purple-500",
  },
  {
    title: "Granulometría",
    description: "Control granulométrico de áridos",
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
    description: "Absorción, flexión y otros ensayos",
    href: "/calidad/ensayos",
    icon: TestTube2,
    color: "bg-green-500",
  },
  {
    title: "Parámetros",
    description: "Configuración de límites y alertas",
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
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <Beaker className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Control de Calidad</h1>
              <p className="text-muted-foreground">Gestión integral de calidad de materiales y productos</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-8">
        {/* Quick Access Modules */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Módulos de Control</h2>
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
      </main>
    </div>
  )
}
