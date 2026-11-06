/**
 * Control de ingresos de materia prima · mail diario a Juan Oreguy (con copia a Bautista). Función pura: arma el asunto
 * y el HTML; lo manda lib/control-ingresos/servidor.ts por Resend.
 *
 * Arriba "Nuevas desde ayer"; después "Siguen abiertas (N)" y el link a la pantalla. Cada parte, en tablas por las 4
 * categorías de las planillas de Juan. Las revisadas no van.
 */
import { CATEGORIAS, ddmm, proveedoresTexto, type Categoria, type Lado } from "@/lib/control-ingresos/cruce"

export type DiferenciaMail = {
  categoria: Categoria
  fecha: string
  detalle: string
  nuestro: Lado[]
  zomatik: Lado[]
}

const esc = (t: unknown) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)

const fmtT = (l: Lado) =>
  l.unidad === "t" ? `${l.t.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} t` : `${l.t.toLocaleString("es-AR")}${l.unidad ? ` ${l.unidad}` : ""}`

const unico = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x && !!x.trim()))].join(" / ") || "-"

/** Celda de un lado: "Nº 163717 · 31,09 t · Canning 26/08" (uno por renglón si hay más de uno). */
function celdaLado(ls: Lado[]): string {
  if (!ls.length) return `<span style="color:#94a3b8">no está</span>`
  return ls.map((l) => `${esc(l.remito || "sin Nº")} · ${esc(fmtT(l))}<br><span style="color:#64748b">${esc(l.planta)} ${esc(ddmm(l.fecha))}</span>`).join("<br>")
}

const TH = `style="text-align:left;font-weight:normal;color:#64748b;padding:3px 6px;border-bottom:1px solid #e2e8f0;font-size:11px"`
const TD = `style="padding:3px 6px;border-bottom:1px solid #f1f5f9;font-size:12px;vertical-align:top"`

function tabla(difs: DiferenciaMail[]): string {
  const filas = difs
    .map((d) => {
      const todos = [...d.nuestro, ...d.zomatik]
      return `<tr>
        <td ${TD}>${esc(ddmm(d.fecha))}</td>
        <td ${TD}>${esc(unico(todos.map((l) => l.material)))}</td>
        <td ${TD}>${celdaLado(d.nuestro)}</td>
        <td ${TD}>${celdaLado(d.zomatik)}</td>
        <td ${TD}>${esc(proveedoresTexto(todos))}</td>
        <td ${TD}>${esc(d.detalle || "-")}</td>
      </tr>`
    })
    .join("")
  return `<table style="width:100%;border-collapse:collapse;margin:2px 0 10px">
    <tr><th ${TH}>Fecha</th><th ${TH}>Material</th><th ${TH}>Nuestro sistema</th><th ${TH}>Zomatik</th><th ${TH}>Proveedor</th><th ${TH}>Qué pasa</th></tr>
    ${filas}
  </table>`
}

function porCategoria(difs: DiferenciaMail[]): string {
  return CATEGORIAS.map((c) => {
    const ds = difs.filter((d) => d.categoria === c.clave)
    if (!ds.length) return ""
    return `<div style="font-size:13px;margin:8px 0 2px">${esc(c.titulo)} (${ds.length})</div>${tabla(ds)}`
  }).join("")
}

/** ¿Hoy toca el mail semanal? Los lunes (en Argentina) el semanal reemplaza al diario. */
export function esDiaSemanal(hoy: string): boolean {
  return new Date(`${hoy}T12:00:00Z`).getUTCDay() === 1
}

export const ASUNTO_SEMANAL = "Rebucret · Control semanal de MP (remitos y stock)"
export const LINEA_SIN_NUEVAS = "Hoy no hay inconsistencias nuevas entre el sistema y Zomatik"
export const LINEA_SIN_LECTURA = "No se pudo leer Zomatik hoy: no se controló"

