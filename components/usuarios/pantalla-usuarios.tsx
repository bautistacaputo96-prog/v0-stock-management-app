"use client"

import { useEffect, useState } from "react"
import { Loader2, Plus, RefreshCw, KeyRound, ChevronDown, FlaskConical, Lock } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { NuevoBadge } from "@/components/nuevo-badge"
import { DialogoUsuario, type UsuarioPantalla } from "@/components/usuarios/dialogo-usuario"
import { getCurrentUser, setVeFuncionesNuevas } from "@/lib/current-user"
import { NOMBRE_TIPO, SECCIONES, diferenciasConPlantilla, seccionesCon, type Tipo } from "@/lib/permisos"
import { cn } from "@/lib/utils"

const COLOR_TIPO: Record<Tipo, string> = {
  gerencial: "bg-blue-100 text-blue-800 border-blue-300",
  operario: "bg-emerald-100 text-emerald-800 border-emerald-300",
  consulta: "bg-slate-100 text-slate-700 border-slate-300",
}

const COLOR_CLAVE: Record<UsuarioPantalla["estadoClave"], string> = {
  propia: "text-emerald-700",
  "tiene que cambiarla": "text-amber-700",
  "primer ingreso pendiente": "text-amber-700",
  "sin contraseña": "text-red-700",
}

function fecha(iso: string | null) {
  if (!iso) return "nunca"
  return new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })
}

/** "Edita/borra: …": solo lo habilitado a mano (lo que no viene de la plantilla del tipo). */
function editaBorraAMano(u: UsuarioPantalla): string[] {
  const nombres = Object.fromEntries(SECCIONES.map((s) => [s.clave, s.nombre]))
  return diferenciasConPlantilla(u.tipo, u.permisos)
    .filter((d) => d.valor && (d.accion === "editar" || d.accion === "borrar"))
    .map((d) => `${nombres[d.seccion]} (${d.accion})`)
}

