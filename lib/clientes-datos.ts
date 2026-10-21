/**
 * Datos para el buscador unificado de clientes y el control del alta (SOLO servidor, clave de servicio):
 * nuestros clientes con alias, obras y despachos, y la copia de clientes de Zomatik. No escribe nada.
 * Se guarda 30 s en memoria del proceso (el buscador consulta mientras se escribe).
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { NuestroB, ZomatikB } from "@/lib/clientes-buscar"

async function todas(sb: SupabaseClient, tabla: string, columnas: string, filtro?: (q: any) => any): Promise<any[]> {
  const out: any[] = []
  for (let desde = 0; ; desde += 1000) {
    let q = sb.from(tabla).select(columnas).range(desde, desde + 999)
    if (filtro) q = filtro(q)
    const { data, error } = await q
    if (error) throw error
    out.push(...((data as any[]) || []))
    if (!data || data.length < 1000) break
  }
  return out
}

let cache: { hasta: number; datos: { nuestros: NuestroB[]; zomatik: ZomatikB[] } } | null = null

/** Para después de un alta, un alias o una unificación: que la próxima búsqueda vuelva a leer. */
export function olvidarClientes() {
  cache = null
}

export async function cargarClientesParaBuscar(sb: SupabaseClient): Promise<{ nuestros: NuestroB[]; zomatik: ZomatikB[] }> {
  if (cache && cache.hasta > Date.now()) return cache.datos
  const [clientes, obras, desp, zcli] = await Promise.all([
    todas(sb, "clients", "id, name, razon_social, cuit, phone, active, zomatik_codigo"),
    todas(sb, "construction_sites", "client_id, name"),
    todas(sb, "dispatches", "id, client_id, dispatch_date, is_test_dispatch", (q) => q.not("client_id", "is", null).order("id")),
    todas(sb, "zomatik_clientes", "codigo, razon_social, cuit, telefono, localidad, remitos_r_12m, remitos_x_12m, ultimo_remito, estado").catch(() => []),
  ])
  let alias: any[] = []
  try {
    alias = await todas(sb, "client_alias", "client_id, alias")
  } catch {
    alias = [] // falta la migración 202610212100
  }
  const obrasDe = new Map<string, string[]>()
  for (const o of obras) obrasDe.set(o.client_id, [...(obrasDe.get(o.client_id) || []), o.name])
  const aliasDe = new Map<string, string[]>()
  for (const a of alias) aliasDe.set(a.client_id, [...(aliasDe.get(a.client_id) || []), a.alias])
  const despDe = new Map<string, { n: number; ultimo: string | null }>()
  for (const d of desp) {
    if (d.is_test_dispatch) continue
    const x = despDe.get(d.client_id) || { n: 0, ultimo: null }
    x.n++
    const f = String(d.dispatch_date || "").slice(0, 10)
    if (f > "1900" && (!x.ultimo || f > x.ultimo)) x.ultimo = f
    despDe.set(d.client_id, x)
  }
  const datos = {
    nuestros: clientes.map((c: any) => ({
      ...c,
      alias: aliasDe.get(c.id) || [],
      obras: obrasDe.get(c.id) || [],
      despachos: despDe.get(c.id)?.n || 0,
      ultimo_despacho: despDe.get(c.id)?.ultimo || null,
    })),
    zomatik: zcli.map((z: any) => ({ ...z, remitos_12m: (z.remitos_r_12m || 0) + (z.remitos_x_12m || 0) })),
  }
  cache = { hasta: Date.now() + 30_000, datos }
  return datos
}
