/**
 * Zomatik · Z2 · Robot de la nota de pedido. Hace en Zomatik lo mismo que hizo Bautista en la prueba del 22/10
 * (spec 23), paso por paso, con un navegador que le pasan de afuera: en producción el de `cliente.ts` (con la llave
 * de la planta prendida) y en las pruebas uno simulado con las respuestas de `lib/__fixtures__/zomatik-np`.
 *
 * Sin base de datos ni imports en tiempo de ejecución salvo `np.ts` (funciones puras). Quien lo llama guarda el
 * estado (np-servidor.ts) y le avisa cada paso por `alPaso`, para que un corte en "Grabar" quede registrado ANTES
 * de mandar el formulario: un "Grabar" cortado nunca se repite a ciegas, primero se busca la marca (spec 10).
 *
 * NP nueva (23.1):  sucursal 18 → alta vacía → datos del cliente → lista activa → Continuar → artículo → cantidad →
 *                   sucursal 18 → número (serie de REBUCRET) → sucursal 18 → Grabar → listado por número → marca.
 * NP de proyecto (23.2): sucursal 18 → MATERIAL → depósito → Continuar (trae lo disponible) → cantidad del día →
 *                   sucursal 18 → Grabar → buscar por marca entre las NP de hoy del cliente (el número lo pone Zomatik).
 * Vaciar (23.4):    abrir la NP → controlar la marca → borrar cada renglón → Grabar → abrir de nuevo: sin renglones.
 * Ajustar (al finalizar el pedido, docs/specs/2026-11-06-ajustar-np-al-finalizar.md): el mismo esqueleto que vaciar,
 *                   pero con la cantidad en vez del tacho: abrir → marca → un renglón → ¿factura? → cantidad → Grabar →
 *                   abrir de nuevo: un renglón con la cantidad nueva y el total del listado en proporción.
 * Si no aparece en REBUCRET, se busca por la marca en RUTA 25 (23.3 c): si está ahí, queda "revisar".
 */
import {
  SUCURSAL_REBUCRET, SUCURSAL_RUTA25, alertasDe, camposFormulario, conCantidad, conValores, datosSecundarios,
  esSerieRebucret, faltanCampos, fparamDe, listaActiva, listasDeListado, multipartLatin1, numeroCompleto, numeroNormalizado,
  numeroZomatik, hayPaginado, paginasDeListado, camposSueltosDetalle, esDetalle, esRenglonDe, recorte, totalDetalle, pedidosDeListado, queryLatin1, renglonesDetalle, respuestaInvalida, tieneMarca, cantidadTexto,
  autorizacionEnListado, tieneFormAutorizar, bloqueNp, comprobanteDeNumero, MSJ_SIN_CLIENTE, MSJ_SIN_ARTICULO, type CampoForm, type FilaPedido, type Renglon,
} from "@/lib/zomatik/np"
import { RUTA_AUTORIZAR_NP } from "@/lib/zomatik/web"
import { MSJ_FACTURA_NO_SE_SABE, TOL_AJUSTE, comprobantesDeNp, facturaDeNp, m3Texto, msjFacturaContradice, msjNpCambio, msjZomatikNoDejo, rechazoPorFactura, totalProporcional, type Comprobantes } from "@/lib/zomatik/ajuste"

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Solo la arma np-servidor.ts después de leer `zomatik_np_config.activo = true`. */
export type LlaveNp = { readonly activo: true; readonly plantId: string }

/** Solo la arma ajuste-servidor.ts después de leer `zomatik_np_config.ajustar_activo = true` (y la NP y la de remitir). */
export type LlaveAjuste = { readonly ajustar: true; readonly plantId: string }

export type RespuestaNav = { status: number; location: string | null; html: string }

export type NavegadorNp = {
  /** `ofARemitir` (solo el navegador de Z1): la OF que ESTA llamada puede remitir (remitir_ordenfabricacion.php?codigo=N) */
  get(ruta: string, opciones?: { ofARemitir?: number | null }): Promise<RespuestaNav>
  post(ruta: string, cuerpo: Uint8Array, contentType: string): Promise<RespuestaNav>
  /** Cambia la sucursal de la sesión. false si la sesión ya no sirve. */
  sucursal(id: string): Promise<boolean>
}

export type DatosNp = {
  /** Marca única de esta NP ("Sistema Rebucret · pedido … · NP 1"). */
  marca: string
  tipo: "nueva" | "proyecto"
  /** 15 NP / 16 NP2 (NP nueva; en la de proyecto lo pone el proyecto). */
  comprobante: "15" | "16" | null
  clienteCodigo: number | null
  clienteNombre: string
  deposito: number | null
  /** aaaa-mm-dd */
  fecha: string
  m3: number
  articuloCodigoSistema: number | null
  /** Código visible del artículo (`zomatik_articulos.codigo`, 10090020): así se reconoce su renglón en el detalle. */
  articuloCodigo?: number | null
  articuloNombre: string
  proyectoCodigo: number | null
  /** Obra y dirección para "observaciones de entrega". */
  entrega: string
  /** Un corte anterior en "Grabar" (o después): antes de nada se busca la marca. */
  buscarAntes: boolean
  /** Día en que se creó la NP en nuestro sistema (aaaa-mm-dd): la marca se busca desde ese día hasta hoy. */
  creadaEl?: string | null
  /** Vendedor de Zomatik de quien programó el pedido (respuesta 4 del 23/10). Sin él, el del cliente (o del proyecto). */
  vendedorId?: number | null
  vendedorNombre?: string | null
}

/** Sin vendedor de quien programa ni del cliente/proyecto: no se genera. */
const SIN_VENDEDOR = "La NP no tiene vendedor: cargale el vendedor de Zomatik a quien programa (Vínculos con Zomatik) o al cliente en Zomatik."

export type ResultadoNp = {
  estado: "ok" | "revisar" | "error" | "pendiente"
  mensaje: string | null
  numero?: string | null
  codigo?: number | null
  /** Sucursal donde quedó grabada (18 = REBUCRET). */
  sucursal?: string | null
  /** m³ disponibles del renglón del proyecto, como los trae "Continuar" del MATERIAL. */
  disponible?: number | null
  /** "error": ¿vale la pena reintentar solo? (no, si es un dato que falta). */
  reintentar?: boolean
  /** Hasta dónde llegó (para el registro). */
  paso: string
  /** Si quedó registrado que se mandó "Grabar" (el estado lo guarda quien llama). */
  grabado?: boolean
  /** Recorte de la respuesta de Zomatik que no se entendió (~2 KB), para Actividad. */
  recorte?: string
}

export type DatosVaciar = { codigo: number; numero: string | null; marca: string }
export type ResultadoVaciar = { estado: "vaciada" | "revisar" | "error" | "vaciar"; mensaje: string | null; paso: string; recorte?: string }

export type OpcionesRobot = {
  /** Se llama antes de cada paso. Con "grabar" quien llama tiene que dejarlo guardado ANTES de que se mande. */
  alPaso?: (paso: string) => Promise<void> | void
  /** Para el `rnd` de las URL (fijo en las pruebas). */
  azar?: () => number
  /** Separador del multipart (fijo en las pruebas). */
  boundary?: string
  /** Hoy en Argentina (aaaa-mm-dd), para buscar por la marca entre las NP del día. */
  hoy: string
}

/** Error de Zomatik con lo que hay que hacer. */
class Corte extends Error {
  estado: ResultadoNp["estado"]
  reintentar: boolean
  /** Recorte de la respuesta de Zomatik (~2 KB) para diagnosticar desde Actividad. */
  recorte?: string
  constructor(estado: ResultadoNp["estado"], mensaje: string, reintentar = false, recorteHtml?: string) {
    super(mensaje)
    this.estado = estado
    this.reintentar = reintentar
    if (recorteHtml) this.recorte = recorte(recorteHtml)
  }
}

/** `html`: la respuesta que no se entendió (queda un recorte en Actividad). */
const formato = (m: string, html?: string) => new Corte("error", `Zomatik cambió el formulario de la nota de pedido (${m}). No se mandó nada.`, false, html)
const dato = (m: string) => new Corte("error", m, false)

