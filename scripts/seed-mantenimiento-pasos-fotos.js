/**
 * Carga, para cada tarea del plan de la Indumóvil 80:
 *   - el checklist de pasos concretos (lo que el operario va tildando)
 *   - las fotos del manual que ayudan a ubicar el componente
 *
 * Las fotos se extrajeron del "Manual Indumovil 80 - Mantenimiento (Rev.02)"
 * y viven en /public/manuales/indumovil80. Se asocian por la página del manual
 * donde aparece cada tarea.
 *
 * Ejecutar: PGCONN=... node scripts/seed-mantenimiento-pasos-fotos.js
 */
const { Client } = require("pg")
const fs = require("fs")
const path = require("path")

const DIR_FOTOS = path.join(__dirname, "..", "public", "manuales", "indumovil80")

// Página del manual donde está cada tarea (para asociarle sus fotos)
const PAGINA = {
  "1.1": 2, "1.2": 2,
  "1.3": 3, "1.4": 3, "1.5": 3,
  "1.6": 4, "1.7": 4, "1.8": 4,
  "1.9": 5, "1.10": 5, "1.11": 5,
  "1.12": 6, "1.13": 6, "1.14": 6,
  "2.1": 7, "2.2": 7, "2.3": 7,
  "2.4": 8, "2.5": 8, "2.6": 8,
  "2.7": 9, "2.8": 9, "2.9": 9,
  "3.1": 10, "3.2": 10, "3.2a": 10, "3.2b": 10,
  "3.3": 11, "3.3a": 11, "3.3b": 11, "3.4": 11, "3.5": 11,
  "3.6": 12, "3.6a": 12, "3.6b": 12,
}

// Checklist por tarea. Son los pasos que el manual describe, desglosados.
const PASOS = {
  "3.6a": ["Cerrar el paso de aire", "Abrir la purga inferior del regulador", "Verificar que salga el agua acumulada", "Cerrar la purga y restablecer el aire"],
  "1.2": ["Abrir la válvula esférica del inferior del tanque", "Dejar salir el condensado hasta que salga aire limpio", "Cerrar la válvula", "Si tiene válvula autopurgante: verificar que funcione sola"],
  "3.2a": ["Ubicar los alemites de los soportes intermedios", "Engrasar hasta ver salida de grasa limpia", "Engrasar los porta rodamientos de los extremos", "No excederse: el exceso de grasa también daña"],
  "3.2b": ["Revisar bulones de las bridas del reductor al tornillo", "Revisar bulones de los soportes intermedios", "Ajustar los que estén flojos"],
  "3.3a": ["Ubicar el tapón indicador de nivel de cada reductor", "Verificar que el aceite llegue al nivel", "Completar si hace falta con YPF EP 220 o SAE 90"],
  "3.6b": ["Verificar el nivel del vaso lubricador del FRL", "Completar con aceite Turbina 32 YPF si está bajo", "Solo aplica a cilindros no autolubricados"],
  "1.1": ["Conectar agua a la primera entrada del circuito", "Hacer circular hasta que salga limpia", "Verificar que no queden restos de aditivo"],
  "3.4": ["Repasar el ajuste de bulones de las compuertas", "Engrasar los engranajes por los alemites", "Verificar que no haya cuerpos extraños trabando"],
  "1.4": ["Limpiar los engranajes con aire comprimido", "Lubricar con grasa para transmisión", "Hacerlo en tolva de acopio y en tolva de pesada"],
  "1.5": ["Ubicar los porta rodamientos de los extremos", "Engrasar el tornillo de carga de cemento", "Engrasar el tornillo de descarga de cemento"],
  "1.6": ["Inspeccionar las mangas de lona de interconexión", "Limpiar con aire comprimido", "Verificar que no tengan cortes ni pérdidas"],
  "1.7": ["Limpiar con aire comprimido los rodamientos del cabezal motriz", "Lubricar con grasa para transmisión", "Repetir en el cabezal tensor"],
  "1.8": ["Limpiar exteriormente las electroválvulas", "Limpiar los cilindros neumáticos", "Verificar que no haya pérdidas de aire"],
  "1.9": ["Aflojar adherencias con martillo de goma", "Limpiar el respiradero con aire comprimido", "Verificar que respire libremente"],
  "1.10": ["Ubicar los soportes intermedios (porta buje de hélices)", "Lubricar con grasa para transmisión", "Hacerlo en alimentación y en descarga"],
  "1.11": ["Verificar la tensión de las correas", "Revisar que no tengan grietas ni desgaste", "Tensar o reemplazar según estado"],
  "1.13": ["Recorrer el circuito buscando pérdidas", "Verificar el estado de mangueras y conexiones", "Comprobar el funcionamiento de las válvulas"],
  "1.14": ["Cortar la tensión del tablero", "Limpiar el interior con aire comprimido", "Verificar que no haya bornes flojos ni signos de recalentamiento", "Cerrar y restablecer la tensión"],
  "3.3b": ["Cortar la tensión y bloquear el equipo", "Retirar el tapón de descarga y drenar el aceite usado", "Colocar el tapón y cargar por el tapón superior", "Verificar el nivel por el indicador", "Anotar la cantidad cargada por reductor"],
  "3.5": ["Cerrar la válvula de salida del tanque", "Retirar el tapón de 2½\" de la Y", "Extraer y limpiar el filtro", "Colocar todo y abrir la válvula"],
  "2.1": ["Inspeccionar el reductor del cabezal motriz", "Inspeccionar el reductor del tornillo de cemento", "Verificar la capacidad en la placa de identificación", "Lubricar con YPF EP 220 o SAE 90"],
  "2.2": ["Inspeccionar la manga del tornillo de carga", "Inspeccionar la manga del tornillo de descarga", "Reemplazar si hay cortes, roturas o pérdida de cemento"],
  "2.3": ["Verificar el estado de los encausadores de cinta", "Verificar el rascador inferior", "Verificar los rascadores superiores", "Reemplazar los desgastados"],
  "2.4": ["Desarmar el acceso al soporte intermedio", "Medir el desgaste del porta buje de hélices", "Reemplazar estrella, retenes y arandelas si hay juego", "Hacerlo en alimentación y en descarga"],
  "2.5": ["Inspeccionar el compresor según su manual", "Cambiar el aceite del compresor", "Sustituir el filtro de aire", "Verificar el funcionamiento del presostato"],
  "2.6": ["Verificar el estado general de la banda", "Revisar empalmes y bordes", "Verificar que todos los rodillos giren libres", "Controlar la tensión y alineación"],
  "2.7": ["Controlar el estado de las correas de transmisión", "Verificar la tensión", "Reemplazar el juego completo si alguna está dañada"],
  "2.8": ["Inspeccionar los engranajes de compuertas de tolva de acopio", "Inspeccionar los de la tolva de pesada", "Medir el desgaste de dientes", "Reemplazar si están gastados"],
  "2.9": ["Inspeccionar los planos inclinados de las tolvas", "Medir el espesor remanente de las chapas", "Programar el recambio si están al límite"],
}

