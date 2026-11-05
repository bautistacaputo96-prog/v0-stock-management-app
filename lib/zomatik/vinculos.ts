/**
 * Zomatik · propuestas de vínculo (etapa Z0). Funciones puras: las usan el script de primera carga
 * (scripts/zomatik-primera-carga.mjs) y la pantalla "Vínculos con Zomatik", así las dos proponen lo mismo.
 *
 * Reglas (spec 6.3, 6.7, 11 y 17.7.5):
 *   - Clientes: "seguro" = CUIT válido igual, o nombre igual sin tildes ni S.A./ARQ/ING/FIDEICOMISO; y además
 *     que el par sea único de los dos lados. "Dudoso" = nombre parecido (se confirma a mano). Si no, sin par.
 *     El CUIT de relleno (inválido) nunca vincula.
 *   - Fórmulas: "seguro" = nombre igual, o igual con las reglas de la spec (sufijo de planta, 6/12 → 612,
 *     GUN → GUNITADO, PELQUE después de la planta); único. "Dudoso" = mismo hormigón y medidas parecidas.
 *   - Proyectos ↔ obras: solo entre las obras del cliente vinculado. "Seguro" = nombre de obra igual (único).
 *     "Dudoso" = parecido, o el cliente tiene una sola obra.
 */
import { cuitValido, nombreNormalizado, parecidoNombres, soloDigitos, tokensNombre } from "@/lib/zomatik/parseo"
import { esGenerico } from "@/lib/zomatik/cruce"
import { detectarDuplicados, formatearCuit, type NuestroB } from "@/lib/clientes-buscar"
import { interpretarNombre } from "@/lib/formulas-nombre"

export type Certeza = "seguro" | "dudoso"
export type Propuesta<T> = { candidato: T; certeza: Certeza; motivo: string; puntaje: number }

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

export type ClienteNuestro = { id: string; name: string; razon_social?: string | null; cuit?: string | null }
export type ClienteZomatik = { codigo: number; razon_social: string; cuit?: string | null; remitos_12m?: number }

const PARECIDO_MINIMO = 0.66

function nombresDe(c: ClienteNuestro): string[] {
  return [c.name, c.razon_social].filter((x): x is string => !!x && !!String(x).trim())
}

/**
 * Propuesta para cada cliente nuestro (los que no se pueden vincular no aparecen). Los seguros salen únicos de
 * los dos lados: si dos de los nuestros caen en el mismo de Zomatik (o al revés), pasan a dudosos.
 */
