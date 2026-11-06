/**
 * Ingresos de materia prima desde Zomatik · el plan de cada pasada. Funciones puras: sin red, sin base y sin React.
 * Se prueban con `npm run test:ingresos-zomatik`. Especificación: docs/specs/2026-11-05-ingresos-mp-desde-zomatik.md
 * (con las respuestas de Bautista del 05/11, que mandan) y la ficha docs/ingresos-mp-zomatik.md.
 *
 * Entra: los renglones de la copia de Zomatik (zomatik_remitos_compra) de los días leídos enteros en esta pasada, los
 * vínculos ya guardados (zomatik_ingresos_mp), los ingresos cargados a mano desde F − 10 días y los maestros.
 * Sale: la lista de acciones que aplica `mp_zomatik_aplicar` en la base (altas, emparejados, correcciones,
 * anulaciones, cambios de planta, pendientes). Correr el plan sobre lo ya aplicado da 0 acciones.
 *
 * El stock nunca lo toca este archivo: el alta es un INSERT (lo suma el trigger) y las correcciones van con asiento
 * `correccion_ingreso` dentro de la función de la base.
 */
import {
  claveMaterial,
  ddmm,
  diasEntre,
  enToneladas,
  materialZomatik,
  mismoProveedor,
  mismoProveedorPorNombre,
  nombreMaterial,
  normalizarRemito,
  sinPrefijoRemito,
  sumarDias,
  toneladas,
  PAREO_FECHA_DIAS,
} from "@/lib/control-ingresos/cruce"
import { tokensNombre } from "@/lib/zomatik/parseo"

// ---------------------------------------------------------------------------
// Parámetros
// ---------------------------------------------------------------------------

/** Tipos de material que entran desde Zomatik (Bautista, 05/11: también aditivos y fibra). */
export const TIPOS_IMPORTABLES = ["arido_fino", "arido_grueso", "cemento", "aditivo_planta", "aditivo_obra", "fibra"]
/** Áridos y cemento (los que se cargan en toneladas). */
export const TIPOS_TONELADAS = ["arido_fino", "arido_grueso", "cemento"]
/** Toneladas iguales: ±0,02 t por remito. */
export const TOL_KG_TONELADAS = 20
/** Un renglón que falta en Zomatik se anula recién si sigue faltando 2 h después (D5). */
export const ESPERA_ANULAR_MS = 2 * 3600_000
/** Candidatos manuales: desde F − 10 días (el borde: un camión cargado el día antes de F). */
export const MANUALES_ANTES_DE_F_DIAS = 10
/** Mismo número, mismo material y planta: hasta ±10 días es el mismo camión. */
export const EMPAREJAR_DIAS = 10
/** Rangos por renglón. Fuera de rango: "Cantidad rara". */
export const RANGO_T = { min: 1, max: 60 }
export const RANGO_LITROS = { min: 1, max: 40_000 }
export const RANGO_KG = { min: 1, max: 30_000 }
/** Un tacho de aditivo = 1000 litros (Bautista, 05/11). */
export const LITROS_POR_TACHO = 1000

// ---------------------------------------------------------------------------
// Interruptor y densidades (integraciones)
// ---------------------------------------------------------------------------

export type Modo = "apagado" | "sombra" | "real"
export type Interruptor = { modo: Modo; desde: string | null }
/** Clave de `integraciones`: `{"modo":"sombra"|"real","desde":"AAAA-MM-DD"}`. Sin la fila o mal escrita: apagado. */
export const CLAVE_INTERRUPTOR = "mp_ingresos_zomatik"
/** Clave de `integraciones`: densidad (kg/L) de cada aditivo que en Rebucret está en kg: `{"<material_id>": 1.2}`. */
export const CLAVE_DENSIDADES = "mp_densidades"

const FECHA = /^\d{4}-\d{2}-\d{2}$/

export function leerInterruptor(valor: unknown): Interruptor {
  try {
    const v = typeof valor === "string" ? JSON.parse(valor) : valor
    const modo = (v as any)?.modo
    const desde = (v as any)?.desde
    if ((modo === "sombra" || modo === "real") && typeof desde === "string" && FECHA.test(desde)) return { modo, desde }
  } catch {
    // mal escrito: apagado
  }
  return { modo: "apagado", desde: null }
}

/** ¿Ya entra solo desde Zomatik? (modo real y hoy ≥ F). Recién ahí se restringe la carga manual. */
export const importacionActiva = (i: Interruptor, hoy: string) => i.modo === "real" && !!i.desde && hoy >= i.desde

