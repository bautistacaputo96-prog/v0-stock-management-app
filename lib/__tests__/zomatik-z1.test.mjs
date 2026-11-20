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
import * as A from "../zomatik/ajuste.ts"
import { chipRemito } from "../zomatik/z1-cliente.ts"

const fx = (f) => readFileSync(new URL(`../__fixtures__/zomatik-z1/${f}`, import.meta.url), "latin1")
// Los comprobantes de una NP (REAL 06/11): sin nada, o con RM2 0099-00002758 (código 218176) y una factura
const fxA = (f) => readFileSync(new URL(`../__fixtures__/zomatik-ajuste/${f}`, import.meta.url), "latin1")
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
    async get(ruta, op) { return responder("GET", ruta, null, undefined, op?.ofARemitir ?? null, op?.ofMp ?? null) },
    async post(ruta, cuerpo, tipo, op) { return responder("POST", ruta, cuerpo ? latin1(cuerpo) : "", tipo, null, op?.ofMp ?? null) },
  }
  async function responder(m, ruta, cuerpo, tipo, ofARemitir = null, ofMp = null) {
    const ll = { m, ruta, suc: nav.suc, cuerpo, tipo, ofARemitir, ofMp }
    nav.llamadas.push(ll)
    alLlamar?.(ll, nav)
    assert.ok(W.rutaEscrituraZ1(ruta, m, ofARemitir, ofMp) || W.rutaPermitida(ruta, m), `ruta fuera de la lista cerrada: ${m} ${ruta}`)
    // Como el cliente real: a "Continuar" de la materia prima solo sale el cuerpo de ESA OF
    if (ruta === W.RUTA_GRABAR_MP) assert.ok(W.cuerpoMpValido(cuerpo, ofMp), `cuerpo de materia prima fuera de la lista cerrada (OF ${ofMp})`)
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

// ── Remitir la OF (REAL 13/11): PEN trae el lapicito remitir_ordenfabricacion.php?codigo=N; un GET la pasa a FIN ──
const LAPICITO = (codigo) => `PEN <a href="remitir_ordenfabricacion.php?codigo=${codigo}"><img src="images/ic_editar.gif" border="0"></a>`
/** El listado con nuestra OF 9002 (0001-00003392): `antes` hasta el GET al lapicito y `despues` desde ahí. */
function zomatikRemitir({ antes = "PEN", despues = "FIN", link = 9002, listado = null } = {}) {
  const estado = { remitida: false, gets: 0 }
  const celda = (e) => (e === "PEN" && link ? LAPICITO(link) : e)
  return {
    estado,
    rutas: [
      ["GET", /^listado_ordenfabricacion\.php$/, () => resp(listadoOf(""))],
      ["POST", /^listado_ordenfabricacion\.php\?enviado=1$/, ({ suc }) => listado ? listado({ suc, estado }) : conSuc(suc, listadoOf(filaOf(9001, "0001-00003391", "CANNING", "2026-10-30", "FIN") + filaOf(9002, "0001-00003392", "CANNING", HOY, celda(estado.remitida ? despues : antes))))],
      ["GET", /^remitir_ordenfabricacion\.php\?codigo=\d+$/, () => { estado.gets++; estado.remitida = true; return resp("", 302, "listado_ordenfabricacion.php") }],
    ],
  }
}
const datosRemitir = (extra = {}) => ({ codigo: 9002, numero: "OF 0001-00003392", deposito: 116, desde: "2026-10-30", ...extra })
const getsRemitir = (nav) => nav.llamadas.filter((l) => /^remitir_ordenfabricacion/.test(l.ruta))

test("remitir OF: el listado lee el lapicito de las PEN (las FIN no lo traen)", () => {
  const filas = Z.listadoOf(listadoOf(filaOf(9001, "0001-00003391", "CANNING", "2026-10-30", "FIN") + filaOf(9002, "0001-00003392", "CANNING", HOY, LAPICITO(9002))))
  assert.deepEqual(filas.map((x) => [x.numero, x.codigo, x.estado, x.remitir]), [["0001-00003391", 9001, "FIN", null], ["0001-00003392", 9002, "PEN", 9002]])
})

test("remitir OF: PEN → se guarda 'remitir_of', GET al lapicito (atado a su código en esa llamada), vuelve a leer y quedó FIN → ok 'of_remitida'", async () => {
  const z = zomatikRemitir()
  const pasos = []
  const nav = navFalso(z.rutas, { alLlamar: (l) => { if (/^remitir_/.test(l.ruta)) pasos.push(["GET", l.suc]) } })
  const r = await R.remitirOf(nav, datosRemitir(), opts({ alPaso: (p) => pasos.push([p]) }))
  assert.equal(r.estado, "ok", r.mensaje)
  assert.equal(r.paso, "of_remitida")
  assert.equal(r.grabado, true)
  assert.deepEqual(getsRemitir(nav).map((l) => [l.m, l.ruta, l.ofARemitir]), [["GET", "remitir_ordenfabricacion.php?codigo=9002", 9002]])
  // el paso se guarda ANTES del GET, y el GET va desde la sucursal 18
  assert.deepEqual(pasos, [["remitir_of"], ["GET", "18"]])
  // se buscó desde el día pedido (y hasta mañana), antes y después
  const lecturas = nav.llamadas.filter((l) => l.m === "POST" && /^listado_ordenfabricacion/.test(l.ruta))
  assert.equal(lecturas.length, 2)
  assert.equal(new URLSearchParams(lecturas[0].cuerpo).get("bus_fechad"), "2026-10-30")
  assert.equal(new URLSearchParams(lecturas[0].cuerpo).get("bus_fechah"), "2026-11-01")
})

test("remitir OF: ya FIN (la remitieron a mano) → ok sin GET ni paso guardado", async () => {
  const z = zomatikRemitir({ antes: "FIN" })
  const pasos = []
  const nav = navFalso(z.rutas)
  const r = await R.remitirOf(nav, datosRemitir(), opts({ alPaso: (p) => pasos.push(p) }))
  assert.equal(r.estado, "ok", r.mensaje)
  assert.equal(r.paso, "of_remitida")
  assert.ok(!r.grabado)
  assert.equal(getsRemitir(nav).length, 0)
  assert.deepEqual(pasos, [])
})

test("remitir OF: después del GET sigue PEN → 'revisar' (nada de reintentos infinitos)", async () => {
  const z = zomatikRemitir({ despues: "PEN" })
  const nav = navFalso(z.rutas)
  const r = await R.remitirOf(nav, datosRemitir(), opts())
  assert.equal(r.estado, "revisar")
  assert.ok(!r.reintentar)
  assert.ok(!r.sinStock)
  assert.equal(r.paso, "remitir_of")
  assert.equal(r.grabado, true)
  assert.equal(r.mensaje, "La OF 0001-00003392 sigue PEN después de remitirla. Revisala en Zomatik.")
  assert.equal(getsRemitir(nav).length, 1)
})

test("remitir OF: el listado no se puede leer (formato u otra sucursal) o se corta la red → 'pendiente' que cuenta para el tope, sin GET a ciegas", async () => {
  for (const listado of [
    ({ suc }) => conSuc(suc, listadoOf(`<tr><td>basura</td><td>OF 0001-00003392</td></tr>`)),
    () => conSuc("17", listadoOf(filaOf(9002, "0001-00003392", "CANNING", HOY, LAPICITO(9002)))),
    () => { throw Object.assign(new Error("Zomatik no respondió a tiempo"), { codigo: "sin_respuesta" }) },
  ]) {
    const nav = navFalso(zomatikRemitir({ listado }).rutas)
    const r = await R.remitirOf(nav, datosRemitir(), opts())
    assert.equal(r.estado, "pendiente", r.mensaje)
    assert.equal(r.reintentar, true)
    assert.equal(r.sinStock, true)
    assert.equal(r.paso, "remitir_of")
    assert.equal(getsRemitir(nav).length, 0)
  }
  // ilegible después del GET: pendiente (el próximo intento la encuentra FIN y no repite el GET)
  const z = zomatikRemitir({ listado: ({ suc, estado }) => conSuc(suc, estado.remitida ? "<html>error</html><table><tr><td>2026-10-31</td><td>OF 0001-00003392</td></tr></table>" : listadoOf(filaOf(9002, "0001-00003392", "CANNING", HOY, LAPICITO(9002)))) })
  const nav = navFalso(z.rutas)
  const r = await R.remitirOf(nav, datosRemitir(), opts())
  assert.equal(r.estado, "pendiente")
  assert.equal(r.sinStock, true)
  assert.equal(r.grabado, true)
  assert.match(r.mensaje, /^Se mandó remitir la OF 0001-00003392, pero no se pudo leer el listado de OF.* Se reintenta\.$/)
  assert.equal(getsRemitir(nav).length, 1)
})

test("remitir OF: anomalías (PEN sin lapicito o a OTRO código, la OF con otro código, repetida o que no aparece) → 'revisar' sin GET; sin código → error", async () => {
  const dos = ({ suc }) => conSuc(suc, listadoOf(filaOf(9002, "0001-00003392", "CANNING", HOY, LAPICITO(9002)) + filaOf(9002, "0001-00003392", "CANNING", HOY, LAPICITO(9002))))
  const ninguna = ({ suc }) => conSuc(suc, listadoOf(filaOf(9001, "0001-00003391", "CANNING", "2026-10-30", "FIN")))
  for (const [z, d, msj] of [
    [zomatikRemitir({ link: 9003 }), datosRemitir(), /PEN en Zomatik pero el link para remitirla va a otro código \(9003\)/],
    [zomatikRemitir({ link: null }), datosRemitir(), /PEN en Zomatik pero sin el link para remitirla/],
    [zomatikRemitir(), datosRemitir({ codigo: 9005 }), /tiene otro código \(9002; el sistema tiene 9005\)/],
    [zomatikRemitir({ listado: dos }), datosRemitir(), /figura 2 veces/],
    [zomatikRemitir({ listado: ninguna }), datosRemitir(), /no aparece en el listado de OF/],
  ]) {
    const nav = navFalso(z.rutas)
    const r = await R.remitirOf(nav, d, opts())
    assert.equal(r.estado, "revisar", r.mensaje)
    assert.match(r.mensaje, msj)
    assert.match(r.mensaje, /Revisala en Zomatik\.$/)
    assert.ok(!r.sinStock)
    assert.equal(getsRemitir(nav).length, 0)
  }
  const nav = navFalso(zomatikRemitir().rutas)
  const r = await R.remitirOf(nav, datosRemitir({ codigo: null }), opts())
  assert.equal(r.estado, "error")
  assert.equal(nav.llamadas.length, 0)
})

test("lista cerrada: remitir_ordenfabricacion solo por GET y solo con el of_codigo de la fila en esa llamada; con otro código, se rechaza", () => {
  assert.equal(W.rutaEscrituraZ1("remitir_ordenfabricacion.php?codigo=8242", "GET", 8242), true)
  assert.equal(W.rutaEscrituraZ1("/remitir_ordenfabricacion.php?codigo=8242", "GET", 8242), true)
  for (const [r, m, of] of [
    ["remitir_ordenfabricacion.php?codigo=8243", "GET", 8242], ["remitir_ordenfabricacion.php?codigo=8242", "GET", null], ["remitir_ordenfabricacion.php?codigo=8242", "GET", undefined],
    ["remitir_ordenfabricacion.php?codigo=8242", "POST", 8242], ["remitir_ordenfabricacion.php?codigo=8242&codigo=1", "GET", 8242], ["remitir_ordenfabricacion.php?codigo=82420", "GET", 8242],
    ["remitir_ordenfabricacion.php", "GET", 8242], ["remitir_ordenfabricacion.php?codigo=0", "GET", 0], ["remitir_ordenfabricacion.php?codigo=8242", "GET", "8242"],
  ])
    assert.equal(W.rutaEscrituraZ1(r, m, of), false, `${m} ${r} (${of})`)
  // ni la lectura ni la NP ni el ajuste la habilitan
  assert.equal(W.rutaPermitida("remitir_ordenfabricacion.php?codigo=8242", "GET"), false)
  assert.equal(W.rutaEscrituraNp("remitir_ordenfabricacion.php?codigo=8242", "GET"), false)
  assert.equal(W.rutaEscrituraAjuste("remitir_ordenfabricacion.php?codigo=8242", "GET", 8242), false)
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
function zomatikRemito({ validar = () => "", pendientes = "remito-pendientes.html", grabaMarca = null, alta = "remito-alta.html", filas = FILAS_BASE, porPagina = 100, archivo = "remitos", secundarios = fx("remito-secundarios.txt"), comprobantes = () => resp(fxA("comprobantes-sin-nada.html")) } = {}) {
  const estado = { grabado: null, sql: null, paginas: [] }
  return {
    estado,
    rutas: [
      ["GET", /^_comprobantes\.php\?ftarget=pedidos&ftargetid=157767&rnd=\d+$/, () => comprobantes(estado)],
      ["GET", /^modificar_remitos\.php\?pedido=157767$/, () => resp(typeof alta === "string" ? fx(alta) : alta())],
      ["GET", /^traerdatossecundarios\.php\?fcliente=24661&rnd=\d+$/, () => resp(secundarios)],
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
  assert.equal(b.get("provincia_fiscal"), "1") // la de la entrega: Buenos Aires
  // los datos del cliente salen de traerdatossecundarios (el alta los trae vacíos)
  assert.equal(b.get("provincia"), "1")
  assert.equal(b.get("cuit"), "30715983644")
  assert.equal(b.get("condicion_pago"), "3")
  assert.equal(b.get("direccion"), "")
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

test("remito: obra sin localidad → revisar 'Completar la localidad de la obra' sin grabar; sin transporte frena", async () => {
  let nav = navFalso(zomatikRemito().rutas)
  let r = await R.generarRemito(nav, datosRm({ entrega: Z.entregaRemito({ nombre: "LA TERCERA", localidad: " " }) }), opts())
  assert.equal(r.estado, "revisar")
  assert.equal(r.aviso, "Completar la localidad de la obra")
  assert.equal(r.paso, "formulario_remito") // antes de grabar: "Remitir en Zomatik" lo reintenta
  assert.equal(grabados(nav, "remitos").length, 0)
  r = await R.generarRemito(navFalso(zomatikRemito().rutas), datosRm({ entrega: Z.entregaRemito(null) }), opts())
  assert.equal(r.estado, "revisar")
  assert.deepEqual(Z.entregaRemito({ nombre: "BARRIO X", lote: "112", direccion: "ECHEVERRY", localidad: "CANNING" }), { lote: "112", direccion: "ECHEVERRY", localidad: "CANNING" })
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
  for (const [r, m] of [["modificar_ordenfabricacion.php", "GET"], ["modificar_ordenfabricacion.php?codigo=9002", "GET"], ["manage_ordenfabricacion.php?ordenfabricacion=0&ordenfabricacion_unico=009&farticulo=1", "GET"], ["grabar_ordenfabricacion.php?codigo=0", "POST"], ["modificar_remitos.php?pedido=157767", "GET"], ["traerdatossecundarios.php?fcliente=15893&rnd=7", "GET"], ["manage_remitos.php?fcliente=1&fpedido=157767", "GET"], ["_validarnumeroremito.php?fcomprobante=19&fnumero=0099-00002746", "GET"], ["grabar_remitos.php?codigo=0", "POST"], ["listado_remitos.php?enviado=1", "POST"], ["paginar_remitos.php?rnd=275836", "POST"], ["paginar_remitos.php", "POST"], ["_comprobantes.php?ftarget=pedidos&ftargetid=157767&rnd=7", "GET"], ["_comprobantes.php?ftarget=pedidos&ftargetid=157767", "GET"]])
    assert.equal(W.rutaEscrituraZ1(r, m), true, `${m} ${r}`)
  for (const [r, m] of [["grabar_ordenfabricacion.php?codigo=9002", "POST"], ["grabar_remitos.php?codigo=5550", "POST"], ["manage_remitos.php?fpedido=1&fborrar=3", "GET"], ["manage_ordenfabricacion.php?ordenfabricacion=9002&ordenfabricacion_unico=1", "GET"], ["remitir_pedido.php?codigo=1", "GET"], ["grabar_pedidos.php?codigo=0", "POST"], ["paginar_pedidos.php", "POST"], ["paginar_remitos.php?rnd=1&fborrar=2", "POST"], ["paginar_remitos.php", "GET"], ["_comprobantes.php?ftarget=pedidos&ftargetid=157767", "POST"], ["_comprobantes.php?ftarget=remitos&ftargetid=157767", "GET"], ["_comprobantes.php?ftarget=pedidos&ftargetid=157767&fborrar=1", "GET"]])
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
    const st = { op: "select", filtros: [], lim: null, cambios: null, conSelect: false, orden: null, columnas: "" }
    const pasa = (row) => st.filtros.every((f) => f(row))
    const filas = () => (db[tabla] ||= []).filter(pasa)
    const correr = () => {
      // Sin la migración 202611191200 (db.sin_mp): las columnas of_mp_* no existen (42703 al leerlas, PGRST204 al escribirlas)
      if (db.sin_mp && tabla === "zomatik_remitos") {
        if (st.op === "select" && /of_mp_/.test(st.columnas)) return { data: null, error: { code: "42703", message: "column zomatik_remitos.of_mp_estado does not exist" } }
        if (st.op === "update" && Object.keys(st.cambios || {}).some((k) => k.startsWith("of_mp_"))) return { data: null, error: { code: "PGRST204", message: "Could not find the 'of_mp_estado' column of 'zomatik_remitos' in the schema cache" } }
      }
      if (st.op === "select") {
        const r = filas().map((x) => ({ ...x }))
        if (st.orden) {
          const [c, asc] = st.orden
          r.sort((a, b) => (String(a[c] ?? "") < String(b[c] ?? "") ? -1 : String(a[c] ?? "") > String(b[c] ?? "") ? 1 : 0) * (asc ? 1 : -1))
        }
        return { data: r.slice(0, st.lim ?? undefined), error: null }
      }
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
        const nuevas = [].concat(st.cambios)
        if (tabla === "integraciones" && nuevas.some((v) => (db[tabla] || []).some((r) => r.clave === v.clave))) return { data: null, error: { code: "23505", message: "duplicate" } }
        // created_at como la base (para ordenar la Actividad)
        ;(db[tabla] ||= []).push(...nuevas.map((v, i) => ({ created_at: new Date(Date.now() + db[tabla].length + i).toISOString(), ...v })))
        return { data: null, error: null }
      }
    }
    const q = {
      select(c) { st.conSelect = true; if (st.op === "select") st.columnas = String(c ?? ""); return q },
      update(c) { st.op = "update"; st.cambios = c; return q },
      delete() { st.op = "delete"; return q },
      insert(c) { st.op = "insert"; st.cambios = c; return q },
      upsert(c) { st.op = "insert"; st.cambios = c; return q },
      // "details->>Marca": un campo de un jsonb, como PostgREST
      eq(c, v) { const [a, b] = c.split("->>"); st.filtros.push((r) => (b ? r[a]?.[b] : r[c]) === v); return q },
      neq(c, v) { st.filtros.push((r) => r[c] !== v); return q },
      in(c, vs) { st.filtros.push((r) => vs.includes(r[c])); return q },
      is(c, v) { st.filtros.push((r) => (r[c] ?? null) === v); return q },
      gte(c, v) { st.filtros.push((r) => String(r[c]) >= v); return q },
      lt(c, v) { st.filtros.push((r) => String(r[c]) < v); return q },
      not(c, op, v) { st.filtros.push((r) => (r[c] ?? null) !== v); return q },
      order(c, o) { st.orden = [c, o?.ascending !== false]; return q },
      limit(n) { st.lim = n; return q },
      async maybeSingle() { const r = correr(); return { data: r.data?.[0] ?? null, error: null } },
      then(ok, mal) { return Promise.resolve(correr()).then(ok, mal) },
    }
    return q
  }
  // Como zomatik_remito_crear (migración 202611161200): un despacho que ya está en otro remito solo entra si lo ya
  // remitido + lo nuevo no pasa sus m³ (la otra parte de un despacho partido); la marca no se repite
  const crearRemito = (x) => {
    const pasa = (d) => {
      const ya = db.zomatik_remito_despachos.filter((l) => l.dispatch_id === d.id)
      if (!ya.length) return false
      const q = (db.dispatches || []).find((z) => z.id === d.id)
      return !q || ya.reduce((s, l) => s + Number(l.m3), 0) + Number(d.m3) > Number(q.quantity_m3) + 0.001
    }
    if (db.zomatik_remitos.some((r) => r.marca === x.marca) || x.despachos.some(pasa)) return null
    const id = `rem-${db.zomatik_remitos.length + 1}`
    db.zomatik_remitos.push({ ...filaRemito({ id }), ...x, despachos: undefined, id, estado: "pendiente" })
    for (const d of x.despachos) db.zomatik_remito_despachos.push({ remito_id: id, dispatch_id: d.id, m3: d.m3 })
    return id
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
      if (nombre === "zomatik_remito_crear") return { data: crearRemito(a.p), error: null }
      // Como la función SQL (migración 202611161200): todos o ninguno
      if (nombre === "zomatik_remitos_crear_juntos") {
        if (db.sin_crear_juntos) return { data: null, error: { code: "PGRST202", message: "Could not find the function public.zomatik_remitos_crear_juntos(p)" } }
        const antes = { r: [...db.zomatik_remitos], l: [...db.zomatik_remito_despachos] }
        const ids = []
        for (const x of a.p.remitos) {
          const id = crearRemito(x)
          if (!id) {
            db.zomatik_remitos = antes.r
            db.zomatik_remito_despachos = antes.l
            return { data: null, error: null }
          }
          ids.push(id)
        }
        return { data: ids, error: null }
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
    zomatik_np: [{ id: "np1", n: 1, numero: "NP 0001-00001169", zomatik_codigo: 157767, estado: "ok", marca: "Sistema Rebucret - pedido 1a2b3c4d - NP 1", paso: "ok", scheduled_dispatch_id: PED, plant_id: PLANTA }],
    formulas: [{ id: "f1", code: "H21", zomatik_articulo_codigo: 10090020, zomatik_articulo_nombre: "H21-620-10 C (CAN)" }],
    zomatik_articulos: [{ codigo: 10090020, nombre: "H21-620-10 C (CAN)", codigo_sistema: 1000015959 }],
    scheduled_dispatches: [{ id: PED, plant_id: PLANTA, construction_sites: { name: "LA TERCERA", address: null, localidad: "CANNING" } }],
    activity_log: [],
  })
}
/** Los materiales de la pantalla "Composicion" real del 19/11 (of-compo.html) */
const MP_FIXTURE = [{ codigo: "10000004", nombre: "CCTS ARENA ESPECIAL", toneladas: 0.93 }, { codigo: "10000026", nombre: "CCTS CEMENTO GRANEL", toneladas: 0.28 }, { codigo: "10000612", nombre: "PIEDRA 6-12", toneladas: 0.95 }]
function depFalsas() {
  const hecho = { navegador: 0, of: [], remito: [], avisos: [], mailsMp: [] }
  return {
    hecho,
    dep: {
      navegador: async () => { hecho.navegador++; return {} },
      avisar: async (_sb, titulo, lineas) => { hecho.avisos.push([titulo, lineas]); return { enviado: true } },
      // El mail a Bautista y Juan de una OF con la materia prima sin descontar (19/11)
      avisarMp: async (_sb, titulo, lineas) => { hecho.mailsMp.push({ titulo, lineas }); return { enviado: true } },
      robot: {
        generarOf: async (_n, d) => { hecho.of.push(d); return { estado: "ok", mensaje: null, numero: "OF 0001-00003412", codigo: 9100, paso: "verificar_of", grabado: true } },
        // La materia prima de la OF (19/11): por defecto pone la marca (alPaso) y queda descontada
        descontarMpOf: async (_n, d, o) => {
          hecho.mp = [...(hecho.mp || []), d]
          if (hecho.respuestaMp) return typeof hecho.respuestaMp === "function" ? hecho.respuestaMp(d, o) : hecho.respuestaMp
          await o.alPaso?.("mp_of", { mp: MP_FIXTURE })
          return { estado: "ok", mensaje: null, numero: d.numero, codigo: d.codigo, paso: "mp_ok", grabado: true, mp: MP_FIXTURE }
        },
        // Remitir la OF (13/11): por defecto, ya FIN (no se manda nada)
        remitirOf: async (_n, d) => { hecho.remitir = [...(hecho.remitir || []), d]; return hecho.respuestaRemitir || { estado: "ok", mensaje: null, numero: "OF 0001-00003412", codigo: d.codigo, paso: "of_remitida" } },
        elegirNumeroRemito: async () => ({ estado: "ok", mensaje: null, numero: "0001-00002260", paso: "elegir_numero" }),
        autorizarNp: async (_n, d) => { hecho.autorizar = [...(hecho.autorizar || []), d]; return hecho.respuestaAutorizar || { estado: "ya", mensaje: null } },
        generarRemito: async (_n, d) => { hecho.remito.push(d); return hecho.respuestaRemito || { estado: "ok", mensaje: null, numero: "RM 0001-00002260", codigo: 5550, paso: "verificar_remito", grabado: true } },
        // Los comprobantes de la NP (antes de la OF): por defecto, sin remitos a mano
        remitoAManoEnNp: async (_n, d) => { hecho.comprobantes = [...(hecho.comprobantes || []), d]; return hecho.respuestaComprobantes ? hecho.respuestaComprobantes(d) : { estado: "libre" } },
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

test("servidor: 6 intentos sin stock (1 hora) → 'revisar' con el aviso de falta de stock", async () => {
  const b = baseZ1({ remito: { of_estado: "ok", of_numero: "OF 0001-00003412", sin_stock: 5 } })
  const f = depFalsas()
  f.hecho.respuestaRemito = { estado: "pendiente", mensaje: "No hay stock.", paso: "continuar_remito", reintentar: true, sinStock: true }
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  assert.equal(b.db.zomatik_remitos[0].estado, "revisar")
  assert.equal(b.db.zomatik_remitos[0].sin_stock, 6)
  assert.equal(f.hecho.avisos[0][0], "Ya se remitió la OF y sigue sin stock")
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

test("datos del cliente (30/10): salen de traerdatossecundarios, provincia fiscal 1 salvo que el formulario traiga otra, sin provincia no frena", async () => {
  const cuerpo = async (z) => {
    const nav = navFalso(z.rutas)
    const r = await R.generarRemito(nav, datosRm(), opts())
    assert.equal(r.estado, "ok", r.mensaje)
    return new URLSearchParams(grabados(nav, "remitos")[0].cuerpo)
  }
  // el cliente sin provincia en Zomatik: 1, no frena
  let b = await cuerpo(zomatikRemito({ secundarios: "\n#||##||##||##||#30715983644#||#3#||#0#||##||#2026-10-30#||#OBRA PROPIA REBUCRET#||##||#3#||#0#||#" }))
  assert.equal(b.get("provincia"), "1")
  assert.equal(b.get("provincia_fiscal"), "1")
  // lo que trae el formulario se respeta: cliente de Capital y fiscal elegida
  const alta = () => fx("remito-alta.html")
    .replace('<option value="4">Capital Federal</option></select>\n<input type="text" name="cp"', '<option value="4" selected>Capital Federal</option></select>\n<input type="text" name="cp"')
    .replace('<select name="provincia_fiscal"><option value="" selected>--</option><option value="1">Buenos Aires</option><option value="4">Capital Federal</option>', '<select name="provincia_fiscal"><option value="">--</option><option value="1">Buenos Aires</option><option value="4" selected>Capital Federal</option>')
    .replace('name="cuit" value=""', 'name="cuit" value="20-11111111-1"')
  b = await cuerpo(zomatikRemito({ alta }))
  assert.equal(b.get("provincia"), "4")
  assert.equal(b.get("provincia_fiscal"), "4")
  assert.equal(b.get("cuit"), "20-11111111-1")
  // una respuesta que no se entiende frena sin grabar, con el recorte
  const nav = navFalso(zomatikRemito({ secundarios: "invalid" }).rutas)
  const r = await R.generarRemito(nav, datosRm(), opts())
  assert.equal(r.estado, "error")
  assert.ok(r.recorte)
  assert.equal(grabados(nav, "remitos").length, 0)
})

test("'Remitir en Zomatik' con una fila en error y el número guardado: usa ese número (el robot lo cambia si ya está usado), sin rehacer la OF", async () => {
  const b = baseZ1({ remito: { estado: "error", of_estado: "ok", of_numero: "OF 0001-00003412", comprobante: "19", remito_estado: "error", remito_numero: "0099-00002756", paso: "formulario_remito", proximo_intento: null } })
  const f = depFalsas()
  let eligio = 0
  f.dep.robot.elegirNumeroRemito = async () => { eligio++; return { estado: "ok", mensaje: null, numero: "0099-00002999", paso: "elegir_numero" } }
  // sin el botón (pasada), una fila en error no se toca
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  assert.equal(f.hecho.remito.length, 0)
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), pedidoId: PED, sb: b.sb, dep: f.dep })
  assert.equal(eligio, 0)
  assert.equal(f.hecho.of.length, 0)
  assert.equal(f.hecho.remito[0].numero, "0099-00002756")
  assert.equal(f.hecho.remito[0].buscarAntes, false)
  assert.equal(b.db.zomatik_remitos[0].estado, "ok")
  // si ya lo usó otro, el robot sigue con el siguiente
  const nav = navFalso(zomatikRemito({ validar: (n) => (n === "0099-00002756" ? USADO(n) : ""), filas: [[5546, "RM2 0099-00002755"]] }).rutas)
  const r = await R.generarRemito(nav, datosRm({ comprobante: "19", numero: "0099-00002756", marca: MARCA }), opts())
  assert.equal(new URLSearchParams(grabados(nav, "remitos")[0].cuerpo).get("numero"), "0099-00002757")
  assert.equal(r.grabado, true)
})

// ── Autorizar la NP del sistema (03/11): filas reales del listado de pedidos ──
import * as NR from "../zomatik/np-robot.ts"
const MARCA_NP = "Sistema Rebucret - pedido 1a2b3c4d - NP 1"
const ROJA = `<tr><td bgcolor="#fe8181">2026-11-03</td><td bgcolor="#fe8181"><a href="modificar_pedidos.php?codigo=157702" class="itemlistado">NP 0001-00001180</a></td><td bgcolor="#fe8181">OBRA PROPIA REBUCRET</td><td bgcolor="#fe8181">$ 176.500</td><td bgcolor="#fe8181">PEN</td><td bgcolor="#fe8181"><a href="#" onclick="return Autorizar(157702);"><img src="images/ico_aut.gif" border="0"></a></td></tr>`
const BLANCA = `<tr><td>2026-11-03</td><td><a href="modificar_pedidos.php?codigo=157702" class="itemlistado">NP 0001-00001180</a></td><td>OBRA PROPIA REBUCRET</td><td>$ 176.500</td><td>PEN</td><td><a href="modificar_remitos.php?pedido=157702">REMITO</a></td></tr>`
const FORM_AUTORIZAR = `<form name="frm_autorizar" method="post" action="_autorizarpedido.php?orden=fechaord desc, codigo desc&torden= "><input type="hidden" name="autorizar" value=""></form>`
function zomatikPedidos({ autorizada = false, marca = MARCA_NP, autoriza = true } = {}) {
  const estado = { autorizada, posts: [] }
  return {
    estado,
    rutas: [
      ["GET", /^listado_pedidos\.php$/, () => resp(`<form action="listado_pedidos.php?enviado=1" method="POST" name="formulario"><input name="bus_numero" value=""><select name="bus_sucursal"><option value="18">REBUCRET</option></select><input type="hidden" name="exportar" value="0"></form>`)],
      ["POST", /^listado_pedidos\.php\?enviado=1$/, ({ suc, cuerpo }) => {
        assert.equal(new URLSearchParams(cuerpo).get("bus_numero"), "0001-00001180")
        return conSuc(suc, `${FORM_AUTORIZAR}<table>${estado.autorizada ? BLANCA : ROJA}</table>`)
      }],
      ["GET", /^modificar_pedidos\.php\?codigo=157702$/, () => resp(`<form action="grabar_pedidos.php?codigo=157702" name="frm_pedido"><textarea name="observaciones">${marca}</textarea></form>`)],
      ["POST", /^_autorizarpedido\.php\?orden=fechaord%20desc,%20codigo%20desc&torden=$/, ({ cuerpo, nav }) => {
        estado.posts.push([cuerpo, nav.llamadas.at(-1).tipo])
        if (autoriza) estado.autorizada = true
        return resp("", 302, "listado_pedidos.php")
      }],
    ],
  }
}
const datosAut = { codigo: 157702, numero: "NP 0001-00001180", marca: MARCA_NP }

test("autorizar NP: fila real en rojo → POST autorizar=<código> y después en blanco con REMITO → 'autorizada'", async () => {
  const z = zomatikPedidos()
  const nav = navFalso(z.rutas)
  const r = await NR.autorizarNp(nav, datosAut)
  assert.equal(r.estado, "autorizada", r.mensaje)
  assert.deepEqual(z.estado.posts, [["autorizar=157702", "application/x-www-form-urlencoded"]])
  // la sucursal 18 justo antes de autorizar
  const i = nav.llamadas.findIndex((l) => /^_autorizarpedido/.test(l.ruta))
  assert.deepEqual([nav.llamadas[i - 1].m, nav.llamadas[i - 1].ruta], ["SUC", "18"])
})

test("autorizar NP: fila en blanco → 'ya' sin mandar nada; sin nuestra marca → nunca se autoriza; si Zomatik no la autoriza → 'sin_autorizar'", async () => {
  let z = zomatikPedidos({ autorizada: true })
  let r = await NR.autorizarNp(navFalso(z.rutas), datosAut)
  assert.equal(r.estado, "ya")
  assert.equal(z.estado.posts.length, 0)
  z = zomatikPedidos({ marca: "cargada a mano" })
  r = await NR.autorizarNp(navFalso(z.rutas), datosAut)
  assert.equal(r.estado, "revisar")
  assert.equal(z.estado.posts.length, 0)
  z = zomatikPedidos({ autoriza: false })
  r = await NR.autorizarNp(navFalso(z.rutas), datosAut)
  assert.equal(r.estado, "sin_autorizar")
  assert.equal(z.estado.posts.length, 1)
  assert.ok(r.recorte)
  // sin el form de autorizar como se leyó → no se manda nada
  z = zomatikPedidos()
  z.rutas.unshift(["POST", /^listado_pedidos\.php\?enviado=1$/, ({ suc }) => conSuc(suc, `<table>${ROJA}</table>`)])
  r = await NR.autorizarNp(navFalso(z.rutas), datosAut)
  assert.equal(r.estado, "sin_autorizar")
  assert.equal(z.estado.posts.length, 0)
  // un error de red no tira: queda sin autorizar
  r = await NR.autorizarNp({ sucursal: async () => true, get: async () => { throw Object.assign(new Error("Zomatik no respondió a tiempo"), { codigo: "sin_respuesta" }) } }, datosAut)
  assert.equal(r.estado, "sin_autorizar")
})

test("autorizar NP: piezas puras y lista cerrada (solo POST a la ruta exacta, solo autorizar=<entero>)", () => {
  assert.deepEqual(N.autorizacionEnListado(ROJA, 157702), { porAutorizar: true, otroAutorizar: false, conRemito: false, roja: true })
  assert.deepEqual(N.autorizacionEnListado(BLANCA, 157702), { porAutorizar: false, otroAutorizar: false, conRemito: true, roja: false })
  assert.equal(N.autorizacionEnListado(ROJA, 15770), null)
  assert.equal(N.tieneFormAutorizar(FORM_AUTORIZAR), true)
  const ruta = "_autorizarpedido.php?orden=fechaord%20desc,%20codigo%20desc&torden="
  assert.equal(W.RUTA_AUTORIZAR_NP, ruta)
  for (const f of [W.rutaEscrituraNp, W.rutaEscrituraZ1]) {
    assert.equal(f(ruta, "POST"), true)
    assert.equal(f(ruta, "GET"), false)
    assert.equal(f("_autorizarpedido.php?orden=x&torden=", "POST"), false)
    assert.equal(f("_autorizarpedido.php", "POST"), false)
  }
  assert.equal(W.rutaPermitida(ruta, "POST"), false)
  assert.equal(W.cuerpoAutorizarValido("autorizar=157702"), true)
  for (const c of ["autorizar=157702&x=1", "autorizar=", "autorizar=1;2", "x=1", "", null]) assert.equal(W.cuerpoAutorizarValido(c), false, String(c))
})

test("Z1: antes del remito la NP se autoriza; sin autorizar el remito espera y la NP queda 'ok' con el aviso", async () => {
  // no se pudo: remito pendiente, sin elegir número ni grabar; la NP 'ok' con paso sin_autorizar y el mensaje
  let b = baseZ1({ remito: { of_estado: "ok", of_numero: "OF 0001-00003412" } })
  let f = depFalsas()
  f.hecho.respuestaAutorizar = { estado: "sin_autorizar", mensaje: "Zomatik no la autorizó" }
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  assert.equal(b.db.zomatik_remitos[0].estado, "pendiente")
  assert.equal(f.hecho.remito.length, 0)
  assert.equal(b.db.zomatik_np[0].estado, "ok")
  assert.equal(b.db.zomatik_np[0].paso, "sin_autorizar")
  assert.match(b.db.zomatik_np[0].mensaje, /^NP sin autorizar en Zomatik/)
  assert.deepEqual(f.hecho.autorizar[0], { codigo: 157767, numero: "NP 0001-00001169", marca: "Sistema Rebucret - pedido 1a2b3c4d - NP 1" })
  // la autoriza: Actividad "NP autorizada en Zomatik" y sigue con el remito
  b = baseZ1({ remito: { of_estado: "ok", of_numero: "OF 0001-00003412" } })
  f = depFalsas()
  f.hecho.respuestaAutorizar = { estado: "autorizada", mensaje: null }
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  assert.equal(b.db.zomatik_np[0].paso, "autorizada")
  assert.ok(b.db.activity_log.some((x) => x.details["Qué pasó"] === "NP autorizada en Zomatik"))
  assert.equal(b.db.zomatik_remitos[0].estado, "ok")
  // ya autorizada (paso guardado): no se vuelve a mirar
  b.db.zomatik_remitos[0] = filaRemito({ id: "rem1", of_estado: "ok" })
  const antes = f.hecho.autorizar.length
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  assert.equal(f.hecho.autorizar.length, antes)
})

test("NP: registrar la autorización (después de generarla y en la pasada)", async () => {
  const { registrarAutorizacion } = await import("../zomatik/np-servidor.ts")
  const fila = { id: "np9", estado: "ok", numero: "NP 0001-00001180", marca: MARCA_NP, paso: "ok", mensaje: null, scheduled_dispatch_id: PED, plant_id: PLANTA }
  const b = baseFalsa({ zomatik_np: [fila], activity_log: [] })
  const avisos = []
  const o = { usuario: "test", avisar: async (_s, t, l) => (avisos.push([t, l]), { enviado: true }) }
  // no se pudo: queda "ok" con el aviso, una sola vez en Actividad
  await registrarAutorizacion(b.sb, { ...fila }, { estado: "sin_autorizar", mensaje: "Zomatik no la autorizó" }, o)
  await registrarAutorizacion(b.sb, { ...b.db.zomatik_np[0] }, { estado: "sin_autorizar", mensaje: "Zomatik no la autorizó" }, o)
  assert.equal(b.db.zomatik_np[0].estado, "ok")
  assert.equal(b.db.zomatik_np[0].paso, "sin_autorizar")
  assert.match(b.db.zomatik_np[0].mensaje, /^NP sin autorizar en Zomatik: Zomatik no la autorizó/)
  assert.equal(b.db.activity_log.filter((x) => x.details["Qué pasó"] === "NP sin autorizar en Zomatik").length, 1)
  // en la pasada se autoriza: paso "autorizada", sin el aviso, y en Actividad
  await registrarAutorizacion(b.sb, { ...b.db.zomatik_np[0] }, { estado: "autorizada", mensaje: null }, o)
  assert.equal(b.db.zomatik_np[0].paso, "autorizada")
  assert.equal(b.db.zomatik_np[0].mensaje, null)
  assert.equal(b.db.activity_log.filter((x) => x.details["Qué pasó"] === "NP autorizada en Zomatik").length, 1)
  // sin la marca: aviso a gerenciales
  await registrarAutorizacion(b.sb, { ...fila, paso: "ok" }, { estado: "revisar", mensaje: "no tiene la marca" }, o)
  assert.equal(b.db.zomatik_np[0].paso, "autorizar_revisar")
  assert.equal(avisos.length, 1)
})

test("pedido programado para mañana y despachado hoy: se remite con fecha de HOY (el día de la pantalla no filtra)", async () => {
  const { hoyAR } = await import("../zomatik/np.ts")
  const hoy = hoyAR()
  const manana = new Date(Date.parse(`${hoy}T12:00:00Z`) + 86400_000).toISOString().slice(0, 10)
  const b = baseZ1()
  b.db.zomatik_remitos = []
  b.db.zomatik_remito_despachos = []
  b.db.zomatik_np_uso = [{ np_id: "np1", m3: 8, created_at: "2026-11-01T10:00:00Z", scheduled_dispatch_id: PED, activo: true }]
  b.db.zomatik_np[0] = { ...b.db.zomatik_np[0], formula_id: "f1", plant_id: PLANTA }
  b.db.dispatches = [{ id: "f635b9ed", scheduled_dispatch_id: PED, quantity_m3: 1, remito: "934", remito_tipo: "R", formula_id: "f1", plant_id: PLANTA, created_at: new Date().toISOString(), dispatch_date: new Date().toISOString(), is_test_dispatch: false, mixers: { license_plate: "AB1" } }]
  // "Remitir en Zomatik" desde la pantalla del día programado (mañana)
  const r = await S.prepararRemitos(PED, manana, "test", b.sb)
  assert.deepEqual(r, { activo: true, creados: 1, problemas: [] })
  assert.equal(b.db.zomatik_remitos[0].fecha, hoy)
  assert.match(b.db.zomatik_remitos[0].marca, new RegExp(` - ${hoy} - NP 1$`))
  assert.deepEqual(b.db.zomatik_remito_despachos.map((x) => x.dispatch_id), ["f635b9ed"])
  // otra vez: ya está remitido, no se duplica
  assert.deepEqual(await S.prepararRemitos(PED, hoy, "test", b.sb), { activo: true, creados: 0, problemas: [] })
  // despachos de dos días distintos: un remito por día
  b.db.dispatches.push({ ...b.db.dispatches[0], id: "ayer1", remito: "930", dispatch_date: new Date(Date.now() - 86400_000).toISOString(), created_at: new Date(Date.now() - 86400_000).toISOString() })
  await S.prepararRemitos(PED, null, "test", b.sb)
  assert.deepEqual(b.db.zomatik_remitos.map((x) => x.fecha).sort(), [Z.ultimosDias(hoy, 2)[1], hoy].sort())
})

// ── Aviso de errores a Bautista (04/11): un mail por episodio ──
test("OF/remito en 'error': un aviso a Bautista; otro error seguido (botón) no repite; el remito que falla después de la OF ok, sí", async () => {
  const b = baseZ1()
  const f = depFalsas()
  const errores = []
  f.dep.avisarError = async (_sb, titulo, lineas) => { errores.push({ titulo, lineas }); return { enviado: true } }
  f.dep.robot.generarOf = async () => ({ estado: "error", mensaje: "Zomatik cambió el formulario de la OF (x). No se mandó nada.", paso: "formulario_of", recorte: "<form>raro</form>" })
  // 1) pendiente → la OF falla: un aviso con la referencia, qué falló, el mensaje, el paso y el recorte
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  assert.equal(b.db.zomatik_remitos[0].estado, "error")
  assert.equal(errores.length, 1)
  assert.equal(errores[0].titulo, "Zomatik: no salió la OF · Pedido 1a2b3c4d")
  const texto = errores[0].lineas.join("\n")
  assert.match(texto, /Pedido 1a2b3c4d · 16 m³ · 2026-10-31/)
  assert.match(texto, /Falló: la OF/)
  assert.match(texto, /Mensaje: Zomatik cambió el formulario de la OF/)
  assert.match(texto, /Paso: formulario_of/)
  assert.match(texto, /recorte\): <form>raro<\/form>/)
  assert.match(texto, /No se reintenta sola: .*Remitir en Zomatik/)
  // 2) "Remitir en Zomatik" y la OF vuelve a fallar: ya estaba en "error", no se repite
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), pedidoId: PED, sb: b.sb, dep: f.dep })
  assert.equal(b.db.zomatik_remitos[0].intentos, 2, "se reintentó")
  assert.equal(errores.length, 1)
  // 3) se corrige: la OF sale ok y ahora falla el remito → es otro error, un aviso
  f.dep.robot.generarOf = async () => ({ estado: "ok", mensaje: null, numero: "OF 0001-00003412", codigo: 9100, paso: "verificar_of", grabado: true })
  f.hecho.respuestaRemito = { estado: "error", mensaje: "A la NP le quedan 8 m³ pendientes.", paso: "continuar_remito" }
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), pedidoId: PED, sb: b.sb, dep: f.dep })
  assert.equal(b.db.zomatik_remitos[0].of_estado, "ok")
  assert.equal(b.db.zomatik_remitos[0].remito_estado, "error")
  assert.equal(errores.length, 2)
  assert.equal(errores[1].titulo, "Zomatik: no salió el remito · Pedido 1a2b3c4d")
  assert.match(errores[1].lineas.join("\n"), /Falló: el remito \(la OF 0001-00003412 ya está hecha\)/)
  // 4) el remito vuelve a fallar con el botón: no se repite
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), pedidoId: PED, sb: b.sb, dep: f.dep })
  assert.equal(errores.length, 2)
  // a los gerenciales no les llega nada por un "error"
  assert.equal(f.hecho.avisos.length, 0)
})

