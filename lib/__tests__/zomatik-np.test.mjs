// Pruebas de Zomatik Z2 (docs/migracion-loop/zomatik.md, secciones 22 a 24): el robot de la nota de pedido con un
// navegador SIMULADO (respuestas de lib/__fixtures__/zomatik-np, armadas con lo que dice la sección 23), la serie de
// numeración, la sucursal equivocada, el corte en "Grabar", cancelar (vaciar) y agrandar. Sin red ni base: nunca se
// llama a Zomatik.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as N from "../zomatik/np.ts"
import * as R from "../zomatik/np-robot.ts"
import * as W from "../zomatik/web.ts"

const fx = (f) => readFileSync(new URL(`../__fixtures__/zomatik-np/${f}`, import.meta.url), "latin1")
const latin1 = (u8) => Buffer.from(u8).toString("latin1")
const HOY = "2026-10-23"
const PEDIDO = "1a2b3c4d-0000-4000-8000-000000000001"
const MARCA = N.marcaNp(PEDIDO, 1)

const resp = (html, status = 200, location = null) => ({ status, location, html })
/** Resultado del listado de pedidos: la página trae el selector de sucursal con la activa (así se ve si otro sistema la cambió). */
const lst = (suc, html) => resp(`<form method="post" action="" name="frm_selsuc"><select name="selsuc"><option value="${suc}" selected>S</option></select></form>${html}`)
const npAbierta = (codigo, { marca = MARCA, renglones = true, numero = "0001-00001176" } = {}) =>
  resp(fx("np-abierta.html").replaceAll("{{CODIGO}}", String(codigo)).replace("{{OBS}}", marca).replace("{{NUMERO}}", numero).replace("{{RENGLONES}}", renglones ? fx("renglon-np.html") : ""))

/**
 * Navegador simulado. `rutas`: [metodo, regex, (ctx) => respuesta]. Lleva la sucursal activa y anota cada llamada
 * con la sucursal del momento. `alLlamar` deja simular que otro sistema cambia la sucursal en el medio.
 */
function navFalso(rutas, { alLlamar } = {}) {
  const nav = {
    suc: "18",
    llamadas: [],
    async sucursal(id) {
      nav.llamadas.push({ m: "SUC", ruta: id, suc: nav.suc })
      nav.suc = id
      return true
    },
    async get(ruta) {
      return responder("GET", ruta, null)
    },
    async post(ruta, cuerpo, tipo) {
      return responder("POST", ruta, cuerpo ? latin1(cuerpo) : "", tipo)
    },
  }
  async function responder(m, ruta, cuerpo, tipo) {
    const ll = { m, ruta, suc: nav.suc, cuerpo, tipo }
    nav.llamadas.push(ll)
    alLlamar?.(ll, nav)
    assert.ok(m === "POST" ? W.rutaEscrituraNp(ruta, m) || W.rutaPermitida(ruta, m) : W.rutaEscrituraNp(ruta, m) || W.rutaPermitida(ruta, m), `ruta fuera de la lista cerrada: ${m} ${ruta}`)
    const r = rutas.find(([mm, re]) => mm === m && re.test(ruta))
    if (!r) throw new Error(`ruta no simulada: ${m} ${ruta}`)
    return r[2]({ ruta, cuerpo, suc: nav.suc, nav })
  }
  return nav
}

/** Zomatik simulado para una NP nueva. `grabaEn`: sucursal donde queda (la activa al grabar, como pasó el 22/10). */
function zomatikNueva({ numeroRuta25Siempre = false, grabar, listadoHoy } = {}) {
  const estado = { grabadaEn: null }
  const rutas = [
    ["GET", /^modificar_pedidos\.php$/, () => resp(fx("alta.html"))],
    ["GET", /^traerdatossecundarios\.php\?fcliente=15893/, () => resp(fx("secundarios.txt"))],
    ["GET", /^listado_listas\.php$/, () => resp(fx("listas.html"))],
    ["GET", /^manage_pedidos\.php\?.*farticulo=1000015959/, () => resp(fx("detalle-articulo.html"))],
    ["GET", /^manage_pedidos\.php\?/, () => resp(fx("detalle-vacio.html"))],
    ["GET", /^_getnumerofactura\.php\?fcomprobante=15/, ({ suc }) => resp(suc === "18" && !numeroRuta25Siempre ? "0001-00001176" : "0001-00007707")],
    ["POST", /^grabar_pedidos\.php\?codigo=0$/, (c) => {
      if (grabar) return grabar(c, estado)
      estado.grabadaEn = c.suc
      return resp("", 302, "listado_pedidos.php")
    }],
    ["GET", /^listado_pedidos\.php$/, () => resp(fx("listado-buscador.html"))],
    ["POST", /^listado_pedidos\.php\?enviado=1$/, ({ cuerpo, suc }) => {
      if (/bus_numero=0001-00001176/.test(cuerpo)) return lst(suc, fx(suc === "18" && estado.grabadaEn === "18" ? "listado-1176.html" : "listado-vacio.html"))
      if (/bus_fechad=2026-10-23/.test(cuerpo)) {
        if (listadoHoy) return lst(suc, fx(listadoHoy(suc, estado)))
        if (estado.grabadaEn === suc) return lst(suc, fx(suc === "18" ? "listado-hoy-rebucret.html" : "listado-hoy-ruta25.html"))
        return lst(suc, fx("listado-vacio.html"))
      }
      return lst(suc, fx("listado-vacio.html"))
    }],
    ["GET", /^modificar_pedidos\.php\?codigo=157704$/, () => npAbierta(157704)],
    ["GET", /^modificar_pedidos\.php\?codigo=157706$/, () => npAbierta(157706, { marca: "Otra cosa" })],
    ["GET", /^modificar_pedidos\.php\?codigo=157705$/, () => npAbierta(157705, { numero: "0001-00007708" })],
  ]
  return { rutas, estado }
}

const datosNueva = (extra = {}) => ({
  marca: MARCA, tipo: "nueva", comprobante: "15", clienteCodigo: 15893, clienteNombre: "OBRA PROPIA REBUCRET", deposito: 116,
  fecha: HOY, m3: 8, articuloCodigoSistema: 1000015959, articuloCodigo: 10090020, articuloNombre: "H21-620-10 C (CAN)", proyectoCodigo: null,
  entrega: "Obra: Planta · Ruta 2 km 45", buscarAntes: false, ...extra,
})
const opts = (extra = {}) => ({ hoy: HOY, azar: () => 7, boundary: "XX", ...extra })
const grabados = (nav) => nav.llamadas.filter((l) => l.m === "POST" && /^grabar_pedidos/.test(l.ruta))

