/**
 * Zomatik · Z1 · Robot de la OF y el remito ("Finalizar pedido", spec 26). Mismo esquema que el de la NP:
 * navegador inyectado (en las pruebas, respuestas simuladas), cada paso avisado con `alPaso` y lo que se necesita para
 * verificar un corte guardado ANTES de grabar (la foto de las OF, el número del remito).
 *
 * OF (como el robot real de Concretus, relevado el 22/10 en la sucursal 17; acá en la 18):
 *   sucursal 18 → alta vacía → manage_ordenfabricacion con el artículo → foto del listado → sucursal 18 → Grabar →
 *   listado otra vez: exactamente UNA OF nueva PEN del depósito y la fecha, con la marca → ok. Si no, "revisar".
 * Remito (SUPUESTO según 4.4 hasta la captura con Bautista, 26.6):
 *   sucursal 18 → modificar_remitos.php?pedido=<NP> → Continuar (manage_remitos: los pendientes de la NP) → el
 *   renglón del artículo con pendiente y stock suficientes → número de la serie (el mayor + 1, validado) → sucursal 18 →
 *   Grabar → listado por número + la marca → ok.
 * Si una respuesta no tiene la forma esperada, se frena SIN GRABAR y queda un recorte para Actividad.
 */
import {
  SUCURSAL_REBUCRET, alertasDe, cantidadTexto, camposFormulario, conValores, esRenglonDe, multipartLatin1, numeroNormalizado,
  queryLatin1, recorte, tieneMarca, type CampoForm,
} from "@/lib/zomatik/np"
import {
  CAMPOS_OF, CAMPOS_REMITO, COMPROBANTE_OF, NOMBRE_DEPOSITO, PREFIJO_REMITO, fparamOf, formularioOf, formularioRemito, itemsRemito,
  listaOf, listadoOf, listadoRemitos, numeroRemitoLibre, ofNuevas, siguienteNumeroRemito, tieneDeposito, type FilaOf,
} from "@/lib/zomatik/z1"
import type { NavegadorNp, RespuestaNav } from "@/lib/zomatik/np-robot"

/** Solo la arma z1-servidor.ts después de leer `zomatik_np_config.remitir_activo = true` (y la NP prendida). */
export type LlaveZ1 = { readonly remitir: true; readonly plantId: string }

export type ResultadoZ1 = {
  estado: "ok" | "revisar" | "error" | "pendiente"
  mensaje: string | null
  numero?: string | null
  codigo?: number | null
  paso: string
  recorte?: string
  /** Quedó registrado que se mandó Grabar (un corte después no se repite a ciegas). */
  grabado?: boolean
  reintentar?: boolean
}

export type OpcionesZ1 = {
  hoy: string
  /** Antes de cada paso. Con "grabar_of" / "grabar_remito", quien llama guarda `extra` (foto de OF o número de remito)
   *  ANTES de que se mande. */
  alPaso?: (paso: string, extra?: Record<string, unknown>) => Promise<void> | void
  azar?: () => number
  boundary?: string
}

