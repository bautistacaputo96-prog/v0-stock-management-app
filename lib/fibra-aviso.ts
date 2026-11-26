/**
 * Aviso del pedido sin fibra (Bautista, 26/11/2026): al guardar en Programación un pedido SIN fibra, si los últimos
 * pedidos de esa obra vinieron todos con fibra, se pregunta antes de guardar (es fácil olvidarse de cargarla).
 *   - Se miran los últimos 5 pedidos de la misma obra (o, sin obra, del mismo cliente con la misma fórmula), no
 *     cancelados y sin contar el que se está editando, del más nuevo al más viejo (fecha programada y, si empata,
 *     fecha de carga). Las dos plantas cuentan igual: es la misma obra.
 *   - Se avisa si son al menos 2 y TODOS llevaron fibra. Si alguno fue sin fibra, no se avisa.
 *   - kg/m³ sugerido: el más repetido entre ellos (empate: el del pedido más reciente).
 * Sin base ni red: la consulta la hace el formulario (components/dispatch-scheduling.tsx) y, si falla, guarda igual.
 */
import { fibraKgM3, textoBolsitas, textoKg } from "@/lib/fibra"

/** Cuántos pedidos anteriores se miran. */
export const FIBRA_AVISO_ULTIMOS = 5
/** Con menos pedidos anteriores que esto no se avisa (uno solo puede ser casualidad). */
export const FIBRA_AVISO_MINIMO = 2

export type PedidoPrevioFibra = {
  id: string
  status?: string | null
  fiber_kg_per_m3?: number | string | null
  scheduled_arrival_time?: string | null
  created_at?: string | null
}

export type AvisoSinFibra = {
  /** Cuántos pedidos anteriores se miraron (todos con fibra). */
  cantidad: number
  /** kg/m³ que se propone cargar. */
  kgM3: number
  /** ¿Todos con la misma dosificación? */
  todosIguales: boolean
  /** «¿Estás seguro? Los últimos 5 pedidos de esta obra fueron con fibra (0,8 kg/m³ = 1 bolsita por m³). Este va sin fibra.» */
  texto: string
  /** «Agregar fibra (0,8 kg/m³)» */
  botonAgregar: string
}

const CANCELADOS = ["cancelled", "canceled", "cancelado"]
const fecha = (v: string | null | undefined) => {
  const t = Date.parse(String(v ?? ""))
  return Number.isFinite(t) ? t : -Infinity
}

/** Los últimos pedidos que cuentan: sin cancelados ni el que se edita, del más nuevo al más viejo. */
export function ultimosPedidosFibra(previos: PedidoPrevioFibra[] | null | undefined, excluirId?: string | null, n: number = FIBRA_AVISO_ULTIMOS): PedidoPrevioFibra[] {
  return (previos || [])
    .filter((p) => p && p.id !== excluirId && !CANCELADOS.includes(String(p.status || "").toLowerCase()))
    .sort((a, b) => fecha(b.scheduled_arrival_time) - fecha(a.scheduled_arrival_time) || fecha(b.created_at) - fecha(a.created_at))
    .slice(0, n)
}

/** El kg/m³ más repetido (empate: el que aparece primero, o sea el más reciente). `kgs` del más nuevo al más viejo. */
export function kgM3MasUsado(kgs: number[]): number {
  const cuenta = new Map<number, { n: number; primero: number }>()
  kgs.forEach((k, i) => {
    const c = cuenta.get(k)
    if (c) c.n++
    else cuenta.set(k, { n: 1, primero: i })
  })
  let mejor: { k: number; n: number; primero: number } | null = null
  for (const [k, c] of cuenta) if (!mejor || c.n > mejor.n || (c.n === mejor.n && c.primero < mejor.primero)) mejor = { k, ...c }
  return mejor ? mejor.k : 0
}

/**
 * ¿Preguntar antes de guardar? null = guardar sin preguntar (el pedido lleva fibra, no hay suficientes pedidos
 * anteriores o alguno fue sin fibra).
 *   `kgM3Actual`: lo escrito en el formulario; `porObra`: false si se buscó por cliente + fórmula (pedido sin obra).
 */
export function avisoPedidoSinFibra(o: {
  kgM3Actual: unknown
  previos: PedidoPrevioFibra[] | null | undefined
  excluirId?: string | null
  porObra?: boolean
}): AvisoSinFibra | null {
  if (fibraKgM3(o.kgM3Actual) > 0) return null
  const ultimos = ultimosPedidosFibra(o.previos, o.excluirId)
  if (ultimos.length < FIBRA_AVISO_MINIMO) return null
  const kgs = ultimos.map((p) => fibraKgM3(p.fiber_kg_per_m3))
  if (!kgs.every((k) => k > 0)) return null
  const kgM3 = kgM3MasUsado(kgs)
  const todosIguales = kgs.every((k) => k === kgM3)
  const de = o.porObra === false ? "de este cliente con esta fórmula" : "de esta obra"
  const dosis = `${todosIguales ? "" : "la más usada: "}${textoKg(kgM3)} kg/m³ = ${textoBolsitas(kgM3)} por m³`
  return {
    cantidad: ultimos.length,
    kgM3,
    todosIguales,
    texto: `¿Estás seguro? Los últimos ${ultimos.length} pedidos ${de} fueron con fibra (${dosis}). Este va sin fibra.`,
    botonAgregar: `Agregar fibra (${textoKg(kgM3)} kg/m³)`,
  }
}