// ── Robot: NP nueva ──
test("NP nueva: los pasos de la prueba del 22/10, con la sucursal REBUCRET justo antes del número y de grabar", async () => {
  const z = zomatikNueva()
  const nav = navFalso(z.rutas)
  const pasos = []
  const r = await R.generarNp(nav, datosNueva(), opts({ alPaso: (p) => pasos.push(p) }))
  assert.equal(r.estado, "ok", r.mensaje)
  assert.equal(r.numero, "NP 0001-00001176")
  assert.equal(r.codigo, 157704)
  assert.equal(r.sucursal, "18")
  // orden de los pasos
  assert.deepEqual(pasos, ["formulario", "cliente", "lista", "continuar", "articulo", "numero", "grabar", "verificar"])
  // sucursal 18 inmediatamente antes de pedir el número y de grabar
  const i = nav.llamadas.findIndex((l) => /^_getnumerofactura/.test(l.ruta))
  assert.deepEqual([nav.llamadas[i - 1].m, nav.llamadas[i - 1].ruta], ["SUC", "18"])
  const g = nav.llamadas.findIndex((l) => /^grabar_pedidos/.test(l.ruta))
  assert.deepEqual([nav.llamadas[g - 1].m, nav.llamadas[g - 1].ruta], ["SUC", "18"])
  // lo que se graba
  const cuerpo = nav.llamadas[g].cuerpo
  const campo = (n) => cuerpo.match(new RegExp(`name="${n}"\\r\\n\\r\\n([^\\r]*)\\r\\n`))?.[1]
  assert.equal(campo("idcliente"), "15893")
  assert.equal(campo("deposito"), "116")
  assert.equal(campo("comprobante"), "15")
  assert.equal(campo("numero"), "0001-00001176")
  assert.equal(campo("idlista"), "10247")
  assert.equal(campo("idvendedor"), "100")
  assert.equal(campo("origen"), "1")
  assert.equal(campo("fecha_entrega"), HOY)
  // Renglón real del 28/10: codigo<id> es el id del renglón (5349423) y es lo que va en fparam (GrabarDatosDetalle)
  assert.equal(campo("cantidad5349423"), "8")
  assert.equal(campo("codigo5349423"), "5349423")
  assert.equal(campo("fparam"), "5349423,176500.000,8,|||")
  // todos los campos del renglón y los sueltos del detalle, como los manda el navegador
  for (const n of ["peso5349423", "hcosto5349423", "costo5349423", "apallet5349423", "palletcant5349423", "coeficiente5349423", "observacionesdetalle5349423", "credito", "compraactual", "compraactualsib", "totalacopio"])
    assert.notEqual(campo(n), undefined, n)
  assert.equal(campo("pedidos_unico"), "0425037001792526529")
  // la marca va en latin1 (el "·" es un solo byte 0xB7, como lo manda el navegador)
  assert.ok(cuerpo.includes(`name="observaciones"\r\n\r\n${MARCA}\r\n`))
  assert.equal(Buffer.from(cuerpo, "latin1").includes(Buffer.from([0xb7])), true)
  assert.equal(nav.llamadas[g].tipo, "multipart/form-data; boundary=XX")
  assert.equal(grabados(nav).length, 1)
  assert.equal(nav.suc, "18")
})

test("vendedor: el de quien programa (si tiene); si no, el del cliente; si ninguno, no se genera", async () => {
  const z = zomatikNueva()
  let nav = navFalso(z.rutas)
  let r = await R.generarNp(nav, datosNueva({ vendedorId: 101, vendedorNombre: "OREGUY JUAN" }), opts())
  assert.equal(r.estado, "ok", r.mensaje)
  const campo = (c, n) => c.match(new RegExp(`name="${n}"\\r\\n\\r\\n([^\\r]*)\\r\\n`))?.[1]
  assert.equal(campo(grabados(nav)[0].cuerpo, "idvendedor"), "101")
  assert.equal(campo(grabados(nav)[0].cuerpo, "vendedor_manual"), "1")
  const z2 = zomatikNueva()
  z2.rutas.unshift(["GET", /^traerdatossecundarios/, () => resp(fx("secundarios.txt").replace("#||#100#||#", "#||#0#||#"))])
  nav = navFalso(z2.rutas)
  r = await R.generarNp(nav, datosNueva(), opts())
  assert.equal(r.estado, "error")
  assert.match(r.mensaje, /cargale el vendedor/)
  assert.equal(grabados(nav).length, 0)
})

test("respuesta real del 28/10: el renglón se reconoce por el código visible (o el nombre), no por codigo<id>", () => {
  const rs = N.renglonesDetalle(fx("detalle-articulo.html"))
  assert.equal(rs.length, 1)
  assert.equal(rs[0].codigo, "5349423") // id del renglón
  assert.equal(rs[0].codigoArticulo, "10090020")
  assert.equal(rs[0].nombreArticulo, "H21-620-10 C (CAN)")
  assert.equal(rs[0].cantidad, "0.000")
  assert.equal(rs[0].borrar, "5349423")
  assert.equal(N.esRenglonDe(rs[0], { codigo: 10090020 }), true)
  assert.equal(N.esRenglonDe(rs[0], { codigo: 1000015959 }), false) // el "Codigo Sistema" no está en el renglón
  assert.equal(N.esRenglonDe(rs[0], { nombre: "h21-620-10 c (can)" }), true)
  assert.equal(N.renglonesDetalle(fx("detalle-vacio.html")).length, 0) // "Continuar": la misma tabla sin renglones
  assert.deepEqual(N.camposSueltosDetalle(fx("detalle-articulo.html")).map((c) => c.nombre), ["credito", "compraactual", "compraactualsib", "totalacopio"])
})

test("si el renglón no coincide, el error trae un recorte de la respuesta para Actividad (y no se graba)", async () => {
  const z = zomatikNueva()
  const nav = navFalso(z.rutas)
  const r = await R.generarNp(nav, datosNueva({ articuloCodigo: 99999999, articuloNombre: "OTRA COSA" }), opts())
  assert.equal(r.estado, "error")
  assert.match(r.mensaje, /otros renglones/)
  assert.ok(r.recorte && r.recorte.length <= 2000 && /5349423/.test(r.recorte), "recorte de la respuesta")
  assert.equal(grabados(nav).length, 0)
})

test("NP nueva: controles antes de tocar Zomatik (sin cliente, sin artículo, sin R/X): no se llama a nada", async () => {
  for (const [extra, texto] of [[{ clienteCodigo: null }, /no está vinculado/], [{ articuloCodigoSistema: null }, /artículo de Zomatik/], [{ comprobante: null }, /R o X/], [{ deposito: null }, /depósito/]]) {
    const nav = navFalso([])
    const r = await R.generarNp(nav, datosNueva(extra), opts())
    assert.equal(r.estado, "error")
    assert.equal(r.reintentar, false)
    assert.match(r.mensaje, texto)
    assert.equal(nav.llamadas.length, 0)
  }
})

