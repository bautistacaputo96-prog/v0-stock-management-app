"use client"

/**
 * Alta de cliente con control de duplicados (regla de Bautista del 21/10/2026). Lo usan el alta rápida
 * (add-client-dialog) y el "Nuevo cliente" de Clientes.
 *   - `pedirAlta`: manda el alta a /api/clientes/alta (que exige CUIT válido, salvo excepción gerencial con motivo,
 *     y controla los dos lados: Rebucret y Zomatik).
 *   - `ConflictoAlta`: si el servidor encontró el mismo CUIT (no deja crear) o nombres parecidos ("¿Es alguno de
 *     estos?"), muestra cada uno con su evidencia y "Sí, es este" (usa el existente y guarda el nombre escrito
 *     como alias) o "Traer de Zomatik". Para crear igual, "No, es otro cliente".
 */
import { useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

export type ConflictoC = { tipo: "rebucret" | "zomatik"; id: string; nombre: string; motivo: string; evidencia: string; dado_de_baja?: boolean }
export type RespuestaAlta =
  | { ok: true; cliente: { id: string; name: string } }
  | { ok: false; codigo: "documento" | "mismo_documento" | "parecidos" | "nombre" | "otro"; error: string; conflictos?: ConflictoC[] }

export async function pedirAlta(datos: Record<string, unknown>, descartados: string[], excepcion?: string): Promise<RespuestaAlta> {
  const r = await fetch("/api/clientes/alta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ datos, descartados, ...(excepcion ? { excepcion: { motivo: excepcion } } : {}) }),
  })
  const j = await r.json().catch(() => ({}))
  if (r.ok && j?.cliente) return { ok: true, cliente: j.cliente }
  return { ok: false, codigo: j?.codigo || "otro", error: j?.error || "No se pudo dar de alta", conflictos: j?.conflictos }
}

export function ConflictoAlta({
  respuesta,
  nombreNuevo,
  plantId,
  onUsar,
  onEsOtro,
}: {
  respuesta: Extract<RespuestaAlta, { ok: false }>
  nombreNuevo: string
  plantId?: string | null
  onUsar: (c: { id: string; name: string }) => void
  onEsOtro: () => void
}) {
  const [trabajando, setTrabajando] = useState<string | null>(null)
  const lista = respuesta.conflictos || []
  async function alias(clientId: string) {
    // El nombre que se escribió queda como alias del existente (para que el buscador lo encuentre así)
    await fetch("/api/clientes/alias", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: clientId, alias: nombreNuevo, origen: "alta" }) }).catch(() => {})
  }
  async function esEste(c: ConflictoC) {
    setTrabajando(`${c.tipo}:${c.id}`)
    try {
      if (c.tipo === "rebucret") {
        await alias(c.id)
        onUsar({ id: c.id, name: c.nombre })
        return
      }
      const r = await fetch("/api/zomatik/traer-cliente", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codigo: Number(c.id), plantId: plantId && plantId !== "all" ? plantId : null }) })
      const j = await r.json().catch(() => ({}))
      const cliente = j?.cliente
      if (!cliente) {
        toast.error(j?.error || "No se pudo traer de Zomatik")
        return
      }
      if (!r.ok) toast.info(j.error)
      await alias(cliente.id)
      onUsar(cliente)
    } finally {
      setTrabajando(null)
    }
  }
  const mismoDoc = respuesta.codigo === "mismo_documento"
  return (
    <div className={`space-y-2 rounded-md border p-2 text-xs ${mismoDoc ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50"}`}>
      <div className="flex items-center gap-1 font-semibold">
        <AlertTriangle className="h-4 w-4" />
        {mismoDoc ? "Ya existe un cliente con ese CUIT: no se puede crear otro." : "¿Es alguno de estos? Para no cargar el mismo cliente con otro nombre."}
      </div>
      {lista.map((c) => (
        <div key={`${c.tipo}:${c.id}`} className="flex items-start gap-2 rounded bg-background p-1.5">
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              {c.nombre} <span className="font-normal text-muted-foreground">· {c.tipo === "zomatik" ? "en Zomatik" : "en Rebucret"} · {c.motivo}</span>
            </div>
            <div className="text-muted-foreground">{c.evidencia}</div>
            {c.dado_de_baja && <div className="text-red-700">Está dado de baja: reactivalo en Clientes en vez de crear otro.</div>}
          </div>
          {!c.dado_de_baja && (
            <Button type="button" size="sm" variant="outline" className="h-7 shrink-0 px-2 text-xs" disabled={!!trabajando} onClick={() => esEste(c)}>
              {trabajando === `${c.tipo}:${c.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : c.tipo === "zomatik" ? "Sí, es este (traer)" : "Sí, es este"}
            </Button>
          )}
        </div>
      ))}
      {!mismoDoc && (
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={!!trabajando} onClick={onEsOtro}>
            No, es otro cliente
          </Button>
        </div>
      )}
    </div>
  )
}
