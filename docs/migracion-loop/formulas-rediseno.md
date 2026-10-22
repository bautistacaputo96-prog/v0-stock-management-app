# Fórmulas · rediseño (tabla resumen)

Aprobado por Bautista el 22/10/2026 ("Programalo"). Rama `loop/formulas` (sale de `loop/carga-planta`). Solo pantalla: sin migraciones.

## Qué cambia

`/formulas` deja el acordeón por resistencia y pasa a una tabla densa, estilo "Tabla resumen de dosificaciones" de Grow.

- **Encabezado:** título, planta (Hudson / Canning), buscador por código o nombre y "+ Nueva" (el mismo diálogo de alta, con `formulas.cargar`).
- **Filtros en chips:** resistencia (Todas, H4 … H50, y "Otras" si hay RDC u otras sin H), piedra (las que usa alguna fórmula: 6/20, 6/12, 10/30), B / C y "Solo usadas en 90 días".
- **Tabla:** una fila por fórmula; una columna por material de la planta que alguna fórmula usa, en el orden de la planilla (CPC 40, Arena Fina, Arena Trituración 0/6, Piedra 6/20, 6/12, 10/30, Agua, Sikament 90E, Sikament 33S, Espumígeno; lo que no figure va al final por tipo). "—" en gris si no lo usa. Usos = despachos de los últimos 90 días (sin los de prueba). Última edición. 12 px, filas de 28 px, encabezado y código fijos, ordenable por columna, fila elegida resaltada.
- **Panel al costado** (no es modal): código, planta, B/C, asentamiento, rinde, descripción, última edición; materiales por m³; receta de la planta (Indumix) si la fórmula tiene número en `puesto_recetas`, con cada diferencia en ámbar ("Planta (receta 13): CPC 40 350 kg · Agua 110 L", misma comparación que la carga, `lib/carga/receta.ts`); Zomatik vinculado o "Sin vincular"; botones Editar (`formulas.editar`), Historial (`activity_log` de esa fórmula), Copiar a la otra planta (`formulas.cargar`, con confirmación) y Eliminar (`formulas.borrar`).
- **Copiar a la otra planta:** Canning lleva el sufijo "(CAN)", Hudson no. No copia si ya existe el mismo código (sin el sufijo) en la otra planta, ni si a la otra planta le falta algún material (se busca por nombre). No copia el artículo de Zomatik. Queda en Actividad como alta con "Copiada de".

Editar y borrar siguen con motivo y registro en Actividad (fase 0c-1), con los mismos diálogos de antes.

## Archivos

- `lib/formulas-tabla.ts`: lógica pura (código, orden de materiales, matriz, filtros, orden, copia, receta). Pruebas: `npm run test:formulas`.
- `app/formulas/page.tsx`: la pantalla.
- `components/formulas/panel-formula.tsx`: panel, historial y copia.
- `components/add-formula-dialog.tsx`: el botón acepta texto y tamaño (`etiqueta`, `compacto`).
- Se retiró `components/formulas-grouped-view.tsx` (el acordeón).

## Hecho

- Todo lo de antes sigue: alta, edición, borrado (con el control de despachos asociados), buscador, filtro por resistencia y por método (Canaleta/Bombeable = chips C/B).
- Lo que el diseño viejo tenía y cambió de lugar: la vista de detalle (ojo) es ahora el panel; las columnas Piedra / Asentamiento / Método salen de los materiales y del panel; el "por usuario" de la última edición está en el panel.
- No pasó al panel la marca "Humedad: aplica" de arenas y piedras del detalle viejo (es solo informativa: se corrige por el tipo de material). Si se quiere, se agrega.
- El selector de planta ya no ofrece "Todas las plantas" (con la tabla por materiales de una planta no tiene sentido; antes mostraba la lista vacía).
- `components/view-formula-dialog.tsx` y `components/formulas-table.tsx` quedaron sin uso (el segundo ya lo estaba): no se borraron.
- Pendiente de probar en el navegador (esta implementación no lo usó): que entre en 1366×768 con el panel abierto (estimado ~780 px de tabla; si no entra, scroll horizontal con el código fijo).