/** ¿Es una falla de red / sesión (se reintenta en 10 min) y no un "no" de Zomatik? */
function esDeRed(e: unknown): boolean {
  const c = (e as { codigo?: string })?.codigo
  return ["sin_respuesta", "sesion_caida", "login_bloqueado", "sin_credenciales"].includes(String(c || "")) || (e as Error)?.name === "AbortError"
}

const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e || "Error de Zomatik"))

// ---------------------------------------------------------------------------
// Pasos comunes
// ---------------------------------------------------------------------------

async function aRebucret(nav: NavegadorNp) {
  if (!(await nav.sucursal(SUCURSAL_REBUCRET))) throw Object.assign(new Error("La sesión de Zomatik se cerró al elegir la sucursal"), { codigo: "sesion_caida" })
}

/** Lo que GetDatosOperacion() agrega a cada manage_pedidos.php. */
function operacion(c: Record<string, string>, proyecto: number | null): [string, string][] {
  return [
    ["pedidos", c.pedidos || "0"],
    ["fcomprobante", c.comprobante || ""],
    ["fcuit", c.cuit || ""],
    ["pedidos_unico", c.pedidos_unico || ""],
    ["fdeposito", c.deposito || ""],
    ["fproyecto", String(proyecto || 0)],
  ]
}

/** El detalle que devuelve manage_pedidos.php: los renglones y la página (para los campos sueltos y el recorte). */
type Detalle = { renglones: Renglon[]; html: string }

async function manage(nav: NavegadorNp, c: Record<string, string>, extra: [string, string][], proyecto: number | null, azar: () => number): Promise<Detalle> {
  const q = queryLatin1([...operacion(c, proyecto), ...extra, ["rnd", String(azar())]])
  const r = await nav.get(`manage_pedidos.php?${q}`)
  if (r.status !== 200 || respuestaInvalida(r.html)) throw formato("el detalle no respondió", r.html)
  return { renglones: renglonesDetalle(r.html), html: r.html }
}

/** Como mucho, cuántas NP se abren para buscar la marca. Si hay más, la búsqueda no es concluyente. */
const MAX_ABRIR = 25

/** Resultado de buscar la marca: está, seguro que no está, o no se puede asegurar (entonces NO se genera otra). */
type Busqueda = { estado: "esta"; sucursal: string; codigo: number; numero: string } | { estado: "no_esta" } | { estado: "dudosa"; motivo: string }

/**
 * Listado de pedidos con los filtros del buscador (descubre los campos como Z0). Devuelve también la sucursal que
 * muestra la página (si otro sistema la cambió en el medio, se nota) y cuántas páginas tiene. Con `limpio`, todos los
 * `bus_*` que trae el buscador van en blanco salvo los de `filtros` y la sucursal (lista blanca, como `listarOf`).
 */
async function listado(nav: NavegadorNp, filtros: Record<string, string>, sucursal: string, limpio = false) {
  const pag = await nav.get("listado_pedidos.php")
  const f = camposFormulario(pag.html, /listado_pedidos\.php\?enviado=1|name="formulario"/i)
  if (!f) throw formato("buscador de pedidos")
  const base = limpio ? Object.fromEntries(Object.entries(f.campos).map(([k, v]) => [k, /^bus_/i.test(k) ? "" : v])) : f.campos
  // En REBUCRET se filtra la sucursal 18 (el select trae 18, 20 y 22); en RUTA 25 se deja vacío
  const campos = { ...base, exportar: "0", bus_sucursal: sucursal === SUCURSAL_REBUCRET ? SUCURSAL_REBUCRET : "", ...filtros }
  const r = await nav.post("listado_pedidos.php?enviado=1", bytes(queryLatin1(Object.entries(campos))), "application/x-www-form-urlencoded")
  return {
    html: r.html,
    filas: pedidosDeListado(r.html),
    paginas: paginasDeListado(r.html),
    paginado: hayPaginado(r.html),
    sucursalPagina: camposFormulario(r.html, /frm_selsuc/i)?.campos.selsuc ?? null,
  }
}

/** Busca una NP por su número en el listado de REBUCRET. */
async function porNumero(nav: NavegadorNp, numero: string): Promise<{ codigo: number; numero: string } | null> {
  const l = await listado(nav, { bus_numero: numero }, SUCURSAL_REBUCRET)
  if (l.sucursalPagina !== SUCURSAL_REBUCRET) return null
  const n = numeroNormalizado(numero)
  const f = l.filas.find((x) => numeroNormalizado(x.numero) === n)
  return f ? { codigo: f.codigo, numero: f.numero } : null
}

const bytes = (ascii: string) => {
  const out = new Uint8Array(ascii.length)
  for (let i = 0; i < ascii.length; i++) out[i] = ascii.charCodeAt(i) & 255
  return out
}

/** Abre una NP (sin importar la sucursal activa, 23.3). */
async function abrir(nav: NavegadorNp, codigo: number) {
  const r = await nav.get(`modificar_pedidos.php?codigo=${codigo}`)
  const f = camposFormulario(r.html, /frm_pedido|grabar_pedidos/i)
  return { html: r.html, form: f, renglones: renglonesDetalle(r.html) }
}

/**
 * Busca la marca en una sucursal: todas las NP del depósito desde el día en que se creó la nuestra hasta hoy, sin
 * filtrar por nombre (la NP se graba con la razón social de Zomatik, no con nuestro nombre). Se abre cada una.
 * No es concluyente si la página muestra otra sucursal, si el listado tiene más de una página, si hay demasiadas o si
 * alguna no se puede abrir.
 */
async function porMarca(nav: NavegadorNp, d: DatosNp, hoy: string, sucursal: string, latir: () => Promise<void>): Promise<Busqueda> {
  const desde = d.creadaEl && d.creadaEl < hoy ? d.creadaEl : hoy
  const l = await listado(nav, { bus_fechad: desde, bus_fechah: hoy, bus_deposito: d.deposito ? String(d.deposito) : "" }, sucursal)
  const nombre = sucursal === SUCURSAL_REBUCRET ? "REBUCRET" : "RUTA 25"
  if (l.sucursalPagina !== sucursal) return { estado: "dudosa", motivo: `el listado de ${nombre} vino de otra sucursal (otro sistema la cambió)` }
  if ((l.paginas ?? 1) > 1) return { estado: "dudosa", motivo: `el listado de ${nombre} tiene ${l.paginas} páginas` }
  if (l.paginado) return { estado: "dudosa", motivo: `el listado de ${nombre} parece tener más páginas` }
  if (l.filas.length > MAX_ABRIR) return { estado: "dudosa", motivo: `hay ${l.filas.length} NP en ${nombre} para revisar` }
  for (const c of [...l.filas].sort((a, b) => b.codigo - a.codigo)) {
    await latir() // renueva el turno y confirma que la NP sigue siendo nuestra
    const a = await abrir(nav, c.codigo)
    if (!a.form) return { estado: "dudosa", motivo: `no se pudo abrir la ${c.numero}` }
    if (tieneMarca(a.form.campos.observaciones, d.marca)) return { estado: "esta", sucursal, codigo: c.codigo, numero: c.numero }
  }
  return { estado: "no_esta" }
}

/** Dónde quedó la NP con esta marca: primero REBUCRET; si no está, RUTA 25 (y se vuelve a REBUCRET). */
async function dondeQuedo(nav: NavegadorNp, d: DatosNp, hoy: string, latir: () => Promise<void>): Promise<Busqueda> {
  await aRebucret(nav)
  const r = await porMarca(nav, d, hoy, SUCURSAL_REBUCRET, latir)
  if (r.estado !== "no_esta") return r
  try {
    if (!(await nav.sucursal(SUCURSAL_RUTA25))) return { estado: "dudosa", motivo: "no se pudo pasar a RUTA 25" }
    return await porMarca(nav, d, hoy, SUCURSAL_RUTA25, latir)
  } finally {
    await nav.sucursal(SUCURSAL_REBUCRET)
  }
}

