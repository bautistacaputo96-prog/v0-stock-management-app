"use server"

import { createClient } from "@/lib/supabase/server"
import { DispatchHistory } from "@/components/dispatch-history"

export default async function HistorialDespachosPage() {
  const supabase = await createClient()

  const { data: plants } = await supabase
    .from("plants")
    .select("id, name")
    .order("name")

  return (
    <div className="container mx-auto py-6 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Historial de Despachos</h1>
        <p className="text-muted-foreground">Metricas y registro historico de despachos programados</p>
      </div>
      <DispatchHistory plants={plants || []} />
    </div>
  )
}
