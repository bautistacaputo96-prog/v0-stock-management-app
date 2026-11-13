/**
 * Zomatik · Z1 · Robot de la OF y el remito ("Finalizar pedido", spec 26). Mismo esquema que el de la NP:
 * navegador inyectado (en las pruebas, respuestas simuladas), cada paso avisado con `alPaso` y lo que se necesita para
 * verificar un corte guardado ANTES de grabar (la foto de las OF, el número del remito).
 *
 * OF (como el robot real de Concretus, relevado el 22/10 en la sucursal 17; alta y lista capturadas en la 18 el 29/10):
 *   sucursal 18 → alta vacía → manage_ordenfabricacion con el artículo → foto del listado → sucursal 18 → Grabar →
 *   listado otra vez: exactamente UNA OF nueva PEN del depósito y la fecha, con la marca → ok. Si no, "revisar".
 * Remito (alta, Validarremito, manage_remitos y _validarnumeroremito capturados el 29/10):
 *   el número (entrada aparte, `elegirNumeroRemito`: el más alto del talonario + 1, Bautista 29/10) → sucursal 18 →
 *   modificar_remitos.php?pedido=<NP> → Continuar (manage_remitos: los pendientes de la NP, con la cantidad precargada
 *   con TODO lo pendiente) → el renglón del artículo con los m³ del día y los demás en 0 → _validarnumeroremito justo
 *   antes de grabar (usado: el siguiente, hasta 5; talonario terminado: "revisar" y aviso) → sucursal 18 → los
 *   comprobantes de la NP (si ya tiene un remito que no es nuestro, hecho a mano, no se graba: 10/11) → Grabar →
 *   listado por número + la marca → ok.
 * Si una respuesta no tiene la forma esperada, se frena SIN GRABAR y queda un recorte para Actividad.
 */
import {
  SUCURSAL_REBUCRET, alertasDe, cantidadTexto, camposFormulario, conValores, datosSecundarios, multipartLatin1, numeroNormalizado,
  queryLatin1, recorte, tieneMarca, type CampoForm,
} from "@/lib/zomatik/np"
import {
  CAMPOS_OF, CAMPOS_REMITO, COMPROBANTE_OF, NOMBRE_DEPOSITO, PREFIJO_REMITO, camposSueltosRemito, datosClienteRemito, esItemDe, esMultipart, fparamOf, formularioOf,
  formularioRemito, itemsRemito, listaOf, listadoOf, listadoRemitos, MSJ_COMPROBANTES_ILEGIBLES, msjRemitoAMano, numeroRemitoLibre, ofNuevas, opcionDeSelect, paginadoDe,
  registrosTotal, remitosAjenos, siguienteNumeroRemito, tieneDeposito,
  tieneTransporte, type FilaOf, type RemitoNuestro,
} from "@/lib/zomatik/z1"
import type { NavegadorNp, RespuestaNav } from "@/lib/zomatik/np-robot"
import { MSJ_NP_NO_AJUSTADA, comprobantesDeNp } from "@/lib/zomatik/ajuste"

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
  /** Título del aviso a los gerenciales (si no, "<OF|remito> para revisar") */
  aviso?: string
  /** El número guardado no sirve (talonario terminado): el próximo intento elige otro */
  olvidarNumero?: boolean
  /** Pendiente que cuenta para el tope (a los MAX_SIN_STOCK, "revisar"): Zomatik no tiene stock del artículo, o no se pudo
   *  remitir la OF (listado ilegible, red o sesión; paso "remitir_of") */
  sinStock?: boolean
  /** No se grabó: la NP ya tiene estos remitos hechos a mano (10/11). Quien llama cierra la fila como "a mano". */
  aMano?: string[]
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
  aviso?: string
  olvidarNumero?: boolean
  sinStock?: boolean
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
/**
 * Una excepción que no es de Zomatik (ZomatikError trae `codigo`) es un error nuestro: no se tapa. Va "Error interno:
 * <mensaje>" a la fila y a Actividad, y el stack a console.error.
 */
export function errorInterno(e: unknown): string | null {
  const x = e as { codigo?: unknown; name?: string; message?: string; stack?: string } | null
  if (typeof x?.codigo === "string" || x?.name === "Cambio") return null
  console.error("[zomatik-z1] error interno:", x?.stack || x?.message || e)
  return `Error interno: ${x?.message || String(e)}`
}
const mensajeDe = (e: unknown) => errorInterno(e) ?? (e instanceof Error ? e.message : String(e || "Error de Zomatik"))
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
    if (e instanceof Freno) return { estado: e.estado, mensaje: e.message, paso: estado.paso, reintentar: e.reintentar, recorte: e.recorte, grabado: estado.grabado, aviso: e.aviso, olvidarNumero: e.olvidarNumero, sinStock: e.sinStock }
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
  /** Desde qué día se sacó esa foto: un corte a las 23:50 se busca desde ese día, no desde hoy */
  fotoDia: string | null
  /** Hubo un Grabar antes que pudo llegar: primero se busca la OF */
  buscarAntes: boolean
}

