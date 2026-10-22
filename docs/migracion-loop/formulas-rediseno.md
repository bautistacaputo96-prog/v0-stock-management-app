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

## Cambios del 22/10 (segunda tanda)

### Nombre automático

- Alta y edición arman el código con partes: resistencia, piedra (620 / 612 / 1030, opcional), asentamiento (cm), C común / B bombeable, la planta sola ((CAN) Canning, (HUD) Hudson) y un comentario opcional en mayúsculas. Formato `H30-620-15 B (CAN) PELQUE`, el mismo que los artículos de Zomatik. El nombre de la fórmula queda igual al código.
- "Nombre libre" (RDC, GUN, cordones, recuperado) solo para gerenciales. Una fórmula con nombre libre la puede editar cualquiera con Fórmulas · editar, pero el nombre solo lo cambia un gerencial.
- Al editar una fórmula vieja, si el formato nuevo da otro código, el diálogo avisa: "Al guardar, el código pasa de … a …".
- "Copiar a la otra planta" usa el mismo armado: cambia (CAN) ↔ (HUD), y en las de nombre libre cambia solo la etiqueta.
- El alta ya no tiene "Etiqueta" (se ponía con " - " y además iba a la descripción): ahora es el comentario.
- **Normalizar nombres** (botón en el encabezado, para un gerencial con Fórmulas · editar): muestra "actual → propuesto" de las dos plantas, en tres listas: para renombrar, revisar a mano y ya están bien. Las que no se pueden leer, o que quedarían iguales a otra de su planta, van a "revisar a mano" con una sugerencia que se puede corregir. Se aplica todas juntas o de a una, siempre con confirmación. Cada cambio queda en Actividad (motivo "Normalizar nombres"). No toca `updated_at`, así "Últ. edic." sigue siendo la de la receta. **No se aplicó en la base: lo hace Bautista desde la pantalla.**
- Qué busca fórmulas por código o nombre (revisado):
  - despachos, pedidos, probetas, `puesto_recetas` y el vínculo con Zomatik (`zomatik_articulo_codigo`) usan `formula_id` o el código del artículo: no se rompen;
  - `nombreParaIndumix` (recetas del simulador) sacaba "(CAN)" solo al final: ahora la saca esté donde esté (con PELQUE después);
  - la receta 13 del simulador busca "H30-612-15 B (CAN)", que ya está en el formato nuevo;
  - el informe semanal de calidad toma la resistencia con `H\d+`: sigue bien;
  - el sugeridor de vínculos de Zomatik (rama `loop/zomatik`, sin publicar) compara nombres con los artículos, que ya usan (CAN)/(HUD): con el renombre deberían coincidir más;
  - `zomatik_articulo_nombre` es el nombre del artículo en Zomatik, no el de la fórmula: no cambia;
  - el despacho por árido (Tolva 1) mira los materiales de la fórmula, no el código.

### Permisos: gerencial "todo salvo lo que se le saque"

- `lib/permisos.ts`: a un gerencial solo lo frena un `false` explícito en su matriz; lo que falta vale sí. Usuarios no se le puede sacar (así nadie queda afuera). Operario y consulta siguen igual.
- Usuarios: las casillas de un gerencial se pueden destildar (marca "a mano") y la lista muestra "Sin: …". El servidor guarda lo destildado y lo deja en Actividad.
- Servidor: las rutas de carga ya chequean con `puedeCon`, que respeta lo destildado. `exigirGerencial` queda solo para las rutas de Usuarios, que no se le pueden sacar. Lo "solo gerencial" que no es una sección (corregir tiempos, Actividad, el menú de Usuarios) sigue por tipo.
- Las altas, ediciones y borrados de fórmulas se escriben desde el navegador con la clave anon (como antes): el freno es la pantalla, no la base.
- **Pendiente de Bautista:** en Usuarios, a Fernando Maldonado destildarle Fórmulas · cargar, editar y borrar. No se tocó en la base.

