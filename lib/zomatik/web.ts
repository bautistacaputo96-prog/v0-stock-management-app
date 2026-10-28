/**
 * Zomatik · dirección y LISTA CERRADA de rutas (sin imports: la usan el navegador, el servidor y las pruebas).
 *
 * Dos grupos:
 *   1. Solo lectura (Z0): login, sucursal, los buscadores de 7 listados, la ficha del cliente y el XLS del acopio.
 *      El 6.º es ESTAD R.COMPRA (remitos de compra de materia prima), para el control de ingresos (docs/control-ingresos-mp.md).
 *      El 7.º es INVENTARIO › MOVIMIENTOS STOCK, para el control de stock de MP (docs/control-stock-mp.md).
 *      Cualquier otra ruta (manage_*, grabar_*, generar_*, set_*, _get*…) se rechaza ANTES de salir.
 *   2. Nota de pedido (Z2, aparte): lo justo para generar y vaciar una NP como en la prueba del 22/10 (spec 23).
 *      Solo se habilita con la llave de la planta prendida (`zomatik_np_config.activo`): el cliente lo pide con
 *      `{ escrituraNp: true }`, que solo arma `lib/zomatik/np-servidor.ts` después de leer la llave en la base.
 */

/** Dirección de Zomatik para los links "Ver en Zomatik" (se abren con la sesión de cada uno en su navegador). */
export const ZOMATIK_WEB = "https://concretus.zomatik.com"

// ---------------------------------------------------------------------------
// 1. Solo lectura
// ---------------------------------------------------------------------------

const PROHIBIDO = /(^|\/)(manage_|grabar_|generar_|set_|_get|_validar|_traer|eliminar|borrar|anular|modificar_(?!clientes\.php\?codigo=\d+$))/i

/** Los únicos listados que se leen (buscador por GET y búsqueda/export por POST `?enviado=1`). */
export const LISTADOS = ["listado_clientes.php", "listado_articulos.php", "reporte_remitosventa.php", "listado_proyectos.php", "listado_pedidos.php", "reporte_remitoscompra.php", "reporte_movimientosdestock.php"] as const

/** ¿Se puede pedir esta ruta en solo lectura? `metodo` POST solo para login, sucursal y buscadores (`?enviado=1`). */
export function rutaPermitida(path: string, metodo: "GET" | "POST"): boolean {
  const p = path.replace(/^\/+/, "")
  if (PROHIBIDO.test(p)) return false
  const listados = LISTADOS as readonly string[]
  if (metodo === "POST") {
    if (p === "index.php?a=1" || p === "home.php") return true
    const m = p.match(/^([a-z_]+\.php)\?enviado=1$/i)
    return !!m && listados.includes(m[1].toLowerCase())
  }
  if (p === "home.php") return true
  if (listados.includes(p.toLowerCase())) return true
  if (/^modificar_clientes\.php\?codigo=\d+$/i.test(p)) return true
  if (/^exportar_acopio\.php\?acopio=\d+$/i.test(p)) return true
  // Los export redirigen al archivo generado (output/<listado>.xlsx): solo el de los listados de arriba
  const salida = p.match(/^output\/([a-z_]+)\.xlsx$/i)
  if (salida) return [...listados, "exportar_acopio.php"].includes(`${salida[1].toLowerCase()}.php`)
  return false
}

/** Pasa un `Location` de Zomatik a ruta relativa (o null si va a otro sitio). */
export function rutaDeLocation(location: string, desde: string): string | null {
  try {
    const u = new URL(location, `${ZOMATIK_WEB}/${desde.replace(/^\/+/, "")}`)
    if (u.origin !== new URL(ZOMATIK_WEB).origin) return null
    return `${u.pathname.replace(/^\/+/, "")}${u.search}`
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 2. Nota de pedido (Z2): grupo aparte, solo con la llave prendida
// ---------------------------------------------------------------------------

/** Comprobantes de NP que puede pedir el robot: 15 Nota de Pedido, 16 Nota de Pedido 2 (spec 5.2). */
export const COMPROBANTES_NP = ["15", "16"] as const

/** Parámetros de `manage_pedidos.php` que el robot nunca manda (autorizar ítems, acciones en lote). */
const MANAGE_PROHIBIDO = /[?&](fautorizar|faccion|fitems)=/i

/**
 * Rutas de la NP (spec 4.2, 20.5 y 23). Cada una con su forma exacta:
 *   GET  modificar_pedidos.php                       alta vacía (trae `pedidos_unico`)
 *   GET  modificar_pedidos.php?proyecto=N&tipo=1     botón MATERIAL de un proyecto
 *   GET  modificar_pedidos.php?codigo=N              abrir una NP (verificar la marca, vaciarla)
 *   GET  traerdatossecundarios.php?fcliente=N…       datos del cliente que copia el formulario (vendedor, CUIT…)
 *   GET  _getnumerofactura.php?fcomprobante=15|16…   el próximo número (se valida que sea de la serie de REBUCRET)
 *   GET  listado_listas.php                          listas de precios (la activa "en 1" / "en 2")
 *   GET  manage_pedidos.php?pedidos_unico=…          Continuar, agregar artículo y borrar renglón (fborrar)
 *   POST grabar_pedidos.php?codigo=N                 Grabar (0 = nueva)
 */
export function rutaEscrituraNp(path: string, metodo: "GET" | "POST"): boolean {
  const p = path.replace(/^\/+/, "")
  if (metodo === "POST") return /^grabar_pedidos\.php\?codigo=\d+$/i.test(p)
  if (/^modificar_pedidos\.php$/i.test(p)) return true
  if (/^modificar_pedidos\.php\?proyecto=\d+&tipo=1$/i.test(p)) return true
  if (/^modificar_pedidos\.php\?codigo=\d+$/i.test(p)) return true
  if (/^traerdatossecundarios\.php\?fcliente=\d+(&rnd=\d+)?$/i.test(p)) return true
  if (/^_getnumerofactura\.php\?fcomprobante=(15|16)(&rnd=\d+)?$/i.test(p)) return true
  if (/^listado_listas\.php$/i.test(p)) return true
  if (/^manage_pedidos\.php\?/i.test(p)) return /[?&]pedidos_unico=\d+/.test(p) && !MANAGE_PROHIBIDO.test(p)
  return false
}

/** Link "Ver en Zomatik" de una NP. */
export function linkNp(codigo: number | null | undefined): string | null {
  return codigo && codigo > 0 ? `${ZOMATIK_WEB}/modificar_pedidos.php?codigo=${codigo}` : null
}