/** OF del depósito dadas de alta desde `desde` hasta hoy (bus_fechah no incluye ese día: se pide hasta mañana,
 *  Concretus 22/10). */
async function listarOf(nav: NavegadorNp, deposito: number, desde: string, hoy: string): Promise<FilaOf[]> {
  const pag = await nav.get("listado_ordenfabricacion.php")
  const f = camposFormulario(pag.html, /listado_ordenfabricacion\.php\?enviado=1|name="formulario"/i)
  if (!f) throw formato("la orden de fabricación", "buscador de OF", pag.html)
  const campos = { ...f.campos, exportar: "0", bus_numero: "", bus_pendrem: "", bus_fechad: desde, bus_fechah: diaSiguiente(hoy), bus_deposito: String(deposito) }
  const r = await nav.post("listado_ordenfabricacion.php?enviado=1", ascii(queryLatin1(Object.entries(campos))), "application/x-www-form-urlencoded")
  if (sucursalDe(r.html) !== SUCURSAL_REBUCRET) throw new Freno("revisar", "El listado de OF vino de otra sucursal (otro sistema la cambió). No se sigue.", false, r.html)
  const filas = listadoOf(r.html)
  if (!filas) throw formato("la orden de fabricación", "listado de OF", r.html)
  const nombre = NOMBRE_DEPOSITO[deposito]
  return filas.filter((x) => !nombre || x.deposito === nombre)
}

/**
 * Las OF nuevas (respecto de la foto) que son la nuestra: del depósito, con la fecha y la marca en observaciones. PEN o
 * FIN: en REBUCRET todas las del listado figuran FIN (columna "Remitido", 29/10); lo que asegura que es la nuestra es la
 * marca.
 */
async function nuestraOf(nav: NavegadorNp, d: DatosOf, foto: string[], ahora: FilaOf[]): Promise<{ esta: FilaOf | null; nuevas: FilaOf[] }> {
  const nuevas = ofNuevas(foto, ahora).filter((x) => x.fechaEntrega === d.fecha)
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
      const b = await nuestraOf(nav, d, d.foto, await listarOf(nav, d.deposito, d.fotoDia && d.fotoDia < o.hoy ? d.fotoDia : o.hoy, o.hoy))
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
    const foto = (await listarOf(nav, d.deposito, o.hoy, o.hoy)).map((x) => x.numero)
    await aRebucret(nav)
    await marcar("grabar_of", { foto, fotoDia: o.hoy })
    // Como el robot real de Concretus (graba OF en vivo desde el 23/10): los campos del alta con fparam, nada más
    const campos = conValores(f.orden.filter((c: CampoForm) => !/^(codigo|cantidad)\d+$/i.test(c.nombre)), {
      deposito: String(d.deposito), fecha_entrega: d.fecha, observaciones: d.marca, fparam, comprobante: COMPROBANTE_OF, ordenfabricacion: "0",
    })
    const g = await nav.post("grabar_ordenfabricacion.php?codigo=0", ascii(queryLatin1(campos.map((c) => [c.nombre, c.valor]))), "application/x-www-form-urlencoded")
    const no = rechazo(g)

    await marcar("verificar_of")
    const b = await nuestraOf(nav, d, foto, await listarOf(nav, d.deposito, o.hoy, o.hoy))
    if (b.esta) return { estado: "ok", mensaje: null, numero: `OF ${b.esta.numero}`, codigo: b.esta.codigo, paso: "verificar_of", grabado: true }
    if (no && !b.nuevas.length) return { estado: "error", mensaje: `Zomatik no aceptó la OF: ${no}`, paso: "grabar_of", recorte: recorte(g.html) }
    return { estado: "revisar", mensaje: `Después de grabar hay ${b.nuevas.length} OF nuevas y ninguna con la marca. Mirá Zomatik.`, paso: "verificar_of", grabado: true, recorte: recorte(g.html) }
  })
}

// ---------------------------------------------------------------------------
// Remitir la OF (REAL 13/11): una OF nueva queda PEN y SIN STOCK hasta que se la "remite"
// ---------------------------------------------------------------------------

