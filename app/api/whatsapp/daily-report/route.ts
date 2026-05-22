import { NextResponse } from "next/server"
import twilio from "twilio"
import { getYesterdayDispatches, getTodaySchedule, formatDailyReport } from "@/lib/rebucret"

export const dynamic = "force-dynamic"
export const maxDuration = 30

export async function GET(request: Request) {
  try {
    // Verificar secret para evitar llamadas no autorizadas
    const { searchParams } = new URL(request.url)
    const secret = searchParams.get("secret")
    if (secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Obtener datos
    const [yesterday, todaySchedule] = await Promise.all([
      getYesterdayDispatches(),
      getTodaySchedule(),
    ])

    // Formatear mensaje
    const message = formatDailyReport(yesterday, todaySchedule, new Date())

    // Enviar por WhatsApp via Twilio
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!
    )

    const from = process.env.TWILIO_WHATSAPP_FROM! // whatsapp:+14155238886
    const recipients = (process.env.WHATSAPP_RECIPIENTS || "").split(",").map(n => n.trim()).filter(Boolean)

    const results = await Promise.allSettled(
      recipients.map(to =>
        client.messages.create({
          from,
          to: `whatsapp:${to}`,
          body: message,
        })
      )
    )

    const sent = results.filter(r => r.status === "fulfilled").length
    const failed = results.filter(r => r.status === "rejected").length

    console.log(`Reporte diario enviado: ${sent} exitosos, ${failed} fallidos`)

    return NextResponse.json({
      success: true,
      sent,
      failed,
      preview: message,
    })
  } catch (error) {
    console.error("Error sending daily report:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido" },
      { status: 500 }
    )
  }
}
