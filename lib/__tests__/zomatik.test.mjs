// Pruebas de Zomatik Z0 (docs/migracion-loop/zomatik.md): parseo de listados y fichas, vínculo por nombre,
// CUIT, fórmulas y obras, saldo de los acopios en m³ y la lista cerrada de rutas. Sin red ni base: HTML y filas
// armadas a mano (no se usan datos reales de clientes).
import { test } from "node:test"
import assert from "node:assert/strict"
import * as P from "../zomatik/parseo.ts"
import * as V from "../zomatik/vinculos.ts"
import * as A from "../zomatik/acopios.ts"
import * as F from "../zomatik/foto.ts"

// ── Números, fechas y nombres ──
test("parseNumero: formatos de Zomatik", () => {
  assert.equal(P.parseNumero("$ 72.176.801,00"), 72176801)
  assert.equal(P.parseNumero("$ 7,986,362.92"), 7986362.92)
  assert.equal(P.parseNumero("$ 0,00"), 0)
  assert.equal(P.parseNumero("1.234.567"), 1234567)
  assert.equal(P.parseNumero(12.5), 12.5)
  assert.equal(P.parseNumero(""), null)
})

test("parseFecha: dd/mm/aaaa, ISO y serie de Excel", () => {
  assert.equal(P.parseFecha("3/7/2026"), "2026-07-03")
  assert.equal(P.parseFecha("2026-10-19"), "2026-10-19")
  assert.equal(P.parseFecha(46000), "2025-12-09")
  assert.equal(P.parseFecha("—"), null)
})

test("nombreNormalizado: sin tildes, S.A., ARQ, ING, FIDEICOMISO y en cualquier orden", () => {
  assert.equal(P.nombreNormalizado("Fideicomiso La Tercera"), P.nombreNormalizado("FIDEICOMISO LA TERCERA S.A."))
  assert.equal(P.nombreNormalizado("García, Juan"), P.nombreNormalizado("JUAN GARCIA"))
  assert.equal(P.nombreNormalizado("Ing. Ramón Allan"), P.nombreNormalizado("RAMON ING ALLAN "))
  assert.equal(P.nombreNormalizado("Construcciones S.R.L."), "CONSTRUCCIONES")
  assert.notEqual(P.nombreNormalizado("LA TERCERA CAMINO REAL"), P.nombreNormalizado("LA TERCERA"))
})

test("parecidoNombres: tokens en común sobre el menor", () => {
  assert.equal(P.parecidoNombres("Educación Popular", "ASOCIACION CIVIL EDUCACION POPULAR"), 1)
  assert.equal(P.parecidoNombres("Barrio Parque Laura", "BARRIO PARQUE GISELLA"), 2 / 3)
  assert.equal(P.parecidoNombres("", "X"), 0)
})

test("cuitValido: dígito verificador", () => {
  assert.equal(P.cuitValido("20-12345678-6"), true)
  assert.equal(P.cuitValido("30-71234567-1"), true)
  assert.equal(P.cuitValido("20-12345678-5"), false)
  assert.equal(P.cuitValido("2201"), false)
  assert.equal(P.cuitValido("11111111111"), false)
})

test("condición de IVA y de pago de Zomatik → las nuestras", () => {
  assert.equal(P.condIvaDeZomatik("Responsable Inscripto"), "Responsable Inscripto")
  assert.equal(P.condIvaDeZomatik("Monotributo"), "Monotributista")
  assert.equal(P.condIvaDeZomatik("Consumidor Final"), "Consumidor Final")
  assert.equal(P.condIvaDeZomatik(""), null)
  assert.equal(P.condPagoDeZomatik("Cuenta Corriente"), "Cuenta Corriente")
  assert.equal(P.condPagoDeZomatik(""), null)
})

