"use client"

import { ShieldAlert } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { usePermisos } from "@/lib/current-user"
import type { SeccionClave } from "@/lib/permisos"

/** Cartel de sección sin acceso (el mismo de Actividad). */
export function SinAcceso({ texto = "No tenés acceso a esta sección." }: { texto?: string }) {
  return (
    <div className="py-10 px-6">
      <Card className="max-w-md mx-auto">
        <CardContent className="pt-6 text-center space-y-2">
          <ShieldAlert className="h-10 w-10 mx-auto text-muted-foreground" />
          <p className="font-medium">Sección restringida</p>
          <p className="text-sm text-muted-foreground">{texto}</p>
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Fase 0c-1 · Envuelve una página: sin permiso de "ver" la sección, muestra el cartel.
 * `soloGerencial`: para Usuarios y Actividad.
 */
export function SeccionProtegida({
  seccion,
  soloGerencial,
  children,
}: {
  seccion?: SeccionClave
  soloGerencial?: boolean
  children: React.ReactNode
}) {
  const { listo, puede, esGerencial } = usePermisos()
  if (!listo) return null
  const ok = soloGerencial ? esGerencial : seccion ? puede(seccion, "ver") : true
  if (!ok) return <SinAcceso texto={soloGerencial ? "Esta sección es solo para gerenciales." : undefined} />
  return <>{children}</>
}
