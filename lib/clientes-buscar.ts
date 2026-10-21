/**
 * Buscador unificado de clientes y control de duplicados (regla de Bautista del 21/10/2026: "no dar de alta el
 * mismo cliente con otro nombre"). Funciones puras, para el servidor y las pruebas (`npm run test:zomatik`).
 *
 * Busca a la vez en nuestros clientes y en la copia de Zomatik:
 *   - sin tildes ni mayúsculas, por palabras en cualquier orden y por partes de palabra ("fide terc");
 *   - por razón social, nombre (de fantasía) y alias;
 *   - por CUIT o DNI, con o sin guiones;
 *   - por nombre de obra (aparece su cliente);
 *   - por teléfono.
 * Más "posibles parecidos" por trigramas (tolera errores de tipeo), sin dependencias.
 */
import { cuitValido, nombreNormalizado, parecidoNombres, soloDigitos } from "@/lib/zomatik/parseo"

export function normalizarBusqueda(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** Igual que lo guarda la base en client_alias.alias_norm: sin tildes, minúsculas, espacios simples. */
export function normalizarAlias(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

const tokens = (s: unknown) => normalizarBusqueda(s).split(" ").filter(Boolean)

/** ¿Todas las palabras buscadas están (como parte de palabra) en el texto? Las de una letra, al principio. */
export function coincidePalabras(q: string, ...campos: unknown[]): boolean {
  const tq = tokens(q)
  if (tq.length === 0) return false
  const tc = campos.flatMap(tokens)
  return tq.every((t) => tc.some((w) => (t.length === 1 ? w.startsWith(t) : w.includes(t))))
}

function trigramas(s: string): Set<string> {
  const t = `  ${normalizarBusqueda(s)} `
  const out = new Set<string>()
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3))
  return out
}

/**
 * Parecido de lo buscado con un nombre: contra el nombre entero y contra cada palabra de 4 letras o más
 * ("merba" ~ "MERVA SA").
 */
export function similitudBusqueda(q: unknown, nombre: unknown): number {
  const palabras = normalizarBusqueda(nombre).split(" ").filter((w) => w.length >= 4)
  return Math.max(similitud(q, nombre), ...palabras.map((w) => similitud(q, w)))
}

/** Parecido por trigramas (Dice), 0 a 1. Tolera errores de tipeo: "merba" ~ "merva". */
export function similitud(a: unknown, b: unknown): number {
  const A = trigramas(String(a ?? ""))
  const B = trigramas(String(b ?? ""))
  if (A.size === 0 || B.size === 0) return 0
  let comunes = 0
  for (const x of A) if (B.has(x)) comunes++
  return (2 * comunes) / (A.size + B.size)
}

export type Documento = { tipo: "CUIT" | "DNI"; digitos: string }

/** CUIT/CUIL con dígito verificador, o DNI de 7 u 8 dígitos. Si no, null. */
export function documentoValido(s: unknown): Documento | null {
  const d = soloDigitos(s)
  if (d.length === 11) return cuitValido(d) ? { tipo: "CUIT", digitos: d } : null
  if ((d.length === 7 || d.length === 8) && !/^(\d)\1+$/.test(d) && Number(d) >= 1_000_000) return { tipo: "DNI", digitos: d }
  return null
}

/** El DNI que lleva adentro un CUIT de persona (20-12345678-6 → 12345678). */
function dniDe(doc: Documento | null): string | null {
  if (!doc) return null
  if (doc.tipo === "DNI") return doc.digitos.replace(/^0+/, "")
  return ["20", "23", "24", "27"].includes(doc.digitos.slice(0, 2)) ? doc.digitos.slice(2, 10).replace(/^0+/, "") : null
}

/** ¿Los dos documentos son de la misma persona o empresa? (CUIT igual, o el DNI dentro del CUIT). */
export function mismoDocumento(a: unknown, b: unknown): boolean {
  const da = documentoValido(a)
  const db = documentoValido(b)
  if (!da || !db) return false
  if (da.digitos === db.digitos) return true
  const x = dniDe(da)
  const y = dniDe(db)
  return !!x && x === y
}

