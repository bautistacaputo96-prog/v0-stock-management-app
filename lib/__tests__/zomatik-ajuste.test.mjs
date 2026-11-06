// Pruebas del ajuste de la NP a lo despachado al finalizar el pedido (docs/specs/2026-11-06-ajustar-np-al-finalizar.md,
// secciones 11 y 12, con las decisiones de la 15): el plan (pura), la factura, el robot con un navegador SIMULADO
// (lib/__fixtures__/zomatik-ajuste, lo de la NP facturada es SUPUESTO), la lista cerrada y el servidor con una base
// simulada en memoria. Sin red, sin Zomatik, sin la base real.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as A from "../zomatik/ajuste.ts"
import * as N from "../zomatik/np.ts"
import * as R from "../zomatik/np-robot.ts"
import * as W from "../zomatik/web.ts"
import * as Z from "../zomatik/z1.ts"
import * as ZR from "../zomatik/z1-robot.ts"
import * as S from "../zomatik/z1-servidor.ts"
import * as AS from "../zomatik/ajuste-servidor.ts"
import { chipRemito, ajusteParaResolver } from "../zomatik/z1-cliente.ts"

const fxA = (f) => readFileSync(new URL(`../__fixtures__/zomatik-ajuste/${f}`, import.meta.url), "latin1")
const fxN = (f) => readFileSync(new URL(`../__fixtures__/zomatik-np/${f}`, import.meta.url), "latin1")
const fxZ = (f) => readFileSync(new URL(`../__fixtures__/zomatik-z1/${f}`, import.meta.url), "latin1")
const latin1 = (u8) => Buffer.from(u8).toString("latin1")
const resp = (html, status = 200, location = null) => ({ status, location, html })
const conSuc = (suc, html) => resp(`<form method="post" action="" name="frm_selsuc"><select name="selsuc"><option value="${suc}" selected>S</option></select></form>${html}`)
const HOY = N.hoyAR()
const PED = "1a2b3c4d-0000-4000-8000-000000000001"
const OTRO = "9f9f9f9f-0000-4000-8000-000000000002"
const MARCA_NP = N.marcaNp(PED, 1)
const opts = (extra = {}) => ({ hoy: HOY, azar: () => 7, boundary: "XX", ...extra })

// ===========================================================================
// 1. El plan (3.1 a 3.4 y 15)
// ===========================================================================

const uso = (id, np_id, m3, extra = {}) => ({ id, np_id, m3, activo: true, created_at: `2026-11-0${extra.dia || 1}T10:00:00Z`, despachado_fijo: null, ...extra })
const npA = (id, m3, extra = {}) => ({ id, n: 1, m3, estado: "ok", numero: "NP2 0001-00002090", zomatik_codigo: 157767, ...extra })
const desp = (m3s) => m3s.map((m3, i) => ({ id: `d${i + 1}`, m3, created_at: `2026-11-06T1${i}:00:00Z` }))
function entrada(extra = {}) {
  return {
    pedidoId: PED, status: "completed", despachos: desp([8, 8, 8, 8, 8]), remitirDesde: null,
    usosDelPedido: [uso("u1", "np1", 60)], nps: [npA("np1", 60)], usosSaldo: [], remitidoPorNp: { np1: 40 }, sinRemitir: 0, ...extra,
  }
}
const uno = (e) => {
  const p = A.planificarAjuste(e)
  assert.equal(p.length, 1)
  return p[0]
}

test("plan, Santa Rita: NP 60, se despacharon 40 en un día → editar 60 → 40", () => {
  const p = uno(entrada())
  assert.deepEqual([p.tipo, p.estado, p.m3_np, p.m3_objetivo, p.m3_despachado], ["editar", "pendiente", 60, 40, 40])
  assert.equal(A.textoAjuste(p), "NP2 0001-00002090 60 → 40 m³")
})

test("plan, varios días: 25 ya remitidos y 15 del martes → la NP queda en 40 (y el remito del martes espera 15 pendientes)", () => {
  const p = uno(entrada({ despachos: desp([12.5, 12.5, 15]), remitidoPorNp: { np1: 40 } }))
  assert.deepEqual([p.tipo, p.m3_objetivo], ["editar", 40])
  assert.equal(A.pendienteEsperado(40, 25), 15)
})

test("plan, NP compartida: el otro pedido activo reserva 20 → queda en 50, nunca menos", () => {
  const otroUso = { id: "u9", np_id: "np1", m3: 20, activo: true, created_at: "2026-11-01T09:00:00Z", despachado_fijo: null, pedido: { id: OTRO, status: "active", dispatched_m3: 0 } }
  const e = entrada({ usosDelPedido: [uso("u1", "np1", 40)], despachos: desp([10, 10, 10]), remitidoPorNp: { np1: 30 }, usosSaldo: [otroUso] })
  const p = uno(e)
  assert.deepEqual([p.tipo, p.m3_objetivo], ["editar", 50])
  // si la NP en la base dijera menos (alguien reservó de más), el piso no da → revisar
  const mal = uno({ ...e, nps: [npA("np1", 55)] })
  assert.equal(mal.estado, "revisar")
  assert.match(mal.mensaje, /la usan otros pedidos \(20 m³\): no puede quedar en 45 m³/)
})

test("plan, 'Usar NP con saldo': NP 100 de un pedido cancelado, este tomó 30 y despachó 20 → 90 (los 70 libres siguen)", () => {
  const cancelado = { id: "u0", np_id: "np1", m3: 100, activo: true, created_at: "2026-10-01T09:00:00Z", despachado_fijo: null, pedido: { id: OTRO, status: "cancelled", dispatched_m3: 0 } }
  const p = uno(entrada({ nps: [npA("np1", 100)], usosDelPedido: [uso("u1", "np1", 30)], despachos: desp([10, 10]), remitidoPorNp: { np1: 20 }, usosSaldo: [cancelado] }))
  assert.deepEqual([p.tipo, p.m3_objetivo, p.m3_despachado], ["editar", 90, 20])
})

test("plan, dos NP (50 + adicional 10) con 40 despachados: NP 1 → 40; la adicional en 0 → revisar para una persona (15.5)", () => {
  const p = A.planificarAjuste(entrada({
    usosDelPedido: [uso("u1", "np1", 50), uso("u2", "np2", 10, { dia: 2 })],
    nps: [npA("np1", 50), npA("np2", 10, { n: 2, numero: "NP2 0001-00002091", zomatik_codigo: 157768 })],
    remitidoPorNp: { np1: 40 },
  }))
  assert.deepEqual(p.map((x) => [x.np_id, x.estado, x.m3_objetivo]), [["np1", "pendiente", 40], ["np2", "revisar", 0]])
  assert.equal(p[1].mensaje, "La NP NP2 0001-00002091 quedó sin uso (0 m³): eliminala o dejala pendiente en Zomatik")
  assert.equal(p[1].tipo, null) // el robot no la vacía ni la borra
})

test("plan, exceso por la tolerancia: NP 40, se despacharon 40,4 (el último no entró en el remito) → agrandar a 40,4", () => {
  const p = uno(entrada({ nps: [npA("np1", 40)], usosDelPedido: [uso("u1", "np1", 40)], despachos: desp([8, 8, 8, 8, 8.4]), remitidoPorNp: { np1: 32 }, sinRemitir: 8.4 }))
  assert.deepEqual([p.tipo, p.m3_objetivo, p.m3_despachado], ["editar", 40.4, 40.4])
})

test("plan, completo justo (60 de 60) → 'nada': no se abre Zomatik", () => {
  const p = uno(entrada({ despachos: desp([12, 12, 12, 12, 12]), remitidoPorNp: { np1: 60 } }))
  assert.deepEqual([p.tipo, p.estado], ["nada", "nada"])
})

test("plan, con factura: el plan es el mismo (editar 60 → 40); la factura la descubre el robot al abrirla", () => {
  assert.equal(uno(entrada()).m3_objetivo, 40)
})

