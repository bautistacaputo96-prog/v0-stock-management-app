/**
 * WhatsApp notification via CallMeBot API
 * Setup: https://www.callmebot.com/blog/free-api-whatsapp-messages/
 */

interface Recipient {
  phone: string
  apiKey: string
}

// Destinatario principal (Bautista) — recibe todo
const MAIN: Recipient = {
  phone: process.env.WHATSAPP_PHONE ?? "5491131379034",
  apiKey: process.env.WHATSAPP_API_KEY ?? "5189487",
}

// Destinatario secundario — recibe partes de Silke, Villa Rosa y calidad de caños
const SECONDARY: Recipient = {
  phone: process.env.WHATSAPP_PHONE_2 ?? "5491153491880",
  apiKey: process.env.WHATSAPP_API_KEY_2 ?? "5788147",
}

async function sendToOne(recipient: Recipient, message: string): Promise<void> {
  try {
    const encoded = encodeURIComponent(message)
    const url = `https://api.callmebot.com/whatsapp.php?phone=${recipient.phone}&text=${encoded}&apikey=${recipient.apiKey}`
    const res = await fetch(url)
    const text = await res.text()
    console.log(`[WhatsApp] ${recipient.phone}: ${res.status} — ${text.slice(0, 100)}`)
  } catch (err) {
    console.error(`[WhatsApp] Error enviando a ${recipient.phone}:`, err)
  }
}

/**
 * Envía un mensaje de WhatsApp.
 * @param message  Texto del mensaje
 * @param also2    Si true, también se lo manda al destinatario secundario
 */
export async function sendWhatsApp(message: string, also2 = false): Promise<void> {
  const tasks: Promise<void>[] = [sendToOne(MAIN, message)]
  if (also2) tasks.push(sendToOne(SECONDARY, message))
  await Promise.all(tasks)
}
