import { createClient } from "@/lib/supabase"
import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json()

    if (!username || !password) {
      return NextResponse.json({ error: "Usuario y contraseña son requeridos" }, { status: 400 })
    }

    const supabase = createClient()
    const { data: users } = await supabase
      .from("rrhh_users")
      .select("*")
      .eq("username", username)
      .eq("is_active", true)

    const user = users && users.length > 0 ? users[0] : null

    if (!user) {
      return NextResponse.json({ error: "Usuario o contraseña incorrectos" }, { status: 401 })
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash)

    if (!passwordMatch) {
      return NextResponse.json({ error: "Usuario o contraseña incorrectos" }, { status: 401 })
    }

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
      },
    })
  } catch {
    return NextResponse.json({ error: "Error del servidor" }, { status: 500 })
  }
}
