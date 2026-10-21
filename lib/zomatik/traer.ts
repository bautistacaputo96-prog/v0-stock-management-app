/**
 * Zomatik Z0 · "Traer de Zomatik": crea el cliente EN NUESTRA BASE, vinculado al código de Zomatik.
 * No escribe nada en Zomatik (spec 16.5). SOLO servidor.
 *
 * Nunca duplica:
 *   - si ya hay un cliente nuestro con ese código, se devuelve ese;
 *   - si hay uno con el mismo nombre (normalizado) o el mismo CUIT válido, NO se crea: se avisa para vincularlo;
 *   - se compara contra todos, también los dados de baja: si el que coincide está de baja, se avisa
 *     "reactivalo" y no se crea ni se devuelve;
 *   - `clients.zomatik_codigo` es único en la base: dos "Traer" a la vez no pueden crear dos.
 */
import { sbServicio } from "@/lib/auth/servidor"
import { obtenerSesion, fetchFichaCliente } from "@/lib/zomatik/cliente"
import { parseFichaCliente, cuitValido, soloDigitos, condIvaDeZomatik, condPagoDeZomatik, remitoSugerido, nombreNormalizado } from "@/lib/zomatik/parseo"
import { yaEstaEnRebucret } from "@/lib/zomatik/vinculos"

const FICHA_VENCE_MS = 30 * 86400_000

export type ResultadoTraer =
  | { ok: true; cliente: { id: string; name: string }; yaEstaba: boolean; aviso?: string }
  | { ok: false; status: number; error: string; cliente?: { id: string; name: string } }

