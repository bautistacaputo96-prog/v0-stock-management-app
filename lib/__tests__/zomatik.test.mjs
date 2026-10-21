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
  assert.equal(P.nombreNormalizado("Fideicomiso Los Robles"), P.nombreNormalizado("FIDEICOMISO LOS ROBLES S.A."))
  assert.equal(P.nombreNormalizado("García, Juan"), P.nombreNormalizado("JUAN GARCIA"))
  assert.equal(P.nombreNormalizado("Ing. Ramón Pérez"), P.nombreNormalizado("PEREZ ING RAMON "))
  assert.equal(P.nombreNormalizado("Construcciones S.R.L."), "CONSTRUCCIONES")
  assert.notEqual(P.nombreNormalizado("LOS ROBLES CAMINO REAL"), P.nombreNormalizado("LOS ROBLES"))
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
<tr><td><a href="modificar_proyectos.php?codigo=576">PRO 0001-00000030</a></td><td></td><td><a href="modificar_proyectos.php?codigo=576">EMPRESA DE PRUEBA (12345)<br>PAVIMENTO LT 1</a></td><td></td><td>03/07/2026</td><td></td><td>Si</td><td></td><td>$ 583.414.000,00</td><td></td><td style="display: none">$ 359.024.000,00</td><td></td><td>$ 224.390.000,00</td><td></td><td>$ 163.516.781,56</td><td></td><td>$ 1,00</td><td></td><td>0 / 1</td><td></td><td>$ 1,00</td><td></td><!-- <td><a href="modificar_facturasventa.php?proyecto=576">$ 7,986,362.92</a></td><td></td> --><td><a href="reporte_detalleproyecto.php?proyecto=576">VER</a></td><td></td><td><a href="modificar_pedidos.php?proyecto=576&tipo=1">MATERIAL</a></td><td></td><td> Abierto </td><td></td><td></td></tr>
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
  assert.equal(p.cliente_codigo, 12345)
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
    { id: "d", name: "Ferretería Norte" },
    { id: "e", name: "FERRETERIA NORTE S.A." },
    { id: "f", name: "Nadie Igual" },
  ]
  const z = [
    { codigo: 1, razon_social: "FIDEICOMISO LAS LOMAS", cuit: "2201" },
    { codigo: 2, razon_social: "OTRO NOMBRE", cuit: "20123456786" },
    { codigo: 3, razon_social: "ASOCIACION CIVIL EDUCACION POPULAR" },
    { codigo: 4, razon_social: "FERRETERIA NORTE" },
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
  for (const ok of [["listado_clientes.php", "GET"], ["listado_clientes.php?enviado=1", "POST"], ["reporte_remitosventa.php?enviado=1", "POST"], ["modificar_clientes.php?codigo=12345", "GET"], ["exportar_acopio.php?acopio=590", "GET"], ["home.php", "POST"], ["index.php?a=1", "POST"]])
    assert.equal(rutaPermitida(ok[0], ok[1]), true, ok.join(" "))
  for (const no of [
    ["grabar_clientes.php?codigo=0", "POST"], ["manage_pedidos.php?pedidos_unico=1", "GET"], ["modificar_pedidos.php?proyecto=576&tipo=1", "GET"],
    ["modificar_remitos.php?pedido=1", "GET"], ["modificar_clientes.php", "GET"], ["modificar_clientes.php?codigo=1", "POST"], ["generar_acopio.php?acopio=1", "GET"],
    ["set_pedidos_destacado.php?codigo=1", "GET"], ["_getnumerofactura.php?fcomprobante=7", "GET"], ["_validarcuit.php?fcuit=1", "GET"], ["listado_clientes.php", "POST"],
  ])
    assert.equal(rutaPermitida(no[0], no[1]), false, no.join(" "))
})

test("lista cerrada: solo los 5 listados que se usan; redirecciones validadas", async () => {
  const { rutaPermitida, rutaDeLocation } = await import("../zomatik/cliente.ts")
  for (const l of ["listado_clientes.php", "listado_articulos.php", "reporte_remitosventa.php", "listado_proyectos.php", "listado_pedidos.php"]) {
    assert.equal(rutaPermitida(l, "GET"), true, l)
    assert.equal(rutaPermitida(`${l}?enviado=1`, "POST"), true, l)
  }
  for (const l of ["listado_remitos.php", "listado_obras.php", "reporte_entrega.php", "listado_tipos_factura.php"]) {
    assert.equal(rutaPermitida(l, "GET"), false, l)
    assert.equal(rutaPermitida(`${l}?enviado=1`, "POST"), false, l)
  }
  assert.equal(rutaDeLocation("home.php", "index.php?a=1"), "home.php")
  assert.equal(rutaDeLocation("/listado_clientes.php?enviado=1", "listado_clientes.php"), "listado_clientes.php?enviado=1")
  assert.equal(rutaDeLocation("https://concretus.zomatik.com/grabar_pedidos.php?codigo=0", "home.php"), "grabar_pedidos.php?codigo=0")
  assert.equal(rutaPermitida(rutaDeLocation("grabar_pedidos.php?codigo=0", "home.php"), "GET"), false)
  assert.equal(rutaDeLocation("https://otro.sitio.com/home.php", "home.php"), null)
})

