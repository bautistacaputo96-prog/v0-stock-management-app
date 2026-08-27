"use client"

import { useState, useEffect } from "react"
import { Lock, UserPlus, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createClient } from "@/lib/supabase/client"
import { getCurrentUser, setCurrentUser, type CurrentUser } from "@/lib/current-user"

// Normaliza texto: minúsculas, sin tildes/acentos y sin espacios sobrantes.
function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
}

// Contraseña común a todos los usuarios. La identidad se toma del nombre
// elegido, así queda registrado quién carga cada movimiento.
const VALID_PASSWORD = normalize("Rebucret")
const STORAGE_KEY = "rebucret-auth"

type AppUser = { id: string; name: string; role: string }

export function LoginGate({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false)
  const [checked, setChecked] = useState(false)
  const [users, setUsers] = useState<AppUser[]>([])
  const [selectedUser, setSelectedUser] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newUserName, setNewUserName] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const sessionOk = typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) === "true"
    if (sessionOk && getCurrentUser()) setAuthenticated(true)
    setChecked(true)
    loadUsers()
  }, [])

  async function loadUsers() {
    const supabase = createClient()
    if (!supabase) return
    const { data } = await supabase
      .from("app_users")
      .select("id, name, role")
      .eq("active", true)
      .order("name")
    setUsers(data || [])
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedUser) {
      setError("Elegí tu nombre para continuar")
      return
    }
    if (normalize(password) !== VALID_PASSWORD) {
      setError("Contraseña incorrecta")
      return
    }
    const user = users.find((u) => u.name === selectedUser)
    const session: CurrentUser = {
      name: selectedUser,
      role: user?.role === "supervisor" ? "supervisor" : "operario",
    }
    setCurrentUser(session)
    window.localStorage.setItem(STORAGE_KEY, "true")
    setAuthenticated(true)
    setError(null)
  }

  async function handleAddUser() {
    const name = newUserName.trim()
    if (!name) return
    setSaving(true)
    try {
      const supabase = createClient()
      const { error: insertError } = await supabase
        .from("app_users")
        .insert({ name, active: true, role: "operario" })
      if (insertError) throw insertError
      await loadUsers()
      setSelectedUser(name)
      setNewUserName("")
      setAdding(false)
      setError(null)
    } catch {
      setError("No se pudo agregar el usuario")
    } finally {
      setSaving(false)
    }
  }

  // Evita el parpadeo del login antes de comprobar el estado guardado.
  if (!checked) {
    return null
  }

  if (authenticated) {
    return <>{children}</>
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f172a] px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-[#1a56db]">
            <span className="text-lg font-bold text-white">R</span>
          </div>
          <div className="space-y-1">
            <CardTitle className="text-xl">Rebucret S.A.</CardTitle>
            <CardDescription>Elegí tu nombre e ingresá la contraseña</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="user">Usuario</Label>
              <Select
                value={selectedUser}
                onValueChange={(v) => {
                  setSelectedUser(v)
                  setError(null)
                }}
              >
                <SelectTrigger id="user">
                  <SelectValue placeholder="Seleccioná tu nombre" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.name}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setError(null)
                }}
                placeholder="Contraseña"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">{error}</p>
            )}

            <Button type="submit" className="w-full">
              <Lock className="mr-2 h-4 w-4" />
              Ingresar
            </Button>
          </form>

          <div className="mt-4 border-t pt-4">
            {adding ? (
              <div className="space-y-2">
                <Label htmlFor="new-user">Nombre completo</Label>
                <Input
                  id="new-user"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="Ej: Juan Perez"
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => { setAdding(false); setNewUserName("") }}>
                    Cancelar
                  </Button>
                  <Button type="button" className="flex-1" onClick={handleAddUser} disabled={saving || !newUserName.trim()}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="ghost" className="w-full text-sm" onClick={() => setAdding(true)}>
                <UserPlus className="mr-2 h-4 w-4" />
                Agregar nuevo usuario
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