test("NP nueva: cliente sin vendedor o listas activas repetidas → error con el motivo, sin grabar", async () => {
  const z = zomatikNueva()
  z.rutas.unshift(["GET", /^traerdatossecundarios/, () => resp(fx("secundarios.txt").replace("#||#100#||#", "#||#0#||#"))])
  let nav = navFalso(z.rutas)
  let r = await R.generarNp(nav, datosNueva(), opts())
  assert.equal(r.estado, "error")
  assert.match(r.mensaje, /vendedor/)
  assert.equal(grabados(nav).length, 0)

  const z2 = zomatikNueva()
  z2.rutas.unshift(["GET", /^listado_listas/, () => resp(fx("listas.html").replace("Invisible", "Activo"))])
  nav = navFalso(z2.rutas)
  r = await R.generarNp(nav, datosNueva(), opts())
  assert.equal(r.estado, "error")
  assert.match(r.mensaje, /2 listas activas "en 1"/)
  assert.equal(grabados(nav).length, 0)
})

test("Zomatik cambió el formulario: falta un campo → no se manda nada", async () => {
  const z = zomatikNueva()
  z.rutas.unshift(["GET", /^modificar_pedidos\.php$/, () => resp(fx("alta.html").replace('name="idvendedor"', 'name="otro"'))])
  const nav = navFalso(z.rutas)
  const r = await R.generarNp(nav, datosNueva(), opts())
  assert.equal(r.estado, "error")
  assert.match(r.mensaje, /cambió el formulario.*idvendedor/)
  assert.equal(nav.llamadas.filter((l) => /^manage_|^grabar_/.test(l.ruta)).length, 0)
})

// ── Serie de numeración ──
test("serie: el número de RUTA 25 no se usa; si otro sistema cambió la sucursal, se vuelve a pedir", async () => {
  // Concretus cambia la sucursal a 17 justo antes del número (una vez): el robot vuelve a 18 y pide de nuevo
  let cambiada = false
  const z = zomatikNueva()
  const nav = navFalso(z.rutas, {
    alLlamar: (ll, n) => {
      if (!cambiada && /^_getnumerofactura/.test(ll.ruta)) {
        cambiada = true
        n.suc = "17"
        ll.suc = "17"
      }
    },
  })
  const r = await R.generarNp(nav, datosNueva(), opts())
  assert.equal(r.estado, "ok", r.mensaje)
  assert.equal(nav.llamadas.filter((l) => /^_getnumerofactura/.test(l.ruta)).length, 2)
  assert.equal(grabados(nav).length, 1)
})

test("serie: si el número sigue sin ser de REBUCRET, no se graba y queda pendiente (reintento en 10 min)", async () => {
  const z = zomatikNueva({ numeroRuta25Siempre: true })
  const nav = navFalso(z.rutas)
  const r = await R.generarNp(nav, datosNueva(), opts())
  assert.equal(r.estado, "pendiente")
  assert.match(r.mensaje, /0001-00007707/)
  assert.equal(grabados(nav).length, 0)
})

test("esSerieRebucret y números", () => {
  assert.equal(N.esSerieRebucret("0001-00001176"), true)
  assert.equal(N.esSerieRebucret("NP2 0001-00002079"), true)
  assert.equal(N.esSerieRebucret("0001-00007706"), false)
  assert.equal(N.esSerieRebucret("0001-00006001"), false)
  assert.equal(N.esSerieRebucret("0002-00001176"), false)
  assert.equal(N.esSerieRebucret("basura"), false)
  assert.equal(N.numeroNormalizado(" 1-1176\n"), "0001-00001176")
  assert.equal(N.numeroCompleto("16", "0001-00002080"), "NP2 0001-00002080")
  assert.equal(N.comprobanteDe("R"), "15")
  assert.equal(N.comprobanteDe("X"), "16")
  assert.equal(N.comprobanteDe(null), null)
  assert.equal(N.comprobanteDeNumero("NP2 0001-00002080"), "16")
})

// ── Sucursal equivocada ──
test("sucursal equivocada: se grabó en RUTA 25 → 'revisar' con el número, y la sesión vuelve a REBUCRET", async () => {
  // Otro sistema cambia la sucursal a 17 entre el último cambio a 18 y el Grabar
  const z = zomatikNueva()
  const nav = navFalso(z.rutas, {
    alLlamar: (ll, n) => {
      if (ll.m === "POST" && /^grabar_pedidos/.test(ll.ruta)) {
        n.suc = "17"
        ll.suc = "17"
      }
    },
  })
  const r = await R.generarNp(nav, datosNueva(), opts())
  assert.equal(z.estado.grabadaEn, "17")
  assert.equal(r.estado, "revisar")
  assert.equal(r.sucursal, "17")
  assert.equal(r.numero, "NP 0001-00007708")
  assert.equal(r.codigo, 157705)
  assert.match(r.mensaje, /RUTA 25/)
  assert.equal(nav.llamadas.at(-1).m, "SUC")
  assert.equal(nav.llamadas.at(-1).ruta, "18")
  assert.equal(grabados(nav).length, 1) // no se graba otra
})

// ── Corte en Grabar ──
test("corte en Grabar: queda pendiente 'buscar la marca'; el 'grabar' se avisa ANTES de mandarlo", async () => {
  const pasos = []
  const z = zomatikNueva({
    grabar: () => {
      assert.equal(pasos.at(-1), "grabar") // ya quedó registrado
      throw Object.assign(new Error("Zomatik no respondió a tiempo"), { codigo: "sin_respuesta" })
    },
  })
  const nav = navFalso(z.rutas)
  const r = await R.generarNp(nav, datosNueva(), opts({ alPaso: (p) => pasos.push(p) }))
  assert.equal(r.estado, "pendiente")
  assert.equal(r.grabado, true)
  assert.match(r.mensaje, /busca la NP por la marca/)
})

test("reintento después de un corte: si la marca está, queda ok SIN volver a grabar", async () => {
  const z = zomatikNueva()
  z.estado.grabadaEn = "18" // el Grabar cortado sí había llegado
  const nav = navFalso(z.rutas)
  const r = await R.generarNp(nav, datosNueva({ buscarAntes: true }), opts())
  assert.equal(r.estado, "ok", r.mensaje)
  assert.equal(r.codigo, 157704)
  assert.equal(grabados(nav).length, 0)
  // abrió la otra NP del día (sin la marca) y la nuestra
  assert.ok(nav.llamadas.some((l) => l.ruta === "modificar_pedidos.php?codigo=157704"))
})

