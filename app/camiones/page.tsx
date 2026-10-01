"use server"

import { CamionesTabs } from "@/components/camiones-tabs"

export default async function CamionesPage() {
  return (
    <div className="container mx-auto py-6 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Gestion de Camiones</h1>
        <p className="text-muted-foreground">Administra la flota de mixers con capacidad y estado en tiempo real, los choferes y las empresas de bombeo</p>
      </div>
      <CamionesTabs />
    </div>
  )
}
