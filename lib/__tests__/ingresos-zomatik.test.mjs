// Pruebas de la importación de ingresos de MP desde Zomatik (docs/ingresos-mp-zomatik.md): clave de cada remito,
// cantidades, material, proveedor y flete, y el plan de cada pasada con lecturas sucesivas armadas desde los renglones
// reales de Zomatik (lib/__fixtures__/ingresos-zomatik/lecturas.json). F = 2026-10-20. Sin red ni base: lo que hace la
// base (mp_zomatik_aplicar) se imita acá con `aplicar` para probar las lecturas sucesivas y que el plan es idempotente.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as P from "../ingresos-zomatik/plan.ts"
import * as Mu from "../ingresos/muestras.ts"
import { libroDesdeRecuento } from "../control-stock/calculo.ts"
import { cruzar } from "../control-ingresos/cruce.ts"

const fx = JSON.parse(readFileSync(new URL("../__fixtures__/ingresos-zomatik/lecturas.json", import.meta.url), "utf8"))
const casos = JSON.parse(readFileSync(new URL("../__fixtures__/control-ingresos/casos.json", import.meta.url), "utf8"))
const T0 = Date.parse("2026-10-28T12:00:00Z")
const H = 3600_000

// ── Estado de la base (imitado) ──
function estadoInicial(stock = {}) {
  const entries = new Map(fx.manuales.map((m) => [m.id, { ...m, origen: null, anulado_at: null, humidity_percentage: null, dry_quantity: m.quantity }]))
  const materials = new Map(fx.materiales.map((m) => [m.id, { ...m, current_stock: stock[m.id] ?? 0, dry_stock: 0 }]))
  return { vinculos: new Map(), entries, materials, movs: [], inserts: 0, n: 0 }
}

function cambiarCantidad(st, id, kgNuevo, nota, anular, desanular) {
  const e = st.entries.get(id)
  const m = st.materials.get(e.material_id)
  const diff = Math.round((kgNuevo - e.quantity) * 100) / 100
  const secoViejo = e.dry_quantity ?? e.quantity
  const secoNuevo = e.humidity_percentage > 0 ? Math.round((kgNuevo / (1 + e.humidity_percentage / 100)) * 100) / 100 : kgNuevo
  e.quantity = kgNuevo
  e.dry_quantity = secoNuevo
  if (anular) e.anulado_at = "ahora"
  if (desanular) e.anulado_at = null
  m.current_stock = Math.round((m.current_stock + diff) * 100) / 100 // sin GREATEST(0, …)
  if (m.corrige_humedad) m.dry_stock = Math.round((m.dry_stock + secoNuevo - secoViejo) * 100) / 100
  if (diff !== 0) st.movs.push({ material_id: m.id, movement_type: "correccion_ingreso", quantity_kg: diff, reference_id: id, notes: nota })
}

function insertar(st, ing) {
  const id = `z${++st.n}`
  st.entries.set(id, { id, ...ing, fecha: ing.entry_date.slice(0, 10), plant_id: st.materials.get(ing.material_id).plant_id, origen: "zomatik", anulado_at: null, humidity_percentage: null, dry_quantity: ing.quantity })
  const m = st.materials.get(ing.material_id)
  m.current_stock += ing.quantity // el trigger
  if (m.corrige_humedad) m.dry_stock += ing.quantity
  st.inserts++
  return id
}

