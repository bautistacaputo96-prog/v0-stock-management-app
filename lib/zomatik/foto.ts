/**
 * Zomatik Z0 · "Foto" de una lectura y las filas que se graban en las copias zomatik_*. Funciones puras (sin
 * red ni base): la lectura (lib/zomatik/lectura.ts) junta la foto en Zomatik y acá se arma qué se graba.
 * Nunca lleva precios ni montos.
 */
import {
  movimientosDeProyectos,
  resumenRemitosPorCliente,
  type Articulo,
  type ClienteListado,
  type FichaCliente,
  type Movimiento,
  type NpPendiente,
  type ProyectoListado,
  type RenglonRemito,
} from "@/lib/zomatik/parseo"

/** Lo que ya hay en la base antes de leer (para saber qué falta leer de a poco). */
export type Previo = {
  proyectos: { codigo: number; numero: string; fecha: string | null; estado: string; historia_leida_at: string | null; tipo: string | null }[]
  fichas: { codigo: number; ficha_leida_at: string | null }[]
}

export type Foto = {
  inicio: string
  hoy: string
  desde12: string
  clientes: ClienteListado[] | null
  articulos: Articulo[] | null
  renglones12: RenglonRemito[] | null
  proyectos: ProyectoListado[] | null
  /** Renglones de remito de años anteriores (solo de proyectos viejos) y para qué proyectos quedó completa. */
  historia: { renglones: RenglonRemito[]; completaPara: number[] }
  tipos: { codigo: number; tipo: "monto" | "cantidades"; m3: number | null }[]
  fichas: { codigo: number; ficha: FichaCliente; leida_at: string }[]
  npPendientes: NpPendiente[] | null
}

export const VENCE_FICHA_DIAS = 30

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** Hoy en Argentina (UTC−3), AAAA-MM-DD. */
export function hoyArgentina(ahora: number = Date.now()): string {
  return new Date(ahora - 3 * 3600_000).toISOString().slice(0, 10)
}

/**
 * Tramos de un año (o menos) para leer los remitos de antes de `desde12`, del más nuevo al más viejo, hasta
 * la fecha del proyecto abierto más viejo que todavía no tiene la historia leída.
 */
export function tramosHistoria(previo: Previo["proyectos"], abiertos: ProyectoListado[] | null, desde12: string): { desde: string; hasta: string }[] {
  const viejos = proyectosSinHistoria(previo, abiertos, desde12)
  if (viejos.length === 0) return []
  const desdeMin = viejos.map((p) => p.fecha as string).sort()[0]
  const out: { desde: string; hasta: string }[] = []
  let hasta = sumarDias(desde12, -1)
  while (hasta >= desdeMin) {
    const desde = sumarDias(hasta, -364) > desdeMin ? sumarDias(hasta, -364) : desdeMin
    out.push({ desde, hasta })
    hasta = sumarDias(desde, -1)
  }
  return out
}

/** Proyectos abiertos, más viejos que un año, a los que todavía no se les leyó la historia. */
export function proyectosSinHistoria(previo: Previo["proyectos"], abiertos: ProyectoListado[] | null, desde12: string) {
  const prev = new Map(previo.map((p) => [p.codigo, p]))
  const lista = abiertos ?? previo.filter((p) => p.estado === "abierto").map((p) => ({ codigo: p.codigo, fecha: p.fecha }))
  return lista.filter((p) => p.fecha && p.fecha < desde12 && !prev.get(p.codigo)?.historia_leida_at)
}

/** Proyectos abiertos que todavía no se sabe si son por monto o por cantidades. */
export function proyectosSinTipo(previo: Previo["proyectos"], abiertos: ProyectoListado[] | null): number[] {
  const prev = new Map(previo.map((p) => [p.codigo, p]))
  const lista = abiertos ?? previo.filter((p) => p.estado === "abierto")
  return lista
    .filter((p) => !prev.get(p.codigo)?.tipo)
    .sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")))
    .map((p) => p.codigo)
}

/**
 * Clientes cuya ficha hay que leer: con remitos en el último año (según esta lectura) y sin ficha o con la ficha
 * de hace más de 30 días. Primero los de remito más reciente.
 */
export function fichasPendientes(clientes: ClienteListado[] | null, renglones12: RenglonRemito[] | null, previo: Previo["fichas"], ahora: number = Date.now()): number[] {
  if (!clientes || !renglones12) return []
  const resumen = resumenRemitosPorCliente(renglones12)
  const titular = titularesPorNombre(clientes)
  const ficha = new Map(previo.map((p) => [p.codigo, p.ficha_leida_at]))
  const vence = ahora - VENCE_FICHA_DIAS * 86400_000
  const out: { codigo: number; ultimo: string }[] = []
  for (const [nombre, r] of resumen) {
    const codigo = titular.get(nombre)
    if (!codigo) continue
    const f = ficha.get(codigo)
    if (f && Date.parse(f) >= vence) continue
    out.push({ codigo, ultimo: r.ultimo || "" })
  }
  return out.sort((a, b) => b.ultimo.localeCompare(a.ultimo)).map((x) => x.codigo)
}

