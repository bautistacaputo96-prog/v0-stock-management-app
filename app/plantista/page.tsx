"use server"

import { createClient } from "@/lib/supabase/server"
import { SeccionProtegida } from "@/components/seccion-protegida"
import { SelectorPantallaDespacho } from "@/components/despacho/selector-pantalla"

export default async function PlantistaPage() {
  const supabase = await createClient()

  const { data: plants } = await supabase
    .from("plants")
    .select("id, name")
    .order("name")

  // Fase 3: con el interruptor de funciones nuevas, la pantalla de tres columnas (convive con la de siempre)
  return (
    <SeccionProtegida seccion="despacho">
      <SelectorPantallaDespacho plants={plants || []} />
    </SeccionProtegida>
  )
}
