/**
 * Control de stock de materia prima · nuestro sistema contra Zomatik (INVENTARIO › MOVIMIENTOS STOCK). Funciones puras:
 * sin red, sin base y sin React. Se prueban con `npm run test:control-stock`. Especificación: docs/control-stock-mp.md.
 *
 * Nuestro lado: el stock de un día se reconstruye hacia atrás desde `materials.current_stock` restando lo que pasó
 * después (ingresos por `entry_date`, consumos y ajustes por `movement_date`). Si el libro desde el último recuento no
 * cierra con `current_stock`, la diferencia es un "ajuste sin registro" (alguien tocó el stock o un ingreso a mano).
 *
 * Zomatik: el reporte trae Fecha | Comprobante | Descripcion | Movimiento | Saldo y una fila "Total acumulado: N". En el
 * ejemplo real (Canning, cemento, 20 al 27/10) el total (68,727) es el saldo ANTERIOR al primer movimiento
 * (102,847 − 34,120), no el último saldo (112,540): el stock final es el último Saldo. Se verifica en cada lectura.
 */
import { col, parseFecha, parseNumero } from "@/lib/zomatik/parseo"
import { claveMaterial, normalizarRemito, sumarDias, ddmm } from "@/lib/control-ingresos/cruce"

// ---------------------------------------------------------------------------
// Materiales y parámetros
// ---------------------------------------------------------------------------

/** Los 5 que se controlan, con su artículo de Zomatik (código visible) y la línea del buscador. */
export const MATERIALES = [
  { clave: "arena_fina", nombre: "Arena Fina", codigo: "10000004", linea: "131" },
  { clave: "arena_0_6", nombre: "Arena Trituración 0/6", codigo: "10000001", linea: "131" },
  { clave: "piedra_6_12", nombre: "Piedra 6/12", codigo: "10000612", linea: "131" },
  { clave: "piedra_6_20", nombre: "Piedra 6/20", codigo: "10000005", linea: "131" },
  { clave: "cemento", nombre: "CPC 40", codigo: "10000026", linea: "130" },
] as const
export type ClaveMaterial = (typeof MATERIALES)[number]["clave"]

/** En rojo si la diferencia supera este %. */
export const UMBRAL_PCT = 5
/** Diferencias de menos de esto (t) no cuentan como rojo aunque el % sea grande (stocks cerca de 0). */
export const MINIMO_T = 0.5
/** Un reporte con esto o más renglones puede venir cortado. */
export const SOSPECHA_RENGLONES = 300
/** Zomatik sin movimientos en los últimos 10 días, con consumos nuestros después: puede venir cortado. */
export const SOSPECHA_DIAS_SIN_MOVIMIENTOS = 10
/** Tolerancia para comprobar que el reporte de Zomatik cierra (saldo anterior + movimientos = saldo). */
const TOL_SALDO = 0.01

export const materialDeNombre = (nombre: string): ClaveMaterial | null => {
  const c = claveMaterial(nombre)
  return (MATERIALES.find((m) => m.clave === c)?.clave as ClaveMaterial) || null
}

/**
 * "Actualizar ahora" no se usa de 16:00 a 16:59 de Argentina: el cron está a las 16:25 (19:25 UTC), pero en el plan
 * Hobby de Vercel puede caer en cualquier minuto de esa hora.
 */
export function enHorarioDelCron(ahora: number = Date.now()): boolean {
  const d = new Date(ahora - 3 * 3600_000)
  const min = d.getUTCHours() * 60 + d.getUTCMinutes()
  return min >= 16 * 60 && min < 17 * 60
}
export const MENSAJE_HORARIO_CRON = "Entre las 16 y las 17 se actualiza solo (el control diario corre en algún momento de esa hora)"

/** Días de `desde` a `hasta` (incluidos). */
export function dias(desde: string, hasta: string): string[] {
  const out: string[] = []
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) out.push(d)
  return out
}

/** Primer día del mes de `fecha`. */
export const inicioDeMes = (fecha: string) => `${fecha.slice(0, 8)}01`

// ---------------------------------------------------------------------------
// Zomatik: el reporte
// ---------------------------------------------------------------------------

export type MovZomatik = { fecha: string; orden: number; comprobante: string; prefijo: string; descripcion: string; movimiento: number; saldo: number }

/** "RMP 0002-02742081" → "RMP" (remito de compra) · "RMI 0001-00006741" → "RMI" (remito interno, consumo). */
export const prefijoComprobante = (c: unknown) => (String(c ?? "").trim().match(/^[A-Za-z]{2,6}/)?.[0] || "").toUpperCase()

