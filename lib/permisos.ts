/**
 * Permisos por persona (fase 0c-1).
 *
 * Una sola fuente para el navegador y el servidor: sin React, sin Supabase y sin imports en tiempo de
 * ejecución (se prueba con `node --test`). Especificación: docs/migracion-loop/fase-0c.md (4.2 a 4.4 y 18).
 *
 * - Cada persona tiene un `tipo` (gerencial / operario / consulta) y una matriz `permisos`
 *   sección × acción (ver · cargar · editar · borrar).
 * - Gerencial puede todo: `puedeCon` no mira la matriz.
 * - `usuarios` sale solo del tipo (solo gerencial): no se habilita por persona.
 * - Lo que falta o no es booleano vale `false`. Las acciones que no existen en la sección, también.
 */

export type Tipo = "gerencial" | "operario" | "consulta"
export type Accion = "ver" | "cargar" | "editar" | "borrar"
export type SeccionClave =
  | "programacion"
  | "despacho"
  | "historial"
  | "materia_prima"
  | "recuentos"
  | "laboratorio"
  | "mantenimiento"
  | "clientes"
  | "formulas"
  | "flota"
  | "usuarios"

export type PermisosSeccion = Record<Accion, boolean>
export type Permisos = Record<SeccionClave, PermisosSeccion>

/** Lo mínimo que hace falta saber de la persona para decidir. */
export type UsuarioPermisos = { name?: string | null; tipo: Tipo | string | null | undefined; permisos?: unknown } | null | undefined

export type Seccion = {
  clave: SeccionClave
  nombre: string
  acciones: Accion[]
  /** Rutas de la sección (la primera es la principal). Sin ruta: no tiene pantalla propia. */
  rutas: string[]
  /** Qué significa cada acción en esta sección (para la pantalla Usuarios). */
  descripcion: Partial<Record<Accion, string>>
}

export const ACCIONES: Accion[] = ["ver", "cargar", "editar", "borrar"]

export const NOMBRE_ACCION: Record<Accion, string> = {
  ver: "Ver",
  cargar: "Cargar",
  editar: "Editar",
  borrar: "Borrar",
}

export const NOMBRE_TIPO: Record<Tipo, string> = {
  gerencial: "Gerencial",
  operario: "Operario",
  consulta: "Consulta",
}

export const TIPOS: Tipo[] = ["gerencial", "operario", "consulta"]

export const SECCIONES: Seccion[] = [
  {
    clave: "programacion",
    nombre: "Programación del día",
    acciones: ["ver", "cargar", "editar", "borrar"],
    rutas: ["/programacion"],
    descripcion: {
      cargar: "Crear pedidos y ajustar los propios: hora y método, viajes, confirmar, el formulario del pedido",
      editar: "Ajustar y corregir todos los pedidos, ordenar el día, editar total, tiempos de la planta",
      borrar: "Cancelar o eliminar pedidos",
    },
  },
  {
    clave: "despacho",
    nombre: "Despacho",
    acciones: ["ver", "cargar"],
    rutas: ["/plantista"],
    descripcion: { cargar: "Despachar (desde pedido y manual), finalizar pedido, camión entregado" },
  },
  {
    clave: "historial",
    nombre: "Historial de despachos",
    acciones: ["ver", "cargar", "editar", "borrar"],
    rutas: ["/historial-despachos"],
    descripcion: {
      cargar: "Agregar muestra después del despacho",
      editar: "Editar despacho, agregar fibra o superfluidificante después",
      borrar: "Eliminar o anular despacho",
    },
  },
  {
    clave: "materia_prima",
    nombre: "Materia prima",
    acciones: ["ver", "cargar", "editar", "borrar"],
    rutas: ["/materias-primas"],
    descripcion: {
      cargar: "Ingresos, humedad del acopio, transferencias, proveedores y transportistas nuevos",
      editar: "Editar ingresos y proveedores",
      borrar: "Borrar ingresos y proveedores",
    },
  },
  {
    clave: "recuentos",
    nombre: "Recuentos y ajustes de stock",
    acciones: ["cargar"],
    rutas: [],
    descripcion: { cargar: "Hacer un recuento o ajuste de stock (\"Ajustar\")" },
  },
  {
    clave: "laboratorio",
    nombre: "Laboratorio",
    acciones: ["ver", "cargar", "editar", "borrar"],
    rutas: ["/calidad"],
    descripcion: {
      cargar: "Cargar rotura, calibración de la prensa, granulometría nueva",
      editar: "Corregir probetas y granulometrías",
      borrar: "Descartar o eliminar probetas y resultados",
    },
  },
  {
    clave: "mantenimiento",
    nombre: "Mantenimiento",
    acciones: ["ver", "cargar", "borrar"],
    rutas: ["/mantenimiento"],
    descripcion: { cargar: "Reportar fallas y trabajar las órdenes", borrar: "Cancelar órdenes de trabajo" },
  },
  {
    clave: "clientes",
    nombre: "Clientes y obras",
    acciones: ["ver", "cargar", "editar", "borrar"],
    rutas: ["/clientes"],
    descripcion: {
      cargar: "Cliente u obra nuevos (también el alta rápida en el pedido)",
      editar: "Editar cliente u obra",
      borrar: "Dar de baja cliente, eliminar obra",
    },
  },
  {
    clave: "formulas",
    nombre: "Fórmulas y materiales",
    acciones: ["ver", "cargar", "editar", "borrar"],
    rutas: ["/formulas"],
    descripcion: { cargar: "Fórmula nueva, material nuevo", editar: "Editar fórmula", borrar: "Eliminar fórmula" },
  },
  {
    clave: "flota",
    nombre: "Camiones, choferes y bombas",
    acciones: ["ver", "cargar", "editar", "borrar"],
    rutas: ["/camiones"],
    descripcion: {
      cargar: "Camión, chofer o empresa de bombeo nuevos",
      editar: "Editar, cambiar estado del camión",
      borrar: "Dar de baja",
    },
  },
  {
    clave: "usuarios",
    nombre: "Usuarios",
    acciones: ["ver"],
    rutas: ["/usuarios", "/actividad"],
    descripcion: { ver: "Usuarios y Actividad (solo gerenciales)" },
  },
]

