"use client"

import { createContext, useContext, useState, useEffect, type ReactNode } from "react"
import { useRouter, usePathname } from "next/navigation"

export type UserRole = "produccion" | "administrativo" | "mantenimiento"

interface User {
  username: string
  role: UserRole
}

interface AuthContextType {
  user: User | null
  login: (username: string, password: string) => boolean
  logout: () => void
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// Usuarios del sistema
const USERS: Record<string, { password: string; role: UserRole }> = {
  "Produccion": { password: "Concretus", role: "produccion" },
  "Administrativo": { password: "Concretus", role: "administrativo" },
  "Mantenimiento": { password: "Concretus", role: "mantenimiento" },
}

// Rutas permitidas por rol
export const ALLOWED_ROUTES: Record<UserRole, string[]> = {
  produccion: ["/", "/produccion", "/informes", "/materia-prima", "/calidad", "/configuracion"],
  administrativo: ["/rrhh"],
  mantenimiento: ["/mantenimiento"],
}

// Ruta por defecto al loguearse
export const DEFAULT_ROUTE: Record<UserRole, string> = {
  produccion: "/",
  administrativo: "/rrhh",
  mantenimiento: "/mantenimiento",
}

export function isRouteAllowed(role: UserRole, pathname: string): boolean {
  const allowed = ALLOWED_ROUTES[role]
  return allowed.some(route => {
    if (route === "/") {
      return pathname === "/"
    }
    return pathname === route || pathname.startsWith(route + "/")
  })
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()
  const pathname = usePathname()

  // Cargar usuario de localStorage al iniciar
  useEffect(() => {
    const stored = localStorage.getItem("concretus_user")
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        setUser(parsed)
      } catch {
        localStorage.removeItem("concretus_user")
      }
    }
    setIsLoading(false)
  }, [])

  // Redirigir si no está autenticado o no tiene acceso
  useEffect(() => {
    if (isLoading) return
    
    // Si está en login, no hacer nada
    if (pathname === "/login") return

    // Si no hay usuario, redirigir a login
    if (!user) {
      router.push("/login")
      return
    }

    // Si el usuario no tiene acceso a esta ruta, redirigir a su ruta por defecto
    if (!isRouteAllowed(user.role, pathname)) {
      router.push(DEFAULT_ROUTE[user.role])
    }
  }, [user, pathname, isLoading, router])

  const login = (username: string, password: string): boolean => {
    const userData = USERS[username]
    if (userData && userData.password === password) {
      const newUser: User = { username, role: userData.role }
      setUser(newUser)
      localStorage.setItem("concretus_user", JSON.stringify(newUser))
      return true
    }
    return false
  }

  const logout = () => {
    setUser(null)
    localStorage.removeItem("concretus_user")
    router.push("/login")
  }

  // Mostrar loading mientras se verifica la sesión
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-zinc-950">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-zinc-500 text-sm">Cargando...</p>
        </div>
      </div>
    )
  }

  // Si no hay usuario y no está en login, mostrar loading mientras redirige
  if (!user && pathname !== "/login") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-zinc-950">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-zinc-500 text-sm">Redirigiendo al login...</p>
        </div>
      </div>
    )
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
