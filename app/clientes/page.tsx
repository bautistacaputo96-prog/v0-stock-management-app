"use server"

import { ClientsManagement } from "@/components/clients-management"

export default async function ClientesPage() {
  return (
    <div className="container mx-auto py-6 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Clientes y Obras</h1>
        <p className="text-muted-foreground">Gestiona los clientes y sus obras con tiempos de viaje y descarga</p>
      </div>
      <ClientsManagement />
    </div>
  )
}
