"use client"

/** Camiones | Choferes | Bombas (fase 1): misma página de siempre, con dos pestañas nuevas. */
import { useEffect, useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Truck, UserRound, Construction } from "lucide-react"
import { MixersManagement } from "@/components/mixers-management"
import { MaestroLista } from "@/components/maestro-lista"

const PESTANAS = ["camiones", "choferes", "bombas"] as const

export function CamionesTabs() {
  const [tab, setTab] = useState<string>("camiones")
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab")
    if (t && (PESTANAS as readonly string[]).includes(t)) setTab(t)
  }, [])
  const cambiar = (t: string) => {
    setTab(t)
    const url = new URL(window.location.href)
    if (t === "camiones") url.searchParams.delete("tab")
    else url.searchParams.set("tab", t)
    window.history.replaceState(null, "", url.toString())
  }
  return (
    <Tabs value={tab} onValueChange={cambiar} className="space-y-6">
      <TabsList>
        <TabsTrigger value="camiones" className="gap-1.5"><Truck className="h-4 w-4" /> Camiones</TabsTrigger>
        <TabsTrigger value="choferes" className="gap-1.5"><UserRound className="h-4 w-4" /> Choferes</TabsTrigger>
        <TabsTrigger value="bombas" className="gap-1.5"><Construction className="h-4 w-4" /> Bombas</TabsTrigger>
      </TabsList>
      <TabsContent value="camiones"><MixersManagement /></TabsContent>
      <TabsContent value="choferes">
        <MaestroLista
          tabla="choferes"
          entidad="chofer"
          singular="chofer"
          icono={UserRound}
          campos={[{ key: "telefono", label: "Teléfono", placeholder: "Ej: 221 555 1234" }, { key: "dni", label: "DNI" }]}
          ayuda="Los choferes rotan entre camiones: se elige quién maneja en cada despacho."
        />
      </TabsContent>
      <TabsContent value="bombas">
        <MaestroLista
          tabla="empresas_bombeo"
          entidad="bomba"
          singular="empresa de bombeo"
          icono={Construction}
          campos={[{ key: "contacto", label: "Contacto" }, { key: "telefono", label: "Teléfono" }, { key: "observaciones", label: "Observaciones" }]}
          femenino
          ayuda="Las bombas son de terceros: la empresa se asigna en cada pedido con bomba (Programación)."
        />
      </TabsContent>
    </Tabs>
  )
}