export type DatosRemitirOf = {
  /** of_codigo de la fila (el único que el navegador deja remitir) */
  codigo: number | null
  /** of_numero de la fila ("OF 0001-00003412") */
  numero: string | null
  deposito: number
  /** Desde qué día se busca la OF en el listado (el del despacho o el de la foto, el más viejo), aaaa-mm-dd */
  desde: string
}

/**
 * En el listado de OF, las PEN traen en "Remitido" el lapicito `remitir_ordenfabricacion.php?codigo=N`. Un GET a ese
 * link la remite sin confirmación (redirige al listado) y pasa a FIN; las FIN ya no lo traen (prueba real del 13/11,
 * OF 8242). Sin eso no hay stock y el remito no sale.
 *   1. Se busca la OF en el listado por su número (y su código). FIN: no se hace nada (alguien la remitió a mano).
 *   2. PEN con el lapicito a ESE código: paso `remitir_of` (se guarda antes) y GET al link, con `ofARemitir` = ese código
 *      en la misma llamada (el navegador de Z1 no deja otro).
 *   3. Se vuelve a leer el listado: FIN → ok (`of_remitida`).
 * Tope (revisión 13/11), nunca reintentos infinitos:
 *   - "revisar" (quien llama avisa a Bautista, un mail por episodio): sigue PEN después del GET, o una anomalía (no
 *     aparece, figura repetida, tiene otro código, PEN sin el lapicito o con el lapicito a otro código);
 *   - "pendiente" con `sinStock` (cuenta para MAX_SIN_STOCK, como la falta de stock): el listado no se pudo leer (otra
 *     sucursal, formato) o se cortó la red o la sesión. Es idempotente: si ya quedó FIN, el GET no se repite.
 * `grabado` = se mandó el GET.
 */
export async function remitirOf(nav: NavegadorNp, d: DatosRemitirOf, o: OpcionesZ1): Promise<ResultadoZ1> {
  const PASO = "remitir_of"
  const numero = String(d.numero ?? "").match(/\d{4}-\d{8}/)?.[0] ?? null
  const ofTexto = numero ? `OF ${numero}` : "OF"
  const revisar = (m: string, corte?: string, grabado = false): ResultadoZ1 => ({ estado: "revisar", mensaje: `${m} Revisala en Zomatik.`, paso: PASO, aviso: "No se pudo remitir la OF", grabado, ...(corte ? { recorte: corte } : {}) })
  const pendiente = (m: string, corte?: string, grabado = false): ResultadoZ1 => ({ estado: "pendiente", mensaje: `${m} Se reintenta.`, paso: PASO, reintentar: true, grabado, ...(corte ? { recorte: corte } : {}) })
  const res = await ejecutar(o, async (marcar, estado) => {
    // Todo lo de este paso (también un corte de red antes del GET) se informa como "remitir_of"; se GUARDA recién antes del GET
    estado.paso = PASO
    if (typeof d.codigo !== "number" || !Number.isInteger(d.codigo) || d.codigo <= 0) throw dato("La OF no tiene código de Zomatik: no se puede remitir.")
    if (!numero) throw dato(`No se entiende el número de la OF ("${d.numero ?? ""}"): no se puede remitir.`)
    /** La fila de nuestra OF en el listado; una anomalía (→ revisar) o por qué no se pudo leer (→ pendiente). */
    const leer = async (): Promise<{ fila: FilaOf } | { anomalia: string } | { ilegible: string; recorte?: string }> => {
      let todas: FilaOf[]
      try {
        todas = await listarOf(nav, d.deposito, d.desde < o.hoy ? d.desde : o.hoy, o.hoy)
      } catch (e) {
        if (e instanceof Freno) return { ilegible: `No se pudo leer el listado de OF de Zomatik: ${e.message.replace(/\s*No se (mandó nada|sigue)\.\s*$/, "")}.`, recorte: e.recorte }
        throw e
      }
      const filas = todas.filter((x) => x.numero === numero)
      if (!filas.length) return { anomalia: `La ${ofTexto} no aparece en el listado de OF de Zomatik (desde el ${d.desde}).` }
      if (filas.length > 1) return { anomalia: `La ${ofTexto} figura ${filas.length} veces en el listado de OF de Zomatik.` }
      if (filas[0].codigo !== d.codigo) return { anomalia: `La ${ofTexto} del listado de Zomatik tiene otro código (${filas[0].codigo ?? "sin link"}; el sistema tiene ${d.codigo}).` }
      return { fila: filas[0] }
    }
    await aRebucret(nav)
    const antes = await leer()
    if ("ilegible" in antes) return pendiente(antes.ilegible, antes.recorte)
    if ("anomalia" in antes) return revisar(antes.anomalia)
    // Ya FIN (alguien la remitió a mano, o un intento anterior): no se hace nada
    if (antes.fila.estado === "FIN") return { estado: "ok", mensaje: null, numero: ofTexto, codigo: d.codigo, paso: "of_remitida" }
    if (antes.fila.remitir !== d.codigo)
      return revisar(`La ${ofTexto} está PEN en Zomatik ${antes.fila.remitir ? `pero el link para remitirla va a otro código (${antes.fila.remitir})` : "pero sin el link para remitirla"}.`)
    await aRebucret(nav)
    await marcar(PASO)
    const g = await nav.get(`remitir_ordenfabricacion.php?codigo=${d.codigo}`, { ofARemitir: d.codigo })
    const no = rechazo(g)
    const despues = await leer()
    const deCorte = (m: string) => `Se mandó remitir la ${ofTexto}, pero ${m.charAt(0).toLowerCase()}${m.slice(1)}`
    if ("ilegible" in despues) return pendiente(deCorte(despues.ilegible), despues.recorte ?? recorte(g.html), true)
    if ("anomalia" in despues) return revisar(deCorte(despues.anomalia), recorte(g.html), true)
    if (despues.fila.estado === "FIN") return { estado: "ok", mensaje: null, numero: ofTexto, codigo: d.codigo, paso: "of_remitida", grabado: true }
    return revisar(`La ${ofTexto} sigue PEN después de remitirla${no ? ` (Zomatik dijo: ${no})` : ""}.`, recorte(g.html), true)
  })
  // Todo "pendiente" de este paso (listado ilegible, red o sesión) cuenta para el tope, como la falta de stock
  return res.estado === "pendiente" ? { ...res, sinStock: true } : res
}