test("plan: remitos ≠ lo despachado, despachos de antes del remito automático, pedido no completo, NP fuera de Zomatik", () => {
  let p = uno(entrada({ remitidoPorNp: { np1: 32 } }))
  assert.equal(p.estado, "revisar")
  assert.match(p.mensaje, /Lo remitido contra la NP2 0001-00002090 \(32 m³\) no coincide con lo despachado \(40 m³\)/)
  p = uno(entrada({ remitirDesde: "2026-11-06T12:00:00Z" }))
  assert.equal(p.estado, "revisar")
  assert.match(p.mensaje, /se remitieron a mano/)
  assert.deepEqual(A.planificarAjuste(entrada({ status: "active" })), []) // reabierto: no hay ajuste (el robot lo anula)
  assert.deepEqual(A.planificarAjuste(entrada({ nps: [npA("np1", 60, { estado: "pendiente", zomatik_codigo: null })] })), [])
})

test("marca del ajuste: ASCII, con el número de la NP (con 'Usar NP con saldo' dos NP pueden tener el mismo n)", () => {
  assert.equal(A.marcaAjuste(PED, { numero: "NP2 0001-00002090", n: 1 }), "Sistema Rebucret - pedido 1a2b3c4d - ajuste NP2 0001-00002090")
  assert.equal(A.marcaAjuste(PED, { numero: null, n: 2 }), "Sistema Rebucret - pedido 1a2b3c4d - ajuste NP 2")
  assert.match(A.marcaAjuste(PED, { numero: "NP 0001-1·2" }), /^[\x20-\x7e]+$/)
})

test("textos de Finalizar (solo con la llave)", () => {
  assert.equal(A.textoFinalizar([{ numero: "NP2 0001-00002090", m3: 60, m3_uso: 60 }], 40), "Al remitir, la NP2 0001-00002090 baja de 60 a 40 m³.")
  assert.equal(A.textoFinalizar([{ numero: "NP 0001-00001176", m3: 40, m3_uso: 40 }], 40.4), "Al remitir, la NP 0001-00001176 sube de 40 a 40,4 m³.")
  assert.equal(A.textoFinalizar([], 40), "Al remitir, la NP se ajusta a lo despachado.")
  assert.equal(A.textoFinalizar([{ numero: "A", m3: 1, m3_uso: 1 }, { numero: "B", m3: 1, m3_uso: 1 }], 2), "Al remitir, la NP se ajusta a lo despachado.")
})

// ===========================================================================
// 2. ¿Tiene factura? (15.1) — con fixtures SUPUESTO
// ===========================================================================

const detalle = (cant, f = "detalle-np.html") => fxA(f).replace("{{CANT}}", cant).replace("{{TOTAL}}", "x")

test("factura: editable con Grabar → sin; sin Grabar o cantidad de solo lectura o FAC en el listado → con; ilegible → no se sabe", () => {
  const pag = fxN("np-abierta.html")
  const r = (html) => N.renglonesDetalle(html)[0]
  assert.equal(A.facturaDeNp({ paginaHtml: pag, detalleHtml: detalle("60.000"), renglon: r(detalle("60.000")), filaEstado: "PEN" }).estado, "sin")
  const fact = detalle("60.000", "detalle-np-facturada.html")
  assert.deepEqual(A.facturaDeNp({ paginaHtml: pag, detalleHtml: fact, renglon: r(fact) }), { estado: "con", motivo: "la cantidad es de solo lectura" })
  const sinG = detalle("60.000", "detalle-np-sin-grabar.html")
  assert.deepEqual(A.facturaDeNp({ paginaHtml: pag, detalleHtml: sinG, renglon: r(sinG) }), { estado: "con", motivo: "la NP no tiene el botón Grabar" })
  assert.equal(A.facturaDeNp({ paginaHtml: pag, detalleHtml: detalle("60.000"), renglon: r(detalle("60.000")), filaEstado: "FAC" }).estado, "con")
  assert.equal(A.facturaDeNp({ paginaHtml: pag, detalleHtml: detalle("60.000"), renglon: null }).estado, "no_se_sabe")
  assert.equal(A.facturaDeNp({ paginaHtml: pag, detalleHtml: detalle("60.000"), renglon: { ...r(detalle("60.000")), sufijo: "999" } }).estado, "no_se_sabe")
  // "readonly" dentro de un value no cuenta
  const conTexto = detalle("60.000").replace('name="cantidad5349424" id="cantidad5349424"', 'name="cantidad5349424" id="cantidad5349424" title="readonly"')
  assert.equal(A.facturaDeNp({ paginaHtml: pag, detalleHtml: conTexto, renglon: r(conTexto) }).estado, "con") // un title con la palabra sí cuenta: mejor de más que de menos
  assert.equal(A.rechazoPorFactura("La nota de pedido tiene comprobantes asociados (factura)"), true)
  assert.equal(A.rechazoPorFactura("* La cantidad no puede ser menor a la cantidad remitida"), false)
})

// ===========================================================================
// 3. El robot (navegador simulado; la NP 157704 = NP 0001-00001176)
// ===========================================================================

const COD = 157704
function navFalso(rutas, { alLlamar, codigo = COD } = {}) {
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
    // Solo el grupo del ajuste (atado a ESTA NP) o la lectura de siempre
    assert.ok(W.rutaEscrituraAjuste(ruta, m, codigo) || W.rutaPermitida(ruta, m), `ruta fuera de la lista cerrada: ${m} ${ruta}`)
    const r = rutas.find(([mm, re]) => mm === m && re.test(ruta))
    if (!r) throw new Error(`ruta no simulada: ${m} ${ruta}`)
    return r[2]({ ruta, cuerpo, suc: nav.suc, nav })
  }
  return nav
}
const filaListado = (codigo, numero, total, estado = "PEN") => `<tr height="20"><td class="itemlistado"><a href="modificar_pedidos.php?codigo=${codigo}">2026-11-06</a></td><td></td><td class="itemlistado"><a href="modificar_pedidos.php?codigo=${codigo}">${numero}</a></td><td></td><td class="itemlistado"><a href="modificar_pedidos.php?codigo=${codigo}">SANTA RITA</a></td><td></td><td class="itemlistado" align="right"><a href="modificar_pedidos.php?codigo=${codigo}">${total}</a></td><td class="itemlistado"><b>${estado}</b></td></tr>`
const pesos = (n) => `$ ${Math.round(n).toLocaleString("de-DE")}`
const PRECIO = 100000

/** Zomatik simulado para ajustar la NP 157704. `graba`: qué hace el Grabar con la cantidad pedida (por defecto, la pone). */
function zomatikAjuste({ cant = 60, marca = MARCA_NP, detalleFx = "detalle-np.html", graba, estadoFila = "PEN", detalleRaro = false, dosRenglones = false } = {}) {
  const estado = { cant, grabados: [], cargas: 0 }
  const pagina = () => resp(fxN("np-abierta.html").replaceAll("{{CODIGO}}", String(COD)).replace("{{OBS}}", marca).replace("{{NUMERO}}", "0001-00001176").replace("{{RENGLONES}}", ""))
  return {
    estado,
    rutas: [
      ["GET", /^modificar_pedidos\.php\?codigo=157704$/, pagina],
      ["GET", /^manage_pedidos\.php\?/, () => {
        estado.cargas++
        if (detalleRaro) return resp("<html><body>Error</body></html>")
        let h = detalle(N.cantidadTexto(estado.cant) + (String(estado.cant).includes(".") ? "" : ".000"), detalleFx)
        if (dosRenglones) h = h.replace(/(<tr>\s*<td class="itemformulario" >[\s\S]*?<\/tr>)/, (x) => x + x.replaceAll("5349424", "5349425"))
        return resp(h)
      }],
      ["POST", /^grabar_pedidos\.php\?codigo=157704$/, ({ cuerpo }) => {
        const pedida = Number(cuerpo.match(/name="cantidad5349424"\r\n\r\n([^\r]*)\r\n/)?.[1])
        estado.grabados.push({ cuerpo, pedida })
        if (graba) return graba(pedida, estado)
        estado.cant = pedida
        return resp("", 302, "listado_pedidos.php")
      }],
      ["GET", /^listado_pedidos\.php$/, () => resp(fxN("listado-buscador.html"))],
      ["POST", /^listado_pedidos\.php\?enviado=1$/, ({ suc }) => conSuc(suc, `<table>${filaListado(COD, "NP 0001-00001176", pesos(estado.cant * PRECIO), estadoFila)}</table>`)],
    ],
  }
}
const datosAj = (extra = {}) => ({ codigo: COD, numero: "NP 0001-00001176", marca: MARCA_NP, articuloCodigo: 10090020, articuloNombre: "H21-620-10 C (CAN)", m3Np: 60, objetivo: 40, cortado: false, ...extra })
const grabar = (nav) => nav.llamadas.filter((l) => l.m === "POST" && /^grabar_/.test(l.ruta))