test("sin stock no manda el aviso de error: pendiente mientras reintenta y, a la hora, solo el aviso de 'revisar' de siempre", async () => {
  for (const sin_stock of [1, 5]) {
    const b = baseZ1({ remito: { of_estado: "ok", of_numero: "OF 0001-00003412", sin_stock } })
    const f = depFalsas()
    const errores = []
    f.dep.avisarError = async (_sb, titulo) => { errores.push(titulo); return { enviado: true } }
    f.hecho.respuestaRemito = { estado: "pendiente", mensaje: "No hay stock.", paso: "continuar_remito", reintentar: true, sinStock: true }
    await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
    assert.equal(b.db.zomatik_remitos[0].estado, sin_stock === 5 ? "revisar" : "pendiente")
    assert.deepEqual(errores, [])
    assert.equal(f.hecho.avisos.length, sin_stock === 5 ? 1 : 0)
  }
})

// ── Revisión del 04/11: caídas del robot, entrada a Zomatik y pendientes largos ──
const avisosZ1 = (f) => {
  const errores = []
  f.dep.avisarError = async (_sb, titulo, lineas) => { errores.push({ titulo, lineas }); return { enviado: true } }
  return errores
}

test("caída del robot (vuelve a 'pendiente'): un aviso; mismo tipo y paso con otro texto no repite; otro paso, sí", async (t) => {
  t.mock.method(console, "error", () => {})
  // recién creada (si no, al segundo intento también llega el de "más de 1 hora")
  const b = baseZ1({ remito: { created_at: new Date().toISOString() } })
  const f = depFalsas()
  const errores = avisosZ1(f)
  let n = 0
  f.dep.robot.generarOf = async (_n, _d, o) => { n++; await o.alPaso("formulario_of"); throw new TypeError(`x.y is not a function (${n})`) }
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  assert.equal(b.db.zomatik_remitos[0].estado, "pendiente")
  assert.equal(errores.length, 1)
  assert.equal(errores[0].titulo, "El robot de Zomatik se cayó con la OF · Pedido 1a2b3c4d")
  assert.match(errores[0].lineas.join("\n"), /Qué se estaba haciendo: la OF · paso formulario_of[\s\S]*Mensaje: Error interno: x\.y is not a function \(1\)/)
  // vuelve a caer igual (otro texto): no se repite
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), pedidoId: PED, sb: b.sb, dep: f.dep })
  assert.equal(b.db.zomatik_remitos[0].intentos, 2, "se reintentó")
  assert.equal(errores.length, 1)
  // se cae en otro paso: otro episodio
  f.dep.robot.generarOf = async (_n, _d, o) => { await o.alPaso("grabar_of", { foto: ["0001-1"], fotoDia: HOY }); throw new TypeError("otra cosa") }
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), pedidoId: PED, sb: b.sb, dep: f.dep })
  assert.equal(errores.length, 2)
  assert.equal(f.hecho.avisos.length, 0, "a los gerenciales no")
})