const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()

/**
 * Lee el reporte (matriz de filas, del Excel o de la página). Busca el encabezado (Fecha … Saldo), los movimientos y la
 * fila "Total acumulado: N" (el número puede venir en la misma celda o en la siguiente).
 */
export function leerReporteStock(filas: (string | number)[][]): { movs: MovZomatik[]; totalAcumulado: number | null; encabezado: boolean } {
  const iEnc = filas.findIndex((f) => f.some((c) => norm(c) === "fecha") && f.some((c) => norm(c).startsWith("saldo")))
  let totalAcumulado: number | null = null
  for (const f of filas) {
    const i = f.findIndex((c) => /total\s+acumulado/i.test(String(c)))
    if (i < 0) continue
    const enCelda = String(f[i]).split(/:/)[1]
    const n = parseNumero(enCelda && enCelda.trim() ? enCelda : f.slice(i + 1).find((c) => String(c).trim() !== ""))
    if (n !== null) totalAcumulado = n
  }
  if (iEnc < 0) return { movs: [], totalAcumulado, encabezado: false }
  const enc = filas[iEnc].map(norm)
  const idx = (re: RegExp) => enc.findIndex((h) => re.test(h))
  const cF = idx(/^fecha/)
  const cC = idx(/comprobante/)
  const cD = idx(/descrip/)
  const cM = idx(/^movimiento/)
  const cS = idx(/^saldo/)
  const movs: MovZomatik[] = []
  for (const f of filas.slice(iEnc + 1)) {
    const fecha = parseFecha(f[cF])
    const movimiento = parseNumero(f[cM])
    const saldo = parseNumero(f[cS])
    if (!fecha || movimiento === null || saldo === null) continue
    const comprobante = String(f[cC] ?? "").trim()
    movs.push({ fecha, orden: movs.length, comprobante, prefijo: prefijoComprobante(comprobante), descripcion: String(f[cD] ?? "").trim(), movimiento, saldo })
  }
  return { movs, totalAcumulado, encabezado: true }
}

/**
 * Saldos de la lectura: inicial = primer saldo − primer movimiento; final = último saldo. `cierra` = cada saldo es el
 * anterior más su movimiento (si no, el reporte vino cortado o desordenado). `totalEsInicial` = el "Total acumulado"
 * coincide con el saldo inicial (lo visto en el ejemplo real); null si no hay con qué comparar.
 */
export function verificarLectura(movs: MovZomatik[], totalAcumulado: number | null): { inicial: number; final: number; cierra: boolean; totalEsInicial: boolean | null } {
  if (!movs.length) return { inicial: totalAcumulado ?? 0, final: totalAcumulado ?? 0, cierra: true, totalEsInicial: null }
  const inicial = movs[0].saldo - movs[0].movimiento
  let cierra = true
  for (let i = 1; i < movs.length; i++) if (Math.abs(movs[i - 1].saldo + movs[i].movimiento - movs[i].saldo) > TOL_SALDO) cierra = false
  return { inicial, final: movs[movs.length - 1].saldo, cierra, totalEsInicial: totalAcumulado === null ? null : Math.abs(totalAcumulado - inicial) <= TOL_SALDO }
}

/**
 * ¿La lectura puede venir cortada? 300 renglones o más, una página con "Siguiente" o `pagina=`, o Zomatik sin
 * movimientos desde hace más de 10 días cuando nosotros tenemos consumos después. null = no.
 */
export function sospechaCorte(d: { movs: MovZomatik[]; paginado: boolean; hoy: string; ultimoConsumoNuestro: string | null }): string | null {
  if (d.movs.length >= SOSPECHA_RENGLONES) return `trajo ${d.movs.length} renglones (puede venir cortado)`
  if (d.paginado) return "la página trae más páginas (Siguiente)"
  const ultimaZ = d.movs.length ? d.movs.map((m) => m.fecha).sort().pop()! : null
  const limite = sumarDias(d.hoy, -SOSPECHA_DIAS_SIN_MOVIMIENTOS)
  if (d.ultimoConsumoNuestro && (!ultimaZ || ultimaZ < limite) && d.ultimoConsumoNuestro > (ultimaZ || "")) {
    return `Zomatik no tiene movimientos ${ultimaZ ? `desde el ${ddmm(ultimaZ)}` : "en el período"} y nosotros tenemos consumos hasta el ${ddmm(d.ultimoConsumoNuestro)}`
  }
  return null
}

