"use client"

import { SeccionProtegida } from "@/components/seccion-protegida"
import { PantallaVinculos } from "@/components/zomatik/pantalla-vinculos"

/** Zomatik Z0 · Vínculos con Zomatik (solo gerenciales). */
export default function ZomatikPage() {
  return (
    <SeccionProtegida soloGerencial>
      <PantallaVinculos />
    </SeccionProtegida>
  )
}
