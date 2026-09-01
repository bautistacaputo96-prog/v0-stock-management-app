/**
 * Carga el plan de mantenimiento preventivo de la planta dosificadora
 * Indumóvil 80 (Indumix) a partir del "Manual Indumovil 80 - Mantenimiento
 * (Rev. 02, Junio 2015)" y del manual de Partes y Repuestos.
 *
 * Las frecuencias del manual vienen en horas de trabajo y en m³ dosificados.
 * Acá se traducen a calendario usando el uso real de Canning medido sobre los
 * despachos cargados (abr–ago 2026): 1.222 m³/mes, 17,2 días productivos/mes,
 * 71 m³/día → ~14.700 m³/año. Con eso, el service de 15.000 m³ del manual cae
 * una vez por año (la "parada anual").
 *
 * Cuando la tarea también tiene disparador por m³ se guarda en frecuencia_m3:
 * el sistema avisa por lo que ocurra primero (calendario o m³ acumulados).
 *
 * Ejecutar: PGCONN=... node scripts/seed-mantenimiento-indumovil80.js
 */
const { Client } = require("pg")

const DIA = 1, SEMANA = 7, QUINCENA = 15, MES = 30, BIMESTRE = 60
const TRIMESTRE = 90, SEMESTRE = 180, ANIO = 365

