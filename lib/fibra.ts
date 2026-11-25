/**
 * Fibra (MACRO FIBRA): el tope de la dosificación y los kg. Sin imports: lo usan el pedido, el plantista, el historial
 * y el robot de la NP (docs/specs/2026-11-25-fibra-en-np.md).
 *
 * Tope (Bautista, 25/11/2026): la macro fibra se dosifica a unos pocos kg por m³. En producción había pedidos con
 * 800 kg/m³ (6.400 kg por camión): eso es un error de carga. Arriba del tope no se deja guardar y la NP nunca lo manda.
 */

/** Más de esto por m³ es un error de carga (la dosificación real es de unos pocos kg/m³). */
export const FIBRA_MAX_KG_M3 = 20

/** Un número escrito entero: "0,8", "0.8", "12" (no "0.8abc", "1e3" ni "-1"). */
const NUMERO = /^\d+(?:[.,]\d+)?$/
const n = (v: unknown) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN
  const t = String(v ?? "").trim()
  return NUMERO.test(t) ? Number(t.replace(",", ".")) : NaN
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
  if (!Number.isFinite(x) || x < 0) return "La fibra tiene que ser un número de kg por m³ (por ejemplo 0,8)."
  if (x > FIBRA_MAX_KG_M3) {
    // 800 (gramos) en vez de 0,8 (kg): el error más común (25/11)
    const kg = x / 1000
    const sugerencia = kg <= FIBRA_MAX_KG_M3 ? ` ¿Quisiste poner ${textoKg(kg)} kg/m³? (${textoKg(x)} gramos = ${textoKg(kg)} kg)` : ""
    return `${textoKg(x)} kg de fibra por m³ es demasiado: la macro fibra va de a pocos kg por m³ (como mucho ${FIBRA_MAX_KG_M3}). Revisá el número: es en kg y por m³, no por camión ni por pedido.${sugerencia}`
  }
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

/** ¿Es el material de la fibra? Por el tipo del material (`materials.tipo = 'fibra'`), como `registrar_despacho`. */
export function esMaterialFibra(m: { tipo?: string | null } | null | undefined): boolean {
  return m?.tipo === "fibra"
}

/** kg de fibra de los materiales de un despacho (dispatch_materials con su material). */
export function kgFibraDeMateriales(ms: { quantity?: number | string | null; materials?: { tipo?: string | null } | null }[] | null | undefined): number {
  return Math.round((ms || []).filter((m) => esMaterialFibra(m.materials)).reduce((t, m) => t + (Number(m.quantity) || 0), 0) * 1000) / 1000
}

/**
 * La fibra que tiene que quedar en una NP (spec 2026-11-25, 3.5): lo cargado de verdad en los camiones del pedido que le
 * tocan a esa NP, más la dosificación del pedido de ahora por los m³ que todavía faltan despachar contra ella. Nunca
 * menos de lo ya remitido. Al generar (nada despachado) da kg/m³ × m³; al finalizar (nada por despachar) da lo real; si
 * se sacó la fibra del pedido, lo real (0 si no se cargó).
 *   `fibraPedido` / `m3Pedido`: la fibra y los m³ despachados de TODO el pedido; `m3Despachado`: los que van contra
 *   esta NP (la fibra real se reparte en esa proporción).
 */
export function objetivoFibra(o: { kgM3: number; m3Objetivo: number; m3Despachado: number; fibraPedido: number; m3Pedido: number; fibraRemitida: number }): number {
  const parte = o.m3Pedido > 0 ? Math.min(1, Math.max(0, o.m3Despachado) / o.m3Pedido) : 0
  const real = Math.max(0, o.fibraPedido) * parte
  const resto = Math.max(0, o.m3Objetivo - Math.max(0, o.m3Despachado))
  const obj = real + Math.max(0, o.kgM3) * resto
  return Math.round(Math.max(obj, Math.max(0, o.fibraRemitida)) * 1000) / 1000
}

/** Lo que se le avisa a quien despacha cuando el pedido lleva fibra y su NP no la tiene (Bautista, 25/11). */
export const MSJ_NP_SIN_FIBRA = "La NP de este pedido no tiene la fibra: está mal, avisale a Juan / Programación. Se puede despachar igual."

/**
 * ¿Mostrar el aviso de la NP sin fibra? Con la llave de la fibra de la planta, un pedido con fibra y alguna NP suya ya
 * en Zomatik sin fibra (NP con saldo, NP de antes de prender la llave o que no se pudo editar).
 */
export function npSinFibra(estado: { fibra?: boolean; nps?: { estado: string; fibra_kg?: number | null }[] } | null | undefined, kgM3: number): boolean {
  if (!estado?.fibra || !(Number(kgM3) > 0)) return false
  return (estado.nps || []).some((x) => x.estado === "ok" && !(Number(x.fibra_kg) > 0))
}
