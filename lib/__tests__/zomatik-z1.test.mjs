// Pruebas de Zomatik Z1 (docs/migracion-loop/zomatik.md, sección 26): qué remitos lleva un pedido en un día, el número
// del remito, y el robot de la OF y el remito con un navegador SIMULADO (lib/__fixtures__/zomatik-z1: armadas con las
// capturas del 29/10; la lista de la OF, supuesta). Nunca se llama a Zomatik.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as Z from "../zomatik/z1.ts"
import * as R from "../zomatik/z1-robot.ts"
import * as W from "../zomatik/web.ts"
import * as S from "../zomatik/z1-servidor.ts"
import * as N from "../zomatik/np.ts"

const fx = (f) => readFileSync(new URL(`../__fixtures__/zomatik-z1/${f}`, import.meta.url), "latin1")
const latin1 = (u8) => Buffer.from(u8).toString("latin1")
const resp = (html, status = 200, location = null) => ({ status, location, html })
const conSuc = (suc, html) => resp(`<form method="post" action="" name="frm_selsuc"><select name="selsuc"><option value="${suc}" selected>S</option></select></form>${html}`)
const HOY = "2026-10-31"
const PED = "1a2b3c4d-0000-4000-8000-000000000001"
const MARCA = Z.marcaZ1(PED, HOY, 1)

function navFalso(rutas, { alLlamar } = {}) {
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
    alLlamar?.(ll, nav)
    assert.ok(W.rutaEscrituraZ1(ruta, m) || W.rutaPermitida(ruta, m), `ruta fuera de la lista cerrada: ${m} ${ruta}`)
    const r = rutas.find(([mm, re]) => mm === m && re.test(ruta))
    if (!r) throw new Error(`ruta no simulada: ${m} ${ruta}`)
    return r[2]({ ruta, cuerpo, suc: nav.suc, nav })
  }
  return nav
}
const grabados = (nav, que) => nav.llamadas.filter((l) => l.m === "POST" && new RegExp(`^grabar_${que}`).test(l.ruta))
const opts = (extra = {}) => ({ hoy: HOY, azar: () => 7, boundary: "XX", ...extra })

// ── Qué remitos lleva un pedido en un día ──
const desp = (id, m3, extra = {}) => ({ id, m3, remito: `R-${id}`, remito_tipo: "X", patente: `AB${id}`, formula_id: "f1", plant_id: "can", created_at: `2026-10-31T1${id}:00:00Z`, ...extra })
const np = (extra = {}) => ({ np_id: "np1", n: 1, estado: "ok", numero: "NP2 0001-00002086", zomatik_codigo: 157767, formula_id: "f1", plant_id: "can", m3_uso: 24, ...extra })

test("plan: un remito por pedido, día y NP, con la patente del primer camión y todas en observaciones (17.1)", () => {
  const p = Z.planificarRemitos([desp("1", 8), desp("2", 8), desp("3", 8)], [np()], new Set())
  assert.equal(p.remitos.length, 1)
  assert.equal(p.remitos[0].comprobante, "19") // NP2 → RM2
  assert.equal(p.remitos[0].m3, 24)
  assert.equal(p.remitos[0].patente, "AB1")
  assert.equal(p.remitos[0].patentes, "AB1, AB2, AB3")
  assert.equal(p.remitos[0].remitos_papel, "R-1, R-2, R-3")
  assert.deepEqual(p.problemas, [])
})

test("plan: dos NP (la segunda adicional) → dos remitos; lo ya remitido no vuelve a entrar", () => {
  const p = Z.planificarRemitos([desp("1", 8), desp("2", 8), desp("3", 4)], [np({ m3_uso: 16 }), np({ np_id: "np2", n: 2, numero: "NP2 0001-00002090", zomatik_codigo: 157800, m3_uso: 4 })], new Set(["1"]), new Map([["np1", 8]]))
  assert.deepEqual(p.remitos.map((r) => [r.np_id, r.m3, r.despachos.map((d) => d.id).join(",")]), [["np1", 8, "2"], ["np2", 4, "3"]])
})

test("plan: R/X, fórmula o planta distintos a la NP, o que no entra → problema, sin remito", () => {
  assert.match(Z.planificarRemitos([desp("1", 8, { remito_tipo: "R" })], [np()], new Set()).problemas[0], /no coincide/)
  assert.match(Z.planificarRemitos([desp("1", 8, { formula_id: "f2" })], [np()], new Set()).problemas[0], /no coincide/)
  assert.match(Z.planificarRemitos([desp("1", 30)], [np()], new Set()).problemas[0], /supera/)
  assert.match(Z.planificarRemitos([desp("1", 8)], [np({ estado: "pendiente" })], new Set()).problemas[0], /no tiene una NP en Zomatik/)
  assert.equal(Z.planificarRemitos([desp("1", 8)], [np()], new Set(["1"])).remitos.length, 0)
})

test("serie del remito: el mayor de su punto + 1 (RM 0001, RM2 0099); sin historia no se inventa", () => {
  const ns = ["RM2 0099-00002745", "RM2 0099-00002741", "RM 0001-00002338", "RM2 0001-00009999"]
  assert.equal(Z.siguienteNumeroRemito(ns, "19"), "0099-00002746")
  assert.equal(Z.siguienteNumeroRemito(ns, "7"), "0001-00002339")
  assert.equal(Z.siguienteNumeroRemito([], "7"), null)
  assert.equal(Z.comprobanteRemito("NP 0001-00001176"), "7")
  assert.equal(Z.comprobanteRemito("NP2 0001-00002086"), "19")
  assert.ok(/^[\x20-\x7e]+$/.test(MARCA))
})

// ── Robot de la OF ──
const filaOf = (codigo, numero, deposito, entrega, estado) => `<tr><td>2026-10-31</td><td></td><td><a href="modificar_ordenfabricacion.php?codigo=${codigo}">OF ${numero}</a></td><td></td><td>${deposito}</td><td>${entrega}</td><td>${estado}</td><td>Generar</td></tr>`
const listadoOf = (filas) => `<form action="listado_ordenfabricacion.php?enviado=1" method="POST" name="formulario"><input name="bus_numero" value=""><input name="bus_fechad" value=""><input name="bus_fechah" value=""><select name="bus_deposito"><option value="">-</option></select><input type="hidden" name="exportar" value="0"></form><table><tr><td>Fecha</td><td>Codigo</td><td>Deposito</td><td>Fecha Entrega</td><td>Remitido</td></tr>${filas}</table>`
const ofAbierta = (codigo, marca) => resp(`<form action="grabar_ordenfabricacion.php?codigo=${codigo}" name="frm_ordenfabricacion"><textarea name="observaciones">${marca}</textarea></form>`)