test("reintento al día siguiente de un corte: la marca se busca desde el día en que se creó la NP", async () => {
  // La NP quedó grabada ayer (22/10): solo aparece si el buscador arranca el 22
  const z = zomatikNueva()
  z.rutas.unshift(["POST", /^listado_pedidos\.php\?enviado=1$/, ({ cuerpo, suc }) => lst(suc, fx(suc === "18" && /bus_fechad=2026-10-22/.test(cuerpo) ? "listado-hoy-rebucret.html" : "listado-vacio.html"))])
  const nav = navFalso(z.rutas)
  const r = await R.generarNp(nav, datosNueva({ buscarAntes: true, creadaEl: "2026-10-22" }), opts())
  assert.equal(r.estado, "ok", r.mensaje)
  assert.equal(grabados(nav).length, 0)
})

test("reintento después de un corte: si la marca no está en ningún lado, se genera de nuevo (un solo Grabar)", async () => {
  const z = zomatikNueva()
  const nav = navFalso(z.rutas)
  const r = await R.generarNp(nav, datosNueva({ buscarAntes: true }), opts())
  assert.equal(r.estado, "ok", r.mensaje)
  assert.equal(grabados(nav).length, 1)
  // buscó en REBUCRET y en RUTA 25 antes de grabar
  const antes = nav.llamadas.slice(0, nav.llamadas.findIndex((l) => /^grabar_/.test(l.ruta)))
  assert.ok(antes.some((l) => l.m === "SUC" && l.ruta === "17"))
})

test("corte: la NP se graba con la razón social de Zomatik, distinta de nuestro nombre → igual se encuentra", async () => {
  const z = zomatikNueva()
  z.estado.grabadaEn = "18"
  const nav = navFalso(z.rutas)
  const r = await R.generarNp(nav, datosNueva({ buscarAntes: true, clienteNombre: "Rebucret (obra propia, nombre nuestro)" }), opts())
  assert.equal(r.estado, "ok", r.mensaje)
  assert.equal(r.codigo, 157704)
  assert.equal(grabados(nav).length, 0)
  // filtró por depósito y sucursal, no por nombre
  const busq = nav.llamadas.find((l) => l.m === "POST" && /bus_fechad/.test(l.cuerpo || ""))
  assert.match(busq.cuerpo, /bus_deposito=116/)
  assert.match(busq.cuerpo, /bus_sucursal=18/)
})

test("corte: búsqueda no concluyente (varias páginas) → 'revisar' y NO se vuelve a generar", async () => {
  const z = zomatikNueva()
  z.rutas.unshift(["POST", /^listado_pedidos\.php\?enviado=1$/, ({ suc }) => lst(suc, fx("listado-hoy-rebucret.html").replace("</table>", "</table><table><tr><td>&nbsp;Pagina 1 de 2</td><td><a href=\"listado_pedidos.php?&pagina=2\">Siguiente &gt;</a></td></tr></table>"))])
  z.rutas.unshift(["GET", /^modificar_pedidos\.php\?codigo=157704$/, () => npAbierta(157704, { marca: "Otra" })])
  const nav = navFalso(z.rutas)
  const r = await R.generarNp(nav, datosNueva({ buscarAntes: true }), opts())
  assert.equal(r.estado, "revisar")
  assert.match(r.mensaje, /2 páginas/)
  assert.equal(grabados(nav).length, 0)
})

test("corte: cualquier señal de paginado (link Siguiente sin 'Página X de Y') → 'revisar', sin generar", async () => {
  const z = zomatikNueva()
  z.rutas.unshift(["POST", /^listado_pedidos\.php\?enviado=1$/, ({ suc }) => lst(suc, fx("listado-vacio.html") + '<a href="listado_pedidos.php?&pagina=2">Siguiente &gt;</a>')])
  const nav = navFalso(z.rutas)
  const r = await R.generarNp(nav, datosNueva({ buscarAntes: true }), opts())
  assert.equal(r.estado, "revisar")
  assert.match(r.mensaje, /más páginas/)
  assert.equal(grabados(nav).length, 0)
  assert.equal(N.hayPaginado("<table></table>"), false)
  assert.equal(N.hayPaginado('<a href="listado_pedidos.php?orden=x&pagina=3">3</a>'), true)
})

test("búsqueda larga: el robot avisa el paso en cada NP que abre (renueva el turno)", async () => {
  const z = zomatikNueva()
  z.estado.grabadaEn = "18"
  const pasos = []
  const r = await R.generarNp(navFalso(z.rutas), datosNueva({ buscarAntes: true }), opts({ alPaso: (p) => pasos.push(p) }))
  assert.equal(r.estado, "ok")
  assert.ok(pasos.filter((p) => p === "buscar_marca").length >= 3, pasos.join(","))
})

test("corte: otro sistema cambió la sucursal en medio de la búsqueda → 'revisar', sin generar", async () => {
  const z = zomatikNueva()
  const nav = navFalso(z.rutas, { alLlamar: (ll, n) => { if (ll.m === "POST" && /bus_fechad/.test(ll.cuerpo || "")) n.suc = "17" } })
  const r = await R.generarNp(nav, datosNueva({ buscarAntes: true }), opts())
  assert.equal(r.estado, "revisar")
  assert.match(r.mensaje, /otra sucursal/)
  assert.equal(grabados(nav).length, 0)
})

test("Zomatik contesta con alert() y no grabó → error con su texto (no se reintenta solo)", async () => {
  const z = zomatikNueva({ grabar: () => resp(fx("grabar-alert.html")) })
  const nav = navFalso(z.rutas)
  const r = await R.generarNp(nav, datosNueva(), opts())
  assert.equal(r.estado, "error")
  assert.equal(r.reintentar, false)
  assert.match(r.mensaje, /Vendedor debe ser completado/)
})

// ── NP de un proyecto (MATERIAL) ──
function zomatikProyecto({ grabadaEn = "18" } = {}) {
  const estado = { grabada: false, borrados: [] }
  const marcaP = N.marcaNp(PEDIDO, 1)
  return {
    estado,
    rutas: [
      ["GET", /^modificar_pedidos\.php\?proyecto=576&tipo=1$/, () => resp(fx("material.html"))],
      ["GET", /^manage_pedidos\.php\?.*fborrar=5349502/, ({ ruta }) => (estado.borrados.push(ruta), resp(fx("detalle-proyecto-1.html")))],
      ["GET", /^manage_pedidos\.php\?.*fproyecto=576.*forigen=3/, () => resp(fx("detalle-proyecto.html"))],
      ["POST", /^grabar_pedidos\.php\?codigo=0$/, ({ suc }) => ((estado.grabada = suc), resp("", 302, "listado_pedidos.php"))],
      ["GET", /^listado_pedidos\.php$/, () => resp(fx("listado-buscador.html"))],
      ["POST", /^listado_pedidos\.php\?enviado=1$/, ({ suc }) => lst(suc, fx(estado.grabada === suc && suc === grabadaEn ? "listado-hoy-proyecto.html" : "listado-vacio.html"))],
      ["GET", /^modificar_pedidos\.php\?codigo=157708$/, () => npAbierta(157708, { marca: `Barrio etapa 2 · ${marcaP}`, numero: "0001-00002081" })],
    ],
  }
}
const datosProyecto = (extra = {}) => datosNueva({ tipo: "proyecto", comprobante: null, proyectoCodigo: 576, articuloCodigoSistema: 1000016666, articuloCodigo: 10090027, articuloNombre: "H30-620-10 C (CAN)", m3: 24, ...extra })