export type NuestroB = {
  id: string
  name: string
  razon_social?: string | null
  cuit?: string | null
  phone?: string | null
  active?: boolean | null
  zomatik_codigo?: number | null
  /** si se unificó: el id del cliente que quedó */
  unificado_en?: string | null
  alias?: string[]
  obras?: string[]
  despachos?: number
  ultimo_despacho?: string | null
}
export type ZomatikB = { codigo: number; razon_social: string; cuit?: string | null; telefono?: string | null; localidad?: string | null; remitos_12m?: number; ultimo_remito?: string | null; estado?: string | null }

export type HitRebucret = { id: string; name: string; via: string; dado_de_baja: boolean; zomatik_codigo: number | null }

/** El cliente que vale: si se unificó, el que quedó (siguiendo la cadena, por las dudas). */
export function clienteVigente<T extends { id: string; unificado_en?: string | null }>(c: T, porId: Map<string, T>): T {
  let x = c
  for (let i = 0; i < 5 && x.unificado_en && porId.get(x.unificado_en); i++) x = porId.get(x.unificado_en)!
  return x
}
export type HitZomatik = { codigo: number; razon_social: string; cuit: string | null; localidad: string | null; remitos_12m: number; ultimo_remito: string | null }
export type Parecido = { tipo: "rebucret" | "zomatik"; id: string; nombre: string; similitud: number; dado_de_baja?: boolean }

const activoZ = (z: ZomatikB) => !z.estado || /activ/i.test(z.estado)

/** Por qué coincide un cliente nuestro (o null). */
function viaNuestro(q: string, c: NuestroB): string | null {
  const dq = soloDigitos(q)
  if (dq.length >= 5) {
    if (soloDigitos(c.cuit).includes(dq)) return "CUIT/DNI"
    if (dq.length >= 6 && soloDigitos(c.phone).includes(dq)) return "teléfono"
  }
  if (coincidePalabras(q, c.name, c.razon_social)) return "nombre"
  const al = (c.alias || []).find((a) => coincidePalabras(q, a))
  if (al) return `alias «${al}»`
  const ob = (c.obras || []).find((o) => coincidePalabras(q, o))
  if (ob) return `obra «${ob}»`
  return null
}

function viaZomatik(q: string, z: ZomatikB): string | null {
  const dq = soloDigitos(q)
  if (dq.length >= 5) {
    if (soloDigitos(z.cuit).includes(dq)) return "CUIT/DNI"
    if (dq.length >= 6 && soloDigitos(z.telefono).includes(dq)) return "teléfono"
  }
  return coincidePalabras(q, z.razon_social) ? "nombre" : null
}

/**
 * Búsqueda unificada. Los de Zomatik ya vinculados a un cliente nuestro (o con el mismo nombre) se muestran
 * como "En Rebucret" (nunca se ofrece traer uno que ya está). Los dados de baja aparecen marcados.
 */
