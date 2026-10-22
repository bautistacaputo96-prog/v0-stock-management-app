/**
 * Nombre automático de las fórmulas (docs/migracion-loop/formulas-rediseno.md, 22/10/2026).
 *
 * Formato (el mismo que los artículos de Zomatik): `H30-620-15 B (CAN) PELQUE`
 *   resistencia - piedra - asentamiento  método  (planta)  comentario
 * - piedra: 620, 612 o 1030 (opcional); asentamiento en cm (opcional); método C común o B bombeable (opcional);
 * - planta: (CAN) Canning, (HUD) Hudson: sale sola de la planta;
 * - comentario opcional, en mayúsculas (PELQUE, GUN).
 * Lo que no encaja (RDC, GUN, cordones…) queda con un "nombre libre", que solo puede poner un gerencial.
 * Sin React ni Supabase: se prueba con `npm run test:formulas`.
 */

export type Piedra = "620" | "612" | "1030"
export const PIEDRAS: Piedra[] = ["620", "612", "1030"]
export const RESISTENCIAS_NOMBRE = ["H4", "H8", "H13", "H17", "H21", "H25", "H30", "H35", "H40", "H45", "H50"]

export type PartesNombre = {
  resistencia: string
  piedra: Piedra | null
  asentamiento: number | null
  metodo: "B" | "C" | null
  comentario: string
}

export const PARTES_VACIAS: PartesNombre = { resistencia: "", piedra: null, asentamiento: null, metodo: null, comentario: "" }

const quitarTildes = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "")

/** "(CAN)" Canning, "(HUD)" Hudson; otra planta: sus tres primeras letras. */
export function sufijoDePlanta(nombrePlanta: string | null | undefined): string {
  const n = quitarTildes(String(nombrePlanta || "")).trim().toUpperCase()
  if (!n) return ""
  if (n.startsWith("CANNING")) return "(CAN)"
  if (n.startsWith("HUDSON")) return "(HUD)"
  return `(${n.replace(/[^A-Z]/g, "").slice(0, 3)})`
}

const RE_SUFIJO = /\s*\((CAN|HUD)\)\s*/gi

/** Saca la etiqueta de planta, esté donde esté: "H25-620-15 B (CAN) PELQUE" → "H25-620-15 B PELQUE". */
export function sinSufijoPlanta(code: string): string {
  return String(code ?? "").replace(RE_SUFIJO, " ").replace(/\s+/g, " ").trim()
}

