"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Lock, Wrench, Package, Fuel, ClipboardList, Settings } from "lucide-react"
import { PanolModule } from "./panol-module"
import { TareasModule } from "./tareas-module"
import { CombustibleModule } from "./combustible-module"

const PLANTS = [
  { id: "silke", name: "SILKE" },
  { id: "villa_rosa", name: "Villa Rosa" },
  { id: "ranchos", name: "Ranchos" },
]

export function MaintenanceContent() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [selectedPlant, setSelectedPlant] = useState("silke")
  const [activeTab, setActiveTab] = useState("panol")
  
  const supabase = createClient()

  // Check if already authenticated (session storage)
  useEffect(() => {
    const auth = sessionStorage.getItem("maintenance_auth")
    if (auth === "true") {
      setIsAuthenticated(true)
    }
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")

    try {
      const { data, error: dbError } = await supabase
        .from("maintenance_users")
        .select("*")
        .eq("username", username)
        .eq("is_active", true)
        .single()

      if (dbError || !data) {
        setError("Usuario no encontrado")
        setLoading(false)
        return
      }

      // Simple password check (in production, use proper hashing)
      if (data.password_hash !== password) {
        setError("Contraseña incorrecta")
        setLoading(false)
        return
      }

      // Success
      sessionStorage.setItem("maintenance_auth", "true")
      sessionStorage.setItem("maintenance_user", data.username)
      setIsAuthenticated(true)
    } catch (err) {
      setError("Error al iniciar sesión")
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = () => {
    sessionStorage.removeItem("maintenance_auth")
    sessionStorage.removeItem("maintenance_user")
    setIsAuthenticated(false)
    setUsername("")
    setPassword("")
  }

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Lock className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">Módulo de Mantenimiento</CardTitle>
            <CardDescription>
              Ingrese sus credenciales para acceder
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Usuario</Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Nombre de usuario"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Contraseña"
                  required
                />
              </div>
              {error && (
                <p className="text-sm text-destructive text-center">{error}</p>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Ingresando..." : "Ingresar"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <Wrench className="h-8 w-8" />
            Mantenimiento
          </h1>
          <p className="text-muted-foreground">
            Gestión de pañol, tareas y combustible
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedPlant} onValueChange={setSelectedPlant}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Seleccionar planta" />
            </SelectTrigger>
            <SelectContent>
              {PLANTS.map((plant) => (
                <SelectItem key={plant.id} value={plant.id}>
                  {plant.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={handleLogout}>
            Cerrar sesión
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 lg:w-[400px]">
          <TabsTrigger value="panol" className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            <span className="hidden sm:inline">Pañol</span>
          </TabsTrigger>
          <TabsTrigger value="tareas" className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            <span className="hidden sm:inline">Tareas</span>
          </TabsTrigger>
          <TabsTrigger value="combustible" className="flex items-center gap-2">
            <Fuel className="h-4 w-4" />
            <span className="hidden sm:inline">Combustible</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="panol">
          <PanolModule plant={selectedPlant} />
        </TabsContent>

        <TabsContent value="tareas">
          <TareasModule plant={selectedPlant} />
        </TabsContent>

        <TabsContent value="combustible">
          <CombustibleModule plant={selectedPlant} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