test("no se puede entrar a Zomatik: un solo mail con textos distintos; si la NP ya avisó, Z1 no repite; al entrar, 'volvió'", async (t) => {
  t.mock.method(console, "error", () => {})
  const b = baseZ1()
  // login() dejó el bloqueo de una entrada que falló de verdad (el login_bloqueado cuenta como falla de entrada)
  b.db.integraciones = [{ clave: "zomatik_login_bloqueado", valor: new Date(Date.now() + 20 * 60_000).toISOString() }]
  const f = depFalsas()
  const errores = avisosZ1(f)
  const textos = ["No se reintenta hasta las 10:40", "No se reintenta hasta las 10:50", "No se pudo conectar con Zomatik"]
  for (const [i, m] of textos.entries()) {
    f.dep.navegador = async () => { throw Object.assign(new Error(m), { codigo: i < 2 ? "login_bloqueado" : "sin_respuesta" }) }
    await S.procesarZ1({ usuario: "test", inicio: Date.now(), pedidoId: PED, sb: b.sb, dep: f.dep })
    assert.equal(b.db.zomatik_remitos[0].estado, "pendiente")
  }
  assert.deepEqual(errores.map((x) => x.titulo), ["Zomatik: el robot no puede entrar"])
  // vuelve a entrar: "volvió" y sigue con la OF y el remito
  f.dep.navegador = async () => ({})
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), pedidoId: PED, sb: b.sb, dep: f.dep })
  assert.deepEqual(errores.map((x) => x.titulo), ["Zomatik: el robot no puede entrar", "Zomatik volvió a andar"])
  assert.equal(b.db.zomatik_remitos[0].estado, "ok")
  // la marca es una sola para todo el robot: si la NP ya avisó la caída, Z1 no manda otro
  const b2 = baseZ1()
  b2.db.integraciones = [{ clave: "zomatik_aviso_entrada", valor: new Date().toISOString() }]
  const f2 = depFalsas()
  const e2 = avisosZ1(f2)
  f2.dep.navegador = async () => { throw Object.assign(new Error("Zomatik rechazó el usuario"), { codigo: "login_rechazado" }) }
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b2.sb, dep: f2.dep })
  assert.deepEqual(e2, [])
})

test("remito pendiente por red más de 1 hora: un aviso a Bautista, una sola vez (sin stock no cuenta)", async (t) => {
  t.mock.method(console, "error", () => {})
  const b = baseZ1() // la fila es del 31/10: hace más de 1 hora
  const f = depFalsas()
  const errores = avisosZ1(f)
  f.dep.robot.generarOf = async () => ({ estado: "pendiente", mensaje: "Zomatik no respondió a tiempo", paso: "formulario_of", reintentar: true })
  for (let i = 0; i < 4; i++) await S.procesarZ1({ usuario: "test", inicio: Date.now(), pedidoId: PED, sb: b.sb, dep: f.dep })
  assert.equal(b.db.zomatik_remitos[0].estado, "pendiente")
  assert.deepEqual(errores.map((x) => x.titulo), ["OF pendiente hace más de 1 hora · Pedido 1a2b3c4d"])
  assert.match(errores[0].lineas.join("\n"), /Último mensaje: Zomatik no respondió a tiempo/)
  // sin stock tiene su propio aviso a la hora ("revisar"): no se suma este
  const b2 = baseZ1({ remito: { of_estado: "ok", of_numero: "OF 0001-00003412", intentos: 3 } })
  const f2 = depFalsas()
  const e2 = avisosZ1(f2)
  f2.hecho.respuestaRemito = { estado: "pendiente", mensaje: "No hay stock.", paso: "continuar_remito", reintentar: true, sinStock: true }
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), pedidoId: PED, sb: b2.sb, dep: f2.dep })
  assert.deepEqual(e2, [])
})

// ── Caso A.A. ARQUITECTURA (10/11): NP1 anulada sin número, NP2 0001-00002099 (X) por 7 m³; viajes 0966 (R, 3 m³) y 3321 (X, 4 m³) ──
test("A.A.: el remito sale con los viajes que coinciden con la NP (R/X), no con la foto de la NP anulada; un viaje R con una NP2 queda afuera con aviso", async () => {
  const { hoyAR } = await import("../zomatik/np.ts")
  const hoy = hoyAR()
  const b = baseZ1()
  b.db.zomatik_remitos = []
  b.db.zomatik_remito_despachos = []
  b.db.zomatik_np = [
    { id: "np-a", n: 1, numero: null, zomatik_codigo: null, estado: "anulada", formula_id: "f1", plant_id: PLANTA, scheduled_dispatch_id: PED },
    { id: "np-b", n: 2, numero: "NP2 0001-00002099", zomatik_codigo: 157800, estado: "ok", formula_id: "f1", plant_id: PLANTA, scheduled_dispatch_id: PED },
  ]
  b.db.zomatik_np_uso = [
    { np_id: "np-a", m3: 6, created_at: "2026-11-06T02:08:30Z", scheduled_dispatch_id: PED, activo: false, despachado_fijo: 0 },
    { np_id: "np-b", m3: 7, created_at: "2026-11-06T18:21:24Z", scheduled_dispatch_id: PED, activo: true, despachado_fijo: null },
  ]
  const viaje = (id, m3, remito, tipo, h) => ({ id, scheduled_dispatch_id: PED, quantity_m3: m3, remito, remito_tipo: tipo, formula_id: "f1", plant_id: PLANTA, created_at: `${hoy}T${h}:00:00.000Z`, dispatch_date: `${hoy}T${h}:00:00.000Z`, is_test_dispatch: false, mixers: { license_plate: "AG083GT" } })
  b.db.dispatches = [viaje("d-0966", 3, "0966", "R", "13"), viaje("d-3321", 4, "3321", "X", "18")]
  const r = await S.prepararRemitos(PED, hoy, "test", b.sb)
  assert.equal(r.creados, 1)
  assert.match(r.problemas.join(" "), /0966 \(3 m³\) no coincide con ninguna NP del pedido \(R\/X/)
  assert.equal(Number(b.db.zomatik_remitos[0].m3), 4)
  assert.equal(b.db.zomatik_remitos[0].comprobante, "19")
  // Si el viaje 0966 era en realidad X (se corrige el despacho), la pasada arma un segundo remito por los 3 m³ que
  // le quedan a la NP (7 − 4 ya en el primer remito, con su OF ya grabada): no se toca el primero.
  b.db.dispatches[0].remito_tipo = "X"
  const r2 = await S.prepararRemitos(PED, hoy, "test", b.sb)
  assert.deepEqual(r2, { activo: true, creados: 1, problemas: [] })
  assert.deepEqual(b.db.zomatik_remitos.map((x) => Number(x.m3)), [4, 3])
  assert.equal(b.db.zomatik_remitos[1].marca, Z.marcaZ1(PED, hoy, 2, 2)) // la marca no se repite
  assert.deepEqual(b.db.zomatik_remito_despachos.map((x) => x.dispatch_id), ["d-3321", "d-0966"])
})

// ── Remito hecho a mano (10/11): el robot nunca repite lo que ya se remitió en Zomatik ──
test("a mano: los remitos de la NP que no son nuestros (por código o número, con su prefijo); no se comparan m³", () => {
  const rms = [{ codigo: 218176, numero: "RM2 0099-00002758" }]
  assert.deepEqual(Z.remitosAjenos(rms, []), rms)
  assert.deepEqual(Z.remitosAjenos(rms, [{ numero: "RM2 0099-00002758" }]), [])
  assert.deepEqual(Z.remitosAjenos(rms, [{ numero: "RM2 99-2758" }]), [])
  assert.deepEqual(Z.remitosAjenos(rms, [{ numero: null, codigo: 218176 }]), [])
  // el número que la fila guardó antes de grabar (sin prefijo): el del comprobante
  assert.deepEqual(Z.remitosAjenos(rms, [{ numero: "0099-00002758", comprobante: "19" }]), [])
  assert.deepEqual(Z.remitosAjenos(rms, [{ numero: "0099-00002758", comprobante: "7" }]), rms) // RM no es RM2
  assert.deepEqual(Z.remitosAjenos(rms, [{ numero: "RM2 0099-00002759", codigo: 218177 }]), rms)
  // un número que no se entiende cuenta como ajeno (no se sigue a ciegas)
  assert.deepEqual(Z.remitosAjenos([{ codigo: 1, numero: "???" }], [{ numero: "RM2 0099-00002758" }]).length, 1)
  assert.equal(Z.claveRemito("RM2 0099-00002765"), "RM2 0099-00002765")
  assert.equal(Z.claveRemito("0001-00002280", "7"), "RM 0001-00002280")
  assert.equal(Z.claveRemito(null), null)
  assert.equal(Z.msjRemitoAMano(["RM2 0099-00002765"]), "Ya estaba remitido a mano en Zomatik (RM2 0099-00002765): el robot no lo repite")
})

test("a mano: leer los comprobantes de la NP es solo lectura, en la sucursal 18; si no se entienden, 'ilegible'", async () => {
  const rutas = (r) => [["GET", /^_comprobantes\.php\?ftarget=pedidos&ftargetid=157767&rnd=7$/, r]]
  let nav = navFalso(rutas(() => resp(fxA("comprobantes-sin-nada.html"))))
  nav.suc = "17"
  assert.deepEqual(await R.remitoAManoEnNp(nav, { npCodigo: 157767, nuestros: [] }, { azar: () => 7 }), { estado: "libre" })
  assert.deepEqual(nav.llamadas.map((l) => (l.m === "SUC" ? [l.m, l.ruta] : [l.m, l.ruta, l.suc])), [["SUC", "18"], ["GET", "_comprobantes.php?ftarget=pedidos&ftargetid=157767&rnd=7", "18"]])
  nav = navFalso(rutas(() => resp(fxA("comprobantes-con-factura.html"))))
  assert.deepEqual(await R.remitoAManoEnNp(nav, { npCodigo: 157767, nuestros: [] }, { azar: () => 7 }), { estado: "a_mano", numeros: ["RM2 0099-00002758"], propio: null })
  assert.deepEqual(await R.remitoAManoEnNp(nav, { npCodigo: 157767, nuestros: [{ numero: "RM2 0099-00002758", codigo: 218176 }] }, { azar: () => 7 }), { estado: "libre" })
  for (const r of [() => resp(fxA("comprobantes-sin-nada.html"), 500), () => resp("<html><body>Error</body></html>"), () => resp("")]) {
    const x = await R.remitoAManoEnNp(navFalso(rutas(r)), { npCodigo: 157767, nuestros: [] }, { azar: () => 7 })
    assert.equal(x.estado, "ilegible")
    assert.equal(x.mensaje, Z.MSJ_COMPROBANTES_ILEGIBLES)
  }
  // sin código de NP no se pide nada
  nav = navFalso([])
  assert.equal((await R.remitoAManoEnNp(nav, { npCodigo: 0, nuestros: [] })).estado, "ilegible")
  assert.equal(nav.llamadas.length, 0)
  // red o sesión: la excepción sigue (quien llama deja la fila pendiente)
  await assert.rejects(R.remitoAManoEnNp(navFalso(rutas(() => { throw Object.assign(new Error("Zomatik no respondió a tiempo"), { codigo: "sin_respuesta" }) })), { npCodigo: 157767, nuestros: [] }, { azar: () => 7 }), /no respondió/)
})

test("a mano: justo antes de grabar el remito se vuelven a leer los comprobantes; un remito ajeno o ilegible → no se graba", async () => {
  // ajeno: no se graba y vuelve el número leído
  let z = zomatikRemito({ comprobantes: () => resp(fxA("comprobantes-con-factura.html")) })
  let nav = navFalso(z.rutas)
  const pasos = []
  let r = await R.generarRemito(nav, datosRm({ nuestros: [] }), opts({ alPaso: (p) => pasos.push(p) }))
  assert.equal(r.estado, "revisar")
  assert.deepEqual(r.aMano, ["RM2 0099-00002758"])
  assert.equal(r.mensaje, "Ya estaba remitido a mano en Zomatik (RM2 0099-00002758): el robot no lo repite")
  assert.equal(grabados(nav, "remitos").length, 0)
  assert.equal(pasos.includes("grabar_remito"), false)
  // la lectura va después de validar el número y es lo último antes de grabar (sin abrir de nuevo el alta)
  z = zomatikRemito()
  nav = navFalso(z.rutas)
  r = await R.generarRemito(nav, datosRm({ nuestros: [] }), opts())
  assert.equal(r.estado, "ok", r.mensaje)
  const ic = nav.llamadas.findIndex((l) => /^_comprobantes/.test(l.ruta))
  const iv = nav.llamadas.findIndex((l) => /^_validarnumeroremito/.test(l.ruta))
  const ig = nav.llamadas.findIndex((l) => /^grabar_remitos/.test(l.ruta))
  assert.ok(iv < ic && ic === ig - 1, JSON.stringify(nav.llamadas.map((l) => l.ruta)))
  assert.equal(nav.llamadas.filter((l) => /^modificar_remitos\.php\?pedido=/.test(l.ruta)).length, 1)
  assert.equal(nav.llamadas[ig].suc, "18")
  // el remito de la NP es nuestro (ya remitido por el sistema otro día): se graba
  nav = navFalso(zomatikRemito({ comprobantes: () => resp(fxA("comprobantes-con-factura.html")) }).rutas)
  r = await R.generarRemito(nav, datosRm({ nuestros: [{ numero: "RM2 0099-00002758", codigo: 218176 }] }), opts())
  assert.equal(r.estado, "ok", r.mensaje)
  assert.equal(grabados(nav, "remitos").length, 1)
  // ilegible: pendiente, se reintenta, no se graba
  nav = navFalso(zomatikRemito({ comprobantes: () => resp("<html>Error</html>", 500) }).rutas)
  r = await R.generarRemito(nav, datosRm({ nuestros: [] }), opts())
  assert.equal(r.estado, "pendiente")
  assert.equal(r.reintentar, true)
  assert.equal(grabados(nav, "remitos").length, 0)
  // sin la lista de los nuestros, cualquier remito de la NP cuenta como a mano
  nav = navFalso(zomatikRemito({ comprobantes: () => resp(fxA("comprobantes-con-factura.html")) }).rutas)
  r = await R.generarRemito(nav, datosRm({ nuestros: undefined }), opts())
  assert.deepEqual(r.aMano, ["RM2 0099-00002758"])
  assert.equal(grabados(nav, "remitos").length, 0)
})

test("servidor, a mano: la NP ya tiene un remito que no es nuestro → ni OF ni remito; 'ok' con el remito 'a_mano', el número y Actividad", async () => {
  const b = baseZ1()
  const f = depFalsas()
  f.hecho.respuestaComprobantes = () => ({ estado: "a_mano", numeros: ["RM2 0099-00002765"] })
  const res = await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  const fila = b.db.zomatik_remitos[0]
  assert.equal(f.hecho.of.length, 0)
  assert.equal(f.hecho.remito.length, 0)
  assert.equal(fila.estado, "ok")
  assert.equal(fila.remito_estado, "a_mano")
  assert.equal(fila.remito_numero, "RM2 0099-00002765")
  assert.equal(fila.mensaje, "Ya estaba remitido a mano en Zomatik (RM2 0099-00002765): el robot no lo repite")
  assert.equal(fila.proximo_intento, null)
  assert.equal(fila.en_curso_desde, null)
  assert.deepEqual(res.hechas, [{ id: "rem1", estado: "ok", mensaje: fila.mensaje }])
  assert.ok(b.db.activity_log.some((a) => a.details?.["Qué pasó"] === fila.mensaje), "queda en Actividad")
  assert.equal(f.hecho.comprobantes[0].npCodigo, 157767)
  // ya cerrada: la pasada no la vuelve a tomar
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  assert.equal(f.hecho.comprobantes.length, 1)
  assert.equal(f.hecho.of.length, 0)
  // con la OF ya hecha por el robot: tampoco hay remito y la OF queda como estaba
  const b2 = baseZ1({ remito: { of_estado: "ok", of_numero: "OF 0001-00003412" } })
  const f2 = depFalsas()
  f2.hecho.respuestaComprobantes = f.hecho.respuestaComprobantes
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b2.sb, dep: f2.dep })
  assert.equal(f2.hecho.remito.length, 0)
  assert.deepEqual([b2.db.zomatik_remitos[0].estado, b2.db.zomatik_remitos[0].of_estado, b2.db.zomatik_remitos[0].remito_estado], ["ok", "ok", "a_mano"])
})

