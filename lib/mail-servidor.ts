/**
 * Mails del servidor (solo servidor): direcciones por nombre de usuario y envío por Resend.
 * Lo usan el control de ingresos de MP y el mail del armado del día.
 */
import type { SupabaseClient } from "@supabase/supabase-js"

/** Mails de los usuarios activos con esos nombres (sin importar mayúsculas), en el orden de `nombres`. */
export async function mailsDe(sb: SupabaseClient | any, nombres: string[]): Promise<string[]> {
  const { data } = await sb.from("app_users").select("name, email").eq("active", true).not("email", "is", null)
  return ((data || []) as { name: string; email: string }[]).filter((u) => nombres.some((n) => n.toLowerCase() === u.name.trim().toLowerCase())).map((u) => u.email)
}

/** Igual que mailsDe, pero por nombre (para saber a quién le falta el mail) */
export async function mailsPorNombre(sb: SupabaseClient | any, nombres: string[]): Promise<Record<string, string | null>> {
  const { data } = await sb.from("app_users").select("name, email").eq("active", true)
  const usuarios = (data || []) as { name: string; email: string | null }[]
  return Object.fromEntries(nombres.map((n) => [n, usuarios.find((u) => u.name.trim().toLowerCase() === n.toLowerCase() && u.email)?.email || null]))
}

/** Manda un mail por Resend. */
export async function enviarMail(m: { from: string; to: string[]; cc?: string[]; subject: string; html: string }): Promise<{ ok: boolean; error?: string }> {
  if (!process.env.RESEND_API_KEY) return { ok: false, error: "falta RESEND_API_KEY" }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: m.from, to: m.to, cc: m.cc?.length ? m.cc : undefined, subject: m.subject, html: m.html }),
    })
    if (!r.ok) return { ok: false, error: `Resend respondió ${r.status}` }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || "no se pudo mandar el mail" }
  }
}
