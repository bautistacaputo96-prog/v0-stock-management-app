"use client"
/**
 * Bloque "Nota de pedido (Zomatik)" del formulario del pedido (Z2, decisiones del 22/10 y del 23/10, sección 25):
 *   - NP nueva: NP o NP2 según el remito (R/X), con la lista activa (el robot la elige; no se muestra).
 *   - NP de un proyecto: un proyecto abierto del cliente, como el botón MATERIAL. Muestra lo disponible en m³
 *     (≈ de la copia y lo que trajo "Continuar" la última vez) y avisa si el pedido no entra (20.4).
 *   - Usar NP con saldo: una NP del sistema del mismo cliente y artículo que tiene m³ sin usar (Reprogramar). El pedido
 *     toma lo que necesita de esa NP (no genera otra); si no alcanza, el resto en una NP nueva.
 * Al editar, el bloque se habilita recién cuando llegó la elección guardada (así no se pisa). Si el pedido cambió de
 * fecha y ya tiene NP, pregunta si se mueve la NP.
 * Con la llave de la planta apagada: "NP: se carga a mano en Zomatik", como hoy.
 * Si al cliente o a la fórmula les falta el vínculo con Zomatik, avisa y ofrece "Vincular" (04/11, quien programa).
 * Precio por m³ (16/11, docs/specs/2026-11-16-precio-en-programacion.md): una línea, SOLO con precios_np.editar (si no,
 * no existe ni se pide nada). Se puede cambiar hasta que sale la NP; vacío = el de la lista. Precio neto (sin IVA).
 */
import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { actualizarCopiaZomatik, cargarNpSaldos, leerPrecioNp, type EleccionNp, type EstadoPedidoNp, type NpSaldo, type PlantaNpResumen, type PrecioNp } from "@/lib/zomatik/np-cliente"
import { NpChip } from "@/components/zomatik/np-chip"
import { usePermisos } from "@/lib/current-user"
import { puedeCon, puedeVincularDesdePedido } from "@/lib/permisos"
import { MSJ_LISTA_SIN_REMITO, MSJ_PRECIO_INVALIDO, diferenciaConLista, esFaltaDeVinculo, precioDeTexto, precioValido, textoPrecio, type PrecioNpForm } from "@/lib/zomatik/np"

type Proyecto = {
  codigo: number; numero: string; obra: string | null; saldo_m3: number | null; saldo_pct: number | null; estimado: boolean
  disponible_m3: number | null; disponible_articulo: string | null; disponible_at: string | null; de_la_obra: boolean
}

const m3t = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 1 })
const fechaCorta = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }) : "")

/** Lo que le queda al proyecto: lo de "Continuar" si lo hay (lo dijo Zomatik), si no el ≈ de la copia. */
export function disponibleProyecto(p: Proyecto | undefined | null): { m3: number | null; estimado: boolean } {
  if (!p) return { m3: null, estimado: true }
  if (p.disponible_m3 !== null && p.disponible_m3 !== undefined) return { m3: Number(p.disponible_m3), estimado: false }
  return { m3: p.saldo_m3, estimado: p.estimado }
}

const OPCIONES = [
  ["nueva", "NP nueva", "NP o NP2 según el remito"],
  ["proyecto", "NP de un proyecto", "Contra un proyecto abierto"],
  ["saldo", "Usar NP con saldo", "Una NP que quedó con m³"],
] as const

