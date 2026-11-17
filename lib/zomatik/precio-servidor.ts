/**
 * Zomatik · Precio por m³ de la NP al programar (SOLO servidor). Spec: docs/specs/2026-11-16-precio-en-programacion.md.
 *
 *   precioParaPedido   lo que ve la línea "Precio por m³" (lista activa de la copia, precio de lista del artículo, el
 *                      precio puesto y si ya salió la NP). Solo lo devuelve GET /api/zomatik/np/precio, con el permiso.
 *   guardarPrecio      guarda el precio del pedido (nulo = el de la lista) con las NP bloqueadas en la base.
 *   congelarPrecio     después de la primera NP nueva "ok": el precio con que salió queda para las adicionales.
 *   precioDeNp         lo que lee el robot para el renglón de una NP nueva.
 *
 * El precio vive en tablas que el navegador no puede leer (zomatik_np_precio, zomatik_listas, zomatik_lista_precios).
 * Nunca va a scheduled_dispatches, zomatik_np ni a GET /api/zomatik/np. Los precios son NETOS (sin IVA).
 * Sin imports de np-servidor.ts (la Actividad la deja quien llama, con `log`).
 */
import { sbServicio } from "@/lib/auth/servidor"
import { comprobanteDe, listaActiva, precioBloqueado, precioValido, textoPrecio, type Lista } from "@/lib/zomatik/np"

type SB = ReturnType<typeof sbServicio>

/** ¿Falta la migración 202611161600? (la línea no aparece y la NP sale como antes). */
export const faltaMigracionPrecio = (e: unknown) =>
  /\b(zomatik_np_precio(_guardar|_congelar)?|zomatik_listas|zomatik_lista_precios)\b/i.test(String((e as { message?: string })?.message || ""))

export type FilaPrecio = {
  scheduled_dispatch_id: string
  precio_m3: number | null
  origen: "manual" | "np" | null
  formula_id: string | null
  lista_codigo: number | null
  precio_lista_m3: number | null
  proyecto_precio_m3: number | null
  updated_by: string | null
  updated_at: string | null
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v))

export async function filaPrecio(sb: SB, pedidoId: string): Promise<FilaPrecio | null> {
  const { data, error } = await sb.from("zomatik_np_precio").select("*").eq("scheduled_dispatch_id", pedidoId).maybeSingle()
  if (error) throw error
  if (!data) return null
  const f = data as unknown as FilaPrecio
  return { ...f, precio_m3: num(f.precio_m3), precio_lista_m3: num(f.precio_lista_m3), proyecto_precio_m3: num(f.proyecto_precio_m3), lista_codigo: num(f.lista_codigo) }
}

export type ListaCopia = { codigo: number; nombre: string; leida_at: string | null }

/**
 * La lista que usaría el robot, sobre la copia: `listaActiva` (la misma función) con el comprobante del remito (R → 15
 * NP, X → 16 NP2). Sin remito, la que valga para las dos (si son distintas, no se sabe).
 */
export async function listaDeLaCopia(sb: SB, remito: string | null | undefined): Promise<{ lista: ListaCopia } | { error: string }> {
  const { data, error } = await sb.from("zomatik_listas").select("codigo, nombre, desde, estado, leida_at")
  if (error) throw error
  const filas = (data as (Lista & { leida_at: string | null })[]) || []
  if (!filas.length) return { error: "Todavía no se leyeron las listas de Zomatik." }
  const comp = comprobanteDe(remito)
  const elegidas = (comp ? [comp] : (["15", "16"] as const)).map((c) => listaActiva(filas.map((f) => ({ ...f, codigo: Number(f.codigo) })), c))
  const mal = elegidas.find((x) => "error" in x)
  if (mal && "error" in mal) return { error: mal.error }
  const codigos = [...new Set(elegidas.map((x) => ("lista" in x ? x.lista.codigo : 0)))]
  if (codigos.length !== 1) return { error: "Elegí R o X para saber la lista." }
  const f = filas.find((x) => Number(x.codigo) === codigos[0])!
  return { lista: { codigo: Number(f.codigo), nombre: f.nombre, leida_at: f.leida_at ?? null } }
}

/** Precio de lista (neto) de un artículo en una lista de la copia. */
async function precioDeLista(sb: SB, lista: number, articulo: number): Promise<number | null> {
  const { data, error } = await sb.from("zomatik_lista_precios").select("precio").eq("lista_codigo", lista).eq("articulo_codigo", articulo).maybeSingle()
  if (error) throw error
  const p = num((data as { precio?: unknown } | null)?.precio)
  return precioValido(p) ? p : null
}

async function articuloDeFormula(sb: SB, formulaId: string): Promise<number | null> {
  const { data, error } = await sb.from("formulas").select("zomatik_articulo_codigo").eq("id", formulaId).maybeSingle()
  if (error) throw error
  return num((data as { zomatik_articulo_codigo?: unknown } | null)?.zomatik_articulo_codigo)
}

