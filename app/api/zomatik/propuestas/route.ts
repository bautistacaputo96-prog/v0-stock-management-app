/**
 * Zomatik Z0 · Propuestas de la pantalla "Vínculos con Zomatik" (solo gerenciales), calculadas acá en el servidor
 * con el cruce por fechas, m³ y planta más el nombre (lib/zomatik/propuestas.ts): el navegador no lee las copias.
 *
 *   GET /api/zomatik/propuestas
 *
 * Además, los posibles duplicados nuestros (para "Unificar"). No graba nada: los vínculos los confirma un
 * gerencial con /api/zomatik/vincular y la unificación va por /api/clientes/unificar.
 */
import { NextResponse } from "next/server"
import { exigirGerencial, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { cargarDatosCruce } from "@/lib/zomatik/datos-cruce"
import { armarPropuestas } from "@/lib/zomatik/propuestas"
import { detectarDuplicados } from "@/lib/clientes-buscar"
import { cargarClientesParaBuscar } from "@/lib/clientes-datos"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET() {
  try {
    const r = await exigirGerencial()
    if (r.respuesta) return r.respuesta
    const sb = sbServicio()
    const [datos, buscar] = await Promise.all([cargarDatosCruce(sb), cargarClientesParaBuscar(sb)])
    // Detector de duplicados nuestros (mismo CUIT, nombre muy parecido, mismas obras), con "Unificar"
    const porId = new Map(buscar.nuestros.map((c) => [c.id, c]))
    const resumen = (id: string) => {
      const c = porId.get(id)!
      return { id, name: c.name, cuit: c.cuit || null, despachos: c.despachos || 0, ultimo_despacho: c.ultimo_despacho || null, obras: (c.obras || []).slice(0, 4), zomatik_codigo: c.zomatik_codigo ?? null }
    }
    const duplicados = detectarDuplicados(buscar.nuestros).map((p) => ({ a: resumen(p.a), b: resumen(p.b), motivos: p.motivos }))
    const res = NextResponse.json({ ...armarPropuestas(datos), duplicados, leido: datos.leido })
    res.headers.set("Cache-Control", "no-store")
    return res
  } catch (e) {
    return respuestaError(e)
  }
}