export function leerDensidades(valor: unknown): Record<string, number> {
  try {
    const v = typeof valor === "string" ? JSON.parse(valor) : valor
    const out: Record<string, number> = {}
    for (const [k, d] of Object.entries((v as Record<string, unknown>) || {})) {
      const n = Number(d)
      if (Number.isFinite(n) && n > 0 && n < 5) out[k] = n
    }
    return out
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Normalizaciones
// ---------------------------------------------------------------------------

const sinTildes = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()

const redondear = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d

/**
 * Número completo de un remito, con punto de venta y sin ceros: "RMP 0002-00318903" → "2-318903" · "00880839" → "880839".
 * null = sin número ("0000-00000000", "000000", vacío).
 */
export function numeroCompleto(remito: unknown): string | null {
  const grupos = sinPrefijoRemito(remito).match(/\d+/g) || []
  if (!grupos.length) return null
  let n = grupos[grupos.length - 1]
  let pv = grupos.length > 1 ? grupos[grupos.length - 2] : null
  if (grupos.length === 1 && n.length >= 12) {
    pv = n.slice(0, -8)
    n = n.slice(-8)
  }
  n = n.replace(/^0+/, "")
  if (!n) return null
  if (pv === null) return n
  return `${pv.replace(/^0+/, "") || "0"}-${n}`
}

/** Artículo para la clave: el código; si no hay, el nombre sin "CCTS " ni tildes. */
export const articuloClave = (codigo: unknown, articulo: unknown) =>
  String(codigo ?? "").trim() ||
  sinTildes(articulo)
    .replace(/^\s*CCTS\s+/, "")
    .replace(/\s+/g, " ")
    .trim()

/**
 * Identidad de un remito de Zomatik entre lecturas (D3): número completo normalizado + artículo.
 * `claveRemito("RMP 0002-00318903", "10000004") = "2-318903|10000004"`. null = sin número.
 */
export function claveRemito(remito: unknown, codigo: unknown, articulo?: unknown): string | null {
  const n = numeroCompleto(remito)
  return n ? `${n}|${articuloClave(codigo, articulo)}` : null
}

/** "BLINKI S A" → "BLINKI" (para las notas de los asientos). */
export const proveedorCorto = (p: unknown) => tokensNombre(p).find((t) => t.length > 2) || String(p ?? "").trim() || "-"

/** Unidad de un material de Rebucret (`materials.unit`). null = otra (no se puede convertir). */
export function unidadMaterial(unit: unknown): "kg" | "l" | null {
  const u = sinTildes(unit).toLowerCase().replace(/[^a-z]/g, "")
  if (/^(kg|kgs|kilo|kilos|kilogramo|kilogramos)$/.test(u)) return "kg"
  if (/^(l|lt|lts|litro|litros)$/.test(u)) return "l"
  return null
}

export type UnidadZomatik = "t" | "kg" | "l" | "tacho"

/**
 * En qué viene la cantidad de Zomatik (Bautista, 05/11): áridos y cemento en toneladas, fibra en kg, aditivos en litros
 * o en tachos de 1000 L. El export no trae la unidad: el tacho se reconoce por el artículo ("TACHO", "IBC", "1000 L") o
 * por una columna Unidad si viniera.
 */
export function unidadZomatik(mat: string | null, articulo: unknown, datos?: Record<string, unknown> | null): UnidadZomatik {
  if (enToneladas(mat)) return "t"
  if (mat === "fibra") return "kg"
  const um = datos ? Object.entries(datos).find(([k]) => /^\s*(unidad|u\.?\s*m\.?|medida)\s*$/i.test(k))?.[1] : undefined
  const t = `${sinTildes(articulo)} ${sinTildes(um)}`
  if (/TACHO|\bIBC\b|\bTOTE\b|\bBIN\b|\b1\.?000\s*(L|LT|LTS|LITROS)\b|\bX\s*1\.?000\b/.test(t)) return "tacho"
  return "l"
}

const fmt = (n: number, dec = 2) => n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: dec })
const fmtT = (t: number) => t.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** "38,10 t" · "300 kg" · "500 L" · "2 tachos". */
export function textoCantidad(cantidad: number | null | undefined, unidad: UnidadZomatik | string | null | undefined): string {
  const c = Number(cantidad) || 0
  if (unidad === "t") return `${fmtT(c)} t`
  if (unidad === "tacho") return `${fmt(c)} ${c === 1 ? "tacho" : "tachos"}`
  if (unidad === "l") return `${fmt(c)} L`
  return `${fmt(c)} kg`
}

/** Toneladas de Zomatik → kg (rango 1 a 60 t por renglón). */
export function kgDeZomatik(t: number): { ok: true; kg: number } | { ok: false; motivo: string } {
  if (!Number.isFinite(t) || t < RANGO_T.min || t > RANGO_T.max) return { ok: false, motivo: `Cantidad rara (${fmt(t, 3)} t)` }
  return { ok: true, kg: redondear(t * 1000) }
}

export type Problema = { codigo: CodigoMotivo; motivo: string }
export type CodigoMotivo = "sin_numero" | "repetido" | "sin_deposito" | "material" | "cantidad" | "unidad" | "densidad" | "dudoso" | "borrado" | "ya_no_esta" | "antes_de_f"

/**
 * Cantidad de Zomatik en la unidad del material de Rebucret (lo que va a `stock_entries.quantity`).
 *   t → kg · kg → kg · L → L · tacho → 1000 L · L (o tachos) → kg con la densidad del material (kg/L).
 */
export function cantidadParaMaterial(
  cantidad: number,
  unidad: UnidadZomatik,
  material: { id: string; name: string; unit: string },
  densidades: Record<string, number>,
): { ok: true; cantidad: number } | ({ ok: false } & Problema) {
  const um = unidadMaterial(material.unit)
  if (unidad === "t") {
    if (um !== "kg") return { ok: false, codigo: "unidad", motivo: `${material.name} no está en kg (${material.unit || "sin unidad"})` }
    const r = kgDeZomatik(cantidad)
    return r.ok ? { ok: true, cantidad: r.kg } : { ok: false, codigo: "cantidad", motivo: r.motivo }
  }
  if (unidad === "kg") {
    if (!Number.isFinite(cantidad) || cantidad < RANGO_KG.min || cantidad > RANGO_KG.max) return { ok: false, codigo: "cantidad", motivo: `Cantidad rara (${fmt(cantidad)} kg)` }
    if (um !== "kg") return { ok: false, codigo: "unidad", motivo: `${material.name} no está en kg (${material.unit || "sin unidad"})` }
    return { ok: true, cantidad: redondear(cantidad) }
  }
  const litros = unidad === "tacho" ? cantidad * LITROS_POR_TACHO : cantidad
  if (!Number.isFinite(litros) || litros < RANGO_LITROS.min || litros > RANGO_LITROS.max) return { ok: false, codigo: "cantidad", motivo: `Cantidad rara (${textoCantidad(cantidad, unidad)})` }
  if (um === "l") return { ok: true, cantidad: redondear(litros) }
  if (um === "kg") {
    const d = densidades[material.id]
    if (!d) return { ok: false, codigo: "densidad", motivo: `Falta la densidad de ${material.name}` }
    return { ok: true, cantidad: redondear(litros * d) }
  }
  return { ok: false, codigo: "unidad", motivo: `${material.name} no está en kg ni en litros (${material.unit || "sin unidad"})` }
}

// ---------------------------------------------------------------------------
// Maestros
// ---------------------------------------------------------------------------

export type MaterialMP = { id: string; name: string; plant_id: string | null; tipo: string | null; unit: string; corrige_humedad?: boolean | null }
export type Proveedor = { id: string; name: string; plant_id?: string | null }
export type Flete = { id: string; name: string; supplier_id: string }

