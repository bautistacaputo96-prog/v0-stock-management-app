/**
 * Indumix real (Canning) · interpretar lo que sube el puente. Especificación: docs/specs/2026-11-05-puente-indumix.md.
 *
 * El puente de la PC de la planta es "tonto": lee variables de Indumix y las sube tal cual ({variable: texto}). Todo lo
 * que significan (estado, reportes, recetas, reloj, alarmas, avisos de humedad y Tolva 1) se decide acá, así se corrige
 * con un deploy sin ir a la PC. Lo que no se entiende queda en null y la pantalla muestra "—".
 *
 * Puro: sin React, sin Supabase. Se prueba con `npm run test:carga` (lib/__tests__/carga-indumix.test.mjs) sobre los
 * datos reales del 03/11 y 04/11 (lib/__fixtures__/indumix/).
 */
import {
  ARIDOS, INFO_SALIDA, SALIDAS, TOLERANCIAS_BASE, grupoDeSalida, nf,
  type EstadoPlanta, type EstadoVivo, type FormulaSistema, type MaterialSistema, type RecetaPlanta, type ReportePlanta,
  type Salida, type SalidaMapa,
} from "@/lib/carga/tipos"
import { valoresReceta } from "@/lib/carga/receta"
import { derivaSegundos, diaPlc, esReloj1970, fechaPlc, horaReal } from "@/lib/carga/reloj"

export { derivaSegundos, fechaPlc, horaReal }

export type Variables = Record<string, string | null | undefined>

// ───────────────────────────── Qué se lee (lo baja el puente con GET /api/carga/puente) ─────────────────────────────

/** Las alarmas que se vieron en ALARMAS (04/11). Su significado se confirma con Egacom. */
export const ALARMAS: { variable: string; nombre: string; normal: string }[] = [
  { variable: "@GV.I1_PE", nombre: "Parada de emergencia (I1_PE)", normal: "1" },
  { variable: "@GV.I8_QF", nombre: "Entrada I8_QF", normal: "0" },
  { variable: "@GV.I6_SP", nombre: "Entrada I6_SP", normal: "0" },
  { variable: "@GV.I7_OKAD", nombre: "Entrada I7_OKAD (aditivo)", normal: "0" },
  { variable: "balanza.Falla_Celda", nombre: "Falla de celda de balanza", normal: "0" },
  { variable: "balanza.Falla_Analg", nombre: "Falla analógica de balanza", normal: "0" },
  { variable: "Main.Falla_BAC", nombre: "Falla BAC", normal: "0" },
  { variable: "Main.Falla_TAC", nombre: "Falla TAC", normal: "0" },
]

/** Pantalla INICIO de Indumix (el pedido de hmi.js, tal cual) + el número de receta que se mira y las alarmas. */
const INICIO = ["@GV.ADITIVO_BAL_rD2", "@GV.ARIDO_BAL_rD2", "@GV.CEMENTO_BAL_rD2", "Receta.Parametros.ParcialAditivo1", "Receta.Parametros.ParcialAditivo2", "Receta.Parametros.ParcialArido1", "Receta.Parametros.ParcialArido2", "Receta.Parametros.ParcialArido3", "Receta.Parametros.ParcialArido4", "Receta.Parametros.ParcialCemento1", "Receta.Parametros.ParcialCemento2", "@GV.nReceta", "@GV.PB_PARADA", "@GV.PB_SUSPENCION", "@GV.Q05_EVTA1", "@GV.Q06_EVTA2", "Receta.Parametros.ParcialAgua1", "@GV.Registro.NaCiclo", "Receta.PD_Agua1", "Receta.PD_Aditivo1", "Receta.PD_Aditivo2", "@GV.Receta_Actual.Nombre", "@GV.Secuencia_Actual.Nombre", "@GV.nSecuencia", "@GV.Registro.m3Carga", "@GV.Receta_carga.Nombre", "Receta.Proceso", "Receta.Color_Proceso", "@GV.Registro.NCiclo", "@GV.Registro.m3Ciclo", "@GV.Receta_Actual.Habilitado", "@GV.Secuencia_Actual.Habilitado", "@GV.Q02_MCTA", "@GV.Q16_KRCD", "@GV.Q07_EVTA3", "@GV.Q08_EVTA4", "@GV.I6_BAC", "@GV.Q12_KRC1", "@GV.Q14_KRC2", "Main.PBBocina", "@GV.Q2_Bocina", "@GV.Q20_ADD1", "@GV.Q17_BAG", "@GV.PasoC_Aditivo", "@GV.PasoC_Agua", "@GV.Q18_ADC1", "@GV.Q9_EV1BA1", "@GV.Q19_ADC2", "Main.PBA0AR1", "Main.PBM1AR1", "Main.PBA0AR2", "Main.PBA0AR3", "Main.PBA0AR4", "Main.PBA0BA", "@GV.Cont_Ciclo", "Receta.neReporte", "@GV.Tiempo_CicloS", "@GV.FechaHoraActual", "Receta.Parametros.TxtAditivo1", "Receta.Parametros.TxtAditivo2", "@GV.ARIDO_BAL_Vacio", "@GV.CEMENTO_BAL_Vacio", "@GV.ADITIVO_BAL_Vacio", "@GV.Q11_KVIBA", "Main.PBM1BAG", "@GV.Q23_BAG1", "Receta.Parametros.TxtArido1", "Receta.Parametros.TxtArido2", "Receta.Parametros.TxtArido3", "Receta.Parametros.TxtArido4", "@GV.Q13_EVRC1", "@GV.Q15_EVRC2", "@GV.Caudal_Agua_Extra", "@GV.Observacion", "@GV.Camion", "@GV.Cliente", "balanza.PD_Aditivo", "Receta.PD_BArido", "balanza.PD_Arido", "Receta.PD_Arido1", "Receta.PD_Arido2", "Receta.PD_Arido3", "Receta.PD_Arido4", "@GV.PasoC_Arido", "Receta.Parametros.HumedadArido1", "Receta.Parametros.HumedadArido2", "Receta.Parametros.HumedadArido3", "Receta.Parametros.HumedadArido4", "Receta.PD_OArido1", "Receta.PD_OArido2", "Receta.PD_OArido3", "Receta.PD_OArido4", "Receta.PD_Cemento1", "Receta.PD_Cemento2", "@GV.PasoC_Cemento", "Receta.Parametros.TxtCemento1", "Receta.Parametros.TxtCemento2", "Receta.PD_OCemento1", "Receta.PD_OCemento2", "@GV.PB_INICIO", "@GV.HAB_DESCARGA", "@GV.CICLO"]