/** Las dos mitades de un período partido, una detrás de la otra (el orden sigue). */
export function unirMitades(a: MovZomatik[], b: MovZomatik[]): MovZomatik[] {
  return [...a, ...b].map((m, i) => ({ ...m, orden: i }))
}

/** Mitades de un período (la primera termina el día del medio). */
export function partirPeriodo(desde: string, hasta: string): [{ desde: string; hasta: string }, { desde: string; hasta: string }] | null {
  if (desde >= hasta) return null
  const n = dias(desde, hasta).length
  const medio = sumarDias(desde, Math.floor(n / 2) - 1)
  return [{ desde, hasta: medio }, { desde: sumarDias(medio, 1), hasta }]
}

/**
 * ¿El reporte es de este artículo y este depósito? Se mira con los remitos de compra (RMP) que trae, contra la copia de
 * ESTAD R.COMPRA: si trae remitos de otro artículo u otro depósito, el filtro `idarticulo` no anduvo; si el artículo
 * tuvo compras en el período y no trae ningún RMP, tampoco. Sin compras en el período: "sin verificar".
 */
export function verificarArticulo(
  movs: MovZomatik[],
  propios: Set<string>,
  ajenos: Set<string>,
): { ok: boolean; estado: "verificado" | "sin_verificar" | "error"; motivo?: string } {
  const rmp = movs.filter((m) => m.prefijo === "RMP").map((m) => normalizarRemito(m.comprobante)).filter((n): n is string => !!n)
  const deOtros = rmp.filter((n) => ajenos.has(n) && !propios.has(n))
  if (deOtros.length) return { ok: false, estado: "error", motivo: `trajo ${deOtros.length} remitos de compra de otro artículo o depósito (¿no filtró por artículo?)` }
  const encontrados = rmp.filter((n) => propios.has(n)).length
  if (propios.size > 0 && encontrados === 0) return { ok: false, estado: "error", motivo: `no trajo ninguno de los ${propios.size} remitos de compra del artículo` }
  return encontrados > 0 ? { ok: true, estado: "verificado" } : { ok: true, estado: "sin_verificar" }
}

// ---------------------------------------------------------------------------
// Resúmenes de un período
// ---------------------------------------------------------------------------

export type Dia = { fecha: string; entro: number; salio: number; ajustes: number; saldo: number }
export type Lado = { inicio: number; entro: number; salio: number; ajustes: number; final: number; porDia: Dia[]; porPrefijo?: Record<string, { entro: number; salio: number; n: number }> }

/** Un movimiento nuestro en kg: entrada (+), consumo (lo que salió, en positivo; negativo = devolución) y ajuste (con signo). */
export type MovNuestro = { fecha: string; tipo: "entrada" | "consumo" | "ajuste"; kg: number }

const efecto = (m: MovNuestro) => (m.tipo === "consumo" ? -m.kg : m.kg)
const t = (kg: number) => kg / 1000

/** Nuestro lado en toneladas, reconstruido hacia atrás desde el stock actual (kg). */
export function resumenNuestro(actualKg: number, movs: MovNuestro[], desde: string, hasta: string): Lado {
  const despuesDe = (d: string) => movs.reduce((s, m) => (m.fecha > d ? s + efecto(m) : s), 0)
  const enDia = (d: string) => movs.filter((m) => m.fecha === d)
  const porDia: Dia[] = dias(desde, hasta).map((d) => {
    const ms = enDia(d)
    return {
      fecha: d,
      entro: t(ms.filter((m) => m.tipo === "entrada").reduce((s, m) => s + m.kg, 0)),
      salio: t(ms.filter((m) => m.tipo === "consumo").reduce((s, m) => s + m.kg, 0)),
      ajustes: t(ms.filter((m) => m.tipo === "ajuste").reduce((s, m) => s + m.kg, 0)),
      saldo: t(actualKg - despuesDe(d)),
    }
  })
  return {
    inicio: t(actualKg - despuesDe(sumarDias(desde, -1))),
    entro: porDia.reduce((s, d) => s + d.entro, 0),
    salio: porDia.reduce((s, d) => s + d.salio, 0),
    ajustes: porDia.reduce((s, d) => s + d.ajustes, 0),
    final: t(actualKg - despuesDe(hasta)),
    porDia,
  }
}

