/**
 * Carga de planta · ayudas para las rutas /api/carga/* (SOLO servidor).
 *
 * - Toda ruta pide la sesión de la 0c-1, el interruptor de funciones nuevas (la pantalla está en prueba) y el permiso
 *   que corresponde (carga.ver / carga.cargar / carga.editar, o formulas.editar para resolver una receta).
 * - Escribe con la clave de servicio: el navegador solo puede leer estas tablas.
 * - Nada de esto habla con la planta: en esta etapa la planta es el simulador, que corre en el navegador de la PC de
 *   la planta. No existe ninguna ruta que haga arrancar algo.
 */
import { NextResponse } from "next/server"
import { exigirSesion, respuestaModoLocal, sbServicio, type Sesion } from "@/lib/auth/servidor"
import { puedeCon, type Accion, type SeccionClave } from "@/lib/permisos"
import { bloqueoDe, cargarContexto, cargarFormulas, controlDeFormula, type Contexto, type Puesto } from "@/lib/carga/datos"

type Exigido = { sesion: Sesion; usuario: string; respuesta?: undefined } | { sesion?: undefined; usuario?: undefined; respuesta: NextResponse }

export const error = (texto: string, status = 400) => NextResponse.json({ error: texto }, { status })

/** Sesión + funciones nuevas + permiso. `escribe`: en el modo de prueba local no se graba nada. */
export async function exigirCarga(seccion: SeccionClave, accion: Accion, opts: { escribe?: boolean } = {}): Promise<Exigido> {
  const r = await exigirSesion()
  if (r.respuesta) return { respuesta: r.respuesta }
  const s = r.sesion
  if (s.usuario.ve_funciones_nuevas !== true) return { respuesta: error("La carga de planta está en prueba: solo la ven los usuarios con las funciones nuevas.", 403) }
  if (!puedeCon(s.usuario, seccion, accion)) return { respuesta: error("No tenés permiso para hacer esto.", 403) }
  if (opts.escribe !== false && s.local) return { respuesta: respuestaModoLocal() }
  return { sesion: s, usuario: s.usuario.name }
}

/** "12:41" en hora de Argentina */
export function hhmmAR(d: string | number | Date = new Date()): string {
  return new Date(d).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false })
}

/** Una hora que manda la pantalla (la del puente). Si no viene o es rara (futuro o más de 2 días atrás), ahora. */
export function horaPuente(at: unknown): string {
  const t = typeof at === "string" || typeof at === "number" ? new Date(at).getTime() : NaN
  const ahora = Date.now()
  if (!Number.isFinite(t) || t > ahora + 2 * 60_000 || t < ahora - 2 * 86400_000) return new Date(ahora).toISOString()
  return new Date(t).toISOString()
}

/** Graba un evento. Con `pedido` repetido (se subió dos veces) devuelve false y no graba. */
export async function registrarEvento(e: { carga_id: string | null; puesto_id: string; tipo: string; at?: string; detalle?: Record<string, unknown> | null; usuario?: string | null; pedido?: string | null }): Promise<boolean> {
  const { error: err } = await sbServicio().from("cargas_eventos").insert({
    carga_id: e.carga_id, puesto_id: e.puesto_id, tipo: e.tipo, at: e.at || new Date().toISOString(), detalle: e.detalle ?? null, usuario: e.usuario ?? null, pedido: e.pedido ?? null,
  })
  if (err) {
    if ((err as { code?: string }).code === "23505") return false
    throw err
  }
  return true
}

/** ¿Ya se procesó este pedido de la pantalla? (idempotencia de las acciones que se reintentan sin internet) */
export async function yaProcesado(pedido: string | null | undefined): Promise<boolean> {
  if (!pedido) return false
  const { data } = await sbServicio().from("cargas_eventos").select("id").eq("pedido", pedido).limit(1)
  return !!data?.length
}

/**
 * Recalcula el control de receta de las cargas que esperan en la cola del puesto (después de leer recetas, cambiar la
 * Tolva 1 o resolver una alerta) y las pasa a "bloqueada" o "pendiente".
 */