export async function traerCliente(opts: { codigo: number; plantId?: string | null; usuario: string }): Promise<ResultadoTraer> {
  const sb = sbServicio()
  const { codigo } = opts
  if (!Number.isInteger(codigo) || codigo <= 0) return { ok: false, status: 400, error: "Código de Zomatik inválido" }

  const COLS = "id, name, razon_social, cuit, zomatik_codigo, active"
  // unificado_en existe recién con la migración de alias: si no está, sin ella
  let { data: nuestros, error: eN } = await sb.from("clients").select(`${COLS}, unificado_en`)
  if (eN) ({ data: nuestros, error: eN } = await sb.from("clients").select(COLS))
  if (eN) throw eN
  const lista = ((nuestros as any[]) || []) as { id: string; name: string; razon_social: string | null; cuit: string | null; zomatik_codigo: number | null; active: boolean | null; unificado_en?: string | null }[]
  const porId = new Map(lista.map((c) => [c.id, c]))
  const deBaja = (c: { name: string; unificado_en?: string | null }) => {
    // Si se unificó en otro, se ofrece el que quedó
    const destino = c.unificado_en ? porId.get(c.unificado_en) : undefined
    if (destino)
      return { ok: false as const, status: 409, error: `«${c.name}» se unificó en «${destino.name}»: se usa ese.`, cliente: { id: destino.id, name: destino.name } }
    return { ok: false as const, status: 409, error: `Ya está en Rebucret como «${c.name}», pero está dado de baja: reactivalo en Clientes en vez de crear otro.` }
  }
  const vinculado = lista.find((c) => c.zomatik_codigo === codigo)
  if (vinculado) {
    if (vinculado.active === false) return deBaja(vinculado)
    return { ok: true, cliente: { id: vinculado.id, name: vinculado.name }, yaEstaba: true }
  }

  const { data: zc, error: eZ } = await sb.from("zomatik_clientes").select("*").eq("codigo", codigo).maybeSingle()
  if (eZ) throw eZ
  if (!zc) return { ok: false, status: 404, error: "Ese cliente no está en la copia de Zomatik. Probá de nuevo después de la próxima lectura." }

  // Se compara contra TODOS los clientes, también los dados de baja (para no crear uno repetido)
  const igual = yaEstaEnRebucret({ codigo, razon_social: (zc as any).razon_social }, lista)
  if (igual && igual.active === false) return deBaja(igual)
  if (igual)
    return {
      ok: false,
      status: 409,
      error: `Ya está en Rebucret como «${igual.name}». No se crea otro: pedile a un gerencial que lo vincule en Vínculos con Zomatik.`,
      cliente: { id: igual.id, name: igual.name },
    }

  // Ficha (CUIT, IVA, dirección): de la copia si está fresca; si no, se lee de Zomatik (solo lectura)
  let f: any = zc
  let aviso: string | undefined
  const fresca = (zc as any).ficha_leida_at && Date.now() - Date.parse((zc as any).ficha_leida_at) < FICHA_VENCE_MS
  if (!fresca) {
    try {
      const s = await obtenerSesion()
      const ficha = parseFichaCliente(await fetchFichaCliente(s, codigo))
      if (ficha) {
        const upd = {
          cuit: ficha.cuit || null,
          tipo_documento: ficha.tipo_documento || null,
          tipo_iva: ficha.tipo_iva || null,
          condicion_pago: ficha.condicion_pago || null,
          contacto: ficha.contacto || null,
          ficha_leida_at: new Date().toISOString(),
        }
        await sb.from("zomatik_clientes").update(upd).eq("codigo", codigo)
        f = {
          ...zc,
          ...upd,
          direccion: ficha.direccion || (zc as any).direccion,
          localidad: ficha.localidad || (zc as any).localidad,
          provincia: ficha.provincia || (zc as any).provincia,
          cp: ficha.cp || (zc as any).cp,
          telefono: ficha.telefono || (zc as any).telefono,
          email: ficha.email || (zc as any).email,
        }
      }
    } catch {
      aviso = "No se pudo leer la ficha en Zomatik: se cargó con los datos del listado (sin CUIT)."
    }
  }

  const cuit = soloDigitos(f.cuit)
  const cuitOk = cuitValido(cuit)
  if (cuitOk) {
    const mismo = lista.find((c) => soloDigitos(c.cuit) === cuit)
    if (mismo && mismo.active === false) return deBaja(mismo)
    if (mismo)
      return {
        ok: false,
        status: 409,
        error: `Ya está en Rebucret con el mismo CUIT, como «${mismo.name}». Pedile a un gerencial que lo vincule en Vínculos con Zomatik.`,
        cliente: { id: mismo.id, name: mismo.name },
      }
  }

  const nombre = String(f.razon_social || "").replace(/\s+/g, " ").trim()
  if (!nombreNormalizado(nombre)) return { ok: false, status: 400, error: "El cliente de Zomatik no tiene razón social" }
  const remito = remitoSugerido(Number(f.remitos_r_12m) || 0, Number(f.remitos_x_12m) || 0)
  const ahora = new Date().toISOString()
  const fila: Record<string, unknown> = {
    name: nombre,
    razon_social: nombre,
    cuit: cuitOk ? cuit : null,
    cond_iva: condIvaDeZomatik(f.tipo_iva),
    direccion_fiscal: f.direccion || null,
    localidad_cliente: f.localidad || null,
    provincia: f.provincia || null,
    cp: f.cp || null,
    phone: f.telefono || null,
    email: f.email || null,
    contact: f.contacto || null,
    cond_pago: condPagoDeZomatik(f.condicion_pago),
    plant_id: opts.plantId || null,
    active: true,
    remito_tipo: remito,
    zomatik_codigo: codigo,
    zomatik_vinculo: "traido",
    zomatik_vinculado_por: opts.usuario,
    zomatik_vinculado_at: ahora,
  }
  const { data: creado, error } = await sb.from("clients").insert(fila).select("id, name").single()
  if (error) {
    if ((error as any).code === "23505") {
      // Otro "Traer" lo creó recién: se devuelve ese
      const { data: otro } = await sb.from("clients").select("id, name").eq("zomatik_codigo", codigo).maybeSingle()
      if (otro) return { ok: true, cliente: otro as any, yaEstaba: true }
    }
    throw error
  }
  return { ok: true, cliente: creado as any, yaEstaba: false, aviso }
}