/** La receta que se está editando en RECETAS (Receta_Editar.*) y el botón de guardar (beReceta). */
const EDICION_RECETA = ["Receta.Receta_Editar.Nombre", "Receta.Receta_Editar.Arido1", "Receta.Receta_Editar.Arido2", "Receta.Receta_Editar.Arido3", "Receta.Receta_Editar.Arido4", "Receta.Receta_Editar.Cemento1", "Receta.Receta_Editar.Cemento2", "Receta.Receta_Editar.Agua1", "Receta.Receta_Editar.Aditivo1", "Receta.Receta_Editar.Aditivo2", "Receta.Receta_Editar.SecArido1", "Receta.Receta_Editar.SecArido2", "Receta.Receta_Editar.SecArido3", "Receta.Receta_Editar.SecArido4", "Receta.Receta_Editar.Habilitado", "Receta.beReceta"]

/** Listas de variables por grupo. El puente las baja de la nube cada 5 min (se ajustan sin ir a la PC). */
export const VARIABLES = {
  // + el número de receta que se mira y la receta en edición: si cambian, hay alguien en RECETAS y el puente no barre
  estado: [...INICIO, "Receta.neReceta", ...EDICION_RECETA, ...ALARMAS.map((a) => a.variable)],
  reporte: ["Receta.neReporte", "Receta.Parametros.TxtAditivo1", "Receta.Parametros.TxtAditivo2", "Receta.Parametros.TxtArido1", "Receta.Parametros.TxtArido2", "Receta.Parametros.TxtArido3", "Receta.Parametros.TxtArido4", "Receta.Parametros.HumedadArido1", "Receta.Parametros.HumedadArido2", "Receta.Parametros.HumedadArido3", "Receta.Parametros.HumedadArido4", "Receta.Parametros.TxtCemento1", "Receta.Parametros.TxtCemento2", "Receta.Reporte_WEB.HoraIni", "@GV.Planta", "Receta.Reporte_WEB.RArido1", "Receta.Reporte_WEB.Observacion", "Receta.Reporte_WEB.Camion", "Receta.Reporte_WEB.Receta", "Receta.Reporte_WEB.Secuencia", "Receta.Reporte_WEB.M3", "Receta.Reporte_WEB.NCiclos", "Receta.Reporte_WEB.TiempoCiclo", "Receta.Reporte_WEB.NCarga", "Receta.Reporte_WEB.Cliente", "Receta.Reporte_WEB.RArido2", "Receta.Reporte_WEB.RArido3", "Receta.Reporte_WEB.RArido4", "Receta.Reporte_WEB.RCemento1", "Receta.Reporte_WEB.RCemento2", "Receta.Reporte_WEB.RAditivo1", "Receta.Reporte_WEB.RAditivo2", "Receta.Reporte_WEB.RAgua", "Receta.Reporte_WEB.CAguaExt", "Receta.Reporte_WEB.HoraFin", "Receta.Reporte_WEB.RecetaT", "Receta.Reporte_WEB.SecuenciaT", "Receta.Reporte_WEB.TArido1", "Receta.Reporte_WEB.TArido2", "Receta.Reporte_WEB.TArido3", "Receta.Reporte_WEB.TArido4", "Receta.Reporte_WEB.TCemento1", "Receta.Reporte_WEB.TCemento2", "Receta.Reporte_WEB.TAditivo1", "Receta.Reporte_WEB.TAditivo2", "Receta.Reporte_WEB.TAgua", "Receta.Reporte_WEB.CArido1", "Receta.Reporte_WEB.CArido2", "Receta.Reporte_WEB.CArido3", "Receta.Reporte_WEB.CArido4", "Receta.Reporte_WEB.CCemento1", "Receta.Reporte_WEB.CCemento2", "Receta.Reporte_WEB.CAditivo1", "Receta.Reporte_WEB.CAditivo2", "Receta.Reporte_WEB.CAgua"],
  receta: ["Receta.neReporte", "Receta.Parametros.TxtAditivo1", "Receta.Parametros.TxtAditivo2", "Receta.Parametros.TxtArido1", "Receta.Parametros.TxtArido2", "Receta.Parametros.TxtArido3", "Receta.Parametros.TxtArido4", "Receta.Parametros.TxtCemento1", "Receta.Parametros.TxtCemento2", "Receta.neReceta", "Receta.Receta_Editar.Nombre", "Receta.Receta_Editar.Arido1", "Receta.Receta_Editar.Arido2", "Receta.Receta_Editar.Arido3", "Receta.Receta_Editar.Arido4", "Receta.Receta_Editar.Cemento1", "Receta.Receta_Editar.Cemento2", "Receta.Receta_Editar.Agua1", "Receta.beReceta", "Receta.Receta_Editar.SecArido1", "Receta.Receta_Editar.SecArido2", "Receta.Receta_Editar.SecArido3", "Receta.Receta_Editar.SecArido4", "Receta.Receta_Editar.Habilitado", "Receta.Receta_Editar.Aditivo1", "Receta.Receta_Editar.Aditivo2", "Receta.CopiaReceta", "Receta.CancelReceta", "Receta.ModifReceta", "Receta.PegaReceta"],
  totales: ["@GV.Cont_Ciclo", "Receta.neReporte", "Receta.ConsumoT.Arido1", "Receta.ConsumoT.Arido2", "Receta.ConsumoT.Arido3", "Receta.ConsumoT.Arido4", "Receta.ConsumoT.Cemento1", "Receta.ConsumoT.Cemento2", "Receta.ConsumoT.Agua", "Receta.ConsumoT.Aditivo1", "Receta.ConsumoT.Aditivo2", "Receta.ConsumoP.Arido1", "Receta.ConsumoP.Arido2", "Receta.ConsumoP.Arido3", "Receta.ConsumoP.Arido4", "Receta.ConsumoP.Cemento1", "Receta.ConsumoP.Cemento2", "Receta.ConsumoP.Agua", "Receta.ConsumoP.Aditivo1", "Receta.ConsumoP.Aditivo2", "@GV.RESET_Count_Ciclo", "@GV.Tiempo_Ciclo_ANT", "@GV.Tiempo_Ciclo_ANT2", "@GV.ResetConsumoT"],
}

