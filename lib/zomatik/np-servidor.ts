/**
 * Zomatik · Z2 · Nota de pedido: el lado del servidor (SOLO rutas de app/api). Spec: zomatik.md, secciones 22 a 24.
 *
 *   sincronizarPedido  mira el pedido y sus NP, decide con `planificarNp` (np.ts) qué crear, vaciar o anular y lo deja
 *                      en `zomatik_np` como "pendiente" / "vaciar". No habla con Zomatik.
 *   procesarNp         toma el turno del robot (una sola sesión a la vez) y trabaja las NP pendientes con
 *                      `np-robot.ts`, guardando cada paso. Lo llaman "Programar y generar NP" (después de responder),
 *                      "Generar NP ahora" y la pasada cada 10 min.
 *
 * LLAVE: con `zomatik_np_config.activo` apagado (por defecto) no se crea ninguna NP ni se llama a Zomatik para
 * escribir: `llaveDe()` es el único lugar que arma la llave que pide `navegadorNp()`. La llave, el modo y la elección
 * del pedido (`zomatik_np_pedido`) viven en tablas que solo escribe el servidor (la clave anon no las toca).
 *
 * Tiempo: cada función de Vercel tiene 60 s. `procesarNp` mide desde que empezó el request (`inicio`) y no arranca una
 * NP si quedan menos de 30 s; el turno del robot se renueva en cada paso. Cada guardado del robot pide que la NP siga
 * "generando"/"vaciando" (si otro la cambió en el medio, no se pisa y se avisa).
 */
import { sbServicio } from "@/lib/auth/servidor"
import { CLAVE_BLOQUEO_LOGIN, discoverForm, fetchExport, navegadorLectura, navegadorNp, obtenerSesion, mensajeZomatik } from "@/lib/zomatik/cliente"
import { renglonesRemitos } from "@/lib/zomatik/parseo"
import { errorInterno } from "@/lib/zomatik/z1-robot"
import { autorizarNp, buscarNpEnZomatik, generarNp, vaciarNp, type DatosNp, type LecturaNp, type LlaveNp, type NavegadorNp, type ResultadoAutorizar, type ResultadoNp } from "@/lib/zomatik/np-robot"
import { SUCURSAL_REBUCRET, esFaltaDeVinculo, quedaTiempo, trabajoPendiente } from "@/lib/zomatik/np"
import {
  MIN_REINTENTO, PASOS_GRABADA, VIGENTES, comprobanteDe, puedeEstarGrabada, comprobanteDeNumero, diaAR, esSerieRebucret, hoyAR, marcaNp, modoNp, numeroNormalizado,
  pedidoConNp, planificarNp, controlDespacho, npConSaldo, saldoNp, type EstadoNp, type FilaNp, type ModoNp, type PlantaNp, type SaldoNp, type TipoNp, type UsoPlan, type UsoSaldo,
} from "@/lib/zomatik/np"

type SB = ReturnType<typeof sbServicio>

export type FilaNpDB = FilaNp & {
  scheduled_dispatch_id: string | null
  marca: string
  es_adicional: boolean
  paso: string | null
  mensaje: string | null
  numero: string | null
  zomatik_codigo: number | null
  sucursal: string | null
  disponible_m3: number | null
  intentos: number
  proximo_intento: string | null
  en_curso_desde: string | null
  created_at: string
  updated_at: string
  saldo_decision?: string | null
  saldo_mensaje?: string | null
  saldo_desde?: string | null
  fecha_zomatik?: string | null
  vendedor_usuario_id?: string | null
}

export const COLUMNAS_NP =
  "id, scheduled_dispatch_id, n, marca, tipo, es_adicional, proyecto_codigo, plant_id, client_id, formula_id, fecha, m3, estado, paso, mensaje, numero, zomatik_codigo, sucursal, disponible_m3, intentos, proximo_intento, en_curso_desde, created_at, updated_at, saldo_decision, saldo_mensaje, saldo_desde, fecha_zomatik, vendedor_usuario_id"

const COLUMNAS_PEDIDO =
  "id, status, quantity_m3, plant_id, client_id, construction_site_id, formula_id, scheduled_arrival_time, created_at, created_by"

export type PlantaNpDB = PlantaNp & { id: string; name: string; zomatik_deposito: number | null }

/** ¿Falta la migración de Z2? (las rutas responden "apagado" en vez de romper). */
export const faltaMigracion = (e: unknown) => /\b(zomatik_np(_config|_pedido|_excepciones)?|zomatik_np_tomar|zomatik_robot_tomar|zomatik_robot_soltar|zomatik_np_uso|zomatik_vendedores|saldo_decision|saldo_mensaje|saldo_desde|fecha_zomatik|vendedor_usuario_id|despachado_fijo|zomatik_np_reservar|zomatik_np_devolver|zomatik_np_desvincular|codigo_sistema|disponible_m3|disponible_articulo|disponible_at|zomatik_proyecto_codigo)\b/i.test(String((e as { message?: string })?.message || ""))

// ---------------------------------------------------------------------------
// Plantas y llave
// ---------------------------------------------------------------------------

type ConfigDB = { plant_id: string; activo: boolean; desde: string | null; deposito: number | null; exigir_np: string | null; aviso_hasta: string | null }

/** Plantas con su llave (de `zomatik_np_config`; sin fila = apagada). Sin la migración: vacío (todo apagado). */
export async function plantasNp(sb: SB = sbServicio()): Promise<Record<string, PlantaNpDB>> {
  const [pl, cfg] = await Promise.all([sb.from("plants").select("id, name"), sb.from("zomatik_np_config").select("plant_id, activo, desde, deposito, exigir_np, aviso_hasta")])
  if (cfg.error) {
    if (faltaMigracion(cfg.error)) return {}
    throw cfg.error
  }
  if (pl.error) throw pl.error
  const porPlanta = new Map(((cfg.data as ConfigDB[]) || []).map((c) => [c.plant_id, c]))
  return Object.fromEntries(
    ((pl.data as { id: string; name: string }[]) || []).map((p) => {
      const c = porPlanta.get(p.id)
      return [p.id, { id: p.id, name: p.name, zomatik_np_activo: c?.activo === true, zomatik_np_desde: c?.desde ?? null, zomatik_deposito: c?.deposito ?? null, exigir_np: c?.exigir_np ?? "aviso", aviso_hasta: c?.aviso_hasta ?? null }]
    }),
  )
}

/** El ÚNICO lugar que arma la llave para escribir en Zomatik: solo con la llave de la planta prendida en la base. */
export function llaveDe(planta: PlantaNpDB | undefined): LlaveNp | null {
  return planta?.zomatik_np_activo === true ? { activo: true, plantId: planta.id } : null
}

export function modoDe(planta: PlantaNpDB | undefined): ModoNp {
  return modoNp(planta, hoyAR())
}

// ---------------------------------------------------------------------------
// Actividad y avisos
// ---------------------------------------------------------------------------

export async function actividadNp(sb: SB, o: { usuario: string; action?: "crear" | "editar" | "borrar"; pedidoId: string | null; plantId?: string | null; referencia: string; detalle: Record<string, unknown> }) {
  try {
    const { error } = await sb.from("activity_log").insert({
      user_name: o.usuario, action: o.action || "editar", entity: "zomatik_np", entity_id: o.pedidoId, reference: o.referencia, plant_id: o.plantId ?? null, details: o.detalle,
    })
    if (error) console.error("[zomatik-np] actividad:", error.message)
  } catch (e) {
    console.error("[zomatik-np] actividad:", e)
  }
}

/** Los que autorizan y revisan (20.1.2): reciben el aviso por mail cuando una NP queda "revisar". */
export const GERENCIALES_NP = ["Bautista Caputo", "Juan Oreguy", "Fernando Maldonado"]
const FROM = process.env.REPORTE_CALIDAD_FROM || "reportes@produccionrebucret.com"
const esc = (t: unknown) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)

/** Aviso en el momento a los gerenciales (mail por Resend, como las alertas). Nunca corta la operación. */
export async function avisarGerenciales(sb: SB, titulo: string, lineas: string[]): Promise<{ enviado: boolean; motivo?: string }> {
  return mandarAviso(sb, GERENCIALES_NP, "los gerenciales no tienen mail cargado", titulo, lineas)
}

/** Quien recibe los errores del robot de Zomatik (NP, OF o remito que no salieron) para resolverlos (04/11). */
export const AVISO_ERRORES_ZOMATIK = ["Bautista Caputo"]

/**
 * Aviso de un error del robot de Zomatik, solo a Bautista (mismo mail y From que `avisarGerenciales`). El pedido ya
 * quedó guardado: el mail es para que lo resuelva. Nunca corta la operación.
 */
export async function avisarErrorZomatik(sb: SB, titulo: string, lineas: string[]): Promise<{ enviado: boolean; motivo?: string }> {
  return mandarAviso(sb, AVISO_ERRORES_ZOMATIK, "Bautista no tiene mail cargado", titulo, lineas)
}

/**
 * Quien recibe el aviso de una NP con factura al finalizar el pedido (hay que hacer la devolución a mano y ver si va
 * una nota de crédito). Decisión de Bautista del 06/11: solo Juan (sumar a alguien es una línea).
 */
export const AVISO_AJUSTE_NP = ["Juan Oreguy"]

/** Aviso a Juan de una NP con factura (docs/specs/2026-11-06-ajustar-np-al-finalizar.md, 6 y 15.6). Nunca corta la operación. */
export async function avisarAjusteNp(sb: SB, titulo: string, lineas: string[]): Promise<{ enviado: boolean; motivo?: string }> {
  return mandarAviso(sb, AVISO_AJUSTE_NP, "sin mail", titulo, lineas)
}

