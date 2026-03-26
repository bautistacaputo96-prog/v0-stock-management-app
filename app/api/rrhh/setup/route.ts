import { createClient } from "@/lib/supabase"
import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"

export async function POST() {
  try {
    const supabase = createClient()
    
    // Check if admin already exists with a valid password
    const { data: existingList } = await supabase
      .from("rrhh_users")
      .select("id")
      .eq("username", "admin")
    
    const existing = existingList && existingList.length > 0 ? existingList[0] : null

    const hashedPassword = await bcrypt.hash("admin123", 10)

    if (existing) {
      await supabase
        .from("rrhh_users")
        .update({ password_hash: hashedPassword })
        .eq("username", "admin")
    } else {
      await supabase
        .from("rrhh_users")
        .insert({
          username: "admin",
          password_hash: hashedPassword,
          full_name: "Administrador",
        })
    }

    return NextResponse.json({ success: true, message: "Admin user ready. Username: admin, Password: admin123" })
  } catch {
    return NextResponse.json({ error: "Error setting up admin" }, { status: 500 })
  }
}
