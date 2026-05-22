import { NextResponse } from "next/server"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { type, plant, date, details } = body

    const phone = process.env.WHATSAPP_PHONE ?? "5491131379034"
    const apiKey = process.env.WHATSAPP_API_KEY ?? "5189487"

    const PLANT_LABEL: Record<string, string> = {
      silke: "🏭 Silke (Olivera)",
      "villa-rosa": "🏭 Villa Rosa",
      ranchos: "🏭 Ranchos",
    }
    const plantLabel = PLANT_LABEL[plant] ?? plant

    let message = ""

    if (type === "pipe_production") {
      const { shift, totalPipes, operator, wasteCajones, wasteKg, isVillaRosa } = details

      const wasteLine = isVillaRosa
        ? `🗑️ Desperdicio: *${wasteKg ?? 0} kg*`
        : `🗑️ Desperdicio: *${wasteCajones ?? 0} cajones*`

      message =
        `✅ *Parte de caños cargado*\n` +
        `${plantLabel}\n` +
        `📅 ${date} — Turno ${shift}\n` +
        `🔩 Total caños: *${totalPipes}*\n` +
        wasteLine +
        (operator ? `\n👷 ${operator}` : "")

    } else if (type === "paver_production") {
      const { tables, product, pastons, wasteKg } = details
      message =
        `✅ *Parte de adoquines cargado*\n` +
        `${plantLabel}\n` +
        `📅 ${date}\n` +
        `🧱 Producto: ${product}\n` +
        `📦 Tablas: *${tables}*  |  Pastones: ${pastons}\n` +
        `🗑️ Desperdicio: *${wasteKg ?? 0} kg*`

    } else if (type === "quality_pipe") {
      const { primera, segunda, rotos, recuperar, lote, topDefecto } = details
      message =
        `🔬 *Control de calidad — Caños*\n` +
        `${plantLabel}\n` +
        `📅 ${date}${lote ? `  |  Lote: ${lote}` : ""}\n` +
        `✅ 1ra calidad: *${primera}*\n` +
        `🔸 2da calidad: *${segunda}*\n` +
        `❌ Rotos: *${rotos}*\n` +
        `🔄 A recuperar: *${recuperar}*` +
        (topDefecto ? `\n⚠️ Defecto principal: ${topDefecto}` : "")

    } else {
      message = `📋 *Parte cargado*\n${plantLabel}\n📅 ${date}`
    }

    const encoded = encodeURIComponent(message)
    const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encoded}&apikey=${apiKey}`
    await fetch(url)

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error("[notify]", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