// ── Ficha del cliente ──
const FICHA = `<html><body><form name="frm_clientes" action="grabar_clientes.php?codigo=123" method="post">
<input type="text" name="cuit" value="20-12345678-6">
<select name="tipo_documento"><option value="1" selected>CUIT</option><option value="3">DNI</option></select>
<select name="tipo_iva"><option value="">--IVA--</option><option value="3" selected="selected">Responsable Inscripto</option></select>
<input type="text" name="razon_social" value="PRUEBA &amp; HIJOS S.A.">
<input type="text" name="direccion" value="Calle 1">
<select name="provincia"><option value="1" selected>Buenos Aires</option></select>
<select name="condicion_pago"><option value="0" selected>--Condicion--</option><option value="2">Contado</option></select>
<select name="vendedor"><option value="100" selected>MALDONADO FERNANDO</option></select>
<!-- <input name="razon_social" value="COMENTADO"> -->
<textarea name="comentarios">nota</textarea>
<input type="submit" name="aceptar" value="Grabar">
</form></body></html>`

test("parseFichaCliente: inputs, select elegido, entidades y sin comentarios", () => {
  const f = P.parseFichaCliente(FICHA)
  assert.equal(f.razon_social, "PRUEBA & HIJOS S.A.")
  assert.equal(f.cuit, "20-12345678-6")
  assert.equal(f.tipo_documento, "CUIT")
  assert.equal(f.tipo_iva, "Responsable Inscripto")
  assert.equal(f.provincia, "Buenos Aires")
  assert.equal(f.condicion_pago, "") // "--Condicion--" con valor 0 = vacío
  assert.equal(f.vendedor, "MALDONADO FERNANDO")
  assert.equal(P.parseFichaCliente("<form name='login'><input name='usuario'></form>"), null)
})

// ── Listados ──
test("clientesDeListado: código, razón social y sin repetidos", () => {
  const filas = [
    { "Razon Social": "Pérez Juan ", Codigo: 10, Vendedor: "FERNANDO MALDONADO", "Ultimp Ped": "2026-10-01", Estado: "Activo" },
    { "Razon Social": "Pérez Juan ", Codigo: 10 },
    { "Razon Social": " ", Apellido: "Gómez", Nombre: "Ana", Codigo: 11 },
    { "Razon Social": "Sin código", Codigo: "" },
  ]
  const c = P.clientesDeListado(filas)
  assert.equal(c.length, 2)
  assert.equal(c[0].razon_social, "Pérez Juan")
  assert.equal(c[0].nombre_norm, "JUAN PEREZ")
  assert.equal(c[0].ultimo_pedido, "2026-10-01")
  assert.equal(c[1].razon_social, "Gómez Ana")
})

test("renglones de remito: R/X, proyecto, m³ y resumen por cliente", () => {
  const filas = [
    { Fecha: "20/10/2026", "N Remito": "RM2 0099-00002744", "N Pedido": "NP2 0001-00002079", Cliente: "PRUEBA SA", Codigo: 10000500, Articulo: "H30-620-10 C (CAN)", Cantidad: 32, Comprobante: "RM2", Deposito: "Canning", Proyecto: "PRO2 0001-00000014" },
    { Fecha: "20/10/2026", "N Remito": "RM2 0099-00002744", "N Pedido": "NP2 0001-00002079", Cliente: "PRUEBA SA", Codigo: 10099001, Articulo: "BOMBA PLUMA", Cantidad: 32, Comprobante: "RM2", Deposito: "Canning", Proyecto: "PRO2 0001-00000014" },
    { Fecha: "18/10/2026", "N Remito": "RM 0001-00002300", "N Pedido": "NP 0001-00001100", Cliente: "Prueba S.A.", Codigo: 10000500, Articulo: "H30-620-10 C (CAN)", Cantidad: "8,5", Comprobante: "RM", Deposito: "REBUCRET", Proyecto: "" },
    { Fecha: "", "N Remito": "", Cliente: "Totales" },
  ]
  const r = P.renglonesRemitos(filas)
  assert.equal(r.length, 3)
  assert.equal(r[0].comprobante, "X")
  assert.equal(r[2].comprobante, "R")
  assert.equal(r[2].m3, 8.5)
  const res = P.resumenRemitosPorCliente(r).get(P.nombreNormalizado("PRUEBA SA"))
  assert.deepEqual(res, { r: 1, x: 1, ultimo: "2026-10-20" })
  assert.equal(P.remitoSugerido(res.r, res.x), null)
  assert.equal(P.remitoSugerido(0, 5), "X")
  assert.equal(P.remitoSugerido(3, 0), "R")
  const lineas = new Map([[10099001, "Servicios"], [10000500, "Hormigon"]])
  const movs = P.movimientosDeProyectos(r, new Set(["PRO2 0001-00000014"]), (c) => lineas.get(c))
  assert.equal(movs.length, 2)
  assert.equal(movs.find((m) => m.articulo === "BOMBA PLUMA").es_hormigon, false)
  assert.equal(movs.find((m) => m.articulo.startsWith("H30")).es_hormigon, true)
})