/** Búsqueda no concluyente: queda "revisar" y no se vuelve a generar (podría duplicar). */
function dudosa(b: { motivo: string }, paso: string, disponible?: number | null): ResultadoNp {
  return { estado: "revisar", mensaje: `No se pudo confirmar si la NP quedó grabada (${b.motivo}). No se genera otra: buscala en Zomatik por la marca.`, paso, disponible, grabado: true }
}

/** Resultado al encontrar la NP con la marca. */
function encontrada(x: { sucursal: string; codigo: number; numero: string }, paso: string, disponible?: number | null): ResultadoNp {
  if (x.sucursal === SUCURSAL_REBUCRET && esSerieRebucret(x.numero))
    return { estado: "ok", mensaje: null, numero: x.numero, codigo: x.codigo, sucursal: x.sucursal, paso, disponible, grabado: true }
  const donde = x.sucursal === SUCURSAL_REBUCRET ? "REBUCRET, pero con un número que no es de su serie" : "RUTA 25 - CONCRETUS"
  return {
    estado: "revisar",
    mensaje: `La NP se grabó en ${donde} (${x.numero}). Hay que vaciarla a mano en Zomatik y generar otra.`,
    numero: x.numero, codigo: x.codigo, sucursal: x.sucursal, paso, disponible, grabado: true,
  }
}

/** Campos de renglón (y sueltos del detalle) que trae la página: se reemplazan por los del detalle de ahora. */
const CAMPO_DETALLE = /^(codigo|peso|hcosto|costo|apallet|palletcant|cantidad|coeficiente|observacionesdetalle)\d+$|^(credito|compraactual|compraactualsib|totalacopio)$/i

/**
 * Arma el multipart del Grabar: los campos del formulario + los del detalle de ahora (todos los de cada renglón y los
 * sueltos: credito, compraactual…) + fparam, como lo manda el navegador.
 */
function cuerpoGrabar(orden: CampoForm[], valores: Record<string, string>, detalle: Detalle | null, renglones: Renglon[], boundary: string) {
  const sueltos = detalle ? camposSueltosDetalle(detalle.html) : []
  const base = conValores(orden.filter((c) => !CAMPO_DETALLE.test(c.nombre)), { ...valores, fparam: fparamDe(renglones) })
  return multipartLatin1([...base, ...renglones.flatMap((r) => r.campos), ...sueltos], boundary)
}

/** Después de Grabar: ¿Zomatik dijo que no? */
function rechazo(r: RespuestaNav): string | null {
  if (r.status >= 300 && r.status < 400) return null
  const a = alertasDe(r.html)
  return a.length ? a.join(" · ") : null
}

// ---------------------------------------------------------------------------
// Generar
// ---------------------------------------------------------------------------

export async function generarNp(nav: NavegadorNp, d: DatosNp, o: OpcionesRobot): Promise<ResultadoNp> {
  const azar = o.azar || (() => Math.floor(Math.random() * 345343))
  const boundary = o.boundary || `----rebucret${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`
  let paso = "inicio"
  let grabado = false
  const marcar = async (p: string) => {
    paso = p
    await o.alPaso?.(p)
  }
  /** Durante la búsqueda: el mismo paso otra vez (renueva el turno del robot). */
  const latir = async () => {
    await o.alPaso?.(paso)
  }
  try {
    // Un corte anterior: primero se busca la marca (spec 10). Si está, listo; si no, se genera de nuevo.
    if (d.buscarAntes) {
      await marcar("buscar_marca")
      const x = await dondeQuedo(nav, d, o.hoy, latir)
      if (x.estado === "esta") return encontrada(x, paso)
      if (x.estado === "dudosa") return dudosa(x, paso)
    }
    // Controles antes de tocar Zomatik
    if (!d.clienteCodigo) throw dato(`${MSJ_SIN_CLIENTE} (Vínculos con Zomatik).`)
    if (!d.deposito) throw dato("La planta no tiene depósito de Zomatik.")
    if (!d.articuloCodigoSistema) throw dato(`${MSJ_SIN_ARTICULO}${d.articuloNombre ? ` (${d.articuloNombre})` : ""}.`)
    if (!(d.m3 > 0)) throw dato("El pedido no tiene m³.")
    if (d.tipo === "nueva" && !d.comprobante) throw dato("Falta el tipo de remito (R o X): define si es NP o NP2.")
    if (d.tipo === "proyecto" && !d.proyectoCodigo) throw dato("Falta elegir el proyecto.")

    return d.tipo === "nueva" ? await nueva(nav, d, o, azar, boundary, marcar, () => (grabado = true), latir) : await deProyecto(nav, d, o, azar, boundary, marcar, () => (grabado = true), latir)
  } catch (e) {
    if (e instanceof Corte) return { estado: e.estado, mensaje: e.message, paso, reintentar: e.reintentar, grabado, recorte: e.recorte }
    // Red o sesión. Antes de Grabar: se reintenta en 10 min. Durante o después: queda para buscar la marca primero.
    const m = mensajeDe(e)
    if (grabado || paso === "grabar") return { estado: "pendiente", mensaje: `Se cortó al grabar (${m}). Antes de reintentar se busca la NP por la marca.`, paso, grabado: true, reintentar: true }
    return { estado: esDeRed(e) ? "pendiente" : "error", mensaje: m, paso, reintentar: esDeRed(e), grabado }
  }
}

