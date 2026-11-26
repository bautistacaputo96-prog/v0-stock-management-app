/**
 * WhatsApp por TextMeBot (SOLO servidor: rutas de app/api y lo que corre desde ellas).
 *
 * Env: TEXTMEBOT_API_KEY (la clave de TextMeBot). Los teléfonos van en env (repo público: nunca en el código).
 * Nunca tira y nunca loguea la clave ni la URL completa (la clave va en la URL).
 */

export type ResultadoWhatsApp = { enviado: boolean; motivo?: string }

/** Que un TextMeBot lento no se coma el tiempo del robot (cada función de Vercel tiene 60 s). */
export const TIMEOUT_WHATSAPP_MS = 10_000

/** Manda un WhatsApp. `telefono`: con código de país, sin + (549…). Nunca tira: devuelve si salió y por qué no. */
export async function mandarWhatsApp(telefono: string, texto: string): Promise<ResultadoWhatsApp> {
  try {
    const clave = process.env.TEXTMEBOT_API_KEY
    if (!clave) return { enviado: false, motivo: "falta TEXTMEBOT_API_KEY" }
    const tel = String(telefono || "").replace(/[^\d]/g, "")
    if (!tel) return { enviado: false, motivo: "falta el teléfono" }
    if (!String(texto || "").trim()) return { enviado: false, motivo: "falta el texto" }
    const url = `https://api.textmebot.com/send.php?recipient=${tel}&apikey=${encodeURIComponent(clave)}&text=${encodeURIComponent(texto)}`
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_WHATSAPP_MS) })
    // TextMeBot a veces responde 200 con el error en el texto (suscripción vencida, teléfono desconectado…)
    const cuerpo = (await r.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 200)
    if (!r.ok) return { enviado: false, motivo: `TextMeBot respondió ${r.status}${cuerpo ? `: ${cuerpo}` : ""}` }
    if (/\b(error|invalid|failed|expired)\b/i.test(cuerpo)) return { enviado: false, motivo: `TextMeBot: ${cuerpo}` }
    return { enviado: true }
  } catch (e) {
    const err = e as { name?: string; message?: string }
    return { enviado: false, motivo: err?.name === "TimeoutError" ? "TextMeBot no respondió a tiempo" : "no se pudo mandar el WhatsApp" }
  }
}