const PROYECTOS = `<table><tr><td>menu</td></tr></table><table>
<tr><td class="titulo">Codigo</td><td></td><td>Cliente</td><td></td><td>Fecha</td><td></td><td>Entrega Aprobada</td><td></td><td>Monto S/IVA</td><td></td><td style="display:none">Material + Flete C/IVA</td><td></td><td>Certif</td><td></td><td>Restan Material S/IVA</td><td></td><td>Restan Certif</td><td></td><td>Certificados</td><td></td><td>Pend FC S/IVA</td><td></td><!-- <td>A Fact Mat C/IVA</td><td></td> --><td>Rep</td><td></td><td>ACCIONES</td><td></td><td></td><td></td><td></td></tr>
<tr><td><a href="modificar_proyectos.php?codigo=576">PRO 0001-00000030</a></td><td></td><td><a href="modificar_proyectos.php?codigo=576">EMPRESA DE PRUEBA (22812)<br>PAVIMENTO LT 1</a></td><td></td><td>03/07/2026</td><td></td><td>Si</td><td></td><td>$ 583.414.000,00</td><td></td><td style="display: none">$ 359.024.000,00</td><td></td><td>$ 224.390.000,00</td><td></td><td>$ 163.516.781,56</td><td></td><td>$ 1,00</td><td></td><td>0 / 1</td><td></td><td>$ 1,00</td><td></td><!-- <td><a href="modificar_facturasventa.php?proyecto=576">$ 7,986,362.92</a></td><td></td> --><td><a href="reporte_detalleproyecto.php?proyecto=576">VER</a></td><td></td><td><a href="modificar_pedidos.php?proyecto=576&tipo=1">MATERIAL</a></td><td></td><td> Abierto </td><td></td><td></td></tr>
<tr><td><a href="modificar_proyectos.php?codigo=577">PRO2 0001-00000009</a></td><td></td><td><a href="modificar_proyectos.php?codigo=577">OTRA EMPRESA (100)</a></td><td></td><td>26/05/2026</td><td></td><td>Si</td><td></td><td>$ 10,00</td><td></td><td>$ 100,00</td><td></td><td>$ 0,00</td><td></td><td>$ 0,00</td><td></td><td>$ 0,00</td><td></td><td></td><td></td><td></td><td></td><td>VER</td><td></td><td>MATERIAL</td><td></td><td>Abierto</td><td></td><td></td></tr>
<tr><td>Totales:</td><td></td><td>$ 1</td><td></td><td>$ 2</td></tr>
</table>`