test("robot: editar 60 → 40 (Santa Rita): marca, un renglón, sin factura, Grabar sobre ESTA NP con la cantidad y fparam, y verifica", async () => {
  const z = zomatikAjuste()
  const pasos = []
  const nav = navFalso(z.rutas)
  const r = await R.ajustarCantidadNp(nav, datosAj(), opts({ alPaso: (p) => pasos.push(p) }))
  assert.equal(r.estado, "ok", r.mensaje)
  assert.deepEqual([r.leido, r.totalAntes, r.totalDespues], [60, 6_000_000, 4_000_000])
  assert.deepEqual(pasos, ["leer_np", "leer_factura", "decidir", "editar_detalle", "grabar_np", "verificar_np"])
  const g = grabar(nav)
  assert.equal(g.length, 1)
  assert.equal(g[0].ruta, "grabar_pedidos.php?codigo=157704")
  assert.match(g[0].cuerpo, /name="cantidad5349424"\r\n\r\n40\r\n/)
  assert.match(g[0].cuerpo, /name="fparam"\r\n\r\n5349424,176500\.000,40,\|\|\|\r\n/)
  assert.doesNotMatch(g[0].cuerpo, /fborrar/)
  // la sucursal REBUCRET justo antes de grabar, y el detalle se cargó como la página (pedidos=N)
  assert.deepEqual([nav.llamadas[nav.llamadas.indexOf(g[0]) - 1].m, nav.llamadas[nav.llamadas.indexOf(g[0]) - 1].ruta], ["SUC", "18"])
  assert.ok(nav.llamadas.some((l) => /^manage_pedidos\.php\?pedidos=157704&/.test(l.ruta)))
})

test("robot: agrandar 40 → 40,4 (exceso por la tolerancia)", async () => {
  const z = zomatikAjuste({ cant: 40 })
  const r = await R.ajustarCantidadNp(navFalso(z.rutas), datosAj({ m3Np: 40, objetivo: 40.4 }), opts())
  assert.equal(r.estado, "ok", r.mensaje)
  assert.equal(z.estado.cant, 40.4)
})

test("robot: Zomatik dice que no (menos que lo remitido, SUPUESTO 7.4.3) → error con su texto; si habla de factura → con_factura", async () => {
  let z = zomatikAjuste({ graba: () => resp(fxA("grabar-rechazo-remitido.html")) })
  let r = await R.ajustarCantidadNp(navFalso(z.rutas), datosAj(), opts())
  assert.equal(r.estado, "error")
  assert.equal(r.mensaje, "Zomatik no dejó cambiar la NP: * La cantidad no puede ser menor a la cantidad remitida.")
  z = zomatikAjuste({ graba: () => resp(fxA("grabar-rechazo-factura.html")) })
  r = await R.ajustarCantidadNp(navFalso(z.rutas), datosAj(), opts())
  assert.equal(r.estado, "con_factura")
  assert.match(r.facturaTexto, /comprobantes asociados/)
})

test("robot: NP con factura (sin Grabar, cantidad de solo lectura, o FAC en el listado) → con_factura sin grabar nada", async () => {
  for (const z of [zomatikAjuste({ detalleFx: "detalle-np-facturada.html" }), zomatikAjuste({ detalleFx: "detalle-np-sin-grabar.html" }), zomatikAjuste({ estadoFila: "FAC" })]) {
    const nav = navFalso(z.rutas)
    const r = await R.ajustarCantidadNp(nav, datosAj(), opts())
    assert.equal(r.estado, "con_factura")
    assert.equal(grabar(nav).length, 0)
  }
})

test("robot: corte en grabar_np → se relee: ya en el objetivo → ok sin grabar; en la de antes → edita; otra → revisar", async () => {
  let z = zomatikAjuste({ cant: 40 })
  let nav = navFalso(z.rutas)
  let r = await R.ajustarCantidadNp(nav, datosAj({ cortado: true }), opts())
  assert.equal(r.estado, "ok")
  assert.equal(r.yaEstaba, true)
  assert.equal(grabar(nav).length, 0)
  z = zomatikAjuste({ cant: 60 })
  nav = navFalso(z.rutas)
  r = await R.ajustarCantidadNp(nav, datosAj({ cortado: true }), opts())
  assert.equal(r.estado, "ok")
  assert.equal(grabar(nav).length, 1)
  z = zomatikAjuste({ cant: 55 })
  nav = navFalso(z.rutas)
  r = await R.ajustarCantidadNp(nav, datosAj({ cortado: true }), opts())
  assert.equal(r.estado, "revisar")
  assert.equal(grabar(nav).length, 0)
})

test("robot: la NP cambió en Zomatik (55 y el sistema esperaba 60) → revisar sin tocar", async () => {
  const z = zomatikAjuste({ cant: 55 })
  const nav = navFalso(z.rutas)
  const r = await R.ajustarCantidadNp(nav, datosAj(), opts())
  assert.equal(r.estado, "revisar")
  assert.equal(r.mensaje, "La NP cambió en Zomatik (tiene 55 m³ y el sistema esperaba 60). No se tocó: revisala.")
  assert.equal(grabar(nav).length, 0)
})

test("robot: sin la marca, con dos renglones o con el detalle ilegible → revisar sin grabar", async () => {
  for (const z of [zomatikAjuste({ marca: "Cargada a mano" }), zomatikAjuste({ dosRenglones: true }), zomatikAjuste({ detalleRaro: true })]) {
    const nav = navFalso(z.rutas)
    const r = await R.ajustarCantidadNp(nav, datosAj(), opts())
    assert.equal(r.estado, "revisar", r.mensaje)
    assert.equal(grabar(nav).length, 0)
  }
  const z = zomatikAjuste({ marca: "Cargada a mano" })
  const nav = navFalso(z.rutas)
  await R.ajustarCantidadNp(nav, datosAj(), opts())
  assert.equal(nav.llamadas.filter((l) => /^manage_/.test(l.ruta)).length, 0) // sin marca ni siquiera se carga el detalle
})

test("robot: se grabó pero la NP quedó en otra cantidad → revisar; corte de red al grabar → pendiente (se relee antes de reintentar)", async () => {
  let z = zomatikAjuste({ graba: (_p, e) => ((e.cant = 45), resp("", 302, "listado_pedidos.php")) })
  let r = await R.ajustarCantidadNp(navFalso(z.rutas), datosAj(), opts())
  assert.equal(r.estado, "revisar")
  assert.match(r.mensaje, /tiene 45 m³ \(se esperaban 40\)/)
  z = zomatikAjuste({ graba: () => { throw Object.assign(new Error("Zomatik no respondió a tiempo"), { codigo: "sin_respuesta" }) } })
  r = await R.ajustarCantidadNp(navFalso(z.rutas), datosAj(), opts())
  assert.equal(r.estado, "pendiente")
  assert.equal(r.grabado, true)
  assert.equal(r.paso, "grabar_np")
})