test("NP de un proyecto: MATERIAL, depósito, Continuar trae lo disponible, se saca el otro renglón y va la cantidad del día", async () => {
  const z = zomatikProyecto()
  const nav = navFalso(z.rutas)
  const r = await R.generarNp(nav, datosProyecto(), opts())
  assert.equal(r.estado, "ok", r.mensaje)
  assert.equal(r.disponible, 823.4)
  assert.equal(r.codigo, 157708)
  assert.equal(r.numero, "NP2 0001-00002081")
  assert.equal(z.estado.borrados.length, 1)
  const g = grabados(nav)[0]
  const campo = (n) => g.cuerpo.match(new RegExp(`name="${n}"\\r\\n\\r\\n([^\\r]*)\\r\\n`))?.[1]
  assert.equal(campo("deposito"), "116") // venía en PILAR
  assert.equal(campo("idvendedor"), "101") // el del proyecto
  assert.equal(campo("cantidad5349501"), "24")
  assert.equal(campo("cantidad5349502"), undefined)
  assert.equal(campo("observaciones"), `Barrio etapa 2 · ${MARCA}`)
  assert.equal(campo("fecha_entrega"), HOY)
  assert.equal(nav.llamadas.filter((l) => /^_getnumerofactura/.test(l.ruta)).length, 0) // el número lo pone Zomatik
})

test("NP de un proyecto: si el pedido supera lo disponible, no se graba y se avisa con los m³", async () => {
  const z = zomatikProyecto()
  const nav = navFalso(z.rutas)
  const r = await R.generarNp(nav, datosProyecto({ m3: 900 }), opts())
  assert.equal(r.estado, "error")
  assert.match(r.mensaje, /823,4 m³.*900 m³/)
  assert.equal(r.disponible, 823.4)
  assert.equal(grabados(nav).length, 0)
})

test("NP de un proyecto: fórmula que el proyecto no tiene → error con lo que tiene", async () => {
  const nav = navFalso(zomatikProyecto().rutas)
  const r = await R.generarNp(nav, datosProyecto({ articuloCodigoSistema: 1000015959, articuloCodigo: 10090020, articuloNombre: "H21-620-10 C (CAN)" }), opts())
  assert.equal(r.estado, "error")
  assert.match(r.mensaje, /no tiene la fórmula.*H30-620-10 C \(CAN\)/)
  assert.equal(grabados(nav).length, 0)
})

// ── Cancelar → vaciar ──
function zomatikVaciar({ marca = MARCA, quedaVacia = true } = {}) {
  const estado = { grabada: false, borrados: 0 }
  return {
    estado,
    rutas: [
      ["GET", /^modificar_pedidos\.php\?codigo=157704$/, () => npAbierta(157704, { marca, renglones: !(estado.grabada && quedaVacia) })],
      ["GET", /^manage_pedidos\.php\?.*fborrar=5349423/, () => ((estado.borrados += 1), resp(fx("detalle-vacio.html")))],
      ["POST", /^grabar_pedidos\.php\?codigo=157704$/, () => ((estado.grabada = true), resp("", 302, "listado_pedidos.php"))],
    ],
  }
}

test("cancelar: se borran los renglones, se graba y se confirma que quedó sin ítems", async () => {
  const z = zomatikVaciar()
  const nav = navFalso(z.rutas)
  const r = await R.vaciarNp(nav, { codigo: 157704, numero: "NP 0001-00001176", marca: MARCA }, opts())
  assert.equal(r.estado, "vaciada", r.mensaje)
  assert.equal(z.estado.borrados, 1)
  const g = grabados(nav)[0]
  assert.equal(g.ruta, "grabar_pedidos.php?codigo=157704")
  assert.match(g.cuerpo, /name="fparam"\r\n\r\n\r\n/) // sin renglones
  assert.doesNotMatch(g.cuerpo, /cantidad5349423/)
  const m = nav.llamadas.find((l) => /fborrar=5349423/.test(l.ruta))
  assert.match(m.ruta, /pedidos_unico=0425037001792599999/)
  assert.match(m.ruta, /fparam=5349423%2C176500.000%2C8.000%2C%7C%7C%7C/)
})

test("cancelar: una NP sin la marca del sistema no se toca", async () => {
  const z = zomatikVaciar({ marca: "Cargada a mano por Fernando" })
  const nav = navFalso(z.rutas)
  const r = await R.vaciarNp(nav, { codigo: 157704, numero: "NP 0001-00001176", marca: MARCA }, opts())
  assert.equal(r.estado, "revisar")
  assert.equal(nav.llamadas.filter((l) => /^manage_|^grabar_/.test(l.ruta)).length, 0)
})

test("cancelar: si ya estaba vacía (un grabar cortado que sí llegó), queda vaciada sin tocar nada", async () => {
  const z = zomatikVaciar()
  z.estado.grabada = true
  const nav = navFalso(z.rutas)
  const r = await R.vaciarNp(nav, { codigo: 157704, numero: null, marca: MARCA }, opts())
  assert.equal(r.estado, "vaciada")
  assert.equal(nav.llamadas.filter((l) => /^manage_|^grabar_/.test(l.ruta)).length, 0)
})

test("cancelar: la página graba sobre otra NP (o una nueva) → no se graba nada", async () => {
  const z = zomatikVaciar()
  z.rutas.unshift(["GET", /^modificar_pedidos\.php\?codigo=157704$/, () => { const r = npAbierta(157704); r.html = r.html.replace("grabar_pedidos.php?codigo=157704", "grabar_pedidos.php?codigo=0"); return r }])
  const nav = navFalso(z.rutas)
  const r = await R.vaciarNp(nav, { codigo: 157704, numero: null, marca: MARCA }, opts())
  assert.equal(r.estado, "error")
  assert.equal(nav.llamadas.filter((l) => /^manage_|^grabar_/.test(l.ruta)).length, 0)
  const r0 = await R.vaciarNp(navFalso([]), { codigo: 0, numero: null, marca: MARCA }, opts())
  assert.equal(r0.estado, "revisar")
})

