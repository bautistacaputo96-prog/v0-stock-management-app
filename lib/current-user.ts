/**
 * Usuario en sesión (caché del navegador).
 *
 * Desde la fase 0c-1 cada persona entra con su contraseña propia y la sesión vive en una cookie firmada
 * del servidor (httpOnly). Acá se guarda SOLO un caché de quién es y qué puede hacer, que el login
 * (`components/login-gate.tsx`) refresca con `GET /api/sesion` al abrir y cada 15 minutos. Cambiar este
 * caché a mano no da acceso: al recargar, el servidor lo pisa.
 *
 * Los botones se condicionan con `puede(seccion, accion)` / `usePermisos()`; ningún componente compara
 * `tipo` ni `role` a mano (lo "solo gerencial" usa `esGerencial()`).
 */
import { useEffect, useState } from "react"
import {
  normalizarPermisos,
  puedeCon,
  puedeAjustarPedido,
  tipoDe,
  type Accion,
  type Permisos,
  type SeccionClave,
  type Tipo,
} from "@/lib/permisos"

export type CurrentUser = {
  id: string
  name: string
  tipo: Tipo
  permisos: Permisos
  /** Fase 2: ve las funciones nuevas en prueba (app_users.ve_funciones_nuevas) */
  veFuncionesNuevas: boolean
  /** Derivado del tipo (gerencial → supervisor), para lo viejo que todavía lo mire. */
  role: "operario" | "supervisor"
}

const STORAGE_KEY = "rebucret_current_user"
const EVENTO_USUARIO = "rebucret-usuario-actualizado"

/** Arma el usuario del caché a partir de lo que devuelve el servidor (o de lo guardado). */
export function armarUsuario(raw: any): CurrentUser | null {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id || !raw.name) return null
  // Caché del login viejo (sin tipo): no vale como sesión
  if (raw.tipo !== "gerencial" && raw.tipo !== "operario" && raw.tipo !== "consulta") return null
  const tipo = tipoDe(raw)
  return {
    id: raw.id,
    name: String(raw.name),
    tipo,
    permisos: normalizarPermisos(raw.permisos),
    veFuncionesNuevas: raw.veFuncionesNuevas === true,
    role: tipo === "gerencial" ? "supervisor" : "operario",
  }
}

export function getCurrentUser(): CurrentUser | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return armarUsuario(JSON.parse(raw))
  } catch {
    return null
  }
}

export function setCurrentUser(user: Omit<CurrentUser, "role"> | CurrentUser) {
  if (typeof window === "undefined") return
  const u = armarUsuario(user)
  if (!u) return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(u))
  window.dispatchEvent(new Event(EVENTO_USUARIO))
}

export function clearCurrentUser() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(STORAGE_KEY)
  // Restos del login viejo (contraseña compartida)
  window.localStorage.removeItem("rebucret-auth")
  window.dispatchEvent(new Event(EVENTO_USUARIO))
}

/** Nombre a guardar en los registros; nunca vacío para no perder trazabilidad. */
export function currentUserName(): string {
  return getCurrentUser()?.name || "Desconocido"
}

/** ¿La persona en sesión puede hacer `accion` en `seccion`? Lee el caché, no espera a nada. */
export function puede(seccion: SeccionClave, accion: Accion): boolean {
  return puedeCon(getCurrentUser(), seccion, accion)
}

export function esGerencial(): boolean {
  return getCurrentUser()?.tipo === "gerencial"
}

/** Alias de antes (supervisor = gerencial). */
export function isSupervisor(): boolean {
  return esGerencial()
}

/**
 * Interruptor de funciones nuevas (fase 2, "modo prueba por usuario"): las funciones en prueba
 * solo se muestran a los usuarios con app_users.ve_funciones_nuevas = true. Viene con la sesión.
 */
export function veFuncionesNuevas(): boolean {
  return getCurrentUser()?.veFuncionesNuevas === true
}

/** Actualiza la marca del usuario en sesión sin tocar lo demás (lo usa la pantalla Usuarios). */
export function setVeFuncionesNuevas(valor: boolean) {
  const u = getCurrentUser()
  if (!u || u.veFuncionesNuevas === valor) return
  setCurrentUser({ ...u, veFuncionesNuevas: valor })
}

/** Lee el caché y se vuelve a leer cuando cambia (login, revalidación, otra pestaña). */
function useUsuarioCache(): { usuario: CurrentUser | null; listo: boolean } {
  const [estado, setEstado] = useState<{ usuario: CurrentUser | null; listo: boolean }>({ usuario: null, listo: false })
  useEffect(() => {
    const leer = () => setEstado({ usuario: getCurrentUser(), listo: true })
    leer()
    window.addEventListener(EVENTO_USUARIO, leer)
    window.addEventListener("storage", leer)
    return () => {
      window.removeEventListener(EVENTO_USUARIO, leer)
      window.removeEventListener("storage", leer)
    }
  }, [])
  return estado
}

/** Hook: false en el primer render (igual que el servidor) y después la marca del usuario. */
export function useFuncionesNuevas(): boolean {
  return useUsuarioCache().usuario?.veFuncionesNuevas === true
}

/**
 * Hook de permisos. En el primer render todo da `false` (`listo = false`); después, lo del caché.
 * - `puede(seccion, accion)`
 * - `ajustaPedido(pedido)`: con programacion.editar, cualquiera; con solo cargar, los propios (created_by).
 */
export function usePermisos() {
  const { usuario, listo } = useUsuarioCache()
  return {
    listo,
    usuario,
    tipo: usuario?.tipo ?? null,
    esGerencial: usuario?.tipo === "gerencial",
    puede: (seccion: SeccionClave, accion: Accion) => puedeCon(usuario, seccion, accion),
    ajustaPedido: (pedido: { created_by?: string | null } | null | undefined) => puedeAjustarPedido(usuario, pedido),
  }
}