const TAREAS = [
  // ── Diario ────────────────────────────────────────────────────────────────
  {
    codigo: "3.6a", titulo: "Purgar la trampa de agua del regulador (FR)",
    detalle: "Purgar la trampa de agua ubicada en la parte inferior del regulador de aire.",
    componente: "Sistema neumático", frecuencia_dias: DIA, referencia_manual: "Mant. 3.6",
    items: [],
  },
  // ── Semanal ───────────────────────────────────────────────────────────────
  {
    codigo: "1.2", titulo: "Purgar el compresor de aire",
    detalle: "Abrir la válvula esférica del inferior del tanque. Si tiene válvula autopurgante, verificar que funcione.",
    componente: "Sistema neumático", frecuencia_dias: SEMANA, referencia_manual: "Mant. 1.2 / 3.6",
    items: [],
  },
  {
    codigo: "3.2a", titulo: "Engrasar alemites de los tornillos de cemento",
    detalle: "Engrasar todos los alemites de soportes intermedios (porta buje de hélices) y porta rodamientos de los extremos. El exceso de grasa también perjudica.",
    componente: "Tornillos de cemento", frecuencia_dias: SEMANA, referencia_manual: "Mant. 3.2",
    items: [{ item: "Grasa para transmisión", cantidad: 0.2, unidad: "kg", tipo: "insumo" }],
  },
  {
    codigo: "3.2b", titulo: "Revisar ajuste de bulones de bridas y soportes del tornillo",
    detalle: "Revisar el ajuste de los bulones de las bridas del reductor al tornillo de cemento y de los soportes intermedios.",
    componente: "Tornillos de cemento", frecuencia_dias: SEMANA, referencia_manual: "Mant. 3.2",
    items: [],
  },
  {
    codigo: "3.3a", titulo: "Verificar nivel de aceite de los reductores",
    detalle: "Cada reductor tiene 3 tapones: descarga, indicador de nivel y carga. Verificar por el indicador de nivel.",
    componente: "Reductores", frecuencia_dias: SEMANA, referencia_manual: "Mant. 3.3",
    items: [{ item: "Aceite YPF EP 220 o SAE 90 (reposición)", cantidad: 1, unidad: "lt", tipo: "insumo" }],
  },
  {
    codigo: "3.6b", titulo: "Verificar lubricante del vaso del FRL",
    detalle: "Solo en equipos con cilindros/electroválvulas NO autolubricados. Verificar presencia de lubricante en el vaso.",
    componente: "Sistema neumático", frecuencia_dias: SEMANA, referencia_manual: "Mant. 1.12 / 3.6",
    items: [{ item: "Aceite Turbina 32 YPF", cantidad: 0.25, unidad: "lt", tipo: "insumo" }],
  },
  // ── Quincenal ─────────────────────────────────────────────────────────────
  {
    codigo: "1.1", titulo: "Limpiar el dosificador de aditivos",
    detalle: "Hacer circular agua desde la primera entrada del circuito.",
    componente: "Dosificador de aditivos", frecuencia_dias: QUINCENA, referencia_manual: "Mant. 1.1",
    items: [],
  },
  {
    codigo: "3.4", titulo: "Ajustar bulones y engrasar compuertas de tolvas",
    detalle: "Repasar el ajuste de los bulones de las compuertas de las tolvas y engrasar sus engranajes por los alemites. Evitar cuerpos extraños.",
    componente: "Tolvas de áridos", frecuencia_dias: QUINCENA, referencia_manual: "Mant. 3.4",
    items: [{ item: "Grasa para transmisión", cantidad: 0.3, unidad: "kg", tipo: "insumo" }],
  },
  // ── Mensual (40 h de trabajo) ─────────────────────────────────────────────
  {
    codigo: "1.4", titulo: "Lubricar y limpiar engranajes de compuertas de tolvas",
    detalle: "Engranajes de las compuertas en tolva de acopio y tolva de pesada de áridos. Lubricar con grasa de transmisión, limpiar con aire comprimido.",
    componente: "Tolvas de áridos", frecuencia_dias: MES, referencia_manual: "Mant. 1.4",
    items: [{ item: "Grasa para transmisión", cantidad: 0.3, unidad: "kg", tipo: "insumo" }],
  },
  {
    codigo: "1.5", titulo: "Lubricar porta rodamientos de los tornillos de cemento",
    detalle: "Porta rodamientos de los extremos en los tornillos de carga y descarga de cemento.",
    componente: "Tornillos de cemento", frecuencia_dias: MES, referencia_manual: "Mant. 1.5",
    items: [{ item: "Grasa para transmisión", cantidad: 0.2, unidad: "kg", tipo: "insumo" }],
  },
  {
    codigo: "1.6", titulo: "Limpiar mangas de lona de interconexión",
    detalle: "Mangas de lona de interconexión en los tornillos de cemento. Limpiar con aire comprimido.",
    componente: "Tornillos de cemento", frecuencia_dias: MES, referencia_manual: "Mant. 1.6",
    items: [],
  },
  {
    codigo: "1.7", titulo: "Lubricar y limpiar rodamientos de cabezal motriz y tensor",
    detalle: "Rodamientos del cabezal motriz y del cabezal tensor de la cinta. Lubricar con grasa de transmisión y limpiar con aire comprimido.",
    componente: "Cinta transportadora", frecuencia_dias: MES, referencia_manual: "Mant. 1.7",
    items: [{ item: "Grasa para transmisión", cantidad: 0.2, unidad: "kg", tipo: "insumo" }],
  },
  {
    codigo: "1.8", titulo: "Limpiar electroválvulas y cilindros neumáticos",
    detalle: "Limpieza externa de electroválvulas y cilindros neumáticos.",
    componente: "Sistema neumático", frecuencia_dias: MES, referencia_manual: "Mant. 1.8",
    items: [],
  },
  {
    codigo: "1.9", titulo: "Limpiar el respiradero de la balanza de cemento",
    detalle: "Aflojar adherencias con martillo de goma y limpiar con aire comprimido. Si tiene filtro de cemento, ver su manual.",
    componente: "Balanza de cemento", frecuencia_dias: MES, referencia_manual: "Mant. 1.9",
    items: [],
  },
  // ── Bimestral (80 h) ──────────────────────────────────────────────────────
  {
    codigo: "1.10", titulo: "Lubricar soportes intermedios de los tornillos de cemento",
    detalle: "Soportes intermedios (porta buje de hélices) de los tornillos de alimentación y descarga de cemento.",
    componente: "Tornillos de cemento", frecuencia_dias: BIMESTRE, referencia_manual: "Mant. 1.10",
    items: [{ item: "Grasa para transmisión", cantidad: 0.3, unidad: "kg", tipo: "insumo" }],
  },
  {
    codigo: "1.11", titulo: "Revisar tensión de las correas del cabezal motriz",
    detalle: "Verificar tensión y estado de las correas de transmisión del cabezal motriz de la cinta.",
    componente: "Cinta transportadora", frecuencia_dias: BIMESTRE, referencia_manual: "Mant. 1.11 / 2.7",
    items: [{ item: "Correa trapezoidal tipo C L=60\" (repuesto)", cantidad: 3, unidad: "un", tipo: "repuesto", codigo_repuesto: "Cinta pos. 03" }],
  },
  // ── Trimestral (150 h) ────────────────────────────────────────────────────
  {
    codigo: "1.13", titulo: "Revisar el circuito de agua",
    detalle: "Comprobar el estado de los componentes y verificar que no haya pérdidas.",
    componente: "Circuito de agua", frecuencia_dias: TRIMESTRE, referencia_manual: "Mant. 1.13 / 3.5",
    items: [],
  },
  {
    codigo: "1.14", titulo: "Limpieza interna del tablero de potencia",
    detalle: "Limpiar el interior del tablero con aire comprimido. Con la planta sin tensión.",
    componente: "Tablero eléctrico", frecuencia_dias: TRIMESTRE, referencia_manual: "Mant. 1.14",
    items: [],
  },
  // ── Semestral (300 h) ─────────────────────────────────────────────────────
  {
    codigo: "3.3b", titulo: "Cambio de aceite de reductores",
    detalle: "Cambiar el aceite de los reductores cada 300 h de uso. Verificar la cantidad en la placa de identificación de cada reductor.",
    componente: "Reductores", frecuencia_dias: SEMESTRE, referencia_manual: "Mant. 3.3",
    items: [{ item: "Aceite YPF EP 220 o SAE 90", cantidad: 8, unidad: "lt", tipo: "insumo" }],
  },
  {
    codigo: "3.5", titulo: "Limpiar el filtro del circuito de agua",
    detalle: "Cerrar la válvula de salida del tanque y retirar el tapón de 2½\" de la Y para limpiar el filtro.",
    componente: "Circuito de agua", frecuencia_dias: SEMESTRE, referencia_manual: "Mant. 3.5",
    items: [],
  },
  // ── Anual / parada de fin de año (15.000 m³) ──────────────────────────────
  {
    codigo: "2.1", titulo: "PARADA ANUAL — Inspeccionar y lubricar reductores",
    detalle: "Reductor del cabezal motriz y reductor del tornillo de cemento. Lubricar con aceite YPF EP 220 o SAE 90. Capacidad según placa de identificación.",
    componente: "Reductores", frecuencia_dias: ANIO, frecuencia_m3: 15000, referencia_manual: "Mant. 2.1",
    items: [{ item: "Aceite YPF EP 220 o SAE 90", cantidad: 8, unidad: "lt", tipo: "insumo" }],
  },
  {
    codigo: "2.2", titulo: "PARADA ANUAL — Verificar mangas de lona de tornillos de cemento",
    detalle: "Verificar el estado de las mangas de lona en tornillos de carga y descarga de cemento. Reemplazar si están dañadas.",
    componente: "Tornillos de cemento", frecuencia_dias: ANIO, frecuencia_m3: 15000, referencia_manual: "Mant. 2.2",
    items: [{ item: "Manga de lona Ø274", cantidad: 1, unidad: "un", tipo: "repuesto", codigo_repuesto: "Balanza pos. 30" }],
  },
  {
    codigo: "2.3", titulo: "PARADA ANUAL — Verificar encausadores y rascadores de cinta",
    detalle: "Estado de los encausadores de cinta, del rascador inferior y de los rascadores superiores.",
    componente: "Cinta transportadora", frecuencia_dias: ANIO, frecuencia_m3: 15000, referencia_manual: "Mant. 2.3",
    items: [
      { item: "Rascador inferior (juego)", cantidad: 1, unidad: "un", tipo: "repuesto" },
      { item: "Rascadores superiores (juego)", cantidad: 1, unidad: "un", tipo: "repuesto" },
      { item: "Goma de encausador", cantidad: 2, unidad: "un", tipo: "repuesto" },
    ],
  },
  // ── Cada 1,5 años (20.000 m³) ─────────────────────────────────────────────
  {
    codigo: "2.4", titulo: "Controlar desgaste de soportes intermedios de tornillos",
    detalle: "Controlar el desgaste de los soportes intermedios (porta buje de hélices) de los tornillos de alimentación y descarga de cemento.",
    componente: "Tornillos de cemento", frecuencia_dias: Math.round(ANIO * 1.5), frecuencia_m3: 20000, referencia_manual: "Mant. 2.4",
    items: [
      { item: "Estrella porta buje", cantidad: 1, unidad: "un", tipo: "repuesto", codigo_repuesto: "Balanza pos. 09a" },
      { item: "Retén DBH 5148 (40x52x7)", cantidad: 2, unidad: "un", tipo: "repuesto", codigo_repuesto: "Balanza pos. 09b" },
      { item: "Arandela especial SAE 1010 Øe68xØi43x2", cantidad: 2, unidad: "un", tipo: "repuesto", codigo_repuesto: "Balanza pos. 09c" },
    ],
  },
  {
    codigo: "2.5", titulo: "Inspeccionar y lubricar compresor + cambiar filtro de aire",
    detalle: "Inspeccionar y lubricar el compresor de aire, y sustituir su filtro de aire. Ver especificaciones en el manual del compresor (7,5 HP).",
    componente: "Sistema neumático", frecuencia_dias: Math.round(ANIO * 1.5), frecuencia_m3: 20000, referencia_manual: "Mant. 2.5",
    items: [
      { item: "Filtro de aire del compresor", cantidad: 1, unidad: "un", tipo: "repuesto", codigo_repuesto: "Neumático pos. 01" },
      { item: "Aceite para compresor (ver manual del fabricante)", cantidad: 2, unidad: "lt", tipo: "insumo" },
    ],
  },
  // ── Cada 2 años (30.000 m³) ───────────────────────────────────────────────
  {
    codigo: "2.6", titulo: "Verificar estado de la cinta transportadora",
    detalle: "Verificar el estado general de la banda: tensión, empalmes, desgaste y rotación de rodillos.",
    componente: "Cinta transportadora", frecuencia_dias: ANIO * 2, frecuencia_m3: 30000, referencia_manual: "Mant. 2.6 / 3.1",
    items: [
      { item: "Banda de goma lisa 30\" L=23500", cantidad: 1, unidad: "un", tipo: "repuesto", codigo_repuesto: "Cinta pos. 11" },
      { item: "Rodillo de retorno 30\"", cantidad: 7, unidad: "un", tipo: "repuesto", codigo_repuesto: "Cinta pos. 15" },
      { item: "Trío delantero 30\"", cantidad: 8, unidad: "un", tipo: "repuesto", codigo_repuesto: "Cinta pos. 10" },
      { item: "Soporte SKF SY65 / SY50", cantidad: 4, unidad: "un", tipo: "repuesto", codigo_repuesto: "Cinta pos. 08 / 14" },
    ],
  },
  // ── Cada 3,5 años (50.000 m³) ─────────────────────────────────────────────
  {
    codigo: "2.8", titulo: "Verificar engranajes de compuertas de tolvas",
    detalle: "Estado de los engranajes de las compuertas en la tolva de acopio y en la tolva de pesada de áridos.",
    componente: "Tolvas de áridos", frecuencia_dias: Math.round(ANIO * 3.5), frecuencia_m3: 50000, referencia_manual: "Mant. 2.8",
    items: [{ item: "Juego de engranajes de compuerta", cantidad: 1, unidad: "un", tipo: "repuesto" }],
  },
  // ── Cada 7 años (100.000 m³) ──────────────────────────────────────────────
  {
    codigo: "2.9", titulo: "Controlar desgaste de planos inclinados de tolvas",
    detalle: "Controlar el desgaste de los planos inclinados de las tolvas de áridos.",
    componente: "Tolvas de áridos", frecuencia_dias: ANIO * 7, frecuencia_m3: 100000, referencia_manual: "Mant. 2.9",
    items: [{ item: "Chapa de desgaste para planos inclinados", cantidad: 1, unidad: "un", tipo: "repuesto" }],
  },
]