/** Planta de un depósito de Zomatik (`zomatik_np_config`: 116 Canning, 113 Hudson). null = otro depósito. */
export const resolverPlanta = (deposito: number | null | undefined, plantaDeDeposito: Map<number, string> | Record<number, string>): string | null => {
  if (deposito === null || deposito === undefined) return null
  const m = plantaDeDeposito instanceof Map ? plantaDeDeposito.get(Number(deposito)) : plantaDeDeposito[Number(deposito)]
  return m ?? null
}

/**
 * Material de Rebucret de un renglón: `materialZomatik(articulo, codigo)` → el de esa planta con la misma
 * `claveMaterial(name)` y un tipo importable. Tiene que haber uno solo.
 */
export function resolverMaterial(
  r: { articulo: string; codigo?: string | null },
  plantId: string | null,
  materiales: MaterialMP[],
  nombrePlanta = "la planta",
): { estado: "ok"; material: MaterialMP; clave: string } | { estado: "sin_material" } | { estado: "no_encontrado"; clave: string; motivo: string } {
  const clave = materialZomatik(r.articulo, r.codigo)
  if (!clave) return { estado: "sin_material" }
  const cands = materiales.filter((m) => m.plant_id === plantId && TIPOS_IMPORTABLES.includes(m.tipo || "") && claveMaterial(m.name) === clave)
  if (cands.length === 1) return { estado: "ok", material: cands[0], clave }
  return {
    estado: "no_encontrado",
    clave,
    motivo: cands.length ? `Hay más de un material ${nombreMaterial(clave)} en ${nombrePlanta}` : `Material no encontrado en ${nombrePlanta} (${nombreMaterial(clave)})`,
  }
}

/**
 * Proveedor de un renglón: primero entre los del material y después entre los de la planta. Gana la coincidencia por
 * palabra sobre el alias (Fenomix → "FENOMIX MATERIALES" si existe; si no, "CEMENTOS AVELLANEDA"). Uno solo, o null.
 */
export function resolverProveedor(texto: string | null | undefined, delMaterial: Proveedor[], dePlanta: Proveedor[] = []): string | null {
  if (!texto || !texto.trim()) return null
  for (const lista of [delMaterial, dePlanta]) {
    const unicos = [...new Map(lista.filter(Boolean).map((p) => [p.id, p])).values()]
    const porPalabra = unicos.filter((p) => mismoProveedorPorNombre(texto, p.name) === true)
    if (porPalabra.length === 1) return porPalabra[0].id
    if (porPalabra.length > 1) return null
    const porAlias = unicos.filter((p) => mismoProveedor(texto, p.name) === true)
    if (porAlias.length === 1) return porAlias[0].id
    if (porAlias.length > 1) return null
  }
  return null
}

/** Flete de un renglón entre los del proveedor ("Transporte · Chofer"). "Proveedor con flete incluido" → null. */
export function resolverFlete(texto: string | null | undefined, fletes: Flete[]): string | null {
  const t = String(texto ?? "").split(" · ")[0].trim()
  if (!t || /flete\s+incluido/i.test(t)) return null
  const c = fletes.filter((f) => mismoProveedorPorNombre(t, f.name) === true)
  return c.length === 1 ? c[0].id : null
}

// ---------------------------------------------------------------------------
// Entradas y acciones del plan
// ---------------------------------------------------------------------------

/** Un renglón de la copia (zomatik_remitos_compra). `orden` = orden del export (el id de la copia). */
export type FilaCopia = {
  orden: number
  fecha: string
  remito: string
  codigo_articulo: string | null
  articulo: string
  cantidad: number
  deposito: number | null
  plant_id: string | null
  proveedor: string | null
  transportista: string | null
  orden_compra?: string | null
  datos?: Record<string, unknown> | null
}

export type EstadoVinculo = "importado" | "emparejado" | "pendiente" | "anulado" | "descartado"

/** Un vínculo guardado (zomatik_ingresos_mp). */
export type Vinculo = {
  clave: string
  estado: EstadoVinculo
  motivo?: string | null
  motivo_codigo?: string | null
  stock_entry_id: string | null
  fecha: string | null
  remito?: string | null
  orden_compra?: string | null
  proveedor?: string | null
  codigo_articulo?: string | null
  articulo?: string | null
  cantidad_zomatik?: number | null
  unidad_zomatik?: string | null
  deposito?: number | null
  plant_id?: string | null
  material_id?: string | null
  transportista?: string | null
  kg_asentado: number | null
  proveedor_por_robot?: boolean | null
  falta_desde?: string | null
  candidato_id?: string | null
  resolucion?: "mismo" | "distintos" | "descartar" | null
  /** Ingresos a mano que alguien dijo que "son distintos" de este remito (no se vuelven a proponer). */
  rechazados?: string[] | null
  era_manual?: boolean | null
}

/** Un ingreso cargado a mano (candidato a emparejar). `fecha` = fecha de Argentina del `entry_date`. */
export type Manual = { id: string; fecha: string; material_id: string; plant_id: string | null; quantity: number; remito: string | null }

export type EntradaPlan = {
  filas: FilaCopia[]
  /** Días leídos enteros en esta pasada (AAAA-MM-DD). Solo en esos días puede "faltar" un remito. */
  diasLeidos: string[]
  vinculos: Vinculo[]
  /** Ingresos a mano (origen nulo o manual), sin anular, desde F − 10 días. Los ya vinculados se descartan solos. */
  manuales: Manual[]
  materiales: MaterialMP[]
  proveedores: Proveedor[]
  materialProveedores: { material_id: string; supplier_id: string }[]
  fletes: Flete[]
  plantas: Record<string, string>
  /** F: fecha desde la que se importa (la del interruptor). */
  desde: string
  ahora: number
  densidades?: Record<string, number>
}

/** Columnas del vínculo que salen del renglón (sin precios). */
export type DatosVinculo = {
  fecha: string
  remito: string
  remito_norm: string | null
  orden_compra: string | null
  proveedor: string | null
  codigo_articulo: string | null
  articulo: string
  cantidad_t: number | null
  cantidad_zomatik: number
  unidad_zomatik: UnidadZomatik
  deposito: number | null
  plant_id: string | null
  material_id: string | null
  transportista: string | null
  datos: Record<string, unknown> | null
}

