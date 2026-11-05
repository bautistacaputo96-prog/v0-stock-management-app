/**
 * Zomatik · vínculos de clientes, fórmulas y proyectos (SOLO servidor, clave de servicio). Lo usa
 * /api/zomatik/vincular. Escribe solo en nuestra base: no toca Zomatik.
 *
 *   aplicar              Vínculos con Zomatik (solo gerenciales): vincular, "no está en Zomatik" o quitar.
 *   aplicarDesdePedido   El cartel "Falta vincular con Zomatik" del pedido (04/11/2026,
 *                        docs/specs/2026-11-04-vincular-al-programar.md): quien programa completa lo que falta. Solo
 *                        vincula un cliente o una fórmula sin vínculo (o "No está en Zomatik"); nunca cambia ni quita
 *                        uno hecho. La condición va dentro del UPDATE: si no actualiza nada, alguien lo vinculó en el medio.
 *   estadoVinculos       Qué le falta al cliente y a la fórmula del pedido, con sugerencias.
 *   buscarParaVincular   El buscador del cartel (clientes de la copia de Zomatik o artículos), sin teléfonos ni mails.
 *
 * `sb` va como parámetro (patrón de np-servidor.ts) para poder probarlo con una base simulada.
 */
import { registrarActividad, sbServicio } from "@/lib/auth/servidor"
import { cargarClientesParaBuscar, olvidarClientes } from "@/lib/clientes-datos"
import { coincidePalabras } from "@/lib/clientes-buscar"
import { esGenerico } from "@/lib/zomatik/cruce"
import { soloDigitos } from "@/lib/zomatik/parseo"
import { actividadNp } from "@/lib/zomatik/np-servidor"
import {
  buscarEnZomatik, compararCuit, vinculadosPorCodigo, controlVinculoPedido, deHormigon, otraPlantaDelArticulo, sugerenciasArticulo, sugerenciasCliente, zomatikActivo,
  type ArticuloSug, type DuplicadoDe, type SugerenciaArticulo, type SugerenciaCliente, type VinculadoA, type ZomatikSug,
} from "@/lib/zomatik/vinculos"

type SB = ReturnType<typeof sbServicio>