// ===========================================================================
// 4. Lista cerrada (8.1) y llave
// ===========================================================================

test("lista cerrada: el grupo del ajuste acepta lo de 8.1 atado a UNA NP y rechaza el resto", () => {
  const ok = [
    ["GET", "modificar_pedidos.php?codigo=157704"],
    ["GET", "manage_pedidos.php?pedidos=157704&fcomprobante=15&fcuit=1&pedidos_unico=0425037001792599999&fdeposito=116&fproyecto=0&fcliente=15893&facopio=&forigen=1&flista=10247&rnd=7"],
    ["POST", "grabar_pedidos.php?codigo=157704"],
    ["GET", "listado_pedidos.php"],
    ["POST", "listado_pedidos.php?enviado=1"],
  ]
  for (const [m, r] of ok) assert.equal(W.rutaEscrituraAjuste(r, m, COD), true, `${m} ${r}`)
  const no = [
    ["POST", "grabar_pedidos.php?codigo=0"],
    ["POST", "grabar_pedidos.php?codigo=157705"],
    ["GET", "modificar_pedidos.php?codigo=157705"],
    ["GET", "modificar_pedidos.php"],
    ["GET", "manage_pedidos.php?pedidos=157704&pedidos_unico=1&fborrar=5349424"],
    ["GET", "manage_pedidos.php?pedidos=157704&pedidos_unico=1&farticulo=1000015959"],
    ["GET", "manage_pedidos.php?pedidos=157704&pedidos_unico=1&faccion=2"],
    ["GET", "manage_pedidos.php?pedidos=157704&pedidos_unico=1&fautorizar=1"],
    ["GET", "manage_pedidos.php?pedidos=157705&pedidos_unico=1"],
    ["GET", "manage_pedidos.php?pedidos=157704&pedidos=157705&pedidos_unico=1"],
    ["GET", "manage_pedidos.php?pedidos=157704"],
    ["POST", "grabar_remitos.php?codigo=0"],
    ["POST", "grabar_pedidosdevolucion.php?codigo=0"],
    ["GET", "modificar_pedidosdevolucion.php?pedido=157704"],
    ["GET", "listado_pedidosdevolucion.php?pedido=157704"],
    ["POST", "_autorizarpedido.php?orden=fechaord%20desc,%20codigo%20desc&torden="],
    ["GET", "_getnumerofactura.php?fcomprobante=15"],
    ["POST", "grabar_ordenfabricacion.php?codigo=0"],
  ]
  for (const [m, r] of no) assert.equal(W.rutaEscrituraAjuste(r, m, COD), false, `${m} ${r}`)
  assert.equal(W.rutaEscrituraAjuste("grabar_pedidos.php?codigo=157704", "POST", 0), false)
  // ni la lectura ni la NP ni Z1 habilitan grabar la NP abierta sin el grupo
  assert.equal(W.rutaPermitida("grabar_pedidos.php?codigo=157704", "POST"), false)
  assert.equal(W.rutaEscrituraZ1("grabar_pedidos.php?codigo=157704", "POST"), false)
})

test("llave apagada: no se arma la llave ni se puede abrir el navegador del ajuste (rechaza antes de salir)", async () => {
  const base = { plant_id: "can", activo: true, remitir_activo: true, remitir_desde: null, deposito: 116 }
  assert.equal(AS.llaveAjuste(base), null)
  assert.equal(AS.llaveAjuste({ ...base, ajustar_activo: false }), null)
  assert.equal(AS.llaveAjuste({ ...base, remitir_activo: false, ajustar_activo: true }), null)
  assert.equal(AS.llaveAjuste({ ...base, activo: false, ajustar_activo: true }), null)
  assert.deepEqual(AS.llaveAjuste({ ...base, ajustar_activo: true }), { ajustar: true, plantId: "can" })
  const { navegadorAjuste } = await import("../zomatik/cliente.ts")
  await assert.rejects(navegadorAjuste(null, COD), /apagado/)
  await assert.rejects(navegadorAjuste({ ajustar: true, plantId: "can" }, 0), /falta el código/)
})

// ===========================================================================
// 5. El control del remito (4.4): el pendiente que trae "Continuar"
// ===========================================================================

const MARCA_RM = Z.marcaZ1(PED, HOY, 1)
function zomatikRemito() {
  const estado = { grabado: null }
  const rutas = [
    ["GET", /^modificar_remitos\.php\?pedido=157767$/, () => resp(fxZ("remito-alta.html"))],
    ["GET", /^traerdatossecundarios\.php\?fcliente=24661&rnd=\d+$/, () => resp(fxZ("remito-secundarios.txt"))],
    ["GET", /^manage_remitos\.php\?remitos=0&.*fpedido=157767/, () => resp(fxZ("remito-pendientes.html"))],
    ["GET", /^_validarnumeroremito\.php\?/, () => resp("")],
    ["POST", /^grabar_remitos\.php\?codigo=0$/, ({ cuerpo }) => ((estado.grabado = new URLSearchParams(cuerpo).get("numero")), resp("", 302, "listado_remitos.php"))],
    ["GET", /^listado_remitos\.php$/, () => resp(`<form method="post" action="" name="frm_selsuc"><select name="selsuc"><option value="18" selected>R</option></select></form><form action="listado_remitos.php?enviado=1" method="POST" name="formulario"><input type="hidden" name="exportar" value="0"><select name="bus_sucursal"><option value="18">REBUCRET</option></select></form>`)],
    ["POST", /^listado_remitos\.php\?enviado=1$/, ({ suc }) => conSuc(suc, `<input type="hidden" id="paginar_archivo" value="remitos"><input type="hidden" id="sql" name="sql" value="select r.codigo from remitos r"><input type="hidden" id="query_string" value="">`)],
    ["POST", /^paginar_remitos\.php\?rnd=\d+$/, () => resp(`<table><tr><td>Numero</td></tr>${estado.grabado ? `<tr><td><a href="modificar_remitos.php?codigo=5550">RM ${estado.grabado}</a></td></tr>` : ""}</table><input type="hidden" id="registros_total" value="${estado.grabado ? 1 : 0}">`)],
    ["GET", /^modificar_remitos\.php\?codigo=5550$/, () => resp(`<form action="grabar_remitos.php?codigo=5550" name="frm_remitos"><textarea name="observaciones">${MARCA_RM}</textarea></form>`)],
  ]
  const nav = { suc: "18", llamadas: [], async sucursal(id) { nav.suc = id; return true }, async get(ruta) { return r("GET", ruta, null) }, async post(ruta, c) { return r("POST", ruta, c ? latin1(c) : "") } }
  async function r(m, ruta, cuerpo) {
    nav.llamadas.push({ m, ruta })
    assert.ok(W.rutaEscrituraZ1(ruta, m) || W.rutaPermitida(ruta, m), `ruta fuera de la lista cerrada: ${m} ${ruta}`)
    const x = rutas.find(([mm, re]) => mm === m && re.test(ruta))
    if (!x) throw new Error(`ruta no simulada: ${m} ${ruta}`)
    return x[2]({ ruta, cuerpo, suc: nav.suc })
  }
  return { nav, estado }
}
const datosRm = (extra = {}) => ({
  marca: MARCA_RM, npCodigo: 157767, comprobante: "7", deposito: 116, fecha: HOY, m3: 8, articuloCodigo: 10090020, articuloNombre: "H21-620-10 C (CAN)",
  patente: null, observaciones: MARCA_RM, observacionesimp: "934", numero: "0001-00002260",
  entrega: Z.entregaRemito({ nombre: "LA TERCERA", direccion: null, localidad: "CANNING" }), buscarAntes: false, ...extra,
})

