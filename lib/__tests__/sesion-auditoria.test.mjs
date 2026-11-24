// Auditoría de sesión (23/11/2026): aviso de borrado escapado y comparación de secretos del cron. Sin base ni red.
import { test } from "node:test"
import assert from "node:assert/strict"
import * as A from "../auth/aviso-borrado.ts"
import * as K from "../cron.ts"

// ---------------------------------------------------------------- aviso de borrado
test("escaparHtml: < > & comillas", () => {
  assert.equal(A.escaparHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;")
  assert.equal(A.escaparHtml(null), "")
  assert.equal(A.escaparHtml(12), "12")
})

test("aviso: lo que manda el navegador no entra como HTML (ni en el detalle ni en las claves)", () => {
  const { html, subject } = A.armarAvisoBorrado({
    usuario: "Juan Pérez",
    entidad: "<img src=x onerror=alert(1)>",
    referencia: '<a href="https://phishing.test">Entrá acá</a>',
    detalle: { "<b>Clave</b>": "<script>robar()</script>", Cliente: "Obra & Cía" },
    cuando: "23/11/2026, 10:00:00",
  })
  assert.ok(!html.includes("<img"), "entidad sin escapar")
  assert.ok(!html.includes('<a href="https://phishing.test"'), "referencia sin escapar")
  assert.ok(!html.includes("<script>"), "detalle sin escapar")
  assert.ok(!html.includes("<b>Clave</b>"), "clave del detalle sin escapar")
  assert.ok(html.includes("Obra &amp; Cía"))
  assert.ok(html.includes("Juan Pérez"))
  assert.ok(!/[\r\n]/.test(subject), "el asunto es de una línea")
  assert.match(subject, /— por Juan Pérez$/)
})

test("aviso: el usuario es el que pasa la ruta (de la sesión), no hay campo del navegador para eso", () => {
  const { html } = A.armarAvisoBorrado({ usuario: "Titan", entidad: "Despacho", referencia: "R-1", detalle: { usuario: "Bautista Caputo" }, cuando: "x" })
  // El "Usuario" del encabezado es Titan; lo que venga en el detalle queda como un dato más del registro
  assert.match(html, /Usuario<\/td>\s*<td[^>]*>Titan</)
})

test("aviso: detalle acotado (filas, largo, sin saltos) y basura tolerada", () => {
  const grande = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`c${i}`, "x".repeat(5000)]))
  const { html } = A.armarAvisoBorrado({ usuario: "A", entidad: "E", referencia: "R", detalle: grande, cuando: "x" })
  assert.equal((html.match(/<tr>/g) || []).length, 3 + A.MAX_FILAS_DETALLE)
  assert.ok(!html.includes("x".repeat(A.MAX_LARGO_TEXTO + 1)))
  for (const d of [null, undefined, "texto", 5, ["a"]]) {
    const r = A.armarAvisoBorrado({ usuario: "", entidad: null, referencia: undefined, detalle: d, cuando: "x" })
    assert.ok(r.html.includes("Desconocido"))
    assert.ok(!r.html.includes("Datos del registro eliminado"))
  }
  const obj = A.armarAvisoBorrado({ usuario: "A", entidad: "E", referencia: "R", detalle: { Materiales: { cemento: 300 } }, cuando: "x" })
  assert.ok(obj.html.includes("{&quot;cemento&quot;:300}"))
})

// ---------------------------------------------------------------- cron
test("igualSeguro: igual, distinto, largos distintos, vacíos y no texto", () => {
  assert.equal(K.igualSeguro("Bearer abc", "Bearer abc"), true)
  assert.equal(K.igualSeguro("Bearer abd", "Bearer abc"), false)
  assert.equal(K.igualSeguro("Bearer ab", "Bearer abc"), false)
  assert.equal(K.igualSeguro("Bearer abcd", "Bearer abc"), false)
  assert.equal(K.igualSeguro("", ""), true)
  assert.equal(K.igualSeguro("", "x"), false)
  assert.equal(K.igualSeguro(null, "x"), false)
  assert.equal(K.igualSeguro("x", undefined), false)
  assert.equal(K.igualSeguro("ñandú", "ñandú"), true)
  assert.equal(K.igualSeguro("ñandu", "ñandú"), false)
})

function pedido(headers) {
  return new Request("https://ejemplo.test/api/x", { headers })
}

test("esLlamadaDeCron: con CRON_SECRET solo el Bearer exacto (los headers de Vercel no alcanzan)", () => {
  const antes = process.env.CRON_SECRET
  process.env.CRON_SECRET = "secreto-de-prueba-123"
  try {
    assert.equal(K.esLlamadaDeCron(pedido({ authorization: "Bearer secreto-de-prueba-123" })), true)
    assert.equal(K.esLlamadaDeCron(pedido({ authorization: "Bearer secreto-de-prueba-12" })), false)
    assert.equal(K.esLlamadaDeCron(pedido({ authorization: "secreto-de-prueba-123" })), false)
    assert.equal(K.esLlamadaDeCron(pedido({ "x-vercel-cron": "1", "user-agent": "vercel-cron/1.0" })), false)
    assert.equal(K.esLlamadaDeCron(pedido({})), false)
  } finally {
    if (antes === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = antes
  }
})

test("esLlamadaDeCron: sin CRON_SECRET, como antes (headers de Vercel)", () => {
  const antes = process.env.CRON_SECRET
  delete process.env.CRON_SECRET
  try {
    assert.equal(K.esLlamadaDeCron(pedido({ "x-vercel-cron": "1" })), true)
    assert.equal(K.esLlamadaDeCron(pedido({ "user-agent": "vercel-cron/1.0" })), true)
    assert.equal(K.esLlamadaDeCron(pedido({ "user-agent": "Mozilla/5.0" })), false)
  } finally {
    if (antes !== undefined) process.env.CRON_SECRET = antes
  }
})
