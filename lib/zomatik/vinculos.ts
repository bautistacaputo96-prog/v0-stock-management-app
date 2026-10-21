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
function deHormigon(a: ArticuloZomatik) {
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