export type Item = {
  tipo: "cliente" | "formula" | "proyecto"
  id: string
  accion: "vincular" | "sin_par" | "quitar"
  codigo?: string | number | null
  /** "Confirmar todas las de confianza alta": graba solo si todavía no tiene vínculo (no pisa lo que otro confirmó) */
  soloSiLibre?: boolean
}
export type Res = { ok: boolean; error?: string; tipo?: "cliente" | "formula"; id?: string; codigo?: number; nombre?: string; antes?: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// Vínculos con Zomatik (gerenciales): igual que antes, movido desde la ruta
// ---------------------------------------------------------------------------

export async function aplicar(it: Item, usuario: string, sb: SB = sbServicio()): Promise<Res> {
  const ahora = new Date().toISOString()
  if (!["vincular", "sin_par", "quitar"].includes(it.accion)) return { ok: false, error: "Acción inválida" }

  if (it.tipo === "cliente") {
    if (!UUID.test(String(it.id))) return { ok: false, error: "Cliente inválido" }
    const { data: c } = await sb.from("clients").select("id, name, zomatik_codigo").eq("id", it.id).maybeSingle()
    if (!c) return { ok: false, error: "No existe el cliente" }
    let upd: Record<string, unknown>
    let detalle: string
    if (it.accion === "vincular") {
      const codigo = Number(it.codigo)
      if (!Number.isInteger(codigo) || codigo <= 0) return { ok: false, error: "Código de Zomatik inválido" }
      const { data: z } = await sb.from("zomatik_clientes").select("codigo, razon_social").eq("codigo", codigo).maybeSingle()
      if (!z) return { ok: false, error: "Ese código no está en la copia de Zomatik" }
      const { data: otro } = await sb.from("clients").select("id, name").eq("zomatik_codigo", codigo).neq("id", it.id).maybeSingle()
      if (otro) return { ok: false, error: `Ese cliente de Zomatik ya está vinculado a «${(otro as any).name}»` }
      upd = { zomatik_codigo: codigo, zomatik_vinculo: "manual", zomatik_vinculado_por: usuario, zomatik_vinculado_at: ahora }
      detalle = `${(z as any).razon_social} (${codigo})`
    } else {
      upd = { zomatik_codigo: null, zomatik_vinculo: it.accion === "sin_par" ? "sin_par" : null, zomatik_vinculado_por: usuario, zomatik_vinculado_at: ahora }
      detalle = it.accion === "sin_par" ? "No está en Zomatik" : "Sin revisar"
    }
    let qc = sb.from("clients").update(upd).eq("id", it.id)
    if (it.soloSiLibre) qc = qc.is("zomatik_vinculo", null)
    const { data: hechos, error } = await qc.select("id")
    if (!error && it.soloSiLibre && !(hechos || []).length) return { ok: false, error: `«${(c as any).name}» ya tenía vínculo: no se tocó` }
    if (error) return { ok: false, error: (error as any).code === "23505" ? "Ese cliente de Zomatik ya está vinculado a otro" : error.message }
    await registrarActividad({ usuario, action: "editar", entity: "cliente", entityId: it.id, reference: (c as any).name, details: { "Vínculo con Zomatik": detalle } })
    return { ok: true }
  }

  if (it.tipo === "formula") {
    if (!UUID.test(String(it.id))) return { ok: false, error: "Fórmula inválida" }
    const { data: f } = await sb.from("formulas").select("id, name").eq("id", it.id).maybeSingle()
    if (!f) return { ok: false, error: "No existe la fórmula" }
    let upd: Record<string, unknown>
    let detalle: string
    if (it.accion === "vincular") {
      const codigo = Number(it.codigo)
      const { data: a } = await sb.from("zomatik_articulos").select("codigo, nombre").eq("codigo", codigo).maybeSingle()
      if (!a) return { ok: false, error: "Ese artículo no está en la copia de Zomatik" }
      upd = { zomatik_articulo_codigo: codigo, zomatik_articulo_nombre: (a as any).nombre, zomatik_vinculo: "manual", zomatik_vinculado_por: usuario, zomatik_vinculado_at: ahora }
      detalle = `${(a as any).nombre} (${codigo})`
    } else {
      upd = { zomatik_articulo_codigo: null, zomatik_articulo_nombre: null, zomatik_vinculo: it.accion === "sin_par" ? "sin_par" : null, zomatik_vinculado_por: usuario, zomatik_vinculado_at: ahora }
      detalle = it.accion === "sin_par" ? "Sin artículo en Zomatik" : "Sin revisar"
    }
    let qf = sb.from("formulas").update(upd).eq("id", it.id)
    if (it.soloSiLibre) qf = qf.is("zomatik_vinculo", null)
    const { data: hechos, error } = await qf.select("id")
    if (error) return { ok: false, error: error.message }
    if (it.soloSiLibre && !(hechos || []).length) return { ok: false, error: `«${(f as any).name}» ya tenía vínculo: no se tocó` }
    await registrarActividad({ usuario, action: "editar", entity: "formula", entityId: it.id, reference: (f as any).name, details: { "Artículo de Zomatik": detalle } })
    return { ok: true }
  }

  if (it.tipo === "proyecto") {
    const codigo = Number(it.id)
    const { data: p } = await sb.from("zomatik_proyectos").select("codigo, numero").eq("codigo", codigo).maybeSingle()
    if (!p) return { ok: false, error: "No existe el proyecto en la copia" }
    let upd: Record<string, unknown>
    let detalle: string
    if (it.accion === "vincular") {
      if (!UUID.test(String(it.codigo))) return { ok: false, error: "Obra inválida" }
      const { data: o } = await sb.from("construction_sites").select("id, name").eq("id", String(it.codigo)).maybeSingle()
      if (!o) return { ok: false, error: "No existe la obra" }
      upd = { construction_site_id: (o as any).id, vinculo: "manual", vinculado_por: usuario, vinculado_at: ahora }
      detalle = `Obra ${(o as any).name}`
    } else {
      upd = { construction_site_id: null, vinculo: it.accion === "sin_par" ? "sin_par" : null, vinculado_por: usuario, vinculado_at: ahora }
      detalle = it.accion === "sin_par" ? "Sin obra en Rebucret" : "Sin revisar"
    }
    let qp = sb.from("zomatik_proyectos").update(upd).eq("codigo", codigo)
    if (it.soloSiLibre) qp = qp.is("vinculo", null)
    const { data: hechos, error } = await qp.select("codigo")
    if (error) return { ok: false, error: error.message }
    if (it.soloSiLibre && !(hechos || []).length) return { ok: false, error: `${(p as any).numero} ya tenía vínculo: no se tocó` }
    await registrarActividad({ usuario, action: "editar", entity: "obra", entityId: typeof upd.construction_site_id === "string" ? (upd.construction_site_id as string) : null, reference: (p as any).numero, details: { "Proyecto de Zomatik": `${(p as any).numero} → ${detalle}` } })
    return { ok: true }
  }
  return { ok: false, error: "Tipo inválido" }
}

// ---------------------------------------------------------------------------
// Desde el pedido (quien programa)
// ---------------------------------------------------------------------------

/** Sin vínculo o "No está en Zomatik": lo único que se completa desde el pedido. */
const LIBRE = "zomatik_vinculo.is.null,zomatik_vinculo.eq.sin_par"
const antesDe = (vinculo: string | null | undefined) => (vinculo === "sin_par" ? "No está en Zomatik" : "Sin revisar")
const yaLoVinculo = (por: string | null | undefined) =>
  `Ya lo vinculó ${por || "otra persona"}: desde el pedido no se cambia. Si está mal, lo corrige un gerencial en Vínculos.`
const yaEsDe = (nombre: string) => `Ese cliente de Zomatik ya es «${nombre}» acá: usá ese cliente en el pedido.`

/** La misma fila que `registrarActividad`, pero con la `sb` que se recibe (así se prueba con la base simulada). */
async function actividad(sb: SB, o: { usuario: string; entity: "cliente" | "formula"; entityId: string; reference: string; details: Record<string, unknown> }) {
  try {
    const { error } = await sb.from("activity_log").insert({ user_name: o.usuario, action: "editar", entity: o.entity, entity_id: o.entityId, reference: o.reference, plant_id: null, details: o.details })
    if (error) console.error("[zomatik-vincular] actividad:", error.message)
  } catch (e) {
    console.error("[zomatik-vincular] actividad:", e)
  }
}

export async function aplicarDesdePedido(it: Item, o: { usuario: string; pedidoId?: string | null }, sb: SB = sbServicio()): Promise<Res> {
  if (it.accion !== "vincular" || (it.tipo !== "cliente" && it.tipo !== "formula"))
    return { ok: false, error: "Desde el pedido solo se vincula un cliente o una fórmula (corregir o quitar es en Vínculos)." }
  if (!UUID.test(String(it.id))) return { ok: false, error: it.tipo === "cliente" ? "Cliente inválido" : "Fórmula inválida" }
  const codigo = Number(it.codigo)
  if (!Number.isInteger(codigo) || codigo <= 0) return { ok: false, error: "Código de Zomatik inválido" }
  const pedidoId = o.pedidoId || null
  type PedidoV = { id: string; plant_id: string | null; client_id: string | null; formula_id: string | null }
  let ped: PedidoV | null = null
  if (pedidoId) {
    if (!UUID.test(pedidoId)) return { ok: false, error: "Pedido inválido" }
    const { data } = await sb.from("scheduled_dispatches").select("id, plant_id, client_id, formula_id").eq("id", pedidoId).maybeSingle()
    ped = data as PedidoV | null
    if (!ped) return { ok: false, error: "No existe el pedido" }
    if (it.tipo === "cliente" && ped.client_id !== it.id) return { ok: false, error: "Ese cliente no es el del pedido." }
    if (it.tipo === "formula" && ped.formula_id !== it.id) return { ok: false, error: "Esa fórmula no es la del pedido." }
  }
  const desde = `Programación · ${pedidoId ? `pedido ${pedidoId.slice(0, 8)}` : "pedido nuevo"}`
  const ahora = new Date().toISOString()

  if (it.tipo === "cliente") {
    const { data: c0 } = await sb.from("clients").select("id, name, cuit, zomatik_codigo, zomatik_vinculo, zomatik_vinculado_por").eq("id", it.id).maybeSingle()
    const c = c0 as { id: string; name: string; cuit: string | null; zomatik_codigo: number | null; zomatik_vinculo: string | null; zomatik_vinculado_por: string | null } | null
    if (!c) return { ok: false, error: "No existe el cliente" }
    if (c.zomatik_codigo != null || (c.zomatik_vinculo && c.zomatik_vinculo !== "sin_par")) return { ok: false, error: yaLoVinculo(c.zomatik_vinculado_por) }
    const { data: z0 } = await sb.from("zomatik_clientes").select("codigo, razon_social, cuit, estado").eq("codigo", codigo).maybeSingle()
    const z = z0 as { codigo: number; razon_social: string; cuit: string | null; estado: string | null } | null
    if (!z) return { ok: false, error: "Ese código no está en la copia de Zomatik" }
    const regla = controlVinculoPedido({ tipo: "cliente", cuitNuestro: c.cuit, zomatik: z })
    if (regla) return { ok: false, error: regla }
    const otroDe = async () => {
      const { data } = await sb.from("clients").select("id, name").eq("zomatik_codigo", codigo).neq("id", it.id).maybeSingle()
      return data as { id: string; name: string } | null
    }
    const otro = await otroDe()
    if (otro) return { ok: false, error: yaEsDe(otro.name) }
    const { data: hechos, error } = await sb
      .from("clients")
      .update({ zomatik_codigo: codigo, zomatik_vinculo: "manual", zomatik_vinculado_por: o.usuario, zomatik_vinculado_at: ahora })
      .eq("id", it.id)
      .is("zomatik_codigo", null)
      .or(LIBRE)
      .select("id")
    if (error) {
      // Dos a la vez con el mismo código: el índice único deja uno solo
      if ((error as { code?: string }).code === "23505") {
        const x = await otroDe()
        return { ok: false, error: x ? yaEsDe(x.name) : "Ese cliente de Zomatik ya está vinculado a otro cliente nuestro: usá ese en el pedido." }
      }
      return { ok: false, error: error.message }
    }
    if (!(hechos || []).length) {
      const { data: ya } = await sb.from("clients").select("zomatik_vinculado_por").eq("id", it.id).maybeSingle()
      return { ok: false, error: yaLoVinculo((ya as { zomatik_vinculado_por?: string | null } | null)?.zomatik_vinculado_por) }
    }
    olvidarClientes()
    const detalle = `${z.razon_social} (${codigo})`
    await actividad(sb, { usuario: o.usuario, entity: "cliente", entityId: it.id, reference: c.name, details: { "Vínculo con Zomatik": detalle, Desde: desde, Antes: antesDe(c.zomatik_vinculo) } })
    if (ped) await actividadNp(sb, { usuario: o.usuario, pedidoId: ped.id, plantId: ped.plant_id, referencia: `Pedido ${ped.id.slice(0, 8)}`, detalle: { "Qué pasó": `Vinculó el cliente «${c.name}» con ${detalle}` } })
    return { ok: true, tipo: "cliente", id: it.id, codigo, nombre: z.razon_social, antes: antesDe(c.zomatik_vinculo) }
  }

  // Fórmula
  const { data: f0 } = await sb.from("formulas").select("id, name, code, plant_id, zomatik_articulo_codigo, zomatik_vinculo, zomatik_vinculado_por").eq("id", it.id).maybeSingle()
  const f = f0 as { id: string; name: string; code: string | null; plant_id: string | null; zomatik_articulo_codigo: number | null; zomatik_vinculo: string | null; zomatik_vinculado_por: string | null } | null
  if (!f) return { ok: false, error: "No existe la fórmula" }
  if (f.zomatik_articulo_codigo != null || (f.zomatik_vinculo && f.zomatik_vinculo !== "sin_par")) return { ok: false, error: yaLoVinculo(f.zomatik_vinculado_por) }
  const { data: a0 } = await sb.from("zomatik_articulos").select("codigo, nombre, linea, codigo_sistema").eq("codigo", codigo).maybeSingle()
  const a = a0 as { codigo: number; nombre: string; linea: string | null; codigo_sistema: number | null } | null
  if (!a) return { ok: false, error: "Ese artículo no está en la copia de Zomatik" }
  const { data: pl } = f.plant_id ? await sb.from("plants").select("name").eq("id", f.plant_id).maybeSingle() : { data: null }
  const plantaNombre = (pl as { name?: string } | null)?.name || ""
  const regla = controlVinculoPedido({ tipo: "formula", plantaNombre, articulo: a })
  if (regla) return { ok: false, error: regla }
  const { data: hechos, error } = await sb
    .from("formulas")
    .update({ zomatik_articulo_codigo: codigo, zomatik_articulo_nombre: a.nombre, zomatik_vinculo: "manual", zomatik_vinculado_por: o.usuario, zomatik_vinculado_at: ahora })
    .eq("id", it.id)
    .is("zomatik_articulo_codigo", null)
    .or(LIBRE)
    .select("id")
  if (error) return { ok: false, error: error.message }
  if (!(hechos || []).length) {
    const { data: ya } = await sb.from("formulas").select("zomatik_vinculado_por").eq("id", it.id).maybeSingle()
    return { ok: false, error: yaLoVinculo((ya as { zomatik_vinculado_por?: string | null } | null)?.zomatik_vinculado_por) }
  }
  const detalle = `${a.nombre} (${codigo})`
  const nombreF = f.code || f.name
  await actividad(sb, { usuario: o.usuario, entity: "formula", entityId: it.id, reference: f.name, details: { "Artículo de Zomatik": detalle, Desde: desde, Antes: antesDe(f.zomatik_vinculo) } })
  if (ped) await actividadNp(sb, { usuario: o.usuario, pedidoId: ped.id, plantId: ped.plant_id, referencia: `Pedido ${ped.id.slice(0, 8)}`, detalle: { "Qué pasó": `Vinculó la fórmula «${nombreF}» con ${detalle}` } })
  return { ok: true, tipo: "formula", id: it.id, codigo, nombre: a.nombre, antes: antesDe(f.zomatik_vinculo) }
}

// ---------------------------------------------------------------------------
// Estado y buscador del cartel
// ---------------------------------------------------------------------------

export type ProblemaVinculo = "sin_vinculo" | "sin_par" | "articulo_no_esta" | "articulo_sin_codigo_sistema"

export type EstadoCliente = {
  id: string
  name: string
  cuit: string | null
  falta: boolean
  problema: ProblemaVinculo | null
  vinculado: { codigo: number; nombre: string | null; por: string | null } | null
  sugerencias: SugerenciaCliente[]
  duplicadoDe: DuplicadoDe[]
}
export type EstadoFormula = {
  id: string
  name: string
  code: string | null
  planta: string
  falta: boolean
  problema: ProblemaVinculo | null
  vinculado: { codigo: number; nombre: string | null; por: string | null } | null
  sugerencias: SugerenciaArticulo[]
}

async function todas(sb: SB, tabla: string, columnas: string): Promise<any[]> {
  const out: any[] = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb.from(tabla).select(columnas).range(desde, desde + 999)
    if (error) throw error
    out.push(...((data as any[]) || []))
    if (!data || data.length < 1000) break
  }
  return out
}

