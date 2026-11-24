/**
 * Fase 0c-2 · Freno a la adivinación de contraseñas en el login.
 *
 * Se cuenta por persona y por lugar (IP), en una ventana de 15 minutos (tabla `ingreso_intentos`, función
 * `ingreso_reservar` de la migración 202611241800, con candado: el intento se reserva ANTES de verificar la
 * contraseña, así 100 pedidos juntos no dan 100 intentos):
 *   - misma persona desde el mismo lugar: 5
 *   - misma persona desde cualquier lugar: 10
 *   - mismo lugar, cualquier persona: 20 (la planta sale a internet por una sola IP)
 * El 04/11/2026 se había sacado el bloqueo por cuenta (un error ajeno dejaba afuera a la persona); por eso ahora
 * el límite más bajo es el de persona + lugar.
 *
 * Sin imports de otros archivos del proyecto (se prueba con `node --test`).
 */

export const VENTANA_MIN = 15
export const LIMITE_PERSONA_LUGAR = 5
export const LIMITE_PERSONA = 10
export const LIMITE_LUGAR = 20

/**
 * IP de quien pide. En Vercel, `x-real-ip` y el primer valor de `x-forwarded-for` los pone Vercel (pisa lo que
 * mande el navegador). Fuera de Vercel puede no haber ninguno: "desconocida" (cuenta igual, todos juntos).
 */
export function ipDelPedido(headers: { get(nombre: string): string | null }): string {
  const real = (headers.get("x-real-ip") || "").trim()
  if (real) return real.slice(0, 64)
  const ff = (headers.get("x-forwarded-for") || "").split(",")[0]?.trim()
  if (ff) return ff.slice(0, 64)
  return "desconocida"
}

export function errorDemasiadosIntentos(segundos: number): string {
  const m = Math.max(1, Math.ceil((Number.isFinite(segundos) ? segundos : VENTANA_MIN * 60) / 60))
  return `Demasiados intentos. Esperá ${m} ${m === 1 ? "minuto" : "minutos"} y probá de nuevo, o pedile a un gerencial que te desbloquee desde Usuarios.`
}

export type Reserva = { permitido: boolean; espera_seg: number | null; intento_id: number | null }

/**
 * Lo que contestó `ingreso_reservar`. Si la función todavía no existe (migración sin aplicar), el login sigue
 * como antes (sin freno): `sinFreno`.
 */
export function leerReserva(data: unknown, error: { code?: string; message?: string } | null | undefined):
  | { sinFreno: true; motivo: string }
  | { sinFreno: false; permitido: boolean; esperaSeg: number; intentoId: number | null } {
  if (error) {
    const falta = error.code === "PGRST202" || error.code === "42883" || /could not find the function|does not exist/i.test(error.message || "")
    if (falta) return { sinFreno: true, motivo: "falta la migración 202611241800 (ingreso_reservar)" }
    throw Object.assign(new Error(error.message || "No se pudo controlar los intentos"), { code: error.code })
  }
  const fila = (Array.isArray(data) ? data[0] : data) as Partial<Reserva> | null | undefined
  if (!fila || typeof fila.permitido !== "boolean") return { sinFreno: true, motivo: "respuesta inesperada de ingreso_reservar" }
  return {
    sinFreno: false,
    permitido: fila.permitido,
    esperaSeg: Number(fila.espera_seg) || 0,
    intentoId: fila.intento_id == null ? null : Number(fila.intento_id),
  }
}

export type FilaIntento = { user_id: string | null; ip: string; creado_at: string }

/**
 * Segundos que le faltan a una persona para poder probar de nuevo (0 = no está frenada), para la pantalla
 * Usuarios. Mismo criterio que `ingreso_reservar`: 5 desde un mismo lugar o 10 en total, en 15 minutos.
 */
export function esperaDePersona(filas: FilaIntento[], userId: string, ahoraMs: number = Date.now()): number {
  const desde = ahoraMs - VENTANA_MIN * 60000
  const horas = (fs: FilaIntento[]) => fs.map((f) => new Date(f.creado_at).getTime()).filter((t) => Number.isFinite(t) && t >= desde).sort((a, b) => b - a)
  const espera = (hs: number[], limite: number) => (hs.length < limite ? 0 : Math.max(0, Math.ceil((hs[limite - 1] + VENTANA_MIN * 60000 - ahoraMs) / 1000)))
  const propias = filas.filter((f) => f.user_id === userId)
  let max = espera(horas(propias), LIMITE_PERSONA)
  const porLugar = new Map<string, FilaIntento[]>()
  for (const f of propias) porLugar.set(f.ip, [...(porLugar.get(f.ip) || []), f])
  for (const fs of porLugar.values()) max = Math.max(max, espera(horas(fs), LIMITE_PERSONA_LUGAR))
  return max
}