test("cancelar: corte de red → sigue 'vaciar' para el reintento", async () => {
  const z = zomatikVaciar()
  z.rutas.unshift(["POST", /^grabar_pedidos/, () => { throw Object.assign(new Error("Zomatik no respondió a tiempo"), { codigo: "sin_respuesta" }) }])
  const r = await R.vaciarNp(navFalso(z.rutas), { codigo: 157704, numero: null, marca: MARCA }, opts())
  assert.equal(r.estado, "vaciar")
})

// ── Planificación (sección 25): una NP puede servir a varios pedidos; cancelar no vacía; reprogramar usa el saldo ──
const ped = (extra = {}) => ({ id: PEDIDO, status: "scheduled", quantity_m3: 24, plant_id: "can", client_id: "c1", formula_id: "f1", fecha: HOY, np_tipo: "nueva", ...extra })
const np = (extra = {}) => ({ id: "np1", n: 1, estado: "ok", tipo: "nueva", m3: 24, numero: "NP 0001-00001176", formula_id: "f1", plant_id: "can", client_id: "c1", fecha: HOY, ...extra })
/** Un uso activo del pedido: reserva `m3` de la NP; `libre` = lo que le queda libre a la NP. */
const uso = (extra = {}, npExtra = {}) => ({ uso_id: `u-${npExtra.id || "np1"}`, m3: 24, libre: 0, ...extra, np: np(npExtra) })
const VACIO = { crear: [], usar: [], ajustar: [], desvincular: [], mover_fecha: [], anular: [], revisar: [], avisos: [] }

test("plan: pedido nuevo → una NP por los m³ del pedido", () => {
  assert.deepEqual(N.planificarNp(ped(), []).crear, [{ n: 1, tipo: "nueva", m3: 24, proyecto_codigo: null, es_adicional: false }])
  assert.deepEqual(N.planificarNp(ped({ np_tipo: "proyecto", proyecto_codigo: 576 }), []).crear, [{ n: 1, tipo: "proyecto", m3: 24, proyecto_codigo: 576, es_adicional: false }])
})

test("plan: con NP ok y los mismos m³ no se hace nada (una sola NP por pedido y día)", () => {
  assert.deepEqual(N.planificarNp(ped(), [uso()]), VACIO)
})

test("plan: pedido que se agranda → primero lo libre de su NP, después NP adicional por la diferencia", () => {
  const p = N.planificarNp(ped({ quantity_m3: 32 }), [uso()])
  assert.deepEqual(p.crear, [{ n: 2, tipo: "nueva", m3: 8, proyecto_codigo: null, es_adicional: true }])
  // su NP tenía 5 m³ libres (se había achicado antes): crece hasta ahí y el resto va adicional
  const q = N.planificarNp(ped({ quantity_m3: 32 }), [uso({ m3: 24, libre: 5 })])
  assert.deepEqual(q.ajustar, [{ uso_id: "u-np1", m3: 29 }])
  assert.deepEqual(q.crear, [{ n: 2, tipo: "nueva", m3: 3, proyecto_codigo: null, es_adicional: true }])
})

test("plan: pedido que se achica → reserva menos de la NP y lo que sobra queda de saldo", () => {
  const p = N.planificarNp(ped({ quantity_m3: 16 }), [uso()])
  assert.deepEqual(p.ajustar, [{ uso_id: "u-np1", m3: 16 }])
  assert.equal(p.crear.length + p.anular.length + p.desvincular.length, 0)
  assert.match(p.avisos[0], /sobran 8 m³/)
})

test("plan: cancelado → la NP grabada NO se vacía (queda pendiente en Programación); lo que no llegó, se anula", () => {
  const p = N.planificarNp(ped({ status: "cancelled" }), [
    uso(), uso({}, { id: "np2", n: 2, estado: "pendiente" }), uso({}, { id: "np3", n: 3, estado: "error" }), uso({}, { id: "np4", n: 4, estado: "generando" }),
  ])
  assert.deepEqual(p.anular, ["np2", "np3"])
  assert.equal(p.desvincular.length + p.ajustar.length + p.crear.length, 0)
  assert.match(p.avisos[0], /queda pendiente en Programación/)
})

test("plan: lo que no llegó a Zomatik se rehace si cambió el pedido; si no cambió, se deja", () => {
  assert.deepEqual(N.planificarNp(ped(), [uso({}, { estado: "pendiente" })]), VACIO)
  const p = N.planificarNp(ped({ quantity_m3: 30, formula_id: "f2" }), [uso({}, { estado: "error" })], 1)
  assert.deepEqual(p.anular, ["np1"])
  assert.deepEqual(p.crear, [{ n: 2, tipo: "nueva", m3: 30, proyecto_codigo: null, es_adicional: false }])
})

test("plan: contra el proyecto con tope → lo que queda al proyecto y el resto en una NP nueva (20.4)", () => {
  const p = N.planificarNp(ped({ np_tipo: "proyecto", proyecto_codigo: 576, proyecto_tope_m3: 18 }), [])
  assert.deepEqual(p.crear, [
    { n: 1, tipo: "proyecto", m3: 18, proyecto_codigo: 576, es_adicional: false },
    { n: 2, tipo: "nueva", m3: 6, proyecto_codigo: null, es_adicional: false },
  ])
})

test("plan: cambió la fórmula o el cliente → la NP vieja no se toca (queda con saldo) y se genera una nueva", () => {
  const p = N.planificarNp(ped({ formula_id: "f2" }), [uso()], 1)
  assert.deepEqual(p.desvincular, [{ uso_id: "u-np1", motivo: "el pedido cambió de fórmula" }])
  assert.deepEqual(p.crear, [{ n: 2, tipo: "nueva", m3: 24, proyecto_codigo: null, es_adicional: false }])
  assert.match(p.avisos[0], /no se toca/)
})

test("plan: cambió la fecha → mover la NP, dejarla (queda con saldo) o, sin respuesta, solo avisar", () => {
  const otra = "2026-10-27"
  const mover = N.planificarNp(ped({ fecha: otra, mover_fecha: true }), [uso()])
  assert.deepEqual(mover.mover_fecha, ["np1"])
  assert.equal(mover.crear.length, 0)
  const dejar = N.planificarNp(ped({ fecha: otra, mover_fecha: false }), [uso()], 1)
  assert.equal(dejar.desvincular.length, 1)
  assert.equal(dejar.crear[0].m3, 24)
  const nada = N.planificarNp(ped({ fecha: otra }), [uso()])
  assert.equal(nada.desvincular.length + nada.crear.length + nada.mover_fecha.length, 0)
  assert.match(nada.avisos[0], /falta decidir si se mueve/)
})