test("saldo % acotado y última entrega solo con hormigón; no borrar si la lectura cae mucho", () => {
  assert.equal(P.saldoPorcentaje(1, 1e9), 999)
  assert.equal(P.saldoPorcentaje(1, -1e9), -999)
  assert.equal(P.saldoPorcentaje(0, 5), null)
  const t = F.totalesPorProyecto([
    { proyecto_numero: "PRO 1", fecha: "2026-10-01", m3: 10, es_hormigon: true },
    { proyecto_numero: "PRO 1", fecha: "2026-10-05", m3: 10, es_hormigon: false },
  ]).get("PRO 1")
  assert.deepEqual(t, { m3: 10, ultima: "2026-10-01" })
  assert.equal(F.puedeBorrarViejos(140, 147), true)
  assert.equal(F.puedeBorrarViejos(20, 147), false)
  assert.equal(F.puedeBorrarViejos(0, 3), false)
  assert.equal(F.puedeBorrarViejos(3, 5), true)
})

test("export: se permite bajar el archivo generado solo de los listados que se usan", async () => {
  const { rutaPermitida } = await import("../zomatik/cliente.ts")
  assert.equal(rutaPermitida("output/reporte_remitosventa.xlsx", "GET"), true)
  assert.equal(rutaPermitida("output/exportar_acopio.xlsx", "GET"), true)
  assert.equal(rutaPermitida("output/listado_remitos.xlsx", "GET"), false)
  assert.equal(rutaPermitida("output/../grabar_pedidos.xlsx", "GET"), false)
  assert.equal(rutaPermitida("output/listado_clientes.xlsx", "POST"), false)
})

// ── Cruce por fechas, m³ y planta (idea de Bautista) ──
const C = await import("../zomatik/cruce.ts")
const PR = await import("../zomatik/propuestas.ts")
const dias = (pares) => { const m = new Map(); for (const [f, pl, m3] of pares) C.agregarDia(m, f, pl, m3); return m }

test("cruzar: mismos días y m³ en la misma planta; Zomatik remite hasta 3 días después y junta días", () => {
  const n = dias([["2026-05-04", "Canning", 8], ["2026-05-05", "Canning", 8], ["2026-05-12", "Canning", 16], ["2026-06-01", "Hudson", 7]])
  const z = dias([["2026-05-06", "Canning", 16], ["2026-05-12", "Canning", 16], ["2026-06-01", "Hudson", 7]])
  const e = C.cruzar(z, n)
  assert.equal(e.comunes, 3)
  assert.equal(e.ratio, 1)
  assert.equal(e.pct, 1) // 16 (dos días juntos) + 16 + 7 contra 8 + 8 + 16 + 7
  assert.equal(e.cubre, 1)
  assert.match(C.textoEvidencia(e), /^3 días en común de 3, 100 % de los m³/)
  assert.equal(C.confianza(e, 0), "alta")
  assert.equal(e.pares.length, 3)
})

test("cruzar: otra planta no cuenta; sin coincidencias con movimiento de los dos lados = baja", () => {
  const n = dias([["2026-05-04", "Hudson", 8], ["2026-05-20", "Hudson", 8]])
  const z = dias([["2026-05-04", "Canning", 8], ["2026-05-20", "Canning", 8]])
  const e = C.cruzar(z, n)
  assert.equal(e.comunes, 0)
  assert.equal(e.otraPlanta, 2)
  assert.equal(C.contradice(e), true)
  assert.equal(C.confianza(e, 1), "baja")
  assert.equal(C.cruzar(dias([["2026-03-01", "Canning", 8]]), dias([["2026-03-01", "Canning", 8]])).zd, 0) // antes del 13/04 no cuenta
})