async function nueva(nav: NavegadorNp, d: DatosNp, o: OpcionesRobot, azar: () => number, boundary: string, marcar: (p: string) => Promise<void>, alGrabar: () => void, latir: () => Promise<void>): Promise<ResultadoNp> {
  const comp = d.comprobante as "15" | "16"
  await marcar("formulario")
  await aRebucret(nav)
  const alta = await nav.get("modificar_pedidos.php")
  const f = camposFormulario(alta.html, /frm_pedido|grabar_pedidos/i)
  if (!f) throw formato("no se abrió el alta")
  const falta = faltanCampos(f.campos)
  if (falta.length) throw formato(`faltan ${falta.join(", ")}`)
  if (!/^grabar_pedidos\.php\?codigo=0$/i.test(f.action || "")) throw formato("el alta graba en otro lado")

  await marcar("cliente")
  const sec = await nav.get(`traerdatossecundarios.php?fcliente=${d.clienteCodigo}&rnd=${azar()}`)
  const cli = datosSecundarios(sec.html)
  if (!cli) throw formato("los datos del cliente no vinieron")
  // Vendedor: el de quien programa; si no tiene, el del cliente; si tampoco, no se genera
  const vend = d.vendedorId ? { id: String(d.vendedorId), nombre: d.vendedorNombre || "", manual: "1" } : cli.idvendedor ? { id: cli.idvendedor, nombre: cli.vendedor, manual: "0" } : null
  if (!vend) throw dato(SIN_VENDEDOR)

  await marcar("lista")
  const ll = listaActiva(listasDeListado((await nav.get("listado_listas.php")).html), comp)
  if ("error" in ll) throw dato(ll.error)

  const valores: Record<string, string> = {
    idcliente: String(d.clienteCodigo), cliente: cli.razon_social || d.clienteNombre, razon_social: cli.razon_social || d.clienteNombre,
    direccion: cli.direccion, localidad: cli.localidad, provincia: cli.provincia, cp: cli.cp, tipo_iva: cli.tipo_iva, cuit: cli.cuit,
    email: cli.email, condicion_pago: cli.condicion_pago, idobra: "0", obra: "", entregaren: "", deposito: String(d.deposito),
    fecha_entrega: d.fecha, observaciones_entrega: d.entrega, observaciones: d.marca, comprobante: comp, origen: "1",
    idlista: String(ll.lista.codigo), lista: ll.lista.nombre, vendedor_manual: vend.manual, idvendedor: vend.id, vendedor: vend.nombre,
    fletemonto: "0", estado: "1", proyecto: "0", tipo: "0",
  }
  const c = { ...f.campos, ...valores }

  // Continuar + agregar el artículo (el resto lo completa Zomatik)
  await marcar("continuar")
  const base: [string, string][] = [["fcliente", String(d.clienteCodigo)], ["facopio", ""], ["forigen", "1"]]
  await manage(nav, c, [...base, ["flista", c.idlista]], null, azar)
  await marcar("articulo")
  const det = await manage(nav, c, [...base, ["fparam", ""], ["farticulo", String(d.articuloCodigoSistema)], ["flista", c.idlista]], null, azar)
  // El renglón del artículo se reconoce por el código visible (o el nombre), no por codigo<id> (id del renglón)
  const art = det.renglones.filter((r) => esRenglonDe(r, { codigo: d.articuloCodigo, nombre: d.articuloNombre }))
  if (art.length !== 1 || det.renglones.length !== 1) throw formato(det.renglones.length ? "el detalle trajo otros renglones" : "no se agregó el artículo", det.html)
  const rs = [conCantidad(art[0], d.m3)]

  // Número: sucursal REBUCRET justo antes, y tiene que ser de su serie (23.3 a y b)
  await marcar("numero")
  let numero: string | null = null
  for (let intento = 0; intento < 2 && !numero; intento++) {
    await aRebucret(nav)
    const n = numeroNormalizado((await nav.get(`_getnumerofactura.php?fcomprobante=${comp}&rnd=${azar()}`)).html)
    if (n && esSerieRebucret(n)) numero = n
    else if (!n) throw new Corte("pendiente", "Zomatik no dio el número de la NP (¿no quedan comprobantes?). Se reintenta en 10 min.", true)
    else if (intento === 1) throw new Corte("pendiente", `El número vino de otra sucursal (${n}): otro sistema cambió la sucursal. No se grabó; se reintenta en 10 min.`, true)
  }

  // Grabar: sucursal REBUCRET de nuevo, con lo mínimo entre medio
  await marcar("grabar")
  alGrabar()
  await aRebucret(nav)
  const { cuerpo, tipo } = cuerpoGrabar(f.orden, { ...valores, numero: numero!, pedidos_unico: c.pedidos_unico, pedidos: c.pedidos || "0" }, det, rs, boundary)
  const g = await nav.post("grabar_pedidos.php?codigo=0", cuerpo, tipo)
  const no = rechazo(g)

  // Confirmar en el listado de REBUCRET por número y la marca (23.3 c)
  await marcar("verificar")
  await aRebucret(nav)
  const x = await porNumero(nav, numero!)
  if (x) {
    const a = await abrir(nav, x.codigo)
    if (a.form && tieneMarca(a.form.campos.observaciones, d.marca)) return { estado: "ok", mensaje: null, numero: numeroCompleto(comp, numero!), codigo: x.codigo, sucursal: SUCURSAL_REBUCRET, paso: "verificar", grabado: true }
  }
  const otra = await dondeQuedo(nav, d, o.hoy, latir)
  if (otra.estado === "esta") return encontrada(otra, "verificar")
  if (otra.estado === "dudosa") return dudosa(otra, "verificar")
  if (no) return { estado: "error", mensaje: `Zomatik no aceptó la NP: ${no}`, paso: "grabar", reintentar: false, grabado: false }
  return { estado: "revisar", mensaje: `Zomatik grabó pero la NP ${numeroCompleto(comp, numero!)} no aparece con la marca. Revisala en Zomatik.`, paso: "verificar", grabado: true }
}

async function deProyecto(nav: NavegadorNp, d: DatosNp, o: OpcionesRobot, azar: () => number, boundary: string, marcar: (p: string) => Promise<void>, alGrabar: () => void, latir: () => Promise<void>): Promise<ResultadoNp> {
  await marcar("material")
  await aRebucret(nav)
  const mat = await nav.get(`modificar_pedidos.php?proyecto=${d.proyectoCodigo}&tipo=1`)
  const f = camposFormulario(mat.html, /frm_pedido|grabar_pedidos/i)
  if (!f) throw formato("no se abrió el MATERIAL del proyecto")
  const falta = faltanCampos(f.campos, ["pedidos_unico", "idcliente", "idvendedor", "deposito", "fecha_entrega", "observaciones", "comprobante"])
  if (falta.length) throw formato(`faltan ${falta.join(", ")}`)
  if (!/^grabar_pedidos\.php\?codigo=0$/i.test(f.action || "")) throw formato("el MATERIAL graba en otro lado")
  if (String(f.campos.idcliente) !== String(d.clienteCodigo)) throw dato("El proyecto es de otro cliente en Zomatik: elegí otro proyecto.")
  // Vendedor: el de quien programa; si no tiene, el que trae el proyecto
  if (!d.vendedorId && (!f.campos.idvendedor || f.campos.idvendedor === "0")) throw dato(SIN_VENDEDOR)

  const obsProyecto = (f.campos.observaciones || "").trim()
  const valores: Record<string, string> = {
    deposito: String(d.deposito), fecha_entrega: d.fecha, observaciones_entrega: d.entrega,
    observaciones: obsProyecto ? `${obsProyecto} - ${d.marca}` : d.marca,
    ...(d.vendedorId ? { idvendedor: String(d.vendedorId), vendedor: d.vendedorNombre || "", vendedor_manual: "1" } : {}),
  }
  const c = { ...f.campos, ...valores }
  const base: [string, string][] = [["fcliente", c.idcliente], ["facopio", ""], ["forigen", "3"], ["flista", c.idlista || "0"]]

  // Continuar: trae el renglón del proyecto con lo disponible (23.2)
  await marcar("continuar")
  let det = await manage(nav, c, base, d.proyectoCodigo, azar)
  let rs = det.renglones
  const delPedido = { codigo: d.articuloCodigo, nombre: d.articuloNombre }
  const mio = rs.filter((r) => esRenglonDe(r, delPedido))
  if (mio.length !== 1) {
    const hay = rs.map((r) => r.articulo).filter(Boolean).join(", ")
    throw dato(`El proyecto no tiene la fórmula del pedido${d.articuloNombre ? ` (${d.articuloNombre})` : ""}${hay ? `; tiene: ${hay}` : ""}.`)
  }
  const disponible = numeroZomatik(mio[0].cantidad)
  if (disponible !== null && d.m3 > disponible + 0.001)
    return { estado: "error", mensaje: `Al proyecto le quedan ${cantidadTexto(disponible).replace(".", ",")} m³ y el pedido es de ${cantidadTexto(d.m3).replace(".", ",")} m³. Bajá los m³ o mandá el resto a una NP nueva.`, paso: "continuar", disponible, reintentar: false }

  // Los otros renglones del proyecto no van en la NP del día
  for (const otro of rs.filter((r) => r !== mio[0])) {
    if (!otro.borrar) throw formato("un renglón del proyecto no se puede sacar")
    await marcar("sacar_renglon")
    det = await manage(nav, c, [...base.slice(0, 3), ["fparam", fparamDe(rs)], ["fborrar", otro.borrar]], d.proyectoCodigo, azar)
    rs = det.renglones
  }
  const elegido = rs.filter((r) => esRenglonDe(r, delPedido))
  if (elegido.length !== 1 || rs.length !== 1) throw formato("el detalle del proyecto quedó raro", det.html)
  rs = [conCantidad(elegido[0], d.m3)]

  await marcar("grabar")
  alGrabar()
  await aRebucret(nav)
  const { cuerpo, tipo } = cuerpoGrabar(f.orden, valores, det, rs, boundary)
  const g = await nav.post("grabar_pedidos.php?codigo=0", cuerpo, tipo)
  const no = rechazo(g)

  // El número lo asigna Zomatik al grabar: se busca por la marca entre las NP de hoy del cliente
  await marcar("verificar")
  const x = await dondeQuedo(nav, d, o.hoy, latir)
  if (x.estado === "esta") return encontrada(x, "verificar", disponible)
  if (x.estado === "dudosa") return dudosa(x, "verificar", disponible)
  if (no) return { estado: "error", mensaje: `Zomatik no aceptó la NP: ${no}`, paso: "grabar", disponible, reintentar: false, grabado: false }
  return { estado: "revisar", mensaje: "Zomatik grabó pero la NP del proyecto no aparece con la marca. Revisala en Zomatik.", paso: "verificar", disponible, grabado: true }
}

