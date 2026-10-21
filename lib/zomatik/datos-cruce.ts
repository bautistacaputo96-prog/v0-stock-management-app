/**
 * Zomatik Z0 · Carga (SOLO servidor, clave de servicio) de todo lo que necesita el cruce por fechas y m³ de la
 * pantalla Vínculos: clientes, despachos desde el 13/04, fórmulas, obras y las copias de Zomatik. No escribe nada.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { DESDE_CRUCE, type RemitoDia } from "@/lib/zomatik/cruce"
import type { DatosCruce } from "@/lib/zomatik/propuestas"

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

const fechaAR = (t: string) => new Date(new Date(t).getTime() - 3 * 3600_000).toISOString().slice(0, 10)

export async function cargarDatosCruce(sb: SupabaseClient): Promise<DatosCruce & { leido: string | null }> {
  const [clientes, zcli, plantas, desp, formulas, articulos, proyectos, movimientos, obras, lec] = await Promise.all([
    todas(sb, "clients", "id, name, razon_social, cuit, active, zomatik_codigo, zomatik_vinculo, zomatik_vinculado_por"),
    todas(sb, "zomatik_clientes", "codigo, razon_social, nombre_norm, cuit, tipo_iva, localidad, vendedor, remitos_r_12m, remitos_x_12m, ultimo_remito, estado"),
    todas(sb, "plants", "id, name"),
    todas(sb, "dispatches", "id, client_id, construction_site_id, formula_id, plant_id, dispatch_date, quantity_m3, is_test_dispatch, construction_sites(name), formulas(name)", (q) => q.gte("dispatch_date", `${DESDE_CRUCE}T03:00:00Z`).order("id")),
    todas(sb, "formulas", "id, name, code, plant_id, zomatik_articulo_codigo, zomatik_articulo_nombre, zomatik_vinculo, zomatik_vinculado_por"),
    todas(sb, "zomatik_articulos", "codigo, nombre, linea"),
    todas(sb, "zomatik_proyectos", "codigo, numero, cliente_codigo, cliente_nombre, obra, ultima_entrega, construction_site_id, vinculo", (q) => q.eq("estado", "abierto")),
    todas(sb, "zomatik_proyecto_movimientos", "id, proyecto_numero, fecha, remito, articulo, m3, deposito", (q) => q.eq("es_hormigon", true).order("id")),
    todas(sb, "construction_sites", "id, name, client_id"),
    sb.from("zomatik_lecturas").select("fin").not("fin", "is", null).order("inicio", { ascending: false }).limit(1),
  ])
  let remitosDia: RemitoDia[] = []
  try {
    remitosDia = (await todas(sb, "zomatik_remitos_dia", "cliente_norm, fecha, planta, m3, articulos", (q) => q.order("fecha"))).map((x) => ({ ...x, m3: Number(x.m3) || 0, articulos: x.articulos || [] }))
  } catch {
    remitosDia = [] // falta la migración 202610212000: clientes y fórmulas se proponen solo por nombre
  }
  const planta = new Map(plantas.map((p: any) => [p.id, p.name]))
  return {
    clientes,
    zcli,
    despachos: desp
      .filter((x: any) => !x.is_test_dispatch)
      .map((x: any) => ({
        client_id: x.client_id,
        construction_site_id: x.construction_site_id,
        formula_id: x.formula_id,
        planta: planta.get(x.plant_id) || "otro",
        fecha: fechaAR(x.dispatch_date),
        m3: Number(x.quantity_m3) || 0,
        obra: x.construction_sites?.name || null,
        formula: x.formulas?.name || null,
      })),
    formulas: formulas.map((f: any) => ({ ...f, planta: planta.get(f.plant_id) || "" })),
    articulos,
    proyectos,
    movimientos: movimientos.map((m: any) => ({ ...m, m3: Number(m.m3) || 0 })),
    obras,
    remitosDia,
    leido: (lec.data as any[])?.[0]?.fin || null,
  }
}