test("confianza: un solo día = media; m³ muy distintos no es alta; nombre igual sin datos = media", () => {
  const uno = C.cruzar(dias([["2026-05-04", "Canning", 10]]), dias([["2026-05-04", "Canning", 10]]))
  assert.equal(C.confianza(uno, 1), "media")
  const lejos = C.cruzar(dias([["2026-05-04", "Canning", 40], ["2026-05-08", "Canning", 40], ["2026-05-09", "Canning", 40]]), dias([["2026-05-04", "Canning", 8], ["2026-05-08", "Canning", 8], ["2026-05-09", "Canning", 8]]))
  assert.equal(lejos.comunes, 3)
  assert.notEqual(C.confianza(lejos, 0), "alta")
  assert.equal(C.confianza(C.cruzar(new Map(), new Map()), 1, 2), "media")
})

test("genéricos y duplicados nuestros", () => {
  assert.equal(C.esGenerico("MOSTRADOR FABRICA"), true)
  assert.equal(C.esGenerico("Consumidor Final"), true)
  assert.equal(C.esGenerico("VARIOS"), true)
  assert.equal(C.esGenerico(" "), true)
  assert.equal(C.esGenerico("Constructora Sur"), false)
  const dup = C.duplicadosNuestros([{ id: "a", name: "LA TERCERA" }, { id: "b", name: "Fideicomiso La Tercera" }, { id: "c", name: "Otro" }, { id: "d", name: "Otro", active: false }])
  assert.match(dup.get("a"), /posible duplicado de «Fideicomiso La Tercera»/)
  assert.equal(dup.has("c"), false)
  assert.equal(C.plantaDeDeposito("REBUCRET"), "Hudson")
  assert.equal(C.plantaDeDeposito("Canning"), "Canning")
})

// Datos de prueba inventados para armarPropuestas
const RD = (cn, f, pl, m3, arts = [500]) => ({ cliente_norm: cn, fecha: f, planta: pl, m3, articulos: arts })
const DESP = (cid, f, pl, m3, fid = "f1", obra = "o1") => ({ client_id: cid, construction_site_id: obra, formula_id: fid, planta: pl, fecha: f, m3, obra: "Obra", formula: "H30" })
function datosPrueba() {
  const zcli = [
    { codigo: 1, razon_social: "CONSTRUCTORA DEL OESTE SRL", remitos_r_12m: 4, remitos_x_12m: 0, estado: "Activo" },
    { codigo: 2, razon_social: "JUAN PEREZ", remitos_r_12m: 0, remitos_x_12m: 2, estado: "Activo" },
    { codigo: 3, razon_social: "MOSTRADOR FABRICA", remitos_r_12m: 9, remitos_x_12m: 0, estado: "Activo" },
    { codigo: 4, razon_social: "ACME SA", remitos_r_12m: 1, remitos_x_12m: 0, estado: "Activo" },
  ]
  const remitosDia = [
    RD(P.nombreNormalizado("CONSTRUCTORA DEL OESTE SRL"), "2026-05-04", "Canning", 16), RD(P.nombreNormalizado("CONSTRUCTORA DEL OESTE SRL"), "2026-05-11", "Canning", 24), RD(P.nombreNormalizado("CONSTRUCTORA DEL OESTE SRL"), "2026-06-02", "Canning", 8),
    RD(P.nombreNormalizado("JUAN PEREZ"), "2026-07-01", "Hudson", 6), RD(P.nombreNormalizado("JUAN PEREZ"), "2026-07-09", "Hudson", 6),
    RD(P.nombreNormalizado("MOSTRADOR FABRICA"), "2026-05-04", "Canning", 16), RD(P.nombreNormalizado("MOSTRADOR FABRICA"), "2026-05-11", "Canning", 24),
  ]
  const despachos = [
    DESP("x", "2026-05-04", "Canning", 8), DESP("x", "2026-05-04", "Canning", 8), DESP("x", "2026-05-11", "Canning", 24), DESP("x", "2026-06-02", "Canning", 8),
    DESP("p", "2026-07-01", "Hudson", 6, "f2", "o2"), DESP("p", "2026-07-09", "Hudson", 6, "f2", "o2"),
  ]
  return {
    clientes: [{ id: "x", name: "Obra Barrio Norte", active: true }, { id: "p", name: "Pérez Juan", active: true }, { id: "q", name: "PEREZ JUAN", active: true }],
    zcli, despachos, remitosDia,
    formulas: [{ id: "f1", name: "H30-620-10 C (CAN)", planta: "Canning" }, { id: "f2", name: "H21 especial", planta: "Hudson" }],
    articulos: [{ codigo: 500, nombre: "H30-620-10 C (CAN)", linea: "Hormigon" }, { codigo: 501, nombre: "H21-620-15 B (HUD)", linea: "Hormigon" }],
    proyectos: [{ codigo: 9, numero: "PRO 0001-00000009", cliente_codigo: 1, cliente_nombre: "CONSTRUCTORA DEL OESTE SRL", obra: "Barrio Norte" }],
    movimientos: [{ proyecto_numero: "PRO 0001-00000009", fecha: "2026-05-11", m3: 24, deposito: "Canning" }, { proyecto_numero: "PRO 0001-00000009", fecha: "2026-06-02", m3: 8, deposito: "Canning" }],
    obras: [{ id: "o1", name: "Barrio Norte", client_id: "x" }, { id: "o2", name: "Casa", client_id: "p" }],
  }
}

