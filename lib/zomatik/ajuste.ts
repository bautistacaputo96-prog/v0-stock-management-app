/**
 * Zomatik · ajustar la NP a lo despachado al finalizar el pedido — funciones puras (sin red, sin base).
 * Spec: docs/specs/2026-11-06-ajustar-np-al-finalizar.md (la sección 15, decisiones de Bautista del 06/11, manda).
 * Se prueban con `npm run test:zomatik-ajuste`.
 *
 *   - Qué cantidad tiene que quedar en cada NP del pedido (decisión 16, 13/11, reemplaza a la 15.3): lo despachado
 *     contra ella por todos los usos + lo que todavía comprometen los pedidos activos (`comprometidoOtros`, la cuenta
 *     del saldo con lo despachado de los pedidos cerrados), con el libre en 0. Lo que reservan otros pedidos activos no
 *     se toca.
 *   - "Tiene factura" (15.1): Zomatik no deja editar la NP. Se mira el detalle de la NP (señal C: sin el botón Grabar,
 *     REAL) y sus comprobantes (señal B, REAL). Lo que no se puede leer: "no se sabe".
 *   - El pendiente que tiene que traer el remito después del ajuste (4.4).
 * Cómo se ve una NP facturada es REAL (06/11); la respuesta del Grabar al editar sigue SUPUESTO hasta la captura 4
 * (lib/__fixtures__/zomatik-ajuste/README.md).
 */
import { despachadoPorUso, esNpTraida, SUCURSAL_REBUCRET, type Renglon, type UsoSaldo } from "@/lib/zomatik/np"

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
  /** Quién la decidió: "Sistema" = la cerró el ajuste de otro pedido (`zomatik_ajuste_aplicar`), no una persona. */
  saldo_decision_por?: string | null
}

/** Decisiones de "NP con saldo" con las que el ajuste no toca la NP (decisión 16): ya se decidió qué hacer con el saldo. */
export const SALDO_DECIDIDO = ["devolver", "cerrada"]
/** Quien firma la NP cerrada por `zomatik_ajuste_aplicar` (supabase/migrations/202611061200_zomatik_np_ajuste.sql). */
export const DECIDE_SISTEMA = "Sistema"

/**
 * La decisión de "NP con saldo" que frena el ajuste (decisión 16), o null. La NP que cerró el ajuste de OTRO pedido de
 * la misma NP (firma "Sistema", sin libre) no frena: el ajuste de este pedido sigue (y da "nada" si ya está en lo justo).
 */
export function saldoDecidido(np: { saldo_decision?: string | null; saldo_decision_por?: string | null }): "devolver" | "cerrada" | null {
  if (np.saldo_decision === "devolver") return "devolver"
  if (np.saldo_decision === "cerrada" && np.saldo_decision_por !== DECIDE_SISTEMA) return "cerrada"
  return null
}

const pedidoActivo = (st: string | null | undefined) => !!st && st !== "cancelled" && st !== "completed"

/**
 * Lo que no puede salir de la NP por los usos de OTROS pedidos (decisión 16): un uso activo de un pedido activo, lo que
 * reserva (o lo despachado, si es más); de un pedido cerrado (completo o cancelado), lo despachado contra la NP aunque
 * pase lo que reservó; desactivado o de un pedido borrado, su foto. Es `saldoNp().comprometido` salvo los cerrados
 * (ahí `saldoNp` toma el menor entre lo reservado y lo despachado, y la NP podría quedar por debajo de lo despachado).
 */
