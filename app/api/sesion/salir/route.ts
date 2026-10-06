import { NextResponse } from "next/server"
import { borrarCookieSesion } from "@/lib/auth/servidor"

export const dynamic = "force-dynamic"

/** Fase 0c-1 · Salir (o "cambiar de usuario" en la tablet compartida): borra la cookie de este equipo. */
export async function POST() {
  const res = NextResponse.json({ ok: true })
  borrarCookieSesion(res)
  return res
}