const articulosCopia = (sb: SB): Promise<ArticuloSug[]> => todas(sb, "zomatik_articulos", "codigo, nombre, linea, codigo_sistema")

/** Lo que muestra el cartel de un cliente de la copia (sin teléfono ni mail). */
const zSug = (z: ZomatikSug): ZomatikSug => ({ codigo: z.codigo, razon_social: z.razon_social, cuit: z.cuit ?? null, localidad: z.localidad ?? null, remitos_12m: z.remitos_12m || 0, ultimo_remito: z.ultimo_remito ?? null, estado: z.estado ?? null })

async function plantaDeFormula(sb: SB, plantId: string | null): Promise<string> {
  if (!plantId) return ""
  const { data } = await sb.from("plants").select("name").eq("id", plantId).maybeSingle()
  return (data as { name?: string } | null)?.name || ""
}

export async function estadoVinculos(o: { clientId?: string | null; formulaId?: string | null }, sb: SB = sbServicio()): Promise<{ cliente: EstadoCliente | null; formula: EstadoFormula | null }> {
  let cliente: EstadoCliente | null = null
  let formula: EstadoFormula | null = null
  if (o.clientId && UUID.test(o.clientId)) {
    const { data } = await sb.from("clients").select("id, name, cuit, zomatik_codigo, zomatik_vinculo, zomatik_vinculado_por").eq("id", o.clientId).maybeSingle()
    const c = data as { id: string; name: string; cuit: string | null; zomatik_codigo: number | null; zomatik_vinculo: string | null; zomatik_vinculado_por: string | null } | null
    if (c) {
      const falta = c.zomatik_codigo == null
      const { nuestros, zomatik } = await cargarClientesParaBuscar(sb)
      const yo = nuestros.find((x) => x.id === c.id) || { id: c.id, name: c.name, cuit: c.cuit }
      const sug = falta ? sugerenciasCliente(yo, zomatik as ZomatikSug[], nuestros) : { sugerencias: [], duplicadoDe: [] }
      cliente = {
        id: c.id, name: c.name, cuit: c.cuit, falta,
        problema: falta ? (c.zomatik_vinculo === "sin_par" ? "sin_par" : "sin_vinculo") : null,
        vinculado: falta ? null : { codigo: c.zomatik_codigo as number, nombre: zomatik.find((z) => z.codigo === c.zomatik_codigo)?.razon_social || null, por: c.zomatik_vinculado_por },
        sugerencias: sug.sugerencias,
        duplicadoDe: sug.duplicadoDe,
      }
    }
  }
  if (o.formulaId && UUID.test(o.formulaId)) {
    const { data } = await sb.from("formulas").select("id, name, code, plant_id, zomatik_articulo_codigo, zomatik_articulo_nombre, zomatik_vinculo, zomatik_vinculado_por").eq("id", o.formulaId).maybeSingle()
    const f = data as { id: string; name: string; code: string | null; plant_id: string | null; zomatik_articulo_codigo: number | null; zomatik_articulo_nombre: string | null; zomatik_vinculo: string | null; zomatik_vinculado_por: string | null } | null
    if (f) {
      const planta = await plantaDeFormula(sb, f.plant_id)
      let problema: ProblemaVinculo | null = null
      let art: ArticuloSug | null = null
      if (f.zomatik_articulo_codigo == null) problema = f.zomatik_vinculo === "sin_par" ? "sin_par" : "sin_vinculo"
      else {
        const { data: a } = await sb.from("zomatik_articulos").select("codigo, nombre, linea, codigo_sistema").eq("codigo", f.zomatik_articulo_codigo).maybeSingle()
        art = a as ArticuloSug | null
        if (!art) problema = "articulo_no_esta"
        else if (!art.codigo_sistema) problema = "articulo_sin_codigo_sistema"
      }
      // Solo lo que no tiene artículo se completa desde el pedido; un artículo vinculado que no sirve lo corrige un gerencial
      const libre = problema === "sin_vinculo" || problema === "sin_par"
      formula = {
        id: f.id, name: f.name, code: f.code, planta, falta: problema !== null, problema,
        vinculado: f.zomatik_articulo_codigo == null ? null : { codigo: f.zomatik_articulo_codigo, nombre: art?.nombre || f.zomatik_articulo_nombre, por: f.zomatik_vinculado_por },
        sugerencias: libre ? sugerenciasArticulo({ id: f.id, name: f.name, code: f.code, planta }, planta, await articulosCopia(sb)) : [],
      }
    }
  }
  return { cliente, formula }
}