/** "Ajuste por recuento. Anterior: 24220 kg, Nuevo: 57320 kg" → 57320. */
export function nuevoDeRecuento(notas: unknown): number | null {
  const m = String(notas ?? "").match(/Nuevo:\s*(-?[\d.,]+)\s*kg/i)
  return m ? parseNumero(m[1]) : null
}

/**
 * Libro desde el último recuento: "Nuevo" del recuento + lo que entró, salió y se ajustó después (por cuándo se cargó).
 * `sinRegistro` = stock actual − libro (kg). null si no hay recuento.
 */
export function libroDesdeRecuento(actualKg: number, recuento: { nuevoKg: number; creadoAt: string } | null, movs: (MovNuestro & { creadoAt: string })[]): { libroKg: number; sinRegistroKg: number } | null {
  if (!recuento) return null
  const libroKg = recuento.nuevoKg + movs.filter((m) => m.creadoAt > recuento.creadoAt).reduce((s, m) => s + efecto(m), 0)
  return { libroKg, sinRegistroKg: actualKg - libroKg }
}

/**
 * Lado de Zomatik en el período, con la lectura guardada (desde `lectura.desde`, con su saldo inicial). null si el
 * período empieza antes de lo leído.
 */
export function resumenZomatik(lectura: { desde: string; saldoInicial: number }, movs: MovZomatik[], desde: string, hasta: string): Lado | null {
  if (desde < lectura.desde) return null
  const orden = [...movs].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.orden - b.orden))
  const saldoAl = (d: string) => {
    let s = lectura.saldoInicial
    for (const m of orden) if (m.fecha <= d) s = m.saldo
    return s
  }
  const enRango = orden.filter((m) => m.fecha >= desde && m.fecha <= hasta)
  const porPrefijo: Record<string, { entro: number; salio: number; n: number }> = {}
  for (const m of enRango) {
    const p = (porPrefijo[m.prefijo || "?"] ||= { entro: 0, salio: 0, n: 0 })
    if (m.movimiento >= 0) p.entro += m.movimiento
    else p.salio += -m.movimiento
    p.n++
  }
  const porDia: Dia[] = dias(desde, hasta).map((d) => {
    const ms = enRango.filter((m) => m.fecha === d)
    return { fecha: d, entro: ms.filter((m) => m.movimiento > 0).reduce((s, m) => s + m.movimiento, 0), salio: ms.filter((m) => m.movimiento < 0).reduce((s, m) => s - m.movimiento, 0), ajustes: 0, saldo: saldoAl(d) }
  })
  return {
    inicio: saldoAl(sumarDias(desde, -1)),
    entro: porDia.reduce((s, d) => s + d.entro, 0),
    salio: porDia.reduce((s, d) => s + d.salio, 0),
    ajustes: 0,
    final: saldoAl(hasta),
    porDia,
    porPrefijo,
  }
}

// ---------------------------------------------------------------------------
// Comparación
// ---------------------------------------------------------------------------

export type Diferencia = { t: number; pct: number | null; rojo: boolean }

/** Diferencia nuestro − Zomatik, en t y % sobre Zomatik. Rojo si supera el 5 % (y al menos media tonelada). */
export function diferencia(nuestro: number, zomatik: number): Diferencia {
  const d = nuestro - zomatik
  const pct = Math.abs(zomatik) < 1e-9 ? (Math.abs(d) < 1e-9 ? 0 : null) : (d / Math.abs(zomatik)) * 100
  return { t: d, pct, rojo: Math.abs(d) >= MINIMO_T && (pct === null || Math.abs(pct) > UMBRAL_PCT) }
}

/**
 * Compara los dos lados. Rojo por el stock final o por el neto (entró − salió): una devolución que en un sistema resta
 * de lo que entró y en el otro suma a lo que salió no marca rojo si el neto coincide. Entró y salió solos se marcan
 * solo si además el neto no coincide.
 */
export function comparar(n: Lado, z: Lado | null): { final: Diferencia; neto: Diferencia; entro: Diferencia; salio: Diferencia; rojo: boolean } | null {
  if (!z) return null
  const final = diferencia(n.final, z.final)
  const neto = diferencia(n.entro - n.salio, z.entro - z.salio)
  const entro = diferencia(n.entro, z.entro)
  const salio = diferencia(n.salio, z.salio)
  entro.rojo = entro.rojo && neto.rojo
  salio.rojo = salio.rojo && neto.rojo
  return { final, neto, entro, salio, rojo: final.rojo || neto.rojo }
}

