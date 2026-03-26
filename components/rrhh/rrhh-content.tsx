"use client"

import { useState } from "react"
import { RRHHLogin } from "./rrhh-login"
import { EmployeeManager } from "./employee-manager"
import { AttendanceGrid } from "./attendance-grid"
import { AttendanceAnalysis } from "./attendance-analysis"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { LogOut, Users, CalendarDays, BarChart3 } from "lucide-react"

export function RRHHContent() {
  const [user, setUser] = useState<{ id: number; username: string; fullName: string } | null>(null)

  if (!user) {
    return <RRHHLogin onLogin={setUser} />
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Sesión iniciada como <span className="font-semibold text-foreground">{user.fullName}</span>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setUser(null)} className="gap-2 bg-transparent">
          <LogOut className="h-4 w-4" />
          Cerrar Sesión
        </Button>
      </div>

      <Tabs defaultValue="employees">
        <TabsList className="grid w-full max-w-xl grid-cols-3">
          <TabsTrigger value="employees" className="gap-2">
            <Users className="h-4 w-4" />
            Empleados
          </TabsTrigger>
          <TabsTrigger value="attendance" className="gap-2">
            <CalendarDays className="h-4 w-4" />
            Asistencia
          </TabsTrigger>
          <TabsTrigger value="analysis" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Analisis
          </TabsTrigger>
        </TabsList>
        <TabsContent value="employees" className="mt-4">
          <EmployeeManager />
        </TabsContent>
        <TabsContent value="attendance" className="mt-4">
          <AttendanceGrid />
        </TabsContent>
        <TabsContent value="analysis" className="mt-4">
          <AttendanceAnalysis />
        </TabsContent>
      </Tabs>
    </div>
  )
}