// ---------------------------------------------------------------------------
// Vaciar (pedido cancelado, 23.4)
// ---------------------------------------------------------------------------

/** Los renglones GRABADOS de una NP abierta: los de la página o, si la página no los trae (los carga por JS), los que
 *  devuelve manage_pedidos.php con los datos de esa página (pedidos=N y su pedidos_unico), como hace el navegador. */
async function detalleGrabado(nav: NavegadorNp, pag: { html: string; form: ReturnType<typeof camposFormulario>; renglones: Renglon[] }, base: [string, string][], proyecto: number | null, azar: () => number): Promise<{ renglones: Renglon[]; det: Detalle | null; valido: boolean; total: number | null }> {
  if (pag.renglones.length || !pag.form) return { renglones: pag.renglones, det: null, valido: pag.renglones.length > 0, total: null }
  const det = await manage(nav, pag.form.campos, [...base, ["flista", pag.form.campos.idlista || "0"]], proyecto, azar)
  // "Cargó bien" = es la tabla del detalle (cabecera y #totalcosto): solo así "sin renglones" quiere decir algo
  return { renglones: det.renglones, det, valido: esDetalle(det.html), total: totalDetalle(det.html) }
}

/**
 * Vaciar una NP ya grabada (23.4). La página de la NP abierta NO trae los renglones en el HTML (el navegador los carga
 * después, con manage_pedidos.php): por eso, el 28/10, el robot vio "sin renglones" y dio por vaciada la NP2
 * 0001-00002086 sin borrar ni grabar nada. Ahora:
 *   1. Lo que vale es lo GRABADO en Zomatik: el total de la NP en el listado (y los renglones de la página o del detalle).
 *   2. El detalle se carga como lo hace la página (manage_pedidos.php con los datos de la NP abierta: pedidos=N y su
 *      pedidos_unico), se borra cada renglón con el tacho (fborrar) y se graba con fparam vacío, sin campos de renglón.
 *   3. Después de grabar se vuelve a abrir la NP y a mirar el listado: vaciada SOLO si no hay renglones y el total es 0.
 *      Si no, "revisar" con un recorte de la respuesta (lo avisa quien llama a los gerenciales).
 */
export async function vaciarNp(nav: NavegadorNp, d: DatosVaciar, o: OpcionesRobot): Promise<ResultadoVaciar> {
  const azar = o.azar || (() => Math.floor(Math.random() * 345343))
  const boundary = o.boundary || `----rebucret${Date.now().toString(36)}`
  let paso = "abrir"
  const marcar = async (p: string) => {
    paso = p
    await o.alPaso?.(p)
  }
  /** Total grabado de la NP según el listado de REBUCRET (null si no aparece o no trae el total). */
  const totalGrabado = async (): Promise<number | null> => {
    if (!d.numero) return null
    await aRebucret(nav)
    const l = await listado(nav, { bus_numero: numeroNormalizado(d.numero) || d.numero }, SUCURSAL_REBUCRET)
    if (l.sucursalPagina !== SUCURSAL_REBUCRET) return null
    const f = l.filas.find((x) => x.codigo === d.codigo)
    return f ? f.total : null
  }
  try {
    if (!Number.isInteger(d.codigo) || d.codigo <= 0) return { estado: "revisar", mensaje: "No se sabe el código de la NP en Zomatik: vaciala a mano.", paso }
    if (!d.numero) return { estado: "revisar", mensaje: "No se sabe el número de la NP: vaciala a mano.", paso }
    await marcar("abrir")
    const a = await abrir(nav, d.codigo)
    if (!a.form) throw formato("no se abrió la NP", a.html)
    if (!tieneMarca(a.form.campos.observaciones, d.marca)) return { estado: "revisar", mensaje: "La NP no tiene la marca del sistema: no se toca. Revisala en Zomatik.", paso }
    const accion = a.form.action || ""
    // Tiene que grabar sobre ESTA NP (nunca codigo=0, que sería una NP nueva)
    if (accion.toLowerCase() !== `grabar_pedidos.php?codigo=${d.codigo}`) throw formato("la NP graba en otro lado", a.html)
    await marcar("total")
    const antes = await totalGrabado()
    const c = a.form.campos
    // La página tiene que ser de ESTA NP (hidden "pedidos" = su código): si no, el detalle y el tacho irían a otra
    if (String(c.pedidos || "") !== String(d.codigo)) throw formato("la página abierta no es de esta NP", a.html)
    const proyecto = Number(c.proyecto || 0) || null
    const base: [string, string][] = [["fcliente", c.idcliente || "0"], ["facopio", c.acopio ?? ""], ["forigen", (c.origen as string) || "1"]]
    // El detalle: el de la página, o el que la página carga por JS (manage_pedidos.php con pedidos=N y su pedidos_unico)
    await marcar("detalle")
    const leido = await detalleGrabado(nav, a, base, proyecto, azar)
    let det: Detalle | null = leido.det
    let rs = leido.renglones
    if (!leido.valido && !rs.length) return { estado: "revisar", mensaje: `No se pudo leer el detalle de la NP (Zomatik dice total ${antes ?? "sin dato"}). No se tocó: vaciala a mano.`, paso, recorte: recorte(det?.html || a.html) }
    // ¿Ya está vacía en Zomatik? (un grabar anterior llegó): el detalle cargó bien, sin renglones, y el listado da 0
    if (!rs.length && antes === 0 && (leido.total === null || leido.total === 0)) return { estado: "vaciada", mensaje: null, paso }
    if (!rs.length) return { estado: "revisar", mensaje: `El detalle de la NP no tiene renglones pero Zomatik dice total ${antes ?? "sin dato"}. No se tocó: revisala a mano.`, paso, recorte: recorte(det?.html || a.html) }
    for (const r of [...rs]) {
      if (String(c.pedidos || "") !== String(d.codigo)) throw formato("la página abierta no es de esta NP", a.html)
      if (!r.borrar) throw formato("un renglón no tiene el tacho", det?.html || a.html)
      await marcar("borrar_renglon")
      det = await manage(nav, c, [...base, ["fparam", fparamDe(rs)], ["fborrar", r.borrar]], proyecto, azar)
      rs = det.renglones
    }
    if (rs.length) throw formato("quedaron renglones después de borrar", det?.html)
    await marcar("grabar")
    await aRebucret(nav)
    // fparam vacío y SIN los campos del renglón viejo (si se mandan, el renglón revive)
    const { cuerpo, tipo } = cuerpoGrabar(a.form.orden, {}, det, [], boundary)
    const g = await nav.post(accion, cuerpo, tipo)
    const no = rechazo(g)
    // Comprobar en Zomatik: se vuelve a abrir la NP (página nueva, su propio pedidos_unico), se cargan sus renglones como
    // lo hace la página y se mira el total del listado. Vaciada SOLO sin renglones y con total 0.
    await marcar("verificar")
    const v = await abrir(nav, d.codigo)
    const esLaMisma = !!v.form && String(v.form.campos.pedidos || "") === String(d.codigo)
    const quedan = esLaMisma ? await detalleGrabado(nav, v, [["fcliente", v.form!.campos.idcliente || "0"], ["facopio", v.form!.campos.acopio ?? ""], ["forigen", (v.form!.campos.origen as string) || "1"]], proyecto, azar) : null
    const despues = await totalGrabado()
    // Vaciada SOLO si el detalle cargó bien y no tiene renglones; el total 0 (listado y #totalcosto) es una confirmación más
    if (quedan && quedan.valido && !quedan.renglones.length && despues === 0 && (quedan.total === null || quedan.total === 0)) return { estado: "vaciada", mensaje: null, paso }
    if (no) return { estado: "error", mensaje: `Zomatik no dejó vaciar la NP: ${no}`, paso, recorte: recorte(g.html) }
    return {
      estado: "revisar",
      mensaje: `Se grabó pero la NP no quedó vacía en Zomatik (${quedan ? `${quedan.renglones.length} renglón(es)` : "no se pudo abrir"}, total ${despues ?? "sin dato"}). Revisala en Zomatik.`,
      paso,
      recorte: recorte(quedan?.det?.html || v.html),
    }
  } catch (e) {
    if (e instanceof Corte) return { estado: e.estado === "pendiente" ? "vaciar" : e.estado === "ok" ? "vaciada" : (e.estado as "revisar" | "error"), mensaje: e.message, paso, recorte: e.recorte }
    // Corte de red: queda para vaciar; la próxima vez se abre de nuevo y se mira (vaciar es idempotente)
    return { estado: "vaciar", mensaje: `${mensajeDe(e)}. Se reintenta en 10 min.`, paso }
  }
}