export function proponerClientes(nuestros: ClienteNuestro[], deZomatik: ClienteZomatik[]): Map<string, Propuesta<ClienteZomatik>> {
  const porCuit = new Map<string, ClienteZomatik[]>()
  const porNombre = new Map<string, ClienteZomatik[]>()
  for (const z of deZomatik) {
    const d = soloDigitos(z.cuit)
    if (cuitValido(d)) porCuit.set(d, [...(porCuit.get(d) || []), z])
    const n = nombreNormalizado(z.razon_social)
    if (n) porNombre.set(n, [...(porNombre.get(n) || []), z])
  }
  const prelim = new Map<string, Propuesta<ClienteZomatik>>()
  for (const c of nuestros) {
    const d = soloDigitos(c.cuit)
    if (cuitValido(d)) {
      const zs = porCuit.get(d) || []
      if (zs.length === 1) {
        prelim.set(c.id, { candidato: zs[0], certeza: "seguro", motivo: "CUIT igual", puntaje: 1 })
        continue
      }
    }
    let igual: ClienteZomatik[] = []
    for (const n of nombresDe(c)) {
      const k = nombreNormalizado(n)
      if (k && porNombre.get(k)) igual = [...igual, ...porNombre.get(k)!]
    }
    igual = [...new Map(igual.map((z) => [z.codigo, z])).values()]
    if (igual.length === 1) {
      prelim.set(c.id, { candidato: igual[0], certeza: "seguro", motivo: "Nombre igual", puntaje: 1 })
      continue
    }
    if (igual.length > 1) {
      // Varios con el mismo nombre en Zomatik: el que más usó el último año, para confirmar a mano
      const z = [...igual].sort((a, b) => (b.remitos_12m || 0) - (a.remitos_12m || 0))[0]
      prelim.set(c.id, { candidato: z, certeza: "dudoso", motivo: `Hay ${igual.length} con el mismo nombre en Zomatik`, puntaje: 0.99 })
      continue
    }
    let mejor: ClienteZomatik | null = null
    let mejorP = 0
    let mejorUso = -1
    for (const z of deZomatik) {
      let p = 0
      for (const n of nombresDe(c)) p = Math.max(p, parecidoNombres(n, z.razon_social))
      const uso = z.remitos_12m || 0
      if (p > mejorP || (p === mejorP && p > 0 && uso > mejorUso)) {
        mejor = z
        mejorP = p
        mejorUso = uso
      }
    }
    const tokens = Math.max(...nombresDe(c).map((n) => tokensNombre(n).filter((t) => t.length > 2).length), 0)
    if (mejor && (mejorP >= 0.99 || (mejorP >= PARECIDO_MINIMO && tokens >= 2)))
      prelim.set(c.id, { candidato: mejor, certeza: "dudoso", motivo: "Nombre parecido", puntaje: Math.round(mejorP * 100) / 100 })
  }
  // Unicidad de los seguros del lado de Zomatik
  const usos = new Map<number, number>()
  for (const p of prelim.values()) if (p.certeza === "seguro") usos.set(p.candidato.codigo, (usos.get(p.candidato.codigo) || 0) + 1)
  for (const [id, p] of prelim) {
    if (p.certeza === "seguro" && (usos.get(p.candidato.codigo) || 0) > 1)
      prelim.set(id, { ...p, certeza: "dudoso", motivo: `${p.motivo}, pero hay otro cliente nuestro igual` })
  }
  return prelim
}

/**
 * ¿El cliente de Zomatik ya está en Rebucret? Por código vinculado o por nombre igual (para no duplicar al
 * "Traer de Zomatik"). Devuelve el cliente nuestro o null.
 */
export function yaEstaEnRebucret<T extends ClienteNuestro & { zomatik_codigo?: number | null }>(z: ClienteZomatik, nuestros: T[]): T | null {
  const porCodigo = nuestros.find((c) => c.zomatik_codigo === z.codigo)
  if (porCodigo) return porCodigo
  const k = nombreNormalizado(z.razon_social)
  if (!k) return null
  return nuestros.find((c) => nombresDe(c).some((n) => nombreNormalizado(n) === k)) || null
}

/** Búsqueda en la copia de Zomatik por texto (nombre normalizado) o por CUIT (dígitos). */
export function buscarEnZomatik<T extends ClienteZomatik>(texto: string, deZomatik: T[], max = 8): T[] {
  const q = String(texto || "").trim()
  if (q.length < 3) return []
  const dig = soloDigitos(q)
  const tq = tokensNombre(q)
  const out: { z: T; p: number }[] = []
  for (const z of deZomatik) {
    if (dig.length >= 6 && soloDigitos(z.cuit).includes(dig)) {
      out.push({ z, p: 2 })
      continue
    }
    if (tq.length === 0) continue
    const tz = tokensNombre(z.razon_social)
    // Todos los tokens buscados tienen que empezar algún token del nombre
    const todos = tq.every((t) => tz.some((w) => w.startsWith(t)))
    if (todos) out.push({ z, p: 1 + (z.remitos_12m || 0) / 1000 })
  }
  return out.sort((a, b) => b.p - a.p || a.z.razon_social.localeCompare(b.z.razon_social)).slice(0, max).map((x) => x.z)
}

// ---------------------------------------------------------------------------
// Fórmulas ↔ artículos
// ---------------------------------------------------------------------------

export type FormulaNuestra = { id: string; name: string; code?: string | null; planta: string }
export type ArticuloZomatik = { codigo: number; nombre: string; linea?: string | null }