// ---------------------------------------------------------------------------
// Mail (va dentro del mail de las 16:25 del control de ingresos)
// ---------------------------------------------------------------------------

/** `vieja`: fecha de la última lectura buena de Zomatik si es vieja (la fila va en gris y no cuenta como rojo). */
export type FilaMail = { clave: string; planta: string; material: string; nuestroFinal: number; zomatikFinal: number | null; dif: Diferencia | null; aviso?: string | null; vieja?: string | null }

/** Filas en rojo que cuentan (no las de lectura vieja ni sin datos). */
export const clavesRojas = (filas: FilaMail[]) => filas.filter((f) => f.dif?.rojo && !f.vieja && f.zomatikFinal !== null).map((f) => f.clave)

/** Una fila en rojo dispara el mail solo si es nueva: no estaba en rojo en el último mail. */
export const rojasNuevas = (hoy: string[], ultimoMail: string[]) => hoy.filter((k) => !ultimoMail.includes(k))

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
export const fmtT = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
export const fmtPct = (p: number | null) => (p === null ? "-" : `${p > 0 ? "+" : ""}${p.toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`)

/** Tabla corta: stock final de los dos lados y la diferencia; las filas en rojo, marcadas. */
export function seccionMailStock(d: { filas: FilaMail[]; desde: string; hasta: string; link: string; aviso?: string | null }): string {
  const TH = `style="text-align:left;font-weight:normal;color:#64748b;padding:3px 6px;border-bottom:1px solid #e2e8f0;font-size:11px"`
  const TD = (color: string) => `style="padding:3px 6px;border-bottom:1px solid #f1f5f9;font-size:12px;${color ? `color:${color}` : ""}"`
  const rojas = clavesRojas(d.filas).length
  const filas = d.filas
    .map((f) => {
      const c = f.vieja ? "#94a3b8" : f.dif?.rojo ? "#b91c1c" : ""
      const aviso = [f.vieja ? `lectura del ${ddmm(f.vieja)}` : null, f.aviso].filter(Boolean).join(" · ")
      return `<tr><td ${TD(c)}>${esc(f.planta)}</td><td ${TD(c)}>${esc(f.material)}</td><td ${TD(c)}>${fmtT(f.nuestroFinal)} t</td><td ${TD(c)}>${f.zomatikFinal === null ? "sin datos" : `${fmtT(f.zomatikFinal)} t`}</td><td ${TD(c)}>${f.dif ? `${fmtT(f.dif.t)} t (${fmtPct(f.dif.pct)})` : "-"}</td><td ${TD(c)}>${esc(aviso)}</td></tr>`
    })
    .join("")
  return `<div style="font-size:14px;margin:14px 0 6px">Stock de materia prima: nuestro sistema y Zomatik (${esc(ddmm(d.desde))} al ${esc(ddmm(d.hasta))})${rojas ? ` · ${rojas} en rojo` : ""}</div>
    ${d.aviso ? `<div style="background:#fef3c7;color:#78350f;padding:6px 8px;border-radius:6px;margin-bottom:6px">${esc(d.aviso)}</div>` : ""}
    <table style="width:100%;border-collapse:collapse;margin:2px 0 6px">
      <tr><th ${TH}>Planta</th><th ${TH}>Material</th><th ${TH}>Stock final nuestro</th><th ${TH}>Stock final Zomatik</th><th ${TH}>Diferencia</th><th ${TH}></th></tr>
      ${filas}
    </table>
    <p style="margin:4px 0"><a href="${esc(d.link)}" style="color:#1d4ed8">Ver el detalle por día</a> · en rojo, más de ${UMBRAL_PCT} % de diferencia</p>`
}

// ---------------------------------------------------------------------------
// Export de artículos (para el idarticulo del reporte)
// ---------------------------------------------------------------------------

/** Código visible y código del sistema de un renglón de listado_articulos (como en la NP: `farticulo` = código del sistema). */
export function articuloDeListado(r: Record<string, string | number>): { codigo: string; codigoSistema: string | null; nombre: string } | null {
  const codigo = col(r, "Codigo", "Código")
  const nombre = col(r, "Nombre", "Descripcion")
  if (!codigo || !nombre) return null
  const sis = String(r["Codigo Sistema"] ?? col(r, "Codigo Sistema") ?? "").trim()
  return { codigo, codigoSistema: sis && /^\d+$/.test(sis) ? sis : null, nombre }
}