class Freno extends Error {
  estado: ResultadoZ1["estado"]
  reintentar: boolean
  recorte?: string
  constructor(estado: ResultadoZ1["estado"], mensaje: string, reintentar = false, html?: string) {
    super(mensaje)
    this.estado = estado
    this.reintentar = reintentar
    if (html) this.recorte = recorte(html)
  }
}
const formato = (que: string, m: string, html?: string) => new Freno("error", `Zomatik cambió el formulario de ${que} (${m}). No se mandó nada.`, false, html)
const dato = (m: string) => new Freno("error", m, false)
const esDeRed = (e: unknown) => ["sin_respuesta", "sesion_caida", "login_bloqueado", "sin_credenciales"].includes(String((e as { codigo?: string })?.codigo || ""))
const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e || "Error de Zomatik"))
const ascii = (s: string) => {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255
  return out
}
const diaSiguiente = (f: string) => {
  const d = new Date(`${f}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

async function aRebucret(nav: NavegadorNp) {
  if (!(await nav.sucursal(SUCURSAL_REBUCRET))) throw Object.assign(new Error("La sesión de Zomatik se cerró al elegir la sucursal"), { codigo: "sesion_caida" })
}

/** La sucursal que muestra una página (selector frm_selsuc); null si no lo trae. */
const sucursalDe = (html: string) => camposFormulario(html, /frm_selsuc/i)?.campos.selsuc ?? null

function rechazo(r: RespuestaNav): string | null {
  if (r.status >= 300 && r.status < 400) return null
  const a = alertasDe(r.html)
  return a.length ? a.join(" · ") : null
}

async function ejecutar(o: OpcionesZ1, cuerpo: (marcar: (p: string, extra?: Record<string, unknown>) => Promise<void>, estado: { grabado: boolean; paso: string }) => Promise<ResultadoZ1>): Promise<ResultadoZ1> {
  const estado = { grabado: false, paso: "inicio" }
  const marcar = async (p: string, extra?: Record<string, unknown>) => {
    estado.paso = p
    await o.alPaso?.(p, extra)
    if (p.startsWith("grabar")) estado.grabado = true
  }
  try {
    return await cuerpo(marcar, estado)
  } catch (e) {
    if (e instanceof Freno) return { estado: e.estado, mensaje: e.message, paso: estado.paso, reintentar: e.reintentar, recorte: e.recorte, grabado: estado.grabado }
    const m = mensajeDe(e)
    if (estado.grabado) return { estado: "pendiente", mensaje: `Se cortó al grabar (${m}). Antes de reintentar se busca en Zomatik.`, paso: estado.paso, grabado: true, reintentar: true }
    return { estado: esDeRed(e) ? "pendiente" : "error", mensaje: m, paso: estado.paso, reintentar: esDeRed(e) }
  }
}

// ---------------------------------------------------------------------------
// OF
// ---------------------------------------------------------------------------

export type DatosOf = {
  marca: string
  deposito: number
  /** Fecha de entrega de la OF (el día de los despachos), aaaa-mm-dd */
  fecha: string
  m3: number
  articuloCodigoSistema: number | null
  articuloNombre: string
  /** Foto de las OF del depósito que se guardó antes de un Grabar anterior (para verificar un corte) */
  foto: string[] | null
  /** Hubo un Grabar antes que pudo llegar: primero se busca la OF */
  buscarAntes: boolean
}

/** OF del depósito dadas de alta hoy (bus_fechah no incluye ese día: se pide hasta mañana, Concretus 22/10). */
async function listarOf(nav: NavegadorNp, deposito: number, hoy: string): Promise<FilaOf[]> {
  const pag = await nav.get("listado_ordenfabricacion.php")
  const f = camposFormulario(pag.html, /listado_ordenfabricacion\.php\?enviado=1|name="formulario"/i)
  if (!f) throw formato("la orden de fabricación", "buscador de OF", pag.html)
  const campos = { ...f.campos, exportar: "0", bus_numero: "", bus_pendrem: "", bus_fechad: hoy, bus_fechah: diaSiguiente(hoy), bus_deposito: String(deposito) }
  const r = await nav.post("listado_ordenfabricacion.php?enviado=1", ascii(queryLatin1(Object.entries(campos))), "application/x-www-form-urlencoded")
  if (sucursalDe(r.html) !== SUCURSAL_REBUCRET) throw new Freno("revisar", "El listado de OF vino de otra sucursal (otro sistema la cambió). No se sigue.", false, r.html)
  const filas = listadoOf(r.html)
  if (!filas) throw formato("la orden de fabricación", "listado de OF", r.html)
  const nombre = NOMBRE_DEPOSITO[deposito]
  return filas.filter((x) => !nombre || x.deposito === nombre)
}

/** Las OF nuevas (respecto de la foto) que son la nuestra: PEN, del depósito, con la fecha y la marca en observaciones. */
async function nuestraOf(nav: NavegadorNp, d: DatosOf, foto: string[], ahora: FilaOf[]): Promise<{ esta: FilaOf | null; nuevas: FilaOf[] }> {
  const nuevas = ofNuevas(foto, ahora).filter((x) => x.estado === "PEN" && x.fechaEntrega === d.fecha)
  for (const x of nuevas) {
    if (!x.codigo) continue
    const p = await nav.get(`modificar_ordenfabricacion.php?codigo=${x.codigo}`)
    const f = camposFormulario(p.html, /grabar_ordenfabricacion/i)
    if (f && tieneMarca(f.campos.observaciones, d.marca)) return { esta: x, nuevas }
  }
  return { esta: null, nuevas }
}

export async function generarOf(nav: NavegadorNp, d: DatosOf, o: OpcionesZ1): Promise<ResultadoZ1> {
  const azar = o.azar || (() => Math.floor(Math.random() * 345343))
  return ejecutar(o, async (marcar) => {
    if (!d.articuloCodigoSistema) throw dato(`La fórmula no está vinculada con un artículo de Zomatik${d.articuloNombre ? ` (${d.articuloNombre})` : ""}.`)
    if (!(d.m3 > 0)) throw dato("No hay m³ para fabricar.")
    await aRebucret(nav)
    // Un Grabar anterior pudo llegar: se busca con la foto que se guardó antes
    if (d.buscarAntes) {
      await marcar("buscar_of")
      if (!d.foto) return { estado: "revisar", mensaje: "Se cortó una OF y no quedó la foto previa: buscala en Zomatik antes de seguir.", paso: "buscar_of", grabado: true }
      const b = await nuestraOf(nav, d, d.foto, await listarOf(nav, d.deposito, o.hoy))
      if (b.esta) return { estado: "ok", mensaje: null, numero: `OF ${b.esta.numero}`, codigo: b.esta.codigo, paso: "buscar_of", grabado: true }
      if (b.nuevas.length) return { estado: "revisar", mensaje: `Hay OF nuevas sin la marca (${b.nuevas.map((x) => x.numero).join(", ")}): revisá en Zomatik antes de seguir.`, paso: "buscar_of", grabado: true }
    }
    await marcar("formulario_of")
    const alta = await nav.get("modificar_ordenfabricacion.php")
    const f = formularioOf(alta.html)
    if (!f) throw formato("la orden de fabricación", "no se abrió el alta", alta.html)
    const falta = CAMPOS_OF.filter((c) => !(c in f.campos))
    if (falta.length) throw formato("la orden de fabricación", `faltan ${falta.join(", ")}`, alta.html)
    if (!/^grabar_ordenfabricacion\.php\?codigo=0$/i.test(f.action || "") || f.campos.ordenfabricacion !== "0") throw formato("la orden de fabricación", "el alta graba en otro lado", alta.html)
    if (!tieneDeposito(alta.html, d.deposito)) throw formato("la orden de fabricación", `no está el depósito ${d.deposito}`, alta.html)

    await marcar("articulo_of")
    const q = queryLatin1([
      ["ordenfabricacion", "0"], ["fcomprobante", COMPROBANTE_OF], ["ordenfabricacion_unico", f.campos.ordenfabricacion_unico], ["fdeposito", String(d.deposito)],
      ["fparam", ""], ["farticulo", String(d.articuloCodigoSistema)], ["fsubtipo", "0"], ["rnd", String(azar())],
    ])
    const man = await nav.get(`manage_ordenfabricacion.php?${q}`)
    const lista = listaOf(man.html)
    if (!lista || lista.length !== 1) throw formato("la orden de fabricación", lista ? `la lista trajo ${lista.length} renglones` : "la lista no se entendió", man.html)
    const fparam = fparamOf([{ codigo: lista[0].codigo, cantidad: cantidadTexto(d.m3) }])

    // Foto de las OF antes de grabar: solo una OF que no estaba puede ser la nuestra
    const foto = (await listarOf(nav, d.deposito, o.hoy)).map((x) => x.numero)
    await aRebucret(nav)
    await marcar("grabar_of", { foto })
    const campos = conValores(f.orden.filter((c: CampoForm) => !/^(codigo|cantidad)\d+$/i.test(c.nombre)), {
      deposito: String(d.deposito), fecha_entrega: d.fecha, observaciones: d.marca, fparam, comprobante: COMPROBANTE_OF, ordenfabricacion: "0",
    })
    const lista0 = [{ nombre: `codigo${lista[0].n}`, valor: lista[0].codigo }, { nombre: `cantidad${lista[0].n}`, valor: cantidadTexto(d.m3) }]
    const g = await nav.post("grabar_ordenfabricacion.php?codigo=0", ascii(queryLatin1([...campos, ...lista0].map((c) => [c.nombre, c.valor]))), "application/x-www-form-urlencoded")
    const no = rechazo(g)

    await marcar("verificar_of")
    const b = await nuestraOf(nav, d, foto, await listarOf(nav, d.deposito, o.hoy))
    if (b.esta) return { estado: "ok", mensaje: null, numero: `OF ${b.esta.numero}`, codigo: b.esta.codigo, paso: "verificar_of", grabado: true }
    if (no && !b.nuevas.length) return { estado: "error", mensaje: `Zomatik no aceptó la OF: ${no}`, paso: "grabar_of", recorte: recorte(g.html) }
    return { estado: "revisar", mensaje: `Después de grabar hay ${b.nuevas.length} OF nuevas y ninguna con la marca. Mirá Zomatik.`, paso: "verificar_of", grabado: true, recorte: recorte(g.html) }
  })
}

// ---------------------------------------------------------------------------
// Remito (SUPUESTO hasta la captura, 26.6)
// ---------------------------------------------------------------------------

export type DatosRemito = {
  marca: string
  /** Código de la NP en Zomatik (modificar_remitos.php?pedido=N) */
  npCodigo: number
  comprobante: "7" | "19"
  deposito: number
  fecha: string
  m3: number
  articuloCodigo: number | null
  articuloNombre: string
  patente: string | null
  observaciones: string
  observacionesimp: string
  /** El número que eligió un intento anterior (se guardó antes de grabar) */
  numeroPrevio: string | null
  buscarAntes: boolean
}

/** El remito con ese número en el listado de REBUCRET, y si tiene la marca. */
async function remitoPorNumero(nav: NavegadorNp, numero: string, marca: string): Promise<{ codigo: number; numero: string; conMarca: boolean } | null> {
  const pag = await nav.get("listado_remitos.php")
  const f = camposFormulario(pag.html, /listado_remitos\.php\?enviado=1|name="formulario"/i)
  if (!f) throw formato("el remito", "buscador de remitos", pag.html)
  const r = await nav.post("listado_remitos.php?enviado=1", ascii(queryLatin1(Object.entries({ ...f.campos, exportar: "0", bus_numero: numero }))), "application/x-www-form-urlencoded")
  if (sucursalDe(r.html) !== SUCURSAL_REBUCRET) throw new Freno("revisar", "El listado de remitos vino de otra sucursal (otro sistema la cambió). No se sigue.", false, r.html)
  const fila = listadoRemitos(r.html).find((x) => numeroNormalizado(x.numero) === numeroNormalizado(numero))
  if (!fila) return null
  const p = await nav.get(`modificar_remitos.php?codigo=${fila.codigo}`)
  const fr = formularioRemito(p.html)
  return { ...fila, conMarca: !!fr && tieneMarca(fr.campos.observaciones, marca) }
}

/** El mayor número de la serie del comprobante en el listado + 1 (el número se tipea en REBUCRET). */
async function proximoNumero(nav: NavegadorNp, comprobante: "7" | "19"): Promise<string> {
  const pag = await nav.get("listado_remitos.php")
  const f = camposFormulario(pag.html, /listado_remitos\.php\?enviado=1|name="formulario"/i)
  if (!f) throw formato("el remito", "buscador de remitos", pag.html)
  const r = await nav.post("listado_remitos.php?enviado=1", ascii(queryLatin1(Object.entries({ ...f.campos, exportar: "0", bus_numero: "" }))), "application/x-www-form-urlencoded")
  if (sucursalDe(r.html) !== SUCURSAL_REBUCRET) throw new Freno("revisar", "El listado de remitos vino de otra sucursal (otro sistema la cambió). No se sigue.", false, r.html)
  const n = siguienteNumeroRemito(listadoRemitos(r.html).map((x) => x.numero), comprobante)
  if (!n) throw formato("el remito", `no se encontró la serie de ${PREFIJO_REMITO[comprobante]}`, r.html)
  return n
}

export async function generarRemito(nav: NavegadorNp, d: DatosRemito, o: OpcionesZ1): Promise<ResultadoZ1> {
  const azar = o.azar || (() => Math.floor(Math.random() * 345343))
  const boundary = o.boundary || `----rebucret${Date.now().toString(36)}`
  const pref = PREFIJO_REMITO[d.comprobante]
  return ejecutar(o, async (marcar) => {
    if (!d.npCodigo) throw dato("La NP no tiene código de Zomatik.")
    if (!(d.m3 > 0)) throw dato("No hay m³ para remitir.")
    await aRebucret(nav)
    // Un Grabar anterior pudo llegar: el número se eligió y se guardó antes de grabar
    if (d.buscarAntes && d.numeroPrevio) {
      await marcar("buscar_remito")
      const x = await remitoPorNumero(nav, d.numeroPrevio, d.marca)
      if (x?.conMarca) return { estado: "ok", mensaje: null, numero: `${pref} ${numeroNormalizado(d.numeroPrevio)}`, codigo: x.codigo, paso: "buscar_remito", grabado: true }
      if (x) return { estado: "revisar", mensaje: `El remito ${d.numeroPrevio} existe pero no tiene la marca: revisalo en Zomatik.`, paso: "buscar_remito", grabado: true }
    }
    await marcar("formulario_remito")
    const alta = await nav.get(`modificar_remitos.php?pedido=${d.npCodigo}`)
    const f = formularioRemito(alta.html)
    if (!f) throw formato("el remito", "no se abrió el remito desde la NP", alta.html)
    const falta = CAMPOS_REMITO.filter((c) => !(c in f.campos))
    if (falta.length) throw formato("el remito", `faltan ${falta.join(", ")}`, alta.html)
    if (!/^grabar_remitos\.php\?codigo=0$/i.test(f.action || "")) throw formato("el remito", "el alta graba en otro lado", alta.html)

    await marcar("continuar_remito")
    const q = queryLatin1([
      ["fcliente", f.campos.idcliente], ["fobra", f.campos.idobra || "0"], ["fcomprobante", d.comprobante], ["fstdeposito", String(d.deposito)],
      ["fpedido", String(d.npCodigo)], ...(f.campos.remitos_unico ? [["remitos_unico", f.campos.remitos_unico] as [string, string]] : []), ["rnd", String(azar())],
    ])
    const man = await nav.get(`manage_remitos.php?${q}`)
    const items = itemsRemito(man.html)
    const mio = items.filter((r) => esRenglonDe(r, { codigo: d.articuloCodigo, nombre: d.articuloNombre }))
    if (mio.length !== 1) throw formato("el remito", items.length ? `los pendientes no traen ${d.articuloNombre || "el artículo"} una sola vez` : "no vinieron los pendientes de la NP", man.html)
    const it = mio[0]
    if (it.pendiente !== null && d.m3 > it.pendiente + 0.001) throw dato(`A la NP le quedan ${it.pendiente} m³ pendientes y se despacharon ${cantidadTexto(d.m3)} m³: generá una NP adicional.`)
    if (it.stock !== null && d.m3 > it.stock + 0.001) throw new Freno("pendiente", `No hay stock del artículo en el depósito (${it.stock} m³): falta la OF. Se reintenta.`, true)

    // Número: el mayor de la serie + 1, que Zomatik diga que está libre (hasta 5 intentos)
    await marcar("numero_remito")
    let numero = d.numeroPrevio || (await proximoNumero(nav, d.comprobante))
    for (let i = 0; ; i++) {
      const v = numeroRemitoLibre((await nav.get(`_validarnumeroremito.php?fcomprobante=${d.comprobante}&fnumero=${numero}&rnd=${azar()}`)).html)
      if (v.libre) break
      if (i >= 4) throw dato(`No se encontró un número libre de ${pref} (${v.motivo}). Revisá los talonarios en Zomatik.`)
      const n = Number(numero.slice(5)) + 1
      numero = `${numero.slice(0, 5)}${String(n).padStart(8, "0")}`
    }

    await aRebucret(nav)
    await marcar("grabar_remito", { numero })
    const valores: Record<string, string> = {
      comprobante: d.comprobante, numero, fecha: d.fecha, fentrega: d.fecha, deposito: String(d.deposito), transporte: "1",
      patente: d.patente || "", observaciones: d.observaciones, observacionesimp: d.observacionesimp,
    }
    // Los ítems: el del artículo con los m³ despachados; cualquier otro pendiente de la NP, en 0
    const renglones = items.flatMap((r) => r.campos.map((c) => (/^cantidad\d+$/i.test(c.nombre) ? { nombre: c.nombre, valor: r === it ? cantidadTexto(d.m3) : "0" } : c)))
    if ("fparam" in f.campos) valores.fparam = items.map((r) => `${r.codigo},${r === it ? cantidadTexto(d.m3) : "0"}|||`).join("")
    const base = conValores(f.orden.filter((c: CampoForm) => !/^(codigo|cantidad|hcantidad|stock|novalidarstock)\d+$/i.test(c.nombre)), valores)
    const { cuerpo, tipo } = multipartLatin1([...base, ...renglones], boundary)
    const g = await nav.post("grabar_remitos.php?codigo=0", cuerpo, tipo)
    const no = rechazo(g)

    await marcar("verificar_remito")
    const x = await remitoPorNumero(nav, numero, d.marca)
    if (x?.conMarca) return { estado: "ok", mensaje: null, numero: `${pref} ${numero}`, codigo: x.codigo, paso: "verificar_remito", grabado: true }
    if (!x && no) return { estado: "error", mensaje: `Zomatik no aceptó el remito: ${no}`, paso: "grabar_remito", recorte: recorte(g.html) }
    return { estado: "revisar", mensaje: x ? `El remito ${numero} existe pero sin la marca: revisalo en Zomatik.` : `Zomatik grabó pero el remito ${numero} no aparece. Revisalo en Zomatik.`, paso: "verificar_remito", grabado: true, recorte: recorte(g.html) }
  })
}