const clave = (s: unknown) => String(s ?? "").toUpperCase().replace(/\s+/g, " ").trim()

/** Sufijo de planta de los artículos de Zomatik: Hudson → (HUD), Canning → (CAN). */
export function sufijoPlanta(planta: string): "(HUD)" | "(CAN)" | null {
  const p = clave(planta)
  if (p.startsWith("HUD")) return "(HUD)"
  if (p.startsWith("CAN")) return "(CAN)"
  return null
}

/** Variantes del nombre de una fórmula según las reglas de la spec 6.7. */
export function variantesFormula(f: FormulaNuestra): string[] {
  const n = clave(f.name)
  const suf = sufijoPlanta(f.planta)
  const base = n.replace(/\s*\((CAN|HUD)\)\s*/g, " ").replace(/\s+/g, " ").trim()
  const out = new Set<string>([n])
  if (suf) {
    out.add(`${base} ${suf}`)
    const m = base.match(/^(.*?)\s+PELQUE$/)
    if (m) out.add(`${m[1]} ${suf} PELQUE`)
  }
  for (const v of [...out]) {
    const w = v.replace(/6\/12/g, "612").replace(/6\/20/g, "620")
    out.add(w)
    out.add(w.replace(/-GUN(\b|\s)/g, "-GUNITADO$1"))
    out.add(v.replace(/-GUN(\b|\s)/g, "-GUNITADO$1"))
  }
  return [...out]
}

/** Tokens para comparar fórmulas: sin sufijo de planta, con 6/12 → 612, separando letras y números. */
function tokensFormula(s: string): string[] {
  return clave(s)
    .replace(/\((CAN|HUD)\)/g, " ")
    .replace(/6\/12/g, "612")
    .replace(/6\/20/g, "620")
    .replace(/GUNITADO/g, "GUN")
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
}

function plantaDelArticulo(nombre: string): "(HUD)" | "(CAN)" | null {
  const m = clave(nombre).match(/\((HUD|CAN)\)/)
  return m ? (`(${m[1]})` as "(HUD)" | "(CAN)") : null
}

/** Artículos de hormigón (los servicios no se vinculan a fórmulas). */
export function deHormigon(a: ArticuloZomatik) {
  return !String(a.linea ?? "").toLowerCase().includes("servicio")
}

export function proponerFormulas(formulas: FormulaNuestra[], articulos: ArticuloZomatik[]): Map<string, Propuesta<ArticuloZomatik>> {
  const arts = articulos.filter(deHormigon)
  const porNombre = new Map<string, ArticuloZomatik[]>()
  for (const a of arts) porNombre.set(clave(a.nombre), [...(porNombre.get(clave(a.nombre)) || []), a])
  const prelim = new Map<string, Propuesta<ArticuloZomatik>>()
  for (const f of formulas) {
    const exacto = [...(porNombre.get(clave(f.name)) || []), ...(f.code ? porNombre.get(clave(f.code)) || [] : [])]
    const unicosExacto = [...new Map(exacto.map((a) => [a.codigo, a])).values()]
    if (unicosExacto.length === 1) {
      prelim.set(f.id, { candidato: unicosExacto[0], certeza: "seguro", motivo: "Nombre igual", puntaje: 1 })
      continue
    }
    const porRegla = [...new Map(variantesFormula(f).flatMap((v) => porNombre.get(v) || []).map((a) => [a.codigo, a])).values()]
    if (porRegla.length === 1) {
      prelim.set(f.id, { candidato: porRegla[0], certeza: "seguro", motivo: "Igual con las reglas (planta, 6/12, GUN)", puntaje: 1 })
      continue
    }
    // Dudoso: mismo hormigón (primer token, ej. H30 o RDC) y la mayoría de los números
    const tf = tokensFormula(f.name)
    if (tf.length === 0) continue
    const suf = sufijoPlanta(f.planta)
    let mejor: ArticuloZomatik | null = null
    let mejorP = 0
    for (const a of arts) {
      const pa = plantaDelArticulo(a.nombre)
      if (suf && pa && pa !== suf) continue
      const ta = tokensFormula(a.nombre)
      if (ta[0] !== tf[0]) continue
      const comunes = tf.filter((t) => ta.includes(t)).length
      const p = comunes / Math.max(tf.length, 1)
      if (p > mejorP) {
        mejorP = p
        mejor = a
      }
    }
    if (mejor && mejorP >= 0.5)
      prelim.set(f.id, { candidato: mejor, certeza: "dudoso", motivo: "Nombre parecido", puntaje: Math.round(mejorP * 100) / 100 })
  }
  const usos = new Map<number, number>()
  for (const p of prelim.values()) if (p.certeza === "seguro") usos.set(p.candidato.codigo, (usos.get(p.candidato.codigo) || 0) + 1)
  for (const [id, p] of prelim)
    if (p.certeza === "seguro" && (usos.get(p.candidato.codigo) || 0) > 1)
      prelim.set(id, { ...p, certeza: "dudoso", motivo: `${p.motivo}, pero otra fórmula cae en el mismo artículo` })
  return prelim
}

