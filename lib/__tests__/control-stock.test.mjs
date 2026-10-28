// Pruebas del control de stock de MP (docs/control-stock-mp.md) con el ejemplo real de Canning, cemento, 20 al 27/10.
// Sin red ni base.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as S from "../control-stock/calculo.ts"
import { matrizDeTablaHtml } from "../zomatik/parseo.ts"

const fx = JSON.parse(readFileSync(new URL("../__fixtures__/control-stock/canning-cemento.json", import.meta.url), "utf8"))
const cerca = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ""} ${a} ≠ ${b}`)

test("leerReporteStock: movimientos, prefijos y el Total acumulado", () => {
  const r = S.leerReporteStock(fx.zomatik)
  assert.equal(r.encabezado, true)
  assert.equal(r.movs.length, 4)
  assert.deepEqual(r.movs.map((m) => m.prefijo), ["RMP", "RMI", "RMP", "RMI"])
  cerca(r.movs[3].movimiento, -33.810001)
  cerca(r.totalAcumulado, 68.727496)
  // Con el número en la celda de al lado y con números de Excel
  const x = S.leerReporteStock([["Fecha", "Comprobante", "Descripcion", "Movimiento", "Saldo"], [46315, "RMP 0002-1", "", 10, 20], ["Total acumulado:", 10]])
  assert.equal(x.movs[0].fecha, "2026-10-20")
  assert.equal(x.totalAcumulado, 10)
})

test("verificarLectura: el Total acumulado es el saldo ANTERIOR (68,727 = 102,847 − 34,12); el final es el último Saldo", () => {
  const r = S.leerReporteStock(fx.zomatik)
  const v = S.verificarLectura(r.movs, r.totalAcumulado)
  cerca(v.inicial, 68.727, "inicial")
  assert.equal(v.totalEsInicial, true)
  cerca(v.final, 112.54, "final")
  // El extracto no trae todos los renglones del período: no cierra (79,747 + 36,29 ≠ 103,482)
  assert.equal(v.cierra, false)
  const completo = [{ ...r.movs[0] }, { ...r.movs[1] }]
  assert.equal(S.verificarLectura(completo, r.totalAcumulado).cierra, true)
  assert.deepEqual(S.verificarLectura([], 50), { inicial: 50, final: 50, cierra: true, totalEsInicial: null })
})

test("resumenNuestro: 106,8 t de entradas y 122,2 t de consumo del 20 al 27/10, hacia atrás desde el stock actual", () => {
  const n = S.resumenNuestro(fx.nuestro.actualKg, fx.nuestro.movs, "2026-10-20", "2026-10-27")
  cerca(n.entro, 106.8, "entró")
  cerca(n.salio, 122.1875, "salió")
  cerca(n.final, 75.77, "final")
  cerca(n.inicio, 75.77 - 106.8 + 122.1875, "inicio")
  assert.equal(n.porDia.length, 8)
  cerca(n.porDia.find((d) => d.fecha === "2026-10-20").salio, 58.595)
  cerca(n.porDia[n.porDia.length - 1].saldo, n.final)
  // El saldo de un día es el del anterior más lo que pasó ese día
  for (let i = 1; i < n.porDia.length; i++) cerca(n.porDia[i].saldo, n.porDia[i - 1].saldo + n.porDia[i].entro - n.porDia[i].salio + n.porDia[i].ajustes)
})

test("resumenZomatik: entró, salió, final y por tipo de comprobante; sin datos antes de lo leído", () => {
  const r = S.leerReporteStock(fx.zomatik)
  const v = S.verificarLectura(r.movs, r.totalAcumulado)
  const z = S.resumenZomatik({ desde: "2026-10-20", saldoInicial: v.inicial }, r.movs, "2026-10-20", "2026-10-27")
  cerca(z.inicio, 68.727)
  cerca(z.entro, 70.41)
  cerca(z.salio, 56.910001)
  cerca(z.final, 112.54)
  assert.deepEqual(Object.keys(z.porPrefijo).sort(), ["RMI", "RMP"])
  cerca(z.porDia.find((d) => d.fecha === "2026-10-24").saldo, 103.482)
  assert.equal(S.resumenZomatik({ desde: "2026-10-20", saldoInicial: 0 }, r.movs, "2026-10-19", "2026-10-27"), null)
  const parte = S.resumenZomatik({ desde: "2026-10-20", saldoInicial: v.inicial }, r.movs, "2026-10-21", "2026-10-26")
  cerca(parte.inicio, 79.747)
  cerca(parte.final, 103.482)
})

test("comparar: el ejemplo real da −36,8 t de stock final y sale en rojo", () => {
  const r = S.leerReporteStock(fx.zomatik)
  const v = S.verificarLectura(r.movs, r.totalAcumulado)
  const n = S.resumenNuestro(fx.nuestro.actualKg, fx.nuestro.movs, "2026-10-20", "2026-10-27")
  const z = S.resumenZomatik({ desde: "2026-10-20", saldoInicial: v.inicial }, r.movs, "2026-10-20", "2026-10-27")
  const c = S.comparar(n, z)
  cerca(c.final.t, 75.77 - 112.54)
  assert.equal(c.final.rojo, true)
  assert.equal(c.rojo, true)
  assert.equal(S.diferencia(100, 104).rojo, false) // 4 %
  assert.equal(S.diferencia(100, 106).rojo, true) // más del 5 %
  assert.equal(S.diferencia(0.3, 0).rojo, false) // menos de media tonelada
  assert.equal(S.diferencia(0, 0).pct, 0)
  assert.equal(S.comparar(n, null), null)
})

test("verificarArticulo: con los RMP de la copia de remitos de compra", () => {
  const r = S.leerReporteStock(fx.zomatik)
  const propios = new Set(["2742081", "2742384"])
  const ajenos = new Set(["318903", "880839"])
  assert.equal(S.verificarArticulo(r.movs, propios, ajenos).estado, "verificado")
  const mezclado = [...r.movs, { ...r.movs[0], comprobante: "RMP 0002-00318903", prefijo: "RMP" }]
  assert.equal(S.verificarArticulo(mezclado, propios, ajenos).ok, false)
  assert.equal(S.verificarArticulo(r.movs.filter((m) => m.prefijo !== "RMP"), propios, ajenos).ok, false)
  assert.equal(S.verificarArticulo([], new Set(), ajenos).estado, "sin_verificar")
})

test("libro desde el último recuento y ajuste sin registro", () => {
  assert.equal(S.nuevoDeRecuento("Ajuste por recuento. Anterior: 24220 kg, Nuevo: 57320 kg"), 57320)
  assert.equal(S.nuevoDeRecuento("Ajuste por recuento. Anterior: 18561 kg, Nuevo: -74470 kg"), -74470)
  const movs = [
    { fecha: "2026-09-23", tipo: "entrada", kg: 30000, creadoAt: "2026-09-23T12:00:00Z" },
    { fecha: "2026-09-23", tipo: "consumo", kg: 10000, creadoAt: "2026-09-23T15:00:00Z" },
    { fecha: "2026-09-20", tipo: "consumo", kg: 999, creadoAt: "2026-09-21T15:00:00Z" }, // antes del recuento
  ]
  const l = S.libroDesdeRecuento(80000, { nuevoKg: 57320, creadoAt: "2026-09-22T18:00:00Z" }, movs)
  assert.equal(l.libroKg, 77320)
  assert.equal(l.sinRegistroKg, 2680)
  assert.equal(S.libroDesdeRecuento(1, null, movs), null)
})

test("materiales: nuestros nombres a los 5 del control", () => {
  assert.equal(S.materialDeNombre("Arena Fina"), "arena_fina")
  assert.equal(S.materialDeNombre("Arena Trituración 0/6"), "arena_0_6")
  assert.equal(S.materialDeNombre("Piedra Partida 6/12"), "piedra_6_12")
  assert.equal(S.materialDeNombre("Piedra Partida 6/20"), "piedra_6_20")
  assert.equal(S.materialDeNombre("CPC 40"), "cemento")
  assert.equal(S.materialDeNombre("Piedra Partida 10/30"), null)
  assert.equal(S.materialDeNombre("Sikament 90E"), null)
  assert.equal(S.inicioDeMes("2026-10-28"), "2026-10-01")
})

test("articuloDeListado y la página HTML con la fila de Total acumulado", () => {
  assert.deepEqual(S.articuloDeListado({ Codigo: "10000026", Nombre: "CCTS CEMENTO GRANEL", "Codigo Sistema": 1000012345 }), { codigo: "10000026", codigoSistema: "1000012345", nombre: "CCTS CEMENTO GRANEL" })
  assert.equal(S.articuloDeListado({ Codigo: "10000026", Nombre: "X" }).codigoSistema, null)
  const html = `<table><tr><td><table><tr><th>Fecha</th><th>Comprobante</th><th>Descripcion</th><th>Movimiento</th><th>Saldo</th></tr>
    <tr><td>20/10/2026</td><td>RMP 0002-02742081</td><td>FENOMIX</td><td>34.120000</td><td>102.847</td></tr>
    <tr><td colspan="5">Total acumulado: 68.727496</td></tr></table></td></tr></table>`
  const r = S.leerReporteStock(matrizDeTablaHtml(html))
  assert.equal(r.movs.length, 1)
  cerca(r.totalAcumulado, 68.727496)
})

test("seccionMailStock: stock final de los dos lados, rojas marcadas, link y sin negritas", () => {
  const h = S.seccionMailStock({
    filas: [
      { planta: "Canning", material: "CPC 40", nuestroFinal: 75.77, zomatikFinal: 112.54, dif: S.diferencia(75.77, 112.54) },
      { planta: "Hudson", material: "Arena Fina", nuestroFinal: 100, zomatikFinal: 101, dif: S.diferencia(100, 101) },
    ],
    desde: "2026-10-01",
    hasta: "2026-10-28",
    link: "https://www.produccionrebucret.com/materias-primas?tab=control-stock",
  })
  assert.match(h, /1 en rojo/)
  assert.match(h, /color:#b91c1c/)
  assert.match(h, /112,5 t/)
  assert.match(h, /tab=control-stock/)
  assert.equal(/<b>|font-weight:\s*(bold|[6-9]00)/.test(h), false)
})