function zomatikOf({ manage = "of-manage.html", grabaMarca = MARCA, grabar } = {}) {
  const estado = { grabada: false }
  return {
    estado,
    rutas: [
      ["GET", /^modificar_ordenfabricacion\.php$/, () => resp(fx("of-alta.html"))],
      ["GET", /^manage_ordenfabricacion\.php\?.*farticulo=1000015959/, () => resp(fx(manage))],
      ["GET", /^listado_ordenfabricacion\.php$/, () => resp(listadoOf(""))],
      ["POST", /^listado_ordenfabricacion\.php\?enviado=1$/, ({ suc }) => conSuc(suc, listadoOf(filaOf(9001, "0001-00003391", "CANNING", "2026-10-30", "FIN") + (estado.grabada ? filaOf(9002, "0001-00003392", "CANNING", HOY, "PEN") : "")))],
      ["POST", /^grabar_ordenfabricacion\.php\?codigo=0$/, (c) => (grabar ? grabar(c, estado) : ((estado.grabada = true), resp("", 302, "listado_ordenfabricacion.php")))],
      ["GET", /^modificar_ordenfabricacion\.php\?codigo=9002$/, () => ofAbierta(9002, grabaMarca)],
    ],
  }
}
const datosOf = (extra = {}) => ({ marca: MARCA, deposito: 116, fecha: HOY, m3: 8, articuloCodigoSistema: 1000015959, articuloNombre: "H21-620-10 C (CAN)", foto: null, fotoDia: null, buscarAntes: false, ...extra })

test("OF: alta, artículo, foto, sucursal 18 antes de grabar, y una OF nueva PEN con la marca → ok", async () => {
  const z = zomatikOf()
  const pasos = []
  const nav = navFalso(z.rutas)
  const r = await R.generarOf(nav, datosOf(), opts({ alPaso: (p, extra) => pasos.push([p, extra]) }))
  assert.equal(r.estado, "ok", r.mensaje)
  assert.equal(r.numero, "OF 0001-00003392")
  assert.equal(r.codigo, 9002)
  // la foto de las OF de antes se guarda ANTES de grabar
  const g = pasos.find(([p]) => p === "grabar_of")
  assert.deepEqual(g[1].foto, ["0001-00003391"])
  const i = nav.llamadas.findIndex((l) => /^grabar_ordenfabricacion/.test(l.ruta))
  assert.deepEqual([nav.llamadas[i - 1].m, nav.llamadas[i - 1].ruta], ["SUC", "18"])
  const body = new URLSearchParams(nav.llamadas[i].cuerpo)
  assert.equal(body.get("deposito"), "116")
  assert.equal(body.get("fecha_entrega"), HOY)
  assert.equal(body.get("observaciones"), MARCA)
  assert.equal(body.get("fparam"), "14850,8|||") // lista real del 29/10: codigo14850 / cantidad14850
  assert.equal(body.get("cantidad14850"), null) // como Concretus: solo los campos del alta con fparam
  assert.match(nav.llamadas.find((l) => /^manage_ordenfabricacion/.test(l.ruta)).ruta, /^manage_ordenfabricacion\.php\?ordenfabricacion=0&fcomprobante=62&ordenfabricacion_unico=0138383001793301957&fdeposito=116&fparam=&farticulo=1000015959&fsubtipo=0&rnd=7$/)
  assert.equal(body.get("ordenfabricacion"), "0")
  assert.equal(body.get("comprobante"), "62")
})

test("OF: la lista trae otra cosa (2 renglones) → frena sin grabar y deja el recorte", async () => {
  const z = zomatikOf()
  z.rutas.unshift(["GET", /^manage_ordenfabricacion/, () => resp(fx("of-manage.html").replace("</table>", '<tr><td>1</td><td>X<input type="hidden" name="codigo14851" value="14851"></td><td><input name="cantidad14851" value="0"></td></tr></table>'))])
  const nav = navFalso(z.rutas)
  const r = await R.generarOf(nav, datosOf(), opts())
  assert.equal(r.estado, "error")
  assert.match(r.mensaje, /2 renglones/)
  assert.ok(r.recorte)
  assert.equal(grabados(nav, "ordenfabricacion").length, 0)
})

test("OF: después de grabar no aparece una nueva con la marca → 'revisar' (no se repite)", async () => {
  const z = zomatikOf({ grabaMarca: "otra cosa" })
  const nav = navFalso(z.rutas)
  const r = await R.generarOf(nav, datosOf(), opts())
  assert.equal(r.estado, "revisar")
  assert.equal(grabados(nav, "ordenfabricacion").length, 1)
})

test("OF: corte en Grabar → con la foto guardada se encuentra la OF y no se graba otra", async () => {
  const z = zomatikOf()
  z.estado.grabada = true
  const nav = navFalso(z.rutas)
  const r = await R.generarOf(nav, datosOf({ buscarAntes: true, foto: ["0001-00003391"] }), opts())
  assert.equal(r.estado, "ok", r.mensaje)
  assert.equal(grabados(nav, "ordenfabricacion").length, 0)
  // sin foto no se puede asegurar: revisar
  const r2 = await R.generarOf(navFalso(zomatikOf().rutas), datosOf({ buscarAntes: true, foto: null }), opts())
  assert.equal(r2.estado, "revisar")
})

