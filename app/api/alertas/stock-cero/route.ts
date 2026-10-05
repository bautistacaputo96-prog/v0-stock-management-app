/**
 * Manda por mail las alertas de stock en 0 que estén pendientes (tabla `alertas_stock`,
 * las crea un trigger de la base cuando un material queda en 0 o negativo).
 * La llama la base en el momento (pg_net) y un cron diario como respaldo.
 * Llamarla de más no hace daño: solo manda lo que todavía no se mandó.
 * Destinatarios: supervisores activos con mail en app_users (hoy Bautista y Juan).
 */
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { formatStock } from "@/lib/stock-format"

export const dynamic = "force-dynamic"

const FROM = process.env.REPORTE_CALIDAD_FROM || "reportes@produccionrebucret.com"

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

async function enviarPendientes() {
  const supabase = sb()

  // Se "reservan" las pendientes antes de mandar, para que dos llamados juntos no manden dos mails
  const ahora = new Date().toISOString()
  const { data: tomadas, error } = await supabase
    .from("alertas_stock")
    .update({ enviado_at: ahora })
    .is("enviado_at", null)
    .is("resuelto_at", null)
    .select("id, material_id, stock_al_alertar, creado_at")
  if (error) throw error
  if (!tomadas || tomadas.length === 0) return { enviados: 0 }

  const devolver = async () => {
    await supabase.from("alertas_stock").update({ enviado_at: null }).in("id", tomadas.map((a) => a.id))
  }

  const { data: supervisores } = await supabase
    .from("app_users")
    .select("email")
    .eq("role", "supervisor")
    .eq("active", true)
    .not("email", "is", null)
  const destinatarios = (supervisores || []).map((s: any) => s.email).filter(Boolean)
  if (destinatarios.length === 0 || !process.env.RESEND_API_KEY) {
    await devolver()
    return { enviados: 0, motivo: destinatarios.length === 0 ? "sin supervisores con mail" : "falta RESEND_API_KEY" }
  }

  const { data: materiales } = await supabase
    .from("materials")
    .select("id, name, unit, current_stock, plants(name)")
    .in("id", tomadas.map((a) => a.material_id))
  const filas = (materiales || [])
    .map((m: any) => ({ planta: m.plants?.name || "-", nombre: m.name, unidad: m.unit, stock: Number(m.current_stock) || 0 }))
    .sort((a, b) => a.planta.localeCompare(b.planta) || a.nombre.localeCompare(b.nombre))

  const lista = filas
    .map(
      (f) => `<tr>
        <td style="padding:6px 0;font-size:13px">${f.planta}</td>
        <td style="padding:6px 0;font-size:13px;font-weight:600">${f.nombre}</td>
        <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right;color:#b91c1c">${formatStock(f.stock, f.nombre, f.unidad)}</td>
      </tr>`,
    )
    .join("")
  const titulo =
    filas.length === 1 ? `Stock en 0: ${filas[0].nombre} (${filas[0].planta})` : `Stock en 0: ${filas.length} materiales`

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
      <div style="background:#b45309;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
        <div style="font-size:16px;font-weight:700">${titulo}</div>
        <div style="opacity:.85;font-size:13px;margin-top:2px">El sistema siguió despachando: revisá si falta cargar un ingreso o pedir material</div>
      </div>
      <div style="border:1px solid #e2e8f0;border-top:none;padding:16px 20px;border-radius:0 0 8px 8px">
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="font-size:12px;color:#64748b">Planta</td><td style="font-size:12px;color:#64748b">Material</td><td style="font-size:12px;color:#64748b;text-align:right">Stock en el sistema</td></tr>
          ${lista}
        </table>
        <p style="font-size:11px;color:#94a3b8;margin-top:16px">
          Avisa una sola vez por material; vuelve a avisar si el stock sube y otra vez llega a 0 · produccionrebucret.com
        </p>
      </div>
    </div>`

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `Rebucret - Alertas <${FROM}>`, to: destinatarios, subject: `Rebucret · ${titulo}`, html }),
  })
  if (!r.ok) {
    await devolver()
    throw new Error(`Resend respondió ${r.status}`)
  }
  return { enviados: filas.length }
}

export async function POST() {
  try {
    return NextResponse.json({ ok: true, ...(await enviarPendientes()) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "No se pudo enviar" }, { status: 500 })
  }
}

// El cron de Vercel llama con GET
export const GET = POST