// ---------------------------------------------------------------------------
// Proyectos ↔ obras
// ---------------------------------------------------------------------------

export type ObraNuestra = { id: string; name: string; client_id: string }
export type ProyectoZomatik = { codigo: number; numero: string; cliente_codigo: number | null; cliente_nombre?: string | null; obra: string | null }

/**
 * `clientePorCodigo`: el cliente nuestro vinculado a cada código de Zomatik. Sin cliente vinculado no hay
 * propuesta (primero se vincula el cliente).
 */
export function proponerProyectos(
  proyectos: ProyectoZomatik[],
  obras: ObraNuestra[],
  clientePorCodigo: Map<number, string>,
): Map<number, Propuesta<ObraNuestra>> {
  const out = new Map<number, Propuesta<ObraNuestra>>()
  for (const p of proyectos) {
    const cli = p.cliente_codigo != null ? clientePorCodigo.get(p.cliente_codigo) : undefined
    if (!cli) continue
    const delCliente = obras.filter((o) => o.client_id === cli)
    if (delCliente.length === 0) continue
    const k = nombreNormalizado(p.obra)
    if (k) {
      const iguales = delCliente.filter((o) => nombreNormalizado(o.name) === k)
      if (iguales.length === 1) {
        out.set(p.codigo, { candidato: iguales[0], certeza: "seguro", motivo: "Obra con el mismo nombre", puntaje: 1 })
        continue
      }
      let mejor: ObraNuestra | null = null
      let mejorP = 0
      for (const o of delCliente) {
        const s = parecidoNombres(p.obra, o.name)
        if (s > mejorP) {
          mejorP = s
          mejor = o
        }
      }
      if (mejor && mejorP >= 0.5) {
        out.set(p.codigo, { candidato: mejor, certeza: "dudoso", motivo: "Obra con nombre parecido", puntaje: Math.round(mejorP * 100) / 100 })
        continue
      }
    }
    if (delCliente.length === 1)
      out.set(p.codigo, { candidato: delCliente[0], certeza: "dudoso", motivo: "Es la única obra del cliente", puntaje: 0.5 })
  }
  return out
}

// ---------------------------------------------------------------------------
// Vincular desde el pedido (04/11/2026, docs/specs/2026-11-04-vincular-al-programar.md)
// Sugerencias livianas (CUIT, nombre y partes del código, sin el cruce por fechas) y la regla de qué no se vincula
// desde el cartel (decisión 6): artículo de otra planta o sin código de sistema, cliente genérico o inactivo, CUIT
// válido distinto. Eso lo resuelve un gerencial en Vínculos.
// ---------------------------------------------------------------------------

/** Cliente de la copia de Zomatik con lo que muestra el cartel (sin teléfono ni mail). */
export type ZomatikSug = { codigo: number; razon_social: string; cuit?: string | null; localidad?: string | null; remitos_12m?: number; ultimo_remito?: string | null; estado?: string | null }

