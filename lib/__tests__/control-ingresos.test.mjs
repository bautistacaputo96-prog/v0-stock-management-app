// Pruebas del control de ingresos de materia prima (docs/control-ingresos-mp.md): normalización de remitos, materiales,
// proveedores, el cruce con los casos reales de las planillas de Juan (lib/__fixtures__/control-ingresos/casos.json),
// el estado de las diferencias entre corridas, el export de Zomatik y el mail. Sin red ni base.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as C from "../control-ingresos/cruce.ts"
import * as M from "../control-ingresos/mail.ts"
const { armarMail } = M

const casos = JSON.parse(readFileSync(new URL("../__fixtures__/control-ingresos/casos.json", import.meta.url), "utf8"))
const difs = C.cruzar(casos.nuestros, casos.zomatik, { hoy: casos.hoy })
const conRef = (ref) => difs.filter((d) => [...d.nuestro, ...d.zomatik].some((l) => l.ref === ref))
const una = (ref) => {
  const ds = conRef(ref)
  assert.equal(ds.length, 1, `${ref}: ${ds.length} diferencias (${ds.map((d) => d.tipo).join(", ")})`)
  return ds[0]
}

// ── Normalizaciones ──
test("normalizarRemito: sin el prefijo RMP, sin punto de venta ni ceros a la izquierda", () => {
  assert.equal(C.normalizarRemito("RMP 0002-00318903"), "318903")
  assert.equal(C.normalizarRemito("RMP 0002-02742081"), "2742081")
  assert.equal(C.sinPrefijoRemito("RMP 0002-00880839"), "0002-00880839")
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

test("Artículos reales de REBUCRET (con CCTS) y por código", () => {
  assert.equal(C.materialZomatik("CCTS ARENA ESPECIAL", "10000004"), C.claveMaterial("Arena Fina"))
  assert.equal(C.materialZomatik("CCTS CEMENTO GRANEL", "10000026"), C.claveMaterial("CPC 40"))
  assert.equal(C.materialZomatik("PIEDRA 6-20", "10000005"), C.claveMaterial("Piedra Partida 6/20"))
  assert.equal(C.materialZomatik("CCTS ARENA ESPECIAL"), "arena_fina") // sin código, por el nombre
  assert.equal(C.materialZomatik("CCTS PIEDRA 6-12"), C.claveMaterial("Piedra Partida 6/12"))
  assert.equal(C.materialZomatik("CCTS ARENA TRITURACION 0-6"), C.claveMaterial("Arena Trituración 0/6"))
  assert.equal(C.materialZomatik("CCTS SIKAMENT 90 E"), C.claveMaterial("Sikament 90E"))
  assert.equal(C.materialZomatik("CCTS MALLA SIMA Q188", "10000099"), null)
  // Los 5 artículos de la primera corrida real (28/10)
  assert.equal(C.materialZomatik("CCTS PIEDRA 06", "10000001"), C.claveMaterial("Arena Trituración 0/6"))
  assert.equal(C.materialZomatik("CCTS PIEDRA 06"), C.claveMaterial("Arena Trituración 0/6"))
  assert.equal(C.materialZomatik("PIEDRA 6-12", "10000612"), C.claveMaterial("Piedra Partida 6/12"))
  assert.equal(C.materialZomatik("PIEDRA 6-20"), C.claveMaterial("Piedra Partida 6/20"))
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
  // Fenomix distribuye el cemento de Cementos Avellaneda: para el control son el mismo
  assert.equal(C.mismoProveedor("FENOMIX - MATERIALES SAN FERNANDO", "CEMENTOS AVELLANEDA"), true)
  assert.equal(C.mismoProveedor("BLINKI", "Guerrico"), false)
  assert.equal(C.mismoProveedor(null, "BLINKI"), null)
})

test("ventana: desde el 01/08/2026 y después los últimos 90 días", () => {
  assert.equal(C.desdeVentana("2026-10-27"), "2026-08-01")
  assert.equal(C.desdeVentana("2026-12-15"), "2026-09-16")
  assert.equal(C.fechaArgentina("2026-10-26T03:00:00.000Z"), "2026-10-26")
  assert.equal(C.fechaArgentina("2026-10-27T02:30:00.000Z"), "2026-10-26")
  assert.deepEqual(C.tramosLectura("2026-07-27", "2026-10-27"), [
    { desde: "2026-09-24", hasta: "2026-10-27" },
    { desde: "2026-08-21", hasta: "2026-09-23" },
    { desde: "2026-07-27", hasta: "2026-08-20" },
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
  // Lo del 26/10 todavía puede estar por cargarse en Zomatik (7 días): no se avisa
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

test("3. Cargado dos veces: en las dos plantas (nuestro) y dos veces en Zomatik", () => {
  const d = una("04e33ed2-8d36-40e7-967c-6d3bc890fa7f")
  assert.equal(d.tipo, "duplicado_nuestro")
  assert.equal(d.nuestro.length, 2)
  assert.equal(d.zomatik.length, 1)
  assert.match(d.detalle, /Canning y Hudson/)
  const z = una("z-318913-b")
  assert.equal(z.tipo, "duplicado_zomatik")
  assert.doesNotMatch(z.detalle, /transportista/)
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

test("Mismo número, material y toneladas con otro proveedor: no es diferencia (real: 0002-02742081, Cementos Avellaneda y Fenomix)", () => {
  assert.equal(conRef("e-2742081").length, 0)
  const n = [{ ...casos.nuestros.find((x) => x.id === "e-319040"), id: "p", proveedor: "BLINKI" }]
  const z = [{ ...casos.zomatik.find((x) => x.clave === "z-319040"), clave: "pz", proveedor: "Guerrico" }]
  assert.deepEqual(C.cruzar(n, z, { hoy: casos.hoy }), [])
})

test("Otra fecha: la fecha sola nunca es diferencia (Bautista 28/10)", () => {
  const n = [casos.nuestros.find((x) => x.id === "e-319040")]
  const z0 = casos.zomatik.find((x) => x.clave === "z-319040")
  assert.deepEqual(C.cruzar(n, [{ ...z0, fecha: "2026-10-02" }], { hoy: casos.hoy }), [])
  assert.deepEqual(C.cruzar(n, [{ ...z0, fecha: "2026-10-13" }], { hoy: casos.hoy }), [])
  assert.deepEqual(C.cruzar([{ ...n[0], fecha: "2026-10-14" }], [z0], { hoy: casos.hoy }), [])
  assert.deepEqual(C.cruzar(n, [{ ...z0, fecha: "2026-10-12" }], { hoy: casos.hoy }), [])
  // Número mal escrito con 8 días de diferencia también se empareja
  const m = C.cruzar(n, [{ ...z0, remito: "RMP 0002-00319004", fecha: "2026-10-15" }], { hoy: casos.hoy })
  assert.equal(m.length, 1)
  assert.equal(m[0].categoria, "numero_mal")
})

test("4. Real: Fenomix 0002-02743030 en el nuestro y RMP 0002-02730799 en Zomatik (mismo día y toneladas)", () => {
  const d = una("4bcd5fc0-175a-42d8-816a-b4f656823538")
  assert.equal(d.categoria, "numero_mal")
  assert.equal(d.tipo, "numero")
  assert.equal(d.zomatik[0].ref, "z-2730799")
})

test("Renglones reales de REBUCRET con CCTS: coinciden y no se rechazan", () => {
  assert.equal(conRef("e-318903").length, 0) // RMP 0002-00318903 · CCTS ARENA ESPECIAL
  assert.equal(conRef("z-sinmat").length, 0) // artículo sin material: no es diferencia
  assert.deepEqual(C.articulosSinMaterial(casos.zomatik).map((a) => a.articulo), ["CCTS MALLA SIMA Q188", "GASOIL GRADO 2"].sort((a, b) => a.localeCompare(b)))
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

test("Criterio 2: lo nuestro contra un Zomatik igual da 0 diferencias (kg y toneladas mezclados)", () => {
  const art = { "Arena Fina": "ARENA FINA", "Piedra Partida 6/20": "PIEDRA PARTIDA 6-20", "Piedra Partida 6/12": "PIEDRA PARTIDA 6-12", "CPC 40": "CEMENTO CPC40 GRANEL" }
  const espejo = casos.nuestros.map((n) => {
    const nro = C.normalizarRemito(n.remito)
    return { clave: `z-${n.id}`, fecha: n.fecha, plantaId: n.plantaId, planta: n.planta, articulo: art[n.material], cantidad: C.toneladas(n.cantidad).t, remito: `0002-${nro.padStart(8, "0")}`, proveedor: `${n.proveedor.trim().toUpperCase()} S.A.`, transportista: null }
  })
  assert.deepEqual(C.cruzar(casos.nuestros, espejo, { hoy: casos.hoy }), [])
})

test("Aditivos y fibra: por ahora fuera del control (Zomatik no los trae en 116 ni 113)", () => {
  const n = [{ id: "sika", fecha: "2026-08-28", plantaId: "CAN", planta: "Canning", material: "Sikament 33S", cantidad: 440, remito: "205543", proveedor: "SIKA ARGENTINA S.A.I.C", transportista: null, notas: null, cargadoPor: null }]
  const z = [{ clave: "zs", fecha: "2026-08-28", plantaId: "CAN", planta: "Canning", articulo: "SIKAMENT 33 S", cantidad: 400, remito: "0001-00205600", proveedor: "SIKA ARGENTINA", transportista: null }]
  assert.deepEqual(C.cruzar(n, [], { hoy: casos.hoy }), [])
  assert.deepEqual(C.cruzar([], z, { hoy: casos.hoy }), [])
  assert.deepEqual(C.cruzar(n, z, { hoy: casos.hoy }), [])
})

test("Gracia: \"falta en Zomatik\" recién a los 7 días; \"falta en nuestro sistema\" a los 2", () => {
  const n = [casos.nuestros.find((x) => x.id === "67a57e7e-a8aa-47f7-9c82-c3903f2bca67")] // 24/10
  assert.equal(C.cruzar(n, [], { hoy: "2026-10-30" }).length, 0)
  assert.equal(C.cruzar(n, [], { hoy: "2026-10-31" }).length, 1)
  const z = [casos.zomatik.find((x) => x.clave === "z-319500")] // 21/10
  assert.equal(C.cruzar([], z, { hoy: "2026-10-22" }).length, 0)
  assert.equal(C.cruzar([], z, { hoy: "2026-10-23" }).length, 1)
})

test("B1: sin Zomatik leído en esas fechas no se avisa nada", () => {
  const hasta14 = (f) => f <= "2026-10-14"
  const d = C.cruzar(casos.nuestros, casos.zomatik, { hoy: casos.hoy, cubierto: hasta14 })
  assert.ok(d.length > 0)
  // Nada que necesite días de Zomatik después del 14/10 (con los ±3 días)
  for (const x of d) for (const l of [...x.nuestro, ...x.zomatik]) assert.ok(C.sumarDias(l.fecha, C.TOL_FECHA_DIAS) <= "2026-10-14" || l.fecha > casos.hoy, x.clave)
  assert.equal(conRef("67a57e7e-a8aa-47f7-9c82-c3903f2bca67").length, 1) // con todo leído sí sale
  assert.equal(d.some((x) => x.nuestro.some((l) => l.ref === "67a57e7e-a8aa-47f7-9c82-c3903f2bca67")), false)
  assert.deepEqual(C.cruzar(casos.nuestros, casos.zomatik, { hoy: casos.hoy, cubierto: () => false }), [])
  // Un día sin leer en el medio también frena
  assert.equal(C.evaluable(["2026-09-10"], { hoy: casos.hoy, cubierto: (f) => f !== "2026-09-18" }), false)
  assert.equal(C.evaluable(["2026-09-10"], { hoy: casos.hoy, cubierto: (f) => f !== "2026-09-25" }), true)
  // Fuera de la ventana: no
  assert.equal(C.evaluable(["2026-07-20"], { hoy: casos.hoy }), false)
})

test("ordenTramos: primero lo nunca leído, después lo leído hace más tiempo", () => {
  const t = C.tramosLectura("2026-07-27", "2026-10-27")
  const leidos = new Map()
  for (let d = "2026-07-27"; d <= "2026-10-26"; d = C.sumarDias(d, 1)) leidos.set(d, d < "2026-08-21" ? "2026-10-25T19:00:00Z" : "2026-10-26T19:00:00Z")
  const o = C.ordenTramos(t, leidos)
  assert.deepEqual(o.map((x) => x.desde), ["2026-09-24", "2026-07-27", "2026-08-21"]) // el de hoy no se leyó nunca
})

test("Real: remito partido en dos renglones en Zomatik (0002 y 0022) que suman lo nuestro: una sola diferencia", () => {
  const n = [{ id: "c", fecha: "2026-09-03", plantaId: "CAN", planta: "Canning", material: "CPC 40", cantidad: 36120, remito: "2731284", proveedor: "CEMENTOS AVELLANEDA", transportista: null, notas: null, cargadoPor: null }]
  const z = [
    { clave: "a", fecha: "2026-09-03", plantaId: "CAN", planta: "Canning", articulo: "CCTS CEMENTO GRANEL", codigo: "10000026", cantidad: 31.19, remito: "RMP 0002-02731284", proveedor: "FENOMIX - MATERIALES SAN FERNANDO", transportista: null },
    { clave: "b", fecha: "2026-09-03", plantaId: "CAN", planta: "Canning", articulo: "CCTS CEMENTO GRANEL", codigo: "10000026", cantidad: 4.93, remito: "RMP 0022-02731284", proveedor: "FENOMIX - MATERIALES SAN FERNANDO", transportista: null },
  ]
  const d = C.cruzar(n, z, { hoy: casos.hoy })
  assert.equal(d.length, 1)
  assert.equal(d[0].tipo, "duplicado_zomatik")
  assert.match(d[0].detalle, /2 renglones que suman 36,12 t, igual que el nuestro/)
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
  assert.deepEqual(p.reabiertas.map((s) => ({ id: s.id, revisada: s.revisada })), [{ id: "2", revisada: false }])
  assert.deepEqual(p.resueltas.sort(), ["3", "4"])
})

test("I1 e I2: lo que salió de la ventana no se resuelve; una revisada que vuelve, vuelve revisada", () => {
  const [a] = difs
  const guardadas = [
    { id: "vieja", clave: "x", estado: "abierta", fecha: "2026-07-20", nuestro: [{ fecha: "2026-07-20" }], zomatik: [] },
    { id: "sin-leer", clave: "y", estado: "abierta", fecha: "2026-10-20", nuestro: [{ fecha: "2026-10-20" }], zomatik: [] },
    { id: "rev", clave: a.clave, estado: "resuelta", revisada_at: "2026-10-01T12:00:00Z" },
  ]
  const oc = { hoy: casos.hoy, desde: "2026-08-01", cubierto: (f) => f <= "2026-10-14" }
  const p = C.planDeEstados([a], guardadas, (g) => C.evaluable(C.fechasDe(g), oc))
  assert.deepEqual(p.resueltas, [])
  assert.deepEqual(p.reabiertas.map((r) => ({ id: r.id, revisada: r.revisada })), [{ id: "rev", revisada: true }])
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

// Renglones reales de ESTAD R.COMPRA (REBUCRET, Canning, 20 y 23/10/2026), con sus columnas
const real = [
  { Fecha: "20/10/2026", "Nº Remito": "RMP 0002-00318903", "Nº OC": "OC 0001-00002983", Proveedor: "BLINKI S A", "Código": "10000004", "Artículo": "CCTS ARENA ESPECIAL", Cantidad: 40.14, "P.Unit": 1, Total: 40, "Depósito": "Canning", Transporte: "Proveedor con flete incluido", Chofer: "", "Valor Flete": 0 },
  { Fecha: "20/10/2026", "Nº Remito": "RMP 0002-02742081", "Nº OC": "OC 0001-00002981", Proveedor: "FENOMIX - MATERIALES SAN FERNANDO", "Código": "10000026", "Artículo": "CCTS CEMENTO GRANEL", Cantidad: 34.12, "P.Unit": 1, Total: 34, "Depósito": "Canning", Transporte: "Proveedor con flete incluido", Chofer: "", "Valor Flete": 0 },
  { Fecha: "20/10/2026", "Nº Remito": "RMP 0002-00880839", "Nº OC": "OC 0001-00002980", Proveedor: "Guerrico", "Código": "10000005", "Artículo": "PIEDRA 6-20", Cantidad: 30.42, "P.Unit": 1, Total: 30, "Depósito": "Canning", Transporte: "Transporte Mengarelli sh", Chofer: "", "Valor Flete": 828945 },
  { Fecha: "23/10/2026", "Nº Remito": "RMP 0002-02730799", "Nº OC": "OC 0001-00002993", Proveedor: "FENOMIX - MATERIALES SAN FERNANDO", "Código": "10000026", "Artículo": "CCTS CEMENTO GRANEL", Cantidad: 36.39, "P.Unit": 1, Total: 36, "Depósito": "Canning" },
]

test("renglonCompra con las columnas reales: RMP, Nº OC, Transporte, Depósito; sin P.Unit, Total ni Valor Flete", () => {
  const r = C.renglonCompra(real[2], 116)
  assert.equal(r.remito_norm, "880839")
  assert.equal(r.orden_compra, "OC 0001-00002980")
  assert.equal(r.codigo_articulo, "10000005")
  assert.equal(r.transportista, "Transporte Mengarelli sh")
  assert.equal(r.deposito_texto, "Canning")
  for (const k of ["P.Unit", "Total", "Valor Flete"]) assert.equal(k in r.datos, false, k)
  assert.equal(C.renglonCompra(real[3], 116).transportista, null)
})

test("motivoRechazoTramo: CCTS no es de Concretus; solo rechaza si Canning y Hudson vienen vacíos y 'todos' trae de esos depósitos", () => {
  assert.equal(C.motivoRechazoTramo([{ deposito: 116, filas: real }, { deposito: 113, filas: [] }], real), null)
  assert.match(C.motivoRechazoTramo([{ deposito: 116, filas: [] }, { deposito: 113, filas: [] }], real), /vinieron vacíos/)
  const pilar = real.map((f) => ({ ...f, "Depósito": "PILAR" }))
  assert.equal(C.motivoRechazoTramo([{ deposito: 116, filas: [] }, { deposito: 113, filas: [] }], pilar), null)
  const sinColumna = real.map(({ "Depósito": _d, ...f }) => f)
  assert.equal(C.motivoRechazoTramo([{ deposito: 116, filas: [] }, { deposito: 113, filas: [] }], sinColumna), null)
})

test("muestraLectura: columnas, depósitos, artículos con su material, series de OC y decimales (sin precios)", () => {
  const m = C.muestraLectura([{ deposito: 116, filas: real }, { deposito: 113, filas: [] }], [])
  assert.deepEqual(m.renglones, { 116: 4, 113: 0, todos: 0 })
  assert.equal(m.columnas.includes("P.Unit") || m.columnas.includes("Valor Flete"), false)
  assert.deepEqual(m.depositos, { Canning: 4 })
  assert.equal(m.articulos["10000026 CCTS CEMENTO GRANEL → cemento"], 2)
  assert.deepEqual(m.series_oc, { "OC 0001-…": 4 })
  assert.equal(m.con_decimales, 4)
})

// ── Mail ──
const LINK = "https://www.produccionrebucret.com/materias-primas?tab=control"
const sinNegritas = (h) => /<b>|font-weight:\s*(bold|[6-9]00)/.test(h) === false

test("Mail diario: solo las detectadas hoy, sin stock ni 'siguen abiertas'", () => {
  const m = armarMail({ tipo: "diario", nuevas: difs.slice(0, 3), abiertas: difs, link: LINK, hoy: casos.hoy, stockHtml: "<p>STOCK</p>" })
  assert.equal(m.asunto, "Rebucret · Control de ingresos MP: 3 inconsistencias nuevas hoy")
  assert.match(m.html, /Detectadas hoy \(3\)/)
  assert.equal(/Siguen abiertas|Todas las inconsistencias|STOCK/.test(m.html), false)
  assert.match(m.html, /materias-primas\?tab=control/)
  assert.ok(sinNegritas(m.html))
  assert.equal(armarMail({ tipo: "diario", nuevas: difs.slice(0, 1), link: LINK, hoy: casos.hoy }).asunto, "Rebucret · Control de ingresos MP: 1 inconsistencia nueva hoy")
})

test("Mail diario vacío: sale igual, con una línea y el link", () => {
  const m = armarMail({ tipo: "diario", nuevas: [], abiertas: difs, link: LINK, hoy: casos.hoy })
  assert.equal(m.asunto, "Rebucret · Control de ingresos MP: sin inconsistencias hoy")
  assert.match(m.html, /Hoy no hay inconsistencias nuevas entre el sistema y Zomatik/)
  assert.match(m.html, /tab=control/)
  assert.equal(/DESCARGO/.test(m.html), false) // las abiertas de antes no van
})

test("Mail diario: si no se pudo leer Zomatik, lo dice en una línea", () => {
  const m = armarMail({ tipo: "diario", nuevas: [], link: LINK, hoy: casos.hoy, falloLectura: true })
  assert.match(m.html, /No se pudo leer Zomatik hoy: no se controló/)
  assert.match(m.asunto, /no se pudo leer Zomatik hoy/)
  const conNuevas = armarMail({ tipo: "diario", nuevas: difs.slice(0, 2), link: LINK, hoy: casos.hoy, falloLectura: true })
  assert.match(conNuevas.html, /No se pudo leer Zomatik hoy/)
})

test("Mail semanal (lunes): nuevas del día, todas las abiertas y la tabla de stock, en un solo mail", () => {
  assert.equal(M.esDiaSemanal("2026-11-02"), true) // lunes
  assert.equal(M.esDiaSemanal("2026-10-28"), false) // miércoles
  const m = armarMail({ tipo: "semanal", nuevas: difs.slice(0, 2), abiertas: difs, link: LINK, hoy: "2026-11-02", stockHtml: "<p>TABLA DE STOCK</p>" })
  assert.equal(m.asunto, "Rebucret · Control semanal de MP (remitos y stock)")
  assert.ok(m.html.indexOf("Nuevas del día (2)") < m.html.indexOf(`Todas las inconsistencias de remitos abiertas (${difs.length})`))
  assert.ok(m.html.indexOf("Todas las inconsistencias") < m.html.indexOf("TABLA DE STOCK"))
  assert.match(m.html, /DESCARGO LUNES 26\/10/)
  assert.ok(sinNegritas(m.html))
  const vacio = armarMail({ tipo: "semanal", nuevas: [], abiertas: [], link: LINK, hoy: "2026-11-02", stockHtml: "<p>TABLA DE STOCK</p>" })
  assert.match(vacio.html, /Hoy no hay inconsistencias nuevas/)
  assert.match(vacio.html, /TABLA DE STOCK/)
})
