/**
 * Usuario en sesión.
 *
 * El login es por nombre + una contraseña compartida ("rebucret"), así que la
 * identidad sirve para saber quién carga qué en el día a día, pero no es una
 * credencial fuerte: cualquiera que conozca la contraseña puede entrar con
 * otro nombre. Si más adelante se quiere endurecer, hay que darle contraseña
 * propia a cada usuario sin cambiar nada de lo que se registra.
 */
export type CurrentUser = {
  name: string
  role: "operario" | "supervisor"
}

const STORAGE_KEY = "rebucret_current_user"

export function getCurrentUser(): CurrentUser | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.name) return null
    return { name: parsed.name, role: parsed.role === "supervisor" ? "supervisor" : "operario" }
  } catch {
    return null
  }
}

export function setCurrentUser(user: CurrentUser) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
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
