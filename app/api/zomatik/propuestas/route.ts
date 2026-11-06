/**
 * Zomatik Z0 · Propuestas de la pantalla "Vínculos con Zomatik" (solo gerenciales), calculadas acá en el servidor
 * con el cruce por fechas, m³ y planta más el nombre (lib/zomatik/propuestas.ts): el navegador no lee las copias.
 *
 *   GET /api/zomatik/propuestas
 *
 * Además, los posibles duplicados nuestros (para "Unificar"), y en clientes y fórmulas `por_gerencial` (si quien vinculó
 * es gerencial; si no, lo vinculó quien programa desde un pedido: filtro "De un pedido"). No graba nada: los vínculos los confirma un
 * gerencial con /api/zomatik/vincular y la unificación va por /api/clientes/unificar.
 */
import { NextResponse } from "next/server"
import { exigirGerencial, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { cargarDatosCruce } from "@/lib/zomatik/datos-cruce"
import { armarPropuestas } from "@/lib/zomatik/propuestas"
import { detectarDuplicados } from "@/lib/clientes-buscar"
import { cargarClientesParaBuscar } from "@/lib/clientes-datos"
import { normalizarNombre } from "@/lib/permisos"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET() {
  try {
    const r = await exigirGerencial()
    if (r.respuesta) return r.respuesta
    const sb = sbServicio()
    const [datos, buscar, usuarios] = await Promise.all([cargarDatosCruce(sb), cargarClientesParaBuscar(sb), sb.from("app_users").select("name, tipo")])
    // Detector de duplicados nuestros (mismo CUIT, nombre muy parecido, mismas obras), con "Unificar"
    const porId = new Map(buscar.nuestros.map((c) => [c.id, c]))
    const resumen = (id: string) => {
      const c = porId.get(id)!
      return { id, name: c.name, cuit: c.cuit || null, despachos: c.despachos || 0, ultimo_despacho: c.ultimo_despacho || null, obras: (c.obras || []).slice(0, 4), zomatik_codigo: c.zomatik_codigo ?? null }
    }
    const duplicados = detectarDuplicados(buscar.nuestros).map((p) => ({ a: resumen(p.a), b: resumen(p.b), motivos: p.motivos }))
    // "De un pedido" (04/11): el vínculo a mano que no hizo un gerencial (lo vinculó quien programa, desde el pedido)
    const gerenciales = new Set(((usuarios.data as { name: string; tipo: string | null }[] | null) || []).filter((x) => x.tipo === "gerencial").map((x) => normalizarNombre(x.name)))
    const porGerencial = (por: string | null | undefined) => !!por && gerenciales.has(normalizarNombre(por))
    const prop = armarPropuestas(datos)
    const clientes = prop.clientes.map((c) => ({ ...c, por_gerencial: porGerencial(c.vinculado_por) }))
    const formulas = prop.formulas.map((f) => ({ ...f, por_gerencial: porGerencial(f.vinculado_por) }))
    const res = NextResponse.json({ ...prop, clientes, formulas, duplicados, leido: datos.leido })
    res.headers.set("Cache-Control", "no-store")
    return res
  } catch (e) {
    return respuestaError(e)
  }
}
