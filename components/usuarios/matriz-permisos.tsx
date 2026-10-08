"use client"

import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import {
  ACCIONES,
  NOMBRE_ACCION,
  SECCIONES,
  cambiarPermiso,
  existeAccion,
  plantilla,
  type Permisos,
  type Tipo,
} from "@/lib/permisos"

/**
 * Matriz sección × acción de una persona. Donde la acción no existe va "—". Para gerencial, todo
 * tildado y gris. Cada casilla distinta de la plantilla del tipo lleva la marca "a mano".
 * Usuarios no se habilita por persona (sale del tipo).
 */
export function MatrizPermisos({ tipo, permisos, onChange }: { tipo: Tipo; permisos: Permisos; onChange: (p: Permisos) => void }) {
  const gerencial = tipo === "gerencial"
  const base = plantilla(tipo)
  return (
    <div className="rounded-md border overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left font-medium px-3 py-2">Sección</th>
            {ACCIONES.map((a) => (
              <th key={a} className="font-medium px-2 py-2 text-center w-[72px]">{NOMBRE_ACCION[a]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SECCIONES.map((s) => {
            const soloTipo = s.clave === "usuarios"
            return (
              <tr key={s.clave} className="border-t">
                <td className="px-3 py-2">
                  <p className="font-medium">{s.nombre}</p>
                  {soloTipo && <p className="text-xs text-muted-foreground">Solo gerenciales (sale del tipo)</p>}
                </td>
                {ACCIONES.map((a) => {
                  if (!existeAccion(s.clave, a)) return <td key={a} className="text-center text-muted-foreground">—</td>
                  const valor = gerencial || (!soloTipo && permisos[s.clave][a])
                  const aMano = !gerencial && !soloTipo && permisos[s.clave][a] !== base[s.clave][a]
                  return (
                    <td key={a} className="text-center py-1.5" title={s.descripcion[a] || ""}>
                      <div className="flex flex-col items-center gap-0.5">
                        <Checkbox
                          className={cn("h-6 w-6", (gerencial || soloTipo) && "opacity-50")}
                          checked={valor}
                          disabled={gerencial || soloTipo}
                          onCheckedChange={(v) => onChange(cambiarPermiso(permisos, s.clave, a, v === true))}
                        />
                        {aMano && (
                          <span className={cn("text-[10px] leading-none", permisos[s.clave][a] ? "text-emerald-700" : "text-red-700")}>
                            a mano
                          </span>
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      {gerencial && <p className="px-3 py-2 text-xs text-muted-foreground border-t">Gerencial puede todo.</p>}
    </div>
  )
}
