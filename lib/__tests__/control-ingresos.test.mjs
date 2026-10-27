// Pruebas del control de ingresos de materia prima (docs/control-ingresos-mp.md): normalización de remitos, materiales,
// proveedores, el cruce con los casos reales de las planillas de Juan (lib/__fixtures__/control-ingresos/casos.json),
// el estado de las diferencias entre corridas, el export de Zomatik y el mail. Sin red ni base.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as C from "../control-ingresos/cruce.ts"
import { armarMail } from "../control-ingresos/mail.ts"

const casos = JSON.parse(readFileSync(new URL("../__fixtures__/control-ingresos/casos.json", import.meta.url), "utf8"))
const difs = C.cruzar(casos.nuestros, casos.zomatik, { hoy: casos.hoy })
const conRef = (ref) => difs.filter((d) => [...d.nuestro, ...d.zomatik].some((l) => l.ref === ref))
const una = (ref) => {
  const ds = conRef(ref)
  assert.equal(ds.length, 1, `${ref}: ${ds.length} diferencias (${ds.map((d) => d.tipo).join(", ")})`)
  return ds[0]
}

// ── Normalizaciones ──
test("normalizarRemito: sin punto de venta ni ceros a la izquierda", () => {
  assert.equal(C.normalizarRemito("0002-00881597"), "881597")
  assert.equal(C.normalizarRemito("00002-  00319166"), "319166")
  assert.equal(C.normalizarRemito("00002  00318913"), "318913")
  assert.equal(C.normalizarRemito("0002 02742364"), "2742364")
  assert.equal(C.normalizarRemito("0109  00166837"), "166837")
  assert.equal(C.normalizarRemito("00880960"), "880960")
  assert.equal(C.normalizarRemito("000200881597"), "881597")
  assert.equal(C.normalizarRemito("0109-00065063"), "65063")
  assert.equal(C.normalizarRemito("0000-00000000"), null)
  assert.equal(C.normalizarRemito("000000"), null)
  assert.equal(C.normalizarRemito(""), null)
  assert.equal(C.normalizarRemito(null), null)
})

test("claveMaterial: nuestros nombres y los de Zomatik van a la misma clave", () => {
  for (const [a, b] of [["Piedra Partida 6/20", "PIEDRA PARTIDA 6-20"], ["Piedra Partida 6/12", "PIEDRA 6/12"], ["Arena Trituración 0/6", "ARENA DE TRITURACION 0-6"], ["Arena Fina", "ARENA FINA"], ["CPC 40", "CEMENTO CPC40 GRANEL"], ["Sikament 90E", "SIKAMENT 90 E"]])
    assert.equal(C.claveMaterial(a), C.claveMaterial(b), `${a} / ${b}`)
  assert.notEqual(C.claveMaterial("Piedra Partida 6/12"), C.claveMaterial("Piedra Partida 6/20"))
  assert.equal(C.claveMaterial("GASOIL GRADO 2"), null)
  assert.equal(C.claveMaterial("FILTRO DE ACEITE"), null)
})

test("toneladas: kg o toneladas, como lo haya cargado cada uno", () => {
  assert.deepEqual(C.toneladas(31090), { t: 31.09, cargadoEnT: false })
  assert.deepEqual(C.toneladas(32.76), { t: 32.76, cargadoEnT: true })
})

test("digitosInvertidos y proveedores", () => {
  assert.equal(C.digitosInvertidos(39.24, 39.42), true)
  assert.equal(C.digitosInvertidos(43.54, 43.1), false)
  assert.equal(C.digitosInvertidos(39.24, 39.24), false)
  assert.equal(C.mismoProveedor("GUERRICO", "Gerrico"), true)
  assert.equal(C.mismoProveedor("GUERRICO ", "GUERRICO S.A."), true)
  assert.equal(C.mismoProveedor("BLINKI", "BLINKI S.A."), true)
  assert.equal(C.mismoProveedor("CEMENTOS AVELLANEDA", "CEMENTOS AVELLANEDA S.A."), true)
  assert.equal(C.mismoProveedor("FENOMIX MATERIALES", "CEMENTOS AVELLANEDA S.A."), false)
  assert.equal(C.mismoProveedor(null, "BLINKI"), null)
})

test("ventana: desde el 01/08/2026 y después los últimos 90 días", () => {
  assert.equal(C.desdeVentana("2026-10-27"), "2026-08-01")
  assert.equal(C.desdeVentana("2026-12-15"), "2026-09-16")
  assert.equal(C.fechaArgentina("2026-10-26T03:00:00.000Z"), "2026-10-26")
  assert.equal(C.fechaArgentina("2026-10-27T02:30:00.000Z"), "2026-10-26")
  assert.deepEqual(C.tramosLectura("2026-07-27", "2026-10-27"), [
    { desde: "2026-09-26", hasta: "2026-10-27" },
    { desde: "2026-08-25", hasta: "2026-09-25" },
    { desde: "2026-07-27", hasta: "2026-08-24" },
  ])
  assert.equal(C.tramosLectura(C.sumarDias(C.desdeVentana("2026-12-15"), -C.MARGEN_DIAS), "2026-12-15").length, 3)
})

