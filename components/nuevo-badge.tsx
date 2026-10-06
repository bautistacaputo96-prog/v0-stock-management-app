import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/** Distintivo de las funciones que están en prueba (solo las ven los usuarios con el interruptor prendido). */
export function NuevoBadge({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={cn("shrink-0 border-violet-300 bg-violet-50 text-violet-700 text-[10px] px-1.5 py-0 font-medium", className)}>
      Nuevo · en prueba
    </Badge>
  )
}
