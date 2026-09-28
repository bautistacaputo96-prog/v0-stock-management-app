import { NextResponse } from "next/server"
import { parsearCoordenadas } from "@/lib/geo"

/**
 * Convierte un link de ubicación en coordenadas. Resuelve los links cortos de
 * Google Maps (maps.app.goo.gl, goo.gl/maps) que manda el cliente por WhatsApp,
 * siguiendo las redirecciones hasta el link largo que trae las coordenadas.
 * ?u=<link>
 */
export async function GET(req: Request) {
  const u = (new URL(req.url).searchParams.get("u") || "").trim()
  const directo = parsearCoordenadas(u)
  if (directo) return NextResponse.json(directo)
  if (!/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.|www\.google\.[a-z.]+\/maps|g\.co\/kgs)/i.test(u)) {
    return NextResponse.json({ error: "No es un link de Google Maps" }, { status: 400 })
  }
  try {
    let url = u
    for (let i = 0; i < 6; i++) {
      const r = await fetch(url, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0" } })
      const loc = r.headers.get("location")
      const c = parsearCoordenadas(loc || url)
      if (c) return NextResponse.json(c)
      if (!loc) {
        // Algunas páginas traen las coordenadas en el HTML
        const html = await r.text()
        const m = html.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || html.match(/\[null,null,(-?\d+\.\d+),(-?\d+\.\d+)\]/)
        if (m) return NextResponse.json({ lat: Number(m[1]), lng: Number(m[2]) })
        break
      }
      url = new URL(loc, url).toString()
    }
    return NextResponse.json({ error: "No encontré coordenadas en ese link" }, { status: 422 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "No se pudo leer el link" }, { status: 502 })
  }
}