export type HitClienteVincular = ZomatikSug & { cuit_coincide: "igual" | "distinto" | null; vinculado_a: VinculadoA | null }
export type HitArticuloVincular = { codigo: number; nombre: string; otra_planta: boolean; sin_codigo_sistema: boolean }

export async function buscarParaVincular(
  tipo: "cliente" | "articulo",
  q: string,
  o: { clientId?: string | null; formulaId?: string | null } = {},
  sb: SB = sbServicio(),
): Promise<{ clientes?: HitClienteVincular[]; articulos?: HitArticuloVincular[] }> {
  const texto = String(q || "").trim().slice(0, 80)
  if (tipo === "cliente") {
    const { nuestros, zomatik } = await cargarClientesParaBuscar(sb)
    const yo = o.clientId ? nuestros.find((c) => c.id === o.clientId) : undefined
    const vinculadoA = vinculadosPorCodigo(nuestros, o.clientId)
    // Los genéricos y los inactivos no aparecen (no se vinculan desde el pedido)
    const validos = (zomatik as ZomatikSug[]).filter((z) => zomatikActivo(z) && !esGenerico(z.razon_social))
    const hits = buscarEnZomatik(texto, validos.map((z) => ({ ...z, remitos_12m: z.remitos_12m || 0 })), 10)
    return { clientes: hits.map((z) => ({ ...zSug(z), cuit_coincide: compararCuit(yo?.cuit, z.cuit), vinculado_a: vinculadoA.get(z.codigo) || null })) }
  }
  if (texto.length < 2) return { articulos: [] }
  let planta = ""
  if (o.formulaId && UUID.test(o.formulaId)) {
    const { data } = await sb.from("formulas").select("plant_id").eq("id", o.formulaId).maybeSingle()
    planta = await plantaDeFormula(sb, (data as { plant_id?: string | null } | null)?.plant_id || null)
  }
  const dig = soloDigitos(texto)
  const arts = (await articulosCopia(sb)).filter((a) => deHormigon({ codigo: a.codigo, nombre: a.nombre, linea: a.linea }))
  const hits = arts.filter((a) => (dig.length >= 3 && dig === texto.replace(/\s/g, "") && String(a.codigo).includes(dig)) || coincidePalabras(texto, a.nombre))
  return {
    articulos: hits
      .map((a) => ({ codigo: a.codigo, nombre: a.nombre, otra_planta: !!otraPlantaDelArticulo(a.nombre, planta), sin_codigo_sistema: !a.codigo_sistema }))
      .sort((x, y) => Number(x.otra_planta) - Number(y.otra_planta) || Number(x.sin_codigo_sistema) - Number(y.sin_codigo_sistema) || x.nombre.localeCompare(y.nombre))
      .slice(0, 12),
  }
}
