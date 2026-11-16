"use client"

import { m3txt } from "@/lib/despacho"
import type { DespachoT } from "./tipos"

type Fila = { nombre: string; viajes: number; m3: number }

function agrupar(despachos: DespachoT[], clave: (d: DespachoT) => string): Fila[] {
  const out: Record<string, Fila> = {}
  for (const d of despachos) {
    const k = clave(d)
    out[k] = out[k] || { nombre: k, viajes: 0, m3: 0 }
    out[k].viajes++
    out[k].m3 += Number(d.quantity_m3 || 0)
  }
  return Object.values(out).sort((a, b) => b.m3 - a.m3)
}

/** Resumen del día de la planta por fórmula y por cliente (lo que tenía la pantalla de siempre). Sin los "por árido / prueba". */
export function ResumenDia({ despachos }: { despachos: DespachoT[] }) {
  const reales = despachos.filter((d) => !d.is_test_dispatch)
  if (!reales.length) return null
  const bloques: [string, Fila[]][] = [
    ["Por fórmula", agrupar(reales, (d) => d.formulas?.code || "Sin fórmula")],
    ["Por cliente", agrupar(reales, (d) => d.clients?.name || "Sin cliente")],
  ]
  return (
    <section className="d3c-card grid grid-cols-1 gap-x-4 gap-y-2 rounded-md border bg-card px-2.5 py-1.5 md:grid-cols-2">
      {bloques.map(([titulo, filas]) => (
        <div key={titulo} className="min-w-0">
          <h2 className="mb-0.5 text-sm font-semibold">{titulo}</h2>
          <table className="w-full table-fixed text-xs">
            <tbody>
              {filas.map((f) => (
                <tr key={f.nombre} className="border-b last:border-0">
                  <td className="truncate py-0.5 pr-2" title={f.nombre}>{f.nombre}</td>
                  <td className="w-20 whitespace-nowrap py-0.5 pr-2 text-right font-semibold tabular-nums">{m3txt(f.m3)} m³</td>
                  <td className="w-16 whitespace-nowrap py-0.5 text-right text-muted-foreground">{f.viajes} viaje{f.viajes === 1 ? "" : "s"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  )
}