type NpDelPedido = { n: number; tipo: string; formula_id: string | null; estado: string; paso: string | null; numero: string | null }

async function npsDelPedido(sb: SB, pedidoId: string): Promise<NpDelPedido[]> {
  const { data, error } = await sb.from("zomatik_np").select("n, tipo, formula_id, estado, paso, numero").eq("scheduled_dispatch_id", pedidoId).order("n")
  if (error) throw error
  return (data as NpDelPedido[]) || []
}

export type PrecioPedido = {
  /** ok · sin_vinculo (la fórmula no tiene artículo) · no_en_lista (el artículo no está en la lista) · sin_lista */
  estado: "ok" | "sin_vinculo" | "no_en_lista" | "sin_lista"
  lista: ListaCopia | null
  precio_lista: number | null
  /** El precio del pedido para ESTA fórmula (nulo = el de la lista). */
  precio_m3: number | null
  origen: "manual" | "np" | null
  /** La NP nueva de esta fórmula ya salió (o pudo salir): no se puede cambiar. */
  bloqueado: boolean
  numero_np: string | null
  /** NP de proyecto: el costo que trajo el MATERIAL cuando salió la NP. */
  proyecto_precio_m3: number | null
}

/** Lo que muestra la línea "Precio por m³" del formulario del pedido. */
export async function precioParaPedido(o: { formulaId: string; remito: string | null; pedidoId?: string | null }, sb: SB = sbServicio()): Promise<PrecioPedido> {
  const out: PrecioPedido = { estado: "ok", lista: null, precio_lista: null, precio_m3: null, origen: null, bloqueado: false, numero_np: null, proyecto_precio_m3: null }
  if (o.pedidoId) {
    const [fila, nps] = await Promise.all([filaPrecio(sb, o.pedidoId), npsDelPedido(sb, o.pedidoId)])
    if (fila && fila.formula_id === o.formulaId && precioValido(fila.precio_m3)) {
      out.precio_m3 = fila.precio_m3
      out.origen = fila.origen
    }
    out.proyecto_precio_m3 = precioValido(fila?.proyecto_precio_m3) ? fila!.proyecto_precio_m3 : null
    out.bloqueado = precioBloqueado(nps, o.formulaId)
    out.numero_np = out.bloqueado ? nps.find((n) => n.tipo === "nueva" && n.formula_id === o.formulaId && n.numero)?.numero ?? null : null
  }
  const art = await articuloDeFormula(sb, o.formulaId)
  const l = await listaDeLaCopia(sb, o.remito)
  if ("lista" in l) out.lista = l.lista
  if (!art) return { ...out, estado: "sin_vinculo" }
  if (!out.lista) return { ...out, estado: "sin_lista" }
  out.precio_lista = await precioDeLista(sb, out.lista.codigo, art)
  return { ...out, estado: out.precio_lista === null ? "no_en_lista" : "ok" }
}

export type ResultadoGuardarPrecio = { ok: boolean; bloqueado: boolean; cambio: boolean; antes: number | null; precio: number | null; lista: ListaCopia | null; precio_lista: number | null; error?: string }

/**
 * Guarda el precio del pedido (null = el de la lista) para su fórmula, con la lista y el precio de lista de ahora. Si se
 * pone exactamente el de la lista, se guarda vacío. La base no lo cambia si la NP nueva de esa fórmula ya salió
 * (`bloqueado`). `log` deja la Actividad (con montos: Actividad es de gerenciales, respuesta 13.4).
 */
export async function guardarPrecio(
  sb: SB,
  o: { pedidoId: string; precio: number | null; formulaId: string; remito: string | null; usuario: string },
  log?: (detalle: Record<string, unknown>) => Promise<void>,
): Promise<ResultadoGuardarPrecio> {
  if (o.precio !== null && !precioValido(o.precio)) return { ok: false, bloqueado: false, cambio: false, antes: null, precio: null, lista: null, precio_lista: null, error: "El precio tiene que ser mayor a 0" }
  const art = await articuloDeFormula(sb, o.formulaId)
  const l = await listaDeLaCopia(sb, o.remito)
  const lista = "lista" in l ? l.lista : null
  const precioLista = lista && art ? await precioDeLista(sb, lista.codigo, art) : null
  const precio = o.precio !== null && precioLista !== null && Math.abs(o.precio - precioLista) < 0.005 ? null : o.precio
  const { data, error } = await sb.rpc("zomatik_np_precio_guardar", { p_pedido: o.pedidoId, p_precio: precio, p_formula: o.formulaId, p_lista: lista?.codigo ?? null, p_precio_lista: precioLista, p_usuario: o.usuario })
  if (error) throw error
  const r = (data || {}) as { ok?: boolean; bloqueado?: boolean; cambio?: boolean; antes?: unknown; error?: string }
  const res: ResultadoGuardarPrecio = { ok: r.ok !== false, bloqueado: !!r.bloqueado, cambio: !!r.cambio, antes: num(r.antes), precio, lista, precio_lista: precioLista, ...(r.error ? { error: r.error } : {}) }
  if (log && res.bloqueado) await log({ "Qué pasó": "No se cambió el precio: la NP ya salió" })
  if (log && res.cambio) {
    const deLista = lista && precioLista !== null ? ` (lista ${lista.nombre}: $ ${textoPrecio(precioLista)})` : ""
    if (precio === null) await log({ "Qué pasó": `Precio de la NP: vuelve a la lista${deLista}` })
    else {
      const antes = res.antes ?? precioLista
      await log({ "Qué pasó": `Precio de la NP: ${antes !== null ? `$ ${textoPrecio(antes)} → ` : ""}$ ${textoPrecio(precio)} /m³${deLista}` })
    }
  }
  return res
}