// ── Robot del remito (alta, Continuar y validación capturados el 29/10) ──
const filaRm = (codigo, numero) => `<tr><td><a href="modificar_remitos.php?codigo=${codigo}">${numero}</a></td><td>AVANCES AMBIENTALES</td><td>Canning</td><td>2026-10-31</td><td>2026-10-31</td><td>REBUCRET</td><td>DEVOL | REM P</td></tr>`
// listado_remitos.php (prueba real 29/10): el HTML trae el buscador y los hidden del paginado, SIN filas; las filas las
// trae POST paginar_remitos.php con fsql = el hidden #sql tal cual
const buscadorRm = (extra = "") => `<form method="post" action="" name="frm_selsuc"><select name="selsuc"><option value="18" selected>R</option></select></form><form action="listado_remitos.php?enviado=1" method="POST" name="formulario"><input type="hidden" name="exportar" value="0"><input name="bus_numero" value=""><select name="bus_deposito"><option value="">--</option></select><select name="bus_sucursal"><option value="">--Sucursal--</option><option value="17">RUTA 25</option><option value="18">REBUCRET</option></select><input name="bus_fechad" value=""><input name="bus_fechah" value=""></form>${extra}<div id="listado"></div>`
// El #sql trae de todo: ">=" y "<>" crudos dentro de value="…", comillas simples, saltos de línea, tildes y entidades
const sqlPagina = (b) => `select distinct SQL_CALC_FOUND_ROWS suc.nombre as nsuc, r.codigo\n from remitos r where r.sucursal = ${b.get("bus_sucursal")} and r.fecha >= '${b.get("bus_fechad")}' and r.fecha < &#039;${b.get("bus_fechah")}&#39;\r\n and o.nombre <> 'Año &aacute; &amp; b' and c.abreviatura &lt;&gt; &quot;x&quot; order by r.codigo desc`
const decod = (t) => t.replace(/&#0*39;/g, "'").replace(/&aacute;/g, "á").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
const listadoRm = (filas, total = null) => `<table><tr><td>Numero</td><td>Cliente</td></tr>${filas}</table><input type="hidden" id="registros_total" value="${total ?? (filas.match(/<tr>/g) || []).length}">`
const USADO = (n) => `El numero de comprobante: ${n} ya se encuentra utilizado`
const FUERA = (n) => `El numero de comprobante: ${n} no esta cargado en el sistema`

const FILAS_BASE = [[5548, "RM 0001-00002252"], [5547, "RM 0001-00002233"], [5546, "RM2 0099-00002755"]]
function zomatikRemito({ validar = () => "", pendientes = "remito-pendientes.html", grabaMarca = null, alta = "remito-alta.html", filas = FILAS_BASE, porPagina = 100, archivo = "remitos" } = {}) {
  const estado = { grabado: null, sql: null, paginas: [] }
  return {
    estado,
    rutas: [
      ["GET", /^modificar_remitos\.php\?pedido=157767$/, () => resp(typeof alta === "string" ? fx(alta) : alta())],
      ["GET", /^manage_remitos\.php\?remitos=0&.*fpedido=157767/, () => resp(fx(pendientes))],
      ["GET", /^listado_remitos\.php$/, () => resp(buscadorRm())],
      ["POST", /^listado_remitos\.php\?enviado=1$/, ({ suc, cuerpo }) => {
        const b = new URLSearchParams(cuerpo)
        estado.sql = decod(sqlPagina(b))
        return conSuc(suc, buscadorRm(`<input type="hidden" id="paginar_archivo" value="${archivo}"><input type="hidden" id="sql" name="sql" value="${sqlPagina(b)}"><input type="hidden" id="query_string" value="">`))
      }],
      ["POST", /^paginar_remitos\.php\?rnd=\d+$/, ({ cuerpo }) => {
        const b = new URLSearchParams(cuerpo)
        assert.equal(b.get("fsql"), estado.sql) // el sql tal cual vino (decodificado como lo lee el navegador)
        assert.match(b.get("fsql"), /r\.sucursal = 18 /) // la sucursal REBUCRET del buscador
        assert.equal(b.get("fqs"), "")
        const todas = [...filas, ...(estado.grabado ? [[5550, `RM ${estado.grabado}`]] : [])]
        const pag = Number(b.get("fpagina"))
        estado.paginas.push(pag)
        const estas = todas.slice((pag - 1) * porPagina, pag * porPagina)
        return resp(listadoRm(estas.map(([c, n]) => filaRm(c, n)).join(""), todas.length))
      }],
      ["GET", /^_validarnumeroremito\.php\?/, ({ ruta }) => resp(validar(new URLSearchParams(ruta.split("?")[1]).get("fnumero"), estado))],
      ["POST", /^grabar_remitos\.php\?codigo=0$/, ({ cuerpo }) => ((estado.grabado = new URLSearchParams(cuerpo).get("numero")), resp("", 302, "listado_remitos.php"))],
      ["GET", /^modificar_remitos\.php\?codigo=5550$/, () => resp(`<form action="grabar_remitos.php?codigo=5550" name="frm_remitos"><textarea name="observaciones">${grabaMarca ?? "LA TERCERA - Camiones: AB1 - " + MARCA}</textarea></form>`)],
    ],
  }
}
const datosRm = (extra = {}) => ({
  marca: MARCA, npCodigo: 157767, comprobante: "7", deposito: 116, fecha: HOY, m3: 8, articuloCodigo: 10090020, articuloNombre: "H21-620-10 C (CAN)",
  patente: null, ...Z.observacionesRemito(MARCA, { patentes: "AB1, AB2", remitos_papel: "934, 935" }, "LA TERCERA"), numero: "0001-00002260",
  entrega: Z.entregaRemito({ nombre: "LA TERCERA", direccion: null, localidad: "CANNING" }), buscarAntes: false, ...extra,
})

test("remito: Continuar, el renglón del día y los demás en 0, el número validado justo antes de grabar, campos de Validarremito", async () => {
  const z = zomatikRemito()
  const pasos = []
  const nav = navFalso(z.rutas)
  const r = await R.generarRemito(nav, datosRm(), opts({ alPaso: (p, extra) => pasos.push([p, extra]) }))
  assert.equal(r.estado, "ok", r.mensaje)
  assert.equal(r.numero, "RM 0001-00002260")
  assert.deepEqual(pasos.find(([p]) => p === "grabar_remito")[1], { numero: "0001-00002260" }) // el número se guarda ANTES de grabar
  // la validación del número va justo antes de grabar (después de "Continuar"), con la sucursal 18 elegida antes
  const iv = nav.llamadas.findIndex((l) => /^_validarnumeroremito/.test(l.ruta))
  const ic = nav.llamadas.findIndex((l) => /^manage_remitos/.test(l.ruta))
  const ig = nav.llamadas.findIndex((l) => /^grabar_remitos/.test(l.ruta))
  assert.ok(ic < iv && iv < ig)
  assert.deepEqual([nav.llamadas[iv - 1].m, nav.llamadas[iv - 1].ruta], ["SUC", "18"])
  assert.match(nav.llamadas[ic].ruta, /^manage_remitos\.php\?remitos=0&fcliente=24661&fobra=0&fcomprobante=7&fstdeposito=116&fdeposito=116&fpedido=157767&rnd=7$/)
  const g = grabados(nav, "remitos")[0]
  assert.equal(g.tipo, "application/x-www-form-urlencoded") // el form no es multipart
  const b = new URLSearchParams(g.cuerpo)
  assert.equal(b.get("comprobante"), "7")
  assert.equal(b.get("numero"), "0001-00002260")
  assert.equal(b.get("patente"), "") // vacía, como hoy: las patentes van en observaciones
  assert.equal(b.get("transporte"), "1")
  assert.equal(b.get("provincia_fiscal"), "4") // vacía en el alta: la provincia del cliente
  assert.equal(b.get("entrega_direccion"), "LA TERCERA") // sin dirección: el nombre de la obra
  assert.equal(b.get("entrega_localidad"), "CANNING")
  assert.equal(b.get("lote"), "LA TERCERA") // sin lote: el nombre de la obra
  assert.equal(b.get("observacionesimp"), "934 935") // los remitos de planta del día, separados por espacio
  assert.equal(b.get("remitos"), "0")
  assert.equal(b.get("idcliente"), "24661")
  assert.equal(b.get("cantidad5349097"), "8") // el del día
  assert.equal(b.get("cantidad5349096"), "0") // venía precargado con los 32 pendientes
  assert.equal(b.get("hcantidad5349096"), "32.000")
  assert.equal(b.get("bus_deposito"), "116")
  assert.equal(b.getAll("cantidad5349096").length, 1)
  assert.equal(b.get("observaciones"), `${MARCA} - LA TERCERA - Camiones: AB1, AB2`) // la marca primero (si Zomatik recorta)
})

test("remito: número usado → prueba el siguiente (hasta 5); talonario terminado → revisar y aviso, sin grabar", async () => {
  let z = zomatikRemito({ validar: (n) => (["0001-00002260", "0001-00002261"].includes(n) ? USADO(n) : "") })
  let nav = navFalso(z.rutas)
  const pasos = []
  let r = await R.generarRemito(nav, datosRm(), opts({ alPaso: (p, extra) => pasos.push([p, extra]) }))
  assert.equal(r.estado, "ok", r.mensaje)
  assert.equal(r.numero, "RM 0001-00002262")
  assert.deepEqual(pasos.find(([p]) => p === "grabar_remito")[1], { numero: "0001-00002262" })
  // todos usados → error sin grabar
  z = zomatikRemito({ validar: USADO })
  nav = navFalso(z.rutas)
  r = await R.generarRemito(nav, datosRm(), opts())
  assert.equal(r.estado, "error")
  assert.equal(nav.llamadas.filter((l) => /^_validarnumeroremito/.test(l.ruta)).length, 5)
  assert.equal(grabados(nav, "remitos").length, 0)
  // talonario terminado
  z = zomatikRemito({ validar: FUERA })
  nav = navFalso(z.rutas)
  r = await R.generarRemito(nav, datosRm(), opts())
  assert.equal(r.estado, "revisar")
  assert.equal(r.aviso, "Cargar talonario nuevo de RM en Zomatik")
  assert.equal(r.olvidarNumero, true)
  assert.equal(r.grabado, false)
  assert.equal(grabados(nav, "remitos").length, 0)
  r = await R.generarRemito(navFalso(zomatikRemito({ validar: FUERA }).rutas), datosRm({ comprobante: "19", numero: "0099-00002760" }), opts())
  assert.equal(r.aviso, "Cargar talonario nuevo de RM2 en Zomatik")
  // respuesta desconocida → frena
  r = await R.generarRemito(navFalso(zomatikRemito({ validar: () => "Error inesperado" }).rutas), datosRm(), opts())
  assert.equal(r.estado, "error")
  assert.match(r.mensaje, /cambió el formulario/)
  // número de otro talonario
  r = await R.generarRemito(navFalso(zomatikRemito().rutas), datosRm({ numero: "0099-00002760" }), opts())
  assert.equal(r.estado, "error")
})

test("remito: pendiente menor → error; sin stock → pendiente (falta la OF); renglón de otra NP o artículo que no está → frena", async () => {
  let z = zomatikRemito()
  let nav = navFalso(z.rutas)
  let r = await R.generarRemito(nav, datosRm({ m3: 11 }), opts())
  assert.equal(r.estado, "error")
  assert.match(r.mensaje, /pendientes/)
  z = zomatikRemito()
  z.rutas.unshift(["GET", /^manage_remitos/, () => resp(fx("remito-pendientes.html").replace('name="stock5349097" value="8.000000"', 'name="stock5349097" value="2.000000"'))])
  nav = navFalso(z.rutas)
  r = await R.generarRemito(nav, datosRm(), opts())
  assert.equal(r.estado, "pendiente")
  assert.equal(r.reintentar, true)
  assert.equal(grabados(nav, "remitos").length, 0)
  z = zomatikRemito()
  z.rutas.unshift(["GET", /^manage_remitos/, () => resp(fx("remito-pendientes.html").replace("modificar_pedidos.php?codigo=157767", "modificar_pedidos.php?codigo=150000"))])
  nav = navFalso(z.rutas)
  r = await R.generarRemito(nav, datosRm(), opts())
  assert.equal(r.estado, "error")
  assert.ok(r.recorte)
  nav = navFalso(zomatikRemito().rutas)
  r = await R.generarRemito(nav, datosRm({ articuloCodigo: 99999, articuloNombre: "OTRA" }), opts())
  assert.equal(r.estado, "error")
  assert.ok(r.recorte)
  assert.equal(grabados(nav, "remitos").length, 0)
})

test("remito: obra sin localidad → revisar 'Completar la localidad de la obra' sin grabar; sin provincia o transporte frena", async () => {
  let nav = navFalso(zomatikRemito().rutas)
  let r = await R.generarRemito(nav, datosRm({ entrega: Z.entregaRemito({ nombre: "LA TERCERA", localidad: " " }) }), opts())
  assert.equal(r.estado, "revisar")
  assert.equal(r.aviso, "Completar la localidad de la obra")
  assert.equal(r.paso, "formulario_remito") // antes de grabar: "Remitir en Zomatik" lo reintenta
  assert.equal(grabados(nav, "remitos").length, 0)
  r = await R.generarRemito(navFalso(zomatikRemito().rutas), datosRm({ entrega: Z.entregaRemito(null) }), opts())
  assert.equal(r.estado, "revisar")
  assert.deepEqual(Z.entregaRemito({ nombre: "BARRIO X", lote: "112", direccion: "ECHEVERRY", localidad: "CANNING" }), { lote: "112", direccion: "ECHEVERRY", localidad: "CANNING" })
  r = await R.generarRemito(navFalso(zomatikRemito({ alta: () => fx("remito-alta.html").replace('<option value="4" selected>Capital Federal</option>', '<option value="4">Capital Federal</option>').replace('<option value="1">Buenos Aires</option><option value="4">', '<option value="0">--</option><option value="1">Buenos Aires</option><option value="4">').replace('<select name="provincia"><option value="1">', '<select name="provincia"><option value="0" selected>--</option><option value="1">') }).rutas), datosRm(), opts())
  assert.match(r.mensaje, /provincia/)
  nav = navFalso(zomatikRemito({ alta: () => fx("remito-alta.html").replace(/<input type="radio" name="transporte"[^>]*>/g, "") }).rutas)
  r = await R.generarRemito(nav, datosRm(), opts())
  assert.equal(r.estado, "error")
  assert.equal(grabados(nav, "remitos").length, 0)
})

test("remito: corte en Grabar → con el número guardado se encuentra y no se graba otro (sin la marca: ver B1)", async () => {
  const z = zomatikRemito()
  z.estado.grabado = "0001-00002260"
  const nav = navFalso(z.rutas)
  const r = await R.generarRemito(nav, datosRm({ buscarAntes: true }), opts())
  assert.equal(r.estado, "ok", r.mensaje)
  assert.equal(grabados(nav, "remitos").length, 0)
})

test("número del remito (Bautista 29/10, \"del anterior\"): el MÁS ALTO del talonario + 1, no el más reciente", async () => {
  // el listado trae RM 2252 (28/10) antes que 2233 (28/10) y 2251 (23/10): no son correlativos por fecha.
  // De a 2 filas por página: el más alto está en la 3.ª página (se recorren todas hasta registros_total)
  const z = zomatikRemito({ filas: [[5549, "RM 0001-00002251"], [5540, "RM 0001-00002258"], ...FILAS_BASE], porPagina: 2 })
  const nav = navFalso(z.rutas)
  assert.equal((await R.elegirNumeroRemito(nav, "7", { hoy: HOY, azar: () => 7 })).numero, "0001-00002259")
  assert.deepEqual(z.estado.paginas, [1, 2, 3])
  assert.equal((await R.elegirNumeroRemito(navFalso(zomatikRemito().rutas), "19", { hoy: HOY })).numero, "0099-00002756")
  assert.equal(grabados(nav, "remitos").length, 0)
  assert.equal(nav.llamadas.filter((l) => /^_validarnumeroremito/.test(l.ruta)).length, 0) // se valida justo antes de grabar
})

test("validar número: las tres respuestas reales", () => {
  assert.deepEqual(Z.numeroRemitoLibre(""), { libre: true })
  assert.equal(Z.numeroRemitoLibre(USADO("0001-00002252")).motivo, "usado")
  assert.equal(Z.numeroRemitoLibre(FUERA("0001-00009999")).motivo, "fuera")
  assert.equal(Z.numeroRemitoLibre("ok").libre, false) // solo vacío es libre
})

test("marcas: la de un despacho sin pedido es ASCII; un segundo remito del mismo día lleva otra", () => {
  assert.ok(/^[\x20-\x7e]+$/.test(Z.marcaOfSuelta("9f8e7d6c-0000-4000-8000-000000000001", HOY)))
  const otra = Z.marcaZ1(PED, HOY, 1, 2)
  assert.equal(otra, `Sistema Rebucret - pedido 1a2b3c4d - ${HOY} - 2 - NP 1`)
  // ninguna queda contenida en la otra (la verificación busca la marca dentro de las observaciones)
  assert.equal(N.tieneMarca(`x - ${otra}`, MARCA), false)
  assert.equal(N.tieneMarca(`x - ${MARCA}`, otra), false)
})

// ── Lista cerrada y llave ──
test("lista cerrada: el grupo de Z1 aparte; ni la lectura ni la NP lo habilitan", () => {
  for (const [r, m] of [["modificar_ordenfabricacion.php", "GET"], ["modificar_ordenfabricacion.php?codigo=9002", "GET"], ["manage_ordenfabricacion.php?ordenfabricacion=0&ordenfabricacion_unico=009&farticulo=1", "GET"], ["grabar_ordenfabricacion.php?codigo=0", "POST"], ["modificar_remitos.php?pedido=157767", "GET"], ["manage_remitos.php?fcliente=1&fpedido=157767", "GET"], ["_validarnumeroremito.php?fcomprobante=19&fnumero=0099-00002746", "GET"], ["grabar_remitos.php?codigo=0", "POST"], ["listado_remitos.php?enviado=1", "POST"], ["paginar_remitos.php?rnd=275836", "POST"], ["paginar_remitos.php", "POST"]])
    assert.equal(W.rutaEscrituraZ1(r, m), true, `${m} ${r}`)
  for (const [r, m] of [["grabar_ordenfabricacion.php?codigo=9002", "POST"], ["grabar_remitos.php?codigo=5550", "POST"], ["manage_remitos.php?fpedido=1&fborrar=3", "GET"], ["manage_ordenfabricacion.php?ordenfabricacion=9002&ordenfabricacion_unico=1", "GET"], ["remitir_pedido.php?codigo=1", "GET"], ["grabar_pedidos.php?codigo=0", "POST"], ["paginar_pedidos.php", "POST"], ["paginar_remitos.php?rnd=1&fborrar=2", "POST"], ["paginar_remitos.php", "GET"]])
    assert.equal(W.rutaEscrituraZ1(r, m), false, `${m} ${r}`)
  assert.equal(W.rutaPermitida("paginar_remitos.php", "POST"), false) // solo en el navegador de Z1
  for (const r of ["grabar_remitos.php?codigo=0", "grabar_ordenfabricacion.php?codigo=0", "modificar_remitos.php?pedido=1"]) assert.equal(W.rutaEscrituraNp(r, "POST") || W.rutaEscrituraNp(r, "GET") || W.rutaPermitida(r, "GET") || W.rutaPermitida(r, "POST"), false, r)
})

test("llave de Z1: hace falta la NP prendida Y la de remitir (apagada por defecto)", () => {
  assert.equal(S.llaveZ1(undefined), null)
  assert.equal(S.llaveZ1({ plant_id: "can", activo: true, remitir_activo: false, remitir_desde: null, deposito: 116 }), null)
  assert.equal(S.llaveZ1({ plant_id: "can", activo: false, remitir_activo: true, remitir_desde: null, deposito: 116 }), null)
  assert.deepEqual(S.llaveZ1({ plant_id: "can", activo: true, remitir_activo: true, remitir_desde: null, deposito: 116 }), { remitir: true, plantId: "can" })
})

// ── Robot: revisión del 29/10 (B1, I1 y menores) ──
test("B1: reintento después de un corte, el número guardado lo usa OTRO remito → se sigue con el siguiente y se graba una vez", async () => {
  // el 2260 está en el listado, de otro cliente (sin nuestra marca)
  const z = zomatikRemito({ validar: (n) => (n === "0001-00002260" ? USADO(n) : ""), filas: [[5549, "RM 0001-00002260"], ...FILAS_BASE] })
  z.rutas.unshift(["GET", /^modificar_remitos\.php\?codigo=5549$/, () => resp(`<form action="grabar_remitos.php?codigo=5549" name="frm_remitos"><textarea name="observaciones">PILETA</textarea></form>`)])
  const nav = navFalso(z.rutas)
  const r = await R.generarRemito(nav, datosRm({ buscarAntes: true }), opts())
  assert.equal(r.estado, "ok", r.mensaje)
  assert.equal(r.numero, "RM 0001-00002261")
  assert.equal(grabados(nav, "remitos").length, 1)
  // figura usado pero no aparece en el listado: puede ser el nuestro → revisar, sin grabar
  const nav2 = navFalso(zomatikRemito({ validar: (n) => (n === "0001-00002260" ? USADO(n) : "") }).rutas)
  const r2 = await R.generarRemito(nav2, datosRm({ buscarAntes: true }), opts())
  assert.equal(r2.estado, "revisar")
  assert.equal(grabados(nav2, "remitos").length, 0)
})

test("I1: la OF cortada se busca desde el día de la foto (23:50 → pasada la medianoche)", async () => {
  const z = zomatikOf()
  z.estado.grabada = true
  const nav = navFalso(z.rutas)
  const r = await R.generarOf(nav, datosOf({ buscarAntes: true, foto: ["0001-00003391"], fotoDia: "2026-10-30" }), opts())
  assert.equal(r.estado, "ok", r.mensaje)
  const b = new URLSearchParams(nav.llamadas.find((l) => l.m === "POST" && /^listado_ordenfabricacion/.test(l.ruta)).cuerpo)
  assert.equal(b.get("bus_fechad"), "2026-10-30")
  assert.equal(b.get("bus_fechah"), "2026-11-01")
  // al grabar se guarda el día de la foto
  const pasos = []
  await R.generarOf(navFalso(zomatikOf().rutas), datosOf(), opts({ alPaso: (p, extra) => pasos.push([p, extra]) }))
  assert.equal(pasos.find(([p]) => p === "grabar_of")[1].fotoDia, HOY)
})

test("validar número: una respuesta vacía con error HTTP no es 'libre'; sin stock se marca", async () => {
  assert.equal(Z.numeroRemitoLibre("", 500).libre, false)
  assert.equal(Z.numeroRemitoLibre("", 302).libre, false)
  const z = zomatikRemito()
  z.rutas.unshift(["GET", /^_validarnumeroremito/, () => resp("", 500)])
  let nav = navFalso(z.rutas)
  let r = await R.generarRemito(nav, datosRm(), opts())
  assert.equal(r.estado, "error")
  assert.equal(grabados(nav, "remitos").length, 0)
  const z2 = zomatikRemito()
  z2.rutas.unshift(["GET", /^manage_remitos/, () => resp(fx("remito-pendientes.html").replace('name="stock5349097" value="8.000000"', 'name="stock5349097" value="0.000000"'))])
  r = await R.generarRemito(navFalso(z2.rutas), datosRm(), opts())
  assert.equal(r.sinStock, true)
})

test("cambios de despachos: anulados (borrados) y editados, con firma estable", () => {
  const c = Z.cambiosDespachos([{ dispatch_id: "b", m3: 8 }, { dispatch_id: "a", m3: 8 }, { dispatch_id: "c", m3: 4 }], [{ id: "a", quantity_m3: 8 }, { id: "c", quantity_m3: 3 }])
  assert.deepEqual(c.anulados, ["b"])
  assert.deepEqual(c.editados, [{ id: "c", antes: 4, ahora: 3 }])
  assert.equal(c.m3, 11)
  assert.equal(Z.cambiosDespachos([{ dispatch_id: "a", m3: 8 }], [{ id: "a", quantity_m3: 8 }]).firma, null)
  assert.match(Z.textoCambio(c), /anuló 1 despacho; se editó 4 → 3 m³/)
  assert.deepEqual(Z.ultimosDias("2026-11-01", 3), ["2026-11-01", "2026-10-31", "2026-10-30"])
})

// ── Servidor de Z1 con una base simulada (sin red ni Zomatik) ──
function baseFalsa(tablas) {
  const db = Object.fromEntries(Object.entries(tablas).map(([k, v]) => [k, v.map((x) => ({ ...x }))]))
  const llamadas = []
  function consulta(tabla) {
    const st = { op: "select", filtros: [], lim: null, cambios: null, conSelect: false }
    const pasa = (row) => st.filtros.every((f) => f(row))
    const filas = () => (db[tabla] ||= []).filter(pasa)
    const correr = () => {
      if (st.op === "select") return { data: filas().slice(0, st.lim ?? undefined).map((x) => ({ ...x })), error: null }
      if (st.op === "update") {
        const fs = filas()
        for (const x of fs) Object.assign(x, st.cambios)
        llamadas.push({ tabla, op: "update", cambios: st.cambios, n: fs.length })
        return { data: fs.map((x) => ({ ...x })), error: null }
      }
      if (st.op === "delete") {
        const fs = filas()
        db[tabla] = db[tabla].filter((x) => !fs.includes(x))
        llamadas.push({ tabla, op: "delete", n: fs.length })
        return { data: fs, error: null }
      }
      if (st.op === "insert") {
        db[tabla].push(...[].concat(st.cambios))
        return { data: null, error: null }
      }
    }
    const q = {
      select() { st.conSelect = true; return q },
      update(c) { st.op = "update"; st.cambios = c; return q },
      delete() { st.op = "delete"; return q },
      insert(c) { st.op = "insert"; st.cambios = c; return q },
      upsert(c) { st.op = "insert"; st.cambios = c; return q },
      eq(c, v) { st.filtros.push((r) => r[c] === v); return q },
      neq(c, v) { st.filtros.push((r) => r[c] !== v); return q },
      in(c, vs) { st.filtros.push((r) => vs.includes(r[c])); return q },
      is(c, v) { st.filtros.push((r) => (r[c] ?? null) === v); return q },
      gte(c, v) { st.filtros.push((r) => String(r[c]) >= v); return q },
      lt(c, v) { st.filtros.push((r) => String(r[c]) < v); return q },
      not(c, op, v) { st.filtros.push((r) => (r[c] ?? null) !== v); return q },
      order() { return q },
      limit(n) { st.lim = n; return q },
      async maybeSingle() { const r = correr(); return { data: r.data?.[0] ?? null, error: null } },
      then(ok, mal) { return Promise.resolve(correr()).then(ok, mal) },
    }
    return q
  }
  const sb = {
    from: (t) => consulta(t),
    async rpc(nombre, a) {
      llamadas.push({ rpc: nombre, a })
      if (nombre === "zomatik_robot_tomar") return { data: true, error: null }
      if (nombre === "zomatik_robot_soltar") return { data: null, error: null }
      if (nombre === "zomatik_remito_tomar") {
        const r = db.zomatik_remitos.find((x) => x.id === a.p_id)
        const colgada = r?.estado === "generando" && Date.now() - Date.parse(r.en_curso_desde) > 3 * 60_000
        if (!r || !(a.p_desde.includes(r.estado) || colgada)) return { data: [], error: null }
        const antes = { remito_id: r.id, estado_anterior: r.estado, paso_anterior: r.paso }
        Object.assign(r, { estado: "generando", en_curso_desde: new Date().toISOString(), intentos: (r.intentos || 0) + 1 })
        return { data: [antes], error: null }
      }
      throw new Error(`rpc no simulada: ${nombre}`)
    },
  }
  return { sb, db, llamadas }
}

const PLANTA = "can"
const filaRemito = (extra = {}) => ({
  id: "rem1", tipo: "pedido", scheduled_dispatch_id: PED, np_id: "np1", fecha: HOY, plant_id: PLANTA, marca: MARCA, comprobante: "7", m3: 16,
  formula_id: "f1", patente: "AB1", patentes: "AB1, AB2", remitos_papel: "934, 935", estado: "pendiente", of_estado: "pendiente", of_numero: null,
  of_codigo: null, of_foto: null, of_foto_dia: null, sin_stock: 0, cambio_avisado: null, remito_estado: "pendiente", remito_numero: null, remito_codigo: null,
  paso: null, mensaje: null, intentos: 0, proximo_intento: "2000-01-01T00:00:00Z", en_curso_desde: null, created_at: "2026-10-31T10:00:00Z", ...extra,
})
function baseZ1({ remito = {}, config = {}, despachos = ["d1", "d2"] } = {}) {
  return baseFalsa({
    zomatik_np_config: [{ plant_id: PLANTA, activo: true, remitir_activo: true, remitir_desde: null, deposito: 116, ...config }],
    zomatik_remitos: [filaRemito(remito)],
    zomatik_remito_despachos: [{ remito_id: "rem1", dispatch_id: "d1", m3: 8 }, { remito_id: "rem1", dispatch_id: "d2", m3: 8 }],
    dispatches: despachos.map((id, i) => ({ id, quantity_m3: 8, formula_id: "f1", remito: String(934 + i), mixers: { license_plate: `AB${i + 1}` } })),
    zomatik_np: [{ id: "np1", n: 1, numero: "NP 0001-00001169", zomatik_codigo: 157767, estado: "ok" }],
    formulas: [{ id: "f1", code: "H21", zomatik_articulo_codigo: 10090020, zomatik_articulo_nombre: "H21-620-10 C (CAN)" }],
    zomatik_articulos: [{ codigo: 10090020, nombre: "H21-620-10 C (CAN)", codigo_sistema: 1000015959 }],
    scheduled_dispatches: [{ id: PED, plant_id: PLANTA, construction_sites: { name: "LA TERCERA", address: null, localidad: "CANNING" } }],
    activity_log: [],
  })
}
function depFalsas() {
  const hecho = { navegador: 0, of: [], remito: [], avisos: [] }
  return {
    hecho,
    dep: {
      navegador: async () => { hecho.navegador++; return {} },
      avisar: async (_sb, titulo, lineas) => { hecho.avisos.push([titulo, lineas]); return { enviado: true } },
      robot: {
        generarOf: async (_n, d) => { hecho.of.push(d); return { estado: "ok", mensaje: null, numero: "OF 0001-00003412", codigo: 9100, paso: "verificar_of", grabado: true } },
        elegirNumeroRemito: async () => ({ estado: "ok", mensaje: null, numero: "0001-00002260", paso: "elegir_numero" }),
        generarRemito: async (_n, d) => { hecho.remito.push(d); return hecho.respuestaRemito || { estado: "ok", mensaje: null, numero: "RM 0001-00002260", codigo: 5550, paso: "verificar_remito", grabado: true } },
      },
    },
  }
}

test("servidor: con la llave de remitir apagada no se toma nada ni se abre Zomatik", async () => {
  const b = baseZ1({ config: { remitir_activo: false } })
  const f = depFalsas()
  const res = await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  assert.deepEqual(res.hechas, [])
  assert.equal(f.hecho.navegador, 0)
  assert.equal(b.llamadas.filter((l) => l.rpc).length, 0)
  assert.deepEqual(await S.prepararRemitos(PED, HOY, "test", b.sb), { activo: false, motivo: "OF y remito: se cargan a mano en Zomatik" })
})

test("servidor: un despacho anulado antes de la OF → la OF y el remito van con los m³ de hoy", async () => {
  const b = baseZ1({ despachos: ["d1"] })
  const f = depFalsas()
  const res = await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  assert.equal(res.hechas[0]?.estado, "ok", JSON.stringify(res))
  assert.equal(f.hecho.of[0].m3, 8)
  assert.equal(f.hecho.remito[0].m3, 8)
  assert.deepEqual(b.db.zomatik_remito_despachos.map((x) => x.dispatch_id), ["d1"])
  assert.equal(b.db.zomatik_remitos[0].remitos_papel, "934")
  assert.equal(b.db.zomatik_remitos[0].estado, "ok")
})

test("servidor: un despacho anulado DESPUÉS de la OF → 'revisar' y aviso (una sola vez), sin remito", async () => {
  const b = baseZ1({ despachos: ["d1"], remito: { of_estado: "ok", of_numero: "OF 0001-00003412" } })
  const f = depFalsas()
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  assert.equal(b.db.zomatik_remitos[0].estado, "revisar")
  assert.equal(f.hecho.remito.length, 0)
  assert.equal(f.hecho.avisos.length, 1)
  assert.match(f.hecho.avisos[0][1][0], /OF 0001-00003412 se anuló 1 despacho/)
  // la pasada no vuelve a avisar lo mismo; un remito ya hecho que cambia sí avisa
  assert.equal(await S.controlarCambiosZ1("test", { dias: [HOY], sb: b.sb, avisar: f.dep.avisar }), 0)
  const b2 = baseZ1({ despachos: ["d1"], remito: { estado: "ok", of_estado: "ok", of_numero: "OF 0001-00003412", remito_estado: "ok", remito_numero: "RM 0001-00002260" } })
  assert.equal(await S.controlarCambiosZ1("test", { dias: [HOY], sb: b2.sb, avisar: f.dep.avisar }), 1)
  assert.equal(await S.controlarCambiosZ1("test", { dias: [HOY], sb: b2.sb, avisar: f.dep.avisar }), 0)
})

test("servidor: una fila colgada en 'grabar_of' se retoma buscando la OF desde el día de la foto", async () => {
  const b = baseZ1({ remito: { estado: "generando", en_curso_desde: new Date(Date.now() - 5 * 60_000).toISOString(), paso: "grabar_of", of_foto: ["0001-00003391"], of_foto_dia: "2026-10-30" } })
  const f = depFalsas()
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  assert.equal(f.hecho.of[0].buscarAntes, true)
  assert.equal(f.hecho.of[0].fotoDia, "2026-10-30")
  // una que se está generando ahora (menos de 3 min) no se toca
  const b2 = baseZ1({ remito: { estado: "generando", en_curso_desde: new Date().toISOString(), paso: "grabar_of" } })
  const f2 = depFalsas()
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b2.sb, dep: f2.dep })
  assert.equal(f2.hecho.of.length, 0)
})

