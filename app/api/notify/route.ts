import { NextResponse } from "next/server"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { type, plant, date, details } = body

    const phone = process.env.WHATSAPP_PHONE ?? "5491131379034"
    const apiKey = process.env.WHATSAPP_API_KEY ?? "5189487"

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
    } else {
      message = `📋 *Parte cargado*\n${plantLabel}\n📅 ${date}`
    }

    // Llamar a CallMeBot directamente aquí para poder ver la respuesta
    const encoded = encodeURIComponent(message)
    const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encoded}&apikey=${apiKey}`

    const res = await fetch(url)
    const text = await res.text()

    return NextResponse.json({
      success: true,
      callmebot_status: res.status,
      callmebot_response: text.slice(0, 300),
      phone_used: `${phone.slice(0, 4)}...${phone.slice(-3)}`,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
