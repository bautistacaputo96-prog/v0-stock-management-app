import { NextResponse } from "next/server"
import { sendWhatsApp } from "@/lib/whatsapp"

/**
 * POST /api/notify
 * Body: { type, plant, date, details }
 *
 * Llamado desde los formularios del cliente después de guardar un parte.
 * La API key de WhatsApp vive en el servidor (env vars) y nunca se expone al browser.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { type, plant, date, details } = body

    const PLANT_EMOJI: Record<string, string> = {
      silke: "🏭 Silke (Olivera)",
      "villa-rosa": "🏭 Villa Rosa",
      ranchos: "🏭 Ranchos",
    }

    const plantLabel = PLANT_EMOJI[plant] ?? plant

    let message = ""

    if (type === "pipe_production") {
      const { shift, totalPipes, operator } = details
      message =
        `✅ *Parte de caños cargado*\n` +
        `${plantLabel}\n` +
        `📅 ${date} — Turno ${shift}\n` +
        `🔩 Total caños: *${totalPipes}*\n` +
        (operator ? `👷 Operario: ${operator}` : "")
    } else if (type === "paver_production") {
      const { tables, product, pastons } = details
      message =
        `✅ *Parte de adoquines cargado*\n` +
        `${plantLabel}\n` +
        `📅 ${date}\n` +
        `🧱 Producto: ${product}\n` +
        `📦 Tablas: *${tables}*  |  Pastones: ${pastons}`
    } else if (type === "quality_test") {
      const { testType, result } = details
      message =
        `🔬 *Ensayo de calidad cargado*\n` +
        `${plantLabel}\n` +
        `📅 ${date}\n` +
        `📋 Tipo: ${testType}\n` +
        (result ? `📊 Resultado: ${result}` : "")
    } else {
      message =
        `📋 *Parte cargado*\n` +
        `${plantLabel}\n` +
        `📅 ${date}`
    }

    await sendWhatsApp(message)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[notify] Error:", err)
    return NextResponse.json({ error: "Error al enviar notificación" }, { status: 500 })
  }
}