test("servidor: 6 intentos sin stock (1 hora) → 'revisar' con el aviso de 'Generar'", async () => {
  const b = baseZ1({ remito: { of_estado: "ok", of_numero: "OF 0001-00003412", sin_stock: 5 } })
  const f = depFalsas()
  f.hecho.respuestaRemito = { estado: "pendiente", mensaje: "No hay stock.", paso: "continuar_remito", reintentar: true, sinStock: true }
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  assert.equal(b.db.zomatik_remitos[0].estado, "revisar")
  assert.equal(b.db.zomatik_remitos[0].sin_stock, 6)
  assert.equal(f.hecho.avisos[0][0], "Zomatik no tiene stock: ¿la OF necesita 'Generar'?")
  // con menos, sigue pendiente
  const b2 = baseZ1({ remito: { of_estado: "ok", of_numero: "OF 0001-00003412", sin_stock: 1 } })
  const f2 = depFalsas()
  f2.hecho.respuestaRemito = f.hecho.respuestaRemito
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b2.sb, dep: f2.dep })
  assert.equal(b2.db.zomatik_remitos[0].estado, "pendiente")
  assert.equal(b2.db.zomatik_remitos[0].sin_stock, 2)
})

test("B1: el remito con el número guardado no se puede leer → 'revisar' y nunca el número siguiente", async () => {
  const z = zomatikRemito({ validar: () => "", filas: [[5549, "RM 0001-00002260"]] })
  z.rutas.unshift(["GET", /^modificar_remitos\.php\?codigo=5549$/, () => resp("<html>Sesion expirada</html>")])
  const nav = navFalso(z.rutas)
  const r = await R.generarRemito(nav, datosRm({ buscarAntes: true }), opts())
  assert.equal(r.estado, "revisar")
  assert.match(r.mensaje, /no se pudo leer/)
  assert.equal(grabados(nav, "remitos").length, 0)
  assert.equal(nav.llamadas.filter((l) => /^_validarnumeroremito/.test(l.ruta)).length, 0)
})