async function mandarAviso(sb: SB, nombres: string[], sinMail: string, titulo: string, lineas: string[]): Promise<{ enviado: boolean; motivo?: string }> {
  try {
    if (!process.env.RESEND_API_KEY) return { enviado: false, motivo: "falta RESEND_API_KEY" }
    const { data } = await sb.from("app_users").select("name, email").eq("active", true).not("email", "is", null)
    const a = ((data || []) as { name: string; email: string }[]).filter((u) => nombres.some((n) => n.toLowerCase() === u.name.trim().toLowerCase())).map((u) => u.email)
    if (!a.length) return { enviado: false, motivo: sinMail }
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
      <div style="background:#b45309;color:#fff;padding:12px 16px;border-radius:8px 8px 0 0;font-weight:700">${esc(titulo)}</div>
      <div style="border:1px solid #e2e8f0;border-top:none;padding:12px 16px;border-radius:0 0 8px 8px;font-size:13px">
      ${lineas.map((l) => `<p style="margin:0 0 6px">${esc(l)}</p>`).join("")}
      <p style="font-size:11px;color:#94a3b8;margin-top:12px">Programación › NP · produccionrebucret.com</p></div></div>`
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `Rebucret - Zomatik <${FROM}>`, to: a, subject: `Rebucret · ${titulo}`, html }),
      // Que un Resend lento no se coma el tiempo del robot (la función tiene 60 s)
      signal: AbortSignal.timeout(8000),
    })
    return r.ok ? { enviado: true } : { enviado: false, motivo: `Resend respondió ${r.status}` }
  } catch (e) {
    return { enviado: false, motivo: (e as Error)?.message || "no se pudo mandar" }
  }
}

export type AvisarFn = (sb: SB, titulo: string, lineas: string[]) => Promise<{ enviado: boolean; motivo?: string }>

/** Códigos de `ZomatikError` que son "no se puede entrar o hablar con Zomatik": un solo problema para todo el robot. */
const CODIGOS_ACCESO = ["sin_credenciales", "login_rechazado", "login_bloqueado", "sesion_caida", "sin_respuesta"]
export const esFallaDeAcceso = (e: unknown) => CODIGOS_ACCESO.includes(String((e as { codigo?: unknown } | null)?.codigo ?? ""))
/** ¿La excepción es de Zomatik (trae el `codigo` de `ZomatikError`) o nuestra (base, código)? */
export const esDeZomatik = (e: unknown) => typeof (e as { codigo?: unknown } | null)?.codigo === "string"
/** Tipo de una excepción, para comparar episodios: el código de `ZomatikError` o "interno" (no el texto, que cambia). */
export const tipoDeFalla = (e: unknown) => {
  const c = (e as { codigo?: unknown } | null)?.codigo
  return typeof c === "string" ? c : "interno"
}

/**
 * Clave de `integraciones`: el robot no puede entrar a Zomatik y ya se le avisó a Bautista. `valor` = desde cuándo;
 * `actualizado` = el último mail (el primero o el recordatorio de cada 24 h).
 */
export const CLAVE_AVISO_ENTRADA = "zomatik_aviso_entrada"
/** Cada cuánto se recuerda que Zomatik sigue sin dejar entrar (así la clave no queda pegada para siempre). */
export const RECORDATORIO_ENTRADA_MS = 24 * 60 * 60_000
const horaAR = (iso: string) => new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" })

/**
 * ¿Hay un bloqueo de login por una entrada que falló de verdad? (`zomatik_login_bloqueado`, lo graba `login()` en
 * cliente.ts). Si no está, un `login_bloqueado` es solo la espera de 10 min entre entradas del proceso: la última entrada
 * anduvo y no es una falla de entrada.
 */
async function hayBloqueoDeLogin(sb: SB): Promise<boolean> {
  const { data } = await sb.from("integraciones").select("valor").eq("clave", CLAVE_BLOQUEO_LOGIN).maybeSingle()
  const hasta = Date.parse((data as { valor?: string } | null)?.valor || "")
  return Number.isFinite(hasta) && hasta > Date.now()
}

/**
 * El robot no puede entrar a Zomatik (usuario, sesión, red): UN aviso para todo el robot (NP y Z1 juntos), no uno por
 * fila. La marca queda en `integraciones` y se borra cuando vuelve a entrar (`avisarZomatikVolvio`); si sigue más de
 * 24 h, un recordatorio y se renueva. Devuelve "enviado" (mail de ahora), "ya" (ya se había avisado) o "no" (no salió
 * el mail, o no era una falla de entrada: se vuelve a mirar en la próxima).
 */
export async function avisarFallaAcceso(sb: SB, avisar: AvisarFn, o: { que: string; mensaje: string; codigo?: string }): Promise<"enviado" | "ya" | "no"> {
  try {
    const { data } = await sb.from("integraciones").select("valor, actualizado").eq("clave", CLAVE_AVISO_ENTRADA).maybeSingle()
    const ya = data as { valor: string; actualizado: string | null } | null
    if (ya) {
      // Sigue caída: nada más, salvo el recordatorio cada 24 h (lo manda un solo proceso: el que renueva la fecha)
      const ultimo = ya.actualizado || ya.valor
      if (Date.now() - Date.parse(ultimo) <= RECORDATORIO_ENTRADA_MS) return "ya"
      const ahora = new Date().toISOString()
      const q = sb.from("integraciones").update({ actualizado: ahora } as never).eq("clave", CLAVE_AVISO_ENTRADA)
      const { data: renovada } = await (ya.actualizado ? q.eq("actualizado", ya.actualizado) : q).select("clave")
      if (!((renovada as unknown[] | null) || []).length) return "ya"
      const r = await avisar(sb, `Zomatik sigue sin dejar entrar (desde ${horaAR(ya.valor)})`, [
        `El robot no puede entrar a Zomatik desde ${horaAR(ya.valor)}.`,
        `Último intento: ${o.que}`,
        `Mensaje: ${o.mensaje}`,
        "Las NP, OF y remitos siguen pendientes. Este recordatorio llega cada 24 horas mientras siga.",
        "Si habla de usuario o clave: revisar ZOMATIK_USER / ZOMATIK_PASS en Vercel.",
      ])
      if (r.enviado) return "enviado"
      console.error("[zomatik] recordatorio de entrada:", r.motivo)
      await sb.from("integraciones").update({ actualizado: ultimo } as never).eq("clave", CLAVE_AVISO_ENTRADA).eq("actualizado", ahora) // se vuelve a probar
      return "ya"
    }
    // "Ya se intentó entrar hace menos de 10 min": si la última entrada anduvo, no es una falla (sin falso "volvió")
    if (o.codigo === "login_bloqueado" && !(await hayBloqueoDeLogin(sb))) return "no"
    const ahora = new Date().toISOString()
    // La clave es única: si otro proceso la grabó recién (23505), este no manda otro mail. Otro error: el mail va igual
    const { error } = await sb.from("integraciones").insert({ clave: CLAVE_AVISO_ENTRADA, valor: ahora, actualizado: ahora, conectado_por: "sistema" } as never)
    if (error && (error as { code?: string }).code === "23505") return "ya"
    if (error) console.error("[zomatik] no se pudo grabar la marca de entrada:", error.message)
    const r = await avisar(sb, "Zomatik: el robot no puede entrar", [
      `Desde: ${horaAR(ahora)}`,
      `Qué se estaba haciendo: ${o.que}`,
      `Mensaje: ${o.mensaje}`,
      "Las NP, OF y remitos quedan pendientes y se retoman en la próxima pasada cuando Zomatik vuelva a andar.",
      "No llegan más mails de esto mientras siga (salvo un recordatorio cada 24 horas). Cuando vuelva a entrar, llega uno corto.",
      "Si habla de usuario o clave: revisar ZOMATIK_USER / ZOMATIK_PASS en Vercel.",
    ])
    if (r.enviado) return "enviado"
    console.error("[zomatik] aviso de entrada:", r.motivo)
    if (!error) await sb.from("integraciones").delete().eq("clave", CLAVE_AVISO_ENTRADA)
    return "no"
  } catch (e) {
    console.error("[zomatik] aviso de entrada:", (e as Error)?.message)
    return "no"
  }
}

/** El robot volvió a entrar a Zomatik: si se había avisado la falla, se borra la marca y llega un mail corto. */
export async function avisarZomatikVolvio(sb: SB, avisar: AvisarFn): Promise<void> {
  try {
    const { data } = await sb.from("integraciones").delete().eq("clave", CLAVE_AVISO_ENTRADA).select("valor")
    const fila = ((data as { valor: string }[] | null) || [])[0]
    if (!fila) return
    const r = await avisar(sb, "Zomatik volvió a andar", [`El robot volvió a entrar a Zomatik (no podía desde ${horaAR(fila.valor)}).`, "Lo que quedó pendiente se retoma en la próxima pasada."])
    if (!r.enviado) console.error("[zomatik] aviso de que volvió:", r.motivo)
  } catch (e) {
    console.error("[zomatik] aviso de que volvió:", (e as Error)?.message)
  }
}

/**
 * Una falla inesperada de un botón o del robot que corre después de responder (rutas de NP y remito). Si es de entrada a
 * Zomatik, va el aviso único del robot (uno solo mientras siga). Devuelve si Bautista ya está avisado (el mail salió
 * ahora o ya se había avisado la caída). Nunca tira.
 */
export async function avisarFallaInesperada(e: unknown, titulo: string, lineas: (mensaje: string) => string[], sb?: SB): Promise<boolean> {
  try {
    const m = errorInterno(e) ?? mensajeZomatik(e)
    const s = sb ?? sbServicio()
    if (esFallaDeAcceso(e)) return (await avisarFallaAcceso(s, avisarErrorZomatik, { que: titulo, mensaje: m, codigo: tipoDeFalla(e) })) !== "no"
    const r = await avisarErrorZomatik(s, titulo, lineas(m))
    if (!r.enviado) console.error("[zomatik] aviso de la falla:", r.motivo)
    return r.enviado
  } catch (err) {
    console.error("[zomatik] aviso de la falla", (err as Error)?.message)
    return false
  }
}

/**
 * Actividad de una fila del robot (NP o remito), lo más nuevo primero. Se filtra por la marca en la base
 * (`details->>Marca`), así una marca vieja no queda afuera por otras entradas del mismo pedido.
 */
async function actividadDeFila(sb: SB, ref: string, marca: string): Promise<Record<string, unknown>[]> {
  const { data } = await sb.from("activity_log").select("details, created_at").eq("entity", "zomatik_np").eq("reference", ref).eq("details->>Marca", marca).order("created_at", { ascending: false }).limit(50)
  return ((data as { details: Record<string, unknown> | null }[] | null) || []).map((x) => x.details || {}).filter((d) => d.Marca === marca)
}

/** Lo que queda en Actividad cuando se mandó (o no) un aviso: "no" no cuenta como avisado y se vuelve a probar. */
const avisado = (r: { enviado: boolean }) => (r.enviado ? "sí" : "no")

/** "Qué pasó" de la Actividad cuando el robot se cae con una excepción (la fila vuelve a "pendiente"). */
export const QUE_CAIDA = "El robot se cayó"
/** "Qué pasó" de la Actividad cuando una fila lleva más de 1 hora pendiente (una vez por fila). */
export const QUE_PENDIENTE_LARGO = "Pendiente hace más de 1 hora"

type FilaAviso = { usuario: string; pedidoId: string | null; plantId?: string | null; ref: string; marca: string; titulo: string; lineas: string[] }

/**
 * El robot se cayó con una excepción en una fila (que no es de entrada a Zomatik): aviso a Bautista, uno por episodio.
 * `firma` = tipo de falla + paso. Si lo último de la fila en Actividad ya es esta misma caída, no se repite.
 */
export async function avisarCaidaFila(sb: SB, avisar: AvisarFn, o: FilaAviso & { firma: string; mensaje: string; paso: string | null; quePaso?: string }): Promise<boolean> {
  try {
    // Solo las caídas llevan Firma: si lo último de la fila es esta misma caída, es el mismo episodio
    // (si el mail de esa caída no salió, "Avisado: no", se vuelve a probar)
    const ultimo = (await actividadDeFila(sb, o.ref, o.marca))[0]
    if (ultimo?.Firma === o.firma && ultimo.Avisado !== "no") return false
    const r = await avisar(sb, o.titulo, o.lineas)
    if (!r.enviado) console.error("[zomatik] aviso de la caída:", r.motivo)
    await actividadNp(sb, { usuario: o.usuario, pedidoId: o.pedidoId, plantId: o.plantId, referencia: o.ref, detalle: { "Qué pasó": o.quePaso || QUE_CAIDA, Mensaje: o.mensaje, Paso: o.paso, Marca: o.marca, Firma: o.firma, Avisado: avisado(r) } })
    return r.enviado
  } catch (e) {
    console.error("[zomatik] aviso de la caída:", (e as Error)?.message)
    return false
  }
}

/** Intentos y antigüedad para avisar una fila que sigue pendiente (sin cambios de base: created_at e intentos). */
export const PENDIENTE_LARGO_MS = 60 * 60_000
export const PENDIENTE_LARGO_INTENTOS = 2

/**
 * Una NP o un remito que sigue "pendiente" por red o sesión hace más de 1 hora (desde que se creó la fila, con al menos
 * un reintento): aviso a Bautista, UNA vez por fila (la marca queda en Actividad). Con la entrada a Zomatik caída ya
 * llegó el aviso general: no se manda uno por fila.
 */
export async function avisarPendienteLargo(sb: SB, avisar: AvisarFn, o: FilaAviso & { creada: string; intentos: number }): Promise<boolean> {
  try {
    if (o.intentos < PENDIENTE_LARGO_INTENTOS || !(Date.now() - Date.parse(o.creada) > PENDIENTE_LARGO_MS)) return false
    const { data: caida } = await sb.from("integraciones").select("valor").eq("clave", CLAVE_AVISO_ENTRADA).maybeSingle()
    if (caida) return false
    // Una vez por fila: solo cuenta el aviso que salió ("Avisado: no" se vuelve a probar en el próximo intento)
    if ((await actividadDeFila(sb, o.ref, o.marca)).some((d) => d["Qué pasó"] === QUE_PENDIENTE_LARGO && d.Avisado !== "no")) return false
    const r = await avisar(sb, o.titulo, o.lineas)
    if (!r.enviado) console.error("[zomatik] aviso de pendiente:", r.motivo)
    await actividadNp(sb, { usuario: o.usuario, pedidoId: o.pedidoId, plantId: o.plantId, referencia: o.ref, detalle: { "Qué pasó": QUE_PENDIENTE_LARGO, Intentos: o.intentos, Marca: o.marca, Avisado: avisado(r) } })
    return r.enviado
  } catch (e) {
    console.error("[zomatik] aviso de pendiente:", (e as Error)?.message)
    return false
  }
}

// ---------------------------------------------------------------------------
// Usos y saldo de las NP (Z2b: una NP puede servir a varios pedidos)
// ---------------------------------------------------------------------------

export type UsoDB = { id: string; np_id: string; scheduled_dispatch_id: string | null; m3: number; activo: boolean; motivo: string | null; created_at: string; despachado_fijo: number | null }
const COLUMNAS_USO = "id, np_id, scheduled_dispatch_id, m3, activo, motivo, created_at, despachado_fijo"

/** RPC que tiene que andar (si falla, se corta: nunca se escribe una reserva a medias). */
async function rpc(sb: SB, nombre: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await sb.rpc(nombre, args)
  if (error) throw error
  return data
}

async function usosDe(sb: SB, campo: "np_id" | "scheduled_dispatch_id", ids: string[]): Promise<UsoDB[]> {
  if (!ids.length) return []
  const { data, error } = await sb.from("zomatik_np_uso").select(COLUMNAS_USO).in(campo, ids)
  if (error) throw error
  return (data as unknown as UsoDB[]) || []
}

/** Pasos del remito en los que pudo quedar grabado en Zomatik (un corte en Grabar): cuentan como remitidos. */
const PASOS_REMITO_GRABADO = ["grabar_remito", "verificar_remito", "buscar_remito"]

/**
 * Lo que el sistema REALMENTE remitió contra una NP para un pedido: la suma de `zomatik_remitos` de esa NP y ese pedido
 * (no anulados) con el remito grabado (`remito_estado = 'ok'`) o cortado en Grabar (puede estar en Zomatik: se cuenta,
 * para no inventar saldo). No cuenta los que no llegaron a Grabar (pendiente, error, "revisar" antes de grabar) ni los
 * de remito a mano. No usa el reparto de lo despachado (`despachadoPorUso`).
 */
async function remitidoContra(sb: SB, npId: string, pedidoId: string | null): Promise<number> {
  let q = sb.from("zomatik_remitos").select("m3, estado, remito_estado, paso").eq("np_id", npId).neq("estado", "anulado")
  q = pedidoId ? q.eq("scheduled_dispatch_id", pedidoId) : q.is("scheduled_dispatch_id", null)
  const { data, error } = await q
  if (error) throw error
  const filas = (data as { m3: number; estado: string | null; remito_estado: string | null; paso: string | null }[]) || []
  // Un remito cortado al grabar puede estar en Zomatik; uno que Zomatik rechazó (estado "error") no.
  const total = filas.filter((r) => r.remito_estado === "ok" || (r.estado !== "error" && PASOS_REMITO_GRABADO.includes(r.paso || ""))).reduce((s, r) => s + (Number(r.m3) || 0), 0)
  return Math.round(total * 1000) / 1000
}

/**
 * Desactiva los usos (activos) de una NP anulada. La foto (`despachado_fijo`) es lo que se remitió de verdad contra ella:
 *   - sin número nunca llegó a Zomatik: 0. Lo despachado del pedido (en modo aviso se despacha con la NP pendiente)
 *     sigue siendo de su NP nueva (si no, la NP nueva ve menos despachado, muestra un saldo falso y el remito sale corto);
 *   - con número: lo remitido por el sistema contra esa NP en ese pedido (`remitidoContra`), no el reparto.
 * Un update directo por uso, solo si sigue activo (sin migración).
 */
async function desvincularDeAnulada(sb: SB, np: { id: string; numero: string | null | undefined }, usos: { id: string; scheduled_dispatch_id: string | null }[], motivo: string): Promise<void> {
  for (const u of usos) {
    const fijo = np.numero ? await remitidoContra(sb, np.id, u.scheduled_dispatch_id) : 0
    const { error } = await sb.from("zomatik_np_uso").update({ activo: false, despachado_fijo: fijo, motivo, updated_at: new Date().toISOString() } as never).eq("id", u.id).eq("np_id", np.id).eq("activo", true)
    if (error) throw error
  }
}

/** Saldo de cada NP: reparte lo despachado de cada pedido entre sus NP (np.ts, `saldoNp`). */
export async function saldosDe(sb: SB, nps: { id: string; m3: number }[]): Promise<Map<string, SaldoNp>> {
  const out = new Map<string, SaldoNp>()
  if (!nps.length) return out
  const deNps = await usosDe(sb, "np_id", nps.map((x) => x.id))
  const pedidoIds = [...new Set(deNps.map((u) => u.scheduled_dispatch_id).filter(Boolean) as string[])]
  const dePedidos = await usosDe(sb, "scheduled_dispatch_id", pedidoIds)
  const todos = [...new Map([...deNps, ...dePedidos].map((u) => [u.id, u])).values()]
  const { data: peds, error } = pedidoIds.length ? await sb.from("scheduled_dispatches").select("id, status, dispatched_m3").in("id", pedidoIds) : { data: [], error: null }
  if (error) throw error
  const porId = new Map(((peds as { id: string; status: string; dispatched_m3: number | null }[]) || []).map((p) => [p.id, p]))
  const usos: UsoSaldo[] = todos.map((u) => ({ id: u.id, np_id: u.np_id, m3: Number(u.m3), activo: u.activo, created_at: u.created_at, despachado_fijo: u.despachado_fijo === null || u.despachado_fijo === undefined ? null : Number(u.despachado_fijo), pedido: u.scheduled_dispatch_id ? porId.get(u.scheduled_dispatch_id) || null : null }))
  for (const np of nps) out.set(np.id, saldoNp({ id: np.id, m3: Number(np.m3) }, usos))
  return out
}

// ---------------------------------------------------------------------------
// Sincronizar un pedido (sin Zomatik)
// ---------------------------------------------------------------------------

export type Eleccion = { tipo: TipoNp | "saldo"; proyecto_codigo?: number | null; tope_m3?: number | null; np_id?: string | null }

export type ResultadoSync =
  | { activo: false; motivo: string }
  | { activo: true; fuera?: boolean; error?: string; creadas: number; usadas: number; desvinculadas: number; anuladas: number; avisos: string[]; nps: FilaNpDB[] }

type PedidoDB = {
  id: string; status: string; quantity_m3: number; plant_id: string; client_id: string; construction_site_id: string | null; formula_id: string
  scheduled_arrival_time: string; created_at: string; created_by: string | null
}

export type EleccionDB = { tipo: TipoNp | "saldo"; proyecto_codigo: number | null; tope_m3: number | null; np_id: string | null }

export async function eleccionesDe(sb: SB, ids: string[]): Promise<Record<string, EleccionDB>> {
  if (!ids.length) return {}
  const { data, error } = await sb.from("zomatik_np_pedido").select("scheduled_dispatch_id, tipo, proyecto_codigo, tope_m3, np_id").in("scheduled_dispatch_id", ids)
  if (error) throw error
  return Object.fromEntries(
    ((data as (EleccionDB & { scheduled_dispatch_id: string })[]) || []).map((e) => [
      e.scheduled_dispatch_id,
      { tipo: e.tipo, proyecto_codigo: e.proyecto_codigo ?? null, tope_m3: e.tope_m3 === null || e.tope_m3 === undefined ? null : Number(e.tope_m3), np_id: e.np_id ?? null },
    ]),
  )
}

/** El proyecto tiene que estar abierto y ser del cliente (no se confía en lo que manda el navegador). */
async function validarProyecto(sb: SB, clientId: string, codigo: number): Promise<string | null> {
  const [{ data: c }, { data: p }] = await Promise.all([
    sb.from("clients").select("zomatik_codigo").eq("id", clientId).maybeSingle(),
    sb.from("zomatik_proyectos").select("codigo, cliente_codigo, estado").eq("codigo", codigo).maybeSingle(),
  ])
  const zc = (c as { zomatik_codigo?: number | null } | null)?.zomatik_codigo
  const pr = p as { cliente_codigo: number | null; estado: string } | null
  if (!pr) return "Ese proyecto no está en la copia de Zomatik."
  if (pr.estado !== "abierto") return "Ese proyecto ya no está abierto en Zomatik."
  if (!zc || pr.cliente_codigo !== zc) return "Ese proyecto es de otro cliente en Zomatik."
  return null
}

/** Artículo de Zomatik de una fórmula (para comparar NP con saldo: mismo cliente y artículo). */
async function articuloDe(sb: SB, formulaIds: string[]): Promise<Map<string, number | null>> {
  const ids = [...new Set(formulaIds.filter(Boolean))]
  if (!ids.length) return new Map()
  const { data } = await sb.from("formulas").select("id, zomatik_articulo_codigo").in("id", ids)
  return new Map(((data as { id: string; zomatik_articulo_codigo: number | null }[]) || []).map((f) => [f.id, f.zomatik_articulo_codigo ?? null]))
}

/** Una NP con saldo sirve para el pedido si está en Zomatik, es del mismo cliente y artículo y no se cerró ni se manda a devolver. */
async function validarSaldo(sb: SB, ped: PedidoDB, npId: string): Promise<{ error: string } | { libre: number }> {
  const { data } = await sb.from("zomatik_np").select(COLUMNAS_NP).eq("id", npId).maybeSingle()
  const np = data as unknown as FilaNpDB | null
  if (!np || np.estado !== "ok") return { error: "Esa NP no está en Zomatik." }
  if (np.saldo_decision === "cerrada" || np.saldo_decision === "devolver") return { error: "Esa NP ya se cerró o se está devolviendo." }
  if (np.client_id !== ped.client_id) return { error: "Esa NP es de otro cliente." }
  const art = await articuloDe(sb, [np.formula_id || "", ped.formula_id])
  const a1 = art.get(np.formula_id || ""), a2 = art.get(ped.formula_id)
  if (np.formula_id !== ped.formula_id && (!a1 || a1 !== a2)) return { error: "Esa NP es de otro artículo (fórmula)." }
  const s = (await saldosDe(sb, [np])).get(np.id)
  return { libre: s?.libre ?? 0 }
}

export async function npsDePedidos(sb: SB, ids: string[]): Promise<FilaNpDB[]> {
  if (!ids.length) return []
  const { data, error } = await sb.from("zomatik_np").select(COLUMNAS_NP).in("scheduled_dispatch_id", ids).order("n")
  if (error) throw error
  return (data as unknown as FilaNpDB[]) || []
}

async function npsPorId(sb: SB, ids: string[]): Promise<FilaNpDB[]> {
  if (!ids.length) return []
  const { data, error } = await sb.from("zomatik_np").select(COLUMNAS_NP).in("id", ids)
  if (error) throw error
  return (data as unknown as FilaNpDB[]) || []
}

const vacio = (nps: FilaNpDB[], extra: Partial<Extract<ResultadoSync, { activo: true }>> = {}): ResultadoSync => ({ activo: true, creadas: 0, usadas: 0, desvinculadas: 0, anuladas: 0, avisos: [], nps, ...extra })

export async function sincronizarPedido(pedidoId: string, usuario: string, eleccion?: Eleccion | null, sb: SB = sbServicio(), opciones: { mover_fecha?: boolean | null; usuarioId?: string | null } = {}): Promise<ResultadoSync> {
  const { data: p, error } = await sb.from("scheduled_dispatches").select(COLUMNAS_PEDIDO).eq("id", pedidoId).maybeSingle()
  if (error) throw error
  if (!p) return { activo: false, motivo: "El pedido no existe" }
  const ped = p as unknown as PedidoDB
  const plantas = await plantasNp(sb)
  const planta = plantas[ped.plant_id]
  if (!planta?.zomatik_np_activo) return { activo: false, motivo: "NP: se carga a mano en Zomatik" }
  let usos = (await usosDe(sb, "scheduled_dispatch_id", [ped.id])).filter((u) => u.activo)
  // Autocorrección: un uso activo de una NP anulada (un paso cortado a la mitad, o de antes de este arreglo) se suelta
  // con lo que se remitió de verdad contra ella (sin número, 0), para que no se lleve lo despachado del pedido
  const colgadas = (await npsPorId(sb, [...new Set(usos.map((u) => u.np_id))])).filter((x) => x.estado === "anulada")
  for (const x of colgadas) {
    await desvincularDeAnulada(sb, x, usos.filter((u) => u.np_id === x.id), "NP anulada")
    await actividadNp(sb, { usuario, pedidoId: ped.id, plantId: ped.plant_id, referencia: `Pedido ${ped.id.slice(0, 8)}`, detalle: { "Qué pasó": `${x.numero || `La NP ${x.n}`} estaba anulada y el pedido la seguía usando: se soltó`, Marca: x.marca } })
  }
  if (colgadas.length) usos = (await usosDe(sb, "scheduled_dispatch_id", [ped.id])).filter((u) => u.activo)
  const propias = await npsDePedidos(sb, [ped.id])
  // Resguardo: una NP propia viva sin ningún uso (un alta a medias de antes) cuenta como usada por el pedido. Se le
  // repone el uso (con la NP bloqueada) en vez de generar una segunda NP.
  const conUso = new Set((await usosDe(sb, "np_id", propias.map((x) => x.id))).map((u) => u.np_id))
  const huerfanas = propias.filter((x) => VIGENTES.includes(x.estado) && !conUso.has(x.id))
  for (const x of huerfanas) {
    await rpc(sb, "zomatik_np_reservar", { p_np: x.id, p_pedido: ped.id, p_m3: Number(x.m3), p_usuario: usuario })
    await actividadNp(sb, { usuario, pedidoId: ped.id, plantId: ped.plant_id, referencia: `Pedido ${ped.id.slice(0, 8)}`, detalle: { "Qué pasó": `La NP ${x.n} no tenía uso: se le repuso (no se genera otra)`, Marca: x.marca } })
  }
  if (huerfanas.length) usos = (await usosDe(sb, "scheduled_dispatch_id", [ped.id])).filter((u) => u.activo)
  // Un pedido de antes de prender la llave no tiene NP automática (salvo que ya tenga alguna del sistema)
  if (!pedidoConNp(planta, ped.created_at) && !usos.length && !propias.length) return vacio([], { fuera: true })

  // Elección del formulario (NP nueva, de un proyecto o una NP con saldo): se valida y se guarda (solo el servidor)
  let el: EleccionDB = (await eleccionesDe(sb, [ped.id]))[ped.id] || { tipo: "nueva", proyecto_codigo: null, tope_m3: null, np_id: null }
  if (eleccion && (eleccion.tipo === "nueva" || eleccion.tipo === "proyecto" || eleccion.tipo === "saldo")) {
    const proy = eleccion.tipo === "proyecto" && Number(eleccion.proyecto_codigo) > 0 ? Number(eleccion.proyecto_codigo) : null
    const npSaldo = eleccion.tipo === "saldo" && typeof eleccion.np_id === "string" && eleccion.np_id.length > 0 && eleccion.np_id.length <= 64 ? eleccion.np_id : null
    const tipo: EleccionDB["tipo"] = proy ? "proyecto" : npSaldo ? "saldo" : "nueva"
    const tope = proy && eleccion.tope_m3 !== null && eleccion.tope_m3 !== undefined && Number(eleccion.tope_m3) >= 0 ? Number(eleccion.tope_m3) : null
    if (eleccion.tipo === "proyecto" && !proy) return vacio(propias, { error: "Elegí el proyecto." })
    if (eleccion.tipo === "saldo" && !npSaldo) return vacio(propias, { error: "Elegí la NP con saldo." })
    const invalido = proy ? await validarProyecto(sb, ped.client_id, proy) : null
    if (invalido) return vacio(propias, { error: invalido })
    if (npSaldo && !usos.some((u) => u.np_id === npSaldo)) {
      const v = await validarSaldo(sb, ped, npSaldo)
      if ("error" in v) return vacio(propias, { error: v.error })
    }
    if (tipo !== el.tipo || proy !== el.proyecto_codigo || tope !== el.tope_m3 || npSaldo !== el.np_id) {
      const { error: e1 } = await sb.from("zomatik_np_pedido").upsert({ scheduled_dispatch_id: ped.id, tipo, proyecto_codigo: proy, tope_m3: tope, np_id: npSaldo, updated_by: usuario, updated_at: new Date().toISOString() } as never, { onConflict: "scheduled_dispatch_id" })
      if (e1) throw e1
      el = { tipo, proyecto_codigo: proy, tope_m3: tope, np_id: npSaldo }
    }
    if (proy && ped.construction_site_id) await sb.from("construction_sites").update({ zomatik_proyecto_codigo: proy } as never).eq("id", ped.construction_site_id)
  }

  // Lo que usa el pedido, con lo libre de cada NP
  const npsUso = await npsPorId(sb, usos.map((u) => u.np_id))
  const saldoElegida = el.tipo === "saldo" && el.np_id && !usos.some((u) => u.np_id === el.np_id) ? await validarSaldo(sb, ped, el.np_id) : null
  const saldos = await saldosDe(sb, npsUso)
  const usoPlan: UsoPlan[] = usos
    .map((u) => ({ u, np: npsUso.find((x) => x.id === u.np_id) }))
    .filter((x) => !!x.np)
    .sort((a, b) => a.u.created_at.localeCompare(b.u.created_at))
    .map(({ u, np }) => ({ uso_id: u.id, m3: Number(u.m3), np: np!, libre: Math.max(0, saldos.get(np!.id)?.libre ?? 0) }))
  const fecha = diaAR(ped.scheduled_arrival_time)
  const plan = planificarNp(
    {
      id: ped.id, status: ped.status, quantity_m3: Number(ped.quantity_m3), plant_id: ped.plant_id, client_id: ped.client_id, formula_id: ped.formula_id, fecha,
      np_tipo: el.tipo, proyecto_codigo: el.proyecto_codigo, proyecto_tope_m3: el.tope_m3,
      saldo_np: saldoElegida && "libre" in saldoElegida && el.np_id ? { id: el.np_id, libre: saldoElegida.libre } : null,
      mover_fecha: opciones.mover_fecha ?? null,
    },
    usoPlan,
    propias.reduce((m, x) => Math.max(m, x.n || 0), 0),
  )
  const ahora = new Date().toISOString()
  const ref = `Pedido ${ped.id.slice(0, 8)}`
  const log = (detalle: Record<string, unknown>, action: "crear" | "editar" = "editar") => actividadNp(sb, { usuario, action, pedidoId: ped.id, plantId: ped.plant_id, referencia: ref, detalle })

  // Anular lo que no llegó a Zomatik. Si el robot tomó alguna en el medio (ya no está pendiente/error), se anulan
  // menos de las planeadas: entonces NO se crea ni se usa nada; la próxima sincronización vuelve a planear.
  let anuladas = 0
  if (plan.anular.length) {
    const { data: an, error: ea } = await sb.from("zomatik_np").update({ estado: "anulada", mensaje: ped.status === "cancelled" ? "El pedido se canceló antes de generarla" : "Se rehízo con los datos nuevos del pedido", proximo_intento: null, updated_at: ahora } as never).in("id", plan.anular).in("estado", ["pendiente", "error"])
      // Como el trigger zomatik_np_no_borrar_pedido: una NP cortada en Grabar puede estar en Zomatik y no se anula (se
      // vuelve a planear: con el pedido cancelado va a "revisar")
      .or(`paso.is.null,paso.not.in.(${PASOS_GRABADA.join(",")})`).select("id")
    if (ea) throw ea
    const ids = ((an as { id: string }[]) || []).map((x) => x.id)
    anuladas = ids.length
    // El uso se desactiva. En modo aviso se pudo despachar con la NP pendiente, pero contra ella no se remitió nada (nunca
    // llegó a Zomatik): la foto queda en 0 y lo despachado lo toma la NP que la reemplaza.
    for (const id of ids) await desvincularDeAnulada(sb, { id, numero: npsUso.find((x) => x.id === id)?.numero }, usos.filter((x) => x.np_id === id), "NP anulada")
  }
  const incompleto = anuladas < plan.anular.length
  if (incompleto) plan.avisos.push("Una NP se estaba generando mientras se cambiaba el pedido: se vuelve a mirar en la próxima pasada.")
  if (plan.revisar.length) {
    const msg = "El pedido se canceló y esta NP se cortó al grabar: puede estar en Zomatik. Buscala por la marca y decidí qué hacer con el saldo."
    await sb.from("zomatik_np").update({ estado: "revisar", mensaje: msg, proximo_intento: null, updated_at: ahora } as never).in("id", plan.revisar).in("estado", ["pendiente", "error"])
    await avisarGerenciales(sb, "NP para revisar (pedido cancelado)", [msg, ...npsUso.filter((x) => plan.revisar.includes(x.id)).map((x) => `Marca: ${x.marca}`)])
  }
  for (const d of plan.desvincular) {
    // Desactiva el uso guardando la foto de lo despachado contra esa NP hasta ahora (no le toca lo que venga después)
    await rpc(sb, "zomatik_np_desvincular", { p_uso: d.uso_id, p_motivo: d.motivo })
    const np = usoPlan.find((x) => x.uso_id === d.uso_id)?.np
    if (np) await sb.from("zomatik_np").update({ saldo_mensaje: `Sin pedido: ${d.motivo}`, updated_at: ahora } as never).eq("id", np.id)
    await log({ "Qué pasó": `${np?.numero || "La NP"} queda pendiente con su saldo (${d.motivo})` })
  }
  for (const id of plan.mover_fecha) {
    const np = npsUso.find((x) => x.id === id)
    await sb.from("zomatik_np").update({ fecha, updated_at: ahora } as never).eq("id", id) // solo en nuestro sistema: en Zomatik no hace falta (25.5)
    await log({ "Qué pasó": `${np?.numero || "La NP"} se movió a la nueva fecha del pedido (${fecha}), en el sistema` })
  }
  // Reservas (agrandar/achicar lo que usa de sus NP, y usar una NP con saldo): en la base, con la NP bloqueada. Si otro
  // tomó el saldo en el medio, se reserva menos y lo que falte va en una NP nueva.
  let falta = 0
  let usadas = 0
  if (!incompleto) {
    for (const a of plan.ajustar) {
      const u = usoPlan.find((x) => x.uso_id === a.uso_id)
      if (!u) continue
      const dado = Number(await rpc(sb, "zomatik_np_reservar", { p_np: u.np.id, p_pedido: ped.id, p_m3: a.m3, p_usuario: usuario })) || 0
      if (a.m3 > u.m3) falta += Math.max(0, a.m3 - dado)
    }
    if (plan.ajustar.length) await log({ "Qué pasó": "Cambió lo que el pedido usa de sus NP", Detalle: plan.ajustar.map((a) => `${a.m3} m³`).join(", ") })
    for (const u of plan.usar) {
      const dado = Number(await rpc(sb, "zomatik_np_reservar", { p_np: u.np_id, p_pedido: ped.id, p_m3: u.m3, p_usuario: usuario })) || 0
      falta += Math.max(0, u.m3 - dado)
      if (dado > 0) {
        usadas++
        await log({ "Qué pasó": `El pedido usa ${dado} m³ de una NP con saldo (reprogramado)`, NP: npsUso.find((x) => x.id === u.np_id)?.numero || u.np_id }, "crear")
      }
    }
  }
  const crear = incompleto ? [] : [...plan.crear]
  if (falta > 0.001) {
    const n = Math.max(0, ...crear.map((c) => c.n), ...propias.map((x) => x.n || 0))
    crear.push({ n: n + 1, tipo: "nueva", m3: Math.round(falta * 1000) / 1000, proyecto_codigo: null, es_adicional: true })
    plan.avisos.push(`Otro pedido tomó parte del saldo en el mismo momento: ${Math.round(falta * 1000) / 1000} m³ van en una NP nueva.`)
  }
  let creadas = 0
  for (const c of crear) {
    const fila = {
      scheduled_dispatch_id: ped.id, n: c.n, marca: marcaNp(ped.id, c.n), tipo: c.tipo, es_adicional: c.es_adicional, proyecto_codigo: c.proyecto_codigo,
      plant_id: ped.plant_id, client_id: ped.client_id, formula_id: ped.formula_id, fecha, m3: c.m3, estado: "pendiente", proximo_intento: ahora, created_by: usuario,
      // El vendedor de la NP: el de quien guarda el pedido ahora (sesión del servidor), no el que lo cargó primero
      vendedor_usuario_id: opciones.usuarioId ?? null,
    }
    // La NP y su uso juntos, en una sola transacción de la base (nunca una NP sin uso)
    const npId = await rpc(sb, "zomatik_np_crear_con_uso", { p: fila })
    if (!npId) continue // otro proceso la creó recién (marca o número repetidos)
    creadas++
    await log({ "Qué pasó": c.es_adicional ? `NP adicional por ${c.m3} m³ (el pedido se agrandó)` : `NP ${c.tipo === "proyecto" ? `contra el proyecto ${c.proyecto_codigo}` : "nueva"} por ${c.m3} m³: pendiente de generar`, Marca: fila.marca }, "crear")
  }
  // Los avisos no se repiten: si el último aviso de este pedido dice lo mismo, no se vuelve a grabar
  if (plan.avisos.length) {
    const texto = plan.avisos.join(" · ")
    const { data: ult } = await sb.from("activity_log").select("details").eq("entity", "zomatik_np").eq("entity_id", ped.id).eq("reference", ref).order("created_at", { ascending: false }).limit(20)
    const yaEsta = ((ult as { details: { Aviso?: string } | null }[]) || []).some((x) => x.details?.Aviso === texto)
    if (!yaEsta) await log({ "Qué pasó": "Aviso de la NP", Aviso: texto })
  }
  await marcarPendientes(sb, [...new Set([...(await usosDe(sb, "scheduled_dispatch_id", [ped.id])).map((u) => u.np_id), ...propias.map((x) => x.id)])], ahora)
  usos = (await usosDe(sb, "scheduled_dispatch_id", [ped.id])).filter((u) => u.activo)
  const nps = await npsPorId(sb, usos.map((u) => u.np_id))
  return { activo: true, creadas, usadas, desvinculadas: plan.desvincular.length, anuladas, avisos: plan.avisos, nps }
}

/**
 * "NP con saldo: pendiente" desde cuándo (precisión del 23/10): una NP en Zomatik con saldo y sin pedido activo queda
 * pendiente desde que pasó (sin preguntar ni vencer); si vuelve a tener un pedido activo, deja de estarlo.
 */
async function marcarPendientes(sb: SB, npIds: string[], ahora: string) {
  const nps = (await npsPorId(sb, npIds)).filter((x) => x.estado === "ok")
  if (!nps.length) return
  const saldos = await saldosDe(sb, nps)
  for (const x of nps) {
    const pendiente = npConSaldo(x, saldos.get(x.id)!)
    if (pendiente && !x.saldo_desde) await sb.from("zomatik_np").update({ saldo_desde: ahora } as never).eq("id", x.id).is("saldo_desde", null)
    if (!pendiente && x.saldo_desde && x.saldo_decision !== "devolver" && x.saldo_decision !== "cerrada") await sb.from("zomatik_np").update({ saldo_desde: null } as never).eq("id", x.id)
  }
}

// ---------------------------------------------------------------------------
// NP con saldo (Programación) y qué hacer con el saldo
// ---------------------------------------------------------------------------

export type NpSaldo = {
  id: string; numero: string | null; zomatik_codigo: number | null; m3: number; libre: number; comprometido: number; fecha: string; fecha_zomatik: string | null
  saldo_decision: string | null; saldo_mensaje: string | null; pendiente_desde: string | null; plant_id: string | null; client_id: string | null; cliente: string | null
  formula_id: string | null; formula: string | null; construction_site_id: string | null; obra: string | null; con_pedido_activo: boolean
}

/**
 * NP del sistema en Zomatik con saldo. `lista`: las que van a "NP con saldo" (sin pedido activo, sin cerrar).
 * Con `clientId` y `formulaId`: las que sirven para "Usar NP con saldo" (mismo cliente y artículo, con algo libre).
 */
export async function npsConSaldo(o: { clientId?: string | null; formulaId?: string | null; sb?: SB } = {}): Promise<NpSaldo[]> {
  const sb = o.sb ?? sbServicio()
  let q = sb.from("zomatik_np").select(COLUMNAS_NP).eq("estado", "ok").order("fecha", { ascending: false }).limit(300)
  if (o.clientId) q = q.eq("client_id", o.clientId)
  const { data, error } = await q
  if (error) throw error
  const nps = ((data as unknown as FilaNpDB[]) || []).filter((x) => x.saldo_decision !== "cerrada")
  const saldos = await saldosDe(sb, nps)
  let elegidas = nps.filter((x) => {
    const sd = saldos.get(x.id)
    if (!sd) return false
    return o.clientId ? sd.libre > 0.001 && x.saldo_decision !== "devolver" : npConSaldo(x, sd)
  })
  if (o.clientId && o.formulaId) {
    const art = await articuloDe(sb, [o.formulaId, ...elegidas.map((x) => x.formula_id || "")])
    const quiere = art.get(o.formulaId)
    elegidas = elegidas.filter((x) => x.formula_id === o.formulaId || (!!quiere && art.get(x.formula_id || "") === quiere))
  }
  if (!elegidas.length) return []
  const pedIds = [...new Set(elegidas.map((x) => x.scheduled_dispatch_id).filter(Boolean) as string[])]
  const [{ data: cli }, { data: frm }, { data: peds }] = await Promise.all([
    sb.from("clients").select("id, name").in("id", [...new Set(elegidas.map((x) => x.client_id).filter(Boolean) as string[])]),
    sb.from("formulas").select("id, code").in("id", [...new Set(elegidas.map((x) => x.formula_id).filter(Boolean) as string[])]),
    pedIds.length ? sb.from("scheduled_dispatches").select("id, construction_site_id, construction_sites(name)").in("id", pedIds) : Promise.resolve({ data: [] }),
  ])
  const nombre = new Map(((cli as { id: string; name: string }[]) || []).map((c) => [c.id, c.name]))
  const codigo = new Map(((frm as { id: string; code: string }[]) || []).map((f) => [f.id, f.code]))
  const obra = new Map(((peds as { id: string; construction_site_id: string | null; construction_sites?: { name?: string } | null }[]) || []).map((p) => [p.id, p]))
  return elegidas.map((x) => {
    const sd = saldos.get(x.id)!
    const o2 = x.scheduled_dispatch_id ? obra.get(x.scheduled_dispatch_id) : undefined
    return {
      id: x.id, numero: x.numero, zomatik_codigo: x.zomatik_codigo, m3: Number(x.m3), libre: sd.libre, comprometido: sd.comprometido, fecha: String(x.fecha), fecha_zomatik: x.fecha_zomatik ?? null,
      saldo_decision: x.saldo_decision ?? null, saldo_mensaje: x.saldo_mensaje ?? null, pendiente_desde: x.saldo_desde ?? x.updated_at ?? null, plant_id: x.plant_id ?? null, client_id: x.client_id ?? null, cliente: nombre.get(x.client_id || "") || null,
      formula_id: x.formula_id ?? null, formula: codigo.get(x.formula_id || "") || null, construction_site_id: o2?.construction_site_id ?? null, obra: o2?.construction_sites?.name ?? null,
      con_pedido_activo: sd.conPedidoActivo,
    }
  })
}

/**
 * Qué hacer con el saldo de una NP pendiente (respuesta 2 y precisión del 23/10: queda pendiente hasta Reprogramar o
 * Devolver; Reprogramar es abrir un pedido nuevo con "Usar NP con saldo"):
 *   devolver  "Devolver el saldo": si no tuvo despachos, se vacía (23.4, el robot controla que no tenga remitos). Si tuvo,
 *             hace falta una devolución de pedido (DEVOL) por el saldo: TODAVÍA NO la hace el sistema (falta probarla
 *             con Bautista, 20.6.1): queda "devolver" con el aviso de hacerla a mano.
 *   cerrada   "Ya la devolví": se hizo a mano en Zomatik.
 */
export async function decidirSaldo(npId: string, decision: "devolver" | "cerrada", usuario: string, sb: SB = sbServicio(), motivo?: string | null): Promise<{ ok: boolean; error?: string; mensaje?: string }> {
  const { data } = await sb.from("zomatik_np").select(COLUMNAS_NP).eq("id", npId).maybeSingle()
  const np = data as unknown as FilaNpDB | null
  if (!np) return { ok: false, error: "La NP no existe." }
  const ahora = new Date().toISOString()
  const ref = `NP ${np.numero || np.id.slice(0, 8)}`
  let mensaje: string
  if (decision === "cerrada") {
    // "Ya la devolví" (DEVOL a mano): solo un gerencial y con motivo (lo controla la ruta); queda en Actividad
    if (np.estado !== "ok" || np.saldo_decision !== "devolver") return { ok: false, error: "La NP no está esperando la devolución. Actualizá la pantalla." }
    const { data: hecho } = await sb.from("zomatik_np").update({ saldo_decision: "cerrada", saldo_decision_por: usuario, saldo_decision_at: ahora, saldo_mensaje: `Devuelta a mano por ${usuario}: ${motivo || ""}`.trim(), updated_at: ahora } as never).eq("id", np.id).eq("estado", "ok").eq("saldo_decision", "devolver").select("id")
    if (!((hecho as unknown[]) || []).length) return { ok: false, error: "La NP cambió. Actualizá la pantalla." }
    mensaje = "Marcada como devuelta"
  } else {
    // En la base, con la NP bloqueada: no se pisa con una reprogramación al mismo tiempo
    const r = (await rpc(sb, "zomatik_np_devolver", { p_np: np.id, p_usuario: usuario })) as { error?: string; mensaje?: string; libre?: number } | null
    if (!r || r.error) return { ok: false, error: r?.error || "No se pudo." }
    mensaje = r.mensaje || "Listo"
  }
  await actividadNp(sb, { usuario, pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: ref, detalle: { "Qué pasó": decision === "cerrada" ? "NP con saldo: ya devuelta a mano (DEVOL)" : "NP con saldo: devolver el saldo", Mensaje: mensaje, ...(motivo ? { Motivo: motivo } : {}) } })
  return { ok: true, mensaje }
}

/** Vendedor de Zomatik de quien programó el pedido (respuesta 4); null si no tiene. */
async function vendedorDe(sb: SB, appUserId: string | null | undefined): Promise<{ id: number; nombre: string } | null> {
  if (!appUserId) return null
  const { data: v, error } = await sb.from("zomatik_vendedores").select("vendedor_id, vendedor_nombre").eq("app_user_id", appUserId).maybeSingle()
  if (error || !v) return null
  return { id: Number((v as { vendedor_id: number }).vendedor_id), nombre: (v as { vendedor_nombre: string | null }).vendedor_nombre || "" }
}

// ---------------------------------------------------------------------------
// Procesar con el robot
// ---------------------------------------------------------------------------

export type ResultadoProceso = { ocupado?: boolean; sinTiempo?: boolean; hechas: { id: string; estado: string; mensaje: string | null; numero?: string | null }[]; quedan: number; error?: string }

/** Más de estas veces colgada en "generando"/"vaciando" = trabada: queda "revisar". */
const MAX_INTENTOS_TRABADA = 3

const despuesDe = (min: number) => new Date(Date.now() + min * 60_000).toISOString()

/** NP para trabajar ahora (ver `trabajoPendiente`, np.ts). Con `pedidoId`, también las de error (el botón). */
async function aTrabajar(sb: SB, pedidoId?: string | null): Promise<FilaNpDB[]> {
  let q = sb.from("zomatik_np").select(COLUMNAS_NP).in("estado", ["pendiente", "generando", "vaciar", "vaciando", ...(pedidoId ? ["error"] : [])]).order("created_at").limit(30)
  if (pedidoId) q = q.eq("scheduled_dispatch_id", pedidoId)
  const { data, error } = await q
  if (error) throw error
  const ahora = Date.now()
  return ((data as unknown as FilaNpDB[]) || []).filter((x) => trabajoPendiente(x, ahora, !!pedidoId))
}

/** Lo que el robot necesita de afuera (en las pruebas se reemplaza). */
export type Dependencias = {
  navegador: (llave: LlaveNp) => Promise<NavegadorNp>
  remitos: (numero: string | null, desde: string) => Promise<boolean | null>
  avisar: (sb: SB, titulo: string, lineas: string[]) => Promise<{ enviado: boolean; motivo?: string }>
  /** Autorizar la NP en Zomatik (en las pruebas, uno simulado) */
  autorizar?: typeof autorizarNp
  /** Aviso a Bautista cuando una NP queda en "error" (sin esto, `avisarErrorZomatik`) */
  avisarError?: (sb: SB, titulo: string, lineas: string[]) => Promise<{ enviado: boolean; motivo?: string }>
}

type Contexto = {
  plantas: Record<string, PlantaNpDB>
  nav: NavegadorNp | null
  usuario: string
  dep: Dependencias
  /** Renueva el turno del robot (como mucho cada 10 s). */
  renovar: () => Promise<void>
  /** Abre el navegador del robot; si entró y se había avisado que no podía, avisa que volvió. */
  abrir: (llave: LlaveNp) => Promise<NavegadorNp>
  /** El último paso que arrancó la NP en curso (para el aviso si se cae). */
  paso: string | null
}

/** Datos del pedido que necesita el robot (cliente, fórmula, depósito, R/X y obra). */
async function datosParaRobot(sb: SB, np: FilaNpDB, planta: PlantaNpDB | undefined, buscarAntes: boolean): Promise<DatosNp> {
  const pedidoId = np.scheduled_dispatch_id
  const [{ data: ped }, { data: cli }, { data: form }] = await Promise.all([
    pedidoId ? sb.from("scheduled_dispatches").select("id, created_by, construction_site_id, construction_sites(name, address, localidad)").eq("id", pedidoId).maybeSingle() : Promise.resolve({ data: null }),
    np.client_id ? sb.from("clients").select("id, name, zomatik_codigo").eq("id", np.client_id).maybeSingle() : Promise.resolve({ data: null }),
    np.formula_id ? sb.from("formulas").select("id, code, zomatik_articulo_codigo, zomatik_articulo_nombre").eq("id", np.formula_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  let articulo: { codigo_sistema: number | null; nombre: string } | null = null
  const codArt = (form as { zomatik_articulo_codigo?: number | null } | null)?.zomatik_articulo_codigo
  if (codArt) {
    const { data: a } = await sb.from("zomatik_articulos").select("codigo, nombre, codigo_sistema").eq("codigo", codArt).maybeSingle()
    articulo = a ? { codigo_sistema: (a as { codigo_sistema: number | null }).codigo_sistema ?? null, nombre: (a as { nombre: string }).nombre } : null
  }
  let comprobante: "15" | "16" | null = null
  if (np.tipo === "nueva" && pedidoId) {
    const { data: rt } = await sb.rpc("remito_tipo_para", { p_pedido_id: pedidoId })
    comprobante = comprobanteDe((rt as { tipo?: string } | null)?.tipo || null)
  }
  // Vendedor: el de quien guardó el pedido cuando se creó esta NP (usuario de la sesión del servidor, respuesta 4 del
  // 23/10); si no tiene, el robot usa el del cliente
  const vendedor = await vendedorDe(sb, np.vendedor_usuario_id)
  const obra = (ped as { construction_sites?: { name?: string; address?: string | null; localidad?: string | null } | null } | null)?.construction_sites
  const entrega = obra ? [`Obra: ${obra.name || ""}`, obra.address, obra.localidad].filter(Boolean).join(" · ") : ""
  return {
    marca: np.marca,
    tipo: np.tipo,
    comprobante,
    clienteCodigo: (cli as { zomatik_codigo?: number | null } | null)?.zomatik_codigo ?? null,
    clienteNombre: (cli as { name?: string } | null)?.name || "",
    deposito: planta?.zomatik_deposito ?? null,
    fecha: String(np.fecha),
    m3: Number(np.m3),
    articuloCodigoSistema: articulo?.codigo_sistema ?? null,
    articuloCodigo: codArt ?? null,
    articuloNombre: articulo?.nombre || (form as { zomatik_articulo_nombre?: string } | null)?.zomatik_articulo_nombre || (form as { code?: string } | null)?.code || "",
    proyectoCodigo: np.proyecto_codigo ?? null,
    entrega,
    buscarAntes,
    creadaEl: np.created_at ? diaAR(np.created_at) : null,
    vendedorId: vendedor?.id ?? null,
    vendedorNombre: vendedor?.nombre ?? null,
  }
}

/** ¿La NP tiene remitos? (reporte de remitos de venta, solo lectura). Si no se puede leer, null. */
async function tieneRemitos(numero: string | null, desde: string): Promise<boolean | null> {
  if (!numero) return false
  try {
    const s = await obtenerSesion()
    const f = await discoverForm(s, "reporte_remitosventa.php")
    const rs = renglonesRemitos(await fetchExport(s, "reporte_remitosventa.php", f, { desde, hasta: hoyAR() }))
    const n = numeroNormalizado(numero)
    const comp = comprobanteDeNumero(numero)
    return rs.some((r) => numeroNormalizado(r.pedido) === n && (!comp || comprobanteDeNumero(r.pedido) === comp))
  } catch {
    return null
  }
}

export const DEPENDENCIAS: Dependencias = { navegador: navegadorNp, remitos: tieneRemitos, avisar: avisarGerenciales, autorizar: autorizarNp, avisarError: avisarErrorZomatik }

/** `zomatik_np.paso` de una NP "ok" sin autorizar en Zomatik: se reintenta en la pasada; la ve el chip. */
export const PASO_SIN_AUTORIZAR = "sin_autorizar"
/** NP "ok" sin nuestra marca en Zomatik: no se autoriza sola, no se reintenta (la mira una persona). */
export const PASO_AUTORIZAR_REVISAR = "autorizar_revisar"
export const PASO_AUTORIZADA = "autorizada"

/**
 * Guarda el resultado de autorizar una NP "ok" (03/11). Autorizada: Actividad "NP autorizada en Zomatik". Sin
 * autorizar: queda "ok" con el aviso "NP sin autorizar en Zomatik" (paso sin_autorizar, se reintenta). Sin la marca:
 * aviso a gerenciales, no se reintenta.
 */
export async function registrarAutorizacion(
  sb: SB,
  np: { id: string; numero: string | null; marca: string; paso: string | null; scheduled_dispatch_id: string | null; plant_id?: string | null },
  a: ResultadoAutorizar,
  o: { usuario: string; avisar: Dependencias["avisar"] },
): Promise<void> {
  const ref = `Pedido ${(np.scheduled_dispatch_id || "").slice(0, 8)}`
  const ahora = new Date().toISOString()
  if (a.estado === "autorizada" || a.estado === "ya") {
    if (np.paso === PASO_AUTORIZADA) return
    await sb.from("zomatik_np").update({ paso: PASO_AUTORIZADA, ...(np.paso === PASO_SIN_AUTORIZAR || np.paso === PASO_AUTORIZAR_REVISAR ? { mensaje: null } : {}), updated_at: ahora } as never).eq("id", np.id).eq("estado", "ok")
    if (a.estado === "autorizada") await actividadNp(sb, { usuario: o.usuario, action: "editar", pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: ref, detalle: { "Qué pasó": "NP autorizada en Zomatik", NP: np.numero } })
    return
  }
  const paso = a.estado === "revisar" ? PASO_AUTORIZAR_REVISAR : PASO_SIN_AUTORIZAR
  const mensaje = a.estado === "revisar" ? a.mensaje : `NP sin autorizar en Zomatik: ${a.mensaje || "no se pudo"}. Se reintenta.`
  await sb.from("zomatik_np").update({ paso, mensaje, updated_at: ahora } as never).eq("id", np.id).eq("estado", "ok")
  if (np.paso === paso) return // ya avisado
  await actividadNp(sb, { usuario: o.usuario, pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: ref, detalle: { "Qué pasó": "NP sin autorizar en Zomatik", Mensaje: a.mensaje, NP: np.numero, ...(a.recorte ? { "Respuesta de Zomatik (recorte)": a.recorte } : {}) } })
  if (a.estado === "revisar") await o.avisar(sb, `NP sin autorizar: ${np.numero || "NP"}`, [a.mensaje || "", `Marca: ${np.marca}`])
}

/**
 * Guarda SOLO si la NP sigue en `esperado` ("generando" / "vaciando"): si otro proceso o un gerencial la cambió en el
 * medio (anulada, revisada), no se pisa. Devuelve si se guardó.
 */
async function guardarSi(sb: SB, id: string, esperado: EstadoNp, cambios: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await sb.from("zomatik_np").update({ ...cambios, updated_at: new Date().toISOString() } as never).eq("id", id).eq("estado", esperado).select("id")
  if (error) throw error
  return ((data as unknown[]) || []).length > 0
}

/** Error para cortar el robot ANTES de grabar si la NP cambió mientras trabajaba. */
class NpCambio extends Error {}

/** Si el robot terminó pero la NP ya no estaba "generando"/"vaciando": no se pisa, queda en Actividad y se avisa. */
async function noSePudoGuardar(sb: SB, np: FilaNpDB, ctx: Contexto, que: string) {
  const detalle = `La NP ${np.n} cambió mientras el robot trabajaba (${que}). No se pisó: revisala en Zomatik.`
  await actividadNp(sb, { usuario: ctx.usuario, pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: `Pedido ${(np.scheduled_dispatch_id || "").slice(0, 8)}`, detalle: { "Qué pasó": detalle, Marca: np.marca } })
  await ctx.dep.avisar(sb, "NP para revisar (cambió mientras se generaba)", [detalle, `Marca: ${np.marca}`])
}

/** Una NP que sigue pendiente por red o sesión hace más de 1 hora: un aviso a Bautista, una vez por NP. */
async function avisarPendienteNp(sb: SB, np: FilaNpDB, ctx: Contexto, mensaje: string | null, cliente: string | null) {
  const ref = `Pedido ${(np.scheduled_dispatch_id || "").slice(0, 8)}`
  const intentos = Number(np.intentos || 0) + 1 // el de ahora ya se contó al tomarla
  await avisarPendienteLargo(sb, ctx.dep.avisarError ?? avisarErrorZomatik, {
    usuario: ctx.usuario, pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, ref, marca: np.marca, creada: np.created_at, intentos,
    titulo: `NP pendiente hace más de 1 hora · ${ref}`,
    lineas: [
      `${ref}${cliente ? ` · ${cliente}` : ""} · ${np.m3} m³ · ${np.fecha}${ctx.plantas[np.plant_id || ""]?.name ? ` · ${ctx.plantas[np.plant_id || ""].name}` : ""}`,
      `Lleva más de 1 hora sin poder generarse (${intentos} intentos), por red o sesión de Zomatik.`,
      `Último mensaje: ${mensaje || "(sin mensaje)"}`,
      `Marca en observaciones: ${np.marca}`,
      "Se sigue reintentando en la próxima pasada (cada 10 minutos). Este aviso llega una sola vez por NP.",
    ],
  })
}

async function trabajarGenerar(sb: SB, np: FilaNpDB, ctx: Contexto, previo: { estado: string; paso: string | null }) {
  const G: EstadoNp = "generando"
  const planta = ctx.plantas[np.plant_id || ""]
  const llave = llaveDe(planta)
  if (!llave) {
    await guardarSi(sb, np.id, G, { estado: "pendiente", en_curso_desde: null, mensaje: "La NP automática está apagada para esta planta: cargala a mano en Zomatik.", proximo_intento: null })
    return { estado: "pendiente", mensaje: "llave apagada" }
  }
  const buscarAntes = previo.estado === "generando" || puedeEstarGrabada({ paso: previo.paso })
  // El pedido se canceló (o se borró) entre que se creó la NP y ahora: no se genera
  const { data: est } = np.scheduled_dispatch_id ? await sb.from("scheduled_dispatches").select("status").eq("id", np.scheduled_dispatch_id).maybeSingle() : { data: null }
  const status = (est as { status?: string } | null)?.status
  if (!status || status === "cancelled") {
    if (buscarAntes) {
      await guardarSi(sb, np.id, G, { estado: "revisar", en_curso_desde: null, mensaje: "El pedido se canceló y esta NP se cortó al grabar: puede estar en Zomatik. Buscala por la marca y vaciala.", proximo_intento: null })
      return { estado: "revisar", mensaje: null }
    }
    if (await guardarSi(sb, np.id, G, { estado: "anulada", en_curso_desde: null, mensaje: "El pedido se canceló antes de generarla", proximo_intento: null }))
      await desvincularDeAnulada(sb, np, (await usosDe(sb, "np_id", [np.id])).filter((u) => u.activo), "NP anulada")
    return { estado: "anulada", mensaje: null }
  }
  const datos = await datosParaRobot(sb, np, planta, buscarAntes)
  if (!ctx.nav) ctx.nav = await ctx.abrir(llave)
  const r: ResultadoNp = await generarNp(ctx.nav, datos, {
    hoy: hoyAR(),
    alPaso: async (paso) => {
      ctx.paso = paso
      await ctx.renovar()
      // Antes de cada paso (y sobre todo antes de "grabar") la NP tiene que seguir siendo nuestra
      if (!(await guardarSi(sb, np.id, G, { paso }))) throw new NpCambio("La NP cambió mientras se generaba")
    },
  })
  const ahora = new Date().toISOString()
  const comunes = { en_curso_desde: null, mensaje: r.mensaje, disponible_m3: r.disponible ?? np.disponible_m3 ?? null }
  const ref = `Pedido ${(np.scheduled_dispatch_id || "").slice(0, 8)}`
  let guardo = true
  if (r.estado === "ok") {
    guardo = await guardarSi(sb, np.id, G, { ...comunes, estado: "ok", numero: r.numero, zomatik_codigo: r.codigo, sucursal: r.sucursal, paso: "ok", ok_at: ahora, proximo_intento: null, fecha_zomatik: np.fecha })
    if (guardo) {
      if (np.scheduled_dispatch_id) await sb.from("zomatik_np_excepciones").update({ regularizado_at: ahora } as never).eq("scheduled_dispatch_id", np.scheduled_dispatch_id).is("regularizado_at", null)
      await actividadNp(sb, { usuario: ctx.usuario, action: "crear", pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: ref, detalle: { "Qué pasó": `NP generada en Zomatik: ${r.numero}`, "m³": np.m3, Tipo: np.tipo === "proyecto" ? `Proyecto ${np.proyecto_codigo}` : "NP nueva" } })
      // Generada y verificada con la marca: se autoriza en el momento (03/11), si no el remito no la ve
      if (r.codigo && r.sucursal === SUCURSAL_REBUCRET) {
        const a = await (ctx.dep.autorizar ?? autorizarNp)(ctx.nav, { codigo: r.codigo, numero: r.numero ?? null, marca: np.marca }, { latir: ctx.renovar })
        await registrarAutorizacion(sb, { ...np, numero: r.numero ?? np.numero, paso: "ok" }, a, { usuario: ctx.usuario, avisar: ctx.dep.avisar })
      }
    }
  } else if (r.estado === "revisar") {
    guardo = await guardarSi(sb, np.id, G, { ...comunes, estado: "revisar", numero: r.numero ?? null, zomatik_codigo: r.codigo ?? null, sucursal: r.sucursal ?? null, paso: r.paso, proximo_intento: null })
    if (guardo) {
      await actividadNp(sb, { usuario: ctx.usuario, pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: ref, detalle: { "Qué pasó": "NP para revisar", Mensaje: r.mensaje } })
      const aviso = await ctx.dep.avisar(sb, `NP para revisar${r.numero ? `: ${r.numero}` : ""}`, [r.mensaje || "", `Pedido ${(np.scheduled_dispatch_id || "").slice(0, 8)} · ${np.m3} m³ · ${np.fecha}`, `Marca en observaciones: ${np.marca}`])
      if (!aviso.enviado) console.error("[zomatik-np] aviso a gerenciales:", aviso.motivo)
    }
  } else if (r.estado === "pendiente") {
    guardo = await guardarSi(sb, np.id, G, { ...comunes, estado: "pendiente", paso: r.grabado ? "grabar_cortado" : r.paso, proximo_intento: despuesDe(MIN_REINTENTO) })
    // Pendiente por red o sesión: si ya lleva más de 1 hora, un aviso a Bautista (una vez por NP)
    if (guardo) await avisarPendienteNp(sb, np, ctx, r.mensaje, datos.clienteNombre)
  } else {
    guardo = await guardarSi(sb, np.id, G, { ...comunes, estado: "error", paso: r.paso, proximo_intento: r.reintentar ? despuesDe(MIN_REINTENTO) : null })
    // Con un recorte de lo que respondió Zomatik (~2 KB), para diagnosticar sin capturarlo a mano
    if (guardo) await actividadNp(sb, { usuario: ctx.usuario, pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: ref, detalle: { "Qué pasó": "Zomatik no generó la NP", Mensaje: r.mensaje, Paso: r.paso, Marca: np.marca, ...(r.recorte ? { "Respuesta de Zomatik (recorte)": r.recorte } : {}) } })
    // Aviso a Bautista, un solo mail por episodio: si ya estaba en "error" (reintento con el botón), no se repite
    if (guardo && previo.estado !== "error") {
      const aviso = await (ctx.dep.avisarError ?? avisarErrorZomatik)(sb, `Zomatik no generó la NP · ${ref}`, [
        `${ref}${datos.clienteNombre ? ` · ${datos.clienteNombre}` : ""} · ${np.m3} m³ · ${np.fecha}${planta?.name ? ` · ${planta.name}` : ""}`,
        `Mensaje: ${r.mensaje || "(sin mensaje)"}`,
        `Paso: ${r.paso || "?"}`,
        `Marca en observaciones: ${np.marca}`,
        // Una NP en "error" no la vuelve a tomar la pasada (solo el botón): el mail dice la verdad
        // Falta vincular el cliente o la fórmula: quien programa lo vincula desde el pedido y la NP se reintenta (04/11)
        esFaltaDeVinculo(r.mensaje)
          ? "Vinculalo desde el pedido (⋯ › Vincular con Zomatik) y la NP se reintenta sola; si lo vincula un gerencial en Vínculos, tocá Generar NP ahora."
          : "No se reintenta sola: corregilo y tocá \"Generar NP ahora\" en el pedido.",
        "El pedido está guardado.",
        ...(r.recorte ? [`Respuesta de Zomatik (recorte): ${r.recorte}`] : []),
      ])
      if (!aviso.enviado) console.error("[zomatik-np] aviso de error:", aviso.motivo)
    }
  }
  if (!guardo && (r.estado === "ok" || r.estado === "revisar" || r.grabado)) await noSePudoGuardar(sb, np, ctx, r.numero ? `quedó ${r.numero}` : r.mensaje || r.estado)
  if (np.tipo === "proyecto" && np.proyecto_codigo && r.disponible !== undefined && r.disponible !== null)
    await sb.from("zomatik_proyectos").update({ disponible_m3: r.disponible, disponible_articulo: datos.articuloNombre || null, disponible_at: ahora } as never).eq("codigo", np.proyecto_codigo)
  return { estado: guardo ? r.estado : "cambió", mensaje: r.mensaje, numero: r.numero }
}

async function trabajarVaciar(sb: SB, np: FilaNpDB, ctx: Contexto) {
  const V: EstadoNp = "vaciando"
  const planta = ctx.plantas[np.plant_id || ""]
  const llave = llaveDe(planta)
  const ref = `Pedido ${(np.scheduled_dispatch_id || "").slice(0, 8)}`
  if (!llave) {
    await guardarSi(sb, np.id, V, { estado: "vaciar", en_curso_desde: null, mensaje: `La NP automática está apagada: vaciá la ${np.numero || "NP"} a mano en Zomatik.`, proximo_intento: null })
    return { estado: "vaciar", mensaje: "llave apagada" }
  }
  if (!np.zomatik_codigo) {
    await guardarSi(sb, np.id, V, { estado: "revisar", en_curso_desde: null, mensaje: "No se sabe el código de la NP en Zomatik: vaciala a mano.", proximo_intento: null })
    return { estado: "revisar", mensaje: null }
  }
  // Con remitos no se toca (23.4 / decisión 22/10): se avisa
  const conRemitos = await ctx.dep.remitos(np.numero, String(np.fecha))
  if (conRemitos === null) {
    await guardarSi(sb, np.id, V, { estado: "vaciar", en_curso_desde: null, mensaje: "No se pudo leer si la NP tiene remitos: se reintenta en 10 min.", proximo_intento: despuesDe(MIN_REINTENTO) })
    return { estado: "vaciar", mensaje: null }
  }
  if (conRemitos) {
    // Con remitos no se vacía: hace falta una devolución de pedido (DEVOL), que todavía no hace el sistema
    const msg = `La ${np.numero} tiene remitos en Zomatik: no se vació. Hace falta una devolución de pedido (DEVOL) por el saldo: hacela a mano y tocá "Ya la devolví".`
    if (await guardarSi(sb, np.id, V, { estado: "ok", en_curso_desde: null, mensaje: null, saldo_decision: "devolver", saldo_mensaje: msg, proximo_intento: null })) {
      await actividadNp(sb, { usuario: ctx.usuario, pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: ref, detalle: { "Qué pasó": "Devolver el saldo: la NP tiene remitos, falta la DEVOL a mano", NP: np.numero } })
    }
    return { estado: "ok", mensaje: msg }
  }
  if (!ctx.nav) ctx.nav = await ctx.abrir(llave)
  const r = await vaciarNp(ctx.nav, { codigo: np.zomatik_codigo, numero: np.numero, marca: np.marca }, {
    hoy: hoyAR(),
    alPaso: async (paso) => {
      ctx.paso = paso
      await ctx.renovar()
      if (!(await guardarSi(sb, np.id, V, { paso }))) throw new NpCambio("La NP cambió mientras se vaciaba")
    },
  })
  const ahora = new Date().toISOString()
  let guardo: boolean
  if (r.estado === "vaciada") {
    guardo = await guardarSi(sb, np.id, V, { estado: "vaciada", en_curso_desde: null, mensaje: null, vaciada_at: ahora, proximo_intento: null, paso: "vaciada", saldo_decision: "cerrada", saldo_mensaje: "Vaciada en Zomatik" })
    if (guardo) await actividadNp(sb, { usuario: ctx.usuario, pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: ref, detalle: { "Qué pasó": `NP vaciada en Zomatik (devolver el saldo): ${np.numero}` } })
  } else if (r.estado === "vaciar") {
    guardo = await guardarSi(sb, np.id, V, { estado: "vaciar", en_curso_desde: null, mensaje: r.mensaje, proximo_intento: despuesDe(MIN_REINTENTO) })
  } else {
    guardo = await guardarSi(sb, np.id, V, { estado: "revisar", en_curso_desde: null, mensaje: r.mensaje, proximo_intento: null })
    if (guardo) {
      await actividadNp(sb, { usuario: ctx.usuario, pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: ref, detalle: { "Qué pasó": "No se pudo vaciar la NP", Mensaje: r.mensaje, NP: np.numero, ...(r.recorte ? { "Respuesta de Zomatik (recorte)": r.recorte } : {}) } })
      await ctx.dep.avisar(sb, `No se pudo vaciar la ${np.numero || "NP"}`, [r.mensaje || "", `Pedido ${(np.scheduled_dispatch_id || "").slice(0, 8)}`])
    }
  }
  if (!guardo) await noSePudoGuardar(sb, np, ctx, r.estado)
  return { estado: guardo ? r.estado : "cambió", mensaje: r.mensaje }
}

/**
 * Trabaja las NP que esperan, con una sola sesión del robot a la vez (23.3 e). `inicio` = cuándo empezó el request:
 * no se arranca una NP si quedan menos de 30 s de los 55 s útiles de la función. El turno dura 60 s y se renueva en
 * cada paso. Cada NP se "toma" en la base antes de tocar Zomatik: dos procesos nunca trabajan la misma.
 */
export async function procesarNp(o: { usuario: string; pedidoId?: string | null; inicio: number; totalMs?: number; minimoMs?: number; sb?: SB; dep?: Dependencias }): Promise<ResultadoProceso> {
  const sb = o.sb ?? sbServicio()
  const dep = o.dep ?? DEPENDENCIAS
  const avisarError = dep.avisarError ?? avisarErrorZomatik
  const total = o.totalMs ?? 55_000
  const minimo = o.minimoMs ?? 30_000
  if (!quedaTiempo(o.inicio, Date.now(), total, minimo)) return { sinTiempo: true, hechas: [], quedan: 0 }
  // Sin ninguna llave prendida o sin NP para trabajar, no se toma el turno (no tapa la lectura diaria de Zomatik)
  const plantas = await plantasNp(sb)
  if (!Object.values(plantas).some((p) => p.zomatik_np_activo)) return { hechas: [], quedan: 0 }
  const lista = await aTrabajar(sb, o.pedidoId)
  const porAutorizar = await sinAutorizar(sb, plantas, o.pedidoId)
  if (!lista.length && !porAutorizar.length) return { hechas: [], quedan: 0 }
  const quien = `${o.usuario}·${o.inicio.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
  const { data: turno, error: et } = await sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 60 })
  if (et) throw et
  if (turno !== true) return { ocupado: true, hechas: [], quedan: 0 }
  let ultimaRenovacion = Date.now()
  const ctx: Contexto = {
    plantas, nav: null, usuario: o.usuario, dep, paso: null,
    abrir: async (llave) => {
      const nav = await dep.navegador(llave)
      await avisarZomatikVolvio(sb, avisarError)
      return nav
    },
    renovar: async () => {
      if (Date.now() - ultimaRenovacion < 10_000) return
      ultimaRenovacion = Date.now()
      await sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 60 })
    },
  }
  const hechas: ResultadoProceso["hechas"] = []
  let quedan = 0
  try {
    for (let i = 0; i < lista.length; i++) {
      if (!quedaTiempo(o.inicio, Date.now(), total, minimo)) {
        quedan = lista.length - i
        break
      }
      const np = lista[i]
      ctx.paso = null
      const vaciando = np.estado === "vaciar" || np.estado === "vaciando"
      const a: EstadoNp = vaciando ? "vaciando" : "generando"
      const { data: tom, error: e1 } = await sb.rpc("zomatik_np_tomar", { p_id: np.id, p_desde: vaciando ? ["vaciar"] : ["pendiente", ...(o.pedidoId ? ["error"] : [])], p_a: a })
      if (e1) throw e1
      const t = (tom as { np_id: string; estado_anterior: string; paso_anterior: string | null }[] | null)?.[0]
      if (!t) continue
      // Trabada: quedó colgada en "generando"/"vaciando" más de 3 veces → la mira un gerencial (no se insiste)
      if (["generando", "vaciando"].includes(t.estado_anterior) && Number(np.intentos || 0) + 1 > MAX_INTENTOS_TRABADA) {
        const msg = `Se cortó ${Number(np.intentos || 0) + 1} veces en el medio (último paso: ${t.paso_anterior || "?"}). No se reintenta: revisala en Zomatik buscando la marca.`
        if (await guardarSi(sb, np.id, a, { estado: "revisar", en_curso_desde: null, mensaje: msg, proximo_intento: null })) {
          await actividadNp(sb, { usuario: ctx.usuario, pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: `Pedido ${(np.scheduled_dispatch_id || "").slice(0, 8)}`, detalle: { "Qué pasó": "NP trabada: para revisar", Mensaje: msg, Marca: np.marca } })
          await dep.avisar(sb, "NP trabada: para revisar", [msg, `Marca: ${np.marca}`])
        }
        hechas.push({ id: np.id, estado: "revisar", mensaje: msg })
        continue
      }
      try {
        const r = vaciando ? await trabajarVaciar(sb, np, ctx) : await trabajarGenerar(sb, np, ctx, { estado: t.estado_anterior, paso: t.paso_anterior })
        hechas.push({ id: np.id, ...r })
      } catch (e) {
        if (e instanceof NpCambio) {
          await noSePudoGuardar(sb, np, ctx, e.message)
          hechas.push({ id: np.id, estado: "cambió", mensaje: e.message })
          continue
        }
        // Falla de nuestro lado o de la sesión (antes de que el robot devuelva): se deja para el reintento. Lo que no es de
        // Zomatik no se tapa con "Error leyendo Zomatik": va el error interno real (como en Z1)
        const m = errorInterno(e) ?? (mensajeZomatik(e) || "Error")
        const volvio = await guardarSi(sb, np.id, a, { estado: vaciando ? "vaciar" : "pendiente", en_curso_desde: null, mensaje: m, proximo_intento: despuesDe(MIN_REINTENTO) })
        hechas.push({ id: np.id, estado: vaciando ? "vaciar" : "pendiente", mensaje: m })
        if (volvio) {
          const ref = `Pedido ${(np.scheduled_dispatch_id || "").slice(0, 8)}`
          const que = vaciando ? `vaciar la ${np.numero || "NP"}` : "generar la NP"
          if (esFallaDeAcceso(e)) {
            // No se puede entrar a Zomatik: un solo aviso para todo el robot, no uno por NP
            await avisarFallaAcceso(sb, avisarError, { que: `${que} (${ref})`, mensaje: m, codigo: tipoDeFalla(e) })
          } else {
            await avisarCaidaFila(sb, avisarError, {
              usuario: ctx.usuario, pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, ref, marca: np.marca,
              firma: `${tipoDeFalla(e)}|${ctx.paso || "inicio"}`, mensaje: m, paso: ctx.paso,
              titulo: `El robot de Zomatik se cayó ${vaciando ? "vaciando" : "generando"} la NP · ${ref}`,
              lineas: [
                `${ref} · ${np.m3} m³ · ${np.fecha}${plantas[np.plant_id || ""]?.name ? ` · ${plantas[np.plant_id || ""]!.name}` : ""}`,
                `Qué se estaba haciendo: ${que}${ctx.paso ? ` · paso ${ctx.paso}` : ""}`,
                `Mensaje: ${m}`,
                `Marca en observaciones: ${np.marca}`,
                `La NP queda ${vaciando ? "para vaciar" : "pendiente"}: se reintenta en la próxima pasada (cada 10 minutos). Mientras se caiga igual, no llega otro mail.`,
              ],
            })
          }
          if (!vaciando) await avisarPendienteNp(sb, np, ctx, m, null)
        }
        if (esFallaDeAcceso(e) || /sesi[oó]n|entrar a Zomatik|login|ZOMATIK_USER/i.test(m)) break // no se insiste con la sesión caída
      }
    }
    // NP "ok" que quedaron sin autorizar en Zomatik: se reintenta (con el tiempo que quede)
    for (const np of porAutorizar) {
      if (!quedaTiempo(o.inicio, Date.now(), total, minimo)) break
      const llave = llaveDe(plantas[np.plant_id || ""])
      if (!llave || !np.zomatik_codigo) continue
      try {
        if (!ctx.nav) ctx.nav = await ctx.abrir(llave)
        const a = await (dep.autorizar ?? autorizarNp)(ctx.nav, { codigo: np.zomatik_codigo, numero: np.numero, marca: np.marca }, { latir: ctx.renovar })
        await registrarAutorizacion(sb, np, a, { usuario: ctx.usuario, avisar: dep.avisar })
        hechas.push({ id: np.id, estado: a.estado, mensaje: a.mensaje })
      } catch (e) {
        console.error("[zomatik-np] autorizar", (e as Error)?.message)
      }
    }
  } finally {
    await sb.rpc("zomatik_robot_soltar", { p_quien: quien })
  }
  return { hechas, quedan }
}