test("parseProyectosHtml: código interno, cliente, obra, saldo en % (sin pesos) y estado", () => {
  const ps = P.parseProyectosHtml(PROYECTOS)
  assert.equal(ps.length, 2)
  const p = ps[0]
  assert.equal(p.codigo, 576)
  assert.equal(p.numero, "PRO 0001-00000030")
  assert.equal(p.comprobante, "PRO")
  assert.equal(p.cliente_codigo, 22812)
  assert.equal(p.cliente_nombre, "EMPRESA DE PRUEBA")
  assert.equal(p.obra, "PAVIMENTO LT 1")
  assert.equal(p.fecha, "2026-07-03")
  assert.equal(p.saldo_pct, 45.5) // 163.516.781,56 ÷ 359.024.000
  assert.equal(p.estado_zomatik, "Abierto")
  assert.equal(ps[1].obra, null)
  assert.equal(ps[1].saldo_pct, 0)
  assert.ok(!Object.keys(p).some((k) => /monto|importe|precio/i.test(k)), "no guarda montos")
})

test("pactadoDeAcopio: vacío = por monto; con artículos = m³ de hormigón", () => {
  assert.deepEqual(P.pactadoDeAcopio([]), { tipo: "monto", m3: null })
  assert.deepEqual(P.pactadoDeAcopio([{ Articulo: "H30-620-10 C (CAN)", Cantidad: 300 }, { Articulo: "m3 BOMBEADOS", Cantidad: 300 }]), { tipo: "cantidades", m3: 300 })
})

test("npPendientesDeListado: solo NP y NP2, sin el total en pesos", () => {
  const n = P.npPendientesDeListado([
    { Codigo: "NP2 0001-00002079", Cliente: "X", Total: 2590000, Fecha: "2026-10-19", "F.Entrega": "2026-10-20", Estado: "PEND", Deposito: "Canning", Origen: "Lista" },
    { Codigo: "DP2 0001-00000005", Cliente: "X", Estado: "PEND" },
    { Codigo: "Total", Cliente: "" },
  ])
  assert.equal(n.length, 1)
  assert.equal(n[0].fecha_entrega, "2026-10-20")
  assert.ok(!("Total" in n[0]) && !("total" in n[0]))
})

// ── Vínculos ──
test("clientes: CUIT válido igual o nombre igual = seguro; parecido = dudoso; único de los dos lados", () => {
  const nuestros = [
    { id: "a", name: "Fideicomiso Las Lomas", cuit: "2201" }, // CUIT de relleno: no cuenta
    { id: "b", name: "OBRA DE PRUEBA", cuit: "20-12345678-6" },
    { id: "c", name: "Educación Popular" },
    { id: "d", name: "Merva" },
    { id: "e", name: "MERVA S.A." },
    { id: "f", name: "Nadie Igual" },
  ]
  const z = [
    { codigo: 1, razon_social: "FIDEICOMISO LAS LOMAS", cuit: "2201" },
    { codigo: 2, razon_social: "OTRO NOMBRE", cuit: "20123456786" },
    { codigo: 3, razon_social: "ASOCIACION CIVIL EDUCACION POPULAR" },
    { codigo: 4, razon_social: "MERVA" },
  ]
  const p = V.proponerClientes(nuestros, z)
  assert.equal(p.get("a").certeza, "seguro")
  assert.equal(p.get("a").candidato.codigo, 1)
  assert.equal(p.get("b").certeza, "seguro")
  assert.equal(p.get("b").motivo, "CUIT igual")
  assert.equal(p.get("c").certeza, "dudoso")
  assert.equal(p.get("d").certeza, "dudoso") // dos nuestros con el mismo nombre
  assert.equal(p.get("e").certeza, "dudoso")
  assert.equal(p.has("f"), false)
})

test("clientes: dos en Zomatik con el mismo nombre → dudoso con el más usado", () => {
  const p = V.proponerClientes([{ id: "a", name: "Juan Pérez" }], [
    { codigo: 1, razon_social: "PEREZ JUAN", remitos_12m: 1 },
    { codigo: 2, razon_social: "JUAN PEREZ", remitos_12m: 9 },
  ])
  assert.equal(p.get("a").certeza, "dudoso")
  assert.equal(p.get("a").candidato.codigo, 2)
})

