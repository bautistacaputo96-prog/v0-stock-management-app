"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { getCurrentUser } from "@/lib/current-user"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface User {
  id: string
  name: string
}

interface UserSelectorProps {
  value: string
  onValueChange: (value: string) => void
  label?: string
  required?: boolean
}

/**
 * "Responsable". Fase 0c-1: por defecto, la persona en sesión, y sin alta de usuarios (eso es de la
 * pantalla Usuarios).
 */
export function UserSelector({ value, onValueChange, label = "Responsable", required = false }: UserSelectorProps) {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadUsers()
  }, [])

  async function loadUsers() {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("app_users")
      .select("id, name")
      .eq("active", true)
      .order("name")

    if (!error && data) {
      setUsers(data)
      // Si no hay valor, el usuario en sesión (si no figura en la lista, el primero)
      if (!value && data.length > 0) {
        const yo = getCurrentUser()?.name
        onValueChange(yo && data.some((u) => u.name === yo) ? yo : data[0].name)
      }
    }
    setLoading(false)
  }

  return (
    <div className="space-y-2">
      <Label>{label} {required && "*"}</Label>
      <Select value={value} onValueChange={onValueChange} disabled={loading}>
        <SelectTrigger>
          <SelectValue placeholder={loading ? "Cargando..." : "Seleccionar"} />
        </SelectTrigger>
        <SelectContent>
          {users.map((user) => (
            <SelectItem key={user.id} value={user.name}>
              {user.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