test("servidor, a mano: los comprobantes no se pueden leer (o se cae la red) → 'pendiente' y se reintenta, sin OF ni remito", async (t) => {
  t.mock.method(console, "error", () => {})
  const b = baseZ1({ remito: { created_at: new Date().toISOString() } })
  const f = depFalsas()
  f.hecho.respuestaComprobantes = () => ({ estado: "ilegible", mensaje: Z.MSJ_COMPROBANTES_ILEGIBLES })
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  let fila = b.db.zomatik_remitos[0]
  assert.equal(f.hecho.of.length, 0)
  assert.equal(f.hecho.remito.length, 0)
  assert.deepEqual([fila.estado, fila.of_estado, fila.paso, fila.mensaje], ["pendiente", "pendiente", "comprobantes_np", Z.MSJ_COMPROBANTES_ILEGIBLES])
  assert.ok(Date.parse(fila.proximo_intento) > Date.now(), "se reintenta en la próxima pasada")
  // red: la excepción deja la fila pendiente (como cualquier corte)
  f.hecho.respuestaComprobantes = () => { throw Object.assign(new Error("Zomatik no respondió a tiempo"), { codigo: "sin_respuesta" }) }
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), pedidoId: PED, sb: b.sb, dep: f.dep })
  fila = b.db.zomatik_remitos[0]
  assert.equal(fila.estado, "pendiente")
  assert.equal(f.hecho.of.length, 0)
  // vuelve a leerse bien: sigue con la OF y el remito
  f.hecho.respuestaComprobantes = null
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), pedidoId: PED, sb: b.sb, dep: f.dep })
  assert.equal(b.db.zomatik_remitos[0].estado, "ok")
  assert.equal(b.db.zomatik_remitos[0].remito_estado, "ok")
  assert.equal(f.hecho.of.length, 1)
})

test("servidor, a mano: se hizo a mano entre la OF y el remito → la OF queda, el remito no se graba y la fila se cierra 'a_mano'", async () => {
  const b = baseZ1()
  const f = depFalsas()
  f.hecho.respuestaRemito = { estado: "revisar", aMano: ["RM 0001-00002281"], mensaje: Z.msjRemitoAMano(["RM 0001-00002281"]), paso: "comprobantes_np" }
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  const fila = b.db.zomatik_remitos[0]
  assert.equal(f.hecho.of.length, 1)
  assert.deepEqual([fila.estado, fila.of_estado, fila.of_numero, fila.remito_estado, fila.remito_numero], ["ok", "ok", "OF 0001-00003412", "a_mano", "RM 0001-00002281"])
  assert.equal(fila.mensaje, "Ya estaba remitido a mano en Zomatik (RM 0001-00002281): el robot no lo repite")
  assert.equal(f.hecho.avisos.length, 0, "no es un 'revisar': no hay aviso")
})

test("servidor, a mano: 'nuestros' = los remitos ok del sistema contra esa NP (no los 'a_mano') y los de otras filas que quedaron después de Grabar", async () => {
  // la fila guardó un número pero nunca llegó a Grabar: no es "propio"
  const b = baseZ1({ remito: { of_estado: "ok", of_numero: "OF 0001-00003412", remito_numero: "0001-00002261" } })
  b.db.zomatik_remitos.push(
    filaRemito({ id: "rem-ok", marca: "otra-1", estado: "ok", remito_estado: "ok", remito_numero: "RM 0001-00002250", remito_codigo: 5540 }),
    filaRemito({ id: "rem-mano", marca: "otra-2", estado: "ok", remito_estado: "a_mano", remito_numero: "RM 0001-00002251" }),
    filaRemito({ id: "rem-otra-np", marca: "otra-3", np_id: "np9", estado: "ok", remito_estado: "ok", remito_numero: "RM 0001-00002252" }),
    filaRemito({ id: "rem-rev", marca: "otra-4", estado: "revisar", remito_estado: "revisar", remito_numero: "0001-00002253", paso: "verificar_remito", proximo_intento: null }),
    filaRemito({ id: "rem-busca", marca: "otra-5", estado: "revisar", remito_estado: "revisar", remito_numero: "0001-00002254", paso: "buscar_remito", proximo_intento: null }),
    filaRemito({ id: "rem-antes", marca: "otra-6", estado: "revisar", remito_estado: "revisar", remito_numero: "0001-00002255", paso: "continuar_remito", proximo_intento: null }),
    filaRemito({ id: "rem-anulado", marca: "otra-7", estado: "anulado", remito_numero: "0001-00002256", paso: "verificar_remito", proximo_intento: null }),
  )
  const f = depFalsas()
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  const esperado = [{ numero: "RM 0001-00002250", codigo: 5540, comprobante: "7" }, { numero: "0001-00002253", codigo: null, comprobante: "7" }, { numero: "0001-00002254", codigo: null, comprobante: "7" }]
  assert.deepEqual(f.hecho.comprobantes[0].nuestros, esperado)
  assert.equal(f.hecho.comprobantes[0].propio, null)
  assert.deepEqual(f.hecho.remito[0].nuestros, esperado)
  // un remito del robot en "revisar" (verificar_remito) que está en la NP no cierra otra fila como "a mano"
  const nav = navFalso([["GET", /^_comprobantes\.php\?ftarget=pedidos&ftargetid=157767&rnd=7$/, () => resp(fxA("comprobantes-con-factura.html"))]])
  assert.deepEqual(await R.remitoAManoEnNp(nav, { npCodigo: 157767, nuestros: [{ numero: "0099-00002758", codigo: null, comprobante: "19" }] }, { azar: () => 7 }), { estado: "libre" })
})

test("servidor, a mano: un pedido con la NP sin código de Zomatik no hace la OF (no se pueden leer sus comprobantes)", async () => {
  const b = baseZ1()
  b.db.zomatik_np[0].zomatik_codigo = null
  const f = depFalsas()
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  assert.equal(f.hecho.of.length, 0)
  assert.equal(f.hecho.comprobantes, undefined)
  // lo que no salió es la OF (el mail lo dice así)
  assert.deepEqual([b.db.zomatik_remitos[0].estado, b.db.zomatik_remitos[0].of_estado, b.db.zomatik_remitos[0].remito_estado, b.db.zomatik_remitos[0].mensaje], ["error", "error", "pendiente", "La NP del remito no está en Zomatik."])
})

test("servidor, a mano: un despacho sin pedido (sin NP) no lee comprobantes: solo la OF, como siempre", async () => {
  const b = baseZ1({ remito: { tipo: "suelto", np_id: null, comprobante: null } })
  const f = depFalsas()
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  assert.equal(f.hecho.comprobantes, undefined)
  assert.equal(f.hecho.of.length, 1)
  assert.equal(b.db.zomatik_remitos[0].remito_estado, "a_mano")
})

test("servidor, a mano: un mail a Bautista por fila cerrada (antes de la OF o antes de grabar), con cliente, fecha, m³, NP y el remito; nunca repetido", async () => {
  const b = baseZ1()
  b.db.scheduled_dispatches[0].clients = { name: "FELICIANO" }
  const f = depFalsas()
  const errores = avisosZ1(f)
  f.hecho.respuestaComprobantes = () => ({ estado: "a_mano", numeros: ["RM2 0099-00002765"] })
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  assert.equal(errores.length, 1)
  assert.equal(errores[0].titulo, "Remito hecho a mano: el robot no lo repitió · Pedido 1a2b3c4d")
  assert.deepEqual(errores[0].lineas.slice(0, 4), [
    "Cliente: FELICIANO",
    `Fecha: ${HOY} · 16 m³ · NP: NP 0001-00001169`,
    "Remito que ya estaba en Zomatik: RM2 0099-00002765",
    "El robot no lo hizo para no duplicar: revisá que ese remito cubra estos m³.",
  ])
  assert.equal(f.hecho.avisos.length, 0, "a los gerenciales no")
  // otra pasada y el botón: la fila ya está cerrada, no llega otro mail
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), pedidoId: PED, sb: b.sb, dep: f.dep })
  assert.equal(errores.length, 1)
  // justo antes de grabar: también un mail, con el remito que encontró
  const b2 = baseZ1()
  const f2 = depFalsas()
  const e2 = avisosZ1(f2)
  f2.hecho.respuestaRemito = { estado: "revisar", aMano: ["RM 0001-00002281"], mensaje: Z.msjRemitoAMano(["RM 0001-00002281"]), paso: "comprobantes_np" }
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b2.sb, dep: f2.dep })
  assert.equal(e2.length, 1)
  assert.equal(e2[0].lineas[0], "Cliente: (sin cliente)")
  assert.equal(e2[0].lineas[2], "Remito que ya estaba en Zomatik: RM 0001-00002281")
  // ilegible (pendiente) no manda este mail
  const b3 = baseZ1({ remito: { created_at: new Date().toISOString() } })
  const f3 = depFalsas()
  const e3 = avisosZ1(f3)
  f3.hecho.respuestaComprobantes = () => ({ estado: "ilegible", mensaje: Z.MSJ_COMPROBANTES_ILEGIBLES })
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b3.sb, dep: f3.dep })
  assert.equal(e3.filter((x) => /hecho a mano/.test(x.titulo)).length, 0)
})

// ── Revisión del 10/11 ──
const COMP_DOS = fxA("comprobantes-con-factura.html").replace('<tr>\n\t\t\t\t\t\t<td class="itemformulario">', '<tr><td class="itemformulario"><a href="modificar_remitos.php?codigo=218177" target="_blank">RM2 0099-00002759</a></td></tr>\n\t\t\t\t\t<tr>\n\t\t\t\t\t\t<td class="itemformulario">')

test("comprobantes de la NP: una fila sin link conocido o un remito que no vino como link → no se pudo leer (null)", () => {
  assert.equal(A.comprobantesDeNp(COMP_DOS).remitos.length, 2)
  const base = fxA("comprobantes-sin-nada.html")
  const conFila = (td) => base.replace("</table>", `<tr><td class="itemformulario">${td}</td></tr></table>`)
  // las que se leen
  assert.deepEqual(A.comprobantesDeNp(conFila('<a href="modificar_remitos.php?codigo=9">RM 0001-00002281</a> <a href="imprimir_remito.php?codigo=9"><img src="x.png"></a>')).remitos, [{ codigo: 9, numero: "RM 0001-00002281" }])
  assert.deepEqual(A.comprobantesDeNp(conFila("  ")), { remitos: [], facturas: [] }) // fila vacía
  // las que no: remito como texto, link de otro tipo, imagen sola, remito fuera de la tabla
  assert.equal(A.comprobantesDeNp(conFila("RM2 0099-00002765")), null)
  assert.equal(A.comprobantesDeNp(conFila('<a href="modificar_devoluciones.php?codigo=4">DV 0001-00000012</a>')), null)
  assert.equal(A.comprobantesDeNp(conFila('<img src="x.png">')), null)
  assert.equal(A.comprobantesDeNp(conFila('<a href="modificar_remitos.php?codigo=9">RM 0001-00002281</a> y RM 0001-00002282')), null)
  assert.equal(A.comprobantesDeNp(base.replace("</table>", "</table><p>RM 0001-00002283</p>")), null)
})

test("a mano, corte al grabar: el número propio en la NP no cuenta como a mano; con otro más, vuelve como 'propio' para no pisarlo", async () => {
  const nav = navFalso([["GET", /^_comprobantes\.php\?ftarget=pedidos&ftargetid=157767&rnd=7$/, () => resp(COMP_DOS)]])
  const propio = { numero: "0099-00002758", codigo: null, comprobante: "19" }
  assert.deepEqual(await R.remitoAManoEnNp(nav, { npCodigo: 157767, nuestros: [], propio }, { azar: () => 7 }), { estado: "a_mano", numeros: ["RM2 0099-00002759"], propio: "RM2 0099-00002758" })
  const nav1 = navFalso([["GET", /^_comprobantes/, () => resp(fxA("comprobantes-con-factura.html"))]])
  assert.deepEqual(await R.remitoAManoEnNp(nav1, { npCodigo: 157767, nuestros: [], propio }, { azar: () => 7 }), { estado: "libre" })
  // sin el propio, los dos son ajenos y propio queda vacío
  assert.deepEqual(await R.remitoAManoEnNp(nav, { npCodigo: 157767, nuestros: [] }, { azar: () => 7 }), { estado: "a_mano", numeros: ["RM2 0099-00002759", "RM2 0099-00002758"], propio: null })
})

test("servidor, corte al grabar y después un remito a mano: no pisa el número del robot; nombra los dos en el mensaje, Actividad y el mail", async () => {
  const b = baseZ1({ remito: { comprobante: "19", of_estado: "ok", of_numero: "OF 0001-00003412", remito_numero: "0099-00002758", paso: "grabar_remito", estado: "pendiente" } })
  const f = depFalsas()
  const errores = avisosZ1(f)
  f.hecho.respuestaComprobantes = (d) => (d.propio ? { estado: "a_mano", numeros: ["RM2 0099-00002759"], propio: "RM2 0099-00002758" } : { estado: "a_mano", numeros: ["RM2 0099-00002759", "RM2 0099-00002758"], propio: null })
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  const fila = b.db.zomatik_remitos[0]
  assert.deepEqual(f.hecho.comprobantes[0].propio, { numero: "0099-00002758", codigo: null, comprobante: "19" })
  assert.equal(f.hecho.remito.length, 0)
  assert.deepEqual([fila.estado, fila.remito_estado, fila.remito_numero], ["ok", "a_mano", "0099-00002758"]) // no se pisó
  const dos = "Puede haber dos remitos: RM2 0099-00002758 (robot) y RM2 0099-00002759 (a mano), revisalos. El robot no hizo otro."
  assert.ok(fila.mensaje.includes(dos), fila.mensaje)
  const act = b.db.activity_log.find((a) => a.details?.["Remito del robot"])
  assert.deepEqual([act.details["Remito del robot"], act.details["Remito a mano"]], ["RM2 0099-00002758", "RM2 0099-00002759"])
  assert.equal(errores.length, 1)
  assert.ok(errores[0].lineas.includes(dos))
  // sin corte (el número guardado nunca se grabó): no hay "propio" y se guarda el número leído
  const b2 = baseZ1({ remito: { of_estado: "ok", of_numero: "OF 0001-00003412", remito_numero: "0001-00002261", paso: "continuar_remito" } })
  const f2 = depFalsas()
  f2.hecho.respuestaComprobantes = () => ({ estado: "a_mano", numeros: ["RM 0001-00002261"], propio: null })
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b2.sb, dep: f2.dep })
  assert.equal(f2.hecho.comprobantes[0].propio, null)
  assert.equal(b2.db.zomatik_remitos[0].remito_numero, "RM 0001-00002261")
})

test("servidor: si falla la base al leer los datos del remito → 'pendiente' (reintento), no 'error'; el mail dice si era la OF o el remito", async (t) => {
  t.mock.method(console, "error", () => {})
  for (const [of, que] of [[{}, "la OF"], [{ of_estado: "ok", of_numero: "OF 0001-00003412" }, "el remito"]]) {
    const b = baseZ1({ remito: { created_at: new Date().toISOString(), ...of } })
    const orig = b.sb.from
    b.sb.from = (tabla) => (tabla === "zomatik_np" ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "connection failure", code: "08006" } }) }) }) } : orig(tabla))
    const f = depFalsas()
    const errores = avisosZ1(f)
    await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
    const fila = b.db.zomatik_remitos[0]
    assert.equal(fila.estado, "pendiente", que)
    assert.notEqual(fila.of_estado, "error")
    assert.notEqual(fila.remito_estado, "error")
    assert.ok(Date.parse(fila.proximo_intento) > Date.now())
    assert.equal(f.hecho.of.length + f.hecho.remito.length, 0)
    assert.equal(errores.length, 1)
    assert.equal(errores[0].titulo, `El robot de Zomatik se cayó con ${que} · Pedido 1a2b3c4d`)
  }
})