/** NP "ok" de REBUCRET que quedaron sin autorizar (paso sin_autorizar), de plantas con la llave prendida. */
async function sinAutorizar(sb: SB, plantas: Record<string, PlantaNpDB>, pedidoId?: string | null): Promise<FilaNpDB[]> {
  let q = sb.from("zomatik_np").select(COLUMNAS_NP).eq("estado", "ok").eq("paso", PASO_SIN_AUTORIZAR).order("updated_at").limit(5)
  if (pedidoId) q = q.eq("scheduled_dispatch_id", pedidoId)
  const { data, error } = await q
  if (error) throw error
  return ((data as unknown as FilaNpDB[]) || []).filter((x) => x.zomatik_codigo && (!x.sucursal || x.sucursal === SUCURSAL_REBUCRET) && llaveDe(plantas[x.plant_id || ""]))
}

// ---------------------------------------------------------------------------
// La pasada (cron cada 10 min, botón y Programación abierta): solo la base, sin Zomatik
// ---------------------------------------------------------------------------

/**
 * Sincroniza los pedidos de hoy en adelante de las plantas con la llave prendida y los que tienen NP vivas. Para si se
 * le termina el tiempo (`hastaMs` desde `inicio`), así el robot todavía tiene lugar.
 */
export async function pasadaNp(usuario: string, o: { inicio: number; hastaMs?: number; sb?: SB } = { inicio: Date.now() }): Promise<{ pedidos: number; sincronizados: number }> {
  const sb = o.sb ?? sbServicio()
  const hasta = o.hastaMs ?? 20_000
  const plantas = Object.values(await plantasNp(sb)).filter((p) => p.zomatik_np_activo)
  const ids = new Set<string>()
  if (plantas.length) {
    const desdeDia = new Date(`${hoyAR()}T03:00:00.000Z`).toISOString() // 00:00 de Argentina
    const { data } = await sb.from("scheduled_dispatches").select("id, plant_id, created_at").in("plant_id", plantas.map((p) => p.id)).gte("scheduled_arrival_time", desdeDia).not("status", "in", "(completed,cancelled)").limit(500)
    for (const p of (data as { id: string; plant_id: string; created_at: string }[]) || []) if (pedidoConNp(plantas.find((x) => x.id === p.plant_id), p.created_at)) ids.add(p.id)
  }
  // Los pedidos ACTIVOS que usan NP vivas (cambios y NP adicionales). Los cancelados y completos no se miran más
  // (se sincronizan al cancelar o finalizar; el robot no genera NP de un pedido cancelado) ni las NP cerradas.
  const { data: vivas } = await sb.from("zomatik_np").select("id, saldo_decision").in("estado", ["ok", "pendiente", "error"] as EstadoNp[]).limit(1000)
  const usosVivos = await usosDe(sb, "np_id", ((vivas as { id: string; saldo_decision: string | null }[]) || []).filter((x) => x.saldo_decision !== "cerrada").map((x) => x.id))
  const candidatos = [...new Set(usosVivos.filter((u) => u.activo && u.scheduled_dispatch_id).map((u) => u.scheduled_dispatch_id!))].filter((id) => !ids.has(id))
  if (candidatos.length) {
    const { data: act } = await sb.from("scheduled_dispatches").select("id").in("id", candidatos).not("status", "in", "(completed,cancelled)")
    for (const p of (act as { id: string }[]) || []) ids.add(p.id)
  }
  let sincronizados = 0
  for (const id of ids) {
    if (Date.now() - o.inicio > hasta) break
    try {
      await sincronizarPedido(id, usuario, null, sb)
      sincronizados++
    } catch (e) {
      console.error("[zomatik-np] sincronizar", id, (e as Error)?.message)
    }
  }
  // Las NP de pedidos borrados ya no se vacían solas: quedan en "NP con saldo" para decidir (respuesta 2 del 23/10)
  return { pedidos: ids.size, sincronizados }
}