/** Variables que cambian solas con la planta quieta (ruido de las balanzas): no cuentan como "cambió algo". */
export const RUIDO = ["@GV.ARIDO_BAL_rD2", "@GV.CEMENTO_BAL_rD2", "@GV.ADITIVO_BAL_rD2", "balanza.PD_Arido", "balanza.PD_Aditivo", "Receta.PD_BArido"]

/** Cadencias en segundos (1.2 y 1.3 de la spec). El puente las duplica solo si Indumix tarda (mediana > 500 ms). */
export const CADENCIAS = {
  estado_ciclo_s: 3, estado_quieta_s: 15, latido_ciclo_s: 5, latido_quieta_max_s: 60, reporte_s: 300, reportes_s: 1800,
  recetas_s: 3600, totales_s: 900, crudo_s: 30, config_s: 300, espera_fin_s: 15, posponer_s: 900, quieto_navegando_s: 120,
}

/** 7 días de muestreo crudo desde el primer latido (para entender los pesos en vivo antes de la fase 2). */
export const DIAS_MUESTREO_CRUDO = 7

// ───────────────────────────── Ayudas ─────────────────────────────

/** Texto de Indumix → número (null si no es número o no vino). */
export function num(t: string | null | undefined): number | null {
  if (t == null) return null
  const s = String(t).trim().replace(",", ".")
  if (!s) return null
  const x = Number(s)
  return Number.isFinite(x) ? x : null
}
const txt = (t: string | null | undefined) => (t == null ? "" : String(t).trim())
const bool = (t: string | null | undefined): boolean | null => (t == null ? null : txt(t) === "1" ? true : txt(t) === "0" ? false : null)
const r1 = (x: number) => Math.round(x * 10) / 10

/** Los rellenos de Indumix cuando no se escribió nada ("Cliente", "Camion", "Observacion") pasan a "". */
export function limpiarTexto(t: string | null | undefined): string {
  const s = txt(t)
  return ["cliente", "camion", "camión", "observacion", "observación"].includes(s.toLowerCase()) ? "" : s
}

