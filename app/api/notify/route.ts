import { NextResponse } from "next/server"
import { sendWhatsApp } from "@/lib/whatsapp"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { type, plant, date, details } = body

    const PLANT_LABEL: Record<string, string> = {
      silke: "🏭 Silke (Olivera)",
      "villa-rosa": "🏭 Villa Rosa",
      ranchos: "🏭 Ranchos",
    }
    const plantLabel = PLANT_LABEL[plant] ?? plant

    let message = ""
    // also2: true cuando el segundo destinatario debe recibir el mensaje
    // (partes de Silke, Villa Rosa y control de calidad de caños — no Ranchos)
    let also2 = false

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

      // Silke y Villa Rosa → también al segundo destinatario
      also2 = plant === "silke" || plant === "villa-rosa"

    } else if (type === "paver_production") {
      const { tables, product, pastons, wasteKg } = details
      message =
        `✅ *Parte de adoquines cargado*\n` +
        `${plantLabel}\n` +
        `📅 ${date}\n` +
        `🧱 Producto: ${product}\n` +
        `📦 Tablas: *${tables}*  |  Pastones: ${pastons}\n` +
        `🗑️ Desperdicio: *${wasteKg ?? 0} kg*`

      // Ranchos → solo destinatario principal
      also2 = false

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

      // Control de calidad de caños → también al segundo destinatario
      also2 = true

    } else {
      message = `📋 *Parte cargado*\n${plantLabel}\n📅 ${date}`
    }

    await sendWhatsApp(message, also2)

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error("[notify]", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