/**
 * El pedido cambió de fórmula: el precio que tenía (de la otra fórmula) se limpia y vuelve a la lista. Devuelve si
 * limpió algo (quien llama deja la Actividad).
 */
export async function limpiarPrecioOtraFormula(sb: SB, pedidoId: string, formulaId: string): Promise<boolean> {
  const { data, error } = await sb
    .from("zomatik_np_precio")
    .update({ precio_m3: null, origen: null, formula_id: formulaId, lista_codigo: null, precio_lista_m3: null, updated_at: new Date().toISOString() } as never)
    .eq("scheduled_dispatch_id", pedidoId)
    .not("precio_m3", "is", null)
    .neq("formula_id", formulaId)
    .select("scheduled_dispatch_id")
  if (error) throw error
  return ((data as unknown[] | null) || []).length > 0
}

/** Primera NP nueva "ok": su precio queda para las adicionales (la base no pisa uno puesto a mano). Nunca tira. */
export async function congelarPrecio(sb: SB, np: { scheduled_dispatch_id: string | null; formula_id?: string | null }, precio: number | null | undefined, usuario: string): Promise<boolean> {
  if (!np.scheduled_dispatch_id || !precioValido(precio)) return false
  try {
    const { data, error } = await sb.rpc("zomatik_np_precio_congelar", { p_pedido: np.scheduled_dispatch_id, p_precio: precio, p_formula: np.formula_id ?? null, p_usuario: usuario })
    if (error) throw error
    return data === true
  } catch (e) {
    if (!faltaMigracionPrecio(e)) console.error("[zomatik-np] congelar el precio:", (e as Error)?.message)
    return false
  }
}

/** NP de proyecto: el costo que trajo el MATERIAL (solo para mostrarlo). Nunca tira. */
export async function guardarPrecioProyecto(sb: SB, pedidoId: string | null, precio: number | null | undefined): Promise<void> {
  if (!pedidoId || !precioValido(precio)) return
  try {
    const { error } = await sb.from("zomatik_np_precio").upsert({ scheduled_dispatch_id: pedidoId, proyecto_precio_m3: precio, updated_at: new Date().toISOString() } as never, { onConflict: "scheduled_dispatch_id" })
    if (error) throw error
  } catch (e) {
    if (!faltaMigracionPrecio(e)) console.error("[zomatik-np] precio del proyecto:", (e as Error)?.message)
  }
}

/**
 * Lo que lee el robot DESPUÉS de tomar la NP (ya está "generando": guardar queda bloqueado). Solo para una NP nueva y si
 * el precio es de su fórmula; si no, null (sale con la lista). Sin la migración, null.
 */
export async function precioDeNp(sb: SB, np: { tipo: string; scheduled_dispatch_id: string | null; formula_id?: string | null }): Promise<{ precio: number; origen: "manual" | "np" | null; lista_codigo: number | null } | null> {
  if (np.tipo !== "nueva" || !np.scheduled_dispatch_id) return null
  let f: FilaPrecio | null
  try {
    f = await filaPrecio(sb, np.scheduled_dispatch_id)
  } catch (e) {
    if (faltaMigracionPrecio(e)) return null
    throw e
  }
  if (!f || f.formula_id !== (np.formula_id ?? null) || !precioValido(f.precio_m3)) return null
  return { precio: f.precio_m3, origen: f.origen, lista_codigo: f.lista_codigo }
}

/** Nombre de una lista de la copia (para "lista NOVIEMBRE (antes OCTUBRE)"). */
export async function nombreLista(sb: SB, codigo: number | null): Promise<string | null> {
  if (!codigo) return null
  try {
    const { data } = await sb.from("zomatik_listas").select("nombre").eq("codigo", codigo).maybeSingle()
    return (data as { nombre?: string } | null)?.nombre ?? null
  } catch {
    return null
  }
}