test("I2: cortado en grabar_of y después cambia un despacho → como OF hecha: 'revisar' y aviso, sin ajustar ni hacer otra OF", async () => {
  for (const paso of ["grabar_of", "verificar_of"]) {
    const b = baseZ1({ despachos: ["d1"], remito: { paso, of_foto: ["0001-00003391"], of_foto_dia: HOY } })
    const f = depFalsas()
    await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
    assert.equal(b.db.zomatik_remitos[0].estado, "revisar", paso)
    assert.equal(b.db.zomatik_remitos[0].m3, 16) // no se ajustó
    assert.equal(b.db.zomatik_remito_despachos.length, 2)
    assert.equal(f.hecho.of.length, 0)
    assert.equal(f.hecho.avisos.length, 1)
    assert.match(f.hecho.avisos[0][1][0], /La OF puede estar en Zomatik/)
  }
})

test("listado de remitos con paginar (prueba real 29/10): sin sql o con otro archivo → error sin grabar; registros_total manda", async () => {
  for (const archivo of ["pedidos", ""]) {
    const nav = navFalso(zomatikRemito({ archivo }).rutas)
    const r = await R.elegirNumeroRemito(nav, "7", { hoy: HOY, azar: () => 7 })
    assert.equal(r.estado, "error")
    assert.match(r.mensaje, /cambió el formulario/)
    assert.equal(nav.llamadas.filter((l) => /^paginar_/.test(l.ruta)).length, 0)
  }
  // el remito: con el listado vacío en el HTML, el número se encuentra igual (paginar) y el corte se resuelve sin grabar
  const z = zomatikRemito()
  z.estado.grabado = "0001-00002260"
  const nav = navFalso(z.rutas)
  const r = await R.generarRemito(nav, datosRm({ buscarAntes: true }), opts())
  assert.equal(r.estado, "ok", r.mensaje)
  assert.equal(grabados(nav, "remitos").length, 0)
  // piezas puras
  assert.deepEqual(Z.paginadoDe(`<input type="hidden" id="paginar_archivo" value="remitos"><input type="hidden" name="sql" id="sql" value="select &#39;a&#39; &lt; &quot;b&quot; &amp; c from t"><input id="query_string" value="">`), { archivo: "remitos", sql: `select 'a' < "b" & c from t`, qs: "" })
  assert.equal(Z.paginadoDe(`<input id="paginar_archivo" value="remitos">`), null)
  assert.equal(Z.registrosTotal(`<span id="registros_total">580</span>`), 580)
  assert.equal(Z.registrosTotal(`<input type="hidden" id="registros_total" value="580">`), 580)
  assert.equal(Z.registrosTotal("<table></table>"), null)
  assert.deepEqual(Z.listadoRemitos(`<tr><td><a href="modificar_remitos.php?codigo=218152" class="itemlistado">RM 0001-00017456</a></td><td>CLIENTE</td></tr>`), [{ codigo: 218152, numero: "RM 0001-00017456" }])
  assert.equal(Z.opcionDeSelect(buscadorRm(), "bus_sucursal", /^REBUCRET$/i), "18")
})