/** "6:33  MM:ss" → "6:33" */
export const tiempoCiclo = (t: string | null | undefined) => (txt(t).match(/\d+:\d{1,2}/)?.[0] ?? null)
const segundosDe = (t: string | null) => { const m = t?.match(/^(\d+):(\d{1,2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN }

/** Sufijo de cada salida en los nombres de Indumix. */
const SUF: Record<Salida, string> = {
  arido_1: "Arido1", arido_2: "Arido2", arido_3: "Arido3", arido_4: "Arido4", cemento_1: "Cemento1", cemento_2: "Cemento2",
  aditivo_1: "Aditivo1", aditivo_2: "Aditivo2", agua: "Agua",
}
const varParcial = (s: Salida) => `Receta.Parametros.Parcial${s === "agua" ? "Agua1" : SUF[s]}`
const varPesado = (s: Salida) => (grupoDeSalida(s) === "arido" || grupoDeSalida(s) === "cemento" ? `Receta.PD_O${SUF[s]}` : s === "agua" ? "Receta.PD_Agua1" : `Receta.PD_${SUF[s]}`)
const varTxt = (s: Salida) => (s === "agua" ? null : `Receta.Parametros.Txt${SUF[s]}`)
const varReceta = (s: Salida) => `Receta.Receta_Editar.${s === "agua" ? "Agua1" : SUF[s]}`

/** Nombres de las salidas en Indumix (Txt*). */
export function nombresSalidas(v: Variables): Partial<Record<Salida, string>> {
  const out: Partial<Record<Salida, string>> = {}
  for (const s of SALIDAS) { const k = varTxt(s); const t = k ? txt(v[k]) : ""; if (t) out[s] = t }
  return out
}

// ───────────────────────────── Alarmas ─────────────────────────────

/** Las que no están en su valor normal (el del 04/11 con la planta quieta). Ninguna va por mail en la fase 1. */
export function alarmasDesdeVariables(v: Variables): { codigo: string; texto: string }[] {
  const out: { codigo: string; texto: string }[] = []
  for (const a of ALARMAS) {
    const x = v[a.variable]
    if (x == null || txt(x) === "" || txt(x) === a.normal) continue
    out.push({ codigo: a.variable, texto: `${a.nombre} (a confirmar con Egacom)` })
  }
  return out
}

// ───────────────────────────── Estado en vivo ─────────────────────────────

/** El estado de INICIO interpretado. `at` es la hora del puente. */
export function estadoDesdeVariables(v: Variables, at: string | null = null): EstadoVivo {
  const proceso = v["Receta.Proceso"] == null ? null : txt(v["Receta.Proceso"])
  const objetivo: EstadoVivo["objetivo"] = {}
  const pesado: EstadoVivo["pesado"] = {}
  for (const s of SALIDAS) { objetivo[s] = num(v[varParcial(s)]); pesado[s] = num(v[varPesado(s)]) }
  const nombre = txt(v["@GV.Receta_Actual.Nombre"]) || txt(v["@GV.Receta_carga.Nombre"]) || null
  return {
    at,
    proceso,
    en_ciclo: proceso == null || proceso === "" ? null : proceso.toLowerCase() !== "fin",
    suspendida: proceso ? /susp/i.test(proceso) : null,
    receta: num(v["@GV.nReceta"]),
    // El nombre de la receta elegida (cambia apenas se elige otra); Receta_carga es el de la última que se cargó
    receta_nombre: nombre,
    m3: num(v["@GV.Registro.m3Carga"]),
    cliente: limpiarTexto(v["@GV.Cliente"]),
    camion: limpiarTexto(v["@GV.Camion"]),
    observacion: limpiarTexto(v["@GV.Observacion"]),
    ciclo: num(v["@GV.Registro.NaCiclo"]),
    ciclos: num(v["@GV.Registro.NCiclo"]),
    m3_ciclo: num(v["@GV.Registro.m3Ciclo"]),
    contador: num(v["@GV.Cont_Ciclo"]),
    humedades: [1, 2, 3, 4].map((i) => num(v[`Receta.Parametros.HumedadArido${i}`])),
    objetivo,
    pesado,
    nombres: nombresSalidas(v),
    agua_extra: num(v["@GV.Caudal_Agua_Extra"]),
    balanzas_vacias: { aridos: bool(v["@GV.ARIDO_BAL_Vacio"]), cemento: bool(v["@GV.CEMENTO_BAL_Vacio"]), aditivo: bool(v["@GV.ADITIVO_BAL_Vacio"]) },
    tiempo_ciclo: tiempoCiclo(v["@GV.Tiempo_CicloS"]),
    reloj_plc: v["@GV.FechaHoraActual"] == null ? null : txt(v["@GV.FechaHoraActual"]),
    bocina: bool(v["Main.PBBocina"]),
    alarmas: alarmasDesdeVariables(v),
    ne_reporte: num(v["Receta.neReporte"]),
    ne_receta: num(v["Receta.neReceta"]),
  }
}

/**
 * El número de reporte o de receta que tiene Indumix en pantalla está fuera de lo que el puente puede volver a dejar
 * (reporte 1 a 10, receta 1 a 20): el puente no barre esa pantalla. null = está bien (o no vino).
 */
export function numeroFueraDeRango(ev: Pick<EstadoVivo, "ne_reporte" | "ne_receta"> | null | undefined): string | null {
  const r = ev?.ne_reporte, c = ev?.ne_receta
  const malR = r != null && !(Number.isInteger(r) && r >= 1 && r <= 10)
  const malC = c != null && !(Number.isInteger(c) && c >= 1 && c <= 20)
  if (!malR && !malC) return null
  const que = [malR ? `el reporte en ${r} (va de 1 a 10)` : "", malC ? `la receta en ${c} (va de 1 a 20)` : ""].filter(Boolean).join(" y ")
  const noLee = malR && malC ? "reportes ni recetas" : malR ? "reportes" : "recetas"
  return `Indumix tiene ${que}: el puente no lee ${noLee} hasta que se ponga un número válido`
}

export type EstadoPantalla = "QUIETA" | "EN CICLO" | "SUSPENDIDA" | "ALARMA" | "SIN DATOS"
export function estadoPantalla(ev: EstadoVivo | null): EstadoPantalla {
  if (!ev) return "SIN DATOS"
  if (ev.alarmas.length && ev.en_ciclo) return "ALARMA"
  if (ev.suspendida) return "SUSPENDIDA"
  if (ev.en_ciclo) return "EN CICLO"
  return "QUIETA"
}

/**
 * El estado en vivo, con la forma que usa el dibujo de la planta (PlantaVivo y TablaPesajes). Lo que Indumix no da
 * (niveles, acumulado, m³ en el trompo) va en NaN: la pantalla lo muestra "—".
 */
export function estadoPlantaDeVivo(ev: EstadoVivo | null): EstadoPlanta | null {
  if (!ev) return null
  const ciclos = ev.ciclos ?? NaN
  const salidas = SALIDAS.map((s) => {
    const obj = ev.objetivo[s] ?? NaN
    const i = ARIDOS.indexOf(s)
    return {
      salida: s, real: ev.pesado[s] ?? NaN, objetivo: obj, acumulado: NaN,
      total: Number.isFinite(obj) && obj > 0 ? (Number.isFinite(ciclos) && ciclos > 0 ? obj * ciclos : obj) : 0,
      ...(i >= 0 ? { humedad_pct: ev.humedades[i] ?? undefined } : {}),
      nivel_pct: NaN, pesando: false,
    }
  })
  // Indumix solo dice si la balanza está vacía: "llena" = no está vacía
  const vac = (x: boolean | null) => (x === false ? "llena" : "vacia") as "vacia" | "llena"
  return {
    en_linea: true, en_ciclo: !!ev.en_ciclo, suspendida: !!ev.suspendida, parada: false,
    ciclo: ev.ciclo ?? NaN, ciclos, m3_ciclo: ev.m3_ciclo ?? NaN, tiempo_ciclo_s: segundosDe(ev.tiempo_ciclo), tiempo_total_s: NaN,
    contador_carga: ev.contador ?? NaN,
    seleccion: ev.receta != null ? { receta: ev.receta, secuencia: 1, m3: ev.m3 ?? NaN, cliente: ev.cliente, camion: ev.camion, observacion: ev.observacion } : null,
    salidas,
    balanzas: [
      { id: "aridos", valor: NaN, unidad: "kg", estado: vac(ev.balanzas_vacias.aridos), max: 0 },
      { id: "cemento", valor: NaN, unidad: "kg", estado: vac(ev.balanzas_vacias.cemento), max: 0 },
      { id: "aditivo", valor: NaN, unidad: "g", estado: vac(ev.balanzas_vacias.aditivo), max: 0 },
    ],
    agua: { real: ev.pesado.agua ?? NaN, objetivo: ev.objetivo.agua ?? NaN, extra: ev.agua_extra ?? 0 },
    agua_extra_abierta: false, agua_extra_pulso: 0, agua_extras: [], m3_en_trompo: NaN, cinta_en_marcha: false, bocina: !!ev.bocina,
    alarmas: ev.alarmas, reloj_plc: ev.reloj_plc || "",
  }
}

/** Objetivo por ciclo con la planta quieta (para verlo en el dibujo como "lo que va a pesar"). */
export function objetivoQuieta(ev: EstadoVivo | null): Partial<Record<Salida, number>> | null {
  if (!ev || ev.en_ciclo) return null
  const out: Partial<Record<Salida, number>> = {}
  for (const s of SALIDAS) { const x = ev.objetivo[s]; if (x != null && x > 0) out[s] = x }
  return Object.keys(out).length ? out : null
}

// ───────────────────────────── Recetas ─────────────────────────────

/** Una receta leída en RECETAS (Receta_Editar.*). null si lo leído no es la receta pedida (otro número en pantalla). */
export function recetaDesdeVariables(numero: number, v: Variables): RecetaPlanta | null {
  const visto = num(v["Receta.neReceta"])
  if (visto != null && visto !== numero) return null
  const nombres = nombresSalidas(v)
  const salidas: RecetaPlanta["salidas"] = SALIDAS.map((s) => {
    const i = ARIDOS.indexOf(s)
    const orden = i >= 0 ? num(v[`Receta.Receta_Editar.SecArido${i + 1}`]) : null
    return {
      salida: s, nombre_planta: nombres[s] || INFO_SALIDA[s].nombre, valor: Math.max(0, num(v[varReceta(s)]) ?? 0), unidad: INFO_SALIDA[s].unidad,
      ...(orden != null ? { orden } : {}),
    }
  })
  return { numero, nombre: txt(v["Receta.Receta_Editar.Nombre"]), habilitada: txt(v["Receta.Receta_Editar.Habilitado"]) !== "0", salidas }
}

/** "H40-6/20-15 B" → "H40-620-15 B"; "H 35 - 6/12 - 10 B" → "H35-612-10 B" (para sugerir la fórmula por el nombre). */
export function nombreRecetaComoFormula(n: string | null | undefined): string {
  return String(n ?? "").trim().replace(/\s*-\s*/g, "-").replace(/^H\s+(\d)/i, "H$1").replace(/(\d)\s*\/\s*(\d)/g, "$1$2").replace(/\s+/g, " ")
}

/**
 * Qué cambió entre dos versiones de una receta (5.2), para no llenar de avisos:
 *  - "frena": cambió el cemento, un árido o el aditivo POR MATERIAL (con el mapa de salidas) → alerta receta_cambiada;
 *  - "agua": solo el agua → evento receta_agua, sin alerta;
 *  - "salida": el mismo material pasó de una salida a otra (cemento de la rosca 2 a la 1) → evento receta_salida;
 *  - "otro": nombre, habilitada u orden de los áridos → evento receta_datos;
 *  - "igual".
 */
export type CambioReceta = "frena" | "agua" | "salida" | "otro" | "igual"
export function clasificarCambioReceta(antes: RecetaPlanta, despues: RecetaPlanta, salidas: SalidaMapa[]): CambioReceta {
  const porMaterial = (r: RecetaPlanta) => {
    const m = new Map<string, number>()
    for (const s of r.salidas) {
      const x = Number(s.valor) || 0
      if (!(x > 0) || s.salida === "agua") continue
      const map = salidas.find((y) => y.salida === s.salida)
      const k = map?.material_id ? `${grupoDeSalida(s.salida)}:${map.material_id}` : `suelta:${s.salida}`
      m.set(k, (m.get(k) || 0) + x * (map?.factor || 1))
    }
    return m
  }
  const a = porMaterial(antes), d = porMaterial(despues)
  for (const k of new Set([...a.keys(), ...d.keys()])) if (Math.abs((a.get(k) || 0) - (d.get(k) || 0)) > 1e-6) return "frena"
  const va = valoresReceta(antes), vd = valoresReceta(despues)
  if (Math.abs((va.agua || 0) - (vd.agua || 0)) > 1e-6) return "agua"
  if (SALIDAS.some((s) => Math.abs((va[s] || 0) - (vd[s] || 0)) > 1e-6)) return "salida"
  const ordenes = (r: RecetaPlanta) => r.salidas.map((s) => `${s.salida}@${s.orden ?? ""}`).sort().join("|")
  if (antes.nombre.trim() !== despues.nombre.trim() || antes.habilitada !== despues.habilitada || ordenes(antes) !== ordenes(despues)) return "otro"
  return "igual"
}

/** ¿La receta por m³ de un reporte es distinta de la versión guardada? (entonces el puente vuelve a leer esa receta) */
export function recetaDeReporteDistinta(rep: Pick<ReportePlanta, "lineas">, version: Pick<RecetaPlanta, "salidas"> | null): boolean {
  if (!version) return true
  const v = valoresReceta(version)
  return rep.lineas.some((l) => Math.abs((Number(l.receta) || 0) - (v[l.salida] || 0)) > 0.5)
}

/** La receta por m³ que trae un reporte, como receta (para compararReceta contra la fórmula del remito). */
export const recetaDeReporte = (rep: Pick<ReportePlanta, "lineas">): Pick<RecetaPlanta, "salidas"> => ({
  salidas: rep.lineas.map((l) => ({ salida: l.salida, nombre_planta: INFO_SALIDA[l.salida].nombre, valor: Number(l.receta) || 0, unidad: INFO_SALIDA[l.salida].unidad })),
})

// ───────────────────────────── Reportes ─────────────────────────────

export type Visto = { inicio_at?: string | null; fin_at?: string | null; humedades?: (number | string | null)[] | null }

export type ReporteLeido = {
  reporte: ReportePlanta
  /** todo lo pesado en 0: un arranque cortado (no se crea carga) */
  sinMaterial: boolean
  /** fecha del PLC del inicio ("2026-11-03"); null con el reloj en 1970 */
  dia_planta: string | null
  /** cemento teórico y real de la carga (kg) */
  cemento: { teorico: number; real: number; pct: number | null }
  /** m³ estimados por el cemento (siempre estimado: Indumix no lo dice) */
  m3_estimado: boolean
  /** sin la humedad con que se pesó: áridos y agua no se evalúan */
  sin_humedad: boolean
}

/**
 * Un reporte de REPORTE (Reporte_WEB.*): R = receta por m³, T = teórico, C = real. `visto` es lo que vio el puente en
 * vivo durante esa carga (horas y humedades). Sin humedad, el teórico corregido de áridos y agua queda en null y no se
 * evalúan; cemento y aditivo no dependen de la humedad.
 */
export function reporteDesdeVariables(v: Variables, visto?: Visto | null): ReporteLeido {
  const R = (s: Salida) => num(v[`Receta.Reporte_WEB.R${SUF[s]}`]) ?? 0
  const T = (s: Salida) => num(v[`Receta.Reporte_WEB.T${SUF[s]}`]) ?? 0
  const C = (s: Salida) => num(v[`Receta.Reporte_WEB.C${SUF[s]}`]) ?? 0
  const hums = (visto?.humedades || []).map((h) => (h == null ? null : typeof h === "number" ? h : num(h)))
  const conHumedad = hums.length >= 4 && hums.slice(0, 4).every((h) => h != null && Number.isFinite(h))
  const extra = num(v["Receta.Reporte_WEB.CAguaExt"]) ?? 0
  let aguaAridos = 0
  const lineas: ReportePlanta["lineas"] = SALIDAS.map((s) => {
    const g = grupoDeSalida(s)
    const base = { salida: s, receta: R(s), teorico: T(s), real: C(s) }
    if (g === "cemento" || g === "aditivo") return { ...base, teorico_corregido: T(s) }
    if (g === "arido") {
      if (!conHumedad) return { ...base, teorico_corregido: null }
      const h = hums[ARIDOS.indexOf(s)] as number
      const hum = T(s) * (1 + h / 100)
      aguaAridos += hum - T(s)
      return { ...base, humedad_pct: h, teorico_corregido: Math.round(hum) }
    }
    return { ...base, teorico_corregido: null, extra }
  })
  if (conHumedad) { const a = lineas.find((l) => l.salida === "agua")!; a.teorico_corregido = Math.round(a.teorico - aguaAridos) }
  const m3 = num(v["Receta.Reporte_WEB.M3"]) ?? 0
  const cT = T("cemento_1") + T("cemento_2"), cR = C("cemento_1") + C("cemento_2")
  // Dentro de la tolerancia de pesaje del cemento (1 %) se cargó todo: no es "corta"
  const m3Cargados = cT > 0 && cR < cT * (1 - TOLERANCIAS_BASE.pesaje.cemento) ? r1(m3 * cR / cT) : m3
  const parada = cT > 0 && cR < 0.95 * cT
  const ini = txt(v["Receta.Reporte_WEB.HoraIni"])
  const f = fechaPlc(ini)
  const reporte: ReportePlanta = {
    numero: num(v["Receta.Reporte_WEB.NCarga"]) ?? 0,
    inicio_plc: ini,
    fin_plc: txt(v["Receta.Reporte_WEB.HoraFin"]),
    cliente: limpiarTexto(v["Receta.Reporte_WEB.Cliente"]),
    camion: limpiarTexto(v["Receta.Reporte_WEB.Camion"]),
    observacion: limpiarTexto(v["Receta.Reporte_WEB.Observacion"]),
    m3,
    receta: num(v["Receta.Reporte_WEB.Receta"]) ?? 0,
    receta_nombre: txt(v["Receta.Reporte_WEB.RecetaT"]),
    secuencia: num(v["Receta.Reporte_WEB.Secuencia"]) ?? 0,
    ciclos: num(v["Receta.Reporte_WEB.NCiclos"]) ?? 0,
    tiempo_ciclo: tiempoCiclo(v["Receta.Reporte_WEB.TiempoCiclo"]) || "",
    humedades: conHumedad ? (hums.slice(0, 4) as number[]) : [],
    parada,
    m3_cargados: m3Cargados,
    lineas,
    extras: extra > 0 ? [{ litros: extra, despues_de_terminar: false, at_s: 0 }] : [],
  }
  return {
    reporte,
    sinMaterial: SALIDAS.every((s) => !(C(s) > 0)),
    dia_planta: f && !esReloj1970(f) ? diaPlc(f) : null,
    cemento: { teorico: cT, real: cR, pct: cT > 0 ? cR / cT - 1 : null },
    m3_estimado: true,
    sin_humedad: !conHumedad,
  }
}

/** N° que faltan entre el menor y el mayor leído de un día (Indumix guarda solo los 10 últimos). */
export function huecosContador(numeros: number[]): number[] {
  const xs = [...new Set(numeros.filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b)
  const out: number[] = []
  for (let i = 1; i < xs.length; i++) for (let n = xs[i - 1] + 1; n < xs[i]; n++) out.push(n)
  return out
}

export const textoPerdidas = (faltan: number[]) =>
  `Falta${faltan.length > 1 ? "n" : ""} ${faltan.length > 1 ? "los" : "el"} N° ${faltan.length > 1 ? `${faltan.slice(0, -1).join(", ")} y ${faltan[faltan.length - 1]}` : faltan[0]}: Indumix guarda solo 10`

// ───────────────────────────── Humedad y Tolva 1 (punto 6) ─────────────────────────────

const pct = (x: number) => nf(x, Math.abs(x % 1) > 0.04 ? 1 : 0)

/**
 * Humedad de la arena (alertas_carga tipo humedad, una abierta por día como mucho):
 *  - H1: a las 07:00 (o en la primera carga del día, si es antes) no está la humedad de hoy de la Arena Fina;
 *  - H2: la de Indumix (HumedadArido3, ARENA) difiere más de 1,5 puntos de la medida hoy. No frena nada.
 * `minutos` = minutos desde las 0:00 de hoy (Argentina).
 */
export function controlHumedad(e: {
  indumix: number | null
  medida: { pct: number; hhmm?: string | null } | null
  minutos: number
  cargoHoy?: boolean
  sinCambioDesdeAyer?: boolean
  /** H1 solo los días con despachos programados en la planta */
  diaConDespachos?: boolean
}): { regla: "H1" | "H2" | null; texto: string | null } {
  if (!e.medida) {
    if (e.diaConDespachos !== false && (e.minutos >= 7 * 60 || e.cargoHoy)) return { regla: "H1", texto: "Falta la humedad de la arena de hoy" }
    return { regla: null, texto: null }
  }
  if (e.indumix != null && Math.abs(e.indumix - e.medida.pct) > 1.5 + 1e-9) {
    return {
      regla: "H2",
      texto: `Humedad de la arena: Indumix ${pct(e.indumix)} % · medida hoy ${pct(e.medida.pct)} %${e.medida.hhmm ? ` (${e.medida.hhmm})` : ""}${e.sinCambioDesdeAyer ? " · en Indumix no se cambió desde ayer" : ""}`,
    }
  }
  return { regla: null, texto: null }
}

/** "Piedra Partida 6/12" → "6/12" */
export const piedraCorta = (n: string | null | undefined) => String(n || "").match(/\d+\/\d+/)?.[0] || String(n || "?")

/**
 * Tolva 1 (tolva_material, una abierta a la vez): al cambiar la receta elegida en Indumix, qué piedra pide en la Tolva 1
 * (la de la fórmula asignada entre las alternativas; sin fórmula, la que dice el nombre) contra la última que se usó.
 * Avisa solo si la receta pesa algo en la Tolva 1.
 */
export function controlTolva1(e: {
  numero: number
  receta: (Pick<RecetaPlanta, "salidas"> & { nombre?: string | null }) | null
  formula: FormulaSistema | null
  salida: SalidaMapa | null
  materiales: Pick<MaterialSistema, "id" | "name">[]
  /** material de la última carga leída o, si no hay, el de puesto_salidas vigente */
  ultimo: string | null
}): { aviso: boolean; lleva: string | null; texto: string | null } {
  const no = { aviso: false, lleva: null as string | null, texto: null as string | null }
  const s = e.salida
  if (!e.receta || !s?.alternativas?.length) return no
  if (!((valoresReceta(e.receta)[s.salida] || 0) > 0)) return no
  const nombre = (id: string | null) => e.materiales.find((m) => m.id === id)?.name || null
  let lleva: string | null = null
  if (e.formula) {
    const pide = new Set(e.formula.materiales.filter((m) => m.cantidad > 0).map((m) => m.material_id))
    lleva = s.alternativas.find((a) => pide.has(a)) || null
  }
  if (!lleva) {
    const g = String(e.receta.nombre || "").match(/6\s*\/?\s*(12|20)/)
    if (g) lleva = s.alternativas.find((a) => piedraCorta(nombre(a)) === `6/${g[1]}`) || null
  }
  if (!lleva || !e.ultimo || lleva === e.ultimo) return { ...no, lleva }
  return {
    aviso: true, lleva,
    texto: `¿Cambiaron la piedra de la ${INFO_SALIDA[s.salida].nombre}? La receta ${e.numero} lleva ${piedraCorta(nombre(lleva))} y lo último fue ${piedraCorta(nombre(e.ultimo))}`,
  }
}

/**
 * Id del evento "carga_sin_material" (un arranque cortado, sin carga): el mismo reporte leído otra vez no se graba dos
 * veces, y los dos N° 8 del 03/11 (mismo número y hora, distinto camión) quedan como dos eventos distintos.
 */
export function claveSinMaterial(puestoId: string, dia: string | null, rep: Pick<ReportePlanta, "numero" | "inicio_plc" | "camion" | "observacion">): string {
  return `sinmat:${puestoId}:${dia}:${rep.numero}:${rep.inicio_plc}:${rep.camion}:${rep.observacion}`.slice(0, 200)
}
