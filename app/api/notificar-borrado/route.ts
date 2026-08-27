/**
 * Avisa por mail a los supervisores cuando alguien borra un despacho o un
 * ingreso de materia prima. Los destinatarios salen de app_users (rol
 * supervisor con mail cargado), así que se cambian desde el sistema sin tocar
 * el código.
 */
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

const FROM = process.env.REPORTE_CALIDAD_FROM || "reportes@produccionrebucret.com"

function fila(label: string, valor: string) {
  return `<tr>
    <td style="padding:6px 0;color:#64748b;font-size:13px">${label}</td>
    <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right">${valor}</td>
  </tr>`
}

export async function POST(req: Request) {
  try {
    const { usuario, entidad, referencia, detalle } = await req.json()

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    const { data: supervisores } = await supabase
      .from("app_users")
      .select("email")
      .eq("role", "supervisor")
      .eq("active", true)
      .not("email", "is", null)

    const destinatarios = (supervisores || []).map((s: any) => s.email).filter(Boolean)
    if (destinatarios.length === 0) {
      return NextResponse.json({ ok: false, motivo: "sin supervisores con mail" })
    }
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ ok: false, motivo: "falta RESEND_API_KEY" })
    }

    const cuando = new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })
    const detalleFilas = Object.entries(detalle || {})
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => fila(k, String(v)))
      .join("")

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
        <div style="background:#b91c1c;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
          <div style="font-size:16px;font-weight:700">Se eliminó un registro</div>
          <div style="opacity:.85;font-size:13px;margin-top:2px">${entidad}</div>
        </div>
        <div style="border:1px solid #e2e8f0;border-top:none;padding:16px 20px;border-radius:0 0 8px 8px">
          <table style="width:100%;border-collapse:collapse">
            ${fila("Usuario", usuario || "Desconocido")}
            ${fila("Referencia", referencia || "-")}
            ${fila("Fecha y hora", cuando)}
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

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `Rebucret - Alertas <${FROM}>`,
        to: destinatarios,
        subject: `Eliminación: ${entidad} ${referencia || ""} — por ${usuario || "desconocido"}`.trim(),
        html,
      }),
    })

    return NextResponse.json({ ok: r.ok, destinatarios, detalle: r.ok ? "enviado" : await r.text() })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "error" },
      { status: 500 },
    )
  }
}