/** Activo en Zomatik: sin estado, o un estado que diga "activo" (no "inactivo" ni "baja"). */
export function zomatikActivo(z: { estado?: string | null }): boolean {
  const e = String(z.estado ?? "").trim()
  if (!e) return true
  return /activ/i.test(e) && !/inactiv|baja/i.test(e)
}

export type SugerenciaCliente = {
  codigo: number
  razon_social: string
  cuit: string | null
  localidad: string | null
  remitos_12m: number
  ultimo_remito: string | null
  /** "CUIT igual", "nombre igual", "nombre parecido 78 %" */
  motivo: string
  /** El CUIT de los dos lados (válidos): igual, distinto; null si alguno falta o no es válido. Distinto = no se elige. */
  cuit_coincide: "igual" | "distinto" | null
  /** Ya es de otro cliente nuestro: se muestra, pero no se elige. */
  vinculado_a: { id: string; name: string } | null
}
export type DuplicadoDe = { id: string; name: string; zomatik_codigo: number; motivos: string[] }

/** CUIT de los dos lados: igual / distinto (los dos válidos) / null. */
export function compararCuit(nuestro: unknown, deZomatik: unknown): "igual" | "distinto" | null {
  const a = soloDigitos(nuestro)
  const b = soloDigitos(deZomatik)
  if (!cuitValido(a) || !cuitValido(b)) return null
  return a === b ? "igual" : "distinto"
}

/**
 * Sugerencias de cliente de Zomatik para un cliente nuestro sin vínculo. Candidatos: activos y no genéricos. Orden:
 * CUIT válido igual, nombre normalizado igual (razón social y alias), nombre parecido ≥ 0,5; desempate por remitos del
 * año y último remito. `duplicadoDe`: clientes nuestros que parecen el mismo y ya tienen código (caso «La Tercera»).
 */
export function sugerenciasCliente(cliente: NuestroB, zcli: ZomatikSug[], nuestros: NuestroB[], max = 5): { sugerencias: SugerenciaCliente[]; duplicadoDe: DuplicadoDe[] } {
  const nombres = [cliente.name, cliente.razon_social, ...(cliente.alias || [])].filter((x): x is string => !!x && !!String(x).trim())
  const claves = new Set(nombres.map(nombreNormalizado).filter(Boolean))
  const dCli = soloDigitos(cliente.cuit)
  const cuitOk = cuitValido(dCli)
  const vinculadoA = new Map<number, { id: string; name: string }>()
  for (const c of nuestros) if (c.zomatik_codigo != null && c.id !== cliente.id) vinculadoA.set(c.zomatik_codigo, { id: c.id, name: c.name })
  const cands: { s: SugerenciaCliente; rango: number; pct: number }[] = []
  for (const z of zcli) {
    if (!zomatikActivo(z) || esGenerico(z.razon_social)) continue
    let rango = -1
    let pct = 0
    let motivo = ""
    if (cuitOk && soloDigitos(z.cuit) === dCli) {
      rango = 0
      pct = 1
      motivo = "CUIT igual"
    } else if (claves.has(nombreNormalizado(z.razon_social))) {
      rango = 1
      pct = 1
      motivo = "nombre igual"
    } else {
      for (const n of nombres) pct = Math.max(pct, parecidoNombres(n, z.razon_social))
      if (pct >= 0.5) {
        rango = 2
        motivo = `nombre parecido ${Math.round(pct * 100)} %`
      }
    }
    if (rango < 0) continue
    cands.push({
      rango,
      pct,
      s: {
        codigo: z.codigo, razon_social: z.razon_social, cuit: z.cuit || null, localidad: z.localidad || null, remitos_12m: z.remitos_12m || 0,
        ultimo_remito: z.ultimo_remito || null, motivo, cuit_coincide: compararCuit(cliente.cuit, z.cuit), vinculado_a: vinculadoA.get(z.codigo) || null,
      },
    })
  }
  cands.sort((a, b) => a.rango - b.rango || b.pct - a.pct || b.s.remitos_12m - a.s.remitos_12m || String(b.s.ultimo_remito || "").localeCompare(String(a.s.ultimo_remito || "")))
  // Duplicados nuestros que ya tienen código: se compara de a pares con este (no todos contra todos)
  const duplicadoDe: DuplicadoDe[] = []
  for (const c of nuestros) {
    if (c.id === cliente.id || c.zomatik_codigo == null) continue
    const par = detectarDuplicados([cliente, c])[0]
    if (par) duplicadoDe.push({ id: c.id, name: c.name, zomatik_codigo: c.zomatik_codigo, motivos: par.motivos })
  }
  return { sugerencias: cands.slice(0, max).map((x) => x.s), duplicadoDe }
}