export function buscarClientes(q: string, nuestros: NuestroB[], zomatik: ZomatikB[], max = 8) {
  const texto = String(q || "").trim()
  const rebucret: HitRebucret[] = []
  const deZomatik: HitZomatik[] = []
  const parecidos: Parecido[] = []
  if (texto.length < 2) return { rebucret, zomatik: deZomatik, parecidos }
  const porId = new Map(nuestros.map((c) => [c.id, c]))
  const porCodigo = new Map(nuestros.filter((c) => c.zomatik_codigo != null).map((c) => [c.zomatik_codigo as number, c]))
  const porNombre = new Map<string, NuestroB>()
  for (const c0 of nuestros) for (const n of [c0.name, c0.razon_social, ...(c0.alias || [])]) {
    const c = clienteVigente(c0, porId)
    const k = nombreNormalizado(n)
    if (k && (!porNombre.has(k) || (porNombre.get(k)!.active === false && c.active !== false))) porNombre.set(k, c)
  }
  const vistos = new Set<string>()
  const agregarNuestro = (c0: NuestroB, via0: string) => {
    // Un cliente unificado no se ofrece: se ofrece el que quedó
    const c = clienteVigente(c0, porId)
    const via = c.id !== c0.id ? `«${c0.name}» se unificó en este` : via0
    if (vistos.has(c.id)) return
    vistos.add(c.id)
    rebucret.push({ id: c.id, name: c.name, via, dado_de_baja: c.active === false, zomatik_codigo: c.zomatik_codigo ?? null })
  }
  for (const c of nuestros) {
    const v = viaNuestro(texto, c)
    if (v) agregarNuestro(c, v)
  }
  const zVistos = new Set<number>()
  for (const z of zomatik) {
    if (!activoZ(z)) continue
    const v = viaZomatik(texto, z)
    if (!v) continue
    zVistos.add(z.codigo)
    const nuestro = porCodigo.get(z.codigo) || porNombre.get(nombreNormalizado(z.razon_social))
    if (nuestro) agregarNuestro(nuestro, `en Zomatik como «${z.razon_social}»`)
    else deZomatik.push({ codigo: z.codigo, razon_social: z.razon_social, cuit: z.cuit || null, localidad: z.localidad || null, remitos_12m: z.remitos_12m || 0, ultimo_remito: z.ultimo_remito || null })
  }
  // Posibles parecidos (errores de tipeo), si la búsqueda tiene letras
  if (normalizarBusqueda(texto).replace(/[0-9 ]/g, "").length >= 3) {
    for (const c of nuestros) {
      if (vistos.has(c.id) || c.unificado_en) continue
      const s = Math.max(...[c.name, c.razon_social, ...(c.alias || [])].filter(Boolean).map((n) => similitudBusqueda(texto, n)))
      if (s >= 0.45) parecidos.push({ tipo: "rebucret", id: c.id, nombre: c.name, similitud: Math.round(s * 100) / 100, dado_de_baja: c.active === false })
    }
    for (const z of zomatik) {
      if (zVistos.has(z.codigo) || !activoZ(z) || porCodigo.has(z.codigo) || porNombre.has(nombreNormalizado(z.razon_social))) continue
      const s = similitudBusqueda(texto, z.razon_social)
      if (s >= 0.45) parecidos.push({ tipo: "zomatik", id: String(z.codigo), nombre: z.razon_social, similitud: Math.round(s * 100) / 100 })
    }
    parecidos.sort((a, b) => b.similitud - a.similitud)
  }
  const orden = (a: HitRebucret, b: HitRebucret) => Number(a.dado_de_baja) - Number(b.dado_de_baja) || a.name.localeCompare(b.name)
  return {
    rebucret: rebucret.sort(orden).slice(0, max),
    zomatik: deZomatik.sort((a, b) => b.remitos_12m - a.remitos_12m || a.razon_social.localeCompare(b.razon_social)).slice(0, max),
    parecidos: parecidos.slice(0, 6),
  }
}

// ---------------------------------------------------------------------------
// Alta nueva: mismo documento y nombres parecidos, en los dos lados
// ---------------------------------------------------------------------------

export type Conflicto = {
  tipo: "rebucret" | "zomatik"
  id: string
  nombre: string
  motivo: string
  evidencia: string
  dado_de_baja?: boolean
}

/** Nombres "parecidos" para el alta: mismo nombre normalizado, tokens en común o trigramas. */
export function nombresParecidos(a: unknown, b: unknown): number {
  if (!nombreNormalizado(a) || !nombreNormalizado(b)) return 0
  if (nombreNormalizado(a) === nombreNormalizado(b)) return 1
  return Math.max(similitud(a, b), parecidoNombres(a, b) >= 0.99 ? 0.8 : parecidoNombres(a, b) * 0.9)
}

