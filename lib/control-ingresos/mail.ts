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
}): { asunto: string; html: string } {
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