/** Lo que hace mp_zomatik_aplicar (supabase/migrations/202611061000_ingresos_mp_zomatik.sql). */
function aplicar(st, acciones, ahora) {
  for (const a of acciones) {
    const v = st.vinculos.get(a.clave)
    const datos = (x) => {
      const { proveedor_por_robot, limpiar_resolucion, ...r } = x
      return r
    }
    if (a.tipo === "alta") {
      if (v && (v.stock_entry_id || v.estado !== "pendiente")) continue
      const id = insertar(st, a.ingreso)
      st.vinculos.set(a.clave, { ...(v || {}), ...datos(a.vinculo), clave: a.clave, estado: "importado", stock_entry_id: id, kg_asentado: a.ingreso.quantity, proveedor_por_robot: true, motivo: null, motivo_codigo: null, falta_desde: null })
    } else if (a.tipo === "emparejar") {
      const e = st.entries.get(a.entry_id)
      assert.equal(e.quantity, a.kg_manual_visto)
      if (a.reemplazar && a.mover) {
        // Otra planta u otro material: se anula el manual con asiento y entra donde dice Zomatik
        cambiarCantidad(st, a.entry_id, 0, a.nota, true)
        const id = insertar(st, a.ingreso)
        st.vinculos.set(a.clave, { ...(v || {}), ...datos(a.vinculo), clave: a.clave, estado: "importado", stock_entry_id: id, kg_asentado: a.ingreso.quantity, era_manual: true, proveedor_por_robot: true, falta_desde: null })
        continue
      }
      if (a.reemplazar) {
        e.origen = "zomatik"
        if (a.kg_nuevo !== null) cambiarCantidad(st, a.entry_id, a.kg_nuevo, a.nota)
      }
      st.vinculos.set(a.clave, { ...(v || {}), ...datos(a.vinculo), clave: a.clave, estado: a.reemplazar ? "importado" : "emparejado", stock_entry_id: a.entry_id, kg_asentado: e.quantity, era_manual: true, proveedor_por_robot: false, falta_desde: null })
    } else if (a.tipo === "corregir") {
      assert.equal(v.kg_asentado, a.kg_visto)
      cambiarCantidad(st, a.entry_id, a.kg_nuevo, a.nota, false, a.desanular)
      Object.assign(v, datos(a.vinculo), { kg_asentado: a.kg_nuevo, estado: "importado", falta_desde: null })
    } else if (a.tipo === "anular") {
      assert.equal(v.kg_asentado, a.kg_visto)
      cambiarCantidad(st, a.entry_id, 0, a.nota, true)
      Object.assign(v, { estado: "anulado", kg_asentado: 0, falta_desde: null })
    } else if (a.tipo === "mover") {
      if (a.anular_viejo) cambiarCantidad(st, a.entry_id, 0, a.nota, true)
      const id = insertar(st, a.ingreso)
      Object.assign(v, datos(a.vinculo), { estado: "importado", stock_entry_id: id, kg_asentado: a.ingreso.quantity, falta_desde: null, proveedor_por_robot: true })
    } else if (a.tipo === "pendiente") {
      st.vinculos.set(a.clave, { ...(v || { stock_entry_id: null, kg_asentado: null }), ...datos(a.vinculo), clave: a.clave, estado: "pendiente", ...(a.vinculo.limpiar_resolucion ? { resolucion: null } : {}) })
    } else if (a.tipo === "descartar") {
      if (v) Object.assign(v, { estado: "descartado", motivo: a.motivo })
    } else if (a.tipo === "actualizar") {
      const x = { ...a.vinculo }
      if (x.falta_desde === "ahora") x.falta_desde = new Date(ahora).toISOString()
      Object.assign(v, x)
      if (a.ingreso && v.stock_entry_id) Object.assign(st.entries.get(v.stock_entry_id), a.ingreso)
    }
  }
}

function entrada(st, filas, o = {}) {
  return {
    filas,
    diasLeidos: o.dias || fx.diasLeidos,
    vinculos: [...st.vinculos.values()].map((v) => ({ ...v })),
    manuales: [...st.entries.values()].filter((e) => e.origen !== "zomatik" && !e.anulado_at).map((e) => ({ id: e.id, fecha: e.fecha, material_id: e.material_id, plant_id: e.plant_id, quantity: e.quantity, remito: e.remito })),
    materiales: fx.materiales,
    proveedores: fx.proveedores,
    materialProveedores: fx.materialProveedores,
    fletes: fx.fletes,
    plantas: fx.plantas,
    desde: o.desde || fx.desde,
    ahora: o.ahora ?? T0,
    densidades: o.densidades || {},
  }
}

const pasada = (st, filas, o = {}) => {
  const r = P.planImportacion(entrada(st, filas, o))
  aplicar(st, r.acciones, o.ahora ?? T0)
  return r
}
const deClave = (r, re) => r.acciones.filter((a) => re.test(a.clave))
const base = fx.lecturas.base

// ── Normalizaciones ──
test("claveRemito: número completo con punto de venta + artículo; sin número → null", () => {
  assert.equal(P.claveRemito("RMP 0002-00318903", "10000004"), "2-318903|10000004")
  assert.equal(P.claveRemito("RMP 0000-00000000", "10000004"), null)
  assert.equal(P.claveRemito("000000", "10000004"), null)
  assert.equal(P.claveRemito("RMP 0002-00318903", null, "CCTS ARENA ESPECIAL"), "2-318903|ARENA ESPECIAL")
  assert.equal(P.claveRemito("00880839", "10000005"), "880839|10000005")
})

test("kgDeZomatik: toneladas → kg, de 1 a 60 t", () => {
  assert.deepEqual(P.kgDeZomatik(40.14), { ok: true, kg: 40140 })
  assert.deepEqual(P.kgDeZomatik(40140), { ok: false, motivo: "Cantidad rara (40.140 t)" })
  assert.equal(P.kgDeZomatik(0.5).ok, false)
})