/** Fase 0c-1 · Pantalla Usuarios (solo gerenciales). */
export function PantallaUsuarios() {
  const [usuarios, setUsuarios] = useState<UsuarioPantalla[]>([])
  const [yo, setYo] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogo, setDialogo] = useState<{ open: boolean; usuario: UsuarioPantalla | null }>({ open: false, usuario: null })
  const [verBajas, setVerBajas] = useState(false)
  const [confirmarCierre, setConfirmarCierre] = useState(false)
  const [guardando, setGuardando] = useState<string | null>(null)

  async function cargar() {
    setCargando(true)
    setError(null)
    try {
      const r = await fetch("/api/usuarios", { cache: "no-store" })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error || "No se pudo leer la lista de usuarios.")
      setUsuarios(d.usuarios || [])
      setYo(d.yo || null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }
  useEffect(() => {
    cargar()
  }, [])

  async function cambiarFunciones(u: UsuarioPantalla, valor: boolean) {
    setGuardando(u.id)
    try {
      const r = await fetch(`/api/usuarios/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ve_funciones_nuevas: valor }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error || "No se pudo guardar.")
      setUsuarios((us) => us.map((x) => (x.id === u.id ? { ...x, veFuncionesNuevas: valor } : x)))
      if (getCurrentUser()?.id === u.id) setVeFuncionesNuevas(valor)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setGuardando(null)
    }
  }

  async function cerrarClaveComun() {
    setGuardando("cierre")
    try {
      const r = await fetch("/api/usuarios/cerrar-clave-comun", { method: "POST" })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error || "No se pudo cerrar.")
      toast.success("Listo: la contraseña común ya no sirve para nadie.")
      cargar()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setGuardando(null)
      setConfirmarCierre(false)
    }
  }

  const activos = usuarios.filter((u) => u.active)
  const bajas = usuarios.filter((u) => !u.active)
  const pendientes = activos.filter((u) => u.estadoClave === "primer ingreso pendiente")
  const prendidos = activos.filter((u) => u.veFuncionesNuevas).length

  function fila(u: UsuarioPantalla) {
    const carga = seccionesCon(u, "cargar")
    const aMano = editaBorraAMano(u)
    return (
      <div key={u.id} className={cn("rounded-lg border p-3 flex flex-col md:flex-row md:items-center gap-3", !u.active && "opacity-70")}>
        <button type="button" className="flex-1 min-w-0 text-left space-y-1" onClick={() => setDialogo({ open: true, usuario: u })}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{u.name}</span>
            <Badge variant="outline" className={COLOR_TIPO[u.tipo]}>{NOMBRE_TIPO[u.tipo]}</Badge>
            {u.id === yo && <span className="text-xs text-muted-foreground">(vos)</span>}
            {u.bloqueado && <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300"><Lock className="h-3 w-3 mr-1" />bloqueado</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            {u.tipo === "gerencial" ? "Puede todo" : carga.length ? `Carga en: ${carga.join(", ")}` : "No carga nada"}
          </p>
          {aMano.length > 0 && <p className="text-xs text-amber-800">Edita/borra: {aMano.join(", ")}</p>}
          <p className="text-xs">
            <span className={COLOR_CLAVE[u.estadoClave]}>Contraseña: {u.estadoClave}</span>
            <span className="text-muted-foreground"> · último ingreso: {fecha(u.ultimoIngreso)}</span>
          </p>
        </button>
        <label className="flex items-center gap-2 text-xs shrink-0 cursor-pointer">
          <FlaskConical className="h-3.5 w-3.5 text-violet-700" />
          Funciones nuevas
          <Switch checked={u.veFuncionesNuevas} disabled={guardando === u.id || !u.active} onCheckedChange={(v) => cambiarFunciones(u, v)} />
        </label>
      </div>
    )
  }

  return (
    <div className="py-4 px-4 md:py-6 md:px-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Usuarios</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">Quién entra, qué puede cargar, editar o borrar</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={cargar} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Actualizar
          </Button>
          <Button size="sm" onClick={() => setDialogo({ open: true, usuario: null })} className="gap-2">
            <Plus className="h-4 w-4" />
            Nuevo usuario
          </Button>
        </div>
      </div>

      {!cargando && pendientes.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/60">
          <CardContent className="pt-4 space-y-2">
            <p className="text-sm font-medium">
              Primer ingreso pendiente: {pendientes.length} de {activos.length}
            </p>
            <p className="text-xs text-muted-foreground">
              Todavía no eligieron su contraseña: {pendientes.map((u) => u.name).join(", ")}. Pueden entrar una vez con la contraseña de
              siempre.
            </p>
            <Button size="sm" variant="outline" className="bg-background" onClick={() => setConfirmarCierre(true)} disabled={guardando === "cierre"}>
              <KeyRound className="h-4 w-4 mr-2" />
              Cerrar el ingreso con la contraseña común
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
            {activos.length} usuarios activos
            <span className="font-normal text-muted-foreground flex items-center gap-1">
              · funciones nuevas en prueba <NuevoBadge />: las ven {prendidos} de {activos.length} (al volver a abrir el sistema)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {cargando ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            activos.map(fila)
          )}
        </CardContent>
      </Card>

      {bajas.length > 0 && (
        <div className="space-y-2">
          <Button variant="ghost" size="sm" onClick={() => setVerBajas(!verBajas)} className="gap-2">
            <ChevronDown className={cn("h-4 w-4 transition-transform", verBajas && "rotate-180")} />
            Ver dados de baja ({bajas.length})
          </Button>
          {verBajas && <div className="space-y-2">{bajas.map(fila)}</div>}
        </div>
      )}

      <DialogoUsuario
        open={dialogo.open}
        onOpenChange={(v) => setDialogo((d) => ({ ...d, open: v }))}
        usuario={dialogo.usuario}
        yo={yo}
        onGuardado={(m) => {
          toast.success(m)
          cargar()
        }}
      />

      <AlertDialog open={confirmarCierre} onOpenChange={setConfirmarCierre}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cerrar el ingreso con la contraseña común?</AlertDialogTitle>
            <AlertDialogDescription>
              Los que no eligieron su contraseña no van a poder entrar hasta que les des una.
              {pendientes.length > 0 && ` Quedan: ${pendientes.map((u) => u.name).join(", ")}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction onClick={cerrarClaveComun}>Cerrar el ingreso</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
