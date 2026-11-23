// Pruebas del control cruzado del despacho contra Zomatik (docs/specs/2026-11-20-control-cruzado-despacho-zomatik.md).
// Con la captura real del Reporte de Producción del 20/11 y el ejemplo real del cemento (90,3 t contra 19,1 t).
// Sin red ni base.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as P from "../control-produccion/calculo.ts"

const html = readFileSync(new URL("../__fixtures__/control-produccion/reporte-produccion.html", import.meta.url), "utf8")
const cerca = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ""} ${a} ≠ ${b}`)
const CAN = "planta-canning"
const HUD = "planta-hudson"
const PLANTAS = [
  { id: CAN, nombre: "Canning", deposito: 116 },
  { id: HUD, nombre: "Hudson", deposito: 113 },
]
const CODIGOS = ["10000004", "10000001", "10000612", "10000005", "10000026"]
/** Todas las lecturas de stock hechas a las 05:44 de `hoy`. */
const lecturasDe = (hoy, hora = "08:44:00") => PLANTAS.flatMap((p) => CODIGOS.map((codigo) => ({ deposito: p.deposito, codigo, leidoAt: `${hoy}T${hora}Z`, error: null })))
const datos = (hoy, mas = {}) => ({
  hoy,
  plantas: PLANTAS,
  despachos: [],
  produccion: [],
  lecturaProduccion: { leidoAt: `${hoy}T08:42:30Z`, error: null },
  movimientos: [],
  lecturasStock: lecturasDe(hoy),
  ofsRobot: [],
  ofs: [],
  ...mas,
})
const despacho = (fecha, m3, materiales = [], mas = {}) => ({ plantaId: CAN, fecha, m3, articuloCodigo: 501, articuloNombre: "H30-620-10 C (CAN)", formula: "H30-620-10 Pavimento (CAN)", materiales, ...mas })
const rmi = (codigo, fecha, t, mas = {}) => ({ deposito: 116, codigo, fecha, prefijo: "RMI", comprobante: "RMI 0001-00000001", movimiento: -t, ...mas })
const planta = (r, id) => r.plantas.find((p) => p.plantaId === id)
const grupo = (r, id, g) => planta(r, id).grupos.find((x) => x.grupo === g)

// ── 1 a 3. El reporte ──────────────────────────────────────────────────────

test("1. leerReporteProduccion: 16 días del 13/11 al 28/11 y los m³ reales por depósito", () => {
  const r = P.leerReporteProduccion(html, "2026-11-13")
  assert.equal(r.ok, true, r.motivo)
  assert.equal(r.fechas.length, 16)
  assert.equal(r.fechas[0], "2026-11-13")
  assert.equal(r.fechas[15], "2026-11-28")
  const m3 = (deposito, fecha) => r.celdas.filter((c) => c.deposito === deposito && c.fecha === fecha).reduce((s, c) => s + c.m3, 0)
  assert.equal(m3(116, "2026-11-13"), 41)
  assert.equal(m3(116, "2026-11-16"), 81.5)
  assert.equal(m3(116, "2026-11-18"), 45)
  assert.equal(m3(116, "2026-11-19"), 19.5)
  assert.equal(m3(116, "2026-11-21"), 1)
  assert.equal(m3(113, "2026-11-13"), 36)
  assert.equal(m3(113, "2026-11-19"), 0)
  // Solo las celdas con m³: nada en cero, y la fila "M2" sin números no suma ni rompe
  assert.ok(r.celdas.every((c) => c.m3 !== 0))
  assert.equal(r.celdas.some((c) => c.um === "M2"), false)
  assert.equal(r.celdas.filter((c) => c.producto === "H-21 AC15 B").length, 1)
  // El "(HUD)" del 19/11 está en el depósito Canning: suma en Canning (la planta sale del depósito, no del nombre)
  const hud = r.celdas.find((c) => c.producto === "H21-620-15 B (HUD)" && c.fecha === "2026-11-19")
  assert.equal(hud.deposito, 116)
  assert.equal(hud.m3, 3)
  assert.deepEqual(r.otros, [])
  // Sin pasar la fecha pedida también vale (16 días seguidos desde el primero)
  assert.equal(P.leerReporteProduccion(html).ok, true)
})

test("1b. Otro segmento u otro depósito no se suman: van a `otros`", () => {
  const otro = html
    .replace("<td class=\"itemlistado\" bgcolor=\"#ffffff\"> Hormigon </td> <td bgcolor=\"#999999\"></td> <td class=\"itemlistado\" bgcolor=\"#ffffff\"> H21-620-10 C (CAN) </td>", "<td class=\"itemlistado\" bgcolor=\"#ffffff\"> Bloques </td> <td bgcolor=\"#999999\"></td> <td class=\"itemlistado\" bgcolor=\"#ffffff\"> H21-620-10 C (CAN) </td>")
    .replace("<td class=\"itemlistado\" bgcolor=\"#ffffff\"> H30-620-15 B (CAN) </td> <td bgcolor=\"#999999\"></td> <td class=\"itemlistado\" bgcolor=\"#ffffff\"> Canning </td>", "<td class=\"itemlistado\" bgcolor=\"#ffffff\"> H30-620-15 B (CAN) </td> <td bgcolor=\"#999999\"></td> <td class=\"itemlistado\" bgcolor=\"#ffffff\"> Ruta 25 </td>")
  const r = P.leerReporteProduccion(otro, "2026-11-13")
  assert.equal(r.ok, true)
  // Canning 13/11: 41 − 2 (otro segmento) − 4 (otro depósito) = 35
  assert.equal(r.celdas.filter((c) => c.deposito === 116 && c.fecha === "2026-11-13").reduce((s, c) => s + c.m3, 0), 35)
  assert.deepEqual(r.otros.map((o) => [o.segmento, o.deposito, o.m3]).sort(), [["Bloques", "Canning", 2], ["Hormigon", "Ruta 25", 4]])
})

test("2. No vale: menos de 16 fechas, fechas salteadas, otra fecha de inicio, sin tabla o sin Canning ni REBUCRET", () => {
  const celdaFecha = (f) => ` <td width="1" bgcolor="#999999"><img src="images/1x1.gif" width="1" height="1"></td> <td background="images/fondo_tabl.gif" class="headerlistado"> ${f} </td>`
  const menos = html.replace(celdaFecha("28/11/2026"), "")
  assert.notEqual(menos, html)
  const a = P.leerReporteProduccion(menos, "2026-11-13")
  assert.equal(a.ok, false)
  assert.match(a.motivo, /no trae 16 días seguidos/)
  assert.deepEqual(a.celdas, [])
  const salteada = html.replace("> 20/11/2026 <", "> 29/11/2026 <")
  assert.equal(P.leerReporteProduccion(salteada, "2026-11-13").ok, false)
  // Zomatik devolvió el reporte desde otro día que el pedido
  assert.equal(P.leerReporteProduccion(html, "2026-11-11").ok, false)
  const sinTabla = P.leerReporteProduccion("<html><body><form name=\"frm_selsuc\"></form><p>Sin datos</p></body></html>", "2026-11-13")
  assert.equal(sinTabla.ok, false)
  assert.match(sinTabla.motivo, /no vino la tabla/)
  assert.equal(P.leerReporteProduccion("", "2026-11-13").ok, false)
  // Los depósitos de otra sucursal: no se guarda
  const otraSucursal = html.replaceAll("> Canning <", "> Ruta 25 <").replaceAll("> REBUCRET <", "> Olivera <")
  const o = P.leerReporteProduccion(otraSucursal, "2026-11-13")
  assert.equal(o.ok, false)
  assert.match(o.motivo, /ningún depósito/)
})

test("3. Una página que muestra la sucursal 17 se rechaza (la respuesta tiene que mostrar la 18)", async () => {
  const { exigirSucursalDePagina, sucursalDePagina } = await import("../zomatik/cliente.ts")
  assert.equal(sucursalDePagina(html), "18")
  const en17 = html.replace('<option value="17">', '<option value="17" selected>').replace('<option value="18" selected>', '<option value="18">')
  assert.equal(sucursalDePagina(en17), "17")
  assert.throws(() => exigirSucursalDePagina(en17, "18", "el reporte de producción"), /otra sucursal \(17\)/)
  assert.doesNotThrow(() => exigirSucursalDePagina(html, "18", "el reporte de producción"))
})

// ── 4. m³ ──────────────────────────────────────────────────────────────────

test("ventana: los 7 días cerrados; ayer y anteayer en plazo", () => {
  assert.deepEqual(P.ventana("2026-11-20"), { desde: "2026-11-13", hasta: "2026-11-19" })
  assert.deepEqual(P.diasDeGracia("2026-11-20"), ["2026-11-19", "2026-11-18"])
})

test("4. m³: iguales bien; falta ayer ámbar; falta hace 3 días rojo; OF duplicada rojo; otra fecha ámbar; hoy no entra", () => {
  const hoy = "2026-11-20"
  const z = { "2026-11-13": 41, "2026-11-16": 81.5, "2026-11-18": 45, "2026-11-19": 19.5 }
  // Iguales
  const igual = P.compararM3({ hoy, sistema: { ...z }, zomatik: z, alDia: true })
  assert.equal(igual.semana.estado, "bien")
  assert.equal(igual.semana.texto, null)
  assert.equal(igual.semana.sistema, 187)
  assert.ok(igual.dias.every((d) => d.estado === "bien"))
  assert.equal(igual.dias.length, 7)
  // Falta ayer (19/11): ámbar, la semana sin rojo
  const ayer = P.compararM3({ hoy, sistema: { ...z, "2026-11-19": 33.5 }, zomatik: z, alDia: true })
  assert.equal(ayer.semana.estado, "ambar")
  assert.equal(ayer.semana.texto, "faltan OF por 14 m³ (de ayer o anteayer, en plazo)")
  assert.equal(ayer.semana.enEspera, 14)
  assert.equal(ayer.dias.find((d) => d.fecha === "2026-11-19").estado, "ambar")
  assert.equal(ayer.dias.some((d) => d.estado === "rojo"), false)
  // Falta hace 3 días (17/11, el ejemplo de la spec): rojo el día y la semana
  const tres = P.compararM3({ hoy, sistema: { ...z, "2026-11-17": 12 }, zomatik: z, alDia: true })
  assert.equal(tres.semana.estado, "rojo")
  assert.equal(tres.semana.texto, "faltan OF por 12 m³")
  assert.deepEqual(tres.semana.dias, ["2026-11-17"])
  assert.equal(tres.dias.find((d) => d.fecha === "2026-11-17").estado, "rojo")
  assert.equal(tres.semana.sistema, 199)
  assert.equal(tres.semana.zomatik, 187)
  // Falta firme y, además, algo de ayer: rojo; lo de ayer sigue en ámbar
  const mixto = P.compararM3({ hoy, sistema: { ...z, "2026-11-17": 12, "2026-11-19": 33.5 }, zomatik: z, alDia: true })
  assert.equal(mixto.semana.estado, "rojo")
  assert.equal(mixto.semana.texto, "faltan OF por 26 m³")
  assert.equal(mixto.dias.find((d) => d.fecha === "2026-11-19").estado, "ambar")
  assert.equal(mixto.dias.find((d) => d.fecha === "2026-11-17").estado, "rojo")
  // OF duplicada: sobran
  const doble = P.compararM3({ hoy, sistema: z, zomatik: { ...z, "2026-11-16": 89.5 }, alDia: true })
  assert.equal(doble.semana.estado, "rojo")
  assert.equal(doble.semana.texto, "sobran 8 m³ con OF")
  assert.equal(doble.dias.find((d) => d.fecha === "2026-11-16").estado, "rojo")
  // Una OF de más de ayer también es roja (la gracia es solo para lo que falta)
  assert.equal(P.compararM3({ hoy, sistema: z, zomatik: { ...z, "2026-11-19": 27.5 }, alDia: true }).semana.estado, "rojo")
  // La misma cantidad con otra fecha dentro de la semana: el total cierra → ámbar "OF con otra fecha"
  const otra = P.compararM3({ hoy, sistema: { ...z, "2026-11-14": 8 }, zomatik: { ...z, "2026-11-15": 8 }, alDia: true })
  assert.equal(otra.semana.estado, "bien")
  assert.deepEqual(otra.dias.filter((d) => d.estado !== "bien").map((d) => [d.fecha, d.estado, d.nota]), [["2026-11-14", "ambar", "OF con otra fecha"], ["2026-11-15", "ambar", "OF con otra fecha"]])
  // Menos de 0,5 m³ (redondeo del reporte): no cuenta. 0,5 justo: sí
  assert.equal(P.compararM3({ hoy, sistema: { ...z, "2026-11-16": 81.9 }, zomatik: z, alDia: true }).semana.estado, "bien")
  assert.equal(P.compararM3({ hoy, sistema: { ...z, "2026-11-16": 82 }, zomatik: z, alDia: true }).semana.estado, "rojo")
  // Hoy no entra en nada: 32 m³ despachados hoy con 12 de OF no cambian ni la semana ni los días
  const conHoy = P.compararM3({ hoy, sistema: { ...z, [hoy]: 32 }, zomatik: { ...z, [hoy]: 12 }, alDia: true })
  assert.equal(conHoy.semana.estado, "bien")
  assert.deepEqual(conHoy.hoy, { sistema: 32, zomatik: 12 })
  assert.equal(conHoy.dias.some((d) => d.fecha === hoy), false)
  // Sin la lectura de hoy: todo en gris, nada en rojo
  const viejo = P.compararM3({ hoy, sistema: { ...z, "2026-11-17": 12 }, zomatik: z, alDia: false })
  assert.equal(viejo.semana.estado, "gris")
  assert.ok(viejo.dias.every((d) => d.estado === "gris"))
})

test("Criterio 1 y ejemplo de la spec: con la captura real, mismos m³ → todo bien; 12 m³ sin OF el 17/11 → rojo", () => {
  const rep = P.leerReporteProduccion(html, "2026-11-13")
  const dep = { 116: CAN, 113: HUD }
  const produccion = rep.celdas.map((c) => ({ deposito: c.deposito, fecha: c.fecha, producto: c.producto, articuloCodigo: null, m3: c.m3 }))
  const iguales = rep.celdas.map((c) => despacho(c.fecha, c.m3, [], { plantaId: dep[c.deposito], articuloCodigo: null, articuloNombre: null }))
  const r = P.armarDespacho(datos("2026-11-20", { produccion, despachos: iguales }))
  assert.equal(r.desde, "2026-11-13")
  assert.equal(r.hasta, "2026-11-19")
  assert.equal(r.semaforo.estado, "verde")
  const m3Can = Object.fromEntries(planta(r, CAN).m3.dias.map((d) => [d.fecha, d.zomatik]))
  assert.deepEqual([m3Can["2026-11-13"], m3Can["2026-11-16"], m3Can["2026-11-18"], m3Can["2026-11-19"]], [41, 81.5, 45, 19.5])
  assert.equal(planta(r, HUD).m3.dias.find((d) => d.fecha === "2026-11-13").zomatik, 36)
  assert.equal(planta(r, CAN).m3.semana.zomatik, 187)
  // El 21/11 (una OF a futuro) no entra en la semana
  assert.equal(planta(r, CAN).m3.dias.some((d) => d.fecha === "2026-11-21"), false)
  const con12 = P.armarDespacho(datos("2026-11-20", { produccion, despachos: [...iguales, despacho("2026-11-17", 12)] }))
  assert.equal(con12.semaforo.estado, "rojo")
  assert.equal(planta(con12, CAN).m3.semana.texto, "faltan OF por 12 m³")
  assert.equal(planta(con12, CAN).m3.dias.find((d) => d.fecha === "2026-11-17").estado, "rojo")
  assert.equal(planta(con12, HUD).m3.semana.estado, "bien")
})

// ── 5 a 9. Materia prima ───────────────────────────────────────────────────

test("Grupos: el criterio de qué material va a qué grupo, en un solo lugar", () => {
  assert.equal(P.grupoDeMaterial("CPC 40"), "cemento")
  assert.equal(P.grupoDeMaterial("Cemento CPC40 granel"), "cemento")
  assert.equal(P.grupoDeMaterial("Arena Fina"), "arenas")
  assert.equal(P.grupoDeMaterial("Arena Trituración 0/6"), "arenas")
  for (const n of ["Piedra 6/12", "Piedra 6/20", "Piedra Partida 6/20", "Piedra 10/30", "Piedra Partida 10-30", "Piedra bola"]) assert.equal(P.grupoDeMaterial(n), "piedras", n)
  // Lo que Zomatik no descuenta no entra
  for (const n of ["Agua", "Sikament 90E", "Aditivo superfluidificante", "Fibra Macroflex", "Gasoil", "", null]) assert.equal(P.grupoDeMaterial(n), null, String(n))
  // Los artículos de Zomatik de cada grupo
  assert.deepEqual(P.GRUPOS.map((g) => [g.clave, [...g.codigos].sort()]), [["cemento", ["10000026"]], ["arenas", ["10000001", "10000004"]], ["piedras", ["10000005", "10000612"]]])
  assert.equal(P.grupoDeCodigo("10000001"), "arenas")
  assert.equal(P.grupoDeCodigo(10000612), "piedras")
  assert.equal(P.grupoDeCodigo("99"), null)
})

test("5. Ejemplo real: Canning, cemento, 12 al 18/11: 90,3 t contra 19,1 t → −71,2 t, 78,8 %, rojo", () => {
  const r = P.armarDespacho(
    datos("2026-11-19", {
      despachos: [despacho("2026-11-14", 250, [{ nombre: "CPC 40", kg: 90_300, kgSeco: null }])],
      produccion: [{ deposito: 116, fecha: "2026-11-14", producto: "H30-620-10 C (CAN)", articuloCodigo: 501, m3: 250 }],
      movimientos: [rmi("10000026", "2026-11-13", 19.1)],
    }),
  )
  assert.equal(r.desde, "2026-11-12")
  assert.equal(r.hasta, "2026-11-18")
  const c = grupo(r, CAN, "cemento")
  cerca(c.sistema, 90.3)
  cerca(c.zomatik, 19.1)
  cerca(c.dif, -71.2)
  assert.equal(Math.round(c.pct * 10) / 10, -78.8)
  assert.equal(c.estado, "rojo")
  assert.equal(c.texto, "faltan 71,2 t (79 %)")
  // Las OF existían (los m³ coinciden): no hay m³ en espera que lo expliquen
  assert.equal(planta(r, CAN).m3.semana.estado, "bien")
  assert.equal(r.semaforo.estado, "rojo")
  assert.equal(r.semaforo.titulo, "Despacho contra Zomatik: hay diferencias")
  // Hudson no despachó nada: todo coincide
  assert.ok(planta(r, HUD).grupos.every((g) => g.estado === "bien" && g.texto === "coincide"))
})

test("17. El semáforo va por grupo: con los números reales del 20/11, material por material no da rojo", () => {
  const mats = [
    { nombre: "CPC 40", kg: 72_640, kgSeco: null },
    { nombre: "Arena Trituración 0/6", kg: 66_540, kgSeco: 66_540 },
    { nombre: "Arena Fina", kg: 156_530, kgSeco: 151_640 },
    { nombre: "Piedra 6/20", kg: 208_610, kgSeco: 208_610 },
    { nombre: "Piedra 6/12", kg: 13_590, kgSeco: 13_590 },
    { nombre: "Piedra 10/30", kg: 19_500, kgSeco: 19_500 },
    { nombre: "Agua", kg: 40_000, kgSeco: null },
    { nombre: "Sikament 90E", kg: 600, kgSeco: null },
  ]
  const r = P.armarDespacho(
    datos("2026-11-20", {
      despachos: [despacho("2026-11-16", 239.5, mats)],
      produccion: [{ deposito: 116, fecha: "2026-11-16", producto: "H30-620-10 C (CAN)", articuloCodigo: 501, m3: 239.5 }],
      movimientos: [rmi("10000026", "2026-11-16", 72.8), rmi("10000001", "2026-11-16", 56.34), rmi("10000004", "2026-11-16", 169.05), rmi("10000005", "2026-11-16", 231.36)],
    }),
  )
  const [cem, are, pie] = ["cemento", "arenas", "piedras"].map((g) => grupo(r, CAN, g))
  cerca(are.sistema, 223.07)
  cerca(are.zomatik, 225.39)
  cerca(pie.sistema, 241.7) // con la 6/12 y la 10/30, que la composición de Zomatik no tiene
  cerca(pie.zomatik, 231.36)
  assert.equal(Math.round(pie.pct * 10) / 10, -4.3)
  assert.deepEqual([cem.estado, are.estado, pie.estado], ["bien", "bien", "bien"])
  assert.equal(r.semaforo.estado, "verde")
  // Material por material: informativo, sin estado (la arena 0/6 daría −15 % y la 6/20 +11 %)
  const m = Object.fromEntries(are.materiales.map((x) => [x.nombre, x]))
  cerca(m["Arena Trituración 0/6"].zomatik, 56.34)
  cerca(m["Arena Fina"].sistema, 156.53)
  assert.equal("estado" in m["Arena Fina"], false)
  const p = Object.fromEntries(pie.materiales.map((x) => [x.nombre, x]))
  assert.equal(p["Piedra 10/30"].zomatik, null, "no es un artículo de Zomatik")
  assert.equal(p["Piedra 10/30"].codigo, null)
  cerca(p["Piedra 6/12"].zomatik, 0)
  // Agua y aditivos no entran en ningún grupo
  assert.equal(r.plantas.flatMap((x) => x.grupos).flatMap((g) => g.materiales).some((x) => /agua|sika/i.test(x.nombre)), false)
})

test("6. Regularización del 20/11: las toneladas del robot se pasan al día del despacho", () => {
  // Cemento de Canning: los despachos del 13 al 18 (71,2 t) se descontaron recién el 20; el 19 y el 20, en el día
  const kg = { "2026-11-13": 10_000, "2026-11-14": 12_000, "2026-11-16": 20_000, "2026-11-17": 14_000, "2026-11-18": 15_200, "2026-11-19": 9_000, "2026-11-20": 11_000 }
  const despachos = Object.entries(kg).map(([f, k]) => despacho(f, 30, [{ nombre: "CPC 40", kg: k, kgSeco: null }]))
  const produccion = Object.keys(kg).map((f) => ({ deposito: 116, fecha: f, producto: "H30-620-10 C (CAN)", articuloCodigo: 501, m3: 30 }))
  const movimientos = [rmi("10000026", "2026-11-19", 9), rmi("10000026", "2026-11-20", 11 + 71.2)]
  const robot = Object.entries(kg).map(([f, k]) => ({
    plantaId: CAN,
    fecha: f,
    // Atrasadas: el 20/11 a las 11:30 de Argentina. Las del 19 y el 20, en su día
    ofMpAt: f <= "2026-11-18" ? "2026-11-20T14:30:00Z" : `${f}T20:00:00Z`,
    detalle: [{ codigo: "10000026", nombre: "CCTS CEMENTO GRANEL", toneladas: k / 1000 }],
  }))
  // Mail del 21/11 (ventana 14 al 20): lo del 13 queda afuera
  const a = grupo(P.armarDespacho(datos("2026-11-21", { despachos, produccion, movimientos, ofsRobot: robot })), CAN, "cemento")
  cerca(a.sistema, 81.2)
  cerca(a.zomatik, 81.2)
  assert.equal(a.estado, "bien")
  cerca(a.movido, 71.2)
  cerca(a.porDia.find((d) => d.fecha === "2026-11-16").zomatik, 20, "pasado al día del despacho")
  cerca(a.porDia.find((d) => d.fecha === "2026-11-20").zomatik, 11)
  // Mail del 27/11 (ventana 20 al 26): no queda nada de la regularización
  const b = grupo(P.armarDespacho(datos("2026-11-27", { despachos, produccion, movimientos, ofsRobot: robot })), CAN, "cemento")
  cerca(b.sistema, 11)
  cerca(b.zomatik, 11)
  assert.equal(b.estado, "bien")
  // Sin las filas del robot (regularización hecha a mano): "de más", en rojo
  const sinA = grupo(P.armarDespacho(datos("2026-11-21", { despachos, produccion, movimientos })), CAN, "cemento")
  assert.equal(sinA.estado, "rojo")
  assert.match(sinA.texto, /^de más 10,0 t/)
  const sinB = grupo(P.armarDespacho(datos("2026-11-27", { despachos, produccion, movimientos })), CAN, "cemento")
  assert.equal(sinB.estado, "rojo")
  assert.match(sinB.texto, /^de más 71,2 t/)
  // Mail del 19/11 (ventana 12 al 18), antes de regularizar: faltan las 71,2 t
  const antes = grupo(P.armarDespacho(datos("2026-11-19", { despachos: despachos.filter((d) => d.fecha <= "2026-11-18"), produccion, movimientos: [] })), CAN, "cemento")
  assert.equal(antes.estado, "rojo")
  assert.equal(antes.texto, "faltan 71,2 t (100 %)")
})

test("6b. Descontado HOY por el robot: cuenta si la lectura ya lo trae; si es posterior a la lectura, no", () => {
  const hoy = "2026-11-21"
  const despachos = [despacho("2026-11-18", 30, [{ nombre: "CPC 40", kg: 10_000, kgSeco: null }])]
  const produccion = [{ deposito: 116, fecha: "2026-11-18", producto: "H30-620-10 C (CAN)", articuloCodigo: 501, m3: 30 }]
  const robot = (ofMpAt) => [{ plantaId: CAN, fecha: "2026-11-18", ofMpAt, detalle: [{ codigo: "10000026", toneladas: 10 }] }]
  // Descontado hoy 04:00 de Argentina, leído 05:44: el RMI tiene fecha de hoy (fuera de la ventana) y se pasa al 18
  const antes = grupo(P.armarDespacho(datos(hoy, { despachos, produccion, movimientos: [rmi("10000026", hoy, 10)], ofsRobot: robot(`${hoy}T07:00:00Z`) })), CAN, "cemento")
  assert.equal(antes.estado, "bien")
  cerca(antes.zomatik, 10)
  // Descontado hoy 10:00, después de la lectura de las 05:44: la lectura no lo trae, todavía falta
  const despues = grupo(P.armarDespacho(datos(hoy, { despachos, produccion, movimientos: [], ofsRobot: robot(`${hoy}T13:00:00Z`) })), CAN, "cemento")
  assert.equal(despues.estado, "rojo")
  cerca(despues.zomatik, 0)
})

test("7. Humedad de la arena: Zomatik entre lo seco y lo húmedo está bien, 'por la humedad'", () => {
  const ok = P.evaluarGrupo({ sistema: 61.2, seco: 58.0, zomatik: 58.1 })
  assert.equal(ok.estado, "bien")
  assert.equal(ok.nota, "por la humedad")
  assert.equal(ok.texto, "faltan 3,1 t (5,1 %)")
  // Un poco por debajo del seco, dentro del 5 %: también
  assert.deepEqual([P.evaluarGrupo({ sistema: 61.2, seco: 58.0, zomatik: 55.5 }).estado, P.evaluarGrupo({ sistema: 61.2, seco: 58.0, zomatik: 55.5 }).nota], ["bien", "por la humedad"])
  // Cerca del húmedo: bien, sin nota
  assert.equal(P.evaluarGrupo({ sistema: 61.2, seco: 58.0, zomatik: 60.9 }).nota, null)
  const mal = P.evaluarGrupo({ sistema: 61.2, seco: 58.0, zomatik: 50.0 })
  assert.equal(mal.estado, "rojo")
  assert.equal(mal.texto, "faltan 11,2 t (18 %)")
  // Con los datos reales de la arena fina de Canning (226,45 húmedo, 219,38 seco)
  assert.equal(P.evaluarGrupo({ sistema: 226.45, seco: 219.38, zomatik: 219.4 }).estado, "bien")
})

test("8. Gracia: lo que falta por las OF de ayer o cubierto por lo de hoy va en ámbar", () => {
  // 14 % de los m³ de la semana en espera y falta 13 % del material → ámbar
  const a = P.evaluarGrupo({ sistema: 100, seco: 100, zomatik: 87, pctEspera: 14 })
  assert.equal(a.estado, "ambar")
  assert.equal(a.nota, "faltan OF de ayer o anteayer")
  // Hasta 14 + 5: ámbar; falta 40 %: rojo
  assert.equal(P.evaluarGrupo({ sistema: 100, seco: 100, zomatik: 81, pctEspera: 14 }).estado, "ambar")
  assert.equal(P.evaluarGrupo({ sistema: 100, seco: 100, zomatik: 60, pctEspera: 14 }).estado, "rojo")
  // Sin m³ en espera, 13 % es rojo
  assert.equal(P.evaluarGrupo({ sistema: 100, seco: 100, zomatik: 87 }).estado, "rojo")
  // Falta cubierta por lo que Zomatik descontó hoy (y no es del robot) → ámbar
  const h = P.evaluarGrupo({ sistema: 100, seco: 100, zomatik: 60, hoyLibre: 38 })
  assert.equal(h.estado, "ambar")
  assert.equal(h.nota, "Zomatik lo descontó hoy")
  assert.equal(P.evaluarGrupo({ sistema: 100, seco: 100, zomatik: 60, hoyLibre: 10 }).estado, "rojo")
  // Con todo armado: 14 % de los m³ (ayer, sin OF) y 13 % menos de cemento
  const hoy = "2026-11-20"
  const r = P.armarDespacho(
    datos(hoy, {
      despachos: [despacho("2026-11-16", 86, [{ nombre: "CPC 40", kg: 87_000, kgSeco: null }]), despacho("2026-11-19", 14, [{ nombre: "CPC 40", kg: 13_000, kgSeco: null }])],
      produccion: [{ deposito: 116, fecha: "2026-11-16", producto: "H30-620-10 C (CAN)", articuloCodigo: 501, m3: 86 }],
      movimientos: [rmi("10000026", "2026-11-16", 87)],
    }),
  )
  assert.equal(planta(r, CAN).m3.semana.estado, "ambar")
  assert.equal(grupo(r, CAN, "cemento").estado, "ambar")
  assert.equal(r.semaforo.estado, "verde")
  assert.equal(r.semaforo.avisos.length, 2)
  assert.match(r.semaforo.avisos[0], /^Canning: faltan OF por 14 m³ \(de ayer o anteayer, en plazo\)\.$/)
  // RMI de hoy que no son del robot (alguien regularizó a mano hoy)
  const m = P.armarDespacho(
    datos(hoy, {
      despachos: [despacho("2026-11-16", 100, [{ nombre: "CPC 40", kg: 100_000, kgSeco: null }])],
      produccion: [{ deposito: 116, fecha: "2026-11-16", producto: "H30-620-10 C (CAN)", articuloCodigo: 501, m3: 100 }],
      movimientos: [rmi("10000026", "2026-11-16", 60), rmi("10000026", hoy, 40)],
    }),
  )
  assert.equal(grupo(m, CAN, "cemento").estado, "ambar")
  assert.equal(grupo(m, CAN, "cemento").nota, "Zomatik lo descontó hoy")
})

test("9. Umbrales: rojo solo con más de 5 % Y media tonelada o más", () => {
  // 0,4 t con 50 %: no es rojo
  assert.equal(P.evaluarGrupo({ sistema: 0.8, seco: 0.8, zomatik: 0.4 }).estado, "bien")
  assert.equal(P.evaluarGrupo({ sistema: 0, seco: 0, zomatik: 0.4 }).estado, "bien")
  // 5,0 % justo: no
  assert.equal(P.evaluarGrupo({ sistema: 100, seco: 100, zomatik: 95 }).estado, "bien")
  assert.equal(P.evaluarGrupo({ sistema: 100, seco: 100, zomatik: 105 }).estado, "bien")
  // 5,1 % y más de 0,5 t: sí
  assert.equal(P.evaluarGrupo({ sistema: 100, seco: 100, zomatik: 94.9 }).estado, "rojo")
  const mas = P.evaluarGrupo({ sistema: 100, seco: 100, zomatik: 105.1 })
  assert.equal(mas.estado, "rojo")
  assert.equal(mas.texto, "de más 5,1 t (5,1 %)")
  // Zomatik descontó y el sistema no: rojo, sin porcentaje
  const solo = P.evaluarGrupo({ sistema: 0, seco: 0, zomatik: 3 })
  assert.equal(solo.estado, "rojo")
  assert.equal(solo.texto, "de más 3,0 t")
  assert.equal(P.evaluarGrupo({ sistema: 0, seco: 0, zomatik: 0 }).texto, "coincide")
})

// ── 10 y 11. OF sin materia prima y detalle por producto ───────────────────

test("10. OF sin materia prima: revisar y pendiente van; no y ok no; sin dato solo desde el 20/11; las de hoy no", () => {
  const hoy = "2026-11-22"
  const v = P.ventana(hoy)
  const f = (fecha, of_mp_estado, mas = {}) => ({ fecha, plant_id: CAN, of_numero: `0001-${fecha.slice(8)}${of_mp_estado || "nulo"}`, m3: 8, of_estado: "ok", estado: "ok", of_mp_estado, of_mp_mensaje: null, ...mas })
  const filas = [
    f("2026-11-18", "revisar", { of_mp_mensaje: "El artículo de la OF no tiene composición en Zomatik" }),
    f("2026-11-21", "pendiente"),
    f(hoy, "pendiente"),
    f("2026-11-19", "no"),
    f("2026-11-19", "ok"),
    f("2026-11-18", null),
    f("2026-11-21", null),
    f("2026-11-20", "revisar", { estado: "anulado" }),
    f("2026-11-20", "revisar", { of_estado: "pendiente" }),
    f("2026-11-10", "revisar"),
  ]
  const lista = P.ofSinMp(filas, v)
  assert.deepEqual(lista.map((x) => [x.fecha, x.of_mp_estado]), [["2026-11-18", "revisar"], ["2026-11-21", null], ["2026-11-21", "pendiente"]])
  assert.deepEqual(lista.map(P.motivoOfSinMp), ["El artículo de la OF no tiene composición en Zomatik", "sin dato", "todavía sin descontar"])
  assert.equal(P.motivoOfSinMp({ of_mp_estado: "revisar", of_mp_mensaje: "" }), "no se pudo descontar")
  // En el resultado: con la planta, la fórmula y el semáforo en rojo aunque los m³ y la materia prima coincidan
  const r = P.armarDespacho(datos(hoy, { ofs: filas.map((x) => ({ ...x, formula: "H40-612-15 B (CAN)" })) }))
  assert.equal(r.ofSinMp.length, 3)
  assert.deepEqual(r.ofSinMp[0], { fecha: "2026-11-18", planta: "Canning", of: "0001-18revisar", m3: 8, formula: "H40-612-15 B (CAN)", motivo: "El artículo de la OF no tiene composición en Zomatik" })
  assert.equal(r.semaforo.estado, "rojo")
})

test("11. Detalle por producto: dos fórmulas con el mismo artículo se suman en un renglón", () => {
  const fechas = ["2026-11-16", "2026-11-17"]
  const d = P.detalleProductos({
    fechas,
    sistema: [
      { fecha: "2026-11-16", m3: 30, articuloCodigo: 501, articuloNombre: "H30-620-10 C (CAN)", formula: "H30-620-10 Pavimento (CAN)" },
      { fecha: "2026-11-16", m3: 13.5, articuloCodigo: 501, articuloNombre: "H30-620-10 C (CAN)", formula: "H30-Cordones C (CAN)" },
      { fecha: "2026-11-17", m3: 6, articuloCodigo: null, articuloNombre: null, formula: "Relleno RDC" },
      { fecha: "2026-11-16", m3: 38, articuloCodigo: 502, articuloNombre: "H21-620-15 B (CAN)", formula: "H21-620-15 B (CAN)" },
      { fecha: "2026-11-10", m3: 99, articuloCodigo: 501, articuloNombre: "H30-620-10 C (CAN)", formula: "fuera de las fechas" },
    ],
    zomatik: [
      { fecha: "2026-11-16", m3: 43.5, producto: "H30-620-10 C (CAN)", articuloCodigo: 501 },
      // El nombre del reporte no cruzó con zomatik_articulos al leer: se cruza por nombre con el artículo de la fórmula
      { fecha: "2026-11-16", m3: 38, producto: "h21-620-15  B (CAN)", articuloCodigo: null },
      { fecha: "2026-11-17", m3: 3, producto: "H21-620-15 B (HUD)", articuloCodigo: null },
    ],
  })
  const h30 = d.find((p) => p.clave === "a:501")
  assert.deepEqual(h30.formulas, ["H30-620-10 Pavimento (CAN)", "H30-Cordones C (CAN)"])
  assert.deepEqual(h30.dias, [{ fecha: "2026-11-16", sistema: 43.5, zomatik: 43.5 }, { fecha: "2026-11-17", sistema: 0, zomatik: 0 }])
  const h21 = d.find((p) => p.clave === "a:502")
  assert.deepEqual([h21.sistema, h21.zomatik], [38, 38])
  const sin = d.find((p) => p.clave === "sin")
  assert.equal(sin.nombre, "sin artículo de Zomatik")
  assert.deepEqual([sin.sistema, sin.zomatik], [6, 0])
  const hud = d.find((p) => p.nombre === "H21-620-15 B (HUD)")
  assert.deepEqual([hud.sistema, hud.zomatik], [0, 3])
  assert.equal(d.length, 4)
  assert.equal(d[d.length - 1].clave, "sin", "el renglón sin artículo va último")
})

// ── Semáforo y lectura ─────────────────────────────────────────────────────

test("Criterio 7: sin la lectura de hoy nunca dice 'todo bien'; el rojo de lo que sí se leyó se mantiene", () => {
  const hoy = "2026-11-20"
  // Todo coincide, pero el reporte de producción es de ayer
  const viejo = P.armarDespacho(datos(hoy, { lecturaProduccion: { leidoAt: "2026-11-19T08:44:00Z", error: "Zomatik no respondió a tiempo" } }))
  assert.equal(viejo.semaforo.estado, "ambar")
  assert.equal(viejo.semaforo.titulo, "Despacho contra Zomatik: no se pudo leer Zomatik hoy")
  assert.equal(viejo.lectura.alDia, false)
  assert.equal(viejo.lectura.leidoAt, "2026-11-19T08:44:00Z")
  assert.deepEqual(viejo.lectura.sinLeer, ["el reporte de producción"])
  assert.equal(planta(viejo, CAN).m3.semana.estado, "gris")
  // Un material de un grupo sin leer hoy: el grupo en gris, no cuenta como rojo
  const lecturas = lecturasDe(hoy).map((l) => (l.deposito === 116 && l.codigo === "10000612" ? { ...l, leidoAt: "2026-11-18T19:40:00Z", error: "Zomatik no tiene movimientos desde el 02/11" } : l))
  const parcial = P.armarDespacho(datos(hoy, { lecturasStock: lecturas, despachos: [despacho("2026-11-16", 10, [{ nombre: "Piedra 6/20", kg: 50_000, kgSeco: 50_000 }])], produccion: [{ deposito: 116, fecha: "2026-11-16", producto: "X", articuloCodigo: 501, m3: 10 }] }))
  const pie = grupo(parcial, CAN, "piedras")
  assert.equal(pie.estado, "gris")
  assert.deepEqual(pie.lectura, { leidoAt: "2026-11-18T19:40:00Z", error: "Zomatik no tiene movimientos desde el 02/11" })
  assert.equal(parcial.semaforo.estado, "ambar")
  assert.deepEqual(parcial.lectura.sinLeer, ["Canning · Piedras"])
  // Nunca leído
  const nunca = P.armarDespacho(datos(hoy, { lecturaProduccion: null, lecturasStock: [] }))
  assert.equal(nunca.semaforo.estado, "ambar")
  assert.equal(nunca.lectura.leidoAt, null)
  assert.equal(nunca.lectura.sinLeer.length, 1 + 2 * 3)
  // Con una OF sin descontar, rojo aunque Zomatik no se haya leído
  const of = { fecha: "2026-11-18", plant_id: CAN, of_numero: "0001-00003459", m3: 7.5, of_estado: "ok", estado: "ok", of_mp_estado: "revisar", of_mp_mensaje: "x" }
  assert.equal(P.armarDespacho(datos(hoy, { lecturaProduccion: null, ofs: [of] })).semaforo.estado, "rojo")
  // Todo leído hoy y nada cargado: verde
  const limpio = P.armarDespacho(datos(hoy))
  assert.equal(limpio.semaforo.estado, "verde")
  assert.equal(limpio.lectura.alDia, true)
  assert.equal(limpio.lectura.leidoAt, `${hoy}T08:42:30Z`)
})

test("Criterio 4: lo de hoy nunca da color (despachos de hoy sin OF ni materia prima descontada)", () => {
  const hoy = "2026-11-20"
  const r = P.armarDespacho(datos(hoy, { despachos: [despacho(hoy, 32, [{ nombre: "CPC 40", kg: 12_000, kgSeco: null }])] }))
  assert.equal(r.semaforo.estado, "verde")
  assert.deepEqual(planta(r, CAN).m3.hoy, { sistema: 32, zomatik: 0 })
  assert.equal(grupo(r, CAN, "cemento").sistema, 0)
})

// ── 12. Mail ───────────────────────────────────────────────────────────────

const LINK = "https://www.produccionrebucret.com/materias-primas?tab=control-stock"
const sinNegritas = (h) => /<b>|<strong|font-weight:\s*(bold|[6-9]00)/.test(h) === false

test("12. Mail, todo bien: una línea verde y ninguna tabla; con ámbar, una línea gris más", () => {
  const m = P.seccionMailDespacho(P.armarDespacho(datos("2026-11-20")), LINK)
  assert.equal(m.asunto, null)
  assert.match(m.html, /Despacho contra Zomatik: todo bien\.<\/span> Del 13\/11 al 19\/11 coinciden los m³ y la materia prima, y no hay OF sin descontar\./)
  assert.equal(/<table/.test(m.html), false)
  assert.equal(m.html.includes("$"), false)
  assert.ok(sinNegritas(m.html))
  const ambar = P.seccionMailDespacho(
    P.armarDespacho(datos("2026-11-20", { plantas: [PLANTAS[1]], despachos: [despacho("2026-11-19", 14, [], { plantaId: HUD })] })),
    LINK,
  )
  assert.equal(ambar.asunto, null)
  assert.match(ambar.html, /todo bien/)
  assert.match(ambar.html, /Hudson: faltan OF por 14 m³ \(de ayer o anteayer, en plazo\)\./)
  assert.equal(/<table/.test(ambar.html), false)
})

test("12. Mail, con rojo: la línea, el detalle corto de lo que no coincide y el agregado del asunto; sin montos", () => {
  const r = P.armarDespacho(
    datos("2026-11-19", {
      despachos: [despacho("2026-11-14", 250, [{ nombre: "CPC 40", kg: 90_300, kgSeco: null }, { nombre: "Piedra 6/20", kg: 200_000, kgSeco: 200_000 }])],
      produccion: [{ deposito: 116, fecha: "2026-11-14", producto: "H30-620-10 C (CAN)", articuloCodigo: 501, m3: 250 }],
      movimientos: [rmi("10000026", "2026-11-13", 19.1), rmi("10000005", "2026-11-14", 199)],
      ofs: [
        { fecha: "2026-11-18", plant_id: CAN, of_numero: "0001-00003457", m3: 8, of_estado: "ok", estado: "ok", of_mp_estado: "pendiente", of_mp_mensaje: null },
        { fecha: "2026-11-18", plant_id: CAN, of_numero: "0001-00003459", m3: 7.5, of_estado: "ok", estado: "ok", of_mp_estado: "revisar", of_mp_mensaje: "El artículo de la OF no tiene composición en Zomatik" },
      ],
    }),
  )
  const m = P.seccionMailDespacho(r, LINK)
  assert.equal(m.asunto, " · Despacho contra Zomatik: hay diferencias")
  assert.match(m.html, /Despacho contra Zomatik: hay diferencias\./)
  assert.match(m.html, /Del 12\/11 al 18\/11\. Hoy no se cuenta\. Zomatik leído hoy 05:42\./)
  assert.match(m.html, /m³: coinciden en las dos plantas\./)
  assert.match(m.html, /Materia prima descontada \(t\)/)
  assert.match(m.html, /Canning<\/td><td [^>]*>Cemento<\/td><td [^>]*>90,3<\/td><td [^>]*>19,1<\/td><td [^>]*>faltan 71,2 t \(79 %\)<\/td>/)
  // Solo lo que no coincide: las piedras (199 contra 200) y Hudson no van
  assert.equal(/Piedras|Arenas|Hudson/.test(m.html), false)
  assert.match(m.html, /OF sin materia prima descontada \(2\)/)
  assert.match(m.html, /18\/11 · Canning · OF 0001-00003457 · 8 m³ · todavía sin descontar/)
  assert.match(m.html, /18\/11 · Canning · OF 0001-00003459 · 7,5 m³ · El artículo de la OF no tiene composición en Zomatik/)
  assert.match(m.html, new RegExp(`<a href="${LINK.replace(/[?.]/g, "\\$&")}"[^>]*>Ver el detalle</a>`))
  assert.equal(m.html.includes("$"), false)
  assert.ok(sinNegritas(m.html))
  // Los m³ que no coinciden, en una línea por planta
  const m3 = P.seccionMailDespacho(
    P.armarDespacho(
      datos("2026-11-20", {
        despachos: [despacho("2026-11-16", 253.5), despacho("2026-11-17", 12)],
        produccion: [{ deposito: 116, fecha: "2026-11-16", producto: "H30-620-10 C (CAN)", articuloCodigo: 501, m3: 253.5 }],
      }),
    ),
    LINK,
  )
  assert.match(m3.html, /Canning: el sistema despachó 265,5 m³ y Zomatik tiene OF por 253,5\. Faltan OF por 12 m³ \(17\/11\)\./)
  assert.match(m3.html, /Materia prima: coincide\./)
  assert.equal(/<table/.test(m3.html), false)
})

test("12. Mail, sin la lectura de hoy: 'no se pudo leer Zomatik hoy' y la última lectura", () => {
  const m = P.seccionMailDespacho(P.armarDespacho(datos("2026-11-20", { lecturaProduccion: { leidoAt: "2026-11-19T08:44:00Z", error: null } })), LINK)
  assert.equal(m.asunto, null)
  assert.match(m.html, /Despacho contra Zomatik: no se pudo leer Zomatik hoy\. Última lectura: 19\/11 05:44\. Falta: el reporte de producción\./)
  assert.equal(/todo bien/.test(m.html), false)
  assert.equal(/<table/.test(m.html), false)
  const nunca = P.seccionMailDespacho(P.armarDespacho(datos("2026-11-20", { lecturaProduccion: null, lecturasStock: [] })), LINK)
  assert.match(nunca.html, /no se pudo leer Zomatik hoy\. Última lectura: nunca\./)
  assert.equal(nunca.html.includes("$"), false)
})

test("Horas: 'hoy 05:44' o 'dd/mm hh:mm', en hora de Argentina", () => {
  assert.equal(P.horaArgentina("2026-11-20T08:44:10Z"), "05:44")
  assert.equal(P.cuandoSeLeyo("2026-11-20T08:44:10Z", "2026-11-20"), "hoy 05:44")
  assert.equal(P.cuandoSeLeyo("2026-11-20T01:10:00Z", "2026-11-20"), "19/11 22:10")
  assert.equal(P.cuandoSeLeyo(null, "2026-11-20"), "nunca")
})