const PIE = `<p style="font-size:11px;color:#94a3b8;margin-top:12px">Toneladas iguales ±0,02 · la fecha sola no cuenta · un proveedor distinto solo no cuenta · se controlan áridos y cemento · "falta en Zomatik" después de 7 días y "falta en nuestro sistema" después de 2 · produccionrebucret.com</p>`

// ---------------------------------------------------------------------------
// Importación de ingresos desde Zomatik (fase 2, docs/ingresos-mp-zomatik.md)
// ---------------------------------------------------------------------------

/** Lo de la importación que va al mail (ya filtrado: en el diario, solo lo nuevo desde el mail anterior). */
export type ImportacionMail = {
  desde: string
  pendientes: { fecha: string | null; remito: string | null; proveedor: string | null; cantidad: string; planta: string; motivo: string; queHacer: string }[]
  cambios: { fecha: string; material: string; planta: string; kg: number; nota: string }[]
  antesDeF: { fecha: string | null; remito: string | null; motivo: string }[]
  /** Importados que Zomatik cambió y no se pudo aplicar. */
  noAplicados?: { fecha: string | null; remito: string | null; proveedor: string | null; cantidad: string; planta: string; motivo: string }[]
  manuales: { fecha: string; material: string; planta: string; cantidad: number; unidad: string; remito: string | null; cargadoPor: string | null }[]
  sinMaterial: { articulo: string; codigo: string | null; renglones: number }[]
  sinVincular: { proveedor: string; renglones: number }[]
  faltaDensidad: { material: string; planta: string }[]
}

function tablaSimple(enc: string[], filas: string[][]): string {
  return `<table style="width:100%;border-collapse:collapse;margin:2px 0 10px"><tr>${enc.map((h) => `<th ${TH}>${esc(h)}</th>`).join("")}</tr>${filas
    .map((f) => `<tr>${f.map((c) => `<td ${TD}>${esc(c)}</td>`).join("")}</tr>`)
    .join("")}</table>`
}
const seccion = (titulo: string, n: number, cuerpo: string) => (n ? `<div style="font-size:13px;margin:8px 0 2px">${esc(titulo)} (${n})</div>${cuerpo}` : "")
const kgTxt = (kg: number) => `${kg > 0 ? "+" : ""}${kg.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`

/** Las secciones de la importación (pantalla y mail usan los mismos títulos). */
export function htmlImportacion(d: ImportacionMail): string {
  return [
    seccion(
      "No se pudo importar",
      d.pendientes.length,
      tablaSimple(
        ["Fecha", "Remito", "Proveedor", "Cantidad", "Planta", "Qué pasa", "Qué hacer"],
        d.pendientes.map((p) => [ddmm(p.fecha), p.remito || "-", p.proveedor || "-", p.cantidad, p.planta, p.motivo, p.queHacer]),
      ),
    ),
    seccion("Cambios de Zomatik", d.cambios.length + d.antesDeF.length, tablaSimple(["Fecha", "Material", "Planta", "kg", "Qué cambió"], [
      ...d.cambios.map((c) => [ddmm(c.fecha), c.material, c.planta, kgTxt(c.kg), c.nota]),
      ...d.antesDeF.map((c) => [ddmm(c.fecha), "-", "-", "-", `${c.remito || ""} ${c.motivo}`.trim()]),
    ])),
    seccion(
      "Zomatik cambió y no se pudo aplicar",
      (d.noAplicados || []).length,
      tablaSimple(["Fecha", "Remito", "Proveedor", "Cantidad", "Planta", "Qué pasa"], (d.noAplicados || []).map((x) => [ddmm(x.fecha), x.remito || "-", x.proveedor || "-", x.cantidad, x.planta, x.motivo])),
    ),
    seccion(
      "Cargados a mano sin Zomatik hace más de 7 días (para eliminar)",
      d.manuales.length,
      tablaSimple(["Fecha", "Material", "Planta", "Cantidad", "Remito", "Cargó"], d.manuales.map((m) => [ddmm(m.fecha), m.material, m.planta, `${m.cantidad.toLocaleString("es-AR")} ${m.unidad}`, m.remito || "-", m.cargadoPor || "-"])),
    ),
    seccion("Falta la densidad", d.faltaDensidad.length, tablaSimple(["Material", "Planta"], d.faltaDensidad.map((x) => [x.material, x.planta]))),
    seccion("Artículos de Zomatik sin material", d.sinMaterial.length, tablaSimple(["Artículo", "Renglones"], d.sinMaterial.map((a) => [`${a.codigo ? `${a.codigo} ` : ""}${a.articulo}`, String(a.renglones)]))),
    seccion("Proveedores sin vincular (entraron igual)", d.sinVincular.length, tablaSimple(["Proveedor en Zomatik", "Ingresos"], d.sinVincular.map((p) => [p.proveedor, String(p.renglones)]))),
  ].join("")
}

