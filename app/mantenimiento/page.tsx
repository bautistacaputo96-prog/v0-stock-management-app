import { Suspense } from "react"
import { createClient } from "@/lib/supabase/server"
import { MantenimientoContent } from "@/components/mantenimiento-content"

export const dynamic = "force-dynamic"

export default async function MantenimientoPage() {
  const supabase = await createClient()

  const { data: equipos } = await supabase
    .from("maint_equipment")
    .select("id, nombre, modelo, fabricante, plant_id, plants(name)")
    .eq("activo", true)
    .order("nombre")

  return (
    <div className="py-4 px-4 md:py-6 md:px-6">
      <div className="mb-4 md:mb-6">
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">Mantenimiento</h1>
        <p className="text-xs md:text-sm text-muted-foreground mt-1">
          Órdenes de trabajo, plan preventivo y fallas de la planta
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando...</p>}>
        <MantenimientoContent equipos={equipos || []} />
      </Suspense>
    </div>
  )
}
