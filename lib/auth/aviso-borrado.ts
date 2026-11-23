/**
 * Mail de aviso de borrado (POST /api/notificar-borrado). Función PURA: arma asunto y HTML.
 *
 * Todo lo que viene del navegador (entidad, referencia, detalle) se escapa: antes iba tal cual al HTML del mail
 * que sale desde produccionrebucret.com a los gerenciales. El usuario NO viene del navegador: lo pone la ruta
 * con el nombre de la sesión.
 *
 * Sin imports de otros archivos del proyecto (se prueba con `node --test`).
 */

/** Tope de filas del detalle y de largo de cada texto (un borrado real tiene una docena de campos). */
export const MAX_FILAS_DETALLE = 40
export const MAX_LARGO_TEXTO = 300

export function escaparHtml(valor: unknown): string {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Texto de una línea, sin saltos y cortado. */
function linea(valor: unknown, largo = MAX_LARGO_TEXTO): string {
  const t = (typeof valor === "object" && valor !== null ? JSON.stringify(valor) : String(valor ?? ""))
    .replace(/[\r\n\t]+/g, " ")
    .trim()
  return t.length > largo ? `${t.slice(0, largo - 1)}…` : t
}

function fila(label: string, valor: string) {
  return `<tr>
    <td style="padding:6px 0;color:#64748b;font-size:13px">${escaparHtml(label)}</td>
    <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right">${escaparHtml(valor)}</td>
  </tr>`
}

export function armarAvisoBorrado(opts: {
  /** Nombre de la persona en sesión (nunca el que manda el navegador). */
  usuario: string
  entidad: unknown
  referencia: unknown
  detalle: unknown
  cuando: string
}): { subject: string; html: string } {
  const usuario = linea(opts.usuario, 120) || "Desconocido"
  const entidad = linea(opts.entidad, 80) || "Registro"
  const referencia = linea(opts.referencia, 120) || "-"
  const detalle = opts.detalle && typeof opts.detalle === "object" && !Array.isArray(opts.detalle) ? (opts.detalle as Record<string, unknown>) : {}

  const detalleFilas = Object.entries(detalle)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .slice(0, MAX_FILAS_DETALLE)
    .map(([k, v]) => fila(linea(k, 80), linea(v)))
    .join("")

  const html = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
        <div style="background:#b91c1c;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
          <div style="font-size:16px;font-weight:700">Se eliminó un registro</div>
          <div style="opacity:.85;font-size:13px;margin-top:2px">${escaparHtml(entidad)}</div>
        </div>
        <div style="border:1px solid #e2e8f0;border-top:none;padding:16px 20px;border-radius:0 0 8px 8px">
          <table style="width:100%;border-collapse:collapse">
            ${fila("Usuario", usuario)}
            ${fila("Referencia", referencia)}
            ${fila("Fecha y hora", opts.cuando)}
          </table>
          ${detalleFilas ? `
            <div style="margin-top:14px;padding-top:12px;border-top:1px solid #e2e8f0">
              <div style="font-size:12px;color:#64748b;margin-bottom:6px">Datos del registro eliminado</div>
              <table style="width:100%;border-collapse:collapse">${detalleFilas}</table>
            </div>` : ""}
          <p style="font-size:11px;color:#94a3b8;margin-top:16px">
            Queda asentado en Actividad, dentro del sistema · produccionrebucret.com
          </p>
        </div>
      </div>`

  const subject = `Eliminación: ${entidad} ${referencia === "-" ? "" : referencia} — por ${usuario}`.replace(/\s+/g, " ").trim()
  return { subject, html }
}