export function comprometidoOtros(npId: string, usos: UsoSaldo[]): number {
  const porPedido = new Map<string, UsoSaldo[]>()
  for (const u of usos) if (u.pedido) porPedido.set(u.pedido.id, [...(porPedido.get(u.pedido.id) || []), u])
  let total = 0
  for (const u of usos.filter((x) => x.np_id === npId)) {
    if (!u.activo || !u.pedido) {
      total += Number(u.despachado_fijo) || 0
      continue
    }
    const desp = despachadoPorUso(porPedido.get(u.pedido.id) || [u], Number(u.pedido.dispatched_m3) || 0).get(u.id) || 0
    total += pedidoActivo(u.pedido.status) ? Math.max(Number(u.m3) || 0, desp) : desp
  }
  return r3(total)
}

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
 * decisión de "NP con saldo" (devolver o cerrada por una persona); el piso pide agrandar la NP más de lo que este pedido
 * despachó de más (la NP está reservada de más); lo remitido contra la NP no da lo despachado; o la NP queda en 0
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
    const otros = comprometidoOtros(x.id, e.usosSaldo.filter((v) => v.pedido?.id !== e.pedidoId))
    const propio = e.usosDelPedido.filter((v) => v.np_id === x.id).reduce((s, v) => s + (reparto.get(v.id) || 0), 0)
    const piso = r3(otros + propio)
    // Agrandar solo por lo que este pedido despachó de más sobre lo que reservó (3.3). Si hace falta más, la NP está
    // reservada de más (o la tocaron): para una persona. No se compara con "sacar solo lo de este pedido" (la regla del
    // 06/11): el ajuste de otro pedido de la NP ya pudo bajar el sobrante de este
    const tope = r3(Number(x.m3) + Math.max(0, desp - Number(u.m3)))
    const obj = piso
    const base = { np_id: x.id, uso_id: u.id, numero: x.numero, m3_np: r3(x.m3), m3_uso: r3(u.m3), m3_despachado: desp, m3_objetivo: obj }
    const revisar = (mensaje: string): PlanAjuste => ({ ...base, tipo: null, estado: "revisar", mensaje })
    if (antesDeRemitir) return revisar(`El pedido tiene despachos que se remitieron a mano (de antes del remito automático): ajustá la ${nombre} a mano.`)
    // Ya se decidió qué hacer con el saldo en "NP con saldo" (o se está devolviendo a mano): no se toca
    const decidido = saldoDecidido(x)
    if (decidido) return revisar(msjSaldoDecidido(nombre, decidido))
    if (piso > tope + TOL_AJUSTE) return revisar(msjPisoNoDa(nombre, piso, Number(x.m3)))
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
/** La decisión llegó con el ajuste en marcha (antes de pasarlo a la base o al reintentar después de un corte). */
export const msjSaldoDecididoEnMedio = (nombre: string, decision: string) =>
  `Mientras se ajustaba la ${nombre}, ${decision === "devolver" ? "se pidió devolver su saldo" : "se cerró"} en «NP con saldo». Revisá la NP en Zomatik antes de seguir.`
/** Lo despachado y lo reservado de la NP (de este pedido, sus usos desvinculados y los otros pedidos) no entra en ella. */
export const msjPisoNoDa = (nombre: string, piso: number, m3: number) =>
  `La ${nombre} tiene ${m3Texto(piso)} m³ despachados o reservados y es de ${m3Texto(m3)} m³. No se tocó: revisala.`
/** "NP con saldo": la NP tiene un ajuste en marcha (decisión 16): no se devuelve ni se reserva hasta que termine. */
export const MSJ_NP_AJUSTANDOSE = "La NP se está ajustando a lo despachado: esperá unos minutos."
/** Ajustes que frenan "NP con saldo" (la NP no se muestra, no se devuelve ni se reserva). */
export const AJUSTE_EN_CURSO: EstadoAjuste[] = ["pendiente", "generando", "revisar"]

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

// ---------------------------------------------------------------------------
// Editar la NP cuando el pedido cambia de m³ antes de terminar (docs/specs/2026-11-18-editar-np-al-cambiar-pedido.md)
// Es el mismo robot del ajuste con otro origen: el ajuste deja la NP en lo despachado AL TERMINAR; la edición la deja en
// lo que el pedido necesita AHORA. Las dos van en `zomatik_np_ajustes` (columna `origen`).
// ---------------------------------------------------------------------------

/** Origen de una fila de `zomatik_np_ajustes`: el ajuste al finalizar o la edición por un cambio del pedido. */
export const ORIGEN_FINALIZAR = "finalizar"
export const ORIGEN_PEDIDO = "pedido"
/** Una edición que todavía no terminó (una sola por NP: índice único parcial de la migración 202611181400). */
export const EDICION_ABIERTA: EstadoAjuste[] = ["pendiente", "generando", "revisar", "error"]
/** Pasos de una edición que ya pudo tocar Zomatik (o pasarlo a la base): su cantidad no se cambia más. */
export const PASOS_EDICION_FIJA = [...PASOS_GRABAR_AJUSTE, "aplicar"]
/** Minutos de espera desde el último cambio del pedido, para juntar 8 → 9 → 10 en una sola edición (decisión 12.5). */
export const MIN_JUNTAR_EDICION = 2