// ── Servidor: remitir la OF antes del remito (REAL 13/11) ──
/** El robot real de remitir sobre el navegador simulado (el GET va atado al código en la misma llamada). */
function conRemitirReal(f, z) {
  f.dep.navegador = async () => { f.hecho.navegador++; return navFalso(z.rutas) }
  f.dep.robot.remitirOf = async (nav, d, o) => { f.hecho.remitir = [...(f.hecho.remitir || []), d]; return R.remitirOf(nav, d, { ...o, hoy: HOY }) }
}
const FILA_OF_OK = { of_estado: "ok", of_numero: "OF 0001-00003392", of_codigo: 9002, of_foto_dia: HOY }

test("servidor, remitir OF: fila vieja frenada por 'No hay stock' (OF ok, PEN) → GET con su of_codigo, 'of_remitida' y después el remito (un solo navegador)", async () => {
  const b = baseZ1({ remito: { ...FILA_OF_OK, of_foto_dia: "2026-10-30", sin_stock: 2, paso: "continuar_remito", mensaje: "No hay stock de H21 en el depósito (0 m³). Se reintenta." } })
  const f = depFalsas()
  const z = zomatikRemitir()
  conRemitirReal(f, z)
  const pasos = []
  const from = b.sb.from
  b.sb.from = (t) => { const q = from(t); if (t === "zomatik_remitos") { const u = q.update; q.update = (c) => { if (c.paso) pasos.push(c.paso); return u(c) } } return q }
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  assert.equal(z.estado.gets, 1)
  assert.equal(f.hecho.navegador, 1)
  assert.deepEqual(f.hecho.remitir[0], { codigo: 9002, numero: "OF 0001-00003392", deposito: 116, desde: "2026-10-30" })
  assert.equal(f.hecho.of.length, 0) // la OF no se repite
  assert.equal(f.hecho.remito.length, 1)
  assert.equal(b.db.zomatik_remitos[0].estado, "ok")
  assert.equal(b.db.zomatik_remitos[0].sin_stock, 0) // recién remitida, el tope empieza de nuevo
  // 'remitir_of' se guarda antes del GET; 'of_remitida' antes del remito
  assert.ok(pasos.indexOf("remitir_of") >= 0 && pasos.indexOf("remitir_of") < pasos.indexOf("of_remitida"), pasos.join(","))
  assert.ok(b.db.activity_log.some((x) => /OF remitida en Zomatik \(pasó a FIN\): OF 0001-00003392/.test(x.details["Qué pasó"])))
})

test("servidor, remitir OF: la OF nueva de esta misma pasada se remite con el código que acaba de devolver Zomatik", async () => {
  const b = baseZ1()
  const f = depFalsas()
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  assert.equal(f.hecho.of.length, 1)
  assert.equal(f.hecho.remitir[0].codigo, 9100)
  assert.equal(f.hecho.remitir[0].numero, "OF 0001-00003412")
  assert.equal(f.hecho.remito.length, 1)
})

test("servidor, remitir OF: ya FIN → sin GET y sigue con el remito", async () => {
  const b = baseZ1({ remito: FILA_OF_OK })
  const f = depFalsas()
  const z = zomatikRemitir({ antes: "FIN" })
  conRemitirReal(f, z)
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  assert.equal(z.estado.gets, 0)
  assert.equal(f.hecho.remito.length, 1)
  assert.equal(b.db.zomatik_remitos[0].estado, "ok")
})

test("servidor, remitir OF: sigue PEN → 'revisar', un mail a Bautista (no a gerenciales); el botón lo reintenta y, si frena igual, no repite el mail", async () => {
  const b = baseZ1({ remito: FILA_OF_OK })
  const f = depFalsas()
  const errores = avisosZ1(f)
  conRemitirReal(f, zomatikRemitir({ despues: "PEN" }))
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  let r = b.db.zomatik_remitos[0]
  assert.equal(r.estado, "revisar")
  assert.equal(r.remito_estado, "revisar")
  assert.equal(r.of_estado, "ok")
  assert.equal(r.paso, "remitir_of")
  assert.equal(r.proximo_intento, null)
  assert.equal(r.mensaje, "La OF 0001-00003392 sigue PEN después de remitirla. Revisala en Zomatik.")
  assert.equal(f.hecho.remito.length, 0)
  assert.equal(f.hecho.avisos.length, 0)
  assert.equal(errores.length, 1)
  assert.equal(errores[0].titulo, "Zomatik: no se pudo remitir la OF · Pedido 1a2b3c4d")
  assert.ok(errores[0].lineas.includes("Mensaje: La OF 0001-00003392 sigue PEN después de remitirla. Revisala en Zomatik."))
  // la pasada no lo vuelve a tomar
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  assert.equal(errores.length, 1)
  // "Remitir en Zomatik": lo vuelve a mirar; frena igual → sin otro mail
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), pedidoId: PED, sb: b.sb, dep: f.dep })
  assert.equal(b.db.zomatik_remitos[0].estado, "revisar")
  assert.equal(errores.length, 1)
  // ya la remitieron a mano (FIN) → el botón sigue con el remito
  conRemitirReal(f, zomatikRemitir({ antes: "FIN" }))
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), pedidoId: PED, sb: b.sb, dep: f.dep })
  r = b.db.zomatik_remitos[0]
  assert.equal(r.estado, "ok")
  assert.equal(f.hecho.remito.length, 1)
})

test("servidor, remitir OF: listado ilegible → 'pendiente' con el tope de sin_stock (sin el mail de 'pendiente hace 1 hora'); a los 6, 'revisar' y un mail", async (t) => {
  t.mock.method(console, "error", () => {})
  const ilegible = zomatikRemitir({ listado: ({ suc }) => conSuc(suc, "<table><tr><td>?</td><td>OF 0001-00003392</td></tr></table>") })
  // pendiente: cuenta 1, sin mail (aunque la fila tenga más de 1 hora)
  const b = baseZ1({ remito: { ...FILA_OF_OK, sin_stock: 0, intentos: 5, created_at: "2026-10-01T10:00:00Z" } })
  const f = depFalsas()
  const errores = avisosZ1(f)
  conRemitirReal(f, ilegible)
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  let r = b.db.zomatik_remitos[0]
  assert.equal(r.estado, "pendiente")
  assert.equal(r.remito_estado, "pendiente")
  assert.equal(r.paso, "remitir_of")
  assert.equal(r.sin_stock, 1)
  assert.match(r.mensaje, /Se reintenta\.$/)
  assert.ok(Date.parse(r.proximo_intento) > Date.now())
  assert.equal(errores.length, 0)
  assert.equal(f.hecho.remito.length, 0)
  // el 6.º intento: revisar y un mail a Bautista
  const b2 = baseZ1({ remito: { ...FILA_OF_OK, sin_stock: 5 } })
  const f2 = depFalsas()
  const errores2 = avisosZ1(f2)
  conRemitirReal(f2, ilegible)
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b2.sb, dep: f2.dep })
  r = b2.db.zomatik_remitos[0]
  assert.equal(r.estado, "revisar")
  assert.equal(r.sin_stock, 6)
  assert.match(r.mensaje, /Después de 6 intentos \(1 hora\) no se pudo remitir la OF 0001-00003392: revisala en Zomatik\.$/)
  assert.doesNotMatch(r.mensaje, /Se reintenta/)
  assert.equal(errores2.length, 1)
  assert.equal(f2.hecho.avisos.length, 0)
})

test("servidor, sin stock con la OF ya remitida: a los 6 intentos, 'revisar' con 'Ya se remitió la OF y sigue sin stock' (sin la pregunta de 'Generar')", async () => {
  const b = baseZ1({ remito: { ...FILA_OF_OK, sin_stock: 5 } })
  const f = depFalsas()
  f.hecho.respuestaRemito = { estado: "pendiente", mensaje: "No hay stock de H21 en el depósito (0 m³). Se reintenta.", paso: "continuar_remito", reintentar: true, sinStock: true }
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  const r = b.db.zomatik_remitos[0]
  assert.equal(r.estado, "revisar")
  assert.equal(f.hecho.avisos[0][0], "Ya se remitió la OF y sigue sin stock")
  assert.equal(r.mensaje, "No hay stock de H21 en el depósito (0 m³). Después de 6 intentos (1 hora): ya se remitió la OF 0001-00003392 y sigue sin stock. Revisá el depósito o la OF en Zomatik.")
  assert.doesNotMatch(r.mensaje, /Generar/)
})

test("servidor, remitir OF: 'Remitir en Zomatik' sobre un 'revisar' por falta de stock → pasa por remitir la OF y después el remito", async () => {
  const b = baseZ1({ remito: { ...FILA_OF_OK, estado: "revisar", sin_stock: 6, remito_estado: "revisar", paso: "continuar_remito", proximo_intento: null } })
  const f = depFalsas()
  const z = zomatikRemitir()
  conRemitirReal(f, z)
  // la pasada no toca un "revisar"
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  assert.equal(z.estado.gets, 0)
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), pedidoId: PED, sb: b.sb, dep: f.dep })
  assert.equal(z.estado.gets, 1)
  assert.equal(f.hecho.remito.length, 1)
  assert.equal(b.db.zomatik_remitos[0].estado, "ok")
})

test("servidor, remitir OF: con un Grabar del remito cortado no se toca la OF (ya había stock) ni se pisa el paso; un despacho sin pedido tampoco, y el mensaje dice que la remitan a mano", async () => {
  const b = baseZ1({ remito: { ...FILA_OF_OK, remito_numero: "0001-00002260", paso: "grabar_remito" } })
  const f = depFalsas()
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  assert.equal((f.hecho.remitir || []).length, 0)
  assert.equal(f.hecho.remito[0].buscarAntes, true)
  const b2 = baseZ1({ remito: { tipo: "suelto", np_id: null, comprobante: null } })
  const f2 = depFalsas()
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b2.sb, dep: f2.dep })
  assert.equal(f2.hecho.of.length, 1)
  assert.equal((f2.hecho.remitir || []).length, 0)
  assert.equal(b2.db.zomatik_remitos[0].mensaje, "OF hecha. Despacho sin pedido: remití la OF (lapicito en el listado de OF) y cargá el remito a mano.")
})

// ── Despacho partido entre NP (16/11, pedido 7a4dcc61 A.A. Arquitectura): NP2 2123 por 35 y adicional NP2 2124 por 3;
//    camiones 3326 (6), 3327, 3328, 3329 y 3330 (8 cada uno) = 38 m³. El 3330 no entra entero en ninguna NP ──
const NP2123 = (extra = {}) => np({ np_id: "np2123", n: 1, numero: "NP2 0001-00002123", zomatik_codigo: 158123, m3_uso: 35, ...extra })
const NP2124 = (extra = {}) => np({ np_id: "np2124", n: 2, numero: "NP2 0001-00002124", zomatik_codigo: 158124, m3_uso: 3, ...extra })
const camionesAA = () => [desp("1", 6, { remito: "3326" }), desp("2", 8, { remito: "3327" }), desp("3", 8, { remito: "3328" }), desp("4", 8, { remito: "3329" }), desp("5", 8, { remito: "3330", patente: "AF123XY" })]

test("plan, partido (A.A. 16/11): 6+8+8+8+8 contra 35+3 → 2123 = 3326…3329 + 5 m³ del 3330; 2124 = 3 m³ del 3330", () => {
  const p = Z.planificarRemitos(camionesAA(), [NP2123(), NP2124()], new Set())
  assert.deepEqual(p.problemas, [])
  assert.deepEqual(p.partidos, ["5"])
  assert.deepEqual(p.remitos.map((r) => [r.np_id, r.m3, r.despachos.map((d) => `${d.id}:${d.m3}`).join(",")]), [
    ["np2123", 35, "1:6,2:8,3:8,4:8,5:5"],
    ["np2124", 3, "5:3"],
  ])
  // El número de papel y la patente del 3330, en los DOS remitos (observaciones e impresas)
  assert.equal(p.remitos[0].remitos_papel, "3326, 3327, 3328, 3329, 3330")
  assert.equal(p.remitos[1].remitos_papel, "3330")
  assert.match(p.remitos[0].patentes, /AF123XY/)
  assert.equal(p.remitos[1].patente, "AF123XY")
  const obs = Z.observacionesRemito("M", p.remitos[1], "OBRA")
  assert.deepEqual(obs, { observaciones: "M - OBRA - Camiones: AF123XY", observacionesimp: "3330" })
  assert.equal(Z.observacionesRemito("M", p.remitos[0], null).observacionesimp, "3326 3327 3328 3329 3330")
  // Con lo ya remitido de otro día: 2123 tiene 30 remitidos → el 3330 se parte 5 + 3 igual
  const q = Z.planificarRemitos([desp("5", 8, { remito: "3330" })], [NP2123(), NP2124()], new Set(), new Map([["np2123", 30]]))
  assert.deepEqual(q.remitos.map((r) => [r.np_id, r.m3]), [["np2123", 5], ["np2124", 3]])
})

test("plan, partido: si entra entero en una NP va entero (como hoy), aunque sea la segunda; no se parte", () => {
  // Adicional por 10: el 3330 (8) no entra en la 2123 (le quedan 5) pero sí entero en la 2124
  const p = Z.planificarRemitos(camionesAA(), [NP2123(), NP2124({ m3_uso: 10 })], new Set())
  assert.deepEqual(p.partidos, [])
  assert.deepEqual(p.remitos.map((r) => [r.np_id, r.m3, r.despachos.map((d) => `${d.id}:${d.m3}`).join(",")]), [["np2123", 30, "1:6,2:8,3:8,4:8"], ["np2124", 8, "5:8"]])
  // Pedido de 40 en una sola NP: todo entero, un remito
  const q = Z.planificarRemitos(camionesAA(), [NP2123({ m3_uso: 40 })], new Set())
  assert.deepEqual([q.partidos, q.remitos.length, q.remitos[0].m3], [[], 1, 38])
})

test("plan, partido: si ni partido entra (no alcanza lo que les queda a las aptas) → problema y nada de ese despacho", () => {
  const cam = camionesAA()
  cam[4] = desp("5", 10, { remito: "3330" }) // 10 > 5 + 3
  const p = Z.planificarRemitos(cam, [NP2123(), NP2124()], new Set())
  assert.deepEqual(p.partidos, [])
  assert.match(p.problemas[0], /3330 \(10 m³\) supera lo que le queda a la NP/)
  assert.deepEqual(p.remitos.map((r) => [r.np_id, r.m3]), [["np2123", 30]]) // el resto sale; la 2124, sin nada
})

test("plan, partido: nunca hacia una NP de otro tipo (R/X), fórmula o planta: si solo alcanza con ella, problema", () => {
  // La adicional es una NP (R) y los camiones son X: no se parte hacia ella
  const p = Z.planificarRemitos(camionesAA(), [NP2123(), NP2124({ numero: "NP 0001-00001190" })], new Set())
  assert.deepEqual(p.partidos, [])
  assert.match(p.problemas[0], /3330 \(8 m³\) supera lo que le queda a la NP/)
  assert.deepEqual(p.remitos.map((r) => [r.np_id, r.m3]), [["np2123", 30]])
  // Otra fórmula u otra planta, lo mismo
  for (const extra of [{ formula_id: "f2" }, { plant_id: "hud" }]) {
    const q = Z.planificarRemitos(camionesAA(), [NP2123(), NP2124(extra)], new Set())
    assert.deepEqual([q.partidos, q.remitos.map((r) => r.np_id)], [[], ["np2123"]], JSON.stringify(extra))
  }
  // Con dos NP2 aptas y una NP (R) en el medio, se parte entre las aptas y la otra queda afuera
  const r = Z.planificarRemitos(camionesAA(), [NP2123(), np({ np_id: "npR", n: 3, numero: "NP 0001-00001190", m3_uso: 10 }), NP2124()], new Set())
  assert.deepEqual(r.remitos.map((x) => [x.np_id, x.m3]), [["np2123", 35], ["np2124", 3]])
})

test("cambios de despachos, partido: se compara la suma de sus partes; si cambió, este remito se queda con lo que no tienen las otras", () => {
  const otros = new Map([["d5", 3]])
  // Sin cambios (5 acá + 3 en el otro remito = 8)
  assert.equal(Z.cambiosDespachos([{ dispatch_id: "d4", m3: 8 }, { dispatch_id: "d5", m3: 5 }], [{ id: "d4", quantity_m3: 8 }, { id: "d5", quantity_m3: 8 }], null, otros).firma, null)
  assert.equal(Z.cambiosDespachos([{ dispatch_id: "d4", m3: 8 }, { dispatch_id: "d5", m3: 5 }], [{ id: "d4", quantity_m3: 8 }, { id: "d5", quantity_m3: 8 }], null, otros).m3, 13)
  // Se editó 8 → 6: a este remito le quedan 3
  const c = Z.cambiosDespachos([{ dispatch_id: "d4", m3: 8 }, { dispatch_id: "d5", m3: 5 }], [{ id: "d4", quantity_m3: 8 }, { id: "d5", quantity_m3: 6 }], null, otros)
  assert.deepEqual(c.editados, [{ id: "d5", antes: 8, ahora: 6, parte: 3 }])
  assert.equal(c.m3, 11)
  assert.match(Z.textoCambio(c), /se editó 8 → 6 m³/)
  // Se editó 8 → 2: a este remito no le queda nada
  assert.deepEqual(Z.cambiosDespachos([{ dispatch_id: "d5", m3: 5 }], [{ id: "d5", quantity_m3: 2 }], null, otros).editados, [{ id: "d5", antes: 8, ahora: 2, parte: 0 }])
  // Anulado: como siempre
  assert.deepEqual(Z.cambiosDespachos([{ dispatch_id: "d5", m3: 5 }], [], null, otros).anulados, ["d5"])
})

/** Pedido A.A. del 16/11 en la base simulada: NP2 2123 (35) + adicional NP2 2124 (3) y los cinco camiones de hoy. */
async function baseAA() {
  const { hoyAR } = await import("../zomatik/np.ts")
  const hoy = hoyAR()
  const b = baseZ1()
  b.db.zomatik_remitos = []
  b.db.zomatik_remito_despachos = []
  b.db.zomatik_np = [
    { id: "np2123", n: 1, numero: "NP2 0001-00002123", zomatik_codigo: 158123, estado: "ok", formula_id: "f1", plant_id: PLANTA, scheduled_dispatch_id: PED, marca: "Sistema Rebucret - pedido 1a2b3c4d - NP 1", paso: "ok" },
    { id: "np2124", n: 2, numero: "NP2 0001-00002124", zomatik_codigo: 158124, estado: "ok", formula_id: "f1", plant_id: PLANTA, scheduled_dispatch_id: PED, marca: "Sistema Rebucret - pedido 1a2b3c4d - NP 2", paso: "ok" },
  ]
  b.db.zomatik_np_uso = [
    { np_id: "np2123", m3: 35, created_at: "2026-11-16T10:00:00Z", scheduled_dispatch_id: PED, activo: true },
    { np_id: "np2124", m3: 3, created_at: "2026-11-16T14:00:00Z", scheduled_dispatch_id: PED, activo: true },
  ]
  const viaje = (id, m3, remito, h, patente = "AB1") => ({ id, scheduled_dispatch_id: PED, quantity_m3: m3, remito, remito_tipo: "X", formula_id: "f1", plant_id: PLANTA, created_at: `${hoy}T${h}:00:00.000Z`, dispatch_date: `${hoy}T${h}:00:00.000Z`, is_test_dispatch: false, mixers: { license_plate: patente } })
  b.db.dispatches = [viaje("d3326", 6, "3326", "12"), viaje("d3327", 8, "3327", "13"), viaje("d3328", 8, "3328", "14"), viaje("d3329", 8, "3329", "15"), viaje("d3330", 8, "3330", "16", "AF123XY")]
  return { b, hoy }
}

