"use client"

import { SeccionProtegida } from "@/components/seccion-protegida"
import { PantallaUsuarios } from "@/components/usuarios/pantalla-usuarios"

/** Fase 0c-1 · Usuarios y permisos (solo gerenciales). */
export default function UsuariosPage() {
  return (
    <SeccionProtegida soloGerencial>
      <PantallaUsuarios />
    </SeccionProtegida>
  )
}