/**
 * ¿La edición ya no se puede cambiar? El robot la está trabajando (generando), se cortó en el Grabar o al pasarla a la
 * base, o espera a una persona (revisar / error). Una "fija" no se actualiza ni se anula al cambiar el pedido.
 */
export function edicionFija(e: { estado: string; paso?: string | null; aplicado_at?: string | null }): boolean {
  if (["generando", "revisar", "error"].includes(e.estado)) return true
  return e.estado === "pendiente" && (PASOS_EDICION_FIJA.includes(e.paso || "") || !!e.aplicado_at)
}

/**
 * "Sistema Rebucret - pedido 1a2b3c4d - edicion NP 0001-00001194 - 1" (ASCII; clave interna, no se graba en Zomatik).
 * `k` = cuántas ediciones de esa NP y ese pedido hubo + 1 (la marca es única en la tabla).
 */
export function marcaEdicion(pedidoId: string, np: { numero?: string | null; n?: number | null }, k: number): string {
  const num = String(np.numero || "").replace(/[^\x20-\x7e]/g, "").replace(/\s+/g, " ").trim()
  return `Sistema Rebucret - pedido ${corto(pedidoId)} - edicion ${num || `NP ${np.n ?? 0}`} - ${Math.max(1, Math.floor(Number(k) || 1))}`
}

/** Lo que hace falta de la NP para saber si se puede editar (lo que se lee de `zomatik_np`). */
export type NpParaEditar = {
  tipo: string; marca: string; estado: string; zomatik_codigo: number | null; sucursal: string | null; paso: string | null; saldo_decision?: string | null
}
/** Las filas de `zomatik_np_ajustes` de esa NP (de cualquier origen y pedido). */
export type FilaAjusteNp = { origen?: string | null; estado: string; tipo: string | null; con_factura: boolean | null }

export type Editable = { editable: boolean; espera: boolean; motivo: string | null }

/**
 * ¿Se puede editar la cantidad de esta NP en Zomatik cuando el pedido cambia? (3.1). Todo se tiene que cumplir:
 * la llave `editar_activo` de la planta; una NP nueva con la marca del sistema (ni traída ni de proyecto); en Zomatik
 * (`ok`, con código, sucursal 18, sin `autorizar_revisar`); sin decisión de "NP con saldo"; sin otro pedido activo que
 * la use; y sin factura conocida ni una edición que ya terminó como "no se pudo". Si la NP se está generando, la
 * edición ESPERA (cuenta como editable, con `espera`).
 */
export function npEditable(o: { llave: boolean; np: NpParaEditar; otroPedidoActivo: boolean; ajustes: FilaAjusteNp[] }): Editable {
  const no = (motivo: string): Editable => ({ editable: false, espera: false, motivo })
  const { np } = o
  if (!o.llave) return no("La edición de la NP está apagada en la planta.")
  if (np.tipo !== "nueva") return no("Es de un proyecto.")
  if (esNpTraida(np.marca)) return no("La NP la trajeron de Zomatik.")
  if (SALDO_DECIDIDO.includes(String(np.saldo_decision || ""))) return no("Ya se decidió qué hacer con su saldo.")
  if (o.otroPedidoActivo) return no("La usa otro pedido activo.")
  if (o.ajustes.some((a) => a.con_factura === true)) return no("La NP tiene factura.")
  if (o.ajustes.some((a) => (a.origen ?? ORIGEN_FINALIZAR) === ORIGEN_PEDIDO && ["nada", "a_mano"].includes(a.estado) && ["adicional", "devol"].includes(a.tipo || "")))
    return no("Zomatik no dejó cambiarla antes.")
  if (np.estado === "generando") return { editable: true, espera: true, motivo: "Esperando que salga la NP." }
  if (np.estado !== "ok" || !np.zomatik_codigo || np.sucursal !== SUCURSAL_REBUCRET) return no("La NP no está en Zomatik.")
  if (np.paso === "autorizar_revisar") return no("La NP está para revisar.")
  return { editable: true, espera: false, motivo: null }
}