test("servidor, partido (A.A. 16/11): dos remitos creados juntos (35 y 3), el 3330 en los dos; otra pasada no duplica; OF y remito de cada uno", async () => {
  const { b } = await baseAA()
  const r = await S.prepararRemitos(PED, null, "test", b.sb)
  assert.deepEqual(r, { activo: true, creados: 2, problemas: [] })
  assert.deepEqual(b.llamadas.filter((l) => l.rpc).map((l) => l.rpc), ["zomatik_remitos_crear_juntos"])
  assert.deepEqual(b.db.zomatik_remitos.map((x) => [x.np_id, Number(x.m3), x.remitos_papel, x.patentes]), [
    ["np2123", 35, "3326, 3327, 3328, 3329, 3330", "AB1, AF123XY"],
    ["np2124", 3, "3330", "AF123XY"],
  ])
  assert.deepEqual(b.db.zomatik_remito_despachos.filter((l) => l.dispatch_id === "d3330").map((l) => [l.remito_id, l.m3]), [["rem-1", 5], ["rem-2", 3]])
  // Otra vez ("Remitir en Zomatik" o la pasada): ya está todo remitido
  assert.deepEqual(await S.prepararRemitos(PED, null, "test", b.sb), { activo: true, creados: 0, problemas: [] })
  assert.equal(b.db.zomatik_remitos.length, 2)
  // El robot: cada remito con su OF, sin "cambió" (el 3330 suma 8 entre los dos)
  const f = depFalsas()
  const res = await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  assert.deepEqual(res.hechas.map((x) => x.estado), ["ok", "ok"], JSON.stringify(res))
  assert.deepEqual(f.hecho.of.map((x) => x.m3), [35, 3])
  assert.deepEqual(f.hecho.remito.map((x) => [x.m3, x.observacionesimp]), [[35, "3326 3327 3328 3329 3330"], [3, "3330"]])
  assert.match(f.hecho.remito[1].observaciones, /Camiones: AF123XY/)
  // El control de la pasada no avisa nada
  assert.equal(await S.controlarCambiosZ1("test", { dias: [b.db.zomatik_remitos[0].fecha], sb: b.sb, avisar: f.dep.avisar }), 0)
  assert.equal(f.hecho.avisos.length, 0)
})

test("servidor, partido: si uno de los remitos no se puede crear, no queda ninguno (todos o ninguno); sin la migración, problema y nada", async () => {
  // Otro proceso mete el 3330 entero en un remito justo antes (entre leer y crear): no se crea ninguno de los dos
  const { b } = await baseAA()
  const rpc = b.sb.rpc
  b.sb.rpc = async (nombre, a) => {
    if (nombre === "zomatik_remitos_crear_juntos") b.db.zomatik_remito_despachos.push({ remito_id: "otro", dispatch_id: "d3330", m3: 8 })
    return rpc(nombre, a)
  }
  const r = await S.prepararRemitos(PED, null, "test", b.sb)
  assert.equal(r.creados, 0)
  assert.deepEqual([b.db.zomatik_remitos.length, b.db.zomatik_remito_despachos.map((l) => l.remito_id)], [0, ["otro"]])
  assert.equal(b.db.activity_log.filter((x) => /OF \+ remito pendientes/.test(x.details?.["Qué pasó"] || "")).length, 0)
  // Sin la función de la migración 202611161200: no se arma nada de ese día y queda el problema
  const { b: b2 } = await baseAA()
  b2.db.sin_crear_juntos = true
  const r2 = await S.prepararRemitos(PED, null, "test", b2.sb)
  assert.equal(r2.creados, 0)
  assert.match(r2.problemas[0], /El despacho 3330 hay que partirlo entre dos NP y falta la migración/)
  assert.deepEqual([b2.db.zomatik_remitos.length, b2.db.zomatik_remito_despachos.length], [0, 0])
})

test("servidor, partido: el 3330 se edita 8 → 6 antes de la OF → el primer remito que sale se queda con lo que falta (3) y el total da 6", async () => {
  const { b } = await baseAA()
  await S.prepararRemitos(PED, null, "test", b.sb)
  b.db.dispatches.find((d) => d.id === "d3330").quantity_m3 = 6
  const f = depFalsas()
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep })
  assert.deepEqual(b.db.zomatik_remito_despachos.filter((l) => l.dispatch_id === "d3330").map((l) => [l.remito_id, l.m3]), [["rem-1", 3], ["rem-2", 3]])
  assert.deepEqual(f.hecho.of.map((x) => x.m3), [33, 3])
  assert.deepEqual(b.db.zomatik_remitos.map((x) => x.estado), ["ok", "ok"])
  // Se edita 8 → 2: a la 2123 no le toca nada del 3330 (sale de su remito, que sigue con los otros cuatro)
  const { b: b2 } = await baseAA()
  await S.prepararRemitos(PED, null, "test", b2.sb)
  b2.db.dispatches.find((d) => d.id === "d3330").quantity_m3 = 2
  const f2 = depFalsas()
  await S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b2.sb, dep: f2.dep })
  assert.deepEqual(b2.db.zomatik_remito_despachos.filter((l) => l.dispatch_id === "d3330").map((l) => [l.remito_id, l.m3]), [["rem-2", 2]])
  assert.deepEqual(f2.hecho.of.map((x) => x.m3), [30, 2])
  assert.equal(b2.db.zomatik_remitos[0].remitos_papel, "3326, 3327, 3328, 3329")
})

// ── Editar la NP cuando el pedido cambia de m³ (docs/specs/2026-11-18-editar-np-al-cambiar-pedido.md, 6.2) ──
/** Cordones: NP 0001-00001194 de 8 m³ y un camión de 9 hoy. `reserva` = lo que el pedido reserva de la NP. */
async function baseCordones(reserva) {
  const { hoyAR } = await import("../zomatik/np.ts")
  const hoy = hoyAR()
  const b = baseZ1()
  b.db.zomatik_remitos = []
  b.db.zomatik_remito_despachos = []
  b.db.zomatik_np = [{ id: "np1194", n: 1, numero: "NP 0001-00001194", zomatik_codigo: 158194, estado: "ok", formula_id: "f1", plant_id: PLANTA, scheduled_dispatch_id: PED, marca: "Sistema Rebucret - pedido 1a2b3c4d - NP 1", paso: "autorizada" }]
  b.db.zomatik_np_uso = [{ np_id: "np1194", m3: reserva, created_at: "2026-11-16T10:00:00Z", scheduled_dispatch_id: PED, activo: true }]
  b.db.dispatches = [{ id: "d3401", scheduled_dispatch_id: PED, quantity_m3: 9, remito: "3401", remito_tipo: "R", formula_id: "f1", plant_id: PLANTA, created_at: `${hoy}T12:00:00.000Z`, dispatch_date: `${hoy}T12:00:00.000Z`, is_test_dispatch: false, mixers: { license_plate: "AB1" } }]
  b.db.zomatik_np_ajustes = []
  return b
}

test("edición de la NP: con la reserva en 9, el camión de 9 sale en UN remito contra la misma NP", async () => {
  const p = Z.planificarRemitos([{ id: "d3401", m3: 9, remito: "3401", remito_tipo: "R", patente: "AB1", formula_id: "f1", plant_id: PLANTA, created_at: "2026-11-18T12:00:00Z" }], [{ np_id: "np1194", n: 1, estado: "ok", numero: "NP 0001-00001194", zomatik_codigo: 158194, formula_id: "f1", plant_id: PLANTA, m3_uso: 9 }], new Set())
  assert.deepEqual([p.remitos.map((r) => [r.np_id, r.m3]), p.problemas, p.partidos], [[["np1194", 9]], [], []])
  const b = await baseCordones(9)
  const r = await S.prepararRemitos(PED, null, "test", b.sb)
  assert.deepEqual([r.creados, r.problemas], [1, []])
  assert.deepEqual(b.db.zomatik_remitos.map((x) => [x.np_id, x.m3]), [["np1194", 9]])
})

test("edición de la NP: con la edición abierta (reserva todavía en 8) el problema dice 'Esperando que la NP pase a 9 m³'; sin edición, lo de siempre", async () => {
  const sin = await baseCordones(8)
  const r0 = await S.prepararRemitos(PED, null, "test", sin.sb)
  assert.match(r0.problemas[0], /supera lo que le queda a la NP: generá una NP adicional antes de remitir\.$/)
  const b = await baseCordones(8)
  b.db.zomatik_np_ajustes = [{ id: "ed-1", np_id: "np1194", scheduled_dispatch_id: PED, origen: "pedido", estado: "pendiente", m3_objetivo: 9, m3_uso_objetivo: 9 }]
  // con la llave de la edición apagada nadie la va a hacer: el texto de siempre
  assert.match((await S.prepararRemitos(PED, null, "test", b.sb)).problemas[0], /generá una NP adicional/)
  b.db.zomatik_np_config[0].editar_activo = true
  const r = await S.prepararRemitos(PED, null, "test", b.sb)
  assert.equal(r.creados, 0)
  assert.match(r.problemas[0], /3401 \(9 m³\) supera lo que le queda a la NP\. Esperando que la NP pase a 9 m³ en Zomatik\.$/)
  // una edición ya terminada no cambia el texto
  b.db.zomatik_np_ajustes[0].estado = "ok"
  assert.match((await S.prepararRemitos(PED, null, "test", b.sb)).problemas[0], /generá una NP adicional/)
  // después de aplicar (reserva 9) el despacho que había quedado afuera sale
  b.db.zomatik_np_uso[0].m3 = 9
  assert.equal((await S.prepararRemitos(PED, null, "test", b.sb)).creados, 1)
})

// ── Materia prima de la OF (docs/specs/2026-11-19-of-descuenta-materia-prima.md; capturas REALES del 19/11) ──
const FX_RMI = fx("remitosinternos-listado.html")
/** El listado real (comentario, selector de sucursal, buscador y encabezado) con estas filas */
const paginaRmi = (filas) => `${FX_RMI.slice(0, FX_RMI.indexOf('<tr height="20">'))}${filas.join("\n")}\n</table>\n</body></html>`
/** Una fila con la forma capturada (celdas angostas entre columnas, imprimir y el link de BORRAR, que nunca se pide) */
const filaRmi = (codigo, numero, fecha, of = null, celdaOf = null) =>
  `<tr height="20"> <td class="itemlistado" bgcolor="#ffffff"> <a href="modificar_remitosinternos.php?codigo=${codigo}" class="itemlistado">RMI ${numero}</a> </td> <td bgcolor="#999999"></td> <td class="itemlistado" bgcolor="#ffffff"> <a href="modificar_remitosinternos.php?codigo=${codigo}" class="itemlistado">${fecha}</a> </td> <td bgcolor="#999999"></td> <td class="itemlistado" bgcolor="#ffffff"> </td> <td bgcolor="#999999"></td> <td class="itemlistado" bgcolor="#ffffff"> Canning </td> <td bgcolor="#999999"></td> <td class="itemlistado" bgcolor="#ffffff"> Canning </td> <td bgcolor="#999999"></td> <td class="itemlistado" bgcolor="#ffffff"> </td> <td bgcolor="#999999"></td> <td class="itemlistado" bgcolor="#ffffff"> </td> <td bgcolor="#999999"></td> <td class="itemlistado" bgcolor="#ffffff" id="remi"><b> RECIBIDO </b> </td> <td bgcolor="#999999"></td> <td class="itemlistado" align="center" bgcolor="#ffffff"> ${celdaOf ?? (of ? `OF ${of}` : "")} </td> <td bgcolor="#999999"></td> <td class="itemlistado" align="center" bgcolor="#ffffff"> <a href="imprimir_remitointerno.php?codigo=${codigo}" target="_blank" class="itemlistado" title="Imprimir"><img src="images/imprimir.png" border="0"></a> </td> <td bgcolor="#999999"></td> <td align="center" bgcolor="#ffffff"> <a href="#" onclick="BorrarConPregunta('borrar_remitosinternos.php?codigo=${codigo}','RMI ${numero}'); return false;"><img src="images/ico_borrar.gif" width="12" height="12" border="0"></a> </td> </tr>`
/** La pantalla "Composicion" real, para otra OF */
const COMPO = (codigo) => fx("of-compo.html").replaceAll("8271", String(codigo))
const COMPO_SIN_MATERIALES = (codigo) => COMPO(codigo).replace(/<tr>\s*<td width="90"[\s\S]*?<\/tr>/g, "")
const CAMPOS_COMPO = (codigo) => [{ nombre: "ordenfabricacion", valor: String(codigo) }, { nombre: "fparam", valor: "" }, { nombre: "adescontar_1000013405", valor: "0.9300000000000" }, { nombre: "adescontar_1000013403", valor: "0.2800000000000" }, { nombre: "adescontar_1000013435", valor: "0.9500000000000" }]
const deRed = (m = "Zomatik no respondió a tiempo") => Object.assign(new Error(m), { codigo: "sin_respuesta" })

/**
 * Zomatik con nuestra OF (`codigo`, `numero`) en estado `of` y con `rmi` remitos internos ya hechos. "Continuar" agrega
 * uno (salvo `alGrabar`). `viejas`: el listado por defecto llega hasta antes del día de la OF.
 */
function zomatikMp({ of = "PEN", rmi = 0, codigo = 9002, numero = "0001-00003392", compo = null, alGrabar = null, viejas = true, busqueda = null, paginaListado = null } = {}) {
  const estado = { posts: 0, cuerpos: [], busquedas: [], compos: 0, of, rmi: [], n: 6900 }
  const nueva = () => { estado.n++; return filaRmi(21300 + estado.n, `0001-0000${estado.n}`, HOY, numero) }
  for (let i = 0; i < rmi; i++) estado.rmi.push(nueva())
  const VIEJAS = [filaRmi(21250, "0001-00006850", "2026-10-30", "0001-00003391"), filaRmi(21249, "0001-00006849", "2026-10-29")]
  const propias = () => [...estado.rmi].reverse()
  return {
    estado, nueva, propias,
    rutas: [
      ["GET", /^listado_remitosinternos\.php$/, () => (paginaListado ? paginaListado(estado, propias) : resp(paginaRmi([...propias(), ...(viejas ? VIEJAS : [])])))],
      ["POST", /^listado_remitosinternos\.php\?enviado=1$/, (c) => { estado.busquedas.push(c.cuerpo); return busqueda ? busqueda(estado, propias) : resp(paginaRmi([...propias(), ...VIEJAS])) }],
      ["GET", /^listado_ordenfabricacion\.php$/, () => resp(listadoOf(""))],
      ["POST", /^listado_ordenfabricacion\.php\?enviado=1$/, ({ suc }) => conSuc(suc, listadoOf(filaOf(9001, "0001-00003391", "CANNING", "2026-10-30", "FIN") + filaOf(codigo, numero, "CANNING", HOY, estado.of === "PEN" ? LAPICITO(codigo) : estado.of)))],
      ["GET", /^modificar_ordenfabricacioncompo\.php\?codigo=\d+$/, () => { estado.compos++; return resp(compo ?? COMPO(codigo)) }],
      ["POST", /^grabar_ordenfabricacioncompo\.php$/, (c) => {
        estado.posts++
        estado.cuerpos.push(c.cuerpo)
        if (alGrabar) return alGrabar(estado, nueva)
        estado.rmi.push(nueva())
        return resp("", 302, "listado_ordenfabricacion.php")
      }],
    ],
  }
}
const datosMp = (extra = {}) => ({ codigo: 9002, numero: "OF 0001-00003392", deposito: 116, desde: HOY, yaEnviado: false, ...extra })

test("materia prima, puro: la pantalla Composicion real (campos en su orden, materiales con código, nombre y toneladas, multipart)", () => {
  const f = Z.formularioMpOf(fx("of-compo.html"), 8271)
  assert.equal(f.ok, true)
  assert.deepEqual(f.campos, CAMPOS_COMPO(8271))
  assert.deepEqual(f.materiales, MP_FIXTURE)
  assert.equal(f.multipart, true)
  assert.equal(Z.textoMateriales(f.materiales), "CCTS ARENA ESPECIAL (10000004): 0,93 t · CCTS CEMENTO GRANEL (10000026): 0,28 t · PIEDRA 6-12 (10000612): 0,95 t")
})

test("materia prima, puro: controles de la pantalla (otra OF, campo desconocido o repetido, valor que no es > 0, otro form, sin composición) → no se manda", () => {
  const h = fx("of-compo.html")
  const mal = (html, re, of = 8271) => { const f = Z.formularioMpOf(html, of); assert.equal(f.ok, false); assert.equal(f.motivo, "formato"); assert.match(f.mensaje, re); assert.match(f.mensaje, /No se mandó nada\.$/) }
  mal(h, /es de otra OF: 8271 y se esperaba 8272/, 8272)
  mal(h.replace('<input type="hidden" name="fparam"', '<input type="hidden" name="borrar" value="1"><input type="hidden" name="fparam"'), /campo que no se conoce: borrar/)
  mal(h.replace('<input type="hidden" name="fparam"', '<input type="hidden" name="ordenfabricacion" value="8271"><input type="hidden" name="fparam"'), /ordenfabricacion viene repetido/)
  mal(h.replace("0.2800000000000", "0.0000000000000"), /adescontar_1000013403 vale "0.0000000000000"/)
  mal(h.replace("0.2800000000000", ""), /adescontar_1000013403 vale ""/)
  mal(h.replace("0.2800000000000", "0,28"), /adescontar_1000013403 vale "0,28"/)
  mal(h.replace("0.2800000000000", "-0.28"), /no un número mayor que 0/)
  mal(h.replace('action="grabar_ordenfabricacioncompo.php"', 'action="grabar_ordenfabricacioncompo.php?codigo=8271"'), /graba en otro lado/)
  mal(h.replace('method="POST" name="frm_ordenfabricacion"', 'method="GET" name="frm_ordenfabricacion"'), /graba en otro lado/)
  mal(h.replace("<td width=\"90\" class=\"itemformulario\"> 10000026 </td>", "<td width=\"90\" class=\"itemformulario\"> </td>"), /no trae código de artículo y nombre/)
  mal("<html><body>Sesion</body></html>", /no se abrió la pantalla Composicion/)
  mal(`${h}${h}`, /más de un formulario/)
  const sin = Z.formularioMpOf(COMPO_SIN_MATERIALES(8271), 8271)
  assert.deepEqual([sin.ok, sin.motivo, sin.mensaje], [false, "sin_composicion", "El artículo de la OF no tiene composición en Zomatik: no hay materia prima para descontar."])
})

test("materia prima, puro: el listado real de remitos internos (la columna OF se ubica por el encabezado); si no se entiende, null", () => {
  const filas = Z.listadoRmi(FX_RMI)
  assert.deepEqual(filas, [
    { codigo: 21254, numero: "0001-00006857", fecha: "2026-11-18", of: "0001-00003460" }, { codigo: 21253, numero: "0001-00006856", fecha: "2026-11-18", of: "0001-00003459" },
    { codigo: 21221, numero: "0001-00006837", fecha: "2026-11-13", of: "0001-00003447" }, { codigo: 21220, numero: "0001-00006836", fecha: "2026-11-13", of: "0001-00003447" },
  ])
  // la OF hecha a mano tiene DOS; las del robot hasta el 19/11, uno
  assert.equal(Z.rmiDeOf(filas, "0001-00003447"), 2)
  assert.equal(Z.rmiDeOf(filas, "0001-00003460"), 1)
  assert.equal(Z.rmiDeOf(filas, "0001-00003461"), 0)
  // un remito interno que no es de una OF (celda vacía) se lee; un listado vacío con su encabezado, también
  assert.deepEqual(Z.listadoRmi(paginaRmi([filaRmi(21249, "0001-00006849", "2026-10-29")])), [{ codigo: 21249, numero: "0001-00006849", fecha: "2026-10-29", of: null }])
  assert.deepEqual(Z.listadoRmi(paginaRmi([])), [])
  // falla cerrado: sin encabezado, la celda OF con otra cosa, sin fecha, sin link o el mismo código dos veces
  assert.equal(Z.listadoRmi("<html><table><tr><td>nada</td></tr></table></html>"), null)
  assert.equal(Z.listadoRmi(paginaRmi([filaRmi(1, "0001-00006849", "2026-10-29", null, "OF rara")])), null)
  assert.equal(Z.listadoRmi(paginaRmi([filaRmi(1, "0001-00006849", "29/10/2026")])), null)
  assert.equal(Z.listadoRmi(paginaRmi([filaRmi(1, "0001-00006849", "2026-10-29").replaceAll("modificar_remitosinternos.php?codigo=1", "#")])), null)
  assert.equal(Z.listadoRmi(paginaRmi([filaRmi(1, "0001-00006849", "2026-10-29"), filaRmi(1, "0001-00006848", "2026-10-29")])), null)
})

