import { NextResponse } from "next/server"
import { registrarActividad, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { cargarPuestoPorId } from "@/lib/carga/datos"
import { contextoServidor, error, exigirCarga, recalcularBloqueos, registrarEvento } from "@/lib/carga/servidor"
import { INFO_SALIDA, SALIDAS, type Salida } from "@/lib/carga/tipos"

export const dynamic = "force-dynamic"

/**
 * Cambiar qué material hay en una salida con alternativas (la Tolva 1: Piedra 6/12 o 6/20; 6.3). carga.cargar.
 * Body: {puesto_id, salida, material_id}. Cierra la fila vigente (vigente_hasta) y abre otra: queda la historia,
 * en Actividad, y vale para el control de receta de las cargas que esperan. No se cambia con una carga en curso.
 */
export async function POST(req: Request) {
  try {
    const r = await exigirCarga("carga", "cargar")
    if (r.respuesta) return r.respuesta
    const body = await req.json().catch(() => ({}))
    const sb = sbServicio()
    const puesto = await cargarPuestoPorId(sb, String(body?.puesto_id || ""))
    if (!puesto) return error("El puesto de carga no existe.", 404)
    const salida = String(body?.salida || "") as Salida
    if (!SALIDAS.includes(salida)) return error("Salida desconocida.")
    const { data: vig } = await sb.from("puesto_salidas").select("*").eq("puesto_id", puesto.id).eq("salida", salida).is("vigente_hasta", null).maybeSingle()
    if (!vig) return error("Esa salida no está en el mapa del puesto.", 404)
    const v = vig as any
    const material = String(body?.material_id || "")
    if (!(v.alternativas || []).includes(material)) return error(`La ${INFO_SALIDA[salida].nombre} no puede tener ese material.`)
    if (v.material_id === material) return NextResponse.json({ ok: true, sin_cambios: true })
    const { data: ocup } = await sb.from("cargas").select("id").eq("puesto_id", puesto.id).in("estado", ["en_curso", "suspendida"]).limit(1)
    if (ocup?.length) return error("No se cambia la tolva con una carga en curso.", 409)
    const ahora = new Date().toISOString()
    const { error: e1 } = await sb.from("puesto_salidas").update({ vigente_hasta: ahora }).eq("id", v.id)
    if (e1) throw e1
    const { error: e2 } = await sb.from("puesto_salidas").insert({
      puesto_id: puesto.id, salida, nombre_planta: v.nombre_planta, material_id: material, unidad_planta: v.unidad_planta,
      factor_a_unidad_sistema: v.factor_a_unidad_sistema, alternativas: v.alternativas, vigente_desde: ahora, cambiado_por: r.usuario,
    })
    if (e2) throw e2
    const { data: mats } = await sb.from("materials").select("id, name").in("id", [v.material_id, material].filter(Boolean))
    const nom = (id: string | null) => ((mats || []) as { id: string; name: string }[]).find((m) => m.id === id)?.name || "vacía"
    await registrarEvento({ carga_id: null, puesto_id: puesto.id, tipo: "salida_cambiada", detalle: { salida, antes: nom(v.material_id), ahora: nom(material) }, usuario: r.usuario })
    await registrarActividad({ usuario: r.usuario, action: "editar", entity: "carga", entityId: puesto.id, reference: puesto.nombre, details: { [INFO_SALIDA[salida].nombre]: `${nom(v.material_id)} → ${nom(material)}` } })
    const recalculadas = await recalcularBloqueos(await contextoServidor(puesto))
    return NextResponse.json({ ok: true, recalculadas })
  } catch (e) {
    return respuestaError(e)
  }
}