test("sql real: comillas, saltos de línea, tildes, entidades y '>' crudo llegan enteros a paginar_remitos (UTF-8, como $.post)", async () => {
  const z = zomatikRemito()
  const nav = navFalso(z.rutas)
  const r = await R.elegirNumeroRemito(nav, "7", { hoy: HOY, azar: () => 7 })
  assert.equal(r.estado, "ok", r.mensaje)
  const b = new URLSearchParams(nav.llamadas.find((l) => /^paginar_remitos/.test(l.ruta)).cuerpo)
  assert.match(b.get("fsql"), /^select distinct SQL_CALC_FOUND_ROWS suc\.nombre as nsuc, r\.codigo\n from remitos r where r\.sucursal = 18 and r\.fecha >= '\d{4}-\d{2}-\d{2}' and r\.fecha < '/)
  assert.match(b.get("fsql"), /\r\n and o\.nombre <> 'Año á & b' and c\.abreviatura <> "x" order by r\.codigo desc$/)
  // un sql cortado nunca se manda
  assert.equal(Z.paginadoDe(`<input id="paginar_archivo" value="remitos"><input id="sql" value="&quot;select">`), null)
  assert.equal(Z.valorDeInput(`<input type="hidden" value="a > b" id="sql">`, "sql"), "a > b")
  assert.equal(Z.valorDeInput(`<input id="otro" value="id='sql' name=sql">`, "sql"), null)
})

test("el error real no se pierde: el Freno de elegir el número llega a la fila y a Actividad", async () => {
  const b = baseZ1({ remito: { of_estado: "ok", of_numero: "OF 0001-00003412", paso: "elegir_numero" } })
  const f = depFalsas()
  f.dep.navegador = async () => navFalso(zomatikRemito({ archivo: "pedidos" }).rutas)
  f.dep.robot.elegirNumeroRemito = R.elegirNumeroRemito
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  const fila = b.db.zomatik_remitos[0]
  assert.equal(fila.estado, "error")
  assert.match(fila.mensaje, /cambió el formulario de el remito \(el listado pagina con "pedidos"\)/)
  assert.ok(b.db.activity_log.some((x) => /cambió el formulario/.test(x.details.Mensaje)))
})

test("una excepción de JavaScript queda como 'Error interno: …' en la fila y en Actividad, con el stack en console.error", async (t) => {
  const errores = t.mock.method(console, "error", () => {})
  // en el servidor
  const b = baseZ1()
  const f = depFalsas()
  f.dep.robot.generarOf = async () => { throw new TypeError("x.y is not a function") }
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  const fila = b.db.zomatik_remitos[0]
  assert.equal(fila.estado, "pendiente")
  assert.equal(fila.mensaje, "Error interno: x.y is not a function")
  assert.equal(b.db.activity_log.filter((x) => x.details.Mensaje === fila.mensaje).length, 1)
  assert.ok(errores.mock.callCount() >= 1)
  // en el robot
  const nav = { sucursal: async () => true, get: async () => { throw new TypeError("boom") }, post: async () => { throw new TypeError("boom") } }
  const r = await R.elegirNumeroRemito(nav, "7", { hoy: HOY })
  assert.equal(r.estado, "error")
  assert.equal(r.mensaje, "Error interno: boom")
  // lo de Zomatik sigue con su mensaje
  const red = { sucursal: async () => true, get: async () => { throw Object.assign(new Error("Zomatik no respondió a tiempo"), { codigo: "sin_respuesta" }) } }
  const r2 = await R.elegirNumeroRemito(red, "7", { hoy: HOY })
  assert.equal(r2.estado, "pendiente")
  assert.equal(r2.mensaje, "Zomatik no respondió a tiempo")
})