test("remito: con el pendiente esperado (10) sale; si Zomatik trae otro → 'revisar' SIN grabar; sin control (null) como hoy", async () => {
  let z = zomatikRemito()
  let r = await ZR.generarRemito(z.nav, datosRm({ pendienteEsperado: 10 }), opts())
  assert.equal(r.estado, "ok", r.mensaje)
  z = zomatikRemito()
  r = await ZR.generarRemito(z.nav, datosRm({ pendienteEsperado: 0 }), opts())
  assert.equal(r.estado, "revisar")
  assert.equal(r.paso, "continuar_remito") // antes de grabar: "Remitir en Zomatik" lo reintenta
  assert.match(r.mensaje, /^La NP no quedó ajustada: Zomatik dice 10 m³ pendientes y el sistema esperaba 0\./)
  assert.equal(z.estado.grabado, null)
  assert.equal(z.nav.llamadas.filter((l) => /^grabar_/.test(l.ruta)).length, 0)
  z = zomatikRemito()
  r = await ZR.generarRemito(z.nav, datosRm({ pendienteEsperado: null }), opts())
  assert.equal(r.estado, "ok")
})

// ===========================================================================
// 6. El servidor (base simulada)
// ===========================================================================

const CAN = "can"
const r3 = (n) => Math.round(n * 1000) / 1000
function baseFalsa(tablas, { sinMigracionAjuste = false } = {}) {
  const db = JSON.parse(JSON.stringify(tablas))
  function consulta(tabla) {
    const st = { op: "select", filtros: [], lim: null, cambios: null, orden: null, cols: "" }
    const pasa = (row) => st.filtros.every((f) => f(row))
    const filas = () => (db[tabla] ||= []).filter(pasa)
    const correr = () => {
      if (sinMigracionAjuste && (tabla === "zomatik_np_ajustes" || /ajustar_activo/.test(st.cols))) return { data: null, error: { message: `column "ajustar_activo" does not exist` } }
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
        return { data: fs.map((x) => ({ ...x })), error: null }
      }
      if (st.op === "delete") {
        const fs = filas()
        db[tabla] = db[tabla].filter((x) => !fs.includes(x))
        return { data: fs, error: null }
      }
      if (st.op === "insert") {
        const nuevas = [].concat(st.cambios)
        for (const v of nuevas) {
          const t = (db[tabla] ||= [])
          if (tabla === "integraciones" && t.some((r) => r.clave === v.clave)) return { data: null, error: { code: "23505", message: "duplicate" } }
          if (tabla === "zomatik_np_ajustes" && t.some((r) => r.marca === v.marca || (r.np_id === v.np_id && r.scheduled_dispatch_id === v.scheduled_dispatch_id))) return { data: null, error: { code: "23505", message: "duplicate" } }
          const base = tabla === "zomatik_np_ajustes" ? { id: `aj-${t.length + 1}`, intentos: 0, aplicado_at: null, aviso_juan_at: null, con_factura: null, factura_texto: null, resuelto_por: null, resuelto_motivo: null } : {}
          t.push({ ...base, created_at: new Date(Date.now() + t.length).toISOString(), ...v })
        }
        return { data: null, error: null }
      }
    }
    const q = {
      select(c) { if (st.op === "select") st.cols = String(c || ""); return q },
      update(c) { st.op = "update"; st.cambios = c; return q },
      delete() { st.op = "delete"; return q },
      insert(c) { st.op = "insert"; st.cambios = c; return q },
      upsert(c) { st.op = "insert"; st.cambios = c; return q },
      eq(c, v) { const [a, b] = c.split("->>"); st.filtros.push((r) => (b ? r[a]?.[b] : r[c]) === v); return q },
      neq(c, v) { st.filtros.push((r) => r[c] !== v); return q },
      in(c, vs) { st.filtros.push((r) => vs.includes(r[c])); return q },
      is(c, v) { st.filtros.push((r) => (r[c] ?? null) === v); return q },
      gte(c, v) { st.filtros.push((r) => String(r[c]) >= v); return q },
      lt(c, v) { st.filtros.push((r) => String(r[c]) < v); return q },
      not(c, op, v) { st.filtros.push((r) => (r[c] ?? null) !== v); return q },
      order(c, o) { st.orden = [c, o?.ascending !== false]; return q },
      limit(n) { st.lim = n; return q },
      async maybeSingle() { const r = correr(); return { data: r.data?.[0] ?? null, error: r.error } },
      then(ok, mal) { return Promise.resolve(correr()).then(ok, mal) },
    }
    return q
  }
  const tomar = (tabla, clave) => (a) => {
    const r = db[tabla].find((x) => x.id === a.p_id)
    const colgada = r?.estado === "generando" && Date.now() - Date.parse(r.en_curso_desde) > 3 * 60_000
    if (!r || !(a.p_desde.includes(r.estado) || colgada)) return []
    const antes = { [clave]: r.id, estado_anterior: r.estado, paso_anterior: r.paso }
    Object.assign(r, { estado: "generando", en_curso_desde: new Date().toISOString(), intentos: (r.intentos || 0) + 1 })
    return [antes]
  }
  const rpcs = {
    zomatik_robot_tomar: () => true,
    zomatik_robot_soltar: () => null,
    zomatik_remito_tomar: tomar("zomatik_remitos", "remito_id"),
    zomatik_ajuste_tomar: tomar("zomatik_np_ajustes", "ajuste_id"),
    zomatik_remito_crear: ({ p: x }) => {
      if (db.zomatik_remitos.some((r) => r.marca === x.marca) || x.despachos.some((d) => db.zomatik_remito_despachos.some((l) => l.dispatch_id === d.id))) return null
      const id = `rem-${db.zomatik_remitos.length + 1}`
      db.zomatik_remitos.push({
        id, ...x, despachos: undefined, estado: "pendiente", of_estado: "pendiente", of_numero: null, of_codigo: null, of_foto: null, of_foto_dia: null, sin_stock: 0, cambio_avisado: null,
        remito_estado: "pendiente", remito_numero: null, remito_codigo: null, paso: null, mensaje: null, intentos: 0, proximo_intento: new Date(Date.now() - 1000).toISOString(), en_curso_desde: null,
        created_at: new Date(Date.now() + db.zomatik_remitos.length).toISOString(),
      })
      for (const d of x.despachos) db.zomatik_remito_despachos.push({ remito_id: id, dispatch_id: d.id, m3: d.m3 })
      return id
    },
    // Como la función SQL: con la NP bloqueada, la NP en el objetivo, el uso en lo despachado y, sin libre, "cerrada"
    zomatik_ajuste_aplicar: ({ p_id }) => {
      const a = db.zomatik_np_ajustes.find((x) => x.id === p_id)
      if (!a) return { error: "El ajuste no existe." }
      if (a.aplicado_at) { if (a.estado === "generando") Object.assign(a, { estado: "ok", paso: "ok" }); return { ok: true, ya: true } }
      if (a.estado !== "generando") return { error: "El ajuste cambió mientras se trabajaba." }
      if (db.falla_aplicar) return { error: "falló la base" }
      const np = db.zomatik_np.find((x) => x.id === a.np_id)
      np.m3_original ??= np.m3
      np.m3 = a.m3_objetivo
      for (const u of db.zomatik_np_uso.filter((u) => u.np_id === a.np_id && u.scheduled_dispatch_id === a.scheduled_dispatch_id && u.activo)) u.m3 = a.m3_despachado
      const usos = db.zomatik_np_uso.map((u) => ({ ...u, pedido: db.scheduled_dispatches.find((p) => p.id === u.scheduled_dispatch_id) || null }))
      const s = N.saldoNp({ id: np.id, m3: np.m3 }, usos)
      if (s.libre <= 0.001 && !s.conPedidoActivo) Object.assign(np, { saldo_decision: "cerrada", saldo_mensaje: "Ajustada a lo despachado" })
      Object.assign(a, { estado: "ok", paso: "ok", aplicado_at: new Date().toISOString(), ok_at: new Date().toISOString(), en_curso_desde: null, proximo_intento: null, mensaje: null })
      return { ok: true, libre: s.libre }
    },
  }
  const sb = {
    from: (t) => consulta(t),
    async rpc(nombre, a) {
      if (!rpcs[nombre]) throw new Error(`rpc no simulada: ${nombre}`)
      return { data: rpcs[nombre](a), error: null }
    },
  }
  return { sb, db }
}

