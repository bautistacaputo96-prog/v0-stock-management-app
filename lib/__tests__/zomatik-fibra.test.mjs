// Pruebas de la fibra en la NP (docs/specs/2026-11-25-fibra-en-np.md): el tope y las bolsitas (lib/fibra.ts), el
// renglón de MACRO FIBRA en la NP nueva y en la de proyecto, la edición / ajuste con dos renglones y la fibra del
// remito. Navegador SIMULADO con los fixtures de lib/__fixtures__/zomatik-np y zomatik-ajuste: el renglón de la fibra
// se arma copiando el renglón REAL del 28/10 con otro id, código (10099016), nombre y precio (a confirmar con una
// captura real del detalle con MACRO FIBRA). Sin red ni base: nunca se llama a Zomatik.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as F from "../fibra.ts"
import * as N from "../zomatik/np.ts"
import * as R from "../zomatik/np-robot.ts"
import * as Z1R from "../zomatik/z1-robot.ts"
import * as W from "../zomatik/web.ts"

const fx = (f) => readFileSync(new URL(`../__fixtures__/zomatik-np/${f}`, import.meta.url), "latin1")
const fxA = (f) => readFileSync(new URL(`../__fixtures__/zomatik-ajuste/${f}`, import.meta.url), "latin1")
const latin1 = (u8) => Buffer.from(u8).toString("latin1")
const HOY = "2026-10-23"
const PEDIDO = "1a2b3c4d-0000-4000-8000-000000000001"
const MARCA = N.marcaNp(PEDIDO, 1)
const resp = (html, status = 200, location = null) => ({ status, location, html })
const lst = (suc, html) => resp(`<form method="post" action="" name="frm_selsuc"><select name="selsuc"><option value="${suc}" selected>S</option></select></form>${html}`)
const campo = (cuerpo, n) => cuerpo.match(new RegExp(`name="${n}"\\r\\n\\r\\n([^\\r]*)\\r\\n`))?.[1]