export async function recalcularBloqueos(ctx: Contexto): Promise<number> {
  const sb = sbServicio()
  const { data } = await sb.from("cargas").select("id, estado, formula_id, autorizacion").eq("puesto_id", ctx.puesto.id).in("estado", ["pendiente", "bloqueada", "lista"])
  const cargas = (data || []) as { id: string; estado: string; formula_id: string | null; autorizacion: { por: string; motivo?: string } | null }[]
  if (!cargas.length) return 0
  const formulas = await cargarFormulas(sb, [...new Set(cargas.map((c) => c.formula_id).filter(Boolean) as string[])])
  let n = 0
  for (const c of cargas) {
    const f = formulas.find((x) => x.id === c.formula_id) || null
    const ctl = controlDeFormula(ctx, f, c.autorizacion)
    const estado = ctl.frena ? "bloqueada" : "pendiente"
    await sb.from("cargas").update({ bloqueo: bloqueoDe(ctl), agua_distinta: ctl.aguaDistinta, estado, receta_numero: ctl.numero }).eq("id", c.id)
    if (estado !== c.estado) n++
  }
  return n
}

/**
 * Una alerta abierta por receta y fórmula (6.5): se abre cuando la receta de la planta no es igual a la fórmula
 * asignada (roja si frena; ámbar si es solo el agua) y se cierra sola cuando el puente lee la receta corregida.
 */
export async function sincronizarAlertasReceta(ctx: Contexto, leidaAt: string): Promise<{ abiertas: number; cerradas: number }> {
  const sb = sbServicio()
  const ids = ctx.asignaciones.map((a) => a.formula_id).filter(Boolean) as string[]
  const formulas = await cargarFormulas(sb, ids)
  const { data } = await sb.from("alertas_carga").select("id, receta_numero, formula_id, estado").eq("puesto_id", ctx.puesto.id).eq("tipo", "receta_no_coincide").in("estado", ["abierta", "esperando_planta"])
  const abiertas = (data || []) as { id: string; receta_numero: number; formula_id: string; estado: string }[]
  let nuevas = 0, cerradas = 0
  for (const a of ctx.asignaciones) {
    if (!a.formula_id) continue
    const f = formulas.find((x) => x.id === a.formula_id)
    const receta = ctx.recetas.find((r) => r.numero === a.numero)
    if (!f || !receta) continue
    const ctl = controlDeFormula(ctx, f)
    const ya = abiertas.find((x) => x.receta_numero === a.numero && x.formula_id === a.formula_id)
    // La Tolva 1 no es un problema de receta: se controla aparte (y se corrige en la tolva)
    const coincide = !!ctl.cmp?.ok
    if (!coincide && ctl.cmp && !ya) {
      const soloAgua = !ctl.frenaReceta && ctl.aguaDistinta
      const { error: err } = await sb.from("alertas_carga").insert({
        puesto_id: ctx.puesto.id, tipo: "receta_no_coincide", formula_id: f.id, receta_numero: a.numero, receta_planta_id: receta.id,
        titulo: soloAgua ? `Receta ${a.numero}: el agua no es igual a ${f.code} (no frena)` : `La receta ${a.numero} de la planta no coincide con ${f.code}`,
        detalle: { frena: ctl.frenaReceta, agua: ctl.aguaDistinta, motivo: ctl.motivo, items: bloqueoDe(ctl).items, simulada: ctx.puesto.sistema === "simulador" },
      })
      if (!err) nuevas++
    } else if (coincide && ya) {
      await sb.from("alertas_carga").update({ estado: "cerrada_sola", resuelta_at: new Date().toISOString(), motivo: `Corregida en la planta · leída ${hhmmAR(leidaAt)}`, updated_at: new Date().toISOString() }).eq("id", ya.id)
      cerradas++
    }
  }
  return { abiertas: nuevas, cerradas }
}

