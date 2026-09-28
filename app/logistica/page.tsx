import { Suspense } from "react"
import { LogisticaEnVivo } from "@/components/logistica-en-vivo"

export const dynamic = "force-dynamic"

export default function LogisticaPage() {
  return (
    <div className="py-4 px-4 md:py-6 md:px-6">
      <div className="mb-4 md:mb-6">
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">Logística</h1>
        <p className="text-xs md:text-sm text-muted-foreground mt-1">Dónde está cada mixer, a qué obra va y cuánto le falta</p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando...</p>}>
        <LogisticaEnVivo />
      </Suspense>
    </div>
  )
}
