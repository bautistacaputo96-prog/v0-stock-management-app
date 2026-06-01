"use server"

import { createClient } from "@/lib/supabase/server"
import { PlantistaView } from "@/components/plantista-view"

export default async function PlantistaPage() {
  const supabase = await createClient()

  const { data: plants } = await supabase
    .from("plants")
    .select("id, name")
    .order("name")

  return (
    <div className="container mx-auto py-6 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Despacho Diario</h1>
        <p className="text-muted-foreground">Control de despachos en tiempo real</p>
      </div>
      <PlantistaView plants={plants || []} />
    </div>
  )
}
