/**
 * Avisa por mail a los gerenciales cuando alguien borra un despacho o un
 * ingreso de materia prima. Los destinatarios salen de app_users (tipo
 * gerencial con mail cargado), así que se cambian desde el sistema sin tocar
 * el código.
 *
 * Auditoría de sesión (23/11/2026): pide la sesión (antes cualquiera desde internet mandaba mails con el texto
 * que quisiera desde produccionrebucret.com a los gerenciales), el usuario sale de la sesión y no del cuerpo, todo
 * lo que viene del navegador se escapa (lib/auth/aviso-borrado.ts) y los mails se leen con la clave de servicio.
 */
import { NextResponse } from "next/server"
import { exigirSesion, sbServicio, respuestaModoLocal, respuestaError } from "@/lib/auth/servidor"
import { armarAvisoBorrado } from "@/lib/auth/aviso-borrado"

export const dynamic = "force-dynamic"

const FROM = process.env.REPORTE_CALIDAD_FROM || "reportes@produccionrebucret.com"

export async function POST(req: Request) {
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    if (r.sesion.local) return respuestaModoLocal() // en `next dev` no salen mails
    const { entidad, referencia, detalle } = await req.json().catch(() => ({}))

    const { data: supervisores, error } = await sbServicio()
      .from("app_users")
      .select("email")
      .eq("tipo", "gerencial") // fase 0c-1: antes role = supervisor
      .eq("active", true)
      .not("email", "is", null)
    if (error) throw error

    const destinatarios = (supervisores || []).map((s: any) => s.email).filter(Boolean)
    if (destinatarios.length === 0) {
      return NextResponse.json({ ok: false, motivo: "sin supervisores con mail" })
    }
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ ok: false, motivo: "falta RESEND_API_KEY" })
    }

    const cuando = new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })
    const { subject, html } = armarAvisoBorrado({ usuario: r.sesion.usuario.name, entidad, referencia, detalle, cuando })

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: `Rebucret - Alertas <${FROM}>`, to: destinatarios, subject, html }),
    })

    // Sin devolver los mails de los gerenciales al navegador
    return NextResponse.json({ ok: res.ok, enviados: res.ok ? destinatarios.length : 0 })
  } catch (err) {
    return respuestaError(err)
  }
}
