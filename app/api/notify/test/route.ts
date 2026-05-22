import { NextResponse } from "next/server"

export async function GET() {
  const phone = process.env.WHATSAPP_PHONE
  const apiKey = process.env.WHATSAPP_API_KEY

  return NextResponse.json({
    phone_loaded: !!phone,
    phone_value: phone ? `${phone.slice(0, 4)}...${phone.slice(-3)}` : null,
    apikey_loaded: !!apiKey,
    apikey_value: apiKey ? `${apiKey.slice(0, 2)}...` : null,
  })
}
