"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { UserPlus } from "lucide-react"
import { toast } from "sonner"

interface User {
  id: string
  name: string
}

interface UserSelectorProps {
  value: string
  onValueChange: (value: string) => void
  label?: string
  required?: boolean
}

export function UserSelector({ value, onValueChange, label = "Responsable", required = false }: UserSelectorProps) {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [newUserName, setNewUserName] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadUsers()
  }, [])

  async function loadUsers() {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("app_users")
      .select("id, name")
      .eq("active", true)
      .order("name")

    if (!error && data) {
      setUsers(data)
      // If no value is set and there are users, set the first one
      if (!value && data.length > 0) {
        onValueChange(data[0].name)
      }
    }
    setLoading(false)
  }

  async function handleAddUser() {
    if (!newUserName.trim()) {
      toast.error("Ingrese un nombre")
      return
    }

    setSaving(true)
    const supabase = createClient()

    const { data, error } = await supabase
      .from("app_users")
      .insert({ name: newUserName.trim() })
      .select()
      .single()

    if (error) {
      toast.error("Error al agregar usuario")
      setSaving(false)
      return
    }

    toast.success("Usuario agregado")
    setUsers([...users, data])
    onValueChange(data.name)
    setNewUserName("")
    setShowAddDialog(false)
    setSaving(false)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label} {required && "*"}</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => setShowAddDialog(true)}
        >
          <UserPlus className="h-3 w-3 mr-1" />
          Agregar
        </Button>
      </div>
      <Select value={value} onValueChange={onValueChange} disabled={loading}>
        <SelectTrigger>
          <SelectValue placeholder={loading ? "Cargando..." : "Seleccionar"} />
        </SelectTrigger>
        <SelectContent>
          {users.map((user) => (
            <SelectItem key={user.id} value={user.name}>
              {user.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Agregar Usuario</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nombre completo</Label>
              <Input
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                placeholder="Nombre y apellido"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    handleAddUser()
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleAddUser} disabled={saving}>
              {saving ? "Guardando..." : "Agregar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