export type IngresoNuevo = {
  material_id: string
  quantity: number
  supplier_id: string | null
  supplier: string | null
  carrier_id: string | null
  remito: string
  entry_date: string
}

export type Accion =
  | { tipo: "alta"; clave: string; texto: string; vinculo: DatosVinculo & { proveedor_por_robot: boolean }; ingreso: IngresoNuevo }
  | { tipo: "emparejar"; clave: string; texto: string; vinculo: DatosVinculo & { motivo: string | null; motivo_codigo: string | null }; entry_id: string; kg_manual_visto: number; reemplazar: boolean; kg_nuevo: number | null; nota: string | null }
  | { tipo: "corregir"; clave: string; texto: string; entry_id: string; kg_visto: number; kg_nuevo: number; desanular: boolean; nota: string; vinculo: Partial<DatosVinculo> }
  | { tipo: "anular"; clave: string; texto: string; entry_id: string; kg_visto: number; nota: string }
  | { tipo: "mover"; clave: string; texto: string; entry_id: string; kg_visto: number; anular_viejo: boolean; nota: string; vinculo: DatosVinculo & { proveedor_por_robot: boolean }; ingreso: IngresoNuevo }
  | { tipo: "pendiente"; clave: string; texto: string; vinculo: Partial<DatosVinculo> & { motivo: string; motivo_codigo: CodigoMotivo; candidato_id: string | null; limpiar_resolucion?: boolean } }
  | { tipo: "descartar"; clave: string; texto: string; motivo: string }
  | {
      tipo: "actualizar"
      clave: string
      texto: string
      vinculo: Partial<DatosVinculo> & { falta_desde?: "ahora" | null; motivo?: string | null; motivo_codigo?: string | null }
      ingreso?: { entry_date?: string; supplier_id?: string | null; supplier?: string | null; carrier_id?: string | null }
    }

export type ResumenPlan = {
  renglones: number
  nuevos: number
  emparejados: number
  correcciones: number
  anulaciones: number
  movidos: number
  /** Renglones que quedan sin importar (pendientes nuevos o que siguen). */
  sin_importar: number
  sin_material: number
  proveedores_sin_vincular: number
  acciones: number
}