// ---------------------------------------------------------------------------
// Autorizar la NP del sistema (03/11, Bautista: "se autoriza sola en el momento")
// ---------------------------------------------------------------------------

export type ResultadoAutorizar = {
  /** autorizada = la autorizó el robot; ya = ya estaba autorizada; sin_autorizar = no se pudo (se reintenta);
   *  revisar = no tiene nuestra marca (nunca se autoriza: lo mira una persona) */
  estado: "autorizada" | "ya" | "sin_autorizar" | "revisar"
  mensaje: string | null
  recorte?: string
}

/**
 * Autoriza una NP en Zomatik si está "pendiente de autorización" (fila en rojo con el ícono `Autorizar(<codigo>)`, sin
 * REMITO). Sin autorizar no aparece el remito ni sus pendientes. Solo una NP con NUESTRA marca: se abre y se mira antes.
 *   sucursal 18 → listado por número → (ya autorizada: fin) → abrir la NP y ver la marca → el form frm_autorizar del
 *   listado tiene que ser el leído → POST _autorizarpedido.php con autorizar=<codigo> → listado otra vez: sin
 *   "Autorizar(" y con el link REMITO.
 * Nunca tira: lo que no se pueda vuelve como "sin_autorizar" (la NP sigue "ok"; se reintenta en la pasada).
 */
export async function autorizarNp(nav: NavegadorNp, d: { codigo: number; numero: string | null; marca: string }, o: { latir?: () => Promise<void> } = {}): Promise<ResultadoAutorizar> {
  const sin = (m: string, html?: string): ResultadoAutorizar => ({ estado: "sin_autorizar", mensaje: m, ...(html ? { recorte: recorte(html) } : {}) })
  try {
    if (!Number.isInteger(d.codigo) || d.codigo <= 0 || !d.numero) return sin("la NP no tiene código o número de Zomatik")
    const fila = async () => {
      await o.latir?.()
      await aRebucret(nav)
      const l = await listado(nav, { bus_numero: numeroNormalizado(d.numero) || d.numero! }, SUCURSAL_REBUCRET)
      if (l.sucursalPagina !== SUCURSAL_REBUCRET) return { l, a: null, otraSucursal: true }
      return { l, a: autorizacionEnListado(l.html, d.codigo), otraSucursal: false }
    }
    const antes = await fila()
    if (antes.otraSucursal) return sin("el listado de pedidos vino de otra sucursal")
    if (!antes.a) return sin(`no se encontró la ${d.numero} en el listado de pedidos`, antes.l.html)
    if (antes.a.otroAutorizar) return sin("la fila trae el ícono de autorizar de otro código", antes.l.html)
    if (!antes.a.porAutorizar) return antes.a.conRemito ? { estado: "ya", mensaje: null } : sin("la NP no muestra ni Autorizar ni REMITO", antes.l.html)
    // Solo una NP con nuestra marca
    const np = await abrir(nav, d.codigo)
    if (!np.form) return sin(`no se pudo abrir la ${d.numero}`, np.html)
    if (!tieneMarca(np.form.campos.observaciones, d.marca)) return { estado: "revisar", mensaje: `La ${d.numero} no tiene la marca del sistema: no se autoriza sola. Autorizala a mano si corresponde.` }
    if (!tieneFormAutorizar(antes.l.html)) return sin("Zomatik cambió el formulario de autorizar", antes.l.html)
    await o.latir?.()
    await aRebucret(nav)
    const r = await nav.post(RUTA_AUTORIZAR_NP, bytes(`autorizar=${d.codigo}`), "application/x-www-form-urlencoded")
    const despues = await fila()
    if (!despues.otraSucursal && despues.a && !despues.a.porAutorizar && !despues.a.otroAutorizar && despues.a.conRemito) return { estado: "autorizada", mensaje: null }
    return sin(`Zomatik no la autorizó${rechazo(r) ? ` (${rechazo(r)})` : ""}`, despues.l.html || r.html)
  } catch (e) {
    return sin(mensajeDe(e))
  }
}

// ---------------------------------------------------------------------------
// Ajustar la cantidad de la NP a lo despachado (al finalizar el pedido, antes de la OF y el remito)
// ---------------------------------------------------------------------------

export type DatosAjuste = {
  /** Código de la NP en Zomatik (modificar_pedidos.php?codigo=N) */
  codigo: number
  numero: string | null
  /** La marca de la NP (la que se grabó al generarla): sin ella no se toca */
  marca: string
  articuloCodigo?: number | null
  articuloNombre?: string | null
  /** Lo que el sistema cree que tiene la NP (zomatik_np.m3): Zomatik tiene que decir lo mismo */
  m3Np: number
  /** La cantidad que tiene que quedar */
  objetivo: number
  /** Hubo un Grabar que pudo llegar (corte en grabar_np / verificar_np): primero se relee la NP */
  cortado: boolean
}

export type ResultadoAjusteNp = {
  /** con_factura = Zomatik no deja editar la NP (no se tocó o no aceptó el Grabar por la factura) */
  estado: "ok" | "con_factura" | "revisar" | "error" | "pendiente"
  mensaje: string | null
  paso: string
  /** La cantidad del renglón que se leyó en Zomatik al empezar */
  leido?: number | null
  totalAntes?: number | null
  totalDespues?: number | null
  /** Por qué se dice que tiene factura (o lo que contestó Zomatik) */
  facturaTexto?: string | null
  /** El número de la factura de la NP, si se leyó en sus comprobantes ("F2 0001-00002455") */
  facturaNumero?: string | null
  /** Zomatik ya tenía la cantidad nueva: no se grabó nada */
  yaEstaba?: boolean
  grabado?: boolean
  recorte?: string
}

export type LecturaAjuste = {
  pagina: Awaited<ReturnType<typeof abrir>>
  form: NonNullable<ReturnType<typeof camposFormulario>>
  accion: string
  renglon: Renglon
  det: Detalle | null
  cantidad: number
  fila: { total: number | null; estado: string } | null
}

/** La fila de la NP en el listado de REBUCRET (null si no aparece o el listado vino de otra sucursal). */
async function filaNp(nav: NavegadorNp, d: { codigo: number; numero: string | null }) {
  if (!d.numero) return null
  await aRebucret(nav)
  const l = await listado(nav, { bus_numero: numeroNormalizado(d.numero) || d.numero }, SUCURSAL_REBUCRET)
  if (l.sucursalPagina !== SUCURSAL_REBUCRET) return null
  const f = l.filas.find((x) => x.codigo === d.codigo)
  return f ? { total: f.total, estado: f.estado } : null
}

/**
 * Abre la NP para el ajuste (paso `leer_np`): tiene que tener nuestra marca, grabar sobre ESTA NP (nunca codigo=0), ser
 * la página de esta NP (hidden `pedidos` = N) y tener UN renglón, del artículo de la NP, con la cantidad legible. El
 * detalle se carga como la página (manage_pedidos.php con pedidos=N y su pedidos_unico). Lo que no se reconoce: "revisar"
 * (o "error" si la página cambió de forma), sin grabar nada.
 */
