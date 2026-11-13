/**
 * Zomatik · ajustar la NP a lo despachado al finalizar el pedido — funciones puras (sin red, sin base).
 * Spec: docs/specs/2026-11-06-ajustar-np-al-finalizar.md (la sección 15, decisiones de Bautista del 06/11, manda).
 * Se prueban con `npm run test:zomatik-ajuste`.
 *
 *   - Qué cantidad tiene que quedar en cada NP del pedido (decisión 16, 13/11, reemplaza a la 15.3): lo despachado
 *     contra ella por todos los usos + lo que todavía comprometen los pedidos activos (`saldoNp`, la misma cuenta del
 *     saldo), con el libre en 0. Lo que reservan otros pedidos activos no se toca.
 *   - "Tiene factura" (15.1): Zomatik no deja editar la NP. Se mira el detalle de la NP (señal C: sin el botón Grabar,
 *     REAL) y sus comprobantes (señal B, REAL). Lo que no se puede leer: "no se sabe".
 *   - El pendiente que tiene que traer el remito después del ajuste (4.4).
 * Cómo se ve una NP facturada es REAL (06/11); la respuesta del Grabar al editar sigue SUPUESTO hasta la captura 4
 * (lib/__fixtures__/zomatik-ajuste/README.md).
 */
import { despachadoPorUso, saldoNp, type Renglon, type UsoSaldo } from "@/lib/zomatik/np"

const r3 = (n: number) => Math.round(Number(n) * 1000) / 1000
export const TOL_AJUSTE = 0.001
/** "40,4" (como se ve en pantalla). */
export const m3Texto = (n: number | null | undefined) => String(r3(Number(n) || 0)).replace(".", ",")

// ---------------------------------------------------------------------------
// Estados y marca
// ---------------------------------------------------------------------------

export const ESTADOS_AJUSTE = ["pendiente", "generando", "ok", "nada", "revisar", "error", "a_mano", "anulado"] as const
export type EstadoAjuste = (typeof ESTADOS_AJUSTE)[number]
/** Con el ajuste en uno de estos, el remito (y su OF) del pedido puede salir (4.4). */
export const AJUSTE_LISTO: EstadoAjuste[] = ["ok", "nada", "a_mano"]
/** Pasos en los que un Grabar pudo llegar a Zomatik: antes de reintentar se relee la NP (4.3). */
export const PASOS_GRABAR_AJUSTE = ["grabar_np", "verificar_np"]
/** Paso del remito que espera el ajuste de su NP (no manda el aviso de "pendiente hace más de 1 hora"). */
export const PASO_ESPERANDO_AJUSTE = "esperando_ajuste"
export const MSJ_ESPERANDO_AJUSTE = "Esperando el ajuste de la NP"
/** Pasos de un ajuste en "revisar" que resuelve un gerencial a mano (cada uno con su botón). */
export const PASO_DEVOL_A_MANO = "devol_a_mano"
export const PASO_ADICIONAL_A_MANO = "adicional_a_mano"
export const PASO_NP_SIN_USO = "np_sin_uso"
/** Comienzo del mensaje del remito frenado por el control del pendiente (z1-robot.ts). */
export const MSJ_NP_NO_AJUSTADA = "La NP no quedó ajustada"

const corto = (id: string) => String(id).replace(/-/g, "").slice(0, 8)

/**
 * "Sistema Rebucret - pedido 1a2b3c4d - ajuste NP2 0001-00002090" (ASCII). Va con el número de la NP y no con su `n`:
 * con "Usar NP con saldo" el pedido usa una NP de otro pedido, que puede tener el mismo `n` que una propia.
 */
export function marcaAjuste(pedidoId: string, np: { numero?: string | null; n?: number | null }): string {
  const num = String(np.numero || "").replace(/[^\x20-\x7e]/g, "").replace(/\s+/g, " ").trim()
  return `Sistema Rebucret - pedido ${corto(pedidoId)} - ajuste ${num || `NP ${np.n ?? 0}`}`
}

// ---------------------------------------------------------------------------
// Qué cantidad tiene que quedar (3.1 a 3.4 y 15)
// ---------------------------------------------------------------------------

export type UsoAjuste = { id: string; np_id: string; m3: number; activo: boolean; created_at: string; despachado_fijo?: number | null }
export type NpAjuste = {
  id: string; n: number; m3: number; estado: string; numero: string | null; zomatik_codigo: number | null
  /** "NP con saldo": devolver (una persona hace la DEVOL a mano) o cerrada. Con una de estas no se toca (decisión 16). */
  saldo_decision?: string | null
}

