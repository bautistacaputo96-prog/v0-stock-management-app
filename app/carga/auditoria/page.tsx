import { createClient } from "@/lib/supabase/server"
import { SeccionProtegida } from "@/components/seccion-protegida"
import { AuditoriaCarga } from "@/components/carga/auditoria-carga"

/** Auditoría de carga (carga-planta.md 11, 19.5 y 19.6): remito ↔ carga, desvíos, tiempos y agua extra. */
export default async function AuditoriaCargaPage() {
  const supabase = await createClient()
  const { data: plants } = await supabase.from("plants").select("id, name").order("name")
  return (
    <SeccionProtegida seccion="carga">
      <div className="px-3 pb-10">
        <AuditoriaCarga plants={plants || []} />
      </div>
    </SeccionProtegida>
  )
}