// ---------------------------------------------------------------------------
// Remito (capturado el 29/10 en REBUCRET)
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
  /** El número del remito ("0099-00002760"), de `elegirNumeroRemito` o el que se guardó en un intento anterior. Si
   *  Zomatik dice que está usado se prueban los siguientes; el que se usa se guarda antes de grabar. */
  numero: string
  /** Lugar de entrega (Validarremito los exige siempre). Si el alta los trae precargados, se usan esos. */
  entrega: { direccion: string | null; localidad: string | null; lote: string | null }
  /** Hubo un Grabar antes que pudo llegar: primero se busca el remito por su número */
  buscarAntes: boolean
  /** Con el ajuste de la NP hecho (docs/specs/2026-11-06-ajustar-np-al-finalizar.md 4.4): el pendiente que tiene que
   *  traer "Continuar". Si difiere, "revisar" sin grabar. null = no se controla (como antes del ajuste). */
  pendienteEsperado?: number | null
  /** Los remitos que grabó el sistema contra esta NP: justo antes de grabar, cualquier otro remito de la NP frena (10/11). */
  nuestros: RemitoNuestro[]
}

/** Tope de páginas del paginado de remitos (si hay más, se frena sin grabar). */
const MAX_PAGINAS_REMITOS = 40

/**
 * Las filas del listado de remitos de REBUCRET con esos filtros. Las filas NO vienen en el HTML (prueba real del
 * 29/10): las carga el JavaScript (TraerPaginado) con POST paginar_remitos.php y `fsql` = el hidden `#sql`.
 *   1. GET listado_remitos.php (el buscador) y la sucursal REBUCRET de su select;
 *   2. POST listado_remitos.php?enviado=1 con los filtros, y de ESA respuesta los hidden sql, paginar_archivo y
 *      query_string;
 *   3. POST paginar_remitos.php con fsql TAL CUAL vino (nunca se arma ni se modifica), página por página hasta
 *      registros_total.
 * Si algo no tiene esa forma (otro archivo, sin sql, sin total, demasiadas páginas), error sin grabar.
 */