// ── Cruce con los casos de Juan ──
test("1. Falta en nuestro sistema: remito de Zomatik sin ingreso (y el gasoil no se controla)", () => {
  const d = una("z-319500")
  assert.equal(d.categoria, "falta_nuestro")
  assert.equal(d.zomatik[0].planta, "Canning")
  assert.equal(d.zomatik[0].t, 38.1)
  assert.equal(conRef("z-gasoil").length, 0)
})

test("2. Falta en Zomatik, con la nota (\"descargó lunes 26/10\")", () => {
  const d = una("67a57e7e-a8aa-47f7-9c82-c3903f2bca67")
  assert.equal(d.categoria, "falta_zomatik")
  assert.match(d.detalle, /DESCARGO LUNES 26\/10/)
  assert.equal(d.nuestro[0].cargadoEnT, true)
  assert.equal(una("9c91d8ea-f6e4-46d6-8a94-c0ad73e6d809").categoria, "falta_zomatik")
  // Lo del 26/10 todavía puede estar por cargarse: no se avisa
  assert.equal(conRef("e-319166").length, 0)
})

test("3. Toneladas: dígitos invertidos (39,42 contra 39,24) y distintas", () => {
  const d = una("694958ee-3de4-4661-8d8e-60be05ee6f04")
  assert.equal(d.categoria, "no_coincide")
  assert.equal(d.tipo, "digitos")
  assert.match(d.detalle, /39,42 t en el nuestro y 39,24 t en Zomatik/)
  const t = una("e-319043")
  assert.equal(t.tipo, "toneladas")
})

test("3. Cargado dos veces: en las dos plantas (nuestro) y con dos transportistas (Zomatik)", () => {
  const d = una("04e33ed2-8d36-40e7-967c-6d3bc890fa7f")
  assert.equal(d.tipo, "duplicado_nuestro")
  assert.equal(d.nuestro.length, 2)
  assert.equal(d.zomatik.length, 1)
  assert.match(d.detalle, /Canning y Hudson/)
  const z = una("z-318913-b")
  assert.equal(z.tipo, "duplicado_zomatik")
  assert.match(z.detalle, /dos transportistas: Transp\. A y Transp\. B/)
})

test("3. Otro producto (6/12 contra 6/20) y otra planta (Hudson 19/10 contra Canning 20/10)", () => {
  const p = una("720f2c71-d3c1-494a-8b51-bfb4326b4629")
  assert.equal(p.tipo, "producto")
  assert.match(p.detalle, /Piedra 6\/12 en el nuestro y Piedra 6\/20 en Zomatik/)
  const o = una("4855c974-e9b0-4f7c-9157-2839ea125242")
  assert.equal(o.tipo, "planta")
  assert.match(o.detalle, /Hudson el 19\/10 en el nuestro y Canning el 20\/10 en Zomatik/)
})

test("4. Número mal escrito: los 5 casos de Juan", () => {
  for (const [nuestro, z] of [
    ["8b914eed-aa0d-45ba-a281-89100ffb47c6", "z-3717"], // 163717 contra 3717
    ["cad72c2e-17a3-4b3d-819f-f44296316d8e", "z-65063"], // 165063 contra 0109-00065063
    ["98139dd2-4618-4059-9cec-3cc14438330e", "z-880159"], // 3410 contra 0002-00880159
    ["49fb13a2-f499-4fef-947f-431e0bd8679d", "z-318633"], // 319633 contra 318633
    ["dec1bfa5-0bed-4dd1-adee-1828d203685f", "z-ceros"], // 318729 contra 0000-00000000
  ]) {
    const d = una(nuestro)
    assert.equal(d.categoria, "numero_mal", nuestro)
    assert.equal(d.tipo, "numero", nuestro)
    assert.equal(d.zomatik[0].ref, z, nuestro)
  }
})

test("4. El mismo número con otro proveedor (Fenomix contra Cementos Avellaneda)", () => {
  const d = una("4bcd5fc0-175a-42d8-816a-b4f656823538")
  assert.equal(d.categoria, "numero_mal")
  assert.equal(d.tipo, "proveedor")
  assert.match(d.detalle, /FENOMIX MATERIALES en el nuestro y CEMENTOS AVELLANEDA S\.A\. en Zomatik/)
})

test("Lo que coincide no sale (fecha un día después, dentro de los ±3 días)", () => {
  assert.equal(conRef("e-319040").length, 0)
  assert.equal(conRef("z-164613").length, 1) // solo en el duplicado
})