const fecha = (f: string | null | undefined) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}` : "")

export function verificarAlta(nuevo: { nombre: string; cuit?: string | null }, nuestros: NuestroB[], zomatik: ZomatikB[]) {
  const mismoDoc: Conflicto[] = []
  const parecidos: Conflicto[] = []
  const ev = (c: NuestroB) =>
    [c.obras?.length ? `obras: ${c.obras.slice(0, 3).join(", ")}` : "", c.despachos ? `${c.despachos} despachos` : "", c.ultimo_despacho ? `último ${fecha(c.ultimo_despacho)}` : ""].filter(Boolean).join(" · ") ||
    "sin despachos"
  const evZ = (z: ZomatikB) => [z.remitos_12m ? `${z.remitos_12m} remitos en el año` : "sin remitos en el año", z.ultimo_remito ? `último ${fecha(z.ultimo_remito)}` : "", z.localidad || ""].filter(Boolean).join(" · ")
  const porCodigo = new Set(nuestros.filter((c) => c.zomatik_codigo != null).map((c) => c.zomatik_codigo as number))
  if (documentoValido(nuevo.cuit)) {
    for (const c of nuestros) if (mismoDocumento(nuevo.cuit, c.cuit)) mismoDoc.push({ tipo: "rebucret", id: c.id, nombre: c.name, motivo: "mismo CUIT/DNI", evidencia: ev(c), dado_de_baja: c.active === false })
    // También los CUIT de Zomatik (activos o no). Si ese cliente de Zomatik ya está vinculado, el conflicto es con el nuestro
    const vinculadoA = new Map(nuestros.filter((c) => c.zomatik_codigo != null).map((c) => [c.zomatik_codigo as number, c]))
    for (const z of zomatik) {
      if (!mismoDocumento(nuevo.cuit, z.cuit)) continue
      const c = vinculadoA.get(z.codigo)
      if (c) {
        if (!mismoDoc.some((m) => m.tipo === "rebucret" && m.id === c.id))
          mismoDoc.push({ tipo: "rebucret", id: c.id, nombre: c.name, motivo: `mismo CUIT que su cliente de Zomatik «${z.razon_social}»`, evidencia: ev(c), dado_de_baja: c.active === false })
      } else mismoDoc.push({ tipo: "zomatik", id: String(z.codigo), nombre: z.razon_social, motivo: activoZ(z) ? "mismo CUIT/DNI en Zomatik" : "mismo CUIT/DNI en Zomatik (inactivo allá)", evidencia: evZ(z) })
    }
  }
  const yaEsta = new Set(mismoDoc.map((m) => `${m.tipo}:${m.id}`))
  for (const c of nuestros) {
    if (yaEsta.has(`rebucret:${c.id}`)) continue
    const s = Math.max(...[c.name, c.razon_social, ...(c.alias || [])].filter(Boolean).map((n) => nombresParecidos(nuevo.nombre, n)))
    if (s >= 0.6) parecidos.push({ tipo: "rebucret", id: c.id, nombre: c.name, motivo: s >= 0.99 ? "mismo nombre" : `nombre parecido (${Math.round(s * 100)} %)`, evidencia: ev(c), dado_de_baja: c.active === false })
  }
  for (const z of zomatik) {
    if (!activoZ(z) || porCodigo.has(z.codigo) || yaEsta.has(`zomatik:${z.codigo}`)) continue
    const s = nombresParecidos(nuevo.nombre, z.razon_social)
    if (s >= 0.6) parecidos.push({ tipo: "zomatik", id: String(z.codigo), nombre: z.razon_social, motivo: s >= 0.99 ? "mismo nombre en Zomatik" : `nombre parecido en Zomatik (${Math.round(s * 100)} %)`, evidencia: evZ(z) })
  }
  parecidos.sort((a, b) => (a.motivo.startsWith("mismo") ? -1 : 0) - (b.motivo.startsWith("mismo") ? -1 : 0))
  // Los unificados se muestran como el que quedó ("«A» se unificó en «X»"), sin repetir
  const porId = new Map(nuestros.map((c) => [c.id, c]))
  const vigentes = (xs: Conflicto[]) => {
    const out: Conflicto[] = []
    for (const x of xs) {
      const c0 = x.tipo === "rebucret" ? porId.get(x.id) : undefined
      const c = c0 ? clienteVigente(c0, porId) : undefined
      const y = c && c0 && c.id !== c0.id ? { ...x, id: c.id, nombre: c.name, motivo: `${x.motivo} («${c0.name}» se unificó en «${c.name}»)`, evidencia: ev(c), dado_de_baja: c.active === false } : x
      if (!out.some((o) => o.tipo === y.tipo && o.id === y.id)) out.push(y)
    }
    return out
  }
  return { mismoDoc: vigentes(mismoDoc), parecidos: vigentes(parecidos).slice(0, 8) }
}

// ---------------------------------------------------------------------------
// Detector de duplicados nuestros
// ---------------------------------------------------------------------------

/** Nombres de obra que no identifican (muchos clientes tienen una "Casa" o una "Platea"). */
const OBRAS_GENERICAS = /^(casa|obra|obras|pileta|platea|vivienda|losa|losas|contrapiso|varios|base|bases|pavimento|vereda|garage|galpon|quincho)( \d+)?$/

/** Para duplicados, más estricto que en el alta: un nombre contenido en otro cuenta solo si tiene 2 palabras o más. */
function nombreDuplicado(a: unknown, b: unknown): number {
  if (!nombreNormalizado(a) || !nombreNormalizado(b)) return 0
  if (nombreNormalizado(a) === nombreNormalizado(b)) return 1
  const ta = nombreNormalizado(a).split(" ").filter((t) => t.length > 2).length
  const tb = nombreNormalizado(b).split(" ").filter((t) => t.length > 2).length
  const cont = parecidoNombres(a, b) >= 0.99 && Math.min(ta, tb) >= 2 ? 0.85 : 0
  return Math.max(similitud(a, b), cont)
}

export type ParDuplicado = { a: string; b: string; motivos: string[] }

/** Pares de clientes nuestros (activos) que parecen el mismo: mismo CUIT/DNI, nombre muy parecido, mismas obras. */
export function detectarDuplicados(clientes: NuestroB[]): ParDuplicado[] {
  const act = clientes.filter((c) => c.active !== false && !c.unificado_en)
  const out: ParDuplicado[] = []
  for (let i = 0; i < act.length; i++)
    for (let j = i + 1; j < act.length; j++) {
      const a = act[i]
      const b = act[j]
      const motivos: string[] = []
      if (mismoDocumento(a.cuit, b.cuit)) motivos.push("mismo CUIT/DNI")
      const s = Math.max(nombreDuplicado(a.name, b.name), nombreDuplicado(a.razon_social || a.name, b.razon_social || b.name))
      if (s >= 0.99) motivos.push("mismo nombre")
      else if (s >= 0.8) motivos.push(`nombre muy parecido (${Math.round(s * 100)} %)`)
      const oa = new Set((a.obras || []).map(normalizarBusqueda).filter((o) => o.length >= 4 && !OBRAS_GENERICAS.test(o)))
      const comunes = [...new Set((b.obras || []).map(normalizarBusqueda))].filter((o) => oa.has(o))
      // Una obra con el mismo nombre sola no alcanza (dos contratistas pueden trabajar en la misma): hacen falta 2,
      // o 1 y nombres algo parecidos
      if (comunes.length >= 2 || (comunes.length === 1 && Math.max(s, similitud(a.name, b.name)) >= 0.5)) motivos.push(`mismas obras: ${comunes.slice(0, 3).join(", ")}`)
      if (motivos.length) out.push({ a: a.id, b: b.id, motivos })
    }
  return out
}