async function filasRemitos(nav: NavegadorNp, filtros: Record<string, string>, azar: () => number): Promise<{ codigo: number; numero: string }[]> {
  const pag = await nav.get("listado_remitos.php")
  const f = camposFormulario(pag.html, /listado_remitos\.php\?enviado=1|name="formulario"/i)
  if (!f) throw formato("el remito", "buscador de remitos", pag.html)
  const suc = opcionDeSelect(pag.html, "bus_sucursal", /REBUCRET/i)
  if (!suc) throw formato("el remito", "el buscador de remitos no tiene la sucursal REBUCRET", pag.html)
  // Sin los hidden del paginado: los arma Zomatik con los filtros, no son filtros
  const { sql: _sql, paginar_archivo: _archivo, query_string: _qs, ...buscador } = f.campos
  const r = await nav.post("listado_remitos.php?enviado=1", ascii(queryLatin1(Object.entries({ ...buscador, exportar: "0", bus_numero: "", bus_sucursal: suc, ...filtros }))), "application/x-www-form-urlencoded")
  if (sucursalDe(r.html) !== SUCURSAL_REBUCRET) throw new Freno("revisar", "El listado de remitos vino de otra sucursal (otro sistema la cambió). No se sigue.", false, r.html)
  const p = paginadoDe(r.html)
  if (!p || p.archivo !== "remitos") throw formato("el remito", p ? `el listado pagina con "${p.archivo}"` : "el listado no trae el sql del paginado", r.html)
  const out: { codigo: number; numero: string }[] = []
  for (let pagina = 1; ; pagina++) {
    // Como $.post de la página: encodeURIComponent (UTF-8), no latin1. fsql va tal cual vino.
    const body = [["fpagina", String(pagina)], ["fregistros", "100"], ["fsql", p.sql], ["fqs", p.qs]].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")
    const res = await nav.post(`paginar_remitos.php?rnd=${azar()}`, ascii(body), "application/x-www-form-urlencoded")
    if (res.status !== 200) throw formato("el remito", `el paginado respondió HTTP ${res.status}`, res.html)
    const total = registrosTotal(res.html)
    if (total === null) throw formato("el remito", "el paginado no trae registros_total", res.html)
    const filas = listadoRemitos(res.html)
    out.push(...filas)
    if (!filas.length || out.length >= total) break
    if (pagina >= MAX_PAGINAS_REMITOS) throw formato("el remito", `el listado tiene más de ${MAX_PAGINAS_REMITOS} páginas`)
  }
  return out
}

/**
 * El remito con ese número en el listado de REBUCRET (por fechas: del día del remito a hoy). null si no está; si está,
 * se abre y se lee la marca:
 *   "nuestro"  tiene nuestra marca;
 *   "otro"     se leyó y no la tiene (lo cargó otro);
 *   "ilegible" no se pudo leer (sin formulario u observaciones): no se sabe de quién es.
 */
async function remitoPorNumero(nav: NavegadorNp, numero: string, marca: string, desde: string, hoy: string, azar: () => number): Promise<{ codigo: number; numero: string; de: "nuestro" | "otro" | "ilegible" } | null> {
  const filas = await filasRemitos(nav, { bus_fechad: desde, bus_fechah: diaSiguiente(hoy) }, azar)
  const fila = filas.find((x) => numeroNormalizado(x.numero) === numeroNormalizado(numero))
  if (!fila) return null
  const p = await nav.get(`modificar_remitos.php?codigo=${fila.codigo}`)
  const fr = formularioRemito(p.html)
  if (!fr || !("observaciones" in fr.campos)) return { ...fila, de: "ilegible" }
  return { ...fila, de: tieneMarca(fr.campos.observaciones, marca) ? "nuestro" : "otro" }
}