async function main() {
  const c = new Client({
    connectionString: process.env.PGCONN.replace(/[?&]sslmode=[^&]*/, ""),
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()

  const plant = await c.query(`SELECT id FROM plants WHERE name = 'Canning'`)
  if (!plant.rowCount) throw new Error("No se encontró la planta Canning")

  let eq = await c.query(
    `SELECT id FROM maint_equipment WHERE nombre = 'Planta dosificadora Indumóvil 80' AND plant_id = $1`,
    [plant.rows[0].id],
  )
  if (!eq.rowCount) {
    eq = await c.query(
      `INSERT INTO maint_equipment (plant_id, nombre, modelo, fabricante)
       VALUES ($1, 'Planta dosificadora Indumóvil 80', 'Indumóvil 80', 'Indumix S.A.') RETURNING id`,
      [plant.rows[0].id],
    )
    console.log("equipo creado")
  }
  const equipmentId = eq.rows[0].id

  let nuevas = 0
  for (const [i, t] of TAREAS.entries()) {
    const existe = await c.query(`SELECT id FROM maint_tasks WHERE equipment_id = $1 AND codigo = $2`, [equipmentId, t.codigo])
    if (existe.rowCount) continue
    const r = await c.query(
      `INSERT INTO maint_tasks (equipment_id, codigo, titulo, detalle, componente, frecuencia_dias, frecuencia_m3, referencia_manual, orden)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [equipmentId, t.codigo, t.titulo, t.detalle, t.componente, t.frecuencia_dias || null, t.frecuencia_m3 || null, t.referencia_manual, i],
    )
    for (const it of t.items || []) {
      await c.query(
        `INSERT INTO maint_task_items (task_id, item, cantidad, unidad, tipo, codigo_repuesto)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [r.rows[0].id, it.item, it.cantidad, it.unidad, it.tipo, it.codigo_repuesto || null],
      )
    }
    nuevas++
  }
  console.log(`tareas cargadas: ${nuevas} nuevas de ${TAREAS.length}`)
  await c.end()
}

main().catch((e) => {
  console.error("ERROR:", e.message)
  process.exit(1)
})