test("cantidadParaMaterial: aditivos en litros o tachos de 1000 L, con densidad si el material está en kg; fibra en kg", () => {
  const sika90 = fx.materiales.find((m) => m.id === "CAN-sika90")
  const sika33 = fx.materiales.find((m) => m.id === "CAN-sika33")
  const fibra = fx.materiales.find((m) => m.id === "CAN-fibra")
  assert.deepEqual(P.cantidadParaMaterial(800, "l", sika90, {}), { ok: false, codigo: "densidad", motivo: "Falta la densidad de Sikament 90E" })
  assert.deepEqual(P.cantidadParaMaterial(800, "l", sika90, { "CAN-sika90": 1.2 }), { ok: true, cantidad: 960 })
  assert.deepEqual(P.cantidadParaMaterial(2, "tacho", sika33, {}), { ok: true, cantidad: 2000 })
  assert.deepEqual(P.cantidadParaMaterial(250, "kg", fibra, {}), { ok: true, cantidad: 250 })
  // 5 litros o menos: seguramente son tachos
  assert.deepEqual(P.cantidadParaMaterial(3, "l", sika33, {}), { ok: false, codigo: "tachos", motivo: "¿Son tachos? Revisar" })
  assert.equal(P.unidadZomatik("sikament_33s", "CCTS SIKAMENT 33 S TACHO 1000 L"), "tacho")
  assert.equal(P.unidadZomatik("sikament_90e", "CCTS SIKAMENT 90 E"), "l")
  assert.equal(P.unidadZomatik("fibra", "FIBRA"), "kg")
  assert.equal(P.unidadZomatik("arena_fina", "CCTS ARENA ESPECIAL"), "t")
})

test("resolverMaterial: por código y por nombre, de la planta; malla → sin material", () => {
  const r1 = P.resolverMaterial({ articulo: "CCTS PIEDRA 06", codigo: "10000001" }, "CAN", fx.materiales)
  assert.equal(r1.estado === "ok" && r1.material.name, "Arena Trituración 0/6")
  const r2 = P.resolverMaterial({ articulo: "PIEDRA 6-12", codigo: "10000612" }, "HUD", fx.materiales)
  assert.equal(r2.estado === "ok" && r2.material.id, "HUD-piedra-612")
  assert.equal(P.resolverMaterial({ articulo: "CCTS MALLA SIMA Q188", codigo: "10000099" }, "CAN", fx.materiales).estado, "sin_material")
  const r3 = P.resolverMaterial({ articulo: "CCTS ARENA ESPECIAL", codigo: "10000004" }, "CAN", fx.materiales.filter((m) => m.id !== "CAN-arena-fina"), "Canning")
  assert.equal(r3.estado === "no_encontrado" && r3.motivo, "Material no encontrado en Canning (Arena fina)")
})

test("resolverProveedor y resolverFlete", () => {
  const p = (n) => ({ id: n, name: n })
  assert.equal(P.resolverProveedor("BLINKI S A", [p("BLINKI")]), "BLINKI")
  assert.equal(P.resolverProveedor("FENOMIX - MATERIALES SAN FERNANDO", [p("CEMENTOS AVELLANEDA"), p("FENOMIX MATERIALES")]), "FENOMIX MATERIALES")
  assert.equal(P.resolverProveedor("FENOMIX - MATERIALES SAN FERNANDO", [p("CEMENTOS AVELLANEDA")]), "CEMENTOS AVELLANEDA")
  assert.equal(P.resolverProveedor("FENOMIX - MATERIALES SAN FERNANDO", []), null)
  assert.equal(P.resolverProveedor("Guerrico", [], [p("GUERRICO S.A.")]), "GUERRICO S.A.")
  assert.equal(P.resolverFlete("Proveedor con flete incluido", [{ id: "x", name: "Flete incluido", supplier_id: "s" }]), null)
  assert.equal(P.resolverFlete("Transporte Mengarelli sh · Juan", fx.fletes), "f-mengarelli")
})

test("leerInterruptor: sin fila o mal escrito → apagado; sombra y real con la fecha", () => {
  assert.deepEqual(P.leerInterruptor(null), { modo: "apagado", desde: null })
  assert.deepEqual(P.leerInterruptor("{mal"), { modo: "apagado", desde: null })
  assert.deepEqual(P.leerInterruptor('{"modo":"sombra","desde":"2026-11-09"}'), { modo: "sombra", desde: "2026-11-09" })
  assert.equal(P.importacionActiva(P.leerInterruptor('{"modo":"real","desde":"2026-11-16"}'), "2026-11-15"), false)
  assert.equal(P.importacionActiva(P.leerInterruptor('{"modo":"real","desde":"2026-11-16"}'), "2026-11-16"), true)
})

