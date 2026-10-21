import { createClient } from "@/lib/supabase/server"
import { SeccionProtegida } from "@/components/seccion-protegida"
import { PantallaCarga } from "@/components/carga/pantalla-carga"

/** Carga de planta (carga-planta.md). En prueba: solo con el interruptor de funciones nuevas. Planta SIMULADA. */
export default async function CargaPage() {
  const supabase = await createClient()
  const { data: plants } = await supabase.from("plants").select("id, name").order("name")
  return (
    <SeccionProtegida seccion="carga">
      <div className="px-3 pb-24">
        <PantallaCarga plants={plants || []} />
      </div>
    </SeccionProtegida>
  )
}