// ---------------------------------------------------------------------------
// Control de NP eliminadas a mano en Zomatik (pasada de la noche, solo lectura en Zomatik)
// ---------------------------------------------------------------------------

/** Cuántos días para atrás (por la fecha de la NP) se controlan las NP "ok". */
export const DIAS_CONTROL_ELIMINADAS = 60
/** La segunda lectura tiene que ser de otra pasada: al menos esto después de la primera. */
export const ENTRE_LECTURAS_MS = 6 * 60 * 60_000
/** `details.Control` de las entradas de Actividad del control (la marca de "sospechosa" vive ahí, sin cambiar la base). */
export const CONTROL_ELIMINADA = "np_eliminada"
/** Llave del control (`integraciones`): corre solo si existe esta fila. Sin la fila (como arranca), apagado. */
export const CLAVE_CONTROL_ELIMINADAS = "np_control_eliminadas"
/** Noches seguidas con todo ilegible (`integraciones`, valor `{"noches":[…],"avisado":bool}`): se borra al leer bien. */
export const CLAVE_CONTROL_ILEGIBLE = "np_control_eliminadas_ilegible"
/** Con tantas noches seguidas sin poder leer, un mail a Bautista (uno solo hasta que vuelva a leer bien). */
export const NOCHES_ILEGIBLE_AVISO = 3
/** Más de esto "no está" en una misma pasada = posible falla de lectura: no se marca ninguna. */
export const MAX_NO_ESTA = 2
/** Las lecturas en Zomatik paran con este margen antes del límite de la función. */
export const MARGEN_LECTURA_MS = 20_000
/** Antes de cada cambio en la base (o un mail) tiene que quedar al menos esto. */
const MARGEN_ESCRITURA_MS = 10_000
export const MSJ_ELIMINADA_REVISAR = "La NP fue eliminada en Zomatik: ¿la hicieron a mano? Revisá antes de generar otra"
export const msjEliminadaAnulada = (hoy: string) => `Eliminada en Zomatik (detectado el ${hoy.slice(8, 10)}/${hoy.slice(5, 7)})`
const ddmm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`

export type DependenciasControl = {
  /** Navegador de solo lectura (en las pruebas, uno simulado). */
  navegador: () => Promise<NavegadorNp>
  buscar?: typeof buscarNpEnZomatik
  avisarError?: AvisarFn
}
export const DEPENDENCIAS_CONTROL: DependenciasControl = { navegador: navegadorLectura, buscar: buscarNpEnZomatik, avisarError: avisarErrorZomatik }

export type ResultadoControl = {
  controladas: number; ilegibles: number; sospechosas: number; anuladas: number; revisar: number; avisos: number
  apagado?: boolean; ocupado?: boolean; sinTiempo?: boolean; freno?: boolean
}

type MarcaControl = { Lectura?: string; NpId?: string; Avisado?: string; creada: string }

/** Las entradas de Actividad del control (lo más nuevo primero). */
async function marcasControl(sb: SB): Promise<MarcaControl[]> {
  const desde = new Date(Date.now() - (DIAS_CONTROL_ELIMINADAS + 10) * 86_400_000).toISOString()
  const { data, error } = await sb.from("activity_log").select("details, created_at").eq("entity", "zomatik_np").eq("details->>Control", CONTROL_ELIMINADA).gte("created_at", desde).order("created_at", { ascending: false }).limit(2000)
  if (error) throw error
  return ((data as { details: Record<string, unknown> | null; created_at: string }[] | null) || []).map((x) => ({ ...(x.details || {}), creada: x.created_at }) as MarcaControl)
}

const logControl = (sb: SB, usuario: string, np: FilaNpDB, detalle: Record<string, unknown>) =>
  actividadNp(sb, { usuario, pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: `Pedido ${(np.scheduled_dispatch_id || "").slice(0, 8)}`, detalle: { ...detalle, Control: CONTROL_ELIMINADA, NpId: np.id, NP: np.numero, Marca: np.marca } })

/** Los pedidos activos (ni completos ni cancelados) que usan la NP, y sus usos activos. */
async function usoActivoDe(sb: SB, npId: string): Promise<{ usos: UsoDB[]; activos: { id: string; status: string }[] }> {
  const usos = (await usosDe(sb, "np_id", [npId])).filter((u) => u.activo)
  const pedidoIds = [...new Set(usos.map((u) => u.scheduled_dispatch_id).filter(Boolean) as string[])]
  const { data: peds, error } = pedidoIds.length ? await sb.from("scheduled_dispatches").select("id, status").in("id", pedidoIds) : { data: [], error: null }
  if (error) throw error
  return { usos, activos: ((peds as { id: string; status: string }[]) || []).filter((p) => p.status !== "completed" && p.status !== "cancelled") }
}

/**
 * Con la llave (`integraciones.np_control_eliminadas`) prendida, busca en el listado de pedidos de Zomatik (REBUCRET,
 * solo lectura) las NP "ok" con número de los últimos 60 días. Una NP que no aparece (con el listado leído bien) queda
 * SOSPECHOSA en Actividad; si en otra pasada (6 h después o más) sigue sin aparecer, se da por eliminada:
 *   - un pedido activo (no completo ni cancelado) la usa: "revisar" + un mail a Bautista (no se anula: si no,
 *     `sincronizarPedido` generaría otra y podría duplicar una que se hizo a mano). Si el mail no sale, se reintenta;
 *   - si no: "anulada", con los usos inactivos y lo remitido de verdad contra ella (`remitidoContra`), y Actividad.
 * Freno: si en una pasada faltan más de 2, no se marca ninguna (posible falla de lectura) y se avisa. Con el listado
 * ilegible no se concluye nada; 3 noches seguidas así, un mail. Si aparece después de una sospecha, se cierra.
 */
export async function controlarNpEliminadas(usuario: string, o: { inicio: number; hastaMs?: number; sb?: SB; dep?: DependenciasControl } = { inicio: Date.now() }): Promise<ResultadoControl> {
  const sb = o.sb ?? sbServicio()
  const dep = o.dep ?? DEPENDENCIAS_CONTROL
  const avisarError = dep.avisarError ?? avisarErrorZomatik
  const hasta = o.hastaMs ?? 55_000
  const quedan = () => hasta - (Date.now() - o.inicio)
  const res: ResultadoControl = { controladas: 0, ilegibles: 0, sospechosas: 0, anuladas: 0, revisar: 0, avisos: 0 }
  const { data: llave, error: el } = await sb.from("integraciones").select("clave").eq("clave", CLAVE_CONTROL_ELIMINADAS).maybeSingle()
  if (el) throw el
  if (!llave) return { ...res, apagado: true }
  if (quedan() < MARGEN_LECTURA_MS + 5_000) return { ...res, sinTiempo: true }
  const hoy = hoyAR()
  const desde = new Date(Date.parse(`${hoy}T12:00:00Z`) - DIAS_CONTROL_ELIMINADAS * 86_400_000).toISOString().slice(0, 10)
  const { data, error } = await sb.from("zomatik_np").select(COLUMNAS_NP).eq("estado", "ok").not("numero", "is", null).gte("fecha", desde).order("fecha", { ascending: false }).limit(500)
  if (error) throw error
  const nps = ((data as unknown as FilaNpDB[]) || []).filter((x) => x.numero && esSerieRebucret(x.numero) && (!x.sucursal || x.sucursal === SUCURSAL_REBUCRET))
  res.controladas = nps.length

  if (nps.length) {
    // Lectura en Zomatik con el turno del robot (no se cruza con una NP que se está generando en otra sucursal)
    const quien = `control·${usuario}·${o.inicio.toString(36)}`
    const { data: turno, error: et } = await sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 60 })
    if (et) throw et
    let lecturas = new Map<string, LecturaNp>()
    if (turno !== true) res.ocupado = true
    else {
      try {
        let ultima = Date.now()
        const latir = async () => {
          if (Date.now() - ultima < 10_000) return
          ultima = Date.now()
          await sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 60 })
        }
        const nav = await dep.navegador()
        lecturas = await (dep.buscar ?? buscarNpEnZomatik)(nav, nps.map((x) => ({ id: x.id, numero: x.numero!, codigo: x.zomatik_codigo })), { latir, seguir: () => quedan() > MARGEN_LECTURA_MS })
      } catch (e) {
        // Sin sesión o sin red: no se concluye nada
        console.error("[zomatik-np] control de eliminadas:", errorInterno(e) ?? mensajeZomatik(e))
      } finally {
        await sb.rpc("zomatik_robot_soltar", { p_quien: quien })
      }
    }

    // Freno: muchas que faltan a la vez parece una falla de lectura, no NP borradas a mano
    const faltan = nps.filter((x) => lecturas.get(x.id)?.estado === "no_esta")
    if (faltan.length > MAX_NO_ESTA) {
      res.freno = true
      for (const x of faltan) lecturas.set(x.id, { estado: "ilegible", motivo: "posible falla de lectura" })
      const r = await avisarError(sb, "Control de NP eliminadas: posible falla de lectura", [
        `Esta noche ${faltan.length} NP no aparecieron en el listado de pedidos de Zomatik: ${faltan.map((x) => x.numero).join(", ")}.`,
        `Con más de ${MAX_NO_ESTA} a la vez no se marca ninguna: puede ser una falla de lectura. Fijate en Zomatik si de verdad las eliminaron.`,
      ])
      if (!r.enviado) console.error("[zomatik-np] aviso del freno:", r.motivo)
    }

    const marcas = await marcasControl(sb)
    const ahora = Date.now()
    const log = (np: FilaNpDB, d: Record<string, unknown>) => logControl(sb, usuario, np, d)
    for (const np of nps) {
      const l = lecturas.get(np.id)
      const ultima = marcas.find((m) => m.NpId === np.id)
      const sospechosa = ultima?.Lectura === "sospecha"
      try {
        if (!l || l.estado === "ilegible") {
          res.ilegibles++
          continue
        }
        if (quedan() < MARGEN_ESCRITURA_MS) continue // sin tiempo: lo que falte, en la próxima pasada
        if (l.estado === "esta") {
          if (sospechosa) await log(np, { "Qué pasó": `${np.numero} volvió a aparecer en Zomatik: no estaba eliminada`, Lectura: "aparece" })
          continue
        }
        // No está: la primera vez queda sospechosa; en otra pasada, eliminada
        if (!sospechosa) {
          await log(np, { "Qué pasó": `${np.numero} no aparece en el listado de Zomatik: se vuelve a mirar en la próxima pasada`, Lectura: "sospecha" })
          res.sospechosas++
          continue
        }
        if (ahora - Date.parse(ultima!.creada) < ENTRE_LECTURAS_MS) continue // misma pasada (o una repetida): se espera la próxima
        const r = await npEliminada(sb, np, { usuario, hoy, log })
        if (r === "anulada") res.anuladas++
        if (r === "revisar") res.revisar++
      } catch (e) {
        console.error("[zomatik-np] control de eliminadas", np.numero, (e as Error)?.message)
      }
    }
    // Noches seguidas sin poder leer nada (no cuenta si el robot estaba ocupado)
    if (!res.ocupado) {
      try {
        await registrarNoche(sb, hoy, !nps.some((x) => ["esta", "no_esta"].includes(lecturas.get(x.id)?.estado || "")), avisarError)
      } catch (e) {
        console.error("[zomatik-np] noches ilegibles", (e as Error)?.message)
      }
    }
  }
  // El mail de las que quedaron "revisar" (también el que no salió en una pasada anterior)
  res.avisos = await avisosEliminadas(sb, { usuario, avisarError, quedan })
  return res
}

/** Una NP confirmada como eliminada en Zomatik: "revisar" si la usa un pedido activo; si no, "anulada". */
async function npEliminada(sb: SB, np: FilaNpDB, o: { usuario: string; hoy: string; log: (np: FilaNpDB, d: Record<string, unknown>) => Promise<void> }): Promise<"anulada" | "revisar" | "cambió"> {
  const { usos, activos } = await usoActivoDe(sb, np.id)
  if (activos.length) {
    // El mail lo manda `avisosEliminadas` (y lo reintenta si no sale)
    if (!(await guardarSi(sb, np.id, "ok", { estado: "revisar", mensaje: MSJ_ELIMINADA_REVISAR, proximo_intento: null }))) return "cambió"
    await o.log(np, { "Qué pasó": `${np.numero} fue eliminada en Zomatik y la usa un pedido activo: para revisar`, Lectura: "revisar" })
    return "revisar"
  }
  // Primero los usos (inactivos, con lo remitido de verdad contra ella: suele ser 0) y después la NP. Si se corta en el
  // medio, la NP sigue "ok" con la sospecha y la próxima pasada la vuelve a confirmar y termina.
  await desvincularDeAnulada(sb, np, usos, "NP eliminada en Zomatik")
  if (!(await guardarSi(sb, np.id, "ok", { estado: "anulada", mensaje: msjEliminadaAnulada(o.hoy), proximo_intento: null }))) return "cambió"
  await o.log(np, { "Qué pasó": `${np.numero} fue eliminada en Zomatik: se anuló`, Lectura: "anulada" })
  return "anulada"
}

/**
 * Mail a Bautista de cada NP que el control dejó "revisar", uno solo por NP: lo que ya salió se ve en Actividad
 * (`Lectura: "aviso"`, `Avisado: "sí"`). Si no salió, se reintenta en la próxima pasada.
 */
async function avisosEliminadas(sb: SB, o: { usuario: string; avisarError: AvisarFn; quedan: () => number }): Promise<number> {
  const { data, error } = await sb.from("zomatik_np").select(COLUMNAS_NP).eq("estado", "revisar").eq("mensaje", MSJ_ELIMINADA_REVISAR).limit(50)
  if (error) throw error
  const nps = (data as unknown as FilaNpDB[]) || []
  if (!nps.length) return 0
  const marcas = await marcasControl(sb)
  let enviados = 0
  for (const np of nps) {
    if (marcas.some((m) => m.NpId === np.id && m.Lectura === "aviso" && m.Avisado === "sí")) continue
    if (o.quedan() < MARGEN_ESCRITURA_MS) break
    try {
      const { activos } = await usoActivoDe(sb, np.id)
      const r = await o.avisarError(sb, `NP eliminada en Zomatik: ${np.numero}`, [
        `La ${np.numero} no aparece más en el listado de pedidos de Zomatik (dos controles en noches distintas).`,
        activos.length ? `La usa ${activos.length === 1 ? "un pedido activo" : `${activos.length} pedidos activos`}: ${activos.map((p) => `Pedido ${p.id.slice(0, 8)}`).join(", ")}.` : "",
        "No se anuló ni se genera otra sola: puede que la hayan rehecho a mano. Revisala en Programación (Revisar NP) antes de generar otra.",
        `Marca en observaciones: ${np.marca}`,
      ].filter(Boolean))
      if (!r.enviado) console.error("[zomatik-np] aviso de NP eliminada:", r.motivo)
      await logControl(sb, o.usuario, np, { "Qué pasó": r.enviado ? `Aviso a Bautista: ${np.numero} eliminada en Zomatik` : `No salió el aviso de ${np.numero} eliminada en Zomatik: se reintenta en la próxima pasada`, Lectura: "aviso", Avisado: r.enviado ? "sí" : "no" })
      if (r.enviado) enviados++
    } catch (e) {
      console.error("[zomatik-np] aviso de NP eliminada", np.numero, (e as Error)?.message)
    }
  }
  return enviados
}

/** Lleva la cuenta de noches seguidas con todo ilegible; a la 3.ª, un mail (uno solo hasta que vuelva a leer bien). */
async function registrarNoche(sb: SB, hoy: string, todoIlegible: boolean, avisar: AvisarFn): Promise<void> {
  if (!todoIlegible) {
    await sb.from("integraciones").delete().eq("clave", CLAVE_CONTROL_ILEGIBLE)
    return
  }
  const { data } = await sb.from("integraciones").select("valor").eq("clave", CLAVE_CONTROL_ILEGIBLE).maybeSingle()
  let antes: { noches?: unknown; avisado?: unknown } = {}
  try {
    antes = JSON.parse((data as { valor?: string } | null)?.valor || "{}")
  } catch {
    // mal escrita: se empieza de cero
  }
  const noches = [...new Set([...(Array.isArray(antes.noches) ? antes.noches.map(String) : []), hoy])].sort().slice(-10)
  let avisado = antes.avisado === true
  if (!avisado && noches.length >= NOCHES_ILEGIBLE_AVISO) {
    const r = await avisar(sb, "Control de NP eliminadas: no puede leer Zomatik", [
      `Hace ${noches.length} noches seguidas que el control no puede leer el listado de pedidos de Zomatik (${noches.map(ddmm).join(", ")}).`,
      "Mientras siga así no detecta las NP eliminadas a mano. Este aviso llega una sola vez hasta que vuelva a leer bien.",
    ])
    if (!r.enviado) console.error("[zomatik-np] aviso de noches ilegibles:", r.motivo)
    avisado = r.enviado
  }
  await sb.from("integraciones").upsert({ clave: CLAVE_CONTROL_ILEGIBLE, valor: JSON.stringify({ noches, avisado }), actualizado: new Date().toISOString(), conectado_por: "sistema" } as never, { onConflict: "clave" })
}

// ---------------------------------------------------------------------------
// Estado para las pantallas
// ---------------------------------------------------------------------------

export type EstadoPedidoNp = {
  activo: boolean
  modo: ModoNp
  /** El pedido entra en la NP automática (cargado después de prender la llave). */
  entra: boolean
  /** Las NP que usa el pedido (con los m³ que reserva de cada una y lo libre de la NP). */
  nps: (FilaNpDB & { m3_uso: number; libre: number })[]
  /** El pedido está cancelado o completo: sus NP con saldo van a "NP con saldo". */
  cerrado: boolean
  excepcion: { autorizado_por: string; motivo_tipo: string; motivo: string | null } | null
  control: { bloquea: boolean; aviso: string | null }
  /** NP nueva o de un proyecto (null = todavía no se eligió). */
  eleccion: EleccionDB | null
}

export async function estadoPedidos(ids: string[]): Promise<{ porPedido: Record<string, EstadoPedidoNp>; plantas: Record<string, { activo: boolean; modo: ModoNp; aviso_hasta: string | null }> }> {
  const sb = sbServicio()
  const plantas = await plantasNp(sb)
  const resumen = Object.fromEntries(Object.values(plantas).map((p) => [p.id, { activo: !!p.zomatik_np_activo, modo: modoDe(p), aviso_hasta: p.aviso_hasta ?? null }]))
  if (!ids.length || !Object.values(plantas).some((p) => p.zomatik_np_activo)) {
    return { porPedido: {}, plantas: resumen }
  }
  const [{ data: peds }, usos, { data: exc }, elecciones] = await Promise.all([
    sb.from("scheduled_dispatches").select("id, plant_id, created_at, status").in("id", ids),
    usosDe(sb, "scheduled_dispatch_id", ids),
    sb.from("zomatik_np_excepciones").select("scheduled_dispatch_id, autorizado_por, motivo_tipo, motivo").in("scheduled_dispatch_id", ids).eq("fecha", hoyAR()),
    eleccionesDe(sb, ids),
  ])
  const activos = usos.filter((u) => u.activo)
  const nps = await npsPorId(sb, [...new Set(activos.map((u) => u.np_id))])
  const saldos = await saldosDe(sb, nps.filter((x) => x.estado === "ok"))
  const porPedido: Record<string, EstadoPedidoNp> = {}
  for (const p of (peds as { id: string; plant_id: string; created_at: string; status: string }[]) || []) {
    const planta = plantas[p.plant_id]
    const modo = modoDe(planta)
    const suyas = activos
      .filter((u) => u.scheduled_dispatch_id === p.id)
      .map((u) => {
        const x = nps.find((n) => n.id === u.np_id)
        return x ? { ...x, m3_uso: Number(u.m3), libre: Math.max(0, saldos.get(x.id)?.libre ?? 0) } : null
      })
      .filter(Boolean) as (FilaNpDB & { m3_uso: number; libre: number })[]
    const entra = pedidoConNp(planta, p.created_at) || suyas.length > 0
    const e = ((exc as { scheduled_dispatch_id: string; autorizado_por: string; motivo_tipo: string; motivo: string | null }[]) || []).find((x) => x.scheduled_dispatch_id === p.id) || null
    porPedido[p.id] = {
      activo: !!planta?.zomatik_np_activo,
      modo,
      entra,
      nps: suyas,
      cerrado: p.status === "cancelled" || p.status === "completed",
      excepcion: e ? { autorizado_por: e.autorizado_por, motivo_tipo: e.motivo_tipo, motivo: e.motivo } : null,
      control: controlDespacho({ modo, entra, nps: suyas.filter((x) => VIGENTES.includes(x.estado)), excepcion: !!e }),
      eleccion: elecciones[p.id] || null,
    }
  }
  return { porPedido, plantas: resumen }
}

/** Revisión de un gerencial de una NP en "revisar": generar otra (la errónea ya se vació a mano) o dejar esta como buena. */
export async function revisarNp(npId: string, decision: "otra" | "buena", usuario: string, sb: SB = sbServicio(), usuarioId: string | null = null): Promise<{ ok: boolean; error?: string }> {
  const { data } = await sb.from("zomatik_np").select(COLUMNAS_NP).eq("id", npId).maybeSingle()
  const np = data as unknown as FilaNpDB | null
  if (!np) return { ok: false, error: "La NP no existe" }
  if (np.estado !== "revisar") return { ok: false, error: "La NP ya no está para revisar. Actualizá la pantalla." }
  if (decision === "buena") {
    if (!np.numero || !np.zomatik_codigo || np.sucursal !== "18" || !esSerieRebucret(np.numero)) return { ok: false, error: "Esta NP no es de REBUCRET: no se puede dejar como buena." }
    if (!(await guardarSi(sb, np.id, "revisar", { estado: "ok", mensaje: `Revisada por ${usuario}`, ok_at: new Date().toISOString() }))) return { ok: false, error: "La NP cambió. Actualizá la pantalla." }
  } else {
    if (!(await guardarSi(sb, np.id, "revisar", { estado: "anulada", mensaje: `${np.mensaje || ""} · Revisada por ${usuario}: se genera otra`.replace(/^ · /, "") }))) return { ok: false, error: "La NP cambió. Actualizá la pantalla." }
    // Su uso queda siempre inactivo, con lo que se remitió de verdad contra ella (sin número, 0): no se lleva lo
    // despachado del pedido que va a ir en la NP nueva
    await desvincularDeAnulada(sb, np, (await usosDe(sb, "np_id", [np.id])).filter((u) => u.activo), "NP anulada (revisada: se genera otra)")
    if (np.scheduled_dispatch_id) await sincronizarPedido(np.scheduled_dispatch_id, usuario, null, sb, { usuarioId })
  }
  await actividadNp(sb, { usuario, pedidoId: np.scheduled_dispatch_id, plantId: np.plant_id, referencia: `Pedido ${(np.scheduled_dispatch_id || "").slice(0, 8)}`, detalle: { "Qué pasó": decision === "buena" ? `NP revisada: queda ${np.numero}` : "NP revisada: se genera otra", NP: np.numero, Antes: np.mensaje } })
  return { ok: true }
}