const ahora = () => new Date().toISOString()
const despacho = (id, m3, extra = {}) => ({ id, scheduled_dispatch_id: PED, quantity_m3: m3, remito: id, remito_tipo: "X", formula_id: "f1", plant_id: CAN, created_at: new Date(Date.now() - 3600_000 + Number(id.replace(/\D/g, "")) * 1000).toISOString(), dispatch_date: ahora(), is_test_dispatch: false, mixers: { license_plate: `AB${id}` }, ...extra })
const NP1 = { id: "np1", n: 1, m3: 60, estado: "ok", numero: "NP2 0001-00002090", zomatik_codigo: 157767, marca: MARCA_NP, paso: "autorizada", scheduled_dispatch_id: PED, plant_id: CAN, formula_id: "f1", client_id: "c1", saldo_decision: null }

/** Santa Rita: NP2 de 60, cinco camiones de 8 (40), el pedido finalizado. */
function santaRita({ config = {}, nps = [NP1], usos = [{ id: "u1", np_id: "np1", scheduled_dispatch_id: PED, m3: 60, activo: true, created_at: "2026-11-05T10:00:00Z", despachado_fijo: null }], despachos = ["1", "2", "3", "4", "5"].map((i) => despacho(`d${i}`, 8)), sinMigracionAjuste = false } = {}) {
  return baseFalsa({
    // Sin la migración la fila no tiene las columnas del ajuste (la base simulada devuelve todo lo que hay en la fila)
    zomatik_np_config: [{ plant_id: CAN, activo: true, remitir_activo: true, remitir_desde: null, deposito: 116, ...(sinMigracionAjuste ? {} : { ajustar_activo: true, ajustar_desde: null }), ...config }],
    scheduled_dispatches: [{ id: PED, plant_id: CAN, status: "completed", dispatched_m3: r3(despachos.reduce((s, d) => s + d.quantity_m3, 0)), clients: { name: "SANTA RITA" }, construction_sites: { name: "LOTE 12", address: null, localidad: "CANNING" } }],
    dispatches: despachos,
    zomatik_np: nps.map((x) => ({ ...x })),
    zomatik_np_uso: usos,
    zomatik_remitos: [],
    zomatik_remito_despachos: [],
    zomatik_np_ajustes: [],
    formulas: [{ id: "f1", code: "H21", zomatik_articulo_codigo: 10090020, zomatik_articulo_nombre: "H21-620-10 C (CAN)" }],
    zomatik_articulos: [{ codigo: 10090020, nombre: "H21-620-10 C (CAN)", codigo_sistema: 1000015959 }],
    activity_log: [],
    integraciones: [],
  }, { sinMigracionAjuste })
}

/** El robot de OF + remito y el del ajuste, simulados (anotan el orden). */
function robots({ ajuste } = {}) {
  const h = { orden: [], ajustes: [], navAjuste: [], of: [], remito: [], avisos: [], errores: [], juan: [] }
  const respuestaAjuste = ajuste || ((d) => ({ estado: "ok", mensaje: null, paso: "verificar_np", leido: d.m3Np }))
  return {
    h,
    dep: {
      navegador: async () => ({}),
      avisar: async (_s, t, l) => (h.avisos.push([t, l]), { enviado: true }),
      avisarError: async (_s, t, l) => (h.errores.push([t, l]), { enviado: true }),
      robot: {
        generarOf: async (_n, d) => (h.orden.push("of"), h.of.push(d), { estado: "ok", mensaje: null, numero: "OF 0001-00003412", codigo: 9100, paso: "verificar_of", grabado: true }),
        elegirNumeroRemito: async () => ({ estado: "ok", mensaje: null, numero: "0099-00002760", paso: "elegir_numero" }),
        autorizarNp: async () => ({ estado: "ya", mensaje: null }),
        generarRemito: async (_n, d) => (h.orden.push("remito"), h.remito.push(d), { estado: "ok", mensaje: null, numero: `RM2 0099-0000${2760 + h.remito.length}`, codigo: 5550 + h.remito.length, paso: "verificar_remito", grabado: true }),
      },
      ajuste: {
        navegador: async (llave, codigo) => (h.navAjuste.push([llave, codigo]), {}),
        robot: {
          ajustarCantidadNp: async (_n, d, o) => {
            h.orden.push("ajuste")
            h.ajustes.push(d)
            await o.alPaso?.("leer_np")
            return typeof respuestaAjuste === "function" ? respuestaAjuste(d, h) : respuestaAjuste
          },
        },
        avisarJuan: async (_s, t, l) => (h.juan.push([t, l]), { enviado: true }),
      },
    },
  }
}
/** Lo que hace "Finalizar pedido" en el servidor: remitos y ajustes; después el robot (procesarZ1). */
async function finalizar(b, o = {}) {
  await S.prepararRemitos(PED, HOY, "test", b.sb)
  const aj = await AS.prepararAjustes(PED, "test", b.sb, { avisar: o.avisar })
  return aj
}
const procesar = (b, f, extra = {}) => S.procesarZ1({ usuario: "test", inicio: Date.now(), sb: b.sb, dep: f.dep, ...extra })

test("servidor, Santa Rita (12.1 y 12.2): ajuste 60 → 40 ANTES de la OF y el remito; NP 40 (original 60), uso 40, sin saldo", async () => {
  const b = santaRita()
  const f = robots()
  const aj = await finalizar(b)
  assert.equal(aj.aplica, true)
  assert.equal(aj.pendientes, 1)
  assert.equal(b.db.zomatik_remitos.length, 1)
  await procesar(b, f)
  assert.deepEqual(f.h.orden, ["ajuste", "of", "remito"])
  assert.deepEqual([f.h.ajustes[0].m3Np, f.h.ajustes[0].objetivo, f.h.ajustes[0].cortado], [60, 40, false])
  assert.deepEqual(f.h.navAjuste[0], [{ ajustar: true, plantId: CAN }, 157767]) // el navegador atado a ESTA NP
  const a = b.db.zomatik_np_ajustes[0]
  assert.deepEqual([a.estado, a.tipo, a.m3_np, a.m3_objetivo, a.m3_despachado], ["ok", "editar", 60, 40, 40])
  assert.equal(a.marca, "Sistema Rebucret - pedido 1a2b3c4d - ajuste NP2 0001-00002090")
  const np = b.db.zomatik_np[0]
  assert.deepEqual([np.m3, np.m3_original, np.saldo_decision], [40, 60, "cerrada"]) // no aparece en "NP con saldo"
  assert.equal(b.db.zomatik_np_uso[0].m3, 40)
  assert.equal(f.h.remito[0].m3, 40)
  assert.equal(f.h.remito[0].pendienteEsperado, 40) // el remito controla lo que dice Zomatik
  assert.equal(b.db.zomatik_remitos[0].estado, "ok")
  // en Actividad, el ajuste antes que la OF
  const que = b.db.activity_log.map((x) => x.details["Qué pasó"])
  const iAj = que.findIndex((x) => /^NP ajustada en Zomatik: NP2 0001-00002090 60 → 40 m³$/.test(x || ""))
  const iOf = que.findIndex((x) => /^OF en Zomatik/.test(x || ""))
  assert.ok(iAj >= 0 && iAj < iOf, JSON.stringify(que))
  assert.equal(f.h.errores.length + f.h.avisos.length + f.h.juan.length, 0)
})