export function NpBloque({
  planta, clientId, siteId, formulaId, m3, valor, onCambio, onM3, soloLectura, estado, proponer, lista, fallo, fechaCambiada, moverFecha, onMoverFecha, faltan, onVincular,
  precio, onPrecio, remito, pedidoId, plantId,
}: {
  planta: PlantaNpResumen | undefined
  clientId: string
  siteId: string
  formulaId: string
  m3: number
  valor: EleccionNp
  onCambio: (v: EleccionNp) => void
  onM3: (m3: number) => void
  soloLectura?: boolean
  /** Al editar: las NP que ya tiene el pedido. */
  estado?: EstadoPedidoNp | null
  /** Proponer solo el proyecto guardado en la obra: en el alta, o si el pedido todavía no tiene elección guardada. */
  proponer: boolean
  /** false mientras no llegó la elección guardada (al editar): el bloque queda deshabilitado (Guardar NO). */
  lista: boolean
  /** No se pudo leer la NP del pedido: se guarda sin tocar la elección que tenía. */
  fallo?: boolean
  /** El pedido (con NP) cambió de fecha: preguntar si se mueve la NP. */
  fechaCambiada: boolean
  moverFecha: boolean | null
  onMoverFecha: (v: boolean) => void
  /** Lo que falta vincular con Zomatik (de lo que ya está en memoria): el nombre del cliente y/o de la fórmula. */
  faltan?: { cliente: string | null; formula: string | null }
  /** Abre el cartel "Falta vincular con Zomatik" (solo si puede vincular desde el pedido). */
  onVincular?: () => void
  /** Precio por m³ de la NP (lo guarda quien llama y lo manda al guardar, solo si se tocó). */
  precio?: PrecioNpForm
  onPrecio?: (p: PrecioNpForm) => void
  /** R o X del formulario (define NP o NP2, y así la lista). */
  remito?: string | null
  /** Al editar, el pedido (para saber si la NP ya salió). */
  pedidoId?: string | null
  plantId?: string
}) {
  const { usuario } = usePermisos()
  const puedeVincular = puedeVincularDesdePedido(usuario) && !!onVincular
  const [proyectos, setProyectos] = useState<Proyecto[] | null>(null)
  const [sinVinculo, setSinVinculo] = useState(false)
  const [saldos, setSaldos] = useState<NpSaldo[] | null>(null)
  const [igual, setIgual] = useState(false)
  const activo = !!planta?.activo
  const deshabilitado = !!soloLectura || !lista
  // Precio por m³: solo con el permiso (si no, ni se pide al servidor) y en un pedido que se puede cambiar
  const puedePrecio = puedeCon(usuario, "precios_np", "editar") && !soloLectura && !!precio && !!onPrecio
  const [infoPrecio, setInfoPrecio] = useState<PrecioNp | null>(null)
  const [vueltaPrecio, setVueltaPrecio] = useState(0)
  const [actualizando, setActualizando] = useState(false)
  // Lo que pasó con el último "Actualizar" (falló o se había hecho hace poco)
  const [avisoActualizar, setAvisoActualizar] = useState<string | null>(null)
  const formulaAntes = useRef(formulaId)

  useEffect(() => {
    if (!activo || !clientId || !lista) {
      setProyectos(null)
      return
    }
    let vivo = true
    fetch(`/api/zomatik/np/proyectos?client_id=${clientId}${siteId ? `&site_id=${siteId}` : ""}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!vivo) return
        setProyectos(j?.proyectos || [])
        setSinVinculo(!!j?.sinVinculo)
        // El proyecto guardado en la obra se propone solo (en el alta, o si el pedido todavía no eligió)
        if (proponer && j?.obraProyecto && valor.tipo === "nueva" && !valor.proyecto_codigo) onCambio({ tipo: "proyecto", proyecto_codigo: j.obraProyecto, tope_m3: null, np_id: null })
      })
      .catch(() => vivo && setProyectos([]))
    return () => {
      vivo = false
    }
  }, [activo, clientId, siteId, lista]) // eslint-disable-line react-hooks/exhaustive-deps

  // NP con saldo del mismo cliente y artículo (para "Usar NP con saldo")
  useEffect(() => {
    if (!activo || !clientId || !formulaId || !lista) {
      setSaldos(null)
      return
    }
    let vivo = true
    cargarNpSaldos({ clientId, formulaId }).then((x) => vivo && setSaldos(x))
    return () => {
      vivo = false
    }
  }, [activo, clientId, formulaId, lista])

  useEffect(() => {
    if (!activo || !lista || !puedePrecio || !formulaId || !plantId) {
      setInfoPrecio(null)
      return
    }
    let vivo = true
    leerPrecioNp({ formulaId, plantId, remito: remito || null, pedidoId: pedidoId || null }).then((x) => vivo && setInfoPrecio(x))
    return () => {
      vivo = false
    }
  }, [activo, lista, puedePrecio, formulaId, plantId, remito, pedidoId, vueltaPrecio])

  // Otro pedido (o uno nuevo): no se muestra lo del anterior mientras llega lo de este
  useEffect(() => {
    setInfoPrecio(null)
    setAvisoActualizar(null)
  }, [pedidoId])

  // Cambió la fórmula: el precio vuelve a la lista (lo tipeado era para la otra)
  useEffect(() => {
    if (formulaAntes.current === formulaId) return
    formulaAntes.current = formulaId
    if (precio && onPrecio && precio.tocado) onPrecio({ ...precio, texto: "", tocado: false })
  }, [formulaId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lo que puede cambiar quien llama: si se edita ahora, el precio de lista y (sin tocar) el puesto en el pedido
  const usable = !!infoPrecio && !infoPrecio.sinMigracion && infoPrecio.activo !== false
  const paraNueva = valor.tipo === "nueva" || (valor.tipo === "proyecto" && valor.tope_m3 !== null && valor.tope_m3 !== undefined)
  const editable = usable && paraNueva && !infoPrecio!.bloqueado && (infoPrecio!.estado === "ok" || infoPrecio!.estado === "no_en_lista")
  const precioLista = usable && precioValido(infoPrecio!.precio_lista) ? infoPrecio!.precio_lista! : null
  const inicial = usable && infoPrecio!.origen === "manual" && precioValido(infoPrecio!.precio_m3) ? textoPrecio(infoPrecio!.precio_m3!) : ""
  useEffect(() => {
    if (!precio || !onPrecio) return
    const texto = precio.tocado ? precio.texto : inicial
    if (precio.editable !== editable || precio.lista !== precioLista || precio.texto !== texto) onPrecio({ ...precio, texto, editable, lista: precioLista })
  }, [editable, precioLista, inicial, precio?.tocado, precio?.editable, precio?.lista, precio?.texto]) // eslint-disable-line react-hooks/exhaustive-deps

  async function actualizarLista() {
    setActualizando(true)
    setAvisoActualizar(null)
    const r = await actualizarCopiaZomatik("precios")
    setActualizando(false)
    setAvisoActualizar(!r.ok ? r.error || "No se pudo actualizar desde Zomatik." : r.reciente ? "Se actualizó hace menos de 2 minutos: es lo último de Zomatik." : null)
    setVueltaPrecio((v) => v + 1)
  }

  if (!activo) return <p className="text-xs text-muted-foreground">NP: se carga a mano en Zomatik.</p>
  if (!lista) return <p className="text-xs text-muted-foreground">{fallo ? "NP: no se pudo leer, se mantiene la elección (podés guardar igual)." : "Leyendo la NP del pedido…"}</p>

  const elegido = proyectos?.find((p) => p.codigo === valor.proyecto_codigo) || null
  const disp = disponibleProyecto(elegido)
  const contra = valor.tope_m3 !== null && valor.tope_m3 !== undefined ? Math.min(valor.tope_m3, m3) : m3
  const excede = valor.tipo === "proyecto" && disp.m3 !== null && m3 > 0 && contra > disp.m3 + 0.001
  const yaTiene = (estado?.nps || []).filter((x) => ["pendiente", "generando", "ok", "revisar", "error"].includes(x.estado))
  const saldoElegido = saldos?.find((x) => x.id === valor.np_id) || null
  // Falta vincular el cliente o la fórmula: sin eso la NP no sale (04/11). Un pedido de antes de prender la NP o con
  // "Usar NP con saldo", no
  const faltaTexto = [faltan?.cliente && `el cliente «${faltan.cliente}»`, faltan?.formula && `la fórmula «${faltan.formula}»`].filter(Boolean).join(" y ")
  const avisoVinculo = !!faltaTexto && !(estado && !estado.entra) && valor.tipo !== "saldo"
  const errorPorVinculo = yaTiene.some((x) => x.estado === "error" && esFaltaDeVinculo(x.mensaje))
  const botonVincular = puedeVincular && !soloLectura ? (
    <button type="button" className="rounded border border-amber-400 bg-white px-2 py-0.5 text-xs font-medium" onClick={onVincular}>Vincular</button>
  ) : null

  return (
    <div className="space-y-1.5">
      {avisoVinculo && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          <span className="min-w-0 flex-1">Falta vincular con Zomatik: {faltaTexto}. Sin eso la NP no sale.</span>
          {botonVincular}
        </div>
      )}
      <div className="grid grid-cols-1 gap-1.5 md:grid-cols-3">
        {OPCIONES.map(([k, l, d]) => (
          <button
            key={k}
            type="button"
            disabled={deshabilitado}
            onClick={() =>
              onCambio(
                k === "nueva" ? { tipo: "nueva", proyecto_codigo: null, tope_m3: null, np_id: null }
                : k === "proyecto" ? { tipo: "proyecto", proyecto_codigo: valor.proyecto_codigo || proyectos?.[0]?.codigo || null, tope_m3: null, np_id: null }
                : { tipo: "saldo", proyecto_codigo: null, tope_m3: null, np_id: valor.np_id || saldos?.[0]?.id || null },
              )
            }
            className={cn("h-8 rounded-md border-2 px-2 text-left text-xs leading-tight", valor.tipo === k ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50")}
          >
            <span className="font-medium">{l}</span> <span className="text-muted-foreground">· {d}</span>
          </button>
        ))}
      </div>

      {valor.tipo === "proyecto" && (
        <div className="space-y-1">
          {proyectos === null && <p className="text-xs text-muted-foreground">Buscando proyectos…</p>}
          {sinVinculo && <p className="text-xs text-amber-700">El cliente no está vinculado con Zomatik (Vínculos con Zomatik).</p>}
          {proyectos && !proyectos.length && !sinVinculo && <p className="text-xs text-amber-700">El cliente no tiene proyectos abiertos en Zomatik.</p>}
          {proyectos?.map((p) => {
            const d = disponibleProyecto(p)
            return (
              <button
                key={p.codigo}
                type="button"
                disabled={deshabilitado}
                onClick={() => onCambio({ tipo: "proyecto", proyecto_codigo: p.codigo, tope_m3: null, np_id: null })}
                className={cn("flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-xs", valor.proyecto_codigo === p.codigo ? "border-primary bg-primary/5" : "hover:bg-muted/50")}
              >
                <span className="font-medium tabular-nums">{p.numero}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{p.obra || ""}{p.de_la_obra ? " · de esta obra" : ""}</span>
                <span className="shrink-0 tabular-nums">
                  {d.m3 === null ? "saldo sin dato" : `${d.estimado ? "≈ " : ""}${m3t(d.m3)} m³`}
                  {p.disponible_m3 !== null && p.disponible_at ? <span className="text-muted-foreground"> (Zomatik {fechaCorta(p.disponible_at)})</span> : d.estimado && d.m3 !== null ? <span className="text-muted-foreground"> (estimado)</span> : null}
                </span>
              </button>
            )
          })}
          {valor.tope_m3 !== null && valor.tope_m3 !== undefined && m3 > valor.tope_m3 && (
            <p className="text-xs">
              Van {m3t(valor.tope_m3)} m³ contra el proyecto y {m3t(m3 - valor.tope_m3)} m³ en una NP nueva.{" "}
              {!deshabilitado && <button type="button" className="underline" onClick={() => onCambio({ ...valor, tope_m3: null })}>Quitar</button>}
            </p>
          )}
          {excede && !igual && disp.m3 !== null && (
            <div className="space-y-1 rounded-md border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-800">
              <p>
                Al proyecto {elegido?.numero} le quedan {disp.estimado ? "≈ " : ""}{m3t(disp.m3)} m³ y estás programando {m3t(m3)} m³. Zomatik no va a dejar fabricar ni remitir lo que sobra.
              </p>
              {!deshabilitado && (
                <div className="flex flex-wrap gap-1.5">
                  {disp.m3 > 0 && <button type="button" className="rounded border border-red-300 bg-white px-2 py-0.5" onClick={() => onM3(Math.floor(disp.m3! * 2) / 2)}>Programar solo {m3t(Math.floor(disp.m3 * 2) / 2)} m³</button>}
                  {disp.m3 > 0 && <button type="button" className="rounded border border-red-300 bg-white px-2 py-0.5" onClick={() => onCambio({ ...valor, tope_m3: Math.floor(disp.m3! * 2) / 2 })}>{m3t(Math.floor(disp.m3 * 2) / 2)} al proyecto y el resto en una NP nueva</button>}
                  <button type="button" className="rounded border border-red-300 bg-white px-2 py-0.5" onClick={() => setIgual(true)}>Guardar igual (queda sin NP)</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {valor.tipo === "saldo" && (
        <div className="space-y-1">
          {saldos === null && <p className="text-xs text-muted-foreground">{formulaId ? "Buscando NP con saldo…" : "Elegí la fórmula para ver las NP con saldo."}</p>}
          {saldos && !saldos.length && <p className="text-xs text-amber-700">El cliente no tiene NP con saldo de esta fórmula.</p>}
          {saldos?.map((x) => (
            <button
              key={x.id}
              type="button"
              disabled={deshabilitado}
              onClick={() => onCambio({ tipo: "saldo", proyecto_codigo: null, tope_m3: null, np_id: x.id })}
              className={cn("flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-xs", valor.np_id === x.id ? "border-primary bg-primary/5" : "hover:bg-muted/50")}
            >
              <span className="font-medium tabular-nums">{x.numero || "NP"}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{x.formula || ""}{x.obra ? ` · ${x.obra}` : ""} · del {fechaCorta(x.fecha)}</span>
              <span className="shrink-0 tabular-nums">{m3t(x.libre)} m³ libres</span>
            </button>
          ))}
          {saldoElegido && m3 > saldoElegido.libre + 0.001 && <p className="text-xs">Toma {m3t(saldoElegido.libre)} m³ de esa NP y {m3t(m3 - saldoElegido.libre)} m³ van en una NP nueva.</p>}
        </div>
      )}

      {fechaCambiada && (
        <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          <p>El pedido cambió de fecha. ¿Mover la NP a la nueva fecha?</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" disabled={deshabilitado} className={cn("rounded border px-2 py-0.5", moverFecha === true ? "border-primary bg-white font-medium" : "border-amber-300 bg-white")} onClick={() => onMoverFecha(true)}>Sí, mover la NP</button>
            <button type="button" disabled={deshabilitado} className={cn("rounded border px-2 py-0.5", moverFecha === false ? "border-primary bg-white font-medium" : "border-amber-300 bg-white")} onClick={() => onMoverFecha(false)}>No: la NP queda pendiente y va una nueva</button>
          </div>
        </div>
      )}

      {puedePrecio && usable && <LineaPrecio info={infoPrecio!} valor={valor} precio={precio!} onPrecio={onPrecio!} editable={editable} lista={precioLista} actualizando={actualizando} onActualizar={actualizarLista} aviso={avisoActualizar} />}

      <p className="text-[11px] text-muted-foreground">Crear proyecto: por ahora los proyectos se cargan en Zomatik.</p>
      {yaTiene.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="text-muted-foreground">Ya tiene:</span>
          <NpChip estado={estado} />
          {yaTiene.filter((x) => x.mensaje && x.estado !== "ok").map((x) => <span key={x.id} className="text-red-700">{x.mensaje}</span>)}
          {errorPorVinculo && !avisoVinculo && botonVincular}
        </div>
      )}
    </div>
  )
}

const leidaEl = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }).replace(",", "") : ""

/** Una sola línea, input de ancho fijo: el precio por m³ (neto, sin IVA) que va a la NP de Zomatik. */
function LineaPrecio({ info, valor, precio, onPrecio, editable, lista, actualizando, onActualizar, aviso }: {
  info: PrecioNp
  valor: EleccionNp
  precio: PrecioNpForm
  onPrecio: (p: PrecioNpForm) => void
  editable: boolean
  lista: number | null
  actualizando: boolean
  /** Resultado del último "Actualizar" (falló o fue reciente). */
  aviso: string | null
  onActualizar: () => void
}) {
  const gris = "flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
  const actualizar = (
    <>
      <button type="button" disabled={actualizando} className="rounded border px-2 py-0.5 text-xs text-foreground hover:bg-muted/50" onClick={onActualizar}>
        {actualizando ? "Actualizando…" : "Actualizar"}
      </button>
      {aviso && <span className="text-amber-700">{aviso}</span>}
    </>
  )
  if (valor.tipo === "saldo") return <p className={gris}>Precio por m³: el de la NP con saldo</p>
  if (valor.tipo === "proyecto" && (valor.tope_m3 === null || valor.tope_m3 === undefined))
    return <p className={gris}>Precio por m³: {precioValido(info.proyecto_precio_m3) ? `$ ${textoPrecio(info.proyecto_precio_m3!)}, del proyecto` : "el del proyecto"}</p>
  if (info.estado === "sin_vinculo") return <p className={gris}>Precio: vinculá la fórmula con Zomatik</p>
  if (info.bloqueado)
    return <p className={gris}>Precio por m³: {precioValido(info.precio_m3) ? `$ ${textoPrecio(info.precio_m3!)} · ` : ""}ya está en la NP (para cambiarlo, en Zomatik)</p>
  if (info.estado === "sin_lista" || !editable)
    return (
      <div className={gris}>
        <span className="text-amber-700">{info.aviso === MSJ_LISTA_SIN_REMITO ? MSJ_LISTA_SIN_REMITO : info.aviso || "No se pudo saber la lista: revisá las listas en Zomatik"}</span>
        {info.aviso !== MSJ_LISTA_SIN_REMITO && actualizar}
      </div>
    )
  const tipeado = precio.texto.trim() ? precioDeTexto(precio.texto) : null
  const malo = !!precio.texto.trim() && !precioValido(tipeado)
  const dif = !malo ? diferenciaConLista(tipeado, lista) : null
  const ayuda = `Es el precio que va a la NP de Zomatik, sin IVA. Vacío = el de la lista. Se puede cambiar hasta que sale la NP.${info.lista ? ` Lista ${info.lista.nombre.replace(/^0\s*-\s*Lista\s*/i, "")}, leída el ${leidaEl(info.lista.leida_at)}.` : ""}`
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-medium">{valor.tipo === "proyecto" ? "Precio del resto (NP nueva, sin IVA)" : "Precio por m³ (sin IVA)"}</span>
      <span className="flex items-center gap-1">
        $
        <Input
          inputMode="decimal"
          className="h-7 w-28 px-2 text-xs tabular-nums"
          placeholder={lista !== null ? textoPrecio(lista) : ""}
          value={precio.texto}
          onChange={(e) => onPrecio({ ...precio, texto: e.target.value, tocado: true })}
        />
      </span>
      {lista !== null ? <span className="text-muted-foreground tabular-nums">Lista: $ {textoPrecio(lista)}</span> : <span className="text-amber-700">No está en la lista de Zomatik</span>}
      <span className="cursor-help text-muted-foreground" title={ayuda}>(?)</span>
      {malo ? <span className="text-red-700">{MSJ_PRECIO_INVALIDO}</span> : dif ? <span className="text-amber-700">{dif}</span> : null}
      {lista === null && actualizar}
    </div>
  )
}