test("plan: reprogramar = usar el saldo de una NP; si el pedido es más grande, el resto en una NP nueva", () => {
  const p = N.planificarNp(ped({ np_tipo: "saldo", saldo_np: { id: "npS", libre: 20 } }), [], 0)
  assert.deepEqual(p.usar, [{ np_id: "npS", m3: 20 }])
  assert.deepEqual(p.crear, [{ n: 1, tipo: "nueva", m3: 4, proyecto_codigo: null, es_adicional: true }])
  // una NP más grande que lo del día: el pedido toma solo una parte
  const q = N.planificarNp(ped({ quantity_m3: 8, np_tipo: "saldo", saldo_np: { id: "npS", libre: 20 } }), [])
  assert.deepEqual(q.usar, [{ np_id: "npS", m3: 8 }])
  assert.equal(q.crear.length, 0)
})

test("plan: una NP que se cortó al grabar no se rehace ni se anula a ciegas", () => {
  const p = N.planificarNp(ped({ quantity_m3: 30 }), [uso({}, { estado: "pendiente", paso: "grabar_cortado" })])
  assert.deepEqual(p.anular, [])
  assert.deepEqual(p.crear, [{ n: 2, tipo: "nueva", m3: 6, proyecto_codigo: null, es_adicional: true }])
  const c = N.planificarNp(ped({ status: "cancelled" }), [uso({}, { estado: "pendiente", paso: "grabar" }), uso({}, { id: "np2", n: 2, estado: "error", paso: "lista" })])
  assert.deepEqual(c.revisar, ["np1"])
  assert.deepEqual(c.anular, ["np2"])
})

test("plan: completo → nada", () => {
  assert.deepEqual(N.planificarNp(ped({ status: "completed" }), [uso()]), VACIO)
})

// ── Saldo de una NP ──
test("saldo: lo despachado se reparte entre las NP del pedido; cancelado libera lo no despachado", () => {
  const u = (id, np_id, m3, activo, status, desp, created_at = "2026-10-20T10:00:00Z", pid = "p1") => ({ id, np_id, m3, activo, created_at, pedido: { id: pid, status, dispatched_m3: desp } })
  // pedido activo que usa 24 de una NP de 40: libre 16
  assert.deepEqual(N.saldoNp({ id: "A", m3: 40 }, [u("1", "A", 24, true, "scheduled", 0)]), { libre: 16, comprometido: 24, conPedidoActivo: true })
  // cancelado con 8 despachados: compromete 8, libre 32, sin pedido activo → va a "NP con saldo"
  const s = N.saldoNp({ id: "A", m3: 40 }, [u("1", "A", 24, true, "cancelled", 8)])
  assert.deepEqual(s, { libre: 32, comprometido: 8, conPedidoActivo: false })
  assert.equal(N.npConSaldo({ estado: "ok", saldo_decision: null }, s), true)
  assert.equal(N.npConSaldo({ estado: "ok", saldo_decision: "cerrada" }, s), false)
  // pedido con dos NP: 30 despachados → 24 a la primera, 6 a la segunda
  const m = N.despachadoPorUso([{ id: "1", m3: 24, created_at: "2026-10-20T10:00:00Z" }, { id: "2", m3: 8, created_at: "2026-10-20T11:00:00Z" }], 30)
  assert.deepEqual([m.get("1"), m.get("2")], [24, 6])
  // pedido borrado: no compromete nada
  assert.equal(N.saldoNp({ id: "A", m3: 10 }, [{ id: "9", np_id: "A", m3: 10, activo: true, created_at: "x", pedido: null }]).libre, 10)
})

// ── Despacho: llave, modo aviso y modo duro ──
test("modo: apagado por defecto, aviso las 2 semanas y después duro", () => {
  assert.equal(N.modoNp(null, HOY), "apagado")
  assert.equal(N.modoNp({ zomatik_np_activo: false }, HOY), "apagado")
  assert.equal(N.modoNp({ zomatik_np_activo: true, exigir_np: "aviso", aviso_hasta: "2026-11-06" }, HOY), "aviso")
  assert.equal(N.modoNp({ zomatik_np_activo: true, exigir_np: "aviso", aviso_hasta: "2026-11-06" }, "2026-11-06"), "aviso")
  assert.equal(N.modoNp({ zomatik_np_activo: true, exigir_np: "aviso", aviso_hasta: "2026-11-06" }, "2026-11-07"), "duro")
  assert.equal(N.modoNp({ zomatik_np_activo: true, exigir_np: "duro" }, HOY), "duro")
})

test("control del despacho: NP pendiente en rojo; en duro frena; excepción gerencial; pedidos de antes de la llave no", () => {
  const sinNp = [{ estado: "pendiente" }]
  assert.deepEqual(N.controlDespacho({ modo: "apagado", entra: true, nps: sinNp, excepcion: false }), { bloquea: false, aviso: null })
  assert.deepEqual(N.controlDespacho({ modo: "aviso", entra: true, nps: sinNp, excepcion: false }), { bloquea: false, aviso: "NP pendiente: avisale a Programación" })
  assert.equal(N.controlDespacho({ modo: "duro", entra: true, nps: sinNp, excepcion: false }).bloquea, true)
  assert.equal(N.controlDespacho({ modo: "duro", entra: true, nps: [], excepcion: false }).bloquea, true)
  assert.equal(N.controlDespacho({ modo: "duro", entra: true, nps: sinNp, excepcion: true }).bloquea, false)
  assert.equal(N.controlDespacho({ modo: "duro", entra: true, nps: [{ estado: "ok" }], excepcion: false }).aviso, null)
  assert.equal(N.controlDespacho({ modo: "duro", entra: false, nps: [], excepcion: false }).bloquea, false)
  const planta = { zomatik_np_activo: true, zomatik_np_desde: "2026-10-23T10:00:00.000Z" }
  assert.equal(N.pedidoConNp(planta, "2026-10-22T09:00:00.000Z"), false)
  assert.equal(N.pedidoConNp(planta, "2026-10-23T11:00:00.000Z"), true)
  assert.equal(N.pedidoConNp({ zomatik_np_activo: false }, "2026-10-23T11:00:00.000Z"), false)
})

