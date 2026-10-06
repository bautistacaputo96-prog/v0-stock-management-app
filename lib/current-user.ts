/**
 * Usuario en sesión.
 *
 * El login es por nombre + una contraseña compartida ("rebucret"), así que la
 * identidad sirve para saber quién carga qué en el día a día, pero no es una
 * credencial fuerte: cualquiera que conozca la contraseña puede entrar con
 * otro nombre. Si más adelante se quiere endurecer, hay que darle contraseña
 * propia a cada usuario sin cambiar nada de lo que se registra.
 */
import { useEffect, useState } from "react"

export type CurrentUser = {
  name: string
  role: "operario" | "supervisor"
  /** Fase 2: ve las funciones nuevas en prueba (app_users.ve_funciones_nuevas) */
  veFuncionesNuevas?: boolean
}

const STORAGE_KEY = "rebucret_current_user"
const EVENTO_USUARIO = "rebucret-usuario-actualizado"

export function getCurrentUser(): CurrentUser | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.name) return null
    return { name: parsed.name, role: parsed.role === "supervisor" ? "supervisor" : "operario", veFuncionesNuevas: parsed.veFuncionesNuevas === true }
  } catch {
    return null
  }
}

export function setCurrentUser(user: CurrentUser) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
  window.dispatchEvent(new Event(EVENTO_USUARIO))
}

export function clearCurrentUser() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(STORAGE_KEY)
}

/** Nombre a guardar en los registros; nunca vacío para no perder trazabilidad. */
export function currentUserName(): string {
  return getCurrentUser()?.name || "Desconocido"
}

export function isSupervisor(): boolean {
  return getCurrentUser()?.role === "supervisor"
}

/**
 * Interruptor de funciones nuevas (fase 2, "modo prueba por usuario"): las funciones en prueba
 * solo se muestran a los usuarios con app_users.ve_funciones_nuevas = true. Se lee al iniciar sesión
 * (y se refresca al abrir el sistema) y se guarda junto al usuario actual.
 */
export function veFuncionesNuevas(): boolean {
  return getCurrentUser()?.veFuncionesNuevas === true
}

/** Actualiza la marca del usuario en sesión sin tocar lo demás (lo usa el login y Actividad). */
export function setVeFuncionesNuevas(valor: boolean) {
  const u = getCurrentUser()
  if (!u || u.veFuncionesNuevas === valor) return
  setCurrentUser({ ...u, veFuncionesNuevas: valor })
}

/** Hook: false en el primer render (igual que el servidor) y después la marca del usuario. */
export function useFuncionesNuevas(): boolean {
  const [ve, setVe] = useState(false)
  useEffect(() => {
    const leer = () => setVe(veFuncionesNuevas())
    leer()
    window.addEventListener(EVENTO_USUARIO, leer)
    window.addEventListener("storage", leer)
    return () => {
      window.removeEventListener(EVENTO_USUARIO, leer)
      window.removeEventListener("storage", leer)
    }
  }, [])
  return ve
}