test("servidor, llave del ajuste apagada (12.8): sin ajustes, el remito sale como hoy (sin control) y no se abre el navegador del ajuste", async () => {
  const b = santaRita({ config: { ajustar_activo: false } })
  const f = robots()
  const aj = await finalizar(b)
  assert.equal(aj.aplica, false)
  await procesar(b, f)
  assert.deepEqual(f.h.orden, ["of", "remito"])
  assert.equal(f.h.navAjuste.length, 0)
  assert.equal(b.db.zomatik_np_ajustes.length, 0)
  assert.equal(f.h.remito[0].pendienteEsperado, null)
  assert.equal(b.db.zomatik_np[0].m3, 60)
})

test("servidor, sin la migración del ajuste: Z1 sigue como hoy (la config se lee sin las columnas nuevas)", async () => {
  const b = santaRita({ sinMigracionAjuste: true })
  const f = robots()
  await S.prepararRemitos(PED, HOY, "test", b.sb)
  assert.equal((await AS.prepararAjustesSeguro(PED, "test", b.sb))?.aplica ?? false, false) // sin la llave (no existe la columna): no aplica
  await procesar(b, f)
  assert.deepEqual(f.h.orden, ["of", "remito"])
  assert.equal(b.db.zomatik_remitos[0].estado, "ok")
})

test("servidor, completo justo (60 de 60): ajuste 'nada', no se abre Zomatik para ajustar y el remito sale", async () => {
  const b = santaRita({ despachos: ["1", "2", "3", "4", "5"].map((i) => despacho(`d${i}`, 12)) })
  const f = robots()
  const aj = await finalizar(b)
  assert.deepEqual([aj.pendientes, b.db.zomatik_np_ajustes[0].estado], [0, "nada"])
  await procesar(b, f)
  assert.deepEqual(f.h.orden, ["of", "remito"])
  assert.equal(f.h.navAjuste.length, 0)
  assert.equal(f.h.remito[0].pendienteEsperado, 60)
})

test("servidor: prepararAjustes dos veces no duplica; un ajuste anulado (pedido reabierto) se vuelve a armar", async () => {
  const b = santaRita()
  await finalizar(b)
  const otra = await AS.prepararAjustes(PED, "test", b.sb)
  assert.equal(otra.creados, 0)
  assert.equal(b.db.zomatik_np_ajustes.length, 1)
  b.db.zomatik_np_ajustes[0].estado = "anulado"
  assert.equal((await AS.prepararAjustes(PED, "test", b.sb)).creados, 1)
  assert.equal(b.db.zomatik_np_ajustes[0].estado, "pendiente")
})

test("servidor: el remito ESPERA con el ajuste en revisar (mail a Bautista una vez) y sale después de 'Remitir sin ajustar la NP'", async () => {
  const b = santaRita()
  const f = robots({ ajuste: { estado: "revisar", mensaje: A.MSJ_FACTURA_NO_SE_SABE, paso: "leer_factura", leido: 60 } })
  await finalizar(b)
  await procesar(b, f)
  assert.equal(b.db.zomatik_np_ajustes[0].estado, "revisar")
  assert.equal(f.h.of.length + f.h.remito.length, 0) // ni OF ni remito
  const rm = b.db.zomatik_remitos[0]
  assert.deepEqual([rm.estado, rm.paso], ["pendiente", "esperando_ajuste"])
  assert.match(rm.mensaje, /^Esperando el ajuste de la NP/)
  assert.equal(f.h.errores.length, 1)
  assert.match(f.h.errores[0][0], /ajuste de la NP para revisar/)
  // el botón otra vez: el revisar no se reintenta solo, el remito sigue esperando y no llega otro mail
  await procesar(b, f, { pedidoId: PED })
  assert.equal(f.h.ajustes.length, 1)
  assert.equal(f.h.remito.length, 0)
  assert.equal(f.h.errores.length, 1)
  // un gerencial lo arregló a mano en Zomatik
  assert.deepEqual(await AS.remitirSinAjustar(PED, "Juan Oreguy", "La bajé a 40 a mano", b.sb), { ok: true })
  assert.deepEqual([b.db.zomatik_np_ajustes[0].estado, b.db.zomatik_np_ajustes[0].resuelto_motivo], ["a_mano", "La bajé a 40 a mano"])
  await procesar(b, f)
  assert.deepEqual(f.h.orden.slice(-2), ["of", "remito"])
  assert.equal(f.h.remito[0].pendienteEsperado, null) // a mano: sin control
  assert.ok(b.db.activity_log.some((x) => x.details.Motivo === "La bajé a 40 a mano"))
})

test("servidor: ajuste en error → un mail a Bautista por episodio (el botón con el mismo error no repite); pendiente por red → el remito espera", async () => {
  const b = santaRita()
  const f = robots({ ajuste: { estado: "error", mensaje: A.msjZomatikNoDejo("no"), paso: "grabar_np" } })
  await finalizar(b)
  await procesar(b, f)
  assert.equal(b.db.zomatik_np_ajustes[0].estado, "error")
  assert.equal(f.h.errores.length, 1)
  await procesar(b, f, { pedidoId: PED }) // "Remitir en Zomatik" reintenta el error
  assert.equal(f.h.ajustes.length, 2)
  assert.equal(f.h.errores.length, 1)
  assert.equal(f.h.remito.length, 0)
  // red: queda pendiente, el remito espera; en el próximo intento sale bien y el remito sale en la misma pasada
  const b2 = santaRita()
  let vez = 0
  const f2 = robots({ ajuste: (d) => (++vez === 1 ? { estado: "pendiente", mensaje: "Zomatik no respondió a tiempo", paso: "leer_np" } : { estado: "ok", mensaje: null, paso: "verificar_np", leido: d.m3Np }) })
  await finalizar(b2)
  await procesar(b2, f2)
  assert.equal(b2.db.zomatik_np_ajustes[0].estado, "pendiente")
  assert.equal(f2.h.remito.length, 0)
  b2.db.zomatik_np_ajustes[0].proximo_intento = new Date(Date.now() - 1000).toISOString()
  await procesar(b2, f2)
  assert.deepEqual(f2.h.orden, ["ajuste", "ajuste", "of", "remito"])
})

test("servidor, con factura (12.3, fase 1): no se toca, 'hacé la devolución de 20 m³', UN mail a Juan, y el remito sale después de 'Ya hice la devolución'", async () => {
  const b = santaRita()
  const f = robots({ ajuste: { estado: "con_factura", mensaje: null, paso: "leer_factura", leido: 60, facturaTexto: "la NP no tiene el botón Grabar" } })
  await finalizar(b)
  await procesar(b, f)
  const a = b.db.zomatik_np_ajustes[0]
  assert.deepEqual([a.estado, a.tipo, a.con_factura], ["revisar", "devol", true])
  assert.equal(a.mensaje, "La NP tiene factura: hacé la devolución de 20 m³ a mano y tocá «Ya la hice».")
  assert.equal(f.h.juan.length, 1)
  assert.match(f.h.juan[0][0], /^NP con factura · SANTA RITA · NP2 0001-00002090$/)
  assert.ok(f.h.juan[0][1].some((l) => /devolución \(DEVOL\) de 20 m³/.test(l)))
  assert.ok(f.h.juan[0][1].some((l) => /modificar_pedidos\.php\?codigo=157767/.test(l)))
  assert.ok(f.h.juan[0][1].some((l) => /nota de crédito/.test(l)))
  assert.equal(f.h.errores.length, 0) // 15.6: este aviso es solo de Juan
  assert.equal(b.db.zomatik_np[0].m3, 60)
  assert.equal(f.h.remito.length, 0)
  assert.equal(ajusteParaResolver([{ estado: "revisar", con_factura: true }]), "factura")
  await procesar(b, f, { pedidoId: PED })
  assert.equal(f.h.juan.length, 1) // una sola vez
  await AS.remitirSinAjustar(PED, "Juan Oreguy", "DP2 0001-00000012 por 20 m³", b.sb)
  await procesar(b, f)
  assert.equal(f.h.remito.length, 1)
  assert.equal(f.h.remito[0].m3, 40)
})

