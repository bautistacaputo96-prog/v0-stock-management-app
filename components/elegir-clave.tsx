"use client"

import { useState } from "react"
import { Eye, EyeOff, KeyRound, Loader2, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { setCurrentUser, clearCurrentUser } from "@/lib/current-user"

/** Campo de contraseña con "ojito" para verla. No pone mayúsculas solas: las contraseñas las distinguen. */
export function CampoClave({
  id,
  label,
  value,
  onChange,
  autoComplete,
  autoFocus,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  autoComplete?: string
  autoFocus?: boolean
}) {
  const [ver, setVer] = useState(false)
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={ver ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          className="pr-10 h-11 text-base"
        />
        <button
          type="button"
          onClick={() => setVer(!ver)}
          className="absolute right-0 top-0 h-11 w-10 flex items-center justify-center text-muted-foreground hover:text-foreground"
          title={ver ? "Ocultar" : "Ver la contraseña"}
          tabIndex={-1}
        >
          {ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}

/**
 * Formulario para elegir o cambiar la contraseña propia (`POST /api/sesion/clave`).
 * Con `pedirActual` es un cambio voluntario y pide la contraseña actual.
 */
function FormularioClave({ pedirActual, onListo, extra }: { pedirActual: boolean; onListo: () => void; extra?: React.ReactNode }) {
  const [actual, setActual] = useState("")
  const [nueva, setNueva] = useState("")
  const [repetida, setRepetida] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (pedirActual && !actual) return setError("Poné tu contraseña actual.")
    if (nueva.trim().length < 6) return setError("La contraseña tiene que tener al menos 6 letras o números.")
    if (nueva !== repetida) return setError("Las dos contraseñas no son iguales. Escribila de nuevo.")
    setGuardando(true)
    try {
      const r = await fetch("/api/sesion/clave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pedirActual ? { actual, nueva } : { nueva }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(d?.error || "No se pudo guardar. Probá de nuevo.")
        return
      }
      if (d?.usuario) setCurrentUser(d.usuario)
      onListo()
    } catch {
      setError("Sin conexión con el servidor. Probá de nuevo en un rato.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-4">
      {pedirActual && <CampoClave id="clave-actual" label="Contraseña actual" value={actual} onChange={setActual} autoComplete="current-password" autoFocus />}
      <CampoClave id="clave-nueva" label="Contraseña nueva" value={nueva} onChange={setNueva} autoComplete="new-password" autoFocus={!pedirActual} />
      <CampoClave id="clave-repetida" label="Repetila" value={repetida} onChange={setRepetida} autoComplete="new-password" />
      <p className="text-xs text-muted-foreground">Mínimo 6 letras o números. Distinguí mayúsculas. No uses la de antes.</p>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <Button type="submit" className="w-full h-11" disabled={guardando}>
        {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <><KeyRound className="mr-2 h-4 w-4" />{pedirActual ? "Guardar contraseña" : "Guardar y entrar"}</>}
      </Button>
      {extra}
    </form>
  )
}

export async function salirDelSistema() {
  try {
    await fetch("/api/sesion/salir", { method: "POST" })
  } catch {
    // aunque falle, se limpia este equipo
  }
  clearCurrentUser()
  window.location.reload()
}

/** Pantalla obligatoria "Elegí tu contraseña" (primer ingreso, alta o blanqueo). No se puede saltear. */
export function ElegirClave({ nombre, onListo }: { nombre: string; onListo: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f172a] px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-[#1a56db]">
            <KeyRound className="h-6 w-6 text-white" />
          </div>
          <CardTitle className="text-xl">Elegí tu contraseña</CardTitle>
          <CardDescription>
            Hola, {nombre}. Desde ahora entrás con una contraseña propia. No se la pases a nadie.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormularioClave
            pedirActual={false}
            onListo={onListo}
            extra={
              <Button type="button" variant="ghost" className="w-full text-sm" onClick={salirDelSistema}>
                <LogOut className="mr-2 h-4 w-4" />
                Salir
              </Button>
            }
          />
        </CardContent>
      </Card>
    </div>
  )
}

/** "Cambiar mi contraseña" desde el menú del usuario (pide la actual). */
export function CambiarClaveDialog({ open, onOpenChange, onListo }: { open: boolean; onOpenChange: (v: boolean) => void; onListo?: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Cambiar mi contraseña</DialogTitle>
          <DialogDescription>Se cierran tus sesiones en los otros equipos.</DialogDescription>
        </DialogHeader>
        {open && (
          <FormularioClave
            pedirActual
            onListo={() => {
              onOpenChange(false)
              onListo?.()
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