test("materia prima, puro: tieneRmiDeMp (PEN 0 falta · FIN 1 falta · FIN 0 no se sabe) y hasta dónde llega el listado", () => {
  assert.deepEqual([0, 1, 2].map((n) => Z.tieneRmiDeMp("PEN", n)), [false, true, true])
  assert.deepEqual([0, 1, 2, 3].map((n) => Z.tieneRmiDeMp("FIN", n)), [null, false, true, true])
  assert.equal(Z.tieneRmiDeMp("pen", 0), false)
  for (const [e, n] of [["ANU", 1], ["", 0], [null, 0], ["PEN", -1], ["FIN", 1.5]]) assert.equal(Z.tieneRmiDeMp(e, n), null, `${e} ${n}`)
  const filas = Z.listadoRmi(FX_RMI) // la última fila es del 2026-11-13
  assert.equal(Z.rmiLlegaHasta(filas, "2026-11-14"), true)
  assert.equal(Z.rmiLlegaHasta(filas, "2026-11-13"), false) // ese día puede estar cortado
  assert.equal(Z.rmiLlegaHasta(filas, "2026-11-06"), false)
  assert.equal(Z.rmiLlegaHasta([], "2026-11-14"), false)
  assert.equal(Z.rmiLlegaHasta(filas, ""), false)
})

test("lista cerrada, materia prima: la pantalla Composicion solo de la OF de esa llamada; nunca borrar, grabar ni abrir remitos internos", () => {
  for (const [r, m, of] of [["modificar_ordenfabricacioncompo.php?codigo=8271", "GET", 8271], ["/modificar_ordenfabricacioncompo.php?codigo=8271", "GET", 8271], ["grabar_ordenfabricacioncompo.php", "POST", 8271], ["listado_remitosinternos.php", "GET", null], ["listado_remitosinternos.php?enviado=1", "POST", null]])
    assert.equal(W.rutaEscrituraZ1(r, m, null, of), true, `${m} ${r}`)
  for (const [r, m, of] of [
    ["modificar_ordenfabricacioncompo.php?codigo=8272", "GET", 8271], ["modificar_ordenfabricacioncompo.php?codigo=8271", "GET", null], ["modificar_ordenfabricacioncompo.php?codigo=8271", "GET", "8271"],
    ["modificar_ordenfabricacioncompo.php?codigo=82710", "GET", 8271], ["modificar_ordenfabricacioncompo.php", "GET", 8271], ["modificar_ordenfabricacioncompo.php?codigo=8271&codigo=1", "GET", 8271],
    ["modificar_ordenfabricacioncompo.php?codigo=8271", "POST", 8271], ["grabar_ordenfabricacioncompo.php", "GET", 8271], ["grabar_ordenfabricacioncompo.php", "POST", null], ["grabar_ordenfabricacioncompo.php", "POST", 0],
    ["grabar_ordenfabricacioncompo.php?codigo=8271", "POST", 8271], ["grabar_ordenfabricacioncompo.php?ordenfabricacion=8272", "POST", 8271],
    ["borrar_remitosinternos.php?codigo=21254", "GET", 8271], ["borrar_remitosinternos.php?codigo=21254", "POST", 8271], ["grabar_remitosinternos.php", "POST", 8271], ["grabar_remitosinternos.php?codigo=0", "POST", 8271],
    ["grabar_remitosinternos.php?codigo=21254", "POST", 8271], ["modificar_remitosinternos.php?codigo=21254", "GET", 8271], ["modificar_remitosinternos.php", "GET", 8271], ["modificar_remitosinternos.php?codigo=21254", "POST", 8271],
    ["imprimir_remitointerno.php?codigo=21254", "GET", 8271], ["listado_remitosinternos.php?enviado=1&borrar=3", "POST", 8271], ["listado_remitosinternos.php?borrar=3", "GET", 8271], ["paginar_remitosinternos.php", "POST", 8271],
    ["grabar_ordenfabricacion.php?codigo=8271", "POST", 8271], ["remitir_ordenfabricacion.php?codigo=8271", "GET", 8271],
  ])
    assert.equal(W.rutaEscrituraZ1(r, m, null, of), false, `${m} ${r} (${of})`)
  // ni la lectura ni la NP ni el ajuste ni traer una NP habilitan nada de esto
  for (const r of ["modificar_ordenfabricacioncompo.php?codigo=8271", "grabar_ordenfabricacioncompo.php", "listado_remitosinternos.php", "listado_remitosinternos.php?enviado=1", "borrar_remitosinternos.php?codigo=21254"])
    for (const m of ["GET", "POST"])
      assert.equal(W.rutaPermitida(r, m) || W.rutaEscrituraNp(r, m) || W.rutaEscrituraAjuste(r, m, 8271) || W.rutaLecturaNp(r, m, 8271), false, `${m} ${r}`)
})

test("lista cerrada, materia prima: el cuerpo de 'Continuar' solo con ESA OF, fparam y adescontar_<id> > 0 (multipart o urlencoded)", () => {
  const mp = (campos) => latin1(N.multipartLatin1(campos, "XX").cuerpo)
  const ok = mp(CAMPOS_COMPO(8271))
  assert.equal(W.cuerpoMpValido(ok, 8271), true)
  assert.equal(W.cuerpoMpValido("ordenfabricacion=8271&fparam=&adescontar_1000013405=0.9300000000000", 8271), true)
  // de OTRA OF, o sin decir de cuál
  assert.equal(W.cuerpoMpValido(ok, 8272), false)
  assert.equal(W.cuerpoMpValido(ok, null), false)
  assert.equal(W.cuerpoMpValido(ok, "8271"), false)
  assert.equal(W.cuerpoMpValido("ordenfabricacion=8272&fparam=&adescontar_1=0.5", 8271), false)
  for (const malo of [
    mp([...CAMPOS_COMPO(8271), { nombre: "borrar", valor: "1" }]), mp([...CAMPOS_COMPO(8271), { nombre: "ordenfabricacion", valor: "8272" }]), mp([...CAMPOS_COMPO(8271), { nombre: "ordenfabricacion", valor: "8271" }]),
    mp(CAMPOS_COMPO(8271).slice(0, 2)), mp(CAMPOS_COMPO(8271).slice(1)), mp([...CAMPOS_COMPO(8271), { nombre: "adescontar_9", valor: "0" }]), mp([...CAMPOS_COMPO(8271), { nombre: "adescontar_9", valor: "1e3" }]),
    mp([...CAMPOS_COMPO(8271), { nombre: "adescontar_1000013405", valor: "0.5" }]), ok.slice(0, -10), "", null, "ordenfabricacion=8271", "ordenfabricacion=8271&adescontar_1=0.5&codigo=3", "ordenfabricacion=8271&adescontar_x=0.5",
  ])
    assert.equal(W.cuerpoMpValido(malo, 8271), false, String(malo).slice(-60))
})

test("materia prima: OF nueva (PEN, 0 remitos internos) → la marca ANTES de mandar, POST con los MISMOS campos de la pantalla, 1 remito interno → ok", async () => {
  const z = zomatikMp()
  const pasos = []
  const nav = navFalso(z.rutas, { alLlamar: (l) => { if (/^grabar_ordenfabricacioncompo/.test(l.ruta)) pasos.push(["POST", l.suc]) } })
  const r = await R.descontarMpOf(nav, datosMp(), opts({ alPaso: (p, extra) => pasos.push([p, extra?.mp]) }))
  assert.equal(r.estado, "ok", r.mensaje)
  assert.deepEqual([r.paso, r.grabado, r.yaEstaba, r.numero, r.codigo], ["mp_ok", true, undefined, "OF 0001-00003392", 9002])
  assert.deepEqual(r.mp, MP_FIXTURE)
  // la marca (con lo que se va a descontar) se guarda ANTES del POST, y el POST sale desde la sucursal 18
  assert.deepEqual(pasos, [["mp_of", MP_FIXTURE], ["POST", "18"]])
  const i = nav.llamadas.findIndex((l) => /^grabar_ordenfabricacioncompo/.test(l.ruta))
  assert.deepEqual([nav.llamadas[i - 1].m, nav.llamadas[i - 1].ruta], ["SUC", "18"])
  // los mismos campos y valores que trajo la pantalla, en su orden, atado a ESA OF
  const p = nav.llamadas[i]
  assert.deepEqual([p.m, p.ruta, p.ofMp, p.tipo], ["POST", "grabar_ordenfabricacioncompo.php", 9002, "multipart/form-data; boundary=XX"])
  assert.equal(p.cuerpo, latin1(N.multipartLatin1(CAMPOS_COMPO(9002), "XX").cuerpo))
  assert.deepEqual(nav.llamadas.filter((l) => /^modificar_ordenfabricacioncompo/.test(l.ruta)).map((l) => [l.m, l.ruta, l.ofMp]), [["GET", "modificar_ordenfabricacioncompo.php?codigo=9002", 9002]])
  // se contó antes y después; primero los remitos internos y después el estado de la OF
  const orden = nav.llamadas.filter((l) => l.m !== "SUC").map((l) => l.ruta.split("?")[0].replace(/\.php$/, ""))
  assert.deepEqual(orden, ["listado_remitosinternos", "listado_ordenfabricacion", "listado_ordenfabricacion", "modificar_ordenfabricacioncompo", "grabar_ordenfabricacioncompo", "listado_remitosinternos"])
  // nunca un link de acción (borrar, remitir, abrir un remito interno)
  assert.ok(!nav.llamadas.some((l) => /borrar|remitir_|modificar_remitosinternos|grabar_remitosinternos/.test(l.ruta)))
  assert.equal(z.estado.posts, 1)
})

test("materia prima: ya estaba (PEN con 1, FIN con 2) → no se abre la pantalla ni se manda nada; regularizar una FIN con 1 → POST → 2 → ok", async () => {
  for (const [of, rmi] of [["PEN", 1], ["FIN", 2], ["FIN", 3]]) {
    const z = zomatikMp({ of, rmi })
    const pasos = []
    const r = await R.descontarMpOf(navFalso(z.rutas), datosMp(), opts({ alPaso: (p) => pasos.push(p) }))
    assert.deepEqual([r.estado, r.yaEstaba, r.grabado, r.paso], ["ok", true, false, "mp_ok"], `${of} ${rmi}: ${r.mensaje}`)
    assert.match(r.mensaje, /ya tenía su remito interno de materia prima/)
    assert.deepEqual([z.estado.posts, z.estado.compos, pasos.length], [0, 0, 0])
  }
  // la OF vieja del robot: FIN con un solo remito interno (el del hormigón)
  const z = zomatikMp({ of: "FIN", rmi: 1 })
  const r = await R.descontarMpOf(navFalso(z.rutas), datosMp(), opts())
  assert.deepEqual([r.estado, r.grabado, z.estado.posts, z.estado.rmi.length], ["ok", true, 1, 2], r.mensaje)
})

test("materia prima: sin composición, otra OF en la pantalla o un campo desconocido → 'revisar' SIN mandar ni poner la marca", async () => {
  for (const [compo, re] of [
    [COMPO_SIN_MATERIALES(9002), /^El artículo de la OF no tiene composición en Zomatik: no hay materia prima para descontar\. \(OF 0001-00003392\)$/],
    [COMPO(9003), /es de otra OF: 9003 y se esperaba 9002/],
    [COMPO(9002).replace('<input type="hidden" name="fparam"', '<input type="hidden" name="borrar" value="1"><input type="hidden" name="fparam"'), /campo que no se conoce: borrar/],
    [COMPO(9002).replace("0.9500000000000", "0"), /adescontar_1000013435 vale "0"/],
  ]) {
    const z = zomatikMp({ compo })
    const pasos = []
    const r = await R.descontarMpOf(navFalso(z.rutas), datosMp(), opts({ alPaso: (p) => pasos.push(p) }))
    assert.deepEqual([r.estado, r.grabado, r.paso], ["revisar", false, "mp_of"], r.mensaje)
    assert.match(r.mensaje, re)
    assert.ok(r.recorte)
    assert.deepEqual([z.estado.posts, pasos.length], [0, 0])
  }
  // sin código o sin número de OF: tampoco
  for (const d of [datosMp({ codigo: null }), datosMp({ numero: "OF" })]) {
    const z = zomatikMp()
    const nav = navFalso(z.rutas)
    assert.equal((await R.descontarMpOf(nav, d, opts())).estado, "revisar")
    assert.equal(nav.llamadas.length, 0)
  }
})

test("materia prima: si no se puede poner la marca (otro proceso la puso, o la fila cambió) no se manda nada", async () => {
  const z = zomatikMp()
  const r = await R.descontarMpOf(navFalso(z.rutas), datosMp(), opts({ alPaso: (p) => { if (p === "mp_of") throw Object.assign(new Error("ya tenía la marca"), { name: "Cambio" }) } }))
  assert.notEqual(r.estado, "ok")
  assert.ok(!r.grabado)
  assert.equal(z.estado.posts, 0)
})

test("materia prima: corte después del POST → al reintentar cuenta primero y NO manda dos veces (si llegó, ok; si no aparece, 'revisar')", async () => {
  // el POST llegó (el remito interno quedó) y se cortó la respuesta
  const z = zomatikMp({ alGrabar: (estado, nueva) => { estado.rmi.push(nueva()); throw deRed() } })
  const r1 = await R.descontarMpOf(navFalso(z.rutas), datosMp(), opts())
  assert.deepEqual([r1.estado, r1.grabado, r1.reintentar, r1.sinStock], ["pendiente", true, true, true], r1.mensaje)
  const pasos = []
  const r2 = await R.descontarMpOf(navFalso(z.rutas), datosMp({ yaEnviado: true }), opts({ alPaso: (p) => pasos.push(p) }))
  assert.deepEqual([r2.estado, r2.grabado, r2.yaEstaba, r2.mensaje], ["ok", true, false, null])
  assert.deepEqual([z.estado.posts, z.estado.compos, pasos.length], [1, 1, 0]) // ni la pantalla ni otro POST
  // el POST no llegó (o no se sabe): con la marca puesta, nunca un segundo envío
  const z2 = zomatikMp({ alGrabar: () => { throw deRed() } })
  assert.equal((await R.descontarMpOf(navFalso(z2.rutas), datosMp(), opts())).estado, "pendiente")
  const r3 = await R.descontarMpOf(navFalso(z2.rutas), datosMp({ yaEnviado: true }), opts())
  assert.deepEqual([r3.estado, r3.grabado], ["revisar", true])
  assert.match(r3.mensaje, /se cortó; el remito interno no aparece en Zomatik\. No se manda otra vez/)
  assert.deepEqual([z2.estado.posts, z2.estado.compos], [1, 1])
  // con la marca puesta y el listado sin poder leerse: espera, sin mandar
  const z3 = zomatikMp({ paginaListado: () => resp("<html>mantenimiento</html>") })
  const r4 = await R.descontarMpOf(navFalso(z3.rutas), datosMp({ yaEnviado: true }), opts())
  assert.deepEqual([r4.estado, z3.estado.posts], ["pendiente", 0])
})

test("materia prima: la verificación no cierra (no aparece el remito interno, o aparecen dos) → 'revisar', sin otro envío", async () => {
  const z = zomatikMp({ alGrabar: () => resp("<script>alert('No hay stock de CCTS CEMENTO GRANEL')</script>") })
  const r = await R.descontarMpOf(navFalso(z.rutas), datosMp(), opts())
  assert.deepEqual([r.estado, r.grabado, z.estado.posts], ["revisar", true, 1])
  assert.equal(r.mensaje, "Se mandó la materia prima de la OF 0001-00003392 y el remito interno no apareció en Zomatik (Zomatik dijo: No hay stock de CCTS CEMENTO GRANEL). No se manda otra vez: revisala en Zomatik.")
  const z2 = zomatikMp({ alGrabar: (estado, nueva) => { estado.rmi.push(nueva(), nueva()); return resp("", 302, "listado_ordenfabricacion.php") } })
  const r2 = await R.descontarMpOf(navFalso(z2.rutas), datosMp(), opts())
  assert.deepEqual([r2.estado, r2.grabado, z2.estado.posts], ["revisar", true, 1])
  assert.match(r2.mensaje, /sus remitos internos pasaron de 0 a 2/)
  // se mandó y después el listado no se pudo leer: 'pendiente' con el envío anotado (el próximo intento solo cuenta)
  let lecturas = 0
  const z3 = zomatikMp({ paginaListado: (estado, propias) => (++lecturas > 1 ? resp("<html>mantenimiento</html>") : resp(paginaRmi([...propias(), filaRmi(21249, "0001-00006849", "2026-10-29")]))) })
  const r3 = await R.descontarMpOf(navFalso(z3.rutas), datosMp(), opts())
  assert.deepEqual([r3.estado, r3.grabado, z3.estado.posts], ["pendiente", true, 1])
  assert.match(r3.mensaje, /^Se mandó la materia prima de la OF 0001-00003392, pero no se pudo verificar/)
})

test("materia prima: si los últimos 150 no llegan al día de la OF se busca por fechas; si tampoco llega (o no se entiende), no se sigue", async () => {
  // por defecto solo hay filas de hoy: busca desde 7 días antes hasta mañana, y con esa respuesta sigue
  const z = zomatikMp({ viejas: false })
  const r = await R.descontarMpOf(navFalso(z.rutas), datosMp(), opts())
  assert.deepEqual([r.estado, z.estado.posts], ["ok", 1], r.mensaje)
  const b = new URLSearchParams(z.estado.busquedas[0])
  assert.deepEqual([b.get("bus_fechacred"), b.get("bus_fechacreh"), b.get("bus_numero"), b.get("exportar"), b.get("nota_tabla")], ["2026-10-24", "2026-11-01", "", "0", "remitosinternos"])
  assert.equal(z.estado.busquedas.length, 2) // antes y después de mandar
  // la búsqueda tampoco llega (o viene vacía: un filtro que Zomatik no entendió): no se puede asegurar → espera, sin mandar
  for (const busqueda of [(estado, propias) => resp(paginaRmi(propias())), () => resp(paginaRmi([])), () => resp("<html>error</html>"), () => resp(paginaRmi([filaRmi(1, "0001-00006849", "2026-10-29", null, "OF rara")]))]) {
    const z2 = zomatikMp({ viejas: false, rmi: 0, busqueda })
    const r2 = await R.descontarMpOf(navFalso(z2.rutas), datosMp(), opts())
    assert.deepEqual([r2.estado, r2.sinStock, r2.grabado, z2.estado.posts, z2.estado.compos], ["pendiente", true, false, 0, 0], r2.mensaje)
    assert.match(r2.mensaje, /^No se pudo leer el listado de remitos internos de Zomatik: .* Se reintenta\.$/)
  }
  // el listado de otra sucursal, o con una fila que no se entiende: igual
  const otra = paginaRmi([filaRmi(21249, "0001-00006849", "2026-10-29")]).replace('<option value="18" selected>', '<option value="18">').replace('<option value="17">', '<option value="17" selected>')
  for (const [pagina, re] of [[otra, /vino de otra sucursal/], [paginaRmi([filaRmi(1, "0001-00006849", "2026-10-29", null, "OF rara")]), /cambió el formato/]]) {
    const z3 = zomatikMp({ paginaListado: () => resp(pagina) })
    const r3 = await R.descontarMpOf(navFalso(z3.rutas), datosMp(), opts())
    assert.deepEqual([r3.estado, z3.estado.posts], ["pendiente", 0])
    assert.match(r3.mensaje, re)
  }
})

test("materia prima: una FIN sin ningún remito interno no se sabe (espera); la OF que no aparece o con otro código → 'revisar'; nunca se manda", async () => {
  const z = zomatikMp({ of: "FIN", rmi: 0 })
  const r = await R.descontarMpOf(navFalso(z.rutas), datosMp(), opts())
  assert.deepEqual([r.estado, r.sinStock, z.estado.posts, z.estado.compos], ["pendiente", true, 0, 0])
  assert.match(r.mensaje, /figura FIN con 0 remitos internos en Zomatik: no se puede saber/)
  for (const [d, re] of [[datosMp({ numero: "OF 0001-00009999" }), /no aparece en el listado de OF/], [datosMp({ codigo: 9003 }), /tiene otro código \(9002; el sistema tiene 9003\)/]]) {
    const z2 = zomatikMp()
    const r2 = await R.descontarMpOf(navFalso(z2.rutas), d, opts())
    assert.deepEqual([r2.estado, z2.estado.posts, z2.estado.compos], ["revisar", 0, 0], r2.mensaje)
    assert.match(r2.mensaje, re)
  }
  // se corta la red antes de mandar: espera, sin mandar
  const z3 = zomatikMp({ paginaListado: () => { throw deRed() } })
  const r3 = await R.descontarMpOf(navFalso(z3.rutas), datosMp(), opts())
  assert.deepEqual([r3.estado, !!r3.grabado, r3.sinStock, z3.estado.posts], ["pendiente", false, true, 0])
})

