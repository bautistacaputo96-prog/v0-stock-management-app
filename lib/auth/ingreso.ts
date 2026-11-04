/**
 * Reglas de ingreso (fase 0c-1, especificación 5.3). Función PURA: no toca la base ni la red. La ruta
 * `POST /api/sesion/ingresar` le pasa la credencial y graba `cambios`.
 *
 * Sin imports de otros archivos del proyecto (se prueba con `node --test`).
 */

export type Credencial = {
  clave_hash: string | null
  debe_cambiar: boolean
  permite_clave_comun: boolean
  intentos_fallidos: number
  bloqueado_hasta: string | null
}

export type CambiosIngreso = {
  intentos_fallidos?: number
  bloqueado_hasta?: string | null
  ultimo_ingreso_at?: string
}

export type ResultadoIngreso = {
  ok: boolean
  /** Entra pero tiene que elegir su contraseña antes de seguir. */
  debeCambiar: boolean
  error: string | null
  /** Qué grabar en app_user_credenciales (null: nada). */
  cambios: CambiosIngreso | null
}

/** Ya no se usan para bloquear (Bautista sacó el bloqueo por intentos el 04/11/2026); quedan por compatibilidad. */
export const MAX_INTENTOS = 5
export const MINUTOS_BLOQUEO = 10

export const ERROR_INCORRECTO = "Usuario o contraseña incorrectos."
export const ERROR_SIN_CLAVE = "Todavía no tenés contraseña. Pedile a un gerencial que te la dé desde Usuarios."

export function errorBloqueado(minutos: number): string {
  const m = Math.max(1, Math.ceil(minutos))
  return `Demasiados intentos. Esperá ${m} ${m === 1 ? "minuto" : "minutos"} o pedile a un gerencial que te blanquee la contraseña.`
}

export async function decidirIngreso(opts: {
  credencial: Credencial | null
  /** Usuario existente y activo. */
  activo: boolean
  clave: string
  ahora: Date
  /** Compara la contraseña con el hash guardado (scrypt). */
  verificar: (clave: string, hash: string) => Promise<boolean> | boolean
  /** ¿Es la contraseña común de antes? */
  esComun: (clave: string) => boolean
}): Promise<ResultadoIngreso> {
  const { credencial: c, activo, clave, ahora } = opts

  // 1. Usuario inexistente o inactivo
  if (!activo) return { ok: false, debeCambiar: false, error: ERROR_INCORRECTO, cambios: null }

  // 5 (sin fila). Sin credencial no hay nada que probar
  if (!c) return { ok: false, debeCambiar: false, error: ERROR_SIN_CLAVE, cambios: null }

  // 2. Sin bloqueo por intentos (Bautista, 04/11/2026): bloqueado_hasta se ignora

  let bien: boolean
  let debeCambiar = c.debe_cambiar === true
  if (c.clave_hash) {
    // 3. Con contraseña propia vale SOLO esa (la común ya no, aunque permite_clave_comun siga en true)
    bien = (await opts.verificar(clave, c.clave_hash)) === true
  } else if (c.permite_clave_comun) {
    // 4. Primer ingreso con la contraseña común: entra y tiene que elegir la suya
    bien = opts.esComun(clave) === true
    debeCambiar = true
  } else {
    // 5. Sin contraseña y sin primer ingreso
    return { ok: false, debeCambiar: false, error: ERROR_SIN_CLAVE, cambios: null }
  }

  if (!bien) {
    // 6. Contraseña mal: suma un intento (solo para ver; ya no bloquea)
    const intentos = (Number.isInteger(c.intentos_fallidos) ? c.intentos_fallidos : 0) + 1
    return { ok: false, debeCambiar: false, error: ERROR_INCORRECTO, cambios: { intentos_fallidos: intentos } }
  }

  // 7. Bien
  return {
    ok: true,
    debeCambiar,
    error: null,
    cambios: { intentos_fallidos: 0, bloqueado_hasta: null, ultimo_ingreso_at: ahora.toISOString() },
  }
}

/**
 * Mensaje después de grabar un intento fallido con la función atómica de la base
 * (`registrar_ingreso_fallido`), que devuelve el estado que quedó grabado.
 */
export function errorTrasIntentoFallido(
  _r: { intentos: number | null; bloqueado: string | null; ya_bloqueado: boolean | null } | null | undefined,
  _ahora: Date,
): string {
  // Sin bloqueo por intentos (04/11/2026): aunque la base deje bloqueado_hasta, el mensaje es siempre el mismo
  return ERROR_INCORRECTO
}
