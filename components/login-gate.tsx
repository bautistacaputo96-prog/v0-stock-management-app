"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Lock, Loader2, WifiOff, RefreshCw, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getCurrentUser, setCurrentUser, clearCurrentUser } from "@/lib/current-user"
import { CampoClave, ElegirClave } from "@/components/elegir-clave"

/**
 * Login (fase 0c-1): cada persona entra con su nombre y su contraseña propia.
 *
 * - La sesión es una cookie firmada del servidor (httpOnly). Acá solo se guarda un caché de quién es y
 *   qué puede hacer, que se refresca con `GET /api/sesion` al abrir y cada 15 minutos.
 * - Sin conexión con el servidor: si ya había entrado, sigue con sus permisos guardados (franja de aviso)
 *   y se reintenta cada minuto. Así un corte de internet no deja a nadie sin despachar.
 * - No hay contraseña en el código del navegador ni alta de usuarios: eso es de la pantalla Usuarios.
 */

type Estado = "cargando" | "login" | "elegir" | "dentro" | "error" | "sin_secreto" | "sin_clave_servicio"

/** Códigos de configuración que devuelven las rutas de sesión (500). */
function estadoDeConfiguracion(codigo: unknown): Estado | null {
  return codigo === "sin_secreto" || codigo === "sin_clave_servicio" ? codigo : null
}
type Nombre = { id: string; name: string }

const QUINCE_MIN = 15 * 60 * 1000
const UN_MIN = 60 * 1000