// ── El plan (criterios 1 a 13) ──
test("Criterios 1 a 8 y 13: la primera pasada con F = 20/10", () => {
  const st = estadoInicial()
  const r = pasada(st, base)
  const una = (re) => {
    const xs = deClave(r, re)
    assert.equal(xs.length, 1, `${re}: ${xs.map((x) => x.tipo).join(", ")}`)
    return xs[0]
  }
  // 1. Alta
  const alta = una(/^2-319500\|/)
  assert.equal(alta.tipo, "alta")
  assert.deepEqual(alta.ingreso, { material_id: "CAN-arena-fina", quantity: 38100, supplier_id: "p-blinki", supplier: null, carrier_id: null, remito: "0002-00319500", entry_date: "2026-10-21T12:00:00Z" })
  const e1 = st.entries.get(st.vinculos.get(alta.clave).stock_entry_id)
  assert.equal(e1.created_by ?? "Zomatik", "Zomatik")
  assert.equal(e1.origen, "zomatik")
  // 2. Emparejados sin duplicar (y desde F pasan a ser el importado)
  const e318903 = una(/^2-318903\|/)
  assert.equal(e318903.tipo, "emparejar")
  assert.equal(e318903.entry_id, "e-318903")
  assert.equal(e318903.kg_nuevo, null)
  assert.equal(e318903.reemplazar, true)
  const cem = una(/^2-2742081\|/)
  assert.equal(cem.tipo, "emparejar")
  assert.equal(cem.entry_id, "e-2742081")
  assert.equal(cem.kg_nuevo, null)
  // 3. Emparejado con corrección (cargado en t)
  const c319043 = una(/^2-319043\|/)
  assert.equal(c319043.tipo, "emparejar")
  assert.equal(c319043.kg_nuevo, 43100)
  const mov = st.movs.find((m) => m.reference_id === "e-319043")
  assert.equal(mov.quantity_kg, 43056.46)
  assert.match(mov.notes, /RMP 0002-00319043 BLINKI/)
  assert.equal(st.entries.get("e-319043").quantity, 43100)
  // 4. Posible duplicado: número mal escrito
  const d4 = una(/^2-2730799\|/)
  assert.equal(d4.tipo, "pendiente")
  assert.equal(d4.vinculo.motivo, "¿Mismo camión que el ingreso manual del 23/10?")
  assert.equal(d4.vinculo.candidato_id, "4bcd5fc0-175a-42d8-816a-b4f656823538")
  // 5. Borde de F, otra planta
  const d5 = una(/^2-880839\|/)
  assert.equal(d5.tipo, "pendiente")
  assert.equal(d5.vinculo.motivo, "¿Mismo camión que el ingreso manual del 19/10 (Hudson)?")
  // 6. Repetido
  const rep = deClave(r, /^2-318913\|/)
  assert.deepEqual(rep.map((x) => x.tipo).sort(), ["emparejar", "pendiente"])
  assert.equal(rep.find((x) => x.tipo === "emparejar").entry_id, "e-318913")
  assert.equal(rep.find((x) => x.tipo === "pendiente").vinculo.motivo, "Remito repetido en Zomatik")
  // 7. Sin número
  assert.equal(una(/^sn\|/).vinculo.motivo, "Remito sin número")
  // 8. Sin depósito; gasoil y malla: ni ingreso ni pendiente
  assert.equal(una(/^2-319777\|/).vinculo.motivo, "Depósito sin planta")
  assert.equal(deClave(r, /12345|55555/).length, 0)
  assert.deepEqual(r.sinMaterial.map((a) => a.articulo).sort(), ["CCTS MALLA SIMA Q188", "GASOIL GRADO 2"])
  // 13. Antes de F nada
  assert.equal(deClave(r, /^(3717|109-164613|109-65063|2-317949|2-880159|2-318633)\|/).length, 0)
  // Aditivos y fibra: sin densidad pendiente; litros y tachos; fibra en kg (sin proveedor vinculado, entra igual)
  assert.equal(una(/^5-1234\|/).vinculo.motivo, "Falta la densidad de Sikament 90E")
  assert.equal(una(/^5-1235\|/).ingreso.quantity, 2000)
  const fib = una(/^7-77\|/)
  assert.equal(fib.ingreso.quantity, 250)
  assert.equal(fib.ingreso.supplier_id, null)
  assert.equal(fib.ingreso.supplier, "MACCAFERRI")
  assert.ok(r.proveedoresSinVincular.some((p) => p.proveedor === "MACCAFERRI"))
  // Stock: el alta suma una vez (la hace el trigger), el emparejado no
  assert.equal(st.inserts, deClave(r, /./).filter((a) => a.tipo === "alta").length)
  const casi = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} ≠ ${b}`)
  casi(st.materials.get("CAN-arena-fina").current_stock, 38100 + 43056.46 + (38400 - 38.4))
  casi(st.materials.get("CAN-arena-fina").dry_stock, 38100 + 43056.46 + (38400 - 38.4))
})

test("Criterio 12: el plan sobre lo aplicado da 0 acciones", () => {
  const st = estadoInicial()
  pasada(st, base)
  const r2 = P.planImportacion(entrada(st, base))
  assert.deepEqual(r2.acciones.map((a) => `${a.tipo} ${a.clave}`), [])
  assert.ok(r2.resumen.sin_importar > 0) // los pendientes siguen, sin acciones
})

test("Criterio 9: corrección de Zomatik con asiento", () => {
  const st = estadoInicial()
  pasada(st, base)
  const antes = st.materials.get("CAN-arena-fina").current_stock
  const r = pasada(st, fx.lecturas.corregida)
  assert.deepEqual(r.acciones.map((a) => a.tipo), ["corregir"])
  const v = [...st.vinculos.values()].find((x) => x.clave.startsWith("2-319500|"))
  assert.equal(st.entries.get(v.stock_entry_id).quantity, 38500)
  assert.equal(st.materials.get("CAN-arena-fina").current_stock, antes + 400)
  assert.equal(st.movs.at(-1).quantity_kg, 400)
  assert.equal(st.movs.at(-1).notes, "Corregido en Zomatik: RMP 0002-00319500 BLINKI, 38,10 t → 38,50 t")
  assert.equal(P.planImportacion(entrada(st, fx.lecturas.corregida)).acciones.length, 0)
})

test("Criterio 10: anulación recién con dos lecturas separadas 2 h; sin el día leído no pasa nada; no recorta a 0", () => {
  const st = estadoInicial({ "CAN-arena-fina": -200000 })
  pasada(st, base)
  const v = () => [...st.vinculos.values()].find((x) => x.clave.startsWith("2-319500|"))
  const stock0 = st.materials.get("CAN-arena-fina").current_stock
  // Sin el 21/10 leído: nada
  assert.equal(P.planImportacion(entrada(st, fx.lecturas.anulada, { dias: fx.diasLeidos.filter((d) => d !== "2026-10-21") })).acciones.length, 0)
  // 1ª vez: solo falta_desde
  const r1 = pasada(st, fx.lecturas.anulada, { ahora: T0 })
  assert.deepEqual(r1.acciones.map((a) => a.tipo), ["actualizar"])
  assert.ok(v().falta_desde)
  assert.equal(st.materials.get("CAN-arena-fina").current_stock, stock0)
  // 1 h después: nada
  assert.equal(P.planImportacion(entrada(st, fx.lecturas.anulada, { ahora: T0 + H })).acciones.length, 0)
  // 2 h después: anula
  const r2 = pasada(st, fx.lecturas.anulada, { ahora: T0 + 2 * H })
  assert.deepEqual(r2.acciones.map((a) => a.tipo), ["anular"])
  const e = st.entries.get(v().stock_entry_id)
  assert.equal(e.quantity, 0)
  assert.ok(e.anulado_at)
  assert.equal(Math.round((st.materials.get("CAN-arena-fina").current_stock - (stock0 - 38100)) * 100), 0)
  assert.ok(st.materials.get("CAN-arena-fina").current_stock < stock0 && stock0 < 0) // con stock negativo resta igual (sin GREATEST(0, …))
  assert.equal(st.movs.at(-1).quantity_kg, -38100)
  assert.equal(st.movs.at(-1).notes, "Anulado en Zomatik: RMP 0002-00319500 BLINKI, 38,10 t")
  // Si reaparece, se des-anula con otro asiento
  const r3 = pasada(st, base, { ahora: T0 + 3 * H })
  assert.deepEqual(r3.acciones.map((a) => a.tipo), ["corregir"])
  assert.equal(st.entries.get(v().stock_entry_id).anulado_at, null)
  assert.equal(Math.round((st.materials.get("CAN-arena-fina").current_stock - stock0) * 100), 0)
})

test("Si reaparece antes de las 2 h, se limpia falta_desde", () => {
  const st = estadoInicial()
  pasada(st, base)
  pasada(st, fx.lecturas.anulada, { ahora: T0 })
  const r = pasada(st, base, { ahora: T0 + H })
  assert.deepEqual(r.acciones.map((a) => a.tipo), ["actualizar"])
  assert.equal([...st.vinculos.values()].find((x) => x.clave.startsWith("2-319500|")).falta_desde, null)
})

test("Criterio 11: cambio de planta → anula en Canning y da de alta en Hudson", () => {
  const st = estadoInicial()
  pasada(st, base)
  const can = st.materials.get("CAN-arena-fina").current_stock
  const r = pasada(st, fx.lecturas.movida)
  assert.deepEqual(r.acciones.map((a) => a.tipo), ["mover"])
  assert.equal(st.materials.get("CAN-arena-fina").current_stock, can - 38100)
  assert.equal(st.materials.get("HUD-arena-fina").current_stock, 38100)
  assert.equal(P.planImportacion(entrada(st, fx.lecturas.movida)).acciones.length, 0)
})

test("Resolver un pendiente: es el mismo / son distintos / descartar", () => {
  const st = estadoInicial()
  pasada(st, base)
  const clave = [...st.vinculos.keys()].find((k) => k.startsWith("2-2730799|"))
  st.vinculos.get(clave).resolucion = "mismo"
  const r = pasada(st, base)
  assert.deepEqual(r.acciones.map((a) => a.tipo), ["emparejar"])
  assert.equal(r.acciones[0].kg_nuevo, 36390) // se cargó 36,39 "kg"
  // "Son distintos": no se vuelve a proponer ese ingreso; si hay otro parecido (3410 del 14/10, 30,44 t) se propone ese
  const c5 = [...st.vinculos.keys()].find((k) => k.startsWith("2-880839|"))
  const distintos = () => {
    const v = st.vinculos.get(c5)
    v.rechazados = [...(v.rechazados || []), v.candidato_id]
    v.resolucion = "distintos"
  }
  distintos()
  const r5 = pasada(st, base)
  assert.deepEqual(r5.acciones.map((a) => a.tipo), ["pendiente"])
  assert.equal(st.vinculos.get(c5).candidato_id, "98139dd2-4618-4059-9cec-3cc14438330e")
  assert.equal(st.vinculos.get(c5).resolucion, null)
  assert.equal(P.planImportacion(entrada(st, base)).acciones.length, 0)
  distintos()
  assert.deepEqual(pasada(st, base).acciones.map((a) => a.tipo), ["alta"])
  const cs = [...st.vinculos.keys()].find((k) => k.startsWith("sn|"))
  st.vinculos.get(cs).resolucion = "descartar"
  assert.deepEqual(pasada(st, base).acciones.map((a) => a.tipo), ["descartar"])
  assert.equal(P.planImportacion(entrada(st, base)).acciones.length, 0)
})

test("\"Es el mismo\" con un manual de otra planta: se anula el manual con asiento y entra donde dice Zomatik", () => {
  const st = estadoInicial()
  pasada(st, base)
  // 880839: manual en Hudson (19/10, ≥ F − 10 pero < F) y Zomatik en Canning. Con un manual desde F:
  const m = st.entries.get("4855c974-e9b0-4f7c-9157-2839ea125242")
  m.fecha = "2026-10-20"
  const clave = [...st.vinculos.keys()].find((k) => k.startsWith("2-880839|"))
  st.vinculos.get(clave).resolucion = "mismo"
  const hud = st.materials.get("HUD-piedra-620").current_stock
  const can = st.materials.get("CAN-piedra-620").current_stock
  const r = pasada(st, base)
  assert.deepEqual(r.acciones.map((a) => `${a.tipo}${a.mover ? ":mover" : ""}`), ["emparejar:mover"])
  assert.equal(m.quantity, 0)
  assert.ok(m.anulado_at)
  assert.equal(st.materials.get("HUD-piedra-620").current_stock, hud - 30420)
  assert.equal(st.materials.get("CAN-piedra-620").current_stock, can + 30420)
  assert.match(st.movs.at(-1).notes, /Era el mismo camión que Zomatik/)
  assert.equal(P.planImportacion(entrada(st, base)).acciones.length, 0)
})

test("Si cambia la densidad, se corrige el aditivo importado con la nota de la densidad", () => {
  const st = estadoInicial()
  pasada(st, base, { densidades: { "CAN-sika90": 1.2 } })
  const r = pasada(st, base, { densidades: { "CAN-sika90": 1.25 } })
  assert.deepEqual(r.acciones.map((a) => a.tipo), ["corregir"])
  assert.equal(r.acciones[0].kg_nuevo, 1000)
  assert.match(r.acciones[0].nota, /^Densidad de Sikament 90E cambiada de 1,2 a 1,25 kg\/L/)
})

test("Posible copia de un importado: mismo remito completo y material, sin vincular", () => {
  assert.equal(P.mismoRemitoCompleto("00002 00318903", "RMP 0002-00318903"), true)
  assert.equal(P.mismoRemitoCompleto("318903", "RMP 0002-00318903"), false) // sin punto de venta no se puede decir
  assert.equal(P.mismoRemitoCompleto("0003-00318903", "RMP 0002-00318903"), false)
  assert.equal(P.mismoRemitoCompleto("0000-00000000", "0000-00000000"), false)
  const st = estadoInicial()
  pasada(st, base)
  const imp = [...st.vinculos.values()].find((v) => v.clave.startsWith("2-319500|"))
  // Alguien carga a mano el mismo camión después de que entró desde Zomatik
  const copia = { id: "copia", material_id: "CAN-arena-fina", remito: "0002-00319500" }
  const otroMaterial = { id: "otro", material_id: "CAN-arena-06", remito: "0002-00319500" }
  const sinPv = { id: "sinpv", material_id: "CAN-arena-fina", remito: "319500" }
  const yaVinculado = { id: imp.stock_entry_id, material_id: "CAN-arena-fina", remito: "0002-00319500" }
  const r = P.posiblesCopias([copia, otroMaterial, sinPv, yaVinculado], [...st.vinculos.values()])
  assert.deepEqual(r.map((x) => [x.id, x.remitoZomatik]), [["copia", "RMP 0002-00319500"]])
  // También contra un emparejado (el manual 318903 de la primera pasada)
  assert.deepEqual(P.posiblesCopias([{ id: "c2", material_id: "CAN-arena-fina", remito: "2-318903" }], [...st.vinculos.values()]).map((x) => x.id), ["c2"])
  // Los pendientes no cuentan
  assert.equal(P.posiblesCopias([{ id: "c3", material_id: "CAN-cpc40", remito: "0002-02730799" }], [...st.vinculos.values()]).length, 0)
})

test("Un importado que borraron a mano no se vuelve a importar", () => {
  const st = estadoInicial()
  pasada(st, base)
  const v = [...st.vinculos.values()].find((x) => x.clave.startsWith("2-319500|"))
  st.entries.delete(v.stock_entry_id)
  v.stock_entry_id = null // ON DELETE SET NULL
  const r = pasada(st, base)
  assert.deepEqual(r.acciones.map((a) => `${a.tipo}:${a.vinculo?.motivo}`), ["pendiente:Borrado a mano en Rebucret"])
  assert.equal(P.planImportacion(entrada(st, base)).acciones.length, 0)
})

test("Con la densidad cargada, el aditivo pendiente entra", () => {
  const st = estadoInicial()
  pasada(st, base)
  const r = pasada(st, base, { densidades: { "CAN-sika90": 1.2 } })
  assert.deepEqual(r.acciones.map((a) => a.tipo), ["alta"])
  assert.equal(r.acciones[0].ingreso.quantity, 960)
})

test("Sombra: el plan no cambia el estado; el resumen dice qué pasaría", () => {
  const st = estadoInicial()
  const r = P.planImportacion(entrada(st, base))
  assert.equal(st.vinculos.size, 0)
  assert.equal(st.inserts, 0)
  assert.match(P.textoResumen(r.resumen), /^\d+ nuevos, \d+ emparejados, .*\d+ sin importar$/)
})

// ── Humedad desde el historial (criterio 14) ──
test("efectosHumedad: 40140 kg al 5 % → seco 38228,57, dry_stock −1911,43, excedente 2 % = 802,8 kg", () => {
  const r = Mu.efectosHumedad({ quantity: 40140, dryViejo: 40140, humedad: 5 })
  assert.equal(r.dryNuevo, 38228.57)
  assert.equal(r.dryDiff, -1911.43)
  assert.deepEqual(r.exceso, { pct: 2, kg: 802.8, tn: 0.8028 })
  assert.equal(Mu.efectosHumedad({ quantity: 40140, dryViejo: 40140, humedad: 2.5 }).exceso, null)
  assert.equal(Mu.calcularHumedad(475), 5.26)
})

// ── Libro desde el último recuento (criterio 15) ──
test("libroDesdeRecuento: una corrección después del recuento de un ingreso anterior no es ajuste sin registro", () => {
  const rc = { nuevoKg: 100000, creadoAt: "2026-10-22T10:00:00Z" }
  // Ingreso creado el 21 (antes del recuento) por 38100, corregido el 23 a 38500: current_stock = 100000 + 400
  const movs = [{ fecha: "2026-10-21", tipo: "entrada", kg: 38500, creadoAt: "2026-10-21T15:00:00Z" }]
  const sin = libroDesdeRecuento(100400, rc, movs)
  assert.equal(sin.sinRegistroKg, 400) // antes: aparecía como ajuste sin registro
  const con = libroDesdeRecuento(100400, rc, movs, [{ kg: 400, creadoAt: "2026-10-23T10:00:00Z", ingresoCreadoAt: "2026-10-21T15:00:00Z" }])
  assert.equal(con.sinRegistroKg, 0)
  assert.equal(con.correccionesAnteriores, 1)
  // Si el ingreso se creó después del recuento, el libro ya usa la cantidad nueva: la corrección no se suma
  const despues = libroDesdeRecuento(138500, rc, [{ fecha: "2026-10-23", tipo: "entrada", kg: 38500, creadoAt: "2026-10-23T09:00:00Z" }], [{ kg: 400, creadoAt: "2026-10-23T10:00:00Z", ingresoCreadoAt: "2026-10-23T09:00:00Z" }])
  assert.equal(despues.sinRegistroKg, 0)
})

// ── Cruce viejo solo antes de F (criterio 16) ──
test("cruzar con hasta: con todo lo ≥ F importado o emparejado no informa nada de fechas ≥ F", () => {
  const st = estadoInicial()
  pasada(st, base)
  const vinculadas = new Set([...st.vinculos.values()].map((v) => v.stock_entry_id).filter(Boolean))
  const claves = new Set([...st.vinculos.values()].filter((v) => v.estado !== "pendiente").map((v) => v.remito))
  const nuestros = casos.nuestros.filter((n) => !vinculadas.has(n.id))
  const zomatik = casos.zomatik.filter((z) => !claves.has(z.remito))
  const difs = cruzar(nuestros, zomatik, { hoy: casos.hoy, hasta: "2026-10-19" })
  for (const d of difs) assert.ok([...d.nuestro, ...d.zomatik].some((l) => l.fecha < "2026-10-20"), `${d.clave}`)
  assert.ok(difs.length > 0)
})

// ── Mail del control con la importación prendida (fase 2) ──
test("Mail: asunto y secciones de la importación; el cruce viejo queda como 'Antes del F'", async () => {
  const M = await import("../control-ingresos/mail.ts")
  assert.equal(M.asuntoImportacion({ pendientes: 2, cambios: 1, manuales: 0, inconsistencias: 0 }), "Rebucret · Ingresos MP: 2 sin importar, 1 cambio")
  assert.equal(M.asuntoImportacion({ pendientes: 0, cambios: 0, manuales: 0, inconsistencias: 0 }), "Rebucret · Ingresos MP: sin novedades hoy")
  assert.equal(M.asuntoImportacion({ pendientes: 0, cambios: 0, manuales: 0, inconsistencias: 0, copias: 1 }), "Rebucret · Ingresos MP: 1 posible copia")
  const im = {
    desde: "2026-11-16",
    pendientes: [{ fecha: "2026-11-17", remito: "RMP 0002-00319777", proveedor: "BLINKI S A", cantidad: "39,50 t", planta: "otro depósito", motivo: "Depósito sin planta", queHacer: "Corregí el depósito en Zomatik (Canning o REBUCRET)" }],
    cambios: [{ fecha: "2026-11-17", material: "Arena Fina", planta: "Canning", kg: 400, nota: "Corregido en Zomatik: RMP 0002-00319500 BLINKI, 38,10 t → 38,50 t" }],
    antesDeF: [],
    manuales: [],
    sinMaterial: [],
    sinVincular: [{ proveedor: "MACCAFERRI", renglones: 1 }],
    faltaDensidad: [{ material: "Sikament 90E", planta: "Canning" }],
    copias: [{ fecha: "2026-11-17", material: "Arena Fina", planta: "Canning", cantidad: 38100, unidad: "kg", remito: "0002-00319500", cargadoPor: "Fernando", remitoZomatik: "RMP 0002-00319500" }],
  }
  const { asunto, html } = M.armarMail({ tipo: "diario", nuevas: [], link: "x", hoy: "2026-11-18", importacion: im })
  assert.equal(asunto, "Rebucret · Ingresos MP: 1 sin importar, 1 cambio, 1 posible copia")
  for (const t of ["No se pudo importar (1)", "Posible copia de un importado (para eliminar) (1)", "Cambios de Zomatik (1)", "Falta la densidad (1)", "Proveedores sin vincular", "38,10 t → 38,50 t"]) assert.ok(html.includes(t), t)
  assert.ok(!/<b>|<strong>|font-weight:bold/.test(html))
  // Sin la importación, el mail de siempre
  assert.equal(M.armarMail({ tipo: "diario", nuevas: [], link: "x", hoy: "2026-11-18" }).asunto, "Rebucret · Control de ingresos MP: sin inconsistencias hoy")
})