test("armarPropuestas: candidato solo por fechas aunque el nombre no se parezca; genéricos fuera; duplicados marcados", () => {
  const d = datosPrueba()
  const r = PR.armarPropuestas(d)
  const x = r.clientes.find((c) => c.id === "x")
  assert.equal(x.propuesta.codigo, 1) // "Obra Barrio Norte" ↔ CONSTRUCTORA DEL OESTE: solo por fechas
  assert.equal(x.propuesta.confianza, "alta")
  assert.match(x.propuesta.evidencia, /3 días en común de 3, 100 % de los m³/)
  assert.match(x.propuesta.evidencia, /artículo igual a la fórmula/)
  assert.ok(!x.candidatos.some((k) => k.codigo === 3), "el genérico no se propone")
  const p = r.clientes.find((c) => c.id === "p"), q = r.clientes.find((c) => c.id === "q")
  assert.match(p.duplicado, /posible duplicado/)
  assert.equal([p, q].filter((c) => c.propuesta?.codigo === 2 && c.propuesta.confianza !== "baja").length, 1) // un código, un cliente nuestro
  const yo = r.zomatikAnio.find((z) => z.codigo === 3)
  assert.equal(yo.generico, true)
  assert.equal(yo.cubre, null)
  assert.equal(r.zomatikAnio.find((z) => z.codigo === 1).cubre.id, "x") // al revés: quién cubre sus días
  assert.equal(r.conteos.clientes.faltan, 3)
})

test("armarPropuestas: fórmulas por el artículo de los remitos y proyectos ↔ obra por los despachos", () => {
  const r = PR.armarPropuestas(datosPrueba())
  const f1 = r.formulas.find((f) => f.id === "f1")
  assert.equal(f1.propuesta.codigo, 500)
  assert.equal(f1.propuesta.confianza, "alta") // nombre igual
  assert.equal(f1.ranking[0].codigo, 500)
  assert.equal(f1.ranking[0].pct, 100)
  const pr = r.proyectos.find((p) => p.codigo === 9)
  assert.equal(pr.propuesta.id, "o1")
  assert.match(pr.propuesta.evidencia, /2 días en común de 2/)
})

test("Ver días: lado a lado con los días que coinciden marcados", () => {
  const d = datosPrueba()
  const v = PR.diasCliente(d, "x", 1)
  assert.equal(v.nuestros.length, 4)
  assert.ok(v.nuestros.every((n) => n.coincide))
  assert.equal(v.zomatik.length, 3)
  assert.ok(v.zomatik.every((z) => z.coincide))
  assert.equal(v.zomatik[0].deposito, "Canning (116)")
  const vp = PR.diasProyecto(d, 9, "o1")
  assert.equal(vp.zomatik.filter((z) => z.coincide).length, 2)
  assert.equal(vp.nuestros.filter((n) => n.coincide).length, 2)
  const vf = PR.diasFormula(d, "f1", 500, new Map([["x", P.nombreNormalizado("CONSTRUCTORA DEL OESTE SRL")]]))
  assert.match(vf.evidencia, /3 de 3 días \(100 %\)/)
})

test("remitosPorDia: suma m³ de hormigón por cliente, día y planta; sin bombeo", () => {
  const ren = P.renglonesRemitos([
    { Fecha: "04/05/2026", "N Remito": "RM 1", Cliente: "Acme SA", Codigo: 500, Articulo: "H30-620-10 C (CAN)", Cantidad: 8, Comprobante: "RM", Deposito: "Canning" },
    { Fecha: "04/05/2026", "N Remito": "RM 2", Cliente: "ACME S.A.", Codigo: 500, Articulo: "H30-620-10 C (CAN)", Cantidad: 8, Comprobante: "RM", Deposito: "Canning" },
    { Fecha: "04/05/2026", "N Remito": "RM 2", Cliente: "ACME S.A.", Codigo: 10099001, Articulo: "BOMBA PLUMA", Cantidad: 16, Comprobante: "RM", Deposito: "Canning" },
  ])
  const r = C.remitosPorDia(ren)
  assert.equal(r.length, 1)
  assert.equal(r[0].m3, 16)
  assert.equal(r[0].remitos, 2)
  assert.deepEqual(r[0].articulos, [500])
})