export async function leerNpParaAjuste(nav: NavegadorNp, d: Pick<DatosAjuste, "codigo" | "numero" | "marca" | "articuloCodigo" | "articuloNombre">, o: { azar?: () => number } = {}): Promise<LecturaAjuste> {
  const azar = o.azar || (() => Math.floor(Math.random() * 345343))
  if (!Number.isInteger(d.codigo) || d.codigo <= 0) throw new Corte("revisar", "No se sabe el código de la NP en Zomatik: ajustala a mano.")
  if (!d.numero) throw new Corte("revisar", "No se sabe el número de la NP: ajustala a mano.")
  await aRebucret(nav)
  const a = await abrir(nav, d.codigo)
  if (!a.form) throw formato("no se abrió la NP", a.html)
  if (!tieneMarca(a.form.campos.observaciones, d.marca)) throw new Corte("revisar", "La NP no tiene la marca del sistema: no se toca. Revisala en Zomatik.")
  const accion = a.form.action || ""
  if (accion.toLowerCase() !== `grabar_pedidos.php?codigo=${d.codigo}`) throw formato("la NP graba en otro lado", a.html)
  const c = a.form.campos
  if (String(c.pedidos || "") !== String(d.codigo)) throw formato("la página abierta no es de esta NP", a.html)
  const proyecto = Number(c.proyecto || 0) || null
  const base: [string, string][] = [["fcliente", c.idcliente || "0"], ["facopio", c.acopio ?? ""], ["forigen", (c.origen as string) || "1"]]
  // El detalle SIEMPRE como lo carga la página (manage_pedidos.php): el botón Grabar (señal de factura) solo viene ahí
  const det = await manage(nav, c, [...base, ["flista", c.idlista || "0"]], proyecto, azar)
  const leido = { det, renglones: det.renglones, valido: esDetalle(det.html) }
  const html = det.html
  if (!leido.valido) throw new Corte("revisar", "No se pudo leer el detalle de la NP. No se tocó: revisala.", false, html)
  if (leido.renglones.length !== 1) throw new Corte("revisar", `La NP tiene ${leido.renglones.length} renglones: no se toca. Revisala en Zomatik.`, false, html)
  const r = leido.renglones[0]
  const art = { codigo: d.articuloCodigo, nombre: d.articuloNombre }
  if ((art.codigo || art.nombre) && !esRenglonDe(r, art)) throw new Corte("revisar", `El renglón de la NP no es ${d.articuloNombre || "el artículo del pedido"}: no se toca. Revisala en Zomatik.`, false, html)
  const cantidad = numeroZomatik(r.cantidad)
  if (cantidad === null || !(cantidad > 0)) throw new Corte("revisar", "No se pudo leer la cantidad de la NP. No se tocó: revisala.", false, html)
  return { pagina: a, form: a.form, accion, renglon: r, det: leido.det, cantidad, fila: await filaNp(nav, d) }
}

/** Los comprobantes de la NP (señal B, solo lectura). null si no se pudieron leer: entonces decide solo el detalle. */
async function comprobantesNp(nav: NavegadorNp, codigo: number, azar: () => number): Promise<Comprobantes | null> {
  try {
    const r = await nav.get(`_comprobantes.php?ftarget=pedidos&ftargetid=${codigo}&rnd=${azar()}`)
    return r.status === 200 ? comprobantesDeNp(r.html) : null
  } catch (e) {
    if (esDeRed(e)) throw e // red o sesión: se reintenta todo el ajuste
    return null
  }
}

/**
 * Pone la cantidad de la NP en `objetivo` (achicar o agrandar). Editar es ABSOLUTO (se pone la cantidad, no "restar
 * 20"): reintentar después de un corte es seguro, pero primero se relee (4.3).
 *   leer_np       → la NP con la marca, un renglón; la cantidad tiene que ser la del sistema (si no, "revisar").
 *                   Cortado antes: ya en `objetivo` → ok sin grabar; en la de antes → se vuelve a editar; otra → revisar.
 *   leer_factura  → 15.1: si Zomatik no deja editarla, "con_factura" y no se toca. Si no se puede saber, "revisar".
 *   editar_detalle, grabar_np (quien llama lo guarda ANTES de mandar) → Grabar sobre esta NP con el renglón y fparam.
 *   verificar_np  → abrir otra vez: un renglón en `objetivo`, la marca, y el total del listado en proporción.
 */
export async function ajustarCantidadNp(nav: NavegadorNp, d: DatosAjuste, o: OpcionesRobot): Promise<ResultadoAjusteNp> {
  const azar = o.azar || (() => Math.floor(Math.random() * 345343))
  const boundary = o.boundary || `----rebucret${Date.now().toString(36)}`
  let paso = "leer_np"
  let grabado = false
  const marcar = async (p: string) => {
    paso = p
    await o.alPaso?.(p)
  }
  const igual = (a: number, b: number) => Math.abs(a - b) <= TOL_AJUSTE
  let leidoAntes: number | null = null
  try {
    if (!(d.objetivo > 0)) return { estado: "revisar", mensaje: "La NP quedaría en 0 m³: no se toca (la decide una persona).", paso }
    await marcar("leer_np")
    const l = await leerNpParaAjuste(nav, d, { azar })
    leidoAntes = l.cantidad
    // Un corte anterior en el Grabar: lo que dice Zomatik ahora manda
    if (d.cortado && igual(l.cantidad, d.objetivo)) return { estado: "ok", mensaje: null, paso, leido: l.cantidad, totalDespues: l.fila?.total ?? null, yaEstaba: true }
    if (!igual(l.cantidad, d.m3Np)) return { estado: "revisar", mensaje: msjNpCambio(l.cantidad, d.m3Np), paso, leido: l.cantidad }
    await marcar("leer_factura")
    const f = facturaDeNp({ detalleHtml: l.det?.html ?? null, renglon: l.renglon, filaEstado: l.fila?.estado ?? null, comprobantes: await comprobantesNp(nav, d.codigo, azar) })
    if (f.estado === "con") return { estado: "con_factura", mensaje: null, paso, leido: l.cantidad, facturaTexto: f.motivo, facturaNumero: f.numero ?? null }
    if (f.estado === "contradice") return { estado: "revisar", mensaje: msjFacturaContradice(f.numero || "?"), paso, leido: l.cantidad, facturaTexto: f.motivo, facturaNumero: f.numero ?? null, recorte: recorte(l.det?.html || "") }
    if (f.estado === "no_se_sabe") return { estado: "revisar", mensaje: MSJ_FACTURA_NO_SE_SABE, paso, leido: l.cantidad, facturaTexto: f.motivo, recorte: recorte(l.det?.html || l.pagina.html) }
    // El total grabado de antes (para ver que quedó en proporción): sin la fila del listado no se sigue
    if (!l.fila || l.fila.total === null) return { estado: "revisar", mensaje: `No se encontró la ${d.numero} en el listado de pedidos de REBUCRET. No se tocó: revisala.`, paso, leido: l.cantidad }
    const totalAntes = l.fila.total
    if (igual(l.cantidad, d.objetivo)) return { estado: "ok", mensaje: null, paso, leido: l.cantidad, totalAntes, totalDespues: totalAntes, yaEstaba: true }

    await marcar("decidir")
    await marcar("editar_detalle")
    const rs = [conCantidad(l.renglon, d.objetivo)]
    await marcar("grabar_np")
    grabado = true
    await aRebucret(nav)
    const { cuerpo, tipo } = cuerpoGrabar(l.form.orden, {}, l.det, rs, boundary)
    const g = await nav.post(l.accion, cuerpo, tipo)
    const no = rechazo(g)

    // Comprobar en Zomatik: la NP abierta de nuevo (página nueva) con UN renglón en el objetivo y el total en proporción
    await marcar("verificar_np")
    let v: LecturaAjuste | null = null
    try {
      v = await leerNpParaAjuste(nav, d, { azar })
    } catch (e) {
      if (!(e instanceof Corte)) throw e
    }
    if (v && igual(v.cantidad, d.objetivo)) {
      const despues = v.fila?.total ?? null
      if (despues !== null && totalProporcional(totalAntes, l.cantidad, despues, d.objetivo))
        return { estado: "ok", mensaje: null, paso, leido: l.cantidad, totalAntes, totalDespues: despues, grabado: true }
      return { estado: "revisar", mensaje: `La NP quedó en ${m3Texto(d.objetivo)} m³ pero el total del listado no cerró (antes ${totalAntes}, ahora ${despues ?? "sin dato"}). Revisala en Zomatik.`, paso, leido: l.cantidad, totalAntes, totalDespues: despues, grabado: true, recorte: recorte(g.html) }
    }
    if (v && igual(v.cantidad, l.cantidad)) {
      if (no && rechazoPorFactura(no)) return { estado: "con_factura", mensaje: null, paso: "grabar_np", leido: l.cantidad, facturaTexto: `Zomatik contestó: ${no}`, recorte: recorte(g.html) }
      if (no) return { estado: "error", mensaje: msjZomatikNoDejo(no), paso: "grabar_np", leido: l.cantidad, recorte: recorte(g.html) }
      return { estado: "revisar", mensaje: `Se grabó pero la NP sigue en ${m3Texto(l.cantidad)} m³. Revisala en Zomatik.`, paso, leido: l.cantidad, grabado: true, recorte: recorte(g.html) }
    }
    return {
      estado: "revisar",
      mensaje: `Después de grabar, la NP ${v ? `tiene ${m3Texto(v.cantidad)} m³ (se esperaban ${m3Texto(d.objetivo)})` : "no se pudo leer"}${no ? ` · Zomatik dijo: ${no}` : ""}. Revisala en Zomatik.`,
      paso, leido: l.cantidad, grabado: true, recorte: recorte(g.html),
    }
  } catch (e) {
    if (e instanceof Corte) return { estado: e.estado === "ok" ? "revisar" : e.estado, mensaje: e.message, paso, leido: leidoAntes, recorte: e.recorte, grabado }
    const m = mensajeDe(e)
    // Red o sesión: antes de Grabar se reintenta; durante o después, el próximo intento relee la NP primero
    if (grabado) return { estado: "pendiente", mensaje: `Se cortó al grabar la NP (${m}). Antes de reintentar se relee en Zomatik.`, paso, grabado: true, leido: leidoAntes }
    return { estado: esDeRed(e) ? "pendiente" : "error", mensaje: m, paso, leido: leidoAntes }
  }
}

