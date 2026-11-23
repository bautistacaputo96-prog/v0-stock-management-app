/**
 * Mail de las alertas de stock en 0 pendientes (tabla `alertas_stock`, las crea un trigger de la base cuando un
 * material queda en 0 o negativo). Lo llama /api/alertas/stock-cero (pg_net en el momento y el cron diario de respaldo).
 * Llamarla de más no hace daño: solo manda lo que todavía no se mandó.
 * Destinatarios: gerenciales activos con mail en app_users.
 *
 * `sb` y `enviar` se pasan de afuera (la ruta pone la clave de servicio y Resend; las pruebas, dobles).
 */
import { formatStock } from "@/lib/stock-format"

type Sb = any
export type EnviarMail = (m: { to: string[]; subject: string; html: string }) => Promise<{ ok: boolean; status?: number }>

const esc = (t: unknown) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!))

export async function enviarPendientes(sb: Sb, enviar: EnviarMail | null): Promise<{ enviados: number; motivo?: string }> {
  // Se "reservan" las pendientes antes de mandar, para que dos llamados juntos no manden dos mails
  const ahora = new Date().toISOString()
  const { data: tomadas, error } = await sb
    .from("alertas_stock")
    .update({ enviado_at: ahora })
    .is("enviado_at", null)
    .is("resuelto_at", null)
    .select("id, material_id, stock_al_alertar, creado_at")
  if (error) throw error
  if (!tomadas || tomadas.length === 0) return { enviados: 0 }

  const devolver = async () => {
    await sb.from("alertas_stock").update({ enviado_at: null }).in("id", tomadas.map((a: any) => a.id))
  }

  const { data: supervisores } = await sb
    .from("app_users")
    .select("email")
    .eq("tipo", "gerencial") // fase 0c-1: antes role = supervisor
    .eq("active", true)
    .not("email", "is", null)
  const destinatarios = (supervisores || []).map((s: any) => s.email).filter(Boolean)
  if (destinatarios.length === 0 || !enviar) {
    await devolver()
    return { enviados: 0, motivo: destinatarios.length === 0 ? "sin supervisores con mail" : "falta RESEND_API_KEY" }
  }

  const { data: materiales, error: eM } = await sb
    .from("materials")
    .select("id, name, unit, current_stock, plants(name)")
    .in("id", tomadas.map((a: any) => a.material_id))
  // Antes no se miraba el error: salía un mail "Stock en 0: 0 materiales" vacío y las alertas quedaban como mandadas
  if (eM) {
    await devolver()
    throw eM
  }
  const filas = ((materiales || []) as any[])
    .map((m) => ({ planta: m.plants?.name || "-", nombre: m.name, unidad: m.unit, stock: Number(m.current_stock) || 0 }))
    .sort((a, b) => a.planta.localeCompare(b.planta) || a.nombre.localeCompare(b.nombre))
  // Materiales que ya no existen: no hay nada que avisar (quedan como mandadas, no se reintentan para siempre)
  if (filas.length === 0) return { enviados: 0, motivo: "los materiales de las alertas ya no existen" }

  const lista = filas
    .map(
      (f) => `<tr>
        <td style="padding:6px 0;font-size:13px">${esc(f.planta)}</td>
        <td style="padding:6px 0;font-size:13px;font-weight:600">${esc(f.nombre)}</td>
        <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right;color:#b91c1c">${esc(formatStock(f.stock, f.nombre, f.unidad))}</td>
      </tr>`,
    )
    .join("")
  const titulo =
    filas.length === 1 ? `Stock en 0: ${filas[0].nombre} (${filas[0].planta})` : `Stock en 0: ${filas.length} materiales`

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
      <div style="background:#b45309;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
        <div style="font-size:16px;font-weight:700">${esc(titulo)}</div>
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

  let r: { ok: boolean; status?: number }
  try {
    r = await enviar({ to: destinatarios, subject: `Rebucret · ${titulo}`, html })
  } catch (e) {
    // Sin red: se devuelven para el próximo llamado (antes quedaban como mandadas y no salían nunca)
    await devolver()
    throw e
  }
  if (!r.ok) {
    await devolver()
    throw new Error(`Resend respondió ${r.status}`)
  }
  return { enviados: filas.length }
}
