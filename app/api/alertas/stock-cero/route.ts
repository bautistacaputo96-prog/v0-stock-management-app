/**
 * Manda por mail las alertas de stock en 0 que estén pendientes (tabla `alertas_stock`, las crea un trigger de la base
 * cuando un material queda en 0 o negativo). La lógica está en lib/alertas-stock-cero.ts.
 * La llama la base en el momento (pg_net) y un cron diario como respaldo.
 * Llamarla de más no hace daño: solo manda lo que todavía no se mandó.
 * Destinatarios: gerenciales activos con mail en app_users (hoy Bautista y Juan).
 */
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { enviarPendientes, type EnviarMail } from "@/lib/alertas-stock-cero"

export const dynamic = "force-dynamic"

const FROM = process.env.REPORTE_CALIDAD_FROM || "reportes@produccionrebucret.com"

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

const resend: EnviarMail = async (m) => {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `Rebucret - Alertas <${FROM}>`, to: m.to, subject: m.subject, html: m.html }),
  })
  return { ok: r.ok, status: r.status }
}

export async function POST() {
  try {
    return NextResponse.json({ ok: true, ...(await enviarPendientes(sb(), process.env.RESEND_API_KEY ? resend : null)) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "No se pudo enviar" }, { status: 500 })
  }
}

// El cron de Vercel llama con GET
export const GET = POST