/** Si dos clientes de Zomatik tienen el mismo nombre, los remitos van al de pedido más reciente. */
export function titularesPorNombre(clientes: ClienteListado[]): Map<string, number> {
  const titular = new Map<string, number>()
  for (const c of [...clientes].sort((a, b) => String(b.ultimo_pedido || "").localeCompare(String(a.ultimo_pedido || ""))))
    if (c.nombre_norm && !titular.has(c.nombre_norm)) titular.set(c.nombre_norm, c.codigo)
  return titular
}

// ---------------------------------------------------------------------------
// Filas a grabar (todas las filas de cada lote con las mismas claves: PostgREST lo exige)
// ---------------------------------------------------------------------------

export function filasClientes(foto: Foto): Record<string, unknown>[] {
  if (!foto.clientes) return []
  const resumen = foto.renglones12 ? resumenRemitosPorCliente(foto.renglones12) : null
  const titular = titularesPorNombre(foto.clientes)
  return foto.clientes.map((c) => {
    const r = resumen && titular.get(c.nombre_norm) === c.codigo ? resumen.get(c.nombre_norm) : undefined
    return {
      ...c,
      ...(resumen ? { remitos_r_12m: r?.r ?? 0, remitos_x_12m: r?.x ?? 0, ultimo_remito: r?.ultimo ?? null } : {}),
      visto_at: foto.inicio,
      actualizado_at: foto.inicio,
    }
  })
}

export function filasFichas(foto: Foto): { codigo: number; valores: Record<string, unknown> }[] {
  return foto.fichas.map((f) => ({
    codigo: f.codigo,
    valores: {
      cuit: f.ficha.cuit || null,
      tipo_documento: f.ficha.tipo_documento || null,
      tipo_iva: f.ficha.tipo_iva || null,
      condicion_pago: f.ficha.condicion_pago || null,
      contacto: f.ficha.contacto || null,
      ficha_leida_at: f.leida_at,
    },
  }))
}

export function filasArticulos(foto: Foto): Record<string, unknown>[] {
  if (!foto.articulos) return []
  const unicos = [...new Map(foto.articulos.map((a) => [a.codigo, a])).values()]
  return unicos.map((a) => ({ codigo: a.codigo, nombre: a.nombre, linea: a.linea || null, visto_at: foto.inicio, actualizado_at: foto.inicio }))
}

export function filasProyectos(foto: Foto): Record<string, unknown>[] {
  if (!foto.proyectos) return []
  return foto.proyectos.map((p) => ({
    codigo: p.codigo,
    numero: p.numero,
    comprobante: p.comprobante || null,
    cliente_codigo: p.cliente_codigo,
    cliente_nombre: p.cliente_nombre || null,
    obra: p.obra,
    fecha: p.fecha,
    saldo_pct: p.saldo_pct,
    estado: "abierto",
    estado_zomatik: p.estado_zomatik || null,
    visto_at: foto.inicio,
    leido_at: foto.inicio,
  }))
}

/** Movimientos del año y de la historia, de los proyectos conocidos (los de esta lectura y los de antes). */
export function filasMovimientos(foto: Foto, numerosConocidos: Iterable<string>, lineaDe: (codigo: number) => string | undefined): { delAnio: Movimiento[]; historia: Movimiento[] } {
  const numeros = new Set<string>(numerosConocidos)
  for (const p of foto.proyectos || []) numeros.add(p.numero)
  return {
    delAnio: foto.renglones12 ? movimientosDeProyectos(foto.renglones12, numeros, lineaDe) : [],
    historia: movimientosDeProyectos(foto.historia.renglones, numeros, lineaDe),
  }
}

/** Remitido y última entrega (las dos solo con hormigón) por proyecto, a partir de todos los movimientos guardados. */
export function totalesPorProyecto(movs: { proyecto_numero: string; fecha: string; m3: number | string; es_hormigon: boolean }[]): Map<string, { m3: number; ultima: string | null }> {
  const tot = new Map<string, { m3: number; ultima: string | null }>()
  for (const m of movs) {
    const t = tot.get(m.proyecto_numero) || { m3: 0, ultima: null }
    // Solo hormigón: un renglón de bombeo o servicio no es una entrega de material
    if (m.es_hormigon) {
      t.m3 = Math.round((t.m3 + (Number(m.m3) || 0)) * 1000) / 1000
      if (!t.ultima || m.fecha > t.ultima) t.ultima = m.fecha
    }
    tot.set(m.proyecto_numero, t)
  }
  return tot
}

/**
 * ¿Se pueden sacar los movimientos del año que esta lectura ya no trajo (remitos anulados)? Solo si la lectura
 * no cayó mucho respecto de lo guardado: con 10 o más guardados, hace falta al menos el 70 %. Si no, puede ser un
 * export cortado o un cambio de formato, y es mejor no borrar nada.
 */
export function puedeBorrarViejos(nuevos: number, guardados: number): boolean {
  if (nuevos <= 0) return false
  if (guardados < 10) return true
  return nuevos >= guardados * 0.7
}