/** "Rebucret · Ingresos MP: 2 sin importar, 1 cambio" · "…: sin novedades hoy". */
export function asuntoImportacion(d: { pendientes: number; cambios: number; manuales: number; inconsistencias: number; noAplicados?: number; falloLectura?: boolean }): string {
  const plural = (n: number, a: string, b: string) => `${n} ${n === 1 ? a : b}`
  const partes = [
    d.pendientes ? `${d.pendientes} sin importar` : null,
    d.cambios ? plural(d.cambios, "cambio", "cambios") : null,
    d.noAplicados ? `${d.noAplicados} sin aplicar` : null,
    d.manuales ? plural(d.manuales, "cargado a mano", "cargados a mano") : null,
    d.inconsistencias ? plural(d.inconsistencias, "inconsistencia", "inconsistencias") : null,
  ].filter(Boolean)
  if (partes.length) return `Rebucret · Ingresos MP: ${partes.join(", ")}`
  return d.falloLectura ? "Rebucret · Ingresos MP: no se pudo leer Zomatik hoy" : "Rebucret · Ingresos MP: sin novedades hoy"
}

/**
 * Mail del control (Bautista, 28/10/2026). Va siempre a Juan con copia a Bautista:
 *   - diario: solo las inconsistencias de remitos detectadas ese día (nuevas desde el mail anterior). Si no hay, sale
 *     igual con una línea. Sin stock y sin "siguen abiertas".
 *   - semanal (lunes, reemplaza al diario): las nuevas del día, todas las abiertas y la tabla de stock (`stockHtml`).
 * `falloLectura`: la lectura de Zomatik falló hoy (se dice en una línea).
 */
