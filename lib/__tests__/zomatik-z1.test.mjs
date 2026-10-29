// Pruebas de Zomatik Z1 (docs/migracion-loop/zomatik.md, sección 26): qué remitos lleva un pedido en un día, la serie
// del remito, y el robot de la OF y el remito con un navegador SIMULADO (respuestas SUPUESTAS de
// lib/__fixtures__/zomatik-z1: la OF como el robot real de Concretus; el remito según 4.4). Nunca se llama a Zomatik.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as Z from "../zomatik/z1.ts"
import * as R from "../zomatik/z1-robot.ts"
import * as W from "../zomatik/web.ts"
import * as S from "../zomatik/z1-servidor.ts"

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
const datosOf = (extra = {}) => ({ marca: MARCA, deposito: 116, fecha: HOY, m3: 8, articuloCodigoSistema: 1000015959, articuloNombre: "H21-620-10 C (CAN)", foto: null, buscarAntes: false, ...extra })

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
  assert.equal(body.get("fparam"), "7001,8|||")
  assert.equal(body.get("cantidad7001"), "8")
  assert.equal(body.get("ordenfabricacion"), "0")
  assert.equal(body.get("comprobante"), "62")
})

test("OF: la lista trae otra cosa (2 renglones) → frena sin grabar y deja el recorte", async () => {
  const z = zomatikOf()
  z.rutas.unshift(["GET", /^manage_ordenfabricacion/, () => resp(fx("of-manage.html").replace("</table>", '<tr><td>1</td><td>X<input type="hidden" name="codigo7002" value="7002"></td><td><input name="cantidad7002" value="0"></td></tr></table>'))])
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

// ── Robot del remito (SUPUESTO) ──
const filaRm = (codigo, numero) => `<tr><td>2026-10-31</td><td><a href="modificar_remitos.php?codigo=${codigo}">${numero}</a></td><td>OBRA PROPIA REBUCRET</td></tr>`
const listadoRm = (filas) => `<form action="listado_remitos.php?enviado=1" method="POST" name="formulario"><input name="bus_numero" value=""><input type="hidden" name="exportar" value="0"></form><table><tr><td>Fecha</td><td>Numero</td><td>Cliente</td></tr>${filas}</table>`

function zomatikRemito({ ocupado = [], pendientes = "remito-pendientes.html", grabaMarca = null } = {}) {
  const estado = { grabado: null }
  return {
    estado,
    rutas: [
      ["GET", /^modificar_remitos\.php\?pedido=157767$/, () => resp(fx("remito-alta.html"))],
      ["GET", /^manage_remitos\.php\?.*fpedido=157767/, () => resp(fx(pendientes))],
      ["GET", /^listado_remitos\.php$/, () => resp(listadoRm(""))],
      ["POST", /^listado_remitos\.php\?enviado=1$/, ({ suc, cuerpo }) => {
        const n = new URLSearchParams(cuerpo).get("bus_numero")
        if (n) return conSuc(suc, listadoRm(estado.grabado === n ? filaRm(5550, `RM2 ${n}`) : ""))
        return conSuc(suc, listadoRm(filaRm(5548, "RM2 0099-00002745") + filaRm(5547, "RM 0001-00002338")))
      }],
      ["GET", /^_validarnumeroremito\.php\?/, ({ ruta }) => resp(ocupado.some((n) => ruta.includes(n)) ? "El numero de remito ya existe" : "")],
      ["POST", /^grabar_remitos\.php\?codigo=0$/, ({ cuerpo }) => ((estado.grabado = cuerpo.match(/name="numero"\r\n\r\n([^\r]*)/)[1]), resp("", 302, "listado_remitos.php"))],
      ["GET", /^modificar_remitos\.php\?codigo=5550$/, () => resp(`<form action="grabar_remitos.php?codigo=5550" name="frm_remito"><textarea name="observaciones">${grabaMarca ?? MARCA + " - Camiones: AB1"}</textarea></form>`)],
    ],
  }
}
const datosRm = (extra = {}) => ({
  marca: MARCA, npCodigo: 157767, comprobante: "19", deposito: 116, fecha: HOY, m3: 8, articuloCodigo: 10090020, articuloNombre: "H21-620-10 C (CAN)",
  patente: "AB1", observaciones: `${MARCA} - Camiones: AB1`, observacionesimp: "Remitos 884", numeroPrevio: null, buscarAntes: false, ...extra,
})

test("remito: desde la NP, pendientes, número de la serie (2746) validado, patente y observaciones, y verificación", async () => {
  const z = zomatikRemito()
  const pasos = []
  const nav = navFalso(z.rutas)
  const r = await R.generarRemito(nav, datosRm(), opts({ alPaso: (p, extra) => pasos.push([p, extra]) }))
  assert.equal(r.estado, "ok", r.mensaje)
  assert.equal(r.numero, "RM2 0099-00002746")
  assert.deepEqual(pasos.find(([p]) => p === "grabar_remito")[1], { numero: "0099-00002746" }) // el número se guarda ANTES de grabar
  const g = grabados(nav, "remitos")[0]
  const campo = (n) => g.cuerpo.match(new RegExp(`name="${n}"\\r\\n\\r\\n([^\\r]*)\\r\\n`))?.[1]
  assert.equal(campo("comprobante"), "19")
  assert.equal(campo("numero"), "0099-00002746")
  assert.equal(campo("patente"), "AB1")
  assert.equal(campo("transporte"), "1")
  assert.equal(campo("cantidad8001"), "8")
  assert.equal(campo("observaciones"), `${MARCA} - Camiones: AB1`)
})

test("remito: número ocupado → prueba el siguiente; pendiente menor → error sin grabar; sin stock → pendiente (falta la OF)", async () => {
  let z = zomatikRemito({ ocupado: ["0099-00002746"] })
  let nav = navFalso(z.rutas)
  let r = await R.generarRemito(nav, datosRm(), opts())
  assert.equal(r.numero, "RM2 0099-00002747")
  z = zomatikRemito()
  nav = navFalso(z.rutas)
  r = await R.generarRemito(nav, datosRm({ m3: 9 }), opts())
  assert.equal(r.estado, "error")
  assert.match(r.mensaje, /pendientes/)
  assert.equal(grabados(nav, "remitos").length, 0)
  z = zomatikRemito()
  z.rutas.unshift(["GET", /^manage_remitos/, () => resp(fx("remito-pendientes.html").replace('name="stock8001" value="8.000"', 'name="stock8001" value="2.000"'))])
  nav = navFalso(z.rutas)
  r = await R.generarRemito(nav, datosRm(), opts())
  assert.equal(r.estado, "pendiente")
  assert.equal(grabados(nav, "remitos").length, 0)
})

test("remito: la respuesta de 'Continuar' no trae el artículo → frena sin grabar con recorte", async () => {
  const z = zomatikRemito()
  const nav = navFalso(z.rutas)
  const r = await R.generarRemito(nav, datosRm({ articuloCodigo: 99999, articuloNombre: "OTRA" }), opts())
  assert.equal(r.estado, "error")
  assert.ok(r.recorte)
  assert.equal(grabados(nav, "remitos").length, 0)
})

test("remito: corte en Grabar → con el número guardado se encuentra y no se graba otro; sin la marca → revisar", async () => {
  let z = zomatikRemito()
  z.estado.grabado = "0099-00002746"
  let nav = navFalso(z.rutas)
  let r = await R.generarRemito(nav, datosRm({ buscarAntes: true, numeroPrevio: "0099-00002746" }), opts())
  assert.equal(r.estado, "ok", r.mensaje)
  assert.equal(grabados(nav, "remitos").length, 0)
  z = zomatikRemito({ grabaMarca: "cargado a mano" })
  z.estado.grabado = "0099-00002746"
  nav = navFalso(z.rutas)
  r = await R.generarRemito(nav, datosRm({ buscarAntes: true, numeroPrevio: "0099-00002746" }), opts())
  assert.equal(r.estado, "revisar")
  assert.equal(grabados(nav, "remitos").length, 0)
})

// ── Lista cerrada y llave ──
test("lista cerrada: el grupo de Z1 aparte; ni la lectura ni la NP lo habilitan", () => {
  for (const [r, m] of [["modificar_ordenfabricacion.php", "GET"], ["modificar_ordenfabricacion.php?codigo=9002", "GET"], ["manage_ordenfabricacion.php?ordenfabricacion=0&ordenfabricacion_unico=009&farticulo=1", "GET"], ["grabar_ordenfabricacion.php?codigo=0", "POST"], ["modificar_remitos.php?pedido=157767", "GET"], ["manage_remitos.php?fcliente=1&fpedido=157767", "GET"], ["_validarnumeroremito.php?fcomprobante=19&fnumero=0099-00002746", "GET"], ["grabar_remitos.php?codigo=0", "POST"], ["listado_remitos.php?enviado=1", "POST"]])
    assert.equal(W.rutaEscrituraZ1(r, m), true, `${m} ${r}`)
  for (const [r, m] of [["grabar_ordenfabricacion.php?codigo=9002", "POST"], ["grabar_remitos.php?codigo=5550", "POST"], ["manage_remitos.php?fpedido=1&fborrar=3", "GET"], ["manage_ordenfabricacion.php?ordenfabricacion=9002&ordenfabricacion_unico=1", "GET"], ["remitir_pedido.php?codigo=1", "GET"], ["grabar_pedidos.php?codigo=0", "POST"]])
    assert.equal(W.rutaEscrituraZ1(r, m), false, `${m} ${r}`)
  for (const r of ["grabar_remitos.php?codigo=0", "grabar_ordenfabricacion.php?codigo=0", "modificar_remitos.php?pedido=1"]) assert.equal(W.rutaEscrituraNp(r, "POST") || W.rutaEscrituraNp(r, "GET") || W.rutaPermitida(r, "GET") || W.rutaPermitida(r, "POST"), false, r)
})

test("llave de Z1: hace falta la NP prendida Y la de remitir (apagada por defecto)", () => {
  assert.equal(S.llaveZ1(undefined), null)
  assert.equal(S.llaveZ1({ plant_id: "can", activo: true, remitir_activo: false, remitir_desde: null, deposito: 116 }), null)
  assert.equal(S.llaveZ1({ plant_id: "can", activo: false, remitir_activo: true, remitir_desde: null, deposito: 116 }), null)
  assert.deepEqual(S.llaveZ1({ plant_id: "can", activo: true, remitir_activo: true, remitir_desde: null, deposito: 116 }), { remitir: true, plantId: "can" })
})