/** Mayúsculas, sin tildes, solo letras, números, espacio, / . - (máx. 20). */
export function limpiarComentario(t: string | null | undefined): string {
  return quitarTildes(String(t ?? "").replace(/ñ/gi, "\u0000"))
    .replace(/\u0000/g, "Ñ")
    .toUpperCase()
    .replace(/[^A-Z0-9Ñ /.\-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20)
}

export function armarNombre(p: PartesNombre, nombrePlanta: string | null | undefined): string {
  const r = String(p.resistencia || "").trim().toUpperCase()
  if (!r) return ""
  const seg = [r]
  if (p.piedra) seg.push(p.piedra)
  if (p.asentamiento != null && Number.isFinite(p.asentamiento)) seg.push(String(Math.round(p.asentamiento)))
  let s = seg.join("-")
  if (p.metodo) s += ` ${p.metodo}`
  const suf = sufijoDePlanta(nombrePlanta)
  if (suf) s += ` ${suf}`
  const c = limpiarComentario(p.comentario)
  if (c) s += ` ${c}`
  return s
}

/** Qué le falta a las partes para armar el nombre (null = está bien). */
export function validarPartes(p: PartesNombre): string | null {
  if (!/^H\d{1,2}$/i.test(String(p.resistencia || "").trim())) return "Elegí la resistencia"
  if (p.asentamiento != null && !(Number.isInteger(p.asentamiento) && p.asentamiento >= 1 && p.asentamiento <= 30))
    return "El asentamiento va en cm, entre 1 y 30"
  return null
}

const PIEDRA_DE: Record<string, Piedra> = { "620": "620", "6/20": "620", "612": "612", "6/12": "612", "1030": "1030", "10/30": "1030" }

/**
 * Lee un código (viejo o nuevo) y devuelve sus partes. null si no encaja en el formato (RDC, GUN, cordones,
 * recuperado…): esas quedan con nombre libre.
 */
export function interpretarNombre(code: string | null | undefined): PartesNombre | null {
  const s = sinSufijoPlanta(String(code ?? "")).toUpperCase()
  const m = s.match(/^(H\d{1,2})-(620|612|1030|6\/20|6\/12|10\/30)(?:-(\d{1,2}))?(?:\s+([BC]))?(?:\s+(.+))?$/)
  if (!m) return null
  const asent = m[3] != null ? Number(m[3]) : null
  if (asent != null && !(asent >= 1 && asent <= 30)) return null
  // comentario: lo que queda (el formato viejo de etiqueta era "H30-620-10 C - Pirelli")
  const comentario = limpiarComentario((m[5] || "").replace(/^-\s*/, ""))
  return { resistencia: `H${Number(m[1].slice(1))}`, piedra: PIEDRA_DE[m[2]], asentamiento: asent, metodo: (m[4] as "B" | "C") || null, comentario }
}

/** Nombre libre con la etiqueta de la planta en su lugar ("RDC-200" en Hudson → "RDC-200 (HUD)"). */
export function libreConPlanta(code: string, nombrePlanta: string | null | undefined): string {
  const base = sinSufijoPlanta(code)
  const suf = sufijoDePlanta(nombrePlanta)
  return suf ? `${base} ${suf}` : base
}

/** El mismo nombre en otra planta: se rearma con las partes; si es libre, se cambia la etiqueta de planta. */
export function nombreEnOtraPlanta(code: string, plantaDestino: string | null | undefined): string {
  const p = interpretarNombre(code)
  return p ? armarNombre(p, plantaDestino) : libreConPlanta(code, plantaDestino)
}

/** Clave para comparar nombres entre plantas: sin la etiqueta de planta, mayúsculas y piedra sin barra. */
export function claveNombre(code: string): string {
  const p = interpretarNombre(code)
  if (p) return armarNombre(p, null)
  return sinSufijoPlanta(code).toUpperCase()
}

// ───────────────────────────── Normalizar nombres ─────────────────────────────

export type EstadoRenombre = "igual" | "renombrar" | "revisar"

export type Renombre = {
  id: string
  plant_id: string
  planta: string
  actual: string
  propuesto: string
  estado: EstadoRenombre
  motivo: string | null
}

/**
 * "actual → propuesto" para todas las fórmulas. Las que no se pueden leer, o que quedarían con el mismo nombre que
 * otra de su planta, van a "revisar" (con una sugerencia que solo corrige la etiqueta de planta).
 */
export function proponerRenombres(
  formulas: { id: string; code: string; name?: string | null; plant_id: string }[],
  plantas: { id: string; name: string }[],
): Renombre[] {
  const nombrePlanta = new Map(plantas.map((p) => [p.id, p.name]))
  const filas: Renombre[] = formulas.map((f) => {
    const planta = nombrePlanta.get(f.plant_id) || ""
    const p = interpretarNombre(f.code)
    if (!p) {
      return { id: f.id, plant_id: f.plant_id, planta, actual: f.code, propuesto: libreConPlanta(f.code, planta), estado: "revisar", motivo: "No encaja en el formato: nombre libre" }
    }
    const propuesto = armarNombre(p, planta)
    const igual = propuesto === f.code && (f.name == null || f.name === f.code)
    return { id: f.id, plant_id: f.plant_id, planta, actual: f.code, propuesto, estado: igual ? "igual" : "renombrar", motivo: null }
  })
  // Choques dentro de la planta: dos que quedarían iguales, o una que quedaría igual a otra que no cambia
  const porPlanta = new Map<string, Map<string, Renombre[]>>()
  for (const r of filas) {
    const m = porPlanta.get(r.plant_id) || new Map<string, Renombre[]>()
    const k = r.propuesto.toUpperCase()
    m.set(k, [...(m.get(k) || []), r])
    porPlanta.set(r.plant_id, m)
  }
  for (const m of porPlanta.values()) {
    for (const grupo of m.values()) {
      if (grupo.length < 2) continue
      for (const r of grupo) {
        if (r.estado === "igual") continue
        const otras = grupo.filter((x) => x.id !== r.id).map((x) => x.actual)
        r.estado = "revisar"
        r.motivo = `Quedaría igual a ${otras.join(", ")}`
      }
    }
  }
  const orden: Record<EstadoRenombre, number> = { renombrar: 0, revisar: 1, igual: 2 }
  return filas.sort((a, b) => orden[a.estado] - orden[b.estado] || a.planta.localeCompare(b.planta) || a.actual.localeCompare(b.actual, "es", { numeric: true }))
}
