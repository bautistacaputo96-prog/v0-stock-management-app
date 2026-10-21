/**
 * Alta de cliente nuevo con control de duplicados (regla de Bautista del 21/10/2026: no dar de alta el mismo
 * cliente con otro nombre). Solo crea en Rebucret; no toca Zomatik.
 *
 *   POST /api/clientes/alta   {datos, descartados?: ["rebucret:<id>" | "zomatik:<código>"], excepcion?: {motivo}}
 *
 *   - CUIT válido obligatorio (11 dígitos con el dígito verificador; no se acepta DNI), salvo excepción de un
 *     gerencial con motivo (precisión de Bautista del 21/10/2026).
 *   - Mismo CUIT/DNI en Rebucret o en Zomatik (aunque el nombre sea otro) → 409 "mismo_documento": no se crea.
 *   - Nombres parecidos en los dos lados → 409 "parecidos" ("¿Es alguno de estos?"). Para seguir hay que mandar
 *     los descartados ("No, es otro cliente").
 *   - Queda en Actividad quién lo dio de alta y por qué.
 */
import { NextResponse } from "next/server"
import { exigirSesion, modoPruebaLocal, respuestaModoLocal, respuestaError, registrarActividad, sbServicio } from "@/lib/auth/servidor"
import { puedeCon, tipoDe } from "@/lib/permisos"
import { documentoValido, verificarAlta } from "@/lib/clientes-buscar"
import { cargarClientesParaBuscar, olvidarClientes } from "@/lib/clientes-datos"

export const dynamic = "force-dynamic"

const CAMPOS = ["name", "razon_social", "cuit", "cond_iva", "contact", "phone", "email", "remito_tipo", "plant_id", "direccion_fiscal", "cp", "localidad_cliente", "provincia", "cond_pago"] as const

export async function POST(req: Request) {
  if (modoPruebaLocal()) return respuestaModoLocal()
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    const u = r.sesion.usuario
    if (!puedeCon(u, "clientes", "cargar")) return NextResponse.json({ error: "No tenés permiso para cargar clientes." }, { status: 403 })
    const body = await req.json().catch(() => ({}))
    const datos: Record<string, unknown> = {}
    for (const k of CAMPOS) {
      const v = body?.datos?.[k]
      if (typeof v === "string" && v.trim()) datos[k] = v.trim()
    }
    if (datos.remito_tipo && !["R", "X"].includes(String(datos.remito_tipo))) delete datos.remito_tipo
    if (datos.plant_id && !/^[0-9a-f-]{36}$/i.test(String(datos.plant_id))) delete datos.plant_id
    const nombre = String(datos.name || datos.razon_social || "").replace(/\s+/g, " ")
    if (nombre.length < 2) return NextResponse.json({ codigo: "nombre", error: "Poné el nombre del cliente." }, { status: 400 })
    datos.name = nombre
    if (!datos.razon_social) datos.razon_social = nombre

    const d0 = documentoValido(datos.cuit)
    const doc = d0 && d0.tipo === "CUIT" ? d0 : null
    const motivoExc = String(body?.excepcion?.motivo || "").trim()
    if (!doc) {
      if (tipoDe(u) !== "gerencial" || motivoExc.length < 5)
        return NextResponse.json(
          { codigo: "documento", error: d0?.tipo === "DNI" ? "El alta pide CUIT, no DNI (11 dígitos con el dígito verificador). Sin CUIT, solo un gerencial puede darlo de alta, con motivo." : "Hace falta un CUIT válido (11 dígitos con el dígito verificador correcto). Sin CUIT, solo un gerencial puede darlo de alta, con motivo." },
          { status: 400 },
        )
    }

    olvidarClientes()
    const { nuestros, zomatik } = await cargarClientesParaBuscar(sbServicio())
    const v = verificarAlta({ nombre, cuit: doc ? String(datos.cuit) : null }, nuestros, zomatik)
    if (v.mismoDoc.length) return NextResponse.json({ codigo: "mismo_documento", error: "Ya existe un cliente con ese CUIT.", conflictos: v.mismoDoc }, { status: 409 })
    const descartados = new Set<string>(Array.isArray(body?.descartados) ? body.descartados.map(String) : [])
    const pendientes = v.parecidos.filter((p) => !descartados.has(`${p.tipo}:${p.id}`))
    if (pendientes.length) return NextResponse.json({ codigo: "parecidos", error: "¿Es alguno de estos?", conflictos: pendientes }, { status: 409 })

    const { data: creado, error } = await sbServicio().from("clients").insert({ ...datos, active: true }).select("id, name").single()
    if (error) throw error
    olvidarClientes()
    await registrarActividad({
      usuario: u.name,
      action: "crear",
      entity: "cliente",
      entityId: (creado as any).id,
      reference: (creado as any).name,
      details: {
        Cliente: nombre,
        CUIT: doc ? String(datos.cuit) : "sin CUIT válido",
        ...(doc ? {} : { "Excepción de gerencial": motivoExc }),
        ...(descartados.size ? { "Dijo que no es": v.parecidos.filter((p) => descartados.has(`${p.tipo}:${p.id}`)).map((p) => `${p.nombre}${p.tipo === "zomatik" ? " (Zomatik)" : ""}`).join(", ") } : {}),
        "Condición IVA": String(datos.cond_iva || "-"),
      },
    })
    return NextResponse.json({ cliente: creado })
  } catch (e) {
    return respuestaError(e)
  }
}