test("servidor, exceso (12.7): NP 40 y 40,4 despachados → la NP se agranda a 40,4 y el despacho que había quedado afuera se remite", async () => {
  const b = santaRita({
    nps: [{ ...NP1, m3: 40 }], usos: [{ id: "u1", np_id: "np1", scheduled_dispatch_id: PED, m3: 40, activo: true, created_at: "2026-11-05T10:00:00Z", despachado_fijo: null }],
    despachos: [despacho("d1", 8), despacho("d2", 8), despacho("d3", 8), despacho("d4", 8), despacho("d5", 8.4)],
  })
  const f = robots()
  await finalizar(b)
  assert.deepEqual(b.db.zomatik_remitos.map((x) => x.m3), [32]) // hoy: el último no entra ("generá una NP adicional")
  assert.equal(b.db.zomatik_np_ajustes[0].m3_objetivo, 40.4)
  await procesar(b, f)
  assert.deepEqual([b.db.zomatik_np[0].m3, b.db.zomatik_np_uso[0].m3], [40.4, 40.4])
  assert.deepEqual(f.h.remito.map((x) => x.m3), [32, 8.4])
  assert.deepEqual(f.h.remito.map((x) => x.pendienteEsperado), [40.4, 8.4])
})

test("servidor, dos NP con la adicional sin usar (15.5): no se vacía; 'revisar' con su mensaje y mail a Bautista; el remito de la NP 1 no espera", async () => {
  const NP2 = { ...NP1, id: "np2", n: 2, m3: 10, numero: "NP2 0001-00002091", zomatik_codigo: 157768, marca: N.marcaNp(PED, 2) }
  const b = santaRita({
    nps: [{ ...NP1, m3: 50 }, NP2],
    usos: [{ id: "u1", np_id: "np1", scheduled_dispatch_id: PED, m3: 50, activo: true, created_at: "2026-11-05T10:00:00Z", despachado_fijo: null }, { id: "u2", np_id: "np2", scheduled_dispatch_id: PED, m3: 10, activo: true, created_at: "2026-11-05T11:00:00Z", despachado_fijo: null }],
  })
  const f = robots()
  const errores = []
  await finalizar(b, { avisar: async (_s, t, l) => (errores.push([t, l]), { enviado: true }) })
  const a2 = b.db.zomatik_np_ajustes.find((x) => x.np_id === "np2")
  assert.equal(a2.estado, "revisar")
  assert.equal(a2.mensaje, "La NP NP2 0001-00002091 quedó sin uso (0 m³): eliminala o dejala pendiente en Zomatik")
  assert.equal(errores.length, 1)
  await procesar(b, f)
  assert.deepEqual(f.h.ajustes.map((x) => x.codigo), [157767]) // la adicional no se toca
  assert.equal(f.h.remito.length, 1)
  assert.deepEqual([b.db.zomatik_np[1].m3, b.db.zomatik_np[1].estado], [10, "ok"])
  assert.equal(chipRemito([{ estado: "ok", remito_numero: "RM2 0099-00002761", fecha: HOY }], [{ estado: "ok", numero: "NP2 0001-00002090", m3_np: 50, m3_objetivo: 40 }, { estado: "revisar", numero: "NP2 0001-00002091", mensaje: a2.mensaje }]).texto, "NP: revisar ajuste")
})

test("servidor: el pedido se reabre con el ajuste sin hacer → 'anulado' sin abrir Zomatik, y el remito sale como hoy", async () => {
  const b = santaRita()
  const f = robots()
  await finalizar(b)
  b.db.scheduled_dispatches[0].status = "active"
  await procesar(b, f)
  assert.equal(b.db.zomatik_np_ajustes[0].estado, "anulado")
  assert.equal(f.h.navAjuste.length, 0)
  assert.equal(f.h.remito[0].pendienteEsperado, null)
})

test("servidor, corte (12.6): colgado en grabar_np → se relee (cortado) con el objetivo guardado; colgado en aplicar → solo la base", async () => {
  let b = santaRita()
  let f = robots()
  await finalizar(b)
  Object.assign(b.db.zomatik_np_ajustes[0], { estado: "generando", paso: "grabar_np", en_curso_desde: new Date(Date.now() - 5 * 60_000).toISOString(), intentos: 1 })
  await procesar(b, f)
  assert.equal(f.h.ajustes[0].cortado, true)
  assert.equal(f.h.ajustes[0].objetivo, 40)
  assert.equal(b.db.zomatik_np_ajustes[0].estado, "ok")
  // Zomatik ya tenía 40 pero falló la base: queda en "aplicar" y el reintento no vuelve a abrir Zomatik
  b = santaRita()
  f = robots()
  await finalizar(b)
  b.db.falla_aplicar = true
  await procesar(b, f)
  assert.deepEqual([b.db.zomatik_np_ajustes[0].estado, b.db.zomatik_np_ajustes[0].paso], ["generando", "aplicar"])
  assert.equal(f.h.remito.length, 0)
  b.db.falla_aplicar = false
  b.db.zomatik_np_ajustes[0].en_curso_desde = new Date(Date.now() - 5 * 60_000).toISOString()
  b.db.zomatik_remitos[0].proximo_intento = new Date(Date.now() - 1000).toISOString()
  await procesar(b, f)
  assert.equal(f.h.ajustes.length, 1)
  assert.equal(b.db.zomatik_np_ajustes[0].estado, "ok")
  assert.equal(b.db.zomatik_np[0].m3, 40)
  assert.equal(f.h.remito.length, 1)
})

test("servidor: el remito armado sin su ajuste (se cortó entre los dos) → el gate lo arma y espera", async () => {
  const b = santaRita()
  const f = robots({ ajuste: { estado: "pendiente", mensaje: "red", paso: "leer_np" } })
  await S.prepararRemitos(PED, HOY, "test", b.sb) // sin prepararAjustes
  await procesar(b, f)
  assert.equal(b.db.zomatik_np_ajustes.length, 1)
  assert.equal(f.h.of.length, 0)
  assert.equal(b.db.zomatik_remitos[0].paso, "esperando_ajuste")
})

test("chip del pedido: Ajustando NP… / NP: revisar ajuste / Remito esperando la NP / el número con 'NP 60 → 40 m³' en el detalle", () => {
  const aj = (estado, extra = {}) => ({ estado, tipo: "editar", numero: "NP2 0001-00002090", m3_np: 60, m3_objetivo: 40, mensaje: null, con_factura: null, ...extra })
  const rm = (extra = {}) => ({ estado: "pendiente", remito_estado: "pendiente", of_numero: null, remito_numero: null, mensaje: null, fecha: HOY, paso: null, ...extra })
  assert.equal(chipRemito([rm()], [aj("pendiente")]).texto, "Ajustando NP…")
  assert.equal(chipRemito([rm()], [aj("error")]).texto, "NP: revisar ajuste")
  assert.equal(chipRemito([rm({ paso: "esperando_ajuste" })], [aj("ok")]).texto, "Remito esperando la NP")
  const c = chipRemito([rm({ estado: "ok", remito_estado: "ok", remito_numero: "RM2 0099-00002760", of_numero: "OF 1" })], [aj("ok")])
  assert.equal(c.texto, "RM2 …2760 ✓")
  assert.match(c.titulo, /NP2 0001-00002090 60 → 40 m³/)
  assert.equal(chipRemito([rm({ estado: "ok", remito_estado: "ok", remito_numero: "RM2 0099-00002760" })]).texto, "RM2 …2760 ✓") // sin ajuste, como hoy
  assert.equal(ajusteParaResolver([aj("ok")]), null)
  assert.equal(ajusteParaResolver([aj("revisar")]), "trabado")
})