export type ArticuloSug = { codigo: number; nombre: string; linea?: string | null; codigo_sistema?: number | null }
export type SugerenciaArticulo = { codigo: number; nombre: string; motivo: string; otra_planta: boolean; sin_codigo_sistema: boolean }

const NOMBRE_SUFIJO: Record<"(HUD)" | "(CAN)", string> = { "(HUD)": "Hudson", "(CAN)": "Canning" }

/** La planta del artículo si es otra que la de la fórmula ("Hudson"); null si es la misma o no lleva sufijo. */
export function otraPlantaDelArticulo(nombreArticulo: string, plantaNombre: string): string | null {
  const pa = plantaDelArticulo(nombreArticulo)
  const suf = sufijoPlanta(plantaNombre)
  return pa && suf && pa !== suf ? NOMBRE_SUFIJO[pa] : null
}

const unir = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`)

/**
 * Sugerencias de artículo de Zomatik para una fórmula sin vínculo. Con el código leído (`interpretarNombre`): solo la
 * misma resistencia; primero la misma planta (o sin sufijo), después la misma piedra, el asentamiento más cercano, el
 * mismo método C/B y el mismo comentario. Si el código no se lee (RDC, cordones…), la regla de tokens de
 * `proponerFormulas`. El nombre igual (o igual por las reglas) va primero. Sin servicios.
 */
export function sugerenciasArticulo(formula: FormulaNuestra, plantaNombre: string, articulos: ArticuloSug[], max = 6): SugerenciaArticulo[] {
  const arts = articulos.filter(deHormigon)
  const f: FormulaNuestra = { ...formula, planta: plantaNombre || formula.planta }
  const iguales = new Set([clave(f.name), ...(f.code ? [clave(f.code)] : []), ...variantesFormula(f), ...(f.code ? variantesFormula({ ...f, name: f.code }) : [])])
  const p = interpretarNombre(f.code || f.name) || interpretarNombre(f.name)
  const tf = tokensFormula(f.code || f.name)
  const salida = (a: ArticuloSug, motivo: string): SugerenciaArticulo => ({
    codigo: a.codigo, nombre: a.nombre, motivo, otra_planta: !!otraPlantaDelArticulo(a.nombre, plantaNombre), sin_codigo_sistema: !a.codigo_sistema,
  })
  const filas: { s: SugerenciaArticulo; k: number[] }[] = []
  for (const a of arts) {
    const otra = otraPlantaDelArticulo(a.nombre, plantaNombre) ? 1 : 0
    if (iguales.has(clave(a.nombre))) {
      filas.push({ s: salida(a, "nombre igual"), k: [0, otra, 0, 0, 0, 0, a.codigo_sistema ? 0 : 1] })
      continue
    }
    if (p) {
      const pa = interpretarNombre(a.nombre)
      if (!pa || pa.resistencia !== p.resistencia) continue
      const igual: string[] = ["resistencia"]
      const distinto: string[] = []
      const piedra = pa.piedra === p.piedra ? 0 : 1
      if (!piedra) igual.push("piedra")
      else distinto.push(`piedra ${pa.piedra || "sin dato"} en vez de ${p.piedra || "sin dato"}`)
      const asent = p.asentamiento == null || pa.asentamiento == null ? (p.asentamiento == pa.asentamiento ? 0 : 99) : Math.abs(pa.asentamiento - p.asentamiento)
      if (asent === 0 && p.asentamiento != null) igual.push("asentamiento")
      else if (p.asentamiento != null) distinto.push(`asentamiento ${pa.asentamiento ?? "sin dato"} en vez de ${p.asentamiento}`)
      const metodo = p.metodo && pa.metodo !== p.metodo ? 1 : 0
      if (p.metodo && !metodo) igual.push("método")
      else if (p.metodo) distinto.push(`${pa.metodo || "sin C/B"} en vez de ${p.metodo}`)
      const coment = pa.comentario === p.comentario ? 0 : 1
      if (coment) distinto.push(pa.comentario ? `con ${pa.comentario}` : `sin ${p.comentario}`)
      const motivo = `misma ${unir(igual)}${distinto.length ? `, ${distinto.join(", ")}` : ""}`
      // Último desempate (después de los 5 de la spec): el que se puede usar en la NP antes que el que no tiene código de sistema
      filas.push({ s: salida(a, motivo), k: [1, otra, piedra, asent, metodo, coment, a.codigo_sistema ? 0 : 1] })
      continue
    }
    // Plan B (RDC, cordones, recuperado…): mismo primer token y la mitad de los números
    if (!tf.length) continue
    const ta = tokensFormula(a.nombre)
    if (ta[0] !== tf[0]) continue
    const pct = tf.filter((t) => ta.includes(t)).length / Math.max(tf.length, 1)
    if (pct < 0.5) continue
    filas.push({ s: salida(a, `nombre parecido ${Math.round(pct * 100)} %`), k: [1, otra, Math.round((1 - pct) * 100), 0, 0, 0, a.codigo_sistema ? 0 : 1] })
  }
  filas.sort((x, y) => {
    for (let i = 0; i < x.k.length; i++) if (x.k[i] !== y.k[i]) return x.k[i] - y.k[i]
    return x.s.nombre.localeCompare(y.s.nombre)
  })
  return filas.slice(0, max).map((x) => x.s)
}

/**
 * Regla de la decisión 6: ¿se puede vincular desde el pedido? null = sí; si no, el texto del error. Lo demás (que ya
 * sea de otro, que alguien lo haya vinculado en el medio) lo controla el servidor contra la base.
 */
export function controlVinculoPedido(
  o:
    | { tipo: "cliente"; cuitNuestro: string | null | undefined; zomatik: { razon_social: string; cuit?: string | null; estado?: string | null } }
    | { tipo: "formula"; plantaNombre: string; articulo: { nombre: string; linea?: string | null; codigo_sistema?: number | null } },
): string | null {
  if (o.tipo === "cliente") {
    if (esGenerico(o.zomatik.razon_social)) return "Es un cliente genérico de Zomatik: no se vincula."
    if (!zomatikActivo(o.zomatik)) return "Ese cliente está inactivo en Zomatik: lo vincula un gerencial en Vínculos."
    if (compararCuit(o.cuitNuestro, o.zomatik.cuit) === "distinto")
      return `El CUIT no coincide (acá ${formatearCuit(o.cuitNuestro)}, en Zomatik ${formatearCuit(o.zomatik.cuit)}): lo vincula un gerencial en Vínculos.`
    return null
  }
  if (!deHormigon({ codigo: 0, nombre: o.articulo.nombre, linea: o.articulo.linea })) return "Es un servicio, no un hormigón: no se vincula con una fórmula."
  const otra = otraPlantaDelArticulo(o.articulo.nombre, o.plantaNombre)
  if (otra) return `Es un artículo de ${otra}: desde el pedido no se vincula.`
  if (!o.articulo.codigo_sistema) return "Ese artículo no tiene código de sistema en Zomatik: no se puede usar en la NP."
  return null
}