const POR_CLAVE = Object.fromEntries(SECCIONES.map((s) => [s.clave, s])) as Record<SeccionClave, Seccion>

export function existeAccion(seccion: SeccionClave, accion: Accion): boolean {
  return POR_CLAVE[seccion]?.acciones.includes(accion) ?? false
}

function vacia(): Permisos {
  const p = {} as Permisos
  for (const s of SECCIONES) p[s.clave] = { ver: false, cargar: false, editar: false, borrar: false }
  return p
}

function armar(fn: (s: Seccion, a: Accion) => boolean): Permisos {
  const p = vacia()
  for (const s of SECCIONES) for (const a of s.acciones) p[s.clave][a] = fn(s, a)
  return p
}

/** Plantillas por tipo (4.4 + respuesta 18.3: "agregar muestra" = historial.cargar en gerencial y operario). */
export const PLANTILLAS: Record<Tipo, Permisos> = {
  gerencial: armar(() => true),
  operario: armar((s, a) => (s.clave !== "usuarios" && a === "ver") || (s.clave === "historial" && a === "cargar")),
  consulta: armar((s, a) => s.clave !== "usuarios" && a === "ver"),
}

export function esTipo(t: unknown): t is Tipo {
  return t === "gerencial" || t === "operario" || t === "consulta"
}

/** Copia de la plantilla del tipo (si el tipo no es válido, la de consulta). */
export function plantilla(tipo: unknown): Permisos {
  const base = PLANTILLAS[esTipo(tipo) ? tipo : "consulta"]
  return JSON.parse(JSON.stringify(base))
}

/**
 * Matriz completa y limpia: todas las secciones y acciones; lo que falta o no es booleano, `false`; las
 * acciones que no existen en la sección, `false`. Además: si carga, edita o borra, ve (regla 5).
 */
export function normalizarPermisos(raw: unknown): Permisos {
  const p = vacia()
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  for (const s of SECCIONES) {
    const r = obj[s.clave]
    const rs = r && typeof r === "object" && !Array.isArray(r) ? (r as Record<string, unknown>) : {}
    for (const a of s.acciones) p[s.clave][a] = rs[a] === true
    if (s.acciones.includes("ver") && (p[s.clave].cargar || p[s.clave].editar || p[s.clave].borrar)) p[s.clave].ver = true
  }
  return p
}

/**
 * Tildar o destildar una casilla en la pantalla Usuarios (regla 5): tildar cargar, editar o borrar tilda
 * "ver"; destildar "ver" destilda las demás. Devuelve una matriz nueva.
 */