/** Decisiones de "NP con saldo" con las que el ajuste no toca la NP (decisión 16): ya se decidió qué hacer con el saldo. */
export const SALDO_DECIDIDO = ["devolver", "cerrada"]

export type EntradaAjuste = {
  pedidoId: string
  status: string
  /** Los despachos del pedido que no son de prueba, de todos los días. */
  despachos: { id: string; m3: number; created_at: string }[]
  /** Desde cuándo remite el sistema (zomatik_np_config.remitir_desde): lo de antes se remitió a mano. */
  remitirDesde: string | null
  /** Todos los usos del pedido (activos y no), para repartir lo despachado como el saldo. */
  usosDelPedido: UsoAjuste[]
  nps: NpAjuste[]
  /** Los usos de esas NP y de los pedidos que las usan (como `saldoNp`), para lo que comprometen los otros pedidos. */
  usosSaldo: UsoSaldo[]
  /** Σ zomatik_remitos.m3 de ESTE pedido contra cada NP (sin anulados, también los que se acaban de armar). */
  remitidoPorNp: Record<string, number>
  /** m³ de despachos del pedido que todavía no están en ningún remito (un exceso que no entró en la NP). */
  sinRemitir: number
}

export type PlanAjuste = {
  np_id: string
  uso_id: string
  numero: string | null
  /** m³ de la NP según la base (en Zomatik tiene que decir lo mismo). */
  m3_np: number
  m3_uso: number
  /** Lo despachado del pedido que le toca a esta NP (queda en el uso). */
  m3_despachado: number
  m3_objetivo: number
  /** editar = poner la cantidad (achicar o agrandar) · nada · null = para una persona */
  tipo: "editar" | "nada" | null
  /** np_sin_uso = la NP quedó en 0 (15.5: la decide un gerencial) */
  paso?: string | null
  estado: "pendiente" | "nada" | "revisar"
  mensaje: string | null
}

/**
 * El ajuste de cada NP que usa un pedido completo (una fila por uso activo con la NP en Zomatik). La NP baja también el
 * saldo libre (decisión 16, 13/11): queda en lo despachado contra ella por todos los usos (este pedido y los demás) más
 * lo que todavía comprometen los otros pedidos activos (el piso). Si otro pedido activo la usa, no baja de lo que ese
 * pedido reserva y queda abierta; si no, queda sin libre y `zomatik_ajuste_aplicar` la cierra.
 * Revisar (sin tocar Zomatik) si: el pedido tiene despachos de antes de que remitiera el sistema; la NP ya tiene una
 * decisión de "NP con saldo" (devolver o cerrada); ni sacando solo lo que este pedido tomó y no usó (la regla del 06/11)
 * se llega al piso (la NP está reservada de más); lo remitido contra la NP no da lo despachado; o la NP queda en 0
 * (15.5: no se vacía sola, la decide una persona).
 */