test("yaEstaEnRebucret y buscarEnZomatik: nunca duplica", () => {
  const nuestros = [{ id: "x", name: "Constructora Sur", zomatik_codigo: null }, { id: "y", name: "Otro", zomatik_codigo: 7 }]
  assert.equal(V.yaEstaEnRebucret({ codigo: 9, razon_social: "CONSTRUCTORA SUR S.R.L." }, nuestros)?.id, "x")
  assert.equal(V.yaEstaEnRebucret({ codigo: 7, razon_social: "Cualquiera" }, nuestros)?.id, "y")
  assert.equal(V.yaEstaEnRebucret({ codigo: 8, razon_social: "Nuevo Cliente" }, nuestros), null)
  const z = [{ codigo: 1, razon_social: "CONSTRUCTORA DEL SUR", cuit: "30712345671" }, { codigo: 2, razon_social: "SUR VIAL" }]
  assert.deepEqual(V.buscarEnZomatik("constr sur", z).map((x) => x.codigo), [1])
  assert.deepEqual(V.buscarEnZomatik("71234567", z).map((x) => x.codigo), [1])
  assert.deepEqual(V.buscarEnZomatik("su", z), [])
})

test("fórmulas: nombre igual, reglas de la spec y dudosas", () => {
  const arts = [
    { codigo: 1, nombre: "H21-620-15 B (HUD)", linea: "Hormigon" },
    { codigo: 2, nombre: "H30-620-10 C (CAN)", linea: "Hormigon" },
    { codigo: 3, nombre: "H25-612-15 B (CAN)", linea: "Hormigon" },
    { codigo: 4, nombre: "H25-GUNITADO 10 (CAN)", linea: "Hormigon" },
    { codigo: 5, nombre: "H21-620-15 B (HUD) PELQUE", linea: "Hormigon" },
    { codigo: 6, nombre: "H17-620-15 B (CAN)", linea: "Hormigon" },
    { codigo: 7, nombre: "BOMBA PLUMA", linea: "Servicios" },
  ]
  const fs = [
    { id: "a", name: "H30-620-10 C (CAN)", planta: "Canning" },
    { id: "b", name: "H21-620-15 B", planta: "Hudson" },
    { id: "c", name: "H25-6/12-15 B", planta: "Canning" },
    { id: "d", name: "H25-GUN 10", planta: "Canning" },
    { id: "e", name: "H21-620-15 B PELQUE", planta: "Hudson" },
    { id: "f", name: "H17-6/20 B", planta: "Canning" },
    { id: "g", name: "Cordones", planta: "Canning" },
  ]
  const p = V.proponerFormulas(fs, arts)
  assert.equal(p.get("a").candidato.codigo, 2)
  assert.equal(p.get("a").motivo, "Nombre igual")
  assert.equal(p.get("b").candidato.codigo, 1)
  assert.equal(p.get("b").certeza, "seguro")
  assert.equal(p.get("c").candidato.codigo, 3)
  assert.equal(p.get("d").candidato.codigo, 4)
  assert.equal(p.get("e").candidato.codigo, 5)
  assert.equal(p.get("f").certeza, "dudoso")
  assert.equal(p.get("f").candidato.codigo, 6)
  assert.equal(p.has("g"), false)
})

test("proyectos ↔ obras: solo entre las obras del cliente vinculado", () => {
  const obras = [
    { id: "o1", name: "PAVIMENTO", client_id: "c1" },
    { id: "o2", name: "Cordones", client_id: "c1" },
    { id: "o3", name: "Única", client_id: "c2" },
  ]
  const clientes = new Map([[10, "c1"], [20, "c2"]])
  const p = V.proponerProyectos(
    [
      { codigo: 1, numero: "PRO 1", cliente_codigo: 10, obra: "Cordones" },
      { codigo: 2, numero: "PRO 2", cliente_codigo: 10, obra: "PAVIMENTO LT 1" },
      { codigo: 3, numero: "PRO 3", cliente_codigo: 20, obra: null },
      { codigo: 4, numero: "PRO 4", cliente_codigo: 99, obra: "Cordones" },
    ],
    obras,
    clientes,
  )
  assert.equal(p.get(1).certeza, "seguro")
  assert.equal(p.get(1).candidato.id, "o2")
  assert.equal(p.get(2).certeza, "dudoso")
  assert.equal(p.get(2).candidato.id, "o1")
  assert.equal(p.get(3).certeza, "dudoso")
  assert.equal(p.has(4), false) // cliente sin vincular
})

