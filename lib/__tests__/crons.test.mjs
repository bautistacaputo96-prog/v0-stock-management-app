// Auditoría de crons y APIs (23/11/2026): lo que se arregló, probado sin base ni red.
import { test } from "node:test"
import assert from "node:assert/strict"

const conHora = async (iso, fn) => {
  const real = Date.now
  Date.now = () => Date.parse(iso)
  try {
    return await fn()
  } finally {
    Date.now = real
  }
}

test("Controlar ahora no corre en la hora del cron diario (16:00–16:59 de Argentina)", async () => {
  const { POST } = await import("../../app/api/control-ingresos/controlar/route.ts")
  for (const iso of ["2026-11-23T19:00:00Z", "2026-11-23T19:25:00Z", "2026-11-23T19:59:59Z"]) {
    const r = await conHora(iso, () => POST())
    assert.equal(r.status, 409, iso)
    assert.match((await r.json()).error, /Entre las 16 y las 17 se actualiza solo/)
  }
})

test("Controlar ahora fuera de esa hora sigue al control de sesión (no 409)", async () => {
  const { POST } = await import("../../app/api/control-ingresos/controlar/route.ts")
  for (const iso of ["2026-11-23T18:59:00Z", "2026-11-23T20:00:00Z"]) {
    // Sin pedido HTTP no hay cookies: la sesión falla, pero no por la hora
    const r = await conHora(iso, () => POST())
    assert.notEqual(r.status, 409, iso)
  }
})

// ---------------------------------------------------------------------------
// Alertas de stock en 0 (lib/alertas-stock-cero.ts)
// ---------------------------------------------------------------------------
/** Base de mentira: cada tabla responde lo que se le diga y se anotan los update */
function baseFalsa(o) {
  const updates = []
  const from = (tabla) => {
    const q = { tabla, op: "select", cambios: null }
    const cadena = {
      update(c) { q.op = "update"; q.cambios = c; return cadena },
      select() { return cadena },
      is() { return cadena },
      eq() { return cadena },
      not() { return cadena },
      in() { return cadena },
      then(res, rej) {
        if (q.op === "update") updates.push({ tabla, cambios: q.cambios })
        let r
        if (tabla === "alertas_stock" && q.op === "update" && q.cambios.enviado_at) r = { data: o.alertas, error: null }
        else if (tabla === "alertas_stock") r = { data: null, error: null }
        else if (tabla === "app_users") r = { data: o.usuarios, error: null }
        else if (tabla === "materials") r = o.materiales
        return Promise.resolve(r).then(res, rej)
      },
    }
    return cadena
  }
  return { from, updates }
}
const ALERTA = [{ id: "a1", material_id: "m1", stock_al_alertar: 0, creado_at: "2026-11-23T12:00:00Z" }]
const GERENTE = [{ email: "g@x.com" }]
const devueltas = (sb) => sb.updates.filter((u) => u.tabla === "alertas_stock" && u.cambios.enviado_at === null).length

test("stock en 0: un error al leer los materiales no manda un mail vacío y devuelve las alertas", async () => {
  const { enviarPendientes } = await import("../alertas-stock-cero.ts")
  const sb = baseFalsa({ alertas: ALERTA, usuarios: GERENTE, materiales: { data: null, error: { message: "timeout" } } })
  const mails = []
  await assert.rejects(enviarPendientes(sb, async (m) => (mails.push(m), { ok: true })), { message: "timeout" })
  assert.equal(mails.length, 0)
  assert.equal(devueltas(sb), 1)
})

test("stock en 0: si falla la red al mandar, las alertas se devuelven (antes quedaban como mandadas)", async () => {
  const { enviarPendientes } = await import("../alertas-stock-cero.ts")
  const sb = baseFalsa({ alertas: ALERTA, usuarios: GERENTE, materiales: { data: [{ id: "m1", name: "Cemento", unit: "kg", current_stock: 0, plants: { name: "Canning" } }], error: null } })
  await assert.rejects(enviarPendientes(sb, async () => { throw new Error("fetch failed") }), /fetch failed/)
  assert.equal(devueltas(sb), 1)
})

test("stock en 0: Resend con error devuelve las alertas; bien, manda una vez con el material escapado", async () => {
  const { enviarPendientes } = await import("../alertas-stock-cero.ts")
  const mat = { data: [{ id: "m1", name: "Arena <fina>", unit: "kg", current_stock: -5, plants: { name: "Hudson" } }], error: null }
  const sb1 = baseFalsa({ alertas: ALERTA, usuarios: GERENTE, materiales: mat })
  await assert.rejects(enviarPendientes(sb1, async () => ({ ok: false, status: 500 })), /Resend respondió 500/)
  assert.equal(devueltas(sb1), 1)
  const sb2 = baseFalsa({ alertas: ALERTA, usuarios: GERENTE, materiales: mat })
  const mails = []
  assert.deepEqual(await enviarPendientes(sb2, async (m) => (mails.push(m), { ok: true })), { enviados: 1 })
  assert.equal(mails.length, 1)
  assert.deepEqual(mails[0].to, ["g@x.com"])
  assert.match(mails[0].html, /Arena &lt;fina&gt;/)
  assert.equal(devueltas(sb2), 0)
})

test("stock en 0: materiales que ya no existen no mandan un mail vacío", async () => {
  const { enviarPendientes } = await import("../alertas-stock-cero.ts")
  const sb = baseFalsa({ alertas: ALERTA, usuarios: GERENTE, materiales: { data: [], error: null } })
  const mails = []
  const r = await enviarPendientes(sb, async (m) => (mails.push(m), { ok: true }))
  assert.equal(r.enviados, 0)
  assert.equal(mails.length, 0)
})

test("stock en 0: sin pendientes no lee nada más; sin destinatarios o sin Resend, devuelve", async () => {
  const { enviarPendientes } = await import("../alertas-stock-cero.ts")
  assert.deepEqual(await enviarPendientes(baseFalsa({ alertas: [] }), async () => ({ ok: true })), { enviados: 0 })
  const sb = baseFalsa({ alertas: ALERTA, usuarios: [] })
  assert.equal((await enviarPendientes(sb, async () => ({ ok: true }))).motivo, "sin supervisores con mail")
  assert.equal(devueltas(sb), 1)
  const sb2 = baseFalsa({ alertas: ALERTA, usuarios: GERENTE })
  assert.equal((await enviarPendientes(sb2, null)).motivo, "falta RESEND_API_KEY")
  assert.equal(devueltas(sb2), 1)
})