export function planificarAjuste(e: EntradaAjuste): PlanAjuste[] {
  if (e.status !== "completed") return []
  const despachado = r3(e.despachos.reduce((s, d) => s + (Number(d.m3) || 0), 0))
  const reparto = despachadoPorUso(e.usosDelPedido, despachado)
  const porNp = new Map(e.nps.map((x) => [x.id, x]))
  const activos = e.usosDelPedido
    .filter((u) => u.activo !== false && porNp.get(u.np_id)?.estado === "ok" && !!porNp.get(u.np_id)?.zomatik_codigo)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  // El último uso activo del pedido se lleva lo que sobra (también lo que todavía no entró en un remito)
  const ultimoActivo = [...e.usosDelPedido].filter((u) => u.activo !== false).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).pop()
  const antesDeRemitir = !!e.remitirDesde && e.despachos.some((d) => d.created_at < e.remitirDesde!)
  return activos.map((u) => {
    const x = porNp.get(u.np_id)!
    const nombre = x.numero || `La NP ${x.n}`
    const desp = r3(reparto.get(u.id) || 0)
    // Lo que todavía necesitan los otros pedidos de la NP (y lo que ya despacharon), más lo despachado por este pedido
    // contra ella (también por un uso suyo que se desvinculó y volvió a tomarla: su foto)
    const otros = saldoNp({ id: x.id, m3: Number(x.m3) }, e.usosSaldo.filter((v) => v.pedido?.id !== e.pedidoId)).comprometido
    const propio = e.usosDelPedido.filter((v) => v.np_id === x.id).reduce((s, v) => s + (reparto.get(v.id) || 0), 0)
    const piso = r3(otros + propio)
    // Regla del 06/11 (15.3): solo lo que este pedido tomó y no usó. Queda como control: si ni así se llega al piso, la NP
    // está reservada de más
    const soloLoSuyo = r3(Number(x.m3) - Number(u.m3) + desp)
    const obj = piso
    const base = { np_id: x.id, uso_id: u.id, numero: x.numero, m3_np: r3(x.m3), m3_uso: r3(u.m3), m3_despachado: desp, m3_objetivo: obj }
    const revisar = (mensaje: string): PlanAjuste => ({ ...base, tipo: null, estado: "revisar", mensaje })
    if (antesDeRemitir) return revisar(`El pedido tiene despachos que se remitieron a mano (de antes del remito automático): ajustá la ${nombre} a mano.`)
    // Ya se decidió qué hacer con el saldo en "NP con saldo" (o se está devolviendo a mano): no se toca
    if (SALDO_DECIDIDO.includes(String(x.saldo_decision || ""))) return revisar(msjSaldoDecidido(nombre, String(x.saldo_decision)))
    if (soloLoSuyo < piso - TOL_AJUSTE) return revisar(`La ${nombre} la usan otros pedidos (${m3Texto(r3(piso - desp))} m³): no puede quedar en ${m3Texto(soloLoSuyo)} m³. No se tocó: revisala.`)
    const esperadoRemitido = r3(desp - (ultimoActivo?.id === u.id ? Number(e.sinRemitir) || 0 : 0))
    const remitido = r3(e.remitidoPorNp[x.id] || 0)
    if (Math.abs(remitido - esperadoRemitido) > TOL_AJUSTE)
      return revisar(`Lo remitido contra la ${nombre} (${m3Texto(remitido)} m³) no coincide con lo despachado (${m3Texto(esperadoRemitido)} m³). No se tocó: revisala.`)
    if (obj <= TOL_AJUSTE) return { ...revisar(`La NP ${x.numero || x.n} quedó sin uso (0 m³): eliminala o dejala pendiente en Zomatik`), paso: PASO_NP_SIN_USO }
    if (Math.abs(obj - Number(x.m3)) <= TOL_AJUSTE) return { ...base, tipo: "nada", estado: "nada", mensaje: null }
    return { ...base, tipo: "editar", estado: "pendiente", mensaje: null }
  })
}

/** "NP 60 → 40 m³" (para Actividad y el detalle del chip). */
export function textoAjuste(a: { numero?: string | null; m3_np?: number | null; m3_objetivo?: number | null }): string {
  return `${a.numero || "NP"} ${m3Texto(a.m3_np)} → ${m3Texto(a.m3_objetivo)} m³`
}

// ---------------------------------------------------------------------------
// ¿La NP tiene factura? (15.1: Zomatik no deja editar la NP)
// ---------------------------------------------------------------------------

export type Factura = { estado: "con" | "sin" | "no_se_sabe" | "contradice"; motivo: string; numero?: string | null }

const sinComentarios = (html: string | null | undefined) => String(html ?? "").replace(/<!--[\s\S]*?-->/g, "")
const textoPlano = (html: string) => sinComentarios(html).replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim()