export function armarMail(d: {
  tipo: "diario" | "semanal"
  nuevas: DiferenciaMail[]
  abiertas?: DiferenciaMail[]
  link: string
  hoy: string
  falloLectura?: boolean
  stockHtml?: string | null
  /** Con la importación de Zomatik prendida (desde F): sus secciones van primero y el cruce viejo queda "Antes del F". */
  importacion?: ImportacionMail | null
}): { asunto: string; html: string } {
  if (d.importacion) return armarMailImportacion({ ...d, importacion: d.importacion })
  const semanal = d.tipo === "semanal"
  const n = d.nuevas.length
  const asunto = semanal
    ? ASUNTO_SEMANAL
    : n
      ? `Rebucret · Control de ingresos MP: ${n} ${n === 1 ? "inconsistencia nueva" : "inconsistencias nuevas"} hoy`
      : d.falloLectura
        ? "Rebucret · Control de ingresos MP: no se pudo leer Zomatik hoy"
        : "Rebucret · Control de ingresos MP: sin inconsistencias hoy"
  const link = `<p style="margin-top:14px"><a href="${esc(d.link)}" style="color:#1d4ed8">Ver y marcar como revisado en el sistema</a></p>`
  const fallo = d.falloLectura ? `<div style="background:#fef3c7;color:#78350f;padding:6px 8px;border-radius:6px;margin-bottom:10px">${esc(LINEA_SIN_LECTURA)}</div>` : ""
  const titulo = semanal ? `Control semanal de materia prima · ${esc(ddmm(d.hoy))}` : `Control de ingresos de materia prima · ${esc(ddmm(d.hoy))}`
  const abiertas = d.abiertas || []
  const cuerpo = semanal
    ? `<div style="font-size:14px;margin:6px 0">Nuevas del día (${n})</div>
    ${n ? porCategoria(d.nuevas) : `<div style="color:#64748b">${esc(LINEA_SIN_NUEVAS)}.</div>`}
    <div style="font-size:14px;margin:14px 0 6px">Todas las inconsistencias de remitos abiertas (${abiertas.length})</div>
    ${abiertas.length ? porCategoria(abiertas) : `<div style="color:#64748b">Ninguna.</div>`}
    ${link}
    ${d.stockHtml || ""}`
    : n
      ? `<div style="font-size:14px;margin:6px 0">Detectadas hoy (${n})</div>${porCategoria(d.nuevas)}${link}`
      : `<p>${esc(LINEA_SIN_NUEVAS)}.</p>${link}`
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;color:#0f172a;font-size:12px">
    <div style="font-size:15px;margin-bottom:2px">${titulo}</div>
    <div style="color:#64748b;margin-bottom:10px">Remitos de nuestro sistema contra Zomatik (REBUCRET, Canning y Hudson)${semanal ? " y stock de materia prima" : ""}.</div>
    ${fallo}
    ${cuerpo}
    ${PIE}
  </div>`
  return { asunto, html }
}

/** El mail cuando la importación de Zomatik está prendida (fase 2): mismos destinatarios, hora y semanal de los lunes. */
function armarMailImportacion(d: Parameters<typeof armarMail>[0] & { importacion: ImportacionMail }): { asunto: string; html: string } {
  const semanal = d.tipo === "semanal"
  const im = d.importacion
  const n = d.nuevas.length
  const asunto = semanal
    ? ASUNTO_SEMANAL
    : asuntoImportacion({ pendientes: im.pendientes.length, cambios: im.cambios.length, manuales: im.manuales.length, inconsistencias: n, noAplicados: (im.noAplicados || []).length, falloLectura: d.falloLectura })
  const link = `<p style="margin-top:14px"><a href="${esc(d.link)}" style="color:#1d4ed8">Ver y resolver en el sistema</a></p>`
  const fallo = d.falloLectura ? `<div style="background:#fef3c7;color:#78350f;padding:6px 8px;border-radius:6px;margin-bottom:10px">${esc(LINEA_SIN_LECTURA)}</div>` : ""
  const imp = htmlImportacion(im)
  const viejo = semanal ? d.abiertas || [] : d.nuevas
  const cuerpo = `${imp || `<p>${esc(semanal ? "Ningún pendiente de la importación." : "Hoy no hay novedades de la importación de Zomatik.")}</p>`}
    ${viejo.length ? `<div style="font-size:14px;margin:14px 0 6px">Antes del ${esc(ddmm(im.desde))}: remitos de nuestro sistema contra Zomatik (${viejo.length})</div>${porCategoria(viejo)}` : ""}
    ${link}
    ${semanal ? d.stockHtml || "" : ""}`
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;color:#0f172a;font-size:12px">
    <div style="font-size:15px;margin-bottom:2px">${semanal ? "Control semanal de materia prima" : "Ingresos de materia prima desde Zomatik"} · ${esc(ddmm(d.hoy))}</div>
    <div style="color:#64748b;margin-bottom:10px">Desde el ${esc(ddmm(im.desde))} los ingresos entran solos desde Zomatik (REBUCRET, Canning y Hudson). ${semanal ? "Todo lo abierto y el stock." : "Lo nuevo desde el mail anterior."}</div>
    ${fallo}
    ${cuerpo}
    <p style="font-size:11px;color:#94a3b8;margin-top:12px">Se lee Zomatik cada 30 min, de 6 a 20 · un remito que falta en Zomatik se anula 2 h después · produccionrebucret.com</p>
  </div>`
  return { asunto, html }
}