async function main() {
  const c = new Client({
    connectionString: process.env.PGCONN.replace(/[?&]sslmode=[^&]*/, ""),
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()

  // Fotos disponibles agrupadas por página del manual
  const fotosPorPagina = {}
  for (const f of fs.readdirSync(DIR_FOTOS).filter((f) => f.endsWith(".png")).sort()) {
    const m = f.match(/^p(\d+)_/)
    if (!m) continue
    const pag = parseInt(m[1], 10)
    ;(fotosPorPagina[pag] = fotosPorPagina[pag] || []).push(f)
  }

  const tareas = await c.query(`SELECT id, codigo, titulo FROM maint_tasks ORDER BY orden`)
  let pasosCargados = 0, fotosCargadas = 0

  for (const t of tareas.rows) {
    // Checklist
    const pasos = PASOS[t.codigo]
    if (pasos) {
      const ya = await c.query(`SELECT 1 FROM maint_task_steps WHERE task_id = $1 LIMIT 1`, [t.id])
      if (!ya.rowCount) {
        for (const [i, texto] of pasos.entries()) {
          await c.query(`INSERT INTO maint_task_steps (task_id, texto, orden) VALUES ($1,$2,$3)`, [t.id, texto, i])
          pasosCargados++
        }
      }
    }

    // Fotos de la página del manual donde está la tarea
    const pag = PAGINA[t.codigo]
    const fotos = pag ? fotosPorPagina[pag] || [] : []
    if (fotos.length) {
      const ya = await c.query(`SELECT 1 FROM maint_task_images WHERE task_id = $1 LIMIT 1`, [t.id])
      if (!ya.rowCount) {
        for (const [i, f] of fotos.entries()) {
          await c.query(
            `INSERT INTO maint_task_images (task_id, url, epigrafe, orden) VALUES ($1,$2,$3,$4)`,
            [t.id, `/manuales/indumovil80/${f}`, `Manual pág. ${pag}`, i],
          )
          fotosCargadas++
        }
      }
    }
  }

  console.log(`pasos cargados: ${pasosCargados} | fotos asociadas: ${fotosCargadas}`)
  await c.end()
}

main().catch((e) => {
  console.error("ERROR:", e.message)
  process.exit(1)
})