// ── Lista cerrada: el grupo de la NP aparte ──
test("lista cerrada: el grupo de la NP permite solo lo de la sección 23 y la lectura sigue sin escribir", () => {
  for (const [r, m] of [
    ["modificar_pedidos.php", "GET"], ["modificar_pedidos.php?proyecto=576&tipo=1", "GET"], ["modificar_pedidos.php?codigo=157702", "GET"],
    ["traerdatossecundarios.php?fcliente=15893&rnd=7", "GET"], ["_getnumerofactura.php?fcomprobante=15&rnd=7", "GET"], ["_getnumerofactura.php?fcomprobante=16", "GET"],
    ["listado_listas.php", "GET"], ["manage_pedidos.php?pedidos=0&pedidos_unico=0425&fborrar=9001", "GET"], ["grabar_pedidos.php?codigo=0", "POST"], ["grabar_pedidos.php?codigo=157702", "POST"],
  ])
    assert.equal(W.rutaEscrituraNp(r, m), true, `${m} ${r}`)
  for (const [r, m] of [
    ["grabar_clientes.php?codigo=0", "POST"], ["grabar_remitos.php?codigo=0", "POST"], ["grabar_pedidos.php?codigo=0", "GET"], ["grabar_ordenfabricacion.php?codigo=0", "POST"],
    ["_getnumerofactura.php?fcomprobante=7", "GET"], ["manage_pedidos.php?pedidos_unico=1&fautorizar=3", "GET"], ["manage_pedidos.php?pedidos_unico=1&faccion=3&fitems=1", "GET"],
    ["manage_pedidos.php?fcliente=1", "GET"], ["manage_remitos.php?pedidos_unico=1", "GET"], ["modificar_remitos.php?pedido=1", "GET"], ["set_pedidos_destacado.php?codigo=1", "GET"],
    ["grabar_liberarcomprobante.php", "POST"], ["modificar_pedidosdevolucion.php?pedido=1", "GET"], ["modificar_pedidos.php?codigo=1&borrar=1", "GET"],
  ])
    assert.equal(W.rutaEscrituraNp(r, m), false, `${m} ${r}`)
  // la lectura (Z0) sigue rechazando lo de la NP
  for (const r of ["grabar_pedidos.php?codigo=0", "manage_pedidos.php?pedidos_unico=1", "_getnumerofactura.php?fcomprobante=15", "modificar_pedidos.php"]) assert.equal(W.rutaPermitida(r, "GET") || W.rutaPermitida(r, "POST"), false, r)
})

// ── Lecturas de páginas ──
test("lecturas: formulario crudo, datos del cliente, listas, alert() suelto y marca tolerante", () => {
  const f = N.camposFormulario(fx("alta.html"), /frm_pedido/)
  assert.equal(f.action, "grabar_pedidos.php?codigo=0")
  assert.equal(f.campos.deposito, "104") // PILAR por defecto (hay que cambiarlo)
  assert.equal(f.campos.origen, undefined) // ningún radio tildado
  assert.deepEqual(N.faltanCampos(f.campos), [])
  const d = N.datosSecundarios(fx("secundarios.txt"))
  assert.equal(d.idvendedor, "100")
  assert.equal(d.razon_social, "OBRA PROPIA REBUCRET")
  assert.equal(d.tipo_iva, "3")
  const l = N.listaActiva(N.listasDeListado(fx("listas.html")), "16")
  assert.equal(l.lista.codigo, 10243)
  assert.deepEqual(N.alertasDe(fx("alta.html")), []) // los alert dentro de funciones no cuentan
  assert.deepEqual(N.alertasDe(fx("grabar-alert.html")), ["* Vendedor debe ser completado"])
  assert.equal(N.tieneMarca(`Barrio · ${MARCA.replace("·", "Â·")}`, MARCA), true)
  assert.equal(N.tieneMarca("Sistema Rebucret · pedido 1a2b3c4d · NP 11", MARCA), false)
  assert.equal(N.encodeLatin1("a·b c"), "a%B7b%20c")
  assert.equal(N.numeroZomatik("823,4"), 823.4)
  assert.equal(N.numeroZomatik("1.234,5"), 1234.5)
  const ps = N.pedidosDeListado(fx("listado-hoy-rebucret.html"))
  assert.deepEqual(ps.map((p) => [p.codigo, p.numero, p.cliente, p.estado]), [[157706, "NP 0001-00001177", "OTRO CLIENTE SA", "PEN"], [157704, "NP 0001-00001176", "OBRA PROPIA REBUCRET", "PEN"]])
})

// ── Lista de precios (28/10): una sola activa sirve para NP y NP2 ──
const fila = (codigo, nombre, desde, estado) => `<tr height="20"><td class="itemlistado"><a href="modificar_listas.php?codigo=${codigo}">${nombre}</a></td><td bgcolor="#999999"></td><td><a href="modificar_listas.php?codigo=${codigo}">${desde}</a></td><td bgcolor="#999999"></td><td><a href="modificar_listas.php?codigo=${codigo}">${estado}</a></td></tr>`
const listado = (...filas) => `<html><body><table><tr><td class="headerlistado">Nombre</td><td>V.Desde</td><td>Estado</td></tr>${filas.join("")}</table></body></html>`

test("lista: el listado real del 28/10 (una sola activa, sin 'en 1' ni 'en 2') sirve para la NP y la NP2", () => {
  const ls = N.listasDeListado(listado(
    fila(10260, "0 - Lista OCTUBRE 2026", "28/10/2026", "Activo"),
    fila(10247, "0 - Lista SEPTIEMBRE 26 en 1 (013)", "16/10/2026", "Invisible"),
    fila(10243, "0 - Lista SEPTIEMBRE 26 en 2 (013)", "20/09/2026", "Invisible"),
  ))
  assert.equal(N.listaActiva(ls, "15").lista.codigo, 10260)
  assert.equal(N.listaActiva(ls, "16").lista.codigo, 10260)
})

test("lista: con varias activas se elige por 'en 1' / 'en 2'; si no queda una sola o no hay ninguna, error", () => {
  const ls = N.listasDeListado(fx("listas.html")) // SEPTIEMBRE en 1 (10247) y en 2 (10243) activas
  assert.equal(N.listaActiva(ls, "15").lista.codigo, 10247)
  assert.equal(N.listaActiva(ls, "16").lista.codigo, 10243)
  const sinTipo = N.listasDeListado(listado(fila(1, "Lista A", "01/10/2026", "Activo"), fila(2, "Lista B", "02/10/2026", "Activo")))
  assert.match(N.listaActiva(sinTipo, "16").error, /ninguna "en 2"/)
  const dos = N.listasDeListado(listado(fila(1, "Lista X en 1", "01/10/2026", "Activo"), fila(2, "Lista Y en 1", "02/10/2026", "Activo"), fila(3, "Lista Z en 2", "02/10/2026", "Activo")))
  assert.match(N.listaActiva(dos, "15").error, /2 listas activas "en 1"/)
  const ninguna = N.listasDeListado(listado(fila(10247, "0 - Lista SEPTIEMBRE 26 en 1 (013)", "16/10/2026", "Invisible")))
  assert.match(N.listaActiva(ninguna, "15").error, /ninguna lista activa/)
})