/** El input de la cantidad del renglón (`cantidad<id>`), tal cual viene. */
function inputCantidad(html: string, sufijo: string): string | null {
  for (const m of sinComentarios(html).matchAll(/<input\b[^>]*>/gi)) {
    const nombre = m[0].match(/\bname\s*=\s*["']?([^"'\s>]+)/i)?.[1]
    if (nombre && nombre.toLowerCase() === `cantidad${sufijo}`.toLowerCase()) return m[0]
  }
  return null
}

/** ¿El detalle trae el botón Grabar? (el input `id="botgrabar"`, no una mención en un script). */
export function tieneBotonGrabar(html: string | null | undefined): boolean {
  const h = sinComentarios(html).replace(/<script\b[\s\S]*?<\/script>/gi, " ")
  return /<input\b[^>]*\bid\s*=\s*["']?botgrabar\b[^>]*>/i.test(h)
}

export type Comprobantes = { remitos: { codigo: number; numero: string }[]; facturas: { codigo: number; numero: string }[] }

/** El link de un comprobante que se sabe leer: remito (RM / RM2) o factura. */
const LINK_COMPROBANTE = /<a\b[^>]*href\s*=\s*["']?(modificar_remitos|modificar_facturasventa)\.php\?codigo=(\d+)[^>]*>([\s\S]*?)<\/a>/gi

/**
 * Los comprobantes de la NP (señal B, REAL 06/11): `GET _comprobantes.php?ftarget=pedidos&ftargetid=N`, lo que abre
 * "COMPROBANTES / OPERACIONES". Una tabla con la cabecera "comprobantes" y un `<a>` por comprobante: remitos
 * `modificar_remitos.php?codigo=` (RM / RM2) y facturas `modificar_facturasventa.php?codigo=` (F2 / FA / FB…).
 * null si la respuesta no tiene esa forma (no se pudo leer). También null (10/11, nunca se sigue a ciegas) si queda una
 * fila de la tabla sin uno de esos links, o un número con forma de remito (RM / RM2 0000-00000000) fuera de ellos.
 */
export function comprobantesDeNp(html: string | null | undefined): Comprobantes | null {
  const h = sinComentarios(html)
  if (!/class\s*=\s*["']?contnotas/i.test(h) || !/<td\b[^>]*>\s*comprobantes\s*<\/td>/i.test(h)) return null
  const out: Comprobantes = { remitos: [], facturas: [] }
  for (const m of h.matchAll(LINK_COMPROBANTE)) {
    const x = { codigo: Number(m[2]), numero: textoPlano(m[3]) }
    if (m[1].toLowerCase() === "modificar_remitos") out.remitos.push(x)
    else out.facturas.push(x)
  }
  // Cada fila (menos la cabecera y las vacías) tiene que ser un comprobante que se leyó
  for (const fila of h.match(/<tr\b(?:(?!<tr\b)[\s\S])*?<\/tr>/gi) ?? []) {
    if (/^\s*comprobantes\s*$/i.test(textoPlano(fila))) continue
    LINK_COMPROBANTE.lastIndex = 0
    if (LINK_COMPROBANTE.test(fila)) continue
    if (textoPlano(fila) || /<(a|img|input)\b/i.test(fila)) return null
  }
  // Un remito que no vino como link no se sabe de quién es
  if (/\bRM2?\s*\d{4}\s*-\s*\d{8}\b/i.test(textoPlano(h.replace(LINK_COMPROBANTE, " ")))) return null
  return out
}

/**
 * ¿La NP tiene factura? (REAL, 06/11, en 4 NP): con factura, el detalle que carga la NP (`manage_pedidos.php`, el
 * `#listaprecios`) NO trae el botón Grabar (`botgrabar`); las cantidades siguen editables. La página estática
 * `modificar_pedidos.php?codigo=N` nunca lo trae: solo cuenta el DETALLE.
 *   B. los comprobantes de la NP (`comprobantesDeNp`, null si no se pudieron leer);
 *   C. el detalle: sin `botgrabar` → con factura.
 *   A. la fila del listado dice FAC → con factura (SUPUESTO: nunca se vio).
 * Con factura = B lista una factura o el detalle no tiene el Grabar. Sin factura = el detalle tiene el Grabar y B se
 * leyó sin factura (o no se pudo leer: queda solo C). B con factura y el Grabar en el detalle: "contradice" (revisar).
 * Sin detalle o sin la cantidad del renglón: "no se sabe".
 */
export function facturaDeNp(s: { detalleHtml: string | null; renglon: Renglon | null; filaEstado?: string | null; comprobantes?: Comprobantes | null }): Factura {
  if (!s.detalleHtml || !s.renglon) return { estado: "no_se_sabe", motivo: "no se leyó el detalle de la NP" }
  if (!inputCantidad(s.detalleHtml, s.renglon.sufijo)) return { estado: "no_se_sabe", motivo: "no se encontró la cantidad del renglón" }
  const grabar = tieneBotonGrabar(s.detalleHtml)
  const factura = s.comprobantes?.facturas[0] ?? null
  if (factura && grabar) return { estado: "contradice", motivo: `Zomatik lista la factura ${factura.numero} pero la NP se puede editar`, numero: factura.numero }
  if (factura) return { estado: "con", motivo: `la NP tiene la factura ${factura.numero}`, numero: factura.numero }
  if (!grabar) return { estado: "con", motivo: "la NP no tiene el botón Grabar", numero: null }
  if (String(s.filaEstado || "").toUpperCase() === "FAC") return { estado: "con", motivo: "el listado de pedidos la muestra FAC", numero: null }
  return { estado: "sin", motivo: s.comprobantes ? "la NP se puede editar y no tiene factura" : "la NP se puede editar (no se pudieron leer sus comprobantes)" }
}

/** ¿El rechazo del Grabar habla de una factura o un comprobante? (15.1: "con factura", no se reintenta). */
export function rechazoPorFactura(texto: string | null | undefined): boolean {
  return /factur|comprobante/i.test(String(texto ?? ""))
}

/** ¿El total del listado quedó en proporción? (el renglón es uno solo: total = precio × cantidad, redondeado). */
export function totalProporcional(antes: number, cantAntes: number, despues: number, cantDespues: number): boolean {
  if (!(antes > 0) || !(cantAntes > 0)) return false
  const esperado = (antes * cantDespues) / cantAntes
  return Math.abs(despues - esperado) <= Math.max(2, esperado * 0.005)
}

// ---------------------------------------------------------------------------
// Control del remito (4.4)
// ---------------------------------------------------------------------------

/**
 * Lo que tiene que traer "Continuar" como pendiente de la NP antes de grabar el remito: los m³ de la NP después del
 * ajuste menos lo ya remitido contra ella por todos los pedidos (en Zomatik) menos lo devuelto (fase 2).
 */
export function pendienteEsperado(m3Np: number, remitidoOk: number, devuelto = 0): number {
  return r3(Number(m3Np) - (Number(remitidoOk) || 0) - (Number(devuelto) || 0))
}

// ---------------------------------------------------------------------------
// Textos (sección 9)
// ---------------------------------------------------------------------------

export const msjNpCambio = (tiene: number, esperaba: number) => `La NP cambió en Zomatik (tiene ${m3Texto(tiene)} m³ y el sistema esperaba ${m3Texto(esperaba)}). No se tocó: revisala.`
export const MSJ_FACTURA_NO_SE_SABE = "No se pudo saber si la NP tiene factura. No se tocó: revisala."
const conNumero = (factura?: string | null) => (factura ? ` (${factura})` : "")
export const msjConFactura = (devolver: number, factura?: string | null) => `La NP tiene factura${conNumero(factura)}: hacé la devolución de ${m3Texto(devolver)} m³ a mano y tocá «Ya hice la devolución».`
export const msjConFacturaExceso = (exceso: number, factura?: string | null) => `La NP tiene factura${conNumero(factura)} y se despacharon ${m3Texto(exceso)} m³ de más: hacé una NP adicional por ${m3Texto(exceso)} m³ a mano y tocá «Ya hice la NP adicional».`
export const msjFacturaContradice = (factura: string) => `Zomatik lista la factura ${factura} pero la NP se puede editar. No se tocó: revisala.`
export const msjZomatikNoDejo = (texto: string) => `Zomatik no dejó cambiar la NP: ${texto}.`
/** La NP ya tiene una decisión de "NP con saldo" (decisión 16): el ajuste no la toca. */
export const msjSaldoDecidido = (nombre: string, decision: string) =>
  `La ${nombre} ${decision === "devolver" ? "tiene el saldo para devolver" : "ya está cerrada"} en «NP con saldo». No se tocó: revisala.`

/**
 * Texto de Finalizar (solo con la llave): "Al remitir, la NP2 0001-00002090 baja de 60 a 40 m³." Con la cuenta de
 * `planificarAjuste` (decisión 16): lo que comprometen los otros pedidos (m³ − libre − lo que compromete este pedido
 * mientras está activo) más lo despachado. `libre` es el de la pantalla (nunca negativo). Con una decisión de "NP con
 * saldo" el ajuste va a revisar: texto general.
 */
export function textoFinalizar(nps: { numero: string | null; m3: number; m3_uso: number; libre?: number | null; saldo_decision?: string | null }[], despachado: number): string {
  if (nps.length === 1 && nps[0].numero && !SALDO_DECIDIDO.includes(String(nps[0].saldo_decision || ""))) {
    const x = nps[0]
    const desp = Number(despachado || 0)
    const otros = Math.max(0, Number(x.m3) - Math.max(0, Number(x.libre) || 0) - Math.max(Number(x.m3_uso) || 0, desp))
    const obj = r3(otros + desp)
    if (Math.abs(obj - Number(x.m3)) <= TOL_AJUSTE) return `Al remitir, la ${x.numero} queda en ${m3Texto(x.m3)} m³.`
    if (obj > TOL_AJUSTE) return `Al remitir, la ${x.numero} ${obj < Number(x.m3) ? "baja" : "sube"} de ${m3Texto(x.m3)} a ${m3Texto(obj)} m³.`
  }
  return "Al remitir, la NP se ajusta a lo despachado."
}