test("Resumen del cruce: 15 diferencias, claves únicas y estables", () => {
  const cuenta = Object.fromEntries(C.CATEGORIAS.map((c) => [c.clave, difs.filter((d) => d.categoria === c.clave).length]))
  assert.deepEqual(cuenta, { falta_nuestro: 1, falta_zomatik: 2, no_coincide: 6, numero_mal: 6 })
  assert.equal(new Set(difs.map((d) => d.clave)).size, difs.length)
  const otraVez = C.cruzar([...casos.nuestros].reverse(), [...casos.zomatik].reverse(), { hoy: casos.hoy })
  assert.deepEqual(otraVez.map((d) => d.clave), difs.map((d) => d.clave))
})

test("Solo se informa lo de la ventana", () => {
  const d = C.cruzar(casos.nuestros, casos.zomatik, { hoy: casos.hoy, desde: "2026-10-01" })
  assert.equal(d.some((x) => x.fecha < "2026-10-01"), false)
})

test("Un número parecido en otra planta también se empareja (planta cualquiera)", () => {
  const n = [{ ...casos.nuestros[0], id: "x", plantaId: "HUD", planta: "Hudson" }]
  const z = [casos.zomatik[0]]
  const d = C.cruzar(n, z, { hoy: casos.hoy })
  assert.equal(d.length, 1)
  assert.equal(d[0].categoria, "numero_mal")
  assert.match(d[0].detalle, /Hudson en el nuestro y Canning en Zomatik/)
})

test("Sin número en los dos (fibra \"000000\" contra \"0000-00000000\"), misma cantidad: no es diferencia", () => {
  const n = [{ id: "fib", fecha: "2026-09-15", plantaId: "CAN", planta: "Canning", material: "Fibra", cantidad: 424.8, remito: "000000", proveedor: "FIBRASI Macroflex", transportista: null, notas: null, cargadoPor: null }]
  const z = [{ clave: "zf", fecha: "2026-09-15", plantaId: "CAN", planta: "Canning", articulo: "FIBRA MACROFLEX", cantidad: 424.8, remito: "0000-00000000", proveedor: "FIBRASI S.A.", transportista: null }]
  assert.deepEqual(C.cruzar(n, z, { hoy: casos.hoy }), [])
})

// ── Estado entre corridas ──
test("planDeEstados: nuevas, siguen (la revisada no vuelve), reabiertas y resueltas", () => {
  const [a, b, c] = difs
  const guardadas = [
    { id: "1", clave: a.clave, estado: "revisada" },
    { id: "2", clave: b.clave, estado: "resuelta" },
    { id: "3", clave: "vieja", estado: "abierta" },
    { id: "4", clave: "vieja-revisada", estado: "revisada" },
    { id: "5", clave: "vieja-resuelta", estado: "resuelta" },
  ]
  const p = C.planDeEstados([a, b, c], guardadas)
  assert.deepEqual(p.nuevas.map((d) => d.clave), [c.clave])
  assert.deepEqual(p.siguen.map((s) => s.id), ["1"])
  assert.deepEqual(p.reabiertas.map((s) => s.id), ["2"])
  assert.deepEqual(p.resueltas.sort(), ["3", "4"])
})

// ── Export de Zomatik ──
test("renglonCompra: sin precios, sin la fila de total; otro depósito sin planta", () => {
  const fila = { Fecha: "21/10/2026", "N Remito": "0002-00318913", "N Oc": "", Proveedor: "BLINKI S.A.", Codigo: "1000", Articulo: "ARENA FINA", Cantidad: 32.46, "P.Unit": 1000, Total: 32460 }
  const r = C.renglonCompra(fila, 116)
  assert.equal(r.fecha, "2026-10-21")
  assert.equal(r.remito_norm, "318913")
  assert.equal("P.Unit" in r.datos || "Total" in r.datos, false)
  assert.equal(C.renglonCompra({ Fecha: "", "N Remito": "", Articulo: "", Cantidad: 999, Total: 1 }, 116), null)
  const otra = { ...fila, "N Remito": "0002-00319999" }
  const filas = C.conClaves(C.filasCopia([{ deposito: 116, filas: [fila] }, { deposito: 113, filas: [] }], [fila, otra]))
  assert.equal(filas.length, 2)
  assert.equal(filas.find((f) => f.remito === "0002-00319999").deposito, null)
  const dos = C.conClaves(C.filasCopia([{ deposito: 116, filas: [fila, fila] }], null))
  assert.notEqual(dos[0].clave, dos[1].clave)
})

// ── Mail ──
test("armarMail: nuevas arriba, siguen abiertas con su número, link y sin negritas", () => {
  const m = armarMail({ nuevas: difs.slice(0, 3), siguen: difs.slice(3), link: "https://www.produccionrebucret.com/materias-primas?tab=control", hoy: casos.hoy })
  assert.match(m.asunto, /3 nuevas, 15 abiertas/)
  assert.ok(m.html.indexOf("Nuevas desde ayer (3)") < m.html.indexOf(`Siguen abiertas (${difs.length - 3})`))
  assert.match(m.html, /materias-primas\?tab=control/)
  assert.match(m.html, /DESCARGO LUNES 26\/10/)
  assert.equal(/<b>|font-weight:\s*(bold|[6-9]00)/.test(m.html), false)
})