/** Contexto del puesto con la clave de servicio. */
export const contextoServidor = (p: Puesto) => cargarContexto(sbServicio(), p)

const FROM = process.env.REPORTE_CALIDAD_FROM || "reportes@produccionrebucret.com"
/** A quién va el mail de "despacho con la carga frenada" (20.1): Juan Oreguy. */
export const AVISO_FRENADA_A = ["Juan Oreguy"]

const esc = (t: unknown) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!))

/**
 * Mail (Resend, como app/api/alertas/stock-cero) cuando se despacha igual un viaje cuya receta frena la carga.
 * Nunca corta la operación: devuelve a quién se mandó o por qué no.
 */
export async function mailDespachoFrenado(d: {
  simulada: boolean; planta: string; remito: string; camion: string; formula: string; receta: number | null; motivo: string; items: { texto: string; ok: boolean; aviso?: boolean }[]; por: string
}): Promise<{ enviado: boolean; a: string[]; motivo?: string }> {
  try {
    const sb = sbServicio()
    const { data } = await sb.from("app_users").select("name, email").eq("active", true).not("email", "is", null)
    const a = ((data || []) as { name: string; email: string }[]).filter((u) => AVISO_FRENADA_A.some((n) => n.toLowerCase() === u.name.trim().toLowerCase())).map((u) => u.email)
    if (!a.length) return { enviado: false, a, motivo: "Juan Oreguy no tiene mail cargado" }
    if (!process.env.RESEND_API_KEY) return { enviado: false, a, motivo: "falta RESEND_API_KEY" }
    const sim = d.simulada ? "[PLANTA SIMULADA] " : ""
    const titulo = `${sim}Despacho con la carga frenada: ${d.formula} · remito ${d.remito}`
    const filas = d.items.filter((i) => !i.ok || i.aviso).map((i) => `<li style="margin:3px 0;color:${i.ok ? "#92400e" : "#b91c1c"}">${esc(i.texto)}</li>`).join("")
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
        <div style="background:#b91c1c;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0">
          <div style="font-size:15px;font-weight:700">${esc(titulo)}</div>
          <div style="opacity:.85;font-size:12px;margin-top:2px">Se despachó igual: la carga va a quedar frenada en la planta hasta que se resuelva</div>
        </div>
        <div style="border:1px solid #e2e8f0;border-top:none;padding:14px 18px;border-radius:0 0 8px 8px;font-size:13px">
          ${d.simulada ? `<p style="background:#fef3c7;padding:6px 8px;border-radius:6px;color:#78350f;margin:0 0 10px"><b>Planta simulada</b>: es una prueba de la pantalla de carga, no mueve la planta real.</p>` : ""}
          <p style="margin:0 0 6px"><b>Planta:</b> ${esc(d.planta)} · <b>Remito:</b> ${esc(d.remito)} · <b>Camión:</b> ${esc(d.camion)}</p>
          <p style="margin:0 0 6px"><b>Fórmula:</b> ${esc(d.formula)} · <b>Receta de la planta:</b> ${d.receta ?? "sin receta"}</p>
          <p style="margin:0 0 4px"><b>Qué no coincide:</b></p>
          <ul style="margin:0 0 8px;padding-left:18px">${filas || `<li>${esc(d.motivo)}</li>`}</ul>
          <p style="margin:0">Despachó: ${esc(d.por)} · ${hhmmAR()}. Se resuelve desde Carga de planta › Alertas (Fórmulas · editar).</p>
          <p style="font-size:11px;color:#94a3b8;margin-top:14px">produccionrebucret.com</p>
        </div>
      </div>`
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `Rebucret - Alertas <${FROM}>`, to: a, subject: `Rebucret · ${titulo}`, html }),
    })
    if (!r.ok) return { enviado: false, a, motivo: `Resend respondió ${r.status}` }
    return { enviado: true, a }
  } catch (e) {
    return { enviado: false, a: [], motivo: (e as Error)?.message || "no se pudo mandar" }
  }
}