// ---------------------------------------------------------------------------
// Control de NP eliminadas a mano en Zomatik (SOLO LECTURA: listado de pedidos de REBUCRET)
// ---------------------------------------------------------------------------

/**
 * Lo que dice una lectura: la NP está, no está (con el listado leído bien y trayendo NP de su serie) o no se pudo saber.
 * Con "ilegible" no se concluye nada.
 */
export type LecturaNp = { estado: "esta" } | { estado: "no_esta" } | { estado: "ilegible"; motivo: string }

export type NpAControlar = { id: string; numero: string; codigo: number | null }

/** ¿La fila del listado es esta NP? Por el código de Zomatik o por el número y el comprobante (NP / NP2). */
function esLaNp(f: FilaPedido, np: NpAControlar): boolean {
  if (np.codigo && f.codigo === np.codigo) return true
  return numeroNormalizado(f.numero) === numeroNormalizado(np.numero) && comprobanteDeNumero(f.numero) === comprobanteDeNumero(np.numero)
}

/**
 * Busca cada NP en el listado de pedidos de REBUCRET, sin escribir nada. Todos los `bus_*` del buscador van en blanco
 * salvo el número y la sucursal (lista blanca). Por cada bloque de 100 números ("0001-000020") se lee el listado con
 * ese número: tiene que venir de REBUCRET, en una sola página, con TODAS las filas de ese bloque y alguna NP de la misma
 * serie y comprobante (si no, "ilegible": también así se nota si `bus_numero` se ignora o filtra distinto). Si la NP no
 * aparece en el bloque, se confirma con su número exacto (todas las filas con ese número): recién si tampoco aparece,
 * "no_esta". Una falla de red o de sesión deja todo lo que falta "ilegible".
 * `seguir`: si devuelve false, no se lee nada más (lo que quede, sin lectura).
 */
export async function buscarNpEnZomatik(nav: NavegadorNp, nps: NpAControlar[], o: { latir?: () => Promise<void>; seguir?: () => boolean } = {}): Promise<Map<string, LecturaNp>> {
  const out = new Map<string, LecturaNp>()
  const bloques = new Map<string, NpAControlar[]>()
  for (const np of nps) {
    const b = bloqueNp(np.numero)
    if (!b || !esSerieRebucret(np.numero)) {
      out.set(np.id, { estado: "ilegible", motivo: "el número no es de la serie de REBUCRET" })
      continue
    }
    bloques.set(b, [...(bloques.get(b) || []), np])
  }
  const ilegibles = (lista: NpAControlar[], motivo: string) => lista.forEach((np) => out.set(np.id, { estado: "ilegible", motivo }))
  /** El listado de REBUCRET con ese número (o "ilegible" con el motivo). */
  const leer = async (numero: string, esDeLaBusqueda: (f: FilaPedido) => boolean): Promise<{ filas: FilaPedido[] } | { motivo: string }> => {
    await o.latir?.()
    await aRebucret(nav)
    const l = await listado(nav, { bus_numero: numero }, SUCURSAL_REBUCRET, true)
    if (l.sucursalPagina !== SUCURSAL_REBUCRET) return { motivo: "el listado de pedidos vino de otra sucursal" }
    if ((l.paginas ?? 1) > 1 || l.paginado) return { motivo: "el listado de pedidos tiene más de una página" }
    if (l.filas.some((f) => !esDeLaBusqueda(f))) return { motivo: `la búsqueda por ${numero} trajo NP de otros números (el filtro no anduvo como se espera)` }
    return { filas: l.filas }
  }
  const lista = [...bloques.entries()]
  for (let i = 0; i < lista.length; i++) {
    const [bloque, deBloque] = lista[i]
    if (o.seguir && !o.seguir()) break
    try {
      const l = await leer(bloque, (f) => bloqueNp(f.numero) === bloque)
      if ("motivo" in l) {
        ilegibles(deBloque, l.motivo)
        continue
      }
      for (const np of deBloque) {
        if (l.filas.some((f) => esLaNp(f, np))) {
          out.set(np.id, { estado: "esta" })
          continue
        }
        // La búsqueda tiene que traer otras NP de la misma serie y comprobante: si no trae ninguna, no se sabe si anduvo
        const comp = comprobanteDeNumero(np.numero)
        const deSerie = l.filas.filter((f) => esSerieRebucret(f.numero) && bloqueNp(f.numero) === bloque && comprobanteDeNumero(f.numero) === comp)
        if (!deSerie.length) {
          out.set(np.id, { estado: "ilegible", motivo: "la búsqueda no trajo NP de esa serie" })
          continue
        }
        // Segunda mirada, por el número exacto
        if (o.seguir && !o.seguir()) {
          out.set(np.id, { estado: "ilegible", motivo: "sin tiempo para la segunda mirada" })
          continue
        }
        const n = numeroNormalizado(np.numero) || np.numero
        const exacta = await leer(n, (f) => numeroNormalizado(f.numero) === n)
        if ("motivo" in exacta) out.set(np.id, { estado: "ilegible", motivo: exacta.motivo })
        else out.set(np.id, exacta.filas.some((f) => esLaNp(f, np)) ? { estado: "esta" } : { estado: "no_esta" })
      }
    } catch (e) {
      const sinLeer = deBloque.filter((np) => !out.has(np.id))
      ilegibles(sinLeer, mensajeDe(e))
      if (esDeRed(e)) {
        // Sin sesión o sin red no se insiste: lo que falta queda sin lectura
        for (const [, resto] of lista.slice(i + 1)) ilegibles(resto, mensajeDe(e))
        break
      }
    }
  }
  return out
}