export function cambiarPermiso(permisos: Permisos, seccion: SeccionClave, accion: Accion, valor: boolean): Permisos {
  const p = normalizarPermisos(permisos)
  if (!existeAccion(seccion, accion)) return p
  p[seccion][accion] = valor
  const tieneVer = existeAccion(seccion, "ver")
  if (valor && accion !== "ver" && tieneVer) p[seccion].ver = true
  if (!valor && accion === "ver") {
    p[seccion].cargar = false
    p[seccion].editar = false
    p[seccion].borrar = false
  }
  return p
}

export function tipoDe(usuario: UsuarioPermisos): Tipo {
  return esTipo(usuario?.tipo) ? (usuario!.tipo as Tipo) : "consulta"
}

/** ¿La persona puede hacer `accion` en `seccion`? */
export function puedeCon(usuario: UsuarioPermisos, seccion: SeccionClave, accion: Accion): boolean {
  if (!usuario) return false
  if (!existeAccion(seccion, accion)) return false
  const tipo = tipoDe(usuario)
  if (tipo === "gerencial") return true
  if (seccion === "usuarios") return false // solo del tipo
  return normalizarPermisos(usuario.permisos)[seccion][accion] === true
}

/** Igual que el login: minúsculas, sin tildes, sin espacios a los costados ni dobles. */
export function normalizarNombre(nombre: unknown): string {
  return String(nombre ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Respuesta 18.4: con `programacion.editar` se ajusta cualquier pedido; con solo `programacion.cargar`,
 * únicamente los pedidos que creó la persona (`scheduled_dispatches.created_by`). Los ajenos, en lectura.
 */
export function puedeAjustarPedido(usuario: UsuarioPermisos, pedido: { created_by?: string | null } | null | undefined): boolean {
  if (!usuario || !pedido) return false
  if (puedeCon(usuario, "programacion", "editar")) return true
  if (!puedeCon(usuario, "programacion", "cargar")) return false
  const propio = normalizarNombre(pedido.created_by)
  return propio !== "" && propio === normalizarNombre(usuario.name)
}

export type Diferencia = { seccion: SeccionClave; accion: Accion; valor: boolean; plantilla: boolean }

/** Casillas distintas de la plantilla del tipo ("agregado a mano" / "quitado a mano"). */
export function diferenciasConPlantilla(tipo: unknown, permisos: unknown): Diferencia[] {
  const base = plantilla(tipo)
  const p = normalizarPermisos(permisos)
  const out: Diferencia[] = []
  if (esTipo(tipo) && tipo === "gerencial") return out
  for (const s of SECCIONES)
    for (const a of s.acciones) if (p[s.clave][a] !== base[s.clave][a]) out.push({ seccion: s.clave, accion: a, valor: p[s.clave][a], plantilla: base[s.clave][a] })
  return out
}

/** Sección a la que pertenece una ruta (para el menú y `SeccionProtegida`). Sin sección: la ven todos. */
export function seccionDeRuta(pathname: string): SeccionClave | null {
  const ruta = (pathname || "/").split("?")[0]
  for (const s of SECCIONES)
    for (const r of s.rutas) if (ruta === r || ruta.startsWith(r + "/")) return s.clave
  return null
}

export function nombreSeccion(clave: SeccionClave): string {
  return POR_CLAVE[clave]?.nombre || clave
}

/**
 * Cambios de permisos para la Actividad de la pantalla Usuarios: {"Historial · editar": "no → sí"}.
 */
export function cambiosDePermisos(antes: unknown, despues: unknown): Record<string, string> {
  const a = normalizarPermisos(antes)
  const d = normalizarPermisos(despues)
  const out: Record<string, string> = {}
  for (const s of SECCIONES)
    for (const ac of s.acciones)
      if (a[s.clave][ac] !== d[s.clave][ac])
        out[`${s.nombre} · ${NOMBRE_ACCION[ac].toLowerCase()}`] = `${a[s.clave][ac] ? "sí" : "no"} → ${d[s.clave][ac] ? "sí" : "no"}`
  return out
}

/** "Carga en: …" para la lista de Usuarios. */
export function seccionesCon(usuario: UsuarioPermisos, accion: Accion): string[] {
  return SECCIONES.filter((s) => s.clave !== "usuarios" && existeAccion(s.clave, accion) && puedeCon(usuario, s.clave, accion)).map((s) => s.nombre)
}
