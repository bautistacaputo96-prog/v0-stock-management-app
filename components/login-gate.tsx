"use client"

import { useState, useEffect } from "react"
import { Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

// Normaliza texto: minúsculas, sin tildes/acentos y sin espacios sobrantes.
function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

const VALID_USER = normalize("Produccion")
const VALID_PASSWORD = normalize("Rebucret")
const STORAGE_KEY = "rebucret-auth"

export function LoginGate({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false)
  const [checked, setChecked] = useState(false)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState(false)

  useEffect(() => {
    if (typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) === "true") {
      setAuthenticated(true)
    }
    setChecked(true)
  }, [])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (normalize(username) === VALID_USER && normalize(password) === VALID_PASSWORD) {
      window.localStorage.setItem(STORAGE_KEY, "true")
      setAuthenticated(true)
      setError(false)
    } else {
      setError(true)
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
            <CardDescription>Ingrese sus credenciales para continuar</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Usuario</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value)
                  setError(false)
                }}
                placeholder="Usuario"
                autoComplete="username"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setError(false)
                }}
                placeholder="Contraseña"
                autoComplete="current-password"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                Usuario o contraseña incorrectos
              </p>
            )}
            <Button type="submit" className="w-full">
              <Lock className="mr-2 h-4 w-4" />
              Ingresar
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