const restarDias = (f: string, n: number) => {
  const d = new Date(`${f}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/**
 * El número del remito (Bautista 29/10, "del anterior"): el MÁS ALTO del talonario del comprobante en la sucursal 18
 * (RM 0001, RM2 0099) + 1, entre los remitos de REBUCRET de los últimos 60 días (todas las páginas del paginado), no
 * el más reciente por fecha. Es una entrada aparte: generarRemito lo valida justo antes de
 * grabar y, si está usado, prueba los siguientes.
 */
export async function elegirNumeroRemito(nav: NavegadorNp, comprobante: "7" | "19", o: OpcionesZ1): Promise<ResultadoZ1> {
  const azar = o.azar || (() => Math.floor(Math.random() * 345343))
  return ejecutar(o, async (marcar) => {
    await marcar("elegir_numero")
    await aRebucret(nav)
    const filas = await filasRemitos(nav, { bus_fechad: restarDias(o.hoy, 60), bus_fechah: diaSiguiente(o.hoy) }, azar)
    const numero = siguienteNumeroRemito(filas.map((x) => x.numero), comprobante)
    if (!numero) throw formato("el remito", `no se encontró el talonario de ${PREFIJO_REMITO[comprobante]}`)
    return { estado: "ok", mensaje: null, numero, paso: "elegir_numero" }
  })
}

/** `propio`: el remito de la NP con el número que la fila guardó antes de un Grabar cortado (puede ser el del robot). */
export type RemitoAMano = { estado: "libre" } | { estado: "a_mano"; numeros: string[]; propio?: string | null } | { estado: "ilegible"; mensaje: string }

/**
 * ¿La NP ya tiene un remito que no hizo el sistema? (10/11: Fernando remitió a mano lo que el robot no sacó). Solo
 * lectura: sucursal REBUCRET y GET _comprobantes.php de la NP (lo que abre "COMPROBANTES / OPERACIONES"). Cualquier
 * remito (RM / RM2) cuyo código o número no esté entre `nuestros` alcanza: no se comparan m³. Si la respuesta no se
 * entiende, "ilegible" (nunca se sigue a ciegas); red o sesión: la excepción sigue y quien llama reintenta.
 * `propio`: el número que la fila guardó antes de un Grabar cortado. Si está en la NP no cuenta como hecho a mano (lo
 * resuelve la búsqueda por la marca); si además hay otro, vuelve en `propio` para no pisarlo.
 */
export async function remitoAManoEnNp(nav: NavegadorNp, d: { npCodigo: number; nuestros: RemitoNuestro[]; propio?: RemitoNuestro | null }, o: { azar?: () => number } = {}): Promise<RemitoAMano> {
  if (!Number.isInteger(d.npCodigo) || d.npCodigo <= 0) return { estado: "ilegible", mensaje: MSJ_COMPROBANTES_ILEGIBLES }
  const azar = o.azar || (() => Math.floor(Math.random() * 345343))
  await aRebucret(nav)
  const r = await nav.get(`_comprobantes.php?ftarget=pedidos&ftargetid=${d.npCodigo}&rnd=${azar()}`)
  const c = r.status === 200 ? comprobantesDeNp(r.html) : null
  if (!c) return { estado: "ilegible", mensaje: MSJ_COMPROBANTES_ILEGIBLES }
  const ajenos = remitosAjenos(c.remitos, d.nuestros)
  const propios = d.propio ? ajenos.filter((x) => !remitosAjenos([x], [d.propio!]).length) : []
  const otros = ajenos.filter((x) => !propios.includes(x))
  return otros.length ? { estado: "a_mano", numeros: otros.map((x) => x.numero), propio: propios[0]?.numero ?? null } : { estado: "libre" }
}

const siguiente = (numero: string) => `${numero.slice(0, 5)}${String(Number(numero.slice(5)) + 1).padStart(8, "0")}`

export async function generarRemito(nav: NavegadorNp, d: DatosRemito, o: OpcionesZ1): Promise<ResultadoZ1> {
  const azar = o.azar || (() => Math.floor(Math.random() * 345343))
  const boundary = o.boundary || `----rebucret${Date.now().toString(36)}`
  const pref = PREFIJO_REMITO[d.comprobante]
  return ejecutar(o, async (marcar) => {
    if (!d.npCodigo) throw dato("La NP no tiene código de Zomatik.")
    if (!(d.m3 > 0)) throw dato("No hay m³ para remitir.")
    let numero = numeroNormalizado(d.numero)
    if (!numero || numero.slice(0, 4) !== (d.comprobante === "7" ? "0001" : "0099")) throw dato(`El número de remito "${d.numero}" no es del talonario de ${pref}.`)
    await aRebucret(nav)
    // Un Grabar anterior pudo llegar: el número se guardó antes de grabar y solo se graba con ese número
    let guardadoNoEsta = false
    if (d.buscarAntes) {
      await marcar("buscar_remito")
      const x = await remitoPorNumero(nav, numero, d.marca, d.fecha, o.hoy, azar)
      if (x?.de === "nuestro") return { estado: "ok", mensaje: null, numero: `${pref} ${numero}`, codigo: x.codigo, paso: "buscar_remito", grabado: true }
      // No se pudo leer: puede ser el nuestro. Nunca se pasa al siguiente número.
      if (x?.de === "ilegible") return { estado: "revisar", mensaje: `El remito ${pref} ${numero} existe pero no se pudo leer: puede ser el nuestro de un corte. Revisalo en Zomatik antes de seguir.`, paso: "buscar_remito", grabado: true }
      // Con ese número hay OTRO remito (leído, sin la marca): el nuestro no llegó. Se sigue con el siguiente número.
      if (x?.de === "otro") numero = siguiente(numero)
      // No está en el listado: si después Zomatik dice que está usado, no se puede saber si es el nuestro
      else guardadoNoEsta = true
    }
    await marcar("formulario_remito")
    const alta = await nav.get(`modificar_remitos.php?pedido=${d.npCodigo}`)
    const f = formularioRemito(alta.html)
    if (!f) throw formato("el remito", "no se abrió el remito desde la NP", alta.html)
    const falta = CAMPOS_REMITO.filter((c) => !(c in f.campos))
    if (falta.length) throw formato("el remito", `faltan ${falta.join(", ")}`, alta.html)
    if (!/^grabar_remitos\.php\?codigo=0$/i.test(f.action || "") || f.campos.remitos !== "0") throw formato("el remito", "el alta graba en otro lado", alta.html)
    if (!f.campos.idcliente || f.campos.idcliente === "0") throw formato("el remito", "no trajo el cliente de la NP", alta.html)
    if (!tieneDeposito(alta.html, d.deposito) || !tieneTransporte(alta.html, "1")) throw formato("el remito", `no está el depósito ${d.deposito} o el transporte`, alta.html)
    // Los datos del cliente no vienen en el HTML: los pide la página a traerdatossecundarios.php (30/10)
    const sec = await nav.get(`traerdatossecundarios.php?fcliente=${f.campos.idcliente}&rnd=${azar()}`)
    const cliente = datosSecundarios(sec.html)
    if (!cliente) throw formato("el remito", "los datos del cliente no se entendieron", sec.html)
    const delCliente = datosClienteRemito(f.campos, cliente)
    // Validarremito: lote, dirección y localidad de entrega
    const entregaDireccion = f.campos.entrega_direccion || d.entrega.direccion || ""
    const entregaLocalidad = f.campos.entrega_localidad || d.entrega.localidad || ""
    const lote = f.campos.lote || d.entrega.lote || ""
    const faltaObra = !entregaLocalidad.trim() ? "la localidad" : !entregaDireccion.trim() || !lote.trim() ? "el nombre o la dirección" : null
    if (faltaObra) {
      const fr = new Freno("revisar", `Completar ${faltaObra} de la obra y tocar "Remitir en Zomatik". No se grabó nada.`)
      fr.aviso = `Completar ${faltaObra} de la obra`
      throw fr
    }

    await marcar("continuar_remito")
    const q = queryLatin1([
      ["remitos", "0"], ["fcliente", f.campos.idcliente], ["fobra", f.campos.idobra || "0"], ["fcomprobante", d.comprobante], ["fstdeposito", String(d.deposito)],
      ["fdeposito", String(d.deposito)], ["fpedido", String(d.npCodigo)], ["rnd", String(azar())],
    ])
    const man = await nav.get(`manage_remitos.php?${q}`)
    const items = itemsRemito(man.html)
    if (!items || !items.length) throw formato("el remito", items ? "no vinieron los pendientes de la NP" : "los pendientes no se entendieron", man.html)
    if (items.some((x) => x.pedido !== null && x.pedido !== d.npCodigo)) throw formato("el remito", "vinieron renglones de otra NP", man.html)
    const mio = items.filter((x) => esItemDe(x, { codigo: d.articuloCodigo, nombre: d.articuloNombre }))
    if (mio.length !== 1) throw formato("el remito", `los pendientes no traen ${d.articuloNombre || "el artículo"} una sola vez`, man.html)
    const it = mio[0]
    if (d.pendienteEsperado !== null && d.pendienteEsperado !== undefined && (it.pendiente === null || Math.abs(it.pendiente - d.pendienteEsperado) > 0.001)) {
      const fr = new Freno("revisar", `${MSJ_NP_NO_AJUSTADA}: Zomatik dice ${String(it.pendiente ?? "?").replace(".", ",")} m³ pendientes y el sistema esperaba ${String(Math.round(d.pendienteEsperado * 1000) / 1000).replace(".", ",")}. No se grabó el remito.`, false, man.html)
      fr.aviso = "La NP no quedó ajustada"
      throw fr
    }
    if (it.pendiente === null || d.m3 > it.pendiente + 0.001) throw dato(`A la NP le quedan ${it.pendiente ?? "?"} m³ pendientes de ${it.nombreArticulo} y se despacharon ${cantidadTexto(d.m3)} m³: generá una NP adicional.`)
    if (!it.sinControlStock && d.deposito !== 99 && (it.stock === null || d.m3 > it.stock + 0.001)) {
      const fs = new Freno("pendiente", `No hay stock de ${it.nombreArticulo} en el depósito (${it.stock ?? "?"} m³). Se reintenta.`, true)
      fs.sinStock = true
      throw fs
    }

    // El número, justo antes de grabar: usado → el siguiente (hasta 5); fuera del talonario → se terminó: revisar y aviso
    await aRebucret(nav)
    await marcar("numero_remito")
    for (let i = 0; ; i++) {
      const rv = await nav.get(`_validarnumeroremito.php?fcomprobante=${d.comprobante}&fnumero=${numero}&rnd=${azar()}`)
      const v = numeroRemitoLibre(rv.html, rv.status)
      if (v.libre) break
      if (i === 0 && guardadoNoEsta && v.motivo === "usado")
        return { estado: "revisar", mensaje: `El remito ${pref} ${numero} figura usado en Zomatik pero no aparece en el listado: puede ser el nuestro de un corte. Revisalo en Zomatik antes de seguir.`, paso: "buscar_remito", grabado: true }
      if (v.motivo === "fuera") {
        const f2 = new Freno("revisar", `El talonario de ${pref} se terminó (${pref} ${numero} no está cargado en Zomatik). Cargá un talonario nuevo y tocá "Remitir en Zomatik". No se grabó nada.`)
        f2.aviso = `Cargar talonario nuevo de ${pref} en Zomatik`
        f2.olvidarNumero = true
        throw f2
      }
      if (v.motivo !== "usado") throw formato("el remito", `la validación del número respondió "${v.texto}"`)
      if (i >= 4) throw dato(`Los ${pref} ${d.numero} a ${numero} ya están usados en Zomatik. Revisá el talonario.`)
      numero = siguiente(numero)
    }
    // Justo antes de grabar, otra vez (10/11): ¿se remitió a mano mientras tanto? Solo lectura; deja la sucursal en 18
    await marcar("comprobantes_np")
    const am = await remitoAManoEnNp(nav, { npCodigo: d.npCodigo, nuestros: d.nuestros || [] }, { azar })
    if (am.estado === "ilegible") throw new Freno("pendiente", am.mensaje, true)
    if (am.estado === "a_mano") return { estado: "revisar", aMano: am.numeros, mensaje: msjRemitoAMano(am.numeros), paso: "comprobantes_np" }
    await marcar("grabar_remito", { numero })
    const valores: Record<string, string> = {
      ...delCliente, comprobante: d.comprobante, numero, fecha: d.fecha, fentrega: d.fecha, deposito: String(d.deposito), transporte: "1",
      entrega_direccion: entregaDireccion, entrega_localidad: entregaLocalidad, lote, patente: d.patente || "", observaciones: d.observaciones, observacionesimp: d.observacionesimp,
    }
    // "Continuar" precarga TODO lo pendiente: el renglón del artículo va con los m³ del día y todos los demás en 0
    const renglones = items.flatMap((x) => x.campos.map((c) => (c.nombre.toLowerCase() === `cantidad${x.id}` ? { nombre: c.nombre, valor: x === it ? cantidadTexto(d.m3) : "0" } : c)))
    const nombresItems = new Set([...renglones, ...camposSueltosRemito(man.html)].map((c) => c.nombre))
    const base = conValores(f.orden.filter((c: CampoForm) => !nombresItems.has(c.nombre)), valores)
    const todos = [...base, ...camposSueltosRemito(man.html), ...renglones]
    const g = esMultipart(alta.html, /grabar_remitos/i)
      ? await (async () => { const m = multipartLatin1(todos, boundary); return nav.post("grabar_remitos.php?codigo=0", m.cuerpo, m.tipo) })()
      : await nav.post("grabar_remitos.php?codigo=0", ascii(queryLatin1(todos.map((c) => [c.nombre, c.valor]))), "application/x-www-form-urlencoded")
    const no = rechazo(g)

    await marcar("verificar_remito")
    const x = await remitoPorNumero(nav, numero, d.marca, d.fecha, o.hoy, azar)
    if (x?.de === "nuestro") return { estado: "ok", mensaje: null, numero: `${pref} ${numero}`, codigo: x.codigo, paso: "verificar_remito", grabado: true }
    if (!x && no) return { estado: "error", mensaje: `Zomatik no aceptó el remito: ${no}`, paso: "grabar_remito", recorte: recorte(g.html) }
    return { estado: "revisar", mensaje: x ? `El remito ${pref} ${numero} existe pero ${x.de === "ilegible" ? "no se pudo leer" : "sin la marca"}: revisalo en Zomatik.` : `Zomatik grabó pero el remito ${pref} ${numero} no aparece. Revisalo en Zomatik.`, paso: "verificar_remito", grabado: true, recorte: recorte(g.html) }
  })
}
