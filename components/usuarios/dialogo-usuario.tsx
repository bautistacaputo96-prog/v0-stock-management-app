"use client"

import { useEffect, useState } from "react"
import { Loader2, KeyRound, UserX, UserCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { CampoClave } from "@/components/elegir-clave"
import { MatrizPermisos } from "@/components/usuarios/matriz-permisos"
import { cn } from "@/lib/utils"
import { NOMBRE_TIPO, TIPOS, plantilla, normalizarPermisos, diferenciasConPlantilla, type Permisos, type Tipo } from "@/lib/permisos"

export type UsuarioPantalla = {
  id: string
  name: string
  email: string | null
  active: boolean
  tipo: Tipo
  permisos: Permisos
  veFuncionesNuevas: boolean
  estadoClave: "propia" | "tiene que cambiarla" | "primer ingreso pendiente" | "sin contraseña"
  ultimoIngreso: string | null
  bloqueado: boolean
}

const EXPLICACION_TIPO: Record<Tipo, string> = {
  gerencial: "Ve, carga, edita y borra todo. Administra usuarios.",
  operario: "Ve todo. Carga solo en sus áreas. Editar o borrar se habilita a mano.",
  consulta: "Ve todo. No carga nada.",
}

async function llamar(url: string, metodo: string, body?: unknown) {
  const r = await fetch(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d?.error || "No se pudo guardar. Probá de nuevo.")
  return d
}

/**
 * Alta o edición de una persona (pantalla Usuarios). Todo pasa por /api/usuarios.
 * Sin motivo (es configuración): queda en Actividad con el antes, el después y quién lo hizo.
 */
export function DialogoUsuario({
  open,
  onOpenChange,
  usuario,
  yo,
  onGuardado,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** null = nuevo */
  usuario: UsuarioPantalla | null
  yo: string | null
  onGuardado: (mensaje: string) => void
}) {
  const nuevo = !usuario
  const [nombre, setNombre] = useState("")
  const [email, setEmail] = useState("")
  const [tipo, setTipo] = useState<Tipo>("operario")
  const [permisos, setPermisos] = useState<Permisos>(plantilla("operario"))
  const [clave, setClave] = useState("")
  const [clave2, setClave2] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [cambioTipo, setCambioTipo] = useState<Tipo | null>(null)
  const [blanqueo, setBlanqueo] = useState(false)
  const [confirmarBaja, setConfirmarBaja] = useState(false)

  useEffect(() => {
    if (!open) return
    setNombre(usuario?.name || "")
    setEmail(usuario?.email || "")
    setTipo(usuario?.tipo || "operario")
    setPermisos(usuario ? normalizarPermisos(usuario.permisos) : plantilla("operario"))
    setClave("")
    setClave2("")
    setError(null)
    setBlanqueo(false)
  }, [open, usuario])

  function elegirTipo(t: Tipo) {
    if (t === tipo) return
    // Al editar, avisa antes de reemplazar los permisos
    if (!nuevo) return setCambioTipo(t)
    setTipo(t)
    setPermisos(plantilla(t))
  }

  async function guardar() {
    setError(null)
    if (nuevo) {
      if (nombre.trim().length < 3) return setError("Poné el nombre y apellido.")
      if (clave.trim().length < 6) return setError("La contraseña inicial tiene que tener al menos 6 letras o números.")
      if (clave !== clave2) return setError("Las dos contraseñas no son iguales.")
    }
    setGuardando(true)
    try {
      if (nuevo) {
        await llamar("/api/usuarios", "POST", { name: nombre, email: email || null, tipo, permisos, claveInicial: clave })
        onGuardado(`Se creó ${nombre.trim()}. Pasale la contraseña inicial: la va a cambiar al entrar.`)
      } else {
        await llamar(`/api/usuarios/${usuario!.id}`, "PATCH", { tipo, permisos, email: email || null })
        onGuardado(`Se guardaron los cambios de ${usuario!.name}.`)
      }
      onOpenChange(false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  async function blanquear() {
    setError(null)
    if (clave.trim().length < 6) return setError("La contraseña inicial tiene que tener al menos 6 letras o números.")
    if (clave !== clave2) return setError("Las dos contraseñas no son iguales.")
    setGuardando(true)
    try {
      await llamar(`/api/usuarios/${usuario!.id}/clave`, "POST", { claveInicial: clave })
      onGuardado(`Se blanqueó la contraseña de ${usuario!.name}. Pasale la nueva: la va a cambiar al entrar.`)
      onOpenChange(false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  async function cambiarActivo(activo: boolean) {
    setError(null)
    setGuardando(true)
    try {
      await llamar(`/api/usuarios/${usuario!.id}`, "PATCH", { active: activo })
      onGuardado(activo ? `${usuario!.name} quedó reactivado.` : `${usuario!.name} quedó dado de baja.`)
      onOpenChange(false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
      setConfirmarBaja(false)
    }
  }

  const difs = diferenciasConPlantilla(tipo, permisos)

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !guardando && onOpenChange(v)}>
        <DialogContent className="sm:max-w-[640px] max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{nuevo ? "Nuevo usuario" : usuario!.name}</DialogTitle>
            {!nuevo && (
              <DialogDescription>
                Contraseña: {usuario!.estadoClave}
                {usuario!.bloqueado ? " · bloqueado por intentos fallidos" : ""}
                {!usuario!.active ? " · dado de baja" : ""}
              </DialogDescription>
            )}
          </DialogHeader>

          {blanqueo ? (
            <div className="space-y-4">
              <p className="text-sm">
                Escribí una contraseña inicial para {usuario!.name}. Se cierran sus sesiones abiertas y al entrar la va a tener
                que cambiar.
              </p>
              <CampoClave id="blanqueo-1" label="Contraseña inicial" value={clave} onChange={setClave} autoComplete="new-password" autoFocus />
              <CampoClave id="blanqueo-2" label="Repetila" value={clave2} onChange={setClave2} autoComplete="new-password" />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setBlanqueo(false)} disabled={guardando}>Volver</Button>
                <Button onClick={blanquear} disabled={guardando}>
                  {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Blanquear contraseña"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-5">
              {nuevo && (
                <div className="space-y-2">
                  <Label htmlFor="u-nombre">Nombre y apellido</Label>
                  <Input id="u-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: David Pérez" className="h-11" />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="u-mail">Mail (opcional)</Label>
                <Input id="u-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" autoCapitalize="none" />
                <p className="text-xs text-muted-foreground">Para recibir los avisos de borrados y de stock en cero; solo gerenciales.</p>
              </div>

              <div className="space-y-2">
                <Label>Tipo</Label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {TIPOS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => elegirTipo(t)}
                      className={cn(
                        "rounded-lg border-2 p-3 text-left transition-colors",
                        tipo === t ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                      )}
                    >
                      <p className="text-sm font-semibold">{NOMBRE_TIPO[t]}</p>
                      <p className="text-xs text-muted-foreground">{EXPLICACION_TIPO[t]}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Permisos</Label>
                <MatrizPermisos tipo={tipo} permisos={permisos} onChange={setPermisos} />
                {tipo !== "gerencial" && difs.length > 0 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPermisos(plantilla(tipo))}>
                    Volver a la plantilla de {NOMBRE_TIPO[tipo]}
                  </Button>
                )}
              </div>

              {nuevo && (
                <div className="space-y-3 rounded-md border p-3">
                  <CampoClave id="u-clave-1" label="Contraseña inicial" value={clave} onChange={setClave} autoComplete="new-password" />
                  <CampoClave id="u-clave-2" label="Repetila" value={clave2} onChange={setClave2} autoComplete="new-password" />
                  <p className="text-xs text-muted-foreground">Dásela a la persona. Al entrar la va a tener que cambiar.</p>
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <DialogFooter className="gap-2 flex-wrap sm:justify-between">
                {!nuevo ? (
                  <div className="flex gap-2 flex-wrap">
                    <Button type="button" variant="outline" onClick={() => { setClave(""); setClave2(""); setError(null); setBlanqueo(true) }} disabled={guardando}>
                      <KeyRound className="h-4 w-4 mr-2" />
                      Blanquear contraseña
                    </Button>
                    {usuario!.active ? (
                      usuario!.id !== yo && (
                        <Button type="button" variant="outline" className="text-destructive" onClick={() => setConfirmarBaja(true)} disabled={guardando}>
                          <UserX className="h-4 w-4 mr-2" />
                          Dar de baja
                        </Button>
                      )
                    ) : (
                      <Button type="button" variant="outline" onClick={() => cambiarActivo(true)} disabled={guardando}>
                        <UserCheck className="h-4 w-4 mr-2" />
                        Reactivar
                      </Button>
                    )}
                  </div>
                ) : <span />}
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>Cerrar</Button>
                  <Button onClick={guardar} disabled={guardando}>
                    {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : nuevo ? "Crear usuario" : "Guardar"}
                  </Button>
                </div>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!cambioTipo} onOpenChange={(v) => !v && setCambioTipo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cambiar a {cambioTipo ? NOMBRE_TIPO[cambioTipo] : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se reemplazan los permisos actuales por los de {cambioTipo ? NOMBRE_TIPO[cambioTipo] : ""}. Después podés agregar o sacar
              permisos puntuales. No se graba hasta tocar Guardar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (cambioTipo) {
                  setTipo(cambioTipo)
                  setPermisos(plantilla(cambioTipo))
                }
                setCambioTipo(null)
              }}
            >
              Cambiar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmarBaja} onOpenChange={setConfirmarBaja}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Dar de baja a {usuario?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              No va a poder entrar y se cierran sus sesiones abiertas. Lo que cargó queda igual. Se puede reactivar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction onClick={() => cambiarActivo(false)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Dar de baja
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
