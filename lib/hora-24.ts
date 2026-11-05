/**
 * Horas de 24 h escritas a mano ("1300", "13:00", "13.00", "930"): el campo de hora del bloque y del gerenciador no
 * usa <input type="time"> porque en un navegador en inglés muestra 12 h y en 96 px se corta el AM/PM.
 */
/** "HH:MM" (00:00 a 23:59) o null si no es una hora válida */
export function parsearHora24(texto: string | null | undefined): string | null {
  const s = String(texto ?? "").trim().replace(/\s+/g, "")
  let h: number, m: number
  let x: RegExpMatchArray | null
  if ((x = s.match(/^(\d{1,2})[:.,h](\d{2})$/i))) { h = Number(x[1]); m = Number(x[2]) }
  else if ((x = s.match(/^(\d{3,4})$/))) { h = Number(x[1].slice(0, -2)); m = Number(x[1].slice(-2)) }
  else if ((x = s.match(/^(\d{1,2})$/))) { h = Number(x[1]); m = 0 }
  else return null
  if (!(h >= 0 && h <= 23 && m >= 0 && m <= 59)) return null
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}
