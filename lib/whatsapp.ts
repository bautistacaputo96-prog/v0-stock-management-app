/**
 * WhatsApp notification via CallMeBot API
 * Setup: https://www.callmebot.com/blog/free-api-whatsapp-messages/
 *
 * Required env vars:
 *   WHATSAPP_PHONE    — número con código de país, sin +, sin espacios  (ej: 5491155556666)
 *   WHATSAPP_API_KEY  — API key que te manda CallMeBot al activar el servicio
 */
export async function sendWhatsApp(message: string): Promise<void> {
  const phone = process.env.WHATSAPP_PHONE
  const apiKey = process.env.WHATSAPP_API_KEY

  if (!phone || !apiKey) {
    // Si no están configuradas las variables, no falla — solo loguea
    console.warn("[WhatsApp] Variables WHATSAPP_PHONE / WHATSAPP_API_KEY no configuradas")
    return
  }

  const encoded = encodeURIComponent(message)
  const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encoded}&apikey=${apiKey}`

  try {
    const res = await fetch(url, { method: "GET" })
    if (!res.ok) {
      console.error("[WhatsApp] Error al enviar mensaje:", res.status, await res.text())
    }
  } catch (err) {
    // No queremos que un fallo de WhatsApp rompa el flujo principal
    console.error("[WhatsApp] Excepción al enviar mensaje:", err)
  }
}