export type ResultadoPlan = {
  acciones: Accion[]
  resumen: ResumenPlan
  /** Artículos que no son MP (gasoil, malla…): no se importan ni son pendientes. */
  sinMaterial: { articulo: string; codigo: string | null; renglones: number; ultima: string }[]
  /** Altas sin proveedor vinculado: entran igual, con el texto en `stock_entries.supplier`. */
  proveedoresSinVincular: { proveedor: string; renglones: number }[]
  /** Los pendientes que siguen abiertos después de este plan (para mostrar en la sombra). */
  pendientes: { clave: string; fecha: string; remito: string; motivo: string }[]
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

type Analisis = {
  clave: string
  fila: FilaCopia
  mat: string | null
  material: MaterialMP | null
  cantidad: number | null
  unidad: UnidadZomatik
  problema: Problema | null
  datos: DatosVinculo
  supplierId: string | null
  carrierId: string | null
}

const ORDEN_DEPOSITO = (d: number | null) => (d === 116 ? 0 : d === 113 ? 1 : 2)
const mismoTexto = (a: unknown, b: unknown) => sinTildes(a).replace(/[^A-Z0-9]/g, "") === sinTildes(b).replace(/[^A-Z0-9]/g, "")
const iguales = (a: unknown, b: unknown) => (a ?? null) === (b ?? null)
const igualNum = (a: unknown, b: unknown, tol = 0.005) => (a === null || a === undefined ? b === null || b === undefined : b !== null && b !== undefined && Math.abs(Number(a) - Number(b)) <= tol)

/** Tolerancia para decir que dos cantidades son la misma (t: 0,02 t; aditivos y fibra: 1 %). */
const tolerancia = (kg: number, enT: boolean) => (enT ? TOL_KG_TONELADAS : Math.max(1, Math.abs(kg) * 0.01))

export const entryDateDe = (fecha: string) => `${fecha}T12:00:00Z`

/**
 * El plan de una pasada (3.4). Idempotente: con lo aplicado da 0 acciones.
 */
export function planImportacion(e: EntradaPlan): ResultadoPlan {
  const F = e.desde
  const dens = e.densidades || {}
  const dias = new Set(e.diasLeidos)
  const vinc = new Map(e.vinculos.map((v) => [v.clave, v]))
  const vinculadas = new Set(e.vinculos.map((v) => v.stock_entry_id).filter((x): x is string => !!x))
  const matPorId = new Map(e.materiales.map((m) => [m.id, m]))
  const provPorId = new Map(e.proveedores.map((p) => [p.id, p]))
  const planta = (id: string | null | undefined) => (id ? e.plantas[id] || "otra planta" : "otro depósito")
  const acciones: Accion[] = []
  const pendientes: ResultadoPlan["pendientes"] = []
  const sinMat = new Map<string, { articulo: string; codigo: string | null; renglones: number; ultima: string }>()
  const sinProv = new Map<string, number>()
  const vistos = new Set<string>()

  // 1. Renglones desde F, en el orden en que se decide cuál es "el primero" de un repetido: depósito y orden del export
  const filas = e.filas.filter((f) => f.fecha >= F).sort((a, b) => ORDEN_DEPOSITO(a.deposito) - ORDEN_DEPOSITO(b.deposito) || a.orden - b.orden)

  // 2. Analizar cada renglón: clave, planta, material, cantidad, proveedor
  const porBase = new Map<string, FilaCopia[]>()
  const analisis: Analisis[] = []
  const sinNumero = new Map<string, number>()
  for (const f of filas) {
    const mat = materialZomatik(f.articulo, f.codigo_articulo)
    if (!mat) {
      const k = `${f.codigo_articulo || ""}|${f.articulo}`
      const x = sinMat.get(k) || { articulo: f.articulo, codigo: f.codigo_articulo || null, renglones: 0, ultima: f.fecha }
      x.renglones++
      if (f.fecha > x.ultima) x.ultima = f.fecha
      sinMat.set(k, x)
      continue
    }
    const base = claveRemito(f.remito, f.codigo_articulo, f.articulo)
    if (base) {
      const g = porBase.get(base) || []
      g.push(f)
      porBase.set(base, g)
    }
  }
  // El primero de cada clave repetida: el que coincide con el vínculo (mismo depósito, cantidad más cercana); si no, el orden
  const claveDe = new Map<FilaCopia, string>()
  for (const [base, g] of porBase) {
    const v = vinc.get(base)
    const orden = [...g]
    if (v && g.length > 1) {
      orden.sort((a, b) => Number(a.deposito !== v.deposito) - Number(b.deposito !== v.deposito) || Math.abs(a.cantidad - Number(v.cantidad_zomatik ?? 0)) - Math.abs(b.cantidad - Number(v.cantidad_zomatik ?? 0)) || filas.indexOf(a) - filas.indexOf(b))
    }
    orden.forEach((f, i) => claveDe.set(f, i === 0 ? base : `${base}#${i + 1}`))
  }

  for (const f of filas) {
    const mat = materialZomatik(f.articulo, f.codigo_articulo)
    if (!mat) continue
    let clave = claveDe.get(f)
    let problema: Problema | null = null
    if (!clave) {
      // Sin número: no se puede seguir entre lecturas; queda pendiente con una clave del renglón
      const b = `sn|${f.fecha}|${f.deposito ?? "otro"}|${articuloClave(f.codigo_articulo, f.articulo)}|${f.cantidad}`
      const k = (sinNumero.get(b) || 0) + 1
      sinNumero.set(b, k)
      clave = `${b}|${k}`
      problema = { codigo: "sin_numero", motivo: "Remito sin número" }
    } else if (clave.includes("#")) {
      problema = { codigo: "repetido", motivo: "Remito repetido en Zomatik" }
    }
    const unidad = unidadZomatik(mat, f.articulo, f.datos)
    const plantId = f.plant_id
    let material: MaterialMP | null = null
    let cantidad: number | null = null
    if (!problema && !plantId) problema = { codigo: "sin_deposito", motivo: "Depósito sin planta" }
    if (!problema) {
      const rm = resolverMaterial({ articulo: f.articulo, codigo: f.codigo_articulo }, plantId, e.materiales, planta(plantId))
      if (rm.estado === "ok") material = rm.material
      else if (rm.estado === "no_encontrado") problema = { codigo: "material", motivo: rm.motivo }
    }
    if (!problema && material) {
      const c = cantidadParaMaterial(f.cantidad, unidad, material, dens)
      if (c.ok) cantidad = c.cantidad
      else problema = { codigo: c.codigo, motivo: c.motivo }
    }
    let supplierId: string | null = null
    let carrierId: string | null = null
    if (material) {
      const delMaterial = e.materialProveedores.filter((mp) => mp.material_id === material!.id).map((mp) => provPorId.get(mp.supplier_id)).filter((p): p is Proveedor => !!p)
      const dePlanta = e.proveedores.filter((p) => p.plant_id === plantId)
      supplierId = resolverProveedor(f.proveedor, delMaterial, dePlanta)
      if (supplierId) carrierId = resolverFlete(f.transportista, e.fletes.filter((x) => x.supplier_id === supplierId))
    }
    analisis.push({
      clave,
      fila: f,
      mat,
      material,
      cantidad,
      unidad,
      problema,
      supplierId,
      carrierId,
      datos: {
        fecha: f.fecha,
        remito: f.remito,
        remito_norm: normalizarRemito(f.remito),
        orden_compra: f.orden_compra ?? null,
        proveedor: f.proveedor ?? null,
        codigo_articulo: f.codigo_articulo ?? null,
        articulo: f.articulo,
        cantidad_t: unidad === "t" ? f.cantidad : null,
        cantidad_zomatik: f.cantidad,
        unidad_zomatik: unidad,
        deposito: f.deposito,
        plant_id: plantId,
        material_id: material?.id ?? null,
        transportista: f.transportista ?? null,
        datos: f.datos ?? null,
      },
    })
    vistos.add(clave)
  }

  const ref = (a: Analisis) => `${sinPrefijoRemito(a.fila.remito) ? `RMP ${sinPrefijoRemito(a.fila.remito)}` : "sin número"} ${proveedorCorto(a.fila.proveedor)}`
  const ingresoDe = (a: Analisis): IngresoNuevo => ({
    material_id: a.material!.id,
    quantity: a.cantidad!,
    supplier_id: a.supplierId,
    supplier: a.supplierId ? null : a.fila.proveedor?.trim() || null,
    carrier_id: a.carrierId,
    remito: sinPrefijoRemito(a.fila.remito),
    entry_date: entryDateDe(a.fila.fecha),
  })
  const anotarPendiente = (a: Analisis, motivo: string) => pendientes.push({ clave: a.clave, fecha: a.fila.fecha, remito: a.fila.remito, motivo })

  /** Pendiente (si no estaba igual: idempotente). */
  const pendiente = (a: Analisis, p: Problema, candidato: string | null = null, limpiar = false) => {
    anotarPendiente(a, p.motivo)
    const v = vinc.get(a.clave)
    const igual =
      v &&
      v.estado === "pendiente" &&
      v.motivo_codigo === p.codigo &&
      v.motivo === p.motivo &&
      iguales(v.candidato_id, candidato) &&
      !limpiar &&
      v.fecha === a.datos.fecha &&
      igualNum(v.cantidad_zomatik, a.datos.cantidad_zomatik) &&
      iguales(v.deposito, a.datos.deposito) &&
      iguales(v.material_id, a.datos.material_id) &&
      mismoTexto(v.proveedor, a.datos.proveedor)
    if (igual) return
    // Si cambia el ingreso propuesto, lo que se había elegido para el anterior ya no vale
    if (v && v.resolucion && !iguales(v.candidato_id, candidato)) limpiar = true
    acciones.push({ tipo: "pendiente", clave: a.clave, texto: `${ref(a)} ${ddmm(a.fila.fecha)}: ${p.motivo}`, vinculo: { ...a.datos, motivo: p.motivo, motivo_codigo: p.codigo, candidato_id: candidato, ...(limpiar ? { limpiar_resolucion: true } : {}) } })
  }

  // 3. Lo que ya tiene vínculo; el resto va al emparejamiento
  const nuevos: Analisis[] = []
  for (const a of analisis) {
    const v = vinc.get(a.clave)
    if (v && (v.estado === "importado" || v.estado === "anulado") && v.stock_entry_id) {
      seguirImportado(a, v)
      continue
    }
    if (v && v.estado === "importado" && !v.stock_entry_id) {
      // Lo borraron a mano en Rebucret: no se vuelve a importar
      pendiente(a, { codigo: "borrado", motivo: "Borrado a mano en Rebucret" })
      continue
    }
    if (v && v.estado === "pendiente" && v.motivo_codigo === "borrado") {
      if (v.resolucion === "descartar") acciones.push({ tipo: "descartar", clave: a.clave, texto: `${ref(a)}: descartado`, motivo: "Descartado" })
      else pendiente(a, { codigo: "borrado", motivo: "Borrado a mano en Rebucret" })
      continue
    }
    if (v && v.estado === "emparejado") {
      // Emparejado con un manual anterior a F: no se toca el ingreso; solo se mantiene al día lo de Zomatik
      const cambio = v.fecha !== a.datos.fecha || !igualNum(v.cantidad_zomatik, a.datos.cantidad_zomatik) || !iguales(v.deposito, a.datos.deposito) || !mismoTexto(v.proveedor, a.datos.proveedor)
      if (cambio) acciones.push({ tipo: "actualizar", clave: a.clave, texto: `${ref(a)}: se actualizan los datos de Zomatik (sin tocar el ingreso)`, vinculo: { ...a.datos } })
      continue
    }
    if (v && v.estado === "descartado") continue
    if (v && v.resolucion === "descartar") {
      acciones.push({ tipo: "descartar", clave: a.clave, texto: `${ref(a)}: descartado`, motivo: "Descartado" })
      continue
    }
    if (a.problema) {
      pendiente(a, a.problema)
      continue
    }
    nuevos.push(a)
  }

  function seguirImportado(a: Analisis, v: Vinculo) {
    if (a.problema && a.problema.codigo !== "repetido") {
      // Cambió en Zomatik a algo que no se puede aplicar (cantidad rara, otro material…): no se toca el ingreso
      const motivo = `No se actualizó: ${a.problema.motivo}`
      if (v.motivo !== motivo || v.falta_desde) acciones.push({ tipo: "actualizar", clave: a.clave, texto: `${ref(a)}: ${motivo}`, vinculo: { motivo, motivo_codigo: a.problema.codigo, falta_desde: null } })
      return
    }
    const kg = a.cantidad!
    const otraPlanta = a.datos.plant_id !== v.plant_id || a.material!.id !== v.material_id
    if (otraPlanta) {
      const deA = `${planta(v.plant_id)} → ${planta(a.datos.plant_id)}`
      acciones.push({
        tipo: "mover",
        clave: a.clave,
        texto: `${ref(a)}: cambio de planta en Zomatik (${deA})`,
        entry_id: v.stock_entry_id!,
        kg_visto: Number(v.kg_asentado) || 0,
        anular_viejo: v.estado !== "anulado",
        nota: `Cambiado de planta en Zomatik (${deA}): ${ref(a)}, ${textoCantidad(v.cantidad_zomatik, v.unidad_zomatik)}`,
        vinculo: { ...a.datos, proveedor_por_robot: true },
        ingreso: ingresoDe(a),
      })
      return
    }
    if (v.estado === "anulado") {
      acciones.push({
        tipo: "corregir",
        clave: a.clave,
        texto: `${ref(a)}: volvió a Zomatik`,
        entry_id: v.stock_entry_id!,
        kg_visto: Number(v.kg_asentado) || 0,
        kg_nuevo: kg,
        desanular: true,
        nota: `Volvió a Zomatik: ${ref(a)}, ${textoCantidad(a.datos.cantidad_zomatik, a.unidad)}`,
        vinculo: { ...a.datos },
      })
      return
    }
    if (!igualNum(v.kg_asentado, kg)) {
      acciones.push({
        tipo: "corregir",
        clave: a.clave,
        texto: `${ref(a)}: ${textoCantidad(v.cantidad_zomatik, v.unidad_zomatik)} → ${textoCantidad(a.datos.cantidad_zomatik, a.unidad)}`,
        entry_id: v.stock_entry_id!,
        kg_visto: Number(v.kg_asentado) || 0,
        kg_nuevo: kg,
        desanular: false,
        nota: `Corregido en Zomatik: ${ref(a)}, ${textoCantidad(v.cantidad_zomatik, v.unidad_zomatik)} → ${textoCantidad(a.datos.cantidad_zomatik, a.unidad)}`,
        vinculo: { cantidad_zomatik: a.datos.cantidad_zomatik, cantidad_t: a.datos.cantidad_t, unidad_zomatik: a.unidad },
      })
    }
    // Lo demás (fecha, proveedor, transporte, remito): sin efecto en el stock
    const vin: Extract<Accion, { tipo: "actualizar" }>["vinculo"] = {}
    const ing: NonNullable<Extract<Accion, { tipo: "actualizar" }>["ingreso"]> = {}
    if (v.fecha !== a.datos.fecha) {
      vin.fecha = a.datos.fecha
      ing.entry_date = entryDateDe(a.datos.fecha)
    }
    if (!mismoTexto(v.proveedor, a.datos.proveedor)) {
      vin.proveedor = a.datos.proveedor
      // Solo si el proveedor lo puso el robot (no se pisa lo que eligió una persona)
      if (v.proveedor_por_robot) {
        ing.supplier_id = a.supplierId
        ing.supplier = a.supplierId ? null : a.datos.proveedor
      }
    }
    if (!mismoTexto(v.transportista, a.datos.transportista)) {
      vin.transportista = a.datos.transportista
      if (v.proveedor_por_robot) ing.carrier_id = a.carrierId
    }
    if (!mismoTexto(v.remito, a.datos.remito)) vin.remito = a.datos.remito
    if (!mismoTexto(v.orden_compra, a.datos.orden_compra)) vin.orden_compra = a.datos.orden_compra
    if (v.falta_desde) vin.falta_desde = null
    if (v.motivo && v.motivo_codigo !== "antes_de_f") {
      vin.motivo = null
      vin.motivo_codigo = null
    }
    if (Object.keys(vin).length) acciones.push({ tipo: "actualizar", clave: a.clave, texto: `${ref(a)}: datos actualizados (${Object.keys(vin).join(", ")})`, vinculo: vin, ...(Object.keys(ing).length ? { ingreso: ing } : {}) })
  }

  // 4. Emparejamiento con los cargados a mano (desde F − 10 días, sin vincular)
  const piso = sumarDias(F, -MANUALES_ANTES_DE_F_DIAS)
  const libres = e.manuales.filter((m) => m.fecha >= piso && !vinculadas.has(m.id))
  const tomados = new Set<string>()
  const enT = (a: Analisis) => TIPOS_TONELADAS.includes(a.material?.tipo || "") || enToneladas(a.mat)
  const emparejar = (a: Analisis, m: Manual) => {
    tomados.add(m.id)
    const reemplazar = m.fecha >= F
    // Desde F el manual pasa a ser el importado con la cantidad de Zomatik si difiere en algo (Bautista, 05/11);
    // antes de F no se toca y solo se informa si difiere más de la tolerancia (0,02 t)
    const difiere = reemplazar ? !igualNum(m.quantity, a.cantidad!) : Math.abs(Number(m.quantity) - a.cantidad!) > tolerancia(a.cantidad!, enT(a))
    const unidad = a.material?.unit || "kg"
    const aMano = `${fmt(Number(m.quantity))} ${unidad}`
    let motivo: string | null = null
    let codigo: string | null = null
    if (!reemplazar && difiere) {
      motivo = `Emparejado con un ingreso anterior al ${ddmm(F)}: no se corrige (a mano ${aMano}, Zomatik ${textoCantidad(a.datos.cantidad_zomatik, a.unidad)})`
      codigo = "antes_de_f"
    }
    acciones.push({
      tipo: "emparejar",
      clave: a.clave,
      texto: `${ref(a)} ${ddmm(a.fila.fecha)}: emparejado con el ingreso a mano del ${ddmm(m.fecha)}${reemplazar && difiere ? ` (${aMano} → ${textoCantidad(a.datos.cantidad_zomatik, a.unidad)})` : ""}`,
      vinculo: { ...a.datos, motivo, motivo_codigo: codigo },
      entry_id: m.id,
      kg_manual_visto: Number(m.quantity),
      reemplazar,
      kg_nuevo: reemplazar && difiere ? a.cantidad! : null,
      nota: reemplazar && difiere ? `Emparejado con Zomatik: ${ref(a)}, cargado a mano ${aMano} → ${textoCantidad(a.datos.cantidad_zomatik, a.unidad)}` : null,
    })
  }
  const restantes: Analisis[] = []
  // 4.a Lo que alguien ya resolvió como "es el mismo"
  for (const a of nuevos) {
    const v = vinc.get(a.clave)
    if (v?.resolucion === "mismo" && v.candidato_id) {
      const m = libres.find((x) => x.id === v.candidato_id && !tomados.has(x.id))
      if (m) emparejar(a, m)
      else pendiente(a, { codigo: "dudoso", motivo: "El ingreso a mano elegido ya no está: elegí de nuevo" }, null, true)
      continue
    }
    restantes.push(a)
  }
  const excluido = (a: Analisis, m: Manual) => {
    const v = vinc.get(a.clave)
    return (v?.rechazados || []).includes(m.id) || (v?.resolucion === "distintos" && v.candidato_id === m.id)
  }
  const nro = (r: string | null | undefined) => normalizarRemito(r)
  // 4.b Seguro: mismo número, mismo material (y planta), ±10 días
  const pares: { a: Analisis; m: Manual; p: number }[] = []
  for (const a of restantes) {
    const n = nro(a.fila.remito)
    if (!n) continue
    for (const m of libres) {
      if (tomados.has(m.id) || excluido(a, m) || m.material_id !== a.material!.id || nro(m.remito) !== n) continue
      const d = Math.abs(diasEntre(m.fecha, a.fila.fecha))
      if (d > EMPAREJAR_DIAS) continue
      pares.push({ a, m, p: d + Math.min(Math.abs(Number(m.quantity) - a.cantidad!), 1e6) / 1e7 })
    }
  }
  const resueltos = new Set<Analisis>()
  pares.sort((x, y) => x.p - y.p || (x.m.id < y.m.id ? -1 : 1))
  for (const { a, m } of pares) {
    if (resueltos.has(a) || tomados.has(m.id)) continue
    resueltos.add(a)
    emparejar(a, m)
  }
  // 4.c Dudoso: mismo número en otro material o planta, o el mismo camión con el número mal escrito (como el paso 3 de
  //     cruzar(): mismo material, ±10 días, mismas toneladas). No se importa hasta que alguien elija.
  const dudas: { a: Analisis; m: Manual; p: number }[] = []
  for (const a of restantes) {
    if (resueltos.has(a)) continue
    const n = nro(a.fila.remito)
    for (const m of libres) {
      if (tomados.has(m.id) || excluido(a, m)) continue
      const d = Math.abs(diasEntre(m.fecha, a.fila.fecha))
      if (d > PAREO_FECHA_DIAS) continue
      const mm = matPorId.get(m.material_id)
      if (n && nro(m.remito) === n) {
        dudas.push({ a, m, p: d / 100 })
        continue
      }
      if (!mm || claveMaterial(mm.name) !== a.mat) continue
      const iguales_ = enT(a) ? Math.abs(toneladas(Number(m.quantity)).t - a.cantidad! / 1000) <= TOL_KG_TONELADAS / 1000 + 1e-9 : Math.abs(Number(m.quantity) - a.cantidad!) <= tolerancia(a.cantidad!, false)
      if (!iguales_) continue
      dudas.push({ a, m, p: 1 + d * 0.05 + (m.plant_id === a.datos.plant_id ? 0 : 0.5) })
    }
  }
  dudas.sort((x, y) => x.p - y.p || (x.m.id < y.m.id ? -1 : 1))
  const conDuda = new Set<Analisis>()
  for (const { a, m } of dudas) {
    if (conDuda.has(a) || tomados.has(m.id)) continue
    conDuda.add(a)
    tomados.add(m.id)
    const otra = m.plant_id !== a.datos.plant_id ? ` (${planta(m.plant_id)})` : ""
    pendiente(a, { codigo: "dudoso", motivo: `¿Mismo camión que el ingreso manual del ${ddmm(m.fecha)}${otra}?` }, m.id)
  }
  // 4.d Altas
  for (const a of restantes) {
    if (resueltos.has(a) || conDuda.has(a)) continue
    if (!a.supplierId) sinProv.set(a.fila.proveedor?.trim() || "(sin proveedor)", (sinProv.get(a.fila.proveedor?.trim() || "(sin proveedor)") || 0) + 1)
    acciones.push({
      tipo: "alta",
      clave: a.clave,
      texto: `${ref(a)} ${ddmm(a.fila.fecha)}: nuevo, ${textoCantidad(a.datos.cantidad_zomatik, a.unidad)} de ${a.material!.name} en ${planta(a.datos.plant_id)}`,
      vinculo: { ...a.datos, proveedor_por_robot: true },
      ingreso: ingresoDe(a),
    })
  }

  // 5. Vínculos que no están en esta lectura, de días leídos enteros
  for (const v of e.vinculos) {
    if (vistos.has(v.clave) || !v.fecha || v.fecha < F || !dias.has(v.fecha)) continue
    if (v.estado === "importado" && v.stock_entry_id) {
      if (!v.falta_desde) {
        acciones.push({ tipo: "actualizar", clave: v.clave, texto: `${v.remito || v.clave}: no está en Zomatik (se espera 2 h antes de anular)`, vinculo: { falta_desde: "ahora" } })
      } else if (e.ahora - Date.parse(v.falta_desde) >= ESPERA_ANULAR_MS) {
        const r = `${v.remito ? `RMP ${sinPrefijoRemito(v.remito)}` : v.clave} ${proveedorCorto(v.proveedor)}`
        acciones.push({ tipo: "anular", clave: v.clave, texto: `${r}: anulado en Zomatik`, entry_id: v.stock_entry_id, kg_visto: Number(v.kg_asentado) || 0, nota: `Anulado en Zomatik: ${r}, ${textoCantidad(v.cantidad_zomatik, v.unidad_zomatik)}` })
      }
    } else if (v.estado === "pendiente") {
      acciones.push({ tipo: "descartar", clave: v.clave, texto: `${v.remito || v.clave}: ya no está en Zomatik`, motivo: "Ya no está en Zomatik" })
    }
  }

  const cuenta = (t: Accion["tipo"]) => acciones.filter((x) => x.tipo === t).length
  return {
    acciones,
    resumen: {
      renglones: analisis.length,
      nuevos: cuenta("alta"),
      emparejados: cuenta("emparejar"),
      correcciones: acciones.filter((x) => x.tipo === "corregir").length + acciones.filter((x) => x.tipo === "emparejar" && x.kg_nuevo !== null).length,
      anulaciones: cuenta("anular"),
      movidos: cuenta("mover"),
      sin_importar: pendientes.length,
      sin_material: [...sinMat.values()].reduce((s, x) => s + x.renglones, 0),
      proveedores_sin_vincular: [...sinProv.values()].reduce((s, n) => s + n, 0),
      acciones: acciones.length,
    },
    sinMaterial: [...sinMat.values()].sort((a, b) => b.renglones - a.renglones || a.articulo.localeCompare(b.articulo)),
    proveedoresSinVincular: [...sinProv].map(([proveedor, renglones]) => ({ proveedor, renglones })).sort((a, b) => b.renglones - a.renglones),
    pendientes,
  }
}

/** "Si estuviera prendida: 12 nuevos, 30 emparejados, 1 sin importar." */
export function textoResumen(r: Partial<ResumenPlan> | null | undefined): string {
  if (!r) return "Sin datos."
  const partes = [
    `${r.nuevos ?? 0} ${r.nuevos === 1 ? "nuevo" : "nuevos"}`,
    `${r.emparejados ?? 0} ${r.emparejados === 1 ? "emparejado" : "emparejados"}`,
    r.correcciones ? `${r.correcciones} ${r.correcciones === 1 ? "corrección" : "correcciones"}` : null,
    r.anulaciones ? `${r.anulaciones} ${r.anulaciones === 1 ? "anulado" : "anulados"}` : null,
    r.movidos ? `${r.movidos} de otra planta` : null,
    `${r.sin_importar ?? 0} sin importar`,
  ].filter(Boolean)
  return partes.join(", ")
}

/** Texto del motivo de un pendiente con qué hacer (pantalla y mail). */
export function textoMotivo(codigo: string | null | undefined, motivo: string | null | undefined): { motivo: string; queHacer: string } {
  const m = motivo || "-"
  switch (codigo) {
    case "dudoso":
      return { motivo: m, queHacer: "Elegí: es el mismo / son distintos" }
    case "repetido":
      return { motivo: m, queHacer: "Corregilo en Zomatik (se importó uno solo)" }
    case "sin_numero":
      return { motivo: m, queHacer: "Cargá el número en Zomatik" }
    case "sin_deposito":
      return { motivo: m, queHacer: "Corregí el depósito en Zomatik (Canning o REBUCRET)" }
    case "material":
    case "unidad":
      return { motivo: m, queHacer: "Revisá el artículo en Zomatik o el material en Rebucret" }
    case "cantidad":
      return { motivo: m, queHacer: "Corregí la cantidad en Zomatik" }
    case "densidad":
      return { motivo: m, queHacer: "Cargá la densidad (Control con Zomatik › Densidades)" }
    case "borrado":
      return { motivo: m, queHacer: "Descartalo o volvelo a cargar a mano" }
    default:
      return { motivo: m, queHacer: "Corregilo en Zomatik" }
  }
}