export type EntradaEdicion = {
  npId: string
  pedidoId: string
  /** Lo despachado del pedido (`scheduled_dispatches.dispatched_m3`). */
  despachado: number
  /** La reserva nueva del pedido en esta NP (la decide `planificarNp`). */
  m3Uso: number
  /** Todos los usos del pedido (activos y no), para repartir lo despachado como el saldo. */
  usosDelPedido: UsoAjuste[]
  /** Los usos de esta NP y de los pedidos que la usan (como `saldoNp`); los de este pedido se ignoran. */
  usosSaldo: UsoSaldo[]
  /** Σ zomatik_remitos.m3 de la NP, de todos los pedidos (remito ok o cortado en Grabar, como `remitidoContra`). */
  remitido: number
}

export type ObjetivoEdicion = { ok: true; m3_objetivo: number; m3_despachado: number } | { ok: false; m3_objetivo: number; mensaje: string }

/**
 * Cuántos m³ tiene que quedar la NP después de editarla (3.2): lo que comprometen los otros pedidos + máx(reserva
 * nueva, lo despachado de este pedido contra ella) + la foto de un uso suyo que se desvinculó de esta NP. Es la cuenta
 * del ajuste al finalizar (decisión 16) con la reserva en lugar de lo despachado: la NP queda sin libre.
 * Pisos (si no se cumplen, `ok: false` y no se toca): más de 0 y no menos de lo remitido contra la NP.
 */
export function objetivoEdicion(e: EntradaEdicion): ObjetivoEdicion {
  const usos = e.usosDelPedido.map((u) => (u.np_id === e.npId && u.activo !== false ? { ...u, m3: r3(e.m3Uso) } : u))
  const reparto = despachadoPorUso(usos, Number(e.despachado) || 0)
  const otros = comprometidoOtros(e.npId, e.usosSaldo.filter((v) => v.pedido?.id !== e.pedidoId))
  const activos = usos.filter((u) => u.np_id === e.npId && u.activo !== false)
  const desp = r3(activos.reduce((s, u) => s + (reparto.get(u.id) || 0), 0))
  const fotos = r3(usos.filter((u) => u.np_id === e.npId && u.activo === false).reduce((s, u) => s + (Number(u.despachado_fijo) || 0), 0))
  const obj = r3(otros + Math.max(r3(e.m3Uso), desp) + fotos)
  if (obj <= TOL_AJUSTE) return { ok: false, m3_objetivo: obj, mensaje: "La NP quedaría en 0 m³: no se toca (la decide una persona)." }
  if (obj + TOL_AJUSTE < Number(e.remitido || 0)) return { ok: false, m3_objetivo: obj, mensaje: msjDebajoDeRemitido(obj, Number(e.remitido)) }
  return { ok: true, m3_objetivo: obj, m3_despachado: desp }
}

export const msjDebajoDeRemitido = (obj: number, remitido: number) =>
  `La NP quedaría en ${m3Texto(obj)} m³ y ya se remitieron ${m3Texto(remitido)} m³ contra ella. No se tocó: revisala.`

// Textos de la edición (secciones 5.3 y 7)
export const MSJ_EDICION_ESPERA_NP = "Esperando que salga la NP."
export const MSJ_EDICION_ESPERA_OTRO = "Esperando otro cambio de la NP."
export const MSJ_EDICION_LO_DEJA_EL_AJUSTE = "Lo deja justo el ajuste al finalizar."
export const MSJ_EDICION_YA_NO_HACE_FALTA = "El pedido ya no necesita este cambio."
export const MSJ_EDICION_CANCELADO = "El pedido se canceló."
export const MSJ_AJUSTE_ESPERA_EDICION = "Esperando el cambio de la NP."
/** "NP 0001-00001194 8 → 9 m³" (Actividad y el título del chip). */
export const textoEdicion = (numero: string | null | undefined, antes: number | null | undefined, despues: number | null | undefined) => `${numero || "NP"} ${m3Texto(antes)} → ${m3Texto(despues)} m³`
/** "La NP 0001-00001194 pasa a 9 m³ en Zomatik (pendiente)". */
export const msjEdicionPendiente = (numero: string | null | undefined, m3: number) => `La ${numero || "NP"} pasa a ${m3Texto(m3)} m³ en Zomatik (pendiente)`
