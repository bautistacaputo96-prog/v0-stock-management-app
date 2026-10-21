/**
 * Puente de carga (carga-planta.md 3 y 9): lo que la pantalla de Carga le pide a la planta.
 *
 * Hoy el puente es SOLO el simulador, que corre en el navegador de la PC de la planta: no hay ningún programa que
 * hable con Indumix (192.168.0.10). El puente real (servicio de Windows en `127.0.0.1:8787` con el adaptador de
 * Indumix) se programa después del jueves 23/10, con lo que se vea ese día. La pantalla usa esta interfaz, así que
 * cambiar el simulador por el puente real no cambia la pantalla.
 *
 * Reglas que respeta cualquier implementación:
 * - nunca escribe recetas en la planta (no hay método para eso);
 * - antes de CARGAR escribe la selección, la lee de vuelta, vuelve a leer la receta y recién ahí arranca; cualquier
 *   diferencia corta ahí y no arranca nada;
 * - si la planta no arranca, no se reintenta solo;
 * - PARAR no pide nada.
 */
import { SimuladorIndumix, type OpcionesSimulador } from "@/lib/carga/simulador"
import { huellaReceta } from "@/lib/carga/receta"
import {
  PlantaRechazoError,
  type AdaptadorDosificadora, type EstadoPlanta, type OrdenPlanta, type RecetaPlanta, type ReportePlanta,
} from "@/lib/carga/tipos"

export type SistemaPuesto = "simulador" | "indumix"

export type PasoArranque = { texto: string; hecho: boolean }

export interface Puente {
  readonly sistema: SistemaPuesto
  leerRecetas(): Promise<RecetaPlanta[]>
  leerEstado(): Promise<EstadoPlanta>
  leerReportes(): Promise<ReportePlanta[]>
  /**
   * Prepara y arranca una carga (5.4, pasos 2 a 5): escribe la selección, la verifica, vuelve a leer la receta y aprieta
   * CARGAR. `huellaEsperada` es la de la receta que se controló contra la fórmula: si la receta cambió en el medio, no
   * arranca. `alPaso` va contando los pasos para la pantalla. `cancelado` se mira antes de cada paso (sobre todo antes
   * de CARGAR): si se tocó PARAR mientras arrancaba, corta con ArranqueCanceladoError y no arranca nada.
   */
  cargarYArrancar(o: OrdenPlanta, huellaEsperada: string | null, alPaso?: (i: number) => void, cancelado?: () => boolean): Promise<void>
  parar(): Promise<void>
  suspender(): Promise<void>
  reanudar(): Promise<void>
  bocina(ms?: number): Promise<void>
  extraAgua(litros: number): Promise<void>
}

/** Se tocó PARAR mientras arrancaba: no se arrancó nada. */
export class ArranqueCanceladoError extends Error {
  codigo = "parar"
  constructor() {
    super("PARAR")
    this.name = "ArranqueCanceladoError"
  }
}

/** Los pasos que se muestran mientras arranca (la pantalla agrega el primero: el permiso o "sin internet"). */
export function pasosArranque(o: OrdenPlanta): string[] {
  return [
    `Escribe en Indumix: receta ${o.receta} · ${o.m3.toLocaleString("es-AR")} m³ · ${o.cliente} · ${o.camion} · Observación ${o.observacion}`,
    "Lee de vuelta lo escrito y lo compara",
    `Vuelve a leer la receta ${o.receta} y la compara con la controlada`,
    "CARGAR",
  ]
}

const mismaOrden = (a: OrdenPlanta | null, b: OrdenPlanta) =>
  !!a && a.receta === b.receta && Math.abs(a.m3 - b.m3) < 1e-6 && a.secuencia === b.secuencia &&
  a.cliente === b.cliente.slice(0, 20) && a.camion === b.camion.slice(0, 20) && a.observacion === b.observacion.slice(0, 30)

export class PuenteConAdaptador implements Puente {
  readonly sistema: SistemaPuesto
  readonly adaptador: AdaptadorDosificadora
  constructor(sistema: SistemaPuesto, adaptador: AdaptadorDosificadora) {
    this.sistema = sistema
    this.adaptador = adaptador
  }
  leerRecetas() { return this.adaptador.leerRecetas() }
  leerEstado() { return this.adaptador.leerEstado() }
  leerReportes() { return this.adaptador.leerReportes() }
  async cargarYArrancar(o: OrdenPlanta, huellaEsperada: string | null, alPaso?: (i: number) => void, cancelado?: () => boolean) {
    const seguir = () => { if (cancelado?.()) throw new ArranqueCanceladoError() }
    seguir()
    await this.adaptador.escribirOrden(o)
    alPaso?.(1)
    seguir()
    const escrita = await this.adaptador.leerOrden()
    if (!mismaOrden(escrita, o)) throw new PlantaRechazoError("Lo que quedó escrito en Indumix no coincide con la orden: no se arrancó.")
    alPaso?.(2)
    seguir()
    if (huellaEsperada) {
      const r = (await this.adaptador.leerRecetas()).find((x) => x.numero === o.receta)
      if (!r || huellaReceta(r) !== huellaEsperada)
        throw new PlantaRechazoError(`La receta ${o.receta} cambió en Indumix desde que se controló: no se arrancó. Volvé a mirar el control.`)
    }
    alPaso?.(3)
    seguir() // el último control antes de CARGAR
    await this.adaptador.arrancar()
    alPaso?.(4)
  }
  parar() { return this.adaptador.parar() }
  suspender() { return this.adaptador.suspender() }
  reanudar() { return this.adaptador.reanudar() }
  bocina(ms = 2000) { return this.adaptador.bocina(ms) }
  extraAgua(litros: number) { return this.adaptador.extraAgua(litros) }
}

/** El puente de un puesto. Solo existe el simulador: el de Indumix real todavía no está programado. */
export function crearPuente(sistema: SistemaPuesto, opciones: OpcionesSimulador): { puente: PuenteConAdaptador; simulador: SimuladorIndumix } {
  if (sistema !== "simulador")
    throw new Error("El puente con Indumix real todavía no existe: se programa después de ver la planta el jueves 23/10.")
  const simulador = new SimuladorIndumix(opciones)
  return { puente: new PuenteConAdaptador("simulador", simulador), simulador }
}