// ── Acopios (solo m³) ──
test("saldo por monto: ≈ m³ = remitido × saldo % ÷ consumido %", () => {
  const s = A.saldoAcopio({ saldo_pct: 2.6, remitido_m3: 682 })
  assert.equal(s.estimado, true)
  assert.equal(s.consumidoPct, 97.4)
  assert.equal(s.saldoM3, 18.2)
  assert.equal(A.saldoAcopio({ saldo_pct: 100, remitido_m3: 0 }).saldoM3, null) // sin entregas no se puede estimar
  assert.equal(A.saldoAcopio({ saldo_pct: -1, remitido_m3: 404 }).saldoM3, 0)
})

test("saldo por cantidades: exacto", () => {
  const s = A.saldoAcopio({ tipo: "cantidades", pactado_m3: 300, saldo_pct: null, remitido_m3: 180 })
  assert.equal(s.estimado, false)
  assert.equal(s.saldoM3, 120)
  assert.equal(s.saldoPct, 40)
})

test("avisos: bajo con 7 días o 15 %, agotado con saldo 0", () => {
  assert.equal(A.estadoAcopio({ saldo_pct: 2.6, remitido_m3: 682 }, 0), "bajo") // menos del 15 %
  assert.equal(A.estadoAcopio({ saldo_pct: 40, remitido_m3: 180 }, 0), "abierto") // ≈ 120 m³
  assert.equal(A.estadoAcopio({ saldo_pct: 40, remitido_m3: 180 }, 130), "bajo") // no alcanza para lo de 7 días
  assert.equal(A.estadoAcopio({ saldo_pct: 0, remitido_m3: 400 }, 0), "agotado")
  assert.equal(A.estadoAcopio({ saldo_pct: 50, remitido_m3: 1, estado: "cerrado" }, 0), "cerrado")
  assert.equal(A.estadoAcopio({ saldo_pct: null, remitido_m3: 0 }, 0), "abierto")
})

test("programado: total a futuro y próximos 7 días; detalle por día con acumulado", () => {
  const p = A.programadoDesde([{ fecha: "2026-10-20", m3: 10 }, { fecha: "2026-10-21", m3: 24 }, { fecha: "2026-10-27", m3: 8 }, { fecha: "2026-10-28", m3: 30 }], "2026-10-21")
  assert.deepEqual(p, { total: 62, proximos: 32 })
  const d = A.detallePorDia([
    { fecha: "2026-10-10", remito: "R1", articulo: "H30", m3: 47 },
    { fecha: "2026-10-14", remito: "R2", articulo: "H30", m3: 36.5 },
    { fecha: "2026-10-14", remito: "R2", articulo: "BOMBA", m3: 36.5, es_hormigon: false },
  ])
  assert.equal(d.length, 2)
  assert.equal(d[0].remito, "R2")
  assert.equal(d[0].acumulado, 83.5)
})