// ── Materia prima: el servidor ──
/** El robot real de la materia prima contra el Zomatik simulado (la OF, remitirla y el remito siguen simulados). */
function conMpReal(f, z) {
  f.dep.navegador = async () => { f.hecho.navegador++; return navFalso(z.rutas) }
  f.dep.robot.descontarMpOf = async (nav, d, o) => { f.hecho.mp = [...(f.hecho.mp || []), d]; return R.descontarMpOf(nav, d, { ...o, hoy: HOY, boundary: "XX" }) }
}
/** La OF que devuelve el robot simulado de `depFalsas` */
const OF_NUEVA = { codigo: 9100, numero: "0001-00003412" }
const otraPasada = (b) => { b.db.zomatik_remitos[0].proximo_intento = "2000-01-01T00:00:00Z" }
const pasar = (b, f, extra = {}) => S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep, ...extra })
const quePaso = (b) => b.db.activity_log.map((x) => x.details["Qué pasó"])

test("servidor, materia prima: OF nueva → OF, materia prima, remitir la OF y el remito, en ese orden; queda 'ok' con la marca y el detalle, y en Actividad", async () => {
  const b = baseZ1()
  const f = depFalsas()
  const z = zomatikMp(OF_NUEVA)
  conMpReal(f, z)
  const orden = []
  for (const k of ["remitoAManoEnNp", "generarOf", "descontarMpOf", "remitirOf", "elegirNumeroRemito", "generarRemito"]) { const fn = f.dep.robot[k]; f.dep.robot[k] = async (...a) => { orden.push(k); return fn(...a) } }
  const pasos = []
  const from = b.sb.from
  b.sb.from = (t) => { const q = from(t); if (t === "zomatik_remitos") { const u = q.update; q.update = (c) => { if (c.paso) pasos.push(c.paso); return u(c) } } return q }
  const res = await pasar(b, f)
  assert.deepEqual(res.hechas.map((x) => x.estado), ["ok"])
  assert.deepEqual(orden, ["remitoAManoEnNp", "generarOf", "descontarMpOf", "remitirOf", "elegirNumeroRemito", "generarRemito"])
  assert.deepEqual(pasos, ["of_ok", "mp_of", "mp_ok", "of_remitida", "numero_elegido", "ok"])
  assert.deepEqual(f.hecho.mp, [{ codigo: 9100, numero: "OF 0001-00003412", deposito: 116, desde: HOY, yaEnviado: false }])
  const r = b.db.zomatik_remitos[0]
  assert.deepEqual([r.estado, r.of_estado, r.remito_estado, r.of_mp_estado, r.of_mp_mensaje, r.sin_stock], ["ok", "ok", "ok", "ok", null, 0])
  assert.ok(Date.parse(r.of_mp_at) > 0)
  assert.deepEqual(r.of_mp_detalle, MP_FIXTURE)
  assert.deepEqual([z.estado.posts, z.estado.rmi.length], [1, 1])
  const a = b.db.activity_log.find((x) => x.details["Qué pasó"] === "Materia prima descontada en Zomatik")
  assert.deepEqual([a.details.OF, a.details.Materiales], ["OF 0001-00003412", "CCTS ARENA ESPECIAL (10000004): 0,93 t · CCTS CEMENTO GRANEL (10000026): 0,28 t · PIEDRA 6-12 (10000612): 0,95 t"])
  assert.deepEqual([f.hecho.mailsMp.length, f.hecho.avisos.length], [0, 0])
  // otra pasada no toca nada
  await pasar(b, f)
  assert.equal(z.estado.posts, 1)
})

test("servidor, materia prima: sin composición → 'MP: revisar', UN mail a Bautista y Juan con la OF, el artículo y el motivo, y el remito del cliente SALE igual; se ve en el chip", async () => {
  const b = baseZ1()
  const f = depFalsas()
  const z = zomatikMp({ ...OF_NUEVA, compo: COMPO_SIN_MATERIALES(9100) })
  conMpReal(f, z)
  await pasar(b, f)
  const r = b.db.zomatik_remitos[0]
  assert.deepEqual([r.estado, r.remito_estado, r.remito_numero, r.of_mp_estado, r.mensaje], ["ok", "ok", "RM 0001-00002260", "revisar", null])
  assert.equal(r.of_mp_mensaje, "El artículo de la OF no tiene composición en Zomatik: no hay materia prima para descontar. (OF 0001-00003412)")
  assert.equal(r.of_mp_at ?? null, null) // no se mandó nada: sin la marca
  assert.deepEqual([z.estado.posts, f.hecho.remitir.length, f.hecho.remito.length], [0, 1, 1])
  assert.equal(f.hecho.mailsMp.length, 1)
  assert.equal(f.hecho.mailsMp[0].titulo, "Zomatik: materia prima sin descontar · OF 0001-00003412 · Pedido 1a2b3c4d")
  for (const linea of ["OF: OF 0001-00003412", "Artículo: H21-620-10 C (CAN)", `Motivo: ${r.of_mp_mensaje}`, "El remito del cliente no se frenó: sigue su camino."]) assert.ok(f.hecho.mailsMp[0].lineas.includes(linea), linea)
  assert.equal(f.hecho.avisos.length, 0) // no va a los gerenciales
  assert.ok(quePaso(b).includes("Materia prima de la OF sin descontar en Zomatik"))
  // otra pasada: ni otro mail ni otro intento
  await pasar(b, f)
  assert.deepEqual([f.hecho.mailsMp.length, f.hecho.mp.length], [1, 1])
  // la pantalla: "MP sin descontar" en el chip, con el motivo en el detalle (sin montos)
  const est = (await S.estadoRemitos([PED], b.sb))[PED]
  assert.deepEqual([est[0].of_mp_estado, est[0].of_mp_mensaje], ["revisar", r.of_mp_mensaje])
  const c = chipRemito(est)
  assert.deepEqual([c.texto, c.clase], ["RM …2260 ✓ · MP sin descontar", "aviso"])
  assert.match(c.titulo, /OF 0001-00003412 · materia prima sin descontar en Zomatik · El artículo de la OF no tiene composición/)
  // sin 'revisar' el chip es el de siempre
  assert.equal(chipRemito([{ ...est[0], of_mp_estado: "ok", of_mp_mensaje: null }]).texto, "RM …2260 ✓")
  assert.equal(chipRemito([{ ...est[0], estado: "pendiente", remito_numero: null }]).texto, "Remito pendiente · MP sin descontar")
})

test("servidor, materia prima: todavía no se pudo (listado ilegible, red) → la fila espera SIN remitir la OF; a los 6 intentos, 'revisar' con su mail y el remito sale", async () => {
  const b = baseZ1()
  const f = depFalsas()
  f.hecho.respuestaMp = { estado: "pendiente", mensaje: "No se pudo leer el listado de remitos internos de Zomatik: Zomatik cambió el formato. Se reintenta.", paso: "mp_of", reintentar: true, sinStock: true }
  const res = await pasar(b, f)
  assert.deepEqual(res.hechas.map((x) => x.estado), ["pendiente"])
  let r = b.db.zomatik_remitos[0]
  assert.deepEqual([r.estado, r.of_estado, r.of_numero, r.of_mp_estado, r.paso, r.sin_stock, r.en_curso_desde], ["pendiente", "ok", "OF 0001-00003412", "pendiente", "mp_of", 1, null])
  assert.ok(Date.parse(r.proximo_intento) > Date.now())
  assert.deepEqual([f.hecho.remitir, f.hecho.remito.length, f.hecho.mailsMp.length], [undefined, 0, 0])
  for (let i = 2; i <= 5; i++) {
    otraPasada(b)
    await pasar(b, f)
    assert.deepEqual([b.db.zomatik_remitos[0].estado, b.db.zomatik_remitos[0].sin_stock, f.hecho.remito.length], ["pendiente", i, 0])
  }
  otraPasada(b)
  await pasar(b, f)
  r = b.db.zomatik_remitos[0]
  assert.deepEqual([r.estado, r.remito_estado, r.of_mp_estado, r.sin_stock], ["ok", "ok", "revisar", 0])
  assert.equal(r.of_mp_mensaje, "No se pudo leer el listado de remitos internos de Zomatik: Zomatik cambió el formato. Después de 6 intentos no se pudo descontar la materia prima de la OF 0001-00003412: revisala en Zomatik.")
  assert.deepEqual([f.hecho.of.length, f.hecho.mp.length, f.hecho.remitir.length, f.hecho.remito.length, f.hecho.mailsMp.length], [1, 6, 1, 1, 1]) // la OF no se repite
})

test("servidor, materia prima: corte después del POST → la marca queda en la fila y el reintento cuenta primero: un solo envío (si no aparece, 'revisar' y el remito sale)", async () => {
  // llegó a Zomatik y se cortó
  const b = baseZ1()
  const f = depFalsas()
  const z = zomatikMp({ ...OF_NUEVA, alGrabar: (estado, nueva) => { estado.rmi.push(nueva()); throw deRed() } })
  conMpReal(f, z)
  await pasar(b, f)
  let r = b.db.zomatik_remitos[0]
  assert.deepEqual([r.estado, r.of_mp_estado, r.paso, r.sin_stock, f.hecho.remito.length], ["pendiente", "pendiente", "mp_of", 1, 0])
  assert.ok(Date.parse(r.of_mp_at) > 0)
  assert.deepEqual(r.of_mp_detalle, MP_FIXTURE)
  otraPasada(b)
  await pasar(b, f)
  r = b.db.zomatik_remitos[0]
  assert.deepEqual([f.hecho.mp[1].yaEnviado, z.estado.posts, z.estado.compos, r.estado, r.of_mp_estado, f.hecho.remito.length, f.hecho.of.length], [true, 1, 1, "ok", "ok", 1, 1])
  assert.ok(b.db.activity_log.some((x) => x.details["Qué pasó"] === "Materia prima descontada en Zomatik" && /intento anterior que se cortó/.test(x.details.Detalle)))
  // no se sabe si llegó (no aparece): nunca un segundo envío
  const b2 = baseZ1()
  const f2 = depFalsas()
  const z2 = zomatikMp({ ...OF_NUEVA, alGrabar: () => { throw deRed() } })
  conMpReal(f2, z2)
  await pasar(b2, f2)
  otraPasada(b2)
  await pasar(b2, f2)
  const r2 = b2.db.zomatik_remitos[0]
  assert.deepEqual([z2.estado.posts, r2.estado, r2.of_mp_estado, f2.hecho.remito.length, f2.hecho.mailsMp.length], [1, "ok", "revisar", 1, 1])
  assert.match(r2.of_mp_mensaje, /No se manda otra vez \(para no descontar dos veces\)/)
})

test("servidor, materia prima: la marca ya la puso otro proceso → este no manda nada ni toca la fila", async () => {
  const b = baseZ1()
  const f = depFalsas()
  let enviados = 0
  f.hecho.respuestaMp = async (d, o) => {
    b.db.zomatik_remitos[0].of_mp_at = "2026-10-31T12:00:00.000Z" // otro proceso, entre que se leyó la fila y la marca
    try { await o.alPaso("mp_of", { mp: MP_FIXTURE }) } catch (e) { return { estado: "error", mensaje: e.message, paso: "mp_of" } }
    enviados++
    return { estado: "ok", mensaje: null, paso: "mp_ok", grabado: true, mp: MP_FIXTURE }
  }
  const res = await pasar(b, f)
  const r = b.db.zomatik_remitos[0]
  assert.deepEqual([enviados, res.hechas[0].estado, r.of_mp_estado, r.of_mp_at, f.hecho.remitir, f.hecho.remito.length, f.hecho.mailsMp.length], [0, "cambió", "pendiente", "2026-10-31T12:00:00.000Z", undefined, 0, 0])
  assert.equal(r.of_mp_detalle, undefined)
})

test("servidor, materia prima: un despacho sin pedido también descuenta (su OF queda PEN); una fila con la OF ya hecha y sin marcar (vieja) no se toca", async () => {
  const b = baseZ1({ remito: { tipo: "suelto", np_id: null, comprobante: null } })
  const f = depFalsas()
  await pasar(b, f)
  const r = b.db.zomatik_remitos[0]
  assert.deepEqual([f.hecho.mp.length, r.estado, r.remito_estado, r.of_mp_estado], [1, "ok", "a_mano", "ok"])
  // la fila vieja frenada por falta de stock (OF hecha antes de la migración: of_mp_estado NULL) sigue como siempre, sin materia prima
  const b2 = baseZ1({ remito: { ...FILA_OF_OK, sin_stock: 2, paso: "continuar_remito" } })
  const f2 = depFalsas()
  await pasar(b2, f2)
  assert.deepEqual([f2.hecho.mp, f2.hecho.remito.length, b2.db.zomatik_remitos[0].estado, b2.db.zomatik_remitos[0].of_mp_estado], [undefined, 1, "ok", undefined])
})

const FILA_CERRADA = { ...FILA_OF_OK, estado: "ok", remito_estado: "ok", remito_numero: "RM 0001-00002260", remito_codigo: 5550, paso: "ok", mensaje: null, proximo_intento: null }

test("servidor, regularizar: una fila vieja ya cerrada marcada 'pendiente' (OF FIN con 1 remito interno) → la pasada la descuenta y no toca nada más de la fila", async () => {
  const b = baseZ1({ remito: { ...FILA_CERRADA, of_mp_estado: "pendiente", of_mp_at: null } })
  const f = depFalsas()
  const z = zomatikMp({ of: "FIN", rmi: 1 })
  conMpReal(f, z)
  // "Remitir en Zomatik" de un pedido no regulariza: solo la pasada
  await pasar(b, f, { pedidoId: PED })
  assert.deepEqual([f.hecho.navegador, z.estado.posts], [0, 0])
  const res = await pasar(b, f)
  assert.deepEqual(res.hechas, [{ id: "rem1", estado: "mp_ok", mensaje: null }])
  const r = b.db.zomatik_remitos[0]
  assert.deepEqual([z.estado.posts, z.estado.rmi.length, r.of_mp_estado, r.sin_stock], [1, 2, "ok", 0])
  assert.deepEqual(f.hecho.mp, [{ codigo: 9002, numero: "OF 0001-00003392", deposito: 116, desde: HOY, yaEnviado: false }])
  assert.deepEqual(r.of_mp_detalle, MP_FIXTURE)
  assert.ok(Date.parse(r.of_mp_at) > 0)
  // la fila, como estaba: ni la OF ni el remito ni su paso
  assert.deepEqual([r.estado, r.of_estado, r.remito_estado, r.remito_numero, r.paso, r.mensaje, r.proximo_intento, r.intentos], ["ok", "ok", "ok", "RM 0001-00002260", "ok", null, null, 0])
  assert.deepEqual([f.hecho.of.length, f.hecho.remito.length, f.hecho.remitir, f.hecho.comprobantes], [0, 0, undefined, undefined])
  assert.ok(quePaso(b).includes("Materia prima descontada en Zomatik"))
  // otra pasada: ya está 'ok', no se abre Zomatik
  await pasar(b, f)
  assert.deepEqual([z.estado.posts, f.hecho.navegador], [1, 1])
})

test("servidor, regularizar: solo las marcadas 'pendiente' (NULL, 'no', 'ok' y 'revisar' no se tocan); si ya tenía sus dos remitos internos, 'ok' sin mandar", async () => {
  for (const marca of [undefined, null, "no", "ok", "revisar"]) {
    const b = baseZ1({ remito: { ...FILA_CERRADA, ...(marca === undefined ? {} : { of_mp_estado: marca }) } })
    const f = depFalsas()
    const z = zomatikMp({ of: "FIN", rmi: 1 })
    conMpReal(f, z)
    const res = await pasar(b, f)
    assert.deepEqual([res.hechas.length, f.hecho.navegador, z.estado.posts, b.db.zomatik_remitos[0].of_mp_estado], [0, 0, 0, marca], String(marca))
  }
  // la OF duplicada de una hecha a mano que SÍ descontó (FIN con 2): no se manda nada
  const b = baseZ1({ remito: { ...FILA_CERRADA, of_mp_estado: "pendiente" } })
  const f = depFalsas()
  const z = zomatikMp({ of: "FIN", rmi: 2 })
  conMpReal(f, z)
  await pasar(b, f)
  const r = b.db.zomatik_remitos[0]
  assert.deepEqual([z.estado.posts, z.estado.compos, r.of_mp_estado, r.estado], [0, 0, "ok", "ok"])
  assert.match(r.of_mp_mensaje, /ya tenía su remito interno de materia prima/)
  assert.ok(Date.parse(r.of_mp_at) > 0)
  assert.ok(quePaso(b).includes("Materia prima de la OF: ya estaba descontada en Zomatik (no se mandó nada)"))
})

test("servidor, regularizar: si no se puede todavía, la fila queda marcada y se reintenta (al tope, 'revisar' y un mail); la red no toca la fila", async (t) => {
  t.mock.method(console, "error", () => {})
  const b = baseZ1({ remito: { ...FILA_CERRADA, of_mp_estado: "pendiente" } })
  const f = depFalsas()
  const z = zomatikMp({ of: "FIN", rmi: 1, paginaListado: () => resp("<html>mantenimiento</html>") })
  conMpReal(f, z)
  const res = await pasar(b, f)
  let r = b.db.zomatik_remitos[0]
  assert.deepEqual([res.hechas[0].estado, r.estado, r.paso, r.of_mp_estado, r.sin_stock, z.estado.posts], ["pendiente", "ok", "ok", "pendiente", 1, 0])
  assert.match(r.of_mp_mensaje, /No se pudo leer el listado de remitos internos/)
  for (let i = 0; i < 5; i++) await pasar(b, f)
  r = b.db.zomatik_remitos[0]
  assert.deepEqual([r.estado, r.paso, r.of_mp_estado, r.sin_stock, z.estado.posts, f.hecho.mailsMp.length], ["ok", "ok", "revisar", 0, 0, 1])
  assert.ok(f.hecho.mailsMp[0].lineas.includes("Es una OF que ya estaba hecha, marcada para regularizar."))
  await pasar(b, f)
  assert.equal(f.hecho.mailsMp.length, 1)
  // no se puede abrir Zomatik: la fila queda igual
  const b2 = baseZ1({ remito: { ...FILA_CERRADA, of_mp_estado: "pendiente" } })
  const f2 = depFalsas()
  f2.dep.navegador = async () => { throw Object.assign(new Error("La sesión de Zomatik se cerró"), { codigo: "sesion_caida" }) }
  const res2 = await pasar(b2, f2)
  assert.deepEqual([res2.hechas[0].estado, b2.db.zomatik_remitos[0].of_mp_estado, b2.db.zomatik_remitos[0].sin_stock, b2.db.zomatik_remitos[0].estado], ["pendiente", "pendiente", 0, "ok"])
})

test("servidor, sin la migración de la materia prima: el paso no corre, no se escribe ninguna columna nueva y todo sigue como hoy (también la pantalla)", async () => {
  const b = baseZ1()
  b.db.sin_mp = true
  const f = depFalsas()
  const orden = []
  for (const k of ["generarOf", "descontarMpOf", "remitirOf", "generarRemito"]) { const fn = f.dep.robot[k]; f.dep.robot[k] = async (...a) => { orden.push(k); return fn(...a) } }
  assert.equal(await S.hayMigracionMp(b.sb), false)
  const res = await pasar(b, f)
  assert.deepEqual(res.hechas.map((x) => x.estado), ["ok"])
  assert.deepEqual(orden, ["generarOf", "remitirOf", "generarRemito"])
  const r = b.db.zomatik_remitos[0]
  assert.deepEqual([r.estado, r.of_estado, r.remito_estado], ["ok", "ok", "ok"])
  assert.deepEqual(Object.keys(r).filter((k) => k.startsWith("of_mp_")), [])
  assert.ok(!b.llamadas.some((l) => l.op === "update" && Object.keys(l.cambios || {}).some((k) => k.startsWith("of_mp_"))))
  const est = (await S.estadoRemitos([PED], b.sb))[PED]
  assert.deepEqual([est.length, est[0].of_mp_estado, est[0].of_mp_mensaje], [1, null, null])
  assert.equal(chipRemito(est).texto, "RM …2260 ✓")
  // con la migración, la base responde: el paso corre
  assert.equal(await S.hayMigracionMp(baseZ1().sb), true)
})
