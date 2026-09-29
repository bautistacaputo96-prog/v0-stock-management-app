"use server"

import { createClient } from "@/lib/supabase/server"
import { ProgramacionTabs } from "@/components/programacion-tabs"

export default async function ProgramacionPage() {
  const supabase = await createClient()

  const { data: plants } = await supabase
    .from("plants")
    .select("id, name")
    .order("name")

  return (
    <div className="py-4 px-4 md:py-6 md:px-6">
      <div className="mb-4 md:mb-6">
        <h1 className="text-xl md:text-2xl font-bold">Programacion de Despachos</h1>
        <p className="text-xs md:text-sm text-foreground/70 font-medium">Planificá la semana y ordená los camiones de cada día</p>
      </div>
      <ProgramacionTabs plants={plants || []} />
    </div>
  )
}
