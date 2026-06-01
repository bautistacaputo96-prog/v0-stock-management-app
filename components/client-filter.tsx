"use client"

import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface ClientFilterProps {
  clients: any[]
  selectedClient: string
  onFilterChange: (clientId: string) => void
}

export function ClientFilter({ clients, selectedClient, onFilterChange }: ClientFilterProps) {
  return (
    <div className="flex flex-col gap-2">
      <Label>Cliente</Label>
      <Select value={selectedClient} onValueChange={onFilterChange}>
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="Todos los clientes" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los clientes</SelectItem>
          {clients.map((client) => (
            <SelectItem key={client.id} value={client.id}>
              {client.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
