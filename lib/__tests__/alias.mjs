// Para las pruebas con `node --import ./lib/__tests__/alias.mjs`: resuelve "@/lib/x" como el tsconfig
// (raíz del repo, agregando .ts), así se pueden probar archivos que importan con el alias (lib/viajes.ts).
import { register } from "node:module"

const raiz = new URL("../../", import.meta.url).href
const ganchos = `
export async function resolve(especificador, contexto, siguiente) {
  if (especificador.startsWith("@/")) {
    const p = especificador.slice(2)
    return siguiente(${JSON.stringify(raiz)} + p + (/\\.[cm]?[jt]s$/.test(p) ? "" : ".ts"), contexto)
  }
  return siguiente(especificador, contexto)
}`
register(`data:text/javascript,${encodeURIComponent(ganchos)}`)