// ── Foto: lo que falta leer de a poco ──
test("tramos de historia y pendientes de ficha y tipo", () => {
  const abiertos = [{ codigo: 1, fecha: "2023-05-01" }, { codigo: 2, fecha: "2026-09-01" }]
  const t = F.tramosHistoria([], abiertos, "2025-10-21")
  assert.equal(t[0].hasta, "2025-10-20")
  assert.equal(t[t.length - 1].desde, "2023-05-01")
  assert.ok(t.every((x) => x.desde <= x.hasta))
  assert.deepEqual(F.tramosHistoria([{ codigo: 1, numero: "", fecha: "2023-05-01", estado: "abierto", historia_leida_at: "2026-10-01", tipo: null }], abiertos, "2025-10-21"), [])
  assert.deepEqual(F.proyectosSinTipo([{ codigo: 2, numero: "", fecha: null, estado: "abierto", historia_leida_at: null, tipo: "monto" }], abiertos), [1])
  const clientes = P.clientesDeListado([{ "Razon Social": "PRUEBA", Codigo: 5 }, { "Razon Social": "OTRO", Codigo: 6 }])
  const renglones = P.renglonesRemitos([{ Fecha: "01/10/2026", "N Remito": "RM 1", Cliente: "Prueba", Cantidad: 1, Comprobante: "RM" }])
  assert.deepEqual(F.fichasPendientes(clientes, renglones, []), [5])
  assert.deepEqual(F.fichasPendientes(clientes, renglones, [{ codigo: 5, ficha_leida_at: new Date().toISOString() }]), [])
})

test("filas a grabar: mismas claves en todo el lote y sin montos", () => {
  const foto = {
    inicio: "2026-10-21T06:30:00Z", hoy: "2026-10-21", desde12: "2025-10-21",
    clientes: P.clientesDeListado([{ "Razon Social": "A", Codigo: 1 }, { "Razon Social": "B", Codigo: 2, Vendedor: "X" }]),
    articulos: [], renglones12: P.renglonesRemitos([{ Fecha: "01/10/2026", "N Remito": "RM2 1", Cliente: "A", Cantidad: 4, Comprobante: "RM2", Proyecto: "PRO 1", Codigo: 9, Articulo: "H21" }]),
    proyectos: P.parseProyectosHtml(PROYECTOS), historia: { renglones: [], completaPara: [] }, tipos: [], fichas: [], npPendientes: [],
  }
  const cli = F.filasClientes(foto)
  assert.deepEqual(Object.keys(cli[0]).sort(), Object.keys(cli[1]).sort())
  assert.equal(cli[0].remitos_x_12m, 1)
  const pr = F.filasProyectos(foto)
  assert.deepEqual(Object.keys(pr[0]).sort(), Object.keys(pr[1]).sort())
  for (const fila of [...cli, ...pr]) assert.ok(!Object.keys(fila).some((k) => /monto|importe|precio|total/i.test(k)))
  const m = F.filasMovimientos(foto, ["PRO 1"], () => "Hormigon")
  assert.equal(m.delAnio.length, 1)
  assert.equal(F.totalesPorProyecto(m.delAnio.map((x) => ({ ...x }))).get("PRO 1").m3, 4)
})

// ── Lista cerrada de rutas: en Z0 nada que escriba ──
test("rutaPermitida: solo lectura", async () => {
  const { rutaPermitida } = await import("../zomatik/cliente.ts")
  for (const ok of [["listado_clientes.php", "GET"], ["listado_clientes.php?enviado=1", "POST"], ["reporte_remitosventa.php?enviado=1", "POST"], ["modificar_clientes.php?codigo=22812", "GET"], ["exportar_acopio.php?acopio=590", "GET"], ["home.php", "POST"], ["index.php?a=1", "POST"]])
    assert.equal(rutaPermitida(ok[0], ok[1]), true, ok.join(" "))
  for (const no of [
    ["grabar_clientes.php?codigo=0", "POST"], ["manage_pedidos.php?pedidos_unico=1", "GET"], ["modificar_pedidos.php?proyecto=576&tipo=1", "GET"],
    ["modificar_remitos.php?pedido=1", "GET"], ["modificar_clientes.php", "GET"], ["modificar_clientes.php?codigo=1", "POST"], ["generar_acopio.php?acopio=1", "GET"],
    ["set_pedidos_destacado.php?codigo=1", "GET"], ["_getnumerofactura.php?fcomprobante=7", "GET"], ["_validarcuit.php?fcuit=1", "GET"], ["listado_clientes.php", "POST"],
  ])
    assert.equal(rutaPermitida(no[0], no[1]), false, no.join(" "))
})