export function LoginGate({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = useState<Estado>("cargando")
  const [sinConexion, setSinConexion] = useState(false)
  const [modoLocal, setModoLocal] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [nombres, setNombres] = useState<Nombre[]>([])
  const [usuarioId, setUsuarioId] = useState("")
  const [clave, setClave] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [entrando, setEntrando] = useState(false)
  const estadoRef = useRef<Estado>("cargando")
  estadoRef.current = estado

  const cargarNombres = useCallback(async () => {
    try {
      const r = await fetch("/api/sesion/usuarios", { cache: "no-store" })
      if (r.status === 500) {
        const d = await r.json().catch(() => ({}))
        const conf = estadoDeConfiguracion(d?.codigo)
        if (conf) return setEstado(conf)
      }
      if (!r.ok) throw new Error(String(r.status))
      setNombres(await r.json())
    } catch {
      setError("Sin conexión con el servidor. Probá de nuevo en un rato.")
    }
  }, [])

  const irAlLogin = useCallback(
    (mensaje: string | null) => {
      clearCurrentUser()
      setAviso(mensaje)
      setClave("")
      setEstado("login")
      cargarNombres()
    },
    [cargarNombres],
  )

  /** Pregunta al servidor quién está en sesión. `inicial`: al abrir el sistema. */
  const revisar = useCallback(
    async (inicial: boolean) => {
      try {
        const r = await fetch("/api/sesion", { cache: "no-store" })
        if (r.status === 401) {
          // Si estaba adentro, la sesión se cerró (baja, blanqueo, cambio de contraseña en otro equipo)
          irAlLogin(inicial ? null : "Tu sesión se cerró. Entrá de nuevo.")
          setSinConexion(false)
          return
        }
        const d = await r.json().catch(() => ({}))
        const conf = estadoDeConfiguracion(d?.codigo)
        if (conf) {
          setEstado(conf)
          return
        }
        if (!r.ok || !d?.usuario) throw new Error(String(r.status))
        setCurrentUser(d.usuario)
        setModoLocal(d.modoPruebaLocal === true)
        setSinConexion(false)
        setEstado(d.debeCambiarClave ? "elegir" : "dentro")
      } catch {
        // Error de red o del servidor: con caché, se sigue trabajando con los permisos guardados
        if (getCurrentUser()) {
          setSinConexion(true)
          if (inicial || estadoRef.current === "cargando") setEstado("dentro")
        } else if (inicial) {
          setEstado("error")
        } else {
          setSinConexion(true)
        }
      }
    },
    [irAlLogin],
  )

  useEffect(() => {
    revisar(true)
  }, [revisar])

  // Revalida cada 15 minutos (o cada minuto si está sin conexión)
  useEffect(() => {
    if (estado !== "dentro") return
    const t = window.setInterval(() => revisar(false), sinConexion ? UN_MIN : QUINCE_MIN)
    return () => window.clearInterval(t)
  }, [estado, sinConexion, revisar])

  async function ingresar(e: React.FormEvent) {
    e.preventDefault()
    if (!usuarioId) return setError("Elegí tu nombre para continuar.")
    if (!clave) return setError("Poné tu contraseña.")
    setEntrando(true)
    setError(null)
    try {
      const r = await fetch("/api/sesion/ingresar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuarioId, clave }),
      })
      const d = await r.json().catch(() => ({}))
      const conf = estadoDeConfiguracion(d?.codigo)
      if (conf) return setEstado(conf)
      if (!r.ok || !d?.usuario) {
        setError(d?.error || "No se pudo entrar. Probá de nuevo.")
        return
      }
      setCurrentUser(d.usuario)
      setClave("")
      setAviso(null)
      setEstado(d.debeCambiarClave ? "elegir" : "dentro")
    } catch {
      setError("Sin conexión con el servidor. Probá de nuevo en un rato.")
    } finally {
      setEntrando(false)
    }
  }

  if (estado === "cargando") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f172a]">
        <Loader2 className="h-6 w-6 animate-spin text-white/70" />
      </div>
    )
  }

  if (estado === "sin_secreto" || estado === "sin_clave_servicio" || estado === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f172a] px-4">
        <Card className="w-full max-w-sm">
          <CardContent className="pt-6 text-center space-y-3">
            <AlertTriangle className="h-10 w-10 mx-auto text-amber-500" />
            {estado === "sin_secreto" ? (
              <p className="text-sm">El sistema no está bien configurado (falta SESION_SECRETO). Avisale a Bautista.</p>
            ) : estado === "sin_clave_servicio" ? (
              <p className="text-sm">El sistema no está bien configurado (falta la clave de servicio). Avisale a Bautista.</p>
            ) : (
              <p className="text-sm">No hay conexión con el servidor. Revisá internet y probá de nuevo.</p>
            )}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setEstado("cargando")
                revisar(true)
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Reintentar
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (estado === "elegir") {
    return <ElegirClave nombre={getCurrentUser()?.name || ""} onListo={() => setEstado("dentro")} />
  }

  if (estado === "dentro") {
    return (
      <>
        {sinConexion && (
          <div className="fixed bottom-0 inset-x-0 z-50 bg-amber-100 border-t border-amber-300 text-amber-900 text-xs px-4 py-1.5 flex items-center justify-center gap-2">
            <WifiOff className="h-3.5 w-3.5" />
            Sin conexión con el servidor: se usan tus permisos guardados.
          </div>
        )}
        {modoLocal && (
          <div className="fixed bottom-0 inset-x-0 z-50 bg-violet-100 border-t border-violet-300 text-violet-900 text-xs px-4 py-1.5 text-center">
            Modo prueba local: se ve como {getCurrentUser()?.name}. No se graba nada desde Usuarios ni el login.
          </div>
        )}
        {children}
      </>
    )
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
            <CardDescription>
              Elegí tu nombre y poné tu contraseña. Si es tu primera vez con contraseña propia, poné la de siempre: el
              sistema te va a pedir que elijas una nueva.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {aviso && <p className="mb-4 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">{aviso}</p>}
          <form onSubmit={ingresar} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="user">Usuario</Label>
              <Select
                value={usuarioId}
                onValueChange={(v) => {
                  setUsuarioId(v)
                  setError(null)
                }}
              >
                <SelectTrigger id="user" className="h-11">
                  <SelectValue placeholder="Seleccioná tu nombre" />
                </SelectTrigger>
                <SelectContent>
                  {nombres.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <CampoClave
              id="password"
              label="Contraseña"
              value={clave}
              onChange={(v) => {
                setClave(v)
                setError(null)
              }}
              autoComplete="current-password"
            />

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full h-11" disabled={entrando}>
              {entrando ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Lock className="mr-2 h-4 w-4" />Ingresar</>}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