/** Copia el primer renglón del detalle como renglón de MACRO FIBRA (otro id, código, nombre, costo y cantidad). */
function renglonFibra(html, { de, id, cant = "0.000", costo = "25000.000" }) {
  const tr = html.match(/<tr>\s*<td class="itemformulario" >[\s\S]*?<\/tr>/)[0]
  return tr
    .replaceAll(de, id)
    .replace(/\d{8}(\s*<\/td>)/, "10099016$1")
    .replace(/(<td class="itemformulario">\s*)[^&<]+(&nbsp;)/, "$1MACRO FIBRA$2")
    .replace(/(name="hcosto\d+"[^>]*value=")[^"]*"/, `$1${costo}"`)
    .replace(/(name="costo\d+"[^>]*value=")[^"]*"/, `$1${costo}"`)
    .replace(/(name="cantidad\d+"[^>]*value=")[^"]*"/, `$1${cant}"`)
}
/** El detalle con el renglón de la fibra agregado después del primero. */
const conFibra = (html, o) => html.replace(/(<tr>\s*<td class="itemformulario" >[\s\S]*?<\/tr>)/, (x) => x + renglonFibra(html, o))

function navFalso(rutas, permitida) {
  const nav = {
    suc: "18",
    llamadas: [],
    async sucursal(id) { nav.llamadas.push({ m: "SUC", ruta: id }); nav.suc = id; return true },
    async get(ruta) { return responder("GET", ruta, null) },
    async post(ruta, cuerpo, tipo) { return responder("POST", ruta, cuerpo ? latin1(cuerpo) : "", tipo) },
  }
  async function responder(m, ruta, cuerpo, tipo) {
    const ll = { m, ruta, suc: nav.suc, cuerpo, tipo }
    nav.llamadas.push(ll)
    assert.ok(permitida(ruta, m), `ruta fuera de la lista cerrada: ${m} ${ruta}`)
    const r = rutas.find(([mm, re]) => mm === m && re.test(ruta))
    if (!r) throw new Error(`ruta no simulada: ${m} ${ruta}`)
    return r[2]({ ruta, cuerpo, suc: nav.suc, nav })
  }
  return nav
}
const navNp = (rutas) => navFalso(rutas, (ruta, m) => W.rutaEscrituraNp(ruta, m) || W.rutaPermitida(ruta, m))
const opts = (extra = {}) => ({ hoy: HOY, azar: () => 7, boundary: "XX", ...extra })
const grabados = (nav) => nav.llamadas.filter((l) => l.m === "POST" && /^grabar_pedidos/.test(l.ruta))

// ===========================================================================
// 1. Tope y bolsitas (lib/fibra.ts)
// ===========================================================================

test("tope: hasta 20 kg/m³; 800 kg/m³ (el H17 de La Tercera del 24/11) no se deja; vacío = no lleva", () => {
  assert.equal(F.FIBRA_MAX_KG_M3, 20)
  assert.equal(F.errorFibraKgM3(""), null)
  assert.equal(F.errorFibraKgM3("0"), null)
  assert.equal(F.errorFibraKgM3("0,8"), null)
  assert.equal(F.errorFibraKgM3(20), null)
  assert.match(F.errorFibraKgM3("800"), /800 kg de fibra por m³ es demasiado.*como mucho 20/)
  assert.match(F.errorFibraKgM3("20,5"), /demasiado/)
  assert.match(F.errorFibraKgM3("-1"), /tiene que ser un número/)
  assert.match(F.errorFibraKgM3("abc"), /tiene que ser un número/)
  assert.equal(F.fibraKgM3("0,8"), 0.8)
  assert.equal(F.fibraKgM3(""), 0)
  assert.equal(F.fibraValida(0.8), true)
  assert.equal(F.fibraValida(0), false)
  assert.equal(F.fibraValida(800), false)
})

test("bolsitas de 800 g: 0,8 kg/m³ × 8 m³ = 6,4 kg = 8 bolsitas; si no da entero, el número exacto", () => {
  assert.equal(F.BOLSITA_FIBRA_KG, 0.8)
  assert.equal(F.kgDeFibra(0.8, 8), 6.4)
  assert.equal(F.bolsitasDe(6.4), 8)
  assert.equal(F.textoBolsitas(6.4), "8 bolsitas")
  assert.equal(F.textoBolsitas(0.8), "1 bolsita")
  assert.equal(F.textoBolsitas(6), "7,5 bolsitas")
  assert.equal(F.textoBolsitas(1), "1,25 bolsitas")
  assert.equal(F.textoFibraCamion(0.8, 8), "6,4 kg = 8 bolsitas")
  assert.equal(F.textoFibraCamion(0, 8), "")
  assert.equal(F.fibraObjetivo(16, 8, 6), 12)
  assert.equal(F.fibraObjetivo(0, 8, 6), 0)
})

// ===========================================================================
// 2. NP nueva con fibra
// ===========================================================================

const FIBRA = { codigo: 10099016, codigoSistema: 1000099016, nombre: "MACRO FIBRA", kgM3: 2, kg: 16, precios: { 10247: 25000 } }

function zomatikNueva() {
  const estado = { grabadaEn: null, fibraAgregada: null }
  const rutas = [
    ["GET", /^modificar_pedidos\.php$/, () => resp(fx("alta.html"))],
    ["GET", /^traerdatossecundarios\.php\?fcliente=15893/, () => resp(fx("secundarios.txt"))],
    ["GET", /^listado_listas\.php$/, () => resp(fx("listas.html"))],
    // Agregar la fibra: Zomatik devuelve el borrador con los dos renglones (el del hormigón como lo trae por defecto)
    ["GET", /^manage_pedidos\.php\?.*farticulo=1000099016/, ({ ruta }) => ((estado.fibraAgregada = ruta), resp(conFibra(fx("detalle-articulo.html"), { de: "5349423", id: "5349999" })))],
    ["GET", /^manage_pedidos\.php\?.*farticulo=1000015959/, () => resp(fx("detalle-articulo.html"))],
    ["GET", /^manage_pedidos\.php\?/, () => resp(fx("detalle-vacio.html"))],
    ["GET", /^_getnumerofactura\.php\?fcomprobante=15/, () => resp("0001-00001176")],
    ["POST", /^grabar_pedidos\.php\?codigo=0$/, ({ suc }) => ((estado.grabadaEn = suc), resp("", 302, "listado_pedidos.php"))],
    ["GET", /^listado_pedidos\.php$/, () => resp(fx("listado-buscador.html"))],
    ["POST", /^listado_pedidos\.php\?enviado=1$/, ({ cuerpo, suc }) => lst(suc, fx(/bus_numero=0001-00001176/.test(cuerpo) && estado.grabadaEn === "18" ? "listado-1176.html" : "listado-vacio.html"))],
    ["GET", /^modificar_pedidos\.php\?codigo=157704$/, () => resp(fx("np-abierta.html").replaceAll("{{CODIGO}}", "157704").replace("{{OBS}}", MARCA).replace("{{NUMERO}}", "0001-00001176").replace("{{RENGLONES}}", fx("renglon-np.html")))],
  ]
  return { rutas, estado }
}
const datosNueva = (extra = {}) => ({
  marca: MARCA, tipo: "nueva", comprobante: "15", clienteCodigo: 15893, clienteNombre: "OBRA PROPIA REBUCRET", deposito: 116,
  fecha: HOY, m3: 8, articuloCodigoSistema: 1000015959, articuloCodigo: 10090020, articuloNombre: "H21-620-10 C (CAN)", proyectoCodigo: null,
  entrega: "Obra: Planta", buscarAntes: false, fibra: FIBRA, ...extra,
})

test("NP nueva con fibra: segundo renglón de MACRO FIBRA con kg/m³ × m³ y el precio por kg de la copia de la lista", async () => {
  const z = zomatikNueva()
  const nav = navNp(z.rutas)
  const pasos = []
  const r = await R.generarNp(nav, datosNueva(), opts({ alPaso: (p) => pasos.push(p) }))
  assert.equal(r.estado, "ok", r.mensaje)
  assert.equal(r.fibraKg, 16)
  assert.equal(r.fibraPrecio, 25000)
  assert.deepEqual(pasos, ["formulario", "cliente", "lista", "continuar", "articulo", "fibra", "numero", "grabar", "verificar"])
  // La fibra se agrega como "agregar artículo", con el renglón del hormigón (8 m³) en fparam
  assert.match(z.estado.fibraAgregada, /fparam=5349423%2C176500\.000%2C8%2C%7C%7C%7C/)
  const g = grabados(nav)[0].cuerpo
  assert.equal(campo(g, "cantidad5349423"), "8")
  assert.equal(campo(g, "costo5349423"), "176500.000")
  assert.equal(campo(g, "cantidad5349999"), "16")
  assert.equal(campo(g, "costo5349999"), "25000")
  assert.equal(campo(g, "fparam"), "5349423,176500.000,8,|||5349999,25000,16,|||")
  assert.equal(grabados(nav).length, 1)
})

test("NP nueva con fibra: sin precio en la copia de la lista → error con qué hacer (Exportar en Lista de Precios: Sí), sin grabar", async () => {
  const z = zomatikNueva()
  const nav = navNp(z.rutas)
  const r = await R.generarNp(nav, datosNueva({ fibra: { ...FIBRA, precios: { 10252: 24000 } } }), opts())
  assert.equal(r.estado, "error")
  assert.equal(r.reintentar, false)
  assert.ok(r.mensaje.startsWith(N.MSJ_SIN_PRECIO_FIBRA))
  assert.match(r.mensaje, /MACRO FIBRA.*Exportar en Lista de Precios: Sí.*Actualizar/)
  assert.doesNotMatch(r.mensaje, /\$|25\.?000/) // sin montos
  assert.equal(z.estado.fibraAgregada, null)
  assert.equal(grabados(nav).length, 0)
  assert.equal(nav.llamadas.some((l) => /_getnumerofactura/.test(l.ruta)), false)
})

test("NP con fibra fuera del tope (800 kg/m³): error antes de tocar Zomatik", async () => {
  const nav = navNp([])
  const r = await R.generarNp(nav, datosNueva({ fibra: { ...FIBRA, kgM3: 800, kg: 6400 } }), opts())
  assert.equal(r.estado, "error")
  assert.match(r.mensaje, /800 kg\/m³.*tope de 20/)
  assert.equal(nav.llamadas.length, 0)
})

test("NP con fibra: el artículo de la fibra sin código de sistema (no está en la copia de artículos) → error, sin grabar", async () => {
  const z = zomatikNueva()
  const nav = navNp(z.rutas)
  const r = await R.generarNp(nav, datosNueva({ fibra: { ...FIBRA, codigoSistema: null } }), opts())
  assert.equal(r.estado, "error")
  assert.match(r.mensaje, /10099016.*copia de artículos/)
  assert.equal(grabados(nav).length, 0)
})

test("NP nueva con fibra: si el detalle no trae los dos renglones, no se graba (con recorte)", async () => {
  const z = zomatikNueva()
  z.rutas.unshift(["GET", /^manage_pedidos\.php\?.*farticulo=1000099016/, () => resp(fx("detalle-articulo.html"))])
  const nav = navNp(z.rutas)
  const r = await R.generarNp(nav, datosNueva(), opts())
  assert.equal(r.estado, "error")
  assert.match(r.mensaje, /al agregar MACRO FIBRA el detalle trajo 1 renglones/)
  assert.ok(r.recorte)
  assert.equal(grabados(nav).length, 0)
})

test("NP nueva sin fibra: igual que siempre (un renglón, sin el paso de la fibra)", async () => {
  const z = zomatikNueva()
  const nav = navNp(z.rutas)
  const pasos = []
  const r = await R.generarNp(nav, datosNueva({ fibra: null }), opts({ alPaso: (p) => pasos.push(p) }))
  assert.equal(r.estado, "ok", r.mensaje)
  assert.equal(r.fibraKg, null)
  assert.equal(pasos.includes("fibra"), false)
  assert.equal(campo(grabados(nav)[0].cuerpo, "fparam"), "5349423,176500.000,8,|||")
})

// ===========================================================================
// 3. NP de proyecto con fibra
// ===========================================================================

function zomatikProyecto({ conFibraEnProyecto = true, kgProyecto = "100.000" } = {}) {
  const estado = { grabada: false }
  const marcaP = N.marcaNp(PEDIDO, 1)
  const f = (h) => (conFibraEnProyecto ? conFibra(h, { de: "5349501", id: "5349503", cant: kgProyecto, costo: "23000.000" }) : h)
  return {
    estado,
    rutas: [
      ["GET", /^modificar_pedidos\.php\?proyecto=576&tipo=1$/, () => resp(fx("material.html"))],
      ["GET", /^manage_pedidos\.php\?.*fborrar=5349502/, () => resp(f(fx("detalle-proyecto-1.html")))],
      ["GET", /^manage_pedidos\.php\?.*fproyecto=576.*forigen=3/, () => resp(f(fx("detalle-proyecto.html")))],
      ["GET", /^_getnumerofactura\.php\?fcomprobante=16&/, () => resp("0001-00002081")],
      ["POST", /^grabar_pedidos\.php\?codigo=0$/, ({ suc }) => ((estado.grabada = suc), resp("", 302, "listado_pedidos.php"))],
      ["GET", /^listado_pedidos\.php$/, () => resp(fx("listado-buscador.html"))],
      ["POST", /^listado_pedidos\.php\?enviado=1$/, ({ suc }) => lst(suc, fx(estado.grabada === suc ? "listado-hoy-proyecto.html" : "listado-vacio.html"))],
      ["GET", /^modificar_pedidos\.php\?codigo=157708$/, () => resp(fx("np-abierta.html").replaceAll("{{CODIGO}}", "157708").replace("{{OBS}}", `Barrio etapa 2 - ${marcaP}`).replace("{{NUMERO}}", "0001-00002081").replace("{{RENGLONES}}", fx("renglon-np.html")))],
    ],
  }
}
const datosProyecto = (extra = {}) => datosNueva({ tipo: "proyecto", comprobante: null, proyectoCodigo: 576, articuloCodigoSistema: 1000016666, articuloCodigo: 10090027, articuloNombre: "H30-620-10 C (CAN)", m3: 24, fibra: { ...FIBRA, kg: 48, precios: {} }, ...extra })

test("NP de proyecto con fibra: queda el renglón de MACRO FIBRA del proyecto (con su precio) y se saca el otro", async () => {
  const z = zomatikProyecto()
  const nav = navNp(z.rutas)
  const r = await R.generarNp(nav, datosProyecto(), opts())
  assert.equal(r.estado, "ok", r.mensaje)
  assert.equal(r.fibraKg, 48)
  assert.equal(r.fibraPrecio, 23000)
  const g = grabados(nav)[0].cuerpo
  assert.equal(campo(g, "cantidad5349501"), "24")
  assert.equal(campo(g, "cantidad5349503"), "48")
  assert.equal(campo(g, "costo5349503"), "23000.000") // el del proyecto: no se toca
  assert.equal(campo(g, "cantidad5349502"), undefined)
})

test("NP de proyecto con fibra: el proyecto no la tiene → error con qué hacer, sin grabar", async () => {
  const nav = navNp(zomatikProyecto({ conFibraEnProyecto: false }).rutas)
  const r = await R.generarNp(nav, datosProyecto(), opts())
  assert.equal(r.estado, "error")
  assert.match(r.mensaje, /El proyecto no tiene MACRO FIBRA/)
  assert.equal(grabados(nav).length, 0)
})

test("NP de proyecto con fibra: al proyecto le quedan menos kg → error, sin grabar", async () => {
  const nav = navNp(zomatikProyecto({ kgProyecto: "30.000" }).rutas)
  const r = await R.generarNp(nav, datosProyecto(), opts())
  assert.equal(r.estado, "error")
  assert.match(r.mensaje, /le quedan 30 kg de MACRO FIBRA.*48 kg/)
  assert.equal(grabados(nav).length, 0)
})

// ===========================================================================
// 4. Edición / ajuste de una NP con fibra (el mismo robot: ajustarCantidadNp)
// ===========================================================================

const COD = 157704
const MARCA_NP = N.marcaNp(PEDIDO, 1)
const PRECIO_H = 176500
const PRECIO_F = 25000
const filaListado = (total) => `<tr height="20"><td class="itemlistado"><a href="modificar_pedidos.php?codigo=${COD}">2026-11-06</a></td><td></td><td class="itemlistado"><a href="modificar_pedidos.php?codigo=${COD}">NP 0001-00001176</a></td><td></td><td class="itemlistado"><a href="modificar_pedidos.php?codigo=${COD}">SANTA RITA</a></td><td></td><td class="itemlistado" align="right"><a href="modificar_pedidos.php?codigo=${COD}">$ ${Math.round(total).toLocaleString("de-DE")}</a></td><td class="itemlistado"><b>PEN</b></td></tr>`

function zomatikAjuste({ cant = 8, kg = 16, sinFibra = false, grabaFibra = true } = {}) {
  const estado = { cant, kg, grabados: [] }
  const texto = (n) => N.cantidadTexto(n) + (String(n).includes(".") ? "" : ".000")
  const detalle = () => {
    const h = fxA("detalle-np.html").replace("{{CANT}}", texto(estado.cant)).replace("{{TOTAL}}", "x")
    return sinFibra ? h : conFibra(h, { de: "5349424", id: "5349425", cant: texto(estado.kg), costo: "25000.000" })
  }
  return {
    estado,
    rutas: [
      ["GET", /^modificar_pedidos\.php\?codigo=157704$/, () => resp(fx("np-abierta.html").replaceAll("{{CODIGO}}", String(COD)).replace("{{OBS}}", MARCA_NP).replace("{{NUMERO}}", "0001-00001176").replace("{{RENGLONES}}", ""))],
      ["GET", /^manage_pedidos\.php\?/, () => resp(detalle())],
      ["POST", /^grabar_pedidos\.php\?codigo=157704$/, ({ cuerpo }) => {
        estado.grabados.push(cuerpo)
        estado.cant = Number(campo(cuerpo, "cantidad5349424"))
        if (grabaFibra && campo(cuerpo, "cantidad5349425") !== undefined) estado.kg = Number(campo(cuerpo, "cantidad5349425"))
        return resp("", 302, "listado_pedidos.php")
      }],
      ["GET", /^listado_pedidos\.php$/, () => resp(fx("listado-buscador.html"))],
      ["POST", /^listado_pedidos\.php\?enviado=1$/, ({ suc }) => lst(suc, `<table>${filaListado(estado.cant * PRECIO_H + (sinFibra ? 0 : estado.kg * PRECIO_F))}</table>`)],
      ["GET", /^_comprobantes\.php\?ftarget=pedidos&ftargetid=157704(&rnd=\d+)?$/, () => resp(fxA("comprobantes-sin-nada.html"))],
    ],
  }
}
const navAj = (rutas) => navFalso(rutas, (ruta, m) => W.rutaEscrituraAjuste(ruta, m, COD) || W.rutaPermitida(ruta, m))
const datosAj = (extra = {}) => ({
  codigo: COD, numero: "NP 0001-00001176", marca: MARCA_NP, articuloCodigo: 10090020, articuloNombre: "H21-620-10 C (CAN)", m3Np: 8, objetivo: 6, cortado: false,
  fibra: { codigo: 10099016, nombre: "MACRO FIBRA", kgNp: 16, kgObjetivo: 12 }, ...extra,
})

test("ajuste con fibra: la NP pasa de 8 a 6 m³ y la fibra de 16 a 12 kg, en un solo Grabar; el total cierra con los dos renglones", async () => {
  const z = zomatikAjuste()
  const nav = navAj(z.rutas)
  const r = await R.ajustarCantidadNp(nav, datosAj(), opts())
  assert.equal(r.estado, "ok", r.mensaje)
  assert.equal(r.fibraKg, 12)
  assert.equal(z.estado.grabados.length, 1)
  const g = z.estado.grabados[0]
  assert.equal(campo(g, "cantidad5349424"), "6")
  assert.equal(campo(g, "cantidad5349425"), "12")
  assert.equal(campo(g, "fparam"), "5349424,176500.000,6,|||5349425,25000.000,12,|||")
})

test("ajuste con fibra: si la fibra no quedó (Zomatik no la grabó), revisar", async () => {
  const z = zomatikAjuste({ grabaFibra: false })
  const r = await R.ajustarCantidadNp(navAj(z.rutas), datosAj(), opts())
  assert.equal(r.estado, "revisar")
})

test("ajuste con fibra: la fibra cambió en Zomatik (no es la que cree el sistema) → revisar sin grabar", async () => {
  const z = zomatikAjuste({ kg: 20 })
  const r = await R.ajustarCantidadNp(navAj(z.rutas), datosAj(), opts())
  assert.equal(r.estado, "revisar")
  assert.match(r.mensaje, /La fibra de la NP cambió en Zomatik \(tiene 20 kg y el sistema esperaba 16\)/)
  assert.equal(z.estado.grabados.length, 0)
})

test("ajuste con fibra: el sistema espera fibra y la NP no tiene el renglón → revisar sin grabar", async () => {
  const z = zomatikAjuste({ sinFibra: true })
  const r = await R.ajustarCantidadNp(navAj(z.rutas), datosAj(), opts())
  assert.equal(r.estado, "revisar")
  assert.match(r.mensaje, /no tiene el renglón de MACRO FIBRA/)
  assert.equal(z.estado.grabados.length, 0)
})

test("ajuste SIN fibra en el sistema y la NP con dos renglones: como antes, revisar (no se toca)", async () => {
  const z = zomatikAjuste()
  const r = await R.ajustarCantidadNp(navAj(z.rutas), datosAj({ fibra: null }), opts())
  assert.equal(r.estado, "revisar")
  assert.match(r.mensaje, /La NP tiene 2 renglones/)
  assert.equal(z.estado.grabados.length, 0)
})

test("ajuste con fibra: ya está en el objetivo (hormigón y fibra) → ok sin grabar; la fibra fuera del tope → revisar", async () => {
  const z = zomatikAjuste({ cant: 6, kg: 12 })
  const r = await R.ajustarCantidadNp(navAj(z.rutas), datosAj({ cortado: true }), opts())
  assert.equal(r.estado, "ok", r.mensaje)
  assert.equal(r.yaEstaba, true)
  assert.equal(z.estado.grabados.length, 0)
  const z2 = zomatikAjuste()
  const r2 = await R.ajustarCantidadNp(navAj(z2.rutas), datosAj({ fibra: { codigo: 10099016, nombre: "MACRO FIBRA", kgNp: 16, kgObjetivo: 4800 } }), opts())
  assert.equal(r2.estado, "revisar")
  assert.match(r2.mensaje, /tope de 20/)
  assert.equal(z2.estado.grabados.length, 0)
})

// ===========================================================================
// 5. La fibra del remito (la cargada de verdad en los camiones)
// ===========================================================================

test("remito: la fibra cargada va en el renglón de la fibra; lo que no entra no frena el remito y queda el aviso", () => {
  const it = (pendiente, extra = {}) => ({ pendiente, stock: 0, sinControlStock: true, ...extra })
  const f = { nombre: "MACRO FIBRA", kg: 6.4 }
  assert.deepEqual(Z1R.fibraDelRemito([it(16)], f, 8, 116), { kg: 6.4, item: 0, aviso: null })
  // más que lo pendiente: va lo pendiente y el aviso con lo que falta
  const mas = Z1R.fibraDelRemito([it(4)], f, 8, 116)
  assert.equal(mas.kg, 4)
  assert.match(mas.aviso, /6,4 kg de MACRO FIBRA.*le quedaban 4 kg: faltan 2,4 kg/)
  // la NP no tiene el renglón de la fibra
  const sin = Z1R.fibraDelRemito([], f, 8, 116)
  assert.equal(sin.kg, 0)
  assert.match(sin.aviso, /La NP no tiene el renglón de MACRO FIBRA/)
  // con control de stock y sin stock: no va
  const st = Z1R.fibraDelRemito([it(16, { sinControlStock: false, stock: 0 })], f, 8, 116)
  assert.equal(st.kg, 0)
  assert.match(st.aviso, /No hay stock de MACRO FIBRA/)
  // fuera del tope (800 kg/m³ cargados): no va
  const tope = Z1R.fibraDelRemito([it(10000)], { nombre: "MACRO FIBRA", kg: 6400 }, 8, 116)
  assert.equal(tope.kg, 0)
  assert.match(tope.aviso, /tope de 20/)
  // sin fibra cargada: nada
  assert.deepEqual(Z1R.fibraDelRemito([it(16)], { nombre: "MACRO FIBRA", kg: 0 }, 8, 116), { kg: 0, item: null, aviso: null })
})

test("subtotal de los renglones (para ver que el total de la NP quedó en proporción)", () => {
  assert.equal(N.subtotalRenglones([{ costo: "176500.000", cantidad: "8" }, { costo: "25000", cantidad: "16" }]), 8 * 176500 + 16 * 25000)
  assert.equal(N.subtotalRenglones([{ costo: "", cantidad: "8" }]), null)
})
