// Puente Rebucret ↔ Indumix · cómo se habla con el controlador (InterNiche, 192.168.0.10). Sin dependencias.
// Especificación: docs/specs/2026-11-05-puente-indumix.md (1.2 y 1.4). Lo prueba lib/__tests__/carga-indumix.test.mjs.
//
// - Leer: POST /cgi-bin/ILRReadValues.exe con el mismo XML que arma hmi.js (la pantalla de Indumix).
// - Escribir: GET /cgi-bin/writeVal.exe?<variable>+<valor>. LISTA CERRADA, fija acá: solo Receta.neReporte (1 a 10) y
//   Receta.neReceta (1 a 20), que son el número de reporte o de receta que se quiere mirar. Cualquier otra escritura
//   tira error antes de salir. La nube no puede ampliar esta lista.

/** Lo único que el puente puede escribir en Indumix, con su rango. Congelado: no se puede cambiar en tiempo de ejecución. */
export const ESCRITURAS_PERMITIDAS = Object.freeze({
  "Receta.neReporte": Object.freeze([1, 10]),
  "Receta.neReceta": Object.freeze([1, 20]),
})

/** Nuestro servidor: fijo en el código (no se toma de la config). */
export const SERVIDOR = "https://www.produccionrebucret.com"

export const RUTA_LEER = "/cgi-bin/ILRReadValues.exe"
export const RUTA_ESCRIBIR = "/cgi-bin/writeVal.exe"
export const CLIENTE = "hmi.js"
export const CLIENTE_VERSION = "1.6.40.150.09"
export const PANTALLA = "vRhz1"

const escXml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c])
const desXml = (t) => String(t).replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (m, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[e] ?? (e.startsWith("#") ? String.fromCharCode(Number(e.slice(1))) : m))

/** El cuerpo del pedido de lectura, igual al de hmi.js. */
export function armarPedido(variables, pantalla = PANTALLA) {
  if (!Array.isArray(variables) || !variables.length) throw new Error("Pedido sin variables")
  const items = variables.map((v) => `<i><n>${escXml(v)}</n></i>`).join("")
  return `<body><version>1.2</version><client>${CLIENTE}</client><client_ver>${CLIENTE_VERSION}</client_ver><file_name>${escXml(pantalla)}</file_name><action>Read</action><item_list_size>${variables.length}</item_list_size><item_list>${items}</item_list></body>`
}

/**
 * La respuesta de Indumix como {variable: texto}. Se recorta el espacio del final ("PLASTIF " → "PLASTIF") y
 * "var not found" queda como null.
 */
export function leerRespuesta(xml) {
  const out = {}
  const re = /<i>\s*<n>([\s\S]*?)<\/n>\s*<v>([\s\S]*?)<\/v>\s*<\/i>/g
  let m
  while ((m = re.exec(String(xml ?? "")))) {
    const valor = desXml(m[2]).replace(/\s+$/, "")
    out[desXml(m[1]).trim()] = valor === "var not found" ? null : valor
  }
  return out
}

/** ¿Se puede escribir este valor en esta variable? Solo la lista cerrada, con enteros dentro del rango. */
export function escrituraPermitida(variable, valor) {
  if (!Object.prototype.hasOwnProperty.call(ESCRITURAS_PERMITIDAS, variable)) return false
  const [min, max] = ESCRITURAS_PERMITIDAS[variable]
  return Number.isInteger(valor) && valor >= min && valor <= max
}

/** La URL de la escritura ("…/cgi-bin/writeVal.exe?Receta.neReporte+3"). Tira error si no está permitida. */
export function urlEscritura(base, variable, valor) {
  if (!escrituraPermitida(variable, valor)) throw new Error(`Escritura no permitida: ${variable} = ${valor}`)
  return `${String(base).replace(/\/+$/, "")}${RUTA_ESCRIBIR}?${encodeURIComponent(variable)}+${valor}`
}

/** ¿Es una dirección IPv4 privada (10/8, 172.16/12, 192.168/16)? Indumix tiene que estar en la red de la planta. */
export function esIpPrivada(host) {
  const m = String(host ?? "").match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const [a, b, c, d] = m.slice(1).map(Number)
  if ([a, b, c, d].some((x) => x > 255)) return false
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/** La dirección de Indumix de config.json, controlada: http y una IPv4 privada, sin ruta ni usuario. */
export function baseIndumix(texto) {
  let u
  try { u = new URL(String(texto ?? "")) } catch { throw new Error(`La dirección de Indumix no se entiende: ${texto}`) }
  if (u.protocol !== "http:" || !esIpPrivada(u.hostname) || u.username || u.password || (u.pathname && u.pathname !== "/") || u.search)
    throw new Error(`La dirección de Indumix tiene que ser http://<IP privada> (por ejemplo http://192.168.0.10), no ${texto}`)
  return `http://${u.host}`
}

/** El puente habla solo con Indumix y con nuestro servidor: cualquier otra dirección tira error antes de salir. */
export function direccionPermitida(url, base) {
  let u
  try { u = new URL(url) } catch { return false }
  if (u.origin === SERVIDOR) return true
  return !!base && u.origin === base && (u.pathname === RUTA_LEER || u.pathname === RUTA_ESCRIBIR)
}
