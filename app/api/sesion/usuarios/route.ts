import { NextResponse } from "next/server"
import { sbServicio, respuestaError } from "@/lib/auth/servidor"

export const dynamic = "force-dynamic"

/** Fase 0c-1 · Lista de nombres para el login: [{id, name}] de los activos. Nada más. */
export async function GET() {
  try {
    const { data, error } = await sbServicio().from("app_users").select("id, name").eq("active", true).order("name")
    if (error) throw error
    const res = NextResponse.json((data || []).map((u: any) => ({ id: u.id, name: u.name })))
    res.headers.set("Cache-Control", "no-store")
    return res
  } catch (e) {
    return respuestaError(e)
  }
}
