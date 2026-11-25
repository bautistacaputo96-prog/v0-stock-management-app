/**
 * Fibra (MACRO FIBRA): el tope de la dosificación y los kg. Sin imports: lo usan el pedido, el plantista, el historial
 * y el robot de la NP (docs/specs/2026-11-25-fibra-en-np.md).
 *
 * Tope (Bautista, 25/11/2026): la macro fibra se dosifica a unos pocos kg por m³. En producción había pedidos con
 * 800 kg/m³ (6.400 kg por camión): eso es un error de carga. Arriba del tope no se deja guardar y la NP nunca lo manda.
 */

/** Más de esto por m³ es un error de carga (la dosificación real es de unos pocos kg/m³). */
export const FIBRA_MAX_KG_M3 = 20

const n = (v: unknown) => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."))
  return Number.isFinite(x) ? x : NaN
}

/** "2,5" / 2.5 / "" → número (0 si está vacío o no se entiende). */
export function fibraKgM3(v: unknown): number {
  const x = n(v)
  return x > 0 ? x : 0
}

/** Qué decirle a quien carga la fibra (o null si está bien). Vacío o 0 = no lleva fibra: está bien. */
export function errorFibraKgM3(v: unknown): string | null {
  const t = String(v ?? "").trim()
  if (!t) return null
  const x = n(t)
  if (!Number.isFinite(x) || x < 0) return "La fibra tiene que ser un número de kg por m³ (por ejemplo 3)."
  if (x > FIBRA_MAX_KG_M3)
    return `${textoKg(x)} kg de fibra por m³ es demasiado: la macro fibra va de a pocos kg por m³ (como mucho ${FIBRA_MAX_KG_M3}). Revisá el número: es por m³, no por camión ni por pedido.`
  return null
}

/** ¿Es una dosificación que se puede mandar a Zomatik? Mayor a 0 y hasta el tope. */
export function fibraValida(kgM3: unknown): boolean {
  const x = n(kgM3)
  return x > 0 && x <= FIBRA_MAX_KG_M3
}

/** kg de fibra para tantos m³ (redondeado a 3 decimales, como las cantidades de Zomatik). */
export function kgDeFibra(kgM3: number, m3: number): number {
  return Math.round(Number(kgM3) * Number(m3) * 1000) / 1000
}

/** 2.5 → "2,5" */
export function textoKg(x: number): string {
  return (Math.round(Number(x) * 1000) / 1000).toLocaleString("es-AR", { maximumFractionDigits: 3 })
}

// ── Bolsitas (Bautista, 25/11/2026) ──
// En el sistema la fibra se carga en kg por m³; en planta se cuenta en bolsitas. La macro fibra viene en bolsitas de
// 800 g. Redondeo: el número exacto, con hasta 2 decimales ("8 bolsitas", "7,5 bolsitas"), sin redondear para arriba:
// así el plantista ve si hay que abrir una bolsita (y quien programa ve que la dosificación no da bolsitas enteras).

/** kg de una bolsita de macro fibra. */
export const BOLSITA_FIBRA_KG = 0.8

/** Cuántas bolsitas son esos kg (exacto, hasta 2 decimales). */
export function bolsitasDe(kg: number, bolsita: number = BOLSITA_FIBRA_KG): number {
  if (!(kg > 0) || !(bolsita > 0)) return 0
  return Math.round((kg / bolsita) * 100) / 100
}

/** "8 bolsitas" · "1 bolsita" · "7,5 bolsitas" */
export function textoBolsitas(kg: number, bolsita: number = BOLSITA_FIBRA_KG): string {
  const b = bolsitasDe(kg, bolsita)
  return `${b.toLocaleString("es-AR", { maximumFractionDigits: 2 })} ${b === 1 ? "bolsita" : "bolsitas"}`
}

/** "6,4 kg = 8 bolsitas" para kg/m³ × m³ (vacío si no lleva fibra). */
export function textoFibraCamion(kgM3: number, m3: number): string {
  const kg = kgDeFibra(kgM3, m3)
  return kg > 0 ? `${textoKg(kg)} kg = ${textoBolsitas(kg)}` : ""
}

/** La fibra que tiene que quedar en una NP que pasa de `m3Np` a `objetivo` m³: en la misma proporción que tiene hoy. */
export function fibraObjetivo(kgNp: number, m3Np: number, objetivo: number): number {
  if (!(kgNp > 0) || !(m3Np > 0) || !(objetivo > 0)) return 0
  return Math.round(((Number(kgNp) * Number(objetivo)) / Number(m3Np)) * 1000) / 1000
}
