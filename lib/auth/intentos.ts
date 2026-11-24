/**
 * Fase 0c-2 · Freno a la adivinación de contraseñas en el login.
 *
 * Se cuenta en una ventana de 15 minutos (tabla `ingreso_intentos`, función `ingreso_reservar` de la migración
 * 202611241800, con candado: el intento se reserva ANTES de verificar la contraseña, así 100 pedidos juntos no dan
 * 100 intentos):
 *   - misma persona desde el mismo lugar (IP): 5
 *   - mismo lugar, cualquier persona: 50 (la planta sale a internet por una sola IP: tiene que ser alto)
 * NO hay límite por persona sola: los ids de la lista del login son públicos y alguien de afuera podría dejar
 * frenado al plantista (es lo que se sacó el 04/11/2026).
 *
 * Sin imports de otros archivos del proyecto (se prueba con `node --test`).
 */

export const VENTANA_MIN = 15
export const LIMITE_PERSONA_LUGAR = 5
export const LIMITE_LUGAR = 50

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

export type BloqueoPersona = {
  /** Segundos que faltan para poder probar de nuevo (0 = no está frenada). */
  segundos: number
  /** "persona": 5 errores suyos desde un lugar. "lugar": 50 errores de cualquiera desde un lugar donde ella probó. */
  motivo: "persona" | "lugar" | null
  ip: string | null
}

/**
 * Para la pantalla Usuarios: ¿la persona está frenada? Mismo criterio que `ingreso_reservar`: 5 suyos desde un
 * mismo lugar, o 50 de cualquiera desde un lugar (IP) donde ella probó, en 15 minutos.
 */
export function bloqueoDePersona(filas: FilaIntento[], userId: string, ahoraMs: number = Date.now()): BloqueoPersona {
  const desde = ahoraMs - VENTANA_MIN * 60000
  const horas = (fs: FilaIntento[]) => fs.map((f) => new Date(f.creado_at).getTime()).filter((t) => Number.isFinite(t) && t >= desde).sort((a, b) => b - a)
  const espera = (hs: number[], limite: number) => (hs.length < limite ? 0 : Math.max(0, Math.ceil((hs[limite - 1] + VENTANA_MIN * 60000 - ahoraMs) / 1000)))
  let out: BloqueoPersona = { segundos: 0, motivo: null, ip: null }
  const ips = new Set(filas.filter((f) => f.user_id === userId).map((f) => f.ip))
  for (const ip of ips) {
    const delLugar = filas.filter((f) => f.ip === ip)
    const propias = espera(horas(delLugar.filter((f) => f.user_id === userId)), LIMITE_PERSONA_LUGAR)
    if (propias > out.segundos) out = { segundos: propias, motivo: "persona", ip }
    const lugar = espera(horas(delLugar), LIMITE_LUGAR)
    if (lugar > out.segundos) out = { segundos: lugar, motivo: "lugar", ip }
  }
  return out
}

/** Segundos que le faltan a una persona para poder probar de nuevo (0 = no está frenada). */
export function esperaDePersona(filas: FilaIntento[], userId: string, ahoraMs: number = Date.now()): number {
  return bloqueoDePersona(filas, userId, ahoraMs).segundos
}

/** Texto para la pantalla Usuarios. */
export function textoBloqueo(b: BloqueoPersona): string | null {
  if (!b.segundos) return null
  const m = Math.max(1, Math.ceil(b.segundos / 60))
  return b.motivo === "lugar"
    ? `frenado ${m} min: demasiados intentos desde su conexión (IP ${b.ip}), afecta a todos los que entran desde ahí`
    : `frenado ${m} min por intentos fallidos`
}
